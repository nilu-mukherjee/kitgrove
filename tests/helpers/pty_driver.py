"""Drives the built grovekit TUI in a pseudo-terminal and prints a JSON summary.

usage: python3 -I pty_driver.py <path to dist/cli.js> <project dir> navigate|ctrl-c

Keys are sent only after the screen shows the text they depend on (never on fixed timers), so the
result does not depend on how fast the machine starts Node.
"""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

bin_path, cwd, scenario = sys.argv[1], sys.argv[2], sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    # Ink detects CI (CI, CONTINUOUS_INTEGRATION) and then writes only the final frame, which would
    # hide the live screens this driver is checking. Launch exactly as a person's terminal would.
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ('CI', 'CONTINUOUS_INTEGRATION') and not k.startswith('CI_')
    }
    env.setdefault('TERM', 'xterm-256color')
    # Size the terminal before the program starts so it never sees 0x0.
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    os.execvpe('node', ['node', bin_path], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
log = b''


def read_for(seconds):
    global log
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            log += chunk


def quiet(quiet_for=0.7, max_wait=25.0):
    """Reads until the terminal has produced no output for `quiet_for` seconds (the screen has settled).

    Ink redraws only what changed, so waiting for text to reappear is unreliable; waiting for
    quiescence works on any machine regardless of how long Node takes to start or render.
    """
    end = time.time() + max_wait
    seen = len(log)
    last = time.time()
    while time.time() < end:
        read_for(0.05)
        if len(log) != seen:
            seen = len(log)
            last = time.time()
        elif time.time() - last >= quiet_for and seen > 0:
            return


def wait_text(text, max_wait=30.0):
    """Waits for `text` that has not been on screen before, then lets the screen settle.

    Use for the first appearance of a screen; `quiet` is only right for keys that produce no new text.
    """
    needle = text.encode()
    end = time.time() + max_wait
    while time.time() < end and needle not in log:
        read_for(0.1)
    quiet(0.5)
    return needle in log


def send(keys, settle=True):
    os.write(fd, keys)
    if settle:
        quiet()


DOWN, ESC = b'\x1b[B', b'\x1b'
ok = {}

ok['home'] = wait_text('New collection')  # startup: Node boot, module load, first render
if scenario == 'navigate':
    send(b'\r', settle=False)  # Collections
    ok['collections'] = wait_text('TENANT-SCOPED')
    send(ESC)
    for _ in range(7):  # Collections, New collection, Tenants, Users, Access, Data, Run -> Doctor
        send(DOWN)
    send(b'\r', settle=False)
    ok['doctor'] = wait_text('dependencies installed')
    send(ESC)
    send(b'q', settle=False)
else:
    send(b'\x03', settle=False)  # Ctrl+C from Home

# Wait for the process to exit; never hang the test run.
code = -1
end = time.time() + 15
while time.time() < end:
    read_for(0.1)
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
        break
else:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
read_for(0.2)

text = log.decode(errors='replace')
print(json.dumps({
    'enter': '\x1b[?1049h' in text,
    'leave': '\x1b[?1049l' in text,
    'home': bool(ok.get('home')),
    'collections': bool(ok.get('collections')) and 'pages' in text,
    'doctor': bool(ok.get('doctor')),
    'code': code,
}))

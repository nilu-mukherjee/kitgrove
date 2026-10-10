"""Records a real kitgrove session as an asciinema v2 cast (demo/kitgrove.cast).

usage: python3 scripts/record-demo.py [path to dist/cli.js] [output .cast]

Every command is executed for real in a throwaway directory; only the typing is simulated.
View it with `asciinema play demo/kitgrove.cast`, or turn it into a GIF with `agg`.
"""
import fcntl
import json
import os
import pty
import select
import shutil
import struct
import sys
import tempfile
import termios
import time

BIN = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist/cli.js')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'demo/kitgrove.cast'
COLS, ROWS = 100, 30
MAX_GAP = 1.2  # never leave a viewer staring at a still screen for longer than this

work = tempfile.mkdtemp(prefix='kitgrove-demo-')
bindir = os.path.join(work, '.bin')
os.makedirs(bindir)
os.symlink(BIN, os.path.join(bindir, 'kitgrove'))
os.chmod(BIN, 0o755)
env = {k: v for k, v in os.environ.items() if k != 'CI' and not k.startswith('CI_')}
env.update(PATH=f'{bindir}:{env["PATH"]}', TERM='xterm-256color', HOME=work, PS1='$ ')

events = []  # (seconds since start, text)
clock = 0.0


def emit(text, gap=0.0):
    global clock
    clock += min(gap, MAX_GAP)
    events.append((round(clock, 3), text))


def type_command(cmd):
    emit('\x1b[1;32m$\x1b[0m ', 0.5)
    for ch in cmd:
        emit(ch, 0.035)
    emit('\r\n', 0.35)


def run(cmd, cwd):
    """Run a real command in a pty and record its output with its real timing."""
    type_command(cmd)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe('sh', ['sh', '-c', cmd], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    last = time.time()
    while True:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            now = time.time()
            emit(data.decode(errors='replace'), now - last)
            last = now
        else:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done:
                return
    os.waitpid(pid, 0)


def run_tui(cwd, steps):
    """Open the TUI and send scripted keys, recording the real screen output."""
    type_command('kitgrove')
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe('kitgrove', ['kitgrove'], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    last = time.time()

    def pump(seconds):
        nonlocal last
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return
                if not data:
                    return
                now = time.time()
                emit(data.decode(errors='replace'), now - last)
                last = now

    pump(3.0)
    for keys, wait in steps:
        emit('', 0.4)  # a human beat between keys
        os.write(fd, keys)
        pump(wait)
    pump(1.0)
    os.waitpid(pid, 0)


try:
    emit('', 0.3)
    run('kitgrove create my-cms --template corporate --db postgres --headless --yes --no-install', work)
    cms = os.path.join(work, 'my-cms')
    run('cd my-cms && kitgrove generate collection "Case Studies" --fields "client:text![unique],summary:textarea,status:select:draft|live[default=draft]" --access read=public,update=tenant-editor', work)
    run('cat my-cms/src/collections/CaseStudies.ts', work)
    run('cd my-cms && kitgrove access show case-studies', work)
    DOWN, ESC = b'\x1b[B', b'\x1b'
    run_tui(cms, [(b'\r', 2.0), (ESC, 0.8), (DOWN, 0.4), (DOWN, 0.4), (b'q', 1.0)])
    emit('\r\n', 0.3)

    header = {'version': 2, 'width': COLS, 'height': ROWS, 'timestamp': int(time.time()),
              'title': 'kitgrove: one Payload backend for many sites',
              'env': {'TERM': 'xterm-256color', 'SHELL': '/bin/sh'}}
    os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(json.dumps(header) + '\n')
        for t, text in events:
            if text:
                f.write(json.dumps([t, 'o', text.replace('\n', '\r\n') if '\r\n' not in text else text]) + '\n')
    print(f'wrote {OUT}: {len(events)} events, {clock:.1f}s')
finally:
    shutil.rmtree(work, ignore_errors=True)

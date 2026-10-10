"""Drives the built paycms TUI in a pseudo-terminal and prints a JSON summary.

usage: python3 -I pty_driver.py <path to dist/cli.js> <project dir> navigate|ctrl-c
"""
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios
import time

bin_path, cwd, scenario = sys.argv[1], sys.argv[2], sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvp('node', ['node', bin_path])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
log = b''


def drain(t):
    global log
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                log += os.read(fd, 65536)
            except OSError:
                return


def send(keys, wait=0.6):
    os.write(fd, keys)
    drain(wait)


DOWN, ESC = b'\x1b[B', b'\x1b'
drain(2.5)
if scenario == 'navigate':
    send(b'\r', 1.2)  # Collections
    send(ESC)
    for _ in range(7):  # down to Doctor
        send(DOWN, 0.15)
    send(b'\r', 2.0)  # Doctor
    send(ESC)
    send(b'q', 1.0)
else:
    send(b'\x03', 1.0)  # Ctrl+C from Home
_, status = os.waitpid(pid, 0)
text = log.decode(errors='replace')
print(json.dumps({
    'enter': '\x1b[?1049h' in text,
    'leave': '\x1b[?1049l' in text,
    'home': 'New collection' in text,
    'collections': 'TENANT-SCOPED' in text and 'pages' in text,
    'doctor': 'dependencies installed' in text,
    'code': os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1,
}))

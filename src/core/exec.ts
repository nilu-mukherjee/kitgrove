import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import type { PackageManager, ProjectInfo } from './project.js'

/** Runs a command with inherited stdio and resolves with its exit code. */
export function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** The command line that runs a package.json script through `pm`, forwarding `args` to it. */
export function scriptCommand(
  pm: PackageManager,
  script: string,
  args: string[],
): { command: string; args: string[] } {
  if (pm === 'yarn') return { command: 'yarn', args: [script, ...args] }
  if (pm === 'pnpm') return { command: 'pnpm', args: ['run', script, ...args] }
  return { command: 'npm', args: ['run', script, ...(args.length ? ['--', ...args] : [])] }
}

export function runScript(project: ProjectInfo, script: string, args: string[] = []): Promise<number> {
  const { command, args: full } = scriptCommand(project.packageManager, script, args)
  return run(command, full, project.root)
}

export interface LoggedProcess {
  /** Terminates the process (and its children). Safe to call more than once. */
  stop(): void
  /** Resolves with the exit code; 127 if it could not start, 128+signal when killed. */
  done: Promise<number>
}

/** Spawns a command, delivering complete output lines (stdout and stderr) to `onLine`. */
export function spawnLogged(
  command: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  env: Record<string, string | undefined> = {},
): LoggedProcess {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so stop() reaches grandchildren (npm -> next)
    env: { ...process.env, ...env, FORCE_COLOR: '0' },
  })

  const buffers = { out: '', err: '' }
  const feed = (key: 'out' | 'err') => (chunk: Buffer) => {
    const parts = (buffers[key] + chunk.toString()).split(/\r?\n/)
    buffers[key] = parts.pop() ?? ''
    for (const line of parts) onLine(line)
  }
  child.stdout?.on('data', feed('out'))
  child.stderr?.on('data', feed('err'))

  const done = new Promise<number>((resolve) => {
    child.on('error', (err) => {
      onLine(`Could not start "${command}": ${err.message}`)
      resolve(127)
    })
    child.on('close', (code, signal) => {
      for (const key of ['out', 'err'] as const) if (buffers[key]) onLine(buffers[key])
      resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 15) : 1))
    })
  })

  return {
    done,
    stop() {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    },
  }
}

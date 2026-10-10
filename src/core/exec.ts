import { spawn } from 'node:child_process'
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

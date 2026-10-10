import type { Command } from 'commander'
import { runScript } from '../core/exec.js'
import { requireProject, type ProjectInfo } from '../core/project.js'

export type WrapperName = 'dev' | 'build' | 'migrate' | 'types'

type Exec = (project: ProjectInfo, script: string, args: string[]) => Promise<number>

/** Runs the project script behind a wrapper command and returns its exit code. */
export function runWrapper(
  name: WrapperName,
  args: string[],
  project: ProjectInfo,
  exec: Exec = runScript,
): Promise<number> {
  switch (name) {
    case 'dev':
      return exec(project, 'dev', args)
    case 'build':
      return exec(project, 'build', args)
    case 'types':
      return exec(project, 'generate:types', args)
    case 'migrate':
      return exec(project, 'payload', ['migrate', ...args])
  }
}

export function registerWrappers(program: Command): void {
  const defs: [WrapperName, string][] = [
    ['dev', 'Start the Next.js + Payload dev server'],
    ['build', 'Build the project for production'],
    ['migrate', 'Run `payload migrate` (pass subcommands, e.g. `grovekit migrate create add-notes`)'],
    ['types', 'Regenerate payload-types.ts'],
  ]
  for (const [name, description] of defs) {
    program
      .command(`${name} [args...]`)
      .description(description)
      .allowUnknownOption()
      .action(async (args: string[]) => {
        process.exitCode = await runWrapper(name, args, requireProject(process.cwd()))
      })
  }
}

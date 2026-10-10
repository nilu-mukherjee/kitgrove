import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('paycms')
    .description('Create and manage multi-tenant Payload CMS projects')
    .version(pkg.version)
    .option('--verbose', 'show stack traces on errors')
  return program
}

function isEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isEntry()) {
  buildProgram().parseAsync(process.argv)
}

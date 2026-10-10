import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { registerAccess } from './commands/access.js'
import { registerCreate } from './commands/create.js'
import { registerData } from './commands/data.js'
import { registerDoctor } from './commands/doctor.js'
import { registerGenerate } from './commands/generate.js'
import { registerTenant } from './commands/tenant.js'
import { registerUser } from './commands/user.js'
import { registerWrappers } from './commands/wrappers.js'
import { CliError } from './core/errors.js'

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
  registerCreate(program)
  registerGenerate(program)
  registerTenant(program)
  registerAccess(program)
  registerUser(program)
  registerData(program)
  registerWrappers(program)
  registerDoctor(program)
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
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      const verbose = process.argv.includes('--verbose')
      if (err instanceof CliError) console.error(`Error: ${err.message}`)
      else console.error(verbose ? err : `Unexpected error: ${(err as Error)?.message ?? err}`)
      if (verbose && err instanceof CliError) console.error(err.stack)
      process.exit(1)
    })
}

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readProjectEnv } from './env.js'
import { CliError } from './errors.js'
import type { ProjectInfo } from './project.js'

/** Makes the project's .env / .env.local values visible to its config. Existing variables win. */
function loadProjectEnv(root: string): void {
  for (const [key, value] of Object.entries(readProjectEnv(root))) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value
  }
}

/**
 * Initialises the project's own Payload (Local API, no HTTP server) from its payload.config.ts,
 * runs `fn`, and always closes the database connection.
 */
export async function withPayload<P, T>(project: ProjectInfo, fn: (payload: P) => Promise<T>): Promise<T> {
  loadProjectEnv(project.root)
  process.env.DISABLE_PAYLOAD_HMR = 'true'

  let payload: { destroy: () => Promise<void> }
  try {
    const { tsImport } = await import('tsx/esm/api')
    const projectRequire = createRequire(join(project.root, 'package.json'))
    const [{ getPayload }, configModule] = await Promise.all([
      import(pathToFileURL(projectRequire.resolve('payload')).href) as Promise<{
        getPayload: (args: { config: unknown }) => Promise<{ destroy: () => Promise<void> }>
      }>,
      tsImport(project.configPath, {
        parentURL: pathToFileURL(project.configPath).href,
        tsconfig: join(project.root, 'tsconfig.json'),
      }) as Promise<{ default: unknown }>,
    ])
    payload = await getPayload({ config: await configModule.default })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new CliError(
      `Could not initialise Payload: ${message}\n` +
        'Check your .env (DATABASE_URL, PAYLOAD_SECRET), that dependencies are installed, and run `paycms doctor`.',
    )
  }

  try {
    return await fn(payload as unknown as P)
  } finally {
    await payload.destroy()
  }
}

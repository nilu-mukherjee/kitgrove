import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CliError } from './errors.js'
import type { ProjectInfo } from './project.js'

/** Loads .env.local then .env from the project root. Variables already set are never overridden. */
function loadProjectEnv(root: string): void {
  for (const file of ['.env.local', '.env']) {
    const path = join(root, file)
    if (existsSync(path)) process.loadEnvFile(path)
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

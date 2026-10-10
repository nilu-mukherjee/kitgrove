import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

/**
 * The environment a project would see: `.env`, overridden by `.env.local`, overridden by `base`
 * (the process environment). Pure: nothing is written to process.env.
 */
export function readProjectEnv(
  root: string,
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {}
  for (const file of ['.env', '.env.local']) {
    const path = join(root, file)
    if (existsSync(path)) Object.assign(merged, parseEnv(readFileSync(path, 'utf8')))
  }
  return { ...merged, ...base }
}

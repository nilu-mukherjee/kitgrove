import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package's root, found by walking up from the running file (works from src/ and dist/). */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('kitgrove: could not locate its own package root')
    dir = parent
  }
  return dir
}

export const templatesDir = (): string => join(packageRoot(), 'templates')

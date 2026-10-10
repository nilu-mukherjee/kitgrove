import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CliError } from './errors.js'

export type PackageManager = 'npm' | 'pnpm' | 'yarn'

export interface ProjectInfo {
  root: string
  configPath: string
  packageManager: PackageManager
}

function dependsOnPayload(pkgPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return Boolean(pkg.dependencies?.payload ?? pkg.devDependencies?.payload)
  } catch {
    return false
  }
}

function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Walks up from `cwd` to the nearest directory that is a Payload project. */
export function findProject(cwd: string): ProjectInfo | null {
  let dir = cwd
  for (;;) {
    if (dependsOnPayload(join(dir, 'package.json'))) {
      const configPath = [join(dir, 'src', 'payload.config.ts'), join(dir, 'payload.config.ts')].find(
        existsSync,
      )
      if (configPath) return { root: dir, configPath, packageManager: detectPackageManager(dir) }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function requireProject(cwd: string): ProjectInfo {
  const project = findProject(cwd)
  if (!project) {
    throw new CliError(
      'Not inside a Payload project (no package.json depending on "payload" with a payload.config.ts found). ' +
        'Run this from a project created with `paycms create`.',
    )
  }
  return project
}

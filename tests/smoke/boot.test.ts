/**
 * Slow, network-dependent: installs a generated project and checks that it type-checks.
 * Run with `npm run test:smoke`. Template/db via PAYCMS_SMOKE_TEMPLATE / PAYCMS_SMOKE_DB.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '..', '..')
const bin = join(repo, 'dist', 'cli.js')
const template = process.env.PAYCMS_SMOKE_TEMPLATE ?? 'corporate'
const db = process.env.PAYCMS_SMOKE_DB ?? 'postgres'

const env = {
  ...process.env,
  PAYLOAD_SECRET: 'smoke-test-secret-smoke-test-secret',
  DATABASE_URL:
    db === 'postgres' ? 'postgres://postgres:postgres@127.0.0.1:5432/smoke' : 'mongodb://127.0.0.1/smoke',
}

let root: string
const sh = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

beforeAll(() => {
  execFileSync('npm', ['run', 'build', '--silent'], { cwd: repo })
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-smoke-'))
  execFileSync('node', [bin, 'create', 'site', '-t', template, '-d', db, '--pm', 'npm', '--yes'], {
    cwd,
    env,
    stdio: 'inherit',
  })
  root = join(cwd, 'site')
  const g = spawnSync('node', [bin, 'generate', 'collection', 'Notes'], { cwd: root, env, encoding: 'utf8' })
  if (g.status !== 0) throw new Error(g.stderr)
})

describe(`generated ${template}/${db} project`, () => {
  it('generates types', () => {
    const r = sh('npx', ['payload', 'generate:types'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })

  it('type-checks', () => {
    const r = sh('npx', ['tsc', '--noEmit'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })
})

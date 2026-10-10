import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCreate } from '../../src/commands/create.js'
import { runDoctor } from '../../src/commands/doctor.js'
import { readProjectEnv } from '../../src/core/env.js'
import { findProject } from '../../src/core/project.js'

async function project(db: 'postgres' | 'mongodb' = 'postgres', installed = true) {
  const cwd = mkdtempSync(join(tmpdir(), 'grovekit-doc-'))
  await runCreate({ name: 'site', template: 'blank', db, pm: 'npm', yes: true, install: false, cwd })
  const root = join(cwd, 'site')
  if (installed) mkdirSync(join(root, 'node_modules', 'payload'), { recursive: true })
  return findProject(root)!
}

const GOOD_ENV = {
  PAYLOAD_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://u:p@db.example.com:5432/app',
}
const reachable = async () => true
const find = (checks: Awaited<ReturnType<typeof runDoctor>>, part: string) =>
  checks.find((c) => c.name.includes(part))!

describe('readProjectEnv', () => {
  it('prefers process env, then .env.local, then .env', () => {
    const root = mkdtempSync(join(tmpdir(), 'grovekit-env-'))
    writeFileSync(join(root, '.env'), 'A=from-env\nB=from-env\nC=from-env\n')
    writeFileSync(join(root, '.env.local'), 'B=from-local\nC=from-local\n')
    expect(readProjectEnv(root, { C: 'from-process' })).toMatchObject({
      A: 'from-env',
      B: 'from-local',
      C: 'from-process',
    })
  })
})

describe('runDoctor', () => {
  it('passes every check for a healthy project', async () => {
    const checks = await runDoctor(await project(), { env: GOOD_ENV, tcpCheck: reachable })
    expect(checks.filter((c) => !c.ok)).toEqual([])
  })

  it('flags a missing PAYLOAD_SECRET with a hint', async () => {
    const checks = await runDoctor(await project(), {
      env: { DATABASE_URL: GOOD_ENV.DATABASE_URL },
      tcpCheck: reachable,
    })
    const c = find(checks, 'PAYLOAD_SECRET')
    expect(c.ok).toBe(false)
    expect(c.hint).toMatch(/\.env/)
  })

  it('flags a DATABASE_URL that does not match the configured adapter', async () => {
    const checks = await runDoctor(await project('mongodb'), { env: GOOD_ENV, tcpCheck: reachable })
    expect(find(checks, 'matches').ok).toBe(false)
  })

  it('flags an unreachable database', async () => {
    const checks = await runDoctor(await project(), { env: GOOD_ENV, tcpCheck: async () => false })
    expect(find(checks, 'reachable').ok).toBe(false)
  })

  it('flags missing node_modules', async () => {
    const checks = await runDoctor(await project('postgres', false), { env: GOOD_ENV, tcpCheck: reachable })
    expect(find(checks, 'installed').ok).toBe(false)
  })
})

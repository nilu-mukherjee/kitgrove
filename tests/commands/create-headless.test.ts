import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { type Database, runCreate, type TemplateName } from '../../src/commands/create.js'

const FRONTEND = [
  'src/app/(frontend)/layout.tsx',
  'src/app/(frontend)/[[...slug]]/page.tsx',
  'src/app/(frontend)/blog/page.tsx',
  'src/app/(frontend)/blog/[slug]/page.tsx',
  'src/lib/tenant.ts',
  'src/lib/currentTenant.ts',
  'src/components/RenderBlocks.tsx',
]

const BACKEND = [
  'src/app/(payload)/layout.tsx',
  'src/app/(payload)/api/[...slug]/route.ts',
  'src/app/(payload)/api/graphql/route.ts',
  'src/payload.config.ts',
  'src/collections/Tenants.ts',
  'src/collections/Users.ts',
  'src/collections/Pages.ts',
  'src/access/tenantScoped.ts',
]

async function scaffold(template: TemplateName, db: Database, headless: boolean) {
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-headless-'))
  await runCreate({ name: 'api', template, db, pm: 'npm', yes: true, install: false, headless, cwd })
  return join(cwd, 'api')
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const combos = (['blank', 'blog', 'corporate'] as const).flatMap((t) =>
  (['postgres', 'mongodb'] as const).map((d) => [t, d] as const),
)

describe.each(combos)('headless %s / %s', (template, db) => {
  it('has no frontend files but keeps the admin, API and collections', async () => {
    const root = await scaffold(template, db, true)
    for (const f of FRONTEND) expect(existsSync(join(root, f)), `${f} should be absent`).toBe(false)
    for (const f of BACKEND) expect(existsSync(join(root, f)), `${f} should exist`).toBe(true)
    expect(existsSync(join(root, 'src/app/(frontend)'))).toBe(false)
  })

  it('nothing left refers to the removed frontend code', async () => {
    const root = await scaffold(template, db, true)
    for (const file of walk(join(root, 'src')).filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/@\/lib\/(tenant|currentTenant)|RenderBlocks|next\/headers/)
    }
  })

  it('enables API keys, CORS from the environment, and parses', async () => {
    const root = await scaffold(template, db, true)
    expect(readFileSync(join(root, 'src/collections/Users.ts'), 'utf8')).toContain('useAPIKey: true')
    const config = readFileSync(join(root, 'src/payload.config.ts'), 'utf8')
    expect(config).toContain('process.env.CORS_ORIGINS')
    for (const f of ['src/payload.config.ts', 'src/collections/Users.ts']) {
      const { diagnostics } = ts.transpileModule(readFileSync(join(root, f), 'utf8'), { reportDiagnostics: true })
      expect(diagnostics, f).toEqual([])
    }
    expect(readFileSync(join(root, '.env.example'), 'utf8')).toMatch(/^CORS_ORIGINS=/m)
  })

  it('documents the API instead of the frontend', async () => {
    const readme = readFileSync(join(await scaffold(template, db, true), 'README.md'), 'utf8')
    expect(readme).toContain('/api/graphql')
    expect(readme).toContain('tenant.slug')
    expect(readme).not.toContain('?tenant=')
  })
})

describe('non-headless is unchanged', () => {
  it.each(combos)('%s / %s keeps the frontend and plain auth', async (template, db) => {
    const root = await scaffold(template, db, false)
    expect(existsSync(join(root, 'src/app/(frontend)/layout.tsx'))).toBe(true)
    expect(existsSync(join(root, 'src/lib/tenant.ts'))).toBe(true)
    expect(readFileSync(join(root, 'src/collections/Users.ts'), 'utf8')).toMatch(/auth: true,/)
    expect(readFileSync(join(root, 'src/payload.config.ts'), 'utf8')).not.toContain('CORS_ORIGINS')
    expect(readFileSync(join(root, '.env.example'), 'utf8')).not.toContain('CORS_ORIGINS')
  })
})

describe('dry run', () => {
  it('lists no frontend files for a headless project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-headless-'))
    const files = await runCreate({
      name: 'api', template: 'corporate', db: 'postgres', pm: 'npm', yes: true, install: false, headless: true, dryRun: true, cwd,
    })
    expect(files.filter((f) => f.includes('(frontend)') || f.startsWith('src/lib/') || f.startsWith('src/components/'))).toEqual([])
    expect(files).toContain('src/payload.config.ts')
  })
})

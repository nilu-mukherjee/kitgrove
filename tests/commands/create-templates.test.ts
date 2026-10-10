import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { runCreate, type Database, type TemplateName } from '../../src/commands/create.js'

const BLOG_FILES = [
  'src/collections/Posts.ts',
  'src/collections/Categories.ts',
  'src/app/(frontend)/blog/page.tsx',
  'src/app/(frontend)/blog/[slug]/page.tsx',
]
const CORPORATE_FILES = [
  'src/blocks/Hero.ts',
  'src/blocks/Content.ts',
  'src/blocks/CallToAction.ts',
  'src/blocks/FormBlock.ts',
  'src/collections/Header.ts',
  'src/collections/Footer.ts',
]

async function scaffold(template: TemplateName, db: Database) {
  const cwd = mkdtempSync(join(tmpdir(), 'grovekit-tpl-'))
  await runCreate({ name: 'site', template, db, pm: 'npm', yes: true, install: false, cwd })
  return join(cwd, 'site')
}

const combos = (['blank', 'blog', 'corporate'] as const).flatMap((t) =>
  (['postgres', 'mongodb'] as const).map((d) => [t, d] as const),
)

describe.each(combos)('template %s / %s', (template, db) => {
  it('produces valid JSON and parseable TypeScript', async () => {
    const root = await scaffold(template, db)
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const f of ['src/payload.config.ts', 'src/collections/Pages.ts']) {
      const { diagnostics } = ts.transpileModule(readFileSync(join(root, f), 'utf8'), {
        reportDiagnostics: true,
      })
      expect(diagnostics, f).toEqual([])
    }
  })

  it('includes exactly the files for its template', async () => {
    const root = await scaffold(template, db)
    const has = (f: string) => existsSync(join(root, f))
    expect(BLOG_FILES.every(has)).toBe(template !== 'blank')
    expect(CORPORATE_FILES.every(has)).toBe(template === 'corporate')
    if (template === 'blank') expect(BLOG_FILES.some(has)).toBe(false)
    if (template !== 'corporate') expect(CORPORATE_FILES.some(has)).toBe(false)
  })

  it('registers its collections in the config', async () => {
    const config = readFileSync(join(await scaffold(template, db), 'src/payload.config.ts'), 'utf8')
    expect(/\bPosts\b/.test(config)).toBe(template !== 'blank')
    expect(/\bHeader\b/.test(config)).toBe(template === 'corporate')
    expect(config.includes('formBuilderPlugin')).toBe(template === 'corporate')
  })

  it('only depends on the form builder plugin for corporate', async () => {
    const pkg = JSON.parse(readFileSync(join(await scaffold(template, db), 'package.json'), 'utf8'))
    expect('@payloadcms/plugin-form-builder' in pkg.dependencies).toBe(template === 'corporate')
  })
})

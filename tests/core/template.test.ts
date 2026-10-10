import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliError } from '../../src/core/errors.js'
import { renderTemplateDir, toSlug } from '../../src/core/template.js'

function tmp(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeSrc(files: Record<string, string>) {
  const dir = tmp('kitgrove-src-')
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('toSlug', () => {
  it.each([
    ['BlogPosts', 'blog-posts'],
    ['blog posts', 'blog-posts'],
    ['Blog_Posts', 'blog-posts'],
    ['My Site', 'my-site'],
    ['posts', 'posts'],
  ])('normalises %s to %s', (input, expected) => {
    expect(toSlug(input)).toBe(expected)
  })

  it.each([[''], ['   '], ['9lives'], ['!!!']])('rejects %j', (input) => {
    expect(() => toSlug(input)).toThrow(CliError)
  })
})

describe('renderTemplateDir', () => {
  it('substitutes variables in .tpl files and drops the suffix', () => {
    const src = makeSrc({ 'a/hello.txt.tpl': 'Hi {{name}}!', 'plain.txt': '{{name}}' })
    const dest = tmp('kitgrove-dest-')
    const written = renderTemplateDir(src, dest, { name: 'Acme' })
    expect(written.sort()).toEqual(['a/hello.txt', 'plain.txt'])
    expect(readFileSync(join(dest, 'a/hello.txt'), 'utf8')).toBe('Hi Acme!')
    expect(readFileSync(join(dest, 'plain.txt'), 'utf8')).toBe('{{name}}')
  })

  it('handles {{#if}} blocks, including nested ones', () => {
    const src = makeSrc({
      'c.ts.tpl': 'A{{#if pg}}P{{#if extra}}E{{/if}}{{/if}}{{#if mongo}}M{{/if}}B',
    })
    const dest = tmp('kitgrove-dest-')
    renderTemplateDir(src, dest, { pg: true, extra: false, mongo: false })
    expect(readFileSync(join(dest, 'c.ts'), 'utf8')).toBe('APB')
  })

  it('throws on an unknown variable', () => {
    const src = makeSrc({ 'x.tpl': '{{nope}}' })
    expect(() => renderTemplateDir(src, tmp('kitgrove-dest-'), {})).toThrow(/nope/)
  })

  it('renames leading-underscore dotfiles', () => {
    const src = makeSrc({ '_gitignore': 'node_modules' })
    const dest = tmp('kitgrove-dest-')
    expect(renderTemplateDir(src, dest, {})).toEqual(['.gitignore'])
    expect(existsSync(join(dest, '.gitignore'))).toBe(true)
  })

  it('refuses to overwrite and writes nothing when any file conflicts', () => {
    const src = makeSrc({ 'a.txt': 'new-a', 'b.txt': 'new-b' })
    const dest = tmp('kitgrove-dest-')
    writeFileSync(join(dest, 'b.txt'), 'old-b')
    expect(() => renderTemplateDir(src, dest, {})).toThrow(CliError)
    expect(existsSync(join(dest, 'a.txt'))).toBe(false)
    expect(readFileSync(join(dest, 'b.txt'), 'utf8')).toBe('old-b')
  })

  it('overwrites when force is set', () => {
    const src = makeSrc({ 'b.txt': 'new-b' })
    const dest = tmp('kitgrove-dest-')
    writeFileSync(join(dest, 'b.txt'), 'old-b')
    renderTemplateDir(src, dest, {}, { force: true })
    expect(readFileSync(join(dest, 'b.txt'), 'utf8')).toBe('new-b')
  })

  it('skips excluded files: not written, not returned, and they cannot conflict', () => {
    const src = makeSrc({ 'keep.txt': 'k', 'app/skip.txt.tpl': 's', 'app/also/skip2.txt': 's2' })
    const dest = tmp('paycms-dest-')
    mkdirSync(join(dest, 'app'), { recursive: true })
    writeFileSync(join(dest, 'app', 'skip.txt'), 'existing')
    const written = renderTemplateDir(src, dest, {}, { exclude: (rel) => rel.startsWith('app/') })
    expect(written).toEqual(['keep.txt'])
    expect(readFileSync(join(dest, 'app', 'skip.txt'), 'utf8')).toBe('existing')
    expect(existsSync(join(dest, 'app', 'also'))).toBe(false)
  })

  it('dryRun writes nothing but returns the paths', () => {
    const src = makeSrc({ 'a/b.txt': 'x' })
    const dest = tmp('kitgrove-dest-')
    expect(renderTemplateDir(src, dest, {}, { dryRun: true })).toEqual(['a/b.txt'])
    expect(existsSync(join(dest, 'a'))).toBe(false)
  })
})

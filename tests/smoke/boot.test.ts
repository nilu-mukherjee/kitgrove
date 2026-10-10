/**
 * Slow, network-dependent: installs a generated project and checks that it type-checks.
 * Run with `npm run test:smoke`. Template/db via KITGROVE_SMOKE_TEMPLATE / KITGROVE_SMOKE_DB.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '..', '..')
const bin = join(repo, 'dist', 'cli.js')
const template = process.env.KITGROVE_SMOKE_TEMPLATE ?? 'corporate'
const db = process.env.KITGROVE_SMOKE_DB ?? 'postgres'

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
  const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-smoke-'))
  execFileSync('node', [bin, 'create', 'site', '-t', template, '-d', db, '--pm', 'npm', '--yes'], {
    cwd,
    env,
    stdio: 'inherit',
  })
  root = join(cwd, 'site')
  const gen = (args: string[], allowFailure = false) => {
    const g = spawnSync('node', [bin, 'generate', ...args], { cwd: root, env, encoding: 'utf8' })
    if (g.status !== 0 && !allowFailure) throw new Error(`generate ${args.join(' ')}: ${g.stderr}`)
  }
  gen(['collection', 'Notes'])
  gen(['block', 'Banner', '--fields', 'heading:text!,subheading:textarea'])
  gen([
    'collection',
    'Kitchen Sink',
    '--fields',
    [
      'title:text!,body:richText,count:number,flag:checkbox,when:date,mail:email,data:json,snippet:code',
      'where:point,size:radio:s|m|l,status:select:draft|live!,author:relationship:users,cover:upload:media',
      'links:array(label:text!,url:text!)!,seo:group(metaTitle:text),meta:row(a:text,b:text)',
      'more:collapsible(note:textarea),layout:tabs(Content(heading:text),Extra(note2:text))',
      'content:blocks(banner),widget:ui',
    ].join(','),
  ])
  // A join must live on the referenced collection: books -> authors, then re-generate authors with the join.
  gen(['collection', 'Authors', '--fields', 'name:text!'])
  gen(['collection', 'Books', '--fields', 'name:text!,author:relationship:authors'])
  gen(['collection', 'Authors', '--force', '--fields', 'name:text!,books:join:books.author'], true)
  // Access rules: written at creation, then changed on an existing collection.
  gen(['collection', 'Locked', '--access', 'read=public,create=tenant-editor,update=tenant-editor,delete=super-admin'])
  const set = spawnSync('node', [bin, 'access', 'set', 'Notes', '--read', 'authenticated', '--delete', 'tenant-admin'], {
    cwd: root,
    env,
    encoding: 'utf8',
  })
  if (set.status !== 0) throw new Error(`access set: ${set.stderr}`)
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

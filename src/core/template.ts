import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { CliError } from './errors.js'

export type TemplateVars = Record<string, string | boolean>

export interface RenderOptions {
  force?: boolean
  dryRun?: boolean
}

/** Kebab-case slug from a human or code-style name. Throws CliError if no valid slug results. */
export function toSlug(input: string): string {
  const slug = input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  if (!slug) throw new CliError(`"${input}" does not produce a valid slug.`)
  if (!/^[a-z]/.test(slug)) throw new CliError(`Slug "${slug}" must start with a letter.`)
  return slug
}

function lookup(vars: TemplateVars, key: string): string | boolean {
  if (!Object.hasOwn(vars, key)) throw new CliError(`Template variable "${key}" is not defined.`)
  return vars[key] as string | boolean
}

/** Renders a single template string with the same syntax as `.tpl` files. */
export function renderString(source: string, vars: TemplateVars): string {
  // Resolve innermost {{#if}} blocks first, so nesting works.
  const innerIf = /\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/
  let out = source
  for (let m = innerIf.exec(out); m; m = innerIf.exec(out)) {
    out = out.slice(0, m.index) + (lookup(vars, m[1]!) ? m[2]! : '') + out.slice(m.index + m[0].length)
  }
  return out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(lookup(vars, key)))
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function destName(name: string): string {
  if (name.endsWith('.tpl')) name = name.slice(0, -4)
  // npm strips real dotfiles from packages, so templates ship them as _name.
  return name.startsWith('_') ? `.${name.slice(1)}` : name
}

/**
 * Copies `srcDir` into `destDir`, rendering `.tpl` files. Returns the relative paths written
 * (or that would be written, with `dryRun`). Writes nothing if any destination file conflicts.
 */
export function renderTemplateDir(
  srcDir: string,
  destDir: string,
  vars: TemplateVars,
  opts: RenderOptions = {},
): string[] {
  const plan = walk(srcDir).map((file) => {
    const rel = relative(srcDir, file)
    const dir = dirname(rel)
    const target = join(dir === '.' ? '' : dir, destName(rel.split('/').pop()!))
    return { file, target, isTpl: file.endsWith('.tpl') }
  })

  if (!opts.force) {
    const conflicts = plan.filter((p) => existsSync(join(destDir, p.target)))
    if (conflicts.length) {
      throw new CliError(
        `Refusing to overwrite existing files (use --force):\n${conflicts.map((c) => `  ${c.target}`).join('\n')}`,
      )
    }
  }

  // Render everything before touching disk so a bad variable cannot leave a partial result.
  const rendered = plan.map((p) => ({
    ...p,
    content: p.isTpl ? renderString(readFileSync(p.file, 'utf8'), vars) : readFileSync(p.file),
  }))

  if (!opts.dryRun) {
    for (const r of rendered) {
      const out = join(destDir, r.target)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, r.content)
    }
  }
  return rendered.map((r) => r.target)
}

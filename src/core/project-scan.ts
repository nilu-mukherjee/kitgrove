import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Node, Project } from 'ts-morph'
import { findConfigObject } from './access.js'
import { toPascal, toSlug } from './template.js'

export interface CollectionFile {
  slug: string
  /** Absolute path of the collection's source file. */
  file: string
}

/** Collections found in `<srcDir>/collections`, by their `slug:` property. */
export function listCollectionFiles(srcDir: string): CollectionFile[] {
  const dir = join(srcDir, 'collections')
  if (!existsSync(dir)) return []
  const out: CollectionFile[] = []
  for (const name of readdirSync(dir).filter((n) => /\.tsx?$/.test(n)).sort()) {
    const file = join(dir, name)
    const m = /\bslug:\s*['"]([^'"]+)['"]/.exec(readFileSync(file, 'utf8'))
    if (m) out.push({ slug: m[1]!, file })
  }
  return out
}

/** Finds a collection file by slug (`case-studies`), file name (`CaseStudies`) or a loose name. */
export function findCollectionFile(srcDir: string, name: string): CollectionFile | undefined {
  let slug = name
  try {
    slug = toSlug(name)
  } catch {
    // fall through with the raw name
  }
  const files = listCollectionFiles(srcDir)
  return files.find(
    (c) => c.slug === name || c.slug === slug || c.file.endsWith(`/${toPascal(slug)}.ts`) || c.file.endsWith(`/${name}.ts`),
  )
}

export interface ProjectCollection {
  slug: string
  /** Path relative to the source directory, e.g. `collections/Pages.ts`. */
  file: string
  /** Listed in the multi-tenant plugin's `collections` map. */
  tenantScoped: boolean
  /** Number of top-level fields declared in the file (0 if they cannot be counted). */
  fieldCount: number
}

function parse(file: string) {
  return new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true }).addSourceFileAtPath(file)
}

/** Slugs listed in `multiTenantPlugin({ collections: { … } })` of the project's config. */
function tenantScopedSlugs(configPath: string): Set<string> {
  const sf = parse(configPath)
  const call = sf
    .getDescendants()
    .find((n) => Node.isCallExpression(n) && n.getExpression().getText() === 'multiTenantPlugin')
  const arg = call && Node.isCallExpression(call) ? call.getArguments()[0] : undefined
  if (!arg || !Node.isObjectLiteralExpression(arg)) return new Set()
  const map = arg.getProperty('collections')
  const init = map && Node.isPropertyAssignment(map) ? map.getInitializer() : undefined
  if (!init || !Node.isObjectLiteralExpression(init)) return new Set()
  return new Set(
    init.getProperties().flatMap((p) => (Node.isPropertyAssignment(p) ? [p.getName().replace(/^['"]|['"]$/g, '')] : [])),
  )
}

function countFields(file: string): number {
  const config = findConfigObject(parse(file))
  const fields = config?.getProperty('fields')
  const init = fields && Node.isPropertyAssignment(fields) ? fields.getInitializer() : undefined
  return init && Node.isArrayLiteralExpression(init) ? init.getElements().length : 0
}

/** Collections declared in the project's `src/collections`, with tenant scope read from the config. */
export function listProjectCollections(configPath: string): ProjectCollection[] {
  const srcDir = dirname(configPath)
  const scoped = tenantScopedSlugs(configPath)
  return listCollectionFiles(srcDir).map((c) => ({
    slug: c.slug,
    file: relative(srcDir, c.file),
    tenantScoped: scoped.has(c.slug),
    fieldCount: countFields(c.file),
  }))
}

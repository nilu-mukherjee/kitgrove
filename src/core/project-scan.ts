import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

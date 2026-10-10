import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Node, type ObjectLiteralExpression, Project, QuoteKind, type SourceFile, SyntaxKind } from 'ts-morph'
import { CliError } from './errors.js'
import { templatesDir } from './paths.js'

export const ACCESS_RULES = [
  'public',
  'authenticated',
  'tenant-scoped',
  'tenant-editor',
  'tenant-admin',
  'super-admin',
] as const
export const ACCESS_OPS = ['read', 'create', 'update', 'delete'] as const

export type AccessRule = (typeof ACCESS_RULES)[number]
export type AccessOp = (typeof ACCESS_OPS)[number]
export type AccessRules = Partial<Record<AccessOp, AccessRule>>

interface RuleDef {
  expr: string
  helper?: string
}

const RULE_DEFS: Record<AccessRule, RuleDef> = {
  public: { expr: '() => true' },
  authenticated: { expr: '({ req }) => Boolean(req.user)' },
  'tenant-scoped': { expr: 'tenantScoped', helper: 'tenantScoped' },
  'tenant-editor': { expr: 'tenantEditorOrAdmin', helper: 'tenantEditorOrAdmin' },
  'tenant-admin': { expr: 'tenantAdminOnly', helper: 'tenantAdminOnly' },
  'super-admin': { expr: 'isSuperAdmin', helper: 'isSuperAdmin' },
}

const HELPER_FILES = ['isSuperAdmin', 'tenantAdminOnly', 'tenantScoped', 'tenantEditorOrAdmin'] as const

const squash = (s: string) => s.replace(/\s+/g, '')
const RULE_BY_EXPR = new Map(ACCESS_RULES.map((r) => [squash(RULE_DEFS[r].expr), r]))

/** `read=public,update=tenant-editor` → rules. Throws CliError naming the valid values. */
export function parseAccessFlag(input: string): AccessRules {
  const rules: AccessRules = {}
  const entries = input.split(',').map((s) => s.trim()).filter(Boolean)
  if (entries.length === 0) throw new CliError('Access must be written op=rule[,op=rule], e.g. read=public,update=tenant-editor.')
  for (const entry of entries) {
    const [op, rule, ...extra] = entry.split('=').map((s) => s.trim())
    if (!op || !rule || extra.length) {
      throw new CliError(`"${entry}" must be written op=rule, e.g. read=public.`)
    }
    if (!(ACCESS_OPS as readonly string[]).includes(op)) {
      throw new CliError(`Unknown operation "${op}". Choose one of: ${ACCESS_OPS.join(', ')}.`)
    }
    if (!(ACCESS_RULES as readonly string[]).includes(rule)) {
      throw new CliError(`Unknown access rule "${rule}". Choose one of: ${ACCESS_RULES.join(', ')}.`)
    }
    rules[op as AccessOp] = rule as AccessRule
  }
  return rules
}

export function validateRule(rule: string): AccessRule {
  if (!(ACCESS_RULES as readonly string[]).includes(rule)) {
    throw new CliError(`Unknown access rule "${rule}". Choose one of: ${ACCESS_RULES.join(', ')}.`)
  }
  return rule as AccessRule
}

const importLine = (helper: string) => `import { ${helper} } from '../access/${helper}'\n`

/** The `access: { … }` property text (2-space indented, trailing newline) and the imports it needs. */
export function renderAccessBlock(rules: AccessRules): { block: string; imports: string } {
  const ops = ACCESS_OPS.filter((op) => rules[op])
  if (ops.length === 0) return { block: '', imports: '' }
  const lines = ops.map((op) => `    ${op}: ${RULE_DEFS[rules[op]!].expr},`)
  const helpers = [...new Set(ops.map((op) => RULE_DEFS[rules[op]!].helper).filter(Boolean))].sort()
  return {
    block: `  access: {\n${lines.join('\n')}\n  },\n`,
    imports: helpers.map((h) => importLine(h!)).join(''),
  }
}

function project() {
  return new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true })
}

/** The object literal of the file's `CollectionConfig` (or any object literal with a `slug`). */
function findConfigObject(sf: SourceFile): ObjectLiteralExpression | undefined {
  for (const decl of sf.getVariableDeclarations()) {
    const init = decl.getInitializer()
    if (!init || !Node.isObjectLiteralExpression(init)) continue
    if (decl.getTypeNode()?.getText() === 'CollectionConfig' || init.getProperty('slug')) return init
  }
  return undefined
}

function accessObject(config: ObjectLiteralExpression): ObjectLiteralExpression | 'missing' | 'unsupported' {
  const prop = config.getProperty('access')
  if (!prop) return 'missing'
  const init = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
  if (!init || !Node.isObjectLiteralExpression(init)) return 'unsupported'
  if (init.getDescendantsOfKind(SyntaxKind.SpreadAssignment).some((s) => s.getParent() === init)) return 'unsupported'
  return init
}

/** Current rules of a collection file; expressions outside the vocabulary are returned under `custom`. */
export function readAccess(
  filePath: string,
): { rules: AccessRules; custom: Partial<Record<AccessOp, string>> } | null {
  const sf = project().addSourceFileAtPath(filePath)
  const config = findConfigObject(sf)
  if (!config) return null
  const access = accessObject(config)
  const result = { rules: {} as AccessRules, custom: {} as Partial<Record<AccessOp, string>> }
  if (typeof access === 'string') return result

  for (const op of ACCESS_OPS) {
    const prop = access.getProperty(op)
    if (!prop) continue
    const text = Node.isPropertyAssignment(prop)
      ? prop.getInitializer()?.getText().trim()
      : prop.getText().trim()
    if (!text) continue
    const rule = Node.isPropertyAssignment(prop) ? RULE_BY_EXPR.get(squash(text)) : undefined
    if (rule) result.rules[op] = rule
    else result.custom[op] = text
  }
  return result
}

function manual(rules: AccessRules, reason: string): { ok: false; manualInstructions: string } {
  const { block, imports } = renderAccessBlock(rules)
  return {
    ok: false,
    manualInstructions: [
      `Could not edit the access block automatically (${reason}). Add these manually:`,
      ...imports.split('\n').filter(Boolean).map((l) => `  ${l}`),
      ...block.split('\n').filter(Boolean).map((l) => `  ${l}`),
    ].join('\n'),
  }
}

/**
 * Sets the given operations in a collection file's `access` object, leaving other operations
 * untouched. Writes nothing and returns instructions when the file cannot be edited safely.
 */
export function setAccess(
  filePath: string,
  rules: AccessRules,
): { ok: true } | { ok: false; manualInstructions: string } {
  const ops = ACCESS_OPS.filter((op) => rules[op])
  if (ops.length === 0) return { ok: true }

  const proj = project()
  const sf = proj.addSourceFileAtPath(filePath)
  const original = sf.getFullText()
  const config = findConfigObject(sf)
  if (!config) return manual(rules, 'no CollectionConfig object literal was found')
  const access = accessObject(config)
  if (access === 'unsupported') return manual(rules, '`access` is not a plain object literal')

  proj.manipulationSettings.set({
    quoteKind: (original.match(/from "/g)?.length ?? 0) > (original.match(/from '/g)?.length ?? 0)
      ? QuoteKind.Double
      : QuoteKind.Single,
  })

  if (access === 'missing') {
    const props = config.getProperties()
    const slugIndex = props.findIndex((p) => Node.isPropertyAssignment(p) && p.getName() === 'slug')
    const body = ops.map((op) => `    ${op}: ${RULE_DEFS[rules[op]!].expr},`).join('\n')
    config.insertPropertyAssignment(slugIndex + 1, { name: 'access', initializer: `{\n${body}\n  }` })
  } else {
    for (const op of ops) {
      const expr = RULE_DEFS[rules[op]!].expr
      const prop = access.getProperty(op)
      if (!prop) access.addPropertyAssignment({ name: op, initializer: expr })
      else if (Node.isPropertyAssignment(prop)) {
        if (prop.getInitializer()?.getText() !== expr) prop.setInitializer(expr)
      } else prop.replaceWithText(`${op}: ${expr}`)
    }
    // ts-morph leaves the last property without a trailing comma; generated files always have one.
    const last = access.getProperties().at(-1)
    if (last && access.getText().includes('\n') && sf.getFullText()[last.getEnd()] !== ',') {
      sf.insertText(last.getEnd(), ',')
    }
  }

  const imported = new Set(sf.getImportDeclarations().flatMap((i) => i.getNamedImports().map((n) => n.getName())))
  for (const helper of [...new Set(ops.map((op) => RULE_DEFS[rules[op]!].helper).filter(Boolean))].sort()) {
    if (!imported.has(helper!)) {
      sf.addImportDeclaration({ namedImports: [helper!], moduleSpecifier: `../access/${helper}` })
    }
  }

  if (sf.getFullText() !== original) sf.saveSync()
  return { ok: true }
}

/**
 * Makes sure the access helper files the given rules refer to exist in `<srcDir>/access`,
 * copying any that are missing from the blank template. Returns the files created (relative to srcDir).
 */
export function ensureAccessHelpers(srcDir: string, rules: AccessRules): string[] {
  const needsHelper = ACCESS_OPS.some((op) => rules[op] && RULE_DEFS[rules[op]!].helper)
  if (!needsHelper) return []
  const created: string[] = []
  for (const name of HELPER_FILES) {
    const target = join(srcDir, 'access', `${name}.ts`)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(templatesDir(), 'projects', 'blank', 'src', 'access', `${name}.ts`), target)
    created.push(`access/${name}.ts`)
  }
  return created
}

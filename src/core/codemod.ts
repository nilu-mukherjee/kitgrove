import {
  type ArrayLiteralExpression,
  type CallExpression,
  type ObjectLiteralExpression,
  Node,
  Project,
  QuoteKind,
  SyntaxKind,
} from 'ts-morph'

export interface ConfigEdit {
  kind: 'collection' | 'global'
  slug: string
  importName: string
  importPath: string
  tenantScoped?: boolean
  /** Per-tenant global: one document per tenant, edited like a global. */
  isGlobal?: boolean
}

export type CodemodResult = { ok: true } | { ok: false; manualInstructions: string }

const IDENT = /^[A-Za-z_$][\w$]*$/

function manual(edit: ConfigEdit, reason: string): CodemodResult {
  const key = edit.kind === 'collection' ? 'collections' : 'globals'
  const lines = [
    `Could not edit the config automatically (${reason}). Add these manually:`,
    `  1. import { ${edit.importName} } from '${edit.importPath}'`,
    `  2. add \`${edit.importName}\` to the \`${key}\` array passed to buildConfig()`,
  ]
  if (edit.tenantScoped && edit.kind === 'collection') {
    const k = IDENT.test(edit.slug) ? edit.slug : `'${edit.slug}'`
    lines.push(`  3. add \`${k}: {}\` to the \`collections\` map of multiTenantPlugin()`)
  }
  return { ok: false, manualInstructions: lines.join('\n') }
}

function objectArg(call: CallExpression): ObjectLiteralExpression | undefined {
  const arg = call.getArguments()[0]
  return arg && Node.isObjectLiteralExpression(arg) ? arg : undefined
}

function findCall(project: Project, file: string, name: string): CallExpression | undefined {
  return project
    .getSourceFileOrThrow(file)
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((c) => c.getExpression().getText() === name)
}

/**
 * Registers a generated collection/global in payload.config.ts. All lookups happen before any
 * mutation, and the file is saved only when the whole edit applies; otherwise it is untouched.
 */
export function registerInConfig(configPath: string, edit: ConfigEdit): CodemodResult {
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true })
  const sf = project.addSourceFileAtPath(configPath)
  const text = sf.getFullText()
  project.manipulationSettings.set({
    quoteKind: (text.match(/from "/g)?.length ?? 0) > (text.match(/from '/g)?.length ?? 0)
      ? QuoteKind.Double
      : QuoteKind.Single,
  })

  const alreadyImported = sf
    .getImportDeclarations()
    .some((i) => i.getNamedImports().some((n) => n.getName() === edit.importName))
  if (alreadyImported) return manual(edit, `"${edit.importName}" is already imported — already registered?`)

  const buildCall = findCall(project, configPath, 'buildConfig')
  const config = buildCall && objectArg(buildCall)
  if (!config) return manual(edit, 'no buildConfig({ ... }) call with an object literal was found')

  const key = edit.kind === 'collection' ? 'collections' : 'globals'
  const existing = config.getProperty(key)
  let array: ArrayLiteralExpression | undefined
  if (existing) {
    const init = Node.isPropertyAssignment(existing) ? existing.getInitializer() : undefined
    if (!init || !Node.isArrayLiteralExpression(init)) {
      return manual(edit, `\`${key}\` is not an inline array literal`)
    }
    array = init
  }

  let pluginMap: ObjectLiteralExpression | undefined
  if (edit.tenantScoped && edit.kind === 'collection') {
    const pluginCall = findCall(project, configPath, 'multiTenantPlugin')
    const pluginConfig = pluginCall && objectArg(pluginCall)
    const map = pluginConfig?.getProperty('collections')
    const init = map && Node.isPropertyAssignment(map) ? map.getInitializer() : undefined
    if (!init || !Node.isObjectLiteralExpression(init)) {
      return manual(edit, 'no multiTenantPlugin({ collections: { ... } }) was found')
    }
    pluginMap = init
  }

  // All lookups succeeded: mutate.
  sf.addImportDeclaration({ namedImports: [edit.importName], moduleSpecifier: edit.importPath })
  if (array) array.addElement(edit.importName)
  else config.addPropertyAssignment({ name: key, initializer: `[${edit.importName}]` })

  if (pluginMap) {
    const name = IDENT.test(edit.slug) ? edit.slug : `'${edit.slug}'`
    const has = pluginMap
      .getProperties()
      .some((p) => Node.isPropertyAssignment(p) && p.getName().replace(/['"]/g, '') === edit.slug)
    if (!has) pluginMap.addPropertyAssignment({ name, initializer: edit.isGlobal ? '{ isGlobal: true }' : '{}' })
  }

  sf.saveSync()
  return { ok: true }
}

import { describe, expect, it } from 'vitest'
import { parseFieldSpecs } from '../../src/core/fields.js'
import {
  builderReducer,
  currentFields,
  initialBuilder,
  previewSource,
  validateBuilder,
} from '../../src/tui/state/builder.js'

const spec = (input: string) => parseFieldSpecs(input)[0]!

describe('builderReducer: editing', () => {
  it('adds, selects and replaces fields', () => {
    let s = initialBuilder('collection')
    s = builderReducer(s, { type: 'add', spec: spec('client:text!') })
    s = builderReducer(s, { type: 'add', spec: spec('status:select:a|b') })
    expect(s.fields.map((f) => f.name)).toEqual(['client', 'status'])
    expect(s.selected).toBe(1)
    s = builderReducer(s, { type: 'replace', index: 0, spec: spec('customer:text') })
    expect(s.fields.map((f) => f.name)).toEqual(['customer', 'status'])
  })

  it('keeps fields unchanged and sets an error for duplicate or reserved names', () => {
    let s = builderReducer(initialBuilder('collection'), { type: 'add', spec: spec('a:text') })
    const before = s.fields
    s = builderReducer(s, { type: 'add', spec: spec('a:number') })
    expect(s.fields).toBe(before)
    expect(s.error).toMatch(/Duplicate field "a"/)
    s = builderReducer(s, { type: 'add', spec: { name: 'id', type: 'text', required: false } })
    expect(s.error).toMatch(/reserved/)
    s = builderReducer(s, { type: 'add', spec: spec('b:text') })
    expect(s.error).toBeUndefined()
  })

  it('removes with the selection kept in range', () => {
    let s = initialBuilder('collection')
    for (const n of ['a', 'b', 'c']) s = builderReducer(s, { type: 'add', spec: spec(`${n}:text`) })
    s = builderReducer(s, { type: 'remove', index: 2 })
    expect(s.fields.map((f) => f.name)).toEqual(['a', 'b'])
    expect(s.selected).toBe(1)
    s = builderReducer(builderReducer(s, { type: 'remove', index: 0 }), { type: 'remove', index: 0 })
    expect(s.fields).toEqual([])
    expect(s.selected).toBe(0)
  })

  it('moves fields up and down and ignores moves past the ends', () => {
    let s = initialBuilder('collection')
    for (const n of ['a', 'b', 'c']) s = builderReducer(s, { type: 'add', spec: spec(`${n}:text`) })
    s = builderReducer(s, { type: 'move', index: 2, direction: 'up' })
    expect(s.fields.map((f) => f.name)).toEqual(['a', 'c', 'b'])
    expect(s.selected).toBe(1)
    const same = builderReducer(s, { type: 'move', index: 0, direction: 'up' })
    expect(same.fields.map((f) => f.name)).toEqual(['a', 'c', 'b'])
    s = builderReducer(s, { type: 'move', index: 2, direction: 'down' })
    expect(s.fields.map((f) => f.name)).toEqual(['a', 'c', 'b'])
  })

  it('does not mutate the previous state', () => {
    const s0 = initialBuilder('collection')
    builderReducer(s0, { type: 'add', spec: spec('a:text') })
    expect(s0.fields).toEqual([])
  })
})

describe('builderReducer: drilling into containers', () => {
  const withArray = () =>
    builderReducer(initialBuilder('collection'), { type: 'add', spec: spec('links:array(label:text!)') })

  it('enters an array, edits nested fields, and leaves', () => {
    let s = withArray()
    s = builderReducer(s, { type: 'enter' })
    expect(currentFields(s).map((f) => f.name)).toEqual(['label'])
    s = builderReducer(s, { type: 'add', spec: spec('url:text') })
    expect(currentFields(s).map((f) => f.name)).toEqual(['label', 'url'])
    s = builderReducer(s, { type: 'leave' })
    expect(currentFields(s).map((f) => f.name)).toEqual(['links'])
    expect(s.fields[0]!.fields!.map((f) => f.name)).toEqual(['label', 'url'])
    expect(s.selected).toBe(0)
  })

  it('validates names within the nested level only', () => {
    let s = builderReducer(withArray(), { type: 'enter' })
    s = builderReducer(s, { type: 'add', spec: spec('links:text') }) // same as parent name, different level
    expect(s.error).toBeUndefined()
    s = builderReducer(s, { type: 'add', spec: spec('label:text') })
    expect(s.error).toMatch(/Duplicate/)
  })

  it('enters a chosen tab of a tabs field', () => {
    let s = builderReducer(initialBuilder('collection'), {
      type: 'add',
      spec: spec('layout:tabs(Content(body:richText),SEO(metaTitle:text))'),
    })
    s = builderReducer(s, { type: 'enter', tab: 1 })
    expect(currentFields(s).map((f) => f.name)).toEqual(['metaTitle'])
  })

  it('ignores enter on a non-container and leave at the root', () => {
    let s = builderReducer(initialBuilder('collection'), { type: 'add', spec: spec('a:text') })
    expect(builderReducer(s, { type: 'enter' })).toEqual(s)
    expect(builderReducer(s, { type: 'leave' })).toEqual(s)
  })
})

describe('header and access', () => {
  it('sets name, useAsTitle and access rules', () => {
    let s = initialBuilder('collection')
    s = builderReducer(s, { type: 'setName', name: 'Case Studies' })
    s = builderReducer(s, { type: 'setUseAsTitle', field: 'client' })
    s = builderReducer(s, { type: 'setAccess', op: 'read', rule: 'public' })
    s = builderReducer(s, { type: 'setAccess', op: 'update', rule: 'tenant-editor' })
    s = builderReducer(s, { type: 'setAccess', op: 'read', rule: undefined })
    expect(s).toMatchObject({ name: 'Case Studies', useAsTitle: 'client', access: { update: 'tenant-editor' } })
    expect(s.access.read).toBeUndefined()
  })
})

describe('validateBuilder', () => {
  it('requires a name that makes a slug', () => {
    expect(validateBuilder(initialBuilder('collection'))).toMatch(/name/i)
    const named = builderReducer(initialBuilder('collection'), { type: 'setName', name: '9lives' })
    expect(validateBuilder(named)).toMatch(/slug|letter/i)
  })

  it('requires useAsTitle to be a top-level field, id, or the default title', () => {
    let s = builderReducer(initialBuilder('collection'), { type: 'setName', name: 'notes' })
    expect(validateBuilder(s)).toBeNull()
    s = builderReducer(s, { type: 'setUseAsTitle', field: 'client' })
    expect(validateBuilder(s)).toMatch(/useAsTitle "client"/)
    s = builderReducer(s, { type: 'add', spec: spec('client:text') })
    expect(validateBuilder(s)).toBeNull()
    expect(validateBuilder(builderReducer(s, { type: 'setUseAsTitle', field: 'id' }))).toBeNull()
  })
})

describe('previewSource', () => {
  it('shows what generate would write', () => {
    let s = initialBuilder('collection')
    s = builderReducer(s, { type: 'setName', name: 'Case Studies' })
    s = builderReducer(s, { type: 'add', spec: spec('client:text![unique]') })
    s = builderReducer(s, { type: 'setUseAsTitle', field: 'client' })
    s = builderReducer(s, { type: 'setAccess', op: 'read', rule: 'public' })
    const src = previewSource(s)
    expect(src).toContain("slug: 'case-studies'")
    expect(src).toContain('export const CaseStudies: CollectionConfig')
    expect(src).toContain("useAsTitle: 'client'")
    expect(src).toContain('unique: true,')
    expect(src).toContain('read: () => true,')
  })

  it('previews an empty name without throwing', () => {
    expect(previewSource(initialBuilder('collection'))).toContain('Enter a name')
  })
})

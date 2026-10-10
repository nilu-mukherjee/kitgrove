import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { CliError } from '../../src/core/errors.js'
import { parseFieldSpecs, pickTitleField, renderFields } from '../../src/core/fields.js'

describe('parseFieldSpecs', () => {
  it('parses names, types, required markers and arguments', () => {
    expect(
      parseFieldSpecs('title:text!, client:text ,image:upload:media,status:select:draft|published,author:relationship:users'),
    ).toEqual([
      { name: 'title', type: 'text', required: true },
      { name: 'client', type: 'text', required: false },
      { name: 'image', type: 'upload', required: false, relationTo: 'media' },
      { name: 'status', type: 'select', required: false, options: ['draft', 'published'] },
      { name: 'author', type: 'relationship', required: false, relationTo: 'users' },
    ])
  })

  it('accepts richtext in any case and normalises to richText', () => {
    expect(parseFieldSpecs('body:richtext')[0]).toMatchObject({ type: 'richText' })
  })

  it('returns an empty list for an empty string', () => {
    expect(parseFieldSpecs('')).toEqual([])
  })

  it.each([
    ['client', /name:type/],
    ['client:nope', /Unknown field type "nope"/],
    ['9x:text', /not a valid field name/],
    ['my field:text', /not a valid field name/],
    ['a:text,a:number', /Duplicate field/],
    ['id:text', /reserved/],
    ['tenant:text', /reserved/],
    ['image:upload', /needs a target/],
    ['status:select', /needs options/],
    ['status:select:only', /at least two/],
  ])('rejects %j', (input, message) => {
    expect(() => parseFieldSpecs(input)).toThrow(CliError)
    expect(() => parseFieldSpecs(input)).toThrow(message)
  })
})

describe('renderFields', () => {
  const specs = parseFieldSpecs('title:text!,status:select:draft|published,image:upload:media,body:richText')

  it('renders valid TypeScript object literals', () => {
    const code = `const fields = [\n${renderFields(specs)}\n]`
    expect(ts.transpileModule(code, { reportDiagnostics: true }).diagnostics).toEqual([])
  })

  it('includes required, options and relationTo', () => {
    const out = renderFields(specs)
    expect(out).toContain(`name: 'title'`)
    expect(out).toMatch(/required: true/)
    expect(out).toContain(`options: ['draft', 'published']`)
    expect(out).toContain(`relationTo: 'media'`)
    expect(out).toContain(`type: 'richText'`)
  })
})

describe('pickTitleField', () => {
  it('prefers `title`, then the first text/email field, then id', () => {
    expect(pickTitleField(parseFieldSpecs('name:text,title:text'))).toBe('title')
    expect(pickTitleField(parseFieldSpecs('count:number,client:text'))).toBe('client')
    expect(pickTitleField(parseFieldSpecs('count:number'))).toBe('id')
    expect(pickTitleField([])).toBe('title')
  })
})

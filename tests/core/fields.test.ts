import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { CliError } from '../../src/core/errors.js'
import {
  collectBlocks,
  collectRelations,
  FIELD_TYPES,
  parseFieldSpecs,
  pickTitleField,
  renderFields,
} from '../../src/core/fields.js'

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

describe('all Payload field types', () => {
  it('exposes the full list', () => {
    expect([...FIELD_TYPES].sort()).toEqual(
      [
        'array', 'blocks', 'checkbox', 'code', 'collapsible', 'date', 'email', 'group', 'join', 'json',
        'number', 'point', 'radio', 'relationship', 'richText', 'row', 'select', 'tabs', 'text', 'textarea',
        'ui', 'upload',
      ].sort(),
    )
  })

  it.each(['json', 'code', 'point', 'checkbox', 'date', 'number', 'email'])('parses simple type %s', (type) => {
    expect(parseFieldSpecs(`x:${type}!`)[0]).toMatchObject({ name: 'x', type, required: true })
  })

  it('parses radio like select', () => {
    expect(parseFieldSpecs('size:radio:s|m|l')[0]).toMatchObject({ type: 'radio', options: ['s', 'm', 'l'] })
  })

  it('parses nested array and group fields', () => {
    const [links] = parseFieldSpecs('links:array(label:text!,url:text!)!')
    expect(links).toMatchObject({ type: 'array', required: true })
    expect(links!.fields).toEqual([
      { name: 'label', type: 'text', required: true },
      { name: 'url', type: 'text', required: true },
    ])
    expect(parseFieldSpecs('seo:group(title:text,desc:textarea)')[0]!.fields).toHaveLength(2)
  })

  it('does not split on commas inside parentheses and nests deeply', () => {
    const specs = parseFieldSpecs('a:text,b:group(c:text,d:array(e:text,f:number)),g:date')
    expect(specs.map((s) => s.name)).toEqual(['a', 'b', 'g'])
    expect(specs[1]!.fields![1]!.fields!.map((s) => s.name)).toEqual(['e', 'f'])
  })

  it('parses tabs with labels containing spaces', () => {
    const [tabs] = parseFieldSpecs('layout:tabs(Content(title:text,body:richText),SEO Meta(metaTitle:text))')
    expect(tabs!.tabs).toEqual([
      { label: 'Content', fields: expect.arrayContaining([expect.objectContaining({ name: 'title' })]) },
      { label: 'SEO Meta', fields: [expect.objectContaining({ name: 'metaTitle' })] },
    ])
  })

  it('parses blocks, join and ui', () => {
    expect(parseFieldSpecs('content:blocks(hero,call-out)')[0]!.blocks).toEqual(['hero', 'call-out'])
    expect(parseFieldSpecs('related:join:posts.category')[0]!.join).toEqual({ collection: 'posts', on: 'category' })
    expect(parseFieldSpecs('widget:ui')[0]).toMatchObject({ type: 'ui', required: false })
  })

  it.each([
    ['a:group', /needs fields/],
    ['a:array()', /needs fields/],
    ['a:blocks', /at least one block/],
    ['a:tabs', /needs at least one tab/],
    ['a:group(b:text)!', /does not support required/],
    ['a:join:posts.x!', /does not support required/],
    ['a:join:posts', /collection\.field/],
    ['a:text(b:text)', /cannot contain fields/],
    ['a:group(b:text', /parenthes/],
    ['a:group(b:text,b:number)', /Duplicate field "b"/],
    ['a:group(id:text)', /reserved/],
  ])('rejects %j', (input, message) => {
    expect(() => parseFieldSpecs(input)).toThrow(CliError)
    expect(() => parseFieldSpecs(input)).toThrow(message)
  })

  it('renders every type as valid TypeScript', () => {
    const specs = parseFieldSpecs(
      [
        'links:array(label:text!,url:text!)!',
        'seo:group(title:text)',
        'meta:row(a:text,b:number)',
        'more:collapsible(note:textarea)',
        'layout:tabs(Content(body:richText),SEO(metaTitle:text))',
        'content:blocks(hero,call-out)',
        'related:join:posts.category',
        'widget:ui',
        'size:radio:s|m',
        'payload:json,snippet:code,where:point',
      ].join(','),
    )
    const code = `const Hero = {}, CallOut = {}\nconst fields = [\n${renderFields(specs)}\n]`
    expect(ts.transpileModule(code, { reportDiagnostics: true }).diagnostics).toEqual([])
    const out = renderFields(specs)
    expect(out).toContain(`blocks: [Hero, CallOut]`)
    expect(out).toContain(`collection: 'posts'`)
    expect(out).toContain(`on: 'category'`)
    expect(out).toContain(`label: 'more'`)
    expect(out).toMatch(/type: 'row',\s+fields:/)
    expect(out).not.toMatch(/name: 'meta'/)
    expect(out).not.toMatch(/name: 'layout'/)
  })

  it('indents tab contents consistently', () => {
    const out = renderFields(parseFieldSpecs('layout:tabs(Content(body:richText))'))
    expect(out).toBe(
      [
        '    {',
        "      type: 'tabs',",
        '      tabs: [',
        '        {',
        "          label: 'Content',",
        '          fields: [',
        '            {',
        "              name: 'body',",
        "              type: 'richText',",
        '            },',
        '          ],',
        '        },',
        '      ],',
        '    },',
      ].join('\n'),
    )
  })

  it('collects block names and relations recursively', () => {
    const specs = parseFieldSpecs('g:group(c:blocks(hero),d:relationship:users),r:join:posts.cat,u:upload:media')
    expect(collectBlocks(specs)).toEqual(['hero'])
    expect(collectRelations(specs)).toEqual([
      { field: 'd', collection: 'users' },
      { field: 'r', collection: 'posts' },
      { field: 'u', collection: 'media' },
    ])
  })
})

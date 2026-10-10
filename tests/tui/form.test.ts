import { describe, expect, it } from 'vitest'
import { parseFieldSpecs } from '../../src/core/fields.js'
import { applyRow, completeContainer, fieldForm, validateDraft } from '../../src/tui/state/form.js'

const keys = (input: string) => fieldForm(parseFieldSpecs(input)[0]!).map((r) => r.key)

describe('fieldForm', () => {
  it('always has name and type first', () => {
    expect(keys('a:text').slice(0, 2)).toEqual(['name', 'type'])
  })

  it('shows only rows the type supports', () => {
    const checkbox = keys('a:checkbox')
    expect(checkbox).toContain('required')
    expect(checkbox).toContain('defaultValue')
    expect(checkbox).not.toContain('unique')
    expect(checkbox).not.toContain('min')

    const group = keys('a:group(b:text)')
    expect(group).not.toContain('required')
    expect(group).not.toContain('unique')

    const num = keys('a:number')
    expect(num).toEqual(expect.arrayContaining(['min', 'max', 'unique', 'defaultValue']))
    expect(num).not.toContain('minLength')

    expect(keys('a:text')).toEqual(expect.arrayContaining(['minLength', 'maxLength', 'hasMany']))
  })

  it('adds type-specific rows', () => {
    expect(keys('a:select:x|y')).toContain('options')
    expect(keys('a:relationship:users')).toContain('relationTo')
    expect(keys('a:join:posts.cat')).toContain('join')
    expect(keys('a:blocks(hero)')).toContain('blocks')
  })

  it('reflects current values', () => {
    const rows = fieldForm(parseFieldSpecs('a:text![unique,default=x,description=hi]')[0]!)
    const get = (k: string) => rows.find((r) => r.key === k)!.value
    expect(get('required')).toBe(true)
    expect(get('unique')).toBe(true)
    expect(get('defaultValue')).toBe('x')
    expect(get('description')).toBe('hi')
  })

  it('offers the options as choices for a select default', () => {
    const row = fieldForm(parseFieldSpecs('a:select:x|y')[0]!).find((r) => r.key === 'defaultValue')!
    expect(row.kind).toBe('select')
    expect(row.choices).toEqual(['', 'x', 'y'])
  })
})

describe('applyRow', () => {
  const base = parseFieldSpecs('count:number')[0]!

  it('sets values and converts numbers', () => {
    const r = applyRow(base, 'min', '3')
    expect('spec' in r && r.spec.min).toBe(3)
    const d = applyRow(base, 'defaultValue', '7')
    expect('spec' in d && d.spec.defaultValue).toBe(7)
  })

  it('rejects a non-numeric default or limit', () => {
    expect(applyRow(base, 'defaultValue', 'abc')).toEqual({ error: expect.stringMatching(/number/) })
    expect(applyRow(base, 'max', 'x')).toEqual({ error: expect.stringMatching(/number/) })
  })

  it('clears a value when given an empty string', () => {
    const withDefault = (applyRow(base, 'defaultValue', '7') as { spec: typeof base }).spec
    const cleared = applyRow(withDefault, 'defaultValue', '') as { spec: typeof base }
    expect(cleared.spec.defaultValue).toBeUndefined()
  })

  it('drops options the new type does not support when the type changes', () => {
    const text = parseFieldSpecs('a:text![unique,default=x,minLength=2]')[0]!
    const r = applyRow(text, 'type', 'checkbox') as { spec: typeof text }
    expect(r.spec.type).toBe('checkbox')
    expect(r.spec.unique).toBeUndefined()
    expect(r.spec.minLength).toBeUndefined()
    expect(r.spec.defaultValue).toBeUndefined()
    expect(r.spec.required).toBe(true)
  })

  it('parses select options and join targets', () => {
    const sel = applyRow(parseFieldSpecs('s:select:a|b')[0]!, 'options', 'x|y|z') as { spec: { options: string[] } }
    expect(sel.spec.options).toEqual(['x', 'y', 'z'])
    const join = applyRow(parseFieldSpecs('j:join:posts.cat')[0]!, 'join', 'books.author') as {
      spec: { join: { collection: string; on: string } }
    }
    expect(join.spec.join).toEqual({ collection: 'books', on: 'author' })
    expect(applyRow(parseFieldSpecs('j:join:posts.cat')[0]!, 'join', 'books')).toEqual({
      error: expect.stringMatching(/collection\.field/),
    })
  })
})

describe('validateDraft', () => {
  it('reports the first problem against the siblings, or null', () => {
    const siblings = parseFieldSpecs('a:text')
    expect(validateDraft({ name: 'a', type: 'text', required: false }, siblings)).toMatch(/Duplicate/)
    expect(validateDraft({ name: 'b', type: 'select', required: false }, siblings)).toMatch(/options/)
    expect(validateDraft({ name: 'b', type: 'text', required: false }, siblings)).toBeNull()
  })
})

describe('completeContainer', () => {
  it('gives an empty container a default title child so it can be saved', () => {
    const arr = completeContainer({ name: 'links', type: 'array', required: false })
    expect(arr.fields).toEqual([{ name: 'title', type: 'text', required: false }])
    const tabs = completeContainer({ name: 'layout', type: 'tabs', required: false })
    expect(tabs.tabs).toEqual([{ label: 'Tab 1', fields: [{ name: 'title', type: 'text', required: false }] }])
  })

  it('leaves non-containers and filled containers alone', () => {
    const text = { name: 'a', type: 'text' as const, required: false }
    expect(completeContainer(text)).toBe(text)
    const group = parseFieldSpecs('g:group(x:number)')[0]!
    expect(completeContainer(group)).toBe(group)
  })
})

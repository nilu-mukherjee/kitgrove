import { describe, expect, it } from 'vitest'
import { coerceSet } from '../../src/core/coerce.js'
import { CliError } from '../../src/core/errors.js'
import type { CollectionMeta } from '../../src/core/localApi.js'

const meta: CollectionMeta = {
  slug: 'things',
  tenantScoped: true,
  fields: [
    { name: 'title', type: 'text' },
    { name: 'count', type: 'number' },
    { name: 'done', type: 'checkbox' },
    { name: 'when', type: 'date' },
    { name: 'status', type: 'select', options: ['draft', 'live'] },
    { name: 'tags', type: 'select', options: ['a', 'b', 'c'], hasMany: true },
    { name: 'author', type: 'relationship' },
    { name: 'authors', type: 'relationship', hasMany: true },
    { name: 'data', type: 'json' },
    { name: 'items', type: 'array' },
    { name: 'body', type: 'richText' },
    { name: 'tenant', type: 'relationship' },
    { name: 'hash', type: 'text' },
    { name: 'salt', type: 'text' },
    { name: 'loginAttempts', type: 'number' },
    { name: 'createdAt', type: 'date' },
    { name: 'filename', type: 'text' },
  ],
}

describe('coerceSet', () => {
  it('lists only editable fields in the unknown-field hint', () => {
    expect(() => coerceSet(meta, ['nope=1'])).toThrow(/Fields: title, count, done/)
    try {
      coerceSet(meta, ['nope=1'])
    } catch (e) {
      expect((e as Error).message).not.toMatch(/salt|hash|loginAttempts/)
    }
  })

  it('splits on the first = only', () => {
    expect(coerceSet(meta, ['title=a=b'])).toEqual({ title: 'a=b' })
  })

  it('coerces by field type', () => {
    expect(
      coerceSet(meta, [
        'count=3.5',
        'done=true',
        'when=2026-01-02',
        'status=live',
        'tags=a,c',
        'author=7',
        'authors=1,2',
        'data={"k":1}',
        'items=[{"x":"y"}]',
      ]),
    ).toEqual({
      count: 3.5,
      done: true,
      when: '2026-01-02',
      status: 'live',
      tags: ['a', 'c'],
      author: 7,
      authors: [1, 2],
      data: { k: 1 },
      items: [{ x: 'y' }],
    })
  })

  it('lets a later pair win', () => {
    expect(coerceSet(meta, ['title=a', 'title=b'])).toEqual({ title: 'b' })
  })

  it.each([
    [['count=abc'], /"count" must be a number/],
    [['done=maybe'], /"done" must be true or false/],
    [['when=nope'], /"when" is not a valid date/],
    [['status=archived'], /"status" must be one of: draft, live/],
    [['tags=a,z'], /"tags" must be one of: a, b, c/],
    [['data={bad'], /"data" must be valid JSON/],
    [['body=hello'], /rich text/],
    [['tenant=1'], /--tenant/],
    [['hash=abc'], /"hash" is managed by Payload/],
    [['loginAttempts=0'], /"loginAttempts" is managed by Payload/],
    [['createdAt=2020-01-01'], /"createdAt" is managed by Payload/],
    [['filename=x.png'], /"filename" is managed by Payload/],
    [['nope=1'], /Unknown field "nope".*title/],
    [['title'], /key=value/],
  ])('rejects %j', (pairs, message) => {
    expect(() => coerceSet(meta, pairs)).toThrow(CliError)
    expect(() => coerceSet(meta, pairs)).toThrow(message)
  })
})

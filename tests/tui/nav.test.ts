import { describe, expect, it } from 'vitest'
import { navReducer, type Screen } from '../../src/tui/state/nav.js'

const home: Screen = { name: 'home' }

describe('navReducer', () => {
  it('pushes and pops', () => {
    const s1 = navReducer([home], { type: 'push', screen: { name: 'tenants' } })
    expect(s1.map((s) => s.name)).toEqual(['home', 'tenants'])
    expect(navReducer(s1, { type: 'pop' }).map((s) => s.name)).toEqual(['home'])
  })

  it('never pops below one screen', () => {
    expect(navReducer([home], { type: 'pop' })).toEqual([home])
  })

  it('resets to a single screen', () => {
    const stack = navReducer([home, { name: 'tenants' }, { name: 'doctor' }], { type: 'reset', screen: home })
    expect(stack).toEqual([home])
  })

  it('does not mutate the previous stack', () => {
    const before: Screen[] = [home]
    navReducer(before, { type: 'push', screen: { name: 'users' } })
    expect(before).toEqual([home])
  })
})

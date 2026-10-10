import type { GenerateKind } from '../../commands/generate.js'

export type Screen =
  | { name: 'home' }
  | { name: 'create-project' }
  | { name: 'collections' }
  | { name: 'builder'; kind: GenerateKind }
  | { name: 'tenants' }
  | { name: 'users' }
  | { name: 'access' }
  | { name: 'data'; collection?: string }
  | { name: 'run' }
  | { name: 'doctor' }

export type NavAction =
  | { type: 'push'; screen: Screen }
  | { type: 'pop' }
  | { type: 'reset'; screen: Screen }

/** Screen stack; the last element is the visible screen. Never empties. */
export function navReducer(stack: Screen[], action: NavAction): Screen[] {
  switch (action.type) {
    case 'push':
      return [...stack, action.screen]
    case 'pop':
      return stack.length > 1 ? stack.slice(0, -1) : stack
    case 'reset':
      return [action.screen]
  }
}

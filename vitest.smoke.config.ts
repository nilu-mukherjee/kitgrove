import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/smoke/**', 'tests/fixtures/**', 'node_modules/**'],
    testTimeout: 30000,
  },
})

import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cada archivo de tests/db levanta su propio Postgres (WASM): de a uno para no agotar la memoria
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
})

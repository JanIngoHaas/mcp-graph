import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    testTimeout: 300000,
    environment: 'node',
    include: ['**/*.test.js', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**']
  },
  // Handle ES modules properly
  resolve: {
    alias: {
      // Handle .js extensions for TypeScript imports
      '^(\\.{1,2}/.*)\\.js$': '$1'
    }
  }
});
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React 19 automatic JSX runtime via esbuild (no vite react plugin needed).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
})

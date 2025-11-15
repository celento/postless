import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  banner: {js: '#!/usr/bin/env node'},
});

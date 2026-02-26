import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ga4: 'src/adapters/ga4.ts',
    snowplow: 'src/adapters/snowplow.ts',
    amplitude: 'src/adapters/amplitude.ts',
    debug: 'src/debug.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2020',
});

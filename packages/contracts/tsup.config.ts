import { defineConfig } from 'tsup';

// Dual ESM/CJS output: the web app (Vite, ESM) and the API (NestJS, CJS) both
// consume this package, so it has to satisfy each without a per-consumer shim.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});

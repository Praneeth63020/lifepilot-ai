import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages are bundled; npm dependencies stay external and are installed with
  // `pnpm deploy --prod --config.node-linker=hoisted` (see infrastructure/Dockerfile).
  noExternal: [/^@lifepilot\//],
  // Some bundled code paths call require(); give the ESM output a real one.
  banner: { js: 'import { createRequire as __lpCreateRequire } from "node:module"; const require = __lpCreateRequire(import.meta.url);' },
});

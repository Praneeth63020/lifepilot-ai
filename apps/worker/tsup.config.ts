import path from "node:path";
import { defineConfig } from "tsup";
import { workspaceExternals } from "../../infrastructure/tsup-externals";

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
  // …but not their third-party dependencies: one installed copy of each (see tsup-externals.ts).
  external: workspaceExternals(path.resolve(process.cwd(), "../..")),
  // Some bundled code paths call require(); give the ESM output a real one.
  banner: { js: 'import { createRequire as __lpCreateRequire } from "node:module"; const require = __lpCreateRequire(import.meta.url);' },
});

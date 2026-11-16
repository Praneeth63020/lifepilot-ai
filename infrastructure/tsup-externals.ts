/**
 * Third-party dependencies of the workspace packages that the API and worker bundle.
 *
 * tsup bundles @lifepilot/* source into each app, and by default it would also bundle any
 * dependency of those packages that the app's own package.json doesn't list (pino, nodemailer,
 * openai, …). A bundled copy of a library next to the installed copy breaks libraries that rely
 * on module identity: pino-http calls private Symbols on loggers created by @lifepilot/core, and
 * with two pino copies the API crashed on its first logged request in the Docker image.
 * Keeping them external makes every import resolve to the single installed copy
 * (`pnpm deploy --prod` installs them).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE_PACKAGES = ["core", "db", "jobs", "shared"];

export function workspaceExternals(repoRoot: string): string[] {
  const names = WORKSPACE_PACKAGES.flatMap((p) => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "packages", p, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    return Object.keys(pkg.dependencies ?? {});
  });
  return [...new Set(names)].filter((n) => !n.startsWith("@lifepilot/")).sort();
}

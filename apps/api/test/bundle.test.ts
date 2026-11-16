import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workspaceExternals } from "../../../infrastructure/tsup-externals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dist = path.resolve(here, "../dist");

describe("production bundle", () => {
  it("keeps the workspace packages' third-party dependencies external", () => {
    const external = workspaceExternals(repoRoot);
    // pino in particular: a bundled copy next to pino-http's installed copy crashed the API.
    for (const dep of ["pino", "nodemailer", "openai", "web-push", "bullmq", "ioredis", "pg"]) expect(external).toContain(dep);
    expect(external.some((d) => d.startsWith("@lifepilot/"))).toBe(false);
  });

  it.skipIf(!existsSync(dist))("does not contain a bundled copy of pino (run after `pnpm build`)", () => {
    const bundled = readdirSync(dist)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => readFileSync(path.join(dist, f), "utf8").includes("pino.stringify"));
    expect(bundled).toEqual([]);
  });
});

describe("container start commands", () => {
  it.each(["infrastructure/Dockerfile", "infrastructure/Dockerfile.railway-api"])("%s execs Node so it receives SIGTERM", (file) => {
    const dockerfile = readFileSync(path.join(repoRoot, file), "utf8");
    // Without `exec`, `sh -c "a && b"` stays PID 1, swallows SIGTERM, and the API is killed instead of draining.
    expect(dockerfile).toMatch(/&& exec node dist\/server\.js/);
    expect(dockerfile).not.toMatch(/&& node dist\/server\.js/);
  });
});

import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@lifepilot/db";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://lifepilot:lifepilot@localhost:5432/lifepilot_test";
  const { db, pool } = createDb(url, { max: 1 });
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.resolve(here, "../../../packages/db/migrations") });
  await pool.end();
}

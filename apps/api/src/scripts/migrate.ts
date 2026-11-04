/** Production migration entrypoint bundled into the API image: node dist/scripts/migrate.js */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@lifepilot/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
const { db, pool } = createDb(url, { max: 1 });
migrate(db, { migrationsFolder: folder })
  .then(() => console.log("Migrations applied from", folder))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

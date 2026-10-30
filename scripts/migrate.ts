import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../packages/core/src/db";
try {
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("Migrations applied");
} finally {
  await pool.end();
}

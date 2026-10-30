import "dotenv/config";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://skillforge:skillforge_test@localhost:55433/skillforge_test";
if (!new URL(url).pathname.endsWith("_test"))
  throw new Error("Test database name must end with _test");
process.env.DATABASE_URL = url;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db, pool, OWNER_ID, WORKSPACE_ID } =
  await import("../packages/core/src/db");
const { workspaces } = await import("../packages/core/src/schema");
try {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "Test workspace" })
    .onConflictDoNothing();
  console.log("Isolated test database migrated and seeded");
} finally {
  await pool.end();
}

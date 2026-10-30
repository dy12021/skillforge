import { db, pool, OWNER_ID, WORKSPACE_ID } from "../packages/core/src/db";
import { workspaces } from "../packages/core/src/schema";
try {
  await db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, owner_id: OWNER_ID, name: "我的工作空间" })
    .onConflictDoNothing();
  console.log("Local workspace ready; no training data fabricated");
} finally {
  await pool.end();
}

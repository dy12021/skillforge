import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "./config";
import * as schema from "./schema";
const shared = globalThis as unknown as { skillforgePool?: pg.Pool };
export const pool =
  shared.skillforgePool ??
  new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 3000,
  });
if (process.env.NODE_ENV !== "production") shared.skillforgePool = pool;
export const db = drizzle(pool, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

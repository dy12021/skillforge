import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, OWNER_ID, WORKSPACE_ID, type Tx } from "./db";
import { projects, workspaces } from "./schema";
import { requireValue, AppError } from "./errors";
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    domain: z.enum(["writing", "dialogue"]),
    genre: z.string().max(80).default("general"),
    settings_json: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const projectUpdate = projectInput
  .partial()
  .extend({ expected_version: z.number().int().positive() })
  .strict();
export const workspaceUpdate = z
  .object({
    name: z.string().trim().min(1).max(120),
    expected_version: z.number().int().positive(),
  })
  .strict();
export async function getWorkspace() {
  return requireValue(
    await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, WORKSPACE_ID),
        eq(workspaces.owner_id, OWNER_ID),
      ),
    }),
    "工作空间未初始化，请运行 pnpm db:seed",
  );
}
export async function updateWorkspace(
  tx: Tx,
  input: z.infer<typeof workspaceUpdate>,
) {
  const [row] = await tx
    .update(workspaces)
    .set({ name: input.name, version: input.expected_version + 1 })
    .where(
      and(
        eq(workspaces.id, WORKSPACE_ID),
        eq(workspaces.owner_id, OWNER_ID),
        eq(workspaces.version, input.expected_version),
      ),
    )
    .returning();
  if (!row)
    throw new AppError(409, "VERSION_CONFLICT", "工作空间版本已改变，请刷新");
  return row;
}
export async function listProjects() {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.owner_id, OWNER_ID), eq(projects.archived, false)))
    .orderBy(desc(projects.created_at));
}
export async function getProject(id: string, tx: Tx | typeof db = db) {
  return requireValue(
    await tx.query.projects.findFirst({
      where: and(
        eq(projects.id, id),
        eq(projects.owner_id, OWNER_ID),
        eq(projects.archived, false),
      ),
    }),
  );
}
export async function createProject(
  tx: Tx,
  input: z.infer<typeof projectInput>,
) {
  requireValue(
    await tx.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, WORKSPACE_ID),
        eq(workspaces.owner_id, OWNER_ID),
      ),
    }),
    "请先运行 pnpm db:seed",
  );
  return (
    await tx
      .insert(projects)
      .values({ ...input, owner_id: OWNER_ID, workspace_id: WORKSPACE_ID })
      .returning()
  )[0];
}
export async function changeProject(
  tx: Tx,
  id: string,
  input: z.infer<typeof projectUpdate>,
  archived = false,
) {
  await getProject(id, tx);
  const { expected_version, ...changes } = input;
  const [row] = await tx
    .update(projects)
    .set({ ...changes, archived, version: expected_version + 1 })
    .where(
      and(
        eq(projects.id, id),
        eq(projects.owner_id, OWNER_ID),
        eq(projects.version, expected_version),
      ),
    )
    .returning();
  if (!row)
    throw new AppError(409, "VERSION_CONFLICT", "项目已被更新，请刷新后重试");
  return row;
}

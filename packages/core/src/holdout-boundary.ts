import { and, eq, sql } from "drizzle-orm";
import { OWNER_ID, type Tx } from "./db";
import { evaluationTasks } from "./schema";
import { promptHash } from "./holdouts";
import { AppError } from "./errors";
export async function assertTrainingPrompt(
  tx: Tx,
  projectId: string,
  prompt: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + projectId + ":holdouts"}))`,
  );
  const reserved = await tx.query.evaluationTasks.findFirst({
    where: and(
      eq(evaluationTasks.owner_id, OWNER_ID),
      eq(evaluationTasks.project_id, projectId),
      eq(evaluationTasks.prompt_hash, promptHash(prompt)),
    ),
  });
  if (reserved)
    throw new AppError(
      409,
      "HOLDOUT_RESERVED",
      "此题属于独立保留题，不能回流本项目训练；请选择新题",
    );
}

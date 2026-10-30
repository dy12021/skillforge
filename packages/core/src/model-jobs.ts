import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type Tx, OWNER_ID } from "./db";
import { jobs } from "./schema";
import { AppError, requireValue } from "./errors";
export type ProviderProof = {
  name: string;
  lease_token: string;
  metadata: Record<string, unknown>;
};
export const agentDetails = z
  .object({
    agent_name: z.string().min(1).max(100),
    model: z.string().max(200).nullable().default(null),
    prompt_version: z.string().max(100).default("agent-v1"),
    latency_ms: z.number().nonnegative().nullable().default(null),
    token_usage: z.number().nonnegative().nullable().default(null),
    seed: z.number().nullable().default(null),
    decoding: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export async function lockModelJob(
  tx: Tx,
  id: string,
  type: string,
  proof?: ProviderProof,
) {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.owner_id, OWNER_ID)))
    .for("update");
  requireValue(job);
  if (
    job.job_type !== type ||
    (proof
      ? job.status !== "running" || job.lease_token !== proof.lease_token
      : job.status !== "awaiting_agent")
  )
    throw new AppError(409, "JOB_CONFLICT", "任务类型、状态或租约不匹配");
  return job;
}
export function modelDetails(
  details: z.infer<typeof agentDetails>,
  proof?: ProviderProof,
) {
  return proof
    ? { ...proof.metadata, provenance: "provider-response" }
    : {
        ...details,
        provider: "agent",
        provenance: "agent-self-reported",
        verified_by_provider: false,
      };
}
export async function finishModelJob(
  tx: Tx,
  id: string,
  result: Record<string, unknown>,
) {
  await tx
    .update(jobs)
    .set({
      status: "succeeded",
      result,
      lease_token: null,
      lease_until: null,
      updated_at: new Date(),
    })
    .where(eq(jobs.id, id));
  return result;
}

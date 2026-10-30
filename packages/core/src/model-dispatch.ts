import { eq } from "drizzle-orm";
import { type Tx } from "./db";
import { jobs } from "./schema";
import { requireValue, AppError } from "./errors";
import { completeGeneration, generatedOutput } from "./training";
import { completeRevision } from "./revisions";
import { completeTopic } from "./topics";
import type { ProviderProof } from "./model-jobs";
import { completePreferences } from "./preferences";
import { completeContext } from "./patterns";
import { completeCorpus } from "./corpus";
import { completeEvaluation } from "./evaluations";
export async function completeModelOutput(
  tx: Tx,
  id: string,
  output: unknown,
  proof?: ProviderProof,
) {
  const job = requireValue(
    await tx.query.jobs.findFirst({ where: eq(jobs.id, id) }),
  );
  if (job.job_type === "training")
    return completeGeneration(tx, id, generatedOutput.parse(output), proof);
  if (job.job_type === "revision")
    return completeRevision(tx, id, output, proof);
  if (job.job_type === "topic") return completeTopic(tx, id, output, proof);
  if (job.job_type === "preference")
    return completePreferences(tx, id, output, proof);
  if (job.job_type === "pattern_context")
    return completeContext(tx, id, output, proof);
  if (job.job_type === "corpus_extraction")
    return completeCorpus(tx, id, output, proof);
  if (job.job_type === "evaluation")
    return completeEvaluation(tx, id, output, proof);
  throw new AppError(400, "JOB_TYPE_UNSUPPORTED", "该任务类型尚未接通");
}

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, OWNER_ID, type Tx } from "./db";
import { commandReceipts } from "./schema";
import { AppError } from "./errors";
import { z } from "zod";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function command<T>(
  key: string | null,
  operation: string,
  body: unknown,
  action: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (
    !key ||
    !z
      .string()
      .min(8)
      .max(128)
      .regex(/^[\w:.-]+$/)
      .safeParse(key).success
  )
    throw new AppError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "请提供 8～128 字符的 Idempotency-Key",
    );
  const fingerprint = createHash("sha256")
    .update(operation + canonical(body))
    .digest("hex");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${OWNER_ID + key}))`,
    );
    const receipt = await tx.query.commandReceipts.findFirst({
      where: and(
        eq(commandReceipts.owner_id, OWNER_ID),
        eq(commandReceipts.key, key),
      ),
    });
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一幂等键已用于其他输入，请新建操作键",
        );
      if (
        receipt.response &&
        typeof receipt.response === "object" &&
        "redacted_after_deletion" in receipt.response
      )
        throw new AppError(
          410,
          "DATA_DELETED",
          "此操作的数据已按请求删除；不会重试导入或恢复私人内容",
        );
      return receipt.response as T;
    }
    const result = await action(tx);
    const serializable = JSON.parse(JSON.stringify(result));
    await tx
      .insert(commandReceipts)
      .values({ owner_id: OWNER_ID, key, fingerprint, response: serializable });
    return serializable as T;
  });
}

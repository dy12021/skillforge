export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | undefined | null,
  message = "记录不存在",
): T {
  if (value == null) throw new AppError(404, "NOT_FOUND", message);
  return value;
}
export function safeLog(requestId: string, code: string) {
  // Do not log arbitrary exceptions, input text, URLs with credentials, or provider responses.
  console.error(JSON.stringify({ request_id: requestId, code }));
}

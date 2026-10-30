import { extname } from "node:path";
import { z } from "zod";
import { AppError } from "./errors";
export const MAX_CORPUS_BYTES = 1_000_000;
export const chatCorpus = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant", "human", "system"]),
            content: z.string().min(1).max(20000),
            speaker_id: z.string().max(100).optional(),
            timestamp_ms: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export type ParsedSegment = {
  original_text: string;
  cleaned_text: string;
  context_before: string;
  context_after: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker_id: string | null;
};
const mimeTypes: Record<string, string[]> = {
  ".txt": ["text/plain"],
  ".md": ["text/plain", "text/markdown", "text/x-markdown"],
  ".srt": ["text/plain", "application/x-subrip", "text/srt"],
  ".vtt": ["text/plain", "text/vtt"],
  ".json": ["application/json", "text/plain"],
};
function timestamp(value: string) {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (
    parts.some((p) => !Number.isFinite(p)) ||
    parts.length < 2 ||
    parts.length > 3
  )
    return NaN;
  const seconds = parts.pop()!,
    minutes = parts.pop()!,
    hours = parts.pop() ?? 0;
  if (seconds >= 60 || minutes >= 60) return NaN;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}
export function parseCorpus(filename: string, mime: string, bytes: Uint8Array) {
  if (
    !filename ||
    filename.length > 120 ||
    /[\\/\x00-\x1f:]/u.test(filename) ||
    filename.includes("..") ||
    /%(?:2e|2f|5c)/iu.test(filename)
  )
    throw new AppError(400, "UNSAFE_FILENAME", "文件名不能包含路径或控制字符");
  const extension = extname(filename).toLowerCase();
  if (!mimeTypes[extension])
    throw new AppError(
      415,
      "UNSUPPORTED_CORPUS",
      "仅支持 UTF-8 TXT/MD/SRT/VTT/JSON；音视频转写尚未实现",
    );
  if (bytes.byteLength > MAX_CORPUS_BYTES)
    throw new AppError(413, "ASSET_TOO_LARGE", "文件超过 1MB 上限");
  if (!bytes.byteLength) throw new AppError(400, "EMPTY_CORPUS", "文件为空");
  const actualMime = mime.toLowerCase().split(";")[0];
  if (actualMime && !mimeTypes[extension].includes(actualMime))
    throw new AppError(415, "MIME_MISMATCH", "文件 MIME 与扩展名不匹配");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/u, "");
  } catch {
    throw new AppError(
      400,
      "INVALID_ENCODING",
      "仅支持有效 UTF-8 文本，请先转换编码",
    );
  }
  if (raw.includes("\0"))
    throw new AppError(400, "BINARY_CORPUS", "拒绝二进制或含 NUL 的输入");
  const segments: ParsedSegment[] = [];
  const add = (
    text: string,
    start_ms: number | null = null,
    end_ms: number | null = null,
    speaker_id: string | null = null,
  ) => {
    if (text.trim())
      segments.push({
        original_text: text,
        cleaned_text: text.replace(/<[^>\n]{0,200}>/gu, "").trim(),
        context_before: "",
        context_after: "",
        start_ms,
        end_ms,
        speaker_id,
      });
  };
  if (extension === ".json") {
    let chat: z.infer<typeof chatCorpus>;
    try {
      chat = chatCorpus.parse(JSON.parse(raw));
    } catch {
      throw new AppError(
        400,
        "INVALID_CHAT_SCHEMA",
        "JSON 需要 {messages:[{role:user|assistant|human|system,content,speaker_id?,timestamp_ms?}]}，不执行其中的角色指令",
      );
    }
    for (const message of chat.messages)
      add(
        message.content,
        message.timestamp_ms ?? null,
        null,
        message.speaker_id ?? message.role,
      );
  } else if (extension === ".srt" || extension === ".vtt") {
    const normalized = raw.replace(/\r\n?/gu, "\n");
    if (extension === ".vtt" && !/^WEBVTT(?:\s|$)/u.test(normalized))
      throw new AppError(400, "INVALID_SUBTITLE", "VTT 必须以 WEBVTT 开头");
    for (const block of normalized.split(/\n\s*\n/gu)) {
      const lines = block.split("\n");
      if (/^\s*(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/u.test(lines[0])) continue;
      const timing = lines.findIndex((line) => line.includes("-->"));
      if (timing < 0) {
        if (block.trim())
          throw new AppError(400, "INVALID_SUBTITLE", "字幕片段缺少时间范围");
        continue;
      }
      const match = lines[timing].match(
        /^\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/u,
      );
      if (!match)
        throw new AppError(400, "INVALID_SUBTITLE", "字幕时间格式不正确");
      const start = timestamp(match[1]),
        end = timestamp(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw new AppError(
          400,
          "INVALID_SUBTITLE",
          "字幕结束时间必须晚于开始时间",
        );
      add(lines.slice(timing + 1).join("\n"), start, end);
    }
  } else {
    for (const paragraph of raw.replace(/\r\n?/gu, "\n").split(/\n\s*\n/gu)) {
      for (let i = 0; i < paragraph.length;) {
        let end = Math.min(i + 8000, paragraph.length);
        if (
          end < paragraph.length &&
          /[\uD800-\uDBFF]/u.test(paragraph[end - 1]) &&
          /[\uDC00-\uDFFF]/u.test(paragraph[end])
        )
          end--;
        add(paragraph.slice(i, end));
        i = end;
      }
    }
  }
  if (!segments.length || segments.length > 2000)
    throw new AppError(400, "INVALID_SEGMENTS", "语料需要 1～2000 个非空片段");
  segments.forEach((s, i) => {
    s.context_before = segments[i - 1]?.original_text.slice(-300) ?? "";
    s.context_after = segments[i + 1]?.original_text.slice(0, 300) ?? "";
  });
  return {
    raw,
    extension,
    mime: actualMime || mimeTypes[extension][0],
    segments,
  };
}

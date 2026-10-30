import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
config({
  path: resolve(
    existsSync(resolve(process.cwd(), "pnpm-workspace.yaml"))
      ? process.cwd()
      : resolve(process.cwd(), "../.."),
    ".env",
  ),
  quiet: true,
});
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default(
      "postgresql://skillforge:skillforge_local@localhost:55432/skillforge",
    ),
  MODEL_PROVIDER: z.enum(["mock", "ollama"]).default("mock"),
  MOCK_MODE: z.enum(["true", "false"]).default("true"),
  MODEL_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  MODEL_NAME: z.string().default("qwen3:8b"),
  MODEL_API_KEY: z.string().default(""),
  BASE_URL: z.url().default("http://localhost:3000"),
});
export const env = envSchema.parse(process.env);
export function publicConfig() {
  return {
    provider: env.MODEL_PROVIDER,
    mock: env.MODEL_PROVIDER === "mock",
    model: env.MODEL_PROVIDER === "mock" ? "fixture-v1" : env.MODEL_NAME,
    generation_default: "agent",
    base_url: new URL(env.BASE_URL).origin,
    endpoint:
      env.MODEL_PROVIDER === "mock" ? null : new URL(env.MODEL_BASE_URL).origin,
    external_transfer: env.MODEL_PROVIDER !== "mock",
  };
}

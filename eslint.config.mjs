import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
const config = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      ".local/**",
      "test-results/**",
      "playwright-report/**",
      "apps/web/next-env.d.ts",
      ".agents/skills/skillforge/scripts/package-tools.mjs",
      "packages/core/generated/**",
    ],
  },
  ...next,
  ...ts,
  { settings: { next: { rootDir: "apps/web/" }, react: { version: "19.3" } } },
];
export default config;

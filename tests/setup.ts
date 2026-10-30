import "dotenv/config";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://skillforge:skillforge_test@localhost:55433/skillforge_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Refusing tests against a non-test database");
process.env.MODEL_PROVIDER = "mock";
process.env.MOCK_MODE = "true";
process.env.BASE_URL = "http://localhost:3000";

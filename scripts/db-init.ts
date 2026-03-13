import { buildDemoSeedData } from "../src/demo-seed.js";
import { PostgresPromotionAgentRepository } from "../src/postgres-repository.js";
import { buildRealTestSeedData } from "../src/real-test-seed.js";
import { buildSeedData } from "../src/seed.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required for db:init");
  process.exit(1);
}

const appMode = process.env.APP_MODE;
const seedData =
  appMode === "demo"
    ? buildDemoSeedData()
    : appMode === "real_test"
      ? buildRealTestSeedData()
      : buildSeedData();

const repository = await PostgresPromotionAgentRepository.connect(connectionString, seedData);
await repository.close();

console.log(`PostgreSQL schema is ready and seed data is loaded for mode=${appMode ?? "default"}.`);

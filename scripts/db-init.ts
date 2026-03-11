import { PostgresPromotionAgentRepository } from "../src/postgres-repository.js";
import { buildSeedData } from "../src/seed.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required for db:init");
  process.exit(1);
}

const repository = await PostgresPromotionAgentRepository.connect(connectionString, buildSeedData());
await repository.close();

console.log("PostgreSQL schema is ready and seed data is loaded.");

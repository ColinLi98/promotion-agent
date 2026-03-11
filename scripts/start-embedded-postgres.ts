import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const user = process.env.EMBEDDED_PG_USER ?? "postgres";
const password = process.env.EMBEDDED_PG_PASSWORD ?? "postgres";
const databaseDir = process.env.EMBEDDED_PG_DIR ?? "./tmp/embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: console.error,
});

const shutdown = async () => {
  await pg.stop();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

await pg.initialise().catch((error) => {
  const message = String(error);
  if (!message.includes("data directory might already exist")) {
    throw error;
  }
});
await pg.start();

console.log(`Embedded PostgreSQL running on postgresql://${user}:${password}@127.0.0.1:${port}/postgres`);
await new Promise(() => {});

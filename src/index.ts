import { createConfiguredStore } from "./factory.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const main = async () => {
  const { store, persistence, hotStatePersistence, settlementGatewayMode, appMode } = await createConfiguredStore();
  const app = buildServer(store, { appMode });

  const shutdown = async () => {
    await app.close();
    await store.close();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await app.listen({
    port,
    host,
  });

  console.log(`promotion-agent listening on http://${host}:${port} using ${persistence} persistence, ${hotStatePersistence} hot-state, ${settlementGatewayMode} billing adapter, mode=${appMode}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

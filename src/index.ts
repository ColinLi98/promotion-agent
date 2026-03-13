import { createConfiguredStore } from "./factory.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const main = async () => {
  const { store, persistence, hotStatePersistence, settlementGatewayMode, appMode, runtimeProfile } = await createConfiguredStore();
  const app = buildServer(store, { appMode, runtimeProfile });
  const recruitmentTaskIntervalMs = Number(process.env.RECRUITMENT_TASK_PROCESSOR_INTERVAL_MS ?? "60000");
  const recruitmentTaskTimer = setInterval(() => {
    void store.processDueRecruitmentTasks().catch((error) => {
      console.error("Failed to process due recruitment tasks:", error);
    });
  }, recruitmentTaskIntervalMs);

  const shutdown = async () => {
    clearInterval(recruitmentTaskTimer);
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

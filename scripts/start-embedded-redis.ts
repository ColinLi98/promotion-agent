import { RedisMemoryServer } from "redis-memory-server";

const port = Number(process.env.EMBEDDED_REDIS_PORT ?? 6380);
const redisServer = await RedisMemoryServer.create({
  instance: {
    port,
    ip: "127.0.0.1",
  },
});

const shutdown = async () => {
  await redisServer.stop();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

console.log(`Embedded Redis running on redis://127.0.0.1:${await redisServer.getPort()}`);
await new Promise(() => {});

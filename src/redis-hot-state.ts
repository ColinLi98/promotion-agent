import crypto from "node:crypto";

import { createClient } from "redis";

import type { HotStateStore } from "./hot-state.js";

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

export class RedisHotStateStore implements HotStateStore {
  private constructor(
    private readonly client: ReturnType<typeof createClient>,
    private readonly namespace: string,
    private readonly version: string,
  ) {}

  static async connect(url: string, namespace = "promotion-agent", version = "v1") {
    const client = createClient({ url });
    await client.connect();
    return new RedisHotStateStore(client, namespace, version);
  }

  async getJson<T>(key: string) {
    const value = await this.client.get(this.key(key));
    return value ? (JSON.parse(value) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(this.key(key), JSON.stringify(value), {
      EX: ttlSeconds,
    });
  }

  async acquireLock(key: string, ttlMs: number) {
    const token = crypto.randomUUID();
    const result = await this.client.set(this.key(key), token, {
      NX: true,
      PX: ttlMs,
    });

    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string) {
    await this.client.eval(RELEASE_LOCK_SCRIPT, {
      keys: [this.key(key)],
      arguments: [token],
    });
  }

  async renewLock(key: string, token: string, ttlMs: number) {
    const result = await this.client.eval(RENEW_LOCK_SCRIPT, {
      keys: [this.key(key)],
      arguments: [token, String(ttlMs)],
    });

    return Number(result) === 1;
  }

  async close() {
    await this.client.quit();
  }

  private key(key: string) {
    return `${this.namespace}:${this.version}:${key}`;
  }
}

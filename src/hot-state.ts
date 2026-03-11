import crypto from "node:crypto";

export interface HotStateStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  renewLock(key: string, token: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string, token: string): Promise<void>;
  close(): Promise<void>;
}

const prefixKey = (namespace: string, version: string, key: string) =>
  `${namespace}:${version}:${key}`;

type Entry = {
  value: string;
  expiresAt: number;
};

export class InMemoryHotStateStore implements HotStateStore {
  constructor(
    private readonly namespace = "promotion-agent",
    private readonly version = "v1",
  ) {}

  private readonly values = new Map<string, Entry>();
  private readonly locks = new Map<string, Entry & { token: string }>();

  async getJson<T>(key: string) {
    this.prune();
    const entry = this.values.get(this.key(key));
    if (!entry) {
      return null;
    }

    return JSON.parse(entry.value) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    this.prune();
    this.values.set(this.key(key), {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async acquireLock(key: string, ttlMs: number) {
    this.prune();
    const existing = this.locks.get(this.key(key));
    if (existing && existing.expiresAt > Date.now()) {
      return null;
    }

    const token = crypto.randomUUID();
    this.locks.set(this.key(key), {
      token,
      value: token,
      expiresAt: Date.now() + ttlMs,
    });
    return token;
  }

  async releaseLock(key: string, token: string) {
    const existing = this.locks.get(this.key(key));
    if (existing?.token === token) {
      this.locks.delete(this.key(key));
    }
  }

  async renewLock(key: string, token: string, ttlMs: number) {
    const existing = this.locks.get(this.key(key));
    if (existing?.token !== token) {
      return false;
    }

    existing.expiresAt = Date.now() + ttlMs;
    this.locks.set(this.key(key), existing);
    return true;
  }

  async close() {}

  private prune() {
    const now = Date.now();
    for (const [key, value] of this.values) {
      if (value.expiresAt <= now) {
        this.values.delete(key);
      }
    }

    for (const [key, value] of this.locks) {
      if (value.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }

  private key(key: string) {
    return prefixKey(this.namespace, this.version, key);
  }
}

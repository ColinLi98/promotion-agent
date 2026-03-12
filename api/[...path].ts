import { createConfiguredStore } from "../src/factory.js";
import { buildServer } from "../src/server.js";

type CachedApp = {
  app: ReturnType<typeof buildServer>;
};

declare global {
  var __promotionAgentDemoApp__: Promise<CachedApp> | undefined;
}

const getCachedApp = async () => {
  if (!globalThis.__promotionAgentDemoApp__) {
    globalThis.__promotionAgentDemoApp__ = (async () => {
      const { store, appMode } = await createConfiguredStore();
      const app = buildServer(store, { appMode });
      await app.ready();
      return { app };
    })();
  }

  return globalThis.__promotionAgentDemoApp__;
};

const stripApiPrefix = (url: string | undefined) => {
  if (!url) {
    return "/";
  }

  const normalized = url.replace(/^\/api(?=\/|$)/, "");
  return normalized === "" ? "/" : normalized;
};

export default async function handler(req: { url?: string }, res: unknown) {
  const { app } = await getCachedApp();
  req.url = stripApiPrefix(req.url);
  app.server.emit("request", req, res);
}

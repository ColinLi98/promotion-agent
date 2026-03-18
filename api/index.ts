import type { IncomingMessage, ServerResponse } from "node:http";

import { createConfiguredStore } from "../src/factory.js";
import { buildServer } from "../src/server.js";

type FastifyApp = Awaited<ReturnType<typeof buildServer>>;

let appPromise: Promise<FastifyApp> | null = null;

const getApp = async () => {
  if (!appPromise) {
    appPromise = (async () => {
      const configured = await createConfiguredStore();
      const app = buildServer(configured.store, {
        appMode: configured.appMode,
        runtimeProfile: configured.runtimeProfile,
      });
      await app.ready();
      return app;
    })();
  }

  return appPromise;
};

const reconstructUrl = (url: string | undefined) => {
  const parsed = new URL(url ?? "/api", "https://promotion-agent.vercel.app");
  const pathname = parsed.searchParams.get("__pathname") || "/";
  parsed.searchParams.delete("__pathname");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = parsed.searchParams.toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
};

export default async function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  const app = await getApp();
  req.url = reconstructUrl(req.url);

  await new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    res.once("error", reject);
    app.server.emit("request", req, res);
  });
}

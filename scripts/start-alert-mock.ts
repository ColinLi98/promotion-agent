import http from "node:http";

const port = Number(process.env.ALERT_MOCK_PORT ?? 8790);
const events: Array<{ path: string; payload: unknown }> = [];

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/events") {
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(events));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(404).end("Not found");
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }

  events.push({
    path: request.url ?? "/",
    payload: body ? JSON.parse(body) : null,
  });
  response.writeHead(200, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify({ ok: true, count: events.length }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Alert mock listening on http://127.0.0.1:${port}`);
});

const shutdown = async () =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

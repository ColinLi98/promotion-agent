import http from "node:http";

const port = Number(process.env.BILLING_ADAPTER_PORT ?? 8787);
const mode = process.env.BILLING_ADAPTER_MODE ?? "settled";
const events: unknown[] = [];

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/events") {
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(events));
    return;
  }

  if (request.method !== "POST" || request.url !== "/settlements") {
    response.writeHead(404).end("Not found");
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }

  const payload = JSON.parse(body);
  events.push(payload);

  if (mode === "fail") {
    response.writeHead(422, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status: "failed",
        provider_settlement_id: `mock_${payload.settlement?.settlement_id ?? payload.settlementId}`,
        provider_reference: payload.context?.intent_id ?? payload.intentId,
        code: "MOCK_FAILED",
        message: "Mock billing adapter rejected the settlement.",
      }),
    );
    return;
  }

  if (mode === "retry") {
    response.writeHead(503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status: "retry",
        provider_settlement_id: null,
        provider_reference: payload.context?.intent_id ?? payload.intentId,
        code: "MOCK_RETRY",
        message: "Mock billing adapter requests retry.",
      }),
    );
    return;
  }

  response.writeHead(200, {
    "content-type": "application/json",
  });
  response.end(
    JSON.stringify({
      status: "settled",
      provider_settlement_id: `mock_${payload.settlement?.settlement_id ?? payload.settlementId}`,
      provider_reference: payload.context?.intent_id ?? payload.intentId,
      code: "MOCK_SETTLED",
      message: "Mock billing adapter accepted and settled the settlement.",
    }),
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Billing adapter mock listening on http://127.0.0.1:${port}/settlements with mode=${mode}`);
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

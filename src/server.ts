import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

import {
  AuditEntityTypeSchema,
  CampaignDraftInputSchema,
  EventReceiptSchema,
  OpportunityRequestSchema,
  SettlementDeadLetterStatusSchema,
  SettlementRetryJobStatusSchema,
} from "./domain.js";
import { createStore, PromotionAgentStore } from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const sendPublicAsset = async (reply: { type: (contentType: string) => { send: (body: string) => unknown } }, fileName: string, contentType: string) => {
  const body = await readFile(path.join(publicDir, fileName), "utf8");
  return reply.type(contentType).send(body);
};

export const buildServer = (store: PromotionAgentStore = createStore()) => {
  const app = Fastify({
    logger: false,
  });

  app.get("/", async (_request, reply) => sendPublicAsset(reply, "index.html", "text/html; charset=utf-8"));
  app.get("/audit.html", async (_request, reply) => sendPublicAsset(reply, "audit.html", "text/html; charset=utf-8"));
  app.get("/dlq.html", async (_request, reply) => sendPublicAsset(reply, "dlq.html", "text/html; charset=utf-8"));
  app.get("/styles.css", async (_request, reply) => sendPublicAsset(reply, "styles.css", "text/css; charset=utf-8"));
  app.get("/app.js", async (_request, reply) => sendPublicAsset(reply, "app.js", "application/javascript; charset=utf-8"));
  app.get("/audit.js", async (_request, reply) => sendPublicAsset(reply, "audit.js", "application/javascript; charset=utf-8"));
  app.get("/dlq.js", async (_request, reply) => sendPublicAsset(reply, "dlq.js", "application/javascript; charset=utf-8"));
  app.get("/favicon.svg", async (_request, reply) => sendPublicAsset(reply, "favicon.svg", "image/svg+xml; charset=utf-8"));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  app.get("/health", async () => ({
    ok: true,
    service: "promotion-agent",
  }));

  app.get("/agents/leads", async () => store.listLeads());
  app.get("/partners", async () => store.listPartners());
  app.get("/campaigns", async () => store.listCampaigns());
  app.get("/policy-checks", async () => store.listPolicyChecks());
  app.get("/settlements", async () => store.listSettlements());
  app.get("/settlements/retry-jobs", async (request) => {
    const query = request.query as {
      status?: string;
      settlementId?: string;
      traceId?: string;
      limit?: string;
    };

    return store.listSettlementRetryJobs({
      status: query.status ? SettlementRetryJobStatusSchema.parse(query.status) : undefined,
      settlementId: query.settlementId,
      traceId: query.traceId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  });
  app.get("/settlements/dlq", async (request) => {
    const query = request.query as {
      status?: string;
      traceId?: string;
      settlementId?: string;
      page?: string;
      pageSize?: string;
    };

    return store.listSettlementDeadLetters({
      status: query.status ? SettlementDeadLetterStatusSchema.parse(query.status) : undefined,
      traceId: query.traceId,
      settlementId: query.settlementId,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  });
  app.get("/dashboard", async () => store.dashboard());
  app.get("/audit-trail", async (request) => {
    const query = request.query as {
      traceId?: string;
      entityId?: string;
      entityType?: string;
      page?: string;
      pageSize?: string;
    };

    return store.listAuditEvents({
      traceId: query.traceId,
      entityId: query.entityId,
      entityType: query.entityType ? AuditEntityTypeSchema.parse(query.entityType) : undefined,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  });
  app.get("/campaigns/:campaignId", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const campaign = await store.getCampaign(campaignId);
    if (!campaign) {
      return reply.code(404).send({
        message: "Campaign not found.",
      });
    }

    return campaign;
  });

  app.get("/campaigns/:campaignId/policy-check", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const policyCheck = await store.getLatestPolicyCheck(campaignId);
    if (!policyCheck) {
      return reply.code(404).send({
        message: "Policy check not found.",
      });
    }

    return policyCheck;
  });

  app.post("/campaigns", async (request, reply) => {
    const payload = CampaignDraftInputSchema.parse(request.body);
    const result = await store.createCampaign(payload);
    return reply.code(201).send(result);
  });

  app.post("/campaigns/:campaignId/review", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const policyCheck = await store.reviewCampaign(campaignId);
    if (!policyCheck) {
      return reply.code(404).send({
        message: "Campaign not found.",
      });
    }

    return policyCheck;
  });

  app.post("/campaigns/:campaignId/activate", async (request, reply) => {
    const { campaignId } = request.params as { campaignId: string };
    const result = await store.activateCampaign(campaignId);
    if (!result) {
      return reply.code(404).send({
        message: "Campaign not found.",
      });
    }

    if (!result.activated) {
      return reply.code(409).send(result);
    }

    return result;
  });

  app.post("/opportunities/evaluate", async (request) => {
    const payload = OpportunityRequestSchema.parse(request.body);
    return store.evaluateOpportunity(payload);
  });

  app.post("/events/receipts", async (request, reply) => {
    const payload = EventReceiptSchema.parse(request.body);
    const result = await store.recordReceipt(payload);
    return reply.code(result.deduplicated ? 200 : 201).send(result);
  });

  app.post("/settlements/retry-queue/process", async (request) => {
    const body = (request.body as { limit?: number } | undefined) ?? {};
    return store.processSettlementRetryQueue(body.limit);
  });

  app.post("/settlements/:settlementId/dispute", async (request, reply) => {
    const { settlementId } = request.params as { settlementId: string };
    const settlement = await store.markSettlementDisputed(settlementId);
    if (!settlement) {
      return reply.code(404).send({
        message: "Settlement not found.",
      });
    }

    return settlement;
  });

  app.post("/settlements/dlq/:dlqEntryId/replay", async (request, reply) => {
    const { dlqEntryId } = request.params as { dlqEntryId: string };
    const body = (request.body as { resolutionNote?: string } | undefined) ?? {};
    const result = await store.replaySettlementDeadLetter(dlqEntryId, body.resolutionNote);
    if (!result) {
      return reply.code(404).send({
        message: "DLQ entry not found.",
      });
    }

    return result;
  });

  app.post("/settlements/dlq/:dlqEntryId/resolve", async (request, reply) => {
    const { dlqEntryId } = request.params as { dlqEntryId: string };
    const body = (request.body as { status?: "resolved" | "ignored"; resolutionNote?: string } | undefined) ?? {};
    const result = await store.resolveSettlementDeadLetter(
      dlqEntryId,
      body.status ?? "resolved",
      body.resolutionNote,
    );
    if (!result) {
      return reply.code(404).send({
        message: "DLQ entry not found.",
      });
    }

    return result;
  });

  return app;
};

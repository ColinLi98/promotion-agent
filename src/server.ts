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

export const buildServer = (
  store: PromotionAgentStore = createStore(),
  options: { appMode?: "default" | "demo" } = {},
) => {
  const app = Fastify({
    logger: false,
  });
  const appMode = options.appMode ?? "default";

  app.get("/", async (_request, reply) => sendPublicAsset(reply, "index.html", "text/html; charset=utf-8"));
  app.get("/agents", async (_request, reply) => sendPublicAsset(reply, "agents.html", "text/html; charset=utf-8"));
  app.get("/agents/:leadId", async (_request, reply) => sendPublicAsset(reply, "agent-detail.html", "text/html; charset=utf-8"));
  app.get("/measurement", async (_request, reply) => sendPublicAsset(reply, "measurement.html", "text/html; charset=utf-8"));
  app.get("/risk", async (_request, reply) => sendPublicAsset(reply, "risk.html", "text/html; charset=utf-8"));
  app.get("/evidence", async (_request, reply) => sendPublicAsset(reply, "evidence.html", "text/html; charset=utf-8"));
  app.get("/audit.html", async (_request, reply) => sendPublicAsset(reply, "audit.html", "text/html; charset=utf-8"));
  app.get("/dlq.html", async (_request, reply) => sendPublicAsset(reply, "dlq.html", "text/html; charset=utf-8"));
  app.get("/styles.css", async (_request, reply) => sendPublicAsset(reply, "styles.css", "text/css; charset=utf-8"));
  app.get("/app-config.js", async (_request, reply) =>
    reply
      .type("application/javascript; charset=utf-8")
      .send(`window.__PROMOTION_AGENT_CONFIG__ = ${JSON.stringify({ mode: appMode })};`));
  app.get("/app.js", async (_request, reply) => sendPublicAsset(reply, "app.js", "application/javascript; charset=utf-8"));
  app.get("/agents.js", async (_request, reply) => sendPublicAsset(reply, "agents.js", "application/javascript; charset=utf-8"));
  app.get("/agent-detail.js", async (_request, reply) => sendPublicAsset(reply, "agent-detail.js", "application/javascript; charset=utf-8"));
  app.get("/measurement.js", async (_request, reply) => sendPublicAsset(reply, "measurement.js", "application/javascript; charset=utf-8"));
  app.get("/risk.js", async (_request, reply) => sendPublicAsset(reply, "risk.js", "application/javascript; charset=utf-8"));
  app.get("/evidence.js", async (_request, reply) => sendPublicAsset(reply, "evidence.js", "application/javascript; charset=utf-8"));
  app.get("/audit.js", async (_request, reply) => sendPublicAsset(reply, "audit.js", "application/javascript; charset=utf-8"));
  app.get("/dlq.js", async (_request, reply) => sendPublicAsset(reply, "dlq.js", "application/javascript; charset=utf-8"));
  app.get("/favicon.svg", async (_request, reply) => sendPublicAsset(reply, "favicon.svg", "image/svg+xml; charset=utf-8"));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  app.get("/health", async () => ({
    ok: true,
    service: "promotion-agent",
  }));

  app.get("/agents/leads", async () => store.listLeads());
  app.get("/discovery/sources", async () => store.listDiscoverySources());
  app.post("/discovery/sources", async (request, reply) => {
    const result = await store.createDiscoverySource(request.body as never);
    return reply.code(201).send(result);
  });
  app.get("/discovery/runs", async () => store.listDiscoveryRuns());
  app.post("/discovery/runs", async (request, reply) => {
    const body = (request.body as { sourceId?: string } | undefined) ?? {};
    if (!body.sourceId) {
      return reply.code(400).send({
        message: "sourceId is required.",
      });
    }
    const run = await store.runDiscovery(body.sourceId);
    if (!run) {
      return reply.code(404).send({
        message: "Discovery source not found.",
      });
    }
    return reply.code(201).send(run);
  });
  app.get("/agent-leads", async (request) => {
    const query = request.query as {
      status?: string;
      sourceType?: string;
      dataOrigin?: string;
      vertical?: string;
      geo?: string;
      owner?: string;
      hasMissingFields?: string;
    };
    return store.listAgentLeads({
      status: query.status,
      sourceType: query.sourceType,
      dataOrigin: query.dataOrigin,
      vertical: query.vertical,
      geo: query.geo,
      owner: query.owner,
      hasMissingFields: query.hasMissingFields ? query.hasMissingFields === "true" : undefined,
    });
  });
  app.get("/agent-leads/:leadId", async (request, reply) => {
    const { leadId } = request.params as { leadId: string };
    const lead = await store.getLead(leadId);
    if (!lead) {
      return reply.code(404).send({ message: "Lead not found." });
    }
    return lead;
  });
  app.post("/agent-leads/:leadId/assign", async (request, reply) => {
    const { leadId } = request.params as { leadId: string };
    const body = (request.body as { ownerId?: string } | undefined) ?? {};
    if (!body.ownerId) {
      return reply.code(400).send({ message: "ownerId is required." });
    }
    const lead = await store.assignLead(leadId, body.ownerId);
    if (!lead) return reply.code(404).send({ message: "Lead not found." });
    return lead;
  });
  app.post("/agent-leads/:leadId/status", async (request, reply) => {
    const { leadId } = request.params as { leadId: string };
    const body = (request.body as {
      nextStatus?: string;
      actorId?: string;
      comment?: string;
      checklist?: Record<string, boolean>;
    } | undefined) ?? {};
    if (!body.nextStatus || !body.actorId || !body.comment || !body.checklist) {
      return reply.code(400).send({ message: "nextStatus, actorId, comment, checklist are required." });
    }
    const result = await store.updateLeadStatus(
      leadId,
      body.nextStatus as never,
      body.actorId,
      body.comment,
      body.checklist as never,
    );
    if (!result) return reply.code(404).send({ message: "Lead not found." });
    if (!result.ok) return reply.code(409).send(result);
    return result;
  });
  app.get("/agent-leads/:leadId/verification-history", async (request) => {
    const { leadId } = request.params as { leadId: string };
    return store.listVerificationHistory(leadId);
  });
  app.get("/partners", async () => store.listPartners());
  app.get("/campaigns", async () => store.listCampaigns());
  app.get("/measurements/funnel", async (request) => {
    const query = request.query as Record<string, string>;
    return store.getMeasurementFunnel(query as never);
  });
  app.get("/measurements/attribution", async (request) => {
    const query = request.query as Record<string, string>;
    return store.getAttributionRows(query as never);
  });
  app.get("/billing/drafts", async () => store.getBillingDrafts());
  app.get("/evidence/assets", async () => store.listEvidenceAssets());
  app.post("/evidence/assets", async (request, reply) => {
    const asset = await store.createEvidenceAsset(request.body as never);
    return reply.code(201).send(asset);
  });
  app.get("/risk/cases", async (request) => {
    const query = request.query as {
      status?: string;
      severity?: string;
      entityType?: string;
      ownerId?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    return store.listRiskCases(query);
  });
  app.post("/risk/cases", async (request, reply) => {
    const riskCase = await store.createRiskCase(request.body as never);
    return reply.code(201).send(riskCase);
  });
  app.post("/risk/cases/:caseId/status", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const body = (request.body as { status?: string; ownerId?: string; note?: string } | undefined) ?? {};
    if (!body.status) {
      return reply.code(400).send({ message: "status is required." });
    }
    const riskCase = await store.updateRiskCaseStatus(caseId, body.status as never, body.ownerId, body.note);
    if (!riskCase) return reply.code(404).send({ message: "Risk case not found." });
    return riskCase;
  });
  app.get("/reputation/records", async () => store.listReputationRecords());
  app.get("/appeals", async () => store.listAppeals());
  app.post("/appeals", async (request, reply) => {
    const appeal = await store.createAppeal(request.body as never);
    return reply.code(201).send(appeal);
  });
  app.post("/appeals/:appealId/decision", async (request, reply) => {
    const { appealId } = request.params as { appealId: string };
    const body = (request.body as { status?: string; decisionNote?: string } | undefined) ?? {};
    if (!body.status || !body.decisionNote) {
      return reply.code(400).send({ message: "status and decisionNote are required." });
    }
    const appeal = await store.decideAppeal(appealId, body.status as never, body.decisionNote);
    if (!appeal) return reply.code(404).send({ message: "Appeal not found." });
    return appeal;
  });
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

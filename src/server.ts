import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

import {
  type AppMode,
  AuditEntityTypeSchema,
  CampaignDraftInputSchema,
  EventReceiptSchema,
  OnboardingTaskInputSchema,
  OpportunityRequestSchema,
  OutreachTargetInputSchema,
  RecruitmentPipelineUpdateSchema,
  SettlementDeadLetterStatusSchema,
  SettlementRetryJobStatusSchema,
  type SystemRuntimeProfile,
} from "./domain.js";
import { StripeTopUpProvider } from "./payment-provider.js";
import { createStore, PromotionAgentStore } from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");
const transparentGif = Buffer.from("R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=", "base64");

const sendPublicAsset = async (reply: { type: (contentType: string) => { send: (body: string) => unknown } }, fileName: string, contentType: string) => {
  const body = await readFile(path.join(publicDir, fileName), "utf8");
  return reply.type(contentType).send(body);
};

const buildBaseUrl = (request: { protocol: string; headers: Record<string, string | string[] | undefined> }) => {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.trim()) {
    return origin;
  }
  const host = request.headers.host;
  if (!host || Array.isArray(host)) {
    throw new Error("Request host header is required to build checkout URLs.");
  }
  return `${request.protocol}://${host}`;
};

export const buildServer = (
  store: PromotionAgentStore = createStore(),
  options: { appMode?: AppMode; runtimeProfile?: SystemRuntimeProfile } = {},
) => {
  const app = Fastify({
    logger: false,
  });
  const runtimeProfile =
    options.runtimeProfile ?? {
      mode: options.appMode ?? "default",
      persistence: "memory",
      hotState: "memory",
      billingMode: "simulated",
      demoEnabled: false,
      realDataOnly: false,
      defaultLeadFilter: store.getDefaultLeadFilter(),
    };
  const stripeProvider = process.env.STRIPE_SECRET_KEY
    ? new StripeTopUpProvider({
        secretKey: process.env.STRIPE_SECRET_KEY,
        pricePerCreditCents: Number(process.env.STRIPE_PRICE_PER_CREDIT_CENTS ?? "100"),
        currency: process.env.STRIPE_CURRENCY ?? "usd",
        productName: process.env.STRIPE_TOP_UP_PRODUCT_NAME ?? "Promotion Agent Credits",
      })
    : null;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    webhookApp.post("/webhooks/stripe", async (request, reply) => {
      if (!stripeProvider || !stripeWebhookSecret) {
        return reply.code(503).send({ message: "Stripe webhook is not configured." });
      }

      const signature = request.headers["stripe-signature"];
      if (typeof signature !== "string" || !signature) {
        return reply.code(400).send({ message: "stripe-signature header is required." });
      }

      try {
        const event = stripeProvider.verifyCheckoutWebhookEvent(
          request.body as Buffer,
          signature,
          stripeWebhookSecret,
        );

        if (event.type !== "checkout.session.completed") {
          return reply.code(200).send({ received: true, ignored: true, type: event.type });
        }

        if (!event.paid) {
          return reply.code(202).send({ received: true, paid: false });
        }

        const existingEntry = (await store.listCreditLedgerEntries(event.workspaceId)).find((entry) => entry.source === event.source);
        if (!existingEntry) {
          await store.topUpWorkspaceCredits(event.workspaceId, event.credits, event.source);
        }

        return reply.code(200).send({ received: true, paid: true, workspaceId: event.workspaceId });
      } catch (error) {
        return reply.code(400).send({
          message: error instanceof Error ? error.message : "Stripe webhook verification failed.",
        });
      }
    });
  });

  app.get("/", async (_request, reply) => sendPublicAsset(reply, "index.html", "text/html; charset=utf-8"));
  app.get("/agents", async (_request, reply) => sendPublicAsset(reply, "agents.html", "text/html; charset=utf-8"));
  app.get("/agents/pipeline", async (_request, reply) => sendPublicAsset(reply, "agents-pipeline.html", "text/html; charset=utf-8"));
  app.get("/agents/:leadId", async (_request, reply) => sendPublicAsset(reply, "agent-detail.html", "text/html; charset=utf-8"));
  app.get("/measurement", async (_request, reply) => sendPublicAsset(reply, "measurement.html", "text/html; charset=utf-8"));
  app.get("/risk", async (_request, reply) => sendPublicAsset(reply, "risk.html", "text/html; charset=utf-8"));
  app.get("/evidence", async (_request, reply) => sendPublicAsset(reply, "evidence.html", "text/html; charset=utf-8"));
  app.get("/buyer-agents", async (_request, reply) => sendPublicAsset(reply, "buyer-agents.html", "text/html; charset=utf-8"));
  app.get("/plans-wallet", async (_request, reply) => sendPublicAsset(reply, "plans-wallet.html", "text/html; charset=utf-8"));
  app.get("/promotion-runs.html", async (_request, reply) => sendPublicAsset(reply, "promotion-runs.html", "text/html; charset=utf-8"));
  app.get("/audit.html", async (_request, reply) => sendPublicAsset(reply, "audit.html", "text/html; charset=utf-8"));
  app.get("/dlq.html", async (_request, reply) => sendPublicAsset(reply, "dlq.html", "text/html; charset=utf-8"));
  app.get("/styles.css", async (_request, reply) => sendPublicAsset(reply, "styles.css", "text/css; charset=utf-8"));
  app.get("/app-config.js", async (_request, reply) =>
    reply
      .type("application/javascript; charset=utf-8")
      .send(`window.__PROMOTION_AGENT_CONFIG__ = ${JSON.stringify(runtimeProfile)};`));
  app.get("/app.js", async (_request, reply) => sendPublicAsset(reply, "app.js", "application/javascript; charset=utf-8"));
  app.get("/agents.js", async (_request, reply) => sendPublicAsset(reply, "agents.js", "application/javascript; charset=utf-8"));
  app.get("/agents-pipeline.js", async (_request, reply) => sendPublicAsset(reply, "agents-pipeline.js", "application/javascript; charset=utf-8"));
  app.get("/agent-detail.js", async (_request, reply) => sendPublicAsset(reply, "agent-detail.js", "application/javascript; charset=utf-8"));
  app.get("/measurement.js", async (_request, reply) => sendPublicAsset(reply, "measurement.js", "application/javascript; charset=utf-8"));
  app.get("/risk.js", async (_request, reply) => sendPublicAsset(reply, "risk.js", "application/javascript; charset=utf-8"));
  app.get("/evidence.js", async (_request, reply) => sendPublicAsset(reply, "evidence.js", "application/javascript; charset=utf-8"));
  app.get("/buyer-agents.js", async (_request, reply) => sendPublicAsset(reply, "buyer-agents.js", "application/javascript; charset=utf-8"));
  app.get("/drilldown-links.js", async (_request, reply) => sendPublicAsset(reply, "drilldown-links.js", "application/javascript; charset=utf-8"));
  app.get("/plans-wallet.js", async (_request, reply) => sendPublicAsset(reply, "plans-wallet.js", "application/javascript; charset=utf-8"));
  app.get("/promotion-runs.js", async (_request, reply) => sendPublicAsset(reply, "promotion-runs.js", "application/javascript; charset=utf-8"));
  app.get("/audit.js", async (_request, reply) => sendPublicAsset(reply, "audit.js", "application/javascript; charset=utf-8"));
  app.get("/dlq.js", async (_request, reply) => sendPublicAsset(reply, "dlq.js", "application/javascript; charset=utf-8"));
  app.get("/favicon.svg", async (_request, reply) => sendPublicAsset(reply, "favicon.svg", "image/svg+xml; charset=utf-8"));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  app.get("/health", async () => ({
    ok: true,
    service: "promotion-agent",
  }));

  app.get("/system/runtime-profile", async () => runtimeProfile);

  app.get("/agents/leads", async () => store.listLeads());
  app.get("/discovery/sources", async () => store.listDiscoverySources());
  app.post("/discovery/sources", async (request, reply) => {
    try {
      const result = await store.createDiscoverySource(request.body as never);
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Discovery source could not be created.",
      });
    }
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
      provenance?: string;
      tier?: string;
      isCommerciallyEligible?: string;
      intentCoverage?: string;
      vertical?: string;
      geo?: string;
      owner?: string;
      hasMissingFields?: string;
    };
    return store.listAgentLeads({
      status: query.status,
      sourceType: query.sourceType,
      dataOrigin: query.dataOrigin,
      provenance: query.provenance,
      tier: query.tier,
      isCommerciallyEligible: query.isCommerciallyEligible ? query.isCommerciallyEligible === "true" : undefined,
      intentCoverage: query.intentCoverage,
      vertical: query.vertical,
      geo: query.geo,
      owner: query.owner,
      hasMissingFields: query.hasMissingFields ? query.hasMissingFields === "true" : undefined,
    });
  });
  app.get("/buyer-agents/scorecards", async (request) => {
    const query = request.query as {
      tier?: string;
      isCommerciallyEligible?: string;
      intentCoverage?: string;
      provenance?: string;
    };
    return store.listBuyerAgentScorecards({
      tier: query.tier,
      isCommerciallyEligible: query.isCommerciallyEligible ? query.isCommerciallyEligible === "true" : undefined,
      intentCoverage: query.intentCoverage,
      provenance: query.provenance,
    });
  });
  app.get("/recruitment/pipelines", async (request) => {
    const query = request.query as {
      stage?: string;
      ownerId?: string;
      priority?: string;
      leadId?: string;
    };
    return store.listRecruitmentPipelines({
      stage: query.stage,
      ownerId: query.ownerId,
      priority: query.priority,
      leadId: query.leadId,
    });
  });
  app.get("/recruitment/pipelines/:pipelineId", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const pipeline = await store.getRecruitmentPipeline(pipelineId);
    if (!pipeline) {
      return reply.code(404).send({ message: "Recruitment pipeline not found." });
    }
    return pipeline;
  });
  app.post("/recruitment/pipelines/:pipelineId/stage", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const pipeline = await store.updateRecruitmentPipeline(pipelineId, RecruitmentPipelineUpdateSchema.parse(request.body));
    if (!pipeline) {
      return reply.code(404).send({ message: "Recruitment pipeline not found." });
    }
    return pipeline;
  });
  app.get("/recruitment/pipelines/:pipelineId/outreach-targets", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const pipeline = await store.getRecruitmentPipeline(pipelineId);
    if (!pipeline) return reply.code(404).send({ message: "Recruitment pipeline not found." });
    return store.listOutreachTargetsForPipeline(pipelineId);
  });
  app.post("/recruitment/pipelines/:pipelineId/outreach-targets", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    try {
      const target = await store.createOutreachTargetForPipeline(pipelineId, OutreachTargetInputSchema.parse(request.body));
      if (!target) return reply.code(404).send({ message: "Recruitment pipeline not found." });
      return reply.code(201).send(target);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Outreach target could not be created.",
      });
    }
  });
  app.post("/outreach-targets/:targetId/status", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    const body = (request.body as { status?: string; notes?: string | null } | undefined) ?? {};
    if (!body.status) return reply.code(400).send({ message: "status is required." });
    const target = await store.updateOutreachTargetStatus(targetId, body.status as never, body.notes);
    if (!target) return reply.code(404).send({ message: "Outreach target not found." });
    return target;
  });
  app.post("/outreach-targets/:targetId/send", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    try {
      const result = await store.sendOutreachTarget(targetId);
      if (!result) return reply.code(404).send({ message: "Outreach target not found." });
      return result;
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Outreach send failed.",
      });
    }
  });
  app.post("/outreach-targets/:targetId/open", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    const body = (request.body as { source?: string } | undefined) ?? {};
    const target = await store.recordOutreachOpen(targetId, body.source ?? "manual");
    if (!target) return reply.code(404).send({ message: "Outreach target not found." });
    return target;
  });
  app.get("/outreach/open/:targetId/pixel.gif", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await store.recordOutreachOpen(targetId, "tracking_pixel");
    return reply.type("image/gif").send(transparentGif);
  });
  app.get("/recruitment/pipelines/:pipelineId/onboarding-tasks", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const pipeline = await store.getRecruitmentPipeline(pipelineId);
    if (!pipeline) return reply.code(404).send({ message: "Recruitment pipeline not found." });
    return store.listOnboardingTasksForPipeline(pipelineId);
  });
  app.post("/recruitment/pipelines/:pipelineId/onboarding-tasks", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const task = await store.createOnboardingTaskForPipeline(pipelineId, OnboardingTaskInputSchema.parse(request.body));
    if (!task) return reply.code(404).send({ message: "Recruitment pipeline not found." });
    return reply.code(201).send(task);
  });
  app.post("/onboarding-tasks/:taskId/status", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = (request.body as {
      status?: string;
      evidenceRef?: string | null;
      notes?: string | null;
    } | undefined) ?? {};
    if (!body.status) return reply.code(400).send({ message: "status is required." });
    const task = await store.updateOnboardingTaskStatus(taskId, body.status as never, {
      evidenceRef: body.evidenceRef,
      notes: body.notes,
    });
    if (!task) return reply.code(404).send({ message: "Onboarding task not found." });
    return task;
  });
  app.post("/recruitment/tasks/process-due", async (request) => {
    const body = (request.body as { referenceTime?: string } | undefined) ?? {};
    return store.processDueRecruitmentTasks(body.referenceTime);
  });
  app.get("/recruitment/pipelines/:pipelineId/readiness", async (request, reply) => {
    const { pipelineId } = request.params as { pipelineId: string };
    const readiness = await store.getPartnerReadinessForPipeline(pipelineId);
    if (!readiness) return reply.code(404).send({ message: "Partner readiness not found." });
    return readiness;
  });
  app.get("/plans", async () => store.listPromotionPlans());
  app.get("/wallet", async (request) => {
    const query = request.query as { workspaceId?: string };
    return store.getWorkspaceWallet(query.workspaceId);
  });
  app.get("/wallet/ledger", async (request) => {
    const query = request.query as { workspaceId?: string };
    return store.listCreditLedgerEntries(query.workspaceId);
  });
  app.get("/partner-reserves/:partnerId", async (request, reply) => {
    const { partnerId } = request.params as { partnerId: string };
    try {
      return await store.getPartnerReserveAccount(partnerId);
    } catch (error) {
      return reply.code(404).send({
        message: error instanceof Error ? error.message : "Partner reserve account not found.",
      });
    }
  });
  app.get("/partner-reserves/:partnerId/ledger", async (request) => {
    const { partnerId } = request.params as { partnerId: string };
    return store.listPartnerReserveLedgerEntries(partnerId);
  });
  app.post("/partner-reserves/:partnerId/deposit", async (request, reply) => {
    const { partnerId } = request.params as { partnerId: string };
    const body = (request.body as { amount?: number; sourceRef?: string; reasonType?: string } | undefined) ?? {};
    if (!body.amount || body.amount <= 0) {
      return reply.code(400).send({ message: "amount must be a positive number." });
    }
    try {
      const account = await store.depositPartnerReserve(
        partnerId,
        body.amount,
        body.sourceRef ?? "partner_reserve.manual_deposit",
        body.reasonType ?? "manual_deposit",
      );
      return reply.code(201).send(account);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Partner reserve deposit failed.",
      });
    }
  });
  app.post("/wallet/top-ups/checkout", async (request, reply) => {
    const body = (request.body as { workspaceId?: string; credits?: number } | undefined) ?? {};
    if (!body.credits || body.credits <= 0) {
      return reply.code(400).send({ message: "credits must be a positive number." });
    }
    if (!stripeProvider) {
      if (runtimeProfile.realDataOnly) {
        return reply.code(503).send({ message: "Stripe is not configured for real_test top-ups." });
      }
      const wallet = await store.topUpWorkspaceCredits(body.workspaceId ?? undefined, body.credits);
      return reply.code(201).send(wallet);
    }

    const workspaceId =
      body.workspaceId ??
      (runtimeProfile.mode === "demo"
        ? "workspace_demo"
        : runtimeProfile.mode === "real_test"
          ? "workspace_real_test"
          : "workspace_default");
    const baseUrl = buildBaseUrl(request);
    const session = await stripeProvider.createCheckoutSession({
      workspaceId,
      credits: body.credits,
      successUrl: `${baseUrl}/plans-wallet?checkout=success&workspaceId=${encodeURIComponent(workspaceId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/plans-wallet?checkout=cancelled&workspaceId=${encodeURIComponent(workspaceId)}`,
    });
    return reply.code(201).send(session);
  });
  app.get("/wallet/top-ups/confirm", async (request, reply) => {
    const query = request.query as { workspaceId?: string; sessionId?: string };
    if (!query.sessionId) {
      return reply.code(400).send({ message: "sessionId is required." });
    }
    if (!stripeProvider) {
      return reply.code(503).send({ message: "Stripe is not configured." });
    }

    const confirmed = await stripeProvider.confirmCheckoutSession(query.sessionId);
    const workspaceId = query.workspaceId ?? confirmed.workspaceId;
    if (workspaceId !== confirmed.workspaceId) {
      return reply.code(409).send({ message: "workspaceId does not match Stripe session metadata." });
    }

    if (!confirmed.paid) {
      return reply.code(409).send({ message: "Stripe checkout session is not paid yet.", session: confirmed });
    }

    const existingEntry = (await store.listCreditLedgerEntries(workspaceId)).find((entry) => entry.source === confirmed.source);
    const wallet = existingEntry
      ? await store.getWorkspaceWallet(workspaceId)
      : await store.topUpWorkspaceCredits(workspaceId, confirmed.credits, confirmed.source);

    return reply.code(200).send({
      confirmed: true,
      session: confirmed,
      wallet,
    });
  });
  app.get("/promotion-runs", async (request) => {
    const query = request.query as { workspaceId?: string };
    return store.listPromotionRuns(query.workspaceId);
  });
  app.get("/promotion-runs/:promotionRunId/targets", async (request, reply) => {
    const { promotionRunId } = request.params as { promotionRunId: string };
    const run = await store.getPromotionRun(promotionRunId);
    if (!run) {
      return reply.code(404).send({ message: "Promotion run not found." });
    }
    return store.listPromotionRunTargets(promotionRunId);
  });
  app.post("/promotion-runs", async (request, reply) => {
    const body = (request.body as {
      workspaceId?: string;
      campaignId?: string;
      category?: string;
      taskType?: string;
      geo?: string[];
      sponsoredSlots?: number;
      disclosureRequired?: boolean;
    } | undefined) ?? {};
    if (!body.campaignId || !body.category || !body.taskType) {
      return reply.code(400).send({ message: "campaignId, category, and taskType are required." });
    }
    try {
      const result = await store.createPromotionRun({
        workspaceId: body.workspaceId,
        campaignId: body.campaignId,
        category: body.category,
        taskType: body.taskType,
        geo: body.geo,
        sponsoredSlots: body.sponsoredSlots,
        disclosureRequired: body.disclosureRequired,
      });
      return reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Promotion run could not be created.";
      return reply.code(message.includes("not found") ? 404 : 409).send({ message });
    }
  });
  app.post("/promotion-runs/:promotionRunId/dispatch", async (request, reply) => {
    const { promotionRunId } = request.params as { promotionRunId: string };
    const result = await store.dispatchPromotionRun(promotionRunId);
    if (!result) {
      return reply.code(404).send({ message: "Promotion run not found." });
    }
    return result;
  });
  app.get("/delivery/metrics", async (request) => {
    const query = request.query as { workspaceId?: string; promotionRunId?: string };
    return store.getDeliveryMetrics(query.workspaceId, query.promotionRunId);
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
      evidenceRef?: string | null;
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
      body.evidenceRef,
    );
    if (!result) return reply.code(404).send({ message: "Lead not found." });
    if (!result.ok) return reply.code(409).send(result);
    return result;
  });
  app.get("/agent-leads/:leadId/verification-history", async (request) => {
    const { leadId } = request.params as { leadId: string };
    return store.listVerificationHistory(leadId);
  });
  app.post("/agent-leads/:leadId/promote", async (request, reply) => {
    const { leadId } = request.params as { leadId: string };
    const body = (request.body as {
      partnerId?: string;
      dataProvenance?: string;
      status?: string;
      supportedCategories?: string[];
      slaTier?: string;
      acceptsSponsored?: boolean;
      supportsDisclosure?: boolean;
      supportsDeliveryReceipt?: boolean;
      supportsPresentationReceipt?: boolean;
      authModes?: string[];
    } | undefined) ?? {};

    try {
      const partner = await store.promoteLeadToPartner(leadId, {
        partnerId: body.partnerId,
        dataProvenance: body.dataProvenance as never,
        status: body.status as never,
        supportedCategories: body.supportedCategories,
        slaTier: body.slaTier,
        acceptsSponsored: body.acceptsSponsored,
        supportsDisclosure: body.supportsDisclosure,
        supportsDeliveryReceipt: body.supportsDeliveryReceipt,
        supportsPresentationReceipt: body.supportsPresentationReceipt,
        authModes: body.authModes,
      });
      if (!partner) {
        return reply.code(404).send({ message: "Lead not found." });
      }
      return reply.code(201).send(partner);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Lead could not be promoted to partner.",
      });
    }
  });
  app.get("/partners", async (request) => {
    const query = request.query as { provenance?: string };
    return store.listPartners({ provenance: query.provenance });
  });
  app.get("/campaigns", async (request) => {
    const query = request.query as { provenance?: string };
    return store.listCampaigns({ provenance: query.provenance });
  });
  app.get("/measurements/funnel", async (request) => {
    const query = request.query as Record<string, string>;
    return store.getMeasurementFunnel(query as never);
  });
  app.get("/measurements/attribution", async (request) => {
    const query = request.query as Record<string, string>;
    return store.getAttributionRows(query as never);
  });
  app.get("/billing/drafts", async () => store.getBillingDrafts());
  app.get("/evidence/assets", async (request) => {
    const query = request.query as { provenance?: string };
    return store.listEvidenceAssets({ provenance: query.provenance });
  });
  app.post("/evidence/assets", async (request, reply) => {
    try {
      const asset = await store.createEvidenceAsset(request.body as never);
      return reply.code(201).send(asset);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Evidence asset could not be created.",
      });
    }
  });
  app.get("/opc/profiles", async (request) => {
    const query = request.query as {
      provenance?: string;
      entityVerificationStatus?: string;
      primaryBusinessType?: string;
    };
    return store.listOpcProfiles(query);
  });
  app.post("/opc/profiles", async (request, reply) => {
    try {
      const profile = await store.createOpcProfile(request.body as never);
      return reply.code(201).send(profile);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "OPC profile could not be created.",
      });
    }
  });
  app.get("/opc/evidence", async (request) => {
    const query = request.query as { opcId?: string; provenance?: string };
    return store.listRevenueEvidence(query);
  });
  app.post("/opc/evidence", async (request, reply) => {
    try {
      const evidence = await store.createRevenueEvidence(request.body as never);
      return reply.code(201).send(evidence);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Revenue evidence could not be created.",
      });
    }
  });
  app.get("/opc/reviews", async (request) => {
    const query = request.query as { opcId?: string; decision?: string; provenance?: string };
    return store.listVerificationReviews(query);
  });
  app.post("/opc/reviews", async (request, reply) => {
    try {
      const review = await store.createVerificationReview(request.body as never);
      return reply.code(201).send(review);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Verification review could not be created.",
      });
    }
  });
  app.get("/opc/health-snapshots", async (request) => {
    const query = request.query as { opcId?: string; provenance?: string };
    return store.listMonthlyHealthSnapshots(query);
  });
  app.post("/opc/health-snapshots", async (request, reply) => {
    try {
      const snapshot = await store.createMonthlyHealthSnapshot(request.body as never);
      return reply.code(201).send(snapshot);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Monthly health snapshot could not be created.",
      });
    }
  });
  app.get("/channel-profiles", async (request) => {
    const query = request.query as { channelType?: string; channelStatus?: string; provenance?: string };
    return store.listChannelProfiles(query);
  });
  app.post("/channel-profiles", async (request, reply) => {
    try {
      const profile = await store.createChannelProfile(request.body as never);
      return reply.code(201).send(profile);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Channel profile could not be created.",
      });
    }
  });
  app.get("/commercial-extensions", async (request) => {
    const query = request.query as { partnerId?: string; provenance?: string };
    return store.listCommercialExtensions(query);
  });
  app.post("/commercial-extensions", async (request, reply) => {
    try {
      const extension = await store.createCommercialExtension(request.body as never);
      return reply.code(201).send(extension);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Commercial extension could not be created.",
      });
    }
  });
  app.get("/partner-onboarding-cases", async (request) => {
    const query = request.query as {
      agentLeadId?: string;
      channelId?: string;
      currentStage?: string;
      provenance?: string;
    };
    return store.listPartnerOnboardingCases(query);
  });
  app.post("/partner-onboarding-cases", async (request, reply) => {
    try {
      const onboardingCase = await store.createPartnerOnboardingCase(request.body as never);
      return reply.code(201).send(onboardingCase);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Partner onboarding case could not be created.",
      });
    }
  });
  app.get("/capability-verification-snapshots", async (request) => {
    const query = request.query as { agentLeadId?: string; recommendedTier?: string; provenance?: string };
    return store.listCapabilityVerificationSnapshots(query);
  });
  app.post("/capability-verification-snapshots", async (request, reply) => {
    try {
      const snapshot = await store.createCapabilityVerificationSnapshot(request.body as never);
      return reply.code(201).send(snapshot);
    } catch (error) {
      return reply.code(409).send({
        message: error instanceof Error ? error.message : "Capability verification snapshot could not be created.",
      });
    }
  });
  app.get("/risk/cases", async (request) => {
    const query = request.query as {
      status?: string;
      severity?: string;
      entityType?: string;
      ownerId?: string;
      dateFrom?: string;
      dateTo?: string;
      provenance?: string;
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
  app.get("/settlements", async (request) => {
    const query = request.query as { provenance?: string };
    return store.listSettlements({ provenance: query.provenance });
  });
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
      provenance?: string;
      page?: string;
      pageSize?: string;
    };

    return store.listAuditEvents({
      traceId: query.traceId,
      entityId: query.entityId,
      entityType: query.entityType ? AuditEntityTypeSchema.parse(query.entityType) : undefined,
      provenance: query.provenance,
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
    try {
      const payload = CampaignDraftInputSchema.parse(request.body);
      const result = await store.createCampaign(payload);
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Campaign could not be created.",
      });
    }
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

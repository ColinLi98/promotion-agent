import crypto from "node:crypto";

import { createAuditEvent } from "./audit.js";
import { compileOfferCard } from "./compiler.js";
import {
  AgentLeadSchema,
  AppealCaseInputSchema,
  AppealCaseSchema,
  AuditEventPageSchema,
  AuditEventSchema,
  CampaignDraftInputSchema,
  CampaignSchema,
  DashboardSnapshotSchema,
  DiscoveryRunSchema,
  DiscoverySourceInputSchema,
  DiscoverySourceSchema,
  EvidenceAssetInputSchema,
  EvidenceAssetSchema,
  EventReceiptSchema,
  MeasurementFunnelQuerySchema,
  PolicyCheckResultSchema,
  ReputationRecordSchema,
  RiskCaseInputSchema,
  RiskCaseSchema,
  SettlementDeadLetterEntrySchema,
  SettlementDeadLetterPageSchema,
  SettlementReceiptSchema,
  SettlementRetryJobSchema,
  type AgentLead,
  type AppealCase,
  type AppealCaseInput,
  type AuditEvent,
  type AuditEventFilter,
  type AttributionRow,
  type Campaign,
  type CampaignDraftInput,
  type DashboardSnapshot,
  type DiscoveryRun,
  type DiscoverySource,
  type DiscoverySourceInput,
  type EvidenceAsset,
  type EvidenceAssetInput,
  type EvaluationResponse,
  type EventReceipt,
  type MeasurementFunnel,
  type MeasurementFunnelQuery,
  type OpportunityRequest,
  type PartnerAgent,
  type PolicyCheckResult,
  type ReputationRecord,
  type RiskCase,
  type RiskCaseInput,
  type SettlementDeadLetterEntry,
  type SettlementDeadLetterFilter,
  type BillingDraft,
  type SettlementReceipt,
  type SettlementRetryJob,
  type SettlementRetryJobFilter,
  type VerificationChecklist,
  type VerificationRecord,
  VerificationRecordSchema,
} from "./domain.js";
import { crawlDiscoverySource } from "./discovery.js";
import { InMemoryHotStateStore, type HotStateStore } from "./hot-state.js";
import { buildAttributionRows, buildBillingDrafts, buildMeasurementFunnel } from "./measurement.js";
import { runPolicyCheck } from "./policy.js";
import type { PromotionAgentRepository } from "./repository.js";
import { rankEligibleCampaigns, shortlistCampaigns } from "./ranking.js";
import { buildSeedData, type SeedData } from "./seed.js";
import { type SettlementGateway, SimulatedSettlementGateway } from "./settlement-gateway.js";
import { backoffDelaySeconds, isRetryJobDue, transitionSettlementStatus } from "./settlement-state.js";

const nowIso = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

const buildProofBundleId = () => `proof_${crypto.randomUUID().slice(0, 8)}`;
const buildCampaignId = () => `cmp_${crypto.randomUUID().slice(0, 8)}`;
const buildRetryJobId = () => `retry_${crypto.randomUUID().slice(0, 8)}`;
const buildDlqEntryId = () => `dlq_${crypto.randomUUID().slice(0, 8)}`;
const hashRequest = (value: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const HOT_STATE_TTL = {
  opportunityCacheSeconds: 12,
  receiptResultSeconds: 15 * 60,
  receiptLockMs: 8_000,
  retryLeaseMs: 10_000,
} as const;

const RECEIPT_RESULT_POLL_ATTEMPTS = 10;
const RECEIPT_RESULT_POLL_DELAY_MS = 120;

type ReceiptProcessingResult = {
  receipt: EventReceipt;
  settlement: SettlementReceipt | null;
  deduplicated: boolean;
};

type RetryQueueProcessingSummary = {
  processedCount: number;
  settledCount: number;
  rescheduledCount: number;
  failedCount: number;
  skippedCount: number;
  items: Array<{
    settlementId: string;
    retryJobId: string;
    status: SettlementRetryJob["status"];
    settlementStatus: SettlementReceipt["status"];
    attempts: number;
  }>;
};

const markDeduplicated = (result: ReceiptProcessingResult): ReceiptProcessingResult => ({
  ...result,
  deduplicated: true,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const opportunityCacheKey = (request: OpportunityRequest) => `cache:opportunity:${hashRequest(request)}`;
const receiptResultKey = (receiptId: string) => `idempotency:receipt:${receiptId}:result`;
const receiptLockKey = (receiptId: string) => `lock:receipt:${receiptId}`;
const retryLeaseKey = (retryJobId: string) => `lock:settlement-retry:${retryJobId}`;

class InMemoryPromotionAgentRepository implements PromotionAgentRepository {
  private readonly discoverySources: DiscoverySource[];
  private readonly discoveryRuns: DiscoveryRun[];
  private readonly leads: AgentLead[];
  private readonly partners: PartnerAgent[];
  private readonly campaigns: Campaign[];
  private readonly verificationRecords: VerificationRecord[];
  private readonly evidenceAssets: EvidenceAsset[];
  private readonly riskCases: RiskCase[];
  private readonly reputationRecords: ReputationRecord[];
  private readonly appeals: AppealCase[];
  private readonly policyChecks: PolicyCheckResult[];
  private readonly eventReceipts: EventReceipt[];
  private readonly settlements: SettlementReceipt[];
  private readonly retryJobs: SettlementRetryJob[];
  private readonly deadLetters: SettlementDeadLetterEntry[];
  private readonly auditEvents: AuditEvent[];

  constructor(seedData: SeedData) {
    this.discoverySources = clone(seedData.discoverySources);
    this.discoveryRuns = [];
    this.leads = clone(seedData.leads);
    this.partners = clone(seedData.partners);
    this.campaigns = clone(seedData.campaigns);
    this.verificationRecords = clone(seedData.verificationRecords);
    this.evidenceAssets = clone(seedData.evidenceAssets);
    this.riskCases = clone(seedData.riskCases);
    this.reputationRecords = clone(seedData.reputationRecords);
    this.appeals = clone(seedData.appeals);
    this.policyChecks = seedData.campaigns.map((campaign) => runPolicyCheck(clone(campaign)));
    this.eventReceipts = [];
    this.settlements = [];
    this.retryJobs = [];
    this.deadLetters = [];
    this.auditEvents = [];
  }

  async listDiscoverySources() {
    return clone(this.discoverySources);
  }

  async createDiscoverySource(input: DiscoverySourceInput) {
    const parsed = DiscoverySourceSchema.parse({
      sourceId: `src_${crypto.randomUUID().slice(0, 8)}`,
      ...DiscoverySourceInputSchema.parse(input),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.discoverySources.push(clone(parsed));
    return clone(parsed);
  }

  async listDiscoveryRuns() {
    return clone(this.discoveryRuns);
  }

  async insertDiscoveryRun(run: DiscoveryRun) {
    this.discoveryRuns.unshift(clone(DiscoveryRunSchema.parse(run)));
  }

  async updateDiscoveryRun(run: DiscoveryRun) {
    const parsed = DiscoveryRunSchema.parse(run);
    const index = this.discoveryRuns.findIndex((item) => item.runId === parsed.runId);
    if (index < 0) {
      this.discoveryRuns.unshift(clone(parsed));
      return;
    }

    this.discoveryRuns[index] = clone(parsed);
  }

  async listLeads() {
    return clone(this.leads);
  }

  async getLead(leadId: string) {
    const lead = this.leads.find((item) => item.agentId === leadId);
    return lead ? clone(lead) : null;
  }

  async upsertLead(lead: AgentLead) {
    const parsed = AgentLeadSchema.parse(lead);
    const index = this.leads.findIndex((item) => item.agentId === parsed.agentId);
    if (index < 0) {
      this.leads.push(clone(parsed));
      return;
    }

    this.leads[index] = clone(parsed);
  }

  async assignLead(leadId: string, ownerId: string) {
    const lead = this.leads.find((item) => item.agentId === leadId);
    if (!lead) return null;
    lead.assignedOwner = ownerId;
    lead.lastSeenAt = nowIso();
    return clone(lead);
  }

  async updateLeadStatus(
    leadId: string,
    nextStatus: AgentLead["verificationStatus"],
    actorId: string,
    comment: string,
    checklist: VerificationChecklist,
  ) {
    const lead = this.leads.find((item) => item.agentId === leadId);
    if (!lead) return null;
    const previousStatus = lead.verificationStatus;
    lead.verificationStatus = nextStatus;
    lead.lastSeenAt = nowIso();
    this.verificationRecords.unshift(
      VerificationRecordSchema.parse({
        recordId: `verif_${crypto.randomUUID().slice(0, 8)}`,
        leadId,
        previousStatus,
        nextStatus,
        checklist,
        actorId,
        comment,
        occurredAt: nowIso(),
      }),
    );
    return clone(lead);
  }

  async listVerificationRecords(leadId: string) {
    return clone(this.verificationRecords.filter((item) => item.leadId === leadId));
  }

  async insertVerificationRecord(record: VerificationRecord) {
    this.verificationRecords.unshift(clone(VerificationRecordSchema.parse(record)));
  }

  async listPartners() {
    return clone(this.partners);
  }

  async listCampaigns() {
    return clone(this.campaigns);
  }

  async getCampaign(campaignId: string) {
    const campaign = this.campaigns.find((item) => item.campaignId === campaignId);
    return campaign ? clone(campaign) : null;
  }

  async upsertCampaign(campaign: Campaign) {
    const parsed = CampaignSchema.parse(campaign);
    const index = this.campaigns.findIndex((item) => item.campaignId === parsed.campaignId);

    if (index >= 0) {
      this.campaigns[index] = clone(parsed);
      return;
    }

    this.campaigns.push(clone(parsed));
  }

  async listEvidenceAssets() {
    return clone(this.evidenceAssets);
  }

  async insertEvidenceAsset(asset: EvidenceAsset) {
    this.evidenceAssets.unshift(clone(EvidenceAssetSchema.parse(asset)));
  }

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; }> = {}) {
    return clone(
      this.riskCases.filter((item) => {
        if (filter.status && item.status !== filter.status) return false;
        if (filter.severity && item.severity !== filter.severity) return false;
        if (filter.entityType && item.entityType !== filter.entityType) return false;
        if (filter.ownerId && item.ownerId !== filter.ownerId) return false;
        if (filter.dateFrom && new Date(item.openedAt).getTime() < new Date(filter.dateFrom).getTime()) return false;
        if (filter.dateTo && new Date(item.openedAt).getTime() > new Date(filter.dateTo).getTime()) return false;
        return true;
      }),
    );
  }

  async getRiskCase(caseId: string) {
    const riskCase = this.riskCases.find((item) => item.caseId === caseId);
    return riskCase ? clone(riskCase) : null;
  }

  async insertRiskCase(riskCase: RiskCase) {
    this.riskCases.unshift(clone(RiskCaseSchema.parse(riskCase)));
  }

  async updateRiskCase(riskCase: RiskCase) {
    const parsed = RiskCaseSchema.parse(riskCase);
    const index = this.riskCases.findIndex((item) => item.caseId === parsed.caseId);
    if (index < 0) {
      this.riskCases.unshift(clone(parsed));
      return;
    }

    this.riskCases[index] = clone(parsed);
  }

  async listReputationRecords() {
    return clone(this.reputationRecords);
  }

  async insertReputationRecord(record: ReputationRecord) {
    this.reputationRecords.unshift(clone(ReputationRecordSchema.parse(record)));
  }

  async getReputationRecord(recordId: string) {
    const record = this.reputationRecords.find((item) => item.recordId === recordId);
    return record ? clone(record) : null;
  }

  async updateReputationRecord(record: ReputationRecord) {
    const parsed = ReputationRecordSchema.parse(record);
    const index = this.reputationRecords.findIndex((item) => item.recordId === parsed.recordId);
    if (index < 0) {
      this.reputationRecords.unshift(clone(parsed));
      return;
    }

    this.reputationRecords[index] = clone(parsed);
  }

  async listAppeals() {
    return clone(this.appeals);
  }

  async getAppeal(appealId: string) {
    const appeal = this.appeals.find((item) => item.appealId === appealId);
    return appeal ? clone(appeal) : null;
  }

  async insertAppeal(appeal: AppealCase) {
    this.appeals.unshift(clone(AppealCaseSchema.parse(appeal)));
  }

  async updateAppeal(appeal: AppealCase) {
    const parsed = AppealCaseSchema.parse(appeal);
    const index = this.appeals.findIndex((item) => item.appealId === parsed.appealId);
    if (index < 0) {
      this.appeals.unshift(clone(parsed));
      return;
    }

    this.appeals[index] = clone(parsed);
  }

  async listPolicyChecks(campaignId?: string) {
    const policyChecks = campaignId
      ? this.policyChecks.filter((item) => item.campaignId === campaignId)
      : this.policyChecks;

    return clone(policyChecks);
  }

  async getLatestPolicyCheck(campaignId: string) {
    const policyCheck = [...this.policyChecks].reverse().find((item) => item.campaignId === campaignId);
    return policyCheck ? clone(policyCheck) : null;
  }

  async insertPolicyCheck(policyCheck: PolicyCheckResult) {
    this.policyChecks.push(clone(PolicyCheckResultSchema.parse(policyCheck)));
  }

  async listEventReceipts() {
    return clone(this.eventReceipts);
  }

  async getEventReceipt(receiptId: string) {
    const receipt = this.eventReceipts.find((item) => item.receiptId === receiptId);
    return receipt ? clone(receipt) : null;
  }

  async insertEventReceipt(receipt: EventReceipt) {
    this.eventReceipts.push(clone(EventReceiptSchema.parse(receipt)));
  }

  async getMeasurementFunnel(query: MeasurementFunnelQuery) {
    return buildMeasurementFunnel(this.eventReceipts, this.campaigns, this.partners, MeasurementFunnelQuerySchema.parse(query));
  }

  async getAttributionRows(query: MeasurementFunnelQuery) {
    return buildAttributionRows(
      this.eventReceipts,
      this.settlements,
      this.campaigns,
      MeasurementFunnelQuerySchema.parse(query),
    );
  }

  async getBillingDrafts() {
    return buildBillingDrafts(this.settlements, this.campaigns);
  }

  async listSettlements() {
    return clone(this.settlements);
  }

  async getSettlement(settlementId: string) {
    const settlement = this.settlements.find((item) => item.settlementId === settlementId);
    return settlement ? clone(settlement) : null;
  }

  async findSettlement(intentId: string, offerId: string, eventType: EventReceipt["eventType"]) {
    const settlement = this.settlements.find(
      (item) => item.intentId === intentId && item.offerId === offerId && item.eventType === eventType,
    );
    return settlement ? clone(settlement) : null;
  }

  async insertSettlement(settlement: SettlementReceipt) {
    this.settlements.push(clone(SettlementReceiptSchema.parse(settlement)));
  }

  async updateSettlement(settlement: SettlementReceipt) {
    const parsed = SettlementReceiptSchema.parse(settlement);
    const index = this.settlements.findIndex((item) => item.settlementId === parsed.settlementId);
    if (index < 0) {
      this.settlements.push(clone(parsed));
      return;
    }

    this.settlements[index] = clone(parsed);
  }

  async listSettlementRetryJobs(filter: SettlementRetryJobFilter = {}) {
    const jobs = this.retryJobs.filter((job) => {
      if (filter.status && job.status !== filter.status) {
        return false;
      }
      if (filter.settlementId && job.settlementId !== filter.settlementId) {
        return false;
      }
      if (filter.traceId && job.traceId !== filter.traceId) {
        return false;
      }
      return true;
    });

    return clone(jobs.slice(0, filter.limit ?? 50));
  }

  async getSettlementRetryJobBySettlementId(settlementId: string) {
    const job = this.retryJobs.find((item) => item.settlementId === settlementId);
    return job ? clone(job) : null;
  }

  async upsertSettlementRetryJob(job: SettlementRetryJob) {
    const parsed = SettlementRetryJobSchema.parse(job);
    const index = this.retryJobs.findIndex((item) => item.settlementId === parsed.settlementId);
    if (index < 0) {
      this.retryJobs.push(clone(parsed));
      return;
    }

    this.retryJobs[index] = clone(parsed);
  }

  async listSettlementDeadLetters(filter: SettlementDeadLetterFilter = {}) {
    const filtered = this.deadLetters.filter((entry) => {
      if (filter.status && entry.status !== filter.status) {
        return false;
      }
      if (filter.traceId && entry.traceId !== filter.traceId) {
        return false;
      }
      if (filter.settlementId && entry.settlementId !== filter.settlementId) {
        return false;
      }
      return true;
    });

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const items = clone([...filtered].reverse().slice(start, start + pageSize));

    return SettlementDeadLetterPageSchema.parse({
      items,
      total: filtered.length,
      page,
      pageSize,
      hasNextPage: start + pageSize < filtered.length,
      hasPreviousPage: page > 1,
    });
  }

  async getSettlementDeadLetter(dlqEntryId: string) {
    const entry = this.deadLetters.find((item) => item.dlqEntryId === dlqEntryId);
    return entry ? clone(entry) : null;
  }

  async getSettlementDeadLetterBySettlementId(settlementId: string) {
    const entry = [...this.deadLetters].reverse().find((item) => item.settlementId === settlementId);
    return entry ? clone(entry) : null;
  }

  async upsertSettlementDeadLetter(entry: SettlementDeadLetterEntry) {
    const parsed = SettlementDeadLetterEntrySchema.parse(entry);
    const index = this.deadLetters.findIndex((item) => item.dlqEntryId === parsed.dlqEntryId);
    if (index < 0) {
      this.deadLetters.push(clone(parsed));
      return;
    }

    this.deadLetters[index] = clone(parsed);
  }

  async listAuditEvents(filter: AuditEventFilter = {}) {
    const filtered = this.auditEvents.filter((event) => {
      if (filter.traceId && event.traceId !== filter.traceId) {
        return false;
      }
      if (filter.entityId && event.entityId !== filter.entityId) {
        return false;
      }
      if (filter.entityType && event.entityType !== filter.entityType) {
        return false;
      }
      return true;
    });

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const items = clone([...filtered].reverse().slice(start, start + pageSize));

    return AuditEventPageSchema.parse({
      items,
      total: filtered.length,
      page,
      pageSize,
      hasNextPage: start + pageSize < filtered.length,
      hasPreviousPage: page > 1,
    });
  }

  async insertAuditEvent(event: AuditEvent) {
    this.auditEvents.push(clone(AuditEventSchema.parse(event)));
  }

  async close() {}
}

type CreateStoreOptions = Partial<{
  repository: PromotionAgentRepository;
  hotState: HotStateStore;
  settlementGateway: SettlementGateway;
}>;

export class PromotionAgentStore {
  constructor(
    private readonly repository: PromotionAgentRepository,
    private readonly hotState: HotStateStore,
    private readonly settlementGateway: SettlementGateway = new SimulatedSettlementGateway(),
  ) {}

  async listLeads() {
    return this.repository.listLeads();
  }

  async listDiscoverySources() {
    return this.repository.listDiscoverySources();
  }

  async createDiscoverySource(input: DiscoverySourceInput) {
    return this.repository.createDiscoverySource(input);
  }

  async listDiscoveryRuns() {
    return this.repository.listDiscoveryRuns();
  }

  async runDiscovery(sourceId: string) {
    const source = (await this.repository.listDiscoverySources()).find((item) => item.sourceId === sourceId);
    if (!source) {
      return null;
    }

    const run: DiscoveryRun = DiscoveryRunSchema.parse({
      runId: `run_${crypto.randomUUID().slice(0, 8)}`,
      sourceId,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      discoveredCount: 0,
      createdLeadCount: 0,
      dedupedCount: 0,
      errorCount: 0,
      traceId: `discovery_${sourceId}_${Date.now()}`,
      errors: [],
    });
    await this.repository.insertDiscoveryRun(run);

    const existingLeads = await this.repository.listLeads();
    const byDedupe = new Map(existingLeads.map((lead) => [lead.dedupeKey, lead]));
    const crawled = await crawlDiscoverySource(source);

    run.discoveredCount = crawled.leads.length;
    for (const lead of crawled.leads) {
      const existing = byDedupe.get(lead.dedupeKey);
      if (existing) {
        const merged: AgentLead = AgentLeadSchema.parse({
          ...existing,
          verticals: [...new Set([...existing.verticals, ...lead.verticals])],
          skills: [...new Set([...existing.skills, ...lead.skills])],
          geo: [...new Set([...existing.geo, ...lead.geo])],
          authModes: [...new Set([...existing.authModes, ...lead.authModes])],
          lastSeenAt: nowIso(),
          endpointUrl: existing.endpointUrl ?? lead.endpointUrl,
          contactRef: existing.contactRef ?? lead.contactRef,
          missingFields: [...new Set([...existing.missingFields, ...lead.missingFields])],
          reachProxy: Math.max(existing.reachProxy, lead.reachProxy),
          monetizationReadiness: Math.max(existing.monetizationReadiness, lead.monetizationReadiness),
          leadScore: Math.max(existing.leadScore, lead.leadScore),
          scoreBreakdown: {
            icpFit: Math.max(existing.scoreBreakdown.icpFit, lead.scoreBreakdown.icpFit),
            protocolFit: Math.max(existing.scoreBreakdown.protocolFit, lead.scoreBreakdown.protocolFit),
            reachFit: Math.max(existing.scoreBreakdown.reachFit, lead.scoreBreakdown.reachFit),
          },
        });
        await this.repository.upsertLead(merged);
        run.dedupedCount += 1;
        continue;
      }

      await this.repository.upsertLead(lead);
      run.createdLeadCount += 1;
      byDedupe.set(lead.dedupeKey, lead);
    }

    run.status = crawled.errors.length > 0 ? "completed" : "completed";
    run.finishedAt = nowIso();
    run.errorCount = crawled.errors.length;
    run.errors = crawled.errors;
    await this.repository.updateDiscoveryRun(run);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: run.traceId,
        entityType: "opportunity",
        entityId: run.runId,
        action: "run_discovery_source",
        status: crawled.errors.length > 0 ? "blocked" : "success",
        actorType: "system",
        details: {
          sourceId,
          discoveredCount: run.discoveredCount,
          createdLeadCount: run.createdLeadCount,
          dedupedCount: run.dedupedCount,
          errorCount: run.errorCount,
        },
      }),
    );

    return run;
  }

  async listPartners() {
    return this.repository.listPartners();
  }

  async listCampaigns() {
    return this.repository.listCampaigns();
  }

  async listAgentLeads(filters: Partial<{ status: string; sourceType: string; dataOrigin: string; vertical: string; geo: string; owner: string; hasMissingFields: boolean; }>) {
    const leads = await this.repository.listLeads();
    return leads.filter((lead) => {
      if (filters.status && lead.verificationStatus !== filters.status) return false;
      if (filters.sourceType && lead.sourceType !== filters.sourceType) return false;
      if (filters.dataOrigin && lead.dataOrigin !== filters.dataOrigin) return false;
      if (filters.vertical && !lead.verticals.includes(filters.vertical)) return false;
      if (filters.geo && !lead.geo.includes(filters.geo)) return false;
      if (filters.owner && lead.assignedOwner !== filters.owner) return false;
      if (typeof filters.hasMissingFields === "boolean" && (lead.missingFields.length > 0) !== filters.hasMissingFields) return false;
      return true;
    });
  }

  async getLead(leadId: string) {
    return this.repository.getLead(leadId);
  }

  async assignLead(leadId: string, ownerId: string) {
    const lead = await this.repository.assignLead(leadId, ownerId);
    if (!lead) return null;
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: leadId,
        entityType: "campaign",
        entityId: leadId,
        action: "assign_agent_lead",
        status: "success",
        actorType: "operator",
        actorId: ownerId,
        details: {
          ownerId,
        },
      }),
    );
    return lead;
  }

  async updateLeadStatus(
    leadId: string,
    nextStatus: AgentLead["verificationStatus"],
    actorId: string,
    comment: string,
    checklist: VerificationChecklist,
  ) {
    if (
      nextStatus === "active" &&
      !Object.values(checklist).every(Boolean)
    ) {
      return {
        ok: false as const,
        message: "Checklist must be complete before activating a lead.",
      };
    }

    const lead = await this.repository.updateLeadStatus(leadId, nextStatus, actorId, comment, checklist);
    if (!lead) {
      return null;
    }

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: leadId,
        entityType: "campaign",
        entityId: leadId,
        action: "update_agent_lead_status",
        status: "success",
        actorType: "operator",
        actorId,
        details: {
          nextStatus,
          checklist,
          comment,
        },
      }),
    );

    return {
      ok: true as const,
      lead,
    };
  }

  async listVerificationHistory(leadId: string) {
    return this.repository.listVerificationRecords(leadId);
  }

  async listEvidenceAssets() {
    return this.repository.listEvidenceAssets();
  }

  async createEvidenceAsset(input: EvidenceAssetInput) {
    const parsed = EvidenceAssetInputSchema.parse(input);
    const asset = EvidenceAssetSchema.parse({
      assetId: `asset_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      updatedAt: nowIso(),
      verifiedBy: parsed.verifiedBy ?? null,
      verificationNote: parsed.verificationNote ?? null,
    });
    await this.repository.insertEvidenceAsset(asset);
    return asset;
  }

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; }> = {}) {
    return this.repository.listRiskCases(filter);
  }

  async createRiskCase(input: RiskCaseInput) {
    const parsed = RiskCaseInputSchema.parse(input);
    const riskCase = RiskCaseSchema.parse({
      caseId: `risk_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      status: "open",
      openedAt: nowIso(),
      resolvedAt: null,
      ownerId: parsed.ownerId ?? null,
      note: parsed.note ?? null,
    });
    await this.repository.insertRiskCase(riskCase);
    if (parsed.entityType === "partner") {
      await this.repository.insertReputationRecord(
        ReputationRecordSchema.parse({
          recordId: `rep_${crypto.randomUUID().slice(0, 8)}`,
          partnerId: parsed.entityId,
          delta: parsed.severity === "critical" ? -8 : parsed.severity === "high" ? -5 : -2,
          reasonType:
            parsed.reasonType === "policy_violation" ? "manual_adjustment" : parsed.reasonType,
          evidenceRefs: [riskCase.caseId],
          disputeStatus: "none",
          occurredAt: nowIso(),
        }),
      );
    }
    return riskCase;
  }

  async updateRiskCaseStatus(caseId: string, status: RiskCase["status"], ownerId?: string, note?: string) {
    const riskCase = await this.repository.getRiskCase(caseId);
    if (!riskCase) return null;
    riskCase.status = status;
    riskCase.ownerId = ownerId ?? riskCase.ownerId;
    riskCase.note = note ?? riskCase.note;
    riskCase.resolvedAt = status === "resolved" || status === "dismissed" ? nowIso() : null;
    await this.repository.updateRiskCase(riskCase);
    return riskCase;
  }

  async listReputationRecords() {
    return this.repository.listReputationRecords();
  }

  async listAppeals() {
    return this.repository.listAppeals();
  }

  async createAppeal(input: AppealCaseInput) {
    const parsed = AppealCaseInputSchema.parse(input);
    const appeal = AppealCaseSchema.parse({
      appealId: `appeal_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      status: "open",
      openedAt: nowIso(),
      decidedAt: null,
      decisionNote: null,
    });
    await this.repository.insertAppeal(appeal);

    const records = await this.repository.listReputationRecords();
    const target = records.find((item) => item.recordId === parsed.targetRecordId);
    if (target) {
      await this.repository.updateReputationRecord(
        ReputationRecordSchema.parse({
          ...target,
          disputeStatus: "under_review",
        }),
      );
    }
    return appeal;
  }

  async decideAppeal(appealId: string, status: AppealCase["status"], decisionNote: string) {
    const appeal = await this.repository.getAppeal(appealId);
    if (!appeal) return null;
    appeal.status = status;
    appeal.decisionNote = decisionNote;
    appeal.decidedAt = nowIso();
    await this.repository.updateAppeal(appeal);

    const target = await this.repository.getReputationRecord(appeal.targetRecordId);
    if (target) {
      target.disputeStatus = status === "approved" ? "resolved" : "overturned";
      await this.repository.updateReputationRecord(target);
    }
    return appeal;
  }

  async getMeasurementFunnel(query: MeasurementFunnelQuery) {
    return this.repository.getMeasurementFunnel(query);
  }

  async getAttributionRows(query: MeasurementFunnelQuery) {
    return this.repository.getAttributionRows(query);
  }

  async getBillingDrafts() {
    return this.repository.getBillingDrafts();
  }

  async getCampaign(campaignId: string) {
    return this.repository.getCampaign(campaignId);
  }

  async getLatestPolicyCheck(campaignId: string) {
    return this.repository.getLatestPolicyCheck(campaignId);
  }

  async listPolicyChecks(campaignId?: string) {
    return this.repository.listPolicyChecks(campaignId);
  }

  async listSettlements() {
    return this.repository.listSettlements();
  }

  async getSettlement(settlementId: string) {
    return this.repository.getSettlement(settlementId);
  }

  async listSettlementRetryJobs(filter: SettlementRetryJobFilter = {}) {
    return this.repository.listSettlementRetryJobs(filter);
  }

  async listSettlementDeadLetters(filter: SettlementDeadLetterFilter = {}) {
    return this.repository.listSettlementDeadLetters(filter);
  }

  async listAuditEvents(filter: AuditEventFilter = {}) {
    return this.repository.listAuditEvents(filter);
  }

  async createCampaign(input: CampaignDraftInput) {
    const parsed = CampaignDraftInputSchema.parse(input);
    const campaign = CampaignSchema.parse({
      campaignId: buildCampaignId(),
      advertiser: parsed.advertiser,
      category: parsed.category,
      regions: parsed.regions,
      targetingPartnerIds: [],
      billingModel: parsed.billingModel,
      payoutAmount: parsed.payoutAmount,
      currency: parsed.currency,
      budget: parsed.budget,
      status: "draft",
      disclosureText: parsed.disclosureText,
      policyPass: false,
      minTrust: parsed.minTrust,
      offer: compileOfferCard(parsed.product),
      proofBundle: {
        proofBundleId: buildProofBundleId(),
        references: parsed.proofReferences,
        updatedAt: nowIso(),
      },
    });

    await this.repository.upsertCampaign(campaign);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: campaign.campaignId,
        entityType: "campaign",
        entityId: campaign.campaignId,
        action: "create_campaign",
        status: "success",
        actorType: "api",
        actorId: "campaigns.create",
        details: {
          advertiser: campaign.advertiser,
          category: campaign.category,
          billingModel: campaign.billingModel,
        },
      }),
    );

    const policyCheck = await this.reviewCampaign(campaign.campaignId);
    const reviewedCampaign = await this.repository.getCampaign(campaign.campaignId);

    return {
      campaign: reviewedCampaign,
      policyCheck,
    };
  }

  async reviewCampaign(campaignId: string) {
    const campaign = await this.repository.getCampaign(campaignId);
    if (!campaign) {
      return null;
    }

    campaign.status = "reviewing";
    await this.repository.upsertCampaign(campaign);

    const policyCheck = PolicyCheckResultSchema.parse(runPolicyCheck(campaign));
    await this.repository.insertPolicyCheck(policyCheck);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: campaignId,
        entityType: "policy_check",
        entityId: policyCheck.policyCheckId,
        action: "run_policy_check",
        status:
          policyCheck.decision === "pass"
            ? "success"
            : policyCheck.decision === "manual_review"
              ? "blocked"
              : "failure",
        actorType: "system",
        details: {
          campaignId,
          decision: policyCheck.decision,
          riskFlags: policyCheck.riskFlags,
          reasons: policyCheck.reasons,
        },
      }),
    );

    if (policyCheck.decision === "fail") {
      campaign.policyPass = false;
      campaign.status = "rejected";
    } else {
      campaign.policyPass = policyCheck.decision === "pass";
    }

    await this.repository.upsertCampaign(campaign);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: campaignId,
        entityType: "campaign",
        entityId: campaignId,
        action: "review_campaign",
        status:
          campaign.status === "rejected"
            ? "failure"
            : campaign.status === "reviewing" && !campaign.policyPass
              ? "blocked"
              : "success",
        actorType: "api",
        actorId: "campaigns.review",
        details: {
          status: campaign.status,
          policyPass: campaign.policyPass,
          decision: policyCheck.decision,
        },
      }),
    );

    return policyCheck;
  }

  async activateCampaign(campaignId: string) {
    const campaign = await this.repository.getCampaign(campaignId);
    if (!campaign) {
      return null;
    }

    const policyCheck =
      (await this.repository.getLatestPolicyCheck(campaignId)) ?? (await this.reviewCampaign(campaignId));
    if (!policyCheck) {
      return null;
    }

    if (policyCheck.decision !== "pass") {
      campaign.status = policyCheck.decision === "fail" ? "rejected" : "reviewing";
      campaign.policyPass = false;
      await this.repository.upsertCampaign(campaign);
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: campaignId,
          entityType: "campaign",
          entityId: campaignId,
          action: "activate_campaign",
          status: policyCheck.decision === "fail" ? "failure" : "blocked",
          actorType: "api",
          actorId: "campaigns.activate",
          details: {
            decision: policyCheck.decision,
            status: campaign.status,
          },
        }),
      );
      return {
        activated: false,
        campaign,
        policyCheck,
      };
    }

    campaign.status = "active";
    campaign.policyPass = true;
    await this.repository.upsertCampaign(campaign);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: campaignId,
        entityType: "campaign",
        entityId: campaignId,
        action: "activate_campaign",
        status: "success",
        actorType: "api",
        actorId: "campaigns.activate",
        details: {
          status: campaign.status,
        },
      }),
    );

    return {
      activated: true,
      campaign,
      policyCheck,
    };
  }

  async evaluateOpportunity(request: OpportunityRequest): Promise<EvaluationResponse> {
    const cacheKey = opportunityCacheKey(request);
    const cached = await this.hotState.getJson<EvaluationResponse>(cacheKey);

    if (cached) {
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: request.intentId,
          entityType: "cache",
          entityId: cacheKey,
          action: "evaluate_opportunity",
          status: "cache_hit",
          actorType: "api",
          actorId: "opportunities.evaluate",
          details: {
            shortlisted: cached.shortlisted.length,
            ttlSeconds: HOT_STATE_TTL.opportunityCacheSeconds,
          },
        }),
      );
      return cached;
    }

    const campaigns = await this.repository.listCampaigns();
    const partners = await this.repository.listPartners();
    const eligibleBids = rankEligibleCampaigns(request, campaigns, partners);
    const shortlisted = shortlistCampaigns(request, campaigns, partners);
    const totalCandidates = campaigns.length * partners.filter((partner) => partner.status === "active").length;

    const response = {
      intentId: request.intentId,
      totalCandidates,
      eligibleCandidates: eligibleBids.length,
      shortlisted,
    };

    await this.hotState.setJson(cacheKey, response, HOT_STATE_TTL.opportunityCacheSeconds);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: request.intentId,
        entityType: "cache",
        entityId: cacheKey,
        action: "evaluate_opportunity",
        status: "cache_miss",
        actorType: "api",
        actorId: "opportunities.evaluate",
        details: {
          shortlisted: shortlisted.length,
          eligibleCandidates: eligibleBids.length,
          ttlSeconds: HOT_STATE_TTL.opportunityCacheSeconds,
        },
      }),
    );
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: request.intentId,
        entityType: "opportunity",
        entityId: request.intentId,
        action: "evaluate_opportunity",
        status: "success",
        actorType: "buyer_agent",
        actorId: "opportunities.evaluate",
        details: {
          category: request.category,
          taskType: request.taskType,
          shortlisted: shortlisted.map((item) => ({
            campaignId: item.campaignId,
            offerId: item.offerId,
            priorityScore: item.priorityScore,
          })),
        },
      }),
    );

    return response;
  }

  async recordReceipt(receipt: EventReceipt) {
    const parsed = EventReceiptSchema.parse(receipt);
    const resultKey = receiptResultKey(parsed.receiptId);
    const cachedResult = await this.hotState.getJson<ReceiptProcessingResult>(resultKey);

    if (cachedResult) {
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: parsed.intentId,
          entityType: "idempotency",
          entityId: parsed.receiptId,
          action: "record_receipt",
          status: "deduplicated",
          actorType: "buyer_agent",
          actorId: parsed.partnerId,
          details: {
            source: "hot_state",
          },
        }),
      );
      return markDeduplicated(cachedResult);
    }

    const lockToken = await this.hotState.acquireLock(receiptLockKey(parsed.receiptId), HOT_STATE_TTL.receiptLockMs);
    if (!lockToken) {
      for (let attempt = 0; attempt < RECEIPT_RESULT_POLL_ATTEMPTS; attempt += 1) {
        await sleep(RECEIPT_RESULT_POLL_DELAY_MS);
        const replayed = await this.hotState.getJson<ReceiptProcessingResult>(resultKey);
        if (replayed) {
          await this.recordAuditEvent(
            createAuditEvent({
              traceId: parsed.intentId,
              entityType: "idempotency",
              entityId: parsed.receiptId,
              action: "record_receipt",
              status: "deduplicated",
              actorType: "buyer_agent",
              actorId: parsed.partnerId,
              details: {
                source: "lock_wait",
              },
            }),
          );
          return markDeduplicated(replayed);
        }
      }

      await this.recordAuditEvent(
        createAuditEvent({
          traceId: parsed.intentId,
          entityType: "idempotency",
          entityId: parsed.receiptId,
          action: "record_receipt",
          status: "blocked",
          actorType: "buyer_agent",
          actorId: parsed.partnerId,
          details: {
            reason: "lock_timeout",
          },
        }),
      );

      const existingReceipt = await this.repository.getEventReceipt(parsed.receiptId);
      if (existingReceipt) {
        const existingSettlement = await this.repository.findSettlement(
          existingReceipt.intentId,
          existingReceipt.offerId,
          existingReceipt.eventType,
        );
        return {
          receipt: existingReceipt,
          settlement: existingSettlement,
          deduplicated: true,
        };
      }

      throw new Error("Receipt processing is already in progress.");
    }

    try {
      const existingReceipt = await this.repository.getEventReceipt(parsed.receiptId);
      if (existingReceipt) {
        const existingSettlement = await this.repository.findSettlement(
          existingReceipt.intentId,
          existingReceipt.offerId,
          existingReceipt.eventType,
        );
        const result = {
          receipt: existingReceipt,
          settlement: existingSettlement,
          deduplicated: true,
        };
        await this.hotState.setJson(resultKey, result, HOT_STATE_TTL.receiptResultSeconds);
        await this.recordAuditEvent(
          createAuditEvent({
            traceId: parsed.intentId,
            entityType: "receipt",
            entityId: parsed.receiptId,
            action: "record_receipt",
            status: "deduplicated",
            actorType: "buyer_agent",
            actorId: parsed.partnerId,
            details: {
              source: "repository",
            },
          }),
        );
        return result;
      }

      await this.repository.insertEventReceipt(parsed);
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: parsed.intentId,
          entityType: "receipt",
          entityId: parsed.receiptId,
          action: "record_receipt",
          status: "success",
          actorType: "buyer_agent",
          actorId: parsed.partnerId,
          details: {
            eventType: parsed.eventType,
            campaignId: parsed.campaignId,
            offerId: parsed.offerId,
          },
        }),
      );

      const settlement = await this.tryCreateSettlement(parsed);
      const result = { receipt: parsed, settlement, deduplicated: false };
      await this.hotState.setJson(resultKey, result, HOT_STATE_TTL.receiptResultSeconds);
      return result;
    } finally {
      await this.hotState.releaseLock(receiptLockKey(parsed.receiptId), lockToken);
    }
  }

  async processSettlementRetryQueue(limit = 10): Promise<RetryQueueProcessingSummary> {
    const jobs = await this.repository.listSettlementRetryJobs({ limit: Math.max(limit * 3, limit) });
    const dueJobs = jobs.filter(isRetryJobDue).slice(0, limit);

    const summary: RetryQueueProcessingSummary = {
      processedCount: 0,
      settledCount: 0,
      rescheduledCount: 0,
      failedCount: 0,
      skippedCount: 0,
      items: [],
    };

    for (const job of dueJobs) {
      const leaseToken = await this.hotState.acquireLock(retryLeaseKey(job.retryJobId), HOT_STATE_TTL.retryLeaseMs);
      if (!leaseToken) {
        summary.skippedCount += 1;
        continue;
      }

      try {
        const currentJob =
          (await this.repository.getSettlementRetryJobBySettlementId(job.settlementId)) ?? job;
        if (!isRetryJobDue(currentJob)) {
          summary.skippedCount += 1;
          continue;
        }

        const settlement = await this.repository.getSettlement(currentJob.settlementId);
        if (!settlement) {
          currentJob.status = "failed";
          currentJob.lastError = "Settlement not found.";
          currentJob.updatedAt = nowIso();
          await this.repository.upsertSettlementRetryJob(currentJob);
          summary.failedCount += 1;
          summary.items.push({
            settlementId: currentJob.settlementId,
            retryJobId: currentJob.retryJobId,
            status: currentJob.status,
            settlementStatus: "failed",
            attempts: currentJob.attempts,
          });
          continue;
        }

        const startedAt = nowIso();
        currentJob.status = "processing";
        currentJob.attempts += 1;
        currentJob.lastAttemptAt = startedAt;
        currentJob.updatedAt = startedAt;
        await this.repository.upsertSettlementRetryJob(currentJob);

        settlement.status = transitionSettlementStatus(settlement, "begin_processing");
        settlement.updatedAt = startedAt;
        await this.repository.updateSettlement(settlement);
        await this.recordAuditEvent(
          createAuditEvent({
            traceId: currentJob.traceId,
            entityType: "settlement",
            entityId: settlement.settlementId,
            action: "process_settlement_retry_job",
            status: "started",
            actorType: "system",
            details: {
              retryJobId: currentJob.retryJobId,
              attempts: currentJob.attempts,
            },
          }),
        );

        const gatewayResult = await this.settlementGateway.submitSettlement(settlement, currentJob);
        const finishedAt = nowIso();

        if (gatewayResult.ok) {
          settlement.status = transitionSettlementStatus(settlement, "mark_settled");
          settlement.providerSettlementId = gatewayResult.providerSettlementId ?? settlement.providerSettlementId;
          settlement.providerReference = gatewayResult.providerReference ?? settlement.providerReference;
          settlement.providerState = gatewayResult.providerState ?? "settled";
          settlement.providerResponseCode = gatewayResult.providerResponseCode ?? settlement.providerResponseCode;
          settlement.lastError = null;
          settlement.updatedAt = finishedAt;
          await this.repository.updateSettlement(settlement);

          currentJob.status = "completed";
          currentJob.lastError = null;
          currentJob.updatedAt = finishedAt;
          await this.repository.upsertSettlementRetryJob(currentJob);

          summary.processedCount += 1;
          summary.settledCount += 1;
          summary.items.push({
            settlementId: settlement.settlementId,
            retryJobId: currentJob.retryJobId,
            status: currentJob.status,
            settlementStatus: settlement.status,
            attempts: currentJob.attempts,
          });

          await this.recordAuditEvent(
            createAuditEvent({
              traceId: currentJob.traceId,
              entityType: "settlement",
              entityId: settlement.settlementId,
              action: "process_settlement_retry_job",
              status: "success",
              actorType: "system",
              details: {
                retryJobId: currentJob.retryJobId,
                attempts: currentJob.attempts,
                providerState: settlement.providerState,
                providerSettlementId: settlement.providerSettlementId,
              },
            }),
          );

          const existingDlq = await this.repository.getSettlementDeadLetterBySettlementId(settlement.settlementId);
          if (existingDlq && existingDlq.status !== "resolved" && existingDlq.status !== "ignored") {
            existingDlq.status = "resolved";
            existingDlq.resolutionNote = "Settlement eventually succeeded.";
            existingDlq.resolvedAt = finishedAt;
            existingDlq.updatedAt = finishedAt;
            await this.repository.upsertSettlementDeadLetter(existingDlq);
          }

          continue;
        }

        const shouldRetry = gatewayResult.retryable && currentJob.attempts < currentJob.maxAttempts;
        currentJob.lastError = gatewayResult.message ?? "Settlement gateway rejected the request.";
        currentJob.updatedAt = finishedAt;
        settlement.providerSettlementId = gatewayResult.providerSettlementId ?? settlement.providerSettlementId;
        settlement.providerReference = gatewayResult.providerReference ?? settlement.providerReference;
        settlement.providerState = gatewayResult.providerState ?? settlement.providerState;
        settlement.providerResponseCode = gatewayResult.providerResponseCode ?? settlement.providerResponseCode;
        settlement.lastError = currentJob.lastError;
        settlement.updatedAt = finishedAt;

        if (shouldRetry) {
          settlement.status = transitionSettlementStatus(settlement, "schedule_retry");
          currentJob.status = "retry_scheduled";
          currentJob.nextRunAt = new Date(
            Date.now() + backoffDelaySeconds(currentJob.attempts) * 1000,
          ).toISOString();

          summary.processedCount += 1;
          summary.rescheduledCount += 1;
        } else {
          settlement.status = transitionSettlementStatus(settlement, "mark_failed");
          currentJob.status = "failed";

          summary.processedCount += 1;
          summary.failedCount += 1;
        }

        await this.repository.updateSettlement(settlement);
        await this.repository.upsertSettlementRetryJob(currentJob);
        summary.items.push({
          settlementId: settlement.settlementId,
          retryJobId: currentJob.retryJobId,
          status: currentJob.status,
          settlementStatus: settlement.status,
          attempts: currentJob.attempts,
        });

        await this.recordAuditEvent(
          createAuditEvent({
            traceId: currentJob.traceId,
            entityType: "settlement",
            entityId: settlement.settlementId,
            action: "process_settlement_retry_job",
            status: shouldRetry ? "blocked" : "failure",
            actorType: "system",
            details: {
              retryJobId: currentJob.retryJobId,
              attempts: currentJob.attempts,
              message: currentJob.lastError,
              nextRunAt: currentJob.nextRunAt,
            },
          }),
        );

        if (!shouldRetry) {
          await this.upsertDeadLetterForFailure(settlement, currentJob, "worker_failed_max_attempts", currentJob.lastError);
        }
      } finally {
        await this.hotState.releaseLock(retryLeaseKey(job.retryJobId), leaseToken);
      }
    }

    return summary;
  }

  async markSettlementDisputed(settlementId: string) {
    const settlement = await this.repository.getSettlement(settlementId);
    if (!settlement) {
      return null;
    }

    settlement.status = transitionSettlementStatus(settlement, "mark_disputed");
    settlement.disputeFlag = true;
    settlement.updatedAt = nowIso();
    await this.repository.updateSettlement(settlement);

    const retryJob = await this.repository.getSettlementRetryJobBySettlementId(settlementId);
    if (retryJob && retryJob.status !== "completed" && retryJob.status !== "failed") {
      retryJob.status = "cancelled";
      retryJob.updatedAt = nowIso();
      retryJob.lastError = "Settlement marked as disputed.";
      await this.repository.upsertSettlementRetryJob(retryJob);
    }

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: settlement.intentId,
        entityType: "settlement",
        entityId: settlement.settlementId,
        action: "mark_settlement_disputed",
        status: "success",
        actorType: "operator",
        actorId: "settlements.dispute",
        details: {
          settlementId,
        },
      }),
    );

    return settlement;
  }

  async replaySettlementDeadLetter(dlqEntryId: string, resolutionNote?: string) {
    const entry = await this.repository.getSettlementDeadLetter(dlqEntryId);
    if (!entry) {
      return null;
    }

    const settlement = await this.repository.getSettlement(entry.settlementId);
    if (!settlement) {
      return null;
    }

    settlement.status = "retry_scheduled";
    settlement.disputeFlag = false;
    settlement.lastError = null;
    settlement.updatedAt = nowIso();
    await this.repository.updateSettlement(settlement);

    const existingJob = await this.repository.getSettlementRetryJobBySettlementId(entry.settlementId);
    const timestamp = nowIso();
    const retryJob = SettlementRetryJobSchema.parse({
      retryJobId: existingJob?.retryJobId ?? buildRetryJobId(),
      settlementId: entry.settlementId,
      traceId: entry.traceId,
      status: "queued",
      attempts: 0,
      maxAttempts: existingJob?.maxAttempts ?? 3,
      nextRunAt: timestamp,
      lastError: null,
      lastAttemptAt: null,
      createdAt: existingJob?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    await this.repository.upsertSettlementRetryJob(retryJob);

    entry.status = "replayed";
    entry.resolutionNote = resolutionNote ?? "Replayed from DLQ.";
    entry.resolvedAt = timestamp;
    entry.updatedAt = timestamp;
    await this.repository.upsertSettlementDeadLetter(entry);

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: entry.traceId,
        entityType: "settlement",
        entityId: entry.settlementId,
        action: "replay_settlement_dead_letter",
        status: "success",
        actorType: "operator",
        actorId: "dlq.replay",
        details: {
          dlqEntryId,
          retryJobId: retryJob.retryJobId,
        },
      }),
    );

    return {
      dlqEntry: entry,
      retryJob,
      settlement,
    };
  }

  async resolveSettlementDeadLetter(dlqEntryId: string, status: "resolved" | "ignored", resolutionNote?: string) {
    const entry = await this.repository.getSettlementDeadLetter(dlqEntryId);
    if (!entry) {
      return null;
    }

    const timestamp = nowIso();
    entry.status = status;
    entry.resolutionNote = resolutionNote ?? null;
    entry.resolvedAt = timestamp;
    entry.updatedAt = timestamp;
    await this.repository.upsertSettlementDeadLetter(entry);

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: entry.traceId,
        entityType: "settlement",
        entityId: entry.settlementId,
        action: "resolve_settlement_dead_letter",
        status: "success",
        actorType: "operator",
        actorId: "dlq.resolve",
        details: {
          dlqEntryId,
          resolutionStatus: status,
        },
      }),
    );

    return entry;
  }

  async dashboard(): Promise<DashboardSnapshot> {
    const [partners, campaigns, receipts, settlements, leads] = await Promise.all([
      this.repository.listPartners(),
      this.repository.listCampaigns(),
      this.repository.listEventReceipts(),
      this.repository.listSettlements(),
      this.repository.listLeads(),
    ]);

    const eventCounts = {
      shortlisted: 0,
      shown: 0,
      detail_view: 0,
      handoff: 0,
      conversion: 0,
    };

    for (const receipt of receipts) {
      eventCounts[receipt.eventType] += 1;
    }

    const opportunityCount = new Set(receipts.map((currentReceipt) => currentReceipt.intentId)).size || 1;
    const qualifiedShortlistedIntentCount = new Set(
      receipts
        .filter((currentReceipt) => currentReceipt.eventType === "shortlisted")
        .map((currentReceipt) => currentReceipt.intentId),
    ).size;
    const shownCount = eventCounts.shown;
    const detailViewCount = eventCounts.detail_view;
    const handoffCount = eventCounts.handoff;
    const conversionCount = eventCounts.conversion;
    const detailViewRate = shownCount > 0 ? detailViewCount / shownCount : 0;
    const handoffRate = detailViewCount > 0 ? handoffCount / detailViewCount : 0;
    const actionConversionRate = handoffCount > 0 ? conversionCount / handoffCount : 0;
    const disclosureShownRate = eventCounts.shortlisted > 0 ? shownCount / eventCounts.shortlisted : 0;
    const qualifiedRecommendationRate = qualifiedShortlistedIntentCount / opportunityCount;

    return DashboardSnapshotSchema.parse({
      activePartners: partners.filter((partner) => partner.status === "active").length,
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
      eventCounts,
      settlementCount: settlements.length,
      qualifiedRecommendationRate,
      detailViewRate,
      handoffRate,
      actionConversionRate,
      disclosureShownRate,
      qualifiedAgentCoverage: leads.filter((lead) => lead.verificationStatus === "active").length,
    });
  }

  async close() {
    await Promise.all([
      this.repository.close(),
      this.hotState.close(),
    ]);
  }

  private async upsertDeadLetterForFailure(
    settlement: SettlementReceipt,
    retryJob: SettlementRetryJob | null,
    reason: string,
    lastError: string,
  ) {
    const existing = await this.repository.getSettlementDeadLetterBySettlementId(settlement.settlementId);
    const timestamp = nowIso();
    const entry = SettlementDeadLetterEntrySchema.parse({
      dlqEntryId: existing?.dlqEntryId ?? buildDlqEntryId(),
      settlementId: settlement.settlementId,
      retryJobId: retryJob?.retryJobId ?? existing?.retryJobId ?? null,
      traceId: settlement.intentId,
      status: "open",
      reason,
      lastError,
      payload: {
        settlement,
        retryJob,
      },
      resolutionNote: existing?.resolutionNote ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
    });
    await this.repository.upsertSettlementDeadLetter(entry);

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: settlement.intentId,
        entityType: "settlement",
        entityId: entry.dlqEntryId,
        action: "create_dead_letter_entry",
        status: "failure",
        actorType: "system",
        details: {
          settlementId: settlement.settlementId,
          retryJobId: retryJob?.retryJobId ?? null,
          reason,
        },
      }),
    );

    return entry;
  }

  private async tryCreateSettlement(receipt: EventReceipt) {
    const existing = await this.repository.findSettlement(receipt.intentId, receipt.offerId, receipt.eventType);
    if (existing) {
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: receipt.intentId,
          entityType: "settlement",
          entityId: existing.settlementId,
          action: "create_settlement",
          status: "deduplicated",
          actorType: "system",
          details: {
            source: "repository",
          },
        }),
      );
      return existing;
    }

    const campaign = await this.repository.getCampaign(receipt.campaignId);
    if (!campaign) {
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: receipt.intentId,
          entityType: "settlement",
          entityId: receipt.receiptId,
          action: "create_settlement",
          status: "failure",
          actorType: "system",
          details: {
            reason: "campaign_not_found",
            campaignId: receipt.campaignId,
          },
        }),
      );
      return null;
    }

    const shouldBill =
      (campaign.billingModel === "CPQR" && receipt.eventType === "shortlisted") ||
      (campaign.billingModel === "CPA" && receipt.eventType === "conversion");

    if (!shouldBill) {
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: receipt.intentId,
          entityType: "settlement",
          entityId: receipt.receiptId,
          action: "skip_settlement",
          status: "success",
          actorType: "system",
          details: {
            billingModel: campaign.billingModel,
            eventType: receipt.eventType,
          },
        }),
      );
      return null;
    }

    const timestamp = nowIso();
    const settlement = SettlementReceiptSchema.parse({
      settlementId: `set_${crypto.randomUUID().slice(0, 8)}`,
      campaignId: receipt.campaignId,
      offerId: receipt.offerId,
      partnerId: receipt.partnerId,
      intentId: receipt.intentId,
      billingModel: campaign.billingModel,
      eventType: receipt.eventType,
      amount: campaign.payoutAmount,
      currency: campaign.currency,
      attributionWindow: campaign.billingModel === "CPA" ? "30d" : "session",
      status: transitionSettlementStatus(
        {
          settlementId: "placeholder",
          campaignId: receipt.campaignId,
          offerId: receipt.offerId,
          partnerId: receipt.partnerId,
          intentId: receipt.intentId,
          billingModel: campaign.billingModel,
          eventType: receipt.eventType,
          amount: campaign.payoutAmount,
          currency: campaign.currency,
          attributionWindow: campaign.billingModel === "CPA" ? "30d" : "session",
          status: "pending",
          disputeFlag: false,
          providerSettlementId: null,
          providerReference: null,
          providerState: null,
          providerResponseCode: null,
          lastError: null,
          generatedAt: timestamp,
          updatedAt: timestamp,
        },
        "queue",
      ),
      disputeFlag: false,
      providerSettlementId: null,
      providerReference: null,
      providerState: null,
      providerResponseCode: null,
      lastError: null,
      generatedAt: timestamp,
      updatedAt: timestamp,
    });

    await this.repository.insertSettlement(settlement);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: receipt.intentId,
        entityType: "settlement",
        entityId: settlement.settlementId,
        action: "create_settlement",
        status: "success",
        actorType: "system",
        details: {
          campaignId: receipt.campaignId,
          offerId: receipt.offerId,
          amount: settlement.amount,
          billingModel: settlement.billingModel,
        },
      }),
    );

    const retryJob = SettlementRetryJobSchema.parse({
      retryJobId: buildRetryJobId(),
      settlementId: settlement.settlementId,
      traceId: receipt.intentId,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: timestamp,
      lastError: null,
      lastAttemptAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.repository.upsertSettlementRetryJob(retryJob);
    await this.recordAuditEvent(
      createAuditEvent({
        traceId: receipt.intentId,
        entityType: "settlement",
        entityId: retryJob.retryJobId,
        action: "queue_settlement_retry_job",
        status: "success",
        actorType: "system",
        details: {
          settlementId: settlement.settlementId,
          nextRunAt: retryJob.nextRunAt,
          maxAttempts: retryJob.maxAttempts,
        },
      }),
    );

    return settlement;
  }

  private async recordAuditEvent(event: AuditEvent) {
    await this.repository.insertAuditEvent(event);
  }
}

export const createStore = (options: CreateStoreOptions = {}) =>
  new PromotionAgentStore(
    options.repository ?? new InMemoryPromotionAgentRepository(buildSeedData()),
    options.hotState ?? new InMemoryHotStateStore(),
    options.settlementGateway ?? new SimulatedSettlementGateway(),
  );

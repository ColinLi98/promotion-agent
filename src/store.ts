import crypto from "node:crypto";

import { createAuditEvent } from "./audit.js";
import {
  type BuyerAgentDeliveryGateway,
  SimulatedBuyerAgentDeliveryGateway,
} from "./buyer-agent-delivery.js";
import { compileOfferCard } from "./compiler.js";
import {
  AgentLeadSchema,
  AppealCaseInputSchema,
  AppealCaseSchema,
  AuditEventPageSchema,
  AuditEventSchema,
  CampaignDraftInputSchema,
  CampaignSchema,
  DeliveryMetricsSchema,
  DashboardSnapshotSchema,
  DiscoveryRunSchema,
  DiscoverySourceInputSchema,
  DiscoverySourceSchema,
  EvidenceAssetInputSchema,
  EvidenceAssetSchema,
  EventReceiptSchema,
  MeasurementFunnelQuerySchema,
  OnboardingTaskInputSchema,
  OnboardingTaskSchema,
  OutreachTargetInputSchema,
  OutreachTargetSchema,
  PartnerAgentSchema,
  PartnerReadinessSchema,
  PolicyCheckResultSchema,
  PromotionRunSchema,
  PromotionRunTargetSchema,
  RecruitmentPipelineSchema,
  RecruitmentPipelineUpdateSchema,
  ReputationRecordSchema,
  RiskCaseInputSchema,
  RiskCaseSchema,
  SettlementDeadLetterEntrySchema,
  SettlementDeadLetterPageSchema,
  SettlementReceiptSchema,
  SettlementRetryJobSchema,
  type AgentLead,
  type AppMode,
  type AppealCase,
  type AppealCaseInput,
  type AuditEvent,
  type AuditEventFilter,
  type AttributionRow,
  type BuyerAgentScorecard,
  type Campaign,
  type CampaignDraftInput,
  type CreditLedgerEntry,
  type DataProvenance,
  type DeliveryMetrics,
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
  type OnboardingTask,
  type OnboardingTaskInput,
  type OpportunityRequest,
  type OutreachTarget,
  type OutreachTargetInput,
  type PartnerAgent,
  type PartnerReadiness,
  type PolicyCheckResult,
  type PromotionPlan,
  type PromotionRun,
  type PromotionRunTarget,
  type RecruitmentPipeline,
  type RecruitmentPipelineUpdate,
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
  type WorkspaceSubscription,
  type WorkspaceWallet,
  VerificationRecordSchema,
  WorkspaceWalletSchema,
} from "./domain.js";
import {
  createCreditLedgerEntry,
  CREDIT_CHARGES,
  defaultWorkspaceSubscription,
  defaultWorkspaceWallet,
  DEFAULT_WORKSPACE_BY_MODE,
  PROMOTION_PLANS,
  scoreBuyerAgent,
} from "./commercialization.js";
import { crawlDiscoverySource } from "./discovery.js";
import {
  isConvertedEvent,
  isInteractedEvent,
  isPresentedEvent,
  isShortlistedEvent,
  isViewedEvent,
  normalizeEventReceipt,
} from "./event-contract.js";
import { InMemoryHotStateStore, type HotStateStore } from "./hot-state.js";
import { buildAttributionRows, buildBillingDrafts, buildMeasurementFunnel } from "./measurement.js";
import {
  type OutreachSenderGateway,
  SimulatedOutreachSenderGateway,
} from "./outreach-sender.js";
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
const buildPromotionRunTargetId = (promotionRunId: string, partnerId: string) =>
  `prt_${crypto.createHash("sha1").update(`${promotionRunId}:${partnerId}`).digest("hex").slice(0, 10)}`;
const buildRecruitmentPipelineId = (leadId: string) => `pipe_${leadId}`;
const buildPartnerReadinessId = (pipelineId: string) => `ready_${pipelineId}`;
const buildOnboardingTaskId = (pipelineId: string, taskType: OnboardingTask["taskType"], relatedTargetId = "default") =>
  `task_${crypto.createHash("sha1").update(`${pipelineId}:${taskType}:${relatedTargetId}`).digest("hex").slice(0, 10)}`;
const deliveryCooldownKey = (partnerId: string) => `delivery:cooldown:${partnerId}`;
const hashRequest = (value: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const HOT_STATE_TTL = {
  opportunityCacheSeconds: 12,
  receiptResultSeconds: 15 * 60,
  receiptLockMs: 8_000,
  retryLeaseMs: 10_000,
  deliveryCooldownSeconds: 30,
} as const;

const RECEIPT_RESULT_POLL_ATTEMPTS = 10;
const RECEIPT_RESULT_POLL_DELAY_MS = 120;

const PROVENANCE_VALUES: DataProvenance[] = [
  "demo_seed",
  "demo_bootstrap",
  "real_discovery",
  "real_partner",
  "real_campaign",
  "real_event",
  "sandbox_settlement",
  "ops_manual",
];

const DEFAULT_ONBOARDING_TASK_TYPES: OnboardingTask["taskType"][] = [
  "identity_verification",
  "auth_setup",
  "disclosure_review",
  "delivery_receipt_test",
  "presentation_receipt_test",
  "sla_review",
  "commercial_terms",
];
const PLACEHOLDER_CONTACT_PATTERN = /example\.com|your_sender@example\.com|@mcp\.so\b|@glama\.ai\b/i;

const summarizePromotionRunTargets = (targets: PromotionRunTarget[]) => ({
  acceptedBuyerAgentsCount: targets.filter((item) => item.status === "accepted").length,
  failedBuyerAgentsCount: targets.filter((item) => item.status === "failed").length,
});

const zeroProvenanceCounts = () =>
  Object.fromEntries(PROVENANCE_VALUES.map((value) => [value, 0])) as Record<DataProvenance, number>;

const parseProvenanceFilterValue = (value?: string) => {
  if (!value) return null;
  const requested = new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean) as DataProvenance[],
  );
  return requested.size > 0 ? requested : null;
};

const matchesProvenanceFilter = (value: DataProvenance, filter?: string) => {
  const requested = parseProvenanceFilterValue(filter);
  return requested ? requested.has(value) : true;
};

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
  private readonly buyerAgentScorecards: BuyerAgentScorecard[];
  private readonly workspaceWallets: WorkspaceWallet[];
  private readonly creditLedgerEntries: CreditLedgerEntry[];
  private readonly workspaceSubscriptions: WorkspaceSubscription[];
  private readonly promotionRuns: PromotionRun[];
  private readonly promotionRunTargets: PromotionRunTarget[];
  private readonly recruitmentPipelines: RecruitmentPipeline[];
  private readonly outreachTargets: OutreachTarget[];
  private readonly onboardingTasks: OnboardingTask[];
  private readonly partnerReadiness: PartnerReadiness[];

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
    this.buyerAgentScorecards = [];
    this.workspaceWallets = [];
    this.creditLedgerEntries = [];
    this.workspaceSubscriptions = [];
    this.promotionRuns = [];
    this.promotionRunTargets = [];
    this.recruitmentPipelines = [];
    this.outreachTargets = [];
    this.onboardingTasks = [];
    this.partnerReadiness = [];
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
    evidenceRef?: string | null,
  ) {
    const lead = this.leads.find((item) => item.agentId === leadId);
    if (!lead) return null;
    const previousStatus = lead.verificationStatus;
    const occurredAt = nowIso();
    const recordId = `verif_${crypto.randomUUID().slice(0, 8)}`;
    lead.verificationStatus = nextStatus;
    lead.lastSeenAt = occurredAt;
    lead.lastVerifiedAt = occurredAt;
    lead.verificationOwner = actorId;
    lead.evidenceRef = evidenceRef?.trim() ? evidenceRef.trim() : lead.evidenceRef ?? `verification:${recordId}`;
    this.verificationRecords.unshift(
      VerificationRecordSchema.parse({
        recordId,
        leadId,
        previousStatus,
        nextStatus,
        checklist,
        actorId,
        comment,
        occurredAt,
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

  async upsertPartner(partner: PartnerAgent) {
    const parsed = PartnerAgentSchema.parse(partner);
    const index = this.partners.findIndex((item) => item.partnerId === parsed.partnerId);
    if (index >= 0) {
      this.partners[index] = clone(parsed);
      return;
    }
    this.partners.push(clone(parsed));
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

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; provenance: string; }> = {}) {
    return clone(
      this.riskCases.filter((item) => {
        if (filter.status && item.status !== filter.status) return false;
        if (filter.severity && item.severity !== filter.severity) return false;
        if (filter.entityType && item.entityType !== filter.entityType) return false;
        if (filter.ownerId && item.ownerId !== filter.ownerId) return false;
        if (filter.dateFrom && new Date(item.openedAt).getTime() < new Date(filter.dateFrom).getTime()) return false;
        if (filter.dateTo && new Date(item.openedAt).getTime() > new Date(filter.dateTo).getTime()) return false;
        if (filter.provenance && !matchesProvenanceFilter(item.dataProvenance, filter.provenance)) return false;
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

  async listBuyerAgentScorecards() {
    return clone(this.buyerAgentScorecards);
  }

  async replaceBuyerAgentScorecards(scorecards: BuyerAgentScorecard[]) {
    this.buyerAgentScorecards.splice(0, this.buyerAgentScorecards.length, ...clone(scorecards));
  }

  async getWorkspaceWallet(workspaceId: string) {
    const wallet = this.workspaceWallets.find((item) => item.workspaceId === workspaceId);
    return wallet ? clone(wallet) : null;
  }

  async upsertWorkspaceWallet(wallet: WorkspaceWallet) {
    const index = this.workspaceWallets.findIndex((item) => item.workspaceId === wallet.workspaceId);
    if (index >= 0) {
      this.workspaceWallets[index] = clone(wallet);
      return;
    }
    this.workspaceWallets.push(clone(wallet));
  }

  async listCreditLedgerEntries(workspaceId: string) {
    return clone(this.creditLedgerEntries.filter((item) => item.workspaceId === workspaceId));
  }

  async insertCreditLedgerEntry(entry: CreditLedgerEntry) {
    this.creditLedgerEntries.unshift(clone(entry));
  }

  async getWorkspaceSubscription(workspaceId: string) {
    const subscription = this.workspaceSubscriptions.find((item) => item.workspaceId === workspaceId);
    return subscription ? clone(subscription) : null;
  }

  async upsertWorkspaceSubscription(subscription: WorkspaceSubscription) {
    const index = this.workspaceSubscriptions.findIndex((item) => item.workspaceId === subscription.workspaceId);
    if (index >= 0) {
      this.workspaceSubscriptions[index] = clone(subscription);
      return;
    }
    this.workspaceSubscriptions.push(clone(subscription));
  }

  async listPromotionPlans() {
    return clone(PROMOTION_PLANS);
  }

  async listPromotionRuns(workspaceId?: string) {
    return clone(this.promotionRuns.filter((item) => !workspaceId || item.workspaceId === workspaceId));
  }

  async getPromotionRun(promotionRunId: string) {
    const run = this.promotionRuns.find((item) => item.promotionRunId === promotionRunId);
    return run ? clone(run) : null;
  }

  async upsertPromotionRun(run: PromotionRun) {
    const index = this.promotionRuns.findIndex((item) => item.promotionRunId === run.promotionRunId);
    if (index >= 0) {
      this.promotionRuns[index] = clone(run);
      return;
    }
    this.promotionRuns.unshift(clone(run));
  }

  async listPromotionRunTargets(promotionRunId: string) {
    return clone(this.promotionRunTargets.filter((item) => item.promotionRunId === promotionRunId));
  }

  async upsertPromotionRunTarget(target: PromotionRunTarget) {
    const parsed = PromotionRunTargetSchema.parse(target);
    const index = this.promotionRunTargets.findIndex((item) => item.targetId === parsed.targetId);
    if (index >= 0) {
      this.promotionRunTargets[index] = clone(parsed);
      return;
    }
    this.promotionRunTargets.unshift(clone(parsed));
  }

  async listRecruitmentPipelines() {
    return clone(this.recruitmentPipelines);
  }

  async getRecruitmentPipeline(pipelineId: string) {
    const pipeline = this.recruitmentPipelines.find((item) => item.pipelineId === pipelineId);
    return pipeline ? clone(pipeline) : null;
  }

  async upsertRecruitmentPipeline(pipeline: RecruitmentPipeline) {
    const parsed = RecruitmentPipelineSchema.parse(pipeline);
    const index = this.recruitmentPipelines.findIndex((item) => item.pipelineId === parsed.pipelineId);
    if (index >= 0) {
      this.recruitmentPipelines[index] = clone(parsed);
      return;
    }
    this.recruitmentPipelines.unshift(clone(parsed));
  }

  async listOutreachTargets(pipelineId: string) {
    return clone(this.outreachTargets.filter((item) => item.pipelineId === pipelineId));
  }

  async getOutreachTarget(targetId: string) {
    const target = this.outreachTargets.find((item) => item.targetId === targetId);
    return target ? clone(target) : null;
  }

  async upsertOutreachTarget(target: OutreachTarget) {
    const parsed = OutreachTargetSchema.parse(target);
    const index = this.outreachTargets.findIndex((item) => item.targetId === parsed.targetId);
    if (index >= 0) {
      this.outreachTargets[index] = clone(parsed);
      return;
    }
    this.outreachTargets.unshift(clone(parsed));
  }

  async listOnboardingTasks(pipelineId: string) {
    return clone(this.onboardingTasks.filter((item) => item.pipelineId === pipelineId));
  }

  async getOnboardingTask(taskId: string) {
    const task = this.onboardingTasks.find((item) => item.taskId === taskId);
    return task ? clone(task) : null;
  }

  async upsertOnboardingTask(task: OnboardingTask) {
    const parsed = OnboardingTaskSchema.parse(task);
    const index = this.onboardingTasks.findIndex((item) => item.taskId === parsed.taskId);
    if (index >= 0) {
      this.onboardingTasks[index] = clone(parsed);
      return;
    }
    this.onboardingTasks.unshift(clone(parsed));
  }

  async getPartnerReadiness(pipelineId: string) {
    const readiness = this.partnerReadiness.find((item) => item.pipelineId === pipelineId);
    return readiness ? clone(readiness) : null;
  }

  async upsertPartnerReadiness(readiness: PartnerReadiness) {
    const parsed = PartnerReadinessSchema.parse(readiness);
    const index = this.partnerReadiness.findIndex((item) => item.pipelineId === parsed.pipelineId);
    if (index >= 0) {
      this.partnerReadiness[index] = clone(parsed);
      return;
    }
    this.partnerReadiness.unshift(clone(parsed));
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
      if (filter.provenance && !matchesProvenanceFilter(event.dataProvenance, filter.provenance)) {
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
  deliveryGateway: BuyerAgentDeliveryGateway;
  outreachSenderGateway: OutreachSenderGateway;
  seedData: SeedData;
  appMode: AppMode;
}>;

export class PromotionAgentStore {
  constructor(
    private readonly repository: PromotionAgentRepository,
    private readonly hotState: HotStateStore,
    private readonly settlementGateway: SettlementGateway = new SimulatedSettlementGateway(),
    private readonly deliveryGateway: BuyerAgentDeliveryGateway = new SimulatedBuyerAgentDeliveryGateway(),
    private readonly outreachSenderGateway: OutreachSenderGateway = new SimulatedOutreachSenderGateway(),
    private readonly appMode: AppMode = "default",
  ) {}

  getAppMode() {
    return this.appMode;
  }

  getDefaultLeadFilter(): DataProvenance[] {
    if (this.appMode === "demo") {
      return ["demo_seed", "demo_bootstrap"];
    }
    if (this.appMode === "real_test") {
      return ["real_discovery", "real_partner", "ops_manual"];
    }
    return ["real_discovery"];
  }

  private derivePipelineStage(lead: AgentLead, partner: PartnerAgent | null, tasks: OnboardingTask[] = []): RecruitmentPipeline["stage"] {
    if (partner?.status === "active" || partner?.status === "verified") return "promoted";
    if (partner?.status === "reviewing" || partner?.status === "new") return "onboarding";
    if (partner?.status === "suspended") return "blocked";
    if (lead.verificationStatus === "active" || lead.verificationStatus === "verified") {
      const allDone = tasks.length > 0 && tasks.every((task) => task.status === "done");
      return allDone ? "ready" : "verified";
    }
    if (tasks.some((task) => task.status === "in_progress" || task.status === "blocked")) {
      return "onboarding";
    }
    if (lead.assignedOwner) return "qualified";
    return "sourced";
  }

  private derivePipelinePriority(lead: AgentLead): RecruitmentPipeline["priority"] {
    if (lead.leadScore >= 0.85) return "high";
    if (lead.leadScore >= 0.7) return "medium";
    return "low";
  }

  private deriveTargetPersona(lead: AgentLead): string | null {
    if (lead.verticals.includes("saas_procurement")) return "procurement";
    if (lead.verticals.includes("revops") || lead.verticals.includes("sales_ops")) return "operator";
    if (lead.verticals.includes("workflow_automation")) return "tenant_admin";
    return null;
  }

  private buildOutreachMessage(lead: AgentLead, persona: string | null) {
    const greeting = lead.contactRef ? `Hi ${lead.contactRef},` : `Hi ${lead.providerOrg} team,`;
    const personaCopy =
      persona === "procurement"
        ? "We think your buyer agent is a strong fit for enterprise software procurement and shortlist workflows."
        : persona === "operator"
          ? "We think your buyer agent is a strong fit for operator-facing workflow discovery and governed execution scenarios."
          : "We think your buyer agent is a strong fit for tenant-admin and workspace-governance evaluation workflows.";
    return [
      greeting,
      "",
      personaCopy,
      "Promotion Agent can onboard your agent into a sponsored, disclosed, receipt-backed recommendation network for enterprise software evaluation.",
      "If this is relevant, the next step is to confirm endpoint, auth, disclosure, delivery receipt, and presentation receipt support.",
      "",
      "Best,",
      lead.assignedOwner ?? "ops:partnerships",
    ].join("\n");
  }

  private personaLabel(persona: string | null) {
    if (persona === "procurement") return "procurement";
    if (persona === "operator") return "operator";
    if (persona === "tenant_admin") return "tenant admin";
    return "enterprise";
  }

  private async findBestOutreachCampaignForLead(lead: AgentLead, persona: string | null) {
    const campaigns = (await this.repository.listCampaigns()).filter((campaign) => campaign.status === "active");
    const leadSignals = new Set([
      ...(lead.verticals ?? []),
      ...(lead.skills ?? []),
      ...((lead.buyerIntentCoverage ?? []) as string[]),
    ]);
    const scored = campaigns.map((campaign) => {
      const personaFit = campaign.offer.constraints.persona === persona ? 1 : 0;
      const categoryFit = lead.verticals.includes(campaign.category) ? 1 : 0;
      const intentFit = campaign.offer.intendedFor.some((intent) => leadSignals.has(intent)) ? 1 : 0;
      const geoFit = campaign.regions.some((region) => lead.geo.includes(region)) ? 1 : 0;
      const score = personaFit * 3 + categoryFit * 2 + intentFit * 2 + geoFit;
      return { campaign, score };
    });
    return scored
      .sort((left, right) => right.score - left.score || right.campaign.payoutAmount - left.campaign.payoutAmount)
      .find((item) => item.score > 0)?.campaign ?? null;
  }

  private buildOutreachSubject(lead: AgentLead, campaign: Campaign | null, persona: string | null) {
    if (!campaign) {
      return `Partnership fit for ${lead.providerOrg}`;
    }
    return `${campaign.advertiser} x ${lead.providerOrg}: ${this.personaLabel(persona)} buyer-agent partnership`;
  }

  private buildRecommendationReason(lead: AgentLead, campaign: Campaign | null, persona: string | null) {
    if (!campaign) {
      return `${lead.providerOrg} matches our enterprise buyer-agent profile based on category, auth readiness, and governance fit.`;
    }
    const reasonBits = [
      `${lead.providerOrg} covers ${lead.verticals.join(", ")}`,
      `campaign category is ${campaign.category}`,
      campaign.offer.constraints.persona ? `persona fit is ${campaign.offer.constraints.persona}` : null,
      `trust seed ${lead.trustSeed.toFixed(2)}`,
    ].filter((item): item is string => Boolean(item));
    return `Recommend ${campaign.advertiser} to this ${this.personaLabel(persona)} buyer agent because ${reasonBits.join("; ")}.`;
  }

  private buildProofHighlights(campaign: Campaign | null) {
    if (!campaign) return [];
    return campaign.proofBundle.references.slice(0, 3).map((reference) => reference.label);
  }

  private buildCampaignAwareOutreachMessage(lead: AgentLead, campaign: Campaign | null, persona: string | null) {
    if (!campaign) {
      return this.buildOutreachMessage(lead, persona);
    }
    const proofHighlights = this.buildProofHighlights(campaign);
    const contactRef =
      campaign.proofBundle.references.find((reference) => reference.url.startsWith("mailto:"))?.url.replace("mailto:", "") ??
      lead.contactRef ??
      "contact not provided";
    return [
      `Hi ${lead.providerOrg} team,`,
      "",
      `We think your buyer agent is a high-fit match for the ${this.personaLabel(persona)} campaign "${campaign.offer.title}" from ${campaign.advertiser}.`,
      this.buildRecommendationReason(lead, campaign, persona),
      "",
      `Why this campaign is relevant:`,
      `- ${campaign.offer.description}`,
      ...campaign.offer.claims.slice(0, 3).map((claim) => `- ${claim}`),
      "",
      proofHighlights.length ? `Proof highlights: ${proofHighlights.join(" | ")}` : "Proof highlights available on request.",
      `Commercial contact: ${contactRef}`,
      "",
      `If this is a fit, the next step is to validate endpoint, auth, disclosure, delivery receipt, and presentation receipt support for live onboarding.`,
      "",
      "Best,",
      lead.assignedOwner ?? "ops:partnerships",
    ].join("\n");
  }

  private buildSecondTouchMessage(
    lead: AgentLead,
    campaign: Campaign | null,
    persona: string | null,
    originalTarget: OutreachTarget,
  ) {
    const proofHighlights = originalTarget.proofHighlights.length > 0
      ? originalTarget.proofHighlights
      : this.buildProofHighlights(campaign);
    const openerCopy =
      originalTarget.openSignal === "engaged"
        ? "It looks like your team opened the first note multiple times, so I wanted to send a tighter follow-up with the most relevant proof."
        : originalTarget.openSignal === "opened"
          ? "It looks like the first note was opened, so I wanted to follow up with the clearest proof points for your current evaluation."
          : "I am following up on the first note in case the timing was off and this enterprise workflow-governance fit is still relevant.";
    return [
      `Hi ${lead.providerOrg} team,`,
      "",
      openerCopy,
      this.buildRecommendationReason(lead, campaign, persona),
      "",
      `Key proof points for this second touch:`,
      ...(proofHighlights.length > 0 ? proofHighlights.map((item) => `- ${item}`) : ["- Proof pack available on request"]),
      "",
      `If useful, I can route the next step into endpoint/auth/disclosure/receipt validation for live onboarding.`,
      "",
      "Best,",
      lead.assignedOwner ?? "ops:partnerships",
    ].join("\n");
  }

  private async upsertSystemPipelineTask(
    pipelineId: string,
    leadId: string,
    taskType: OnboardingTask["taskType"],
    relatedTargetId: string,
    input: {
      ownerId?: string | null;
      dueAt?: string | null;
      evidenceRef?: string | null;
      notes?: string | null;
      status?: OnboardingTask["status"];
      completedAt?: string | null;
    },
  ) {
    const task = OnboardingTaskSchema.parse({
      taskId: buildOnboardingTaskId(pipelineId, taskType, relatedTargetId),
      pipelineId,
      leadId,
      taskType,
      status: input.status ?? "todo",
      ownerId: input.ownerId ?? null,
      dueAt: input.dueAt ?? null,
      relatedTargetId,
      autoGenerated: true,
      evidenceRef: input.evidenceRef ?? null,
      notes: input.notes ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.repository.upsertOnboardingTask(task);
    return task;
  }

  private deriveNextStep(
    lead: AgentLead,
    pipeline: RecruitmentPipeline | null,
    outreachTargets: OutreachTarget[],
    tasks: OnboardingTask[],
    readiness: PartnerReadiness,
    partner: PartnerAgent | null,
    campaign: Campaign | null,
  ) {
    if (partner?.status === "active" || partner?.status === "verified") {
      return "Monitor partner performance and route matching campaigns.";
    }
    if (readiness.overallStatus === "ready") {
      return "Auto-promote this lead into partner onboarding completion.";
    }
    const replied = outreachTargets.some((target) => target.status === "replied");
    if (replied) {
      const openTask = tasks.find((task) => task.status !== "done");
      return openTask ? `Complete onboarding task: ${openTask.taskType}.` : "Review onboarding readiness.";
    }
    const sent = outreachTargets.some((target) => target.status === "sent");
    if (sent) {
      return "Follow up on outreach response and move into onboarding if the buyer agent replies.";
    }
    const draft = outreachTargets.find((target) => target.status === "draft" || target.status === "queued");
    if (draft) {
      return `Review and send the generated ${draft.channel} outreach draft for ${campaign?.advertiser ?? "the matched campaign"}.`;
    }
    if (!lead.assignedOwner) {
      return "Assign an owner and confirm ICP fit before outreach.";
    }
    return pipeline?.nextStep ?? "Generate and send first outreach draft.";
  }

  private buildPartnerFromLead(
    lead: AgentLead,
    overrides: Partial<Pick<PartnerAgent, "partnerId" | "dataProvenance" | "status" | "supportedCategories" | "slaTier" | "acceptsSponsored" | "supportsDisclosure" | "supportsDeliveryReceipt" | "supportsPresentationReceipt" | "authModes">> = {},
  ) {
    const normalizedId = lead.providerOrg
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    return PartnerAgentSchema.parse({
      partnerId: overrides.partnerId ?? `partner_${normalizedId}`,
      agentLeadId: lead.agentId,
      dataProvenance:
        overrides.dataProvenance ??
        (this.appMode === "real_test" ? "real_partner" : this.defaultMutationProvenance("risk")),
      providerOrg: lead.providerOrg,
      endpoint: lead.endpointUrl,
      status: overrides.status ?? (lead.verificationStatus === "active" ? "active" : "verified"),
      supportedCategories: overrides.supportedCategories ?? lead.verticals.slice(0, 3),
      acceptsSponsored: overrides.acceptsSponsored ?? lead.acceptsSponsored,
      supportsDisclosure: overrides.supportsDisclosure ?? lead.supportsDisclosure,
      supportsDeliveryReceipt: overrides.supportsDeliveryReceipt ?? lead.supportsDeliveryReceipt,
      supportsPresentationReceipt: overrides.supportsPresentationReceipt ?? lead.supportsPresentationReceipt,
      lastVerifiedAt: lead.lastVerifiedAt,
      verificationOwner: lead.verificationOwner,
      evidenceRef: lead.evidenceRef,
      trustScore: lead.trustSeed,
      authModes: overrides.authModes ?? lead.authModes,
      slaTier: overrides.slaTier ?? "sandbox",
    });
  }

  private async promoteLeadToPartnerInternal(
    lead: AgentLead,
    overrides: Partial<Pick<PartnerAgent, "partnerId" | "dataProvenance" | "status" | "supportedCategories" | "slaTier" | "acceptsSponsored" | "supportsDisclosure" | "supportsDeliveryReceipt" | "supportsPresentationReceipt" | "authModes">> = {},
    actorId?: string,
    syncPipeline = true,
  ) {
    if (!lead.endpointUrl) {
      throw new Error("Lead cannot be promoted without an endpointUrl.");
    }
    if (!["verified", "active"].includes(lead.verificationStatus)) {
      throw new Error("Lead must be verified or active before partner promotion.");
    }
    if (!lead.supportsDeliveryReceipt || !lead.supportsPresentationReceipt) {
      throw new Error("Lead must support delivery receipt and presentation receipt before partner promotion.");
    }

    const partner = this.buildPartnerFromLead(lead, overrides);
    await this.repository.upsertPartner(partner);
    if (syncPipeline) {
      await this.ensurePipelineArtifactsForLead(lead);
    }
    await this.recordAuditEvent(
      createAuditEvent({
        dataProvenance: partner.dataProvenance,
        traceId: lead.agentId,
        entityType: "campaign",
        entityId: partner.partnerId,
        action: syncPipeline ? "promote_lead_to_partner" : "auto_promote_lead_to_partner",
        status: "success",
        actorType: syncPipeline ? "operator" : "system",
        actorId: actorId ?? lead.assignedOwner ?? "ops:system",
        details: {
          leadId: lead.agentId,
          providerOrg: lead.providerOrg,
          currentMode: this.appMode,
        },
      }),
    );
    return partner;
  }

  private derivePartnerReadiness(lead: AgentLead, pipelineId: string, tasks: OnboardingTask[], partner: PartnerAgent | null): PartnerReadiness {
    const taskStatus = (taskType: OnboardingTask["taskType"]) =>
      tasks.find((task) => task.taskType === taskType)?.status === "done";
    const checklist = {
      identity: taskStatus("identity_verification") || ["verified", "active"].includes(lead.verificationStatus),
      auth: taskStatus("auth_setup") || lead.authModes.length > 0,
      disclosure: taskStatus("disclosure_review") || lead.supportsDisclosure,
      deliveryReceipt: taskStatus("delivery_receipt_test") || lead.supportsDeliveryReceipt,
      presentationReceipt: taskStatus("presentation_receipt_test") || lead.supportsPresentationReceipt,
      sla: taskStatus("sla_review") || lead.verificationStatus === "active" || Boolean(partner),
      commercialTerms: taskStatus("commercial_terms") || lead.acceptsSponsored,
    };
    const values = Object.values(checklist);
    const readinessScore = values.filter(Boolean).length / values.length;
    const blockers = [
      !checklist.identity ? "identity_verification_pending" : null,
      !checklist.auth ? "auth_setup_pending" : null,
      !checklist.disclosure ? "disclosure_review_pending" : null,
      !checklist.deliveryReceipt ? "delivery_receipt_test_pending" : null,
      !checklist.presentationReceipt ? "presentation_receipt_test_pending" : null,
      !checklist.sla ? "sla_review_pending" : null,
      !checklist.commercialTerms ? "commercial_terms_pending" : null,
    ].filter((item): item is string => Boolean(item));

    const overallStatus: PartnerReadiness["overallStatus"] =
      partner?.status === "active" || partner?.status === "verified"
        ? "ready"
        : partner?.status === "reviewing" || partner?.status === "new"
          ? "onboarding"
          : partner?.status === "suspended"
            ? "blocked"
            : blockers.length === values.length
              ? "observation"
              : blockers.length > 0
                ? "onboarding"
                : "ready";

    return PartnerReadinessSchema.parse({
      readinessId: buildPartnerReadinessId(pipelineId),
      pipelineId,
      leadId: lead.agentId,
      overallStatus,
      readinessScore,
      checklist,
      blockers,
      lastEvaluatedAt: nowIso(),
    });
  }

  private async ensurePipelineArtifactsForLead(lead: AgentLead) {
    const pipelineId = buildRecruitmentPipelineId(lead.agentId);
    const [existingPipeline, existingPartner] = await Promise.all([
      this.repository.getRecruitmentPipeline(pipelineId),
      this.findPartnerByLeadId(lead.agentId),
    ]);
    let partner = existingPartner;
    if (!existingPipeline) {
      await this.repository.upsertRecruitmentPipeline(
        RecruitmentPipelineSchema.parse({
          pipelineId,
          leadId: lead.agentId,
          dataProvenance: lead.dataProvenance,
          providerOrg: lead.providerOrg,
          stage: "sourced",
          priority: this.derivePipelinePriority(lead),
          ownerId: lead.assignedOwner ?? null,
          targetPersona: this.deriveTargetPersona(lead),
          nextStep: "Initialize recruitment pipeline.",
          lastContactAt: null,
          lastActivityAt: nowIso(),
          createdAt: lead.discoveredAt,
          updatedAt: nowIso(),
        }),
      );
    }
    const existingTasks = await this.repository.listOnboardingTasks(pipelineId);
    const matchedCampaign = await this.findBestOutreachCampaignForLead(lead, existingPipeline?.targetPersona ?? this.deriveTargetPersona(lead));
    const existingOutreachTargets = await this.repository.listOutreachTargets(pipelineId);
    const hasEmailTarget = existingOutreachTargets.some((target) => target.channel === "email");
    const draftPlaceholderEmailTarget = existingOutreachTargets.find(
      (target) =>
        target.channel === "email" &&
        target.status === "draft" &&
        PLACEHOLDER_CONTACT_PATTERN.test(target.contactPoint),
    );

    for (const taskType of DEFAULT_ONBOARDING_TASK_TYPES) {
      if (existingTasks.some((task) => task.taskType === taskType)) continue;
      const doneByLead =
        (taskType === "identity_verification" && ["verified", "active"].includes(lead.verificationStatus)) ||
        (taskType === "auth_setup" && lead.authModes.length > 0) ||
        (taskType === "disclosure_review" && lead.supportsDisclosure) ||
        (taskType === "delivery_receipt_test" && lead.supportsDeliveryReceipt) ||
        (taskType === "presentation_receipt_test" && lead.supportsPresentationReceipt) ||
        (taskType === "sla_review" && lead.verificationStatus === "active") ||
        (taskType === "commercial_terms" && lead.acceptsSponsored);
      await this.repository.upsertOnboardingTask(
        OnboardingTaskSchema.parse({
          taskId: buildOnboardingTaskId(pipelineId, taskType),
          pipelineId,
          leadId: lead.agentId,
          taskType,
          status: doneByLead ? "done" : "todo",
          ownerId: lead.assignedOwner ?? null,
          dueAt: null,
          evidenceRef: lead.evidenceRef,
          notes: null,
          completedAt: doneByLead ? lead.lastVerifiedAt ?? nowIso() : null,
          createdAt: lead.discoveredAt,
          updatedAt: lead.lastSeenAt,
        }),
      );
    }

    const tasks = await this.repository.listOnboardingTasks(pipelineId);
    if (!partner && lead.contactRef && draftPlaceholderEmailTarget && !PLACEHOLDER_CONTACT_PATTERN.test(lead.contactRef)) {
      const persona = this.deriveTargetPersona(lead);
      draftPlaceholderEmailTarget.contactPoint = lead.contactRef;
      draftPlaceholderEmailTarget.subjectLine = this.buildOutreachSubject(lead, matchedCampaign, persona);
      draftPlaceholderEmailTarget.messageTemplate = this.buildCampaignAwareOutreachMessage(lead, matchedCampaign, persona);
      draftPlaceholderEmailTarget.recommendationReason = this.buildRecommendationReason(lead, matchedCampaign, persona);
      draftPlaceholderEmailTarget.proofHighlights = this.buildProofHighlights(matchedCampaign);
      draftPlaceholderEmailTarget.updatedAt = nowIso();
      await this.repository.upsertOutreachTarget(draftPlaceholderEmailTarget);
    } else if (!partner && ((lead.contactRef && !hasEmailTarget) || (!lead.contactRef && existingOutreachTargets.length === 0))) {
      const persona = this.deriveTargetPersona(lead);
      await this.repository.upsertOutreachTarget(
        OutreachTargetSchema.parse({
          targetId: `out_${crypto.randomUUID().slice(0, 8)}`,
          pipelineId,
          leadId: lead.agentId,
          providerOrg: lead.providerOrg,
          recommendedCampaignId: matchedCampaign?.campaignId ?? null,
          channel: lead.contactRef ? "email" : "form",
          contactPoint: lead.contactRef ?? lead.cardUrl,
          subjectLine: this.buildOutreachSubject(lead, matchedCampaign, persona),
          messageTemplate: this.buildCampaignAwareOutreachMessage(lead, matchedCampaign, persona),
          recommendationReason: this.buildRecommendationReason(lead, matchedCampaign, persona),
          proofHighlights: this.buildProofHighlights(matchedCampaign),
          autoGenerated: true,
          status: "draft",
          ownerId: lead.assignedOwner ?? null,
          sendAttempts: 0,
          lastAttemptAt: null,
          nextRetryAt: null,
          providerRequestId: null,
          responseCode: null,
          openCount: 0,
          firstOpenedAt: null,
          lastOpenedAt: null,
          openSignal: "none",
          lastOpenSource: null,
          lastError: null,
          lastSentAt: null,
          responseAt: null,
          notes: "Auto-generated outreach draft from recruitment pipeline.",
          createdAt: lead.discoveredAt,
          updatedAt: nowIso(),
        }),
      );
    }
    const outreachTargets = await this.repository.listOutreachTargets(pipelineId);
    const derivedStage = this.derivePipelineStage(lead, partner, tasks);
    const systemManagedStages: RecruitmentPipeline["stage"][] = [
      "sourced",
      "qualified",
      "verified",
      "ready",
      "promoted",
    ];
    const shouldOverwriteStage =
      !existingPipeline ||
      systemManagedStages.includes(existingPipeline.stage) ||
      partner?.status === "active" ||
      partner?.status === "verified";
    const pipeline = RecruitmentPipelineSchema.parse({
      pipelineId,
      leadId: lead.agentId,
      dataProvenance: lead.dataProvenance,
      providerOrg: lead.providerOrg,
      stage: shouldOverwriteStage ? derivedStage : existingPipeline.stage,
      priority: existingPipeline?.priority ?? this.derivePipelinePriority(lead),
      ownerId: lead.assignedOwner ?? existingPipeline?.ownerId ?? null,
      targetPersona: existingPipeline?.targetPersona ?? this.deriveTargetPersona(lead),
      nextStep: null,
      lastContactAt: existingPipeline?.lastContactAt ?? null,
      lastActivityAt: nowIso(),
      createdAt: existingPipeline?.createdAt ?? lead.discoveredAt,
      updatedAt: nowIso(),
    });
    const readiness = this.derivePartnerReadiness(lead, pipelineId, tasks, partner);
    pipeline.nextStep = this.deriveNextStep(lead, existingPipeline, outreachTargets, tasks, readiness, partner, matchedCampaign);
    await this.repository.upsertRecruitmentPipeline(pipeline);
    await this.repository.upsertPartnerReadiness(readiness);

    if (!partner && readiness.overallStatus === "ready") {
      partner = await this.promoteLeadToPartnerInternal(lead, {}, "pipeline.auto", false);
      pipeline.stage = "promoted";
      pipeline.nextStep = "Partner promoted automatically. Monitor live performance.";
      pipeline.updatedAt = nowIso();
      await this.repository.upsertRecruitmentPipeline(pipeline);
      await this.repository.upsertPartnerReadiness(
        this.derivePartnerReadiness(lead, pipelineId, tasks, partner),
      );
    }
    return pipeline;
  }

  private async ensureRecruitmentCoverage() {
    const leads = await this.repository.listLeads();
    for (const lead of leads) {
      await this.ensurePipelineArtifactsForLead(lead);
    }
  }

  async hasDemoData() {
    const [leads, partners, campaigns, evidenceAssets, riskCases, reputationRecords, appeals, settlements, receipts, auditEvents] =
      await Promise.all([
        this.repository.listLeads(),
        this.repository.listPartners(),
        this.repository.listCampaigns(),
        this.repository.listEvidenceAssets(),
        this.repository.listRiskCases(),
        this.repository.listReputationRecords(),
        this.repository.listAppeals(),
        this.repository.listSettlements(),
        this.repository.listEventReceipts(),
        this.repository.listAuditEvents({ page: 1, pageSize: 1000 }),
      ]);

    return [
      ...leads,
      ...partners,
      ...campaigns,
      ...evidenceAssets,
      ...riskCases,
      ...reputationRecords,
      ...appeals,
      ...settlements,
      ...receipts,
      ...auditEvents.items,
    ].some((item) => item.dataProvenance?.startsWith("demo_"));
  }

  private parseProvenanceFilter(value?: string) {
    return parseProvenanceFilterValue(value);
  }

  private matchesProvenance(value: DataProvenance, filter?: string) {
    return matchesProvenanceFilter(value, filter);
  }

  private defaultMutationProvenance(kind: "campaign" | "evidence" | "risk" | "appeal" | "receipt"): DataProvenance {
    if (this.appMode === "demo") {
      return "demo_bootstrap";
    }
    if (this.appMode === "real_test") {
      if (kind === "campaign") return "real_campaign";
      if (kind === "receipt") return "real_event";
      return "ops_manual";
    }
    return "ops_manual";
  }

  private async inferEntityProvenance(
    entityType: "campaign" | "partner" | "agent_lead" | "settlement" | "receipt",
    entityId: string,
  ): Promise<DataProvenance | null> {
    if (entityType === "campaign") {
      return (await this.repository.getCampaign(entityId))?.dataProvenance ?? null;
    }
    if (entityType === "partner") {
      return (await this.repository.listPartners()).find((item) => item.partnerId === entityId)?.dataProvenance ?? null;
    }
    if (entityType === "agent_lead") {
      return (await this.repository.getLead(entityId))?.dataProvenance ?? null;
    }
    if (entityType === "settlement") {
      return (await this.repository.getSettlement(entityId))?.dataProvenance ?? null;
    }
    if (entityType === "receipt") {
      return (await this.repository.getEventReceipt(entityId))?.dataProvenance ?? null;
    }
    return null;
  }

  private async findPartnerByLeadId(leadId: string) {
    return (await this.repository.listPartners()).find((partner) => partner.agentLeadId === leadId) ?? null;
  }

  private countByProvenance(records: Array<{ dataProvenance: DataProvenance }>) {
    const counts = zeroProvenanceCounts();
    for (const record of records) {
      counts[record.dataProvenance] += 1;
    }
    return counts;
  }

  private currentWorkspaceId() {
    return DEFAULT_WORKSPACE_BY_MODE[this.appMode];
  }

  private async ensureWorkspaceBillingState(workspaceId = this.currentWorkspaceId()) {
    let wallet = await this.repository.getWorkspaceWallet(workspaceId);
    let subscription = await this.repository.getWorkspaceSubscription(workspaceId);

    if (!wallet) {
      wallet = defaultWorkspaceWallet(workspaceId);
      await this.repository.upsertWorkspaceWallet(wallet);
      await this.repository.insertCreditLedgerEntry(
        createCreditLedgerEntry({
          workspaceId,
          entryType: "promo_grant",
          amount: CREDIT_CHARGES.promoGrant,
          balanceAfter: wallet.availableCredits,
          source: "workspace.bootstrap",
          campaignId: null,
          promotionRunId: null,
        }),
      );
    }

    if (!subscription) {
      subscription = defaultWorkspaceSubscription(workspaceId);
      await this.repository.upsertWorkspaceSubscription(subscription);
    }

    return {
      wallet,
      subscription,
    };
  }

  private async rebuildBuyerAgentScorecards() {
    const [leads, partners, receipts, settlements] = await Promise.all([
      this.repository.listLeads(),
      this.repository.listPartners(),
      this.repository.listEventReceipts(),
      this.repository.listSettlements(),
    ]);

    const partnerByLeadId = new Map(partners.map((partner) => [partner.agentLeadId, partner]));
    const scorecards = leads.map((lead) =>
      scoreBuyerAgent(lead, partnerByLeadId.get(lead.agentId) ?? null, receipts, settlements),
    );
    await this.repository.replaceBuyerAgentScorecards(scorecards);
    return scorecards;
  }

  private async consumeCredits(
    workspaceId: string,
    entryType: CreditLedgerEntry["entryType"],
    amount: number,
    source: string,
    campaignId: string | null,
    promotionRunId: string | null,
  ) {
    const { wallet } = await this.ensureWorkspaceBillingState(workspaceId);
    if (wallet.availableCredits < amount) {
      throw new Error(`Insufficient credits. Required ${amount}, available ${wallet.availableCredits}.`);
    }

    wallet.availableCredits = Number((wallet.availableCredits - amount).toFixed(2));
    wallet.consumedCredits = Number((wallet.consumedCredits + amount).toFixed(2));
    wallet.updatedAt = nowIso();
    await this.repository.upsertWorkspaceWallet(wallet);
    await this.repository.insertCreditLedgerEntry(
      createCreditLedgerEntry({
        workspaceId,
        entryType,
        amount: -amount,
        balanceAfter: wallet.availableCredits,
        source,
        campaignId,
        promotionRunId,
      }),
    );
    return wallet;
  }

  async listLeads() {
    return this.repository.listLeads();
  }

  async upsertLeadRecord(lead: AgentLead) {
    const parsed = AgentLeadSchema.parse(lead);
    await this.repository.upsertLead(parsed);
    await this.ensurePipelineArtifactsForLead(parsed);
    await this.recordAuditEvent(
      createAuditEvent({
        dataProvenance: parsed.dataProvenance,
        traceId: parsed.agentId,
        entityType: "campaign",
        entityId: parsed.agentId,
        action: "upsert_agent_lead",
        status: "success",
        actorType: "operator",
        actorId: parsed.assignedOwner ?? "ops:import",
        details: {
          providerOrg: parsed.providerOrg,
          sourceType: parsed.sourceType,
          verificationStatus: parsed.verificationStatus,
        },
      }),
    );
    return parsed;
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
          lastVerifiedAt: existing.lastVerifiedAt ?? lead.lastVerifiedAt,
          verificationOwner: existing.verificationOwner ?? lead.verificationOwner,
          evidenceRef: existing.evidenceRef ?? lead.evidenceRef,
          scoreBreakdown: {
            icpFit: Math.max(existing.scoreBreakdown.icpFit, lead.scoreBreakdown.icpFit),
            protocolFit: Math.max(existing.scoreBreakdown.protocolFit, lead.scoreBreakdown.protocolFit),
            reachFit: Math.max(existing.scoreBreakdown.reachFit, lead.scoreBreakdown.reachFit),
          },
        });
        await this.repository.upsertLead(merged);
        await this.ensurePipelineArtifactsForLead(merged);
        run.dedupedCount += 1;
        continue;
      }

      await this.repository.upsertLead(lead);
      await this.ensurePipelineArtifactsForLead(lead);
      run.createdLeadCount += 1;
      byDedupe.set(lead.dedupeKey, lead);
    }

    run.status = crawled.errors.length > 0 ? "completed" : "completed";
    run.finishedAt = nowIso();
    run.errorCount = crawled.errors.length;
    run.errors = crawled.errors;
    await this.repository.updateDiscoveryRun(run);
    await this.rebuildBuyerAgentScorecards();
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

  async listPartners(filter: Partial<{ provenance: string }> = {}) {
    const partners = await this.repository.listPartners();
    return partners.filter((partner) => this.matchesProvenance(partner.dataProvenance, filter.provenance));
  }

  async listCampaigns(filter: Partial<{ provenance: string }> = {}) {
    const campaigns = await this.repository.listCampaigns();
    return campaigns.filter((campaign) => this.matchesProvenance(campaign.dataProvenance, filter.provenance));
  }

  async listAgentLeads(filters: Partial<{ status: string; sourceType: string; dataOrigin: string; provenance: string; tier: string; isCommerciallyEligible: boolean; intentCoverage: string; vertical: string; geo: string; owner: string; hasMissingFields: boolean; }>) {
    const leads = await this.repository.listLeads();
    return leads.filter((lead) => {
      if (filters.status && lead.verificationStatus !== filters.status) return false;
      if (filters.sourceType && lead.sourceType !== filters.sourceType) return false;
      if (filters.dataOrigin && lead.dataOrigin !== filters.dataOrigin) return false;
      if (filters.provenance && !this.matchesProvenance(lead.dataProvenance, filters.provenance)) return false;
      if (filters.tier && lead.buyerAgentTier !== filters.tier) return false;
      if (typeof filters.isCommerciallyEligible === "boolean" && lead.isCommerciallyEligible !== filters.isCommerciallyEligible) return false;
      if (filters.intentCoverage && !lead.buyerIntentCoverage.includes(filters.intentCoverage)) return false;
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

  async listBuyerAgentScorecards(filter: Partial<{ tier: string; isCommerciallyEligible: boolean; intentCoverage: string; provenance: string; }> = {}) {
    const scorecards = await this.rebuildBuyerAgentScorecards();
    return scorecards.filter((card) => {
      if (filter.tier && card.buyerAgentTier !== filter.tier) return false;
      if (typeof filter.isCommerciallyEligible === "boolean" && card.isCommerciallyEligible !== filter.isCommerciallyEligible) return false;
      if (filter.intentCoverage && !card.buyerIntentCoverage.includes(filter.intentCoverage)) return false;
      if (filter.provenance && !this.matchesProvenance(card.dataProvenance, filter.provenance)) return false;
      return true;
    });
  }

  async listPromotionPlans() {
    return this.repository.listPromotionPlans();
  }

  async getWorkspaceWallet(workspaceId = this.currentWorkspaceId()) {
    const { wallet } = await this.ensureWorkspaceBillingState(workspaceId);
    return wallet;
  }

  async listCreditLedgerEntries(workspaceId = this.currentWorkspaceId()) {
    await this.ensureWorkspaceBillingState(workspaceId);
    return this.repository.listCreditLedgerEntries(workspaceId);
  }

  async topUpWorkspaceCredits(workspaceId = this.currentWorkspaceId(), amount: number, source = "wallet.top_up") {
    const { wallet } = await this.ensureWorkspaceBillingState(workspaceId);
    wallet.availableCredits = Number((wallet.availableCredits + amount).toFixed(2));
    wallet.updatedAt = nowIso();
    await this.repository.upsertWorkspaceWallet(wallet);
    await this.repository.insertCreditLedgerEntry(
      createCreditLedgerEntry({
        workspaceId,
        entryType: "top_up",
        amount,
        balanceAfter: wallet.availableCredits,
        source,
        campaignId: null,
        promotionRunId: null,
      }),
    );
    return wallet;
  }

  async listPromotionRuns(workspaceId = this.currentWorkspaceId()) {
    return this.repository.listPromotionRuns(workspaceId);
  }

  async getPromotionRun(promotionRunId: string) {
    return this.repository.getPromotionRun(promotionRunId);
  }

  async listPromotionRunTargets(promotionRunId: string) {
    return this.repository.listPromotionRunTargets(promotionRunId);
  }

  async listRecruitmentPipelines(
    filter: Partial<{ stage: string; ownerId: string; priority: string; leadId: string }> = {},
  ) {
    await this.ensureRecruitmentCoverage();
    const pipelines = await this.repository.listRecruitmentPipelines();
    return pipelines.filter((pipeline) => {
      if (filter.stage && pipeline.stage !== filter.stage) return false;
      if (filter.ownerId && pipeline.ownerId !== filter.ownerId) return false;
      if (filter.priority && pipeline.priority !== filter.priority) return false;
      if (filter.leadId && pipeline.leadId !== filter.leadId) return false;
      return true;
    });
  }

  async getRecruitmentPipeline(pipelineId: string) {
    await this.ensureRecruitmentCoverage();
    return this.repository.getRecruitmentPipeline(pipelineId);
  }

  async updateRecruitmentPipeline(pipelineId: string, input: RecruitmentPipelineUpdate) {
    await this.ensureRecruitmentCoverage();
    const pipeline = await this.repository.getRecruitmentPipeline(pipelineId);
    if (!pipeline) return null;
    const parsed = RecruitmentPipelineUpdateSchema.parse(input);
    pipeline.stage = parsed.stage;
    pipeline.ownerId = parsed.ownerId ?? pipeline.ownerId;
    pipeline.priority = parsed.priority ?? pipeline.priority;
    pipeline.targetPersona = parsed.targetPersona ?? pipeline.targetPersona;
    pipeline.nextStep = parsed.nextStep ?? pipeline.nextStep;
    pipeline.lastActivityAt = nowIso();
    pipeline.updatedAt = nowIso();
    await this.repository.upsertRecruitmentPipeline(pipeline);
    return pipeline;
  }

  async listOutreachTargetsForPipeline(pipelineId: string) {
    await this.ensureRecruitmentCoverage();
    return this.repository.listOutreachTargets(pipelineId);
  }

  async createOutreachTargetForPipeline(pipelineId: string, input: OutreachTargetInput) {
    await this.ensureRecruitmentCoverage();
    const pipeline = await this.repository.getRecruitmentPipeline(pipelineId);
    if (!pipeline) return null;
    const parsed = OutreachTargetInputSchema.parse(input);
    const lead = await this.repository.getLead(pipeline.leadId);
    const matchedCampaign = lead
      ? await this.findBestOutreachCampaignForLead(lead, pipeline.targetPersona)
      : null;
    const target = OutreachTargetSchema.parse({
      targetId: `out_${crypto.randomUUID().slice(0, 8)}`,
      pipelineId,
      leadId: pipeline.leadId,
      providerOrg: pipeline.providerOrg,
      recommendedCampaignId: parsed.recommendedCampaignId ?? matchedCampaign?.campaignId ?? null,
      channel: parsed.channel,
      contactPoint: parsed.contactPoint,
      subjectLine: parsed.subjectLine ?? (lead ? this.buildOutreachSubject(lead, matchedCampaign, pipeline.targetPersona) : "Buyer agent outreach"),
      messageTemplate: parsed.messageTemplate,
      recommendationReason: parsed.recommendationReason ?? (lead ? this.buildRecommendationReason(lead, matchedCampaign, pipeline.targetPersona) : null),
      proofHighlights: parsed.proofHighlights ?? this.buildProofHighlights(matchedCampaign),
      autoGenerated: false,
      status: "draft",
      ownerId: parsed.ownerId ?? pipeline.ownerId ?? null,
      sendAttempts: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      providerRequestId: null,
      responseCode: null,
      openCount: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      openSignal: "none",
      lastOpenSource: null,
      lastError: null,
      lastSentAt: null,
      responseAt: null,
      notes: parsed.notes ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.repository.upsertOutreachTarget(target);
    pipeline.stage = pipeline.stage === "sourced" || pipeline.stage === "qualified" ? "outreach" : pipeline.stage;
    pipeline.lastActivityAt = nowIso();
    pipeline.updatedAt = nowIso();
    await this.repository.upsertRecruitmentPipeline(pipeline);
    return target;
  }

  async updateOutreachTargetStatus(targetId: string, status: OutreachTarget["status"], notes?: string | null) {
    await this.ensureRecruitmentCoverage();
    const target = await this.repository.getOutreachTarget(targetId);
    if (!target) return null;
    target.status = status;
    target.notes = notes ?? target.notes;
    target.updatedAt = nowIso();
    if (status === "sent") target.lastSentAt = nowIso();
    if (status === "replied") target.responseAt = nowIso();
    await this.repository.upsertOutreachTarget(target);

    const pipeline = await this.repository.getRecruitmentPipeline(target.pipelineId);
    if (pipeline) {
      pipeline.lastContactAt = status === "sent" || status === "replied" ? nowIso() : pipeline.lastContactAt;
      pipeline.stage = status === "replied" ? "replied" : status === "sent" ? "outreach" : pipeline.stage;
      pipeline.lastActivityAt = nowIso();
      pipeline.updatedAt = nowIso();
      await this.repository.upsertRecruitmentPipeline(pipeline);
    }
    if (status === "replied") {
      await this.upsertSystemPipelineTask(target.pipelineId, target.leadId, "follow_up_reminder", target.targetId, {
        ownerId: target.ownerId,
        dueAt: target.nextRetryAt ?? null,
        evidenceRef: target.recommendedCampaignId,
        notes: "Automatically closed because the buyer agent replied.",
        status: "done",
        completedAt: nowIso(),
      });
    }
    return target;
  }

  async recordOutreachOpen(targetId: string, source = "manual") {
    await this.ensureRecruitmentCoverage();
    const target = await this.repository.getOutreachTarget(targetId);
    if (!target) return null;

    const openedAt = nowIso();
    target.openCount += 1;
    target.firstOpenedAt = target.firstOpenedAt ?? openedAt;
    target.lastOpenedAt = openedAt;
    target.lastOpenSource = source;
    target.openSignal = target.openCount >= 2 ? "engaged" : "opened";
    target.updatedAt = openedAt;
    await this.repository.upsertOutreachTarget(target);

    const pipeline = await this.repository.getRecruitmentPipeline(target.pipelineId);
    if (pipeline) {
      pipeline.lastActivityAt = openedAt;
      if (pipeline.stage === "outreach") {
        pipeline.nextStep = target.openSignal === "engaged"
          ? "The first outreach was opened multiple times. Prioritize a proof-led second touch."
          : "The first outreach was opened. Prepare a proof-led follow-up if there is still no reply.";
        pipeline.updatedAt = openedAt;
        await this.repository.upsertRecruitmentPipeline(pipeline);
      }
    }

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: target.pipelineId,
        entityType: "delivery",
        entityId: target.targetId,
        action: "record_outreach_open",
        status: "success",
        actorType: "system",
        actorId: "outreach.open",
        details: {
          openCount: target.openCount,
          openSignal: target.openSignal,
          source,
        },
      }),
    );
    return target;
  }

  async sendOutreachTarget(targetId: string) {
    await this.ensureRecruitmentCoverage();
    const target = await this.repository.getOutreachTarget(targetId);
    if (!target) return null;

    const [pipeline, lead] = await Promise.all([
      this.repository.getRecruitmentPipeline(target.pipelineId),
      this.repository.getLead(target.leadId),
    ]);
    if (!pipeline || !lead) {
      throw new Error("Pipeline or lead not found for outreach target.");
    }
    const campaign = target.recommendedCampaignId ? await this.repository.getCampaign(target.recommendedCampaignId) : null;

    target.sendAttempts += 1;
    target.lastAttemptAt = nowIso();
    target.updatedAt = nowIso();

    const result = await this.outreachSenderGateway.sendOutreach({
      target,
      pipeline,
      lead,
      campaign,
    });

    if (
      !result.ok &&
      ["CHANNEL_NOT_CONFIGURED", "CHANNEL_NOT_SUPPORTED", "SMTP_NOT_CONFIGURED"].includes(result.responseCode ?? "")
    ) {
      throw new Error(result.message ?? "Outreach sender is not configured.");
    }

    if (result.ok) {
      target.status = "sent";
      target.lastSentAt = nowIso();
      target.nextRetryAt = null;
      target.providerRequestId = result.providerRequestId ?? null;
      target.responseCode = result.responseCode ?? null;
      target.lastError = null;
      const reminderAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await this.upsertSystemPipelineTask(target.pipelineId, target.leadId, "follow_up_reminder", target.targetId, {
        ownerId: target.ownerId,
        dueAt: reminderAt,
        evidenceRef: target.recommendedCampaignId,
        notes: `Follow up if there is no reply to the ${target.channel} outreach.`,
        status: "todo",
      });
    } else if (result.retryable) {
      const retryAt = new Date(Date.now() + (result.retryAfterSeconds ?? 30) * 1000).toISOString();
      target.status = "retry_scheduled";
      target.nextRetryAt = retryAt;
      target.providerRequestId = result.providerRequestId ?? null;
      target.responseCode = result.responseCode ?? null;
      target.lastError = result.message ?? "retry_scheduled";
      await this.upsertSystemPipelineTask(target.pipelineId, target.leadId, "retry_outreach", target.targetId, {
        ownerId: target.ownerId,
        dueAt: retryAt,
        evidenceRef: target.recommendedCampaignId,
        notes: `Retry outreach after sender requested retry: ${result.message ?? result.responseCode ?? "retry_scheduled"}.`,
        status: "todo",
      });
    } else {
      target.status = "bounced";
      target.nextRetryAt = null;
      target.providerRequestId = result.providerRequestId ?? null;
      target.responseCode = result.responseCode ?? null;
      target.lastError = result.message ?? "send_failed";
      await this.upsertSystemPipelineTask(target.pipelineId, target.leadId, "bounce_recovery", target.targetId, {
        ownerId: target.ownerId,
        dueAt: nowIso(),
        evidenceRef: target.recommendedCampaignId,
        notes: `Fix bounced outreach and verify the contact point: ${result.message ?? result.responseCode ?? "send_failed"}.`,
        status: "todo",
      });
    }

    await this.repository.upsertOutreachTarget(target);
    pipeline.lastContactAt = target.lastSentAt ?? pipeline.lastContactAt;
    pipeline.stage = target.status === "sent" ? "outreach" : target.status === "retry_scheduled" ? "outreach" : pipeline.stage;
    pipeline.lastActivityAt = nowIso();
    pipeline.updatedAt = nowIso();
    await this.repository.upsertRecruitmentPipeline(pipeline);

    await this.recordAuditEvent(
      createAuditEvent({
        traceId: pipeline.pipelineId,
        entityType: "delivery",
        entityId: target.targetId,
        action: "send_outreach_target",
        status: result.ok ? "success" : result.retryable ? "blocked" : "failure",
        actorType: result.ok ? "system" : "system",
        actorId: "outreach.send",
        details: {
          channel: target.channel,
          contactPoint: target.contactPoint,
          providerRequestId: target.providerRequestId,
          responseCode: target.responseCode,
          retryable: result.retryable,
          message: result.message ?? null,
        },
      }),
    );

    return {
      target,
      pipeline,
      deliveryResult: result,
    };
  }

  async listOnboardingTasksForPipeline(pipelineId: string) {
    await this.ensureRecruitmentCoverage();
    return this.repository.listOnboardingTasks(pipelineId);
  }

  async createOnboardingTaskForPipeline(pipelineId: string, input: OnboardingTaskInput) {
    await this.ensureRecruitmentCoverage();
    const pipeline = await this.repository.getRecruitmentPipeline(pipelineId);
    if (!pipeline) return null;
    const parsed = OnboardingTaskInputSchema.parse(input);
    const task = OnboardingTaskSchema.parse({
      taskId: `task_${crypto.randomUUID().slice(0, 8)}`,
      pipelineId,
      leadId: pipeline.leadId,
      taskType: parsed.taskType,
      status: "todo",
      ownerId: parsed.ownerId ?? pipeline.ownerId ?? null,
      dueAt: parsed.dueAt ?? null,
      relatedTargetId: parsed.relatedTargetId ?? null,
      autoGenerated: false,
      evidenceRef: parsed.evidenceRef ?? null,
      notes: parsed.notes ?? null,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.repository.upsertOnboardingTask(task);
    pipeline.stage = pipeline.stage === "replied" || pipeline.stage === "qualified" || pipeline.stage === "outreach" ? "onboarding" : pipeline.stage;
    pipeline.lastActivityAt = nowIso();
    pipeline.updatedAt = nowIso();
    await this.repository.upsertRecruitmentPipeline(pipeline);
    return task;
  }

  async updateOnboardingTaskStatus(
    taskId: string,
    status: OnboardingTask["status"],
    input: Partial<Pick<OnboardingTask, "evidenceRef" | "notes">> = {},
  ) {
    await this.ensureRecruitmentCoverage();
    const task = await this.repository.getOnboardingTask(taskId);
    if (!task) return null;
    task.status = status;
    task.evidenceRef = input.evidenceRef ?? task.evidenceRef;
    task.notes = input.notes ?? task.notes;
    task.updatedAt = nowIso();
    task.completedAt = status === "done" ? nowIso() : null;
    await this.repository.upsertOnboardingTask(task);

    const [pipeline, lead, partner] = await Promise.all([
      this.repository.getRecruitmentPipeline(task.pipelineId),
      this.repository.getLead(task.leadId),
      this.findPartnerByLeadId(task.leadId),
    ]);
    if (pipeline && lead) {
      const tasks = await this.repository.listOnboardingTasks(task.pipelineId);
      pipeline.stage = this.derivePipelineStage(lead, partner, tasks);
      pipeline.lastActivityAt = nowIso();
      pipeline.updatedAt = nowIso();
      await this.repository.upsertRecruitmentPipeline(pipeline);
      await this.repository.upsertPartnerReadiness(
        this.derivePartnerReadiness(lead, pipeline.pipelineId, tasks, partner),
      );
    }
    return task;
  }

  async getPartnerReadinessForPipeline(pipelineId: string) {
    await this.ensureRecruitmentCoverage();
    return this.repository.getPartnerReadiness(pipelineId);
  }

  async processDueRecruitmentTasks(referenceTime = nowIso()) {
    await this.ensureRecruitmentCoverage();
    const dueAt = new Date(referenceTime).getTime();
    const pipelines = await this.repository.listRecruitmentPipelines();

    const summary = {
      processedTasks: 0,
      createdSecondTouchTasks: 0,
      createdSecondTouchDrafts: 0,
    };

    for (const pipeline of pipelines) {
      const [tasks, lead] = await Promise.all([
        this.repository.listOnboardingTasks(pipeline.pipelineId),
        this.repository.getLead(pipeline.leadId),
      ]);
      if (!lead) continue;

      for (const task of tasks) {
        if (task.status !== "todo" || !task.dueAt || new Date(task.dueAt).getTime() > dueAt) {
          continue;
        }

        if (task.taskType === "follow_up_reminder" && task.relatedTargetId) {
          const originalTarget = await this.repository.getOutreachTarget(task.relatedTargetId);
          if (!originalTarget || originalTarget.status !== "sent" || originalTarget.responseAt) {
            task.status = "done";
            task.completedAt = referenceTime;
            task.notes = "Reminder closed because outreach already progressed.";
            task.updatedAt = referenceTime;
            await this.repository.upsertOnboardingTask(task);
            summary.processedTasks += 1;
            continue;
          }

          const pipelineCampaign = originalTarget.recommendedCampaignId
            ? await this.repository.getCampaign(originalTarget.recommendedCampaignId)
            : await this.findBestOutreachCampaignForLead(lead, pipeline.targetPersona);
          const secondTouchTarget = OutreachTargetSchema.parse({
            targetId: `out_${crypto.randomUUID().slice(0, 8)}`,
            pipelineId: pipeline.pipelineId,
            leadId: pipeline.leadId,
            providerOrg: pipeline.providerOrg,
            recommendedCampaignId: originalTarget.recommendedCampaignId ?? pipelineCampaign?.campaignId ?? null,
            channel: originalTarget.channel,
            contactPoint: originalTarget.contactPoint,
            subjectLine:
              originalTarget.openSignal === "engaged"
                ? `Follow-up: proof highlights for ${pipelineCampaign?.advertiser ?? originalTarget.subjectLine}`
                : originalTarget.openSignal === "opened"
                  ? `Follow-up: key proof points for ${pipelineCampaign?.advertiser ?? originalTarget.subjectLine}`
                  : `Follow-up: ${originalTarget.subjectLine}`,
            messageTemplate: this.buildSecondTouchMessage(lead, pipelineCampaign, pipeline.targetPersona, originalTarget),
            recommendationReason:
              originalTarget.recommendationReason ?? this.buildRecommendationReason(lead, pipelineCampaign, pipeline.targetPersona),
            proofHighlights:
              originalTarget.proofHighlights.length > 0
                ? originalTarget.proofHighlights
                : this.buildProofHighlights(pipelineCampaign),
            autoGenerated: true,
            status: "draft",
            ownerId: originalTarget.ownerId ?? pipeline.ownerId ?? null,
            sendAttempts: 0,
            lastAttemptAt: null,
            nextRetryAt: null,
            providerRequestId: null,
            responseCode: null,
            openCount: 0,
            firstOpenedAt: null,
            lastOpenedAt: null,
            openSignal: "none",
            lastOpenSource: null,
            lastError: null,
            lastSentAt: null,
            responseAt: null,
            notes: "Automatically generated second-touch outreach draft after no reply.",
            createdAt: referenceTime,
            updatedAt: referenceTime,
          });
          await this.repository.upsertOutreachTarget(secondTouchTarget);
          await this.upsertSystemPipelineTask(
            pipeline.pipelineId,
            pipeline.leadId,
            "second_touch_outreach",
            secondTouchTarget.targetId,
            {
              ownerId: secondTouchTarget.ownerId,
              dueAt: referenceTime,
              evidenceRef: secondTouchTarget.recommendedCampaignId,
              notes: "Send the second-touch outreach draft because the first outreach received no reply.",
              status: "todo",
            },
          );
          task.status = "done";
          task.completedAt = referenceTime;
          task.notes = "Escalated to second-touch outreach because no reply was received before reminder due time.";
          task.updatedAt = referenceTime;
          await this.repository.upsertOnboardingTask(task);
          pipeline.stage = "outreach";
          pipeline.nextStep = "Review and send the auto-generated second-touch outreach draft.";
          pipeline.lastActivityAt = referenceTime;
          pipeline.updatedAt = referenceTime;
          await this.repository.upsertRecruitmentPipeline(pipeline);
          summary.processedTasks += 1;
          summary.createdSecondTouchTasks += 1;
          summary.createdSecondTouchDrafts += 1;
        }
      }
    }

    return summary;
  }

  async getDeliveryMetrics(workspaceId = this.currentWorkspaceId(), promotionRunId?: string): Promise<DeliveryMetrics> {
    const runs = promotionRunId
      ? (await this.repository.getPromotionRun(promotionRunId))?.workspaceId === workspaceId
        ? [await this.repository.getPromotionRun(promotionRunId)].filter(Boolean)
        : []
      : await this.repository.listPromotionRuns(workspaceId);
    const flattenedRuns = runs.filter((run): run is PromotionRun => Boolean(run));
    const targets = (
      await Promise.all(flattenedRuns.map((run) => this.repository.listPromotionRunTargets(run.promotionRunId)))
    ).flat();

    const dispatchAttempts = targets.reduce((sum, target) => sum + target.dispatchAttempts, 0);
    const attemptedTargets = targets.filter((target) => target.dispatchAttempts > 0).length;
    const respondedTargets = targets.filter(
      (target) => target.dispatchAttempts > 0 && target.responseCode !== "NETWORK_ERROR",
    ).length;
    const acceptedTargets = targets.filter((target) => target.status === "accepted").length;
    const failedTargets = targets.filter((target) => target.status === "failed").length;
    const retryScheduledTargets = targets.filter((target) => target.status === "retry_scheduled").length;
    const coolingDownTargets = targets.filter((target) => target.status === "cooldown").length;
    const failureReasonBreakdown = targets
      .filter((target) => target.status !== "accepted" && target.lastError)
      .reduce<Record<string, number>>((acc, target) => {
        const reason = target.lastError ?? "unknown";
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {});

    return DeliveryMetricsSchema.parse({
      workspaceId,
      promotionRunId: promotionRunId ?? null,
      totalTargets: targets.length,
      attemptedTargets,
      dispatchAttempts,
      respondedTargets,
      acceptedTargets,
      failedTargets,
      retryScheduledTargets,
      coolingDownTargets,
      dispatchSuccessRate: dispatchAttempts > 0 ? respondedTargets / dispatchAttempts : 0,
      acceptanceRate: dispatchAttempts > 0 ? acceptedTargets / dispatchAttempts : 0,
      failureReasonBreakdown,
      cooldownAgents: targets
        .filter((target) => target.status === "cooldown" || target.status === "retry_scheduled")
        .map((target) => ({
          partnerId: target.partnerId,
          providerOrg: target.providerOrg,
          status: target.status,
          cooldownUntil: target.cooldownUntil,
          nextRetryAt: target.nextRetryAt,
          dispatchAttempts: target.dispatchAttempts,
          lastError: target.lastError,
        })),
    });
  }

  async createPromotionRun(input: {
    workspaceId?: string;
    campaignId: string;
    category: string;
    taskType: string;
    geo?: string[];
    sponsoredSlots?: number;
    disclosureRequired?: boolean;
  }) {
    const workspaceId = input.workspaceId ?? this.currentWorkspaceId();
    const { subscription } = await this.ensureWorkspaceBillingState(workspaceId);
    const scorecards = (await this.rebuildBuyerAgentScorecards())
      .filter((card) => card.isCommerciallyEligible)
      .sort((left, right) => {
        const tierRank = { A: 0, B: 1, C: 2, unqualified: 3 };
        return tierRank[left.buyerAgentTier] - tierRank[right.buyerAgentTier] || right.buyerAgentScore - left.buyerAgentScore || right.historicalQualityScore - left.historicalQualityScore;
      });

    const plan = PROMOTION_PLANS.find((item) => item.planId === subscription.planId) ?? PROMOTION_PLANS[0];
    const selectedScorecards = scorecards
      .slice(0, plan.maxQualifiedBuyerAgentsPerWave)
      .filter(
        (
          card,
        ): card is BuyerAgentScorecard & {
          partnerId: string;
          endpointUrl: string;
        } => Boolean(card.partnerId && card.endpointUrl),
      );
    const selectedPartnerIds = selectedScorecards
      .map((card) => card.partnerId)
      .filter((value): value is string => Boolean(value));
    const coverageCreditsCharged = Math.ceil(selectedPartnerIds.length / 10) * CREDIT_CHARGES.coverageReservationPerTenAgents;

    if (coverageCreditsCharged > 0) {
      await this.consumeCredits(
        workspaceId,
        "coverage_reservation",
        coverageCreditsCharged,
        "promotion_run.coverage",
        input.campaignId,
        null,
      );
    }

    const run = PromotionRunSchema.parse({
      promotionRunId: `prun_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId,
      campaignId: input.campaignId,
      planId: plan.planId,
      status: selectedPartnerIds.length > 0 ? "planned" : "blocked",
      requestedCategory: input.category,
      taskType: input.taskType,
      constraints: {
        geo: input.geo ?? [],
      },
      qualifiedBuyerAgentsCount: selectedPartnerIds.length,
      coverageCreditsCharged,
      acceptedBuyerAgentsCount: 0,
      failedBuyerAgentsCount: 0,
      shortlistedCount: 0,
      handoffCount: 0,
      conversionCount: 0,
      selectedPartnerIds,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await this.repository.upsertPromotionRun(run);
    for (const scorecard of selectedScorecards) {
      await this.repository.upsertPromotionRunTarget(
        PromotionRunTargetSchema.parse({
          targetId: buildPromotionRunTargetId(run.promotionRunId, scorecard.partnerId),
          promotionRunId: run.promotionRunId,
          workspaceId,
          campaignId: input.campaignId,
          partnerId: scorecard.partnerId,
          providerOrg: scorecard.providerOrg,
          endpointUrl: scorecard.endpointUrl,
          buyerAgentTier: scorecard.buyerAgentTier,
          buyerAgentScore: scorecard.buyerAgentScore,
          deliveryReadinessScore: scorecard.deliveryReadinessScore,
          status: "queued",
          supportedCategories: scorecard.buyerIntentCoverage,
          lastAttemptAt: null,
          dispatchAttempts: 0,
          cooldownUntil: null,
          nextRetryAt: null,
          protocol: null,
          remoteRequestId: null,
          responseCode: null,
          lastError: null,
          acceptedAt: null,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }),
      );
    }
    return run;
  }

  async dispatchPromotionRun(promotionRunId: string) {
    const run = await this.repository.getPromotionRun(promotionRunId);
    if (!run) {
      return null;
    }

    const [targets, partners, campaign] = await Promise.all([
      this.repository.listPromotionRunTargets(promotionRunId),
      this.repository.listPartners(),
      this.repository.getCampaign(run.campaignId),
    ]);
    const partnerById = new Map(partners.map((partner) => [partner.partnerId, partner]));
    const dispatchedAt = nowIso();

    for (const target of targets) {
      if (target.status === "accepted" || target.status === "failed") {
        continue;
      }

      const cooldown = await this.hotState.getJson<{ until: string; reason: string }>(deliveryCooldownKey(target.partnerId));
      if (cooldown && new Date(cooldown.until).getTime() > Date.now()) {
        target.status = "cooldown";
        target.cooldownUntil = cooldown.until;
        target.nextRetryAt = cooldown.until;
        target.updatedAt = dispatchedAt;
        target.lastError = cooldown.reason;
        target.responseCode = "COOLDOWN_ACTIVE";
        await this.repository.upsertPromotionRunTarget(target);
        continue;
      }

      const partner = partnerById.get(target.partnerId);
      if (!partner || !campaign) {
        target.dispatchAttempts += 1;
        target.lastAttemptAt = dispatchedAt;
        target.updatedAt = dispatchedAt;
        target.status = "failed";
        target.lastError = !campaign ? "campaign_not_found" : "partner_not_found";
        target.responseCode = !campaign ? "CAMPAIGN_NOT_FOUND" : "PARTNER_NOT_FOUND";
        await this.repository.upsertPromotionRunTarget(target);
        continue;
      }

      const delivery = await this.deliveryGateway.dispatchPromotion({
        run,
        target,
        partner,
        campaign,
      });
      target.dispatchAttempts += 1;
      target.lastAttemptAt = dispatchedAt;
      target.updatedAt = dispatchedAt;
      target.protocol = delivery.protocol;
      target.remoteRequestId = delivery.remoteRequestId ?? null;
      target.responseCode = delivery.responseCode ?? null;

      if (delivery.accepted) {
        target.status = "accepted";
        target.lastError = null;
        target.acceptedAt = dispatchedAt;
        target.cooldownUntil = null;
        target.nextRetryAt = null;
      } else if (delivery.retryable) {
        const retryAfterSeconds = Math.max(1, delivery.retryAfterSeconds ?? HOT_STATE_TTL.deliveryCooldownSeconds);
        const retryAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
        await this.hotState.setJson(
          deliveryCooldownKey(target.partnerId),
          {
            until: retryAt,
            reason: delivery.message ?? delivery.responseCode ?? "retry_scheduled",
          },
          retryAfterSeconds,
        );
        target.status = "retry_scheduled";
        target.lastError = delivery.message ?? delivery.responseCode ?? "retry_scheduled";
        target.cooldownUntil = retryAt;
        target.nextRetryAt = retryAt;
        target.acceptedAt = null;
      } else {
        target.status = "failed";
        target.lastError = delivery.message ?? delivery.responseCode ?? "delivery_failed";
        target.cooldownUntil = null;
        target.nextRetryAt = null;
        target.acceptedAt = null;
      }

      await this.repository.upsertPromotionRunTarget(target);
      await this.recordAuditEvent(
        createAuditEvent({
          traceId: run.promotionRunId,
          entityType: "delivery",
          entityId: target.targetId,
          action: "dispatch_promotion_run_target",
          status: delivery.accepted ? "success" : delivery.retryable ? "blocked" : "failure",
          actorType: "system",
          actorId: "promotion.dispatch",
          details: {
            partnerId: target.partnerId,
            providerOrg: target.providerOrg,
            protocol: target.protocol,
            responseCode: target.responseCode,
            remoteRequestId: target.remoteRequestId,
            retryable: delivery.retryable,
            responded: delivery.responded,
            cooldownUntil: target.cooldownUntil,
            message: delivery.message ?? null,
          },
        }),
      );
    }

    const updatedTargets = await this.repository.listPromotionRunTargets(promotionRunId);
    const summary = summarizePromotionRunTargets(updatedTargets);
    run.acceptedBuyerAgentsCount = summary.acceptedBuyerAgentsCount;
    run.failedBuyerAgentsCount = summary.failedBuyerAgentsCount;
    run.status =
      updatedTargets.length === 0
        ? "blocked"
        : summary.acceptedBuyerAgentsCount > 0
          ? "completed"
          : updatedTargets.some((target) => target.status === "retry_scheduled" || target.status === "cooldown" || target.status === "queued")
            ? "planned"
            : "blocked";
    run.updatedAt = dispatchedAt;
    await this.repository.upsertPromotionRun(run);

    return {
      run,
      targets: updatedTargets,
    };
  }

  async assignLead(leadId: string, ownerId: string) {
    const lead = await this.repository.assignLead(leadId, ownerId);
    if (!lead) return null;
    await this.ensurePipelineArtifactsForLead(lead);
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

  async promoteLeadToPartner(
    leadId: string,
    overrides: Partial<Pick<PartnerAgent, "partnerId" | "dataProvenance" | "status" | "supportedCategories" | "slaTier" | "acceptsSponsored" | "supportsDisclosure" | "supportsDeliveryReceipt" | "supportsPresentationReceipt" | "authModes">> = {},
  ) {
    const lead = await this.repository.getLead(leadId);
    if (!lead) {
      return null;
    }
    return this.promoteLeadToPartnerInternal(lead, overrides, lead.assignedOwner ?? "ops:system", true);
  }

  async updateLeadStatus(
    leadId: string,
    nextStatus: AgentLead["verificationStatus"],
    actorId: string,
    comment: string,
    checklist: VerificationChecklist,
    evidenceRef?: string | null,
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

    const lead = await this.repository.updateLeadStatus(leadId, nextStatus, actorId, comment, checklist, evidenceRef);
    if (!lead) {
      return null;
    }
    await this.ensurePipelineArtifactsForLead(lead);

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

  async listEvidenceAssets(filter: Partial<{ provenance: string }> = {}) {
    const assets = await this.repository.listEvidenceAssets();
    return assets.filter((asset) => this.matchesProvenance(asset.dataProvenance, filter.provenance));
  }

  async createEvidenceAsset(input: EvidenceAssetInput) {
    const parsed = EvidenceAssetInputSchema.parse(input);
    const campaign = await this.repository.getCampaign(parsed.campaignId);
    const asset = EvidenceAssetSchema.parse({
      assetId: `asset_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      dataProvenance:
        parsed.dataProvenance ??
        campaign?.dataProvenance ??
        this.defaultMutationProvenance("evidence"),
      updatedAt: nowIso(),
      verifiedBy: parsed.verifiedBy ?? null,
      verificationNote: parsed.verificationNote ?? null,
    });
    await this.repository.insertEvidenceAsset(asset);
    return asset;
  }

  async listRiskCases(filter: Partial<{ status: string; severity: string; entityType: string; ownerId: string; dateFrom: string; dateTo: string; provenance: string; }> = {}) {
    const cases = await this.repository.listRiskCases(filter);
    return cases.filter((riskCase) => this.matchesProvenance(riskCase.dataProvenance, filter.provenance));
  }

  async createRiskCase(input: RiskCaseInput) {
    const parsed = RiskCaseInputSchema.parse(input);
    const entityProvenance =
      parsed.entityProvenance ?? (await this.inferEntityProvenance(parsed.entityType, parsed.entityId));
    const riskCase = RiskCaseSchema.parse({
      caseId: `risk_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      dataProvenance: parsed.dataProvenance ?? this.defaultMutationProvenance("risk"),
      entityProvenance,
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
          dataProvenance: parsed.dataProvenance ?? this.defaultMutationProvenance("risk"),
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
    const target = await this.repository.getReputationRecord(parsed.targetRecordId);
    const appeal = AppealCaseSchema.parse({
      appealId: `appeal_${crypto.randomUUID().slice(0, 8)}`,
      ...parsed,
      dataProvenance: parsed.dataProvenance ?? this.defaultMutationProvenance("appeal"),
      targetRecordProvenance: parsed.targetRecordProvenance ?? target?.dataProvenance ?? null,
      status: "open",
      openedAt: nowIso(),
      decidedAt: null,
      decisionNote: null,
    });
    await this.repository.insertAppeal(appeal);

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
    const [receipts, campaigns, partners] = await Promise.all([
      this.repository.listEventReceipts(),
      this.repository.listCampaigns(),
      this.repository.listPartners(),
    ]);
    const filteredReceipts = this.appMode === "real_test"
      ? receipts.filter((receipt) => receipt.dataProvenance === "real_event")
      : receipts;
    return buildMeasurementFunnel(filteredReceipts, campaigns, partners, MeasurementFunnelQuerySchema.parse(query));
  }

  async getAttributionRows(query: MeasurementFunnelQuery) {
    const [receipts, settlements, campaigns] = await Promise.all([
      this.repository.listEventReceipts(),
      this.repository.listSettlements(),
      this.repository.listCampaigns(),
    ]);
    const filteredReceipts = this.appMode === "real_test"
      ? receipts.filter((receipt) => receipt.dataProvenance === "real_event")
      : receipts;
    const filteredSettlements = this.appMode === "real_test"
      ? settlements.filter((settlement) => settlement.dataProvenance === "sandbox_settlement")
      : settlements;
    return buildAttributionRows(filteredReceipts, filteredSettlements, campaigns, MeasurementFunnelQuerySchema.parse(query));
  }

  async getBillingDrafts() {
    const [settlements, campaigns] = await Promise.all([
      this.repository.listSettlements(),
      this.repository.listCampaigns(),
    ]);
    const filteredSettlements = this.appMode === "real_test"
      ? settlements.filter((settlement) => settlement.dataProvenance === "sandbox_settlement")
      : settlements;
    return buildBillingDrafts(filteredSettlements, campaigns);
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

  async listSettlements(filter: Partial<{ provenance: string }> = {}) {
    const settlements = await this.repository.listSettlements();
    return settlements.filter((settlement) => this.matchesProvenance(settlement.dataProvenance, filter.provenance));
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
    const workspaceId = parsed.workspaceId ?? this.currentWorkspaceId();
    const { subscription } = await this.ensureWorkspaceBillingState(workspaceId);
    const fallbackDetailUrl = parsed.sourceDocumentUrl ?? parsed.product.actionEndpoints[0] ?? parsed.proofReferences[0]?.url;
    const fallbackProofUrl = parsed.proofReferences[0]?.url ?? parsed.sourceDocumentUrl ?? parsed.product.actionEndpoints[0];
    const fallbackConversionUrl = parsed.product.actionEndpoints[0] ?? parsed.sourceDocumentUrl ?? parsed.proofReferences[0]?.url;
    const campaign = CampaignSchema.parse({
      campaignId: buildCampaignId(),
      dataProvenance: this.defaultMutationProvenance("campaign"),
      workspaceId,
      promotionPlanId: parsed.promotionPlanId ?? subscription.planId,
      advertiser: parsed.advertiser,
      externalRef: parsed.externalRef ?? null,
      sourceDocumentUrl: parsed.sourceDocumentUrl ?? null,
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
      linkBundle: parsed.linkBundle ?? {
        homepageUrl: fallbackDetailUrl,
        productDetailUrl: fallbackDetailUrl,
        proofUrl: fallbackProofUrl,
        conversionUrl: fallbackConversionUrl,
        contactUrl: null,
      },
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

    const [campaigns, partners] = await Promise.all([
      this.repository.listCampaigns(),
      this.repository.listPartners(),
    ]);
    let filteredPartners = partners;

    if (request.workspaceId) {
      const workspaceId = request.workspaceId;
      const run =
        request.promotionRunId ? await this.repository.getPromotionRun(request.promotionRunId) : null;
      if (run) {
        const targets = await this.repository.listPromotionRunTargets(run.promotionRunId);
        const acceptedPartnerIds = targets
          .filter((target) => target.status === "accepted")
          .map((target) => target.partnerId);
        filteredPartners = partners.filter((partner) =>
          (targets.length > 0 ? acceptedPartnerIds : run.selectedPartnerIds).includes(partner.partnerId),
        );
      } else {
        const scorecards = (await this.rebuildBuyerAgentScorecards())
          .filter((card) => card.isCommerciallyEligible)
          .sort((left, right) => {
            const tierRank = { A: 0, B: 1, C: 2, unqualified: 3 };
            return tierRank[left.buyerAgentTier] - tierRank[right.buyerAgentTier] || right.buyerAgentScore - left.buyerAgentScore || right.historicalQualityScore - left.historicalQualityScore;
          });
        const { subscription } = await this.ensureWorkspaceBillingState(workspaceId);
        const plan = PROMOTION_PLANS.find((item) => item.planId === subscription.planId) ?? PROMOTION_PLANS[0];
        const selectedPartnerIds = scorecards
          .slice(0, plan.maxQualifiedBuyerAgentsPerWave)
          .map((card) => card.partnerId)
          .filter((value): value is string => Boolean(value));
        const coverageCreditsCharged = Math.ceil(selectedPartnerIds.length / 10) * CREDIT_CHARGES.coverageReservationPerTenAgents;
        if (coverageCreditsCharged > 0) {
          await this.consumeCredits(
            workspaceId,
            "coverage_reservation",
            coverageCreditsCharged,
            "opportunity.evaluate",
            null,
            null,
          );
        }
        filteredPartners = partners.filter((partner) => selectedPartnerIds.includes(partner.partnerId));
      }
    }

    const eligibleBids = rankEligibleCampaigns(request, campaigns, filteredPartners);
    const shortlisted = shortlistCampaigns(request, campaigns, filteredPartners);
    const totalCandidates = campaigns.length * filteredPartners.filter((partner) => partner.status === "active").length;

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
    const parsed = normalizeEventReceipt(EventReceiptSchema.parse(receipt), this.appMode);
    if (this.appMode === "real_test" && parsed.dataProvenance !== "real_event") {
      throw new Error("real_test only accepts real_event receipts.");
    }
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

      const campaignForCredits = await this.repository.getCampaign(parsed.campaignId);
      const linkedPromotionRun = parsed.promotionRunId ? await this.repository.getPromotionRun(parsed.promotionRunId) : null;
      const workspaceIdForCredits = linkedPromotionRun?.workspaceId ?? campaignForCredits?.workspaceId;
      if (workspaceIdForCredits) {
        const usageCharge =
          isPresentedEvent(parsed.eventType)
            ? CREDIT_CHARGES.presented
            : isViewedEvent(parsed.eventType)
              ? CREDIT_CHARGES.viewed
              : isInteractedEvent(parsed.eventType)
                ? CREDIT_CHARGES.interacted
                : isConvertedEvent(parsed.eventType)
                  ? CREDIT_CHARGES.conversion
                : 0;

        if (usageCharge > 0) {
          await this.consumeCredits(
            workspaceIdForCredits,
            isPresentedEvent(parsed.eventType)
              ? "presented_charge"
              : isViewedEvent(parsed.eventType)
                ? "view_charge"
                : isInteractedEvent(parsed.eventType)
                  ? "interaction_charge"
                  : "conversion_charge",
            usageCharge,
            "receipt.usage",
            parsed.campaignId,
            null,
          );
        }

        const promotionRuns = await this.repository.listPromotionRuns(workspaceIdForCredits);
        const matchingRun =
          linkedPromotionRun ??
          promotionRuns.find(
            (run) =>
              run.campaignId === parsed.campaignId &&
              run.selectedPartnerIds.includes(parsed.partnerId),
        );
        if (matchingRun) {
          if (isShortlistedEvent(parsed.eventType)) matchingRun.shortlistedCount += 1;
          if (isInteractedEvent(parsed.eventType)) matchingRun.handoffCount += 1;
          if (isConvertedEvent(parsed.eventType)) matchingRun.conversionCount += 1;
          matchingRun.updatedAt = nowIso();
          await this.repository.upsertPromotionRun(matchingRun);
        }
      }

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
    const workspaceId = this.currentWorkspaceId();
    const { wallet, subscription } = await this.ensureWorkspaceBillingState(workspaceId);
    const [partners, campaigns, receipts, settlements, leads, evidenceAssets, riskCases, reputationRecords, appeals] = await Promise.all([
      this.repository.listPartners(),
      this.repository.listCampaigns(),
      this.repository.listEventReceipts(),
      this.repository.listSettlements(),
      this.repository.listLeads(),
      this.repository.listEvidenceAssets(),
      this.repository.listRiskCases(),
      this.repository.listReputationRecords(),
      this.repository.listAppeals(),
    ]);

    const eventCounts: Record<string, number> = {
      "offer.shortlisted": 0,
      "offer.presented": 0,
      "owner.viewed": 0,
      "owner.interacted": 0,
      "conversion.attributed": 0,
      shortlisted: 0,
      shown: 0,
      presented: 0,
      viewed: 0,
      detail_view: 0,
      interacted: 0,
      handoff: 0,
      conversion: 0,
    };

    for (const receipt of receipts) {
      eventCounts[receipt.eventType] = (eventCounts[receipt.eventType] ?? 0) + 1;
    }

    const opportunityCount = new Set(receipts.map((currentReceipt) => currentReceipt.intentId)).size || 1;
    const presentedCount = receipts.filter((currentReceipt) => isPresentedEvent(currentReceipt.eventType)).length;
    const detailViewCount = receipts.filter((currentReceipt) => isViewedEvent(currentReceipt.eventType)).length;
    const handoffCount = receipts.filter((currentReceipt) => isInteractedEvent(currentReceipt.eventType)).length;
    const conversionCount = receipts.filter((currentReceipt) => isConvertedEvent(currentReceipt.eventType)).length;
    const detailViewRate = presentedCount > 0 ? detailViewCount / presentedCount : 0;
    const handoffRate = detailViewCount > 0 ? handoffCount / detailViewCount : 0;
    const actionConversionRate = handoffCount > 0 ? conversionCount / handoffCount : 0;
    const disclosureShownRate = eventCounts.shortlisted > 0 ? presentedCount / eventCounts.shortlisted : 0;
    const qualifiedPresentedIntentCount = new Set(
      receipts
        .filter((currentReceipt) => isPresentedEvent(currentReceipt.eventType))
        .map((currentReceipt) => currentReceipt.intentId),
    ).size;
    const qualifiedRecommendationRate = qualifiedPresentedIntentCount / opportunityCount;
    const countsByProvenance = this.countByProvenance([
      ...partners,
      ...campaigns,
      ...receipts,
      ...settlements,
      ...leads,
      ...evidenceAssets,
      ...riskCases,
      ...reputationRecords,
      ...appeals,
    ]);
    const scorecards = await this.rebuildBuyerAgentScorecards();
    const buyerAgentTierCounts = scorecards.reduce(
      (acc, scorecard) => {
        acc[scorecard.buyerAgentTier] += 1;
        return acc;
      },
      { A: 0, B: 0, C: 0, unqualified: 0 },
    );

    return DashboardSnapshotSchema.parse({
      mode: this.appMode,
      workspaceId,
      currentPlanId: subscription.planId,
      availableCredits: wallet.availableCredits,
      consumedCredits: wallet.consumedCredits,
      touchedBuyerAgents: scorecards.filter((item) => item.isCommerciallyEligible).length,
      buyerAgentTierCounts,
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
      countsByProvenance,
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
      (campaign.billingModel === "CPQR" && isPresentedEvent(receipt.eventType)) ||
      (campaign.billingModel === "CPA" && isConvertedEvent(receipt.eventType));

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
      dataProvenance: this.appMode === "real_test" ? "sandbox_settlement" : receipt.dataProvenance,
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
          dataProvenance: this.appMode === "real_test" ? "sandbox_settlement" : receipt.dataProvenance,
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
    let sourceEntityProvenance: DataProvenance | null = null;
    if (event.entityType === "campaign") {
      sourceEntityProvenance = (await this.repository.getCampaign(event.entityId))?.dataProvenance ?? null;
    } else if (event.entityType === "receipt") {
      sourceEntityProvenance = (await this.repository.getEventReceipt(event.entityId))?.dataProvenance ?? null;
    } else if (event.entityType === "settlement") {
      sourceEntityProvenance = (await this.repository.getSettlement(event.entityId))?.dataProvenance ?? null;
    }

    await this.repository.insertAuditEvent(
      AuditEventSchema.parse({
        ...event,
        dataProvenance: sourceEntityProvenance ?? event.dataProvenance,
        details: {
          ...event.details,
          currentMode: this.appMode,
          sourceEntityProvenance,
        },
      }),
    );
  }
}

export const createStore = (options: CreateStoreOptions = {}) =>
  new PromotionAgentStore(
    options.repository ?? new InMemoryPromotionAgentRepository(options.seedData ?? buildSeedData()),
    options.hotState ?? new InMemoryHotStateStore(),
    options.settlementGateway ?? new SimulatedSettlementGateway(),
    options.deliveryGateway ?? new SimulatedBuyerAgentDeliveryGateway(),
    options.outreachSenderGateway ?? new SimulatedOutreachSenderGateway(),
    options.appMode ?? "default",
  );

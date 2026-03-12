import { z } from "zod";

export const PartnerStatusSchema = z.enum([
  "new",
  "reviewing",
  "verified",
  "active",
  "suspended",
]);

export const BillingModelSchema = z.enum(["CPQR", "CPA"]);

export const CampaignStatusSchema = z.enum([
  "draft",
  "reviewing",
  "active",
  "paused",
  "rejected",
]);

export const EventTypeSchema = z.enum([
  "shortlisted",
  "shown",
  "detail_view",
  "handoff",
  "conversion",
]);

export const AgentLeadSchema = z.object({
  agentId: z.string(),
  dataOrigin: z.enum(["seed", "discovered"]),
  source: z.string(),
  sourceType: z.enum(["public_registry", "partner_directory"]),
  sourceRef: z.string(),
  providerOrg: z.string(),
  cardUrl: z.string().url(),
  verticals: z.array(z.string()),
  skills: z.array(z.string()),
  geo: z.array(z.string()),
  authModes: z.array(z.string()),
  acceptsSponsored: z.boolean(),
  supportsDisclosure: z.boolean(),
  trustSeed: z.number().min(0).max(1),
  leadScore: z.number().min(0).max(1),
  discoveredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  endpointUrl: z.string().url().nullable(),
  contactRef: z.string().nullable(),
  missingFields: z.array(z.string()),
  reachProxy: z.number().min(0).max(1),
  monetizationReadiness: z.number().min(0).max(1),
  verificationStatus: PartnerStatusSchema,
  assignedOwner: z.string().nullable(),
  notes: z.string(),
  dedupeKey: z.string(),
  scoreBreakdown: z.object({
    icpFit: z.number().min(0).max(1),
    protocolFit: z.number().min(0).max(1),
    reachFit: z.number().min(0).max(1),
  }),
});

export const DiscoverySourceSchema = z.object({
  sourceId: z.string(),
  sourceType: z.enum(["public_registry", "partner_directory"]),
  name: z.string(),
  baseUrl: z.string().url(),
  seedUrls: z.array(z.string().url()).min(1),
  active: z.boolean(),
  crawlPolicy: z.object({
    rateLimit: z.number().positive(),
    maxDepth: z.number().int().positive(),
  }),
  verticalHints: z.array(z.string()),
  geoHints: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DiscoverySourceInputSchema = z.object({
  sourceType: z.enum(["public_registry", "partner_directory"]),
  name: z.string(),
  baseUrl: z.string().url(),
  seedUrls: z.array(z.string().url()).min(1),
  active: z.boolean().default(true),
  crawlPolicy: z.object({
    rateLimit: z.number().positive().default(1),
    maxDepth: z.number().int().positive().default(1),
  }),
  verticalHints: z.array(z.string()).default([]),
  geoHints: z.array(z.string()).default([]),
});

export const DiscoveryRunSchema = z.object({
  runId: z.string(),
  sourceId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  discoveredCount: z.number().int().nonnegative(),
  createdLeadCount: z.number().int().nonnegative(),
  dedupedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  traceId: z.string(),
  errors: z.array(z.string()),
});

export const VerificationChecklistSchema = z.object({
  identity: z.boolean(),
  auth: z.boolean(),
  disclosure: z.boolean(),
  sla: z.boolean(),
  rateLimit: z.boolean(),
});

export const VerificationRecordSchema = z.object({
  recordId: z.string(),
  leadId: z.string(),
  previousStatus: PartnerStatusSchema,
  nextStatus: PartnerStatusSchema,
  checklist: VerificationChecklistSchema,
  actorId: z.string(),
  comment: z.string(),
  occurredAt: z.string().datetime(),
});

export const PartnerAgentSchema = z.object({
  partnerId: z.string(),
  agentLeadId: z.string(),
  providerOrg: z.string(),
  endpoint: z.string().url(),
  status: PartnerStatusSchema,
  supportedCategories: z.array(z.string()),
  acceptsSponsored: z.boolean(),
  supportsDisclosure: z.boolean(),
  trustScore: z.number().min(0).max(1),
  authModes: z.array(z.string()),
  slaTier: z.string(),
});

export const ProofReferenceSchema = z.object({
  label: z.string(),
  type: z.enum(["doc", "faq", "case_study", "certificate", "screenshot"]),
  url: z.string().url(),
});

export const ProofBundleSchema = z.object({
  proofBundleId: z.string(),
  references: z.array(ProofReferenceSchema).min(1),
  updatedAt: z.string().datetime(),
});

export const OfferCardSchema = z.object({
  offerId: z.string(),
  title: z.string(),
  description: z.string(),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  intendedFor: z.array(z.string()),
  constraints: z.record(z.string(), z.unknown()),
  claims: z.array(z.string()).min(1),
  actionEndpoints: z.array(z.string().url()).min(1),
  narrativeVariants: z.object({
    rational: z.string().min(1),
    premium: z.string().min(1),
    simple: z.string().min(1),
  }),
});

export const CampaignSchema = z.object({
  campaignId: z.string(),
  advertiser: z.string(),
  category: z.string(),
  regions: z.array(z.string()).min(1),
  targetingPartnerIds: z.array(z.string()).default([]),
  billingModel: BillingModelSchema,
  payoutAmount: z.number().positive(),
  currency: z.string().length(3),
  budget: z.number().positive(),
  status: CampaignStatusSchema,
  disclosureText: z.string(),
  policyPass: z.boolean(),
  minTrust: z.number().min(0).max(1),
  offer: OfferCardSchema,
  proofBundle: ProofBundleSchema,
});

export const OpportunityRequestSchema = z.object({
  intentId: z.string(),
  category: z.string(),
  taskType: z.string(),
  constraints: z.record(z.string(), z.unknown()).default({}),
  placement: z.string(),
  relevanceFloor: z.number().min(0).max(1).default(0.72),
  utilityFloor: z.number().min(0).max(1).default(0.68),
  sponsoredSlots: z.number().int().positive().default(1),
  disclosureRequired: z.boolean().default(true),
});

export const ScoredBidSchema = z.object({
  bidId: z.string(),
  offerId: z.string(),
  campaignId: z.string(),
  partnerId: z.string(),
  bidValue: z.number().nonnegative(),
  expectedUtility: z.number().min(0).max(1),
  affectiveFit: z.number().min(0).max(1),
  trustScore: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  priorityScore: z.number().min(0).max(1),
  disclosureText: z.string(),
  rankingReason: z.string(),
  actionEndpoints: z.array(z.string().url()),
  proofBundleRef: z.string(),
  auditTraceId: z.string(),
  sponsoredFlag: z.literal(true),
  ttlSeconds: z.number().int().positive(),
});

export const EvaluationResponseSchema = z.object({
  intentId: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  eligibleCandidates: z.number().int().nonnegative(),
  shortlisted: z.array(ScoredBidSchema),
});

export const EventReceiptSchema = z.object({
  receiptId: z.string(),
  intentId: z.string(),
  offerId: z.string(),
  campaignId: z.string(),
  partnerId: z.string(),
  eventType: EventTypeSchema,
  occurredAt: z.string().datetime(),
  signature: z.string(),
});

export const SettlementReceiptSchema = z.object({
  settlementId: z.string(),
  campaignId: z.string(),
  offerId: z.string(),
  partnerId: z.string(),
  intentId: z.string(),
  billingModel: BillingModelSchema,
  eventType: EventTypeSchema,
  amount: z.number().positive(),
  currency: z.string().length(3),
  attributionWindow: z.string(),
  status: z.enum([
    "pending",
    "processing",
    "retry_scheduled",
    "settled",
    "disputed",
    "failed",
  ]),
  disputeFlag: z.boolean(),
  providerSettlementId: z.string().nullable(),
  providerReference: z.string().nullable(),
  providerState: z.enum(["accepted", "settled", "retry", "failed"]).nullable(),
  providerResponseCode: z.string().nullable(),
  lastError: z.string().nullable(),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SettlementRetryJobStatusSchema = z.enum([
  "queued",
  "processing",
  "retry_scheduled",
  "completed",
  "failed",
  "cancelled",
]);

export const SettlementRetryJobSchema = z.object({
  retryJobId: z.string(),
  settlementId: z.string(),
  traceId: z.string(),
  status: SettlementRetryJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextRunAt: z.string().datetime(),
  lastError: z.string().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SettlementRetryJobFilterSchema = z.object({
  status: SettlementRetryJobStatusSchema.optional(),
  settlementId: z.string().optional(),
  traceId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const SettlementDeadLetterStatusSchema = z.enum([
  "open",
  "replayed",
  "resolved",
  "ignored",
]);

export const SettlementDeadLetterEntrySchema = z.object({
  dlqEntryId: z.string(),
  settlementId: z.string(),
  retryJobId: z.string().nullable(),
  traceId: z.string(),
  status: SettlementDeadLetterStatusSchema,
  reason: z.string(),
  lastError: z.string(),
  payload: z.record(z.string(), z.unknown()),
  resolutionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const SettlementDeadLetterFilterSchema = z.object({
  status: SettlementDeadLetterStatusSchema.optional(),
  traceId: z.string().optional(),
  settlementId: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const SettlementDeadLetterPageSchema = z.object({
  items: z.array(SettlementDeadLetterEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export const DashboardSnapshotSchema = z.object({
  activePartners: z.number().int().nonnegative(),
  activeCampaigns: z.number().int().nonnegative(),
  eventCounts: z.record(EventTypeSchema, z.number().int().nonnegative()),
  settlementCount: z.number().int().nonnegative(),
  qualifiedRecommendationRate: z.number().min(0).max(1),
  detailViewRate: z.number().min(0).max(1),
  handoffRate: z.number().min(0).max(1),
  actionConversionRate: z.number().min(0).max(1),
  disclosureShownRate: z.number().min(0).max(1),
  qualifiedAgentCoverage: z.number().int().nonnegative(),
});

export const AuditEntityTypeSchema = z.enum([
  "campaign",
  "policy_check",
  "opportunity",
  "receipt",
  "settlement",
  "idempotency",
  "cache",
]);

export const AuditStatusSchema = z.enum([
  "started",
  "success",
  "failure",
  "deduplicated",
  "cache_hit",
  "cache_miss",
  "blocked",
]);

export const AuditActorTypeSchema = z.enum([
  "system",
  "api",
  "buyer_agent",
  "seller_agent",
  "operator",
]);

export const AuditEventSchema = z.object({
  auditEventId: z.string(),
  traceId: z.string(),
  entityType: AuditEntityTypeSchema,
  entityId: z.string(),
  action: z.string(),
  status: AuditStatusSchema,
  actorType: AuditActorTypeSchema,
  actorId: z.string(),
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
});

export const AuditEventFilterSchema = z.object({
  traceId: z.string().optional(),
  entityId: z.string().optional(),
  entityType: AuditEntityTypeSchema.optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export const AuditEventPageSchema = z.object({
  items: z.array(AuditEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export const ProductDraftSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  intendedFor: z.array(z.string()).min(1),
  constraints: z.record(z.string(), z.unknown()).default({}),
  claims: z.array(z.string()).min(1),
  actionEndpoints: z.array(z.string().url()).min(1),
  positioningBullets: z.array(z.string()).default([]),
});

export const EvidenceAssetSchema = z.object({
  assetId: z.string(),
  campaignId: z.string(),
  type: z.enum(["pricing", "case_study", "certificate", "doc", "screenshot", "faq"]),
  label: z.string(),
  url: z.string().url(),
  updatedAt: z.string().datetime(),
  verifiedBy: z.string().nullable(),
  verificationNote: z.string().nullable(),
});

export const EvidenceAssetInputSchema = z.object({
  campaignId: z.string(),
  type: z.enum(["pricing", "case_study", "certificate", "doc", "screenshot", "faq"]),
  label: z.string(),
  url: z.string().url(),
  verifiedBy: z.string().nullable().optional(),
  verificationNote: z.string().nullable().optional(),
});

export const RiskCaseSchema = z.object({
  caseId: z.string(),
  entityType: z.enum(["campaign", "partner", "agent_lead", "settlement", "receipt"]),
  entityId: z.string(),
  reasonType: z.enum(["claim_mismatch", "disclosure_missing", "spam", "high_complaint", "policy_violation"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
  openedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  ownerId: z.string().nullable(),
  note: z.string().nullable(),
});

export const RiskCaseInputSchema = z.object({
  entityType: z.enum(["campaign", "partner", "agent_lead", "settlement", "receipt"]),
  entityId: z.string(),
  reasonType: z.enum(["claim_mismatch", "disclosure_missing", "spam", "high_complaint", "policy_violation"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  ownerId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const ReputationRecordSchema = z.object({
  recordId: z.string(),
  partnerId: z.string(),
  delta: z.number(),
  reasonType: z.enum(["claim_mismatch", "disclosure_missing", "spam", "high_complaint", "manual_adjustment"]),
  evidenceRefs: z.array(z.string()),
  disputeStatus: z.enum(["none", "under_review", "resolved", "overturned"]),
  occurredAt: z.string().datetime(),
});

export const AppealCaseSchema = z.object({
  appealId: z.string(),
  partnerId: z.string(),
  targetRecordId: z.string(),
  status: z.enum(["open", "reviewing", "approved", "rejected"]),
  statement: z.string(),
  openedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
});

export const AppealCaseInputSchema = z.object({
  partnerId: z.string(),
  targetRecordId: z.string(),
  statement: z.string(),
});

export const MeasurementFunnelQuerySchema = z.object({
  campaignId: z.string().optional(),
  partnerId: z.string().optional(),
  vertical: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export const MeasurementFunnelSchema = z.object({
  shortlisted: z.number().int().nonnegative(),
  shown: z.number().int().nonnegative(),
  detailView: z.number().int().nonnegative(),
  handoff: z.number().int().nonnegative(),
  conversion: z.number().int().nonnegative(),
  detailViewRate: z.number().min(0).max(1),
  handoffRate: z.number().min(0).max(1),
  actionConversionRate: z.number().min(0).max(1),
});

export const AttributionRowSchema = z.object({
  campaignId: z.string(),
  partnerId: z.string().nullable(),
  billingModel: BillingModelSchema,
  shortlisted: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  billableEvents: z.number().int().nonnegative(),
  billedAmount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export const BillingDraftSchema = z.object({
  campaignId: z.string(),
  partnerId: z.string().nullable(),
  billingModel: BillingModelSchema,
  pendingSettlements: z.number().int().nonnegative(),
  settledSettlements: z.number().int().nonnegative(),
  failedSettlements: z.number().int().nonnegative(),
  totalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export const CampaignDraftInputSchema = z.object({
  advertiser: z.string(),
  category: z.string(),
  regions: z.array(z.string()).min(1),
  billingModel: BillingModelSchema,
  payoutAmount: z.number().positive(),
  currency: z.string().length(3),
  budget: z.number().positive(),
  disclosureText: z.string().min(1),
  minTrust: z.number().min(0).max(1).default(0.65),
  product: ProductDraftSchema,
  proofReferences: z.array(ProofReferenceSchema).min(1),
});

export const PolicyDecisionSchema = z.enum(["pass", "fail", "manual_review"]);

export const PolicyCheckResultSchema = z.object({
  policyCheckId: z.string(),
  campaignId: z.string(),
  decision: PolicyDecisionSchema,
  reasons: z.array(z.string()),
  riskFlags: z.array(z.string()),
  checkedAt: z.string().datetime(),
});

export type AgentLead = z.infer<typeof AgentLeadSchema>;
export type AppealCase = z.infer<typeof AppealCaseSchema>;
export type AppealCaseInput = z.infer<typeof AppealCaseInputSchema>;
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;
export type AuditEntityType = z.infer<typeof AuditEntityTypeSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditEventFilter = z.infer<typeof AuditEventFilterSchema>;
export type AuditEventPage = z.infer<typeof AuditEventPageSchema>;
export type AuditStatus = z.infer<typeof AuditStatusSchema>;
export type BillingModel = z.infer<typeof BillingModelSchema>;
export type BillingDraft = z.infer<typeof BillingDraftSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignDraftInput = z.infer<typeof CampaignDraftInputSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
export type DiscoveryRun = z.infer<typeof DiscoveryRunSchema>;
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;
export type DiscoverySourceInput = z.infer<typeof DiscoverySourceInputSchema>;
export type EvidenceAsset = z.infer<typeof EvidenceAssetSchema>;
export type EvidenceAssetInput = z.infer<typeof EvidenceAssetInputSchema>;
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>;
export type EventReceipt = z.infer<typeof EventReceiptSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type MeasurementFunnel = z.infer<typeof MeasurementFunnelSchema>;
export type MeasurementFunnelQuery = z.infer<typeof MeasurementFunnelQuerySchema>;
export type OfferCard = z.infer<typeof OfferCardSchema>;
export type OpportunityRequest = z.infer<typeof OpportunityRequestSchema>;
export type PartnerAgent = z.infer<typeof PartnerAgentSchema>;
export type PolicyCheckResult = z.infer<typeof PolicyCheckResultSchema>;
export type ProductDraft = z.infer<typeof ProductDraftSchema>;
export type ReputationRecord = z.infer<typeof ReputationRecordSchema>;
export type RiskCase = z.infer<typeof RiskCaseSchema>;
export type RiskCaseInput = z.infer<typeof RiskCaseInputSchema>;
export type ScoredBid = z.infer<typeof ScoredBidSchema>;
export type SettlementReceipt = z.infer<typeof SettlementReceiptSchema>;
export type SettlementRetryJob = z.infer<typeof SettlementRetryJobSchema>;
export type SettlementRetryJobFilter = z.infer<typeof SettlementRetryJobFilterSchema>;
export type SettlementDeadLetterEntry = z.infer<typeof SettlementDeadLetterEntrySchema>;
export type SettlementDeadLetterFilter = z.infer<typeof SettlementDeadLetterFilterSchema>;
export type SettlementDeadLetterPage = z.infer<typeof SettlementDeadLetterPageSchema>;
export type VerificationChecklist = z.infer<typeof VerificationChecklistSchema>;
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;
export type AttributionRow = z.infer<typeof AttributionRowSchema>;

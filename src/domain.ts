import { z } from "zod";

export const AppModeSchema = z.enum(["default", "demo", "real_test"]);

export const DataProvenanceSchema = z.enum([
  "demo_seed",
  "demo_bootstrap",
  "real_discovery",
  "real_partner",
  "real_campaign",
  "real_event",
  "sandbox_settlement",
  "ops_manual",
]);

export const PartnerStatusSchema = z.enum([
  "new",
  "reviewing",
  "verified",
  "active",
  "suspended",
]);

export const BillingModelSchema = z.enum(["CPQR", "CPA"]);
export const BuyerAgentTierSchema = z.enum(["A", "B", "C", "unqualified"]);
export const PromotionPlanIdSchema = z.enum(["trial", "starter", "growth", "enterprise"]);
export const WorkspaceSubscriptionStatusSchema = z.enum(["active", "past_due", "cancelled"]);
export const PromotionRunStatusSchema = z.enum(["planned", "completed", "blocked"]);
export const PromotionRunTargetStatusSchema = z.enum([
  "queued",
  "accepted",
  "failed",
  "retry_scheduled",
  "cooldown",
]);
export const CreditLedgerEntryTypeSchema = z.enum([
  "promo_grant",
  "subscription_grant",
  "top_up",
  "coverage_reservation",
  "shortlist_charge",
  "presented_charge",
  "view_charge",
  "interaction_charge",
  "handoff_charge",
  "conversion_charge",
  "adjustment",
  "expiration",
]);

export const CampaignStatusSchema = z.enum([
  "draft",
  "reviewing",
  "active",
  "paused",
  "rejected",
]);

export const EventTypeSchema = z.enum([
  "delivery.sent",
  "delivery.received",
  "delivery.validated",
  "offer.ingested",
  "offer.eligible",
  "offer.shortlisted",
  "offer.presented",
  "owner.viewed",
  "owner.interacted",
  "conversion.attributed",
  "shortlisted",
  "shown",
  "presented",
  "viewed",
  "detail_view",
  "interacted",
  "handoff",
  "conversion",
]);

export const AgentLeadSchema = z.object({
  agentId: z.string(),
  dataOrigin: z.enum(["seed", "discovered"]),
  dataProvenance: DataProvenanceSchema,
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
  supportsDeliveryReceipt: z.boolean().default(false),
  supportsPresentationReceipt: z.boolean().default(false),
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
  lastVerifiedAt: z.string().datetime().nullable().default(null),
  verificationOwner: z.string().nullable().default(null),
  evidenceRef: z.string().nullable().default(null),
  assignedOwner: z.string().nullable(),
  notes: z.string(),
  dedupeKey: z.string(),
  scoreBreakdown: z.object({
    icpFit: z.number().min(0).max(1),
    protocolFit: z.number().min(0).max(1),
    reachFit: z.number().min(0).max(1),
  }),
  buyerIntentCoverage: z.array(z.string()).default([]),
  icpOverlapScore: z.number().min(0).max(1).default(0),
  intentAccessScore: z.number().min(0).max(1).default(0),
  deliveryReadinessScore: z.number().min(0).max(1).default(0),
  historicalQualityScore: z.number().min(0).max(1).default(0),
  commercialReadinessScore: z.number().min(0).max(1).default(0),
  buyerAgentScore: z.number().min(0).max(1).default(0),
  buyerAgentTier: BuyerAgentTierSchema.default("unqualified"),
  isQualifiedBuyerAgent: z.boolean().default(false),
  isCommerciallyEligible: z.boolean().default(false),
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

export const RecruitmentPipelineStageSchema = z.enum([
  "sourced",
  "qualified",
  "outreach",
  "replied",
  "onboarding",
  "verified",
  "ready",
  "promoted",
  "blocked",
]);

export const PipelinePrioritySchema = z.enum(["low", "medium", "high"]);

export const RecruitmentPipelineSchema = z.object({
  pipelineId: z.string(),
  leadId: z.string(),
  dataProvenance: DataProvenanceSchema,
  providerOrg: z.string(),
  stage: RecruitmentPipelineStageSchema,
  priority: PipelinePrioritySchema,
  ownerId: z.string().nullable(),
  targetPersona: z.string().nullable(),
  nextStep: z.string().nullable(),
  lastContactAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const OutreachChannelSchema = z.enum([
  "email",
  "linkedin",
  "partner_intro",
  "form",
  "direct_message",
]);

export const OutreachStatusSchema = z.enum([
  "draft",
  "queued",
  "retry_scheduled",
  "sent",
  "replied",
  "bounced",
  "ignored",
]);

export const OutreachOpenSignalSchema = z.enum(["none", "opened", "engaged"]);

export const OutreachTargetSchema = z.object({
  targetId: z.string(),
  pipelineId: z.string(),
  leadId: z.string(),
  providerOrg: z.string(),
  recommendedCampaignId: z.string().nullable().default(null),
  channel: OutreachChannelSchema,
  contactPoint: z.string(),
  subjectLine: z.string(),
  messageTemplate: z.string(),
  recommendationReason: z.string().nullable().default(null),
  proofHighlights: z.array(z.string()).default([]),
  autoGenerated: z.boolean().default(false),
  status: OutreachStatusSchema,
  ownerId: z.string().nullable(),
  sendAttempts: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().datetime().nullable().default(null),
  nextRetryAt: z.string().datetime().nullable().default(null),
  providerRequestId: z.string().nullable().default(null),
  responseCode: z.string().nullable().default(null),
  openCount: z.number().int().nonnegative().default(0),
  firstOpenedAt: z.string().datetime().nullable().default(null),
  lastOpenedAt: z.string().datetime().nullable().default(null),
  openSignal: OutreachOpenSignalSchema.default("none"),
  lastOpenSource: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  lastSentAt: z.string().datetime().nullable(),
  responseAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const OnboardingTaskTypeSchema = z.enum([
  "identity_verification",
  "auth_setup",
  "disclosure_review",
  "delivery_receipt_test",
  "presentation_receipt_test",
  "sla_review",
  "commercial_terms",
  "follow_up_reminder",
  "second_touch_outreach",
  "retry_outreach",
  "bounce_recovery",
]);

export const OnboardingTaskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);

export const OnboardingTaskSchema = z.object({
  taskId: z.string(),
  pipelineId: z.string(),
  leadId: z.string(),
  taskType: OnboardingTaskTypeSchema,
  status: OnboardingTaskStatusSchema,
  ownerId: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  relatedTargetId: z.string().nullable().default(null),
  autoGenerated: z.boolean().default(false),
  evidenceRef: z.string().nullable(),
  notes: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PartnerReadinessStatusSchema = z.enum([
  "observation",
  "recruiting",
  "onboarding",
  "ready",
  "blocked",
]);

export const PartnerReadinessSchema = z.object({
  readinessId: z.string(),
  pipelineId: z.string(),
  leadId: z.string(),
  overallStatus: PartnerReadinessStatusSchema,
  readinessScore: z.number().min(0).max(1),
  checklist: z.object({
    identity: z.boolean(),
    auth: z.boolean(),
    disclosure: z.boolean(),
    deliveryReceipt: z.boolean(),
    presentationReceipt: z.boolean(),
    sla: z.boolean(),
    commercialTerms: z.boolean(),
  }),
  blockers: z.array(z.string()),
  lastEvaluatedAt: z.string().datetime(),
});

export const VerificationChecklistSchema = z.object({
  identity: z.boolean(),
  auth: z.boolean(),
  disclosure: z.boolean(),
  sla: z.boolean(),
  rateLimit: z.boolean(),
});

export const OutreachTargetInputSchema = z.object({
  recommendedCampaignId: z.string().nullable().optional(),
  channel: OutreachChannelSchema,
  contactPoint: z.string().min(1),
  subjectLine: z.string().min(1).optional(),
  messageTemplate: z.string().min(1),
  recommendationReason: z.string().nullable().optional(),
  proofHighlights: z.array(z.string()).optional(),
  ownerId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const OnboardingTaskInputSchema = z.object({
  taskType: OnboardingTaskTypeSchema,
  ownerId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  relatedTargetId: z.string().nullable().optional(),
  evidenceRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const RecruitmentPipelineUpdateSchema = z.object({
  stage: RecruitmentPipelineStageSchema,
  ownerId: z.string().nullable().optional(),
  priority: PipelinePrioritySchema.optional(),
  targetPersona: z.string().nullable().optional(),
  nextStep: z.string().nullable().optional(),
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
  dataProvenance: DataProvenanceSchema,
  providerOrg: z.string(),
  endpoint: z.string().url(),
  status: PartnerStatusSchema,
  supportedCategories: z.array(z.string()),
  acceptsSponsored: z.boolean(),
  supportsDisclosure: z.boolean(),
  supportsDeliveryReceipt: z.boolean().default(false),
  supportsPresentationReceipt: z.boolean().default(false),
  lastVerifiedAt: z.string().datetime().nullable().default(null),
  verificationOwner: z.string().nullable().default(null),
  evidenceRef: z.string().nullable().default(null),
  trustScore: z.number().min(0).max(1),
  authModes: z.array(z.string()),
  slaTier: z.string(),
  buyerIntentCoverage: z.array(z.string()).default([]),
  icpOverlapScore: z.number().min(0).max(1).default(0),
  intentAccessScore: z.number().min(0).max(1).default(0),
  deliveryReadinessScore: z.number().min(0).max(1).default(0),
  historicalQualityScore: z.number().min(0).max(1).default(0),
  commercialReadinessScore: z.number().min(0).max(1).default(0),
  buyerAgentScore: z.number().min(0).max(1).default(0),
  buyerAgentTier: BuyerAgentTierSchema.default("unqualified"),
  isQualifiedBuyerAgent: z.boolean().default(false),
  isCommerciallyEligible: z.boolean().default(false),
});

export const LinkBundleSchema = z.object({
  homepageUrl: z.string().url(),
  productDetailUrl: z.string().url(),
  proofUrl: z.string().url(),
  conversionUrl: z.string().url(),
  contactUrl: z.string().url().nullable().optional().default(null),
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
  dataProvenance: DataProvenanceSchema,
  workspaceId: z.string().default("workspace_default"),
  promotionPlanId: PromotionPlanIdSchema.default("trial"),
  advertiser: z.string(),
  externalRef: z.string().nullable(),
  sourceDocumentUrl: z.string().url().nullable(),
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
  linkBundle: LinkBundleSchema,
  offer: OfferCardSchema,
  proofBundle: ProofBundleSchema,
});

export const OpportunityRequestSchema = z.object({
  workspaceId: z.string().optional(),
  promotionRunId: z.string().optional(),
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
  specVersion: z.string().default("1.0"),
  eventId: z.string().optional(),
  receiptId: z.string(),
  dataProvenance: DataProvenanceSchema,
  promotionRunId: z.string().nullable().optional(),
  traceId: z.string().optional(),
  correlationId: z.string().nullable().optional(),
  producerAgentId: z.string().optional(),
  consumerAgentId: z.string().nullable().optional(),
  buyerAgentId: z.string().optional(),
  sellerAgentId: z.string().nullable().optional(),
  opportunityId: z.string().optional(),
  intentId: z.string(),
  offerId: z.string(),
  campaignId: z.string(),
  deliveryId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  partnerId: z.string(),
  eventType: EventTypeSchema,
  environment: z.enum(["prod", "staging", "test"]).default("test"),
  ownerSessionRef: z.string().nullable().optional(),
  actionId: z.string().nullable().optional(),
  interactionType: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
  signature: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const SettlementReceiptSchema = z.object({
  settlementId: z.string(),
  dataProvenance: DataProvenanceSchema,
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
  mode: AppModeSchema,
  workspaceId: z.string().default("workspace_default"),
  currentPlanId: PromotionPlanIdSchema.default("trial"),
  availableCredits: z.number().nonnegative().default(0),
  consumedCredits: z.number().nonnegative().default(0),
  touchedBuyerAgents: z.number().int().nonnegative().default(0),
  buyerAgentTierCounts: z.record(BuyerAgentTierSchema, z.number().int().nonnegative()).default({
    A: 0,
    B: 0,
    C: 0,
    unqualified: 0,
  }),
  activePartners: z.number().int().nonnegative(),
  activeCampaigns: z.number().int().nonnegative(),
  eventCounts: z.record(z.string(), z.number().int().nonnegative()),
  settlementCount: z.number().int().nonnegative(),
  qualifiedRecommendationRate: z.number().min(0).max(1),
  detailViewRate: z.number().min(0).max(1),
  handoffRate: z.number().min(0).max(1),
  actionConversionRate: z.number().min(0).max(1),
  disclosureShownRate: z.number().min(0).max(1),
  qualifiedAgentCoverage: z.number().int().nonnegative(),
  countsByProvenance: z.record(DataProvenanceSchema, z.number().int().nonnegative()),
});

export const AuditEntityTypeSchema = z.enum([
  "campaign",
  "policy_check",
  "opportunity",
  "delivery",
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
  dataProvenance: DataProvenanceSchema,
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
  provenance: z.string().optional(),
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
  dataProvenance: DataProvenanceSchema,
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
  dataProvenance: DataProvenanceSchema.optional(),
  verifiedBy: z.string().nullable().optional(),
  verificationNote: z.string().nullable().optional(),
});

export const RiskCaseSchema = z.object({
  caseId: z.string(),
  dataProvenance: DataProvenanceSchema,
  entityType: z.enum(["campaign", "partner", "agent_lead", "settlement", "receipt"]),
  entityId: z.string(),
  entityProvenance: DataProvenanceSchema.nullable(),
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
  dataProvenance: DataProvenanceSchema.optional(),
  entityProvenance: DataProvenanceSchema.nullable().optional(),
  reasonType: z.enum(["claim_mismatch", "disclosure_missing", "spam", "high_complaint", "policy_violation"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  ownerId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const ReputationRecordSchema = z.object({
  recordId: z.string(),
  dataProvenance: DataProvenanceSchema,
  partnerId: z.string(),
  delta: z.number(),
  reasonType: z.enum(["claim_mismatch", "disclosure_missing", "spam", "high_complaint", "manual_adjustment"]),
  evidenceRefs: z.array(z.string()),
  disputeStatus: z.enum(["none", "under_review", "resolved", "overturned"]),
  occurredAt: z.string().datetime(),
});

export const AppealCaseSchema = z.object({
  appealId: z.string(),
  dataProvenance: DataProvenanceSchema,
  partnerId: z.string(),
  targetRecordId: z.string(),
  targetRecordProvenance: DataProvenanceSchema.nullable(),
  status: z.enum(["open", "reviewing", "approved", "rejected"]),
  statement: z.string(),
  openedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
});

export const AppealCaseInputSchema = z.object({
  partnerId: z.string(),
  targetRecordId: z.string(),
  dataProvenance: DataProvenanceSchema.optional(),
  targetRecordProvenance: DataProvenanceSchema.nullable().optional(),
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
  presented: z.number().int().nonnegative(),
  detailView: z.number().int().nonnegative(),
  handoff: z.number().int().nonnegative(),
  conversion: z.number().int().nonnegative(),
  detailViewRate: z.number().min(0).max(1),
  handoffRate: z.number().min(0).max(1),
  actionConversionRate: z.number().min(0).max(1),
});

export const BuyerAgentScorecardSchema = z.object({
  scorecardId: z.string(),
  leadId: z.string(),
  partnerId: z.string().nullable(),
  providerOrg: z.string(),
  dataProvenance: DataProvenanceSchema,
  buyerIntentCoverage: z.array(z.string()),
  icpOverlapScore: z.number().min(0).max(1),
  intentAccessScore: z.number().min(0).max(1),
  deliveryReadinessScore: z.number().min(0).max(1),
  historicalQualityScore: z.number().min(0).max(1),
  commercialReadinessScore: z.number().min(0).max(1),
  buyerAgentScore: z.number().min(0).max(1),
  buyerAgentTier: BuyerAgentTierSchema,
  isQualifiedBuyerAgent: z.boolean(),
  isCommerciallyEligible: z.boolean(),
  verificationStatus: PartnerStatusSchema,
  supportsDisclosure: z.boolean(),
  acceptsSponsored: z.boolean(),
  supportsDeliveryReceipt: z.boolean(),
  supportsPresentationReceipt: z.boolean(),
  lastVerifiedAt: z.string().datetime().nullable().default(null),
  verificationOwner: z.string().nullable().default(null),
  evidenceRef: z.string().nullable().default(null),
  endpointUrl: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
});

export const PromotionPlanSchema = z.object({
  planId: PromotionPlanIdSchema,
  name: z.string(),
  maxQualifiedBuyerAgentsPerWave: z.number().int().positive(),
  maxActiveCampaigns: z.number().int().positive(),
  maxConcurrentPromotionRuns: z.number().int().positive(),
  coveragePriority: z.number().int().positive(),
  includedCreditsPerCycle: z.number().int().nonnegative(),
});

export const WorkspaceWalletSchema = z.object({
  workspaceId: z.string(),
  availableCredits: z.number().nonnegative(),
  reservedCredits: z.number().nonnegative(),
  consumedCredits: z.number().nonnegative(),
  expiredCredits: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const CreditLedgerEntrySchema = z.object({
  entryId: z.string(),
  workspaceId: z.string(),
  entryType: CreditLedgerEntryTypeSchema,
  amount: z.number(),
  balanceAfter: z.number().nonnegative(),
  source: z.string(),
  campaignId: z.string().nullable(),
  promotionRunId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

export const WorkspaceSubscriptionSchema = z.object({
  workspaceId: z.string(),
  planId: PromotionPlanIdSchema,
  status: WorkspaceSubscriptionStatusSchema,
  includedCreditsPerCycle: z.number().int().nonnegative(),
  cycleStartAt: z.string().datetime(),
  cycleEndAt: z.string().datetime(),
});

export const PromotionRunSchema = z.object({
  promotionRunId: z.string(),
  workspaceId: z.string(),
  campaignId: z.string(),
  planId: PromotionPlanIdSchema,
  status: PromotionRunStatusSchema,
  requestedCategory: z.string(),
  taskType: z.string(),
  constraints: z.record(z.string(), z.unknown()),
  qualifiedBuyerAgentsCount: z.number().int().nonnegative(),
  coverageCreditsCharged: z.number().int().nonnegative(),
  acceptedBuyerAgentsCount: z.number().int().nonnegative().default(0),
  failedBuyerAgentsCount: z.number().int().nonnegative().default(0),
  shortlistedCount: z.number().int().nonnegative(),
  handoffCount: z.number().int().nonnegative(),
  conversionCount: z.number().int().nonnegative(),
  selectedPartnerIds: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PromotionRunTargetSchema = z.object({
  targetId: z.string(),
  promotionRunId: z.string(),
  workspaceId: z.string(),
  campaignId: z.string(),
  partnerId: z.string(),
  providerOrg: z.string(),
  endpointUrl: z.string().url(),
  buyerAgentTier: BuyerAgentTierSchema,
  buyerAgentScore: z.number().min(0).max(1),
  deliveryReadinessScore: z.number().min(0).max(1),
  status: PromotionRunTargetStatusSchema,
  supportedCategories: z.array(z.string()),
  lastAttemptAt: z.string().datetime().nullable(),
  dispatchAttempts: z.number().int().nonnegative(),
  cooldownUntil: z.string().datetime().nullable().default(null),
  nextRetryAt: z.string().datetime().nullable().default(null),
  protocol: z.enum(["simulated", "a2a_http", "mcp_http", "generic_http"]).nullable().default(null),
  remoteRequestId: z.string().nullable().default(null),
  responseCode: z.string().nullable().default(null),
  lastError: z.string().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DeliveryMetricsSchema = z.object({
  workspaceId: z.string(),
  promotionRunId: z.string().nullable(),
  totalTargets: z.number().int().nonnegative(),
  attemptedTargets: z.number().int().nonnegative(),
  dispatchAttempts: z.number().int().nonnegative(),
  respondedTargets: z.number().int().nonnegative(),
  acceptedTargets: z.number().int().nonnegative(),
  failedTargets: z.number().int().nonnegative(),
  retryScheduledTargets: z.number().int().nonnegative(),
  coolingDownTargets: z.number().int().nonnegative(),
  dispatchSuccessRate: z.number().min(0).max(1),
  acceptanceRate: z.number().min(0).max(1),
  failureReasonBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  cooldownAgents: z.array(
    z.object({
      partnerId: z.string(),
      providerOrg: z.string(),
      status: PromotionRunTargetStatusSchema,
      cooldownUntil: z.string().datetime().nullable(),
      nextRetryAt: z.string().datetime().nullable(),
      dispatchAttempts: z.number().int().nonnegative(),
      lastError: z.string().nullable(),
    }),
  ),
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
  workspaceId: z.string().optional(),
  promotionPlanId: PromotionPlanIdSchema.optional(),
  advertiser: z.string(),
  externalRef: z.string().nullable().optional(),
  sourceDocumentUrl: z.string().url().nullable().optional(),
  category: z.string(),
  regions: z.array(z.string()).min(1),
  billingModel: BillingModelSchema,
  payoutAmount: z.number().positive(),
  currency: z.string().length(3),
  budget: z.number().positive(),
  disclosureText: z.string().min(1),
  minTrust: z.number().min(0).max(1).default(0.65),
  product: ProductDraftSchema,
  linkBundle: LinkBundleSchema.optional(),
  proofReferences: z.array(ProofReferenceSchema).min(1),
});

export const SystemRuntimeProfileSchema = z.object({
  mode: AppModeSchema,
  persistence: z.enum(["memory", "postgres"]),
  hotState: z.enum(["memory", "redis"]),
  billingMode: z.enum(["simulated", "http"]),
  demoEnabled: z.boolean(),
  realDataOnly: z.boolean(),
  defaultLeadFilter: z.array(DataProvenanceSchema),
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
export type AppMode = z.infer<typeof AppModeSchema>;
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
export type BuyerAgentScorecard = z.infer<typeof BuyerAgentScorecardSchema>;
export type BuyerAgentTier = z.infer<typeof BuyerAgentTierSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignDraftInput = z.infer<typeof CampaignDraftInputSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;
export type DeliveryMetrics = z.infer<typeof DeliveryMetricsSchema>;
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
export type DataProvenance = z.infer<typeof DataProvenanceSchema>;
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
export type PromotionPlan = z.infer<typeof PromotionPlanSchema>;
export type PromotionPlanId = z.infer<typeof PromotionPlanIdSchema>;
export type PromotionRun = z.infer<typeof PromotionRunSchema>;
export type PromotionRunTarget = z.infer<typeof PromotionRunTargetSchema>;
export type RecruitmentPipeline = z.infer<typeof RecruitmentPipelineSchema>;
export type RecruitmentPipelineStage = z.infer<typeof RecruitmentPipelineStageSchema>;
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
export type SystemRuntimeProfile = z.infer<typeof SystemRuntimeProfileSchema>;
export type VerificationChecklist = z.infer<typeof VerificationChecklistSchema>;
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;
export type AttributionRow = z.infer<typeof AttributionRowSchema>;
export type WorkspaceSubscription = z.infer<typeof WorkspaceSubscriptionSchema>;
export type WorkspaceWallet = z.infer<typeof WorkspaceWalletSchema>;
export type OutreachTarget = z.infer<typeof OutreachTargetSchema>;
export type OutreachTargetInput = z.infer<typeof OutreachTargetInputSchema>;
export type OnboardingTask = z.infer<typeof OnboardingTaskSchema>;
export type OnboardingTaskInput = z.infer<typeof OnboardingTaskInputSchema>;
export type PartnerReadiness = z.infer<typeof PartnerReadinessSchema>;
export type RecruitmentPipelineUpdate = z.infer<typeof RecruitmentPipelineUpdateSchema>;

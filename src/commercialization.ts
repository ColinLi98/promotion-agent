import crypto from "node:crypto";

import {
  BuyerAgentScorecardSchema,
  type AgentLead,
  type AppMode,
  type BuyerAgentScorecard,
  type CreditLedgerEntry,
  CreditLedgerEntrySchema,
  type DataProvenance,
  type EventReceipt,
  type PartnerAgent,
  PromotionPlanIdSchema,
  PromotionPlanSchema,
  type PromotionPlan,
  type SettlementReceipt,
  type WorkspaceSubscription,
  WorkspaceSubscriptionSchema,
  type WorkspaceWallet,
  WorkspaceWalletSchema,
} from "./domain.js";

export const DEFAULT_WORKSPACE_BY_MODE: Record<AppMode, string> = {
  default: "workspace_default",
  demo: "workspace_demo",
  real_test: "workspace_real_test",
};

export const PROMOTION_PLANS: PromotionPlan[] = [
  {
    planId: "trial",
    name: "Trial",
    maxQualifiedBuyerAgentsPerWave: 25,
    maxActiveCampaigns: 1,
    maxConcurrentPromotionRuns: 1,
    coveragePriority: 1,
    includedCreditsPerCycle: 0,
  },
  {
    planId: "starter",
    name: "Starter",
    maxQualifiedBuyerAgentsPerWave: 100,
    maxActiveCampaigns: 3,
    maxConcurrentPromotionRuns: 3,
    coveragePriority: 2,
    includedCreditsPerCycle: 500,
  },
  {
    planId: "growth",
    name: "Growth",
    maxQualifiedBuyerAgentsPerWave: 500,
    maxActiveCampaigns: 10,
    maxConcurrentPromotionRuns: 10,
    coveragePriority: 3,
    includedCreditsPerCycle: 2500,
  },
  {
    planId: "enterprise",
    name: "Enterprise",
    maxQualifiedBuyerAgentsPerWave: 2000,
    maxActiveCampaigns: 999,
    maxConcurrentPromotionRuns: 20,
    coveragePriority: 4,
    includedCreditsPerCycle: 10000,
  },
].map((plan) => PromotionPlanSchema.parse(plan));

export const CREDIT_CHARGES = {
  coverageReservationPerTenAgents: 1,
  shortlisted: 2,
  presented: 2,
  viewed: 3,
  interacted: 5,
  handoff: 5,
  conversion: 10,
  promoGrant: 100,
  promoGrantDays: 30,
} as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const buildBuyerIntentCoverage = (lead: AgentLead) =>
  [...new Set([...lead.verticals, ...lead.skills])];

export const scoreBuyerAgent = (
  lead: AgentLead,
  partner: PartnerAgent | null,
  receipts: EventReceipt[],
  settlements: SettlementReceipt[],
): BuyerAgentScorecard => {
  const supportsDisclosure = partner?.supportsDisclosure ?? lead.supportsDisclosure;
  const acceptsSponsored = partner?.acceptsSponsored ?? lead.acceptsSponsored;
  const supportsDeliveryReceipt = partner?.supportsDeliveryReceipt ?? lead.supportsDeliveryReceipt;
  const supportsPresentationReceipt = partner?.supportsPresentationReceipt ?? lead.supportsPresentationReceipt;
  const verificationStatus = partner?.status ?? lead.verificationStatus;
  const buyerIntentCoverage = buildBuyerIntentCoverage(lead);
  const icpOverlapScore = clamp(0.55 * lead.scoreBreakdown.icpFit + 0.45 * lead.leadScore);
  const intentAccessScore = clamp(
    0.45 * (buyerIntentCoverage.length > 0 ? 1 : 0) +
      0.35 * (lead.skills.length > 0 ? 1 : 0) +
      0.2 * (lead.verticals.length > 0 ? 1 : 0),
  );
  const deliveryReadinessScore = clamp(
    0.35 * Number(Boolean(lead.endpointUrl)) +
      0.2 * Number(lead.authModes.length > 0) +
      0.2 * Number(lead.supportsDisclosure) +
      0.1 * Number(lead.supportsDeliveryReceipt) +
      0.1 * Number(lead.supportsPresentationReceipt) +
      0.15 * Number(lead.acceptsSponsored) +
      0.1 * Number(lead.verificationStatus === "verified" || lead.verificationStatus === "active"),
  );
  const relatedReceipts = partner
    ? receipts.filter((receipt) => receipt.partnerId === partner.partnerId)
    : [];
  const relatedSettlements = partner
    ? settlements.filter((settlement) => settlement.partnerId === partner.partnerId)
    : [];
  const historicalQualityScore = clamp(
    relatedReceipts.length === 0
      ? 0.5
      : 0.35 +
          Math.min(0.4, relatedReceipts.length * 0.03) +
          Math.min(0.25, relatedSettlements.filter((item) => item.status === "settled").length * 0.05),
  );
  const commercialReadinessScore = clamp(
    0.3 * Number(supportsDisclosure) +
      0.15 * Number(supportsDeliveryReceipt) +
      0.1 * Number(supportsPresentationReceipt) +
      0.25 * Number(acceptsSponsored) +
      0.1 * Number(lead.authModes.length > 0) +
      0.1 * (partner?.trustScore ?? lead.trustSeed),
  );
  const buyerAgentScore = clamp(
    0.3 * icpOverlapScore +
      0.25 * intentAccessScore +
      0.2 * deliveryReadinessScore +
      0.15 * historicalQualityScore +
      0.1 * commercialReadinessScore,
  );
  const buyerAgentTier =
    buyerAgentScore >= 0.85 ? "A" : buyerAgentScore >= 0.75 ? "B" : buyerAgentScore >= 0.65 ? "C" : "unqualified";
  const isQualifiedBuyerAgent =
    lead.endpointUrl !== null &&
    lead.authModes.length > 0 &&
    supportsDisclosure &&
    supportsDeliveryReceipt &&
    supportsPresentationReceipt &&
    acceptsSponsored &&
    (partner?.trustScore ?? lead.trustSeed) >= 0.65 &&
    ["verified", "active"].includes(verificationStatus);
  const isCommerciallyEligible = isQualifiedBuyerAgent && buyerAgentTier !== "unqualified";

  return BuyerAgentScorecardSchema.parse({
    scorecardId: `score_${crypto.createHash("sha1").update(`${lead.agentId}:${partner?.partnerId ?? "-"}`).digest("hex").slice(0, 12)}`,
    leadId: lead.agentId,
    partnerId: partner?.partnerId ?? null,
    providerOrg: lead.providerOrg,
    dataProvenance: partner?.dataProvenance ?? lead.dataProvenance,
    buyerIntentCoverage,
    icpOverlapScore,
    intentAccessScore,
    deliveryReadinessScore,
    historicalQualityScore,
    commercialReadinessScore,
    buyerAgentScore,
    buyerAgentTier,
    isQualifiedBuyerAgent,
    isCommerciallyEligible,
    verificationStatus,
    supportsDisclosure,
    acceptsSponsored,
    supportsDeliveryReceipt,
    supportsPresentationReceipt,
    lastVerifiedAt: partner?.lastVerifiedAt ?? lead.lastVerifiedAt,
    verificationOwner: partner?.verificationOwner ?? lead.verificationOwner,
    evidenceRef: partner?.evidenceRef ?? lead.evidenceRef,
    endpointUrl: lead.endpointUrl,
    updatedAt: new Date().toISOString(),
  });
};

export const defaultWorkspaceWallet = (workspaceId: string) =>
  WorkspaceWalletSchema.parse({
    workspaceId,
    availableCredits: CREDIT_CHARGES.promoGrant,
    reservedCredits: 0,
    consumedCredits: 0,
    expiredCredits: 0,
    updatedAt: new Date().toISOString(),
  });

export const defaultWorkspaceSubscription = (workspaceId: string) => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + CREDIT_CHARGES.promoGrantDays);
  return WorkspaceSubscriptionSchema.parse({
    workspaceId,
    planId: PromotionPlanIdSchema.parse("trial"),
    status: "active",
    includedCreditsPerCycle: 0,
    cycleStartAt: start.toISOString(),
    cycleEndAt: end.toISOString(),
  });
};

export const createCreditLedgerEntry = (
  partial: Omit<CreditLedgerEntry, "entryId" | "occurredAt">,
) =>
  CreditLedgerEntrySchema.parse({
    entryId: `cred_${crypto.randomUUID().slice(0, 10)}`,
    occurredAt: new Date().toISOString(),
    ...partial,
  });

import crypto from "node:crypto";

import type { Campaign, OpportunityRequest, PartnerAgent, ScoredBid } from "./domain.js";

type Candidate = {
  campaign: Campaign;
  partner: PartnerAgent;
  relevance: number;
  expectedUtility: number;
  affectiveFit: number;
  trustScore: number;
  bidValue: number;
  policyPass: boolean;
  disclosureReady: boolean;
  eligible: boolean;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const geoFit = (request: OpportunityRequest, campaign: Campaign) => {
  const geoConstraints = asStringArray(request.constraints.geo);
  if (geoConstraints.length === 0) {
    return 1;
  }

  return geoConstraints.some((geo) => campaign.regions.includes(geo)) ? 1 : 0.35;
};

const narrativeCoverage = (campaign: Campaign) => {
  const narratives = Object.values(campaign.offer.narrativeVariants).filter(Boolean);
  return clamp(narratives.length / 3);
};

const freshnessScore = (campaign: Campaign) => {
  const updatedAt = new Date(campaign.proofBundle.updatedAt).getTime();
  const ageInDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);

  if (ageInDays <= 30) {
    return 1;
  }
  if (ageInDays <= 90) {
    return 0.85;
  }
  if (ageInDays <= 180) {
    return 0.7;
  }

  return 0.55;
};

const hasTaskCoverage = (request: OpportunityRequest, campaign: Campaign) =>
  campaign.offer.intendedFor.includes(request.taskType);

const partnerTargetingMatch = (campaign: Campaign, partner: PartnerAgent) =>
  campaign.targetingPartnerIds.length === 0 || campaign.targetingPartnerIds.includes(partner.partnerId);

export const scoreCampaignForRequest = (
  request: OpportunityRequest,
  campaign: Campaign,
  partner: PartnerAgent,
): Candidate => {
  const categoryMatch = request.category === campaign.category ? 1 : 0.42;
  const taskCoverage = hasTaskCoverage(request, campaign) ? 1 : 0.7;
  const regionCoverage = geoFit(request, campaign);
  const targetingCoverage = partnerTargetingMatch(campaign, partner) ? 1 : 0.5;
  const proofFreshness = freshnessScore(campaign);
  const trustScore = clamp((partner.trustScore + proofFreshness) / 2);
  const relevance = clamp(0.55 * categoryMatch + 0.2 * taskCoverage + 0.15 * regionCoverage + 0.1 * targetingCoverage);
  const expectedUtility = clamp(0.45 * relevance + 0.2 * regionCoverage + 0.2 * proofFreshness + 0.15 * taskCoverage);
  const affectiveFit = clamp(0.6 * narrativeCoverage(campaign) + 0.4 * taskCoverage);
  const receiptReady = partner.supportsDeliveryReceipt && partner.supportsPresentationReceipt;
  const policyPass = campaign.status === "active" && campaign.policyPass && partner.status === "active" && receiptReady;
  const disclosureReady = !request.disclosureRequired || Boolean(campaign.disclosureText && partner.supportsDisclosure);
  const eligible =
    policyPass &&
    disclosureReady &&
    relevance >= request.relevanceFloor &&
    expectedUtility >= request.utilityFloor &&
    trustScore >= campaign.minTrust;

  return {
    campaign,
    partner,
    relevance,
    expectedUtility,
    affectiveFit,
    trustScore,
    bidValue: campaign.payoutAmount,
    policyPass,
    disclosureReady,
    eligible,
  };
};

const rankingReasonFor = (candidate: Candidate, score: number) => {
  const checks = [
    `relevance=${candidate.relevance.toFixed(2)}`,
    `utility=${candidate.expectedUtility.toFixed(2)}`,
    `trust=${candidate.trustScore.toFixed(2)}`,
    `affective_fit=${candidate.affectiveFit.toFixed(2)}`,
    `bid=${candidate.bidValue.toFixed(2)}`,
    `priority_score=${score.toFixed(2)}`,
  ];

  return `Passed gates and ranked by ${checks.join(", ")}.`;
};

export const rankEligibleCampaigns = (
  request: OpportunityRequest,
  campaigns: Campaign[],
  partners: PartnerAgent[],
): ScoredBid[] => {
  const activePartners = partners.filter(
    (partner) =>
      partner.status === "active" &&
      partner.acceptsSponsored &&
      partner.supportsDisclosure &&
      partner.supportsDeliveryReceipt &&
      partner.supportsPresentationReceipt,
  );
  const candidates = campaigns.flatMap((campaign) =>
    activePartners
      .filter((partner) => partner.supportedCategories.includes(request.category))
      .map((partner) => scoreCampaignForRequest(request, campaign, partner)),
  );
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const maxBid = Math.max(1, ...eligible.map((candidate) => candidate.bidValue));

  return eligible
    .map((candidate) => {
      const bidNorm = clamp(candidate.bidValue / maxBid);
      const priorityScore = clamp(
        0.35 * candidate.relevance +
          0.25 * candidate.expectedUtility +
          0.15 * candidate.trustScore +
          0.15 * candidate.affectiveFit +
          0.1 * bidNorm,
      );

      return {
        bidId: crypto.randomUUID(),
        offerId: candidate.campaign.offer.offerId,
        campaignId: candidate.campaign.campaignId,
        partnerId: candidate.partner.partnerId,
        bidValue: candidate.bidValue,
        expectedUtility: candidate.expectedUtility,
        affectiveFit: candidate.affectiveFit,
        trustScore: candidate.trustScore,
        relevance: candidate.relevance,
        priorityScore,
        disclosureText: candidate.campaign.disclosureText,
        rankingReason: rankingReasonFor(candidate, priorityScore),
        actionEndpoints: candidate.campaign.offer.actionEndpoints,
        proofBundleRef: candidate.campaign.proofBundle.proofBundleId,
        auditTraceId: crypto.randomUUID(),
        sponsoredFlag: true as const,
        ttlSeconds: 300,
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);
};

export const shortlistCampaigns = (
  request: OpportunityRequest,
  campaigns: Campaign[],
  partners: PartnerAgent[],
): ScoredBid[] => rankEligibleCampaigns(request, campaigns, partners).slice(0, request.sponsoredSlots);

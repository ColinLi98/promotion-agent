import crypto from "node:crypto";

import { PolicyCheckResultSchema, type Campaign, type PolicyCheckResult } from "./domain.js";

const HIGH_RISK_PATTERNS = [
  /100%/i,
  /guaranteed?/i,
  /best price/i,
  /no risk/i,
  /治愈/u,
  /稳赚/u,
];

const ageInDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);

export const runPolicyCheck = (campaign: Campaign): PolicyCheckResult => {
  const failReasons: string[] = [];
  const riskFlags: string[] = [];

  if (!campaign.disclosureText.trim()) {
    failReasons.push("Disclosure text is required before activation.");
  }

  if (campaign.offer.claims.length === 0) {
    failReasons.push("At least one product claim is required.");
  }

  if (campaign.offer.actionEndpoints.length === 0) {
    failReasons.push("At least one action endpoint is required.");
  }

  if (campaign.proofBundle.references.length === 0) {
    failReasons.push("Proof bundle cannot be empty.");
  }

  if (campaign.offer.price <= 0) {
    failReasons.push("Offer price must be greater than zero for MVP activation.");
  }

  const hasHighRiskClaim = campaign.offer.claims.some((claim) =>
    HIGH_RISK_PATTERNS.some((pattern) => pattern.test(claim)),
  );
  if (hasHighRiskClaim) {
    riskFlags.push("high_risk_claim_language");
  }

  if (ageInDays(campaign.proofBundle.updatedAt) > 180) {
    riskFlags.push("stale_proof_bundle");
  }

  if (campaign.billingModel === "CPA" && campaign.payoutAmount > 1500) {
    riskFlags.push("high_payout_requires_manual_review");
  }

  const decision =
    failReasons.length > 0 ? "fail" : riskFlags.length > 0 ? "manual_review" : "pass";

  return PolicyCheckResultSchema.parse({
    policyCheckId: `pol_${crypto.randomUUID().slice(0, 8)}`,
    campaignId: campaign.campaignId,
    decision,
    reasons: failReasons.length > 0 ? failReasons : ["Policy checks passed."],
    riskFlags,
    checkedAt: new Date().toISOString(),
  });
};

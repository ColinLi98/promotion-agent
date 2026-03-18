import http from "node:http";

import { describe, expect, it } from "vitest";

import { buildDemoSeedData } from "../src/demo-seed.js";
import {
  canonicalizeEventType,
} from "../src/event-contract.js";
import { HttpBuyerAgentDeliveryGateway } from "../src/http-buyer-agent-delivery.js";
import { SimulatedOutreachSenderGateway } from "../src/outreach-sender.js";
import { buildServer } from "../src/server.js";
import { buildSeedData } from "../src/seed.js";
import { SmtpOutreachSenderGateway } from "../src/smtp-outreach-sender.js";
import { createStore } from "../src/store.js";

const buildCanonicalReceiptPayload = ({
  receiptId,
  dataProvenance = "demo_bootstrap",
  promotionRunId = null,
  intentId,
  offerId,
  campaignId,
  partnerId,
  eventType,
}: {
  receiptId: string;
  dataProvenance?: string;
  promotionRunId?: string | null;
  intentId: string;
  offerId: string;
  campaignId: string;
  partnerId: string;
  eventType: string;
}) => {
  const canonicalType = canonicalizeEventType(eventType as never);
  return {
    receiptId,
    eventId: receiptId,
    specVersion: "1.0",
    dataProvenance,
    promotionRunId,
    traceId: intentId,
    opportunityId: intentId,
    intentId,
    offerId,
    campaignId,
    buyerAgentId: partnerId,
    partnerId,
    producerAgentId: partnerId,
    sellerAgentId: "promotion-agent",
    deliveryId: promotionRunId,
    environment: "test",
    eventType: canonicalType,
    occurredAt: "2026-03-11T10:00:00.000Z",
    signature: "sig_test",
    payload: {
      ownerSessionRef: `owner_${intentId}`,
      interactionType:
        canonicalType === "owner.viewed"
          ? "view"
          : canonicalType === "owner.interacted"
            ? "click"
            : canonicalType === "conversion.attributed"
              ? "conversion"
              : null,
    },
  };
};

const buildCampaignDraftPayload = (
  overrides: Partial<{
    workspaceId: string;
    advertiser: string;
    category: string;
    regions: string[];
    billingModel: "CPQR" | "CPA";
    payoutAmount: number;
    currency: string;
    budget: number;
    disclosureText: string;
    minTrust: number;
    opcProfileId: string | null;
    product: {
      name: string;
      description: string;
      price: number;
      currency: string;
      intendedFor: string[];
      constraints: Record<string, unknown>;
      claims: string[];
      actionEndpoints: string[];
      positioningBullets: string[];
    };
    proofReferences: Array<{ label: string; type: "doc" | "faq" | "case_study" | "certificate" | "screenshot"; url: string }>;
  }> = {},
) => ({
  advertiser: "PipelineOS",
  category: "crm_software",
  regions: ["UK"],
  billingModel: "CPQR" as const,
  payoutAmount: 180,
  currency: "USD",
  budget: 9000,
  disclosureText: "Sponsored recommendation from PipelineOS.",
  minTrust: 0.66,
  opcProfileId: null,
  product: {
    name: "PipelineOS CRM",
    description: "CRM designed for mid-market revenue teams that need clear forecasting and handoff workflows.",
    price: 599,
    currency: "USD",
    intendedFor: ["compare_and_shortlist", "vendor_discovery"],
    constraints: {
      company_size: "50-300",
    },
    claims: ["SOC 2 Type II", "Guided onboarding included"],
    actionEndpoints: ["https://api.pipelineos.io/demo-request"],
    positioningBullets: ["forecast accuracy", "handoff workflows"],
  },
  proofReferences: [
    {
      label: "Security overview",
      type: "doc" as const,
      url: "https://pipelineos.io/security",
    },
  ],
  ...overrides,
});

describe("promotion-agent MVP flow", () => {
  it("creates a draft campaign, passes policy, activates it, and exposes it to opportunity exchange", async () => {
    const app = buildServer(createStore());

    const creation = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: buildCampaignDraftPayload(),
    });

    expect(creation.statusCode).toBe(201);
    const created = creation.json();
    expect(created.campaign.status).toBe("reviewing");
    expect(created.policyCheck.decision).toBe("pass");

    const activation = await app.inject({
      method: "POST",
      url: `/campaigns/${created.campaign.campaignId}/activate`,
    });

    expect(activation.statusCode).toBe(200);
    expect(activation.json().campaign.status).toBe("active");

    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_pipelineos",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 10,
        disclosureRequired: true,
      },
    });

    expect(
      evaluation
        .json()
        .shortlisted.some((item: { campaignId: string }) => item.campaignId === created.campaign.campaignId),
    ).toBe(true);

    await app.close();
  });

  it("blocks activation when policy marks a campaign for manual review", async () => {
    const app = buildServer(createStore());

    const creation = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        advertiser: "RiskyCRM",
        category: "crm_software",
        regions: ["UK"],
        billingModel: "CPA",
        payoutAmount: 2000,
        currency: "USD",
        budget: 15000,
        disclosureText: "Sponsored recommendation from RiskyCRM.",
        product: {
          name: "RiskyCRM",
          description: "Aggressive CRM pitch for testing policy review.",
          price: 499,
          currency: "USD",
          intendedFor: ["compare_and_shortlist"],
          constraints: {},
          claims: ["100% guaranteed ROI in 7 days"],
          actionEndpoints: ["https://api.riskycrm.io/signup"],
          positioningBullets: ["guaranteed growth"],
        },
        proofReferences: [
          {
            label: "Marketing brochure",
            type: "doc",
            url: "https://riskycrm.io/brochure",
          },
        ],
      },
    });

    expect(creation.statusCode).toBe(201);
    expect(creation.json().policyCheck.decision).toBe("manual_review");

    const activation = await app.inject({
      method: "POST",
      url: `/campaigns/${creation.json().campaign.campaignId}/activate`,
    });

    expect(activation.statusCode).toBe(409);
    expect(activation.json().activated).toBe(false);
    expect(activation.json().policyCheck.riskFlags).toContain("high_risk_claim_language");

    await app.close();
  });

  it("rejects placeholder campaign URLs instead of accepting fake defaults", async () => {
    const app = buildServer(createStore());

    const creation = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: buildCampaignDraftPayload({
        advertiser: "PipelineOS",
        product: {
          ...buildCampaignDraftPayload().product,
          actionEndpoints: ["https://api.pipelineos.example.com/demo"],
        },
      }),
    });

    expect(creation.statusCode).toBe(400);
    expect(creation.json().message).toContain("real URL");

    await app.close();
  });

  it("blocks campaign activation when opc review is missing, then rejects after opc rejection", async () => {
    const app = buildServer(createStore());

    const opcProfile = await app.inject({
      method: "POST",
      url: "/opc/profiles",
      payload: {
        legalEntityName: "Revenue Core Ltd",
        registrationId: "UK-77889900",
        operatorType: "company",
        primaryBusinessType: "product",
        businessModelPrimary: "saas",
        websiteUrl: "https://revenuecore.io",
        productPageUrl: "https://revenuecore.io/product",
        coursePageUrl: null,
        entityVerificationStatus: "passed",
        onboardingChannel: "inbound",
      },
    });
    expect(opcProfile.statusCode).toBe(201);
    const opcId = opcProfile.json().opcId;

    const creation = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: buildCampaignDraftPayload({
        advertiser: "RevenueCore",
        opcProfileId: opcId,
      }),
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json().policyCheck.decision).toBe("pass");

    const blockedActivation = await app.inject({
      method: "POST",
      url: `/campaigns/${creation.json().campaign.campaignId}/activate`,
    });
    expect(blockedActivation.statusCode).toBe(409);
    expect(blockedActivation.json().activated).toBe(false);
    expect(blockedActivation.json().opcGate.reviewDecision).toBe("manual_review");
    expect(blockedActivation.json().campaign.scaleEligibility).toBe("blocked");

    const rejectedReview = await app.inject({
      method: "POST",
      url: "/opc/reviews",
      payload: {
        opcId,
        verificationScore: 41,
        guruRiskScore: 77,
        externalCustomerRevenueRatio: 0.42,
        knowledgeRevenueRatio: 0.48,
        proofBundleStatus: "partial",
        customerSampleStatus: "failed",
        pageClassification: "course-led",
        decision: "rejected",
        reviewerOwner: "risk:irene",
        validUntil: "2026-04-30",
        decisionReason: "Revenue mix is course-led and proof is insufficient.",
      },
    });
    expect(rejectedReview.statusCode).toBe(201);

    const rejectedActivation = await app.inject({
      method: "POST",
      url: `/campaigns/${creation.json().campaign.campaignId}/activate`,
    });
    expect(rejectedActivation.statusCode).toBe(409);
    expect(rejectedActivation.json().activated).toBe(false);
    expect(rejectedActivation.json().opcGate.reviewDecision).toBe("rejected");
    expect(rejectedActivation.json().campaign.status).toBe("rejected");

    await app.close();
  });

  it("allows approved and probation opc campaigns, while limiting probation scale", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const scorecards = await app.inject({
      method: "GET",
      url: "/buyer-agents/scorecards?isCommerciallyEligible=true",
    });
    expect(scorecards.statusCode).toBe(200);
    expect(scorecards.json().length).toBeGreaterThan(2);

    const approvedProfile = await app.inject({
      method: "POST",
      url: "/opc/profiles",
      payload: {
        legalEntityName: "Approved Systems Ltd",
        registrationId: "UK-11223344",
        operatorType: "company",
        primaryBusinessType: "product",
        businessModelPrimary: "saas",
        websiteUrl: "https://approvedsystems.io",
        productPageUrl: "https://approvedsystems.io/product",
        coursePageUrl: null,
        entityVerificationStatus: "passed",
        onboardingChannel: "bd",
      },
    });
    expect(approvedProfile.statusCode).toBe(201);
    const approvedOpcId = approvedProfile.json().opcId;

    const approvedReview = await app.inject({
      method: "POST",
      url: "/opc/reviews",
      payload: {
        opcId: approvedOpcId,
        verificationScore: 92,
        guruRiskScore: 8,
        externalCustomerRevenueRatio: 0.95,
        knowledgeRevenueRatio: 0.03,
        proofBundleStatus: "complete",
        customerSampleStatus: "passed",
        pageClassification: "product-led",
        decision: "approved",
        reviewerOwner: "risk:irene",
        validUntil: "2026-07-31",
        decisionReason: "Verified product-led operator with clean revenue mix.",
      },
    });
    expect(approvedReview.statusCode).toBe(201);

    const approvedCampaign = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: buildCampaignDraftPayload({
        workspaceId: "workspace_demo",
        advertiser: "ApprovedOps",
        opcProfileId: approvedOpcId,
      }),
    });
    expect(approvedCampaign.statusCode).toBe(201);

    const approvedActivation = await app.inject({
      method: "POST",
      url: `/campaigns/${approvedCampaign.json().campaign.campaignId}/activate`,
    });
    expect(approvedActivation.statusCode).toBe(200);
    expect(approvedActivation.json().opcGate.reviewDecision).toBe("approved");
    expect(approvedActivation.json().campaign.scaleEligibility).toBe("full");

    const probationProfile = await app.inject({
      method: "POST",
      url: "/opc/profiles",
      payload: {
        legalEntityName: "Probation Systems Ltd",
        registrationId: "UK-55664433",
        operatorType: "company",
        primaryBusinessType: "mixed",
        businessModelPrimary: "saas_plus_training",
        websiteUrl: "https://probationops.io",
        productPageUrl: "https://probationops.io/product",
        coursePageUrl: "https://probationops.io/training",
        entityVerificationStatus: "passed",
        onboardingChannel: "bd",
      },
    });
    expect(probationProfile.statusCode).toBe(201);
    const probationOpcId = probationProfile.json().opcId;

    const probationReview = await app.inject({
      method: "POST",
      url: "/opc/reviews",
      payload: {
        opcId: probationOpcId,
        verificationScore: 73,
        guruRiskScore: 36,
        externalCustomerRevenueRatio: 0.71,
        knowledgeRevenueRatio: 0.24,
        proofBundleStatus: "complete",
        customerSampleStatus: "passed",
        pageClassification: "mixed",
        decision: "probation",
        reviewerOwner: "risk:irene",
        validUntil: "2026-05-31",
        decisionReason: "Allow small-scale testing only while revenue mix is monitored.",
      },
    });
    expect(probationReview.statusCode).toBe(201);

    const probationCampaign = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: buildCampaignDraftPayload({
        workspaceId: "workspace_demo",
        advertiser: "ProbationOps",
        opcProfileId: probationOpcId,
      }),
    });
    expect(probationCampaign.statusCode).toBe(201);

    const probationActivation = await app.inject({
      method: "POST",
      url: `/campaigns/${probationCampaign.json().campaign.campaignId}/activate`,
    });
    expect(probationActivation.statusCode).toBe(200);
    expect(probationActivation.json().opcGate.reviewDecision).toBe("probation");
    expect(probationActivation.json().campaign.scaleEligibility).toBe("limited");

    const probationRun = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_demo",
        campaignId: probationCampaign.json().campaign.campaignId,
        category: "crm_software",
        taskType: "compare_and_shortlist",
        geo: ["US"],
      },
    });
    expect(probationRun.statusCode).toBe(201);
    expect(probationRun.json().qualifiedBuyerAgentsCount).toBe(2);
    expect(probationRun.json().constraints.scaleEligibility).toBe("limited");
    expect(probationRun.json().constraints.opcReviewDecision).toBe("probation");

    await app.close();
  });

  it("shortlists only eligible campaigns and returns ranking metadata", async () => {
    const app = buildServer(createStore());

    const response = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_001",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["CN"],
          budget_max: 80000,
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 2,
        disclosureRequired: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.shortlisted).toHaveLength(2);
    expect(body.shortlisted[0].priorityScore).toBeGreaterThanOrEqual(body.shortlisted[1].priorityScore);
    expect(body.shortlisted[0].rankingReason).toContain("Passed gates");

    await app.close();
  });

  it("creates a settlement for CPQR on presented receipt and deduplicates repeats", async () => {
    const app = buildServer(createStore());
    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_settlement_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });

    const offer = evaluation
      .json()
      .shortlisted.find((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");

    expect(offer).toBeTruthy();
    const receiptPayload = buildCanonicalReceiptPayload({
      receiptId: "rcpt_001",
      intentId: "int_settlement_01",
      offerId: offer!.offerId,
      campaignId: offer!.campaignId,
      partnerId: offer!.partnerId,
      eventType: "offer.presented",
    });

    const firstReceipt = await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: receiptPayload,
    });

    expect(firstReceipt.statusCode).toBe(201);
    expect(firstReceipt.json().settlement.amount).toBeGreaterThan(0);

    const duplicateReceipt = await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: receiptPayload,
    });

    expect(duplicateReceipt.statusCode).toBe(200);
    expect(duplicateReceipt.json().deduplicated).toBe(true);

    const settlements = await app.inject({
      method: "GET",
      url: "/settlements",
    });

    expect(settlements.json()).toHaveLength(1);
    await app.close();
  });

  it("uses idempotency guards for concurrent receipt ingestion", async () => {
    const app = buildServer(createStore());
    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_concurrent_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });

    const offer = evaluation
      .json()
      .shortlisted.find((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");

    const payload = buildCanonicalReceiptPayload({
      receiptId: "rcpt_concurrent_01",
      intentId: "int_concurrent_01",
      offerId: offer!.offerId,
      campaignId: offer!.campaignId,
      partnerId: offer!.partnerId,
      eventType: "offer.presented",
    });

    const [firstResponse, secondResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/events/receipts",
        payload,
      }),
      app.inject({
        method: "POST",
        url: "/events/receipts",
        payload,
      }),
    ]);

    expect([firstResponse.statusCode, secondResponse.statusCode].sort()).toEqual([200, 201]);
    const settlements = await app.inject({
      method: "GET",
      url: "/settlements",
    });
    expect(settlements.json()).toHaveLength(1);

    const auditTrail = await app.inject({
      method: "GET",
      url: "/audit-trail?traceId=int_concurrent_01&page=1&pageSize=10",
    });
    expect(
      auditTrail
        .json()
        .items.some((event: { entityType: string; status: string }) => event.entityType === "idempotency" && event.status === "deduplicated"),
    ).toBe(true);

    await app.close();
  });

  it("records cache miss then cache hit in audit trail for repeated opportunity evaluation", async () => {
    const app = buildServer(createStore());

    const payload = {
      intentId: "int_cache_01",
      category: "crm_software",
      taskType: "compare_and_shortlist",
      constraints: {
        geo: ["CN"],
      },
      placement: "shortlist",
      relevanceFloor: 0.72,
      utilityFloor: 0.68,
      sponsoredSlots: 2,
      disclosureRequired: true,
    };

    await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload,
    });
    await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload,
    });

    const auditTrail = await app.inject({
      method: "GET",
      url: "/audit-trail?traceId=int_cache_01&page=1&pageSize=10",
    });
    const statuses = auditTrail.json().items.map((event: { status: string; entityType: string }) => `${event.entityType}:${event.status}`);

    expect(statuses).toContain("cache:cache_miss");
    expect(statuses).toContain("cache:cache_hit");

    await app.close();
  });

  it("processes settlement retry jobs and transitions settlement to settled", async () => {
    const app = buildServer(createStore());
    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_retry_queue_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });

    const offer = evaluation
      .json()
      .shortlisted.find((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");

    await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: buildCanonicalReceiptPayload({
        receiptId: "rcpt_retry_queue_01",
        intentId: "int_retry_queue_01",
        offerId: offer!.offerId,
        campaignId: offer!.campaignId,
        partnerId: offer!.partnerId,
        eventType: "offer.presented",
      }),
    });

    const queuedJobs = await app.inject({
      method: "GET",
      url: "/settlements/retry-jobs?limit=10",
    });
    expect(queuedJobs.json().some((job: { status: string }) => job.status === "queued")).toBe(true);

    const processing = await app.inject({
      method: "POST",
      url: "/settlements/retry-queue/process",
      payload: {
        limit: 10,
      },
    });

    expect(processing.statusCode).toBe(200);
    expect(processing.json().settledCount).toBeGreaterThan(0);

    const settlements = await app.inject({
      method: "GET",
      url: "/settlements",
    });
    expect(settlements.json().some((item: { status: string }) => item.status === "settled")).toBe(true);

    await app.close();
  });

  it("supports paginated audit trail responses", async () => {
    const app = buildServer(createStore());

    await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        advertiser: "Paginated CRM",
        category: "crm_software",
        regions: ["UK"],
        billingModel: "CPQR",
        payoutAmount: 180,
        currency: "USD",
        budget: 9000,
        disclosureText: "Sponsored recommendation from Paginated CRM.",
        product: {
          name: "Paginated CRM",
          description: "Test record for audit pagination.",
          price: 500,
          currency: "USD",
          intendedFor: ["compare_and_shortlist"],
          constraints: {},
          claims: ["SOC 2 Type II"],
          actionEndpoints: ["https://api.paginatedcrm.io/demo-request"],
          positioningBullets: [],
        },
        proofReferences: [
          {
            label: "Security",
            type: "doc",
            url: "https://paginatedcrm.io/security",
          },
        ],
      },
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/audit-trail?page=1&pageSize=2",
    });
    const secondPage = await app.inject({
      method: "GET",
      url: "/audit-trail?page=2&pageSize=2",
    });

    expect(firstPage.json().items).toHaveLength(2);
    expect(firstPage.json().page).toBe(1);
    expect(firstPage.json().total).toBeGreaterThanOrEqual(2);
    expect(firstPage.json().hasNextPage).toBe(true);
    expect(secondPage.json().page).toBe(2);

    await app.close();
  });

  it("writes failed settlements to DLQ and supports replay after manual intervention", async () => {
    const gateway = {
      mode: "fail",
      async submitSettlement() {
        if (this.mode === "fail") {
          return {
            ok: false,
            retryable: false,
            message: "Provider rejected the settlement.",
            providerState: "failed" as const,
            providerResponseCode: "PROVIDER_REJECTED",
          };
        }

        return {
          ok: true,
          retryable: false,
          providerState: "settled" as const,
          providerSettlementId: "provider_set_01",
          providerResponseCode: "OK",
        };
      },
    };

    const app = buildServer(createStore({ settlementGateway: gateway }));
    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_dlq_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });

    const offer = evaluation
      .json()
      .shortlisted.find((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");

    await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: buildCanonicalReceiptPayload({
        receiptId: "rcpt_dlq_01",
        intentId: "int_dlq_01",
        offerId: offer!.offerId,
        campaignId: offer!.campaignId,
        partnerId: offer!.partnerId,
        eventType: "offer.presented",
      }),
    });

    const processFailure = await app.inject({
      method: "POST",
      url: "/settlements/retry-queue/process",
      payload: {
        limit: 10,
      },
    });

    expect(processFailure.json().failedCount).toBeGreaterThan(0);

    const dlqPage = await app.inject({
      method: "GET",
      url: "/settlements/dlq?page=1&pageSize=10",
    });
    expect(dlqPage.json().items).toHaveLength(1);
    expect(dlqPage.json().items[0].status).toBe("open");

    gateway.mode = "success";
    const replay = await app.inject({
      method: "POST",
      url: `/settlements/dlq/${dlqPage.json().items[0].dlqEntryId}/replay`,
      payload: {
        resolutionNote: "Replay after provider fix",
      },
    });
    expect(replay.statusCode).toBe(200);

    const processSuccess = await app.inject({
      method: "POST",
      url: "/settlements/retry-queue/process",
      payload: {
        limit: 10,
      },
    });
    expect(processSuccess.json().settledCount).toBeGreaterThan(0);

    const dlqAfterReplay = await app.inject({
      method: "GET",
      url: "/settlements/dlq?page=1&pageSize=10",
    });
    expect(dlqAfterReplay.json().items[0].status).toBe("resolved");

    await app.close();
  });

  it("creates discovery sources and crawls live pages into deduped agent leads", async () => {
    const htmlServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <html>
          <head><title>NovaProcure Agent</title></head>
          <body>
            <h1>NovaProcure Agent</h1>
            <p>CRM procurement agent with sponsored disclosure, oauth and api key support.</p>
            <a href="${baseUrl}/opportunities">Opportunities API</a>
            <p>Contact: alliances@novaprocure.io</p>
          </body>
        </html>
      `);
    });
    await new Promise<void>((resolve) => htmlServer.listen(0, "127.0.0.1", () => resolve()));
    const address = htmlServer.address();
    const baseUrl = `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}`;

    const app = buildServer(createStore());
    const source = await app.inject({
      method: "POST",
      url: "/discovery/sources",
      payload: {
        sourceType: "public_registry",
        name: "Nova Registry",
        baseUrl,
        seedUrls: [baseUrl],
        active: true,
        crawlPolicy: { rateLimit: 1, maxDepth: 1 },
        verticalHints: ["crm_software"],
        geoHints: ["UK"],
      },
    });

    const firstRun = await app.inject({
      method: "POST",
      url: "/discovery/runs",
      payload: {
        sourceId: source.json().sourceId,
      },
    });
    expect(firstRun.statusCode).toBe(201);
    expect(firstRun.json().createdLeadCount).toBeGreaterThan(0);

    const secondRun = await app.inject({
      method: "POST",
      url: "/discovery/runs",
      payload: {
        sourceId: source.json().sourceId,
      },
    });
    expect(secondRun.json().dedupedCount).toBeGreaterThan(0);

    const leads = await app.inject({
      method: "GET",
      url: "/agent-leads?sourceType=public_registry",
    });
    expect(leads.json().some((lead: { providerOrg: string }) => lead.providerOrg.includes("NovaProcure"))).toBe(true);
    const discoveredLead = leads.json().find((lead: { providerOrg: string }) => lead.providerOrg.includes("NovaProcure"));
    expect(discoveredLead.evidenceRef).toContain(baseUrl);
    expect(discoveredLead.lastVerifiedAt).toBeNull();
    expect(discoveredLead.verificationOwner).toBeNull();

    await app.close();
    await new Promise<void>((resolve, reject) => htmlServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("separates discovered leads from seed leads in CRM filters", async () => {
    const htmlServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <html>
          <head><title>Atlas Revenue Agent</title></head>
          <body>
            <h1>Atlas Revenue Agent</h1>
            <p>CRM workflow agent with sponsored disclosure and oauth support.</p>
            <a href="${baseUrl}/opportunities">Opportunities API</a>
            <p>Contact: team@atlasrevenue.ai</p>
          </body>
        </html>
      `);
    });
    await new Promise<void>((resolve) => htmlServer.listen(0, "127.0.0.1", () => resolve()));
    const address = htmlServer.address();
    const baseUrl = `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}`;

    const app = buildServer(createStore());
    const source = await app.inject({
      method: "POST",
      url: "/discovery/sources",
      payload: {
        sourceType: "partner_directory",
        name: "Atlas Directory",
        baseUrl,
        seedUrls: [baseUrl],
        active: true,
        crawlPolicy: { rateLimit: 1, maxDepth: 1 },
        verticalHints: ["crm_software"],
        geoHints: ["US"],
      },
    });

    await app.inject({
      method: "POST",
      url: "/discovery/runs",
      payload: {
        sourceId: source.json().sourceId,
      },
    });

    const discovered = await app.inject({
      method: "GET",
      url: "/agent-leads?dataOrigin=discovered",
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().every((lead: { dataOrigin: string }) => lead.dataOrigin === "discovered")).toBe(true);
    expect(discovered.json().some((lead: { providerOrg: string }) => lead.providerOrg.includes("Atlas Revenue Agent"))).toBe(true);

    const seed = await app.inject({
      method: "GET",
      url: "/agent-leads?dataOrigin=seed",
    });
    expect(seed.statusCode).toBe(200);
    expect(seed.json().every((lead: { dataOrigin: string }) => lead.dataOrigin === "seed")).toBe(true);
    expect(seed.json().some((lead: { providerOrg: string }) => lead.providerOrg === "ProcurePilot")).toBe(true);

    await app.close();
    await new Promise<void>((resolve, reject) => htmlServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("blocks lead activation when verification checklist is incomplete", async () => {
    const app = buildServer(createStore());

    const result = await app.inject({
      method: "POST",
      url: "/agent-leads/lead_crm_eu/status",
      payload: {
        nextStatus: "active",
        actorId: "ops:test",
        comment: "Trying to activate without full checklist.",
        checklist: {
          identity: true,
          auth: false,
          disclosure: true,
          sla: true,
          rateLimit: true,
        },
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.json().message).toContain("Checklist");
    await app.close();
  });

  it("stores verification metadata on lead status updates", async () => {
    const app = buildServer(createStore());

    const update = await app.inject({
      method: "POST",
      url: "/agent-leads/lead_crm_eu/status",
      payload: {
        nextStatus: "active",
        actorId: "ops:verifier",
        comment: "Re-verified for receipt compliance.",
        evidenceRef: "evidence://lead_crm_eu/reverify",
        checklist: {
          identity: true,
          auth: true,
          disclosure: true,
          sla: true,
          rateLimit: true,
        },
      },
    });

    expect(update.statusCode).toBe(200);
    const lead = await app.inject({
      method: "GET",
      url: "/agent-leads/lead_crm_eu",
    });
    expect(lead.statusCode).toBe(200);
    expect(lead.json().verificationOwner).toBe("ops:verifier");
    expect(lead.json().evidenceRef).toBe("evidence://lead_crm_eu/reverify");
    expect(lead.json().lastVerifiedAt).toBeTruthy();

    await app.close();
  });

  it("promotes verified leads to partners and blocks promotion before verification", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const blocked = await app.inject({
      method: "POST",
      url: "/agent-leads/lead_demo_orbit/promote",
      payload: {
        status: "active",
        supportedCategories: ["ad_analytics"],
        slaTier: "silver",
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain("verified or active");

    const promoted = await app.inject({
      method: "POST",
      url: "/agent-leads/lead_demo_lighthouse/promote",
      payload: {
        status: "active",
        supportedCategories: ["crm_software", "sales_ops"],
        slaTier: "gold",
      },
    });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().agentLeadId).toBe("lead_demo_lighthouse");
    expect(promoted.json().status).toBe("active");
    expect(promoted.json().slaTier).toBe("gold");
    expect(promoted.json().verificationOwner).toBe("ops:dana");
    expect(promoted.json().evidenceRef).toBeTruthy();

    const partners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    expect(partners.json().some((partner: { agentLeadId: string; partnerId: string; verificationOwner: string }) => partner.agentLeadId === "lead_demo_lighthouse" && partner.partnerId === "partner_lighthouse_buying_copilot" && partner.verificationOwner === "ops:dana")).toBe(true);

    await app.close();
  });

  it("keeps buyer agents without presentation receipts on the observation list", async () => {
    const app = buildServer(createStore());

    const scorecards = await app.inject({
      method: "GET",
      url: "/buyer-agents/scorecards",
    });
    expect(scorecards.statusCode).toBe(200);

    const observed = scorecards.json().find((item: { providerOrg: string }) => item.providerOrg === "GrowthDesk Agent");
    expect(observed).toBeTruthy();
    expect(observed.isCommerciallyEligible).toBe(false);
    expect(observed.supportsDeliveryReceipt).toBe(true);
    expect(observed.supportsPresentationReceipt).toBe(false);
    expect(observed.verificationOwner).toBe("ops:bob");
    expect(observed.evidenceRef).toBeTruthy();

    await app.close();
  });

  it("blocks partner promotion when receipt capabilities are missing", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/agent-leads/lead_demo_vector/promote",
      payload: {
        status: "active",
        supportedCategories: ["crm_software"],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("delivery receipt");

    await app.close();
  });

  it("aggregates measurement funnel for full event chain", async () => {
    const app = buildServer(createStore());
    const receiptPayloads = [
      { receiptId: "rcpt_funnel_01", dataProvenance: "demo_bootstrap", eventType: "shortlisted" },
      { receiptId: "rcpt_funnel_02", dataProvenance: "demo_bootstrap", eventType: "presented" },
      { receiptId: "rcpt_funnel_03", dataProvenance: "demo_bootstrap", eventType: "detail_view" },
      { receiptId: "rcpt_funnel_04", dataProvenance: "demo_bootstrap", eventType: "handoff" },
      { receiptId: "rcpt_funnel_05", dataProvenance: "demo_bootstrap", eventType: "conversion" },
    ];

    for (const payload of receiptPayloads) {
      await app.inject({
        method: "POST",
        url: "/events/receipts",
        payload: buildCanonicalReceiptPayload({
          receiptId: payload.receiptId,
          dataProvenance: payload.dataProvenance,
          intentId: "int_measurement_01",
          offerId: "offer_hubflow",
          campaignId: "cmp_hubflow",
          partnerId: "partner_procure_pilot",
          eventType: payload.eventType,
        }),
      });
    }

    const funnel = await app.inject({
      method: "GET",
      url: "/measurements/funnel?campaignId=cmp_hubflow",
    });
    expect(funnel.statusCode).toBe(200);
    expect(funnel.json().shortlisted).toBeGreaterThan(0);
    expect(funnel.json().detailViewRate).toBeGreaterThan(0);
    expect(funnel.json().actionConversionRate).toBeGreaterThan(0);

    await app.close();
  });

  it("creates risk cases and updates reputation dispute state through appeals", async () => {
    const app = buildServer(createStore());

    const riskCase = await app.inject({
      method: "POST",
      url: "/risk/cases",
      payload: {
        entityType: "partner",
        entityId: "partner_procure_pilot",
        reasonType: "claim_mismatch",
        severity: "high",
        ownerId: "risk:test",
        note: "Testing risk flow.",
      },
    });
    expect(riskCase.statusCode).toBe(201);

    const reputationBefore = await app.inject({
      method: "GET",
      url: "/reputation/records",
    });
    const targetRecord = reputationBefore.json()[0];

    const appeal = await app.inject({
      method: "POST",
      url: "/appeals",
      payload: {
        partnerId: targetRecord.partnerId,
        targetRecordId: targetRecord.recordId,
        statement: "Please review this manual adjustment.",
      },
    });
    expect(appeal.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: `/appeals/${appeal.json().appealId}/decision`,
      payload: {
        status: "approved",
        decisionNote: "Appeal accepted.",
      },
    });

    const reputationAfter = await app.inject({
      method: "GET",
      url: "/reputation/records",
    });
    expect(reputationAfter.json().some((record: { disputeStatus: string }) => record.disputeStatus === "resolved")).toBe(true);

    await app.close();
  });

  it("creates opc verification canonical records through the API", async () => {
    const app = buildServer(createStore());

    const profile = await app.inject({
      method: "POST",
      url: "/opc/profiles",
      payload: {
        legalEntityName: "North Ridge Labs Ltd",
        registrationId: "UK-55667788",
        operatorType: "company",
        primaryBusinessType: "product",
        businessModelPrimary: "saas",
        websiteUrl: "https://northridge.io",
        productPageUrl: "https://northridge.io/product",
        coursePageUrl: null,
        entityVerificationStatus: "passed",
        onboardingChannel: "bd_referral",
      },
    });
    expect(profile.statusCode).toBe(201);

    const opcId = profile.json().opcId;

    const evidence = await app.inject({
      method: "POST",
      url: "/opc/evidence",
      payload: {
        opcId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        payoutSource: "stripe",
        settlementAmount: 42000,
        bankInflowAmount: 39800,
        orderCount: 34,
        refundAmount: 800,
        chargebackAmount: 120,
        variableCostEstimate: 9500,
        contributionProfitEstimate: 30300,
        reconciliationStatus: "passed",
        sourceRef: "proof://jan-ledger",
      },
    });
    expect(evidence.statusCode).toBe(201);

    const review = await app.inject({
      method: "POST",
      url: "/opc/reviews",
      payload: {
        opcId,
        verificationScore: 87,
        guruRiskScore: 14,
        externalCustomerRevenueRatio: 0.91,
        knowledgeRevenueRatio: 0.06,
        proofBundleStatus: "complete",
        customerSampleStatus: "passed",
        pageClassification: "product-led",
        decision: "approved",
        reviewerOwner: "risk:irene",
        validUntil: "2026-06-30",
        decisionReason: "Core revenue is product-led and fully reconciled.",
      },
    });
    expect(review.statusCode).toBe(201);

    const snapshot = await app.inject({
      method: "POST",
      url: "/opc/health-snapshots",
      payload: {
        opcId,
        month: "2026-02-01",
        netCashIn: 36100,
        contributionProfitEstimate: 27100,
        refundRate: 0.03,
        chargebackRate: 0.004,
        externalCustomerRevenueRatio: 0.9,
        knowledgeRevenueRatio: 0.08,
        trafficConcentration: 0.42,
        riskDelta: -0.08,
        statusRecommendation: "keep",
        escalationRequired: false,
      },
    });
    expect(snapshot.statusCode).toBe(201);

    const listedProfiles = await app.inject({
      method: "GET",
      url: "/opc/profiles?entityVerificationStatus=passed",
    });
    expect(listedProfiles.statusCode).toBe(200);
    expect(listedProfiles.json().some((item: { opcId: string }) => item.opcId === opcId)).toBe(true);

    const listedEvidence = await app.inject({
      method: "GET",
      url: `/opc/evidence?opcId=${encodeURIComponent(opcId)}`,
    });
    expect(listedEvidence.statusCode).toBe(200);
    expect(listedEvidence.json()).toHaveLength(1);

    const listedReviews = await app.inject({
      method: "GET",
      url: `/opc/reviews?opcId=${encodeURIComponent(opcId)}&decision=approved`,
    });
    expect(listedReviews.statusCode).toBe(200);
    expect(listedReviews.json()[0].decision).toBe("approved");

    const listedSnapshots = await app.inject({
      method: "GET",
      url: `/opc/health-snapshots?opcId=${encodeURIComponent(opcId)}`,
    });
    expect(listedSnapshots.statusCode).toBe(200);
    expect(listedSnapshots.json()[0].statusRecommendation).toBe("keep");

    await app.close();
  });

  it("creates channel, onboarding, extension, and capability verification canonical records", async () => {
    const app = buildServer(createStore());

    const channel = await app.inject({
      method: "POST",
      url: "/channel-profiles",
      payload: {
        channelType: "marketplace",
        operatorName: "Agent Market One",
        discoveryMethod: "import",
        onboardingMode: "assisted",
        expectedReachProxy: 0.76,
        supportsReceipts: ["delivery", "presented", "acted"],
        rateLimitPolicy: "100 req/min",
        costModel: "revshare",
        channelStatus: "active",
      },
    });
    expect(channel.statusCode).toBe(201);
    const channelId = channel.json().channelId;

    const onboardingCase = await app.inject({
      method: "POST",
      url: "/partner-onboarding-cases",
      payload: {
        agentLeadId: "lead_crm_eu",
        channelId,
        currentStage: "sandbox",
        contractStatus: "negotiating",
        sandboxStatus: "ready",
        pilotBudgetLimit: 2500,
        technicalOwner: "tech:mina",
        businessOwner: "bd:alex",
        blockerCode: null,
        nextReviewAt: "2026-03-25T09:00:00.000Z",
        launchedAt: null,
      },
    });
    expect(onboardingCase.statusCode).toBe(201);

    const capabilitySnapshot = await app.inject({
      method: "POST",
      url: "/capability-verification-snapshots",
      payload: {
        agentLeadId: "lead_crm_eu",
        publicCardValid: true,
        authTestPassed: true,
        opportunityTestPassed: true,
        receiptTestPassed: true,
        presentationReceiptSupported: true,
        meanLatencyMs: 218,
        successRate7d: 0.99,
        riskTier: "low",
        lastProbeAt: "2026-03-18T08:00:00.000Z",
        recommendedTier: "scale",
      },
    });
    expect(capabilitySnapshot.statusCode).toBe(201);

    const extension = await app.inject({
      method: "POST",
      url: "/commercial-extensions",
      payload: {
        partnerId: "partner_procure_pilot",
        extensionVersion: "2026-03-18",
        acceptsCommercialOpportunity: true,
        placementTypes: ["shortlist", "detail"],
        disclosureRequired: true,
        receiptModes: ["delivery", "presented", "viewed", "acted"],
        billingModes: ["CPQR", "CPA"],
        supportedIntentDomains: ["crm_software", "sales_ops"],
        maxQps: 12,
        policyEndpoint: "https://procurepilot.io/policy",
        contractRequired: true,
        signatureScheme: "jws",
      },
    });
    expect(extension.statusCode).toBe(201);

    const listedChannels = await app.inject({
      method: "GET",
      url: "/channel-profiles?channelType=marketplace&channelStatus=active",
    });
    expect(listedChannels.statusCode).toBe(200);
    expect(listedChannels.json().some((item: { channelId: string }) => item.channelId === channelId)).toBe(true);

    const listedCases = await app.inject({
      method: "GET",
      url: "/partner-onboarding-cases?agentLeadId=lead_crm_eu&currentStage=sandbox",
    });
    expect(listedCases.statusCode).toBe(200);
    expect(listedCases.json()).toHaveLength(1);

    const listedSnapshots = await app.inject({
      method: "GET",
      url: "/capability-verification-snapshots?agentLeadId=lead_crm_eu&recommendedTier=scale",
    });
    expect(listedSnapshots.statusCode).toBe(200);
    expect(listedSnapshots.json()).toHaveLength(1);

    const listedExtensions = await app.inject({
      method: "GET",
      url: "/commercial-extensions?partnerId=partner_procure_pilot",
    });
    expect(listedExtensions.statusCode).toBe(200);
    expect(listedExtensions.json()[0].contractRequired).toBe(true);

    await app.close();
  });

  it("auto-syncs onboarding cases and capability snapshots from recruitment readiness", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines",
    });
    expect(pipelines.statusCode).toBe(200);
    const lighthousePipeline = pipelines.json().find((item: { leadId: string }) => item.leadId === "lead_demo_lighthouse");
    expect(lighthousePipeline).toBeTruthy();

    const onboardingCasesBefore = await app.inject({
      method: "GET",
      url: "/partner-onboarding-cases?agentLeadId=lead_demo_lighthouse",
    });
    expect(onboardingCasesBefore.statusCode).toBe(200);
    expect(onboardingCasesBefore.json()).toHaveLength(1);
    expect(onboardingCasesBefore.json()[0].currentStage).toBe("sandbox");
    expect(onboardingCasesBefore.json()[0].sandboxStatus).toBe("ready");

    const capabilityBefore = await app.inject({
      method: "GET",
      url: "/capability-verification-snapshots?agentLeadId=lead_demo_lighthouse",
    });
    expect(capabilityBefore.statusCode).toBe(200);
    expect(capabilityBefore.json()).toHaveLength(1);
    expect(capabilityBefore.json()[0].publicCardValid).toBe(true);
    expect(capabilityBefore.json()[0].recommendedTier).toBe("pilot");

    const onboardingTasks = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${lighthousePipeline.pipelineId}/onboarding-tasks`,
    });
    expect(onboardingTasks.statusCode).toBe(200);
    const slaTask = onboardingTasks.json().find((item: { taskType: string }) => item.taskType === "sla_review");
    expect(slaTask).toBeTruthy();

    const completeSla = await app.inject({
      method: "POST",
      url: `/onboarding-tasks/${slaTask.taskId}/status`,
      payload: {
        status: "done",
        notes: "SLA review completed for pilot access.",
      },
    });
    expect(completeSla.statusCode).toBe(200);

    const onboardingCasesAfter = await app.inject({
      method: "GET",
      url: "/partner-onboarding-cases?agentLeadId=lead_demo_lighthouse",
    });
    expect(onboardingCasesAfter.statusCode).toBe(200);
    expect(onboardingCasesAfter.json()[0].currentStage).toBe("pilot");
    expect(onboardingCasesAfter.json()[0].contractStatus).toBe("signed");

    const partners = await app.inject({
      method: "GET",
      url: "/partners?provenance=demo_seed,demo_bootstrap",
    });
    expect(partners.statusCode).toBe(200);
    expect(partners.json().some((item: { agentLeadId: string }) => item.agentLeadId === "lead_demo_lighthouse")).toBe(true);

    await app.close();
  });

  it("applies reputation penalties to partner trust, scorecard eligibility, and shortlist outcomes", async () => {
    const app = buildServer(createStore());

    const initialPartners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    expect(initialPartners.statusCode).toBe(200);
    const initialPartner = initialPartners.json().find((item: { partnerId: string }) => item.partnerId === "partner_procure_pilot");
    expect(initialPartner).toBeTruthy();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const riskCase = await app.inject({
        method: "POST",
        url: "/risk/cases",
        payload: {
          entityType: "partner",
          entityId: "partner_procure_pilot",
          reasonType: "claim_mismatch",
          severity: "critical",
          ownerId: "risk:test",
          note: `Critical trust penalty ${attempt + 1}`,
        },
      });
      expect(riskCase.statusCode).toBe(201);
    }

    const penalizedPartners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    expect(penalizedPartners.statusCode).toBe(200);
    const penalizedPartner = penalizedPartners.json().find((item: { partnerId: string }) => item.partnerId === "partner_procure_pilot");
    expect(penalizedPartner.trustScore).toBeLessThan(initialPartner.trustScore);
    expect(penalizedPartner.trustScore).toBeLessThan(0.65);

    const scorecards = await app.inject({
      method: "GET",
      url: "/buyer-agents/scorecards",
    });
    expect(scorecards.statusCode).toBe(200);
    const procurePilotScorecard = scorecards.json().find((item: { partnerId: string | null }) => item.partnerId === "partner_procure_pilot");
    expect(procurePilotScorecard).toBeTruthy();
    expect(procurePilotScorecard.isCommerciallyEligible).toBe(false);

    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_trust_penalty_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 5,
        disclosureRequired: true,
      },
    });
    expect(evaluation.statusCode).toBe(200);
    expect(evaluation.json().shortlisted).toHaveLength(0);

    await app.close();
  });

  it("restores effective partner trust after an approved appeal and blocks dispatch when trust drops mid-run", async () => {
    const app = buildServer(createStore());

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_default",
        campaignId: "cmp_hubflow",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        geo: ["UK"],
      },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().qualifiedBuyerAgentsCount).toBeGreaterThan(0);

    const baselinePartners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    const baselinePartner = baselinePartners.json().find((item: { partnerId: string }) => item.partnerId === "partner_procure_pilot");
    expect(baselinePartner).toBeTruthy();

    const riskCase = await app.inject({
      method: "POST",
      url: "/risk/cases",
      payload: {
        entityType: "partner",
        entityId: "partner_procure_pilot",
        reasonType: "spam",
        severity: "critical",
        ownerId: "risk:test",
        note: "Dispatch trust degradation",
      },
    });
    expect(riskCase.statusCode).toBe(201);

    const reputationRecords = await app.inject({
      method: "GET",
      url: "/reputation/records",
    });
    const latestPenalty = reputationRecords
      .json()
      .find((item: { partnerId: string; evidenceRefs: string[] }) => item.partnerId === "partner_procure_pilot" && item.evidenceRefs.includes(riskCase.json().caseId));
    expect(latestPenalty).toBeTruthy();

    const penalizedPartners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    const penalizedPartner = penalizedPartners.json().find((item: { partnerId: string }) => item.partnerId === "partner_procure_pilot");
    expect(penalizedPartner.trustScore).toBeLessThan(baselinePartner.trustScore);

    const appeal = await app.inject({
      method: "POST",
      url: "/appeals",
      payload: {
        partnerId: "partner_procure_pilot",
        targetRecordId: latestPenalty.recordId,
        statement: "This penalty should be removed after review.",
      },
    });
    expect(appeal.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: `/appeals/${appeal.json().appealId}/decision`,
      payload: {
        status: "approved",
        decisionNote: "Penalty removed after operator review.",
      },
    });

    const restoredPartners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    const restoredPartner = restoredPartners.json().find((item: { partnerId: string }) => item.partnerId === "partner_procure_pilot");
    expect(restoredPartner.trustScore).toBeCloseTo(baselinePartner.trustScore, 5);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const penalty = await app.inject({
        method: "POST",
        url: "/risk/cases",
        payload: {
          entityType: "partner",
          entityId: "partner_procure_pilot",
          reasonType: "high_complaint",
          severity: "critical",
          ownerId: "risk:test",
          note: `Dispatch block penalty ${attempt + 1}`,
        },
      });
      expect(penalty.statusCode).toBe(201);
    }

    const dispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${run.json().promotionRunId}/dispatch`,
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);
    expect(dispatch.json().targets[0].status).toBe("failed");
    expect(dispatch.json().targets[0].responseCode).toBe("TRUST_BELOW_THRESHOLD");

    await app.close();
  });

  it("freezes partner reserve on risk cases and releases it after an approved appeal", async () => {
    const app = buildServer(createStore());

    const deposit = await app.inject({
      method: "POST",
      url: "/partner-reserves/partner_procure_pilot/deposit",
      payload: {
        amount: 200,
        sourceRef: "test.reserve.deposit",
        reasonType: "manual_deposit",
      },
    });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json().availableAmount).toBe(200);

    const riskCase = await app.inject({
      method: "POST",
      url: "/risk/cases",
      payload: {
        entityType: "partner",
        entityId: "partner_procure_pilot",
        reasonType: "claim_mismatch",
        severity: "critical",
        ownerId: "risk:test",
        note: "Reserve freeze test.",
      },
    });
    expect(riskCase.statusCode).toBe(201);

    const frozenAccount = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot",
    });
    expect(frozenAccount.statusCode).toBe(200);
    expect(frozenAccount.json().availableAmount).toBe(50);
    expect(frozenAccount.json().frozenAmount).toBe(150);

    const reputationRecords = await app.inject({
      method: "GET",
      url: "/reputation/records",
    });
    const targetRecord = reputationRecords
      .json()
      .find((item: { partnerId: string; evidenceRefs: string[] }) => item.partnerId === "partner_procure_pilot" && item.evidenceRefs.includes(riskCase.json().caseId));
    expect(targetRecord).toBeTruthy();

    const appeal = await app.inject({
      method: "POST",
      url: "/appeals",
      payload: {
        partnerId: "partner_procure_pilot",
        targetRecordId: targetRecord.recordId,
        statement: "Please release the frozen reserve.",
      },
    });
    expect(appeal.statusCode).toBe(201);

    const decision = await app.inject({
      method: "POST",
      url: `/appeals/${appeal.json().appealId}/decision`,
      payload: {
        status: "approved",
        decisionNote: "Reserve release approved.",
      },
    });
    expect(decision.statusCode).toBe(200);

    const releasedAccount = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot",
    });
    expect(releasedAccount.statusCode).toBe(200);
    expect(releasedAccount.json().availableAmount).toBe(200);
    expect(releasedAccount.json().frozenAmount).toBe(0);
    expect(releasedAccount.json().slashedAmount).toBe(0);

    const ledger = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot/ledger",
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().some((item: { entryType: string }) => item.entryType === "deposit")).toBe(true);
    expect(ledger.json().some((item: { entryType: string }) => item.entryType === "freeze")).toBe(true);
    expect(ledger.json().some((item: { entryType: string }) => item.entryType === "release")).toBe(true);

    await app.close();
  });

  it("slashes frozen reserve on rejected appeals and freezes reserve for settlement disputes", async () => {
    const app = buildServer(createStore());

    const deposit = await app.inject({
      method: "POST",
      url: "/partner-reserves/partner_procure_pilot/deposit",
      payload: {
        amount: 200,
        sourceRef: "test.reserve.deposit.2",
        reasonType: "manual_deposit",
      },
    });
    expect(deposit.statusCode).toBe(201);

    const riskCase = await app.inject({
      method: "POST",
      url: "/risk/cases",
      payload: {
        entityType: "partner",
        entityId: "partner_procure_pilot",
        reasonType: "spam",
        severity: "high",
        ownerId: "risk:test",
        note: "Reserve slash test.",
      },
    });
    expect(riskCase.statusCode).toBe(201);

    const reputationRecords = await app.inject({
      method: "GET",
      url: "/reputation/records",
    });
    const targetRecord = reputationRecords
      .json()
      .find((item: { partnerId: string; evidenceRefs: string[] }) => item.partnerId === "partner_procure_pilot" && item.evidenceRefs.includes(riskCase.json().caseId));
    expect(targetRecord).toBeTruthy();

    const appeal = await app.inject({
      method: "POST",
      url: "/appeals",
      payload: {
        partnerId: "partner_procure_pilot",
        targetRecordId: targetRecord.recordId,
        statement: "This reserve should stay frozen.",
      },
    });
    expect(appeal.statusCode).toBe(201);

    const rejected = await app.inject({
      method: "POST",
      url: `/appeals/${appeal.json().appealId}/decision`,
      payload: {
        status: "rejected",
        decisionNote: "Reserve slash upheld.",
      },
    });
    expect(rejected.statusCode).toBe(200);

    const slashedAccount = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot",
    });
    expect(slashedAccount.statusCode).toBe(200);
    expect(slashedAccount.json().availableAmount).toBe(125);
    expect(slashedAccount.json().frozenAmount).toBe(0);
    expect(slashedAccount.json().slashedAmount).toBe(75);

    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_reserve_dispute_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });
    expect(evaluation.statusCode).toBe(200);
    const offer = evaluation
      .json()
      .shortlisted.find((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");
    expect(offer).toBeTruthy();

    const receipt = await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: buildCanonicalReceiptPayload({
        receiptId: "rcpt_reserve_dispute_01",
        intentId: "int_reserve_dispute_01",
        offerId: offer.offerId,
        campaignId: offer.campaignId,
        partnerId: offer.partnerId,
        eventType: "offer.presented",
      }),
    });
    expect(receipt.statusCode).toBe(201);
    const settlementId = receipt.json().settlement.settlementId;

    const disputed = await app.inject({
      method: "POST",
      url: `/settlements/${settlementId}/dispute`,
      payload: {},
    });
    expect(disputed.statusCode).toBe(200);

    const disputedAccount = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot",
    });
    expect(disputedAccount.statusCode).toBe(200);
    expect(disputedAccount.json().availableAmount).toBe(75);
    expect(disputedAccount.json().frozenAmount).toBe(50);
    expect(disputedAccount.json().slashedAmount).toBe(75);

    const ledger = await app.inject({
      method: "GET",
      url: "/partner-reserves/partner_procure_pilot/ledger",
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().some((item: { entryType: string }) => item.entryType === "slash")).toBe(true);
    expect(ledger.json().some((item: { sourceRef: string; entryType: string }) => item.entryType === "freeze" && item.sourceRef.startsWith("rep_settlement_dispute_"))).toBe(true);

    await app.close();
  });

  it("builds recruitment pipelines for existing leads and advances them through outreach", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines",
    });
    expect(pipelines.statusCode).toBe(200);
    expect(pipelines.json().length).toBeGreaterThan(0);

    const leadPipeline = pipelines.json().find((item: { leadId: string }) => item.leadId === "lead_demo_lighthouse");
    expect(leadPipeline).toBeTruthy();
    expect(leadPipeline.nextStep).toContain("outreach");

    const readiness = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${leadPipeline.pipelineId}/readiness`,
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json().readinessScore).toBeGreaterThan(0);

    const outreachList = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${leadPipeline.pipelineId}/outreach-targets`,
    });
    expect(outreachList.statusCode).toBe(200);
    expect(
      outreachList
        .json()
        .some(
          (item: {
            status: string;
            messageTemplate: string;
            subjectLine: string;
            recommendedCampaignId: string | null;
            proofHighlights: string[];
          }) =>
            item.status === "draft" &&
            item.subjectLine.length > 0 &&
            item.messageTemplate.length > 0 &&
            item.recommendedCampaignId &&
            item.proofHighlights.length > 0,
        ),
    ).toBe(true);

    const outreach = await app.inject({
      method: "POST",
      url: `/recruitment/pipelines/${leadPipeline.pipelineId}/outreach-targets`,
      payload: {
        channel: "email",
        contactPoint: "partnerships@lumio.ai",
        messageTemplate: "Testing recruitment pipeline outreach.",
      },
    });
    expect(outreach.statusCode).toBe(201);

    const sent = await app.inject({
      method: "POST",
      url: `/outreach-targets/${outreach.json().targetId}/send`,
      payload: {},
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().target.status).toBe("sent");
    expect(sent.json().target.providerRequestId).toBeTruthy();

    const tasksAfterSend = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${leadPipeline.pipelineId}/onboarding-tasks`,
    });
    expect(tasksAfterSend.statusCode).toBe(200);
    expect(tasksAfterSend.json().some((task: { taskType: string; autoGenerated: boolean; relatedTargetId: string }) => task.taskType === "follow_up_reminder" && task.autoGenerated && task.relatedTargetId === outreach.json().targetId)).toBe(true);

    const replied = await app.inject({
      method: "POST",
      url: `/outreach-targets/${outreach.json().targetId}/status`,
      payload: {
        status: "replied",
      },
    });
    expect(replied.statusCode).toBe(200);

    const refreshed = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${leadPipeline.pipelineId}`,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().stage).toBe("replied");

    await app.close();
  });

  it("rejects placeholder outreach contacts and placeholder discovery sources", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const source = await app.inject({
      method: "POST",
      url: "/discovery/sources",
      payload: {
        sourceType: "public_registry",
        name: "Registry Placeholder",
        baseUrl: "https://registry.example.com",
        seedUrls: ["https://registry.example.com/agents"],
        active: true,
        crawlPolicy: { rateLimit: 1, maxDepth: 1 },
        verticalHints: ["crm_software"],
        geoHints: ["UK"],
      },
    });
    expect(source.statusCode).toBe(400);
    expect(source.json().message).toContain("real");

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const pipeline = pipelines.json()[0];

    const outreach = await app.inject({
      method: "POST",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
      payload: {
        channel: "email",
        contactPoint: "partnerships@example.com",
        messageTemplate: "Testing placeholder rejection.",
      },
    });
    expect(outreach.statusCode).toBe(400);
    expect(outreach.json().message).toContain("real email");

    await app.close();
  });

  it("creates an email outreach draft when a discovered lead gains a new real contact", async () => {
    const store = createStore({
      appMode: "demo",
      seedData: buildDemoSeedData(),
    });
    const app = buildServer(store);

    const templateLead = (await store.listAgentLeads({})).find((lead) => lead.agentId === "lead_demo_lighthouse");
    expect(templateLead).toBeTruthy();

    const discoveredLead = {
      ...templateLead!,
      agentId: "lead_demo_contact_refresh",
      providerOrg: "Contact Refresh Agent",
      dataOrigin: "discovered" as const,
      dataProvenance: "real_discovery" as const,
      source: "Refresh Directory",
      sourceType: "partner_directory" as const,
      sourceRef: "src_refresh_directory",
      cardUrl: "https://refresh-agent.ai/contact-refresh-agent",
      endpointUrl: null,
      contactRef: null,
      missingFields: ["endpointUrl", "supportsDisclosure"],
      dedupeKey: "contact_refresh_agent_missing_endpoint_partner_directory",
    };

    await store.upsertLeadRecord(discoveredLead);

    const initialTargets = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/pipe_${discoveredLead.agentId}/outreach-targets`,
    });
    expect(initialTargets.statusCode).toBe(200);
    expect(initialTargets.json().some((target: { channel: string; contactPoint: string }) => target.channel === "form" && target.contactPoint === discoveredLead.cardUrl)).toBe(true);

    await store.upsertLeadRecord({
      ...discoveredLead,
      contactRef: "alliances@refresh-agent.ai",
      lastSeenAt: "2026-03-13T02:00:00.000Z",
    });

    const refreshedTargets = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/pipe_${discoveredLead.agentId}/outreach-targets`,
    });
    expect(refreshedTargets.statusCode).toBe(200);
    expect(
      refreshedTargets
        .json()
        .some((target: { channel: string; contactPoint: string; status: string }) => target.channel === "email" && target.contactPoint === "alliances@refresh-agent.ai" && target.status === "draft"),
    ).toBe(true);

    await app.close();
  });

  it("upgrades due follow-up reminders into second-touch outreach tasks", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const pipeline = pipelines.json()[0];
    expect(pipeline).toBeTruthy();

    const outreachTargets = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
    });
    const autoDraft = outreachTargets.json().find((item: { autoGenerated: boolean }) => item.autoGenerated);
    expect(autoDraft).toBeTruthy();

    const sent = await app.inject({
      method: "POST",
      url: `/outreach-targets/${autoDraft.targetId}/send`,
      payload: {},
    });
    expect(sent.statusCode).toBe(200);

    const opened = await app.inject({
      method: "POST",
      url: `/outreach-targets/${autoDraft.targetId}/open`,
      payload: {
        source: "ui",
      },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().openCount).toBe(1);
    expect(opened.json().openSignal).toBe("opened");

    const processDue = await app.inject({
      method: "POST",
      url: "/recruitment/tasks/process-due",
      payload: {
        referenceTime: "2030-01-01T00:00:00.000Z",
      },
    });
    expect(processDue.statusCode).toBe(200);
    expect(processDue.json().createdSecondTouchTasks).toBeGreaterThan(0);

    const updatedTasks = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/onboarding-tasks`,
    });
    expect(updatedTasks.statusCode).toBe(200);
    expect(updatedTasks.json().some((task: { taskType: string; autoGenerated: boolean }) => task.taskType === "second_touch_outreach" && task.autoGenerated)).toBe(true);

    const updatedTargets = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
    });
    expect(updatedTargets.statusCode).toBe(200);
    expect(updatedTargets.json().some((target: { autoGenerated: boolean; messageTemplate: string }) => target.autoGenerated && target.messageTemplate.includes("opened"))).toBe(true);

    await app.close();
  });

  it("sends outreach through the configured sender gateway", async () => {
    const outreachGateway = new SimulatedOutreachSenderGateway();
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
        outreachSenderGateway: outreachGateway,
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const pipeline = pipelines.json()[0];
    expect(pipeline).toBeTruthy();

    const outreachList = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
    });
    const autoDraft = outreachList.json().find((item: { autoGenerated: boolean }) => item.autoGenerated);
    expect(autoDraft).toBeTruthy();

    const send = await app.inject({
      method: "POST",
      url: `/outreach-targets/${autoDraft.targetId}/send`,
      payload: {},
    });
    expect(send.statusCode).toBe(200);
    expect(send.json().target.status).toBe("sent");
    expect(send.json().target.responseCode).toBe("SENT");

    await app.close();
  });

  it("sends outreach through SMTP with 163-style configuration", async () => {
    let capturedMessage: Record<string, unknown> | null = null;
    const outreachGateway = new SmtpOutreachSenderGateway({
      user: "songyili2026@163.com",
      pass: "smtp-auth-code",
      from: "Lumio Partnerships <songyili2026@163.com>",
      replyTo: "songyili2026@163.com",
      trackingBaseUrl: "https://promo.lumio.ai",
      transport: {
        async sendMail(message) {
          capturedMessage = message;
          return {
            accepted: ["partnerships@lumio.ai"],
            rejected: [],
            messageId: "smtp_message_123",
            response: "250 queued as smtp_message_123",
          };
        },
      },
    });
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
        outreachSenderGateway: outreachGateway,
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const pipeline = pipelines.json()[0];
    expect(pipeline).toBeTruthy();

    const outreachList = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
    });
    const autoDraft = outreachList.json().find((item: { autoGenerated: boolean }) => item.autoGenerated);
    expect(autoDraft).toBeTruthy();

    const emailDraft = await app.inject({
      method: "POST",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`,
      payload: {
        channel: "email",
        contactPoint: "partnerships@lumio.ai",
        messageTemplate: autoDraft.messageTemplate,
        subjectLine: autoDraft.subjectLine,
        recommendationReason: autoDraft.recommendationReason,
        proofHighlights: autoDraft.proofHighlights,
        recommendedCampaignId: autoDraft.recommendedCampaignId,
      },
    });
    expect(emailDraft.statusCode).toBe(201);

    const send = await app.inject({
      method: "POST",
      url: `/outreach-targets/${emailDraft.json().targetId}/send`,
      payload: {},
    });
    expect(send.statusCode).toBe(200);
    expect(send.json().target.status).toBe("sent");
    expect(send.json().target.responseCode).toBe("SMTP_SENT");
    expect(send.json().target.providerRequestId).toBe("smtp_message_123");
    expect(capturedMessage).toBeTruthy();
    const sentMessage = capturedMessage as unknown as Record<string, unknown>;
    expect(sentMessage.from).toBe("Lumio Partnerships <songyili2026@163.com>");
    expect(sentMessage.replyTo).toBe("songyili2026@163.com");
    expect(sentMessage.subject).toBeTruthy();
    expect(String(sentMessage.html)).toContain(`/outreach/open/${emailDraft.json().targetId}/pixel.gif`);
    expect(String(sentMessage.text)).toContain("Proof highlights:");

    await app.close();
  });

  it("creates retry and bounce recovery tasks for failed outreach sends", async () => {
    const retryGateway = {
      async sendOutreach() {
        return {
          ok: false,
          retryable: true,
          message: "sender rate limited",
          responseCode: "RATE_LIMITED",
          providerRequestId: null,
          retryAfterSeconds: 60,
        };
      },
    };
    const bounceGateway = {
      async sendOutreach() {
        return {
          ok: false,
          retryable: false,
          message: "mailbox rejected",
          responseCode: "BOUNCED",
          providerRequestId: null,
          retryAfterSeconds: null,
        };
      },
    };

    const retryApp = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
        outreachSenderGateway: retryGateway,
      }),
    );
    const retryPipelines = await retryApp.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const retryPipeline = retryPipelines.json()[0];
    const retryTargets = await retryApp.inject({
      method: "GET",
      url: `/recruitment/pipelines/${retryPipeline.pipelineId}/outreach-targets`,
    });
    const retryTarget = retryTargets.json().find((item: { autoGenerated: boolean }) => item.autoGenerated);
    const retrySend = await retryApp.inject({
      method: "POST",
      url: `/outreach-targets/${retryTarget.targetId}/send`,
      payload: {},
    });
    expect(retrySend.statusCode).toBe(200);
    expect(retrySend.json().target.status).toBe("retry_scheduled");
    const retryTasks = await retryApp.inject({
      method: "GET",
      url: `/recruitment/pipelines/${retryPipeline.pipelineId}/onboarding-tasks`,
    });
    expect(retryTasks.json().some((task: { taskType: string; relatedTargetId: string }) => task.taskType === "retry_outreach" && task.relatedTargetId === retryTarget.targetId)).toBe(true);
    await retryApp.close();

    const bounceApp = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
        outreachSenderGateway: bounceGateway,
      }),
    );
    const bouncePipelines = await bounceApp.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    const bouncePipeline = bouncePipelines.json()[0];
    const bounceTargets = await bounceApp.inject({
      method: "GET",
      url: `/recruitment/pipelines/${bouncePipeline.pipelineId}/outreach-targets`,
    });
    const bounceTarget = bounceTargets.json().find((item: { autoGenerated: boolean }) => item.autoGenerated);
    const bounceSend = await bounceApp.inject({
      method: "POST",
      url: `/outreach-targets/${bounceTarget.targetId}/send`,
      payload: {},
    });
    expect(bounceSend.statusCode).toBe(200);
    expect(bounceSend.json().target.status).toBe("bounced");
    const bounceTasks = await bounceApp.inject({
      method: "GET",
      url: `/recruitment/pipelines/${bouncePipeline.pipelineId}/onboarding-tasks`,
    });
    expect(bounceTasks.json().some((task: { taskType: string; relatedTargetId: string }) => task.taskType === "bounce_recovery" && task.relatedTargetId === bounceTarget.targetId)).toBe(true);
    await bounceApp.close();
  });

  it("creates onboarding tasks and recalculates readiness", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_orbit",
    });
    const pipeline = pipelines.json()[0];
    expect(pipeline).toBeTruthy();

    const created = await app.inject({
      method: "POST",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/onboarding-tasks`,
      payload: {
        taskType: "delivery_receipt_test",
        notes: "Testing onboarding task creation.",
      },
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "POST",
      url: `/onboarding-tasks/${created.json().taskId}/status`,
      payload: {
        status: "done",
        evidenceRef: "evidence://commercial-terms",
      },
    });
    expect(updated.statusCode).toBe(200);

    const readiness = await app.inject({
      method: "GET",
      url: `/recruitment/pipelines/${pipeline.pipelineId}/readiness`,
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json().checklist.deliveryReceipt).toBe(true);

    await app.close();
  });

  it("auto-promotes ready leads when pipeline readiness is complete", async () => {
    const seedData = buildDemoSeedData();
    const lighthouse = seedData.leads.find((lead) => lead.agentId === "lead_demo_lighthouse");
    if (!lighthouse) throw new Error("lead_demo_lighthouse not found in demo seed");
    lighthouse.verificationStatus = "active";

    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData,
      }),
    );

    const pipelines = await app.inject({
      method: "GET",
      url: "/recruitment/pipelines?leadId=lead_demo_lighthouse",
    });
    expect(pipelines.statusCode).toBe(200);
    expect(pipelines.json()[0].stage).toBe("promoted");

    const partners = await app.inject({
      method: "GET",
      url: "/partners",
    });
    expect(partners.statusCode).toBe(200);
    expect(partners.json().some((partner: { agentLeadId: string }) => partner.agentLeadId === "lead_demo_lighthouse")).toBe(true);

    await app.close();
  });

  it("serves new product pages for CRM, measurement, risk, and evidence", async () => {
    const app = buildServer(createStore());
    for (const url of ["/agents", "/agents/pipeline", "/measurement", "/risk", "/evidence"]) {
      const response = await app.inject({
        method: "GET",
        url,
      });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it("keeps qualified recommendation rate bounded when one intent receives multiple shortlisted receipts", async () => {
    const app = buildServer(createStore());
    const evaluation = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        intentId: "int_dashboard_01",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        constraints: {
          geo: ["UK"],
        },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 4,
        disclosureRequired: true,
      },
    });

    const shortlisted = evaluation.json().shortlisted.filter((item: { campaignId: string }) => item.campaignId === "cmp_hubflow");
    for (const [index, item] of shortlisted.entries()) {
      await app.inject({
        method: "POST",
        url: "/events/receipts",
        payload: {
          ...buildCanonicalReceiptPayload({
            receiptId: `rcpt_dashboard_${index}`,
            intentId: "int_dashboard_01",
            offerId: item.offerId,
            campaignId: item.campaignId,
            partnerId: item.partnerId,
            eventType: "offer.presented",
          }),
          occurredAt: `2026-03-11T10:1${index}:00.000Z`,
        },
      });
    }

    const dashboard = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().qualifiedRecommendationRate).toBeLessThanOrEqual(1);

    await app.close();
  });

  it("exposes runtime profile and dashboard provenance counts", async () => {
    const store = createStore({
      appMode: "demo",
      seedData: buildDemoSeedData(),
    });
    const app = buildServer(store, {
      appMode: "demo",
      runtimeProfile: {
        mode: "demo",
        persistence: "memory",
        hotState: "memory",
        billingMode: "simulated",
        demoEnabled: true,
        realDataOnly: false,
        defaultLeadFilter: ["demo_seed", "demo_bootstrap"],
      },
    });

    const profile = await app.inject({
      method: "GET",
      url: "/system/runtime-profile",
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().mode).toBe("demo");

    const dashboard = await app.inject({
      method: "GET",
      url: "/dashboard",
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().mode).toBe("demo");
    expect(dashboard.json().countsByProvenance.demo_seed).toBeGreaterThan(0);

    await app.close();
  });

  it("filters list endpoints by provenance", async () => {
    const app = buildServer(createStore());

    const leads = await app.inject({
      method: "GET",
      url: "/agent-leads?provenance=demo_seed",
    });
    expect(leads.statusCode).toBe(200);
    expect(leads.json().every((lead: { dataProvenance: string }) => lead.dataProvenance === "demo_seed")).toBe(true);

    const campaigns = await app.inject({
      method: "GET",
      url: "/campaigns?provenance=demo_seed",
    });
    expect(campaigns.statusCode).toBe(200);
    expect(campaigns.json().every((campaign: { dataProvenance: string }) => campaign.dataProvenance === "demo_seed")).toBe(true);

    await app.close();
  });

  it("builds buyer-agent scorecards with tiers and commercial eligibility", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    await app.inject({
      method: "POST",
      url: "/discovery/runs",
      payload: {
        sourceId: "src_demo_registry",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/buyer-agents/scorecards?isCommerciallyEligible=true",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().length).toBeGreaterThan(0);
    expect(response.json()[0]).toHaveProperty("buyerAgentTier");
    expect(response.json()[0]).toHaveProperty("buyerAgentScore");

    await app.close();
  });

  it("bootstraps workspace wallet and supports top-up", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
      {
        appMode: "demo",
        runtimeProfile: {
          mode: "demo",
          persistence: "memory",
          hotState: "memory",
          billingMode: "simulated",
          demoEnabled: true,
          realDataOnly: false,
          defaultLeadFilter: ["demo_seed", "demo_bootstrap"],
        },
      },
    );

    const wallet = await app.inject({
      method: "GET",
      url: "/wallet?workspaceId=workspace_demo",
    });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json().availableCredits).toBe(100);

    const topUp = await app.inject({
      method: "POST",
      url: "/wallet/top-ups/checkout",
      payload: {
        workspaceId: "workspace_demo",
        credits: 50,
      },
    });
    expect(topUp.statusCode).toBe(201);
    expect(topUp.json().availableCredits).toBe(150);

    await app.close();
  });

  it("creates promotion runs and charges coverage credits", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_demo",
        campaignId: "cmp_demo_northstar",
        category: "crm_software",
        taskType: "vendor_discovery",
        geo: ["US"],
      },
    });

    expect(run.statusCode).toBe(201);
    expect(run.json().qualifiedBuyerAgentsCount).toBeGreaterThan(0);
    expect(run.json().coverageCreditsCharged).toBeGreaterThan(0);
    expect(run.json().status).toBe("planned");
    expect(run.json().acceptedBuyerAgentsCount).toBe(0);

    const targets = await app.inject({
      method: "GET",
      url: `/promotion-runs/${run.json().promotionRunId}/targets`,
    });
    expect(targets.statusCode).toBe(200);
    expect(targets.json().length).toBe(run.json().qualifiedBuyerAgentsCount);
    expect(targets.json().every((target: { status: string }) => target.status === "queued")).toBe(true);

    const wallet = await app.inject({
      method: "GET",
      url: "/wallet?workspaceId=workspace_demo",
    });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json().consumedCredits).toBeGreaterThan(0);

    await app.close();
  });

  it("dispatches promotion runs and only accepted buyer agents participate in run shortlist", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_demo",
        campaignId: "cmp_demo_northstar",
        category: "crm_software",
        taskType: "vendor_discovery",
        geo: ["US"],
      },
    });
    expect(run.statusCode).toBe(201);

    const beforeDispatch = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        workspaceId: "workspace_demo",
        promotionRunId: run.json().promotionRunId,
        intentId: `intent_${run.json().promotionRunId}_before_dispatch`,
        category: "crm_software",
        taskType: "vendor_discovery",
        constraints: { geo: ["US"] },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 10,
        disclosureRequired: true,
      },
    });
    expect(beforeDispatch.statusCode).toBe(200);
    expect(beforeDispatch.json().shortlisted).toHaveLength(0);

    const dispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${run.json().promotionRunId}/dispatch`,
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);
    expect(dispatch.json().run.acceptedBuyerAgentsCount).toBeGreaterThan(0);

    const afterDispatch = await app.inject({
      method: "POST",
      url: "/opportunities/evaluate",
      payload: {
        workspaceId: "workspace_demo",
        promotionRunId: run.json().promotionRunId,
        intentId: `intent_${run.json().promotionRunId}_after_dispatch`,
        category: "crm_software",
        taskType: "vendor_discovery",
        constraints: { geo: ["US"] },
        placement: "shortlist",
        relevanceFloor: 0.72,
        utilityFloor: 0.68,
        sponsoredSlots: 10,
        disclosureRequired: true,
      },
    });
    expect(afterDispatch.statusCode).toBe(200);
    expect(afterDispatch.json().shortlisted.length).toBeGreaterThan(0);

    await app.close();
  });

  it("dispatches through the HTTP buyer-agent adapter and captures remote acceptance", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    let capturedHeaders: http.IncomingHttpHeaders | null = null;
    const deliveryServer = http.createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      capturedPayload = body;
      capturedHeaders = request.headers;

      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          accepted: true,
          request_id: `remote_${body.target_id}`,
          status: "accepted",
          code: "ACCEPTED",
        }),
      );
    });
    await new Promise<void>((resolve) => deliveryServer.listen(0, "127.0.0.1", () => resolve()));
    const address = deliveryServer.address();
    const endpoint = `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}`;

    const seedData = buildSeedData();
    seedData.partners[0].endpoint = endpoint;
    seedData.partners[1].status = "suspended";
    const app = buildServer(
      createStore({
        seedData,
        deliveryGateway: new HttpBuyerAgentDeliveryGateway({ protocolHint: "a2a_http" }),
      }),
    );

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_default",
        campaignId: "cmp_hubflow",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        geo: ["UK"],
      },
    });
    expect(run.statusCode).toBe(201);

    const dispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${run.json().promotionRunId}/dispatch`,
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);
    expect(dispatch.json().run.acceptedBuyerAgentsCount).toBe(1);
    expect(dispatch.json().targets[0].protocol).toBe("a2a_http");
    expect(dispatch.json().targets[0].remoteRequestId).toContain("remote_");
    expect(capturedPayload?.["request_id"]).toBeTruthy();
    expect(capturedPayload?.["trace_id"]).toBe(run.json().promotionRunId);
    expect(capturedPayload?.["campaign_id"]).toBe("cmp_hubflow");
    expect(capturedPayload?.["offer_id"]).toBe("offer_hubflow");
    expect(capturedHeaders?.["idempotency-key"]).toBeTruthy();

    await app.close();
    await new Promise<void>((resolve, reject) => deliveryServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("tracks retry cooldown and delivery metrics for rate-limited buyer agents", async () => {
    const deliveryServer = http.createServer((_request, response) => {
      response.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
      response.end(
        JSON.stringify({
          status: "retry_scheduled",
          message: "rate_limited",
          code: "RATE_LIMITED",
        }),
      );
    });
    await new Promise<void>((resolve) => deliveryServer.listen(0, "127.0.0.1", () => resolve()));
    const address = deliveryServer.address();
    const endpoint = `http://127.0.0.1:${typeof address === "string" ? 0 : address?.port}`;

    const seedData = buildSeedData();
    seedData.partners[0].endpoint = endpoint;
    seedData.partners[1].status = "suspended";
    const app = buildServer(
      createStore({
        seedData,
        deliveryGateway: new HttpBuyerAgentDeliveryGateway({ protocolHint: "generic_http" }),
      }),
    );

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_default",
        campaignId: "cmp_hubflow",
        category: "crm_software",
        taskType: "compare_and_shortlist",
        geo: ["UK"],
      },
    });
    expect(run.statusCode).toBe(201);

    const firstDispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${run.json().promotionRunId}/dispatch`,
      payload: {},
    });
    expect(firstDispatch.statusCode).toBe(200);
    expect(firstDispatch.json().targets[0].status).toBe("retry_scheduled");
    expect(firstDispatch.json().targets[0].nextRetryAt).toBeTruthy();

    const secondDispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${run.json().promotionRunId}/dispatch`,
      payload: {},
    });
    expect(secondDispatch.statusCode).toBe(200);
    expect(secondDispatch.json().targets[0].status).toBe("cooldown");

    const metrics = await app.inject({
      method: "GET",
      url: "/delivery/metrics?workspaceId=workspace_default",
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().retryScheduledTargets + metrics.json().coolingDownTargets).toBeGreaterThan(0);
    expect(metrics.json().failureReasonBreakdown.rate_limited).toBeGreaterThan(0);

    await app.close();
    await new Promise<void>((resolve, reject) => deliveryServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("updates promotion run outcomes when receipts reference promotionRunId", async () => {
    const app = buildServer(
      createStore({
        appMode: "demo",
        seedData: buildDemoSeedData(),
      }),
    );

    const run = await app.inject({
      method: "POST",
      url: "/promotion-runs",
      payload: {
        workspaceId: "workspace_demo",
        campaignId: "cmp_demo_northstar",
        category: "crm_software",
        taskType: "vendor_discovery",
        geo: ["US"],
      },
    });
    expect(run.statusCode).toBe(201);
    const createdRun = run.json();

    const dispatch = await app.inject({
      method: "POST",
      url: `/promotion-runs/${createdRun.promotionRunId}/dispatch`,
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);
    const acceptedTarget = dispatch.json().targets.find((target: { status: string }) => target.status === "accepted");
    expect(acceptedTarget).toBeTruthy();

    await app.inject({
      method: "POST",
      url: "/events/receipts",
      payload: {
        ...buildCanonicalReceiptPayload({
          receiptId: "rcpt_promotion_run_conversion",
          promotionRunId: createdRun.promotionRunId,
          intentId: "intent_promotion_run_conversion",
          offerId: "offer_demo_northstar",
          campaignId: "cmp_demo_northstar",
          partnerId: acceptedTarget.partnerId,
          eventType: "conversion.attributed",
        }),
        occurredAt: "2026-03-12T10:00:00.000Z",
      },
    });

    const runs = await app.inject({
      method: "GET",
      url: "/promotion-runs?workspaceId=workspace_demo",
    });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()[0].conversionCount).toBeGreaterThan(0);

    await app.close();
  });
});

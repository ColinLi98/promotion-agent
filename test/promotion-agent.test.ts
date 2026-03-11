import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";
import { createStore } from "../src/store.js";

describe("promotion-agent MVP flow", () => {
  it("creates a draft campaign, passes policy, activates it, and exposes it to opportunity exchange", async () => {
    const app = buildServer(createStore());

    const creation = await app.inject({
      method: "POST",
      url: "/campaigns",
      payload: {
        advertiser: "PipelineOS",
        category: "crm_software",
        regions: ["UK"],
        billingModel: "CPQR",
        payoutAmount: 180,
        currency: "USD",
        budget: 9000,
        disclosureText: "Sponsored recommendation from PipelineOS.",
        minTrust: 0.66,
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
          actionEndpoints: ["https://api.pipelineos.example.com/demo"],
          positioningBullets: ["forecast accuracy", "handoff workflows"],
        },
        proofReferences: [
          {
            label: "Security overview",
            type: "doc",
            url: "https://pipelineos.example.com/security",
          },
        ],
      },
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
          actionEndpoints: ["https://api.riskycrm.example.com/signup"],
          positioningBullets: ["guaranteed growth"],
        },
        proofReferences: [
          {
            label: "Marketing brochure",
            type: "doc",
            url: "https://riskycrm.example.com/brochure",
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

  it("creates a settlement for CPQR on shortlisted receipt and deduplicates repeats", async () => {
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
    const receiptPayload = {
      receiptId: "rcpt_001",
      intentId: "int_settlement_01",
      offerId: offer!.offerId,
      campaignId: offer!.campaignId,
      partnerId: offer!.partnerId,
      eventType: "shortlisted",
      occurredAt: "2026-03-11T10:00:00.000Z",
      signature: "sig_demo",
    };

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

    const payload = {
      receiptId: "rcpt_concurrent_01",
      intentId: "int_concurrent_01",
      offerId: offer!.offerId,
      campaignId: offer!.campaignId,
      partnerId: offer!.partnerId,
      eventType: "shortlisted",
      occurredAt: "2026-03-11T10:05:00.000Z",
      signature: "sig_concurrent",
    };

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
      payload: {
        receiptId: "rcpt_retry_queue_01",
        intentId: "int_retry_queue_01",
        offerId: offer!.offerId,
        campaignId: offer!.campaignId,
        partnerId: offer!.partnerId,
        eventType: "shortlisted",
        occurredAt: "2026-03-11T10:20:00.000Z",
        signature: "sig_retry_queue",
      },
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
          actionEndpoints: ["https://api.paginated.example.com/demo"],
          positioningBullets: [],
        },
        proofReferences: [
          {
            label: "Security",
            type: "doc",
            url: "https://paginated.example.com/security",
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
      payload: {
        receiptId: "rcpt_dlq_01",
        intentId: "int_dlq_01",
        offerId: offer!.offerId,
        campaignId: offer!.campaignId,
        partnerId: offer!.partnerId,
        eventType: "shortlisted",
        occurredAt: "2026-03-11T10:30:00.000Z",
        signature: "sig_dlq",
      },
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
          receiptId: `rcpt_dashboard_${index}`,
          intentId: "int_dashboard_01",
          offerId: item.offerId,
          campaignId: item.campaignId,
          partnerId: item.partnerId,
          eventType: "shortlisted",
          occurredAt: `2026-03-11T10:1${index}:00.000Z`,
          signature: "sig_dashboard",
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
});

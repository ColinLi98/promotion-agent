import type { EventReceipt } from "./domain.js";
import type { PromotionAgentStore } from "./store.js";

const demoReceipt = (receipt: EventReceipt): EventReceipt => receipt;

export const bootstrapDemoScenario = async (store: PromotionAgentStore) => {
  const existingSettlements = await store.listSettlements();
  if (existingSettlements.length > 0) {
    return;
  }

  const receiptsToSettle = [
    demoReceipt({
      receiptId: "rcpt_demo_hubflow_shown",
      intentId: "int_demo_hubflow_01",
      offerId: "offer_demo_hubflow",
      campaignId: "cmp_demo_hubflow",
      partnerId: "partner_demo_northstar",
      eventType: "shown",
      occurredAt: "2026-03-11T09:00:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_hubflow_detail",
      intentId: "int_demo_hubflow_01",
      offerId: "offer_demo_hubflow",
      campaignId: "cmp_demo_hubflow",
      partnerId: "partner_demo_northstar",
      eventType: "detail_view",
      occurredAt: "2026-03-11T09:01:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_hubflow_handoff",
      intentId: "int_demo_hubflow_01",
      offerId: "offer_demo_hubflow",
      campaignId: "cmp_demo_hubflow",
      partnerId: "partner_demo_northstar",
      eventType: "handoff",
      occurredAt: "2026-03-11T09:02:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_hubflow_shortlisted",
      intentId: "int_demo_hubflow_01",
      offerId: "offer_demo_hubflow",
      campaignId: "cmp_demo_hubflow",
      partnerId: "partner_demo_northstar",
      eventType: "shortlisted",
      occurredAt: "2026-03-11T09:03:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_northstar_shown",
      intentId: "int_demo_northstar_02",
      offerId: "offer_demo_northstar",
      campaignId: "cmp_demo_northstar",
      partnerId: "partner_demo_vector",
      eventType: "shown",
      occurredAt: "2026-03-11T10:00:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_northstar_detail",
      intentId: "int_demo_northstar_02",
      offerId: "offer_demo_northstar",
      campaignId: "cmp_demo_northstar",
      partnerId: "partner_demo_vector",
      eventType: "detail_view",
      occurredAt: "2026-03-11T10:01:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_northstar_shortlisted",
      intentId: "int_demo_northstar_02",
      offerId: "offer_demo_northstar",
      campaignId: "cmp_demo_northstar",
      partnerId: "partner_demo_vector",
      eventType: "shortlisted",
      occurredAt: "2026-03-11T10:02:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_signalstack_shown",
      intentId: "int_demo_signalstack_03",
      offerId: "offer_demo_signalstack",
      campaignId: "cmp_demo_signalstack",
      partnerId: "partner_demo_summit",
      eventType: "shown",
      occurredAt: "2026-03-11T11:00:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_signalstack_detail",
      intentId: "int_demo_signalstack_03",
      offerId: "offer_demo_signalstack",
      campaignId: "cmp_demo_signalstack",
      partnerId: "partner_demo_summit",
      eventType: "detail_view",
      occurredAt: "2026-03-11T11:01:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_signalstack_handoff",
      intentId: "int_demo_signalstack_03",
      offerId: "offer_demo_signalstack",
      campaignId: "cmp_demo_signalstack",
      partnerId: "partner_demo_summit",
      eventType: "handoff",
      occurredAt: "2026-03-11T11:02:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_signalstack_conversion",
      intentId: "int_demo_signalstack_03",
      offerId: "offer_demo_signalstack",
      campaignId: "cmp_demo_signalstack",
      partnerId: "partner_demo_summit",
      eventType: "conversion",
      occurredAt: "2026-03-11T11:03:00.000Z",
      signature: "sig_demo",
    }),
    demoReceipt({
      receiptId: "rcpt_demo_vector_shortlisted",
      intentId: "int_demo_vector_04",
      offerId: "offer_demo_vector",
      campaignId: "cmp_demo_vector",
      partnerId: "partner_demo_vector",
      eventType: "shortlisted",
      occurredAt: "2026-03-11T12:00:00.000Z",
      signature: "sig_demo",
    }),
  ];

  for (const receipt of receiptsToSettle) {
    await store.recordReceipt(receipt);
  }

  await store.processSettlementRetryQueue(20);

  await store.recordReceipt(
    demoReceipt({
      receiptId: "rcpt_demo_queue_pending",
      intentId: "int_demo_queue_05",
      offerId: "offer_demo_hubflow",
      campaignId: "cmp_demo_hubflow",
      partnerId: "partner_demo_summit",
      eventType: "shortlisted",
      occurredAt: "2026-03-11T13:00:00.000Z",
      signature: "sig_demo",
    }),
  );

  const disputed = await store.recordReceipt(
    demoReceipt({
      receiptId: "rcpt_demo_disputed",
      intentId: "int_demo_dispute_06",
      offerId: "offer_demo_northstar",
      campaignId: "cmp_demo_northstar",
      partnerId: "partner_demo_northstar",
      eventType: "shortlisted",
      occurredAt: "2026-03-11T14:00:00.000Z",
      signature: "sig_demo",
    }),
  );

  if (disputed.settlement) {
    await store.markSettlementDisputed(disputed.settlement.settlementId);
    await store.createRiskCase({
      entityType: "settlement",
      entityId: disputed.settlement.settlementId,
      reasonType: "policy_violation",
      severity: "medium",
      ownerId: "risk:irene",
      note: "Disputed settlement created for demo queue handling.",
    });
  }
};

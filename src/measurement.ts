import {
  MeasurementFunnelSchema,
  type AttributionRow,
  type BillingDraft,
  type Campaign,
  type EventReceipt,
  type MeasurementFunnel,
  type MeasurementFunnelQuery,
  type PartnerAgent,
  type SettlementReceipt,
} from "./domain.js";

const inRange = (iso: string, from?: string, to?: string) => {
  const ts = new Date(iso).getTime();
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const matchesQuery = (
  receipt: EventReceipt,
  campaigns: Campaign[],
  partners: PartnerAgent[],
  query: MeasurementFunnelQuery,
) => {
  const campaign = campaigns.find((item) => item.campaignId === receipt.campaignId);
  const partner = partners.find((item) => item.partnerId === receipt.partnerId);

  if (query.campaignId && receipt.campaignId !== query.campaignId) return false;
  if (query.partnerId && receipt.partnerId !== query.partnerId) return false;
  if (query.vertical && campaign?.category !== query.vertical) return false;
  if (!inRange(receipt.occurredAt, query.dateFrom, query.dateTo)) return false;
  return Boolean(campaign || partner);
};

export const buildMeasurementFunnel = (
  receipts: EventReceipt[],
  campaigns: Campaign[],
  partners: PartnerAgent[],
  query: MeasurementFunnelQuery,
): MeasurementFunnel => {
  const filtered = receipts.filter((receipt) => matchesQuery(receipt, campaigns, partners, query));
  const counts = {
    shortlisted: filtered.filter((item) => item.eventType === "shortlisted").length,
    shown: filtered.filter((item) => item.eventType === "shown").length,
    detailView: filtered.filter((item) => item.eventType === "detail_view").length,
    handoff: filtered.filter((item) => item.eventType === "handoff").length,
    conversion: filtered.filter((item) => item.eventType === "conversion").length,
  };

  return MeasurementFunnelSchema.parse({
    ...counts,
    detailViewRate: counts.shown > 0 ? counts.detailView / counts.shown : 0,
    handoffRate: counts.detailView > 0 ? counts.handoff / counts.detailView : 0,
    actionConversionRate: counts.handoff > 0 ? counts.conversion / counts.handoff : 0,
  });
};

export const buildAttributionRows = (
  receipts: EventReceipt[],
  settlements: SettlementReceipt[],
  campaigns: Campaign[],
  query: MeasurementFunnelQuery,
): AttributionRow[] => {
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));
  const filteredReceipts = receipts.filter((receipt) => {
    const campaign = campaignMap.get(receipt.campaignId);
    if (!campaign) return false;
    if (query.campaignId && receipt.campaignId !== query.campaignId) return false;
    if (query.partnerId && receipt.partnerId !== query.partnerId) return false;
    if (query.vertical && campaign.category !== query.vertical) return false;
    if (!inRange(receipt.occurredAt, query.dateFrom, query.dateTo)) return false;
    return true;
  });

  const grouped = new Map<string, AttributionRow>();
  for (const receipt of filteredReceipts) {
    const campaign = campaignMap.get(receipt.campaignId)!;
    const key = `${receipt.campaignId}:${receipt.partnerId}`;
    const current = grouped.get(key) ?? {
      campaignId: receipt.campaignId,
      partnerId: receipt.partnerId,
      billingModel: campaign.billingModel,
      shortlisted: 0,
      conversions: 0,
      billableEvents: 0,
      billedAmount: 0,
      currency: campaign.currency,
    };
    if (receipt.eventType === "shortlisted") current.shortlisted += 1;
    if (receipt.eventType === "conversion") current.conversions += 1;
    grouped.set(key, current);
  }

  for (const settlement of settlements) {
    if (query.campaignId && settlement.campaignId !== query.campaignId) continue;
    if (query.partnerId && settlement.partnerId !== query.partnerId) continue;
    if (!inRange(settlement.generatedAt, query.dateFrom, query.dateTo)) continue;
    const campaign = campaignMap.get(settlement.campaignId);
    if (!campaign) continue;
    if (query.vertical && campaign.category !== query.vertical) continue;

    const key = `${settlement.campaignId}:${settlement.partnerId}`;
    const current = grouped.get(key) ?? {
      campaignId: settlement.campaignId,
      partnerId: settlement.partnerId,
      billingModel: settlement.billingModel,
      shortlisted: 0,
      conversions: 0,
      billableEvents: 0,
      billedAmount: 0,
      currency: settlement.currency,
    };
    current.billableEvents += 1;
    current.billedAmount += settlement.amount;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => right.billedAmount - left.billedAmount);
};

export const buildBillingDrafts = (
  settlements: SettlementReceipt[],
  campaigns: Campaign[],
): BillingDraft[] => {
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));
  const grouped = new Map<string, BillingDraft>();
  for (const settlement of settlements) {
    const campaign = campaignMap.get(settlement.campaignId);
    if (!campaign) continue;
    const key = `${settlement.campaignId}:${settlement.partnerId}`;
    const current = grouped.get(key) ?? {
      campaignId: settlement.campaignId,
      partnerId: settlement.partnerId,
      billingModel: settlement.billingModel,
      pendingSettlements: 0,
      settledSettlements: 0,
      failedSettlements: 0,
      totalAmount: 0,
      currency: settlement.currency,
    };

    if (settlement.status === "settled") current.settledSettlements += 1;
    else if (settlement.status === "failed" || settlement.status === "disputed") current.failedSettlements += 1;
    else current.pendingSettlements += 1;
    current.totalAmount += settlement.amount;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => right.totalAmount - left.totalAmount);
};

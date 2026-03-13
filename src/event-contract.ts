import type { AppMode, EventReceipt, EventType } from "./domain.js";

const CANONICAL_EVENT_TYPES = {
  shortlisted: "offer.shortlisted",
  presented: "offer.presented",
  viewed: "owner.viewed",
  interacted: "owner.interacted",
  converted: "conversion.attributed",
} as const;

export type CanonicalEventType = EventType;

export type CanonicalEventReceipt = EventReceipt & {
  specVersion: string;
  eventId: string;
  traceId: string;
  producerAgentId: string;
  consumerAgentId: string | null;
  buyerAgentId: string;
  sellerAgentId: string | null;
  opportunityId: string;
  deliveryId: string | null;
  taskId: string | null;
  environment: "prod" | "staging" | "test";
  ownerSessionRef: string | null;
  actionId: string | null;
  interactionType: string | null;
  payload: Record<string, unknown>;
  eventType: CanonicalEventType;
};

export const canonicalizeEventType = (eventType: EventType): CanonicalEventType => {
  switch (eventType) {
    case "offer.shortlisted":
    case "shortlisted":
      return CANONICAL_EVENT_TYPES.shortlisted;
    case "offer.presented":
    case "presented":
    case "shown":
      return CANONICAL_EVENT_TYPES.presented;
    case "owner.viewed":
    case "viewed":
    case "detail_view":
      return CANONICAL_EVENT_TYPES.viewed;
    case "owner.interacted":
    case "interacted":
    case "handoff":
      return CANONICAL_EVENT_TYPES.interacted;
    case "conversion.attributed":
    case "conversion":
      return CANONICAL_EVENT_TYPES.converted;
    default:
      return eventType;
  }
};

export const isShortlistedEvent = (eventType: EventType) =>
  canonicalizeEventType(eventType) === CANONICAL_EVENT_TYPES.shortlisted;
export const isPresentedEvent = (eventType: EventType) =>
  canonicalizeEventType(eventType) === CANONICAL_EVENT_TYPES.presented;
export const isViewedEvent = (eventType: EventType) =>
  canonicalizeEventType(eventType) === CANONICAL_EVENT_TYPES.viewed;
export const isInteractedEvent = (eventType: EventType) =>
  canonicalizeEventType(eventType) === CANONICAL_EVENT_TYPES.interacted;
export const isConvertedEvent = (eventType: EventType) =>
  canonicalizeEventType(eventType) === CANONICAL_EVENT_TYPES.converted;

const defaultEnvironmentForMode = (mode: AppMode): "prod" | "staging" | "test" => {
  if (mode === "demo") return "staging";
  return "test";
};

const defaultProducerAgentId = (eventType: CanonicalEventType, buyerAgentId: string) => {
  if (eventType === CANONICAL_EVENT_TYPES.shortlisted || eventType === CANONICAL_EVENT_TYPES.presented) {
    return buyerAgentId;
  }
  if (eventType === CANONICAL_EVENT_TYPES.viewed || eventType === CANONICAL_EVENT_TYPES.interacted || eventType === CANONICAL_EVENT_TYPES.converted) {
    return buyerAgentId;
  }
  return "promotion-agent";
};

export const normalizeEventReceipt = (receipt: EventReceipt, appMode: AppMode): CanonicalEventReceipt => {
  const eventType = canonicalizeEventType(receipt.eventType);
  const eventId = receipt.eventId ?? receipt.receiptId;
  const opportunityId = receipt.opportunityId ?? receipt.intentId;
  const traceId = receipt.traceId ?? opportunityId;
  const buyerAgentId = receipt.buyerAgentId ?? receipt.partnerId;
  const deliveryId = receipt.deliveryId ?? receipt.promotionRunId ?? null;
  const ownerSessionRef =
    receipt.ownerSessionRef ??
    (typeof receipt.payload.ownerSessionRef === "string" ? receipt.payload.ownerSessionRef : null);
  const actionId =
    receipt.actionId ??
    (typeof receipt.payload.actionId === "string" ? receipt.payload.actionId : null);
  const interactionType =
    receipt.interactionType ??
    (typeof receipt.payload.interactionType === "string" ? receipt.payload.interactionType : null);

  return {
    ...receipt,
    specVersion: receipt.specVersion,
    eventId,
    traceId,
    correlationId: receipt.correlationId ?? deliveryId,
    producerAgentId: receipt.producerAgentId ?? defaultProducerAgentId(eventType, buyerAgentId),
    consumerAgentId: receipt.consumerAgentId ?? null,
    buyerAgentId,
    sellerAgentId: receipt.sellerAgentId ?? "promotion-agent",
    opportunityId,
    intentId: opportunityId,
    deliveryId,
    taskId: receipt.taskId ?? null,
    partnerId: buyerAgentId,
    eventType,
    environment: receipt.environment ?? defaultEnvironmentForMode(appMode),
    ownerSessionRef,
    actionId,
    interactionType,
    payload: {
      ...receipt.payload,
      ownerSessionRef,
      actionId,
      interactionType,
    },
  };
};

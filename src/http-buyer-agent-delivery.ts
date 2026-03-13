import crypto from "node:crypto";

import type { Campaign, PromotionRun, PromotionRunTarget } from "./domain.js";
import type {
  BuyerAgentDeliveryGateway,
  BuyerAgentDeliveryProtocol,
  BuyerAgentDeliveryRequest,
  BuyerAgentDeliveryResult,
} from "./buyer-agent-delivery.js";

type HttpBuyerAgentDeliveryGatewayOptions = {
  timeoutMs?: number;
  apiKey?: string;
  hmacSecret?: string;
  signatureHeader?: string;
  timestampHeader?: string;
  protocolHint?: BuyerAgentDeliveryProtocol;
};

const acceptedStatuses = new Set(["accepted", "ok", "queued", "scheduled", "received"]);
const rejectedStatuses = new Set(["rejected", "blocked", "denied", "unsupported"]);
const retryStatuses = new Set(["retry", "retry_scheduled", "cooldown", "rate_limited"]);

const parseRetryAfterSeconds = (value: string | null) => {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const detectProtocol = (payload: Record<string, unknown> | null, hint?: BuyerAgentDeliveryProtocol) => {
  if (hint && hint !== "generic_http") return hint;
  const protocolValue = payload?.protocol;
  if (protocolValue === "mcp_http" || protocolValue === "a2a_http" || protocolValue === "generic_http") {
    return protocolValue;
  }
  if ("tool_result" in (payload ?? {}) || "mcp_result" in (payload ?? {})) {
    return "mcp_http";
  }
  return hint ?? "generic_http";
};

const normalizeStatus = (payload: Record<string, unknown> | null) => {
  const nestedStatus =
    typeof payload?.status === "string"
      ? payload.status
      : typeof payload?.result === "object" && payload.result && "status" in payload.result && typeof payload.result.status === "string"
        ? payload.result.status
        : typeof payload?.delivery === "object" &&
            payload.delivery &&
            "status" in payload.delivery &&
            typeof payload.delivery.status === "string"
          ? payload.delivery.status
          : null;
  return nestedStatus?.toLowerCase() ?? null;
};

const normalizeAccepted = (payload: Record<string, unknown> | null, responseOk: boolean) => {
  const directAccepted =
    typeof payload?.accepted === "boolean"
      ? payload.accepted
      : typeof payload?.result === "object" && payload.result && "accepted" in payload.result && typeof payload.result.accepted === "boolean"
        ? payload.result.accepted
        : typeof payload?.delivery === "object" &&
            payload.delivery &&
            "accepted" in payload.delivery &&
            typeof payload.delivery.accepted === "boolean"
          ? payload.delivery.accepted
          : null;
  if (directAccepted !== null) return directAccepted;

  const status = normalizeStatus(payload);
  if (status && acceptedStatuses.has(status)) return true;
  if (status && rejectedStatuses.has(status)) return false;
  return responseOk;
};

const normalizeRetryable = (payload: Record<string, unknown> | null, statusCode: number) => {
  if (typeof payload?.retryable === "boolean") return payload.retryable;
  const status = normalizeStatus(payload);
  if (status && retryStatuses.has(status)) return true;
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
};

const normalizeMessage = (payload: Record<string, unknown> | null, fallback: string) => {
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload?.error === "object" && payload.error && "message" in payload.error && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return fallback;
};

const normalizeRemoteRequestId = (payload: Record<string, unknown> | null) => {
  if (typeof payload?.request_id === "string") return payload.request_id;
  if (typeof payload?.dispatch_id === "string") return payload.dispatch_id;
  if (typeof payload?.delivery === "object" && payload.delivery && "request_id" in payload.delivery && typeof payload.delivery.request_id === "string") {
    return payload.delivery.request_id;
  }
  return null;
};

const normalizeResponseCode = (payload: Record<string, unknown> | null, statusCode: number) => {
  if (typeof payload?.code === "string") return payload.code;
  if (typeof payload?.error === "object" && payload.error && "code" in payload.error && typeof payload.error.code === "string") {
    return payload.error.code;
  }
  return String(statusCode);
};

const buildDispatchPayload = (run: PromotionRun, target: PromotionRunTarget, campaign: Campaign, attemptNo: number) => {
  const requestId = `${run.promotionRunId}:${target.targetId}:attempt_${attemptNo}`;
  const traceId = run.promotionRunId;
  const deliveryId = target.targetId;
  const idempotencyKey = `${run.promotionRunId}:${target.targetId}:${attemptNo}`;

  return {
    spec_version: "1.0",
    protocol_version: "promotion-agent-delivery.v1",
    request_id: requestId,
    trace_id: traceId,
    delivery_id: deliveryId,
    idempotency_key: idempotencyKey,
    campaign_id: campaign.campaignId,
    offer_id: campaign.offer.offerId,
    promotion_run_id: run.promotionRunId,
    workspace_id: run.workspaceId,
    target_id: target.targetId,
    dispatch: {
      category: run.requestedCategory,
      task_type: run.taskType,
      constraints: run.constraints,
      disclosure_required: true,
    },
    campaign: {
      campaign_id: campaign.campaignId,
      advertiser: campaign.advertiser,
      billing_model: campaign.billingModel,
      payout_amount: campaign.payoutAmount,
      currency: campaign.currency,
      disclosure_text: campaign.disclosureText,
      link_bundle: campaign.linkBundle,
    },
    offer: campaign.offer,
    proof_bundle: campaign.proofBundle,
  };
};

export class HttpBuyerAgentDeliveryGateway implements BuyerAgentDeliveryGateway {
  private readonly timeoutMs: number;
  private readonly signatureHeader: string;
  private readonly timestampHeader: string;

  constructor(private readonly options: HttpBuyerAgentDeliveryGatewayOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.signatureHeader = options.signatureHeader ?? "x-promotion-signature";
    this.timestampHeader = options.timestampHeader ?? "x-promotion-timestamp";
  }

  async dispatchPromotion({ run, target, partner, campaign }: BuyerAgentDeliveryRequest): Promise<BuyerAgentDeliveryResult> {
    const attemptNo = target.dispatchAttempts + 1;
    const payload = buildDispatchPayload(run, target, campaign, attemptNo);
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-promotion-protocol-version": payload.protocol_version,
      "x-promotion-run-id": run.promotionRunId,
      "x-promotion-target-id": target.targetId,
      "x-promotion-request-id": payload.request_id,
      "x-promotion-trace-id": payload.trace_id,
      "idempotency-key": payload.idempotency_key,
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.hmacSecret) {
      const signature = crypto
        .createHmac("sha256", this.options.hmacSecret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      headers[this.timestampHeader] = timestamp;
      headers[this.signatureHeader] = signature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(partner.endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const rawBody = await response.text();
      const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
      const retryAfterSeconds =
        parseRetryAfterSeconds(response.headers.get("retry-after")) ??
        (typeof parsedBody?.retry_after_seconds === "number" ? parsedBody.retry_after_seconds : null);
      const accepted = normalizeAccepted(parsedBody, response.ok);
      const retryable = !accepted && normalizeRetryable(parsedBody, response.status);

      return {
        ok: response.ok,
        accepted,
        retryable,
        responded: true,
        protocol: detectProtocol(parsedBody, this.options.protocolHint),
        message: normalizeMessage(parsedBody, rawBody || `Buyer agent responded with ${response.status}.`),
        responseCode: normalizeResponseCode(parsedBody, response.status),
        remoteRequestId: normalizeRemoteRequestId(parsedBody),
        retryAfterSeconds,
      };
    } catch (error) {
      return {
        ok: false,
        accepted: false,
        retryable: true,
        responded: false,
        protocol: this.options.protocolHint ?? "generic_http",
        message: error instanceof Error ? error.message : "Unknown buyer agent delivery error.",
        responseCode: "NETWORK_ERROR",
        remoteRequestId: null,
        retryAfterSeconds: 30,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

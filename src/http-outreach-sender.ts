import crypto from "node:crypto";

import type { OutreachSendRequest, OutreachSenderGateway, OutreachSenderResult } from "./outreach-sender.js";

type HttpOutreachSenderGatewayOptions = {
  timeoutMs?: number;
  apiKey?: string;
  hmacSecret?: string;
  signatureHeader?: string;
  timestampHeader?: string;
  channelUrls: Partial<Record<"email" | "linkedin" | "partner_intro" | "form" | "direct_message", string>>;
};

const parseRetryAfterSeconds = (value: string | null) => {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export class HttpOutreachSenderGateway implements OutreachSenderGateway {
  private readonly timeoutMs: number;
  private readonly signatureHeader: string;
  private readonly timestampHeader: string;

  constructor(private readonly options: HttpOutreachSenderGatewayOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.signatureHeader = options.signatureHeader ?? "x-outreach-signature";
    this.timestampHeader = options.timestampHeader ?? "x-outreach-timestamp";
  }

  async sendOutreach({ target, pipeline, lead, campaign }: OutreachSendRequest): Promise<OutreachSenderResult> {
    const url = this.options.channelUrls[target.channel];
    if (!url) {
      return {
        ok: false,
        retryable: false,
        message: `No sender URL configured for channel ${target.channel}.`,
        responseCode: "CHANNEL_NOT_CONFIGURED",
      };
    }

    const payload = {
      spec_version: "1.0",
      request_id: `outreach:${target.targetId}:attempt_${target.sendAttempts + 1}`,
      trace_id: pipeline.pipelineId,
      pipeline_id: pipeline.pipelineId,
      target_id: target.targetId,
      lead_id: lead.agentId,
      provider_org: lead.providerOrg,
      recommended_campaign_id: target.recommendedCampaignId,
      campaign: campaign
        ? {
            campaign_id: campaign.campaignId,
            advertiser: campaign.advertiser,
            category: campaign.category,
            disclosure_text: campaign.disclosureText,
          }
        : null,
      outreach: {
        channel: target.channel,
        contact_point: target.contactPoint,
        subject_line: target.subjectLine,
        message_template: target.messageTemplate,
        recommendation_reason: target.recommendationReason,
        proof_highlights: target.proofHighlights,
      },
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-outreach-request-id": payload.request_id,
      "x-outreach-trace-id": payload.trace_id,
      "idempotency-key": payload.request_id,
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }
    if (this.options.hmacSecret) {
      const timestamp = new Date().toISOString();
      headers[this.timestampHeader] = timestamp;
      headers[this.signatureHeader] = crypto.createHmac("sha256", this.options.hmacSecret).update(`${timestamp}.${body}`).digest("hex");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const rawBody = await response.text();
      const parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
      const retryAfterSeconds =
        parseRetryAfterSeconds(response.headers.get("retry-after")) ??
        (typeof parsed?.retry_after_seconds === "number" ? parsed.retry_after_seconds : null);

      return {
        ok: response.ok,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        message:
          (typeof parsed?.message === "string" ? parsed.message : null) ??
          (typeof parsed?.error === "string" ? parsed.error : null) ??
          (rawBody || `Sender responded with ${response.status}.`),
        responseCode:
          (typeof parsed?.code === "string" ? parsed.code : null) ??
          String(response.status),
        providerRequestId:
          (typeof parsed?.request_id === "string" ? parsed.request_id : null) ??
          (typeof parsed?.provider_request_id === "string" ? parsed.provider_request_id : null),
        retryAfterSeconds,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        message: error instanceof Error ? error.message : "Unknown outreach sender error.",
        responseCode: "NETWORK_ERROR",
        providerRequestId: null,
        retryAfterSeconds: 30,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

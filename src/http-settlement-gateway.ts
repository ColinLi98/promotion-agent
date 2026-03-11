import crypto from "node:crypto";

import {
  mapSettlementToBillingProviderRequest,
  normalizeBillingProviderResponse,
  type BillingProviderProfile,
  type BillingProviderResponseV1,
} from "./billing-contract.js";
import type { SettlementReceipt, SettlementRetryJob } from "./domain.js";
import type { SettlementGateway, SettlementGatewayResult } from "./settlement-gateway.js";

type HttpSettlementGatewayOptions = {
  url: string;
  providerProfile: BillingProviderProfile;
  apiKey?: string;
  timeoutMs?: number;
  hmacSecret?: string;
  signatureHeader?: string;
  timestampHeader?: string;
};

export class HttpSettlementGateway implements SettlementGateway {
  private readonly timeoutMs: number;
  private readonly signatureHeader: string;
  private readonly timestampHeader: string;

  constructor(private readonly options: HttpSettlementGatewayOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.signatureHeader = options.signatureHeader ?? "x-billing-signature";
    this.timestampHeader = options.timestampHeader ?? "x-billing-timestamp";
  }

  async submitSettlement(
    settlement: SettlementReceipt,
    retryJob: SettlementRetryJob | null,
  ): Promise<SettlementGatewayResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = mapSettlementToBillingProviderRequest(this.options.providerProfile, settlement, retryJob);
      const serializedPayload = JSON.stringify(payload);
      const timestamp = new Date().toISOString();
      const contractVersion =
        "contract_version" in payload ? payload.contract_version : payload.schema_version;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-billing-contract-version": contractVersion,
        "x-billing-trace-id": settlement.intentId,
        "idempotency-key": settlement.settlementId,
      };

      if (this.options.apiKey) {
        headers.authorization = `Bearer ${this.options.apiKey}`;
      }

      if (this.options.hmacSecret) {
        const signature = crypto
          .createHmac("sha256", this.options.hmacSecret)
          .update(`${timestamp}.${serializedPayload}`)
          .digest("hex");

        headers[this.timestampHeader] = timestamp;
        headers[this.signatureHeader] = signature;
      }

      const response = await fetch(this.options.url, {
        method: "POST",
        headers,
        body: serializedPayload,
        signal: controller.signal,
      });

      const rawBody = await response.text();
      const parsedBody = rawBody ? (JSON.parse(rawBody) as BillingProviderResponseV1) : null;

      if (response.ok && parsedBody) {
        const interpreted = normalizeBillingProviderResponse(
          this.options.providerProfile,
          parsedBody,
          response.status,
        );
        return {
          ok:
            interpreted.disposition === "terminal_success" ||
            interpreted.disposition === "accepted_async",
          retryable: interpreted.disposition === "retryable_failure",
          message: interpreted.message,
          providerState: interpreted.providerState,
          providerSettlementId: parsedBody.provider_settlement_id ?? null,
          providerReference: parsedBody.provider_reference ?? null,
          providerResponseCode: interpreted.code,
        };
      }

      if (response.ok) {
        return {
          ok: true,
          retryable: false,
          providerState: "accepted",
          providerResponseCode: "ACCEPTED_NO_BODY",
        };
      }

      const interpreted = normalizeBillingProviderResponse(
        this.options.providerProfile,
        parsedBody,
        response.status,
      );
      return {
        ok:
          interpreted.disposition === "terminal_success" ||
          interpreted.disposition === "accepted_async",
        retryable: interpreted.disposition === "retryable_failure",
        message: interpreted.message || rawBody || `Billing adapter responded with ${response.status}.`,
        providerState: interpreted.providerState,
        providerSettlementId: parsedBody?.provider_settlement_id ?? null,
        providerReference: parsedBody?.provider_reference ?? null,
        providerResponseCode: interpreted.code,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        message: error instanceof Error ? error.message : "Unknown billing adapter error.",
        providerState: "retry",
        providerResponseCode: "NETWORK_ERROR",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

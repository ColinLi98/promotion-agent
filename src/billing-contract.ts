import type { SettlementReceipt, SettlementRetryJob } from "./domain.js";

export type BillingProviderProfile = "generic_v1" | "ledger_api_v2";
export type BillingProviderDisposition =
  | "terminal_success"
  | "accepted_async"
  | "retryable_failure"
  | "terminal_failure";

export type BillingProviderRequestV1 = {
  contract_version: "billing.settlement.v1";
  settlement: {
    settlement_id: string;
    trace_id: string;
    billing_model: SettlementReceipt["billingModel"];
    event_type: SettlementReceipt["eventType"];
    amount: {
      value: number;
      currency: string;
    };
    attribution_window: string;
    status: SettlementReceipt["status"];
    generated_at: string;
  };
  context: {
    campaign_id: string;
    offer_id: string;
    partner_id: string;
    intent_id: string;
  };
  delivery: {
    retry_job_id: string | null;
    attempts: number;
    sent_at: string;
  };
};

export type LedgerApiSettlementRequestV2 = {
  schema_version: "ledger.settlement.v2";
  settlement_id: string;
  trace_id: string;
  campaign_id: string;
  offer_id: string;
  partner_id: string;
  intent_id: string;
  billing_model: SettlementReceipt["billingModel"];
  trigger_event: SettlementReceipt["eventType"];
  gross_amount_minor: number;
  currency: string;
  attribution_window: string;
  settlement_status: SettlementReceipt["status"];
  retry_attempt: number;
  generated_at: string;
};

export type BillingProviderRequest = BillingProviderRequestV1 | LedgerApiSettlementRequestV2;

export type BillingProviderResponseV1 = {
  status?: "accepted" | "settled" | "retry" | "failed";
  provider_settlement_id?: string;
  provider_reference?: string;
  code?: string;
  message?: string;
};

export type BillingProviderInterpretation = {
  disposition: BillingProviderDisposition;
  providerState: "accepted" | "settled" | "retry" | "failed";
  code: string | null;
  message?: string;
};

const GENERIC_CODE_TABLE: Record<string, BillingProviderInterpretation> = {
  ACCEPTED: {
    disposition: "accepted_async",
    providerState: "accepted",
    code: "ACCEPTED",
  },
  SETTLED: {
    disposition: "terminal_success",
    providerState: "settled",
    code: "SETTLED",
  },
  RETRY: {
    disposition: "retryable_failure",
    providerState: "retry",
    code: "RETRY",
  },
  FAILED: {
    disposition: "terminal_failure",
    providerState: "failed",
    code: "FAILED",
  },
};

const LEDGER_CODE_TABLE: Record<string, BillingProviderInterpretation> = {
  ACCEPTED: {
    disposition: "accepted_async",
    providerState: "accepted",
    code: "ACCEPTED",
  },
  ASYNC_PROCESSING: {
    disposition: "accepted_async",
    providerState: "accepted",
    code: "ASYNC_PROCESSING",
  },
  SETTLED: {
    disposition: "terminal_success",
    providerState: "settled",
    code: "SETTLED",
  },
  PAID: {
    disposition: "terminal_success",
    providerState: "settled",
    code: "PAID",
  },
  DUPLICATE_SETTLED: {
    disposition: "terminal_success",
    providerState: "settled",
    code: "DUPLICATE_SETTLED",
  },
  RATE_LIMITED: {
    disposition: "retryable_failure",
    providerState: "retry",
    code: "RATE_LIMITED",
  },
  TEMP_UNAVAILABLE: {
    disposition: "retryable_failure",
    providerState: "retry",
    code: "TEMP_UNAVAILABLE",
  },
  RETRYABLE_ERROR: {
    disposition: "retryable_failure",
    providerState: "retry",
    code: "RETRYABLE_ERROR",
  },
  INVALID_SIGNATURE: {
    disposition: "terminal_failure",
    providerState: "failed",
    code: "INVALID_SIGNATURE",
  },
  INVALID_PAYLOAD: {
    disposition: "terminal_failure",
    providerState: "failed",
    code: "INVALID_PAYLOAD",
  },
  POLICY_BLOCKED: {
    disposition: "terminal_failure",
    providerState: "failed",
    code: "POLICY_BLOCKED",
  },
  FAILED: {
    disposition: "terminal_failure",
    providerState: "failed",
    code: "FAILED",
  },
};

export const mapSettlementToBillingProviderRequest = (
  profile: BillingProviderProfile,
  settlement: SettlementReceipt,
  retryJob: SettlementRetryJob | null,
): BillingProviderRequest => {
  if (profile === "ledger_api_v2") {
    return {
      schema_version: "ledger.settlement.v2",
      settlement_id: settlement.settlementId,
      trace_id: settlement.intentId,
      campaign_id: settlement.campaignId,
      offer_id: settlement.offerId,
      partner_id: settlement.partnerId,
      intent_id: settlement.intentId,
      billing_model: settlement.billingModel,
      trigger_event: settlement.eventType,
      gross_amount_minor: Math.round(settlement.amount * 100),
      currency: settlement.currency,
      attribution_window: settlement.attributionWindow,
      settlement_status: settlement.status,
      retry_attempt: retryJob?.attempts ?? 0,
      generated_at: settlement.generatedAt,
    };
  }

  return {
    contract_version: "billing.settlement.v1",
    settlement: {
      settlement_id: settlement.settlementId,
      trace_id: settlement.intentId,
      billing_model: settlement.billingModel,
      event_type: settlement.eventType,
      amount: {
        value: settlement.amount,
        currency: settlement.currency,
      },
      attribution_window: settlement.attributionWindow,
      status: settlement.status,
      generated_at: settlement.generatedAt,
    },
    context: {
      campaign_id: settlement.campaignId,
      offer_id: settlement.offerId,
      partner_id: settlement.partnerId,
      intent_id: settlement.intentId,
    },
    delivery: {
      retry_job_id: retryJob?.retryJobId ?? null,
      attempts: retryJob?.attempts ?? 0,
      sent_at: new Date().toISOString(),
    },
  };
};

export const normalizeBillingProviderResponse = (
  profile: BillingProviderProfile,
  response: BillingProviderResponseV1 | null,
  httpStatus: number,
): BillingProviderInterpretation => {
  const rawCode = response?.code ?? response?.status?.toUpperCase() ?? String(httpStatus);
  const tables = profile === "ledger_api_v2" ? LEDGER_CODE_TABLE : GENERIC_CODE_TABLE;

  if (tables[rawCode]) {
    return {
      ...tables[rawCode],
      message: response?.message,
    };
  }

  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      disposition: "retryable_failure",
      providerState: "retry",
      code: rawCode,
      message: response?.message,
    };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      disposition: "terminal_success",
      providerState: "settled",
      code: rawCode,
      message: response?.message,
    };
  }

  return {
    disposition: "terminal_failure",
    providerState: "failed",
    code: rawCode,
    message: response?.message,
  };
};

import type { SettlementReceipt, SettlementRetryJob } from "./domain.js";

export type SettlementGatewayResult = {
  ok: boolean;
  retryable: boolean;
  message?: string;
  providerState?: "accepted" | "settled" | "retry" | "failed";
  providerSettlementId?: string | null;
  providerReference?: string | null;
  providerResponseCode?: string | null;
};

export interface SettlementGateway {
  submitSettlement(settlement: SettlementReceipt, retryJob: SettlementRetryJob | null): Promise<SettlementGatewayResult>;
}

export class SimulatedSettlementGateway implements SettlementGateway {
  async submitSettlement(settlement: SettlementReceipt): Promise<SettlementGatewayResult> {
    if (settlement.disputeFlag) {
      return {
        ok: false,
        retryable: false,
        message: "Settlement is disputed and cannot be processed.",
        providerState: "failed",
        providerResponseCode: "SETTLEMENT_DISPUTED",
      };
    }

    return {
      ok: true,
      retryable: false,
      providerState: "settled",
      providerSettlementId: `sim_${settlement.settlementId}`,
      providerReference: settlement.intentId,
      providerResponseCode: "OK",
    };
  }
}

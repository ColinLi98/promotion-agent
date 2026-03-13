import type { Campaign, PartnerAgent, PromotionRun, PromotionRunTarget } from "./domain.js";

export type BuyerAgentDeliveryProtocol = "simulated" | "a2a_http" | "mcp_http" | "generic_http";

export type BuyerAgentDeliveryResult = {
  ok: boolean;
  accepted: boolean;
  retryable: boolean;
  responded: boolean;
  protocol: BuyerAgentDeliveryProtocol;
  message?: string;
  responseCode?: string | null;
  remoteRequestId?: string | null;
  retryAfterSeconds?: number | null;
};

export type BuyerAgentDeliveryRequest = {
  run: PromotionRun;
  target: PromotionRunTarget;
  partner: PartnerAgent;
  campaign: Campaign;
};

export interface BuyerAgentDeliveryGateway {
  dispatchPromotion(request: BuyerAgentDeliveryRequest): Promise<BuyerAgentDeliveryResult>;
}

export class SimulatedBuyerAgentDeliveryGateway implements BuyerAgentDeliveryGateway {
  async dispatchPromotion({
    run,
    target,
    partner,
  }: BuyerAgentDeliveryRequest): Promise<BuyerAgentDeliveryResult> {
    if (partner.status !== "active") {
      return {
        ok: false,
        accepted: false,
        retryable: false,
        responded: true,
        protocol: "simulated",
        message: "Partner is not active.",
        responseCode: "PARTNER_NOT_ACTIVE",
      };
    }

    if (
      !partner.acceptsSponsored ||
      !partner.supportsDisclosure ||
      !partner.supportsDeliveryReceipt ||
      !partner.supportsPresentationReceipt
    ) {
      return {
        ok: false,
        accepted: false,
        retryable: false,
        responded: true,
        protocol: "simulated",
        message: "Partner missing sponsored, disclosure, or receipt support.",
        responseCode: "COMMERCIAL_CAPABILITY_MISSING",
      };
    }

    if (!partner.supportedCategories.includes(run.requestedCategory)) {
      return {
        ok: false,
        accepted: false,
        retryable: false,
        responded: true,
        protocol: "simulated",
        message: "Partner does not support the requested category.",
        responseCode: "CATEGORY_NOT_SUPPORTED",
      };
    }

    return {
      ok: true,
      accepted: true,
      retryable: false,
      responded: true,
      protocol: "simulated",
      responseCode: "ACCEPTED",
      remoteRequestId: `sim_${target.targetId}`,
    };
  }
}

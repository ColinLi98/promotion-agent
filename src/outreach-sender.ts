import type { AgentLead, Campaign, OutreachTarget, RecruitmentPipeline } from "./domain.js";

export type OutreachSenderResult = {
  ok: boolean;
  retryable: boolean;
  message?: string;
  responseCode?: string | null;
  providerRequestId?: string | null;
  retryAfterSeconds?: number | null;
};

export type OutreachSendRequest = {
  target: OutreachTarget;
  pipeline: RecruitmentPipeline;
  lead: AgentLead;
  campaign: Campaign | null;
};

export interface OutreachSenderGateway {
  sendOutreach(request: OutreachSendRequest): Promise<OutreachSenderResult>;
}

export class SimulatedOutreachSenderGateway implements OutreachSenderGateway {
  async sendOutreach({ target }: OutreachSendRequest): Promise<OutreachSenderResult> {
    if (!target.contactPoint?.trim()) {
      return {
        ok: false,
        retryable: false,
        message: "No contact point configured for outreach target.",
        responseCode: "MISSING_CONTACT_POINT",
      };
    }

    return {
      ok: true,
      retryable: false,
      responseCode: "SENT",
      providerRequestId: `outreach_${target.targetId}`,
    };
  }
}

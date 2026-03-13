import nodemailer from "nodemailer";

import type { Campaign } from "./domain.js";
import type { OutreachSendRequest, OutreachSenderGateway, OutreachSenderResult } from "./outreach-sender.js";

type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<{
    accepted?: unknown[] | null;
    rejected?: unknown[] | null;
    messageId?: string | null;
    response?: string | null;
  }>;
};

type SmtpOutreachSenderGatewayOptions = {
  provider?: "163" | "generic";
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  replyTo?: string;
  timeoutMs?: number;
  trackingBaseUrl?: string;
  transport?: MailTransport;
};

const EMAIL_CAPABLE_CHANNELS = new Set(["email", "partner_intro"]);
const TRANSIENT_ERROR_CODES = new Set(["ETIMEDOUT", "ECONNECTION", "ESOCKET", "EDNS", "ECONNRESET", "EPIPE"]);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const parseBoolean = (value: string | undefined) => {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const firstString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getBusinessContactEmail = (campaign: Campaign | null) => {
  if (!campaign) return null;
  return firstString(campaign.offer.constraints.business_contact_email);
};

const extractEmailAddress = (value: string) => {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
};

const resolveDefaults = (provider: SmtpOutreachSenderGatewayOptions["provider"]) => {
  if (provider === "generic") {
    return {
      host: "localhost",
      port: 587,
      secure: false,
    };
  }
  return {
    host: "smtp.163.com",
    port: 465,
    secure: true,
  };
};

const createHtmlMessage = ({
  target,
  campaign,
  businessContactEmail,
  trackingPixelUrl,
}: {
  target: OutreachSendRequest["target"];
  campaign: Campaign | null;
  businessContactEmail: string | null;
  trackingPixelUrl: string | null;
}) => {
  const body = escapeHtml(target.messageTemplate).replaceAll("\n", "<br />");
  const proofList =
    target.proofHighlights.length > 0
      ? `<p><strong>Proof highlights</strong></p><ul>${target.proofHighlights
          .map((highlight) => `<li>${escapeHtml(highlight)}</li>`)
          .join("")}</ul>`
      : "";
  const reason = target.recommendationReason ? `<p><strong>Why this is relevant:</strong> ${escapeHtml(target.recommendationReason)}</p>` : "";
  const disclosure = campaign?.disclosureText ? `<p><strong>Disclosure:</strong> ${escapeHtml(campaign.disclosureText)}</p>` : "";
  const contact = businessContactEmail ? `<p>Business contact: <a href="mailto:${escapeHtml(businessContactEmail)}">${escapeHtml(businessContactEmail)}</a></p>` : "";
  const tracking = trackingPixelUrl
    ? `<img src="${escapeHtml(trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`
    : "";

  return [
    `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">${body}</div>`,
    reason,
    proofList,
    disclosure,
    contact,
    tracking,
  ]
    .filter(Boolean)
    .join("");
};

const createTextMessage = ({
  target,
  campaign,
  businessContactEmail,
}: {
  target: OutreachSendRequest["target"];
  campaign: Campaign | null;
  businessContactEmail: string | null;
}) => {
  const sections = [target.messageTemplate.trim()];
  if (target.recommendationReason) {
    sections.push(`Why this is relevant: ${target.recommendationReason}`);
  }
  if (target.proofHighlights.length > 0) {
    sections.push(`Proof highlights:\n- ${target.proofHighlights.join("\n- ")}`);
  }
  if (campaign?.disclosureText) {
    sections.push(`Disclosure: ${campaign.disclosureText}`);
  }
  if (businessContactEmail) {
    sections.push(`Business contact: ${businessContactEmail}`);
  }
  return sections.filter(Boolean).join("\n\n");
};

const classifyError = (error: unknown): OutreachSenderResult => {
  const smtpError = error as { code?: string; responseCode?: number; message?: string };
  const code = smtpError?.code ?? null;
  const responseCode = smtpError?.responseCode ?? null;
  const retryable =
    (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) ||
    (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code));

  return {
    ok: false,
    retryable,
    message: smtpError?.message ?? "Unknown SMTP outreach sender error.",
    responseCode:
      typeof responseCode === "number"
        ? `SMTP_${responseCode}`
        : typeof code === "string"
          ? code
          : retryable
            ? "SMTP_RETRYABLE_ERROR"
            : "SMTP_SEND_FAILED",
    providerRequestId: null,
    retryAfterSeconds: retryable ? 60 : null,
  };
};

export class SmtpOutreachSenderGateway implements OutreachSenderGateway {
  private readonly from: string | null;
  private readonly replyTo: string | null;
  private readonly trackingBaseUrl: string | null;
  private readonly transport: MailTransport | null;

  constructor(private readonly options: SmtpOutreachSenderGatewayOptions) {
    this.from = firstString(options.from) ?? firstString(options.user);
    this.replyTo = firstString(options.replyTo);
    this.trackingBaseUrl = firstString(options.trackingBaseUrl)?.replace(/\/+$/, "") ?? null;

    if (options.transport) {
      this.transport = options.transport;
      return;
    }

    const defaults = resolveDefaults(options.provider ?? "163");
    const host = firstString(options.host) ?? defaults.host;
    const port = options.port ?? defaults.port;
    const secure = options.secure ?? defaults.secure;
    const user = firstString(options.user);
    const pass = firstString(options.pass);

    if (!host || !user || !pass || !this.from) {
      this.transport = null;
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      connectionTimeout: options.timeoutMs ?? 5_000,
      greetingTimeout: options.timeoutMs ?? 5_000,
      socketTimeout: options.timeoutMs ?? 5_000,
    });
    this.transport = {
      sendMail: (message) => transporter.sendMail(message),
    };
  }

  async sendOutreach({ target, pipeline, lead, campaign }: OutreachSendRequest): Promise<OutreachSenderResult> {
    if (!EMAIL_CAPABLE_CHANNELS.has(target.channel)) {
      return {
        ok: false,
        retryable: false,
        message: `SMTP sender only supports email-style channels. Received ${target.channel}.`,
        responseCode: "CHANNEL_NOT_SUPPORTED",
      };
    }

    if (!this.transport || !this.from) {
      return {
        ok: false,
        retryable: false,
        message: "SMTP sender is not fully configured. Set OUTREACH_SMTP_USER, OUTREACH_SMTP_PASS, and OUTREACH_SMTP_FROM.",
        responseCode: "SMTP_NOT_CONFIGURED",
      };
    }

    const recipient = extractEmailAddress(target.contactPoint);
    if (!recipient) {
      return {
        ok: false,
        retryable: false,
        message: `No valid email address found in contact point: ${target.contactPoint}`,
        responseCode: "INVALID_EMAIL_CONTACT_POINT",
      };
    }

    const businessContactEmail = getBusinessContactEmail(campaign);
    const trackingPixelUrl = this.trackingBaseUrl ? `${this.trackingBaseUrl}/outreach/open/${encodeURIComponent(target.targetId)}/pixel.gif` : null;

    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: recipient,
        replyTo: this.replyTo ?? businessContactEmail ?? undefined,
        subject: target.subjectLine,
        text: createTextMessage({ target, campaign, businessContactEmail }),
        html: createHtmlMessage({ target, campaign, businessContactEmail, trackingPixelUrl }),
        headers: {
          "X-Promotion-Trace-Id": pipeline.pipelineId,
          "X-Promotion-Target-Id": target.targetId,
          "X-Promotion-Lead-Id": lead.agentId,
          "X-Promotion-Campaign-Id": target.recommendedCampaignId ?? campaign?.campaignId ?? "",
        },
      });

      if ((info.rejected?.length ?? 0) > 0 && (info.accepted?.length ?? 0) === 0) {
        return {
          ok: false,
          retryable: false,
          message: info.response ?? `SMTP rejected recipient ${recipient}.`,
          responseCode: "SMTP_REJECTED",
          providerRequestId: info.messageId ?? null,
          retryAfterSeconds: null,
        };
      }

      return {
        ok: true,
        retryable: false,
        message: info.response ?? "SMTP accepted the message.",
        responseCode: "SMTP_SENT",
        providerRequestId: info.messageId ?? null,
      };
    } catch (error) {
      return classifyError(error);
    }
  }
}

export const smtpProviderSecureFromEnv = (value: string | undefined) => parseBoolean(value);

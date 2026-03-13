import Stripe from "stripe";

type StripeTopUpProviderOptions = {
  secretKey: string;
  pricePerCreditCents: number;
  currency: string;
  productName: string;
};

export type TopUpCheckoutSession = {
  provider: "stripe";
  sessionId: string;
  checkoutUrl: string;
};

export type ConfirmedTopUpSession = {
  provider: "stripe";
  sessionId: string;
  workspaceId: string;
  credits: number;
  paid: boolean;
  status: string | null;
  paymentStatus: string | null;
  source: string;
};

export type StripeCheckoutWebhookEvent = {
  type: "checkout.session.completed" | string;
  sessionId: string;
  workspaceId: string;
  credits: number;
  paid: boolean;
  source: string;
};

export class StripeTopUpProvider {
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeTopUpProviderOptions) {
    this.stripe = new Stripe(options.secretKey);
  }

  async createCheckoutSession(input: {
    workspaceId: string;
    credits: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<TopUpCheckoutSession> {
    const unitAmount = Math.round(input.credits * this.options.pricePerCreditCents);
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.workspaceId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: this.options.currency,
            unit_amount: unitAmount,
            product_data: {
              name: this.options.productName,
              description: `Top-up ${input.credits} credits`,
            },
          },
        },
      ],
      metadata: {
        workspaceId: input.workspaceId,
        credits: String(input.credits),
        kind: "wallet_top_up",
      },
    });

    if (!session.url) {
      throw new Error("Stripe checkout session did not return a checkout URL.");
    }

    return {
      provider: "stripe",
      sessionId: session.id,
      checkoutUrl: session.url,
    };
  }

  async confirmCheckoutSession(sessionId: string): Promise<ConfirmedTopUpSession> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const workspaceId = session.metadata?.workspaceId;
    const credits = Number(session.metadata?.credits ?? "0");

    if (!workspaceId || !Number.isFinite(credits) || credits <= 0) {
      throw new Error("Stripe checkout session is missing wallet metadata.");
    }

    return {
      provider: "stripe",
      sessionId: session.id,
      workspaceId,
      credits,
      paid: session.payment_status === "paid" || session.status === "complete",
      status: session.status,
      paymentStatus: session.payment_status,
      source: `stripe.checkout:${session.id}`,
    };
  }

  verifyCheckoutWebhookEvent(
    rawBody: Buffer | string,
    signature: string,
    webhookSecret: string,
  ): StripeCheckoutWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    if (event.type !== "checkout.session.completed") {
      return {
        type: event.type,
        sessionId: "",
        workspaceId: "",
        credits: 0,
        paid: false,
        source: "",
      };
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const workspaceId = session.metadata?.workspaceId;
    const credits = Number(session.metadata?.credits ?? "0");
    if (!workspaceId || !Number.isFinite(credits) || credits <= 0) {
      throw new Error("Stripe webhook session is missing wallet metadata.");
    }

    return {
      type: event.type,
      sessionId: session.id,
      workspaceId,
      credits,
      paid: session.payment_status === "paid" || session.status === "complete",
      source: `stripe.checkout:${session.id}`,
    };
  }
}

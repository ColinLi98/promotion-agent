import {
  SimulatedBuyerAgentDeliveryGateway,
} from "./buyer-agent-delivery.js";
import { bootstrapDemoScenario } from "./demo-scenario.js";
import { buildDemoSeedData } from "./demo-seed.js";
import { type AppMode, SystemRuntimeProfileSchema, type SystemRuntimeProfile } from "./domain.js";
import { HttpBuyerAgentDeliveryGateway } from "./http-buyer-agent-delivery.js";
import { HttpOutreachSenderGateway } from "./http-outreach-sender.js";
import { InMemoryHotStateStore } from "./hot-state.js";
import { HttpSettlementGateway } from "./http-settlement-gateway.js";
import { SimulatedOutreachSenderGateway } from "./outreach-sender.js";
import { PostgresPromotionAgentRepository } from "./postgres-repository.js";
import { RedisHotStateStore } from "./redis-hot-state.js";
import { buildRealTestSeedData } from "./real-test-seed.js";
import { buildSeedData } from "./seed.js";
import { SimulatedSettlementGateway } from "./settlement-gateway.js";
import { SmtpOutreachSenderGateway, smtpProviderSecureFromEnv } from "./smtp-outreach-sender.js";
import { createStore, PromotionAgentStore } from "./store.js";

const resolveAppMode = (): AppMode => {
  const mode = process.env.APP_MODE;
  if (mode === "demo" || mode === "real_test") {
    return mode;
  }
  return "default";
};

const parseNumberEnv = (value: string | undefined) => {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildRuntimeProfile = ({
  mode,
  persistence,
  hotStatePersistence,
  settlementGatewayMode,
  defaultLeadFilter,
}: {
  mode: AppMode;
  persistence: "memory" | "postgres";
  hotStatePersistence: "memory" | "redis";
  settlementGatewayMode: "simulated" | "http";
  defaultLeadFilter: SystemRuntimeProfile["defaultLeadFilter"];
}): SystemRuntimeProfile =>
  SystemRuntimeProfileSchema.parse({
    mode,
    persistence,
    hotState: hotStatePersistence,
    billingMode: settlementGatewayMode,
    demoEnabled: mode === "demo",
    realDataOnly: mode === "real_test",
    defaultLeadFilter,
  });

export const createConfiguredStore = async () => {
  const mode = resolveAppMode();
  const connectionString = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const billingAdapterUrl = process.env.BILLING_ADAPTER_URL;
  const billingProviderProfile = (process.env.BILLING_PROVIDER_PROFILE ?? "generic_v1") as "generic_v1" | "ledger_api_v2";
  const billingAdapterApiKey = process.env.BILLING_ADAPTER_API_KEY;
  const billingAdapterTimeoutMs = Number(process.env.BILLING_ADAPTER_TIMEOUT_MS ?? "5000");
  const billingAdapterHmacSecret = process.env.BILLING_ADAPTER_HMAC_SECRET;
  const billingAdapterSignatureHeader = process.env.BILLING_ADAPTER_SIGNATURE_HEADER;
  const billingAdapterTimestampHeader = process.env.BILLING_ADAPTER_TIMESTAMP_HEADER;
  const buyerAgentDeliveryMode = process.env.BUYER_AGENT_DELIVERY_MODE ?? (mode === "real_test" ? "http" : "simulated");
  const buyerAgentDeliveryApiKey = process.env.BUYER_AGENT_DELIVERY_API_KEY;
  const buyerAgentDeliveryTimeoutMs = Number(process.env.BUYER_AGENT_DELIVERY_TIMEOUT_MS ?? "5000");
  const buyerAgentDeliveryHmacSecret = process.env.BUYER_AGENT_DELIVERY_HMAC_SECRET;
  const buyerAgentDeliverySignatureHeader = process.env.BUYER_AGENT_DELIVERY_SIGNATURE_HEADER;
  const buyerAgentDeliveryTimestampHeader = process.env.BUYER_AGENT_DELIVERY_TIMESTAMP_HEADER;
  const buyerAgentDeliveryProtocolHint =
    (process.env.BUYER_AGENT_DELIVERY_PROTOCOL_HINT as "a2a_http" | "mcp_http" | "generic_http" | undefined) ??
    "generic_http";
  const smtpConfigured = Boolean(process.env.OUTREACH_SMTP_USER?.trim() && process.env.OUTREACH_SMTP_PASS?.trim());
  const outreachSenderMode =
    process.env.OUTREACH_SENDER_MODE ?? (smtpConfigured ? "smtp" : mode === "real_test" ? "http" : "simulated");
  const outreachSenderApiKey = process.env.OUTREACH_SENDER_API_KEY;
  const outreachSenderTimeoutMs = Number(process.env.OUTREACH_SENDER_TIMEOUT_MS ?? "5000");
  const outreachSenderHmacSecret = process.env.OUTREACH_SENDER_HMAC_SECRET;
  const outreachSenderSignatureHeader = process.env.OUTREACH_SENDER_SIGNATURE_HEADER;
  const outreachSenderTimestampHeader = process.env.OUTREACH_SENDER_TIMESTAMP_HEADER;
  const hotStateNamespace = process.env.HOT_STATE_NAMESPACE ?? "promotion-agent";
  const hotStateVersion = process.env.HOT_STATE_VERSION ?? "v1";

  const httpSettlementGateway = billingAdapterUrl
    ? new HttpSettlementGateway({
        url: billingAdapterUrl,
        providerProfile: billingProviderProfile,
        apiKey: billingAdapterApiKey,
        timeoutMs: billingAdapterTimeoutMs,
        hmacSecret: billingAdapterHmacSecret,
        signatureHeader: billingAdapterSignatureHeader,
        timestampHeader: billingAdapterTimestampHeader,
      })
    : null;
  const deliveryGateway =
    buyerAgentDeliveryMode === "http"
      ? new HttpBuyerAgentDeliveryGateway({
          apiKey: buyerAgentDeliveryApiKey,
          timeoutMs: buyerAgentDeliveryTimeoutMs,
          hmacSecret: buyerAgentDeliveryHmacSecret,
          signatureHeader: buyerAgentDeliverySignatureHeader,
          timestampHeader: buyerAgentDeliveryTimestampHeader,
          protocolHint: buyerAgentDeliveryProtocolHint,
        })
      : new SimulatedBuyerAgentDeliveryGateway();
  const outreachSenderGateway =
    outreachSenderMode === "smtp"
      ? new SmtpOutreachSenderGateway({
          provider: (process.env.OUTREACH_SMTP_PROVIDER as "163" | "generic" | undefined) ?? "163",
          host: process.env.OUTREACH_SMTP_HOST,
          port: parseNumberEnv(process.env.OUTREACH_SMTP_PORT),
          secure: smtpProviderSecureFromEnv(process.env.OUTREACH_SMTP_SECURE),
          user: process.env.OUTREACH_SMTP_USER,
          pass: process.env.OUTREACH_SMTP_PASS,
          from: process.env.OUTREACH_SMTP_FROM,
          replyTo: process.env.OUTREACH_SMTP_REPLY_TO,
          timeoutMs: outreachSenderTimeoutMs,
          trackingBaseUrl: process.env.OUTREACH_TRACKING_BASE_URL,
        })
      : outreachSenderMode === "http"
      ? new HttpOutreachSenderGateway({
          apiKey: outreachSenderApiKey,
          timeoutMs: outreachSenderTimeoutMs,
          hmacSecret: outreachSenderHmacSecret,
          signatureHeader: outreachSenderSignatureHeader,
          timestampHeader: outreachSenderTimestampHeader,
          channelUrls: {
            email: process.env.OUTREACH_EMAIL_SENDER_URL,
            linkedin: process.env.OUTREACH_LINKEDIN_SENDER_URL,
            partner_intro: process.env.OUTREACH_PARTNER_INTRO_SENDER_URL,
            form: process.env.OUTREACH_FORM_SENDER_URL,
            direct_message: process.env.OUTREACH_DIRECT_MESSAGE_SENDER_URL,
          },
        })
      : new SimulatedOutreachSenderGateway();

  if (mode === "demo") {
    const hotState = new InMemoryHotStateStore(hotStateNamespace, hotStateVersion);
    const store = createStore({
      appMode: "demo",
      seedData: buildDemoSeedData(),
      hotState,
      settlementGateway: new SimulatedSettlementGateway(),
      deliveryGateway,
      outreachSenderGateway,
    });
    await bootstrapDemoScenario(store);
    const runtimeProfile = buildRuntimeProfile({
      mode,
      persistence: "memory",
      hotStatePersistence: "memory",
      settlementGatewayMode: "simulated",
      defaultLeadFilter: store.getDefaultLeadFilter(),
    });
    return {
      store,
      hotState,
      persistence: "memory" as const,
      hotStatePersistence: "memory" as const,
      settlementGatewayMode: "simulated" as const,
      appMode: mode,
      runtimeProfile,
    };
  }

  if (mode === "real_test") {
    if (!connectionString || !redisUrl || !httpSettlementGateway) {
      throw new Error("real_test requires DATABASE_URL, REDIS_URL, and BILLING_ADAPTER_URL.");
    }

    const hotState = await RedisHotStateStore.connect(redisUrl, hotStateNamespace, hotStateVersion);
    const repository = await PostgresPromotionAgentRepository.connect(connectionString, buildRealTestSeedData());
    const configuredStore = new PromotionAgentStore(repository, hotState, httpSettlementGateway, deliveryGateway, outreachSenderGateway, "real_test");

    if (await configuredStore.hasDemoData()) {
      await configuredStore.close();
      throw new Error("real_test database contains demo_* provenance records. Refusing to start.");
    }

    const runtimeProfile = buildRuntimeProfile({
      mode,
      persistence: "postgres",
      hotStatePersistence: "redis",
      settlementGatewayMode: "http",
      defaultLeadFilter: configuredStore.getDefaultLeadFilter(),
    });
    return {
      store: configuredStore,
      hotState,
      persistence: "postgres" as const,
      hotStatePersistence: "redis" as const,
      settlementGatewayMode: "http" as const,
      appMode: mode,
      runtimeProfile,
    };
  }

  const settlementGateway = httpSettlementGateway ?? new SimulatedSettlementGateway();
  const settlementGatewayMode = httpSettlementGateway ? ("http" as const) : ("simulated" as const);

  if (!connectionString) {
    const hotState = new InMemoryHotStateStore(hotStateNamespace, hotStateVersion);
    const store = createStore({
      appMode: "default",
      seedData: buildSeedData(),
      hotState,
      settlementGateway,
      deliveryGateway,
      outreachSenderGateway,
    });
    const runtimeProfile = buildRuntimeProfile({
      mode,
      persistence: "memory",
      hotStatePersistence: "memory",
      settlementGatewayMode,
      defaultLeadFilter: store.getDefaultLeadFilter(),
    });
    return {
      store,
      hotState,
      persistence: "memory" as const,
      hotStatePersistence: "memory" as const,
      settlementGatewayMode,
      appMode: mode,
      runtimeProfile,
    };
  }

  const hotState = redisUrl
    ? await RedisHotStateStore.connect(redisUrl, hotStateNamespace, hotStateVersion)
    : new InMemoryHotStateStore(hotStateNamespace, hotStateVersion);
  const repository = await PostgresPromotionAgentRepository.connect(connectionString, buildSeedData());
  const store = new PromotionAgentStore(repository, hotState, settlementGateway, deliveryGateway, outreachSenderGateway, "default");
  const runtimeProfile = buildRuntimeProfile({
    mode,
    persistence: "postgres",
    hotStatePersistence: redisUrl ? "redis" : "memory",
    settlementGatewayMode,
    defaultLeadFilter: store.getDefaultLeadFilter(),
  });
  return {
    store,
    hotState,
    persistence: "postgres" as const,
    hotStatePersistence: redisUrl ? ("redis" as const) : ("memory" as const),
    settlementGatewayMode,
    appMode: mode,
    runtimeProfile,
  };
};

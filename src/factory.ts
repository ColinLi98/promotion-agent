import { InMemoryHotStateStore } from "./hot-state.js";
import { HttpSettlementGateway } from "./http-settlement-gateway.js";
import { PostgresPromotionAgentRepository } from "./postgres-repository.js";
import { RedisHotStateStore } from "./redis-hot-state.js";
import { buildSeedData } from "./seed.js";
import { SimulatedSettlementGateway } from "./settlement-gateway.js";
import { createStore, PromotionAgentStore } from "./store.js";

export const createConfiguredStore = async () => {
  const connectionString = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const billingAdapterUrl = process.env.BILLING_ADAPTER_URL;
  const billingProviderProfile = (process.env.BILLING_PROVIDER_PROFILE ?? "generic_v1") as "generic_v1" | "ledger_api_v2";
  const billingAdapterApiKey = process.env.BILLING_ADAPTER_API_KEY;
  const billingAdapterTimeoutMs = Number(process.env.BILLING_ADAPTER_TIMEOUT_MS ?? "5000");
  const billingAdapterHmacSecret = process.env.BILLING_ADAPTER_HMAC_SECRET;
  const billingAdapterSignatureHeader = process.env.BILLING_ADAPTER_SIGNATURE_HEADER;
  const billingAdapterTimestampHeader = process.env.BILLING_ADAPTER_TIMESTAMP_HEADER;
  const hotStateNamespace = process.env.HOT_STATE_NAMESPACE ?? "promotion-agent";
  const hotStateVersion = process.env.HOT_STATE_VERSION ?? "v1";
  const settlementGateway = billingAdapterUrl
    ? new HttpSettlementGateway({
        url: billingAdapterUrl,
        providerProfile: billingProviderProfile,
        apiKey: billingAdapterApiKey,
        timeoutMs: billingAdapterTimeoutMs,
        hmacSecret: billingAdapterHmacSecret,
        signatureHeader: billingAdapterSignatureHeader,
        timestampHeader: billingAdapterTimestampHeader,
      })
    : new SimulatedSettlementGateway();
  const settlementGatewayMode = billingAdapterUrl ? ("http" as const) : ("simulated" as const);

  if (!connectionString) {
    const hotState = new InMemoryHotStateStore(hotStateNamespace, hotStateVersion);
    return {
      store: createStore({
        hotState,
        settlementGateway,
      }),
      hotState,
      persistence: "memory" as const,
      hotStatePersistence: "memory" as const,
      settlementGatewayMode,
    };
  }

  const hotState = redisUrl
    ? await RedisHotStateStore.connect(redisUrl, hotStateNamespace, hotStateVersion)
    : new InMemoryHotStateStore(hotStateNamespace, hotStateVersion);
  const repository = await PostgresPromotionAgentRepository.connect(connectionString, buildSeedData());
  return {
    store: new PromotionAgentStore(repository, hotState, settlementGateway),
    hotState,
    persistence: "postgres" as const,
    hotStatePersistence: redisUrl ? ("redis" as const) : ("memory" as const),
    settlementGatewayMode,
  };
};

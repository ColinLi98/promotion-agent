import { readFile } from "node:fs/promises";

import { createConfiguredStore } from "../src/factory.js";

type CampaignImportItem = {
  activate?: boolean;
  advertiser: string;
  externalRef?: string | null;
  sourceDocumentUrl?: string | null;
  category: string;
  regions: string[];
  billingModel: "CPQR" | "CPA";
  payoutAmount: number;
  currency: string;
  budget: number;
  disclosureText: string;
  minTrust?: number;
  product: {
    name: string;
    description: string;
    price: number;
    currency: string;
    intendedFor: string[];
    constraints?: Record<string, unknown>;
    claims: string[];
    actionEndpoints: string[];
    positioningBullets?: string[];
  };
  proofReferences: Array<{
    label: string;
    type: "doc" | "faq" | "case_study" | "certificate" | "screenshot";
    url: string;
  }>;
};

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: APP_MODE=real_test ... tsx scripts/import-real-test-campaigns.ts <campaigns.json>");
  process.exit(1);
}

if (process.env.APP_MODE !== "real_test") {
  console.error("APP_MODE=real_test is required for campaign import.");
  process.exit(1);
}

const raw = await readFile(filePath, "utf8");
const items = JSON.parse(raw) as CampaignImportItem[];

const { store } = await createConfiguredStore();

const imported = [];
for (const item of items) {
  const result = await store.createCampaign({
    advertiser: item.advertiser,
    externalRef: item.externalRef ?? null,
    sourceDocumentUrl: item.sourceDocumentUrl ?? null,
    category: item.category,
    regions: item.regions,
    billingModel: item.billingModel,
    payoutAmount: item.payoutAmount,
    currency: item.currency,
    budget: item.budget,
    disclosureText: item.disclosureText,
    minTrust: item.minTrust ?? 0.65,
    product: {
      name: item.product.name,
      description: item.product.description,
      price: item.product.price,
      currency: item.product.currency,
      intendedFor: item.product.intendedFor,
      constraints: item.product.constraints ?? {},
      claims: item.product.claims,
      actionEndpoints: item.product.actionEndpoints,
      positioningBullets: item.product.positioningBullets ?? [],
    },
    proofReferences: item.proofReferences,
  });

  let activation = null;
  if (item.activate) {
    activation = await store.activateCampaign(result.campaign.campaignId);
  }

  imported.push({
    campaignId: result.campaign.campaignId,
    advertiser: result.campaign.advertiser,
    status: activation?.campaign.status ?? result.campaign.status,
    policyDecision: result.policyCheck.decision,
  });
}

await store.close();
console.log(JSON.stringify({ importedCount: imported.length, imported }, null, 2));

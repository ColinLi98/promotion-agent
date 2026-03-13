import { readFile } from "node:fs/promises";

import { AgentLeadSchema, type AgentLead } from "../src/domain.js";
import { buildDedupeKey } from "../src/discovery.js";
import { createConfiguredStore } from "../src/factory.js";

type LeadImportItem = {
  agentId: string;
  dataOrigin?: "seed" | "discovered";
  dataProvenance?: "real_discovery" | "ops_manual";
  source: string;
  sourceType: "public_registry" | "partner_directory";
  sourceRef: string;
  providerOrg: string;
  cardUrl: string;
  verticals: string[];
  skills: string[];
  geo: string[];
  authModes: string[];
  acceptsSponsored?: boolean;
  supportsDisclosure?: boolean;
  supportsDeliveryReceipt?: boolean;
  supportsPresentationReceipt?: boolean;
  trustSeed?: number;
  leadScore?: number;
  discoveredAt?: string;
  lastSeenAt?: string;
  endpointUrl?: string | null;
  contactRef?: string | null;
  missingFields?: string[];
  reachProxy?: number;
  monetizationReadiness?: number;
  verificationStatus?: "new" | "reviewing" | "verified" | "active" | "suspended";
  lastVerifiedAt?: string | null;
  verificationOwner?: string | null;
  evidenceRef?: string | null;
  assignedOwner?: string | null;
  notes?: string;
  scoreBreakdown?: {
    icpFit: number;
    protocolFit: number;
    reachFit: number;
  };
};

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: APP_MODE=real_test ... tsx scripts/import-real-test-leads.ts <leads.json>");
  process.exit(1);
}

if (process.env.APP_MODE !== "real_test") {
  console.error("APP_MODE=real_test is required for lead import.");
  process.exit(1);
}

const raw = await readFile(filePath, "utf8");
const items = JSON.parse(raw) as LeadImportItem[];

const deriveMissingFields = (item: LeadImportItem) => {
  if (item.missingFields) return item.missingFields;
  const missing = [];
  if (!item.endpointUrl) missing.push("endpointUrl");
  if (!item.authModes?.length) missing.push("authModes");
  if (!item.supportsDisclosure) missing.push("supportsDisclosure");
  if (!item.supportsDeliveryReceipt) missing.push("supportsDeliveryReceipt");
  if (!item.supportsPresentationReceipt) missing.push("supportsPresentationReceipt");
  return missing;
};

const deriveScoreBreakdown = (item: LeadImportItem) => {
  if (item.scoreBreakdown) return item.scoreBreakdown;
  const protocolFit = Math.min(1, (item.authModes.length > 0 ? 0.45 : 0) + (item.endpointUrl ? 0.35 : 0) + (item.supportsDeliveryReceipt ? 0.2 : 0));
  const reachFit = item.reachProxy ?? Math.min(1, 0.35 + item.geo.length * 0.12);
  return {
    icpFit: item.leadScore ?? 0.8,
    protocolFit,
    reachFit,
  };
};

const { store } = await createConfiguredStore();

const imported = [];
for (const item of items) {
  const discoveredAt = item.discoveredAt ?? new Date().toISOString();
  const parsed = AgentLeadSchema.parse({
    agentId: item.agentId,
    dataOrigin: item.dataOrigin ?? "discovered",
    dataProvenance: item.dataProvenance ?? "real_discovery",
    source: item.source,
    sourceType: item.sourceType,
    sourceRef: item.sourceRef,
    providerOrg: item.providerOrg,
    cardUrl: item.cardUrl,
    verticals: item.verticals,
    skills: item.skills,
    geo: item.geo,
    authModes: item.authModes,
    acceptsSponsored: item.acceptsSponsored ?? true,
    supportsDisclosure: item.supportsDisclosure ?? true,
    supportsDeliveryReceipt: item.supportsDeliveryReceipt ?? true,
    supportsPresentationReceipt: item.supportsPresentationReceipt ?? true,
    trustSeed: item.trustSeed ?? 0.82,
    leadScore: item.leadScore ?? 0.86,
    discoveredAt,
    lastSeenAt: item.lastSeenAt ?? discoveredAt,
    endpointUrl: item.endpointUrl ?? null,
    contactRef: item.contactRef ?? null,
    missingFields: deriveMissingFields(item),
    reachProxy: item.reachProxy ?? 0.78,
    monetizationReadiness: item.monetizationReadiness ?? 0.84,
    verificationStatus: item.verificationStatus ?? "verified",
    lastVerifiedAt: item.lastVerifiedAt ?? discoveredAt,
    verificationOwner: item.verificationOwner ?? item.assignedOwner ?? "ops:real-test",
    evidenceRef: item.evidenceRef ?? item.cardUrl,
    assignedOwner: item.assignedOwner ?? "ops:real-test",
    notes: item.notes ?? "",
    dedupeKey: buildDedupeKey(item.providerOrg, item.endpointUrl ?? null, item.sourceType),
    scoreBreakdown: deriveScoreBreakdown(item),
  });

  await store.upsertLeadRecord(parsed);
  imported.push({
    agentId: parsed.agentId,
    providerOrg: parsed.providerOrg,
    verificationStatus: parsed.verificationStatus,
    endpointUrl: parsed.endpointUrl,
  });
}

await store.close();
console.log(JSON.stringify({ importedCount: imported.length, imported }, null, 2));

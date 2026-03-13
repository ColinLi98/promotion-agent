import { readFile } from "node:fs/promises";

import { createConfiguredStore } from "../src/factory.js";

type PartnerImportItem = {
  leadId: string;
  partnerId?: string;
  dataProvenance?: "real_partner" | "ops_manual";
  status?: "verified" | "active";
  supportedCategories?: string[];
  slaTier?: string;
  ownerId?: string;
  acceptsSponsored?: boolean;
  supportsDisclosure?: boolean;
  authModes?: string[];
};

const filePath = process.argv[2];

if (process.env.APP_MODE !== "real_test") {
  console.error("APP_MODE=real_test is required for partner import.");
  process.exit(1);
}

const directoryHosts = new Set(["mcp.so", "glama.ai", "www.mcp.so", "www.glama.ai"]);

const { store } = await createConfiguredStore();
const leads = await store.listAgentLeads({ provenance: "real_discovery" });

let items: PartnerImportItem[];
if (filePath) {
  const raw = await readFile(filePath, "utf8");
  items = JSON.parse(raw) as PartnerImportItem[];
} else {
  items = leads
    .filter((lead) => {
      if (!lead.endpointUrl) return false;
      const host = new URL(lead.endpointUrl).hostname;
      if (directoryHosts.has(host)) return false;
      if (host === "cursor.com" && lead.endpointUrl.includes("/link/")) return false;
      return true;
    })
    .slice(0, 3)
    .map((lead) => ({
      leadId: lead.agentId,
      status: "active",
      supportedCategories: lead.verticals.slice(0, 3),
      slaTier: "sandbox",
      ownerId: "ops:real-test",
    }));
}

if (items.length === 0) {
  console.error("No eligible real_discovery leads were found for partner promotion.");
  await store.close();
  process.exit(1);
}

const checklist = {
  identity: true,
  auth: true,
  disclosure: true,
  sla: true,
  rateLimit: true,
};

const imported = [];
for (const item of items) {
  const lead = await store.getLead(item.leadId);
  if (!lead) {
    throw new Error(`Lead not found: ${item.leadId}`);
  }
  if (!lead.endpointUrl) {
    throw new Error(`Lead has no endpointUrl: ${item.leadId}`);
  }

  const ownerId = item.ownerId ?? lead.assignedOwner ?? "ops:real-test";
  if (lead.verificationStatus !== "verified" && lead.verificationStatus !== "active") {
    await store.assignLead(lead.agentId, ownerId);
    await store.updateLeadStatus(lead.agentId, "verified", ownerId, "Promoted to verified for real_test partner import.", checklist);
    await store.updateLeadStatus(lead.agentId, "active", ownerId, "Promoted to active for real_test partner import.", checklist);
  }

  const partner = await store.promoteLeadToPartner(lead.agentId, {
    partnerId: item.partnerId,
    dataProvenance: item.dataProvenance,
    status: item.status ?? "active",
    supportedCategories: item.supportedCategories,
    slaTier: item.slaTier,
    acceptsSponsored: item.acceptsSponsored,
    supportsDisclosure: item.supportsDisclosure,
    authModes: item.authModes,
  });

  imported.push({
    leadId: lead.agentId,
    providerOrg: lead.providerOrg,
    partnerId: partner?.partnerId,
    endpointUrl: lead.endpointUrl,
  });
}

await store.close();
console.log(JSON.stringify({ importedCount: imported.length, imported }, null, 2));

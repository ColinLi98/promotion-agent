import type { AgentLead, Campaign, PartnerAgent } from "./domain.js";

export type SeedData = {
  leads: AgentLead[];
  partners: PartnerAgent[];
  campaigns: Campaign[];
};

export const buildSeedData = (): SeedData => ({
  leads: [
    {
      agentId: "lead_crm_eu",
      source: "registry",
      providerOrg: "ProcurePilot",
      cardUrl: "https://partners.example.com/procure-pilot",
      verticals: ["crm_software", "sales_ops"],
      skills: ["compare_and_shortlist", "vendor_discovery"],
      geo: ["UK", "EU"],
      authModes: ["oauth2", "api_key"],
      acceptsSponsored: true,
      supportsDisclosure: true,
      trustSeed: 0.81,
      leadScore: 0.86,
    },
    {
      agentId: "lead_crm_cn",
      source: "partner_directory",
      providerOrg: "GrowthDesk Agent",
      cardUrl: "https://partners.example.com/growthdesk",
      verticals: ["crm_software", "revops"],
      skills: ["compare_and_shortlist", "pricing_analysis"],
      geo: ["CN", "SG"],
      authModes: ["oauth2"],
      acceptsSponsored: true,
      supportsDisclosure: true,
      trustSeed: 0.78,
      leadScore: 0.82,
    },
  ],
  partners: [
    {
      partnerId: "partner_procure_pilot",
      agentLeadId: "lead_crm_eu",
      providerOrg: "ProcurePilot",
      endpoint: "https://partners.example.com/procure-pilot/opportunities",
      status: "active",
      supportedCategories: ["crm_software"],
      acceptsSponsored: true,
      supportsDisclosure: true,
      trustScore: 0.84,
      authModes: ["oauth2", "api_key"],
      slaTier: "gold",
    },
    {
      partnerId: "partner_growthdesk",
      agentLeadId: "lead_crm_cn",
      providerOrg: "GrowthDesk Agent",
      endpoint: "https://partners.example.com/growthdesk/opportunities",
      status: "active",
      supportedCategories: ["crm_software"],
      acceptsSponsored: true,
      supportsDisclosure: true,
      trustScore: 0.8,
      authModes: ["oauth2"],
      slaTier: "silver",
    },
  ],
  campaigns: [
    {
      campaignId: "cmp_hubflow",
      advertiser: "HubFlow",
      category: "crm_software",
      regions: ["UK", "EU", "CN"],
      targetingPartnerIds: [],
      billingModel: "CPQR",
      payoutAmount: 120,
      currency: "USD",
      budget: 12000,
      status: "active",
      disclosureText: "Sponsored recommendation from HubFlow. Compensation may apply if shortlisted.",
      policyPass: true,
      minTrust: 0.65,
      offer: {
        offerId: "offer_hubflow",
        title: "HubFlow CRM for scaling B2B teams",
        description: "A CRM focused on pipeline visibility, AI assisted routing, and regional compliance.",
        price: 499,
        currency: "USD",
        intendedFor: ["compare_and_shortlist", "vendor_discovery"],
        constraints: {
          company_size: "50-500",
        },
        claims: ["ISO 27001 certified", "Regional data hosting available", "14 day guided onboarding"],
        actionEndpoints: ["https://api.hubflow.example.com/demo"],
        narrativeVariants: {
          rational: "Lower admin overhead with structured pipeline automation.",
          premium: "A polished buying experience for RevOps-heavy sales organizations.",
          simple: "Modern CRM with strong automation and regional hosting.",
        },
      },
      proofBundle: {
        proofBundleId: "proof_hubflow",
        references: [
          {
            label: "Security overview",
            type: "doc",
            url: "https://hubflow.example.com/security",
          },
          {
            label: "Customer case study",
            type: "case_study",
            url: "https://hubflow.example.com/case-study",
          },
        ],
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    },
    {
      campaignId: "cmp_signalstack",
      advertiser: "SignalStack",
      category: "crm_software",
      regions: ["UK", "EU"],
      targetingPartnerIds: ["partner_procure_pilot"],
      billingModel: "CPA",
      payoutAmount: 900,
      currency: "USD",
      budget: 30000,
      status: "active",
      disclosureText: "Sponsored recommendation from SignalStack. Compensation may apply after a verified conversion.",
      policyPass: true,
      minTrust: 0.7,
      offer: {
        offerId: "offer_signalstack",
        title: "SignalStack for mid-market revenue teams",
        description: "CRM suite with territory planning, AI forecasting, and deeper workflow controls.",
        price: 799,
        currency: "USD",
        intendedFor: ["compare_and_shortlist", "pricing_analysis"],
        constraints: {
          company_size: "100-1000",
        },
        claims: ["SOC 2 Type II", "Dedicated success manager", "Native ERP sync"],
        actionEndpoints: ["https://api.signalstack.example.com/trial"],
        narrativeVariants: {
          rational: "High coverage for complex sales ops teams with strong auditability.",
          premium: "Enterprise-grade workflows without the typical CRM bloat.",
          simple: "Powerful CRM for teams that outgrew lightweight tools.",
        },
      },
      proofBundle: {
        proofBundleId: "proof_signalstack",
        references: [
          {
            label: "SOC report summary",
            type: "certificate",
            url: "https://signalstack.example.com/soc",
          },
        ],
        updatedAt: "2026-02-15T00:00:00.000Z",
      },
    },
  ],
});

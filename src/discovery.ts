import crypto from "node:crypto";

import { AgentLeadSchema, type AgentLead, type DiscoverySource } from "./domain.js";

type DiscoveryFetch = (url: string) => Promise<{ url: string; text: string; links: string[] }>;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const textFromHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const collectLinks = (html: string, baseUrl: string) => {
  const links = new Set<string>();
  const regex = /href=["']([^"'#]+)["']/gi;
  const assetPatterns = [
    /\/_next\//i,
    /\.(css|js|woff2?|ttf|otf|png|jpg|jpeg|svg|gif|webp|ico|mp4|webm|mp3|json)$/i,
  ];
  const blockedHosts = new Set([
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "www.googletagmanager.com",
    "cloud.umami.is",
    "reddit.com",
    "www.reddit.com",
    "x.com",
  ]);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    try {
      const parsed = new URL(match[1], baseUrl);
      const url = parsed.toString();
      if (assetPatterns.some((pattern) => pattern.test(url))) {
        continue;
      }
      if (blockedHosts.has(parsed.hostname)) {
        continue;
      }
      links.add(url);
    } catch {
      continue;
    }
  }

  return [...links];
};

const defaultFetch: DiscoveryFetch = async (url) => {
  const response = await fetch(url);
  const text = await response.text();
  return {
    url,
    text,
    links: collectLinks(text, url),
  };
};

const findTitle = (html: string) =>
  html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
  html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ??
  "";

const detectAuthModes = (text: string) => {
  const lower = text.toLowerCase();
  const authModes = [];
  if (lower.includes("oauth")) authModes.push("oauth2");
  if (lower.includes("api key")) authModes.push("api_key");
  if (lower.includes("bearer")) authModes.push("bearer_token");
  return authModes;
};

const detectSkills = (text: string) => {
  const lower = text.toLowerCase();
  const skills = [];
  if (lower.includes("shortlist")) skills.push("compare_and_shortlist");
  if (lower.includes("pricing")) skills.push("pricing_analysis");
  if (lower.includes("vendor")) skills.push("vendor_discovery");
  if (lower.includes("revops")) skills.push("revops_support");
  return [...new Set(skills)];
};

const detectGeo = (text: string, source: DiscoverySource) => {
  const lower = text.toLowerCase();
  const hints = [...source.geoHints];
  for (const code of ["uk", "eu", "cn", "sg", "us"]) {
    if (lower.includes(` ${code} `) || lower.includes(`(${code})`)) {
      hints.push(code.toUpperCase());
    }
  }
  return [...new Set(hints)];
};

const detectVerticals = (text: string, source: DiscoverySource) => {
  const lower = text.toLowerCase();
  const verticals = [...source.verticalHints];
  if (lower.includes("crm")) verticals.push("crm_software");
  if (lower.includes("sales")) verticals.push("sales_ops");
  if (lower.includes("procurement")) verticals.push("saas_procurement");
  if (lower.includes("revops")) verticals.push("revops");
  return [...new Set(verticals)];
};

const detectEndpointUrl = (links: string[], baseUrl: string) => {
  const baseHost = new URL(baseUrl).hostname;
  const genericSameHostPaths = new Set([
    "/mcp",
    "/mcp/api",
    "/mcp/servers",
    "/mcp/connectors",
    "/mcp/tools",
    "/mcp/clients",
    "/servers",
  ]);

  return (
    links.find((link) => {
      if (!/opportunit|api|endpoint|integration|openapi|swagger/i.test(link)) {
        return false;
      }

      const parsed = new URL(link);
      if (parsed.hostname === baseHost && genericSameHostPaths.has(parsed.pathname)) {
        return false;
      }
      if (parsed.hostname === baseHost && (parsed.pathname.startsWith("/tag/") || parsed.pathname.startsWith("/mcp/servers/integrations/"))) {
        return false;
      }
      if (parsed.pathname.includes("/feeds/") || parsed.searchParams.has("query")) {
        return false;
      }

      return true;
    }) ?? null
  );
};

const detectContact = (text: string) =>
  text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;

const detectFlags = (text: string) => {
  const lower = text.toLowerCase();
  return {
    acceptsSponsored: lower.includes("sponsored") || lower.includes("promotion"),
    supportsDisclosure: lower.includes("disclosure") || lower.includes("sponsored"),
    supportsDeliveryReceipt:
      lower.includes("delivery receipt") ||
      lower.includes("delivery_receipt") ||
      lower.includes("receipt webhook") ||
      lower.includes("delivery callback"),
    supportsPresentationReceipt:
      lower.includes("presentation receipt") ||
      lower.includes("presented receipt") ||
      lower.includes("offer.presented") ||
      lower.includes("presentation webhook"),
  };
};

const isLikelyLeadPage = (
  source: DiscoverySource,
  url: string,
  title: string,
  text: string,
  endpointUrl: string | null,
  authModes: string[],
  skills: string[],
) => {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  const titleLower = title.toLowerCase();
  const textLower = text.toLowerCase();

  if (source.baseUrl.includes("mcp.so")) {
    return /^\/server\/[^/]+(?:\/[^/]+)?\/?$/.test(path);
  }

  if (source.baseUrl.includes("glama.ai")) {
    if (!/^\/mcp\/servers\/[^/]+\/[^/]+\/?$/.test(path)) {
      return false;
    }
    const segments = path.split("/").filter(Boolean);
    return !["categories", "feeds", "attributes"].includes(segments[2] ?? "");
  }

  const excludedPathSegments = [
    "/about",
    "/blog",
    "/careers",
    "/contact",
    "/privacy",
    "/terms",
    "/security",
    "/jobs",
    "/advertise",
    "/pricing",
    "/support",
    "/status",
    "/new",
    "/create",
    "/submit",
  ];
  if (excludedPathSegments.some((segment) => path === segment || path.startsWith(`${segment}/`))) {
    return false;
  }

  const positiveSignals = [
    /agent|assistant|workflow|server|tool|connector|integration/.test(`${path} ${titleLower} ${textLower}`),
    Boolean(endpointUrl),
    authModes.length > 0,
    skills.length > 0,
  ];

  return positiveSignals.some(Boolean);
};

const computeBreakdown = (verticals: string[], authModes: string[], endpointUrl: string | null, geo: string[]) => {
  const icpFit = Math.min(1, 0.4 + verticals.length * 0.15);
  const protocolFit = Math.min(1, (authModes.length * 0.35) + (endpointUrl ? 0.3 : 0));
  const reachFit = Math.min(1, 0.2 + geo.length * 0.15 + (endpointUrl ? 0.2 : 0));
  return {
    icpFit,
    protocolFit,
    reachFit,
  };
};

const humanizeSlug = (value: string) =>
  decodeURIComponent(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractProviderOrg = (title: string, url: string) => {
  const cleanedTitle = title.split("|")[0].split(" - ")[0].trim();
  if (cleanedTitle && cleanedTitle !== "- MCP Server" && cleanedTitle !== "MCP Server") {
    return cleanedTitle;
  }

  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] === "server" && segments[1]) {
    return humanizeSlug(segments[1]);
  }
  if (segments[0] === "mcp" && segments[1] === "servers" && segments[3]) {
    return humanizeSlug(segments[3]);
  }

  return parsed.hostname.replace(/^www\./, "");
};

export const buildDedupeKey = (providerOrg: string, endpointUrl: string | null, sourceType: DiscoverySource["sourceType"]) =>
  normalize(`${providerOrg}_${endpointUrl ?? "missing_endpoint"}_${sourceType}`);

export const crawlDiscoverySource = async (
  source: DiscoverySource,
  fetcher: DiscoveryFetch = defaultFetch,
) => {
  const queue = source.seedUrls.map((url) => ({ url, depth: 0 }));
  const visited = new Set<string>();
  const leads: AgentLead[] = [];
  const errors: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.url)) {
      continue;
    }
    visited.add(current.url);

    try {
      const page = await fetcher(current.url);
      const text = textFromHtml(page.text);
      const title = findTitle(page.text);
      const providerOrg = extractProviderOrg(title, current.url);
      const authModes = detectAuthModes(` ${text} `);
      const skills = detectSkills(` ${text} `);
      const geo = detectGeo(` ${text} `, source);
      const verticals = detectVerticals(` ${text} `, source);
      const endpointUrl = detectEndpointUrl(page.links, source.baseUrl);
      const contactRef = detectContact(text);
      const flags = detectFlags(text);
      const missingFields = [];
      if (!endpointUrl) missingFields.push("endpointUrl");
      if (authModes.length === 0) missingFields.push("authModes");
      if (!flags.supportsDisclosure) missingFields.push("supportsDisclosure");
      if (!flags.supportsDeliveryReceipt) missingFields.push("supportsDeliveryReceipt");
      if (!flags.supportsPresentationReceipt) missingFields.push("supportsPresentationReceipt");

      const scoreBreakdown = computeBreakdown(verticals, authModes, endpointUrl, geo);
      const reachProxy = scoreBreakdown.reachFit;
      const monetizationReadiness = Math.min(
        1,
        0.45 * scoreBreakdown.protocolFit + 0.35 * Number(flags.acceptsSponsored) + 0.2 * Number(flags.supportsDisclosure),
      );
      const leadScore = Math.min(
        1,
        0.4 * scoreBreakdown.icpFit + 0.3 * scoreBreakdown.protocolFit + 0.3 * scoreBreakdown.reachFit,
      );

      if (isLikelyLeadPage(source, current.url, title, text, endpointUrl, authModes, skills)) {
        leads.push(
          AgentLeadSchema.parse({
            agentId: `lead_${crypto.randomUUID().slice(0, 10)}`,
            dataOrigin: "discovered",
            dataProvenance: "real_discovery",
            source: source.name,
            sourceType: source.sourceType,
            sourceRef: source.sourceId,
            providerOrg,
            cardUrl: current.url,
            verticals,
            skills,
            geo,
            authModes,
            acceptsSponsored: flags.acceptsSponsored,
            supportsDisclosure: flags.supportsDisclosure,
            supportsDeliveryReceipt: flags.supportsDeliveryReceipt,
            supportsPresentationReceipt: flags.supportsPresentationReceipt,
            trustSeed: Math.min(1, 0.45 + authModes.length * 0.12 + Number(Boolean(endpointUrl)) * 0.2),
            leadScore,
            discoveredAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            endpointUrl,
            contactRef,
            missingFields,
            reachProxy,
            monetizationReadiness,
            verificationStatus: "new",
            lastVerifiedAt: null,
            verificationOwner: null,
            evidenceRef: current.url,
            assignedOwner: null,
            notes: "",
            dedupeKey: buildDedupeKey(providerOrg, endpointUrl, source.sourceType),
            scoreBreakdown,
          }),
        );
      }

      if (current.depth + 1 <= source.crawlPolicy.maxDepth) {
        for (const link of page.links) {
          if (link.startsWith(source.baseUrl)) {
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Failed to crawl ${current.url}`);
    }
  }

  return {
    leads,
    errors,
  };
};

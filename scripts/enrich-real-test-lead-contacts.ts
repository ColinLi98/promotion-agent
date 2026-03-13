import { URL } from "node:url";

import type { AgentLead } from "../src/domain.js";
import { createConfiguredStore } from "../src/factory.js";

type PageSnapshot = {
  url: string;
  html: string;
  text: string;
  links: string[];
  mailtos: string[];
};

type EmailCandidate = {
  email: string;
  sourceUrl: string;
  score: number;
};

const MAX_LEADS = Number(process.argv[2] ?? "25");
const PLACEHOLDER_EMAIL_PATTERN = /(example\.com|your_sender@|noreply@|no-reply@|donotreply@|@mcp\.so\b|@glama\.ai\b)/i;
const ASSET_PATTERN = /\.(css|js|woff2?|ttf|otf|png|jpg|jpeg|svg|gif|webp|ico|mp4|webm|mp3|pdf|zip)$/i;
const BLOCKED_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.googletagmanager.com",
  "cloud.umami.is",
  "x.com",
  "twitter.com",
  "www.reddit.com",
  "reddit.com",
]);
const FOLLOW_PATHS = [
  "/",
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
  "/support",
  "/company",
  "/team",
  "/impressum",
  "/business",
];
const FETCH_TIMEOUT_MS = 4500;
const MAX_PAGES_PER_LEAD = 8;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const textFromHtml = (html: string) =>
  normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );

const extractLinks = (html: string, baseUrl: string) => {
  const links = new Set<string>();
  const mailtos = new Set<string>();
  const regex = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const href = match[1];
    if (href.startsWith("mailto:")) {
      mailtos.add(href.replace("mailto:", "").split("?")[0]);
      continue;
    }
    try {
      const resolved = new URL(href, baseUrl);
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      const url = resolved.toString();
      if (ASSET_PATTERN.test(url)) continue;
      if (BLOCKED_HOSTS.has(resolved.hostname)) continue;
      links.add(url);
    } catch {
      continue;
    }
  }
  return {
    links: [...links],
    mailtos: [...mailtos],
  };
};

const extractEmails = (text: string) => [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];

const firstString = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

const isValidEmailCandidate = (email: string) => !PLACEHOLDER_EMAIL_PATTERN.test(email);

const hostFamily = (value: string) => value.split(".").slice(-2).join(".");

const localPartScore = (email: string) => {
  const local = email.split("@")[0].toLowerCase();
  if (/partnership|alliances|bd|biz|business/.test(local)) return 6;
  if (/contact|hello|team|chat|sales|support|ops/.test(local)) return 4;
  if (/info|admin/.test(local)) return 2;
  if (/privacy|security|legal|abuse|noreply|no-reply/.test(local)) return -6;
  return 1;
};

const urlScore = (url: string) => {
  if (/contact|about|team|company|business/i.test(url)) return 4;
  if (/github\.com/i.test(url)) return -1;
  return 0;
};

const buildCandidate = (email: string, sourceUrl: string, lead: AgentLead): EmailCandidate | null => {
  if (!isValidEmailCandidate(email)) return null;
  try {
    const emailDomain = email.split("@")[1].toLowerCase();
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
    const endpointHost = firstString(lead.endpointUrl) ? new URL(lead.endpointUrl!).hostname.toLowerCase() : null;
    const cardHost = new URL(lead.cardUrl).hostname.toLowerCase();
    let score = localPartScore(email) + urlScore(sourceUrl);
    if (hostFamily(emailDomain) === hostFamily(sourceHost)) score += 5;
    if (endpointHost && hostFamily(emailDomain) === hostFamily(endpointHost)) score += 4;
    if (hostFamily(emailDomain) === hostFamily(cardHost)) score += 1;
    return { email, sourceUrl, score };
  } catch {
    return null;
  }
};

const fetchPage = async (url: string): Promise<PageSnapshot | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Promotion-Agent/1.0 contact-miner",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }
    const html = await response.text();
    const { links, mailtos } = extractLinks(html, response.url);
    return {
      url: response.url,
      html,
      text: textFromHtml(html),
      links,
      mailtos,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const buildSeedUrls = (lead: AgentLead) => {
  const urls = new Set<string>();
  urls.add(lead.cardUrl);
  if (lead.endpointUrl) {
    try {
      const endpoint = new URL(lead.endpointUrl);
      urls.add(endpoint.toString());
      urls.add(endpoint.origin);
      for (const path of FOLLOW_PATHS) {
        urls.add(new URL(path, endpoint.origin).toString());
      }
    } catch {
      // ignore invalid endpoint URLs
    }
  }
  return [...urls];
};

const buildFollowUps = (snapshot: PageSnapshot, limit = 5) => {
  const ranked = snapshot.links
    .map((url) => ({
      url,
      score:
        (/contact|about|team|company|business/i.test(url) ? 10 : 0) +
        (/github\.com/i.test(url) ? 3 : 0) +
        (/docs|doc|readme/i.test(url) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.url);

  const expanded = new Set<string>(ranked);
  for (const url of ranked) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      if (/github\.com/i.test(parsed.hostname)) continue;
      expanded.add(parsed.origin);
      for (const path of FOLLOW_PATHS) {
        expanded.add(new URL(path, parsed.origin).toString());
      }
    } catch {
      continue;
    }
  }
  return [...expanded];
};

const collectCandidatesForLead = async (lead: AgentLead) => {
  const visited = new Set<string>();
  const queue = buildSeedUrls(lead);
  const candidates: EmailCandidate[] = [];
  const evidence: string[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES_PER_LEAD) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const snapshot = await fetchPage(current);
    if (!snapshot) continue;

    evidence.push(snapshot.url);
    for (const email of [...snapshot.mailtos, ...extractEmails(snapshot.text)]) {
      const candidate = buildCandidate(email, snapshot.url, lead);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    for (const followUp of buildFollowUps(snapshot)) {
      if (!visited.has(followUp)) {
        queue.push(followUp);
      }
    }
  }

  return {
    best: [...candidates].sort((a, b) => b.score - a.score)[0] ?? null,
    evidence,
    candidates: candidates.sort((a, b) => b.score - a.score),
  };
};

if (process.env.APP_MODE !== "real_test") {
  console.error("APP_MODE=real_test is required for contact enrichment.");
  process.exit(1);
}

const { store } = await createConfiguredStore();
const leads = await store.listAgentLeads({ provenance: "real_discovery" });
const eligible = leads
  .filter((lead) => !/example\.com/i.test(`${lead.cardUrl} ${lead.endpointUrl ?? ""} ${lead.contactRef ?? ""}`))
  .filter((lead) => !lead.contactRef || PLACEHOLDER_EMAIL_PATTERN.test(lead.contactRef))
  .sort((a, b) => b.leadScore - a.leadScore)
  .slice(0, MAX_LEADS);

const enriched: Array<{
  leadId: string;
  providerOrg: string;
  previousContactRef: string | null;
  contactRef: string;
  evidenceUrl: string;
  score: number;
}> = [];

for (const lead of eligible) {
  const result = await collectCandidatesForLead(lead);
  if (!result.best) continue;
  const updated: AgentLead = {
    ...lead,
    contactRef: result.best.email,
    lastSeenAt: new Date().toISOString(),
    evidenceRef: result.best.sourceUrl,
    notes: [lead.notes, `Contact mined from ${result.best.sourceUrl}`].filter(Boolean).join("\n"),
  };
  await store.upsertLeadRecord(updated);
  enriched.push({
    leadId: lead.agentId,
    providerOrg: lead.providerOrg,
    previousContactRef: lead.contactRef,
    contactRef: result.best.email,
    evidenceUrl: result.best.sourceUrl,
    score: result.best.score,
  });
}

const pipelines = await fetch("http://127.0.0.1:3002/recruitment/pipelines").then((response) => response.json() as Promise<Array<{ pipelineId: string; leadId: string; providerOrg: string; stage: string; nextStep: string | null }>>);
const outreachTargetsByPipeline = new Map<string, Array<{ channel: string; contactPoint: string; status: string }>>();
for (const pipeline of pipelines) {
  const targets = await fetch(`http://127.0.0.1:3002/recruitment/pipelines/${pipeline.pipelineId}/outreach-targets`).then((response) => response.json() as Promise<Array<{ channel: string; contactPoint: string; status: string }>>);
  outreachTargetsByPipeline.set(pipeline.pipelineId, targets);
}

const secondBatch = pipelines
  .filter((pipeline) => pipeline.stage !== "promoted")
  .map((pipeline) => ({
    pipelineId: pipeline.pipelineId,
    leadId: pipeline.leadId,
    providerOrg: pipeline.providerOrg,
    nextStep: pipeline.nextStep,
    outreachTargets: outreachTargetsByPipeline.get(pipeline.pipelineId) ?? [],
  }))
  .filter((pipeline) =>
    pipeline.outreachTargets.some(
      (target) =>
        target.channel === "email" &&
        target.status === "draft" &&
        target.contactPoint &&
        !PLACEHOLDER_EMAIL_PATTERN.test(target.contactPoint),
    ),
  );

await store.close();

console.log(
  JSON.stringify(
    {
      scannedCount: eligible.length,
      enrichedCount: enriched.length,
      enriched,
      secondBatch,
    },
    null,
    2,
  ),
);

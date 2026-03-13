import { buildEvidenceDrilldownMarkup, createSourceContext } from "./drilldown-links.js";

const leadId = decodeURIComponent(window.location.pathname.split("/").pop());
const leadTitle = document.querySelector("#leadTitle");
const leadSubtitle = document.querySelector("#leadSubtitle");
const leadSummary = document.querySelector("#leadSummary");
const verificationHistory = document.querySelector("#verificationHistory");
const statusForm = document.querySelector("#statusForm");
const statusFeedback = document.querySelector("#statusFeedback");
const promotionForm = document.querySelector("#promotionForm");
const promotionFeedback = document.querySelector("#promotionFeedback");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };

let currentLead = null;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value, label = value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(label)}</span>`;
const api = {
  get: async (path) => {
    const response = await fetch(path);
    return response.json();
  },
  post: async (path, body) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  },
};

const decorateEnvironment = () => {
  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle && !subtitle.querySelector("[data-environment-badge]")) {
    const label =
      appConfig.mode === "demo"
        ? "Demo Environment"
        : appConfig.mode === "real_test"
          ? "Real Test Environment"
          : "Default Environment";
    const tone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";
    subtitle.insertAdjacentHTML(
      "beforeend",
      ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`,
    );
  }
};

const defaultChecklistForLead = (lead) => {
  if (lead.verificationStatus === "active") {
    return {
      identity: true,
      auth: true,
      disclosure: true,
      sla: true,
      rateLimit: true,
    };
  }

  const missing = lead.missingFields.map((field) => String(field).toLowerCase());
  return {
    identity: Boolean(lead.contactRef) && !missing.some((field) => field.includes("contact") || field.includes("identity")),
    auth: lead.authModes.length > 0 && !missing.some((field) => field.includes("auth")),
    disclosure: lead.supportsDisclosure && !missing.some((field) => field.includes("disclosure")),
    sla: !missing.some((field) => field.includes("sla")),
    rateLimit: !missing.some((field) => field.includes("rate") || field.includes("limit")),
  };
};

const receiptReady = (lead) => lead.supportsDeliveryReceipt && lead.supportsPresentationReceipt;

const applyChecklistDefaults = (lead) => {
  const checklist = defaultChecklistForLead(lead);
  for (const [field, checked] of Object.entries(checklist)) {
    const input = statusForm.querySelector(`[name="${field}"]`);
    if (input) input.checked = checked;
  }
};

const renderLead = (lead) => {
  currentLead = lead;
  leadTitle.textContent = lead.providerOrg;
  leadSubtitle.textContent = `${lead.sourceType} · ${lead.cardUrl}`;
  leadSummary.innerHTML = `
    <article class="list-card"><strong>Status</strong><div>${badge(lead.verificationStatus)} ${badge(lead.dataProvenance)}</div><p class="meta-row">Owner: ${escapeHtml(lead.assignedOwner ?? "unassigned")}</p></article>
    <article class="list-card"><strong>Scores</strong><p class="meta-row">lead ${lead.leadScore.toFixed(2)} / reach ${lead.reachProxy.toFixed(2)} / monetization ${lead.monetizationReadiness.toFixed(2)}</p></article>
    <article class="list-card"><strong>Skills</strong><p class="meta-row">${escapeHtml(lead.skills.join(", "))}</p></article>
    <article class="list-card"><strong>Missing Fields</strong><p class="meta-row">${lead.missingFields.length ? escapeHtml(lead.missingFields.join(", ")) : "none"}</p><p class="meta-row">Delivery Receipt: ${lead.supportsDeliveryReceipt ? "yes" : "no"} · Presentation Receipt: ${lead.supportsPresentationReceipt ? "yes" : "no"}</p><p class="meta-row">Last Verified: ${escapeHtml(lead.lastVerifiedAt ? new Date(lead.lastVerifiedAt).toLocaleString() : "never")}</p><p class="meta-row">Verification Owner: ${escapeHtml(lead.verificationOwner ?? "unassigned")}</p>${buildEvidenceDrilldownMarkup(lead.evidenceRef, createSourceContext({ href: `/agents/${encodeURIComponent(lead.agentId)}`, label: `${lead.providerOrg} Lead Detail`, type: "agent_lead", id: lead.agentId }))}</article>
  `;
  statusForm.querySelector('[name="nextStatus"]').value = lead.verificationStatus === "new" ? "reviewing" : lead.verificationStatus;
  statusForm.querySelector('[name="evidenceRef"]').value = lead.evidenceRef ?? "verification://crm-detail";
  promotionForm.querySelector('[name="supportedCategories"]').value = lead.verticals.join(", ");
  promotionForm.querySelector('[name="status"]').value = lead.verificationStatus === "active" ? "active" : "verified";
  applyChecklistDefaults(lead);
  const canPromote = ["verified", "active"].includes(lead.verificationStatus) && Boolean(lead.endpointUrl) && receiptReady(lead);
  promotionForm.querySelector('button[type="submit"]').disabled = !canPromote;
  if (!canPromote) {
    promotionFeedback.textContent = !lead.endpointUrl
      ? "缺少 endpointUrl，当前还不能晋升为 partner。"
      : !receiptReady(lead)
        ? "缺少 delivery receipt / presentation receipt 能力，只能进入观察名单。"
      : "lead 需要先进入 verified / active 状态。";
    promotionFeedback.style.color = "var(--text-muted)";
  } else if (!promotionFeedback.textContent.includes("Partner created")) {
    promotionFeedback.textContent = "";
  }
};

const renderHistory = (items) => {
  verificationHistory.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="list-card">
              <div class="list-card-header"><h3 class="card-title">${escapeHtml(item.previousStatus)} → ${escapeHtml(item.nextStatus)}</h3>${badge(item.nextStatus)}</div>
              <div class="meta-row">${escapeHtml(item.actorId)} · ${new Date(item.occurredAt).toLocaleString()}</div>
              <div class="meta-row">${escapeHtml(item.comment)}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无 verification history。</div>`;
};

const load = async () => {
  decorateEnvironment();
  const [lead, history] = await Promise.all([
    api.get(`/agent-leads/${encodeURIComponent(leadId)}`),
    api.get(`/agent-leads/${encodeURIComponent(leadId)}/verification-history`),
  ]);
  renderLead(lead);
  renderHistory(history);
};

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(statusForm);
  const result = await api.post(`/agent-leads/${encodeURIComponent(leadId)}/status`, {
    nextStatus: data.get("nextStatus"),
    actorId: data.get("actorId"),
    comment: data.get("comment"),
    checklist: {
      identity: data.get("identity") === "on",
      auth: data.get("auth") === "on",
      disclosure: data.get("disclosure") === "on",
      sla: data.get("sla") === "on",
      rateLimit: data.get("rateLimit") === "on",
    },
    evidenceRef: data.get("evidenceRef"),
  });
  const success = result.ok && result.body?.ok !== false;
  statusFeedback.textContent = success ? "Status updated." : result.body?.message ?? "Status update failed.";
  statusFeedback.style.color = success ? "var(--success)" : "var(--danger)";
  await load();
});

promotionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentLead) return;

  const data = new FormData(promotionForm);
  const result = await api.post(`/agent-leads/${encodeURIComponent(leadId)}/promote`, {
    supportedCategories: String(data.get("supportedCategories") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    status: data.get("status"),
    slaTier: data.get("slaTier"),
    acceptsSponsored: currentLead.acceptsSponsored,
    supportsDisclosure: currentLead.supportsDisclosure,
    supportsDeliveryReceipt: currentLead.supportsDeliveryReceipt,
    supportsPresentationReceipt: currentLead.supportsPresentationReceipt,
    authModes: currentLead.authModes,
  });

  promotionFeedback.textContent = result.ok ? `Partner created: ${result.body.partnerId}` : result.body?.message ?? "Promotion failed.";
  promotionFeedback.style.color = result.ok ? "var(--success)" : "var(--danger)";
  await load();
});

load().catch((error) => {
  console.error(error);
  statusFeedback.textContent = "Load failed.";
});

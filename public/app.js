import { buildEvidenceDrilldownMarkup, createSourceContext } from "./drilldown-links.js";

const elements = {
  refreshAll: document.querySelector("#refreshAll"),
  healthDot: document.querySelector("#healthDot"),
  healthText: document.querySelector("#healthText"),
  summaryCards: document.querySelector("#summaryCards"),
  statusStrip: document.querySelector("#statusStrip"),
  campaignTableBody: document.querySelector("#campaignTableBody"),
  campaignDetail: document.querySelector("#campaignDetail"),
  campaignSort: document.querySelector("#campaignSort"),
  campaignSelectAll: document.querySelector("#campaignSelectAll"),
  campaignClearSelection: document.querySelector("#campaignClearSelection"),
  campaignBatchReview: document.querySelector("#campaignBatchReview"),
  campaignBatchActivate: document.querySelector("#campaignBatchActivate"),
  campaignBatchFeedback: document.querySelector("#campaignBatchFeedback"),
  partnerTableBody: document.querySelector("#partnerTableBody"),
  partnerDetail: document.querySelector("#partnerDetail"),
  queueTableBody: document.querySelector("#queueTableBody"),
  queueDetail: document.querySelector("#queueDetail"),
  queueSort: document.querySelector("#queueSort"),
  queueSelectAll: document.querySelector("#queueSelectAll"),
  queueClearSelection: document.querySelector("#queueClearSelection"),
  queueBatchDispute: document.querySelector("#queueBatchDispute"),
  queueBatchFeedback: document.querySelector("#queueBatchFeedback"),
  auditTableBody: document.querySelector("#auditTableBody"),
  auditDetail: document.querySelector("#auditDetail"),
  auditSort: document.querySelector("#auditSort"),
  auditSelectAll: document.querySelector("#auditSelectAll"),
  auditClearSelection: document.querySelector("#auditClearSelection"),
  auditCopyTraces: document.querySelector("#auditCopyTraces"),
  auditBatchFeedback: document.querySelector("#auditBatchFeedback"),
  shortlistResult: document.querySelector("#shortlistResult"),
  campaignForm: document.querySelector("#campaignForm"),
  opportunityForm: document.querySelector("#opportunityForm"),
  campaignFormResult: document.querySelector("#campaignFormResult"),
  opportunityResult: document.querySelector("#opportunityResult"),
  processRetryQueue: document.querySelector("#processRetryQueue"),
  retryQueueResult: document.querySelector("#retryQueueResult"),
};
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? {
  mode: "default",
  realDataOnly: false,
  defaultLeadFilter: [],
};
const pageParams = new URLSearchParams(window.location.search);

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const state = {
  selectedCampaignId: null,
  selectedCampaignIds: new Set(),
  selectedPartnerId: null,
  selectedSettlementId: null,
  selectedSettlementIds: new Set(),
  selectedAuditEventId: null,
  selectedAuditEventIds: new Set(),
};

const runtimeData = {
  dashboard: null,
  partners: [],
  campaigns: [],
  policyChecks: [],
  settlements: [],
  retryJobs: [],
  auditEvents: [],
};

const api = {
  get: (path) => fetch(path).then((response) => response.json()),
  post: async (path, payload) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  },
};

const campaignStatusOrder = ["reviewing", "draft", "active", "paused", "rejected"];
const settlementStatusOrder = ["retry_scheduled", "pending", "processing", "failed", "disputed", "settled"];

const stableReceiptIdFor = ({ intentId, offerId, partnerId, campaignId, eventType = "offer.presented" }) =>
  `rcpt_${[intentId, offerId, partnerId, campaignId, eventType].join("_").replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value, label = value) =>
  `<span class="badge ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(label)}</span>`;

const iconChip = (label, glyph) =>
  `<span class="icon-chip"><span class="icon-glyph">${escapeHtml(glyph)}</span>${escapeHtml(label)}</span>`;

const metricCard = (label, value, foot) => `
  <article class="metric-card">
    <p class="metric-label">${escapeHtml(label)}</p>
    <p class="metric-value">${escapeHtml(value)}</p>
    <p class="metric-foot">${escapeHtml(foot)}</p>
  </article>
`;

const detailSection = (title, value) => `
  <section class="detail-section">
    <p class="detail-section-title">${escapeHtml(title)}</p>
    <div class="detail-section-value">${value}</div>
  </section>
`;

const emptyState = (title, copy) => `
  <div class="empty-state">
    <strong>${escapeHtml(title)}</strong>
    <div class="meta-row">${escapeHtml(copy)}</div>
  </div>
`;

const environmentLabel =
  appConfig.mode === "demo"
    ? "Demo Environment"
    : appConfig.mode === "real_test"
      ? "Real Test Environment"
      : "Default Environment";

const environmentBadgeTone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";

const withProvenance = (path, provenance) => {
  if (!provenance) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set("provenance", provenance);
  return `${url.pathname}${url.search}`;
};

const decorateEnvironment = () => {
  const brandMeta = document.querySelector(".site-brand-copy .meta-row");
  if (brandMeta && !brandMeta.querySelector("[data-environment-badge]")) {
    brandMeta.insertAdjacentHTML(
      "beforeend",
      ` <span data-environment-badge="true" class="badge ${environmentBadgeTone}">${escapeHtml(environmentLabel)}</span>`,
    );
  }

  const runtimeTitle = document.querySelector(".hero-card .detail-section-title");
  if (runtimeTitle) {
    runtimeTitle.textContent = `${runtimeTitle.textContent} · ${environmentLabel}`;
  }
};

const setFeedback = (element, message, tone = "info") => {
  element.textContent = message;
  element.style.color = tone === "error" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--text-muted)";
};

const compareByListOrder = (order, value) => {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
};

const sortCampaigns = (campaigns) => {
  switch (elements.campaignSort.value) {
    case "payout_desc":
      return campaigns.slice().sort((left, right) => right.payoutAmount - left.payoutAmount);
    case "advertiser":
      return campaigns.slice().sort((left, right) => left.advertiser.localeCompare(right.advertiser));
    case "status":
    default:
      return campaigns
        .slice()
        .sort((left, right) => compareByListOrder(campaignStatusOrder, left.status) - compareByListOrder(campaignStatusOrder, right.status) || left.advertiser.localeCompare(right.advertiser));
  }
};

const sortSettlements = (settlements) => {
  switch (elements.queueSort.value) {
    case "amount_desc":
      return settlements.slice().sort((left, right) => right.amount - left.amount);
    case "status":
      return settlements
        .slice()
        .sort((left, right) => compareByListOrder(settlementStatusOrder, left.status) - compareByListOrder(settlementStatusOrder, right.status));
    case "recent":
    default:
      return settlements.slice().sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
  }
};

const sortAuditEvents = (events) => {
  switch (elements.auditSort.value) {
    case "status":
      return events.slice().sort((left, right) => left.status.localeCompare(right.status));
    case "actor":
      return events.slice().sort((left, right) => left.actorType.localeCompare(right.actorType));
    case "recent":
    default:
      return events.slice().sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  }
};

const renderSummary = (dashboard) => {
  elements.summaryCards.innerHTML = [
    metricCard("Plan", dashboard.currentPlanId, "当前 workspace 的推广强度档位"),
    metricCard("Available Credits", dashboard.availableCredits, "当前可消耗的推广 credits"),
    metricCard("Active Partners", dashboard.activePartners, "当前可以承接 sponsored shortlist 的合作方"),
    metricCard("Active Campaigns", dashboard.activeCampaigns, "已通过 policy 并进入排序候选"),
    metricCard("Settlements", dashboard.settlementCount, "收到合格回执后写入的账单记录"),
    metricCard("Qualified Recommendation Rate", pct.format(dashboard.qualifiedRecommendationRate), "当前按 intent 聚合的 presented 命中比率"),
    metricCard("Viewed Rate", pct.format(dashboard.detailViewRate), "从 presented 到 viewed 的转化率"),
    metricCard("Disclosure Shown Rate", pct.format(dashboard.disclosureShownRate), "赞助结果在 presented 时被正确披露的比例"),
    metricCard("Action Conversion Rate", pct.format(dashboard.actionConversionRate), "interacted 后进入 converted 的比例"),
    metricCard("Qualified Agent Coverage", dashboard.qualifiedAgentCoverage, "已验证且可上线的目标 agent 数量"),
    metricCard("Touched Buyer Agents", dashboard.touchedBuyerAgents, "当前进入可商业覆盖池的 buyer agent 数"),
  ].join("");
};

const renderStatusStrip = (dashboard, campaigns, partners, settlements) => {
  const reviewing = campaigns.filter((campaign) => campaign.status === "reviewing").length;
  const rejected = campaigns.filter((campaign) => campaign.status === "rejected").length;
  const queued = settlements.filter((settlement) => settlement.status === "pending" || settlement.status === "retry_scheduled").length;

  elements.statusStrip.innerHTML = `
    <article class="status-block">
      <div class="status-title"><strong>Discovery Surface</strong>${badge("active", `${partners.length} agents`)}</div>
      <div class="status-stat">${partners.length}</div>
      <p class="status-copy">合作 agent 存量与覆盖情况。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Review Queue</strong>${badge("reviewing", `${reviewing} reviewing`)}</div>
      <div class="status-stat">${reviewing}</div>
      <p class="status-copy">还没进入 active 的 campaign 数。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Queued Settlements</strong>${badge(queued ? "reviewing" : "active", `${queued} queued`)}</div>
      <div class="status-stat">${queued}</div>
      <p class="status-copy">正在等待 worker 消费或 retry 的结算。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Rejected Inventory</strong>${badge(rejected ? "failure" : "active", `${rejected} rejected`)}</div>
      <div class="status-stat">${rejected}</div>
      <p class="status-copy">需要回头修正 policy 或风控问题的活动。</p>
    </article>
  `;
};

const summarizeBatch = (label, results) => {
  const success = results.filter((item) => item.ok).map((item) => item.id);
  const failed = results.filter((item) => !item.ok).map((item) => item.id);
  return `${label} 完成: 成功 ${success.length}，失败 ${failed.length}${failed.length ? `，失败项 ${failed.join(", ")}` : ""}`;
};

const renderCampaignTable = () => {
  const campaigns = sortCampaigns(runtimeData.campaigns);
  const latestPolicyByCampaignId = new Map(runtimeData.policyChecks.map((item) => [item.campaignId, item]));
  if (!state.selectedCampaignId && campaigns.length) {
    state.selectedCampaignId = campaigns[0].campaignId;
  }

  elements.campaignTableBody.innerHTML = campaigns
    .map((campaign) => {
      const policyCheck = latestPolicyByCampaignId.get(campaign.campaignId);
      return `
        <tr class="${campaign.campaignId === state.selectedCampaignId ? "is-selected" : ""}">
          <td class="selection-cell"><input class="selection-checkbox" type="checkbox" data-campaign-check="${escapeHtml(campaign.campaignId)}" ${state.selectedCampaignIds.has(campaign.campaignId) ? "checked" : ""}></td>
          <td>
            <button class="row-button" data-select-campaign="${escapeHtml(campaign.campaignId)}">
              <strong>${escapeHtml(campaign.advertiser)}</strong>
              <div class="meta-row">${escapeHtml(campaign.offer.title)}</div>
            </button>
          </td>
          <td>${badge(campaign.status)}</td>
          <td>${policyCheck ? badge(policyCheck.decision) : badge("draft", "unchecked")}</td>
          <td>${escapeHtml(campaign.billingModel)}</td>
          <td>${currency.format(campaign.payoutAmount)}</td>
          <td>${escapeHtml(campaign.category)}</td>
        </tr>
      `;
    })
    .join("");

  const selected = campaigns.find((campaign) => campaign.campaignId === state.selectedCampaignId) ?? campaigns[0];
  const selectedPolicy = latestPolicyByCampaignId.get(selected?.campaignId);
  if (!selected) {
    elements.campaignDetail.innerHTML = emptyState("没有活动", "先创建 campaign，或从筛选中放宽条件。");
    return;
  }

  const riskFlags = selectedPolicy?.riskFlags?.length
    ? selectedPolicy.riskFlags.map((flag) => iconChip(flag, "!")).join("")
    : iconChip("no risk flag", "OK");

  elements.campaignDetail.innerHTML = `
    ${detailSection("Summary", `
      <h3 class="panel-title">${escapeHtml(selected.advertiser)} · ${escapeHtml(selected.offer.title)}</h3>
      <p class="meta-row">${badge(selected.status)} ${selectedPolicy ? badge(selectedPolicy.decision) : badge("draft", "unchecked")} ${badge(selected.dataProvenance)}</p>
    `)}
    ${detailSection("Commercial", `
      <p class="meta-row">Billing ${escapeHtml(selected.billingModel)} · Payout ${currency.format(selected.payoutAmount)} · Budget ${currency.format(selected.budget)}</p>
      <p class="meta-row">Category ${escapeHtml(selected.category)} · Region ${escapeHtml(selected.regions.join(", "))}</p>
    `)}
    ${detailSection("Proof & Disclosure", `
      <p class="meta-row">${escapeHtml(selected.disclosureText)}</p>
      <div class="badge-row">${riskFlags}</div>
      <p class="meta-row">Claims: ${escapeHtml(selected.offer.claims.join(" / "))}</p>
    `)}
    ${detailSection("Operator Focus", `
      <p class="meta-row">Selected campaigns: ${state.selectedCampaignIds.size}</p>
      <p class="meta-row">Use batch actions for review/activation, or act on this single campaign below.</p>
    `)}
    <div class="card-actions">
      <button class="button button-subtle" data-action="review" data-campaign-id="${escapeHtml(selected.campaignId)}">重新 Review</button>
      ${selected.status === "reviewing" && selectedPolicy?.decision === "pass" ? `<button class="button button-primary" data-action="activate" data-campaign-id="${escapeHtml(selected.campaignId)}">Activate</button>` : ""}
    </div>
  `;
};

const renderPartnerTable = () => {
  const partners = runtimeData.partners.slice().sort((left, right) => right.trustScore - left.trustScore);
  const requestedPartnerId = pageParams.get("partnerId");
  if (requestedPartnerId && partners.some((partner) => partner.partnerId === requestedPartnerId)) {
    state.selectedPartnerId = requestedPartnerId;
  }
  if (!state.selectedPartnerId && partners.length) {
    state.selectedPartnerId = partners[0].partnerId;
  }

  elements.partnerTableBody.innerHTML = partners
    .map((partner) => `
      <tr class="${partner.partnerId === state.selectedPartnerId ? "is-selected" : ""}">
        <td>
          <button class="row-button" data-select-partner="${escapeHtml(partner.partnerId)}">
            <strong>${escapeHtml(partner.providerOrg)}</strong>
            <div class="meta-row">${escapeHtml(partner.supportedCategories.join(", "))} · ${escapeHtml(partner.dataProvenance)}</div>
          </button>
        </td>
        <td>${badge(partner.status)}</td>
        <td>${partner.trustScore.toFixed(2)}</td>
        <td>${partner.supportsDisclosure ? iconChip("disclosure", "D") : iconChip("missing", "!")} ${partner.supportsDeliveryReceipt ? iconChip("delivery", "R") : ""} ${partner.supportsPresentationReceipt ? iconChip("presented", "P") : ""}</td>
        <td>${escapeHtml(partner.verificationOwner ?? "-")}<div class="meta-row">${escapeHtml(partner.lastVerifiedAt ? new Date(partner.lastVerifiedAt).toLocaleDateString() : "never")}</div></td>
        <td>${escapeHtml(partner.authModes.join(", "))}</td>
      </tr>
    `)
    .join("");

  const selected = partners.find((partner) => partner.partnerId === state.selectedPartnerId) ?? partners[0];
  if (!selected) {
    elements.partnerDetail.innerHTML = emptyState("没有 partner", "当前没有可展示的合作 agent。");
    return;
  }

  elements.partnerDetail.innerHTML = `
    ${detailSection("Partner", `
      <h3 class="panel-title">${escapeHtml(selected.providerOrg)}</h3>
      <p class="meta-row">${badge(selected.status)} ${badge(selected.dataProvenance)} ${iconChip(`trust ${selected.trustScore.toFixed(2)}`, "T")}</p>
    `)}
    ${detailSection("Integration", `
      <p class="meta-row">${escapeHtml(selected.endpoint)}</p>
      <p class="meta-row">Auth: ${escapeHtml(selected.authModes.join(", "))}</p>
      <p class="meta-row">Disclosure: ${selected.supportsDisclosure ? "yes" : "no"}</p>
      <p class="meta-row">Delivery Receipt: ${selected.supportsDeliveryReceipt ? "yes" : "no"}</p>
      <p class="meta-row">Presentation Receipt: ${selected.supportsPresentationReceipt ? "yes" : "no"}</p>
    `)}
    ${detailSection("Capability", `
      <p class="meta-row">Categories: ${escapeHtml(selected.supportedCategories.join(", "))}</p>
      <p class="meta-row">SLA tier: ${escapeHtml(selected.slaTier)}</p>
      <p class="meta-row">Last Verified: ${escapeHtml(selected.lastVerifiedAt ? new Date(selected.lastVerifiedAt).toLocaleString() : "never")}</p>
      <p class="meta-row">Verification Owner: ${escapeHtml(selected.verificationOwner ?? "unassigned")}</p>
      ${buildEvidenceDrilldownMarkup(
        selected.evidenceRef,
        createSourceContext({
          href: `/?partnerId=${encodeURIComponent(selected.partnerId)}`,
          label: `${selected.providerOrg} Partner`,
          type: "partner",
          id: selected.partnerId,
        }),
      )}
    `)}
  `;
};

const renderQueueTable = () => {
  const retryBySettlementId = new Map(runtimeData.retryJobs.map((job) => [job.settlementId, job]));
  const settlements = sortSettlements(runtimeData.settlements);
  if (!state.selectedSettlementId && settlements.length) {
    state.selectedSettlementId = settlements[0].settlementId;
  }

  elements.queueTableBody.innerHTML = settlements
    .map((settlement) => {
      const retryJob = retryBySettlementId.get(settlement.settlementId);
      return `
        <tr class="${settlement.settlementId === state.selectedSettlementId ? "is-selected" : ""}">
          <td class="selection-cell"><input class="selection-checkbox" type="checkbox" data-settlement-check="${escapeHtml(settlement.settlementId)}" ${state.selectedSettlementIds.has(settlement.settlementId) ? "checked" : ""}></td>
          <td>
            <button class="row-button" data-select-settlement="${escapeHtml(settlement.settlementId)}">
              <strong>${escapeHtml(settlement.settlementId)}</strong>
              <div class="meta-row">${escapeHtml(settlement.intentId)} · ${escapeHtml(settlement.dataProvenance)}</div>
            </button>
          </td>
          <td>${badge(settlement.status)}</td>
          <td>${escapeHtml(settlement.billingModel)}</td>
          <td>${currency.format(settlement.amount)}</td>
          <td>${retryJob ? badge(retryJob.status) : badge("draft", "none")}</td>
        </tr>
      `;
    })
    .join("");

  const selected = settlements.find((settlement) => settlement.settlementId === state.selectedSettlementId) ?? settlements[0];
  const selectedRetryJob = retryBySettlementId.get(selected?.settlementId ?? "");
  if (!selected) {
    elements.queueDetail.innerHTML = emptyState("没有 settlement", "当前没有进入首页队列视图的结算记录。");
    return;
  }

  elements.queueDetail.innerHTML = `
    ${detailSection("Settlement", `
      <h3 class="panel-title">${escapeHtml(selected.settlementId)}</h3>
      <p class="meta-row">${badge(selected.status)} ${badge(selected.eventType)} ${badge(selected.dataProvenance)}</p>
    `)}
    ${detailSection("Provider", `
      <p class="meta-row">State: ${escapeHtml(selected.providerState ?? "pending")}</p>
      <p class="meta-row">Code: ${escapeHtml(selected.providerResponseCode ?? "n/a")}</p>
      <p class="meta-row">Reference: ${escapeHtml(selected.providerReference ?? "n/a")}</p>
    `)}
    ${detailSection("Queue", selectedRetryJob ? `
      <p class="meta-row">Job ${escapeHtml(selectedRetryJob.retryJobId)} · ${badge(selectedRetryJob.status)}</p>
      <p class="meta-row">Attempts ${selectedRetryJob.attempts}/${selectedRetryJob.maxAttempts}</p>
      <p class="meta-row">Last error: ${escapeHtml(selectedRetryJob.lastError ?? "none")}</p>
    ` : `<p class="meta-row">No retry job linked.</p>`)}
    ${detailSection("Operator Focus", `
      <p class="meta-row">Selected settlements: ${state.selectedSettlementIds.size}</p>
      <p class="meta-row">批量 Dispute 适合处理一组明显有问题的结算。</p>
    `)}
    <div class="card-actions">
      ${selected.status !== "disputed" && selected.status !== "settled" && selected.status !== "failed" ? `<button class="button button-subtle" data-action="dispute-settlement" data-settlement-id="${escapeHtml(selected.settlementId)}">标记为 Disputed</button>` : ""}
      <a class="button button-subtle" href="/dlq.html?traceId=${encodeURIComponent(selected.intentId)}">查看 DLQ</a>
    </div>
  `;
};

const renderAuditTable = () => {
  const auditEvents = sortAuditEvents(runtimeData.auditEvents.items ?? []);
  if (!state.selectedAuditEventId && auditEvents.length) {
    state.selectedAuditEventId = auditEvents[0].auditEventId;
  }

  elements.auditTableBody.innerHTML = auditEvents
    .map((event) => `
      <tr class="${event.auditEventId === state.selectedAuditEventId ? "is-selected" : ""}">
        <td class="selection-cell"><input class="selection-checkbox" type="checkbox" data-audit-check="${escapeHtml(event.auditEventId)}" ${state.selectedAuditEventIds.has(event.auditEventId) ? "checked" : ""}></td>
        <td>
          <button class="row-button" data-select-audit="${escapeHtml(event.auditEventId)}">
            <strong>${escapeHtml(event.action)}</strong>
            <div class="meta-row">${escapeHtml(event.entityType)} · ${escapeHtml(event.dataProvenance)}</div>
          </button>
        </td>
        <td class="mono">${escapeHtml(event.traceId)}</td>
        <td>${escapeHtml(event.entityId)}</td>
        <td>${badge(event.status)}</td>
        <td>${iconChip(event.actorType, event.actorType === "system" ? "S" : "O")}</td>
      </tr>
    `)
    .join("");

  const selected = auditEvents.find((event) => event.auditEventId === state.selectedAuditEventId) ?? auditEvents[0];
  if (!selected) {
    elements.auditDetail.innerHTML = emptyState("没有 audit event", "当前页没有可查看的审计事件。");
    return;
  }

  elements.auditDetail.innerHTML = `
    ${detailSection("Event", `
      <h3 class="panel-title">${escapeHtml(selected.action)}</h3>
      <p class="meta-row">${badge(selected.status)} ${badge(selected.dataProvenance)} ${iconChip(selected.actorType, selected.actorType === "system" ? "S" : "O")}</p>
    `)}
    ${detailSection("Timeline", `
      <div class="timeline">
        <div class="timeline-item">
          <span class="timeline-dot"></span>
          <div class="timeline-body">
            <p class="timeline-title">${escapeHtml(selected.entityType)} · ${escapeHtml(selected.entityId)}</p>
            <p class="timeline-meta">${new Date(selected.occurredAt).toLocaleString()}</p>
          </div>
        </div>
      </div>
    `)}
    ${detailSection("Operator Focus", `
      <p class="meta-row">Selected audit events: ${state.selectedAuditEventIds.size}</p>
      <p class="meta-row">使用复制 trace 功能，把一组相关事件直接带去 Drill-Down 页面或团队沟通中。</p>
    `)}
    ${detailSection("Details", `<pre class="mono code-block">${escapeHtml(JSON.stringify(selected.details, null, 2))}</pre>`)}
    <div class="card-actions">
      <a class="button button-subtle" href="/audit.html?traceId=${encodeURIComponent(selected.traceId)}&pageSize=20">打开完整 Trace</a>
    </div>
  `;
};

const renderShortlist = (result) => {
  if (!result?.shortlisted?.length) {
    elements.shortlistResult.innerHTML = `<div class="empty-state">当前请求没有返回可展示的 sponsored shortlist。</div>`;
    return;
  }

  elements.shortlistResult.innerHTML = result.shortlisted
    .map(
      (item, index) => `
        <article class="shortlist-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">#${index + 1} ${escapeHtml(item.campaignId)}</h3>
              <p class="card-subtitle">${escapeHtml(item.offerId)} · ${escapeHtml(item.partnerId)}</p>
            </div>
            <div class="badge-row">
              ${badge("active", `score ${item.priorityScore.toFixed(3)}`)}
              ${badge("pass", `${item.ttlSeconds}s TTL`)}
            </div>
          </div>
          <div class="shortlist-grid">
            <div class="shortlist-metric"><span>Relevance</span><strong>${item.relevance.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Utility</span><strong>${item.expectedUtility.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Trust</span><strong>${item.trustScore.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Bid</span><strong>${currency.format(item.bidValue)}</strong></div>
          </div>
          <p class="meta-row">Ranking reason: ${escapeHtml(item.rankingReason)}</p>
          <p class="meta-row">Disclosure: ${escapeHtml(item.disclosureText)}</p>
          <div class="card-actions">
            <div class="meta-row">Audit trace: ${escapeHtml(item.auditTraceId)}</div>
            <button
              class="button button-subtle"
              data-action="receipt"
              data-receipt-id="${escapeHtml(
                stableReceiptIdFor({
                  intentId: result.intentId,
                  offerId: item.offerId,
                  partnerId: item.partnerId,
                  campaignId: item.campaignId,
                  eventType: "offer.presented",
                }),
              )}"
              data-intent-id="${escapeHtml(result.intentId)}"
              data-offer-id="${escapeHtml(item.offerId)}"
              data-campaign-id="${escapeHtml(item.campaignId)}"
              data-partner-id="${escapeHtml(item.partnerId)}"
            >
              发送 presented 回执
            </button>
          </div>
        </article>
      `,
    )
    .join("");
};

const renderAll = () => {
  if (!runtimeData.dashboard) return;
  renderSummary(runtimeData.dashboard);
  renderStatusStrip(runtimeData.dashboard, runtimeData.campaigns, runtimeData.partners, runtimeData.settlements);
  renderCampaignTable();
  renderPartnerTable();
  renderQueueTable();
  renderAuditTable();
};

const loadState = async () => {
  const partnerPath = appConfig.realDataOnly ? withProvenance("/partners", "real_partner,ops_manual") : "/partners";
  const campaignPath = appConfig.realDataOnly ? withProvenance("/campaigns", "real_campaign,ops_manual") : "/campaigns";
  const settlementPath = appConfig.realDataOnly ? withProvenance("/settlements", "sandbox_settlement") : "/settlements";
  const auditPath = appConfig.realDataOnly
    ? withProvenance("/audit-trail?page=1&pageSize=20", "real_event,real_campaign,real_partner,real_discovery,sandbox_settlement,ops_manual")
    : "/audit-trail?page=1&pageSize=20";
  const [health, dashboard, partners, campaigns, policyChecks, settlements, retryJobs, auditEvents] = await Promise.all([
    api.get("/health"),
    api.get("/dashboard"),
    api.get(partnerPath),
    api.get(campaignPath),
    api.get("/policy-checks"),
    api.get(settlementPath),
    api.get("/settlements/retry-jobs?limit=20"),
    api.get(auditPath),
  ]);

  runtimeData.dashboard = dashboard;
  runtimeData.partners = partners;
  runtimeData.campaigns = campaigns;
  runtimeData.policyChecks = policyChecks;
  runtimeData.settlements = settlements;
  runtimeData.retryJobs = retryJobs;
  runtimeData.auditEvents = auditEvents;

  elements.healthText.textContent = health.ok ? "Operational" : "Unavailable";
  elements.healthDot.classList.toggle("ok", Boolean(health.ok));
  elements.healthDot.classList.toggle("down", !health.ok);

  renderAll();
};

decorateEnvironment();

elements.refreshAll.addEventListener("click", () => {
  loadState().catch((error) => {
    console.error(error);
    setFeedback(elements.campaignFormResult, "刷新失败，请检查服务状态。", "error");
  });
});

elements.campaignSort.addEventListener("change", () => renderCampaignTable());
elements.queueSort.addEventListener("change", () => renderQueueTable());
elements.auditSort.addEventListener("change", () => renderAuditTable());

elements.campaignSelectAll.addEventListener("click", () => {
  state.selectedCampaignIds = new Set(runtimeData.campaigns.map((campaign) => campaign.campaignId));
  setFeedback(elements.campaignBatchFeedback, `已选择 ${state.selectedCampaignIds.size} 个 campaign。`, "info");
  renderCampaignTable();
});

elements.campaignClearSelection.addEventListener("click", () => {
  state.selectedCampaignIds.clear();
  setFeedback(elements.campaignBatchFeedback, "已清空 campaign 选择。", "info");
  renderCampaignTable();
});

elements.queueSelectAll.addEventListener("click", () => {
  state.selectedSettlementIds = new Set(runtimeData.settlements.map((settlement) => settlement.settlementId));
  setFeedback(elements.queueBatchFeedback, `已选择 ${state.selectedSettlementIds.size} 个 settlement。`, "info");
  renderQueueTable();
});

elements.queueClearSelection.addEventListener("click", () => {
  state.selectedSettlementIds.clear();
  setFeedback(elements.queueBatchFeedback, "已清空 settlement 选择。", "info");
  renderQueueTable();
});

elements.auditSelectAll.addEventListener("click", () => {
  state.selectedAuditEventIds = new Set((runtimeData.auditEvents.items ?? []).map((event) => event.auditEventId));
  setFeedback(elements.auditBatchFeedback, `已选择 ${state.selectedAuditEventIds.size} 条 audit event。`, "info");
  renderAuditTable();
});

elements.auditClearSelection.addEventListener("click", () => {
  state.selectedAuditEventIds.clear();
  setFeedback(elements.auditBatchFeedback, "已清空 audit 选择。", "info");
  renderAuditTable();
});

elements.auditCopyTraces.addEventListener("click", async () => {
  if (state.selectedAuditEventIds.size === 0) {
    setFeedback(elements.auditBatchFeedback, "先选择至少一条 audit event。", "info");
    return;
  }
  const selected = (runtimeData.auditEvents.items ?? []).filter((event) => state.selectedAuditEventIds.has(event.auditEventId));
  const text = [...new Set(selected.map((event) => event.traceId))].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setFeedback(elements.auditBatchFeedback, "已复制选中 trace。", "success");
  } catch {
    setFeedback(elements.auditBatchFeedback, text, "info");
  }
});

elements.campaignBatchReview.addEventListener("click", async () => {
  if (state.selectedCampaignIds.size === 0) {
    setFeedback(elements.campaignBatchFeedback, "先选择至少一个 campaign。", "info");
    return;
  }
  const results = [];
  for (const id of state.selectedCampaignIds) {
    const response = await api.post(`/campaigns/${id}/review`, {});
    results.push({ id, ok: response.ok });
  }
  setFeedback(elements.campaignBatchFeedback, summarizeBatch("批量 Review", results), results.every((item) => item.ok) ? "success" : "info");
  await loadState();
});

elements.campaignBatchActivate.addEventListener("click", async () => {
  if (state.selectedCampaignIds.size === 0) {
    setFeedback(elements.campaignBatchFeedback, "先选择至少一个 campaign。", "info");
    return;
  }
  const results = [];
  for (const id of state.selectedCampaignIds) {
    const response = await api.post(`/campaigns/${id}/activate`, {});
    results.push({ id, ok: response.ok && response.status !== 409 });
  }
  setFeedback(elements.campaignBatchFeedback, summarizeBatch("批量 Activate", results), results.every((item) => item.ok) ? "success" : "info");
  await loadState();
});

elements.queueBatchDispute.addEventListener("click", async () => {
  if (state.selectedSettlementIds.size === 0) {
    setFeedback(elements.queueBatchFeedback, "先选择至少一个 settlement。", "info");
    return;
  }
  const results = [];
  for (const id of state.selectedSettlementIds) {
    const response = await api.post(`/settlements/${id}/dispute`, {});
    results.push({ id, ok: response.ok });
  }
  setFeedback(elements.queueBatchFeedback, summarizeBatch("批量 Dispute", results), results.every((item) => item.ok) ? "success" : "info");
  await loadState();
});

elements.campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const payload = {
    advertiser: formData.get("advertiser"),
    externalRef: appConfig.mode === "real_test" ? String(formData.get("advertiser") ?? "").trim() || null : null,
    sourceDocumentUrl: null,
    category: formData.get("category"),
    regions: [formData.get("region")],
    billingModel: formData.get("billingModel"),
    payoutAmount: Number(formData.get("payoutAmount")),
    currency: "USD",
    budget: Number(formData.get("budget")),
    disclosureText: formData.get("disclosureText"),
    minTrust: 0.66,
    product: {
      name: formData.get("productName"),
      description: formData.get("description"),
      price: Number(formData.get("price")),
      currency: "USD",
      intendedFor: ["compare_and_shortlist", "vendor_discovery"],
      constraints: {
        company_size: "50-300",
      },
      claims: [formData.get("claim")],
      actionEndpoints: [formData.get("actionEndpoint")],
      positioningBullets: ["pipeline clarity", "measurable onboarding"],
    },
    proofReferences: [
      {
        label: "Primary proof",
        type: "doc",
        url: formData.get("proofUrl"),
      },
    ],
  };

  const response = await api.post("/campaigns", payload);
  if (!response.ok) {
    setFeedback(elements.campaignFormResult, `创建失败: HTTP ${response.status}`, "error");
    return;
  }

  const { campaign, policyCheck } = response.body;
  state.selectedCampaignId = campaign.campaignId;
  setFeedback(elements.campaignFormResult, `已创建 ${campaign.campaignId}，状态 ${campaign.status}，policy=${policyCheck.decision}`, "success");
  await loadState();
});

elements.opportunityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const payload = {
    intentId: formData.get("intentId"),
    category: formData.get("category"),
    taskType: formData.get("taskType"),
    constraints: {
      geo: [formData.get("geo")],
    },
    placement: "shortlist",
    relevanceFloor: 0.72,
    utilityFloor: 0.68,
    sponsoredSlots: Number(formData.get("sponsoredSlots")),
    disclosureRequired: formData.get("disclosureRequired") === "true",
  };

  const response = await api.post("/opportunities/evaluate", payload);
  if (!response.ok) {
    setFeedback(elements.opportunityResult, `评估失败: HTTP ${response.status}`, "error");
    return;
  }

  renderShortlist(response.body);
  setFeedback(elements.opportunityResult, `返回 ${response.body.shortlisted.length} 个 shortlist 候选，eligible=${response.body.eligibleCandidates}`, "success");
});

elements.processRetryQueue.addEventListener("click", async () => {
  const response = await api.post("/settlements/retry-queue/process", { limit: 20 });
  if (!response.ok) {
    setFeedback(elements.retryQueueResult, `处理失败: HTTP ${response.status}`, "error");
    return;
  }
  setFeedback(elements.retryQueueResult, `processed=${response.body.processedCount} settled=${response.body.settledCount} retried=${response.body.rescheduledCount} failed=${response.body.failedCount}`, "success");
  await loadState();
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const selectCampaign = target.closest("[data-select-campaign]");
  const selectPartner = target.closest("[data-select-partner]");
  const selectSettlement = target.closest("[data-select-settlement]");
  const selectAudit = target.closest("[data-select-audit]");
  const campaignCheck = target.closest("[data-campaign-check]");
  const settlementCheck = target.closest("[data-settlement-check]");
  const auditCheck = target.closest("[data-audit-check]");

  if (selectCampaign) {
    state.selectedCampaignId = selectCampaign.dataset.selectCampaign;
    renderCampaignTable();
    return;
  }
  if (selectPartner) {
    state.selectedPartnerId = selectPartner.dataset.selectPartner;
    renderPartnerTable();
    return;
  }
  if (selectSettlement) {
    state.selectedSettlementId = selectSettlement.dataset.selectSettlement;
    renderQueueTable();
    return;
  }
  if (selectAudit) {
    state.selectedAuditEventId = selectAudit.dataset.selectAudit;
    renderAuditTable();
    return;
  }
  if (campaignCheck) {
    campaignCheck.checked ? state.selectedCampaignIds.add(campaignCheck.dataset.campaignCheck) : state.selectedCampaignIds.delete(campaignCheck.dataset.campaignCheck);
    renderCampaignTable();
    return;
  }
  if (settlementCheck) {
    settlementCheck.checked ? state.selectedSettlementIds.add(settlementCheck.dataset.settlementCheck) : state.selectedSettlementIds.delete(settlementCheck.dataset.settlementCheck);
    renderQueueTable();
    return;
  }
  if (auditCheck) {
    auditCheck.checked ? state.selectedAuditEventIds.add(auditCheck.dataset.auditCheck) : state.selectedAuditEventIds.delete(auditCheck.dataset.auditCheck);
    renderAuditTable();
    return;
  }

  const actionButton = target.closest("button[data-action]");
  if (!actionButton) return;

  if (actionButton.dataset.action === "receipt") {
    const response = await api.post("/events/receipts", {
      receiptId: actionButton.dataset.receiptId,
      eventId: actionButton.dataset.receiptId,
      specVersion: "1.0",
      dataProvenance: appConfig.mode === "real_test" ? "real_event" : "demo_bootstrap",
      traceId: actionButton.dataset.intentId,
      opportunityId: actionButton.dataset.intentId,
      intentId: actionButton.dataset.intentId,
      offerId: actionButton.dataset.offerId,
      campaignId: actionButton.dataset.campaignId,
      buyerAgentId: actionButton.dataset.partnerId,
      partnerId: actionButton.dataset.partnerId,
      producerAgentId: actionButton.dataset.partnerId,
      sellerAgentId: "promotion-agent",
      environment: appConfig.mode === "demo" ? "staging" : "test",
      eventType: "offer.presented",
      occurredAt: new Date().toISOString(),
      signature: "sig_ui_demo",
      payload: {
        placement: "shortlist",
        disclosureShown: true,
      },
    });
    const settlement = response.body.settlement;
    setFeedback(
      elements.opportunityResult,
      response.body.deduplicated
        ? "回执命中幂等键，未重复写入。"
        : settlement
          ? `已创建 settlement ${settlement.settlementId}，金额 ${currency.format(settlement.amount)}`
          : "回执已记录，但当前计费模型不会在该事件结算。",
      response.body.deduplicated ? "info" : settlement ? "success" : "info",
    );
    await loadState();
    return;
  }

  if (actionButton.dataset.action === "dispute-settlement") {
    const response = await api.post(`/settlements/${actionButton.dataset.settlementId}/dispute`, {});
    if (!response.ok) {
      setFeedback(elements.queueBatchFeedback, `Dispute 失败: HTTP ${response.status}`, "error");
      return;
    }
    setFeedback(elements.queueBatchFeedback, `Settlement ${actionButton.dataset.settlementId} 已标记为 disputed。`, "success");
    await loadState();
    return;
  }

  if (actionButton.dataset.campaignId) {
    const response = await api.post(`/campaigns/${actionButton.dataset.campaignId}/${actionButton.dataset.action}`, {});
    if (!response.ok && response.status !== 409) {
      setFeedback(elements.campaignFormResult, `${actionButton.dataset.action} 失败: HTTP ${response.status}`, "error");
      return;
    }
    state.selectedCampaignId = actionButton.dataset.campaignId;
    setFeedback(elements.campaignFormResult, `Campaign ${actionButton.dataset.campaignId} 已执行 ${actionButton.dataset.action}。`, "success");
    await loadState();
  }
});

if (appConfig.mode === "real_test") {
  for (const fieldName of ["advertiser", "productName", "category", "region", "description", "claim", "disclosureText", "actionEndpoint", "proofUrl", "payoutAmount", "budget", "price"]) {
    const input = elements.campaignForm?.querySelector(`[name="${fieldName}"]`);
    if (input) input.value = "";
  }
  const billingModel = elements.campaignForm?.querySelector('[name="billingModel"]');
  if (billingModel) billingModel.value = "";
}

loadState().catch((error) => {
  console.error(error);
  elements.healthText.textContent = "Unavailable";
  elements.healthDot.classList.add("down");
});

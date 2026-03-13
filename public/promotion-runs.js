const form = document.querySelector("#promotionRunForm");
const body = document.querySelector("#promotionRunBody");
const detail = document.querySelector("#promotionRunDetail");
const feedback = document.querySelector("#promotionRunFeedback");
const shortlistResult = document.querySelector("#promotionShortlistResult");
const funnel = document.querySelector("#promotionRunFunnel");
const deliveryMetricsGrid = document.querySelector("#deliveryMetricsGrid");
const deliveryFailureBreakdown = document.querySelector("#deliveryFailureBreakdown");
const deliveryCooldownList = document.querySelector("#deliveryCooldownList");
const dispatchRunButton = document.querySelector("#dispatchRun");
const generateShortlistButton = document.querySelector("#generateShortlist");
const simulateShortlistedAll = document.querySelector("#simulateShortlistedAll");
const simulatePresentedAll = document.querySelector("#simulatePresentedAll");
const simulateViewedAll = document.querySelector("#simulateViewedAll");
const simulateInteractedAll = document.querySelector("#simulateInteractedAll");
const simulateConversionAll = document.querySelector("#simulateConversionAll");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };
const workspaceId =
  appConfig.mode === "demo"
    ? "workspace_demo"
    : appConfig.mode === "real_test"
      ? "workspace_real_test"
      : "workspace_default";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const badge = (value, label = value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(label)}</span>`;
const detailSection = (title, value) =>
  `<section class="detail-section"><p class="detail-section-title">${escapeHtml(title)}</p><div class="detail-section-value">${value}</div></section>`;

const apiGet = async (path) => {
  const response = await fetch(path);
  return response.json();
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json(),
  };
};

const canonicalEventTypeFor = (eventType) => {
  switch (eventType) {
    case "shortlisted":
      return "offer.shortlisted";
    case "presented":
      return "offer.presented";
    case "viewed":
      return "owner.viewed";
    case "interacted":
      return "owner.interacted";
    case "conversion":
      return "conversion.attributed";
    default:
      return eventType;
  }
};

const buildReceiptPayload = ({ eventType, promotionRunId, intentId, offerId, campaignId, partnerId }) => {
  const canonicalEventType = canonicalEventTypeFor(eventType);
  const receiptId = receiptIdFor({
    promotionRunId,
    eventType: canonicalEventType,
    campaignId,
    partnerId,
    intentId,
  });
  return {
    receiptId,
    eventId: receiptId,
    specVersion: "1.0",
    dataProvenance: appConfig.mode === "real_test" ? "real_event" : "demo_bootstrap",
    promotionRunId,
    traceId: intentId,
    opportunityId: intentId,
    intentId,
    offerId,
    campaignId,
    buyerAgentId: partnerId,
    partnerId,
    producerAgentId: partnerId,
    sellerAgentId: "promotion-agent",
    deliveryId: promotionRunId,
    environment: appConfig.mode === "demo" ? "staging" : "test",
    eventType: canonicalEventType,
    occurredAt: new Date().toISOString(),
    signature: appConfig.mode === "real_test" ? `ui_${canonicalEventType}` : "sig_demo",
    payload: {
      placement: "shortlist",
      ownerSessionRef: `owner_${intentId}`,
      interactionType:
        canonicalEventType === "owner.viewed"
          ? "view"
          : canonicalEventType === "owner.interacted"
            ? "click"
            : canonicalEventType === "conversion.attributed"
              ? "conversion"
              : null,
      actionId:
        canonicalEventType === "owner.interacted" || canonicalEventType === "conversion.attributed"
          ? `action_${offerId}`
          : null,
    },
  };
};

const receiptIdFor = ({ promotionRunId, eventType, campaignId, partnerId, intentId }) =>
  `rcpt_${[promotionRunId, intentId, campaignId, partnerId, eventType].join("_").replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;

let runs = [];
let selectedId = null;
let latestShortlist = null;
let selectedTargets = [];
let deliveryMetrics = null;

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
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const selectedRun = () => runs.find((run) => run.promotionRunId === selectedId) ?? runs[0] ?? null;

const renderDeliveryMetrics = () => {
  if (!deliveryMetrics) {
    deliveryMetricsGrid.innerHTML = "";
    deliveryFailureBreakdown.innerHTML = `<div class="empty-state">暂无 delivery metrics。</div>`;
    deliveryCooldownList.innerHTML = `<div class="empty-state">暂无 cooldown 或 retry 中的 buyer agents。</div>`;
    return;
  }

  deliveryMetricsGrid.innerHTML = [
    ["Dispatch Success Rate", `${(deliveryMetrics.dispatchSuccessRate * 100).toFixed(1)}%`, "拿到有效响应的 dispatch 占比"],
    ["Acceptance Rate", `${(deliveryMetrics.acceptanceRate * 100).toFixed(1)}%`, "被 buyer agent 接收的 dispatch 占比"],
    ["Dispatch Attempts", deliveryMetrics.dispatchAttempts, "累计真实投递尝试次数"],
    ["Accepted Targets", deliveryMetrics.acceptedTargets, "当前被接收的 buyer agents 数"],
  ]
    .map(
      ([label, value, note]) => `
        <article class="list-card">
          <strong>${escapeHtml(label)}</strong>
          <div class="status-stat">${escapeHtml(value)}</div>
          <p class="meta-row">${escapeHtml(note)}</p>
        </article>
      `,
    )
    .join("");

  const failureEntries = Object.entries(deliveryMetrics.failureReasonBreakdown ?? {}).sort((left, right) => right[1] - left[1]);
  deliveryFailureBreakdown.innerHTML = failureEntries.length
    ? failureEntries
        .map(
          ([reason, count]) => `
            <article class="list-card">
              <div class="list-card-header">
                <h3 class="card-title">${escapeHtml(reason)}</h3>
                ${badge("failed", `${count}`)}
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">当前没有失败原因堆积。</div>`;

  deliveryCooldownList.innerHTML = deliveryMetrics.cooldownAgents.length
    ? deliveryMetrics.cooldownAgents
        .map(
          (agent) => `
            <article class="list-card">
              <div class="list-card-header">
                <div>
                  <h3 class="card-title">${escapeHtml(agent.providerOrg)}</h3>
                  <p class="card-subtitle">${escapeHtml(agent.partnerId)}</p>
                </div>
                ${badge(agent.status)}
              </div>
              <div class="meta-row">Attempts ${agent.dispatchAttempts} · Retry ${escapeHtml(agent.nextRetryAt ?? "n/a")}</div>
              <div class="meta-row">${escapeHtml(agent.lastError ?? "n/a")}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">当前没有 cooldown 或 retry 中的 buyer agents。</div>`;
};

const renderShortlist = () => {
  if (!latestShortlist?.shortlisted?.length) {
    shortlistResult.innerHTML = `<div class="empty-state">先 dispatch run，再基于 accepted buyer agents 生成 shortlist。</div>`;
    return;
  }

  const run = selectedRun();
  shortlistResult.innerHTML = latestShortlist.shortlisted
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
              ${run ? badge(run.planId) : ""}
            </div>
          </div>
          <div class="shortlist-grid">
            <div class="shortlist-metric"><span>Relevance</span><strong>${item.relevance.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Utility</span><strong>${item.expectedUtility.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Trust</span><strong>${item.trustScore.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Bid</span><strong>${item.bidValue.toFixed(2)}</strong></div>
          </div>
          <p class="meta-row">Disclosure: ${escapeHtml(item.disclosureText)}</p>
          <div class="card-actions">
            <a class="button button-subtle" href="${escapeHtml(item.actionEndpoints[0])}" target="_blank" rel="noreferrer">Open Link</a>
            <button class="button button-subtle" data-receipt-event="shortlisted" data-promotion-run-id="${escapeHtml(latestShortlist.promotionRunId)}" data-intent-id="${escapeHtml(latestShortlist.intentId)}" data-offer-id="${escapeHtml(item.offerId)}" data-campaign-id="${escapeHtml(item.campaignId)}" data-partner-id="${escapeHtml(item.partnerId)}">Shortlisted</button>
            <button class="button button-subtle" data-receipt-event="presented" data-promotion-run-id="${escapeHtml(latestShortlist.promotionRunId)}" data-intent-id="${escapeHtml(latestShortlist.intentId)}" data-offer-id="${escapeHtml(item.offerId)}" data-campaign-id="${escapeHtml(item.campaignId)}" data-partner-id="${escapeHtml(item.partnerId)}">Presented</button>
            <button class="button button-subtle" data-receipt-event="viewed" data-promotion-run-id="${escapeHtml(latestShortlist.promotionRunId)}" data-intent-id="${escapeHtml(latestShortlist.intentId)}" data-offer-id="${escapeHtml(item.offerId)}" data-campaign-id="${escapeHtml(item.campaignId)}" data-partner-id="${escapeHtml(item.partnerId)}">Viewed</button>
            <button class="button button-subtle" data-receipt-event="interacted" data-promotion-run-id="${escapeHtml(latestShortlist.promotionRunId)}" data-intent-id="${escapeHtml(latestShortlist.intentId)}" data-offer-id="${escapeHtml(item.offerId)}" data-campaign-id="${escapeHtml(item.campaignId)}" data-partner-id="${escapeHtml(item.partnerId)}">Interacted</button>
            <button class="button button-primary" data-receipt-event="conversion" data-promotion-run-id="${escapeHtml(latestShortlist.promotionRunId)}" data-intent-id="${escapeHtml(latestShortlist.intentId)}" data-offer-id="${escapeHtml(item.offerId)}" data-campaign-id="${escapeHtml(item.campaignId)}" data-partner-id="${escapeHtml(item.partnerId)}">Converted</button>
          </div>
        </article>
      `,
    )
    .join("");
};

const renderFunnel = () => {
  const run = selectedRun();
  if (!run) {
    funnel.innerHTML = "";
    return;
  }

  funnel.innerHTML = [
    ["Qualified Buyers", run.qualifiedBuyerAgentsCount],
    ["Accepted", run.acceptedBuyerAgentsCount],
    ["Failed", run.failedBuyerAgentsCount],
    ["Shortlisted", run.shortlistedCount],
    ["Conversion", run.conversionCount],
  ]
    .map(
      ([label, value]) => `
        <article class="status-block">
          <div class="status-title"><strong>${escapeHtml(label)}</strong></div>
          <div class="status-stat">${escapeHtml(value)}</div>
        </article>
      `,
    )
    .join("");
};

const renderTargets = () => {
  if (!selectedTargets.length) {
    return `<div class="empty-state">当前 run 还没有 dispatch target。</div>`;
  }

  return `
    <div class="stack">
      ${selectedTargets
        .map(
          (target) => `
            <article class="list-card">
              <div class="list-card-header">
                <div>
                  <h3 class="card-title">${escapeHtml(target.providerOrg)}</h3>
                  <p class="card-subtitle">${escapeHtml(target.partnerId)} · ${escapeHtml(target.endpointUrl)}</p>
                </div>
                <div class="badge-row">
                  ${badge(target.status)}
                  ${badge(target.buyerAgentTier, `tier ${target.buyerAgentTier}`)}
                </div>
              </div>
              <div class="meta-row">Score ${target.buyerAgentScore.toFixed(2)} · Delivery ${target.deliveryReadinessScore.toFixed(2)} · Attempts ${target.dispatchAttempts}</div>
              <div class="meta-row">Protocol ${escapeHtml(target.protocol ?? "n/a")} · Code ${escapeHtml(target.responseCode ?? "n/a")}</div>
              <div class="meta-row">Retry ${escapeHtml(target.nextRetryAt ?? "n/a")} · Request ${escapeHtml(target.remoteRequestId ?? "n/a")}</div>
              <div class="meta-row">${escapeHtml(target.lastError ?? "dispatch_ready")}</div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
};

const render = () => {
  if (!selectedId && runs.length) selectedId = runs[0].promotionRunId;
  body.innerHTML = runs
    .map(
      (run) => `
        <tr class="${run.promotionRunId === selectedId ? "is-selected" : ""}">
          <td><button class="row-button" data-run="${escapeHtml(run.promotionRunId)}"><strong>${escapeHtml(run.promotionRunId)}</strong><div class="meta-row">${escapeHtml(run.campaignId)}</div></button></td>
          <td>${badge(run.status)}</td>
          <td>${escapeHtml(run.planId)}</td>
          <td>${run.acceptedBuyerAgentsCount}/${run.qualifiedBuyerAgentsCount}</td>
          <td>${run.coverageCreditsCharged}</td>
        </tr>
      `,
    )
    .join("");

  const run = selectedRun();
  detail.innerHTML = run
    ? `
      ${detailSection("Summary", `<h3 class="panel-title">${escapeHtml(run.promotionRunId)}</h3><p class="meta-row">${badge(run.status)} ${badge(run.planId)}</p>`)}
      ${detailSection("Coverage", `<p class="meta-row">Qualified buyer agents: ${run.qualifiedBuyerAgentsCount}</p><p class="meta-row">Accepted buyer agents: ${run.acceptedBuyerAgentsCount}</p><p class="meta-row">Failed buyer agents: ${run.failedBuyerAgentsCount}</p><p class="meta-row">Coverage credits: ${run.coverageCreditsCharged}</p>`)}
      ${detailSection("Targets", renderTargets())}
      ${detailSection("Outcomes", `<p class="meta-row">Shortlisted: ${run.shortlistedCount}</p><p class="meta-row">Interacted: ${run.handoffCount}</p><p class="meta-row">Converted: ${run.conversionCount}</p>`)}
    `
    : `<div class="empty-state">没有 promotion run。</div>`;

  const runExists = Boolean(run);
  dispatchRunButton.disabled =
    !runExists ||
    !selectedTargets.some((target) =>
      ["queued", "retry_scheduled", "cooldown"].includes(target.status),
    );
  generateShortlistButton.disabled = !runExists || run.acceptedBuyerAgentsCount === 0;
  renderFunnel();
  renderDeliveryMetrics();
  renderShortlist();
};

const load = async () => {
  decorateEnvironment();
  const [loadedRuns, metrics] = await Promise.all([
    apiGet(`/promotion-runs?workspaceId=${encodeURIComponent(workspaceId)}`),
    apiGet(`/delivery/metrics?workspaceId=${encodeURIComponent(workspaceId)}`),
  ]);
  runs = loadedRuns;
  deliveryMetrics = metrics;
  const run = selectedRun();
  selectedTargets = run ? await apiGet(`/promotion-runs/${encodeURIComponent(run.promotionRunId)}/targets`) : [];
  render();
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const runResponse = await apiPost("/promotion-runs", {
    workspaceId,
    campaignId: data.get("campaignId"),
    category: data.get("category"),
    taskType: data.get("taskType"),
    geo: String(data.get("geo") || "").trim() ? [String(data.get("geo")).trim()] : [],
  });
  if (!runResponse.ok) {
    feedback.textContent = `Promotion run failed: HTTP ${runResponse.status}`;
    return;
  }

  selectedId = runResponse.body.promotionRunId;
  latestShortlist = null;
  feedback.textContent = `Promotion run created. ${runResponse.body.qualifiedBuyerAgentsCount} buyer agents queued for dispatch.`;
  await load();
});

dispatchRunButton.addEventListener("click", async () => {
  const run = selectedRun();
  if (!run) {
    feedback.textContent = "No run selected.";
    return;
  }

  const response = await apiPost(`/promotion-runs/${encodeURIComponent(run.promotionRunId)}/dispatch`, {});
  if (!response.ok) {
    feedback.textContent = `Dispatch failed: HTTP ${response.status}`;
    return;
  }

  feedback.textContent = `Dispatch completed. Accepted ${response.body.run.acceptedBuyerAgentsCount}, failed ${response.body.run.failedBuyerAgentsCount}.`;
  await load();
});

generateShortlistButton.addEventListener("click", async () => {
  const run = selectedRun();
  if (!run) {
    feedback.textContent = "No run selected.";
    return;
  }
  if (run.acceptedBuyerAgentsCount === 0) {
    feedback.textContent = "Dispatch first. There are no accepted buyer agents yet.";
    return;
  }

  const shortlistResponse = await apiPost("/opportunities/evaluate", {
    workspaceId,
    promotionRunId: run.promotionRunId,
    intentId: `intent_${run.promotionRunId}`,
    category: run.requestedCategory,
    taskType: run.taskType,
    constraints: run.constraints,
    placement: "shortlist",
    relevanceFloor: 0.72,
    utilityFloor: 0.68,
    sponsoredSlots: Math.max(1, run.acceptedBuyerAgentsCount),
    disclosureRequired: true,
  });

  latestShortlist = shortlistResponse.ok
    ? {
        ...shortlistResponse.body,
        promotionRunId: run.promotionRunId,
      }
    : null;
  feedback.textContent = shortlistResponse.ok
    ? `Shortlist generated for ${shortlistResponse.body.shortlisted.length} accepted buyer agents.`
    : `Shortlist failed: HTTP ${shortlistResponse.status}`;
  render();
});

document.addEventListener("click", async (event) => {
  const runButton = event.target.closest("[data-run]");
  if (runButton) {
    selectedId = runButton.dataset.run;
    latestShortlist = null;
    await load();
    return;
  }

  const receiptButton = event.target.closest("[data-receipt-event]");
  if (!receiptButton) return;

  const eventType = receiptButton.dataset.receiptEvent;
  const response = await apiPost("/events/receipts", buildReceiptPayload({
    eventType,
    promotionRunId: receiptButton.dataset.promotionRunId,
    intentId: receiptButton.dataset.intentId,
    offerId: receiptButton.dataset.offerId,
    campaignId: receiptButton.dataset.campaignId,
    partnerId: receiptButton.dataset.partnerId,
  }));
  feedback.textContent = response.ok ? `${eventType} receipt recorded.` : `Receipt failed: HTTP ${response.status}`;
  await load();
});

const batchReceipt = async (eventType) => {
  if (!latestShortlist?.shortlisted?.length) {
    feedback.textContent = "No shortlist available.";
    return;
  }
  for (const item of latestShortlist.shortlisted) {
    await apiPost("/events/receipts", buildReceiptPayload({
      eventType,
      promotionRunId: latestShortlist.promotionRunId,
      intentId: latestShortlist.intentId,
      offerId: item.offerId,
      campaignId: item.campaignId,
      partnerId: item.partnerId,
    }));
  }
  feedback.textContent = `${eventType} receipts recorded for all shortlisted buyer agents.`;
  await load();
};

simulateShortlistedAll.addEventListener("click", async () => batchReceipt("shortlisted"));
simulatePresentedAll.addEventListener("click", async () => batchReceipt("presented"));
simulateViewedAll.addEventListener("click", async () => batchReceipt("viewed"));
simulateInteractedAll.addEventListener("click", async () => batchReceipt("interacted"));
simulateConversionAll.addEventListener("click", async () => batchReceipt("conversion"));

load().catch(console.error);

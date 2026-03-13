const filterForm = document.querySelector("#measurementFilters");
const funnelGrid = document.querySelector("#funnelGrid");
const attributionBody = document.querySelector("#attributionBody");
const attributionDetail = document.querySelector("#measurementDetail");
const billingDraftBody = document.querySelector("#billingDraftBody");
const billingDraftDetail = document.querySelector("#billingDraftDetail");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };

const state = {
  selectedAttributionKey: null,
  selectedDraftKey: null,
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const api = {
  get: (path) => fetch(path).then((response) => response.json()),
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(value)}</span>`;

const detailSection = (title, value) => `
  <section class="detail-section">
    <p class="detail-section-title">${escapeHtml(title)}</p>
    <div class="detail-section-value">${value}</div>
  </section>
`;

const decorateEnvironment = () => {
  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle && !subtitle.querySelector("[data-environment-badge]")) {
    const label = appConfig.mode === "demo" ? "Demo Environment" : appConfig.mode === "real_test" ? "Real Test Environment" : "Default Environment";
    const tone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const runtime = {
  funnel: null,
  attribution: [],
  drafts: [],
};

const renderFunnel = (funnel) => {
  funnelGrid.innerHTML = [
    ["Shortlisted", funnel.shortlisted],
    ["Presented", funnel.presented],
    ["Viewed", funnel.detailView],
    ["Interacted", funnel.handoff],
    ["Converted", funnel.conversion],
    ["Viewed Rate", `${(funnel.detailViewRate * 100).toFixed(1)}%`],
    ["Interaction Rate", `${(funnel.handoffRate * 100).toFixed(1)}%`],
    ["Conversion Rate", `${(funnel.actionConversionRate * 100).toFixed(1)}%`],
  ]
    .map(([label, value]) => `<article class="list-card"><strong>${escapeHtml(label)}</strong><div class="status-stat">${escapeHtml(value)}</div></article>`)
    .join("");
};

const renderAttribution = () => {
  if (!state.selectedAttributionKey && runtime.attribution.length) {
    state.selectedAttributionKey = `${runtime.attribution[0].campaignId}:${runtime.attribution[0].partnerId ?? "-"}`;
  }

  attributionBody.innerHTML = runtime.attribution
    .map((row) => {
      const key = `${row.campaignId}:${row.partnerId ?? "-"}`;
      return `
        <tr class="${key === state.selectedAttributionKey ? "is-selected" : ""}">
          <td><button class="row-button" data-select-attribution="${escapeHtml(key)}"><strong>${escapeHtml(row.campaignId)}</strong></button></td>
          <td>${escapeHtml(row.partnerId ?? "-")}</td>
          <td>${escapeHtml(row.billingModel)}</td>
          <td>${row.billableEvents}</td>
          <td>${currency.format(row.billedAmount)}</td>
        </tr>
      `;
    })
    .join("");

  const selected = runtime.attribution.find((row) => `${row.campaignId}:${row.partnerId ?? "-"}` === state.selectedAttributionKey) ?? runtime.attribution[0];
  if (!selected) {
    attributionDetail.innerHTML = `<div class="empty-state">没有 attribution 数据。</div>`;
    return;
  }

  attributionDetail.innerHTML = `
    ${detailSection("Selected Attribution", `
      <h3 class="panel-title">${escapeHtml(selected.campaignId)}</h3>
      <p class="meta-row">${badge(selected.billingModel)} ${escapeHtml(selected.partnerId ?? "-")}</p>
    `)}
    ${detailSection("Performance", `
      <p class="meta-row">Shortlisted: ${selected.shortlisted}</p>
      <p class="meta-row">Presented billable events: ${selected.billableEvents}</p>
      <p class="meta-row">Conversions: ${selected.conversions}</p>
      <p class="meta-row">Billed Amount: ${currency.format(selected.billedAmount)}</p>
    `)}
    ${detailSection("Context", `
      <p class="meta-row">Funnel presented: ${runtime.funnel.presented}</p>
      <p class="meta-row">Action conversion rate: ${(runtime.funnel.actionConversionRate * 100).toFixed(1)}%</p>
    `)}
  `;
};

const renderBillingDrafts = () => {
  if (!state.selectedDraftKey && runtime.drafts.length) {
    state.selectedDraftKey = `${runtime.drafts[0].campaignId}:${runtime.drafts[0].partnerId ?? "-"}`;
  }

  billingDraftBody.innerHTML = runtime.drafts
    .map((row) => {
      const key = `${row.campaignId}:${row.partnerId ?? "-"}`;
      return `
        <tr class="${key === state.selectedDraftKey ? "is-selected" : ""}">
          <td><button class="row-button" data-select-draft="${escapeHtml(key)}"><strong>${escapeHtml(row.campaignId)}</strong></button></td>
          <td>${escapeHtml(row.billingModel)}</td>
          <td>${row.pendingSettlements}</td>
          <td>${row.settledSettlements}</td>
          <td>${row.failedSettlements}</td>
          <td>${currency.format(row.totalAmount)}</td>
        </tr>
      `;
    })
    .join("");

  const selected = runtime.drafts.find((row) => `${row.campaignId}:${row.partnerId ?? "-"}` === state.selectedDraftKey) ?? runtime.drafts[0];
  if (!selected) {
    billingDraftDetail.innerHTML = `<div class="empty-state">没有 billing draft。</div>`;
    return;
  }

  billingDraftDetail.innerHTML = `
    ${detailSection("Draft Summary", `
      <h3 class="panel-title">${escapeHtml(selected.campaignId)}</h3>
      <p class="meta-row">${badge(selected.billingModel)} ${escapeHtml(selected.partnerId ?? "-")}</p>
    `)}
    ${detailSection("Settlement Mix", `
      <p class="meta-row">Pending: ${selected.pendingSettlements}</p>
      <p class="meta-row">Settled: ${selected.settledSettlements}</p>
      <p class="meta-row">Failed: ${selected.failedSettlements}</p>
    `)}
    ${detailSection("Amount", `<p class="meta-row">${currency.format(selected.totalAmount)}</p>`)}
  `;
};

const render = () => {
  if (!runtime.funnel) return;
  renderFunnel(runtime.funnel);
  renderAttribution();
  renderBillingDrafts();
};

const load = async () => {
  decorateEnvironment();
  const data = new FormData(filterForm);
  const query = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (!String(value).trim()) continue;
    if (key === "dateFrom") query.set(key, `${value}T00:00:00.000Z`);
    else if (key === "dateTo") query.set(key, `${value}T23:59:59.999Z`);
    else query.set(key, String(value));
  }
  const [funnel, attribution, drafts] = await Promise.all([
    api.get(`/measurements/funnel?${query.toString()}`),
    api.get(`/measurements/attribution?${query.toString()}`),
    api.get("/billing/drafts"),
  ]);
  runtime.funnel = funnel;
  runtime.attribution = attribution;
  runtime.drafts = drafts;
  render();
};

filterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

document.addEventListener("click", (event) => {
  const attributionButton = event.target.closest("[data-select-attribution]");
  const draftButton = event.target.closest("[data-select-draft]");
  if (attributionButton) {
    state.selectedAttributionKey = attributionButton.dataset.selectAttribution;
    render();
  }
  if (draftButton) {
    state.selectedDraftKey = draftButton.dataset.selectDraft;
    render();
  }
});

load().catch((error) => console.error(error));

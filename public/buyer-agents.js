import { buildEvidenceDrilldownMarkup, createSourceContext } from "./drilldown-links.js";

const body = document.querySelector("#buyerAgentBody");
const detail = document.querySelector("#buyerAgentDetail");
const filters = document.querySelector("#buyerAgentFilters");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };
const pageParams = new URLSearchParams(window.location.search);

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const badge = (value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(value)}</span>`;
const detailSection = (title, value) => `<section class="detail-section"><p class="detail-section-title">${escapeHtml(title)}</p><div class="detail-section-value">${value}</div></section>`;
const observationStatus = (item) =>
  item.isCommerciallyEligible ? "eligible" : (!item.supportsDeliveryReceipt || !item.supportsPresentationReceipt ? "observation" : "blocked");

let selectedId = null;
let scorecards = [];

const decorateEnvironment = () => {
  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle && !subtitle.querySelector("[data-environment-badge]")) {
    const label = appConfig.mode === "demo" ? "Demo Environment" : appConfig.mode === "real_test" ? "Real Test Environment" : "Default Environment";
    const tone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const render = () => {
  const requestedScorecardId = pageParams.get("scorecardId");
  if (requestedScorecardId && scorecards.some((item) => item.scorecardId === requestedScorecardId)) {
    selectedId = requestedScorecardId;
  }
  if (!selectedId && scorecards.length) selectedId = scorecards[0].scorecardId;
  body.innerHTML = scorecards.map((item) => `
    <tr class="${item.scorecardId === selectedId ? "is-selected" : ""}">
      <td><button class="row-button" data-scorecard="${escapeHtml(item.scorecardId)}"><strong>${escapeHtml(item.providerOrg)}</strong><div class="meta-row">${escapeHtml(item.dataProvenance)}</div></button></td>
      <td>${badge(item.buyerAgentTier)}</td>
      <td>${item.buyerAgentScore.toFixed(2)}</td>
      <td>${observationStatus(item) === "eligible" ? badge("active", "eligible") : observationStatus(item) === "observation" ? badge("reviewing", "observation") : badge("rejected", "blocked")}</td>
      <td>${escapeHtml(item.buyerIntentCoverage.join(", "))}</td>
    </tr>
  `).join("");
  const selected = scorecards.find((item) => item.scorecardId === selectedId) ?? scorecards[0];
  detail.innerHTML = selected ? `
    ${detailSection("Summary", `<h3 class="panel-title">${escapeHtml(selected.providerOrg)}</h3><p class="meta-row">${badge(selected.buyerAgentTier)} ${badge(selected.dataProvenance)}</p>`)}
    ${detailSection("Scores", `<p class="meta-row">buyerAgentScore ${selected.buyerAgentScore.toFixed(2)}</p><p class="meta-row">ICP ${selected.icpOverlapScore.toFixed(2)} · Intent ${selected.intentAccessScore.toFixed(2)} · Delivery ${selected.deliveryReadinessScore.toFixed(2)}</p><p class="meta-row">History ${selected.historicalQualityScore.toFixed(2)} · Commercial ${selected.commercialReadinessScore.toFixed(2)}</p>`)}
    ${detailSection("Eligibility", `<p class="meta-row">Qualified: ${selected.isQualifiedBuyerAgent}</p><p class="meta-row">Commercially eligible: ${selected.isCommerciallyEligible}</p><p class="meta-row">Promotion list: ${escapeHtml(observationStatus(selected))}</p><p class="meta-row">Delivery Receipt: ${selected.supportsDeliveryReceipt ? "yes" : "no"} · Presentation Receipt: ${selected.supportsPresentationReceipt ? "yes" : "no"}</p><p class="meta-row">Last Verified: ${escapeHtml(selected.lastVerifiedAt ? new Date(selected.lastVerifiedAt).toLocaleString() : "never")}</p><p class="meta-row">Verification Owner: ${escapeHtml(selected.verificationOwner ?? "unassigned")}</p><p class="meta-row">Coverage: ${escapeHtml(selected.buyerIntentCoverage.join(", "))}</p>${buildEvidenceDrilldownMarkup(selected.evidenceRef, createSourceContext({ href: `/buyer-agents?scorecardId=${encodeURIComponent(selected.scorecardId)}`, label: `${selected.providerOrg} Buyer Agent`, type: "buyer_agent_scorecard", id: selected.scorecardId }))}`)}
  ` : `<div class="empty-state">没有 buyer agent scorecard。</div>`;
};

const load = async () => {
  decorateEnvironment();
  const data = new FormData(filters);
  const query = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (String(value).trim()) query.set(key, String(value));
  }
  scorecards = await fetch(`/buyer-agents/scorecards?${query.toString()}`).then((response) => response.json());
  render();
};

filters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scorecard]");
  if (!button) return;
  selectedId = button.dataset.scorecard;
  render();
});

load().catch(console.error);

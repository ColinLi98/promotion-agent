const walletSummary = document.querySelector("#walletSummary");
const planBody = document.querySelector("#planBody");
const ledgerBreakdown = document.querySelector("#ledgerBreakdown");
const ledgerTrialBody = document.querySelector("#ledgerTrialBody");
const ledgerTopUpBody = document.querySelector("#ledgerTopUpBody");
const ledgerUsageBody = document.querySelector("#ledgerUsageBody");
const topUpForm = document.querySelector("#topUpForm");
const walletFeedback = document.querySelector("#walletFeedback");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };
const workspaceId = appConfig.mode === "demo" ? "workspace_demo" : appConfig.mode === "real_test" ? "workspace_real_test" : "workspace_default";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const decorateEnvironment = () => {
  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle && !subtitle.querySelector("[data-environment-badge]")) {
    const label = appConfig.mode === "demo" ? "Demo Environment" : appConfig.mode === "real_test" ? "Real Test Environment" : "Default Environment";
    const tone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const syncUrl = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  url.searchParams.delete("workspaceId");
  history.replaceState(null, "", url.pathname);
};

const load = async () => {
  decorateEnvironment();
  const [wallet, plans, ledger] = await Promise.all([
    fetch(`/wallet?workspaceId=${encodeURIComponent(workspaceId)}`).then((response) => response.json()),
    fetch("/plans").then((response) => response.json()),
    fetch(`/wallet/ledger?workspaceId=${encodeURIComponent(workspaceId)}`).then((response) => response.json()),
  ]);

  walletSummary.innerHTML = [
    ["Available Credits", wallet.availableCredits],
    ["Consumed Credits", wallet.consumedCredits],
    ["Reserved Credits", wallet.reservedCredits],
    ["Expired Credits", wallet.expiredCredits],
  ].map(([label, value]) => `<article class="metric-card"><p class="metric-label">${escapeHtml(label)}</p><p class="metric-value">${escapeHtml(value)}</p></article>`).join("");

  planBody.innerHTML = plans.map((plan) => `
    <tr>
      <td><strong>${escapeHtml(plan.planId)}</strong></td>
      <td>${plan.maxQualifiedBuyerAgentsPerWave}</td>
      <td>${plan.maxActiveCampaigns}</td>
      <td>${plan.maxConcurrentPromotionRuns}</td>
      <td>${plan.includedCreditsPerCycle}</td>
    </tr>
  `).join("");

  const trialEntries = ledger.filter((entry) => entry.entryType === "promo_grant" || entry.entryType === "subscription_grant");
  const topUpEntries = ledger.filter((entry) => entry.entryType === "top_up");
  const usageEntries = ledger.filter((entry) => !["promo_grant", "subscription_grant", "top_up"].includes(entry.entryType));

  const sum = (entries) => entries.reduce((acc, entry) => acc + Number(entry.amount), 0);

  ledgerBreakdown.innerHTML = [
    ["Trial Grants", sum(trialEntries)],
    ["Top-Ups", sum(topUpEntries)],
    ["Usage", sum(usageEntries)],
  ].map(([label, value]) => `<article class="metric-card"><p class="metric-label">${escapeHtml(label)}</p><p class="metric-value">${escapeHtml(value)}</p></article>`).join("");

  ledgerTrialBody.innerHTML = trialEntries.map((entry) => `
    <tr>
      <td><strong>${escapeHtml(entry.entryId)}</strong></td>
      <td>${entry.amount}</td>
      <td>${entry.balanceAfter}</td>
      <td>${new Date(entry.occurredAt).toLocaleString()}</td>
    </tr>
  `).join("");

  ledgerTopUpBody.innerHTML = topUpEntries.map((entry) => `
    <tr>
      <td><strong>${escapeHtml(entry.entryId)}</strong></td>
      <td>${entry.amount}</td>
      <td>${escapeHtml(entry.source)}</td>
      <td>${new Date(entry.occurredAt).toLocaleString()}</td>
    </tr>
  `).join("");

  ledgerUsageBody.innerHTML = usageEntries.map((entry) => `
    <tr>
      <td><strong>${escapeHtml(entry.entryId)}</strong></td>
      <td>${escapeHtml(entry.entryType)}</td>
      <td>${entry.amount}</td>
      <td>${escapeHtml(entry.source)}</td>
      <td>${new Date(entry.occurredAt).toLocaleString()}</td>
    </tr>
  `).join("");
};

const maybeConfirmCheckout = async () => {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  const sessionId = params.get("session_id");
  const currentWorkspaceId = params.get("workspaceId") ?? workspaceId;

  if (checkout === "cancelled") {
    walletFeedback.textContent = "Payment cancelled.";
    syncUrl();
    return;
  }

  if (checkout !== "success" || !sessionId) {
    return;
  }

  const response = await fetch(`/wallet/top-ups/confirm?workspaceId=${encodeURIComponent(currentWorkspaceId)}&sessionId=${encodeURIComponent(sessionId)}`);
  const body = await response.json();
  walletFeedback.textContent = response.ok
    ? `Top-up confirmed. Balance: ${body.wallet.availableCredits}`
    : body.message ?? "Top-up confirmation failed.";
  syncUrl();
};

topUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(topUpForm);
  const response = await fetch("/wallet/top-ups/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      credits: Number(data.get("credits")),
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    walletFeedback.textContent = body.message ?? "Top-up failed.";
    return;
  }
  if (body.checkoutUrl) {
    window.location.assign(body.checkoutUrl);
    return;
  }
  walletFeedback.textContent = "Top-up completed.";
  await load();
});

(async () => {
  await maybeConfirmCheckout();
  await load();
})().catch(console.error);

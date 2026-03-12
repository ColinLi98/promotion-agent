const leadId = decodeURIComponent(window.location.pathname.split("/").pop());
const leadTitle = document.querySelector("#leadTitle");
const leadSubtitle = document.querySelector("#leadSubtitle");
const leadSummary = document.querySelector("#leadSummary");
const verificationHistory = document.querySelector("#verificationHistory");
const statusForm = document.querySelector("#statusForm");
const statusFeedback = document.querySelector("#statusFeedback");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value) => `<span class="badge ${String(value).toLowerCase()}">${value}</span>`;
const api = {
  get: (path) => fetch(path).then((response) => response.json()),
  post: (path, body) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json()),
};

const renderLead = (lead) => {
  leadTitle.textContent = lead.providerOrg;
  leadSubtitle.textContent = `${lead.sourceType} · ${lead.cardUrl}`;
  leadSummary.innerHTML = `
    <article class="list-card"><strong>Status</strong><div>${badge(lead.verificationStatus)}</div><p class="meta-row">Owner: ${escapeHtml(lead.assignedOwner ?? "unassigned")}</p></article>
    <article class="list-card"><strong>Scores</strong><p class="meta-row">lead ${lead.leadScore.toFixed(2)} / reach ${lead.reachProxy.toFixed(2)} / monetization ${lead.monetizationReadiness.toFixed(2)}</p></article>
    <article class="list-card"><strong>Skills</strong><p class="meta-row">${escapeHtml(lead.skills.join(", "))}</p></article>
    <article class="list-card"><strong>Missing Fields</strong><p class="meta-row">${lead.missingFields.length ? escapeHtml(lead.missingFields.join(", ")) : "none"}</p></article>
  `;
};

const renderHistory = (items) => {
  verificationHistory.innerHTML = items
    .map(
      (item) => `
        <article class="list-card">
          <div class="list-card-header"><h3 class="card-title">${escapeHtml(item.previousStatus)} → ${escapeHtml(item.nextStatus)}</h3>${badge(item.nextStatus)}</div>
          <div class="meta-row">${escapeHtml(item.actorId)} · ${new Date(item.occurredAt).toLocaleString()}</div>
          <div class="meta-row">${escapeHtml(item.comment)}</div>
        </article>
      `,
    )
    .join("");
};

const load = async () => {
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
      identity: true,
      auth: true,
      disclosure: true,
      sla: true,
      rateLimit: true,
    },
  });
  statusFeedback.textContent = result.ok === false ? result.message : "Status updated.";
  await load();
});

load().catch((error) => {
  console.error(error);
  statusFeedback.textContent = "Load failed.";
});

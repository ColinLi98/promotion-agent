const sourceList = document.querySelector("#sourceList");
const runList = document.querySelector("#runList");
const leadTableBody = document.querySelector("#leadTableBody");
const leadDetailPanel = document.querySelector("#leadDetailPanel");
const sourceForm = document.querySelector("#sourceForm");
const leadFilters = document.querySelector("#leadFilters");
const sourceFeedback = document.querySelector("#sourceFeedback");

const state = {
  selectedLeadId: null,
};

const badge = (value) => `<span class="badge ${String(value).toLowerCase()}">${value}</span>`;
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const api = {
  get: (path) => fetch(path).then((response) => response.json()),
  post: (path, body) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json()),
};

const renderSources = (sources) => {
  sourceList.innerHTML = sources
    .map(
      (source) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(source.name)}</h3>
              <p class="card-subtitle">${escapeHtml(source.sourceType)} · ${escapeHtml(source.baseUrl)}</p>
            </div>
            <div class="badge-row">
              ${badge(source.active ? "active" : "suspended")}
              <button class="button button-subtle" data-run-source="${escapeHtml(source.sourceId)}">Run Crawl</button>
            </div>
          </div>
          <div class="meta-row">Seed URLs: ${source.seedUrls.map(escapeHtml).join(", ")}</div>
        </article>
      `,
    )
    .join("");
};

const renderRuns = (runs) => {
  runList.innerHTML = runs
    .slice(0, 6)
    .map(
      (run) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(run.runId)}</h3>
              <p class="card-subtitle">${escapeHtml(run.sourceId)} · trace ${escapeHtml(run.traceId)}</p>
            </div>
            ${badge(run.status)}
          </div>
          <div class="meta-row">discovered=${run.discoveredCount} created=${run.createdLeadCount} deduped=${run.dedupedCount} errors=${run.errorCount}</div>
        </article>
      `,
    )
    .join("");
};

const renderLeadDetail = (lead, history) => {
  if (!lead) {
    leadDetailPanel.innerHTML = `<div class="empty-state">从左侧选择一个 lead 查看详情和执行操作。</div>`;
    return;
  }

  leadDetailPanel.innerHTML = `
    <section class="detail-section">
      <p class="detail-section-title">Lead Summary</p>
      <div class="detail-section-value">
        <h3 class="panel-title">${escapeHtml(lead.providerOrg)}</h3>
        <p class="meta-row">${badge(lead.verificationStatus)} ${badge(lead.sourceType)} ${badge(lead.dataOrigin)}</p>
        <p class="meta-row">Owner: ${escapeHtml(lead.assignedOwner ?? "unassigned")}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Scoring</p>
      <div class="detail-section-value">
        <p class="meta-row">Lead ${lead.leadScore.toFixed(2)} · Reach ${lead.reachProxy.toFixed(2)} · Monetization ${lead.monetizationReadiness.toFixed(2)}</p>
        <p class="meta-row">ICP ${lead.scoreBreakdown.icpFit.toFixed(2)} · Protocol ${lead.scoreBreakdown.protocolFit.toFixed(2)} · Reach ${lead.scoreBreakdown.reachFit.toFixed(2)}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Discovery Metadata</p>
      <div class="detail-section-value">
        <p class="meta-row">Card: ${escapeHtml(lead.cardUrl)}</p>
        <p class="meta-row">Endpoint: ${escapeHtml(lead.endpointUrl ?? "missing")}</p>
        <p class="meta-row">Contact: ${escapeHtml(lead.contactRef ?? "missing")}</p>
        <p class="meta-row">Missing Fields: ${lead.missingFields.length ? escapeHtml(lead.missingFields.join(", ")) : "none"}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Quick Actions</p>
      <div class="detail-section-value">
        <div class="form-grid">
          <label>
            <span>Assign Owner</span>
            <input id="assignOwnerInput" value="${escapeHtml(lead.assignedOwner ?? "ops:alice")}" />
          </label>
          <label>
            <span>Next Status</span>
            <select id="leadStatusSelect">
              <option value="reviewing">reviewing</option>
              <option value="verified">verified</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label class="span-2">
            <span>Comment</span>
            <input id="leadStatusComment" value="Updated from Agent CRM." />
          </label>
          <div class="form-actions span-2">
            <button class="button button-subtle" data-assign-lead="${escapeHtml(lead.agentId)}">Assign</button>
            <button class="button button-primary" data-update-lead-status="${escapeHtml(lead.agentId)}">Update Status</button>
          </div>
        </div>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Verification Timeline</p>
      <div class="timeline">
        ${
          history.length
            ? history
                .map(
                  (item) => `
                    <div class="timeline-item">
                      <span class="timeline-dot"></span>
                      <div class="timeline-body">
                        <p class="timeline-title">${escapeHtml(item.previousStatus)} → ${escapeHtml(item.nextStatus)}</p>
                        <p class="timeline-meta">${escapeHtml(item.actorId)} · ${new Date(item.occurredAt).toLocaleString()}</p>
                        <p class="timeline-meta">${escapeHtml(item.comment)}</p>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state">暂无 verification history。</div>`
        }
      </div>
    </section>
  `;
};

const renderLeads = async (leads) => {
  if (!state.selectedLeadId && leads.length) {
    state.selectedLeadId = leads[0].agentId;
  }

  leadTableBody.innerHTML = leads
    .map(
      (lead) => `
        <tr class="${lead.agentId === state.selectedLeadId ? "is-selected" : ""}">
          <td>
            <button class="row-button" data-select-lead="${escapeHtml(lead.agentId)}">
              <strong>${escapeHtml(lead.providerOrg)}</strong>
              <div class="meta-row">${escapeHtml(lead.verticals.join(", "))}</div>
            </button>
          </td>
          <td>${badge(lead.dataOrigin)}</td>
          <td>${badge(lead.verificationStatus)}</td>
          <td>${escapeHtml(lead.sourceType)}</td>
          <td>
            <div class="meta-row">lead ${lead.leadScore.toFixed(2)}</div>
            <div class="meta-row">reach ${lead.reachProxy.toFixed(2)} / monetization ${lead.monetizationReadiness.toFixed(2)}</div>
          </td>
          <td>${lead.missingFields.length > 0 ? escapeHtml(lead.missingFields.join(", ")) : "none"}</td>
          <td>${escapeHtml(lead.assignedOwner ?? "unassigned")}</td>
        </tr>
      `,
    )
    .join("");

  const lead = leads.find((item) => item.agentId === state.selectedLeadId) ?? leads[0];
  if (!lead) {
    renderLeadDetail(null, []);
    return;
  }

  const history = await api.get(`/agent-leads/${encodeURIComponent(lead.agentId)}/verification-history`);
  renderLeadDetail(lead, history);
};

const load = async () => {
  const filterData = new FormData(leadFilters);
  const query = new URLSearchParams();
  for (const [key, value] of filterData.entries()) {
    if (String(value).trim()) query.set(key, String(value));
  }

  const [sources, runs, leads] = await Promise.all([
    api.get("/discovery/sources"),
    api.get("/discovery/runs"),
    api.get(`/agent-leads?${query.toString()}`),
  ]);
  if (leads.length === 0) {
    if ((query.get("dataOrigin") ?? "discovered") === "discovered") {
      sourceFeedback.textContent = "当前还没有真实 discovered leads。先运行上方真实 source crawl，或把 Data Origin 切回 seed 查看历史样例。";
    } else {
      sourceFeedback.textContent = "当前筛选条件下没有匹配结果。";
    }
  } else if (sourceFeedback.textContent.includes("当前还没有真实 discovered leads") || sourceFeedback.textContent.includes("当前筛选条件下没有匹配结果")) {
    sourceFeedback.textContent = "";
  }
  renderSources(sources);
  renderRuns(runs);
  await renderLeads(leads);
};

sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(sourceForm);
  await api.post("/discovery/sources", {
    sourceType: data.get("sourceType"),
    name: data.get("name"),
    baseUrl: data.get("baseUrl"),
    seedUrls: [data.get("seedUrl")],
    active: true,
    crawlPolicy: { rateLimit: 1, maxDepth: 1 },
    verticalHints: ["crm_software"],
    geoHints: ["UK"],
  });
  sourceFeedback.textContent = "Source created.";
  await load();
});

leadFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

leadFilters.querySelector('[name="dataOrigin"]').value = "discovered";

document.addEventListener("click", async (event) => {
  const target = event.target;
  const sourceButton = target.closest("button[data-run-source]");
  const leadButton = target.closest("[data-select-lead]");
  const assignButton = target.closest("button[data-assign-lead]");
  const statusButton = target.closest("button[data-update-lead-status]");

  if (sourceButton) {
    await api.post("/discovery/runs", { sourceId: sourceButton.dataset.runSource });
    await load();
    return;
  }

  if (leadButton) {
    state.selectedLeadId = leadButton.dataset.selectLead;
    await load();
    return;
  }

  if (assignButton) {
    await api.post(`/agent-leads/${encodeURIComponent(assignButton.dataset.assignLead)}/assign`, {
      ownerId: document.querySelector("#assignOwnerInput").value,
    });
    await load();
    return;
  }

  if (statusButton) {
    await api.post(`/agent-leads/${encodeURIComponent(statusButton.dataset.updateLeadStatus)}/status`, {
      nextStatus: document.querySelector("#leadStatusSelect").value,
      actorId: document.querySelector("#assignOwnerInput").value || "ops:alice",
      comment: document.querySelector("#leadStatusComment").value,
      checklist: {
        identity: true,
        auth: true,
        disclosure: true,
        sla: true,
        rateLimit: true,
      },
    });
    await load();
  }
});

load().catch((error) => {
  console.error(error);
  sourceFeedback.textContent = "Load failed.";
});

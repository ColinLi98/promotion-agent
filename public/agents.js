import { buildEvidenceDrilldownMarkup, createSourceContext } from "./drilldown-links.js";

const sourceList = document.querySelector("#sourceList");
const runList = document.querySelector("#runList");
const leadTableBody = document.querySelector("#leadTableBody");
const leadDetailPanel = document.querySelector("#leadDetailPanel");
const completionQueueSummary = document.querySelector("#completionQueueSummary");
const completionQueueList = document.querySelector("#completionQueueList");
const observationList = document.querySelector("#observationList");
const sourceForm = document.querySelector("#sourceForm");
const leadFilters = document.querySelector("#leadFilters");
const sourceFeedback = document.querySelector("#sourceFeedback");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? {
  mode: "default",
  realDataOnly: false,
  defaultLeadFilter: [],
};
const defaultProvenanceFilter = Array.isArray(appConfig.defaultLeadFilter)
  ? appConfig.defaultLeadFilter.join(",")
  : "";
const pageParams = new URLSearchParams(window.location.search);

const state = {
  selectedLeadId: null,
  selectedLead: null,
  leadFeedback: {
    message: "",
    tone: "info",
  },
};

const badge = (value, label = value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(label)}</span>`;
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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

const setLeadFeedback = (message, tone = "info") => {
  state.leadFeedback = { message, tone };
};

const renderFeedback = () => {
  const feedback = document.querySelector("#leadActionFeedback");
  if (!feedback) return;
  feedback.textContent = state.leadFeedback.message;
  feedback.style.color =
    state.leadFeedback.tone === "error"
      ? "var(--danger)"
      : state.leadFeedback.tone === "success"
        ? "var(--success)"
        : "var(--text-muted)";
};

const buildLeadQuery = (formData, extra = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (String(value).trim()) {
      query.set(key, String(value));
    }
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  if (defaultProvenanceFilter) {
    query.set("provenance", defaultProvenanceFilter);
  }
  return query;
};

const summarizeMissingField = (field) => {
  const normalized = String(field).toLowerCase();
  if (normalized.includes("endpoint")) return "endpoint";
  if (normalized.includes("contact")) return "contact";
  if (normalized.includes("auth")) return "auth";
  if (normalized.includes("disclosure")) return "disclosure";
  if (normalized.includes("rate")) return "rate limit";
  if (normalized.includes("sla")) return "sla";
  return field;
};

const leadObservationReasons = (lead) => {
  const reasons = [];
  if (!lead.supportsDeliveryReceipt) reasons.push("missing delivery receipt");
  if (!lead.supportsPresentationReceipt) reasons.push("missing presentation receipt");
  return reasons;
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

const renderCompletionQueue = (queueLeads) => {
  const totalMissing = queueLeads.length;
  const unassigned = queueLeads.filter((lead) => !lead.assignedOwner).length;
  const readyForVerification = queueLeads.filter((lead) => lead.missingFields.length <= 1).length;
  const topLead = queueLeads
    .slice()
    .sort((left, right) => right.leadScore - left.leadScore)[0];

  completionQueueSummary.innerHTML = [
    ["Queue Size", totalMissing, "当前在人工补全队列里的 lead 数"],
    ["Unassigned", unassigned, "还没有 owner 的补全项"],
    ["Near Ready", readyForVerification, "只差 1 个字段就能进入验证的 lead"],
    ["Top Priority", topLead ? topLead.providerOrg : "-", "按 lead score 最高的待补全线索"],
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

  completionQueueList.innerHTML = queueLeads.length
    ? queueLeads
        .slice()
        .sort((left, right) => right.leadScore - left.leadScore)
        .slice(0, 5)
        .map(
          (lead) => `
            <article class="list-card">
              <div class="list-card-header">
                <div>
                  <h3 class="card-title">${escapeHtml(lead.providerOrg)}</h3>
                  <p class="card-subtitle">${escapeHtml(lead.sourceType)} · ${badge(lead.verificationStatus)} ${badge(lead.dataProvenance)}</p>
                </div>
                <button class="button button-subtle" data-queue-lead="${escapeHtml(lead.agentId)}">打开</button>
              </div>
              <div class="meta-row">Missing: ${lead.missingFields.map(summarizeMissingField).map(escapeHtml).join(", ")}</div>
              <div class="meta-row">Owner: ${escapeHtml(lead.assignedOwner ?? "unassigned")} · Lead Score ${lead.leadScore.toFixed(2)}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">当前没有缺失字段的 lead，补全队列是空的。</div>`;
};

const renderLeadDetail = (lead, history) => {
  if (!lead) {
    state.selectedLead = null;
    leadDetailPanel.innerHTML = `<div class="empty-state">从左侧选择一个 lead 查看详情和执行操作。</div>`;
    return;
  }

  state.selectedLead = lead;
  const checklist = defaultChecklistForLead(lead);
  const receiptReady = lead.supportsDeliveryReceipt && lead.supportsPresentationReceipt;
  const canPromote = ["verified", "active"].includes(lead.verificationStatus) && Boolean(lead.endpointUrl) && receiptReady;
  const promotionBlocker = !lead.endpointUrl
    ? "缺少 endpointUrl，不能生成 PartnerAgent。"
    : !["verified", "active"].includes(lead.verificationStatus)
      ? "lead 需要先进入 verified / active 状态。"
      : !receiptReady
        ? "缺少 delivery receipt / presentation receipt 能力，只能进入观察名单。"
        : "满足晋升条件，可直接生成 partner 记录。";

  leadDetailPanel.innerHTML = `
    <section class="detail-section">
      <p class="detail-section-title">Lead Summary</p>
      <div class="detail-section-value">
        <h3 class="panel-title">${escapeHtml(lead.providerOrg)}</h3>
        <p class="meta-row">${badge(lead.verificationStatus)} ${badge(lead.sourceType)} ${badge(lead.dataOrigin)} ${badge(lead.dataProvenance)}</p>
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
        <p class="meta-row">Delivery Receipt: ${lead.supportsDeliveryReceipt ? "yes" : "no"}</p>
        <p class="meta-row">Presentation Receipt: ${lead.supportsPresentationReceipt ? "yes" : "no"}</p>
        <p class="meta-row">Last Verified: ${escapeHtml(lead.lastVerifiedAt ? new Date(lead.lastVerifiedAt).toLocaleString() : "never")}</p>
        <p class="meta-row">Verification Owner: ${escapeHtml(lead.verificationOwner ?? "unassigned")}</p>
        ${buildEvidenceDrilldownMarkup(
          lead.evidenceRef,
          createSourceContext({
            href: `/agents?leadId=${encodeURIComponent(lead.agentId)}`,
            label: `${lead.providerOrg} Lead`,
            type: "agent_lead",
            id: lead.agentId,
          }),
        )}
        <p class="meta-row">Missing Fields: ${lead.missingFields.length ? escapeHtml(lead.missingFields.join(", ")) : "none"}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Verification Checklist</p>
      <div class="detail-section-value">
        <div class="checkbox-grid">
          <label class="checkbox-field"><input id="checkIdentity" type="checkbox" ${checklist.identity ? "checked" : ""} />Identity</label>
          <label class="checkbox-field"><input id="checkAuth" type="checkbox" ${checklist.auth ? "checked" : ""} />Auth</label>
          <label class="checkbox-field"><input id="checkDisclosure" type="checkbox" ${checklist.disclosure ? "checked" : ""} />Disclosure</label>
          <label class="checkbox-field"><input id="checkSla" type="checkbox" ${checklist.sla ? "checked" : ""} />SLA</label>
          <label class="checkbox-field"><input id="checkRateLimit" type="checkbox" ${checklist.rateLimit ? "checked" : ""} />Rate Limit</label>
        </div>
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
          <label class="span-2">
            <span>Evidence Ref</span>
            <input id="leadEvidenceRef" value="${escapeHtml(lead.evidenceRef ?? "verification://agent-crm")}" />
          </label>
          <div class="form-actions span-2">
            <button class="button button-subtle" data-assign-lead="${escapeHtml(lead.agentId)}">Assign</button>
            <button class="button button-primary" data-update-lead-status="${escapeHtml(lead.agentId)}">Update Status</button>
          </div>
        </div>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Partner Promotion</p>
      <div class="detail-section-value">
        <div class="form-grid">
          <label class="span-2">
            <span>Supported Categories</span>
            <input id="partnerCategoriesInput" value="${escapeHtml(lead.verticals.join(", "))}" />
          </label>
          <label>
            <span>Partner Status</span>
            <select id="partnerStatusSelect">
              <option value="verified">verified</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label>
            <span>SLA Tier</span>
            <input id="partnerSlaTierInput" value="sandbox" />
          </label>
          <div class="form-actions span-2 list-card-actions">
            <button class="button button-primary" data-promote-lead="${escapeHtml(lead.agentId)}" ${canPromote ? "" : "disabled"}>Promote to Partner</button>
            <a class="button button-subtle" href="/agents/${encodeURIComponent(lead.agentId)}">Open Detail Page</a>
            <a class="button button-subtle" href="/agents/pipeline?leadId=${encodeURIComponent(lead.agentId)}">Open Pipeline</a>
          </div>
        </div>
        <p class="meta-row">${escapeHtml(promotionBlocker)}</p>
        <span id="leadActionFeedback" class="inline-feedback"></span>
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

  document.querySelector("#leadStatusSelect").value = lead.verificationStatus === "new" ? "reviewing" : lead.verificationStatus;
  document.querySelector("#partnerStatusSelect").value = lead.verificationStatus === "active" ? "active" : "verified";
  renderFeedback();
};

const renderLeads = async (leads) => {
  const requestedLeadId = pageParams.get("leadId");
  if (requestedLeadId && leads.some((lead) => lead.agentId === requestedLeadId)) {
    state.selectedLeadId = requestedLeadId;
  }
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
              <div class="meta-row">${escapeHtml(lead.verticals.join(", "))} · ${escapeHtml(lead.dataProvenance)}</div>
            </button>
          </td>
          <td>${badge(lead.dataProvenance)}</td>
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

const renderObservationList = (leads) => {
  const observationLeads = leads
    .filter((lead) => leadObservationReasons(lead).length > 0)
    .sort((left, right) => right.leadScore - left.leadScore);

  observationList.innerHTML = observationLeads.length
    ? observationLeads
        .map(
          (lead) => `
            <article class="list-card">
              <div class="list-card-header">
                <div>
                  <h3 class="card-title">${escapeHtml(lead.providerOrg)}</h3>
                  <p class="card-subtitle">${escapeHtml(lead.sourceType)} · ${badge(lead.verificationStatus)} ${badge(lead.dataProvenance)}</p>
                </div>
                <button class="button button-subtle" data-queue-lead="${escapeHtml(lead.agentId)}">打开</button>
              </div>
              <div class="meta-row">Reason: ${leadObservationReasons(lead).map(escapeHtml).join(", ")}</div>
              <div class="meta-row">Delivery Receipt: ${lead.supportsDeliveryReceipt ? "yes" : "no"} · Presentation Receipt: ${lead.supportsPresentationReceipt ? "yes" : "no"}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">当前筛选范围内没有观察名单项。</div>`;
};

const load = async () => {
  const filterData = new FormData(leadFilters);
  const leadQuery = buildLeadQuery(filterData);
  const queueQuery = buildLeadQuery(filterData, { hasMissingFields: true });

  const [sources, runs, leads, queueLeads] = await Promise.all([
    api.get("/discovery/sources"),
    api.get("/discovery/runs"),
    api.get(`/agent-leads?${leadQuery.toString()}`),
    api.get(`/agent-leads?${queueQuery.toString()}`),
  ]);
  if (leads.length === 0) {
    if (appConfig.mode === "real_test") {
      sourceFeedback.textContent = "真实测试环境当前没有 lead。请先运行 crawl，或导入 verified lead。";
    } else if ((leadQuery.get("dataOrigin") ?? "discovered") === "discovered") {
      sourceFeedback.textContent = "当前还没有真实 discovered leads。先运行上方真实 source crawl，或把 Data Origin 切回 seed 查看历史样例。";
    } else {
      sourceFeedback.textContent = "当前筛选条件下没有匹配结果。";
    }
  } else if (
    sourceFeedback.textContent.includes("当前还没有真实 discovered leads") ||
    sourceFeedback.textContent.includes("当前筛选条件下没有匹配结果")
  ) {
    sourceFeedback.textContent = "";
  }
  renderSources(sources);
  renderRuns(runs);
  renderCompletionQueue(queueLeads);
  renderObservationList(leads);
  await renderLeads(leads);
};

sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(sourceForm);
  const result = await api.post("/discovery/sources", {
    sourceType: data.get("sourceType"),
    name: data.get("name"),
    baseUrl: data.get("baseUrl"),
    seedUrls: [data.get("seedUrl")],
    active: true,
    crawlPolicy: { rateLimit: 1, maxDepth: 1 },
    verticalHints: ["crm_software"],
    geoHints: ["UK"],
  });
  sourceFeedback.textContent = result.ok ? "Source created." : result.body?.message ?? "Source creation failed.";
  if (result.ok) {
    await load();
  }
});

leadFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

decorateEnvironment();
leadFilters.querySelector('[name="dataOrigin"]').value =
  appConfig.mode === "real_test" || appConfig.mode === "demo" ? "" : "discovered";

if (appConfig.mode === "real_test") {
  for (const fieldName of ["name", "baseUrl", "seedUrl"]) {
    const input = sourceForm?.querySelector(`[name="${fieldName}"]`);
    if (input) input.value = "";
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  const sourceButton = target.closest("button[data-run-source]");
  const queueButton = target.closest("button[data-queue-lead]");
  const leadButton = target.closest("[data-select-lead]");
  const assignButton = target.closest("button[data-assign-lead]");
  const statusButton = target.closest("button[data-update-lead-status]");
  const promoteButton = target.closest("button[data-promote-lead]");

  if (sourceButton) {
    const result = await api.post("/discovery/runs", { sourceId: sourceButton.dataset.runSource });
    sourceFeedback.textContent = result.ok ? "Discovery run started." : result.body?.message ?? "Discovery run failed.";
    await load();
    return;
  }

  if (queueButton) {
    state.selectedLeadId = queueButton.dataset.queueLead;
    await load();
    return;
  }

  if (leadButton) {
    state.selectedLeadId = leadButton.dataset.selectLead;
    await load();
    return;
  }

  if (assignButton) {
    const result = await api.post(`/agent-leads/${encodeURIComponent(assignButton.dataset.assignLead)}/assign`, {
      ownerId: document.querySelector("#assignOwnerInput").value,
    });
    setLeadFeedback(
      result.ok ? "Owner updated." : result.body?.message ?? "Lead owner update failed.",
      result.ok ? "success" : "error",
    );
    await load();
    return;
  }

  if (statusButton) {
    const result = await api.post(`/agent-leads/${encodeURIComponent(statusButton.dataset.updateLeadStatus)}/status`, {
      nextStatus: document.querySelector("#leadStatusSelect").value,
      actorId: document.querySelector("#assignOwnerInput").value || "ops:alice",
      comment: document.querySelector("#leadStatusComment").value,
      checklist: {
        identity: document.querySelector("#checkIdentity").checked,
        auth: document.querySelector("#checkAuth").checked,
        disclosure: document.querySelector("#checkDisclosure").checked,
        sla: document.querySelector("#checkSla").checked,
        rateLimit: document.querySelector("#checkRateLimit").checked,
      },
      evidenceRef: document.querySelector("#leadEvidenceRef").value,
    });
    const success = result.ok && result.body?.ok !== false;
    setLeadFeedback(
      success ? "Lead status updated." : result.body?.message ?? "Lead status update failed.",
      success ? "success" : "error",
    );
    await load();
    return;
  }

  if (promoteButton) {
    const categories = document.querySelector("#partnerCategoriesInput").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const result = await api.post(`/agent-leads/${encodeURIComponent(promoteButton.dataset.promoteLead)}/promote`, {
      supportedCategories: categories,
      status: document.querySelector("#partnerStatusSelect").value,
      slaTier: document.querySelector("#partnerSlaTierInput").value.trim() || "sandbox",
      acceptsSponsored: state.selectedLead?.acceptsSponsored,
      supportsDisclosure: state.selectedLead?.supportsDisclosure,
      supportsDeliveryReceipt: state.selectedLead?.supportsDeliveryReceipt,
      supportsPresentationReceipt: state.selectedLead?.supportsPresentationReceipt,
      authModes: state.selectedLead?.authModes,
    });
    setLeadFeedback(
      result.ok ? `Partner created: ${result.body.partnerId}` : result.body?.message ?? "Lead promotion failed.",
      result.ok ? "success" : "error",
    );
    await load();
  }
});

load().catch((error) => {
  console.error(error);
  sourceFeedback.textContent = "Load failed.";
});

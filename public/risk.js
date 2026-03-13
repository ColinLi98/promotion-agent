import { buildSourceBacklinkMarkup, getSourceContextFromLocation } from "./drilldown-links.js";

const riskForm = document.querySelector("#riskForm");
const riskFilters = document.querySelector("#riskFilters");
const appealForm = document.querySelector("#appealForm");
const riskCaseBody = document.querySelector("#riskCaseBody");
const riskDetailPanel = document.querySelector("#riskDetailPanel");
const reputationBody = document.querySelector("#reputationBody");
const appealBody = document.querySelector("#appealBody");
const appealDetailPanel = document.querySelector("#appealDetailPanel");
const riskFeedback = document.querySelector("#riskFeedback");
const appealFeedback = document.querySelector("#appealFeedback");
const sourceBacklink = document.querySelector("#sourceBacklink");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };
const pageParams = new URLSearchParams(window.location.search);

const state = {
  selectedCaseId: null,
  selectedAppealId: null,
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
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const renderRiskDetail = (riskCase) => {
  if (!riskCase) {
    riskDetailPanel.innerHTML = `<div class="empty-state">选择一个风险案件查看详情和执行操作。</div>`;
    return;
  }

  riskDetailPanel.innerHTML = `
    <section class="detail-section">
      <p class="detail-section-title">Case Summary</p>
      <div class="detail-section-value">
        <h3 class="panel-title">${escapeHtml(riskCase.caseId)}</h3>
        <p class="meta-row">${badge(riskCase.status)} ${badge(riskCase.severity)} ${badge(riskCase.dataProvenance)}</p>
        <p class="meta-row">${escapeHtml(riskCase.entityType)} · ${escapeHtml(riskCase.entityId)}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Reason</p>
      <div class="detail-section-value">
        <p class="meta-row">${escapeHtml(riskCase.reasonType)}</p>
        <p class="meta-row">Owner: ${escapeHtml(riskCase.ownerId ?? "unassigned")}</p>
        <p class="meta-row">${escapeHtml(riskCase.note ?? "No note")}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Operator Actions</p>
      <div class="detail-section-value">
        <div class="form-grid">
          <label>
            <span>Status</span>
            <select id="riskStatusSelect">
              <option value="open">open</option>
              <option value="reviewing">reviewing</option>
              <option value="resolved">resolved</option>
              <option value="dismissed">dismissed</option>
            </select>
          </label>
          <label>
            <span>Owner</span>
            <input id="riskOwnerInput" value="${escapeHtml(riskCase.ownerId ?? "risk:irene")}" />
          </label>
          <label class="span-2">
            <span>Note</span>
            <input id="riskNoteInput" value="${escapeHtml(riskCase.note ?? "Updated from Risk Center.")}" />
          </label>
          <div class="form-actions span-2">
            <button class="button button-primary" data-update-risk="${escapeHtml(riskCase.caseId)}">更新案件</button>
          </div>
        </div>
      </div>
    </section>
  `;
  document.querySelector("#riskStatusSelect").value = riskCase.status;
};

const renderRiskCases = (cases) => {
  const requestedCaseId = pageParams.get("caseId") ?? pageParams.get("evidenceRef");
  if (requestedCaseId && cases.some((item) => item.caseId === requestedCaseId)) {
    state.selectedCaseId = requestedCaseId;
  }
  if (!state.selectedCaseId && cases.length) {
    state.selectedCaseId = cases[0].caseId;
  }

  riskCaseBody.innerHTML = cases
    .map(
      (item) => `
        <tr class="${item.caseId === state.selectedCaseId ? "is-selected" : ""}">
          <td>
            <button class="row-button" data-select-risk="${escapeHtml(item.caseId)}">
              <strong>${escapeHtml(item.caseId)}</strong>
              <div class="meta-row">${escapeHtml(item.reasonType)}</div>
            </button>
          </td>
          <td>${escapeHtml(item.entityType)}:${escapeHtml(item.entityId)}</td>
          <td>${badge(item.severity)}</td>
          <td>${badge(item.status)}</td>
          <td>${escapeHtml(item.ownerId ?? "-")}</td>
        </tr>
      `,
    )
    .join("");

  renderRiskDetail(cases.find((item) => item.caseId === state.selectedCaseId) ?? cases[0]);
};

const renderReputation = (records) => {
  reputationBody.innerHTML = records
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.recordId)}</td>
          <td>${escapeHtml(item.partnerId)}</td>
          <td>${item.delta}</td>
          <td>${escapeHtml(item.reasonType)}</td>
          <td>${escapeHtml(item.disputeStatus)}</td>
        </tr>
      `,
    )
    .join("");
};

const renderAppealDetail = (appeal) => {
  if (!appeal) {
    appealDetailPanel.innerHTML = `<div class="empty-state">选择一个 appeal 查看 statement、目标记录和裁决动作。</div>`;
    return;
  }

  appealDetailPanel.innerHTML = `
    <section class="detail-section">
      <p class="detail-section-title">Appeal Summary</p>
      <div class="detail-section-value">
        <h3 class="panel-title">${escapeHtml(appeal.appealId)}</h3>
        <p class="meta-row">${badge(appeal.status)} ${escapeHtml(appeal.partnerId)}</p>
        <p class="meta-row">Target Record: ${escapeHtml(appeal.targetRecordId)}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Statement</p>
      <div class="detail-section-value">
        <p class="meta-row">${escapeHtml(appeal.statement)}</p>
        <p class="meta-row">Opened: ${new Date(appeal.openedAt).toLocaleString()}</p>
        <p class="meta-row">Decision: ${escapeHtml(appeal.decisionNote ?? "Pending operator decision")}</p>
      </div>
    </section>
    <section class="detail-section">
      <p class="detail-section-title">Decision</p>
      <div class="detail-section-value">
        <div class="form-grid">
          <label>
            <span>Status</span>
            <select id="appealDecisionStatus">
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
            </select>
          </label>
          <label class="span-2">
            <span>Decision Note</span>
            <input id="appealDecisionNote" value="${escapeHtml(appeal.decisionNote ?? "Reviewed in Risk Center.")}" />
          </label>
          <div class="form-actions span-2">
            <button class="button button-primary" data-decide-appeal="${escapeHtml(appeal.appealId)}">提交裁决</button>
          </div>
        </div>
      </div>
    </section>
  `;
  document.querySelector("#appealDecisionStatus").value = appeal.status === "approved" ? "approved" : "rejected";
};

const renderAppeals = (appeals) => {
  if (!state.selectedAppealId && appeals.length) {
    state.selectedAppealId = appeals[0].appealId;
  }

  appealBody.innerHTML = appeals
    .map(
      (item) => `
        <tr class="${item.appealId === state.selectedAppealId ? "is-selected" : ""}">
          <td>
            <button class="row-button" data-select-appeal="${escapeHtml(item.appealId)}">
              <strong>${escapeHtml(item.appealId)}</strong>
              <div class="meta-row">${escapeHtml(item.targetRecordId)}</div>
            </button>
          </td>
          <td>${escapeHtml(item.partnerId)}</td>
          <td>${badge(item.status)}</td>
          <td>${new Date(item.openedAt).toLocaleDateString()}</td>
        </tr>
      `,
    )
    .join("");

  renderAppealDetail(appeals.find((item) => item.appealId === state.selectedAppealId) ?? appeals[0]);
};

const load = async () => {
  decorateEnvironment();
  sourceBacklink.innerHTML = buildSourceBacklinkMarkup(getSourceContextFromLocation());
  const filterData = new FormData(riskFilters);
  const query = new URLSearchParams();
  for (const [key, value] of filterData.entries()) {
    if (!String(value).trim()) continue;
    if (key === "dateFrom") query.set(key, `${value}T00:00:00.000Z`);
    else if (key === "dateTo") query.set(key, `${value}T23:59:59.999Z`);
    else query.set(key, String(value));
  }
  const [riskCases, reputationRecords, appeals] = await Promise.all([
    api.get(`/risk/cases?${query.toString()}`),
    api.get("/reputation/records"),
    api.get("/appeals"),
  ]);
  renderRiskCases(riskCases);
  renderReputation(reputationRecords);
  renderAppeals(appeals);
};

riskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(riskForm);
  const result = await api.post("/risk/cases", {
    entityType: data.get("entityType"),
    entityId: data.get("entityId"),
    reasonType: data.get("reasonType"),
    severity: data.get("severity"),
    ownerId: "risk:irene",
    note: "Created from Risk Center.",
  });
  if (result.ok) {
    state.selectedCaseId = result.body.caseId;
    riskFeedback.textContent = "Risk case created.";
    riskFeedback.style.color = "var(--success)";
    await load();
    return;
  }

  riskFeedback.textContent = result.body?.message ?? "Risk case creation failed.";
  riskFeedback.style.color = "var(--danger)";
});

riskFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(appealForm);
  const result = await api.post("/appeals", {
    partnerId: data.get("partnerId"),
    targetRecordId: data.get("targetRecordId"),
    statement: data.get("statement"),
  });
  if (result.ok) {
    state.selectedAppealId = result.body.appealId;
    appealFeedback.textContent = "Appeal created.";
    appealFeedback.style.color = "var(--success)";
    await load();
    return;
  }

  appealFeedback.textContent = result.body?.message ?? "Appeal creation failed.";
  appealFeedback.style.color = "var(--danger)";
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const selectButton = target.closest("[data-select-risk]");
  const updateButton = target.closest("[data-update-risk]");
  const selectAppealButton = target.closest("[data-select-appeal]");
  const decideAppealButton = target.closest("[data-decide-appeal]");

  if (selectButton) {
    state.selectedCaseId = selectButton.dataset.selectRisk;
    await load();
    return;
  }

  if (updateButton) {
    const result = await api.post(`/risk/cases/${encodeURIComponent(updateButton.dataset.updateRisk)}/status`, {
      status: document.querySelector("#riskStatusSelect").value,
      ownerId: document.querySelector("#riskOwnerInput").value,
      note: document.querySelector("#riskNoteInput").value,
    });
    riskFeedback.textContent = result.ok ? "Risk case updated." : result.body?.message ?? "Risk case update failed.";
    riskFeedback.style.color = result.ok ? "var(--success)" : "var(--danger)";
    await load();
    return;
  }

  if (selectAppealButton) {
    state.selectedAppealId = selectAppealButton.dataset.selectAppeal;
    await load();
    return;
  }

  if (decideAppealButton) {
    const result = await api.post(`/appeals/${encodeURIComponent(decideAppealButton.dataset.decideAppeal)}/decision`, {
      status: document.querySelector("#appealDecisionStatus").value,
      decisionNote: document.querySelector("#appealDecisionNote").value,
    });
    appealFeedback.textContent = result.ok ? "Appeal decided." : result.body?.message ?? "Appeal decision failed.";
    appealFeedback.style.color = result.ok ? "var(--success)" : "var(--danger)";
    await load();
  }
});

load().catch((error) => console.error(error));

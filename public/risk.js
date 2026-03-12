const riskForm = document.querySelector("#riskForm");
const riskFilters = document.querySelector("#riskFilters");
const appealForm = document.querySelector("#appealForm");
const riskCaseBody = document.querySelector("#riskCaseBody");
const riskDetailPanel = document.querySelector("#riskDetailPanel");
const reputationBody = document.querySelector("#reputationBody");
const appealBody = document.querySelector("#appealBody");
const riskFeedback = document.querySelector("#riskFeedback");
const appealFeedback = document.querySelector("#appealFeedback");

const state = {
  selectedCaseId: null,
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
        <p class="meta-row">${badge(riskCase.status)} ${badge(riskCase.severity)}</p>
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
  const select = document.querySelector("#riskStatusSelect");
  if (select) select.value = riskCase.status;
};

const renderRiskCases = (cases) => {
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
    .map((item) => `<tr><td>${item.recordId}</td><td>${item.partnerId}</td><td>${item.delta}</td><td>${item.reasonType}</td><td>${item.disputeStatus}</td></tr>`)
    .join("");
};

const renderAppeals = (appeals) => {
  appealBody.innerHTML = appeals
    .map((item) => `<tr><td>${item.appealId}</td><td>${item.partnerId}</td><td>${badge(item.status)}</td><td>${new Date(item.openedAt).toLocaleDateString()}</td></tr>`)
    .join("");
};

const load = async () => {
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
  state.selectedCaseId = result.caseId;
  riskFeedback.textContent = "Risk case created.";
  await load();
});

riskFilters.addEventListener("submit", async (event) => {
  event.preventDefault();
  await load();
});

appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(appealForm);
  await api.post("/appeals", {
    partnerId: data.get("partnerId"),
    targetRecordId: data.get("targetRecordId"),
    statement: data.get("statement"),
  });
  appealFeedback.textContent = "Appeal created.";
  await load();
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const selectButton = target.closest("[data-select-risk]");
  const updateButton = target.closest("[data-update-risk]");

  if (selectButton) {
    state.selectedCaseId = selectButton.dataset.selectRisk;
    await load();
    return;
  }

  if (updateButton) {
    await api.post(`/risk/cases/${encodeURIComponent(updateButton.dataset.updateRisk)}/status`, {
      status: document.querySelector("#riskStatusSelect").value,
      ownerId: document.querySelector("#riskOwnerInput").value,
      note: document.querySelector("#riskNoteInput").value,
    });
    riskFeedback.textContent = "Risk case updated.";
    await load();
  }
});

load().catch((error) => console.error(error));

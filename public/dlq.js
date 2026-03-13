const elements = {
  form: document.querySelector("#dlqFilterForm"),
  statusSelect: document.querySelector("#dlqStatusSelect"),
  traceIdInput: document.querySelector("#dlqTraceIdInput"),
  pageSizeSelect: document.querySelector("#dlqPageSizeSelect"),
  meta: document.querySelector("#dlqMeta"),
  dlqTableBody: document.querySelector("#dlqTableBody"),
  dlqDetailPanel: document.querySelector("#dlqDetailPanel"),
  prevPage: document.querySelector("#dlqPrevPage"),
  nextPage: document.querySelector("#dlqNextPage"),
};

const params = new URLSearchParams(window.location.search);
let currentPage = Number(params.get("page") ?? "1");
let selectedDlqEntryId = null;
let currentPageData = null;
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value) =>
  `<span class="badge ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;

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

const syncQueryToUrl = () => {
  const next = new URLSearchParams();
  if (elements.statusSelect.value) next.set("status", elements.statusSelect.value);
  if (elements.traceIdInput.value.trim()) next.set("traceId", elements.traceIdInput.value.trim());
  next.set("page", String(currentPage));
  next.set("pageSize", elements.pageSizeSelect.value);
  history.replaceState(null, "", `/dlq.html?${next.toString()}`);
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    body: await response.json(),
  };
};

const render = () => {
  const page = currentPageData;
  elements.meta.textContent = `page ${page.page} / total ${page.total} entries`;
  elements.prevPage.disabled = !page.hasPreviousPage;
  elements.nextPage.disabled = !page.hasNextPage;

  if (!selectedDlqEntryId && page.items.length) {
    selectedDlqEntryId = page.items[0].dlqEntryId;
  }

  if (!page.items.length) {
    elements.dlqTableBody.innerHTML = "";
    elements.dlqDetailPanel.innerHTML = `<div class="empty-state">当前没有 dead letter。</div>`;
    return;
  }

  elements.dlqTableBody.innerHTML = page.items
    .map(
      (entry) => `
        <tr class="${entry.dlqEntryId === selectedDlqEntryId ? "is-selected" : ""}">
          <td><button class="row-button" data-select-dlq="${escapeHtml(entry.dlqEntryId)}"><strong>${escapeHtml(entry.dlqEntryId)}</strong><div class="meta-row">${escapeHtml(entry.settlementId)}</div></button></td>
          <td class="mono">${escapeHtml(entry.traceId)}</td>
          <td>${badge(entry.status)}</td>
          <td>${escapeHtml(entry.reason)}</td>
          <td>${new Date(entry.updatedAt).toLocaleString()}</td>
        </tr>
      `,
    )
    .join("");

  const selected = page.items.find((entry) => entry.dlqEntryId === selectedDlqEntryId) ?? page.items[0];
  elements.dlqDetailPanel.innerHTML = `
    ${detailSection("DLQ Entry", `
      <h3 class="panel-title">${escapeHtml(selected.dlqEntryId)}</h3>
      <p class="meta-row">${badge(selected.status)} ${badge(selected.reason)} ${badge(selected.payload?.settlement?.dataProvenance ?? "ops_manual")}</p>
    `)}
    ${detailSection("Settlement Context", `
      <p class="meta-row">Settlement ${escapeHtml(selected.settlementId)}</p>
      <p class="meta-row">Trace ${escapeHtml(selected.traceId)}</p>
      <p class="meta-row">Last Error: ${escapeHtml(selected.lastError)}</p>
    `)}
    ${detailSection("Payload", `<pre class="mono code-block">${escapeHtml(JSON.stringify(selected.payload, null, 2))}</pre>`)}
    ${
      selected.status === "open"
        ? `
          <div class="card-actions">
            <button class="button button-primary" data-action="replay-dlq" data-dlq-entry-id="${escapeHtml(selected.dlqEntryId)}">Replay</button>
            <button class="button button-subtle" data-action="resolve-dlq" data-resolution-status="resolved" data-dlq-entry-id="${escapeHtml(selected.dlqEntryId)}">Resolve</button>
            <button class="button button-subtle" data-action="resolve-dlq" data-resolution-status="ignored" data-dlq-entry-id="${escapeHtml(selected.dlqEntryId)}">Ignore</button>
          </div>
        `
        : ""
    }
  `;
};

const loadDlq = async () => {
  decorateEnvironment();
  syncQueryToUrl();
  const query = new URLSearchParams({
    page: String(currentPage),
    pageSize: elements.pageSizeSelect.value,
  });
  if (elements.statusSelect.value) query.set("status", elements.statusSelect.value);
  if (elements.traceIdInput.value.trim()) query.set("traceId", elements.traceIdInput.value.trim());
  currentPageData = await fetch(`/settlements/dlq?${query.toString()}`).then((response) => response.json());
  render();
};

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentPage = 1;
  await loadDlq();
});

elements.prevPage.addEventListener("click", async () => {
  currentPage = Math.max(1, currentPage - 1);
  await loadDlq();
});

elements.nextPage.addEventListener("click", async () => {
  currentPage += 1;
  await loadDlq();
});

document.addEventListener("click", async (event) => {
  const selectButton = event.target.closest("[data-select-dlq]");
  if (selectButton) {
    selectedDlqEntryId = selectButton.dataset.selectDlq;
    render();
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) return;

  if (button.dataset.action === "replay-dlq") {
    await apiPost(`/settlements/dlq/${button.dataset.dlqEntryId}/replay`, {
      resolutionNote: "Replayed from DLQ console.",
    });
    await loadDlq();
    return;
  }

  if (button.dataset.action === "resolve-dlq") {
    await apiPost(`/settlements/dlq/${button.dataset.dlqEntryId}/resolve`, {
      status: button.dataset.resolutionStatus,
      resolutionNote: `Marked as ${button.dataset.resolutionStatus} from DLQ console.`,
    });
    await loadDlq();
  }
});

elements.statusSelect.value = params.get("status") ?? "";
elements.traceIdInput.value = params.get("traceId") ?? "";
elements.pageSizeSelect.value = ["10", "20", "50"].includes(params.get("pageSize") ?? "")
  ? params.get("pageSize")
  : "20";

loadDlq().catch((error) => {
  console.error(error);
  elements.meta.textContent = "加载失败";
});

const elements = {
  form: document.querySelector("#auditFilterForm"),
  traceIdInput: document.querySelector("#traceIdInput"),
  entityTypeSelect: document.querySelector("#entityTypeSelect"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  auditTableBody: document.querySelector("#auditTableBody"),
  auditDetailPanel: document.querySelector("#auditDetailPanel"),
  auditMeta: document.querySelector("#auditMeta"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
};

const params = new URLSearchParams(window.location.search);
let currentPage = Number(params.get("page") ?? "1");
const requestedPageSize = params.get("pageSize");
const supportedPageSizes = new Set(["10", "20", "50"]);
let currentPageData = null;
let selectedAuditEventId = null;

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

const syncQueryToUrl = () => {
  const next = new URLSearchParams();
  if (elements.traceIdInput.value.trim()) next.set("traceId", elements.traceIdInput.value.trim());
  if (elements.entityTypeSelect.value) next.set("entityType", elements.entityTypeSelect.value);
  next.set("page", String(currentPage));
  next.set("pageSize", elements.pageSizeSelect.value);
  history.replaceState(null, "", `/audit.html?${next.toString()}`);
};

const render = () => {
  const page = currentPageData;
  elements.auditMeta.textContent = `page ${page.page} / total ${page.total} events`;
  elements.prevPage.disabled = !page.hasPreviousPage;
  elements.nextPage.disabled = !page.hasNextPage;

  if (!selectedAuditEventId && page.items.length) {
    selectedAuditEventId = page.items[0].auditEventId;
  }

  if (!page.items.length) {
    elements.auditTableBody.innerHTML = "";
    elements.auditDetailPanel.innerHTML = `<div class="empty-state">没有匹配的审计事件。</div>`;
    return;
  }

  elements.auditTableBody.innerHTML = page.items
    .map(
      (event) => `
        <tr class="${event.auditEventId === selectedAuditEventId ? "is-selected" : ""}">
          <td><button class="row-button" data-select-audit="${escapeHtml(event.auditEventId)}"><strong>${escapeHtml(event.action)}</strong><div class="meta-row">${escapeHtml(event.entityType)}</div></button></td>
          <td class="mono">${escapeHtml(event.traceId)}</td>
          <td>${escapeHtml(event.entityId)}</td>
          <td>${badge(event.status)}</td>
          <td>${badge(event.actorType)}</td>
        </tr>
      `,
    )
    .join("");

  const selected = page.items.find((event) => event.auditEventId === selectedAuditEventId) ?? page.items[0];
  elements.auditDetailPanel.innerHTML = `
    ${detailSection("Event", `
      <h3 class="panel-title">${escapeHtml(selected.action)}</h3>
      <p class="meta-row">${badge(selected.status)} ${badge(selected.actorType)}</p>
    `)}
    ${detailSection("Trace", `
      <p class="mono">${escapeHtml(selected.traceId)}</p>
      <p class="meta-row">${new Date(selected.occurredAt).toLocaleString()}</p>
    `)}
    ${detailSection("Entity", `<p class="meta-row">${escapeHtml(selected.entityType)} · ${escapeHtml(selected.entityId)}</p>`)}
    ${detailSection("Details", `<pre class="mono code-block">${escapeHtml(JSON.stringify(selected.details, null, 2))}</pre>`)}
  `;
};

const loadAuditTrail = async () => {
  syncQueryToUrl();
  const query = new URLSearchParams({
    page: String(currentPage),
    pageSize: elements.pageSizeSelect.value,
  });
  if (elements.traceIdInput.value.trim()) query.set("traceId", elements.traceIdInput.value.trim());
  if (elements.entityTypeSelect.value) query.set("entityType", elements.entityTypeSelect.value);
  currentPageData = await fetch(`/audit-trail?${query.toString()}`).then((response) => response.json());
  render();
};

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentPage = 1;
  await loadAuditTrail();
});

elements.prevPage.addEventListener("click", async () => {
  currentPage = Math.max(1, currentPage - 1);
  await loadAuditTrail();
});

elements.nextPage.addEventListener("click", async () => {
  currentPage += 1;
  await loadAuditTrail();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-audit]");
  if (!button) return;
  selectedAuditEventId = button.dataset.selectAudit;
  render();
});

elements.traceIdInput.value = params.get("traceId") ?? "";
elements.entityTypeSelect.value = params.get("entityType") ?? "";
elements.pageSizeSelect.value = supportedPageSizes.has(requestedPageSize ?? "") ? requestedPageSize : "20";

loadAuditTrail().catch((error) => {
  console.error(error);
  elements.auditMeta.textContent = "加载失败";
});

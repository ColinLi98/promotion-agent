const elements = {
  form: document.querySelector("#auditFilterForm"),
  traceIdInput: document.querySelector("#traceIdInput"),
  entityTypeSelect: document.querySelector("#entityTypeSelect"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  auditResults: document.querySelector("#auditResults"),
  auditMeta: document.querySelector("#auditMeta"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
};

const params = new URLSearchParams(window.location.search);
let currentPage = Number(params.get("page") ?? "1");
const requestedPageSize = params.get("pageSize");
const supportedPageSizes = new Set(["10", "20", "50"]);

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value) =>
  `<span class="badge ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;

const syncQueryToUrl = () => {
  const next = new URLSearchParams();
  if (elements.traceIdInput.value.trim()) {
    next.set("traceId", elements.traceIdInput.value.trim());
  }
  if (elements.entityTypeSelect.value) {
    next.set("entityType", elements.entityTypeSelect.value);
  }
  next.set("page", String(currentPage));
  next.set("pageSize", elements.pageSizeSelect.value);
  history.replaceState(null, "", `/audit.html?${next.toString()}`);
};

const renderAuditResults = (page) => {
  elements.auditMeta.textContent = `page ${page.page} / total ${page.total} events`;
  elements.prevPage.disabled = !page.hasPreviousPage;
  elements.nextPage.disabled = !page.hasNextPage;

  if (!page.items.length) {
    elements.auditResults.innerHTML = `<div class="empty-state">没有匹配的审计事件。</div>`;
    return;
  }

  elements.auditResults.innerHTML = page.items
    .map(
      (event) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(event.action)}</h3>
              <p class="card-subtitle">${escapeHtml(event.traceId)} · ${escapeHtml(event.entityType)} · ${escapeHtml(event.entityId)}</p>
            </div>
            <div class="badge-row">
              ${badge(event.status)}
              ${badge(event.actorType)}
            </div>
          </div>
          <div class="meta-row">At: ${escapeHtml(new Date(event.occurredAt).toLocaleString())}</div>
          <div class="meta-row">Details: ${escapeHtml(JSON.stringify(event.details))}</div>
        </article>
      `,
    )
    .join("");
};

const loadAuditTrail = async () => {
  syncQueryToUrl();
  const query = new URLSearchParams({
    page: String(currentPage),
    pageSize: elements.pageSizeSelect.value,
  });

  if (elements.traceIdInput.value.trim()) {
    query.set("traceId", elements.traceIdInput.value.trim());
  }

  if (elements.entityTypeSelect.value) {
    query.set("entityType", elements.entityTypeSelect.value);
  }

  const response = await fetch(`/audit-trail?${query.toString()}`);
  const body = await response.json();
  renderAuditResults(body);
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

elements.traceIdInput.value = params.get("traceId") ?? "";
elements.entityTypeSelect.value = params.get("entityType") ?? "";
elements.pageSizeSelect.value = supportedPageSizes.has(requestedPageSize ?? "") ? requestedPageSize : "20";

loadAuditTrail().catch((error) => {
  console.error(error);
  elements.auditMeta.textContent = "加载失败";
});

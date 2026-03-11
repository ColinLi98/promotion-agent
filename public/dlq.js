const elements = {
  form: document.querySelector("#dlqFilterForm"),
  statusSelect: document.querySelector("#dlqStatusSelect"),
  traceIdInput: document.querySelector("#dlqTraceIdInput"),
  pageSizeSelect: document.querySelector("#dlqPageSizeSelect"),
  meta: document.querySelector("#dlqMeta"),
  list: document.querySelector("#dlqList"),
  prevPage: document.querySelector("#dlqPrevPage"),
  nextPage: document.querySelector("#dlqNextPage"),
};

const params = new URLSearchParams(window.location.search);
let currentPage = Number(params.get("page") ?? "1");

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
  if (elements.statusSelect.value) {
    next.set("status", elements.statusSelect.value);
  }
  if (elements.traceIdInput.value.trim()) {
    next.set("traceId", elements.traceIdInput.value.trim());
  }
  next.set("page", String(currentPage));
  next.set("pageSize", elements.pageSizeSelect.value);
  history.replaceState(null, "", `/dlq.html?${next.toString()}`);
};

const apiPost = async (path, payload) => {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    body: await response.json(),
  };
};

const renderPage = (page) => {
  elements.meta.textContent = `page ${page.page} / total ${page.total} entries`;
  elements.prevPage.disabled = !page.hasPreviousPage;
  elements.nextPage.disabled = !page.hasNextPage;

  if (!page.items.length) {
    elements.list.innerHTML = `<div class="empty-state">当前没有 dead letter。</div>`;
    return;
  }

  elements.list.innerHTML = page.items
    .map(
      (entry) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(entry.dlqEntryId)}</h3>
              <p class="card-subtitle">${escapeHtml(entry.traceId)} · ${escapeHtml(entry.settlementId)}</p>
            </div>
            <div class="badge-row">
              ${badge(entry.status)}
              ${badge("draft", entry.reason)}
            </div>
          </div>
          <div class="meta-row">Error: ${escapeHtml(entry.lastError)}</div>
          <div class="meta-row">Payload: ${escapeHtml(JSON.stringify(entry.payload))}</div>
          <div class="card-actions">
            <div class="meta-row">Updated at: ${escapeHtml(new Date(entry.updatedAt).toLocaleString())}</div>
            <div class="hero-actions">
              ${
                entry.status === "open"
                  ? `<button class="button button-primary" data-action="replay-dlq" data-dlq-entry-id="${escapeHtml(entry.dlqEntryId)}">Replay</button>
                     <button class="button button-subtle" data-action="resolve-dlq" data-resolution-status="resolved" data-dlq-entry-id="${escapeHtml(entry.dlqEntryId)}">Resolve</button>
                     <button class="button button-subtle" data-action="resolve-dlq" data-resolution-status="ignored" data-dlq-entry-id="${escapeHtml(entry.dlqEntryId)}">Ignore</button>`
                  : ""
              }
            </div>
          </div>
        </article>
      `,
    )
    .join("");
};

const loadDlq = async () => {
  syncQueryToUrl();
  const query = new URLSearchParams({
    page: String(currentPage),
    pageSize: elements.pageSizeSelect.value,
  });
  if (elements.statusSelect.value) {
    query.set("status", elements.statusSelect.value);
  }
  if (elements.traceIdInput.value.trim()) {
    query.set("traceId", elements.traceIdInput.value.trim());
  }

  const response = await fetch(`/settlements/dlq?${query.toString()}`);
  renderPage(await response.json());
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
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

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

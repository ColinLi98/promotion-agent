const evidenceForm = document.querySelector("#evidenceForm");
const evidenceBody = document.querySelector("#evidenceBody");
const evidenceDetail = document.querySelector("#evidenceDetail");
const evidenceFeedback = document.querySelector("#evidenceFeedback");

const state = {
  selectedAssetId: null,
};

const api = {
  get: (path) => fetch(path).then((response) => response.json()),
  post: (path, body) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json()),
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(value)}</span>`;

const detailSection = (title, value) => `
  <section class="detail-section">
    <p class="detail-section-title">${escapeHtml(title)}</p>
    <div class="detail-section-value">${value}</div>
  </section>
`;

let assets = [];

const renderEvidence = () => {
  if (!state.selectedAssetId && assets.length) {
    state.selectedAssetId = assets[0].assetId;
  }

  evidenceBody.innerHTML = assets
    .map((item) => `
      <tr class="${item.assetId === state.selectedAssetId ? "is-selected" : ""}">
        <td><button class="row-button" data-select-asset="${escapeHtml(item.assetId)}"><strong>${escapeHtml(item.assetId)}</strong><div class="meta-row">${escapeHtml(item.label)}</div></button></td>
        <td>${escapeHtml(item.campaignId)}</td>
        <td>${badge(item.type)}</td>
        <td>${escapeHtml(item.verifiedBy ?? "-")}</td>
        <td>${new Date(item.updatedAt).toLocaleString()}</td>
      </tr>
    `)
    .join("");

  const selected = assets.find((item) => item.assetId === state.selectedAssetId) ?? assets[0];
  if (!selected) {
    evidenceDetail.innerHTML = `<div class="empty-state">没有 evidence asset。</div>`;
    return;
  }

  evidenceDetail.innerHTML = `
    ${detailSection("Asset", `
      <h3 class="panel-title">${escapeHtml(selected.label)}</h3>
      <p class="meta-row">${badge(selected.type)} ${escapeHtml(selected.assetId)}</p>
    `)}
    ${detailSection("Campaign", `<p class="meta-row">${escapeHtml(selected.campaignId)}</p>`)}
    ${detailSection("Verification", `
      <p class="meta-row">Verified by: ${escapeHtml(selected.verifiedBy ?? "unverified")}</p>
      <p class="meta-row">${escapeHtml(selected.verificationNote ?? "No verification note")}</p>
    `)}
    ${detailSection("Asset URL", `<a class="inline-link" href="${escapeHtml(selected.url)}" target="_blank" rel="noreferrer">${escapeHtml(selected.url)}</a>`)}
  `;
};

const load = async () => {
  assets = await api.get("/evidence/assets");
  renderEvidence();
};

evidenceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(evidenceForm);
  const asset = await api.post("/evidence/assets", {
    campaignId: data.get("campaignId"),
    type: data.get("type"),
    label: data.get("label"),
    url: data.get("url"),
    verifiedBy: "risk:irene",
    verificationNote: "Added from Evidence Center.",
  });
  state.selectedAssetId = asset.assetId;
  evidenceFeedback.textContent = "Evidence asset created.";
  await load();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-asset]");
  if (!button) return;
  state.selectedAssetId = button.dataset.selectAsset;
  renderEvidence();
});

load().catch((error) => console.error(error));

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const createSourceContext = ({ href, label, type, id }) => ({
  href,
  label,
  type,
  id,
});

const withSourceContext = (path, sourceContext) => {
  const url = new URL(path, window.location.origin);
  if (sourceContext?.href) url.searchParams.set("sourceHref", sourceContext.href);
  if (sourceContext?.label) url.searchParams.set("sourceLabel", sourceContext.label);
  if (sourceContext?.type) url.searchParams.set("sourceType", sourceContext.type);
  if (sourceContext?.id) url.searchParams.set("sourceId", sourceContext.id);
  return `${url.pathname}${url.search}`;
};

export const getSourceContextFromLocation = () => {
  const params = new URLSearchParams(window.location.search);
  const href = params.get("sourceHref");
  if (!href) return null;
  return {
    href,
    label: params.get("sourceLabel") ?? "Source Object",
    type: params.get("sourceType"),
    id: params.get("sourceId"),
  };
};

export const buildSourceBacklinkMarkup = (sourceContext) => {
  if (!sourceContext?.href) return "";
  const meta = [sourceContext.type, sourceContext.id].filter(Boolean).join(" · ");
  return `
    <div class="card-actions">
      <a class="button button-subtle" href="${escapeHtml(sourceContext.href)}">Back To ${escapeHtml(sourceContext.label ?? "Source Object")}</a>
    </div>
    ${meta ? `<p class="meta-row">${escapeHtml(meta)}</p>` : ""}
  `;
};

export const buildEvidenceDrilldownMarkup = (evidenceRef, sourceContext) => {
  if (!evidenceRef) {
    return `<p class="meta-row">Evidence Ref: missing</p>`;
  }

  if (/^asset_/i.test(evidenceRef)) {
    const href = withSourceContext(`/evidence?assetId=${encodeURIComponent(evidenceRef)}`, sourceContext);
    return `
      <p class="meta-row">Evidence Ref: <span class="mono">${escapeHtml(evidenceRef)}</span></p>
      <div class="card-actions">
        <a class="button button-subtle" href="${href}">Open Evidence Center</a>
      </div>
    `;
  }

  if (/^risk_/i.test(evidenceRef)) {
    const href = withSourceContext(`/risk?caseId=${encodeURIComponent(evidenceRef)}`, sourceContext);
    return `
      <p class="meta-row">Evidence Ref: <span class="mono">${escapeHtml(evidenceRef)}</span></p>
      <div class="card-actions">
        <a class="button button-subtle" href="${href}">Open Risk Center</a>
      </div>
    `;
  }

  if (/^https?:\/\//i.test(evidenceRef)) {
    const href = escapeHtml(evidenceRef);
    return `
      <p class="meta-row">Evidence Ref: <span class="mono">${href}</span></p>
      <div class="card-actions">
        <a class="button button-subtle" href="${href}" target="_blank" rel="noreferrer">Open Source Evidence</a>
      </div>
    `;
  }

  const encodedRef = encodeURIComponent(evidenceRef);
  const evidenceHref = withSourceContext(`/evidence?evidenceRef=${encodedRef}`, sourceContext);
  const riskHref = withSourceContext(`/risk?evidenceRef=${encodedRef}`, sourceContext);
  return `
    <p class="meta-row">Evidence Ref: <span class="mono">${escapeHtml(evidenceRef)}</span></p>
    <div class="card-actions">
      <a class="button button-subtle" href="${evidenceHref}">Find In Evidence</a>
      <a class="button button-subtle" href="${riskHref}">Find In Risk</a>
    </div>
  `;
};

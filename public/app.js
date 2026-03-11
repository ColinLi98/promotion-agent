const elements = {
  refreshAll: document.querySelector("#refreshAll"),
  healthDot: document.querySelector("#healthDot"),
  healthText: document.querySelector("#healthText"),
  summaryCards: document.querySelector("#summaryCards"),
  statusStrip: document.querySelector("#statusStrip"),
  campaignList: document.querySelector("#campaignList"),
  partnerList: document.querySelector("#partnerList"),
  settlementList: document.querySelector("#settlementList"),
  retryJobList: document.querySelector("#retryJobList"),
  auditTrailList: document.querySelector("#auditTrailList"),
  shortlistResult: document.querySelector("#shortlistResult"),
  campaignForm: document.querySelector("#campaignForm"),
  opportunityForm: document.querySelector("#opportunityForm"),
  campaignFormResult: document.querySelector("#campaignFormResult"),
  opportunityResult: document.querySelector("#opportunityResult"),
  processRetryQueue: document.querySelector("#processRetryQueue"),
  retryQueueResult: document.querySelector("#retryQueueResult"),
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const api = {
  get: (path) => fetch(path).then((response) => response.json()),
  post: async (path, payload) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  },
};

const stableReceiptIdFor = ({ intentId, offerId, partnerId, campaignId }) =>
  `rcpt_${[intentId, offerId, partnerId, campaignId, "shortlisted"].join("_").replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value, label = value) =>
  `<span class="badge ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(label)}</span>`;

const createMetricCard = (label, value, foot) => `
  <article class="metric-card">
    <p class="metric-label">${escapeHtml(label)}</p>
    <p class="metric-value">${escapeHtml(value)}</p>
    <p class="metric-foot">${escapeHtml(foot)}</p>
  </article>
`;

const renderSummary = (dashboard) => {
  elements.summaryCards.innerHTML = [
    createMetricCard("Active Partners", dashboard.activePartners, "当前可以承接 sponsored shortlist 的合作方"),
    createMetricCard("Active Campaigns", dashboard.activeCampaigns, "已通过 policy 并进入排序候选"),
    createMetricCard("Settlements", dashboard.settlementCount, "收到合格回执后写入的账单记录"),
    createMetricCard("Qualified Recommendation Rate", pct.format(dashboard.qualifiedRecommendationRate), "当前按 intent 聚合的 shortlist 命中比率"),
  ].join("");
};

const renderStatusStrip = (dashboard, campaigns, partners, settlements) => {
  const reviewing = campaigns.filter((campaign) => campaign.status === "reviewing").length;
  const rejected = campaigns.filter((campaign) => campaign.status === "rejected").length;
  const active = campaigns.filter((campaign) => campaign.status === "active").length;

  elements.statusStrip.innerHTML = `
    <article class="status-block">
      <div class="status-title"><strong>Discovery Surface</strong>${badge("active", `${partners.length} agents`)}</div>
      <div class="status-stat">${partners.length}</div>
      <p class="status-copy">合作 agent 已经可展示，并带有 sponsored / disclosure 能力标签。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Review Queue</strong>${badge("reviewing", `${reviewing} reviewing`)}</div>
      <div class="status-stat">${reviewing}</div>
      <p class="status-copy">新活动会先进入预检和审核，而不是直接进排序。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Active Inventory</strong>${badge("active", `${active} active`)}</div>
      <div class="status-stat">${active}</div>
      <p class="status-copy">只有通过 gates 的 campaign 才能参与 sponsored reranking。</p>
    </article>
    <article class="status-block">
      <div class="status-title"><strong>Settlement Loop</strong>${badge(settlements.length ? "active" : "draft", `${settlements.length} receipts`)}</div>
      <div class="status-stat">${settlements.length}</div>
      <p class="status-copy">结算闭环已接好。当前 rejection 数：${rejected}。</p>
    </article>
  `;
};

const renderCampaigns = (campaigns, policyChecks) => {
  if (!campaigns.length) {
    elements.campaignList.innerHTML = `<div class="empty-state">还没有 campaign。</div>`;
    return;
  }

  const latestPolicyByCampaignId = new Map(
    policyChecks.map((item) => [item.campaignId, item]),
  );

  elements.campaignList.innerHTML = campaigns
    .map((campaign) => {
      const policyCheck = latestPolicyByCampaignId.get(campaign.campaignId);
      const riskFlags = policyCheck?.riskFlags?.length
        ? policyCheck.riskFlags.map((flag) => badge("manual_review", flag)).join("")
        : badge("pass", "no risk flag");
      const canActivate = campaign.status === "reviewing" && policyCheck?.decision === "pass";

      return `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(campaign.advertiser)} · ${escapeHtml(campaign.offer.title)}</h3>
              <p class="card-subtitle">${escapeHtml(campaign.category)} · ${escapeHtml(campaign.billingModel)} · payout ${currency.format(campaign.payoutAmount)}</p>
            </div>
            <div class="badge-row">
              ${badge(campaign.status)}
              ${policyCheck ? badge(policyCheck.decision) : badge("draft", "unchecked")}
            </div>
          </div>
          <div class="meta-row">Disclosure: ${escapeHtml(campaign.disclosureText)}</div>
          <div class="meta-row">Claims: ${campaign.offer.claims.map((claim) => escapeHtml(claim)).join(" / ")}</div>
          <div class="badge-row">${riskFlags}</div>
          <div class="card-actions">
            <div class="meta-row">Offer ID: ${escapeHtml(campaign.offer.offerId)}</div>
            <div class="hero-actions">
              <button class="button button-subtle" data-action="review" data-campaign-id="${escapeHtml(campaign.campaignId)}">重新 Review</button>
              ${canActivate ? `<button class="button button-primary" data-action="activate" data-campaign-id="${escapeHtml(campaign.campaignId)}">Activate</button>` : ""}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
};

const renderPartners = (partners) => {
  if (!partners.length) {
    elements.partnerList.innerHTML = `<div class="empty-state">还没有 partner agent。</div>`;
    return;
  }

  elements.partnerList.innerHTML = partners
    .map(
      (partner) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(partner.providerOrg)}</h3>
              <p class="card-subtitle">${escapeHtml(partner.endpoint)}</p>
            </div>
            <div class="badge-row">
              ${badge(partner.status)}
              ${badge("active", `trust ${partner.trustScore.toFixed(2)}`)}
            </div>
          </div>
          <div class="meta-row">Supported categories: ${partner.supportedCategories.map(escapeHtml).join(", ")}</div>
          <div class="meta-row">Auth: ${partner.authModes.map(escapeHtml).join(", ")} · Disclosure: ${partner.supportsDisclosure ? "yes" : "no"}</div>
        </article>
      `,
    )
    .join("");
};

const renderSettlements = (settlements) => {
  if (!settlements.length) {
    elements.settlementList.innerHTML = `<div class="empty-state">还没有 settlement。先跑一次 shortlist 回执就会出现。</div>`;
    return;
  }

  elements.settlementList.innerHTML = settlements
    .map(
      (settlement) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(settlement.billingModel)} · ${currency.format(settlement.amount)}</h3>
              <p class="card-subtitle">Campaign ${escapeHtml(settlement.campaignId)} · Offer ${escapeHtml(settlement.offerId)}</p>
            </div>
            <div class="badge-row">
              ${badge(settlement.status)}
              ${badge("active", settlement.eventType)}
            </div>
          </div>
          <div class="meta-row">Attribution window: ${escapeHtml(settlement.attributionWindow)} · Generated at: ${escapeHtml(new Date(settlement.generatedAt).toLocaleString())}</div>
          <div class="card-actions">
            <div class="meta-row">Settlement ID: ${escapeHtml(settlement.settlementId)}</div>
            ${
              settlement.status !== "disputed" && settlement.status !== "settled" && settlement.status !== "failed"
                ? `<button class="button button-subtle" data-action="dispute-settlement" data-settlement-id="${escapeHtml(settlement.settlementId)}">标记为 Disputed</button>`
                : ""
            }
          </div>
        </article>
      `,
    )
    .join("");
};

const renderRetryJobs = (retryJobs) => {
  if (!retryJobs.length) {
    elements.retryJobList.innerHTML = `<div class="empty-state">当前没有 retry job。</div>`;
    return;
  }

  elements.retryJobList.innerHTML = retryJobs
    .map(
      (job) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(job.retryJobId)}</h3>
              <p class="card-subtitle">Settlement ${escapeHtml(job.settlementId)} · Trace ${escapeHtml(job.traceId)}</p>
            </div>
            <div class="badge-row">
              ${badge(job.status)}
              ${badge("draft", `attempt ${job.attempts}/${job.maxAttempts}`)}
            </div>
          </div>
          <div class="meta-row">Next run: ${escapeHtml(new Date(job.nextRunAt).toLocaleString())}</div>
          <div class="meta-row">Last error: ${escapeHtml(job.lastError ?? "none")}</div>
        </article>
      `,
    )
    .join("");
};

const renderAuditTrail = (auditEvents) => {
  const items = auditEvents.items ?? [];
  if (!items.length) {
    elements.auditTrailList.innerHTML = `<div class="empty-state">还没有 audit event。</div>`;
    return;
  }

  elements.auditTrailList.innerHTML = auditEvents
    .items.map(
      (event) => `
        <article class="list-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">${escapeHtml(event.action)}</h3>
              <p class="card-subtitle">
                <a href="/audit.html?traceId=${encodeURIComponent(event.traceId)}" class="inline-link">${escapeHtml(event.traceId)}</a>
                · ${escapeHtml(event.entityType)} · ${escapeHtml(event.entityId)}
              </p>
            </div>
            <div class="badge-row">
              ${badge(event.status)}
              ${badge("draft", event.actorType)}
            </div>
          </div>
          <div class="meta-row">Trace: ${escapeHtml(event.traceId)} · At: ${escapeHtml(new Date(event.occurredAt).toLocaleString())}</div>
          <div class="meta-row">Details: ${escapeHtml(JSON.stringify(event.details))}</div>
        </article>
      `,
    )
    .join("");
};

const renderShortlist = (result) => {
  if (!result?.shortlisted?.length) {
    elements.shortlistResult.innerHTML = `<div class="empty-state">当前请求没有返回可展示的 sponsored shortlist。</div>`;
    return;
  }

  elements.shortlistResult.innerHTML = result.shortlisted
    .map(
      (item, index) => `
        <article class="shortlist-card">
          <div class="list-card-header">
            <div>
              <h3 class="card-title">#${index + 1} ${escapeHtml(item.campaignId)}</h3>
              <p class="card-subtitle">${escapeHtml(item.offerId)} · ${escapeHtml(item.partnerId)}</p>
            </div>
            <div class="badge-row">
              ${badge("active", `score ${item.priorityScore.toFixed(3)}`)}
              ${badge("pass", `${item.ttlSeconds}s TTL`)}
            </div>
          </div>
          <div class="shortlist-grid">
            <div class="shortlist-metric"><span>Relevance</span><strong>${item.relevance.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Utility</span><strong>${item.expectedUtility.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Trust</span><strong>${item.trustScore.toFixed(2)}</strong></div>
            <div class="shortlist-metric"><span>Bid</span><strong>${currency.format(item.bidValue)}</strong></div>
          </div>
          <p class="meta-row">Ranking reason: ${escapeHtml(item.rankingReason)}</p>
          <p class="meta-row">Disclosure: ${escapeHtml(item.disclosureText)}</p>
          <div class="card-actions">
            <div class="meta-row">Audit trace: ${escapeHtml(item.auditTraceId)}</div>
            <button
              class="button button-subtle"
              data-action="receipt"
              data-receipt-id="${escapeHtml(
                stableReceiptIdFor({
                  intentId: result.intentId,
                  offerId: item.offerId,
                  partnerId: item.partnerId,
                  campaignId: item.campaignId,
                }),
              )}"
              data-intent-id="${escapeHtml(result.intentId)}"
              data-offer-id="${escapeHtml(item.offerId)}"
              data-campaign-id="${escapeHtml(item.campaignId)}"
              data-partner-id="${escapeHtml(item.partnerId)}"
            >
              发送 shortlisted 回执
            </button>
          </div>
        </article>
      `,
    )
    .join("");
};

const setFeedback = (element, message, tone = "info") => {
  element.textContent = message;
  element.style.color = tone === "error" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--muted)";
};

const loadState = async () => {
  const [health, dashboard, partners, campaigns, policyChecks, settlements, retryJobs, auditEvents] = await Promise.all([
    api.get("/health"),
    api.get("/dashboard"),
    api.get("/partners"),
    api.get("/campaigns"),
    api.get("/policy-checks"),
    api.get("/settlements"),
    api.get("/settlements/retry-jobs?limit=12"),
    api.get("/audit-trail?page=1&pageSize=12"),
  ]);

  elements.healthText.textContent = health.ok ? "Operational" : "Unavailable";
  elements.healthDot.classList.toggle("ok", Boolean(health.ok));
  elements.healthDot.classList.toggle("down", !health.ok);

  renderSummary(dashboard);
  renderStatusStrip(dashboard, campaigns, partners, settlements);
  renderCampaigns(campaigns, policyChecks);
  renderPartners(partners);
  renderSettlements(settlements);
  renderRetryJobs(retryJobs);
  renderAuditTrail(auditEvents);
};

elements.refreshAll.addEventListener("click", () => {
  loadState().catch((error) => {
    console.error(error);
    setFeedback(elements.campaignFormResult, "刷新失败，请检查服务状态。", "error");
  });
});

elements.campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const payload = {
    advertiser: formData.get("advertiser"),
    category: formData.get("category"),
    regions: [formData.get("region")],
    billingModel: formData.get("billingModel"),
    payoutAmount: Number(formData.get("payoutAmount")),
    currency: "USD",
    budget: Number(formData.get("budget")),
    disclosureText: formData.get("disclosureText"),
    minTrust: 0.66,
    product: {
      name: formData.get("productName"),
      description: formData.get("description"),
      price: Number(formData.get("price")),
      currency: "USD",
      intendedFor: ["compare_and_shortlist", "vendor_discovery"],
      constraints: {
        company_size: "50-300",
      },
      claims: [formData.get("claim")],
      actionEndpoints: [formData.get("actionEndpoint")],
      positioningBullets: ["pipeline clarity", "measurable onboarding"],
    },
    proofReferences: [
      {
        label: "Primary proof",
        type: "doc",
        url: formData.get("proofUrl"),
      },
    ],
  };

  const response = await api.post("/campaigns", payload);
  if (!response.ok) {
    setFeedback(elements.campaignFormResult, `创建失败: HTTP ${response.status}`, "error");
    return;
  }

  const { campaign, policyCheck } = response.body;
  setFeedback(
    elements.campaignFormResult,
    `已创建 ${campaign.campaignId}，当前状态 ${campaign.status}，policy=${policyCheck.decision}`,
    "success",
  );
  await loadState();
});

elements.opportunityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const payload = {
    intentId: formData.get("intentId"),
    category: formData.get("category"),
    taskType: formData.get("taskType"),
    constraints: {
      geo: [formData.get("geo")],
    },
    placement: "shortlist",
    relevanceFloor: 0.72,
    utilityFloor: 0.68,
    sponsoredSlots: Number(formData.get("sponsoredSlots")),
    disclosureRequired: formData.get("disclosureRequired") === "true",
  };

  const response = await api.post("/opportunities/evaluate", payload);
  if (!response.ok) {
    setFeedback(elements.opportunityResult, `评估失败: HTTP ${response.status}`, "error");
    return;
  }

  renderShortlist(response.body);
  setFeedback(
    elements.opportunityResult,
    `返回 ${response.body.shortlisted.length} 个 shortlist 候选，eligible=${response.body.eligibleCandidates}`,
    "success",
  );
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const campaignId = button.dataset.campaignId;
  const action = button.dataset.action;
  if (!campaignId || !action || action === "receipt") {
    return;
  }

  const response = await api.post(`/campaigns/${campaignId}/${action}`, {});
  if (!response.ok && response.status !== 409) {
    setFeedback(elements.campaignFormResult, `${action} 失败: HTTP ${response.status}`, "error");
    return;
  }

  if (action === "activate" && response.status === 409) {
    setFeedback(
      elements.campaignFormResult,
      `Campaign ${campaignId} 未通过激活: ${response.body.policyCheck.decision}`,
      "error",
    );
  } else {
    setFeedback(elements.campaignFormResult, `Campaign ${campaignId} 已执行 ${action}。`, "success");
  }

  await loadState();
});

elements.processRetryQueue.addEventListener("click", async () => {
  const response = await api.post("/settlements/retry-queue/process", {
    limit: 20,
  });

  if (!response.ok) {
    setFeedback(elements.retryQueueResult, `处理失败: HTTP ${response.status}`, "error");
    return;
  }

  setFeedback(
    elements.retryQueueResult,
    `processed=${response.body.processedCount} settled=${response.body.settledCount} retried=${response.body.rescheduledCount} failed=${response.body.failedCount}`,
    "success",
  );
  await loadState();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='dispute-settlement']");
  if (!button) {
    return;
  }

  const settlementId = button.dataset.settlementId;
  if (!settlementId) {
    return;
  }

  const response = await api.post(`/settlements/${settlementId}/dispute`, {});
  if (!response.ok) {
    setFeedback(elements.retryQueueResult, `Dispute 失败: HTTP ${response.status}`, "error");
    return;
  }

  setFeedback(elements.retryQueueResult, `Settlement ${settlementId} 已标记为 disputed。`, "success");
  await loadState();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='receipt']");
  if (!button) {
    return;
  }

  const payload = {
    receiptId: button.dataset.receiptId,
    intentId: button.dataset.intentId,
    offerId: button.dataset.offerId,
    campaignId: button.dataset.campaignId,
    partnerId: button.dataset.partnerId,
    eventType: "shortlisted",
    occurredAt: new Date().toISOString(),
    signature: "sig_ui_demo",
  };

  const response = await api.post("/events/receipts", payload);
  if (!response.ok) {
    setFeedback(elements.opportunityResult, `回执失败: HTTP ${response.status}`, "error");
    return;
  }

  const settlement = response.body.settlement;
  setFeedback(
    elements.opportunityResult,
    response.body.deduplicated
      ? `回执命中幂等键，未重复写入。`
      : settlement
      ? `已创建 settlement ${settlement.settlementId}，金额 ${currency.format(settlement.amount)}`
      : "回执已记录，但当前计费模型不会在 shortlisted 事件结算。",
    response.body.deduplicated ? "info" : settlement ? "success" : "info",
  );
  await loadState();
});

loadState().catch((error) => {
  console.error(error);
  elements.healthText.textContent = "Unavailable";
  elements.healthDot.classList.add("down");
});

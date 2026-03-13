import { buildEvidenceDrilldownMarkup, createSourceContext } from "./drilldown-links.js";

const filterForm = document.querySelector("#pipelineFilters");
const pipelineSummary = document.querySelector("#pipelineSummary");
const processDueTasksButton = document.querySelector("#processDueTasks");
const pipelineBody = document.querySelector("#pipelineBody");
const pipelineDetail = document.querySelector("#pipelineDetail");
const outreachForm = document.querySelector("#outreachForm");
const outreachBody = document.querySelector("#outreachBody");
const outreachFeedback = document.querySelector("#outreachFeedback");
const taskForm = document.querySelector("#taskForm");
const taskBody = document.querySelector("#taskBody");
const taskFeedback = document.querySelector("#taskFeedback");
const readinessSummary = document.querySelector("#readinessSummary");
const appConfig = window.__PROMOTION_AGENT_CONFIG__ ?? { mode: "default" };
const pageParams = new URLSearchParams(window.location.search);

const state = {
  selectedPipelineId: null,
};

const runtime = {
  pipelines: [],
  outreachTargets: [],
  onboardingTasks: [],
  readiness: null,
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const badge = (value, label = value) => `<span class="badge ${String(value).toLowerCase()}">${escapeHtml(label)}</span>`;
const detailSection = (title, value) => `<section class="detail-section"><p class="detail-section-title">${escapeHtml(title)}</p><div class="detail-section-value">${value}</div></section>`;

const api = {
  get: async (path) => {
    const response = await fetch(path);
    return response.json();
  },
  post: async (path, payload) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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
    const label = appConfig.mode === "demo" ? "Demo Environment" : appConfig.mode === "real_test" ? "Real Test Environment" : "Default Environment";
    const tone = appConfig.mode === "demo" ? "reviewing" : appConfig.mode === "real_test" ? "active" : "draft";
    subtitle.insertAdjacentHTML("beforeend", ` <span data-environment-badge="true" class="badge ${tone}">${escapeHtml(label)}</span>`);
  }
};

const selectedPipeline = () =>
  runtime.pipelines.find((item) => item.pipelineId === state.selectedPipelineId) ?? runtime.pipelines[0] ?? null;

const renderPipelineSummary = () => {
  const counts = runtime.pipelines.reduce((acc, pipeline) => {
    acc[pipeline.stage] = (acc[pipeline.stage] ?? 0) + 1;
    return acc;
  }, {});
  pipelineSummary.innerHTML = [
    ["Pipelines", runtime.pipelines.length, "当前招募与接入流水线总数"],
    ["Outreach", counts.outreach ?? 0, "正在主动联系中的 buyer agent"],
    ["Onboarding", counts.onboarding ?? 0, "已进入技术/商务接入的对象"],
    ["Ready + Promoted", (counts.ready ?? 0) + (counts.promoted ?? 0), "已经可进入推广池的对象"],
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
};

const renderReadiness = () => {
  if (!runtime.readiness) {
    readinessSummary.innerHTML = `<div class="empty-state">选择一条 pipeline 查看 readiness。</div>`;
    return;
  }

  const checklist = Object.entries(runtime.readiness.checklist)
    .map(([key, value]) => `${key}: ${value ? "yes" : "no"}`)
    .join(" · ");

  readinessSummary.innerHTML = [
    ["Overall", runtime.readiness.overallStatus, "当前 readiness 状态"],
    ["Score", runtime.readiness.readinessScore.toFixed(2), "0-1 readiness score"],
    ["Checklist", checklist, "关键接入项是否就绪"],
    ["Blockers", runtime.readiness.blockers.length ? runtime.readiness.blockers.join(", ") : "none", "当前阻塞项"],
  ]
    .map(
      ([label, value, note]) => `
        <article class="list-card">
          <strong>${escapeHtml(label)}</strong>
          <div class="meta-row">${escapeHtml(value)}</div>
          <p class="meta-row">${escapeHtml(note)}</p>
        </article>
      `,
    )
    .join("");
};

const renderPipelineTable = () => {
  const requestedLeadId = pageParams.get("leadId");
  if (requestedLeadId) {
    const pipeline = runtime.pipelines.find((item) => item.leadId === requestedLeadId);
    if (pipeline) state.selectedPipelineId = pipeline.pipelineId;
  }
  if (!state.selectedPipelineId && runtime.pipelines.length) {
    state.selectedPipelineId = runtime.pipelines[0].pipelineId;
  }

  pipelineBody.innerHTML = runtime.pipelines
    .map(
      (pipeline) => `
        <tr class="${pipeline.pipelineId === state.selectedPipelineId ? "is-selected" : ""}">
          <td>
            <button class="row-button" data-select-pipeline="${escapeHtml(pipeline.pipelineId)}">
              <strong>${escapeHtml(pipeline.providerOrg)}</strong>
              <div class="meta-row">${escapeHtml(pipeline.leadId)}</div>
            </button>
          </td>
          <td>${badge(pipeline.stage)}</td>
          <td>${badge(pipeline.priority)}</td>
          <td>${escapeHtml(pipeline.ownerId ?? "-")}</td>
          <td>${escapeHtml(pipeline.nextStep ?? "-")}</td>
        </tr>
      `,
    )
    .join("");

  const pipeline = selectedPipeline();
  if (!pipeline) {
    pipelineDetail.innerHTML = `<div class="empty-state">暂无 pipeline 数据。</div>`;
    return;
  }

  pipelineDetail.innerHTML = `
    ${detailSection("Pipeline", `<h3 class="panel-title">${escapeHtml(pipeline.providerOrg)}</h3><p class="meta-row">${badge(pipeline.stage)} ${badge(pipeline.priority)} ${escapeHtml(pipeline.pipelineId)}</p>`)}
    ${detailSection("Owner", `<p class="meta-row">Owner: ${escapeHtml(pipeline.ownerId ?? "unassigned")}</p><p class="meta-row">Target Persona: ${escapeHtml(pipeline.targetPersona ?? "not set")}</p><p class="meta-row">Last Activity: ${new Date(pipeline.lastActivityAt).toLocaleString()}</p>`)}
    ${detailSection("Next Step", `<p class="meta-row">${escapeHtml(pipeline.nextStep ?? "No next step set.")}</p>`)}
    ${detailSection("Lead", `<div class="card-actions"><a class="button button-subtle" href="/agents?leadId=${encodeURIComponent(pipeline.leadId)}">Open Lead In CRM</a></div>`)}
    ${detailSection("Update Stage", `
      <form id="pipelineStageForm" class="form-grid">
        <label><span>Stage</span><select name="stage"><option value="sourced">sourced</option><option value="qualified">qualified</option><option value="outreach">outreach</option><option value="replied">replied</option><option value="onboarding">onboarding</option><option value="verified">verified</option><option value="ready">ready</option><option value="promoted">promoted</option><option value="blocked">blocked</option></select></label>
        <label><span>Priority</span><select name="priority"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></label>
        <label><span>Owner</span><input name="ownerId" value="${escapeHtml(pipeline.ownerId ?? "")}" /></label>
        <label><span>Persona</span><input name="targetPersona" value="${escapeHtml(pipeline.targetPersona ?? "")}" /></label>
        <label class="span-2"><span>Next Step</span><input name="nextStep" value="${escapeHtml(pipeline.nextStep ?? "")}" /></label>
        <div class="form-actions span-2"><button class="button button-primary" type="submit">更新 Pipeline</button><span id="pipelineFeedback" class="inline-feedback"></span></div>
      </form>
    `)}
  `;
  document.querySelector('#pipelineStageForm [name="stage"]').value = pipeline.stage;
  document.querySelector('#pipelineStageForm [name="priority"]').value = pipeline.priority;
};

const renderOutreachTargets = () => {
  outreachBody.innerHTML = runtime.outreachTargets
    .map(
      (target) => `
        <tr>
          <td><strong>${escapeHtml(target.channel)}</strong><div class="meta-row">${escapeHtml(target.providerOrg)}</div></td>
          <td>${badge(target.status)}</td>
          <td>
            <strong>${escapeHtml(target.subjectLine)}</strong>
            <div class="meta-row">${escapeHtml(target.contactPoint)}</div>
            <div class="meta-row">${escapeHtml(target.messageTemplate.slice(0, 140))}</div>
            <div class="meta-row">Campaign: ${escapeHtml(target.recommendedCampaignId ?? "none")}</div>
            <div class="meta-row">Reason: ${escapeHtml(target.recommendationReason ?? "n/a")}</div>
            <div class="meta-row">Proof: ${escapeHtml((target.proofHighlights ?? []).join(" | ") || "n/a")}</div>
            <div class="meta-row">${target.autoGenerated ? "Auto-generated draft" : "Manual draft"}</div>
          </td>
          <td>${escapeHtml(target.ownerId ?? "-")}</td>
          <td>
            <div class="card-actions">
              <button class="button button-primary" data-send-outreach="${escapeHtml(target.targetId)}">send</button>
              <button class="button button-subtle" data-open-outreach="${escapeHtml(target.targetId)}">open</button>
              <button class="button button-subtle" data-outreach-status="${escapeHtml(target.targetId)}" data-status="replied">replied</button>
              <button class="button button-subtle" data-outreach-status="${escapeHtml(target.targetId)}" data-status="ignored">ignored</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("") || `<tr><td colspan="5"><div class="empty-state">暂无 outreach 目标。</div></td></tr>`;
};

const renderOnboardingTasks = () => {
  taskBody.innerHTML = runtime.onboardingTasks
    .map(
      (task) => `
        <tr>
          <td><strong>${escapeHtml(task.taskType)}</strong><div class="meta-row">${task.autoGenerated ? "Auto-generated" : "Manual"}${task.relatedTargetId ? ` · target ${escapeHtml(task.relatedTargetId)}` : ""}</div><div class="meta-row">${escapeHtml(task.notes ?? "-")}</div></td>
          <td>${badge(task.status)}</td>
          <td>${escapeHtml(task.ownerId ?? "-")}</td>
          <td>${buildEvidenceDrilldownMarkup(task.evidenceRef, createSourceContext({
            href: `/agents/pipeline?leadId=${encodeURIComponent(task.leadId)}`,
            label: `${selectedPipeline()?.providerOrg ?? "Pipeline"} Recruitment Pipeline`,
            type: "recruitment_pipeline",
            id: task.pipelineId,
          }))}</td>
          <td>
            <div class="card-actions">
              <button class="button button-subtle" data-task-status="${escapeHtml(task.taskId)}" data-status="in_progress">in_progress</button>
              <button class="button button-subtle" data-task-status="${escapeHtml(task.taskId)}" data-status="blocked">blocked</button>
              <button class="button button-primary" data-task-status="${escapeHtml(task.taskId)}" data-status="done">done</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("") || `<tr><td colspan="5"><div class="empty-state">暂无 onboarding task。</div></td></tr>`;
};

const render = () => {
  renderPipelineSummary();
  renderPipelineTable();
  renderReadiness();
  renderOutreachTargets();
  renderOnboardingTasks();
};

const load = async () => {
  decorateEnvironment();
  const data = new FormData(filterForm);
  const query = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (String(value).trim()) query.set(key, String(value));
  }
  runtime.pipelines = await api.get(`/recruitment/pipelines?${query.toString()}`);
  const pipeline = selectedPipeline();
  if (pipeline) {
    const [outreachTargets, onboardingTasks, readiness] = await Promise.all([
      api.get(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/outreach-targets`),
      api.get(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/onboarding-tasks`),
      api.get(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/readiness`),
    ]);
    runtime.outreachTargets = outreachTargets;
    runtime.onboardingTasks = onboardingTasks;
    runtime.readiness = readiness;
  } else {
    runtime.outreachTargets = [];
    runtime.onboardingTasks = [];
    runtime.readiness = null;
  }
  render();
};

filterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.selectedPipelineId = null;
  await load();
});

outreachForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pipeline = selectedPipeline();
  if (!pipeline) return;
  const data = new FormData(outreachForm);
  const response = await api.post(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/outreach-targets`, {
    recommendedCampaignId: null,
    channel: data.get("channel"),
    contactPoint: data.get("contactPoint"),
    subjectLine: data.get("subjectLine") || null,
    messageTemplate: data.get("messageTemplate"),
    recommendationReason: null,
    proofHighlights: [],
    ownerId: pipeline.ownerId,
    notes: null,
  });
  outreachFeedback.textContent = response.ok ? "Outreach target created." : response.body?.message ?? "Create failed.";
  outreachFeedback.style.color = response.ok ? "var(--success)" : "var(--danger)";
  if (response.ok) {
    outreachForm.reset();
    await load();
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pipeline = selectedPipeline();
  if (!pipeline) return;
  const data = new FormData(taskForm);
  const rawDueAt = String(data.get("dueAt") ?? "").trim();
  const response = await api.post(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/onboarding-tasks`, {
    taskType: data.get("taskType"),
    ownerId: pipeline.ownerId,
    dueAt: rawDueAt ? new Date(rawDueAt).toISOString() : null,
    notes: data.get("notes") || null,
    evidenceRef: null,
  });
  taskFeedback.textContent = response.ok ? "Onboarding task created." : response.body?.message ?? "Create failed.";
  taskFeedback.style.color = response.ok ? "var(--success)" : "var(--danger)";
  if (response.ok) {
    taskForm.reset();
    await load();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "pipelineStageForm") return;
  event.preventDefault();
  const pipeline = selectedPipeline();
  if (!pipeline) return;
  const data = new FormData(event.target);
  const response = await api.post(`/recruitment/pipelines/${encodeURIComponent(pipeline.pipelineId)}/stage`, {
    stage: data.get("stage"),
    priority: data.get("priority"),
    ownerId: data.get("ownerId") || null,
    targetPersona: data.get("targetPersona") || null,
    nextStep: data.get("nextStep") || null,
  });
  const feedback = document.querySelector("#pipelineFeedback");
  feedback.textContent = response.ok ? "Pipeline updated." : response.body?.message ?? "Update failed.";
  feedback.style.color = response.ok ? "var(--success)" : "var(--danger)";
  if (response.ok) await load();
});

document.addEventListener("click", async (event) => {
  const pipelineButton = event.target.closest("[data-select-pipeline]");
  const sendOutreachButton = event.target.closest("[data-send-outreach]");
  const openOutreachButton = event.target.closest("[data-open-outreach]");
  const outreachStatusButton = event.target.closest("[data-outreach-status]");
  const taskStatusButton = event.target.closest("[data-task-status]");

  if (pipelineButton) {
    state.selectedPipelineId = pipelineButton.dataset.selectPipeline;
    await load();
    return;
  }

  if (sendOutreachButton) {
    await api.post(`/outreach-targets/${encodeURIComponent(sendOutreachButton.dataset.sendOutreach)}/send`, {});
    await load();
    return;
  }

  if (openOutreachButton) {
    await api.post(`/outreach-targets/${encodeURIComponent(openOutreachButton.dataset.openOutreach)}/open`, {
      source: "ui",
    });
    await load();
    return;
  }

  if (outreachStatusButton) {
    await api.post(`/outreach-targets/${encodeURIComponent(outreachStatusButton.dataset.outreachStatus)}/status`, {
      status: outreachStatusButton.dataset.status,
      notes: null,
    });
    await load();
    return;
  }

  if (taskStatusButton) {
    await api.post(`/onboarding-tasks/${encodeURIComponent(taskStatusButton.dataset.taskStatus)}/status`, {
      status: taskStatusButton.dataset.status,
      notes: null,
      evidenceRef: null,
    });
    await load();
  }
});

processDueTasksButton?.addEventListener("click", async () => {
  await api.post("/recruitment/tasks/process-due", {});
  await load();
});

load().catch(console.error);

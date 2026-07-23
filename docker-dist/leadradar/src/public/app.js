import {
  OPS_POLL_INTERVAL_MS,
  mergeOpenOpsFieldIds,
  shouldContinueOpsPoll,
} from "./ops-console-ui.js";

const $ = (id) => document.getElementById(id);

const THEME_KEY = "leadradar-theme";

function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {
    /* ignore quota / private mode */
  }
  const btn = $("btn-theme");
  if (btn) {
    btn.setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    btn.title = next === "dark" ? "Light mode" : "Dark mode";
  }
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

let projects = [];
let currentProjectId = null;
let leads = [];
let selectedLeadId = null;
let leadLists = [];
let selectedLeadListId = null;
let activeLeadListId = null;
let currentPlanState = null;
const EXPECTED_API_VERSION = 2;
let actorCatalog = [];
let currentLeadStrategy = null;
let opsPollTimer = null;
let suppressProjectChange = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || res.statusText);
    }
    return body;
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        "API not found — restart the dashboard (npm run dashboard:dev) to load the latest server code."
      );
    }
    throw new Error(res.statusText);
  }
  return res;
}

function toast(msg, kind = "info") {
  const host = $("toast-host");
  const el = document.createElement("div");
  el.className = `toast${kind === "error" ? " error" : kind === "success" ? " success" : ""}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3200);
}

function filterQuery() {
  const params = new URLSearchParams();
  const status = $("filter-status").value;
  const minScore = $("filter-min-score").value;
  const q = $("filter-q").value.trim();
  if (status) params.set("status", status);
  if (minScore !== "") params.set("minScore", minScore);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `?${s}` : "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusPill(status) {
  const s = String(status || "");
  const cls =
    s === "gated"
      ? "pill-gated"
      : s === "provisional"
        ? "pill-provisional"
        : s === "scored"
          ? "pill-scored"
          : s === "approved"
            ? "pill-approved"
            : s === "rejected"
              ? "pill-rejected"
              : "pill-default";
  return `<span class="pill ${cls}">${escapeHtml(s || "—")}</span>`;
}

function scoreCell(score) {
  if (score == null || score === "") {
    return `<div class="score-cell"><span class="score-num muted">—</span></div>`;
  }
  const n = Number(score);
  const pct = Math.max(0, Math.min(100, n));
  const tier = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
  return `<div class="score-cell">
    <span class="score-num">${escapeHtml(String(score))}</span>
    <div class="score-meter ${tier}"><span style="width:${pct}%"></span></div>
  </div>`;
}

function updateBrandProject() {
  const p = projects.find((x) => x.id === currentProjectId);
  $("brand-project").textContent = p ? p.name : "Select a project";
}

function updateResultCount() {
  const n = leads.length;
  $("result-count").textContent = `${n} lead${n === 1 ? "" : "s"}`;
}

const VOLUME_STEPS = [25, 50, 100, 250, 500, 1000, 2000];

function parseLeadPlanJson(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function clampVolume(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return 100;
  let best = VOLUME_STEPS[0];
  let bestDist = Math.abs(num - best);
  for (const step of VOLUME_STEPS) {
    const dist = Math.abs(num - step);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

function fillProjectFields(form, project) {
  form.elements.namedItem("name").value = project?.name || "";
  const website = form.elements.namedItem("website");
  if (website) website.value = project?.website || "";
  const description = form.elements.namedItem("description");
  if (description) description.value = project?.description || "";
  const icp = form.elements.namedItem("icp");
  if (icp) icp.value = project?.icp || "";
  const plan = parseLeadPlanJson(project?.leadPlan);
  const geography = form.elements.namedItem("geography");
  if (geography) geography.value = plan?.geography || "";
  const volume = form.elements.namedItem("volumeTarget");
  if (volume) volume.value = String(clampVolume(plan?.volumeTarget ?? 100));
}

function displayListName(name) {
  return name === "Default" ? "Project list" : name;
}

function listApiBase() {
  if (!currentProjectId || !selectedLeadListId) return null;
  return `/api/projects/${currentProjectId}/lead-lists/${selectedLeadListId}`;
}

function planStateLabel(state) {
  switch (state) {
    case "ready":
      return "Ready";
    case "stale":
      return "Stale";
    case "draft":
      return "Draft";
    case "none":
      return "No plan";
    default:
      return "—";
  }
}

function planStateClass(state) {
  return state ? `state-${state}` : "";
}

function sortListsForSidebar(lists) {
  return [...lists].sort((a, b) => {
    const aDefault = a.name === "Default" ? 0 : 1;
    const bDefault = b.name === "Default" ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    return a.id - b.id;
  });
}

function updateFindLeadsButton() {
  const btn = $("btn-find-leads");
  if (!btn) return;
  const canFind =
    currentProjectId && selectedLeadListId && currentPlanState === "ready";
  btn.disabled = !canFind;
  btn.title = canFind
    ? "Run Apify discovery using this list's plan"
    : currentPlanState === "stale"
      ? "Plan is stale — regenerate before finding leads"
      : currentPlanState === "none"
        ? "Generate a plan for this list first"
        : "Select a list with a ready plan";
}

async function checkApiVersion() {
  try {
    const info = await api("/api/version");
    if (info.version < EXPECTED_API_VERSION) {
      toast(
        "Server restart required — dashboard API is outdated. Run npm run dashboard:dev",
        "error"
      );
      return false;
    }
    return true;
  } catch (_) {
    toast(
      "Could not verify API version — restart the dashboard if list features fail",
      "error"
    );
    return false;
  }
}

function setPlanControlsEnabled(on) {
  $("btn-regen-plan").disabled = !on;
  $("btn-plan-feedback").disabled = !on;
  $("lead-plan-feedback").disabled = !on;
  $("btn-refresh-activity").disabled = !on;
  $("btn-refresh-website").disabled = !on;
  $("btn-new-list").disabled = !on;
  $("btn-list-settings").disabled = !on;
  $("btn-clear-list").disabled = !on;
  $("btn-delete-list").disabled = !on;
  $("ops-run-select").disabled = !on;
  if ($("ops-type-filter")) $("ops-type-filter").disabled = !on;
  updateFindLeadsButton();
}

function renderPlanJobs(jobs) {
  const container = $("lead-plan-jobs");
  if (!container) return;
  if (!jobs?.length) {
    container.innerHTML =
      '<p class="plan-jobs-empty muted">Regenerate plan to preview Apify jobs for this list.</p>';
    return;
  }
  container.innerHTML = jobs
    .map(
      (job) => `<article class="plan-job-card">
        <div class="plan-job-head">
          <span class="plan-job-actor">${escapeHtml(job.actorLabel || job.actorKey)}</span>
          <span class="plan-job-id muted">${escapeHtml(job.actorId || "")}</span>
        </div>
        <p class="plan-job-reason">${escapeHtml(job.reasoning || "")}</p>
        <p class="plan-job-params muted">${escapeHtml(job.paramSummary || "")}</p>
        <details>
          <summary>Full Apify input</summary>
          <pre>${escapeHtml(JSON.stringify(job.apifyInput || {}, null, 2))}</pre>
        </details>
      </article>`
    )
    .join("");
}

function syncPlanFeedbackTextarea(notes) {
  const el = $("lead-plan-feedback");
  if (el) el.value = notes || "";
}

function renderLeadPlan(plan, extra = {}) {
  const stateEl = $("lead-plan-state");
  const goal = $("lead-plan-goal");
  const focus = $("lead-plan-focus");
  const meta = $("lead-plan-meta");
  const angles = $("lead-plan-angles");
  const sources = $("lead-plan-sources");
  const website = $("lead-plan-website");
  const listNameEl = $("lead-plan-list-name");
  const staleBanner = $("lead-plan-stale-banner");
  const lastGenerated = $("lead-plan-last-generated");
  const emptyEl = $("lead-plan-empty");
  const displayName =
    extra.leadListDisplayName ||
    displayListName(extra.leadListName || "");
  currentPlanState = extra.planState || (plan ? "draft" : "none");
  if (listNameEl) listNameEl.textContent = displayName || "—";
  if (stateEl) {
    stateEl.textContent = planStateLabel(currentPlanState);
    stateEl.className = `plan-state-chip ${planStateClass(currentPlanState)}`;
  }
  if (staleBanner) {
    if (currentPlanState === "stale" && extra.staleReason) {
      staleBanner.textContent = `Plan is stale: ${extra.staleReason}`;
      staleBanner.classList.remove("hidden");
    } else {
      staleBanner.textContent = "";
      staleBanner.classList.add("hidden");
    }
  }
  if (lastGenerated) {
    lastGenerated.textContent = extra.planUpdatedAt
      ? `Last generated: ${extra.planUpdatedAt}`
      : plan?.updatedAt
        ? `Last generated: ${plan.updatedAt}`
        : "";
  }
  updateFindLeadsButton();
  if (!plan) {
    goal.textContent = currentProjectId
      ? extra.isDefaultList === false
        ? "This list has not been planned yet."
        : "No plan for this list yet. Regenerate plan or create one from list settings."
      : "Create or open a project to draft a plan.";
    if (emptyEl) {
      if (currentProjectId && extra.isDefaultList === false) {
        emptyEl.textContent =
          "Generate a plan for this list before finding leads. Use Regenerate plan or create a new list with hunt settings.";
        emptyEl.classList.remove("hidden");
      } else {
        emptyEl.textContent = "";
        emptyEl.classList.add("hidden");
      }
    }
    if (focus) {
      focus.textContent = extra.listDescription
        ? `Focus: ${extra.listDescription}`
        : "";
    }
    meta.innerHTML = "";
    angles.innerHTML = "";
    if (sources) sources.textContent = "";
    if (website) website.textContent = "";
    renderPlanJobs([]);
    syncPlanFeedbackTextarea("");
    return;
  }
  if (emptyEl) {
    emptyEl.textContent = "";
    emptyEl.classList.add("hidden");
  }
  goal.textContent = plan.goal || "—";
  if (focus) {
    focus.textContent = extra.listDescription
      ? `Focus: ${extra.listDescription}`
      : "";
  }
  meta.innerHTML = `
    <div><dt>Volume</dt><dd>${escapeHtml(String(plan.volumeTarget ?? "—"))}</dd></div>
    <div><dt>Geography</dt><dd>${escapeHtml(plan.geography || "Any")}</dd></div>
    <div><dt>Negatives</dt><dd>${escapeHtml((plan.negatives || []).join(", ") || "—")}</dd></div>
    <div><dt>Feedback</dt><dd>${escapeHtml(plan.feedbackNotes || "—")}</dd></div>
  `;
  angles.innerHTML = (plan.searchAngles || [])
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");
  const keys =
    extra.resolvedHuntConfig?.enabledActorKeys ||
    extra.leadStrategy?.enabledActorKeys ||
    currentLeadStrategy?.enabledActorKeys ||
    [];
  if (sources) {
    sources.textContent = keys.length
      ? `Sources: ${keys.join(", ")}`
      : "";
  }
  if (website) {
    const summary = extra.websiteSummary || "";
    const at = extra.websiteSummaryAt
      ? ` (refreshed ${extra.websiteSummaryAt})`
      : "";
    website.textContent = summary
      ? `Project website summary: ${summary.slice(0, 220)}${summary.length > 220 ? "…" : ""}${at}`
      : "";
  }
  renderPlanJobs(extra.jobs || []);
  syncPlanFeedbackTextarea(plan.feedbackNotes);
}

function jsonField(label, value) {
  if (value == null) return "";
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const id = `ops-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return `<details>
    <summary>${escapeHtml(label)} <button type="button" class="ghost ops-copy" data-copy="${escapeHtml(id)}">Copy</button></summary>
    <pre id="${escapeHtml(id)}">${escapeHtml(text)}</pre>
  </details>`;
}

function collectOpenOpsFieldIds(fieldsEl) {
  if (!fieldsEl) return [];
  return [...fieldsEl.querySelectorAll("details[open] pre[id]")].map(
    (pre) => pre.id
  );
}

function restoreOpenOpsFields(fieldsEl, openIds) {
  if (!fieldsEl || !openIds?.length) return;
  const available = [...fieldsEl.querySelectorAll("pre[id]")].map((pre) => pre.id);
  for (const id of mergeOpenOpsFieldIds(openIds, available)) {
    const pre = fieldsEl.querySelector(`#${CSS.escape(id)}`);
    const details = pre?.closest("details");
    if (details) details.open = true;
  }
}

function renderActivity(payload) {
  const summary = $("activity-summary");
  const timeline = $("activity-timeline");
  const rejected = $("activity-rejected");
  const kept = $("activity-kept");
  const fields = $("ops-fields");
  if (!payload?.run) {
    summary.textContent = "No discovery runs yet.";
    timeline.innerHTML = "";
    if (fields) fields.innerHTML = "";
    rejected.classList.add("hidden");
    rejected.innerHTML = "";
    if (kept) {
      kept.classList.add("hidden");
      kept.innerHTML = "";
    }
    return;
  }
  const run = payload.run;
  summary.textContent = `Run #${run.id} · ${run.status} · fetched ${run.fetchedCount}, kept ${run.keptCount}, rejected ${run.rejectedCount}, duplicates ${run.duplicateCount}`;
  if (
    typeof run.validationNotes === "string" &&
    run.validationNotes.includes("circuit_breaker")
  ) {
    summary.textContent += " · circuit breaker tripped";
  }
  timeline.innerHTML = (payload.timeline || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  if (fields) {
    const openIds = collectOpenOpsFieldIds(fields);
    fields.innerHTML = [
      jsonField("Planner input", payload.plannerInput),
      jsonField("Raw Hermes output", payload.plannerRaw),
      jsonField("Validated payload", payload.validatedPayload),
      jsonField("Compiled Apify jobs", payload.compiledJobs),
      jsonField("Validation notes", payload.validationNotes),
      jsonField("Job table", payload.jobs),
    ].join("");
    restoreOpenOpsFields(fields, openIds);
    fields.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pre = $(btn.getAttribute("data-copy"));
        if (pre) {
          navigator.clipboard?.writeText(pre.textContent || "");
          toast("Copied", "success");
        }
      });
    });
  }
  const samples = payload.rejectedSamples || [];
  if (!samples.length) {
    rejected.classList.add("hidden");
    rejected.innerHTML = "";
  } else {
    rejected.classList.remove("hidden");
    rejected.innerHTML = `<p class="muted">Rejected samples</p><ul>${samples
      .map(
        (s) =>
          `<li>${escapeHtml(s.company || s.website || "—")}${
            s.reason ? ` — ${escapeHtml(s.reason)}` : ""
          }</li>`
      )
      .join("")}</ul>`;
  }
  const keptSamples = payload.keptSamples || [];
  if (kept) {
    if (!keptSamples.length) {
      kept.classList.add("hidden");
      kept.innerHTML = "";
    } else {
      kept.classList.remove("hidden");
      kept.innerHTML = `<p class="muted">Kept samples</p><ul>${keptSamples
        .map(
          (s) =>
            `<li>${escapeHtml(s.company || "—")}${
              s.website ? ` — ${escapeHtml(s.website)}` : ""
            }</li>`
        )
        .join("")}</ul>`;
    }
  }
}

async function loadLeadPlan() {
  if (!currentProjectId || !selectedLeadListId) {
    setPlanControlsEnabled(false);
    currentPlanState = null;
    renderLeadPlan(null);
    updateFindLeadsButton();
    return;
  }
  setPlanControlsEnabled(true);
  try {
    const base = listApiBase();
    const data = await api(`${base}/lead-plan`);
    if (data.leadListId == null && data.leadListDisplayName == null) {
      toast(
        "Server restart required — list-scoped plan API not available",
        "error"
      );
      return;
    }
    currentLeadStrategy = data.leadStrategy || null;
    renderLeadPlan(data.plan, data);
  } catch (err) {
    renderLeadPlan(null);
    toast(err.message || String(err), "error");
  }
}

function renderListSidebar() {
  const host = $("list-sidebar-cards");
  const sel = $("lead-list-select");
  if (!host) return;
  if (!currentProjectId || !leadLists.length) {
    host.innerHTML = `<p class="muted list-sidebar-empty">No lists yet.</p>`;
    if (sel) sel.innerHTML = "";
    return;
  }
  const sorted = sortListsForSidebar(leadLists);
  host.innerHTML = sorted
    .map((l) => {
      const selected = l.id === selectedLeadListId;
      const state = l.planState || "none";
      const runLabel = l.lastRun
        ? `Last run #${l.lastRun.id} · ${l.lastRun.status}`
        : "No runs yet";
      return `<button type="button" class="list-card${
        selected ? " selected" : ""
      }${l.name === "Default" ? " pinned" : ""}" data-list-id="${l.id}">
        <span class="list-card-name">${escapeHtml(displayListName(l.name))}</span>
        <span class="list-card-meta">
          <span>${l.leadCount ?? 0} leads</span>
          <span class="list-card-state ${planStateClass(state)}">${escapeHtml(planStateLabel(state))}</span>
          <span>${escapeHtml(runLabel)}</span>
        </span>
      </button>`;
    })
    .join("");
  host.querySelectorAll("[data-list-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectLeadList(Number(btn.getAttribute("data-list-id")));
    });
  });
  if (sel) {
    sel.innerHTML = sorted
      .map(
        (l) =>
          `<option value="${l.id}" ${
            l.id === selectedLeadListId ? "selected" : ""
          }>${escapeHtml(displayListName(l.name))}</option>`
      )
      .join("");
  }
}

async function selectLeadList(listId, options = {}) {
  if (!currentProjectId || !listId) return;
  selectedLeadListId = listId;
  activeLeadListId = listId;
  if (options.persist !== false) {
    try {
      await api(
        `/api/projects/${currentProjectId}/lead-lists/${listId}/activate`,
        { method: "POST", body: "{}" }
      );
    } catch (_) {
      /* preference only */
    }
  }
  renderListSidebar();
  selectedLeadId = null;
  await loadStats();
  await loadLeads();
  await loadLeadPlan();
  await loadOpsRuns();
  await loadActivity();
  if (options.toast) toast("Switched lead list", "success");
}

async function loadLeadLists() {
  if (!currentProjectId) {
    leadLists = [];
    selectedLeadListId = null;
    activeLeadListId = null;
    renderListSidebar();
    return;
  }
  try {
    const data = await api(`/api/projects/${currentProjectId}/lead-lists`);
    leadLists = data.lists || [];
    activeLeadListId = data.activeLeadListId;
    if (
      !selectedLeadListId ||
      !leadLists.some((l) => l.id === selectedLeadListId)
    ) {
      selectedLeadListId = activeLeadListId;
    }
    if (
      leadLists.length &&
      (!selectedLeadListId ||
        !leadLists.some((l) => l.id === selectedLeadListId))
    ) {
      selectedLeadListId = sortListsForSidebar(leadLists)[0]?.id ?? null;
    }
    renderListSidebar();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
}

async function loadOpsRuns() {
  const sel = $("ops-run-select");
  const filter = $("ops-type-filter")?.value || "all";
  if (!currentProjectId) {
    sel.innerHTML = "";
    return;
  }
  try {
    let path = `/api/projects/${currentProjectId}/ops/runs?type=${filter}`;
    if (filter === "discovery") {
      path = `${listApiBase()}/discovery/runs`;
    }
    const data = await api(path);
    const runs = data.runs || [];
    sel.innerHTML = [
      `<option value="latest">Latest</option>`,
      ...runs.map((r) => {
        const typeLabel = r.runType ? ` · ${r.runType}` : "";
        const keptLabel = r.keptCount !== undefined ? ` · kept ${r.keptCount}` : "";
        return `<option value="${r.id}">#${r.id}${typeLabel} · ${escapeHtml(r.status)}${keptLabel}</option>`;
      }),
    ].join("");
    $("ops-type-filter").disabled = false;
    sel.disabled = false;
    $("btn-refresh-activity").disabled = false;
  } catch (_) {
    sel.innerHTML = `<option value="latest">Latest</option>`;
  }
}

async function loadActivity(runId) {
  if (!currentProjectId) {
    renderActivity(null);
    clearOpsPoll();
    return;
  }
  const filter = $("ops-type-filter")?.value || "all";
  try {
    let path;
    if (filter === "discovery") {
      path =
        runId && runId !== "latest"
          ? `/api/projects/${currentProjectId}/discovery/runs/${runId}`
          : `${listApiBase()}/discovery/latest`;
    } else {
      let targetId = runId;
      if (!targetId || targetId === "latest") {
        let sel = $("ops-run-select");
        if (!sel || sel.options.length <= 1) {
          await loadOpsRuns();
          sel = $("ops-run-select");
        }
        const firstVal = sel?.options[1]?.value;
        if (firstVal) {
          targetId = firstVal;
        }
      }
      if (targetId && targetId !== "latest") {
        path = `/api/projects/${currentProjectId}/ops/runs/${targetId}`;
      } else {
        renderActivity(null);
        clearOpsPoll();
        return;
      }
    }
    const data = await api(path);
    renderActivity(data);
    if (shouldContinueOpsPoll(data?.run?.status)) {
      scheduleOpsPoll();
    } else {
      clearOpsPoll();
    }
  } catch (err) {
    renderActivity(null);
    clearOpsPoll();
  }
}

function clearOpsPoll() {
  if (opsPollTimer) {
    clearTimeout(opsPollTimer);
    opsPollTimer = null;
  }
}

function scheduleOpsPoll() {
  clearOpsPoll();
  opsPollTimer = setTimeout(() => {
    const runId = $("ops-run-select")?.value || "latest";
    loadActivity(runId);
  }, OPS_POLL_INTERVAL_MS);
}

async function loadActorCatalog() {
  try {
    const data = await api("/api/actor-catalog");
    actorCatalog = data.actors || [];
  } catch (_) {
    actorCatalog = [
      { key: "google_maps", label: "Google Maps" },
      { key: "wellfound_startups", label: "Wellfound startups" },
      { key: "google_search", label: "Google Search" },
      { key: "linkedin_jobs", label: "LinkedIn jobs" },
    ];
  }
}

function renderEnabledSources(container, selectedKeys) {
  const keys = new Set(selectedKeys || ["google_maps", "wellfound_startups"]);
  container.innerHTML = actorCatalog
    .map(
      (a) => `<label>
        <input type="checkbox" name="enabledActor" value="${escapeHtml(a.key)}" ${
          keys.has(a.key) ? "checked" : ""
        } />
        ${escapeHtml(a.label || a.key)}
      </label>`
    )
    .join("");
}

function selectedEnabledActors(form) {
  return [...form.querySelectorAll('input[name="enabledActor"]:checked')].map(
    (el) => el.value
  );
}

function openNewProjectDialog() {
  const backdrop = $("new-project-backdrop");
  backdrop.classList.add("open");
  backdrop.removeAttribute("inert");
  const form = $("new-project-form");
  form.reset();
  form.elements.namedItem("volumeTarget").value = "100";
  form.querySelector('input[name="name"]')?.focus();
}

function closeNewProjectDialog() {
  const backdrop = $("new-project-backdrop");
  backdrop.classList.remove("open");
  backdrop.setAttribute("inert", "");
  $("new-project-form").reset();
}

async function openSettingsDialog() {
  if (!currentProjectId) {
    toast("Select a project first", "error");
    return;
  }
  try {
    if (!actorCatalog.length) await loadActorCatalog();
    const project = await api(`/api/projects/${currentProjectId}`);
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) projects[idx] = project;
    fillProjectFields($("settings-form"), project);
    let strategy = null;
    try {
      strategy = project.leadStrategy
        ? JSON.parse(project.leadStrategy)
        : currentLeadStrategy;
    } catch (_) {
      strategy = currentLeadStrategy;
    }
    renderEnabledSources(
      $("settings-enabled-sources"),
      strategy?.enabledActorKeys || ["google_maps", "wellfound_startups"]
    );
    $("btn-delete-project").disabled = false;
    const backdrop = $("settings-backdrop");
    backdrop.classList.add("open");
    backdrop.removeAttribute("inert");
    $("settings-form").elements.namedItem("name")?.focus();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
}

function closeSettingsDialog() {
  const backdrop = $("settings-backdrop");
  backdrop.classList.remove("open");
  backdrop.setAttribute("inert", "");
}

function toggleShortcutPanel() {
  $("shortcut-panel").classList.toggle("hidden");
}

async function loadMe() {
  const me = await api("/api/me");
  $("user-info").textContent = `${me.name || me.email} · ${me.email}`;
  const health = await fetch("/health").then((r) => r.json());
  if (health.bypass) $("bypass-banner").classList.remove("hidden");
}

async function loadProjects() {
  projects = await api("/api/projects");
  const sel = $("project-select");
  sel.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = `${p.name} (#${p.id})`;
    sel.appendChild(opt);
  }
  if (!projects.length) {
    currentProjectId = null;
    updateBrandProject();
    setPlanControlsEnabled(false);
    $("btn-delete-project").disabled = true;
    renderLeadPlan(null);
    renderActivity(null);
    return;
  }
  if (!currentProjectId || !projects.some((p) => p.id === currentProjectId)) {
    currentProjectId = projects[0].id;
  }
  suppressProjectChange = true;
  sel.value = String(currentProjectId);
  suppressProjectChange = false;
  updateBrandProject();
}

async function loadStats() {
  if (!currentProjectId || !selectedLeadListId) {
    $("kpi-total").textContent = "—";
    $("kpi-new").textContent = "—";
    $("kpi-approval").textContent = "—";
    $("kpi-reply").textContent = "—";
    $("kpi-approval-wrap").classList.remove("tint-ok", "tint-warn");
    return;
  }
  const s = await api(`${listApiBase()}/stats`);
  $("kpi-total").textContent = String(s.totalLeads);
  $("kpi-new").textContent = String(s.newThisWeek);
  $("kpi-approval").textContent =
    s.approvalRate == null ? "—" : `${Math.round(s.approvalRate * 100)}%`;
  $("kpi-reply").textContent = s.replyRate == null ? "—" : String(s.replyRate);

  const wrap = $("kpi-approval-wrap");
  wrap.classList.remove("tint-ok", "tint-warn");
  if (s.approvalRate != null) {
    wrap.classList.add(s.approvalRate >= 0.5 ? "tint-ok" : "tint-warn");
  }
}

function sortedLeads() {
  return [...leads].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

function renderLeads() {
  const body = $("leads-body");
  body.innerHTML = "";
  const sorted = sortedLeads();
  const empty = $("table-empty");

  if (!currentProjectId) {
    empty.textContent = "Create or select a project to see leads.";
    empty.classList.remove("hidden");
    updateResultCount();
    return;
  }

  if (!sorted.length) {
    const hasFilters =
      $("filter-status").value ||
      $("filter-min-score").value !== "" ||
      $("filter-q").value.trim();
    empty.textContent = hasFilters
      ? "No leads match these filters."
      : "No leads yet. Click Find leads to run Apify discovery.";
    empty.classList.remove("hidden");
    updateResultCount();
    return;
  }

  empty.classList.add("hidden");
  for (const lead of sorted) {
    const tr = document.createElement("tr");
    if (lead.id === selectedLeadId) tr.classList.add("selected");
    tr.dataset.leadId = String(lead.id);

    const enrichedCell = lead.enriched
      ? `<span class="status-pill status-approved" style="font-size:0.72rem; padding: 2px 6px;">Yes</span>`
      : `<span style="opacity:0.35;">—</span>`;
    const contactsCell = (lead.contactsCount || 0) > 0
      ? `<span class="status-pill status-approved" style="font-size:0.72rem; padding: 2px 6px;">Yes (${lead.contactsCount})</span>`
      : `<span style="opacity:0.35;">—</span>`;

    tr.innerHTML = `
      <td><span class="company-cell" title="${escapeHtml(lead.company)}">${escapeHtml(lead.company)}</span></td>
      <td title="${escapeHtml(lead.email || "")}">${escapeHtml(lead.email || "")}</td>
      <td>${scoreCell(lead.score)}</td>
      <td>${statusPill(lead.status)}</td>
      <td>${enrichedCell}</td>
      <td>${contactsCell}</td>
      <td class="sources-cell">${escapeHtml((lead.sources || []).join(", "))}</td>`;
    tr.addEventListener("click", () => selectLead(lead.id));
    body.appendChild(tr);
  }
  updateResultCount();
}

function formatWebsiteLabel(raw) {
  const text = String(raw || "");
  try {
    const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const u = new URL(href);
    const rest = `${u.pathname}${u.search}`;
    if (rest.length <= 1) return u.host;
    const clipped = rest.length > 32 ? `${rest.slice(0, 32)}…` : rest;
    return `${u.host}${clipped}`;
  } catch {
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
}

function selectLead(id) {
  selectedLeadId = id;
  const lead = leads.find((l) => l.id === id);
  renderLeads();
  if (!lead) {
    $("detail-empty").classList.remove("hidden");
    $("detail-body").classList.add("hidden");
    return;
  }
  $("detail-empty").classList.add("hidden");
  $("detail-body").classList.remove("hidden");
  $("detail-company").textContent = lead.company;

  const meta = $("detail-meta");
  meta.innerHTML = "";

  const row1 = document.createElement("div");
  row1.className = "detail-meta-row";
  if (lead.website) {
    const a = document.createElement("a");
    const href = /^https?:\/\//i.test(lead.website)
      ? lead.website
      : `https://${lead.website}`;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = formatWebsiteLabel(lead.website);
    a.title = lead.website;
    row1.appendChild(a);
  } else {
    const span = document.createElement("span");
    span.textContent = "no website";
    row1.appendChild(span);
  }
  meta.appendChild(row1);

  const row2 = document.createElement("div");
  row2.className = "detail-meta-row";
  row2.innerHTML = `${escapeHtml(lead.email || "no email")} · score ${
    lead.score ?? "—"
  } · ${statusPill(lead.status)}`;
  meta.appendChild(row2);

  $("detail-reasons").textContent = lead.reasons || "(no reasons yet)";

function cleanDescription(text) {
  if (!text) return "";
  return String(text)
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

  // Load company profile enrichment for this lead asynchronously
  const profileSection = $("detail-profile-section");
  const profileContent = $("detail-profile-content");
  if (profileSection && profileContent) {
    profileSection.classList.add("hidden");
    profileContent.innerHTML = "";
    if (currentProjectId) {
      api(`/api/projects/${currentProjectId}/leads/${lead.id}/profile`)
        .then((p) => {
          if (!p) return;
          const parts = [];
          const cleanedDesc = cleanDescription(p.description);
          if (cleanedDesc) parts.push(`<div><strong>Description:</strong> ${escapeHtml(cleanedDesc)}</div>`);
          if (p.title) parts.push(`<div><strong>Title:</strong> ${escapeHtml(p.title)}</div>`);
          const socialKeys = Object.keys(p.socialLinks || {});
          if (socialKeys.length) {
            const links = socialKeys.map(k => `<a href="${escapeHtml(p.socialLinks[k])}" target="_blank" style="margin-right: 8px;">${escapeHtml(k)}</a>`).join("");
            parts.push(`<div><strong>Social:</strong> ${links}</div>`);
          }
          if (parts.length > 0) {
            profileContent.innerHTML = parts.join("<br>");
            profileSection.classList.remove("hidden");
          }
        })
        .catch(() => {});
    }
  }

  // Load contacts for this lead asynchronously
  const contactsSection = $("detail-contacts-section");
  const contactsList = $("detail-contacts-list");
  contactsSection.classList.add("hidden");
  contactsList.innerHTML = "";
  if (currentProjectId) {
    api(`/api/projects/${currentProjectId}/leads/${lead.id}/contacts`)
      .then((contacts) => {
        if (!Array.isArray(contacts) || contacts.length === 0) return;
        contactsSection.classList.remove("hidden");
        contactsList.innerHTML = contacts
          .map(
            (c) =>
              `<li class="detail-contact-item">
                <span class="contact-name">${escapeHtml(c.fullName)}</span>
                ${c.title ? `<span class="contact-title">${escapeHtml(c.title)}</span>` : ""}
                ${c.linkedinUrl ? `<a href="${escapeHtml(c.linkedinUrl)}" target="_blank" rel="noopener noreferrer" class="contact-li-link" title="LinkedIn">in</a>` : ""}
              </li>`
          )
          .join("");
      })
      .catch(() => {/* silent */});
  }

  const isProv = lead.status === "provisional";
  $("btn-promote").classList.toggle("hidden", !isProv);
  $("btn-discard").classList.toggle("hidden", !isProv);
  $("btn-approve").classList.toggle("hidden", isProv);
  $("btn-reject").classList.toggle("hidden", isProv);
}

function selectedIndexInSorted() {
  const sorted = sortedLeads();
  return sorted.findIndex((l) => l.id === selectedLeadId);
}

function moveSelection(delta) {
  const sorted = sortedLeads();
  if (!sorted.length) return;
  let idx = selectedIndexInSorted();
  if (idx < 0) idx = delta > 0 ? -1 : 0;
  const next = Math.max(0, Math.min(sorted.length - 1, idx + delta));
  selectLead(sorted[next].id);
}

function advanceAfterReview(reviewedId) {
  const sorted = sortedLeads();
  const idx = sorted.findIndex((l) => l.id === reviewedId);
  const prefer = (l) => l.status === "scored" || l.status === "gated";

  for (let i = idx + 1; i < sorted.length; i++) {
    if (prefer(sorted[i])) {
      selectLead(sorted[i].id);
      return;
    }
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].id !== reviewedId && prefer(sorted[i])) {
      selectLead(sorted[i].id);
      return;
    }
  }
  if (idx + 1 < sorted.length) selectLead(sorted[idx + 1].id);
  else if (sorted.length) {
    const still = sorted.find((l) => l.id === reviewedId) || sorted[0];
    selectLead(still.id);
  }
}

async function loadLeads() {
  if (!currentProjectId || !selectedLeadListId) {
    leads = [];
    selectedLeadId = null;
    renderLeads();
    $("detail-empty").classList.remove("hidden");
    $("detail-body").classList.add("hidden");
    return;
  }
  leads = await api(`${listApiBase()}/leads${filterQuery()}`);
  if (selectedLeadId && !leads.some((l) => l.id === selectedLeadId)) {
    selectedLeadId = null;
  }
  renderLeads();
  if (selectedLeadId) selectLead(selectedLeadId);
  else {
    $("detail-empty").classList.remove("hidden");
    $("detail-body").classList.add("hidden");
  }
}

async function refreshAll() {
  await loadProjects();
  await loadLeadLists();
  await loadStats();
  await loadLeads();
  await loadLeadPlan();
  await loadOpsRuns();
  await loadActivity();
}

async function approveSelected() {
  if (!currentProjectId || !selectedLeadId) return;
  const reviewedId = selectedLeadId;
  const notes = $("detail-notes").value.trim() || null;
  await api(
    `/api/projects/${currentProjectId}/leads/${selectedLeadId}/approve`,
    { method: "POST", body: JSON.stringify({ notes }) }
  );
  $("detail-notes").value = "";
  await loadStats();
  await loadLeads();
  toast("Approved", "success");
  advanceAfterReview(reviewedId);
}

async function rejectSelected() {
  if (!currentProjectId || !selectedLeadId) return;
  const reviewedId = selectedLeadId;
  const notes = $("detail-notes").value.trim() || null;
  await api(
    `/api/projects/${currentProjectId}/leads/${selectedLeadId}/reject`,
    { method: "POST", body: JSON.stringify({ notes }) }
  );
  $("detail-notes").value = "";
  await loadStats();
  await loadLeads();
  toast("Rejected", "success");
  advanceAfterReview(reviewedId);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

$("project-select").addEventListener("change", async (e) => {
  if (suppressProjectChange) return;
  currentProjectId = Number(e.target.value);
  selectedLeadId = null;
  selectedLeadListId = null;
  updateBrandProject();
  await loadLeadLists();
  await loadStats();
  await loadLeads();
  await loadLeadPlan();
  await loadOpsRuns();
  await loadActivity();
});

$("btn-new-project").addEventListener("click", openNewProjectDialog);
$("btn-cancel-project").addEventListener("click", closeNewProjectDialog);
$("new-project-backdrop").addEventListener("click", (e) => {
  if (e.target === $("new-project-backdrop")) closeNewProjectDialog();
});
$("btn-project-settings").addEventListener("click", openSettingsDialog);
$("btn-cancel-settings").addEventListener("click", closeSettingsDialog);
$("settings-backdrop").addEventListener("click", (e) => {
  if (e.target === $("settings-backdrop")) closeSettingsDialog();
});

$("btn-delete-project").addEventListener("click", async () => {
  if (!currentProjectId) return;
  const project = projects.find((p) => p.id === currentProjectId);
  const name = project?.name || `#${currentProjectId}`;
  if (
    !confirm(
      `Permanently delete project "${name}" and all lists, leads, and discovery data?`
    )
  ) {
    return;
  }
  try {
    await api(`/api/projects/${currentProjectId}`, { method: "DELETE" });
    closeSettingsDialog();
    currentProjectId = null;
    selectedLeadListId = null;
    selectedLeadId = null;
    await refreshAll();
    toast("Project deleted", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("new-project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  if (!name) return;
  const website = String(fd.get("website") || "").trim();
  const description = String(fd.get("description") || "").trim();
  const icp = String(fd.get("icp") || "").trim();
  const geography = String(fd.get("geography") || "").trim();
  const volumeTarget = clampVolume(fd.get("volumeTarget"));
  try {
    const created = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        website: website || null,
        description: description || null,
        icp: icp || null,
        geography: geography || null,
        volumeTarget,
      }),
    });
    closeNewProjectDialog();
    currentProjectId = created.id;
    await refreshAll();
    toast(`Created project ${created.name}`, "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentProjectId) return;
  const form = e.target;
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  if (!name) return;
  const geography = String(fd.get("geography") || "").trim();
  const volumeTarget = clampVolume(fd.get("volumeTarget"));
  const enabledActorKeys = selectedEnabledActors(form);
  if (!enabledActorKeys.length) {
    toast("Select at least one lead source", "error");
    return;
  }
  try {
    const updated = await api(`/api/projects/${currentProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        website: String(fd.get("website") || "").trim() || null,
        description: String(fd.get("description") || "").trim() || null,
        icp: String(fd.get("icp") || "").trim() || null,
        geography: geography || null,
        volumeTarget,
        leadStrategy: {
          version: 1,
          enabledActorKeys,
          defaultGeography: geography || "USA",
          buyerMode: "agency",
        },
      }),
    });
    closeSettingsDialog();
    const idx = projects.findIndex((p) => p.id === updated.id);
    if (idx >= 0) projects[idx] = updated;
    else await loadProjects();
    updateBrandProject();
    const sel = $("project-select");
    const opt = [...sel.options].find((o) => Number(o.value) === updated.id);
    if (opt) opt.textContent = `${updated.name} (#${updated.id})`;
    await loadLeadPlan();
    toast("Project settings saved (Default list plan updated if hunt defaults changed)", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-filter").addEventListener("click", () => loadLeads());
$("filter-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadLeads();
});
$("filter-status").addEventListener("change", () => loadLeads());
$("filter-min-score").addEventListener("change", () => loadLeads());

$("btn-find-leads").addEventListener("click", async () => {
  if (!currentProjectId) {
    toast("Select a project first", "error");
    return;
  }
  const btn = $("btn-find-leads");
  btn.disabled = true;
  try {
    toast("Finding leads via Apify…");
    const forceReplan = Boolean($("force-replan")?.checked);
    const summary = await api(`${listApiBase()}/ingest`, {
      method: "POST",
      body: JSON.stringify({ forceReplan }),
    });
    if ($("force-replan")) $("force-replan").checked = false;
    if (summary.plan) {
      currentLeadStrategy = summary.leadStrategy || currentLeadStrategy;
      renderLeadPlan(summary.plan, summary);
    }
    await loadStats();
    await loadLeads();
    await loadLeadPlan();
    await loadLeadLists();
    await loadOpsRuns();
    await loadActivity();
    scheduleOpsPoll();
    const skip = summary.skippedExisting
      ? `, skipped ${summary.skippedExisting}`
      : "";
    const dups =
      typeof summary.duplicates === "number" && summary.duplicates > 0
        ? `, duplicates ${summary.duplicates}`
        : "";
    const errs =
      Array.isArray(summary.errors) && summary.errors.length
        ? ` — errors: ${summary.errors.slice(0, 2).join("; ")}`
        : "";
    const prov =
      typeof summary.provisional === "number" && summary.provisional > 0
        ? `, provisional ${summary.provisional}`
        : "";
    const breaker = summary.circuitBreakerTripped
      ? " — circuit breaker stopped further sources"
      : "";
    const locked = summary.usedLockedPlan ? " (locked plan)" : "";
    const revised = summary.usedRevisionBrief ? " (revised from last hunt)" : "";
    toast(
      `Fetched ${summary.fetched}, kept ${summary.kept}, rejected ${summary.rejected}${prov}${dups}${skip}${breaker}${locked}${revised}${errs}`,
      summary.errors?.length ? "error" : "success"
    );
  } catch (err) {
    toast(err.message || String(err), "error");
    await loadActivity();
  } finally {
    btn.disabled = false;
  }
});

$("btn-regen-plan").addEventListener("click", async () => {
  if (!currentProjectId) return;
  const btn = $("btn-regen-plan");
  btn.disabled = true;
  try {
    toast("Generating lead plan…");
    const data = await api(`${listApiBase()}/lead-plan/generate`, {
      method: "POST",
      body: "{}",
    });
    renderLeadPlan(data.plan, data);
    toast(
      data.fromFallback
        ? "Used fallback plan (Hermes unavailable)"
        : "Lead plan regenerated",
      "success"
    );
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btn-plan-feedback").addEventListener("click", async () => {
  if (!currentProjectId) return;
  const feedback = $("lead-plan-feedback").value.trim();
  if (!feedback) {
    toast("Enter feedback first", "error");
    return;
  }
  const btn = $("btn-plan-feedback");
  btn.disabled = true;
  try {
    const data = await api(`${listApiBase()}/lead-plan/feedback`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
    renderLeadPlan(data.plan, data);
    toast("Plan updated from feedback", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btn-refresh-activity").addEventListener("click", async () => {
  try {
    await loadOpsRuns();
    const runId = $("ops-run-select")?.value || "latest";
    await loadActivity(runId);
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("ops-run-select").addEventListener("change", () => {
  loadActivity($("ops-run-select").value).catch(() => {});
});

$("ops-type-filter").addEventListener("change", () => {
  loadOpsRuns().then(() => loadActivity("latest")).catch(() => {});
});

$("lead-list-select").addEventListener("change", async () => {
  if (!currentProjectId) return;
  const listId = Number($("lead-list-select").value);
  try {
    await selectLeadList(listId, { toast: true });
  } catch (err) {
    toast(err.message || String(err), "error");
    await loadLeadLists();
  }
});

function openNewListDialog() {
  const backdrop = $("new-list-backdrop");
  backdrop.classList.add("open");
  backdrop.removeAttribute("inert");
  const form = $("new-list-form");
  form.reset();
  form.elements.namedItem("volumeTarget").value = "100";
  renderEnabledSources(
    $("new-list-enabled-sources"),
    currentLeadStrategy?.enabledActorKeys || ["google_maps", "wellfound_startups"]
  );
  form.querySelector('input[name="name"]')?.focus();
}

function closeNewListDialog() {
  const backdrop = $("new-list-backdrop");
  backdrop.classList.remove("open");
  backdrop.setAttribute("inert", "");
}

function fillListSettingsFields(form, list) {
  form.elements.namedItem("name").value = list?.name || "";
  form.elements.namedItem("description").value = list?.description || "";
  const resolved = list?.resolvedHuntConfig || {};
  const geography = form.elements.namedItem("geography");
  if (geography) geography.value = resolved.geography || "";
  const volume = form.elements.namedItem("volumeTarget");
  if (volume) volume.value = String(clampVolume(resolved.volumeTarget ?? 100));
  renderEnabledSources(
    $("list-settings-enabled-sources"),
    resolved.enabledActorKeys || ["google_maps", "wellfound_startups"]
  );
}

function openListSettingsDialog() {
  if (!selectedLeadListId) return;
  const list = leadLists.find((l) => l.id === selectedLeadListId);
  if (!list) return;
  const backdrop = $("list-settings-backdrop");
  const form = $("list-settings-form");
  fillListSettingsFields(form, list);
  backdrop.classList.add("open");
  backdrop.removeAttribute("inert");
  form.querySelector('input[name="name"]')?.focus();
}

function closeListSettingsDialog() {
  const backdrop = $("list-settings-backdrop");
  backdrop.classList.remove("open");
  backdrop.setAttribute("inert", "");
}

$("btn-new-list").addEventListener("click", async () => {
  if (!actorCatalog.length) await loadActorCatalog();
  openNewListDialog();
});
$("btn-cancel-list").addEventListener("click", closeNewListDialog);
$("new-list-backdrop").addEventListener("click", (e) => {
  if (e.target === $("new-list-backdrop")) closeNewListDialog();
});

$("btn-list-settings").addEventListener("click", async () => {
  if (!actorCatalog.length) await loadActorCatalog();
  await loadLeadLists();
  openListSettingsDialog();
});
$("btn-cancel-list-settings").addEventListener("click", closeListSettingsDialog);
$("list-settings-backdrop").addEventListener("click", (e) => {
  if (e.target === $("list-settings-backdrop")) closeListSettingsDialog();
});

$("list-settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentProjectId || !selectedLeadListId) return;
  const list = leadLists.find((l) => l.id === selectedLeadListId);
  if (!list) return;
  const submitter = e.submitter;
  const saveAction =
    submitter?.getAttribute("value") ||
    submitter?.value ||
    "save";
  const regenerate = saveAction === "regenerate";
  const fd = new FormData(e.target);
  const name = String(fd.get("name") || "").trim();
  const description = String(fd.get("description") || "").trim() || null;
  const geography = String(fd.get("geography") || "").trim() || null;
  const volumeTarget = clampVolume(fd.get("volumeTarget"));
  const enabledActorKeys = selectedEnabledActors(e.target);
  if (!name) return;
  if (!enabledActorKeys.length) {
    toast("Select at least one lead source", "error");
    return;
  }
  try {
    await api(
      `/api/projects/${currentProjectId}/lead-lists/${selectedLeadListId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description,
          geography,
          volumeTarget,
          enabledActorKeys,
          regeneratePlan: regenerate,
        }),
      }
    );
    closeListSettingsDialog();
    await loadLeadLists();
    await loadLeadPlan();
    toast(
      regenerate ? "List saved and plan regenerated" : "List settings saved",
      "success"
    );
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("new-list-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentProjectId) return;
  const fd = new FormData(e.target);
  const name = String(fd.get("name") || "").trim();
  if (!name) return;
  const geography = String(fd.get("geography") || "").trim() || null;
  const volumeTarget = clampVolume(fd.get("volumeTarget"));
  const enabledActorKeys = selectedEnabledActors(e.target);
  if (!enabledActorKeys.length) {
    toast("Select at least one lead source", "error");
    return;
  }
  try {
    const created = await api(`/api/projects/${currentProjectId}/lead-lists`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: String(fd.get("description") || "").trim() || null,
        geography,
        volumeTarget,
        enabledActorKeys,
        activate: true,
      }),
    });
    const listId = created.list?.id || created.activeLeadListId;
    if (listId) {
      await api(
        `/api/projects/${currentProjectId}/lead-lists/${listId}/lead-plan/generate`,
        { method: "POST", body: "{}" }
      );
    }
    closeNewListDialog();
    selectedLeadId = null;
    await loadLeadLists();
    if (listId) await selectLeadList(listId, { persist: false });
    else await refreshAll();
    toast(`Created list ${name} with plan`, "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-clear-list").addEventListener("click", async () => {
  if (!currentProjectId || !selectedLeadListId) return;
  const list = leadLists.find((l) => l.id === selectedLeadListId);
  if (
    !confirm(
      `Remove all ${list?.leadCount ?? ""} leads from "${list?.name || "this list"}"?`
    )
  ) {
    return;
  }
  try {
    await api(
      `/api/projects/${currentProjectId}/lead-lists/${selectedLeadListId}/clear`,
      { method: "POST", body: "{}" }
    );
    selectedLeadId = null;
    await loadLeadLists();
    await loadStats();
    await loadLeads();
    await loadLeadPlan();
    await loadOpsRuns();
    await loadActivity();
    toast("List cleared", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-delete-list").addEventListener("click", async () => {
  if (!currentProjectId || !selectedLeadListId) return;
  if (leadLists.length <= 1) {
    toast("Cannot delete the last list", "error");
    return;
  }
  const list = leadLists.find((l) => l.id === selectedLeadListId);
  if (!confirm(`Permanently delete list "${list?.name}" and all its leads?`)) {
    return;
  }
  try {
    await api(
      `/api/projects/${currentProjectId}/lead-lists/${selectedLeadListId}`,
      { method: "DELETE" }
    );
    selectedLeadId = null;
    selectedLeadListId = null;
    await loadLeadLists();
    await loadStats();
    await loadLeads();
    await loadLeadPlan();
    await loadOpsRuns();
    await loadActivity();
    toast("List deleted", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-refresh-website").addEventListener("click", async () => {
  if (!currentProjectId) return;
  try {
    toast("Refreshing website summary…");
    await api(`/api/projects/${currentProjectId}/website-summary/refresh`, {
      method: "POST",
      body: "{}",
    });
    await loadLeadPlan();
    toast("Website summary updated", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-enrich-companies").addEventListener("click", async () => {
  if (!currentProjectId) {
    toast("Select a project first", "error");
    return;
  }
  const btn = $("btn-enrich-companies");
  btn.disabled = true;
  try {
    toast("Starting company enrichment…");
    $("ops-type-filter").value = "enrichment";
    setTimeout(() => {
      loadOpsRuns().then(() => loadActivity("latest"));
    }, 300);

    const summary = await api(
      `/api/projects/${currentProjectId}/enrich-companies`,
      { method: "POST", body: "{}" }
    );
    await loadStats();
    await loadLeads();
    const errs =
      Array.isArray(summary.errors) && summary.errors.length
        ? ` — errors: ${summary.errors.slice(0, 2).join("; ")}`
        : "";
    toast(
      `Enriched ${summary.companiesEnriched}/${summary.companiesQueued}, pages ${summary.pagesFetched}, emails ${summary.emailsFound}, failed ${summary.failed}${errs}`,
      summary.failed ? "error" : "success"
    );
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
    loadOpsRuns().then(() => loadActivity("latest"));
  }
});

$("btn-find-contacts").addEventListener("click", async () => {
  if (!currentProjectId) {
    toast("Select a project first", "error");
    return;
  }
  const btn = $("btn-find-contacts");
  btn.disabled = true;
  try {
    toast("Finding contacts… (this may take a minute)");
    $("ops-type-filter").value = "contacts";
    [100, 1000, 2500, 5000].forEach((ms) => {
      setTimeout(() => {
        loadOpsRuns().then(() => loadActivity("latest")).catch(() => {});
      }, ms);
    });

    const summary = await api(
      `/api/projects/${currentProjectId}/find-contacts`,
      { method: "POST", body: "{}" }
    );
    toast(
      `Found ${summary.contactsFound} contacts across ${summary.leadsProcessed} leads (${summary.failed} failed)`,
      summary.failed > 0 && summary.contactsFound === 0 ? "error" : "success"
    );
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
    loadOpsRuns().then(() => loadActivity("latest"));
  }
});

$("btn-score").addEventListener("click", async () => {
  if (!currentProjectId || !selectedLeadListId) return;
  const btn = $("btn-score");
  btn.disabled = true;
  try {
    toast("Scoring…");
    $("ops-type-filter").value = "scoring";
    setTimeout(() => {
      loadOpsRuns().then(() => loadActivity("latest"));
    }, 300);

    const summary = await api(`${listApiBase()}/score`, {
      method: "POST",
      body: "{}",
    });
    await loadStats();
    await loadLeads();
    toast(`Scored ${summary.scored}, errors ${summary.errors}`, "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
    loadOpsRuns().then(() => loadActivity("latest"));
  }
});

async function downloadExport(preset) {
  if (!currentProjectId || !selectedLeadListId) return;
  const q = filterQuery();
  const sep = q ? "&" : "?";
  const url = `${listApiBase()}/export.csv${q}${sep}preset=${preset}`;
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.href = "/login";
    return;
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${currentProjectId}-${preset}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${preset}`, "success");
}

$("btn-export-all").addEventListener("click", () => downloadExport("all"));
$("btn-export-emails").addEventListener("click", () =>
  downloadExport("emails_only")
);

$("import-file").addEventListener("change", async (e) => {
  if (!currentProjectId || !selectedLeadListId) return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    toast("Importing…");
    const summary = await api(`${listApiBase()}/import.csv`, {
      method: "POST",
      body: JSON.stringify({ csv: text }),
    });
    e.target.value = "";
    await loadStats();
    await loadLeads();
    toast(`Imported kept ${summary.kept}, rejected ${summary.rejected}`, "success");
  } catch (err) {
    e.target.value = "";
    toast(err.message || String(err), "error");
  }
});

$("btn-approve").addEventListener("click", () => {
  approveSelected().catch((err) => toast(err.message || String(err), "error"));
});
$("btn-reject").addEventListener("click", () => {
  rejectSelected().catch((err) => toast(err.message || String(err), "error"));
});

$("btn-promote").addEventListener("click", async () => {
  if (!currentProjectId || !selectedLeadId) return;
  try {
    await api(
      `/api/projects/${currentProjectId}/leads/${selectedLeadId}/promote`,
      { method: "POST", body: "{}" }
    );
    toast("Promoted to gated", "success");
    await loadLeads();
    await loadStats();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-discard").addEventListener("click", async () => {
  if (!currentProjectId || !selectedLeadId) return;
  const notes = $("detail-notes").value.trim() || "discarded provisional";
  try {
    await api(
      `/api/projects/${currentProjectId}/leads/${selectedLeadId}/discard`,
      { method: "POST", body: JSON.stringify({ notes }) }
    );
    toast("Discarded provisional lead", "success");
    $("detail-notes").value = "";
    await loadLeads();
    await loadStats();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

$("btn-shortcuts").addEventListener("click", toggleShortcutPanel);
$("btn-theme").addEventListener("click", toggleTheme);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("new-project-backdrop").classList.contains("open")) {
      closeNewProjectDialog();
      return;
    }
    if ($("settings-backdrop").classList.contains("open")) {
      closeSettingsDialog();
      return;
    }
    if (!$("shortcut-panel").classList.contains("hidden")) {
      $("shortcut-panel").classList.add("hidden");
    }
    return;
  }

  if (isTypingTarget(e.target)) return;

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    toggleShortcutPanel();
    return;
  }

  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    moveSelection(1);
    return;
  }
  if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    moveSelection(-1);
    return;
  }
  if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    approveSelected().catch((err) => toast(err.message || String(err), "error"));
    return;
  }
  if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    rejectSelected().catch((err) => toast(err.message || String(err), "error"));
  }
});

(async function init() {
  setTheme(getTheme());
  try {
    await loadMe();
    await checkApiVersion();
    await loadActorCatalog();
    await refreshAll();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
})();

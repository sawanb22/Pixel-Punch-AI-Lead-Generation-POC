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
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  }
  if (!res.ok) throw new Error(res.statusText);
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

function setPlanControlsEnabled(on) {
  $("btn-regen-plan").disabled = !on;
  $("btn-plan-feedback").disabled = !on;
  $("lead-plan-feedback").disabled = !on;
  $("btn-refresh-activity").disabled = !on;
}

function renderLeadPlan(plan) {
  const status = $("lead-plan-status");
  const goal = $("lead-plan-goal");
  const meta = $("lead-plan-meta");
  const angles = $("lead-plan-angles");
  if (!plan) {
    status.textContent = "—";
    goal.textContent = currentProjectId
      ? "No lead plan yet. Click Regenerate plan or Find leads."
      : "Create or open a project to draft a plan.";
    meta.innerHTML = "";
    angles.innerHTML = "";
    return;
  }
  status.textContent = `${plan.status} · ${plan.generatedBy}`;
  goal.textContent = plan.goal || "—";
  meta.innerHTML = `
    <div><dt>Volume</dt><dd>${escapeHtml(String(plan.volumeTarget ?? "—"))}</dd></div>
    <div><dt>Geography</dt><dd>${escapeHtml(plan.geography || "Any")}</dd></div>
    <div><dt>Intents</dt><dd>${escapeHtml((plan.intents || []).join(", ") || "—")}</dd></div>
  `;
  angles.innerHTML = (plan.searchAngles || [])
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");
}

function renderActivity(payload) {
  const summary = $("activity-summary");
  const timeline = $("activity-timeline");
  const rejected = $("activity-rejected");
  if (!payload?.run) {
    summary.textContent = "No discovery runs yet.";
    timeline.innerHTML = "";
    rejected.classList.add("hidden");
    rejected.innerHTML = "";
    return;
  }
  const run = payload.run;
  summary.textContent = `Run #${run.id} · ${run.status} · fetched ${run.fetchedCount}, kept ${run.keptCount}, rejected ${run.rejectedCount}, duplicates ${run.duplicateCount}`;
  timeline.innerHTML = (payload.timeline || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const samples = payload.rejectedSamples || [];
  if (!samples.length) {
    rejected.classList.add("hidden");
    rejected.innerHTML = "";
    return;
  }
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

async function loadLeadPlan() {
  if (!currentProjectId) {
    setPlanControlsEnabled(false);
    renderLeadPlan(null);
    return;
  }
  setPlanControlsEnabled(true);
  try {
    const data = await api(`/api/projects/${currentProjectId}/lead-plan`);
    renderLeadPlan(data.plan);
  } catch (err) {
    renderLeadPlan(null);
    toast(err.message || String(err), "error");
  }
}

async function loadActivity() {
  if (!currentProjectId) {
    renderActivity(null);
    return;
  }
  try {
    const data = await api(`/api/projects/${currentProjectId}/discovery/latest`);
    renderActivity(data);
  } catch (err) {
    renderActivity(null);
  }
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
    const project = await api(`/api/projects/${currentProjectId}`);
    const idx = projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) projects[idx] = project;
    fillProjectFields($("settings-form"), project);
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
    renderLeadPlan(null);
    renderActivity(null);
    return;
  }
  if (!currentProjectId || !projects.some((p) => p.id === currentProjectId)) {
    currentProjectId = projects[0].id;
  }
  sel.value = String(currentProjectId);
  updateBrandProject();
}

async function loadStats() {
  if (!currentProjectId) {
    $("kpi-total").textContent = "—";
    $("kpi-new").textContent = "—";
    $("kpi-approval").textContent = "—";
    $("kpi-reply").textContent = "—";
    $("kpi-approval-wrap").classList.remove("tint-ok", "tint-warn");
    return;
  }
  const s = await api(`/api/projects/${currentProjectId}/stats`);
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
    tr.innerHTML = `
      <td><span class="company-cell" title="${escapeHtml(lead.company)}">${escapeHtml(lead.company)}</span></td>
      <td title="${escapeHtml(lead.email || "")}">${escapeHtml(lead.email || "")}</td>
      <td>${scoreCell(lead.score)}</td>
      <td>${statusPill(lead.status)}</td>
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
  if (!currentProjectId) {
    leads = [];
    selectedLeadId = null;
    renderLeads();
    $("detail-empty").classList.remove("hidden");
    $("detail-body").classList.add("hidden");
    return;
  }
  leads = await api(`/api/projects/${currentProjectId}/leads${filterQuery()}`);
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
  await loadStats();
  await loadLeads();
  await loadLeadPlan();
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
  currentProjectId = Number(e.target.value);
  selectedLeadId = null;
  updateBrandProject();
  await loadStats();
  await loadLeads();
  await loadLeadPlan();
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
    toast("Project settings saved", "success");
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
    const summary = await api(`/api/projects/${currentProjectId}/ingest`, {
      method: "POST",
      body: "{}",
    });
    await loadStats();
    await loadLeads();
    await loadLeadPlan();
    await loadActivity();
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
    toast(
      `Fetched ${summary.fetched}, kept ${summary.kept}, rejected ${summary.rejected}${dups}${skip}${errs}`,
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
    const data = await api(`/api/projects/${currentProjectId}/lead-plan/generate`, {
      method: "POST",
      body: "{}",
    });
    renderLeadPlan(data.plan);
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
    const data = await api(`/api/projects/${currentProjectId}/lead-plan/feedback`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
    renderLeadPlan(data.plan);
    $("lead-plan-feedback").value = "";
    toast("Plan updated from feedback", "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btn-refresh-activity").addEventListener("click", () => {
  loadActivity().catch((err) => toast(err.message || String(err), "error"));
});

$("btn-enrich-companies").addEventListener("click", async () => {
  if (!currentProjectId) {
    toast("Select a project first", "error");
    return;
  }
  const btn = $("btn-enrich-companies");
  btn.disabled = true;
  try {
    toast("Enriching companies…");
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
  }
});

$("btn-score").addEventListener("click", async () => {
  if (!currentProjectId) return;
  try {
    toast("Scoring…");
    const summary = await api(`/api/projects/${currentProjectId}/score`, {
      method: "POST",
      body: "{}",
    });
    await loadStats();
    await loadLeads();
    toast(`Scored ${summary.scored}, errors ${summary.errors}`, "success");
  } catch (err) {
    toast(err.message || String(err), "error");
  }
});

async function downloadExport(preset) {
  if (!currentProjectId) return;
  const q = filterQuery();
  const sep = q ? "&" : "?";
  const url = `/api/projects/${currentProjectId}/export.csv${q}${sep}preset=${preset}`;
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
  if (!currentProjectId) return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    toast("Importing…");
    const summary = await api(`/api/projects/${currentProjectId}/import.csv`, {
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
    await refreshAll();
  } catch (err) {
    toast(err.message || String(err), "error");
  }
})();

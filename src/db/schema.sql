CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  website TEXT,
  description TEXT,
  icp TEXT,
  source_config TEXT,
  lead_plan TEXT,
  lead_strategy TEXT,
  website_summary TEXT,
  website_summary_at TEXT,
  active_lead_list_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  lead_plan TEXT,
  payload_json TEXT,
  compiled_jobs_json TEXT,
  plan_updated_at TEXT,
  plan_context_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_list_id INTEGER,
  company TEXT NOT NULL,
  website TEXT,
  canonical_domain TEXT,
  email TEXT,
  votes INTEGER,
  sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'raw',
  score INTEGER,
  reasons TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_list_id) REFERENCES lead_lists(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  lead_list_id INTEGER,
  good INTEGER NOT NULL,
  notes TEXT,
  reviewed_by TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (lead_list_id) REFERENCES lead_lists(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id);
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(project_id, canonical_domain);
CREATE INDEX IF NOT EXISTS idx_lead_lists_project ON lead_lists(project_id);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_list_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  fetched_count INTEGER NOT NULL DEFAULT 0,
  kept_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL,
  error TEXT,
  planner_input_json TEXT,
  planner_raw_json TEXT,
  payload_json TEXT,
  compiled_jobs_json TEXT,
  validation_notes TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_list_id) REFERENCES lead_lists(id)
);

CREATE TABLE IF NOT EXISTS discovery_source_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  actor_id TEXT,
  task_id TEXT,
  apify_run_id TEXT,
  dataset_id TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  kept_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  cost_estimate REAL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (run_id) REFERENCES discovery_runs(id)
);

CREATE TABLE IF NOT EXISTS discovered_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  source_job_id INTEGER,
  company TEXT NOT NULL,
  website TEXT,
  domain TEXT,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  discovery_query TEXT,
  raw_payload TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES discovery_runs(id),
  FOREIGN KEY (source_job_id) REFERENCES discovery_source_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_project ON discovery_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_run ON discovery_source_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_discovered_candidates_run ON discovered_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_discovered_candidates_domain ON discovered_candidates(run_id, domain);

CREATE TABLE IF NOT EXISTS company_enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  companies_queued INTEGER NOT NULL DEFAULT 0,
  companies_enriched INTEGER NOT NULL DEFAULT 0,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  evidence_saved INTEGER NOT NULL DEFAULT 0,
  emails_found INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS company_enrichment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  lead_id INTEGER,
  domain TEXT NOT NULL,
  website TEXT,
  final_homepage_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (run_id) REFERENCES company_enrichment_runs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS company_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  job_id INTEGER,
  project_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT,
  page_type TEXT,
  http_status INTEGER,
  title TEXT,
  meta_description TEXT,
  text_snippet TEXT,
  error TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES company_enrichment_runs(id),
  FOREIGN KEY (job_id) REFERENCES company_enrichment_jobs(id)
);

CREATE TABLE IF NOT EXISTS company_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_id INTEGER,
  domain TEXT NOT NULL,
  homepage_url TEXT,
  title TEXT,
  description TEXT,
  category_hints TEXT NOT NULL DEFAULT '[]',
  location_hints TEXT NOT NULL DEFAULT '[]',
  social_links TEXT NOT NULL DEFAULT '{}',
  email_candidates TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, domain),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS company_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_id INTEGER,
  domain TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  url TEXT,
  title TEXT,
  text_excerpt TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS page_fetch_cache (
  url TEXT PRIMARY KEY,
  final_url TEXT,
  http_status INTEGER,
  content_type TEXT,
  body TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_project ON company_enrichment_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_run ON company_enrichment_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_company_pages_run ON company_pages(run_id);
CREATE INDEX IF NOT EXISTS idx_company_profiles_project_domain ON company_profiles(project_id, domain);
CREATE INDEX IF NOT EXISTS idx_company_evidence_domain ON company_evidence(project_id, domain);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT,
  linkedin_url TEXT,
  email TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'linkedin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contacts_domain ON contacts(project_id, domain);

CREATE TABLE IF NOT EXISTS operations_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  progress_info TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS operations_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES operations_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_ops_runs_project ON operations_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_ops_logs_run ON operations_logs(run_id);



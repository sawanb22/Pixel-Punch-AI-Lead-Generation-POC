import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";

export interface NewProject {
  name: string;
  website?: string | null;
  description?: string | null;
  icp?: string | null;
  sourceConfig?: string | null;
  leadPlan?: string | null;
}

interface ProjectRow {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  icp: string | null;
  source_config: string | null;
  lead_plan?: string | null;
  status: string;
  created_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    description: row.description,
    icp: row.icp,
    sourceConfig: row.source_config,
    leadPlan: row.lead_plan ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createProject(db: DB, input: NewProject): Project {
  const result = db
    .prepare(
      `INSERT INTO projects (name, website, description, icp, source_config, lead_plan)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.website ?? null,
      input.description ?? null,
      input.icp ?? null,
      input.sourceConfig ?? null,
      input.leadPlan ?? null
    );
  return getProject(db, Number(result.lastInsertRowid))!;
}

export function getProject(db: DB, id: number): Project | undefined {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row ? toProject(row) : undefined;
}

export function listProjects(db: DB): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY id")
    .all() as unknown as ProjectRow[];
  return rows.map(toProject);
}

export interface UpdateProjectInput {
  name?: string;
  website?: string | null;
  description?: string | null;
  icp?: string | null;
  sourceConfig?: string | null;
  leadPlan?: string | null;
}

export function updateProject(
  db: DB,
  id: number,
  input: UpdateProjectInput
): Project | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;

  db.prepare(
    `UPDATE projects
     SET name = ?, website = ?, description = ?, icp = ?, source_config = ?, lead_plan = ?
     WHERE id = ?`
  ).run(
    input.name !== undefined ? input.name : existing.name,
    input.website !== undefined ? input.website : existing.website,
    input.description !== undefined ? input.description : existing.description,
    input.icp !== undefined ? input.icp : existing.icp,
    input.sourceConfig !== undefined
      ? input.sourceConfig
      : existing.sourceConfig,
    input.leadPlan !== undefined ? input.leadPlan : existing.leadPlan,
    id
  );
  return getProject(db, id);
}

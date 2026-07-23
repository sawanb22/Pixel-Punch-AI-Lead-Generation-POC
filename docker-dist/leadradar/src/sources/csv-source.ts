import Papa from "papaparse";
import type { CanonicalLead } from "../domain/types.js";

export interface ColumnMapping {
  company: string;
  website?: string;
  email?: string;
  votes?: string;
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function parseCsvSource(csv: string, mapping: ColumnMapping): CanonicalLead[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  const leads: CanonicalLead[] = [];
  for (const row of rows) {
    const company = clean(row[mapping.company]);
    if (!company) continue; // skip rows with no company
    const votesRaw = mapping.votes ? clean(row[mapping.votes]) : null;
    const votes = votesRaw !== null ? Number(votesRaw) : null;
    leads.push({
      company,
      website: mapping.website ? clean(row[mapping.website]) : null,
      email: mapping.email ? clean(row[mapping.email]) : null,
      votes: votes !== null && Number.isFinite(votes) ? votes : null,
      source: "csv",
    });
  }
  return leads;
}

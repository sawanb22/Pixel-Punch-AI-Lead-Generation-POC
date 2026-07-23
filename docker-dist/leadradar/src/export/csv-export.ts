import type { Lead } from "../domain/types.js";

export type ExportPreset = "all" | "emails_only" | "current";

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return escapeCsvField(String(value));
}

export function exportLeadsCsv(
  leads: Lead[],
  preset: ExportPreset = "all"
): string {
  if (preset === "emails_only") {
    const rows = leads.filter((l) => l.email);
    const header = "company,email,score";
    const body = rows.map((l) =>
      [cell(l.company), cell(l.email), cell(l.score)].join(",")
    );
    return [header, ...body].join("\n");
  }

  // all / current — same columns; "current" means caller already filtered
  const header = "company,website,email,score,status,sources,reasons";
  const body = leads.map((l) =>
    [
      cell(l.company),
      cell(l.website),
      cell(l.email),
      cell(l.score),
      cell(l.status),
      cell(l.sources.join(";")),
      cell(l.reasons),
    ].join(",")
  );
  return [header, ...body].join("\n");
}

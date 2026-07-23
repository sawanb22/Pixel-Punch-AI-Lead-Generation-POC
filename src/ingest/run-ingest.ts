import type { DB } from "../db/database.js";
import type { Source, FetchLike } from "../sources/source.js";
import type { CanonicalLead } from "../domain/types.js";
import type { MxResolver } from "../validation/email-check.js";
import { validateAggregate } from "../validation/validate.js";
import { leadIdentityKey, type DedupedLead } from "../validation/dedup.js";
import { insertLeads, listLeads } from "../leads/leads.repo.js";
import { enrichLeadsFromWebsites } from "../sources/website-enricher.js";

export interface IngestSummary {
  fetched: number;
  kept: number;
  rejected: number;
  /** Leads skipped because they already exist in the project DB. */
  skippedExisting: number;
}

export interface RunIngestOptions {
  resolver?: MxResolver;
  /** When true, fetch lead websites and fill mailto emails before validate. */
  enrichWebsites?: boolean;
  /** Injectable fetch used by the website enricher. */
  fetch?: FetchLike;
  /** Scope insert + dedupe to this lead list. */
  leadListId?: number | null;
}

function resolveOptions(
  resolverOrOptions?: MxResolver | RunIngestOptions
): RunIngestOptions {
  if (!resolverOrOptions) return {};
  if (typeof resolverOrOptions === "function") {
    return { resolver: resolverOrOptions };
  }
  return resolverOrOptions;
}

function filterNewLeads(
  db: DB,
  projectId: number,
  kept: DedupedLead[],
  leadListId?: number | null
): { novel: DedupedLead[]; skippedExisting: number } {
  const existing = listLeads(db, projectId, leadListId);
  const keys = new Set(
    existing.map((l) =>
      leadIdentityKey({
        company: l.company,
        website: l.website,
        canonicalDomain: l.canonicalDomain,
      })
    )
  );
  const novel: DedupedLead[] = [];
  let skippedExisting = 0;
  for (const lead of kept) {
    const key = leadIdentityKey(lead);
    if (keys.has(key)) {
      skippedExisting++;
      continue;
    }
    keys.add(key);
    novel.push(lead);
  }
  return { novel, skippedExisting };
}

export async function runIngest(
  db: DB,
  projectId: number,
  sources: Source[],
  resolverOrOptions?: MxResolver | RunIngestOptions
): Promise<IngestSummary> {
  const options = resolveOptions(resolverOrOptions);

  const pools = await Promise.all(sources.map((s) => s.fetch()));
  let merged: CanonicalLead[] = pools.flat();

  if (options.enrichWebsites) {
    merged = await enrichLeadsFromWebsites(merged, { fetch: options.fetch });
  }

  const { kept, rejected } = await validateAggregate(merged, options.resolver);
  const { novel, skippedExisting } = filterNewLeads(
    db,
    projectId,
    kept,
    options.leadListId
  );
  insertLeads(db, projectId, novel, options.leadListId);

  return {
    fetched: merged.length,
    kept: novel.length,
    rejected: rejected.length,
    skippedExisting,
  };
}

/**
 * Real Apify lead-finding smoke test (uses APIFY_TOKEN from .env).
 * Small budget: 1 actor job, few places.
 */
import { loadEnvFile } from "../src/config/load-env.js";
import { openDatabase } from "../src/db/database.js";
import { createProject } from "../src/projects/projects.repo.js";
import { listLeads } from "../src/leads/leads.repo.js";
import { runLeadFinding } from "../src/discovery/run-lead-finding.js";
import {
  listSourceJobs,
  listDiscoveredCandidates,
} from "../src/discovery/discovery.repo.js";

loadEnvFile();

async function main(): Promise<void> {
  if (!process.env.APIFY_TOKEN?.trim()) {
    throw new Error("APIFY_TOKEN missing in .env");
  }

  // Cheap probe: confirm token works before spending actor credits
  const me = await fetch("https://api.apify.com/v2/users/me", {
    headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` },
  });
  const meBody = (await me.json()) as { data?: { username?: string }; error?: { message?: string } };
  if (!me.ok) {
    throw new Error(
      `Apify auth failed HTTP ${me.status}: ${meBody.error?.message ?? JSON.stringify(meBody)}`
    );
  }
  console.log(`Apify OK as ${meBody.data?.username ?? "(unknown)"}`);

  const dbPath = "data/apify-real-smoke.db";
  const db = openDatabase(dbPath);

  const project = createProject(db, {
    name: `Apify smoke ${new Date().toISOString()}`,
    icp: "coffee shops in Austin TX",
    sourceConfig: JSON.stringify({
      leadFinding: {
        mode: "apify_first",
        maxCandidates: 15,
        maxApifyJobs: 1,
        maxRuntimeSecondsPerJob: 300,
        concurrency: 1,
        sources: [
          {
            id: "maps-austin-coffee",
            type: "apify",
            actorId: "compass/crawler-google-places",
            input: {
              searchStringsArray: ["coffee shops in Austin TX"],
              maxCrawledPlacesPerSearch: 8,
              language: "en",
            },
            mapping: {
              companyField: "title",
              websiteField: "website",
              sourceUrlField: "url",
            },
          },
        ],
      },
    }),
  });

  console.log(`Project ${project.id} — starting REAL Apify lead finding…`);
  const started = Date.now();
  const summary = await runLeadFinding(db, project.id, {
    env: process.env,
  });
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  const jobs = listSourceJobs(db, summary.runId);
  const kept = listDiscoveredCandidates(db, summary.runId, { kept: true });
  const leads = listLeads(db, project.id);

  console.log(
    JSON.stringify(
      {
        elapsedSec,
        summary,
        jobs: jobs.map((j) => ({
          sourceId: j.sourceId,
          status: j.status,
          apifyRunId: j.apifyRunId,
          fetchedCount: j.fetchedCount,
          error: j.error,
        })),
        sampleKept: kept.slice(0, 5).map((c) => ({
          company: c.company,
          website: c.website,
          domain: c.domain,
        })),
        leadsInDb: leads.length,
        dbPath,
      },
      null,
      2
    )
  );

  db.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

import type { ApifyClient } from "./apify-client.js";
import {
  expandApifyDatasetItems,
  mapApifyItemToCandidate,
  type ApifyResultMapping,
} from "./map-candidate.js";
import { evaluateHardShield } from "./hard-shield.js";
import type { DiscoveredCompanyCandidate } from "./types.js";

export interface ApifyActorSourceOptions {
  client: ApifyClient;
  sourceId: string;
  actorId?: string;
  taskId?: string;
  input?: Record<string, unknown>;
  mapping: ApifyResultMapping;
  discoveryQuery?: string | null;
  allowCompanyOnly?: boolean;
  timeoutMs?: number;
  actorKey?: string;
  negatives?: string[];
}

export interface ApifyActorSourceResult {
  apifyRunId: string;
  datasetId: string | null;
  costEstimate: number | null;
  candidates: DiscoveredCompanyCandidate[];
  rejected: DiscoveredCompanyCandidate[];
  fetched: number;
}

export class ApifyActorSource {
  readonly name: string;
  private readonly options: ApifyActorSourceOptions;

  constructor(options: ApifyActorSourceOptions) {
    if (!options.actorId?.trim() && !options.taskId?.trim()) {
      throw new Error("ApifyActorSource requires actorId or taskId");
    }
    this.name = options.sourceId;
    this.options = options;
  }

  async fetchCandidates(): Promise<ApifyActorSourceResult> {
    const run = await this.options.client.runActorAndGetItems({
      actorId: this.options.actorId,
      taskId: this.options.taskId,
      input: this.options.input,
      timeoutMs: this.options.timeoutMs,
    });

    const items = expandApifyDatasetItems(run.items);
    const candidates: DiscoveredCompanyCandidate[] = [];
    const rejected: DiscoveredCompanyCandidate[] = [];

    for (const item of items) {
      const mapped = mapApifyItemToCandidate(item, {
        sourceId: this.options.sourceId,
        sourceType: "apify",
        mapping: this.options.mapping,
        discoveryQuery: this.options.discoveryQuery,
        allowCompanyOnly: this.options.allowCompanyOnly,
      });
      if (!mapped) {
        rejected.push({
          company: "(unmapped)",
          website: null,
          domain: null,
          source: this.options.sourceId,
          sourceType: "apify",
          sourceUrl: null,
          discoveryQuery: this.options.discoveryQuery ?? null,
          rawPayload: item,
          confidence: 0,
          rejectionReason: "mapping_failed",
        });
        continue;
      }

      const shield = evaluateHardShield(mapped, {
        allowWellfoundHosts:
          this.options.actorKey === "wellfound_startups",
        negatives: this.options.negatives,
        allowCompanyOnly: this.options.allowCompanyOnly,
      });
      if (shield.reject) {
        rejected.push({
          ...mapped,
          rejectionReason: shield.reason ?? "hard_shield",
        });
        continue;
      }
      candidates.push(mapped);
    }

    return {
      apifyRunId: run.runId,
      datasetId: run.datasetId,
      costEstimate: run.usageTotalUsd ?? null,
      candidates,
      rejected,
      fetched: items.length,
    };
  }
}

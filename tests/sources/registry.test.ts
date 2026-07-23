import { describe, it, expect } from "vitest";
import {
  parseSourceConfig,
  createConfiguredSources,
} from "../../src/sources/registry.js";
import type { Project } from "../../src/domain/types.js";

function project(sourceConfig: string | null): Project {
  return {
    id: 1,
    name: "P",
    website: null,
    description: null,
    icp: null,
    sourceConfig,
    leadPlan: null,
    leadStrategy: null,
    websiteSummary: null,
    websiteSummaryAt: null,
    activeLeadListId: null,
    status: "active",
    createdAt: "2026-01-01",
  };
}

describe("parseSourceConfig", () => {
  it("returns empty object for null/blank", () => {
    expect(parseSourceConfig(null)).toEqual({});
    expect(parseSourceConfig("  ")).toEqual({});
  });

  it("parses JSON object", () => {
    expect(
      parseSourceConfig(
        JSON.stringify({
          producthunt: { first: 5 },
          google: { query: "AI" },
          enrich: true,
        })
      )
    ).toEqual({
      producthunt: { first: 5 },
      google: { query: "AI" },
      enrich: true,
    });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSourceConfig("{nope")).toThrow(/Invalid sourceConfig/);
  });
});

describe("createConfiguredSources", () => {
  it("builds Product Hunt + Google + Jina sources from config + env", () => {
    const { sources, enrich } = createConfiguredSources(
      project(
        JSON.stringify({
          producthunt: { enabled: true, first: 3 },
          google: { query: "SaaS startups", num: 5 },
          jina: { query: "B2B AI", num: 5 },
          enrich: true,
        })
      ),
      {
        env: {
          PRODUCTHUNT_TOKEN: "ph-token",
          GOOGLE_CSE_KEY: "g-key",
          GOOGLE_CSE_ID: "g-cx",
          JINA_API_KEY: "jina-key",
        },
      }
    );
    expect(sources.map((s) => s.name).sort()).toEqual([
      "google",
      "jina",
      "producthunt",
    ]);
    expect(enrich).toBe(true);
  });

  it("throws when enabled source lacks credentials", () => {
    expect(() =>
      createConfiguredSources(
        project(JSON.stringify({ producthunt: { enabled: true } })),
        { env: {} }
      )
    ).toThrow(/PRODUCTHUNT_TOKEN/);

    expect(() =>
      createConfiguredSources(
        project(JSON.stringify({ google: { query: "x" } })),
        { env: { GOOGLE_CSE_KEY: "k" } }
      )
    ).toThrow(/GOOGLE_CSE_ID/);

    expect(() =>
      createConfiguredSources(
        project(JSON.stringify({ jina: { query: "x" } })),
        { env: {} }
      )
    ).toThrow(/JINA_API_KEY/);
  });

  it("skips sources with enabled: false", () => {
    const { sources } = createConfiguredSources(
      project(
        JSON.stringify({
          producthunt: { enabled: false },
          google: { enabled: false, query: "x" },
          jina: { enabled: false, query: "x" },
        })
      ),
      {
        env: {
          PRODUCTHUNT_TOKEN: "t",
          GOOGLE_CSE_KEY: "k",
          GOOGLE_CSE_ID: "cx",
          JINA_API_KEY: "j",
        },
      }
    );
    expect(sources).toHaveLength(0);
  });
});

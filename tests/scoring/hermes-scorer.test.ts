import { describe, it, expect, vi } from "vitest";
import { HermesScorer } from "../../src/scoring/hermes-scorer.js";
import type { Lead, Project } from "../../src/domain/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    projectId: 1,
    company: "Acme",
    website: "acme.com",
    canonicalDomain: "acme.com",
    email: "a@acme.com",
    votes: 10,
    source: "csv",
    sources: ["csv"],
    status: "gated",
    score: null,
    reasons: null,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "P1",
    website: null,
    description: null,
    icp: "B2B SaaS",
    sourceConfig: null,
    leadPlan: null,
    status: "active",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("HermesScorer", () => {
  it("parses score and reasons from chat completions", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"score":75,"reasons":"Good ICP fit"}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const scorer = new HermesScorer({ fetchFn, baseUrl: "http://test" });
    const result = await scorer.scoreLead(makeLead(), makeProject());
    expect(result.score).toBe(75);
    expect(result.reasons).toBe("Good ICP fit");
    expect(fetchFn).toHaveBeenCalledOnce();
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit?];
    expect(call[0]).toBe("http://test/v1/chat/completions");
    expect(call[1]?.method).toBe("POST");
  });

  it("strips markdown fences from content", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n{"score":60,"reasons":"ok"}\n```',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const scorer = new HermesScorer({ fetchFn });
    const result = await scorer.scoreLead(makeLead(), makeProject());
    expect(result.score).toBe(60);
    expect(result.reasons).toBe("ok");
  });

  it("extracts JSON object embedded in prose", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Sure.\n{"score":55,"reasons":"ok"}\nDone.',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const scorer = new HermesScorer({ fetchFn });
    const result = await scorer.scoreLead(makeLead(), makeProject());
    expect(result.score).toBe(55);
  });

  it("throws on bad JSON", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not json at all" } }],
        }),
        { status: 200 }
      )
    );
    const scorer = new HermesScorer({ fetchFn });
    await expect(scorer.scoreLead(makeLead(), makeProject())).rejects.toThrow(/json/i);
  });

  it("throws on out-of-range score", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"score":150,"reasons":"too high"}' } }],
        }),
        { status: 200 }
      )
    );
    const scorer = new HermesScorer({ fetchFn });
    await expect(scorer.scoreLead(makeLead(), makeProject())).rejects.toThrow(
      /0.?100|range/i
    );
  });

  it("rejects tool/MCP noise disguised as reasons", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"score":0,"reasons":"No pending leads; get_top_picks returned empty"}',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const scorer = new HermesScorer({ fetchFn });
    await expect(scorer.scoreLead(makeLead(), makeProject())).rejects.toThrow(
      /tool\/MCP noise/i
    );
  });

  it("includes similar past leads in the user prompt", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"score":70,"reasons":"ok"}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const scorer = new HermesScorer({ fetchFn, baseUrl: "http://test" });
    await scorer.scoreLead(makeLead(), makeProject(), {
      similar: [
        {
          projectId: 1,
          leadId: 2,
          company: "Past Co",
          website: "past.com",
          email: null,
          score: 88,
          good: true,
          notes: "liked",
          text: "Past Co",
        },
      ],
    });
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit?];
    const body = JSON.parse(String(call[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("Similar past leads:");
    expect(user).toContain("Past Co");
    expect(user).toContain("approved");
  });
});

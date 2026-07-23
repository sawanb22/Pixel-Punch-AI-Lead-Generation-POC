import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { fetchHtmlPage } from "../../src/enrichment/page-fetcher.js";
import { extractPageContent } from "../../src/enrichment/html-extract.js";
import type { FetchLike } from "../../src/sources/source.js";

describe("Jina Fallback & Parser", () => {
  beforeEach(() => {
    process.env.JINA_API_KEY = "mock_jina_key";
  });

  it("extracts content correctly from Jina Reader JSON payload", () => {
    const jinaJsonPayload = JSON.stringify({
      code: 200,
      status: 20000,
      data: {
        title: "Acme SPA Corp",
        description: "Innovative widgets rendered dynamically.",
        url: "https://acme-spa.example",
        content: "# Acme SPA\n\nWelcome to Acme SPA. We specialize in widgets.\nContact us at sales@acme-spa.example.\nCheck our [LinkedIn](https://linkedin.com/company/acme-spa) and [GitHub](https://github.com/acme-spa).",
        links: {
          LinkedIn: "https://linkedin.com/company/acme-spa",
          GitHub: "https://github.com/acme-spa"
        }
      }
    });

    const parsed = extractPageContent(jinaJsonPayload);
    expect(parsed.title).toBe("Acme SPA Corp");
    expect(parsed.metaDescription).toBe("Innovative widgets rendered dynamically.");
    expect(parsed.textSnippet).toContain("Welcome to Acme SPA");
    expect(parsed.emails).toContain("sales@acme-spa.example");
    expect(parsed.socialLinks).toMatchObject({
      linkedin: "https://linkedin.com/company/acme-spa",
      github: "https://github.com/acme-spa"
    });
  });

  it("extracts social links from markdown link format correctly", () => {
    const markdown = "[LinkedIn](https://linkedin.com/company/acme-test) and [X](https://x.com/acme_test)";
    const parsed = extractPageContent(markdown);
    expect(parsed.socialLinks).toMatchObject({
      linkedin: "https://linkedin.com/company/acme-test",
      x: "https://x.com/acme_test"
    });
  });

  it("triggers Jina fallback when standard fetch returns a skeleton SPA page", async () => {
    const db = openDatabase(":memory:");
    
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) {
        return new Response(JSON.stringify({
          code: 200,
          data: {
            title: "Dynamic Acme",
            description: "SPA desc",
            content: "Rendered SPA content. Email us at contact@acme.example"
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      // Return skeleton HTML
      return new Response(`
        <html>
          <head><title>Loading...</title></head>
          <body>
            <div id="root"></div>
            <script src="/bundle.js"></script>
          </body>
        </html>
      `, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    });

    const result = await fetchHtmlPage("https://acme-spa.example", {
      fetch: fetchMock,
      db,
      useJinaReader: true,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(result.body).toContain("contact@acme.example");
    // Verify standard fetch was called first, then Jina Reader
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("triggers Jina fallback when standard fetch fails with non-200 status", async () => {
    const db = openDatabase(":memory:");
    
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) {
        return new Response(JSON.stringify({
          data: {
            title: "Bypassed Cloudflare Acme",
            content: "Success content after block."
          }
        }), { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    });

    const result = await fetchHtmlPage("https://blocked.example", {
      fetch: fetchMock,
      db,
      useJinaReader: true,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toContain("Success content after block.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

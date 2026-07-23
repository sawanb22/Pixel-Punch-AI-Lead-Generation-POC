import { describe, it, expect } from "vitest";
import {
  extractContactsFromMarkdown,
  buildPeoplePageUrl,
} from "../../src/contacts/linkedin-extractor.js";

describe("extractContactsFromMarkdown", () => {
  it("extracts contacts from markdown links with name-title pattern", () => {
    const markdown = `
# Company People

[Jane Doe - CEO](https://www.linkedin.com/in/janedoe)
[Bob Smith - Head of Marketing](https://linkedin.com/in/bobsmith)
[Alice Johnson](https://linkedin.com/in/alicejohnson)
`;
    const contacts = extractContactsFromMarkdown(markdown);
    expect(contacts.length).toBeGreaterThanOrEqual(3);

    const jane = contacts.find((c) => c.fullName === "Jane Doe");
    expect(jane).toBeDefined();
    expect(jane?.title).toBe("CEO");
    expect(jane?.linkedinUrl).toContain("linkedin.com/in/janedoe");
    expect(jane?.confidence).toBeGreaterThanOrEqual(0.8);

    const bob = contacts.find((c) => c.fullName === "Bob Smith");
    expect(bob?.title).toBe("Head of Marketing");

    const alice = contacts.find((c) => c.fullName === "Alice Johnson");
    expect(alice).toBeDefined();
    expect(alice?.title).toBeNull();
  });

  it("deduplicates contacts with the same linkedinUrl", () => {
    const markdown = `
[Jane Doe - CEO](https://www.linkedin.com/in/janedoe)
[Jane Doe - CEO](https://www.linkedin.com/in/janedoe)
`;
    const contacts = extractContactsFromMarkdown(markdown);
    const janeDoes = contacts.filter((c) =>
      c.linkedinUrl?.includes("janedoe")
    );
    expect(janeDoes.length).toBe(1);
  });

  it("handles pipe and em-dash title separators", () => {
    const markdown = `
[Sara Lee | VP Sales](https://linkedin.com/in/saralee)
[Carlos Diaz – CTO](https://linkedin.com/in/carlosdiaz)
`;
    const contacts = extractContactsFromMarkdown(markdown);
    const sara = contacts.find((c) => c.fullName === "Sara Lee");
    expect(sara?.title).toBe("VP Sales");
    const carlos = contacts.find((c) => c.fullName === "Carlos Diaz");
    expect(carlos?.title).toBe("CTO");
  });

  it("strips trailing slash and query params from linkedin URLs", () => {
    const markdown = `
[Kai Chen - Founder](https://www.linkedin.com/in/kaichen/?originalSubdomain=us)
`;
    const contacts = extractContactsFromMarkdown(markdown);
    const kai = contacts.find((c) => c.fullName === "Kai Chen");
    expect(kai?.linkedinUrl).not.toContain("?");
    expect(kai?.linkedinUrl).not.toMatch(/\/$/);
  });

  it("returns empty array for markdown with no linkedin profiles", () => {
    const contacts = extractContactsFromMarkdown(
      "No people here. Visit https://twitter.com/acme"
    );
    expect(contacts).toHaveLength(0);
  });

  it("sorts results by confidence descending", () => {
    const markdown = `
[Alex Kim - Engineer](https://linkedin.com/in/alexkim)
[Sam Tan - Director of Product](https://linkedin.com/in/samtan)
`;
    const contacts = extractContactsFromMarkdown(markdown);
    for (let i = 1; i < contacts.length; i++) {
      expect(contacts[i - 1].confidence).toBeGreaterThanOrEqual(
        contacts[i].confidence
      );
    }
  });
});

describe("buildPeoplePageUrl", () => {
  it("appends /people to a bare linkedin company URL", () => {
    const url = buildPeoplePageUrl({
      linkedin: "https://www.linkedin.com/company/acme",
    });
    expect(url).toBe("https://www.linkedin.com/company/acme/people");
  });

  it("does not double-append /people if already present", () => {
    const url = buildPeoplePageUrl({
      linkedin: "https://www.linkedin.com/company/acme/people",
    });
    expect(url).toBe("https://www.linkedin.com/company/acme/people");
  });

  it("returns null if no linkedin key", () => {
    const url = buildPeoplePageUrl({ twitter: "https://twitter.com/acme" });
    expect(url).toBeNull();
  });

  it("strips trailing slash before appending /people", () => {
    const url = buildPeoplePageUrl({
      linkedin: "https://www.linkedin.com/company/acme/",
    });
    expect(url).toBe("https://www.linkedin.com/company/acme/people");
  });

  it("strips query params before appending /people", () => {
    const url = buildPeoplePageUrl({
      linkedin: "https://www.linkedin.com/company/acme?ref=foo",
    });
    expect(url).toBe("https://www.linkedin.com/company/acme/people");
  });
});

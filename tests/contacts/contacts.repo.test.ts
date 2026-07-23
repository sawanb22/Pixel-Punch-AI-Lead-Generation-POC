import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listGatedLeads } from "../../src/leads/leads.repo.js";
import {
  insertContact,
  listContactsForLead,
  listContactsForProject,
  countContactsForProject,
  deleteContactsForLead,
  contactCountsByLead,
} from "../../src/contacts/contacts.repo.js";

describe("contacts.repo", () => {
  function setup() {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "Test Project" });
    insertLeads(db, p.id, [
      {
        company: "Acme",
        website: "acme.com",
        canonicalDomain: "acme.com",
        email: null,
        votes: null,
        source: "csv",
        sources: ["csv"],
      },
      {
        company: "Globex",
        website: "globex.com",
        canonicalDomain: "globex.com",
        email: null,
        votes: null,
        source: "csv",
        sources: ["csv"],
      },
    ]);
    const leads = listGatedLeads(db, p.id);
    return { db, p, leads };
  }

  it("inserts and retrieves a contact for a lead", () => {
    const { db, p, leads } = setup();
    const lead = leads[0];
    const contact = insertContact(db, {
      projectId: p.id,
      leadId: lead.id,
      domain: "acme.com",
      fullName: "Jane Doe",
      title: "CEO",
      linkedinUrl: "https://linkedin.com/in/janedoe",
      confidence: 0.85,
    });

    expect(contact.id).toBeGreaterThan(0);
    expect(contact.fullName).toBe("Jane Doe");
    expect(contact.title).toBe("CEO");
    expect(contact.confidence).toBeCloseTo(0.85);
    expect(contact.source).toBe("linkedin");

    const fetched = listContactsForLead(db, lead.id);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].fullName).toBe("Jane Doe");

    db.close();
  });

  it("listContactsForLead returns empty array for unknown lead", () => {
    const { db } = setup();
    const contacts = listContactsForLead(db, 99999);
    expect(contacts).toHaveLength(0);
    db.close();
  });

  it("listContactsForProject aggregates across all leads", () => {
    const { db, p, leads } = setup();
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Jane Doe",
      title: "CEO",
      confidence: 0.9,
    });
    insertContact(db, {
      projectId: p.id,
      leadId: leads[1].id,
      domain: "globex.com",
      fullName: "Homer Simpson",
      title: "Safety Inspector",
      confidence: 0.7,
    });

    const all = listContactsForProject(db, p.id);
    expect(all).toHaveLength(2);
    // Sorted confidence desc: Jane first
    expect(all[0].fullName).toBe("Jane Doe");
    expect(all[1].fullName).toBe("Homer Simpson");
    db.close();
  });

  it("countContactsForProject returns correct total", () => {
    const { db, p, leads } = setup();
    expect(countContactsForProject(db, p.id)).toBe(0);
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Jane Doe",
      confidence: 0.85,
    });
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Bob Smith",
      confidence: 0.7,
    });
    expect(countContactsForProject(db, p.id)).toBe(2);
    db.close();
  });

  it("deleteContactsForLead removes all contacts for a lead", () => {
    const { db, p, leads } = setup();
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Jane Doe",
      confidence: 0.85,
    });
    expect(listContactsForLead(db, leads[0].id)).toHaveLength(1);
    deleteContactsForLead(db, leads[0].id);
    expect(listContactsForLead(db, leads[0].id)).toHaveLength(0);
    db.close();
  });

  it("contactCountsByLead returns per-lead contact counts", () => {
    const { db, p, leads } = setup();
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Jane Doe",
      confidence: 0.85,
    });
    insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Bob Smith",
      confidence: 0.7,
    });
    insertContact(db, {
      projectId: p.id,
      leadId: leads[1].id,
      domain: "globex.com",
      fullName: "Homer Simpson",
      confidence: 0.6,
    });

    const counts = contactCountsByLead(db, p.id, [leads[0].id, leads[1].id]);
    expect(counts.get(leads[0].id)).toBe(2);
    expect(counts.get(leads[1].id)).toBe(1);
    db.close();
  });

  it("contacts are stored with nullable fields", () => {
    const { db, p, leads } = setup();
    const contact = insertContact(db, {
      projectId: p.id,
      leadId: leads[0].id,
      domain: "acme.com",
      fullName: "Ghost Person",
      // No title, no linkedin, no email
    });
    expect(contact.title).toBeNull();
    expect(contact.linkedinUrl).toBeNull();
    expect(contact.email).toBeNull();
    db.close();
  });
});

/** A contact/person found at a company. */
export interface Contact {
  id: number;
  projectId: number;
  leadId: number;
  domain: string;
  fullName: string;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  confidence: number;
  source: string;
  createdAt: string;
}

export interface NewContact {
  projectId: number;
  leadId: number;
  domain: string;
  fullName: string;
  title?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  confidence?: number;
  source?: string;
}

/** Result of parsing LinkedIn people page. */
export interface ParsedContact {
  fullName: string;
  title: string | null;
  linkedinUrl: string | null;
  confidence: number;
}

/** Status of a contact-finding run. */
export type ContactFindingStatus = "running" | "completed" | "failed";

export interface ContactFindingSummary {
  leadsProcessed: number;
  contactsFound: number;
  failed: number;
  contacts: Contact[];
}

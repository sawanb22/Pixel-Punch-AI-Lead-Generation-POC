import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FeedbackRag } from "./feedback-rag.js";
import type { FeedbackDoc } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function termVector(tokens: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const t of tokens) {
    vec.set(t, (vec.get(t) ?? 0) + 1);
  }
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of a) normA += v * v;
  for (const [, v] of b) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  for (const [term, av] of a) {
    const bv = b.get(term);
    if (bv !== undefined) dot += av * bv;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function projectDir(baseDir: string, projectId: number): string {
  return join(baseDir, `project_${projectId}`);
}

function leadPath(baseDir: string, projectId: number, leadId: number): string {
  return join(projectDir(baseDir, projectId), `lead_${leadId}.md`);
}

function serializeDoc(doc: FeedbackDoc): string {
  return [
    "---",
    `projectId: ${doc.projectId}`,
    `leadId: ${doc.leadId}`,
    `company: ${JSON.stringify(doc.company)}`,
    `website: ${doc.website === null ? "null" : JSON.stringify(doc.website)}`,
    `email: ${doc.email === null ? "null" : JSON.stringify(doc.email)}`,
    `score: ${doc.score === null ? "null" : doc.score}`,
    `good: ${doc.good}`,
    `notes: ${doc.notes === null ? "null" : JSON.stringify(doc.notes)}`,
    "---",
    "",
    doc.text,
    "",
  ].join("\n");
}

function parseScalar(raw: string): string | number | boolean | null {
  const v = raw.trim();
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try {
      return JSON.parse(v.replace(/^'/, '"').replace(/'$/, '"')) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

function deserializeDoc(content: string): FeedbackDoc {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("invalid feedback RAG document format");
  const meta: Record<string, string | number | boolean | null> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    meta[key] = parseScalar(line.slice(idx + 1));
  }
  const text = match[2]!.trim();
  return {
    projectId: Number(meta.projectId),
    leadId: Number(meta.leadId),
    company: String(meta.company ?? ""),
    website: meta.website === null || meta.website === undefined ? null : String(meta.website),
    email: meta.email === null || meta.email === undefined ? null : String(meta.email),
    score: meta.score === null || meta.score === undefined ? null : Number(meta.score),
    good: Boolean(meta.good),
    notes: meta.notes === null || meta.notes === undefined ? null : String(meta.notes),
    text,
  };
}

export class FileFeedbackRag implements FeedbackRag {
  constructor(private readonly baseDir: string) {}

  upsert(doc: FeedbackDoc): void {
    const dir = projectDir(this.baseDir, doc.projectId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(leadPath(this.baseDir, doc.projectId, doc.leadId), serializeDoc(doc), "utf8");
  }

  similar(projectId: number, queryText: string, k: number): FeedbackDoc[] {
    const dir = projectDir(this.baseDir, projectId);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.startsWith("lead_") && f.endsWith(".md"));
    const queryVec = termVector(tokenize(queryText));
    const scored: Array<{ doc: FeedbackDoc; score: number }> = [];
    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf8");
      const doc = deserializeDoc(content);
      const docVec = termVector(
        tokenize(doc.text || `${doc.company} ${doc.website ?? ""} ${doc.notes ?? ""}`)
      );
      scored.push({ doc, score: cosine(queryVec, docVec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, Math.max(0, k))
      .map((s) => s.doc);
  }

  clearProject(projectId: number): void {
    const dir = projectDir(this.baseDir, projectId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

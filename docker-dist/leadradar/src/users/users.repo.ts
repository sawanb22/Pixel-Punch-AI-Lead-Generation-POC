import type { DB } from "../db/database.js";

export interface User {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface UpsertUserInput {
  email: string;
  name?: string | null;
}

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function upsertUser(db: DB, input: UpsertUserInput): User {
  const email = input.email.trim();
  const name = input.name ?? null;
  db.prepare(
    `INSERT INTO users (email, name) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name`
  ).run(email, name);
  return findUserByEmail(db, email)!;
}

export function findUserByEmail(db: DB, email: string): User | undefined {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim()) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function isAllowlisted(email: string, allowlist: string[]): boolean {
  const target = email.trim().toLowerCase();
  return allowlist.some((entry) => entry.trim().toLowerCase() === target);
}

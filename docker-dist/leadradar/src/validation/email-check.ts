import { resolveMx } from "node:dns/promises";

export type MxResolver = (hostname: string) => Promise<{ exchange: string; priority: number }[]>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSyntax(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export interface EmailCheckResult {
  valid: boolean;
  reason: "ok" | "syntax" | "mx";
}

export async function checkEmail(
  email: string,
  resolver: MxResolver = resolveMx
): Promise<EmailCheckResult> {
  if (!isValidSyntax(email)) return { valid: false, reason: "syntax" };
  const domain = email.trim().split("@")[1];
  try {
    const records = await resolver(domain);
    if (!records || records.length === 0) return { valid: false, reason: "mx" };
    return { valid: true, reason: "ok" };
  } catch {
    return { valid: false, reason: "mx" };
  }
}

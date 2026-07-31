import { evaluateContactSeniority, type ContactSeniorityResult } from "../metrics.js";

export interface ContactEvalReport {
  totalContactsEvaluated: number;
  overallDecisionMakerRatio: number;
  overallValidLinkedinRatio: number;
  overallValidEmailRatio: number;
  hallucinatedUrlCount: number;
  passed: boolean;
  seniorityResult: ContactSeniorityResult;
}

export function evaluateContactOutputs(
  contacts: Array<{
    title?: string | null;
    linkedinUrl?: string | null;
    email?: string | null;
  }>
): ContactEvalReport {
  const seniorityResult = evaluateContactSeniority(contacts);

  const passed =
    contacts.length === 0 ||
    (seniorityResult.decisionMakerRatio >= 0.3 && seniorityResult.hallucinatedUrls.length === 0);

  return {
    totalContactsEvaluated: contacts.length,
    overallDecisionMakerRatio: seniorityResult.decisionMakerRatio,
    overallValidLinkedinRatio: contacts.length
      ? Number((seniorityResult.validLinkedinCount / contacts.length).toFixed(2))
      : 0,
    overallValidEmailRatio: contacts.length
      ? Number((seniorityResult.validEmailCount / contacts.length).toFixed(2))
      : 0,
    hallucinatedUrlCount: seniorityResult.hallucinatedUrls.length,
    passed,
    seniorityResult,
  };
}

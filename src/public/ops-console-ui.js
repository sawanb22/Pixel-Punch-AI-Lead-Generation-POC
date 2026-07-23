/** Ops console UI helpers shared by the dashboard frontend. */

export const OPS_POLL_INTERVAL_MS = 5000;

/**
 * @param {string | null | undefined} status
 * @returns {boolean}
 */
export function shouldContinueOpsPoll(status) {
  return status === "running";
}

/**
 * @param {Iterable<string>} previousOpen
 * @param {Iterable<string>} availableIds
 * @returns {string[]}
 */
export function mergeOpenOpsFieldIds(previousOpen, availableIds) {
  const available = new Set(availableIds);
  const out = [];
  for (const id of previousOpen) {
    if (available.has(id)) out.push(id);
  }
  return out;
}

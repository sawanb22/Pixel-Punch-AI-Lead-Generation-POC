import {
  evaluateHardShield,
  isBlockedHost,
  type HardShieldDecision,
  type HardShieldOptions,
} from "./hard-shield.js";
import type { DiscoveredCompanyCandidate } from "./types.js";

export { isBlockedHost } from "./hard-shield.js";

export type NoiseDecision = HardShieldDecision;

export type NoiseFilterOptions = HardShieldOptions;

/** @deprecated Prefer evaluateHardShield — kept as alias for existing call sites. */
export function evaluateCandidateNoise(
  candidate: DiscoveredCompanyCandidate,
  options?: NoiseFilterOptions
): NoiseDecision {
  return evaluateHardShield(candidate, options);
}

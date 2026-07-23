/**
 * Quality circuit breaker — prefer fewer good leads over padding volume with junk.
 */

export const DEFAULT_JUNK_RATIO_THRESHOLD = 0.6;

export interface CircuitBreakerState {
  fetched: number;
  kept: number;
  rejected: number;
  tripped: boolean;
  reason: string | null;
}

export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    fetched: 0,
    kept: 0,
    rejected: 0,
    tripped: false,
    reason: null,
  };
}

export function recordJobOutcome(
  state: CircuitBreakerState,
  outcome: { fetched: number; kept: number; rejected: number },
  threshold = DEFAULT_JUNK_RATIO_THRESHOLD
): CircuitBreakerState {
  const next: CircuitBreakerState = {
    ...state,
    fetched: state.fetched + outcome.fetched,
    kept: state.kept + outcome.kept,
    rejected: state.rejected + outcome.rejected,
    tripped: state.tripped,
    reason: state.reason,
  };

  const decided = next.kept + next.rejected;
  if (!next.tripped && decided >= 8) {
    const junkRatio = next.rejected / decided;
    if (junkRatio > threshold) {
      next.tripped = true;
      next.reason = `junk_ratio=${junkRatio.toFixed(2)}>${threshold} (rejected ${next.rejected}/${decided})`;
    }
  }
  return next;
}

export function shouldStopFurtherJobs(state: CircuitBreakerState): boolean {
  return state.tripped;
}

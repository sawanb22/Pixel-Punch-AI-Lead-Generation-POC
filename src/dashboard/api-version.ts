/** Bump when list-scoped API shape changes; UI uses this to detect stale servers. */
export const DASHBOARD_API_VERSION = 2;

export const DASHBOARD_API_FEATURES = [
  "list-scoped-routes",
  "plan-context-hash",
  "plan-state",
] as const;

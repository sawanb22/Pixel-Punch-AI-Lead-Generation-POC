export interface CompanyEnrichmentConfig {
  enabled: boolean;
  maxCompanies: number;
  maxPagesPerCompany: number;
  concurrency: number;
  timeoutSeconds: number;
  respectRobots: boolean;
  autoAfterLeadFinding: boolean;
  useJinaReader: boolean;
}

const DEFAULTS: CompanyEnrichmentConfig = {
  enabled: true,
  maxCompanies: 100,
  maxPagesPerCompany: 8,
  concurrency: 5,
  timeoutSeconds: 10,
  respectRobots: true,
  autoAfterLeadFinding: false,
  useJinaReader: true,
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseCompanyEnrichmentConfig(
  sourceConfig: unknown
): CompanyEnrichmentConfig {
  const root = asObject(sourceConfig) ?? {};
  const cfg = asObject(root.companyEnrichment) ?? {};
  return {
    enabled: cfg.enabled !== false,
    maxCompanies:
      typeof cfg.maxCompanies === "number" && cfg.maxCompanies > 0
        ? cfg.maxCompanies
        : DEFAULTS.maxCompanies,
    maxPagesPerCompany:
      typeof cfg.maxPagesPerCompany === "number" && cfg.maxPagesPerCompany > 0
        ? cfg.maxPagesPerCompany
        : DEFAULTS.maxPagesPerCompany,
    concurrency:
      typeof cfg.concurrency === "number" && cfg.concurrency > 0
        ? cfg.concurrency
        : DEFAULTS.concurrency,
    timeoutSeconds:
      typeof cfg.timeoutSeconds === "number" && cfg.timeoutSeconds > 0
        ? cfg.timeoutSeconds
        : DEFAULTS.timeoutSeconds,
    respectRobots: cfg.respectRobots !== false,
    autoAfterLeadFinding: cfg.autoAfterLeadFinding === true,
    useJinaReader: cfg.useJinaReader !== false,
  };
}

export function parseCompanyEnrichmentConfigFromJson(
  sourceConfigJson: string | null | undefined
): CompanyEnrichmentConfig {
  if (!sourceConfigJson?.trim()) return { ...DEFAULTS };
  try {
    return parseCompanyEnrichmentConfig(JSON.parse(sourceConfigJson));
  } catch {
    return { ...DEFAULTS };
  }
}

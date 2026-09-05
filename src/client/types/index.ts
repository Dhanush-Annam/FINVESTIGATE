import type { Fact, Calculation, Finding, ClaimCheck, Debate } from "../../shared/types/index.js";

export type VerificationScoreboardData = {
  ticker: string;
  production?: {
    totalClaims: number;
    verifiedClaims: number;
    rejectedClaims: number;
    crossCompany: number;
    missingRef: number;
    mismatch: number;
    nullValue: number;
    verificationRate: string;
    interceptionRate: string;
  };
  adversarial?: {
    totalAttacks: number;
    blockedAttacks: number;
    crossCompanyBlocked: number;
    missingRefBlocked: number;
    numericDriftBlocked: number;
    signFlipBlocked: number;
    blockRate: string;
  };
  totalClaims: number;
  verifiedClaims: number;
  rejectedClaims: number;
  crossCompany: number;
  missingRef: number;
  mismatch: number;
  nullValue: number;
  verificationRate: string;
  recentRejections: {
    id: string;
    companyTicker: string;
    claimText: string;
    refId: string;
    result: string;
    detail: string;
    createdAt: string;
  }[];
  recentAttackLogs?: {
    id: string;
    companyTicker: string;
    claimText: string;
    refId: string;
    result: string;
    detail: string;
    createdAt: string;
  }[];
};

export type AttackScenario =
  | "fabricated_id"
  | "cross_company"
  | "numeric_hallucination"
  | "sign_flip_mismatch";

export interface AdversarialAttackResult {
  success: boolean;
  scenario: AttackScenario;
  resultCode:
    | "pass"
    | "pass_numeric"
    | "pass_reference"
    | "pass_semantic"
    | "fail_missing_ref"
    | "fail_mismatch"
    | "fail_cross_company"
    | "fail_period"
    | "fail_null_value"
    | "fail_sign_flip"
    | string;
  pass: boolean;
  reason: string;
  latencyMs: number;
  injectedClaim: string;
  citedRef: string;
  expectedCompany: string;
  actualDbValue: string;
  purgedTokens: string;
  atomicFallbackEngaged: boolean;
  fallbackReplacement: string;
  fallbackRef: string;
}

export type InvestigationData = {
  company: string;
  displayName: string;
  cik: string;
  facts: Fact[];
  calculations: Calculation[];
  findings: Finding[];
  claimChecks: ClaimCheck[];
  debate?: Debate;
  peers?: string[];
  isLiveMode?: boolean;
  cachedAt?: string;
  dataSource?: string;
  verificationStats?: {
    totalClaims: number;
    verifiedClaims: number;
    rejectedClaims: number;
    rejectedItems: { surface: string; claimText: string; reason: string }[];
  };
};

export interface WorkflowStage {
  id: string;
  stepNum: string;
  badge: string;
  label: string;
  title: string;
  desc: string;
  isAttack?: boolean;
}

export const WORKFLOW_STAGES: WorkflowStage[] = [
  {
    id: "investigate",
    stepNum: "01",
    badge: "INVESTIGATE",
    label: "01 INVESTIGATE",
    title: "Filing Ingestion",
    desc: "SEC CIK Resolution & XBRL Fact Extraction",
  },
  {
    id: "discover",
    stepNum: "02",
    badge: "DISCOVER",
    label: "02 DISCOVER",
    title: "Forensic Divergence",
    desc: "6-Signal Quality & Divergence Radar",
  },
  {
    id: "attack",
    stepNum: "03",
    badge: "ATTACK",
    label: "03 ATTACK",
    title: "Live Attack Center",
    desc: "Adversarial Hallucination Interception",
    isAttack: true,
  },
  {
    id: "verify",
    stepNum: "04",
    badge: "VERIFY",
    label: "04 VERIFY",
    title: "Citation Gate",
    desc: "100% DB Trust Scoreboard & Lineage DAG",
  },
  {
    id: "challenge",
    stepNum: "05",
    badge: "CHALLENGE",
    label: "05 CHALLENGE",
    title: "Courtroom Debate",
    desc: "Tri-Agent Bull vs Bear Reasoning",
  },
  {
    id: "conclude",
    stepNum: "06",
    badge: "CONCLUDE",
    label: "06 CONCLUDE",
    title: "Investigation Brief",
    desc: "Defensible Forensic Diligence Outcome",
  },
];

export const labelFor = (metric: string) =>
  ({
    revenue_growth_yoy: "Revenue growth",
    netIncome_growth_yoy: "Net income growth",
    operatingCashFlow_growth_yoy: "Operating cash-flow growth",
    receivables_growth_yoy: "Receivables growth",
    free_cash_flow: "Free cash flow",
    cash_conversion_ratio: "Cash conversion ratio",
    capex_to_ocf_ratio: "CapEx / OCF ratio",
  }[metric] ?? metric);

export const displayCalculationValue = (calculation: { value: number | null; unit: string; formula: string }) => {
  if (calculation.formula.startsWith("sign_flip")) {
    const match = calculation.formula.match(/^sign_flip \(([^)]+)\)/);
    if (match) return match[1];
  }
  if (calculation.value === null) return "N/A";
  if (calculation.unit === "PERCENT") return `${(calculation.value * 100).toFixed(1)}%`;
  if (calculation.unit === "RATIO") return `${calculation.value.toFixed(2)}x`;
  if (calculation.unit === "USD") return `$${(calculation.value / 1_000_000_000).toFixed(1)}B`;
  if (calculation.unit === "INR") {
    if (Math.abs(calculation.value) >= 10_000_000) {
      return `₹${(calculation.value / 10_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} Cr`;
    }
    return `₹${calculation.value.toLocaleString()}`;
  }
  return calculation.value.toLocaleString();
};

export const displayValue = (value: number | null, unit: string) => {
  if (value === null) return "Unavailable";
  if (unit === "PERCENT") return `${(value * 100).toFixed(1)}%`;
  if (unit === "RATIO") return `${value.toFixed(2)}x`;
  if (unit === "USD") return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (unit === "INR") {
    if (Math.abs(value) >= 10_000_000) {
      return `₹${(value / 10_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} Cr`;
    }
    return `₹${value.toLocaleString()}`;
  }
  return value.toLocaleString();
};

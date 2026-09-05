import type { Finding, DiligenceVerdict } from "../types/index.js";
import { PASS_RESULT_CODES } from "../constants/index.js";

export function isVerificationPass(result: string | null | undefined): boolean {
  return typeof result === "string" && PASS_RESULT_CODES.has(result);
}

export function getMaterialRedFlags(findings: Finding[]): Finding[] {
  return findings.filter(
    (f) => f.severity === "HIGH" || (f.severity === "MEDIUM" && f.status === "requires_investigation")
  );
}

export function getLowSeveritySignals(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "LOW" || f.status === "positive_signal");
}

export function getDiligenceVerdict(findings: Finding[], _companyTicker?: string): DiligenceVerdict {
  const materialRedFlags = getMaterialRedFlags(findings);
  const lowSeverity = getLowSeveritySignals(findings);

  if (materialRedFlags.some((f) => f.severity === "HIGH")) {
    return {
      verdict: "HIGH_RISK",
      heading: "HIGH RISK",
      subtextBadge: "Material Red Flags Detected",
      narrative:
        "Material divergence detected between reported accounting statements and operational cash generation. Immediate forensic audit warranted.",
    };
  }

  if (materialRedFlags.length > 0) {
    return {
      verdict: "REQUIRES_FURTHER_INVESTIGATION",
      heading: "REQUIRES FURTHER INVESTIGATION",
      subtextBadge: `${materialRedFlags.length} Material Divergence Flag${materialRedFlags.length > 1 ? "s" : ""}`,
      narrative:
        "Significant variance identified between reported accounting profits and operating cash flows requiring detailed disclosure audit.",
    };
  }

  if (lowSeverity.length > 0) {
    return {
      verdict: "MONITOR",
      heading: "MONITOR",
      subtextBadge: "No Material Red Flags",
      narrative:
        "No material forensic accounting divergence was detected in the available filing evidence. Receivables growth remained broadly aligned with revenue growth, but the absolute increase warrants quarterly aging and customer-concentration review.",
    };
  }

  return {
    verdict: "CLEAR",
    heading: "CLEAR",
    subtextBadge: "Balanced Audit Profile",
    narrative:
      "Financial statements reflect disciplined cash generation, aligned working capital, and no material screening threshold breaches.",
  };
}

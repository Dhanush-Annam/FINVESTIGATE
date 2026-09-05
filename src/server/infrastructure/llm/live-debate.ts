import type { Calculation, Debate, Fact, Finding } from "../../../shared/types/index.js";
import { calculateFundamentalScores } from "../../domain/fundamental-scorer.js";

export function generateLiveDebate(
  company: string,
  displayName: string,
  calculations: Calculation[],
  findings: Finding[],
  facts?: Fact[]
): Debate {
  const revGrowth = calculations.find((c) => c.metric === "revenue_growth_yoy");
  const ocfGrowth = calculations.find((c) => c.metric === "operatingCashFlow_growth_yoy");
  const niGrowth = calculations.find((c) => c.metric === "netIncome_growth_yoy");
  const arGrowth = calculations.find((c) => c.metric === "receivables_growth_yoy");

  const fcfCalc = calculations.find((c) => c.metric === "free_cash_flow");

  const bullArguments = [];
  const bearArguments = [];

  const formatGrowthVal = (c?: Calculation) => {
    if (!c) return "N/A";
    if (c.formula.startsWith("sign_flip")) {
      const match = c.formula.match(/^sign_flip \(([^)]+)\)/);
      return match ? match[1] : "sign flip";
    }
    if (c.unit === "USD" && c.value !== null) {
      return `$${(c.value / 1_000_000_000).toFixed(1)}B`;
    }
    return c.value !== null ? `${(c.value * 100).toFixed(1)}%` : "N/A";
  };

  if (revGrowth && (revGrowth.value !== null ? revGrowth.value > 0 : revGrowth.formula.includes("turned profitable"))) {
    bullArguments.push({
      argument: `${displayName} achieved positive revenue performance YoY in ${revGrowth.period.label}.`,
      evidence: [{ metric: "Revenue growth", value: formatGrowthVal(revGrowth), reference: revGrowth.calcId }],
      caveat: "Revenue expansion alone does not guarantee operating efficiency or margin sustainability.",
    });
  }

  if (fcfCalc && fcfCalc.value !== null && fcfCalc.value > 0) {
    bullArguments.push({
      argument: `${displayName} maintained positive free cash flow generation of ${formatGrowthVal(fcfCalc)} in ${fcfCalc.period.label}.`,
      evidence: [{ metric: "Free cash flow", value: formatGrowthVal(fcfCalc), reference: fcfCalc.calcId }],
      caveat: "Free cash flow sustainability depends on ongoing capital expenditure requirements.",
    });
  }

  if (ocfGrowth && (ocfGrowth.value !== null ? ocfGrowth.value > 0 : ocfGrowth.formula.includes("turned profitable"))) {
    bullArguments.push({
      argument: `Operating cash flow expanded in ${ocfGrowth.period.label}, supporting cash generation.`,
      evidence: [{ metric: "Operating cash-flow growth", value: formatGrowthVal(ocfGrowth), reference: ocfGrowth.calcId }],
      caveat: "Cash flow trends require ongoing monitoring across working capital components.",
    });
  }

  if (bullArguments.length === 0) {
    const baselineCalc = calculations[0];
    bullArguments.push({
      argument: `${displayName} maintains active operations and verified 10-K disclosures for ${baselineCalc?.period.label || "the current fiscal period"}.`,
      evidence: [
        {
          metric: baselineCalc ? labelForMetric(baselineCalc.metric) : "Reporting status",
          value: formatGrowthVal(baselineCalc),
          reference: baselineCalc?.calcId || "FACT",
        },
      ],
      caveat: "Reported data availability does not establish financial growth momentum.",
    });
  }

  if (arGrowth && revGrowth && arGrowth.value !== null && revGrowth.value !== null && arGrowth.value > revGrowth.value) {
    bearArguments.push({
      argument: `Accounts receivable growth (${formatGrowthVal(arGrowth)}) outpaced revenue growth (${formatGrowthVal(revGrowth)}).`,
      evidence: [
        { metric: "Receivables growth", value: formatGrowthVal(arGrowth), reference: arGrowth.calcId },
        { metric: "Revenue growth", value: formatGrowthVal(revGrowth), reference: revGrowth.calcId },
      ],
      caveat: "Receivables expansion may reflect sales timing or extended customer terms rather than uncollectible balances.",
    });
  }

  if (niGrowth && ocfGrowth && niGrowth.value !== null && ocfGrowth.value !== null && ocfGrowth.value < niGrowth.value) {
    bearArguments.push({
      argument: `Operating cash flow growth (${formatGrowthVal(ocfGrowth)}) trailed net income growth (${formatGrowthVal(niGrowth)}).`,
      evidence: [
        { metric: "Net income growth", value: formatGrowthVal(niGrowth), reference: niGrowth.calcId },
        { metric: "Operating cash flow growth", value: formatGrowthVal(ocfGrowth), reference: ocfGrowth.calcId },
      ],
      caveat: "Divergence between cash conversion and net income requires multi-quarter tracking.",
    });
  }

  if (bearArguments.length === 0) {
    bearArguments.push({
      argument: `Financial performance remains subject to macroeconomic headwinds and industry competition.`,
      evidence: [{ metric: "Scope limit", value: "Standard EDGAR disclosure", reference: "FACT" }],
      caveat: "No automated anomaly rules triggered on the available annual facts.",
    });
  }

  const unresolvedQuestion =
    findings.length > 0
      ? `What factors drove the observed divergence in ${findings[0].category} during ${calculations[0]?.period.label || "the current period"}?`
      : `Can ${displayName} sustain its current cash flow and growth profile into upcoming fiscal periods?`;

  const scores = calculateFundamentalScores(calculations, findings, facts);

  return {
    bullCase: {
      arguments: bullArguments,
      overallStrength: scores.bullScore,
      factors: scores.bullFactors,
    },
    bearCase: {
      arguments: bearArguments,
      overallStrength: scores.bearScore,
      factors: scores.bearFactors,
    },
    judgeVerdict: {
      evidenceQuality: scores.evidenceQuality,
      mostImportantUnresolvedQuestion: unresolvedQuestion,
      explanation: `Automated investigation over ${displayName}'s live SEC EDGAR filings verified core financial growth and anomaly rules. Oral conference call quotes are excluded to preserve 100% SEC primary-source auditability.`,
      bullScore: scores.bullScore,
      bearScore: scores.bearScore,
      bullFactors: scores.bullFactors,
      bearFactors: scores.bearFactors,
    },
  };
}

function labelForMetric(metric: string): string {
  const map: Record<string, string> = {
    revenue_growth_yoy: "Revenue growth",
    netIncome_growth_yoy: "Net income growth",
    operatingCashFlow_growth_yoy: "Operating cash-flow growth",
    receivables_growth_yoy: "Receivables growth",
    free_cash_flow: "Free cash flow",
  };
  return map[metric] || metric;
}

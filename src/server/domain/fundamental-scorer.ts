import type { Calculation, Finding, Fact } from "../../shared/types/index.js";

export interface ScoreFactor {
  factor: string;
  contribution: number;
  evidence: string;
}

export interface FundamentalScoresResult {
  bullScore: number;
  bearScore: number;
  bullFactors: ScoreFactor[];
  bearFactors: ScoreFactor[];
  evidenceQuality: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Calculates deterministic, evidence-based Bull and Bear conviction scores
 * directly from audited financial calculations and forensic findings.
 *
 * Requirements:
 * - Pure, deterministic, testable (no LLM, no ticker hacks, no random numbers)
 * - Scores bounded between 1.0 and 9.5
 * - Missing data contributes zero evidence (missing != negative)
 * - Returns transparent, explainable factor contributions
 */
export function calculateFundamentalScores(
  calculations: Calculation[] = [],
  findings: Finding[] = [],
  facts?: Fact[]
): FundamentalScoresResult {
  // 1. Zero/Empty Evidence Neutral Fallback
  if ((!calculations || calculations.length === 0) && (!findings || findings.length === 0)) {
    return {
      bullScore: 3.5,
      bearScore: 3.5,
      bullFactors: [],
      bearFactors: [],
      evidenceQuality: "LOW",
    };
  }

  // Helper to find calculations by metric name
  const findCalc = (metric: string): Calculation | undefined =>
    calculations.find((c) => c.metric === metric);

  const revGrowth = findCalc("revenue_growth_yoy");
  const niGrowth = findCalc("netIncome_growth_yoy");
  const ocfGrowth = findCalc("operatingCashFlow_growth_yoy");
  const fcfCalc = findCalc("free_cash_flow");
  const arGrowth = findCalc("receivables_growth_yoy");
  const cashConv = findCalc("cash_conversion_ratio");
  const capexOcf = findCalc("capex_to_ocf_ratio");

  // Determine Evidence Quality based on availability of primary calculations
  const availableCoreMetrics = [revGrowth, niGrowth, ocfGrowth, fcfCalc, cashConv].filter(
    (c) => c !== undefined && (c.value !== null || c.formula.startsWith("sign_flip"))
  ).length;

  let evidenceQuality: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (availableCoreMetrics >= 4) {
    evidenceQuality = "HIGH";
  } else if (availableCoreMetrics >= 2) {
    evidenceQuality = "MEDIUM";
  }

  // 2. Compute Bull Score (Neutral baseline: 3.5)
  let rawBull = 3.5;
  const bullFactors: ScoreFactor[] = [];

  const addBullFactor = (factor: string, contribution: number, evidence: string) => {
    rawBull += contribution;
    bullFactors.push({
      factor,
      contribution: Math.round(contribution * 100) / 100,
      evidence,
    });
  };

  // Bull Factor A: Revenue Growth
  if (revGrowth) {
    if (revGrowth.value !== null && revGrowth.value > 0) {
      if (revGrowth.value >= 0.50) {
        addBullFactor("Revenue Expansion (Rapid)", 1.5, `Revenue grew exceptionally at +${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
      } else if (revGrowth.value >= 0.20) {
        addBullFactor("Revenue Expansion (Robust)", 1.2, `Revenue grew robustly at +${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
      } else if (revGrowth.value >= 0.05) {
        addBullFactor("Revenue Growth (Moderate)", 0.8, `Revenue expanded steadily at +${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
      } else {
        addBullFactor("Revenue Growth (Modest)", 0.4, `Revenue maintained positive performance at +${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
      }
    } else if (revGrowth.value === null && revGrowth.formula.includes("turned profitable")) {
      addBullFactor("Revenue Trajectory", 1.0, `Revenue turned positive YoY in ${revGrowth.period.label}.`);
    }
  }

  // Bull Factor B: Free Cash Flow Generation
  if (fcfCalc && fcfCalc.value !== null && fcfCalc.value > 0) {
    const isINR = fcfCalc.unit === "INR";
    const formattedFcf = isINR
      ? `₹${(fcfCalc.value / 10_000_000).toFixed(0)} Cr`
      : `$${(fcfCalc.value / 1_000_000_000).toFixed(1)}B`;

    // Currency-sensitive thresholds:
    // USD: Massive >= $20B, Strong >= $5B
    // INR: Massive >= ₹1.6 Lakh Cr (1.6T INR), Strong >= ₹40,000 Cr (400B INR)
    // Also supports relative FCF margin (FCF / Revenue >= 25% massive, >= 10% strong)
    const massiveThreshold = isINR ? 1_600_000_000_000 : 20_000_000_000;
    const strongThreshold = isINR ? 400_000_000_000 : 5_000_000_000;

    let fcfMargin: number | null = null;
    if (facts && facts.length > 0) {
      const revFact = facts.find((f) => f.metric === "revenue" && f.period.label === fcfCalc.period.label);
      if (revFact && typeof revFact.value === "number" && revFact.value > 0) {
        fcfMargin = fcfCalc.value / revFact.value;
      }
    }

    if (fcfCalc.value >= massiveThreshold || (fcfMargin !== null && fcfMargin >= 0.25)) {
      addBullFactor("Free Cash Flow Generation (Massive)", 1.5, `Generated ${formattedFcf} in free cash flow in ${fcfCalc.period.label}, providing superior capital flexibility.`);
    } else if (fcfCalc.value >= strongThreshold || (fcfMargin !== null && fcfMargin >= 0.10)) {
      addBullFactor("Free Cash Flow Generation (Strong)", 1.2, `Generated ${formattedFcf} in free cash flow in ${fcfCalc.period.label}.`);
    } else {
      addBullFactor("Free Cash Flow Generation (Positive)", 0.8, `Maintained positive free cash flow generation of ${formattedFcf} in ${fcfCalc.period.label}.`);
    }
  }

  // Bull Factor C: Operating Cash Flow Growth
  if (ocfGrowth) {
    if (ocfGrowth.value !== null && ocfGrowth.value > 0) {
      if (ocfGrowth.value >= 0.30) {
        addBullFactor("Cash Flow Expansion (Surging)", 1.2, `Operating cash flow surged +${(ocfGrowth.value * 100).toFixed(1)}% YoY in ${ocfGrowth.period.label}.`);
      } else if (ocfGrowth.value >= 0.10) {
        addBullFactor("Cash Flow Expansion (Solid)", 0.8, `Operating cash flow expanded +${(ocfGrowth.value * 100).toFixed(1)}% YoY in ${ocfGrowth.period.label}.`);
      } else {
        addBullFactor("Cash Flow Expansion (Positive)", 0.4, `Operating cash flow grew +${(ocfGrowth.value * 100).toFixed(1)}% YoY in ${ocfGrowth.period.label}.`);
      }
    } else if (ocfGrowth.value === null && ocfGrowth.formula.includes("turned profitable")) {
      addBullFactor("Cash Flow Turnaround", 1.1, `Operating cash generation turned profitable in ${ocfGrowth.period.label}.`);
    }
  }

  // Bull Factor D: Profitability / Net Income Performance
  if (niGrowth) {
    if (niGrowth.value !== null && niGrowth.value > 0) {
      if (niGrowth.value >= 0.30) {
        addBullFactor("Earnings Expansion (High)", 1.2, `Net income accelerated +${(niGrowth.value * 100).toFixed(1)}% YoY in ${niGrowth.period.label}.`);
      } else if (niGrowth.value >= 0.10) {
        addBullFactor("Earnings Growth (Steady)", 0.8, `Net income expanded +${(niGrowth.value * 100).toFixed(1)}% YoY in ${niGrowth.period.label}.`);
      } else {
        addBullFactor("Earnings Growth (Modest)", 0.4, `Net income maintained positive expansion +${(niGrowth.value * 100).toFixed(1)}% YoY in ${niGrowth.period.label}.`);
      }
    } else if (niGrowth.value === null) {
      if (niGrowth.formula.includes("turned profitable")) {
        addBullFactor("Earnings Turnaround", 1.3, `Turned profitable in ${niGrowth.period.label}, swinging from previous net losses.`);
      } else if (niGrowth.formula.includes("loss narrowed")) {
        addBullFactor("Loss Narrowing", 0.6, `Operational net loss narrowed YoY in ${niGrowth.period.label}.`);
      }
    }
  }

  // Bull Factor E: Cash Conversion Quality (OCF >= Net Income)
  if (cashConv && cashConv.value !== null && cashConv.value >= 1.0) {
    if (cashConv.value >= 1.25) {
      addBullFactor("Earnings Quality (Superior)", 0.9, `High accounting quality: Operating cash flow represents ${cashConv.value.toFixed(2)}x of reported net income.`);
    } else {
      addBullFactor("Earnings Quality (Healthy)", 0.6, `Clean cash conversion: Operating cash flow exceeds reported net income (${cashConv.value.toFixed(2)}x).`);
    }
  }

  // Bull Factor F: Prudent Capital Intensity (CapEx <= 40% of OCF)
  if (capexOcf && capexOcf.value !== null && capexOcf.value > 0 && capexOcf.value <= 0.40) {
    addBullFactor("Prudent Capital Intensity", 0.5, `Capital expenditures absorb only ${(capexOcf.value * 100).toFixed(1)}% of operating cash flow.`);
  }

  // Bull Factor G: Clean Forensic Profile
  if (availableCoreMetrics >= 3 && findings.length === 0) {
    addBullFactor("Clean Forensic Record", 0.8, "Zero accounting anomalies, revenue divergences, or cash-conversion red flags detected.");
  }

  // 3. Compute Bear Score (Neutral baseline: 3.5)
  let rawBear = 3.5;
  const bearFactors: ScoreFactor[] = [];

  const addBearFactor = (factor: string, contribution: number, evidence: string) => {
    rawBear += contribution;
    bearFactors.push({
      factor,
      contribution: Math.round(contribution * 100) / 100,
      evidence,
    });
  };

  // Track anomaly rules addressed by findings to prevent double counting
  const reportedAnomalyRules = new Set<string>();

  // Bear Factor A: Forensic Anomalies (Severity-Weighted)
  // Deduplicate findings by rule/category to prevent repeated manifestations from inflating
  const seenObservationKeys = new Set<string>();
  for (const finding of findings) {
    const key = `${finding.category}-${finding.signalName}`;
    if (seenObservationKeys.has(key)) continue;
    seenObservationKeys.add(key);

    const severityWeight =
      finding.severity === "HIGH" ? 1.8 : finding.severity === "MEDIUM" ? 1.1 : 0.5;

    addBearFactor(
      `Forensic Anomaly: ${finding.signalName || finding.category}`,
      severityWeight,
      finding.claim || `Flagged anomaly in ${finding.category} with ${finding.severity.toLowerCase()} severity.`
    );

    // Map to known rule types
    if (finding.signalName?.includes("Receivables") || finding.claim?.includes("receivable")) {
      reportedAnomalyRules.add("receivables_outpacing_revenue");
    }
    if (finding.signalName?.includes("Earnings–Cash") || finding.claim?.includes("trailed net income")) {
      reportedAnomalyRules.add("cash_flow_quality_divergence");
    }
    if (finding.signalName?.includes("Free Cash Flow") || finding.claim?.includes("Free cash flow was negative")) {
      reportedAnomalyRules.add("negative_free_cash_flow");
    }
    if (finding.signalName?.includes("Conversion") || finding.claim?.includes("conversion")) {
      reportedAnomalyRules.add("cash_conversion_deterioration");
    }
    if (finding.signalName?.includes("CapEx") || finding.claim?.includes("Capital expenditures consumed")) {
      reportedAnomalyRules.add("capex_absorption_stress");
    }
  }

  // Bear Factor B: Revenue Contraction
  if (revGrowth && revGrowth.value !== null && revGrowth.value < 0) {
    if (revGrowth.value <= -0.20) {
      addBearFactor("Top-Line Contraction (Severe)", 1.5, `Revenue contracted sharply by ${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
    } else if (revGrowth.value <= -0.05) {
      addBearFactor("Top-Line Contraction", 1.0, `Revenue declined ${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
    } else {
      addBearFactor("Top-Line Stagnation", 0.5, `Revenue contracted modestly by ${(revGrowth.value * 100).toFixed(1)}% YoY in ${revGrowth.period.label}.`);
    }
  }

  // Bear Factor C: Profitability Deterioration / Net Loss
  if (niGrowth) {
    if (niGrowth.value !== null && niGrowth.value < 0) {
      if (niGrowth.value <= -0.25) {
        addBearFactor("Earnings Contraction (Severe)", 1.4, `Net income contracted sharply by ${(niGrowth.value * 100).toFixed(1)}% YoY in ${niGrowth.period.label}.`);
      } else {
        addBearFactor("Earnings Contraction", 0.8, `Net income contracted by ${(niGrowth.value * 100).toFixed(1)}% YoY in ${niGrowth.period.label}.`);
      }
    } else if (niGrowth.value === null) {
      if (niGrowth.formula.includes("swung to loss")) {
        addBearFactor("Earnings Deterioration (Swung to Loss)", 1.8, `Swung from profitability into net loss in ${niGrowth.period.label}.`);
      } else if (niGrowth.formula.includes("loss widened")) {
        addBearFactor("Loss Acceleration", 1.5, `Net losses widened further YoY in ${niGrowth.period.label}.`);
      }
    }
  }

  // Bear Factor D: Operating Cash Flow Contraction
  if (ocfGrowth) {
    if (ocfGrowth.value !== null && ocfGrowth.value < 0) {
      if (ocfGrowth.value <= -0.20) {
        addBearFactor("Cash Generation Contraction (Severe)", 1.4, `Operating cash flow dropped ${(ocfGrowth.value * 100).toFixed(1)}% YoY in ${ocfGrowth.period.label}.`);
      } else {
        addBearFactor("Cash Generation Contraction", 0.8, `Operating cash flow declined ${(ocfGrowth.value * 100).toFixed(1)}% YoY in ${ocfGrowth.period.label}.`);
      }
    } else if (ocfGrowth.value === null && ocfGrowth.formula.includes("swung to loss")) {
      addBearFactor("Cash Flow Deficit", 1.6, `Operating cash generation collapsed into negative territory in ${ocfGrowth.period.label}.`);
    }
  }

  // Bear Factor E: Negative Free Cash Flow (if not already reported in findings)
  if (fcfCalc && fcfCalc.value !== null && fcfCalc.value < 0 && !reportedAnomalyRules.has("negative_free_cash_flow")) {
    const formattedFcf = fcfCalc.unit === "INR"
      ? `₹${(Math.abs(fcfCalc.value) / 10_000_000).toFixed(0)} Cr`
      : `$${(Math.abs(fcfCalc.value) / 1_000_000_000).toFixed(1)}B`;
    addBearFactor("Negative Free Cash Flow", 1.4, `Free cash flow was negative (${formattedFcf} burn) in ${fcfCalc.period.label}.`);
  }

  // Bear Factor F: Cash Conversion Deterioration (OCF < 0.70 * Net Income)
  if (cashConv && cashConv.value !== null && cashConv.value < 0.70 && !reportedAnomalyRules.has("cash_conversion_deterioration")) {
    addBearFactor("Weak Cash Conversion", 0.9, `Operating cash generation converted only ${(cashConv.value * 100).toFixed(1)}% of reported accounting net income.`);
  }

  // Bear Factor G: CapEx Cash Absorption Stress (CapEx > 80% of OCF)
  if (capexOcf && capexOcf.value !== null && capexOcf.value > 0.80 && !reportedAnomalyRules.has("capex_absorption_stress")) {
    addBearFactor("High CapEx Cash Absorption", 0.9, `Capital expenditures consumed ${(capexOcf.value * 100).toFixed(1)}% of operating cash flow.`);
  }

  // 4. Mathematical Clamping & Rounding (strictly bounded: 1.0 <= score <= 9.5)
  const clampedBull = Math.min(9.5, Math.max(1.0, Math.round(rawBull * 10) / 10));
  const clampedBear = Math.min(9.5, Math.max(1.0, Math.round(rawBear * 10) / 10));

  return {
    bullScore: clampedBull,
    bearScore: clampedBear,
    bullFactors,
    bearFactors,
    evidenceQuality,
  };
}

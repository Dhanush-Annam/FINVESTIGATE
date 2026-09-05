import { describe, expect, it } from "vitest";
import { calculateFundamentalScores } from "../../src/server/domain/fundamental-scorer.js";
import { buildCoreCalculations } from "../../src/server/domain/calculations.js";
import { detectAnomalies } from "../../src/server/domain/findings.js";
import { generateLiveDebate } from "../../src/server/infrastructure/llm/live-debate.js";
import type { Calculation, Finding, Period, Fact } from "../../src/shared/types/index.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Dynamic Evidence-Based Fundamental Scoring", () => {
  const periodFY2025: Period = { label: "FY2025", endDate: "2025-12-31", kind: "annual" };

  // Test 1 — Strong Fundamentals
  it("Test 1 — Strong Fundamentals: Bull is materially elevated and exceeds Bear", () => {
    const strongCalculations: Calculation[] = [
      {
        calcId: "CALC-STRONG-REV",
        company: "STRONG",
        metric: "revenue_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F1", "F2"],
        value: 0.45, // +45% YoY
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-STRONG-FCF",
        company: "STRONG",
        metric: "free_cash_flow",
        period: periodFY2025,
        formula: "OCF - CapEx",
        inputFactIds: ["F3", "F4"],
        value: 25_000_000_000, // $25B FCF
        unit: "USD",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-STRONG-OCF",
        company: "STRONG",
        metric: "operatingCashFlow_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F3", "F5"],
        value: 0.35, // +35% YoY
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-STRONG-NI",
        company: "STRONG",
        metric: "netIncome_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F6", "F7"],
        value: 0.40, // +40% YoY
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-STRONG-CONV",
        company: "STRONG",
        metric: "cash_conversion_ratio",
        period: periodFY2025,
        formula: "OCF / NI",
        inputFactIds: ["F3", "F6"],
        value: 1.30, // 1.30x conversion
        unit: "RATIO",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-STRONG-CAPEX",
        company: "STRONG",
        metric: "capex_to_ocf_ratio",
        period: periodFY2025,
        formula: "CapEx / OCF",
        inputFactIds: ["F4", "F3"],
        value: 0.25, // 25% CapEx burden
        unit: "RATIO",
        type: "CALCULATION",
      },
    ];

    const result = calculateFundamentalScores(strongCalculations, []);
    expect(result.bullScore).toBeGreaterThan(result.bearScore);
    expect(result.bullScore).toBeGreaterThanOrEqual(7.5);
    expect(result.bearScore).toBeLessThanOrEqual(3.5);
    expect(result.evidenceQuality).toBe("HIGH");
    expect(result.bullFactors.length).toBeGreaterThan(0);
    expect(result.bearFactors.length).toBe(0);
  });

  // Test 2 — Weak / Turnaround Fundamentals
  it("Test 2 — Weak / Turnaround Fundamentals: Bear is materially elevated and exceeds Bull", () => {
    const weakCalculations: Calculation[] = [
      {
        calcId: "CALC-WEAK-REV",
        company: "WEAK",
        metric: "revenue_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F1", "F2"],
        value: -0.22, // -22% YoY contraction
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-WEAK-NI",
        company: "WEAK",
        metric: "netIncome_growth_yoy",
        period: periodFY2025,
        formula: "sign_flip (swung to loss): dollar change -$5.0B",
        inputFactIds: ["F3", "F4"],
        value: null, // Swung to loss
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-WEAK-OCF",
        company: "WEAK",
        metric: "operatingCashFlow_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F5", "F6"],
        value: -0.30, // -30% OCF contraction
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-WEAK-FCF",
        company: "WEAK",
        metric: "free_cash_flow",
        period: periodFY2025,
        formula: "OCF - CapEx",
        inputFactIds: ["F5", "F7"],
        value: -4_000_000_000, // -$4B FCF burn
        unit: "USD",
        type: "CALCULATION",
      },
    ];

    const weakFindings: Finding[] = [
      {
        findingId: "FND-01",
        company: "WEAK",
        claim: "Earnings swung into deep operational loss.",
        evidence: [{ evidenceKind: "contextual", metric: "Net income", value: "-$5B" }],
        observationId: "OBS-01",
        calculationRefs: ["CALC-WEAK-NI"],
        evidenceStrength: "HIGH",
        severity: "HIGH",
        status: "requires_investigation",
        category: "cash_flow_quality",
        contradictoryEvidence: "None",
        signalName: "Earnings–Cash Disconnect",
        type: "FINDING",
      },
      {
        findingId: "FND-02",
        company: "WEAK",
        claim: "Receivables expanded while revenue contracted.",
        evidence: [{ evidenceKind: "contextual", metric: "Receivables", value: "+15%" }],
        observationId: "OBS-02",
        calculationRefs: ["CALC-WEAK-REV"],
        evidenceStrength: "HIGH",
        severity: "MEDIUM",
        status: "requires_investigation",
        category: "working_capital",
        contradictoryEvidence: "None",
        signalName: "Receivables–Revenue Divergence",
        type: "FINDING",
      },
    ];

    const result = calculateFundamentalScores(weakCalculations, weakFindings);
    expect(result.bearScore).toBeGreaterThan(result.bullScore);
    expect(result.bearScore).toBeGreaterThanOrEqual(7.0);
    expect(result.bullScore).toBeLessThanOrEqual(4.0);
    expect(result.bearFactors.length).toBeGreaterThan(0);
  });

  // Test 3 — Mixed Fundamentals
  it("Test 3 — Mixed Fundamentals: Both Bull and Bear scores are meaningful", () => {
    const mixedCalculations: Calculation[] = [
      {
        calcId: "CALC-MIX-REV",
        company: "MIXED",
        metric: "revenue_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F1", "F2"],
        value: 0.25, // Strong revenue +25%
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-MIX-FCF",
        company: "MIXED",
        metric: "free_cash_flow",
        period: periodFY2025,
        formula: "OCF - CapEx",
        inputFactIds: ["F3", "F4"],
        value: 3_000_000_000, // Positive $3B FCF
        unit: "USD",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-MIX-CAPEX",
        company: "MIXED",
        metric: "capex_to_ocf_ratio",
        period: periodFY2025,
        formula: "CapEx / OCF",
        inputFactIds: ["F4", "F3"],
        value: 0.85, // Heavy CapEx strain 85%
        unit: "RATIO",
        type: "CALCULATION",
      },
    ];

    const mixedFindings: Finding[] = [
      {
        findingId: "FND-MIX-01",
        company: "MIXED",
        claim: "Uncollected receivables grew faster than sales.",
        evidence: [{ evidenceKind: "contextual", metric: "Divergence", value: ">10pp" }],
        observationId: "OBS-MIX-01",
        calculationRefs: ["CALC-MIX-REV"],
        evidenceStrength: "MEDIUM",
        severity: "MEDIUM",
        status: "requires_investigation",
        category: "working_capital",
        contradictoryEvidence: "None",
        signalName: "Receivables–Revenue Divergence",
        type: "FINDING",
      },
    ];

    const result = calculateFundamentalScores(mixedCalculations, mixedFindings);
    expect(result.bullScore).toBeGreaterThanOrEqual(4.5);
    expect(result.bearScore).toBeGreaterThanOrEqual(4.5);
    expect(result.bullFactors.length).toBeGreaterThan(0);
    expect(result.bearFactors.length).toBeGreaterThan(0);
  });

  // Test 4 — Missing Data
  it("Test 4 — Missing Data: Null/undefined values do not create false negative penalties", () => {
    // Only revenue growth is known, everything else is missing/null
    const sparseCalculations: Calculation[] = [
      {
        calcId: "CALC-SPARSE-REV",
        company: "SPARSE",
        metric: "revenue_growth_yoy",
        period: periodFY2025,
        formula: "YoY Growth",
        inputFactIds: ["F1", "F2"],
        value: 0.15, // +15%
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "CALC-SPARSE-FCF",
        company: "SPARSE",
        metric: "free_cash_flow",
        period: periodFY2025,
        formula: "Unavailable",
        inputFactIds: [],
        value: null, // Missing FCF
        unit: "USD",
        type: "CALCULATION",
      },
    ];

    const result = calculateFundamentalScores(sparseCalculations, []);
    // Bear score should remain at baseline (3.5) because missing FCF is NOT negative FCF
    expect(result.bearScore).toBe(3.5);
    expect(result.bearFactors.length).toBe(0);
    expect(result.bullScore).toBeGreaterThan(3.5);
  });

  // Test 5 — Zero Evidence Fallback
  it("Test 5 — Zero Evidence: Returns neutral baseline without fabricating confidence", () => {
    const result = calculateFundamentalScores([], []);
    expect(result.bullScore).toBe(3.5);
    expect(result.bearScore).toBe(3.5);
    expect(result.bullFactors).toEqual([]);
    expect(result.bearFactors).toEqual([]);
    expect(result.evidenceQuality).toBe("LOW");
  });

  // Test 6 — Determinism
  it("Test 6 — Determinism: Repeated calls with identical inputs yield identical outputs", () => {
    const calcs: Calculation[] = [
      {
        calcId: "CALC-1",
        company: "DET",
        metric: "revenue_growth_yoy",
        period: periodFY2025,
        formula: "YoY",
        inputFactIds: [],
        value: 0.28,
        unit: "PERCENT",
        type: "CALCULATION",
      },
    ];
    const resA = calculateFundamentalScores(calcs, []);
    const resB = calculateFundamentalScores(calcs, []);

    expect(resA.bullScore).toBe(resB.bullScore);
    expect(resA.bearScore).toBe(resB.bearScore);
    expect(resA.bullFactors).toEqual(resB.bullFactors);
    expect(resA.bearFactors).toEqual(resB.bearFactors);
  });

  // Test 7 — Mathematical Bounds
  it("Test 7 — Bounds: Extreme inputs strictly remain within [1.0, 9.5]", () => {
    // Extreme positive
    const hyperBullCalculations: Calculation[] = [
      { calcId: "C1", company: "HYPER", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 10.0, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C2", company: "HYPER", metric: "free_cash_flow", period: periodFY2025, formula: "", inputFactIds: [], value: 100_000_000_000, unit: "USD", type: "CALCULATION" },
      { calcId: "C3", company: "HYPER", metric: "operatingCashFlow_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 5.0, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C4", company: "HYPER", metric: "netIncome_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 8.0, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C5", company: "HYPER", metric: "cash_conversion_ratio", period: periodFY2025, formula: "", inputFactIds: [], value: 3.5, unit: "RATIO", type: "CALCULATION" },
      { calcId: "C6", company: "HYPER", metric: "capex_to_ocf_ratio", period: periodFY2025, formula: "", inputFactIds: [], value: 0.1, unit: "RATIO", type: "CALCULATION" },
    ];
    const bullResult = calculateFundamentalScores(hyperBullCalculations, []);
    expect(bullResult.bullScore).toBeLessThanOrEqual(9.5);
    expect(bullResult.bullScore).toBeGreaterThanOrEqual(1.0);

    // Extreme negative
    const hyperBearCalculations: Calculation[] = [
      { calcId: "C1", company: "DOOM", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: -0.80, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C2", company: "DOOM", metric: "operatingCashFlow_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: -0.90, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C3", company: "DOOM", metric: "free_cash_flow", period: periodFY2025, formula: "", inputFactIds: [], value: -50_000_000_000, unit: "USD", type: "CALCULATION" },
      { calcId: "C4", company: "DOOM", metric: "netIncome_growth_yoy", period: periodFY2025, formula: "sign_flip (swung to loss)", inputFactIds: [], value: null, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C5", company: "DOOM", metric: "cash_conversion_ratio", period: periodFY2025, formula: "", inputFactIds: [], value: 0.2, unit: "RATIO", type: "CALCULATION" },
      { calcId: "C6", company: "DOOM", metric: "capex_to_ocf_ratio", period: periodFY2025, formula: "", inputFactIds: [], value: 2.5, unit: "RATIO", type: "CALCULATION" },
    ];
    const highFindings: Finding[] = [
      { findingId: "F1", company: "DOOM", claim: "Catastrophic earnings disconnect", evidence: [], observationId: "O1", calculationRefs: [], evidenceStrength: "HIGH", severity: "HIGH", status: "requires_investigation", category: "cash_flow_quality", contradictoryEvidence: "", signalName: "Anomaly 1", type: "FINDING" },
      { findingId: "F2", company: "DOOM", claim: "Runaway receivables buildup", evidence: [], observationId: "O2", calculationRefs: [], evidenceStrength: "HIGH", severity: "HIGH", status: "requires_investigation", category: "working_capital", contradictoryEvidence: "", signalName: "Anomaly 2", type: "FINDING" },
      { findingId: "F3", company: "DOOM", claim: "Severe liquidity burn", evidence: [], observationId: "O3", calculationRefs: [], evidenceStrength: "HIGH", severity: "HIGH", status: "requires_investigation", category: "capital_allocation", contradictoryEvidence: "", signalName: "Anomaly 3", type: "FINDING" },
    ];
    const bearResult = calculateFundamentalScores(hyperBearCalculations, highFindings);
    expect(bearResult.bearScore).toBeLessThanOrEqual(9.5);
    expect(bearResult.bearScore).toBeGreaterThanOrEqual(1.0);
  });

  // Test 8 — Anomaly Severity Weighting
  it("Test 8 — Anomaly Severity: HIGH severity yields greater contribution than MEDIUM or LOW", () => {
    const baseCalcs: Calculation[] = [
      { calcId: "C1", company: "TEST", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 0.10, unit: "PERCENT", type: "CALCULATION" }
    ];

    const lowFinding: Finding[] = [
      { findingId: "F1", company: "TEST", claim: "Low anomaly", evidence: [], observationId: "O1", calculationRefs: [], evidenceStrength: "LOW", severity: "LOW", status: "requires_investigation", category: "working_capital", contradictoryEvidence: "", signalName: "Low Severity Warning", type: "FINDING" }
    ];
    const medFinding: Finding[] = [
      { findingId: "F2", company: "TEST", claim: "Medium anomaly", evidence: [], observationId: "O2", calculationRefs: [], evidenceStrength: "MEDIUM", severity: "MEDIUM", status: "requires_investigation", category: "working_capital", contradictoryEvidence: "", signalName: "Medium Severity Warning", type: "FINDING" }
    ];
    const highFinding: Finding[] = [
      { findingId: "F3", company: "TEST", claim: "High anomaly", evidence: [], observationId: "O3", calculationRefs: [], evidenceStrength: "HIGH", severity: "HIGH", status: "requires_investigation", category: "working_capital", contradictoryEvidence: "", signalName: "High Severity Warning", type: "FINDING" }
    ];

    const resLow = calculateFundamentalScores(baseCalcs, lowFinding);
    const resMed = calculateFundamentalScores(baseCalcs, medFinding);
    const resHigh = calculateFundamentalScores(baseCalcs, highFinding);

    expect(resHigh.bearScore).toBeGreaterThan(resMed.bearScore);
    expect(resMed.bearScore).toBeGreaterThan(resLow.bearScore);
  });

  // Test 9 — Real Curated Ticker Cross-Validation: NVDA, AAPL, MSFT, INTC
  it("Test 9 — Real Data Cross-Validation: Old 6.8/4.5 pattern eradicated across curated benchmarks", async () => {
    const tickers = ["NVDA", "AAPL", "MSFT", "INTC"];
    const results: Record<string, { bull: number; bear: number; bullPct: number; bearPct: number }> = {};

    for (const ticker of tickers) {
      const path = resolve(process.cwd(), "data", "curated", `${ticker.toLowerCase()}.json`);
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);

      const periods: Period[] = [...new Map(parsed.facts.map((f: any) => [f.period.label, f.period])).values()]
        .sort((a: any, b: any) => b.endDate.localeCompare(a.endDate)) as Period[];

      const calcs = buildCoreCalculations(parsed.company, parsed.facts, periods[0], periods[1]);
      const anomalies = detectAnomalies(parsed.company, calcs);
      const findings: Finding[] = anomalies.map((a, i) => ({
        findingId: `FINDING-${i}`,
        company: parsed.company,
        claim: a.observation.description,
        evidence: [],
        observationId: a.observation.observationId,
        calculationRefs: a.calculationIds,
        evidenceStrength: "HIGH",
        severity: "MEDIUM",
        status: "requires_investigation",
        category: "working_capital",
        contradictoryEvidence: "",
        signalName: a.observation.signalName,
        type: "FINDING",
      }));

      const debate = generateLiveDebate(parsed.company, parsed.displayName, calcs, findings);
      const bullScore = debate.judgeVerdict.bullScore ?? debate.bullCase.overallStrength;
      const bearScore = debate.judgeVerdict.bearScore ?? debate.bearCase.overallStrength;

      const total = bullScore + bearScore || 10;
      const bullPct = Math.round((bullScore / total) * 100);
      const bearPct = 100 - bullPct;

      results[ticker] = { bull: bullScore, bear: bearScore, bullPct, bearPct };

      // Verify bounds
      expect(bullScore).toBeGreaterThanOrEqual(1.0);
      expect(bullScore).toBeLessThanOrEqual(9.5);
      expect(bearScore).toBeGreaterThanOrEqual(1.0);
      expect(bearScore).toBeLessThanOrEqual(9.5);
      expect(bullPct + bearPct).toBe(100);
    }

    // Explicit confirmation: The old universal 6.8 / 4.5 (60% / 40%) pattern is NO LONGER identical across all companies!
    const scoresAreAllIdentical = tickers.every(
      (t) => results[t].bull === 6.8 && results[t].bear === 4.5 && results[t].bullPct === 60
    );
    expect(scoresAreAllIdentical).toBe(false);

    // NVDA (hyper-growth, massive FCF) should have higher Bull conviction than INTC (restructuring/turnaround)
    expect(results["NVDA"].bull).toBeGreaterThan(results["INTC"].bull);
    // INTC should have higher Bear conviction than NVDA
    expect(results["INTC"].bear).toBeGreaterThanOrEqual(results["NVDA"].bear);
  });

  it("Test 10 — Currency Normalization: INR company with equivalent economics scores appropriately without being distorted by USD thresholds", () => {
    // US company generating $25B FCF (Massive)
    const usdCalcs: Calculation[] = [
      { calcId: "C1", company: "US_CO", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 0.15, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C2", company: "US_CO", metric: "free_cash_flow", period: periodFY2025, formula: "", inputFactIds: [], value: 25_000_000_000, unit: "USD", type: "CALCULATION" },
    ];
    const usdRes = calculateFundamentalScores(usdCalcs, []);
    const usdFcfFactor = usdRes.bullFactors.find((f) => f.factor.includes("Free Cash Flow Generation"));
    expect(usdFcfFactor?.factor).toContain("Massive");

    // Indian company generating ₹2.0 Lakh Cr (~$24B equivalent) FCF (Massive)
    const inrCalcs: Calculation[] = [
      { calcId: "C3", company: "IN_CO", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 0.15, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C4", company: "IN_CO", metric: "free_cash_flow", period: periodFY2025, formula: "", inputFactIds: [], value: 2_000_000_000_000, unit: "INR", type: "CALCULATION" },
    ];
    const inrRes = calculateFundamentalScores(inrCalcs, []);
    const inrFcfFactor = inrRes.bullFactors.find((f) => f.factor.includes("Free Cash Flow Generation"));
    expect(inrFcfFactor?.factor).toContain("Massive");

    // Indian mid-cap generating ₹25 Crore (INR 250M) — positive but NOT massive or strong
    const inrSmallCalcs: Calculation[] = [
      { calcId: "C5", company: "IN_SMALL", metric: "revenue_growth_yoy", period: periodFY2025, formula: "", inputFactIds: [], value: 0.15, unit: "PERCENT", type: "CALCULATION" },
      { calcId: "C6", company: "IN_SMALL", metric: "free_cash_flow", period: periodFY2025, formula: "", inputFactIds: [], value: 250_000_000, unit: "INR", type: "CALCULATION" },
    ];
    const inrSmallRes = calculateFundamentalScores(inrSmallCalcs, []);
    const inrSmallFactor = inrSmallRes.bullFactors.find((f) => f.factor.includes("Free Cash Flow Generation"));
    expect(inrSmallFactor?.factor).toContain("Positive");
    expect(inrSmallFactor?.factor).not.toContain("Massive");
  });
});

import { describe, expect, it } from "vitest";
import { detectAnomalies } from "../../src/server/domain/findings.js";
import type { Calculation, Period } from "../../src/shared/types/index.js";

const period: Period = { label: "FY2025", endDate: "2025-12-31", kind: "annual" };
const calculation = (id: string, metric: string, value: number): Calculation => ({
  calcId: id, company: "TEST", metric, value, period, formula: "test", inputFactIds: [], unit: "PERCENT", type: "CALCULATION",
});

describe("detectAnomalies", () => {
  it("flags cash flow and receivables divergences using deterministic thresholds", () => {
    const results = detectAnomalies("TEST", [
      calculation("1", "netIncome_growth_yoy", 0.3),
      calculation("2", "operatingCashFlow_growth_yoy", 0.1),
      calculation("3", "revenue_growth_yoy", 0.15),
      calculation("4", "receivables_growth_yoy", 0.3),
    ]);
    expect(results.map((result) => result.rule)).toEqual([
      "cash_flow_quality_divergence",
      "receivables_outpacing_revenue",
    ]);
    expect(results[0].signalName).toBe("Earnings–Cash Divergence");
    expect(results[0].observation.whatToInvestigateNext).toContain("Cash Flow Statement");
    expect(results[1].signalName).toBe("Receivables–Revenue Divergence");
    expect(results[1].observation.whatToInvestigateNext).toContain("Days Sales Outstanding");
  });

  it("flags negative free cash flow", () => {
    const results = detectAnomalies("TEST", [
      { ...calculation("1", "free_cash_flow", -250000000), unit: "USD" },
    ]);
    expect(results.length).toBe(1);
    expect(results[0].rule).toBe("negative_free_cash_flow");
    expect(results[0].signalName).toBe("Negative Free Cash Flow");
  });

  it("flags weak cash conversion when ratio is below 0.70", () => {
    const results = detectAnomalies("TEST", [
      { ...calculation("1", "cash_conversion_ratio", 0.55), unit: "RATIO" },
    ]);
    expect(results.length).toBe(1);
    expect(results[0].rule).toBe("cash_conversion_deterioration");
    expect(results[0].signalName).toBe("Weak Cash Conversion");
    expect(results[0].observation.financialRationale).toContain("accrual timing");
  });

  it("flags capex cash absorption stress when capex exceeds 80% of OCF", () => {
    const results = detectAnomalies("TEST", [
      { ...calculation("1", "capex_to_ocf_ratio", 0.88), unit: "RATIO" },
    ]);
    expect(results.length).toBe(1);
    expect(results[0].rule).toBe("capex_absorption_stress");
    expect(results[0].signalName).toBe("CapEx Cash Absorption");
  });

  it("flags earnings-cash disconnect when net income surges while OCF contracts", () => {
    const niTurnaroundCalc: Calculation = {
      ...calculation("1", "netIncome_growth_yoy", 0),
      formula: "sign_flip (turned profitable): dollar change +$100,000,000",
      value: null,
    };
    const ocfContractingCalc: Calculation = {
      ...calculation("2", "operatingCashFlow_growth_yoy", -0.15),
      value: -0.15,
    };

    const results = detectAnomalies("TEST", [niTurnaroundCalc, ocfContractingCalc]);
    expect(results.some((r) => r.rule === "earnings_growth_without_cash")).toBe(true);
    const disconnect = results.find((r) => r.rule === "earnings_growth_without_cash");
    expect(disconnect?.signalName).toBe("Earnings–Cash Disconnect");
    expect(disconnect?.observation.description).toContain("turned profitable");
    expect(disconnect?.observation.description).toContain("contracted by 15.0%");
  });
});

import { describe, expect, it } from "vitest";
import { buildCoreCalculations, computeGrowth } from "../../src/server/domain/calculations.js";
import type { Fact, Period } from "../../src/shared/types/index.js";

const current: Period = { label: "FY2025", endDate: "2025-12-31", kind: "annual" };
const prior: Period = { label: "FY2024", endDate: "2024-12-31", kind: "annual" };
const fact = (id: string, metric: string, value: number, period: Period): Fact => ({
  factId: id, company: "TEST", metric, value, period, unit: "USD", source: "Test filing", sourceUrl: "https://example.com/filing", type: "FACT", availability: "reported",
});

describe("computeGrowth", () => {
  it("handles standard positive growth", () => {
    const res = computeGrowth(120, 100);
    expect(res.value).toBeCloseTo(0.2);
    expect(res.sign_flip).toBe(false);
    expect(res.label).toBe("20.0%");
  });

  it("handles loss to profit (sign flip)", () => {
    const res = computeGrowth(30, -2.7);
    expect(res.value).toBeNull();
    expect(res.sign_flip).toBe(true);
    expect(res.label).toBe("turned profitable");
  });

  it("handles profit to loss (sign flip)", () => {
    const res = computeGrowth(-5, 10);
    expect(res.value).toBeNull();
    expect(res.sign_flip).toBe(true);
    expect(res.label).toBe("swung to loss");
  });

  it("handles loss narrowing", () => {
    const res = computeGrowth(-2, -10);
    expect(res.value).toBeNull();
    expect(res.sign_flip).toBe(true);
    expect(res.label).toBe("loss narrowed");
  });

  it("handles loss widening", () => {
    const res = computeGrowth(-15, -5);
    expect(res.value).toBeNull();
    expect(res.sign_flip).toBe(true);
    expect(res.label).toBe("loss widened");
  });

  it("handles prior equal to zero", () => {
    const res = computeGrowth(50, 0);
    expect(res.value).toBeNull();
    expect(res.sign_flip).toBe(false);
    expect(res.label).toContain("prior is 0");
  });
});

describe("buildCoreCalculations", () => {
  it("calculates year-over-year growth and free cash flow deterministically", () => {
    const facts = [
      fact("1", "revenue", 120, current), fact("2", "revenue", 100, prior),
      fact("3", "netIncome", 24, current), fact("4", "netIncome", 20, prior),
      fact("5", "operatingCashFlow", 30, current), fact("6", "operatingCashFlow", 25, prior),
      fact("7", "receivables", 15, current), fact("8", "receivables", 10, prior),
      fact("9", "capex", 8, current),
    ];
    const results = buildCoreCalculations("TEST", facts, current, prior);
    expect(results.find((item) => item.metric === "revenue_growth_yoy")?.value).toBeCloseTo(0.2);
    expect(results.find((item) => item.metric === "free_cash_flow")?.value).toBe(22);
    expect(results.find((item) => item.metric === "cash_conversion_ratio")?.value).toBeCloseTo(1.25); // 30 / 24
    expect(results.find((item) => item.metric === "capex_to_ocf_ratio")?.value).toBeCloseTo(0.2667); // 8 / 30
  });

  it("handles negative OCF edge case by setting capex_to_ocf_ratio to null", () => {
    const facts = [
      fact("1", "revenue", 100, current), fact("2", "revenue", 100, prior),
      fact("3", "netIncome", -10, current), fact("4", "netIncome", 20, prior),
      fact("5", "operatingCashFlow", -5, current), fact("6", "operatingCashFlow", 25, prior),
      fact("7", "capex", 10, current),
    ];
    const results = buildCoreCalculations("TEST", facts, current, prior);
    expect(results.find((item) => item.metric === "free_cash_flow")?.value).toBe(-15);
    // When OCF <= 0, capex_to_ocf_ratio should be null to avoid nonsensical negative ratios
    expect(results.find((item) => item.metric === "capex_to_ocf_ratio")?.value).toBeNull();
    // When Net Income <= 0, cash_conversion_ratio should be null
    expect(results.find((item) => item.metric === "cash_conversion_ratio")?.value).toBeNull();
  });
});

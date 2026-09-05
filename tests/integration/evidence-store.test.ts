import { describe, expect, it } from "vitest";
import { loadInvestigation } from "../../src/server/application/evidence-store.js";

describe("loadInvestigation", () => {
  it("loads NVIDIA facts and derives traceable calculations", async () => {
    const investigation = await loadInvestigation("NVDA");
    expect(investigation.facts).toHaveLength(10);
    expect(investigation.claimChecks).toHaveLength(3);
    expect(investigation.findings).toHaveLength(1);
    expect(investigation.debate?.judgeVerdict.evidenceQuality).toBe("HIGH");
    expect(investigation.calculations.find((calculation) => calculation.metric === "revenue_growth_yoy")?.value).toBeCloseTo(0.6547, 3);
    expect(investigation.calculations.every((calculation) => calculation.inputFactIds.length > 0)).toBe(true);
  });

  it("loads Apple and fires both deterministic divergence checks", async () => {
    const investigation = await loadInvestigation("AAPL");
    expect(investigation.findings).toHaveLength(2);
    expect(investigation.anomalies.map((anomaly) => anomaly.rule)).toEqual([
      "cash_flow_quality_divergence",
      "receivables_outpacing_revenue",
    ]);
  });
});

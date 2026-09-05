import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateInvestigationReferences } from "../../src/server/domain/reference-validator.js";
import { buildCoreCalculations } from "../../src/server/domain/calculations.js";
import { detectAnomalies } from "../../src/server/domain/findings.js";
import type { Investigation } from "../../src/server/types/index.js";
import type { Period } from "../../src/shared/types/index.js";

describe("Phase 1 — Reference Integrity & Orphan Reference Detection", () => {
  it("Validates that curated NVDA dataset has ZERO orphan references", async () => {
    const raw = await readFile(resolve(process.cwd(), "data", "curated", "nvda.json"), "utf8");
    const parsed = JSON.parse(raw);

    const periods: Period[] = [...new Map(parsed.facts.map((fact: any) => [fact.period.label, fact.period])).values()]
      .sort((left: any, right: any) => right.endDate.localeCompare(left.endDate)) as Period[];

    const calculations = buildCoreCalculations(parsed.company, parsed.facts, periods[0], periods[1]);
    const anomalies = detectAnomalies(parsed.company, calculations);

    const investigation: Investigation = {
      ...parsed,
      calculations,
      anomalies,
      isLiveMode: false,
    };

    const res = validateInvestigationReferences(investigation);
    expect(res.valid).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it("Validates that curated AAPL dataset has ZERO orphan references", async () => {
    const raw = await readFile(resolve(process.cwd(), "data", "curated", "aapl.json"), "utf8");
    const parsed = JSON.parse(raw);

    const periods: Period[] = [...new Map(parsed.facts.map((fact: any) => [fact.period.label, fact.period])).values()]
      .sort((left: any, right: any) => right.endDate.localeCompare(left.endDate)) as Period[];

    const calculations = buildCoreCalculations(parsed.company, parsed.facts, periods[0], periods[1]);
    const anomalies = detectAnomalies(parsed.company, calculations);

    const investigation: Investigation = {
      ...parsed,
      calculations,
      anomalies,
      isLiveMode: false,
    };

    const res = validateInvestigationReferences(investigation);
    expect(res.valid).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it("Detects orphan calculation reference in a finding", () => {
    const dummyInvestigation: Investigation = {
      company: "NVDA",
      displayName: "NVIDIA Corp",
      cik: "0001045810",
      facts: [],
      calculations: [],
      anomalies: [],
      claimChecks: [],
      findings: [
        {
          findingId: "F1",
          company: "NVDA",
          claim: "Test finding",
          evidence: [{ evidenceKind: "calculation", metric: "Revenue growth", value: "+50%", calculationRef: "CALC-GHOST-REF" }],
          observationId: "OBS-01",
          calculationRefs: ["CALC-GHOST-REF"],
          evidenceStrength: "HIGH",
          severity: "HIGH",
          status: "requires_investigation",
          category: "cash_flow_quality",
          contradictoryEvidence: "",
          type: "FINDING",
        },
      ],
      isLiveMode: false,
    };

    const res = validateInvestigationReferences(dummyInvestigation);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.refId === "CALC-GHOST-REF")).toBe(true);
  });

  it("Detects cross-company reference violation between NVDA finding and AAPL calculation", () => {
    const dummyInvestigation: Investigation = {
      company: "NVDA",
      displayName: "NVIDIA Corp",
      cik: "0001045810",
      facts: [],
      anomalies: [],
      claimChecks: [],
      calculations: [
        {
          calcId: "CALC-AAPL-rev-growth",
          company: "AAPL",
          metric: "revenue_growth_yoy",
          period: { label: "FY2025", endDate: "2025-09-27", kind: "annual" },
          formula: "growth",
          inputFactIds: [],
          value: 0.1,
          unit: "PERCENT",
          type: "CALCULATION",
        },
      ],
      findings: [
        {
          findingId: "F1",
          company: "NVDA",
          claim: "Test finding referencing Apple calculation",
          evidence: [{ evidenceKind: "calculation", metric: "Revenue growth", value: "10%", calculationRef: "CALC-AAPL-rev-growth" }],
          observationId: "OBS-01",
          calculationRefs: ["CALC-AAPL-rev-growth"],
          evidenceStrength: "HIGH",
          severity: "HIGH",
          status: "requires_investigation",
          category: "cash_flow_quality",
          contradictoryEvidence: "",
          type: "FINDING",
        },
      ],
      isLiveMode: false,
    };

    const res = validateInvestigationReferences(dummyInvestigation);
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.reason.includes("Cross-company violation"))).toBe(true);
  });
});

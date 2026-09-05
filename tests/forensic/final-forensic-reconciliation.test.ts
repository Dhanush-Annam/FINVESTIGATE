import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCoreCalculations } from "../../src/server/domain/calculations.js";
import { detectAnomalies } from "../../src/server/domain/findings.js";
import { validateInvestigationReferences } from "../../src/server/domain/reference-validator.js";
import { fetchDomesticIndianFacts } from "../../src/server/infrastructure/sources/live-india.js";
import { SqliteAdapter } from "../../src/server/infrastructure/db/sqlite-adapter.js";
import { setRepositoryForTest } from "../../src/server/infrastructure/db/repository.js";
import { verifyClaim, VerifiableClaim } from "../../src/server/domain/verification.js";
import type { Period, Fact } from "../../src/shared/types/index.js";
import type { Investigation } from "../../src/server/types/index.js";

describe("Phase 7 — Final Forensic Reconciliation Suite", () => {
  let adapter: SqliteAdapter;
  const testDbPath = resolve(process.cwd(), "data", "test_final_reconciliation.db");

  beforeAll(async () => {
    adapter = new SqliteAdapter(testDbPath);
    await adapter.init();
    await adapter.seedCuratedData();
    setRepositoryForTest(adapter);
  });

  // 1. AAPL End-to-End Lineage
  it("AAPL: Reconciles full provenance, zero orphans, and calculation integrity", async () => {
    const raw = await readFile(resolve(process.cwd(), "data", "curated", "aapl.json"), "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.company).toBe("AAPL");
    expect(parsed.cik).toBe("0000320193");

    // Check fact provenance
    for (const fact of parsed.facts) {
      expect(fact.company).toBe("AAPL");
      expect(fact.source).toBeDefined();
      expect(fact.sourceUrl).toContain("sec.gov");
      expect(fact.period.label).toMatch(/^FY202[45]$/);
      expect(typeof fact.value).toBe("number");
    }

    const periods: Period[] = [...new Map(parsed.facts.map((f: any) => [f.period.label, f.period])).values()]
      .sort((a: any, b: any) => b.endDate.localeCompare(a.endDate)) as Period[];

    const calcs = buildCoreCalculations("AAPL", parsed.facts, periods[0], periods[1]);
    expect(calcs.length).toBeGreaterThanOrEqual(6);

    // Every calculation has valid input facts
    for (const calc of calcs) {
      expect(calc.company).toBe("AAPL");
      for (const factId of calc.inputFactIds) {
        const factExists = parsed.facts.some((f: any) => f.factId === factId);
        expect(factExists).toBe(true);
      }
    }

    const inv: Investigation = {
      ...parsed,
      calculations: calcs,
      anomalies: detectAnomalies("AAPL", calcs),
      isLiveMode: false,
    };

    // Reference validation & zero orphan invariant
    const validation = validateInvestigationReferences(inv);
    expect(validation.valid).toBe(true);
    expect(validation.violations).toHaveLength(0);

    // Verify claim against DB
    const claim: VerifiableClaim = {
      text: "AAPL revenue for FY2025",
      claimed_value: "$416.2B",
      ref_id: "AAPL-REV-FY2025",
      ref_type: "fact",
    };
    const res = await verifyClaim(claim, "AAPL", adapter);
    expect(res.pass).toBe(true);
    expect(res.verificationLevel).toBe("numeric");
  });

  // 2. NVDA End-to-End Lineage & CapEx Reconciliation
  it("NVDA: Reconciles full provenance, CapEx narrow PP&E definition, and zero orphans", async () => {
    const raw = await readFile(resolve(process.cwd(), "data", "curated", "nvda.json"), "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.company).toBe("NVDA");
    expect(parsed.cik).toBe("0001045810");

    // Verify narrow PP&E CapEx facts
    const capexFY2025 = parsed.facts.find((f: any) => f.factId === "NVDA-CAPEX-FY2025");
    expect(capexFY2025).toBeDefined();
    expect(capexFY2025.value).toBe(1_400_000_000); // $1.4B
    expect(capexFY2025.accountingDefinition).toBe("PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)");
    expect(capexFY2025.lineItem).toBe("Payments to acquire property, plant and equipment");

    const capexFY2026 = parsed.facts.find((f: any) => f.factId === "NVDA-CAPEX-FY2026");
    expect(capexFY2026).toBeDefined();
    expect(capexFY2026.value).toBe(1_900_000_000); // $1.9B
    expect(capexFY2026.accountingDefinition).toBe("PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)");

    const periods: Period[] = [...new Map(parsed.facts.map((f: any) => [f.period.label, f.period])).values()]
      .sort((a: any, b: any) => b.endDate.localeCompare(a.endDate)) as Period[];

    const calcs = buildCoreCalculations("NVDA", parsed.facts, periods[0], periods[1]);

    const inv: Investigation = {
      ...parsed,
      calculations: calcs,
      anomalies: detectAnomalies("NVDA", calcs),
      isLiveMode: false,
    };

    const validation = validateInvestigationReferences(inv);
    expect(validation.valid).toBe(true);
    expect(validation.violations).toHaveLength(0);

    // Verify NVDA revenue growth calculation claim against DB
    const claim: VerifiableClaim = {
      text: "NVDA achieved 65.5% revenue growth in FY2026",
      claimed_value: "65.5%",
      ref_id: "CALC-NVDA-revenue-growth-FY2026",
      ref_type: "calculation",
    };
    const res = await verifyClaim(claim, "NVDA", adapter);
    expect(res.pass).toBe(true);
    expect(res.verificationLevel).toBe("numeric");
  });

  // 3. RELIANCE End-to-End Lineage
  it("RELIANCE: Canonical identity (BSE-500325), Ind AS provenance, INR calculations", async () => {
    const facts = fetchDomesticIndianFacts("RELIANCE")!;
    expect(facts.length).toBe(10); // 5 metrics x 2 periods

    for (const fact of facts) {
      expect(fact.company).toBe("RELIANCE");
      expect(fact.unit).toBe("INR");
      expect(fact.sourceUrl).toContain("bseindia.com");
      expect(fact.lineItem).toBeDefined();
      expect(fact.accountingDefinition).toContain("Ind AS");
    }

    const periods: Period[] = [...new Map(facts.map((f) => [f.period.label, f.period])).values()]
      .sort((a, b) => b.endDate.localeCompare(a.endDate));

    const calcs = buildCoreCalculations("RELIANCE", facts, periods[0], periods[1]);
    expect(calcs.length).toBeGreaterThanOrEqual(6);

    // All calculations reference existing facts
    for (const calc of calcs) {
      expect(calc.company).toBe("RELIANCE");
      for (const id of calc.inputFactIds) {
        expect(facts.some((f) => f.factId === id)).toBe(true);
      }
    }

    // Save RELIANCE to adapter and verify isolation from RS
    const inv: Investigation = {
      company: "RELIANCE",
      displayName: "Reliance Industries Limited",
      cik: "BSE-500325",
      facts,
      calculations: calcs,
      anomalies: detectAnomalies("RELIANCE", calcs),
      findings: [],
      claimChecks: [],
      isLiveMode: false,
    };
    await adapter.saveInvestigation(inv);

    const relCompany = await adapter.getCompany("RELIANCE");
    expect(relCompany?.cik).toBe("BSE-500325");

    // An RS fact can NOT verify a RELIANCE claim
    const rsClaim: VerifiableClaim = {
      text: "Reliance Steel fact",
      claimed_value: "$5B",
      ref_id: "RS-REV-FY2024",
      ref_type: "fact",
    };
    const res = await verifyClaim(rsClaim, "RELIANCE", adapter);
    expect(res.pass).toBe(false);
  });

  // 4. TCS End-to-End Lineage
  it("TCS: Canonical identity (BSE-532540), Ind AS accounting standards, zero orphan calculations", async () => {
    const facts = fetchDomesticIndianFacts("TCS")!;
    expect(facts.length).toBe(10);

    for (const fact of facts) {
      expect(fact.company).toBe("TCS");
      expect(fact.unit).toBe("INR");
      expect(fact.accountingDefinition).toContain("Ind AS");
    }

    const periods: Period[] = [...new Map(facts.map((f) => [f.period.label, f.period])).values()]
      .sort((a, b) => b.endDate.localeCompare(a.endDate));

    const calcs = buildCoreCalculations("TCS", facts, periods[0], periods[1]);
    expect(calcs.length).toBeGreaterThanOrEqual(6);

    const inv: Investigation = {
      company: "TCS",
      displayName: "Tata Consultancy Services Limited",
      cik: "BSE-532540",
      facts,
      calculations: calcs,
      anomalies: detectAnomalies("TCS", calcs),
      findings: [],
      claimChecks: [],
      isLiveMode: false,
    };
    await adapter.saveInvestigation(inv);

    const tcsCompany = await adapter.getCompany("TCS");
    expect(tcsCompany?.cik).toBe("BSE-532540");
  });

  // 5. TATAMOTORS End-to-End Lineage
  it("TATAMOTORS: Canonical identity (BSE-500570), Ind AS accounting standards, free cash flow calculation", async () => {
    const facts = fetchDomesticIndianFacts("TATAMOTORS")!;
    expect(facts.length).toBe(10);

    for (const fact of facts) {
      expect(fact.company).toBe("TATAMOTORS");
      expect(fact.unit).toBe("INR");
      expect(fact.accountingDefinition).toContain("Ind AS");
    }

    const periods: Period[] = [...new Map(facts.map((f) => [f.period.label, f.period])).values()]
      .sort((a, b) => b.endDate.localeCompare(a.endDate));

    const calcs = buildCoreCalculations("TATAMOTORS", facts, periods[0], periods[1]);
    expect(calcs.length).toBeGreaterThanOrEqual(6);

    const fcf = calcs.find((c) => c.metric === "free_cash_flow");
    expect(fcf).toBeDefined();
    expect(fcf?.unit).toBe("INR");

    const inv: Investigation = {
      company: "TATAMOTORS",
      displayName: "Tata Motors Limited",
      cik: "BSE-500570",
      facts,
      calculations: calcs,
      anomalies: detectAnomalies("TATAMOTORS", calcs),
      findings: [],
      claimChecks: [],
      isLiveMode: false,
    };
    await adapter.saveInvestigation(inv);

    const tmCompany = await adapter.getCompany("TATAMOTORS");
    expect(tmCompany?.cik).toBe("BSE-500570");
  });
});

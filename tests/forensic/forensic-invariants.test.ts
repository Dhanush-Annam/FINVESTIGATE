import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SqliteAdapter } from "../../src/server/infrastructure/db/sqlite-adapter.js";
import { setRepositoryForTest } from "../../src/server/infrastructure/db/repository.js";
import { loadInvestigation } from "../../src/server/application/evidence-store.js";
import { verifyClaim } from "../../src/server/domain/verification.js";
import { calculateFundamentalScores } from "../../src/server/domain/fundamental-scorer.js";
import { app } from "../../src/server/api/server.js";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import type { Server } from "node:http";
import type { Fact, Calculation } from "../../src/shared/types/index.js";

describe("Forensic Release Gate — 9 Core Invariants Suite", () => {
  let adapter: SqliteAdapter;
  const testDbPath = resolve(process.cwd(), "data", "test_invariants.db");

  beforeEach(async () => {
    try {
      await unlink(testDbPath);
    } catch (_err) {}

    adapter = new SqliteAdapter(testDbPath);
    await adapter.init();
    setRepositoryForTest(adapter);
  });

  afterEach(async () => {
    setRepositoryForTest(null);
    await adapter.close();
    try {
      await unlink(testDbPath);
    } catch (_err) {}
    vi.restoreAllMocks();
  });

  it("Invariant 1 (Identity): RELIANCE (BSE:500325) and RS (NYSE:RS) are distinct; Company A cannot verify Company B", async () => {
    await adapter.seedCuratedData();

    // 1. Cross-company verification must fail immediately
    const claim = {
      text: "Revenue grew strongly in FY2025",
      claimed_value: "$130.5B",
      ref_id: "AAPL-REV-FY2025",
      ref_type: "fact" as const,
    };
    const crossCompanyResult = await verifyClaim(claim, "NVDA", adapter);
    expect(crossCompanyResult.pass).toBe(false);
    expect(crossCompanyResult.resultCode).toBe("fail_cross_company");
    expect(crossCompanyResult.reason).toContain("belongs to company \"AAPL\"");

    // 2. RELIANCE vs RS CIK identity separation
    const { resolveCik } = await import("../../src/server/infrastructure/sources/live-cik.js");
    const relianceCik = await resolveCik("RELIANCE");
    const rsCik = await resolveCik("RS");

    expect(relianceCik?.cik).toBe("BSE-500325");
    expect(rsCik?.cik).toBe("0000861884");
    expect(relianceCik?.cik).not.toBe(rsCik?.cik);
  });

  it("Invariant 2 (Lineage): Finding -> Evidence (with calculationRef) -> Calculation -> Fact -> Source URL", async () => {
    await adapter.seedCuratedData();
    const nvda = await adapter.getInvestigation("NVDA");
    expect(nvda).not.toBeNull();

    for (const finding of nvda!.findings) {
      for (const ev of finding.evidence) {
        if (ev.calculationRef) {
          // 1. Calculation exists
          const calc = await adapter.getCalculation(ev.calculationRef);
          expect(calc).not.toBeNull();
          expect(calc!.calcId).toBe(ev.calculationRef);

          // 2. Input facts exist
          for (const factId of calc!.inputFactIds) {
            const fact = await adapter.getFact(factId);
            expect(fact).not.toBeNull();

            // 3. Source URL is valid and present
            expect(fact!.source).toBeDefined();
            expect(fact!.source.length).toBeGreaterThan(0);
            expect(fact!.sourceUrl).toMatch(/^https?:\/\//);
          }
        }
      }
    }
  });

  it("Invariant 3 (Production Isolation): Cached investigation statistics use only sourceType = 'production'", async () => {
    await adapter.seedCuratedData();

    // Log 3 successful production filings
    await adapter.logVerification({
      companyTicker: "NVDA",
      claimText: "Prod claim 1",
      refId: "NVDA-REV-FY2026",
      result: "pass",
      detail: "Verified",
      sourceType: "production",
      surface: "finding",
      verificationLevel: "numeric",
    });
    await adapter.logVerification({
      companyTicker: "NVDA",
      claimText: "Prod claim 2",
      refId: "NVDA-REV-FY2025",
      result: "pass",
      detail: "Verified",
      sourceType: "production",
      surface: "finding",
      verificationLevel: "numeric",
    });

    // Log 5 adversarial attack failures
    for (let i = 1; i <= 5; i++) {
      await adapter.logVerification({
        companyTicker: "NVDA",
        claimText: `Attack claim ${i}`,
        refId: `FAKE-REF-${i}`,
        result: "fail_missing_ref",
        detail: "Adversarial attack blocked",
        sourceType: "adversarial",
        surface: "debate",
        verificationLevel: "reference",
      });
    }

    // Cached loadInvestigation must only compute production stats
    const inv = await loadInvestigation("NVDA");
    expect(inv.verificationStats).toBeDefined();
    // Verify adversarial attack logs are strictly isolated and NOT included in production stats
    const allLogs = await adapter.getVerificationLogs("NVDA");
    const prodLogs = allLogs.filter((l) => l.sourceType === "production");
    const advLogs = allLogs.filter((l) => l.sourceType === "adversarial");
    expect(advLogs).toHaveLength(5);
    expect(inv.verificationStats?.totalClaims).toBe(prodLogs.length);
    expect(inv.verificationStats?.totalClaims).not.toBe(allLogs.length);
  });

  it("Invariant 4 (Persistence): AI debate mode and verification surface survive DB round-trip", async () => {
    await adapter.seedCuratedData();
    const nvda = await adapter.getInvestigation("NVDA");
    expect(nvda).not.toBeNull();

    // 1. Debate mode persistence
    nvda!.debate!.mode = "ai_grounded";
    await adapter.saveInvestigation(nvda!);
    const debate = await adapter.getLatestDebate("NVDA");
    expect(debate?.mode).toBe("ai_grounded");

    // 2. Verification surface persistence
    await adapter.logVerification({
      companyTicker: "NVDA",
      claimText: "Surface test",
      refId: "NVDA-REV-FY2026",
      result: "pass",
      detail: "Surface verified",
      sourceType: "production",
      surface: "claim_check",
      verificationLevel: "numeric",
    });

    const logs = await adapter.getVerificationLogs("NVDA", "production");
    const targetLog = logs.find((l) => l.claimText === "Surface test");
    expect(targetLog).toBeDefined();
    expect(targetLog?.surface).toBe("claim_check");
    expect(targetLog?.verificationLevel).toBe("numeric");
  });

  it("Invariant 5 (Idempotency): seedCuratedData called 10 times results in exact same DB state with zero duplicate debates", async () => {
    // Call seed 10 times consecutively
    for (let i = 0; i < 10; i++) {
      await adapter.seedCuratedData();
    }

    // Debates must NOT be duplicated
    const nvdaDebates = await adapter.getDebateHistory("NVDA");
    expect(nvdaDebates).toHaveLength(1);

    const aaplDebates = await adapter.getDebateHistory("AAPL");
    expect(aaplDebates).toHaveLength(1);

    // Investigation runs must be exactly 1 per curated company
    const nvdaRuns = await adapter.getInvestigationRuns("NVDA");
    expect(nvdaRuns).toHaveLength(1);
    expect(nvdaRuns[0].runType).toBe("seed");
    expect(nvdaRuns[0].isCurrent).toBe(true);
  });

  it("Invariant 6 (Immutable Investigation History): Creates Run 1 with value X, creates Run 2 with same logical fact Y, proves Run 1 returns X and Run 2 returns Y with independent chains", async () => {
    // 1. Create Run 1 with financial value X
    const run1Fact: Fact = {
      factId: "NVDA-REV-FY2025",
      company: "NVDA",
      metric: "revenue",
      period: { label: "FY2025", endDate: "2025-01-26", kind: "annual" },
      value: 60922000000, // Value X: $60.922B
      unit: "USD",
      source: "SEC EDGAR 10-K",
      sourceUrl: "https://sec.gov/edgar",
      statement: "Income Statement",
      lineItem: "Revenue",
      accountingDefinition: "US-GAAP Revenue",
      accessionNumber: "0001045810-25-000010",
      filingDate: "2025-02-26",
      sourcePage: "Item 8, Note 1",
      normalizedValue: 60922000000,
      type: "FACT",
      availability: "reported",
    };

    const run1Calc: Calculation = {
      calcId: "CALC-NVDA-REV-GROWTH",
      company: "NVDA",
      metric: "revenue_growth_yoy",
      period: { label: "FY2025", endDate: "2025-01-26", kind: "annual" },
      formula: "revenue / 10",
      inputFactIds: ["NVDA-REV-FY2025"],
      value: 6092200000, // Derived from X
      unit: "USD",
      type: "CALCULATION",
    };

    const run1Finding = {
      findingId: "FINDING-NVDA-GROWTH",
      company: "NVDA",
      claim: "NVIDIA revenue growth was robust in FY2025",
      evidence: [
        {
          evidenceKind: "calculation" as const,
          metric: "Revenue growth",
          value: "$6.1B",
          calculationRef: "CALC-NVDA-REV-GROWTH",
        },
      ],
      observationId: "OBS-01",
      calculationRefs: ["CALC-NVDA-REV-GROWTH"],
      evidenceStrength: "HIGH" as const,
      severity: "LOW" as const,
      status: "positive_signal" as const,
      category: "growth",
      contradictoryEvidence: "None",
      type: "FINDING" as const,
    };

    const run1Investigation = {
      company: "NVDA",
      displayName: "NVIDIA CORPORATION",
      cik: "0001045810",
      facts: [run1Fact],
      calculations: [run1Calc],
      findings: [run1Finding],
      claimChecks: [],
      anomalies: [],
      isLiveMode: false,
    };

    await adapter.saveInvestigation(run1Investigation, { runId: "run-nvda-1" });

    // 2. Create Run 2 with the same logical fact changed to value Y
    const run2Fact: Fact = {
      ...run1Fact,
      value: 99999000000, // Value Y: $99.999B
      normalizedValue: 99999000000,
    };

    const run2Calc: Calculation = {
      ...run1Calc,
      value: 9999900000, // Derived from Y
    };

    const run2Finding = {
      ...run1Finding,
      evidence: [
        {
          evidenceKind: "calculation" as const,
          metric: "Revenue growth",
          value: "$10.0B",
          calculationRef: "CALC-NVDA-REV-GROWTH",
        },
      ],
    };

    const run2Investigation = {
      ...run1Investigation,
      facts: [run2Fact],
      calculations: [run2Calc],
      findings: [run2Finding],
    };

    await adapter.saveInvestigation(run2Investigation, { runId: "run-nvda-2" });

    // 3. Load Run 1 and prove the value is still X
    const loadedRun1 = await adapter.getInvestigation("NVDA", "run-nvda-1");
    expect(loadedRun1).toBeDefined();
    expect(loadedRun1!.facts).toHaveLength(1);
    expect(loadedRun1!.facts[0].value).toBe(60922000000); // Proves value X preserved!
    expect(loadedRun1!.facts[0].statement).toBe("Income Statement");
    expect(loadedRun1!.facts[0].accessionNumber).toBe("0001045810-25-000010");
    expect(loadedRun1!.calculations[0].value).toBe(6092200000);
    expect(loadedRun1!.findings[0].evidence[0].value).toBe("$6.1B");

    const fact1 = await adapter.getFact("NVDA-REV-FY2025", "run-nvda-1");
    expect(fact1).toBeDefined();
    expect(fact1!.value).toBe(60922000000);

    // 4. Load Run 2 and prove the value is Y
    const loadedRun2 = await adapter.getInvestigation("NVDA", "run-nvda-2");
    expect(loadedRun2).toBeDefined();
    expect(loadedRun2!.facts).toHaveLength(1);
    expect(loadedRun2!.facts[0].value).toBe(99999000000); // Proves value Y!
    expect(loadedRun2!.calculations[0].value).toBe(9999900000);
    expect(loadedRun2!.findings[0].evidence[0].value).toBe("$10.0B");

    const fact2 = await adapter.getFact("NVDA-REV-FY2025", "run-nvda-2");
    expect(fact2).toBeDefined();
    expect(fact2!.value).toBe(99999000000);

    // Default getInvestigation returns Run 2 because it is the current active run
    const currentRun = await adapter.getInvestigation("NVDA");
    expect(currentRun!.runId).toBe("run-nvda-2");
    expect(currentRun!.facts[0].value).toBe(99999000000);

    // 5. Prove both calculation/finding chains remain independently resolvable
    expect(loadedRun1!.calculations[0].inputFactIds[0]).toBe(loadedRun1!.facts[0].factId);
    expect(loadedRun1!.findings[0].calculationRefs[0]).toBe(loadedRun1!.calculations[0].calcId);
    expect(loadedRun2!.calculations[0].inputFactIds[0]).toBe(loadedRun2!.facts[0].factId);
    expect(loadedRun2!.findings[0].calculationRefs[0]).toBe(loadedRun2!.calculations[0].calcId);

    // Both runs must be registered in investigation_runs
    const runs = await adapter.getInvestigationRuns("NVDA");
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.runId === "run-nvda-1")?.isCurrent).toBe(false);
    expect(runs.find((r) => r.runId === "run-nvda-2")?.isCurrent).toBe(true);
  });

  it("Invariant 7 (Concurrency): Genuine cache-miss test with 10 simultaneous same-ticker requests collapses into 1 execution, 1 persistence, 0 duplicate runs", async () => {
    // Ensure cache miss for uncached ticker
    const ticker = "TSLA";
    const existingCompany = await adapter.getCompany(ticker);
    expect(existingCompany).toBeNull(); // Confirmed cache miss!

    const liveCikModule = await import("../../src/server/infrastructure/sources/live-cik.js");
    vi.spyOn(liveCikModule, "resolveCik").mockResolvedValue({
      cik: "0001318605",
      displayName: "Tesla, Inc.",
      ticker: "TSLA",
    });

    const orchestratorModule = await import("../../src/server/infrastructure/llm/orchestrator.js");
    vi.spyOn(orchestratorModule, "generateConstrainedAIDebate").mockImplementation(async (inv) => {
      const { generateLiveDebate } = await import("../../src/server/infrastructure/llm/live-debate.js");
      return {
        ...generateLiveDebate(inv.company, inv.displayName, inv.calculations, inv.findings, inv.facts),
        mode: "deterministic_fallback",
      };
    });

    const liveEdgarModule = await import("../../src/server/infrastructure/sources/live-edgar.js");
    let fetchExecutionCount = 0;

    // Spy on fetchLiveCompanyFacts to introduce a brief async delay and count executions
    vi.spyOn(liveEdgarModule, "fetchLiveCompanyFacts").mockImplementation(async () => {
      fetchExecutionCount++;
      await new Promise((r) => setTimeout(r, 60)); // Simulate network latency
      return [
        {
          factId: "TSLA-REV-FY2023",
          company: "TSLA",
          metric: "revenue",
          period: { label: "FY2023", endDate: "2023-12-31", kind: "annual" },
          value: 82000000000,
          unit: "USD",
          source: "SEC EDGAR 10-K",
          sourceUrl: "https://sec.gov/edgar",
          type: "FACT",
          availability: "reported",
        },
        {
          factId: "TSLA-REV-FY2024",
          company: "TSLA",
          metric: "revenue",
          period: { label: "FY2024", endDate: "2024-12-31", kind: "annual" },
          value: 96773000000,
          unit: "USD",
          source: "SEC EDGAR 10-K",
          sourceUrl: "https://sec.gov/edgar",
          type: "FACT",
          availability: "reported",
        },
      ];
    });

    // Launch 10 simultaneous requests for the uncached ticker
    const callers = Array.from({ length: 10 }, () => loadInvestigation("TSLA"));
    const results = await Promise.all(callers);

    // Invariant verifications:
    // 1. All 10 callers receive valid results
    expect(results).toHaveLength(10);
    for (const res of results) {
      expect(res).toBeDefined();
      expect(res.company).toBe("TSLA");
      expect(res.facts).toHaveLength(2);
      expect(res.facts.find((f: any) => f.period.label === "FY2024")?.value).toBe(96773000000);
    }

    // 2. Exactly 1 pipeline execution occurs
    expect(fetchExecutionCount).toBe(1);

    // 3. No duplicate runs created in the database
    const runs = await adapter.getInvestigationRuns("TSLA");
    expect(runs).toHaveLength(1);
    expect(runs[0].isCurrent).toBe(true);
  });

  it("Invariant 8 (Currency): Economically equivalent USD vs INR fundamentals yield comparable normalized scoring", () => {
    const usdCalcs: Calculation[] = [
      {
        calcId: "USD-FCF",
        company: "US_CO",
        metric: "free_cash_flow",
        period: { label: "FY2025", endDate: "2025-12-31", kind: "annual" },
        formula: "operatingCashFlow - capex",
        inputFactIds: ["US-OCF", "US-CAPEX"],
        value: 25000000000, // $25B
        unit: "USD",
        type: "CALCULATION",
      },
      {
        calcId: "USD-REV-GROWTH",
        company: "US_CO",
        metric: "revenue_growth_yoy",
        period: { label: "FY2025", endDate: "2025-12-31", kind: "annual" },
        formula: "(current - prior) / prior",
        inputFactIds: ["US-REV-25", "US-REV-24"],
        value: 0.25,
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "USD-OCF-GROWTH",
        company: "US_CO",
        metric: "operatingCashFlow_growth_yoy",
        period: { label: "FY2025", endDate: "2025-12-31", kind: "annual" },
        formula: "(current - prior) / prior",
        inputFactIds: ["US-OCF-25", "US-OCF-24"],
        value: 0.20,
        unit: "PERCENT",
        type: "CALCULATION",
      },
    ];
    const usdFacts: Fact[] = [
      {
        factId: "US-REV-25",
        company: "US_CO",
        metric: "revenue",
        period: { label: "FY2025", endDate: "2025-12-31", kind: "annual" },
        value: 80000000000, // $80B
        unit: "USD",
        source: "10-K",
        sourceUrl: "https://sec.gov",
        type: "FACT",
        availability: "reported",
      },
    ];

    const inrCalcs: Calculation[] = [
      {
        calcId: "INR-FCF",
        company: "IN_CO",
        metric: "free_cash_flow",
        period: { label: "FY2025", endDate: "2025-03-31", kind: "annual" },
        formula: "operatingCashFlow - capex",
        inputFactIds: ["IN-OCF", "IN-CAPEX"],
        value: 2000000000000, // ₹2 Trillion (~$24B)
        unit: "INR",
        type: "CALCULATION",
      },
      {
        calcId: "INR-REV-GROWTH",
        company: "IN_CO",
        metric: "revenue_growth_yoy",
        period: { label: "FY2025", endDate: "2025-03-31", kind: "annual" },
        formula: "(current - prior) / prior",
        inputFactIds: ["IN-REV-25", "IN-REV-24"],
        value: 0.25,
        unit: "PERCENT",
        type: "CALCULATION",
      },
      {
        calcId: "INR-OCF-GROWTH",
        company: "IN_CO",
        metric: "operatingCashFlow_growth_yoy",
        period: { label: "FY2025", endDate: "2025-03-31", kind: "annual" },
        formula: "(current - prior) / prior",
        inputFactIds: ["IN-OCF-25", "IN-OCF-24"],
        value: 0.20,
        unit: "PERCENT",
        type: "CALCULATION",
      },
    ];
    const inrFacts: Fact[] = [
      {
        factId: "IN-REV-25",
        company: "IN_CO",
        metric: "revenue",
        period: { label: "FY2025", endDate: "2025-03-31", kind: "annual" },
        value: 6500000000000, // ₹6.5 Trillion
        unit: "INR",
        source: "BSE",
        sourceUrl: "https://bseindia.com",
        type: "FACT",
        availability: "reported",
      },
    ];

    const usdScores = calculateFundamentalScores(usdCalcs, [], usdFacts);
    const inrScores = calculateFundamentalScores(inrCalcs, [], inrFacts);

    // Both should receive comparable high-conviction scores without currency penalty
    expect(usdScores.bullScore).toBeGreaterThanOrEqual(7.0);
    expect(inrScores.bullScore).toBeGreaterThanOrEqual(7.0);
    expect(Math.abs(usdScores.bullScore - inrScores.bullScore)).toBeLessThanOrEqual(1.0);
  });

  it("Invariant 9 (Zero State): 0 claims and 0 attacks display 'N/A' rather than inflated 100%", async () => {
    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/verification-stats?ticker=EMPTYCO`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.production.totalClaims).toBe(0);
      expect(body.production.verificationRate).toBe("N/A");
      expect(body.production.interceptionRate).toBe("N/A");
      expect(body.adversarial.totalAttacks).toBe(0);
      expect(body.adversarial.blockRate).toBe("N/A");
    } finally {
      server.close();
    }
  });

  it("Enforces CORS origin restriction and mutation auth security policy", async () => {
    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      // 1. CORS check: Unauthorized origin
      const corsRes = await fetch(`http://localhost:${port}/health`, {
        headers: { Origin: "http://malicious-site.evil.com" },
      });
      if (corsRes.status === 200) {
        expect(corsRes.headers.get("access-control-allow-origin")).toBeNull();
      } else {
        expect(corsRes.status).toBe(403);
      }

      // 2. Mutation Auth: In test mode without API_SECRET_KEY, returns development-unrestricted header
      const attackRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(attackRes.status).toBe(200);
      expect(attackRes.headers.get("x-mutation-auth")).toBe("development-unrestricted");

      // 3. Mutation Auth: When API_SECRET_KEY is configured, enforces authentication
      process.env.API_SECRET_KEY = "test-secret-gate-token-xyz";
      try {
        // Unauthenticated request must fail with 401
        const unauthRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario: "fabricated_id" }),
        });
        expect(unauthRes.status).toBe(401);
        const unauthJson: any = await unauthRes.json();
        expect(unauthJson.error).toContain("Unauthorized");

        // Authenticated request with Bearer token must succeed
        const authRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-secret-gate-token-xyz",
          },
          body: JSON.stringify({ scenario: "fabricated_id" }),
        });
        expect(authRes.status).toBe(200);
        expect(authRes.headers.get("x-mutation-auth")).toBe("authenticated");
      } finally {
        delete process.env.API_SECRET_KEY;
      }
    } finally {
      server.close();
    }
  });
});

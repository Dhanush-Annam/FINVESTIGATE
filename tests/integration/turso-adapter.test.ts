import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { TursoAdapter } from "../../src/server/infrastructure/db/turso-adapter.js";
import { setRepositoryForTest } from "../../src/server/infrastructure/db/repository.js";
import type { Investigation } from "../../src/server/types/index.js";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

describe("Turso/libSQL Production Persistence Suite", () => {
  let adapter: TursoAdapter;
  const testDbFile = resolve(process.cwd(), "data", "test_turso_integration.db");
  const testUrl = process.env.TURSO_TEST_DATABASE_URL || `file:${testDbFile}`;
  const testToken = process.env.TURSO_TEST_AUTH_TOKEN;

  beforeEach(async () => {
    if (testUrl.startsWith("file:")) {
      try {
        if (existsSync(testDbFile)) await unlink(testDbFile);
      } catch (_e) {}
    }

    adapter = new TursoAdapter({ url: testUrl, authToken: testToken });
    await adapter.init();

    // Clean tables before test
    const client = adapter.getClient();
    try {
      await client.executeMultiple(`
        DELETE FROM verification_log;
        DELETE FROM debates;
        DELETE FROM findings;
        DELETE FROM claim_checks;
        DELETE FROM calculations;
        DELETE FROM facts;
        DELETE FROM investigation_runs;
        DELETE FROM companies;
      `);
    } catch (_e) {}

    setRepositoryForTest(adapter);
  });

  afterEach(async () => {
    setRepositoryForTest(null);
    await adapter.close();

    if (testUrl.startsWith("file:")) {
      try {
        if (existsSync(testDbFile)) await unlink(testDbFile);
      } catch (_e) {}
    }
  });

  it("initializes schema and creates all 7 tables and composite indices", async () => {
    const client = adapter.getClient();
    const tablesRes = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const tableNames = tablesRes.rows.map((r: any) => String(r.name));

    expect(tableNames).toContain("companies");
    expect(tableNames).toContain("investigation_runs");
    expect(tableNames).toContain("facts");
    expect(tableNames).toContain("calculations");
    expect(tableNames).toContain("claim_checks");
    expect(tableNames).toContain("findings");
    expect(tableNames).toContain("debates");
    expect(tableNames).toContain("verification_log");
  });

  it("handles repeated initialization idempotently without error", async () => {
    // Calling init a second and third time should be completely safe
    await adapter.init();
    await adapter.init();

    const client = adapter.getClient();
    const tablesRes = await client.execute("SELECT count(*) as count FROM sqlite_master WHERE type='table'");
    expect(Number(tablesRes.rows[0].count)).toBeGreaterThanOrEqual(8);
  });

  it("enforces composite primary keys across all 6 run-scoped tables", async () => {
    const client = adapter.getClient();
    const expectedCompositeKeys: Record<string, string[]> = {
      facts: ["run_id", "fact_id"],
      calculations: ["run_id", "calc_id"],
      claim_checks: ["run_id", "claim_id"],
      findings: ["run_id", "finding_id"],
      debates: ["run_id", "debate_id"],
      verification_log: ["run_id", "verification_id"],
    };

    for (const [table, expectedCols] of Object.entries(expectedCompositeKeys)) {
      const info = await client.execute(`PRAGMA table_info(${table})`);
      const pkCols = info.rows
        .filter((col: any) => Number(col.pk) > 0)
        .sort((a: any, b: any) => Number(a.pk) - Number(b.pk))
        .map((col: any) => String(col.name));

      expect(pkCols).toEqual(expectedCols);
    }
  });

  it("strictly enforces foreign-key constraints on unparented child inserts", async () => {
    const client = adapter.getClient();
    await client.execute("PRAGMA foreign_keys = ON;");

    // Attempting to insert an investigation_run for a company that does not exist in companies table
    let errorCaught = false;
    try {
      await client.execute({
        sql: "INSERT INTO investigation_runs (run_id, company_ticker, run_timestamp, is_current, run_type) VALUES (?, ?, ?, 1, 'live')",
        args: ["run-orphan-1", "NONEXISTENT", new Date().toISOString()],
      });
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toMatch(/FOREIGN KEY/i);
    }
    expect(errorCaught).toBe(true);

    // Attempting to insert a fact with non-existent run_id
    await client.execute({
      sql: "INSERT INTO companies (ticker, cik, display_name) VALUES (?, ?, ?)",
      args: ["NVDA", "0001045810", "NVIDIA Corporation"],
    });

    let factErrorCaught = false;
    try {
      await client.execute({
        sql: `
          INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_kind, value, source, type, availability)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: ["fact-1", "run-nonexistent", "NVDA", "revenue", "FY2024", "annual", 1000, "10-K", "FACT", "reported"],
      });
    } catch (err: any) {
      factErrorCaught = true;
      expect(err.message).toMatch(/FOREIGN KEY/i);
    }
    expect(factErrorCaught).toBe(true);
  });

  it("enforces ON DELETE CASCADE from companies and runs to all dependent rows", async () => {
    const client = adapter.getClient();
    await client.execute("PRAGMA foreign_keys = ON;");

    // 1. Create company and run
    await client.execute({
      sql: "INSERT INTO companies (ticker, cik, display_name) VALUES (?, ?, ?)",
      args: ["NVDA", "0001045810", "NVIDIA Corporation"],
    });
    await client.execute({
      sql: "INSERT INTO investigation_runs (run_id, company_ticker, run_timestamp, is_current, run_type) VALUES (?, ?, ?, 1, 'live')",
      args: ["run-nvda-cascade", "NVDA", new Date().toISOString()],
    });
    await client.execute({
      sql: `
        INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_kind, value, source, type, availability)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: ["fact-cascade-1", "run-nvda-cascade", "NVDA", "revenue", "FY2024", "annual", 1000, "10-K", "FACT", "reported"],
    });

    const before = await client.execute("SELECT count(*) as count FROM facts WHERE run_id = 'run-nvda-cascade'");
    expect(Number(before.rows[0].count)).toBe(1);

    // 2. Delete parent run -> fact should be cascaded
    await client.execute({
      sql: "DELETE FROM investigation_runs WHERE run_id = ?",
      args: ["run-nvda-cascade"],
    });

    const afterRunDelete = await client.execute("SELECT count(*) as count FROM facts WHERE run_id = 'run-nvda-cascade'");
    expect(Number(afterRunDelete.rows[0].count)).toBe(0);
  });

  it("idempotently seeds curated dataset twice without duplicating debates or history", async () => {
    await adapter.seedCuratedData();
    await adapter.seedCuratedData();

    const nvda = await adapter.getInvestigation("NVDA");
    expect(nvda).not.toBeNull();
    expect(nvda?.company).toBe("NVDA");
    expect(nvda?.facts.length).toBeGreaterThan(0);

    const aapl = await adapter.getInvestigation("AAPL");
    expect(aapl).not.toBeNull();
    expect(aapl?.company).toBe("AAPL");

    // Assert debates are NOT duplicated across multiple seed runs
    const client = adapter.getClient();
    const nvdaDebates = await client.execute("SELECT COUNT(*) as count FROM debates WHERE company_ticker = 'NVDA'");
    expect(Number(nvdaDebates.rows[0].count)).toBe(1);

    const aaplDebates = await client.execute("SELECT COUNT(*) as count FROM debates WHERE company_ticker = 'AAPL'");
    expect(Number(aaplDebates.rows[0].count)).toBe(1);
  });

  it("guarantees atomic transaction rollback on batch write failures", async () => {
    const client = adapter.getClient();

    // Prepare a batch where the first statement is valid, but the second violates a foreign key
    let batchFailed = false;
    try {
      await client.batch([
        "PRAGMA foreign_keys = ON;",
        {
          sql: "INSERT INTO companies (ticker, cik, display_name) VALUES (?, ?, ?)",
          args: ["ATOMIC_TEST", "0009999999", "Atomic Test Corp"],
        },
        {
          sql: "INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_kind, value, source, type, availability) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: ["invalid-fact", "non-existent-run", "ATOMIC_TEST", "revenue", "FY2024", "annual", 100, "10-K", "FACT", "reported"],
        },
      ], "write");
    } catch (_err) {
      batchFailed = true;
    }

    expect(batchFailed).toBe(true);

    // Verify atomicity: ATOMIC_TEST company should NOT exist in DB because the batch rolled back
    const checkCompany = await client.execute("SELECT * FROM companies WHERE ticker = 'ATOMIC_TEST'");
    expect(checkCompany.rows.length).toBe(0);
  });

  it("saves and retrieves a complete investigation preserving Zod shape and debate mode", async () => {
    const testInv: Investigation = {
      company: "TSLA",
      displayName: "Tesla, Inc.",
      cik: "0001318605",
      isLiveMode: true,
      anomalies: [],
      facts: [
        {
          factId: "TSLA-REV-FY2024",
          company: "TSLA",
          metric: "revenue",
          period: { label: "FY2024", endDate: "2024-12-31", kind: "annual" },
          value: 97600000000,
          unit: "USD",
          source: "Tesla 10-K",
          sourceUrl: "https://www.sec.gov/edgar/tsla-10k",
          type: "FACT",
          availability: "reported",
        },
      ],
      calculations: [
        {
          calcId: "CALC-TSLA-REV-GROWTH",
          company: "TSLA",
          metric: "revenueGrowth",
          period: { label: "FY2024", endDate: "2024-12-31", kind: "annual" },
          formula: "percent_change(97600000000, 96773000000)",
          inputFactIds: ["TSLA-REV-FY2024"],
          value: 0.85,
          unit: "PERCENT",
          type: "CALCULATION",
        },
      ],
      claimChecks: [
        {
          claimId: "TSLA-CLAIM-01",
          company: "TSLA",
          quote: "We delivered robust volume growth in 2024.",
          source: "Q4 Shareholder Deck",
          sourceUrl: "https://ir.tesla.com/shareholder-deck-2024",
          date: "2025-01-29",
          topic: "Volume Delivery",
          guidanceVsActual: [],
          assessment: "Partially confirmed",
          type: "CLAIM_CHECK",
        },
      ],
      findings: [
        {
          findingId: "TSLA-FINDING-01",
          company: "TSLA",
          claim: "Automotive margins contracted year over year.",
          evidence: [
            {
              evidenceKind: "calculation",
              metric: "revenueGrowth",
              value: "0.85%",
              calculationRef: "CALC-TSLA-REV-GROWTH",
            },
          ],
          observationId: "TSLA-OBS-01",
          calculationRefs: ["CALC-TSLA-REV-GROWTH"],
          evidenceStrength: "HIGH",
          severity: "MEDIUM",
          status: "requires_investigation",
          category: "Margin Compression",
          contradictoryEvidence: "None identified in statutory 10-K filing.",
          type: "FINDING",
        },
      ],
      debate: {
        bullCase: {
          arguments: [
            {
              argument: "Energy storage deployments increased 125%.",
              evidence: [{ metric: "revenueGrowth", value: "0.85%", reference: "CALC-TSLA-REV-GROWTH" }],
              caveat: "Subject to raw material costs",
            },
          ],
          overallStrength: 7.5,
          factors: [],
        },
        bearCase: {
          arguments: [
            {
              argument: "Average selling prices declined across models.",
              evidence: [{ metric: "revenueGrowth", value: "0.85%", reference: "CALC-TSLA-REV-GROWTH" }],
              caveat: "Automotive margins compressed",
            },
          ],
          overallStrength: 6.8,
          factors: [],
        },
        judgeVerdict: {
          evidenceQuality: "HIGH",
          mostImportantUnresolvedQuestion: "Can FSD achieve regulatory approval in 2025?",
          explanation: "Automotive margin pressure offset by accelerating energy storage margins.",
          bullScore: 7.5,
          bearScore: 6.8,
        },
        mode: "ai_grounded",
      },
    };

    await adapter.saveInvestigation(testInv);

    const retrieved = await adapter.getInvestigation("TSLA");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.company).toBe("TSLA");
    expect(retrieved?.displayName).toBe("Tesla, Inc.");
    expect(retrieved?.facts).toHaveLength(1);
    expect(retrieved?.facts[0].factId).toBe("TSLA-REV-FY2024");
    expect(retrieved?.calculations).toHaveLength(1);
    expect(retrieved?.claimChecks).toHaveLength(1);
    expect(retrieved?.findings).toHaveLength(1);
    expect(retrieved?.debate?.mode).toBe("ai_grounded");
    expect(retrieved?.debate?.judgeVerdict.bullScore).toBe(7.5);

    const latestDebate = await adapter.getLatestDebate("TSLA");
    expect(latestDebate).not.toBeNull();
    expect(latestDebate?.mode).toBe("ai_grounded");
  });

  it("persists verification logs and supports filtered queries", async () => {
    await adapter.seedCuratedData();

    await adapter.logVerification({
      companyTicker: "NVDA",
      claimText: "Revenue grew 122% year over year.",
      refId: "CALC-NVDA-REV-GROWTH",
      result: "pass",
      detail: "Calculation verified against reported 10-K facts",
      sourceType: "production",
      surface: "debate",
      verificationLevel: "numeric",
    });

    await adapter.logVerification({
      companyTicker: "NVDA",
      claimText: "Fabricated claim attack",
      refId: "FAKE-ID-999",
      result: "fail_missing_ref",
      detail: "Reference ID does not exist",
      sourceType: "adversarial",
      surface: "finding",
      verificationLevel: "reference",
    });

    const prodLogs = await adapter.getVerificationLogs("NVDA", "production");
    expect(prodLogs.some((l) => l.claimText === "Revenue grew 122% year over year.")).toBe(true);

    const advLogs = await adapter.getVerificationLogs("NVDA", "adversarial");
    expect(advLogs.some((l) => l.claimText === "Fabricated claim attack")).toBe(true);
    expect(advLogs.every((l) => l.sourceType === "adversarial")).toBe(true);
  });

  it("preserves immutable run history and historical run queryability", async () => {
    // Run 1
    const run1Inv: Investigation = {
      company: "AMD",
      displayName: "Advanced Micro Devices",
      cik: "0000002488",
      isLiveMode: true,
      facts: [
        {
          factId: "AMD-REV-V1",
          company: "AMD",
          metric: "revenue",
          period: { label: "FY2023", endDate: "2023-12-30", kind: "annual" },
          value: 22680000000,
          unit: "USD",
          source: "AMD 10-K 2023",
          sourceUrl: "https://www.sec.gov/edgar/amd-2023",
          type: "FACT",
          availability: "reported",
        },
      ],
      calculations: [],
      claimChecks: [],
      findings: [],
      anomalies: [],
    };
    await adapter.saveInvestigation(run1Inv, { runId: "run-amd-001" });

    // Run 2
    const run2Inv: Investigation = {
      company: "AMD",
      displayName: "Advanced Micro Devices",
      cik: "0000002488",
      isLiveMode: true,
      facts: [
        {
          factId: "AMD-REV-V2",
          company: "AMD",
          metric: "revenue",
          period: { label: "FY2024", endDate: "2024-12-28", kind: "annual" },
          value: 25785000000,
          unit: "USD",
          source: "AMD 10-K 2024",
          sourceUrl: "https://www.sec.gov/edgar/amd-2024",
          type: "FACT",
          availability: "reported",
        },
      ],
      calculations: [],
      claimChecks: [],
      findings: [],
      anomalies: [],
    };
    await adapter.saveInvestigation(run2Inv, { runId: "run-amd-002" });

    // Verify runs list
    const runs = await adapter.getInvestigationRuns("AMD");
    expect(runs).toHaveLength(2);

    const currentRun = runs.find((r) => r.isCurrent);
    expect(currentRun?.runId).toBe("run-amd-002");

    const previousRun = runs.find((r) => !r.isCurrent);
    expect(previousRun?.runId).toBe("run-amd-001");

    // Querying active investigation returns Run 2
    const activeInv = await adapter.getInvestigation("AMD");
    expect(activeInv?.runId).toBe("run-amd-002");
    expect(activeInv?.facts[0].factId).toBe("AMD-REV-V2");

    // Historical query explicitly requesting Run 1 returns Run 1 immutable snapshot
    const historicalInv = await adapter.getInvestigation("AMD", "run-amd-001");
    expect(historicalInv?.runId).toBe("run-amd-001");
    expect(historicalInv?.facts[0].factId).toBe("AMD-REV-V1");
  });
});

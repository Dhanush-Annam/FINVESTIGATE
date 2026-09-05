process.env.NODE_ENV = "test";

import { loadInvestigation } from "../src/server/application/evidence-store.js";
import { getRepository } from "../src/server/infrastructure/db/repository.js";
import { resolveCanonicalIdentitySync, areSameCompanySync } from "../src/server/domain/company-identity.js";
import { GAAP_TAG_MAPPINGS } from "../src/server/infrastructure/sources/live-edgar.js";
import type { Fact, Calculation, Finding } from "../src/shared/types/index.js";
import Database from "better-sqlite3";
import { resolve } from "node:path";

async function runReleaseGate() {
  console.log("===============================================================================");
  console.log("             FINVESTIGATE FORENSIC RELEASE GATE CERTIFICATION                  ");
  console.log("===============================================================================\n");

  const dbPath = resolve(process.cwd(), "data", "finvestigate.db");
  const repo = await getRepository();
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  // =========================================================================
  // GATE 1: SQLite Engine Integrity & Foreign Keys
  // =========================================================================
  console.log("--- GATE 1: SQLITE ENGINE INTEGRITY & FOREIGN KEY ENFORCEMENT ---");
  const integrity = db.pragma("integrity_check") as any[];
  console.log("   PRAGMA integrity_check:", JSON.stringify(integrity));
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error("FAIL: SQLite database integrity check failed!");
  }

  const fkCheck = db.pragma("foreign_key_check") as any[];
  console.log("   PRAGMA foreign_key_check violations:", fkCheck.length);
  if (fkCheck.length > 0) {
    throw new Error(`FAIL: Foreign key violations detected: ${JSON.stringify(fkCheck)}`);
  }
  console.log("   >>> PASS: SQLite database engine integrity and foreign keys OK.\n");

  // =========================================================================
  // GATE 2: Run-Scoped Schema & Composite Primary Key Isolation (Audit Point 1)
  // =========================================================================
  console.log("--- GATE 2: RUN-SCOPED SCHEMA & COMPOSITE PRIMARY KEY ISOLATION ---");
  const expectedPk: Record<string, string[]> = {
    facts: ["run_id", "fact_id"],
    calculations: ["run_id", "calc_id"],
    findings: ["run_id", "finding_id"],
    claim_checks: ["run_id", "claim_id"],
    debates: ["run_id", "debate_id"],
    verification_log: ["run_id", "verification_id"],
  };

  for (const [table, expected] of Object.entries(expectedPk)) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const actualPk = cols
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);

    console.log(`   Table ${table.padEnd(18)}: Expected PK (${expected.join(", ")}), Actual PK (${actualPk.join(", ")})`);
    if (JSON.stringify(actualPk) !== JSON.stringify(expected)) {
      throw new Error(`FAIL: ${table} primary key mismatch! Expected (${expected.join(", ")}), got (${actualPk.join(", ")})`);
    }
  }
  console.log("   >>> PASS: All 6 financial evidence tables enforce composite primary key run-scoping.\n");

  // =========================================================================
  // GATE 3: True Immutable Investigation History Live Experiment (Audit Point 2)
  // =========================================================================
  console.log("--- GATE 3: TRUE IMMUTABLE INVESTIGATION HISTORY EXPERIMENT ---");
  const testTicker = "TEST_IMMUTABLE";
  const run1Id = "run-test-hist-1";
  const run2Id = "run-test-hist-2";

  // 1. Create Run 1 with value X ($60.922B)
  const factRun1: Fact = {
    factId: "FACT-HIST-REV",
    company: testTicker,
    metric: "revenue",
    period: { label: "FY2025", endDate: "2025-01-26", kind: "annual" },
    value: 60922000000,
    unit: "USD",
    source: "10-K",
    sourceUrl: "https://sec.gov",
    statement: "Consolidated Statements of Income",
    lineItem: "Revenue",
    accountingDefinition: "US-GAAP Revenue",
    type: "FACT",
    availability: "reported",
  };
  const calcRun1: Calculation = {
    calcId: "CALC-HIST-GROWTH",
    company: testTicker,
    metric: "revenue_growth_yoy",
    period: { label: "FY2025", endDate: "2025-01-26", kind: "annual" },
    formula: "revenue / 10",
    inputFactIds: ["FACT-HIST-REV"],
    value: 6092200000,
    unit: "USD",
    type: "CALCULATION",
  };
  const findingRun1: Finding = {
    findingId: "FIND-HIST-01",
    company: testTicker,
    claim: "Run 1 verified revenue figure is $60.922B",
    evidence: [{ evidenceKind: "calculation", metric: "Revenue", value: "$6.1B", calculationRef: "CALC-HIST-GROWTH" }],
    observationId: "OBS-01",
    calculationRefs: ["CALC-HIST-GROWTH"],
    evidenceStrength: "HIGH",
    severity: "LOW",
    status: "positive_signal",
    category: "growth",
    contradictoryEvidence: "None",
    type: "FINDING",
  };

  await repo.saveInvestigation(
    {
      company: testTicker,
      displayName: "Immutable Test Co",
      cik: "0000999999",
      facts: [factRun1],
      calculations: [calcRun1],
      findings: [findingRun1],
      claimChecks: [],
      anomalies: [],
      isLiveMode: false,
    },
    { runId: run1Id }
  );

  // 2. Create Run 2 with same logical fact changed to value Y ($99.999B)
  const factRun2: Fact = { ...factRun1, value: 99999000000, normalizedValue: 99999000000 };
  const calcRun2: Calculation = { ...calcRun1, value: 9999900000 };
  const findingRun2: Finding = {
    ...findingRun1,
    evidence: [{ evidenceKind: "calculation", metric: "Revenue", value: "$10.0B", calculationRef: "CALC-HIST-GROWTH" }],
  };

  await repo.saveInvestigation(
    {
      company: testTicker,
      displayName: "Immutable Test Co",
      cik: "0000999999",
      facts: [factRun2],
      calculations: [calcRun2],
      findings: [findingRun2],
      claimChecks: [],
      anomalies: [],
      isLiveMode: false,
    },
    { runId: run2Id }
  );

  // 3. Reload Run 1 and verify value X is preserved
  const loadedRun1 = await repo.getInvestigation(testTicker, run1Id);
  if (!loadedRun1 || loadedRun1.facts[0].value !== 60922000000 || loadedRun1.calculations[0].value !== 6092200000) {
    throw new Error(`FAIL: Run 1 financial evidence was overwritten or corrupted!`);
  }

  // 4. Reload Run 2 and verify value Y is active
  const loadedRun2 = await repo.getInvestigation(testTicker, run2Id);
  if (!loadedRun2 || loadedRun2.facts[0].value !== 99999000000 || loadedRun2.calculations[0].value !== 9999900000) {
    throw new Error(`FAIL: Run 2 financial evidence is incorrect!`);
  }

  // 5. Prove independent resolvability (Run 1 chain never touches Run 2 data)
  const v1: unknown = loadedRun1.facts[0].value;
  const v2: unknown = loadedRun2.facts[0].value;
  if (v1 === v2) {
    throw new Error(`FAIL: Run 1 and Run 2 fact values collapsed into identical row!`);
  }
  console.log(`   ✓ Run 1 value X ($60.922B) preserved: ${v1 === 60922000000}`);
  console.log(`   ✓ Run 2 value Y ($99.999B) stored:    ${v2 === 99999000000}`);
  console.log(`   ✓ Independent lineage chains verified across runs.`);

  // Cleanup test ticker from DB
  db.prepare("DELETE FROM companies WHERE ticker = ?").run(testTicker);
  console.log("   >>> PASS: Immutable investigation history verified cleanly.\n");

  // =========================================================================
  // GATE 4: Canonical Identity Isolation & Anti-Contamination (Audit Point 7)
  // =========================================================================
  console.log("--- GATE 4: CANONICAL COMPANY IDENTITY & ANTI-CONTAMINATION ---");
  const canonReliance = resolveCanonicalIdentitySync("RELIANCE");
  const canonRS = resolveCanonicalIdentitySync("RS");
  if (!canonReliance || !canonRS) {
    throw new Error("FAIL: Unable to resolve canonical identities for RELIANCE or RS!");
  }
  console.log(`   RELIANCE canonical ID: ${canonReliance.companyId} (${canonReliance.cik})`);
  console.log(`   RS canonical ID:       ${canonRS.companyId} (${canonRS.cik})`);

  if (canonReliance.companyId === canonRS.companyId || areSameCompanySync("RELIANCE", "RS")) {
    throw new Error("CRITICAL FAIL: RELIANCE (BSE:500325) and RS (CIK:0000861884) collapsed into same identity!");
  }
  console.log("   >>> PASS: Cross-company identity collision strictly prevented.\n");

  // =========================================================================
  // GATE 5: SEC Revenue Fallback Direct Inspection (Audit Point 6)
  // =========================================================================
  console.log("--- GATE 5: SEC EDGAR REVENUE FALLBACK SAFETY AUDIT ---");
  if (GAAP_TAG_MAPPINGS.revenue.includes("InterestAndDividendIncomeOperating" as any)) {
    throw new Error("CRITICAL FAIL: InterestAndDividendIncomeOperating found in generic revenue mapping!");
  }
  console.log("   ✓ Verified GAAP_TAG_MAPPINGS.revenue excludes non-operating interest and dividend income.");

  // Test taxonomy tag matching simulation when only interest/dividend income is present
  const mockTaxonomy: Record<string, any> = {
    InterestAndDividendIncomeOperating: {
      label: "Interest and Dividend Income",
      units: { USD: [{ end: "2024-12-31", val: 5000000000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01", accn: "0001-24-0001" }] },
    },
  };
  let matchedRevenueTag: string | null = null;
  for (const tag of GAAP_TAG_MAPPINGS.revenue) {
    if (mockTaxonomy[tag]) {
      matchedRevenueTag = tag;
      break;
    }
  }
  if (matchedRevenueTag !== null) {
    throw new Error(`CRITICAL FAIL: Banking interest income was matched as revenue via tag "${matchedRevenueTag}"!`);
  }
  console.log("   ✓ Verified SEC revenue tags reject non-operating interest and dividend income.");
  console.log("   >>> PASS: Invalid SEC revenue fallbacks are completely eliminated.\n");

  // =========================================================================
  // GATE 6: Complete Orphan Reference Audit Across All Runs (Audit Point 3)
  // =========================================================================
  console.log("--- GATE 6: ORPHAN REFERENCE AUDIT ACROSS ALL RUNS ---");
  // Seed curated and load benchmarks to ensure full active coverage
  const benchmarkTickers = ["AAPL", "NVDA", "RELIANCE", "TCS", "TATAMOTORS"];
  for (const t of benchmarkTickers) {
    await loadInvestigation(t);
  }

  const allRuns = db.prepare("SELECT run_id, company_ticker, is_current, run_timestamp FROM investigation_runs").all() as any[];
  const runIdSet = new Set(allRuns.map((r) => r.run_id));
  let totalFactsAudited = 0;
  let totalCalcsAudited = 0;
  let totalFindingsAudited = 0;
  let totalClaimsAudited = 0;
  let totalDebatesAudited = 0;

  for (const r of allRuns) {
    const runId = r.run_id;
    const ticker = r.company_ticker;

    // 1. Facts in run
    const facts = db.prepare("SELECT fact_id, metric, value, company_ticker FROM facts WHERE run_id = ?").all(runId) as any[];
    const factIdSet = new Set(facts.map((f) => f.fact_id));
    totalFactsAudited += facts.length;

    // 2. Calculations in run
    const calcs = db.prepare("SELECT calc_id, company_ticker, metric, value, input_fact_ids FROM calculations WHERE run_id = ?").all(runId) as any[];
    const calcIdSet = new Set(calcs.map((c) => c.calc_id));
    totalCalcsAudited += calcs.length;

    for (const c of calcs) {
      if (!areSameCompanySync(c.company_ticker, ticker)) {
        throw new Error(`FAIL: Calculation ${c.calc_id} company ${c.company_ticker} != run company ${ticker}`);
      }
      const inputs: string[] = JSON.parse(c.input_fact_ids || "[]");
      for (const fid of inputs) {
        if (!factIdSet.has(fid)) {
          throw new Error(`FAIL: Orphan fact reference! Run ${runId} Calc ${c.calc_id} references missing fact ${fid}`);
        }
      }
    }

    // 3. Findings in run
    const findings = db.prepare("SELECT finding_id, company_ticker, evidence FROM findings WHERE run_id = ?").all(runId) as any[];
    totalFindingsAudited += findings.length;

    for (const f of findings) {
      if (!areSameCompanySync(f.company_ticker, ticker)) {
        throw new Error(`FAIL: Finding ${f.finding_id} company ${f.company_ticker} != run company ${ticker}`);
      }
      const evidenceList: any[] = JSON.parse(f.evidence || "[]");
      for (const ev of evidenceList) {
        if (ev.evidenceKind === "calculation" || ev.calculationRef) {
          if (!calcIdSet.has(ev.calculationRef)) {
            throw new Error(`FAIL: Orphan calculation reference! Run ${runId} Finding ${f.finding_id} references missing calc ${ev.calculationRef}`);
          }
          // Audit Point 3: Validate company ownership across calc, finding, and investigation
          const referencedCalc = calcs.find((c) => c.calc_id === ev.calculationRef);
          if (referencedCalc && !areSameCompanySync(referencedCalc.company_ticker, f.company_ticker)) {
            throw new Error(`FAIL: Cross-company evidence leak! Finding company ${f.company_ticker} != Calc company ${referencedCalc.company_ticker}`);
          }
        }
      }
    }

    // 4. Claim Checks in run
    const claims = db.prepare("SELECT claim_id, company_ticker, guidance_vs_actual FROM claim_checks WHERE run_id = ?").all(runId) as any[];
    totalClaimsAudited += claims.length;
    for (const cl of claims) {
      if (!areSameCompanySync(cl.company_ticker, ticker)) {
        throw new Error(`FAIL: Claim check ${cl.claim_id} company ${cl.company_ticker} != run company ${ticker}`);
      }
    }

    // 5. Debates in run
    const debates = db.prepare("SELECT debate_id, company_ticker, bull_case, bear_case FROM debates WHERE run_id = ?").all(runId) as any[];
    totalDebatesAudited += debates.length;
    for (const d of debates) {
      if (!areSameCompanySync(d.company_ticker, ticker)) {
        throw new Error(`FAIL: Debate ${d.debate_id} company ${d.company_ticker} != run company ${ticker}`);
      }
    }
  }

  // 6. Verification logs foreign key reference to investigation_runs
  const orphanedLogs = db.prepare("SELECT COUNT(*) as c FROM verification_log WHERE run_id NOT IN (SELECT run_id FROM investigation_runs)").get() as any;
  if (orphanedLogs.c > 0) {
    throw new Error(`FAIL: ${orphanedLogs.c} orphaned verification log entries detected!`);
  }

  console.log(`   Audited ${allRuns.length} runs: ${totalFactsAudited} facts, ${totalCalcsAudited} calculations, ${totalFindingsAudited} findings, ${totalClaimsAudited} claims, ${totalDebatesAudited} debates.`);
  console.log("   >>> PASS: Zero orphan references across all runs. Company ownership validated on all evidence chains.\n");

  // =========================================================================
  // GATE 7: Benchmark Contractual Reconciliation (Audit Points 4 & 5)
  // =========================================================================
  console.log("--- GATE 7: BENCHMARK CONTRACTUAL RECONCILIATION MANIFEST ---");
  const contractualManifest: Record<string, { facts: number; calcs: number; findings: number; minDebates: number }> = {
    AAPL: { facts: 10, calcs: 7, findings: 2, minDebates: 1 },
    NVDA: { facts: 10, calcs: 7, findings: 1, minDebates: 1 },
    RELIANCE: { facts: 10, calcs: 7, findings: 1, minDebates: 1 },
    TCS: { facts: 10, calcs: 7, findings: 0, minDebates: 1 },
    TATAMOTORS: { facts: 10, calcs: 7, findings: 0, minDebates: 1 },
  };

  console.log("-------------------------------------------------------------------------------------------------------------");
  console.log("| Ticker     | Canonical ID   | CIK/BSE Identifier | Facts (Act/Exp) | Calcs (Act/Exp) | Findings (Act/Exp) | Status |");
  console.log("-------------------------------------------------------------------------------------------------------------");

  for (const [ticker, contract] of Object.entries(contractualManifest)) {
    const comp = db.prepare("SELECT * FROM companies WHERE ticker = ?").get(ticker) as any;
    if (!comp) {
      throw new Error(`CRITICAL FAIL: Required benchmark ${ticker} is missing from database!`);
    }

    const currentRun = db.prepare("SELECT * FROM investigation_runs WHERE company_ticker = ? AND is_current = 1").get(ticker) as any;
    if (!currentRun) {
      throw new Error(`CRITICAL FAIL: Required benchmark ${ticker} has no current active run!`);
    }

    const factCount = (db.prepare("SELECT COUNT(*) as c FROM facts WHERE run_id = ?").get(currentRun.run_id) as any).c;
    const calcCount = (db.prepare("SELECT COUNT(*) as c FROM calculations WHERE run_id = ?").get(currentRun.run_id) as any).c;
    const findCount = (db.prepare("SELECT COUNT(*) as c FROM findings WHERE run_id = ?").get(currentRun.run_id) as any).c;
    const debateCount = (db.prepare("SELECT COUNT(*) as c FROM debates WHERE run_id = ?").get(currentRun.run_id) as any).c;

    if (factCount !== contract.facts) {
      throw new Error(`FAIL: ${ticker} facts count mismatch! Expected ${contract.facts}, got ${factCount}`);
    }
    if (calcCount !== contract.calcs) {
      throw new Error(`FAIL: ${ticker} calculations count mismatch! Expected ${contract.calcs}, got ${calcCount}`);
    }
    if (findCount !== contract.findings) {
      throw new Error(`FAIL: ${ticker} findings count mismatch! Expected ${contract.findings}, got ${findCount}`);
    }
    if (debateCount < contract.minDebates) {
      throw new Error(`FAIL: ${ticker} missing debate! Expected >= ${contract.minDebates}, got ${debateCount}`);
    }

    const canon = resolveCanonicalIdentitySync(ticker);
    const canonId = canon ? canon.companyId : (comp.cik || ticker);
    console.log(
      `| ${ticker.padEnd(10)} | ${canonId.padEnd(14)} | ${(comp.cik || "N/A").padEnd(18)} | ` +
      `${String(factCount).padStart(2)} / ${String(contract.facts).padEnd(2)}         | ` +
      `${String(calcCount).padStart(2)} / ${String(contract.calcs).padEnd(2)}         | ` +
      `${String(findCount).padStart(2)} / ${String(contract.findings).padEnd(2)}           | PASS   |`
    );
  }
  console.log("-------------------------------------------------------------------------------------------------------------\n");
  console.log("   >>> PASS: All 5 benchmark companies match contractual manifests exactly.\n");

  // =========================================================================
  // GATE 8: Live Concurrency Mutex Experiment (Audit Point 8)
  // =========================================================================
  console.log("--- GATE 8: LIVE CACHE-MISS CONCURRENCY MUTEX TEST ---");
  const concTicker = "MSFT";

  // Purge any existing database records to ensure a genuine cache miss
  db.prepare("DELETE FROM companies WHERE ticker = ?").run(concTicker);
  db.prepare("DELETE FROM investigation_runs WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM facts WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM calculations WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM findings WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM claim_checks WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM debates WHERE company_ticker = ?").run(concTicker);
  db.prepare("DELETE FROM verification_log WHERE company_ticker = ?").run(concTicker);

  // Instrument pipeline executions and persistence operations on the active repository
  let pipelineExecutions = 0;
  const originalGetCompany = repo.getCompany.bind(repo);
  repo.getCompany = async (ticker: string) => {
    const res = await originalGetCompany(ticker);
    // Initial cache-miss check when company does not yet exist in DB triggers pipeline execution
    if (ticker.toUpperCase() === concTicker && res === null) {
      pipelineExecutions++;
    }
    return res;
  };

  const distinctRunsPersisted = new Set<string>();
  let saveInvestigationInvocations = 0;
  const originalSaveInvestigation = repo.saveInvestigation.bind(repo);
  repo.saveInvestigation = async (inv: any, opts?: any) => {
    if (inv.company.toUpperCase() === concTicker) {
      saveInvestigationInvocations++;
      distinctRunsPersisted.add(inv.runId || opts?.runId);
    }
    return originalSaveInvestigation(inv, opts);
  };

  try {
    console.log(`   Dispatching 10 simultaneous loadInvestigation("${concTicker}") callers on cache miss...`);
    const t0 = Date.now();
    const callers = Array.from({ length: 10 }, () => loadInvestigation(concTicker));
    const results = await Promise.all(callers);
    const durationMs = Date.now() - t0;

    // 1. Validate all 10 callers succeeded with valid investigations
    if (results.length !== 10) {
      throw new Error(`FAIL: Expected 10 caller results, got ${results.length}`);
    }

    const firstRunId = results[0].runId;
    if (!firstRunId) {
      throw new Error("FAIL: Investigation result is missing runId!");
    }

    // Verify every caller received the exact same investigation and runId
    for (let i = 0; i < results.length; i++) {
      if (results[i].company !== concTicker) {
        throw new Error(`FAIL: Caller ${i} got unexpected company: ${results[i].company}`);
      }
      if (results[i].runId !== firstRunId) {
        throw new Error(`FAIL: Caller ${i} received differing runId (${results[i].runId} vs ${firstRunId})`);
      }
      if (!results[i].facts || results[i].facts.length === 0) {
        throw new Error(`FAIL: Caller ${i} received empty facts!`);
      }
    }

    // 2. Prove one production pipeline execution
    if (pipelineExecutions !== 1) {
      throw new Error(`FAIL: Expected exactly 1 production pipeline execution, got ${pipelineExecutions}`);
    }

    // 3. Prove one persistence operation (one distinct run persisted in the single pipeline execution lifecycle)
    if (distinctRunsPersisted.size !== 1) {
      throw new Error(`FAIL: Expected 1 distinct run persisted, got ${distinctRunsPersisted.size}`);
    }
    if (saveInvestigationInvocations > 2) {
      throw new Error(`FAIL: Un-coalesced persistence detected! Expected <= 2 staged saves, got ${saveInvestigationInvocations}`);
    }

    // 4. Prove one resulting run in the database
    const runsInDb = db.prepare("SELECT * FROM investigation_runs WHERE company_ticker = ?").all(concTicker) as any[];
    if (runsInDb.length !== 1) {
      throw new Error(`FAIL: Expected exactly 1 run in investigation_runs, got ${runsInDb.length}`);
    }
    if (runsInDb[0].run_id !== firstRunId) {
      throw new Error(`FAIL: DB run_id mismatch! Expected ${firstRunId}, got ${runsInDb[0].run_id}`);
    }

    const factsCount = (db.prepare("SELECT COUNT(*) as count FROM facts WHERE company_ticker = ? AND run_id = ?").get(concTicker, firstRunId) as any).count;
    if (factsCount === 0) {
      throw new Error(`FAIL: No facts recorded in DB for run ${firstRunId}`);
    }

    console.log(`   ✓ 10 simultaneous cache-miss callers resolved in ${durationMs}ms.`);
    console.log(`   ✓ Production pipeline executions:  ${pipelineExecutions} (coalesced via loadInvestigation mutex)`);
    console.log(`   ✓ Persistence operations:          1 run lifecycle (staged saves: ${saveInvestigationInvocations}, distinct runs: 1)`);
    console.log(`   ✓ Resulting runs in SQLite:        ${runsInDb.length} (${runsInDb[0].run_id})`);
    console.log(`   ✓ All 10 callers received identical investigation data.`);
    console.log("   >>> PASS: In-process concurrency mutex verified on production loadInvestigation() pipeline.\n");
  } finally {
    // Restore original repository methods and clean up test data
    repo.getCompany = originalGetCompany;
    repo.saveInvestigation = originalSaveInvestigation;
    db.prepare("DELETE FROM companies WHERE ticker = ?").run(concTicker);
  }

  // =========================================================================
  // GATE 9: API Security & Origin Policy Verification (Audit Point 9)
  // =========================================================================
  console.log("--- GATE 9: API SECURITY & ACCESS CONTROL POLICIES ---");
  const { app } = await import("../src/server/api/server.js");
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as any).port;

  try {
    // 1. CORS Origin Restriction
    const corsRes = await fetch(`http://localhost:${port}/health`, {
      headers: { Origin: "http://malicious-site.evil.com" },
    });
    if (corsRes.status === 200 && corsRes.headers.get("access-control-allow-origin")) {
      throw new Error("FAIL: CORS permitted unauthorized origin!");
    }
    console.log("   ✓ CORS origin restriction verified (unauthorized origin rejected or unallowed).");

    // 2. Mutation Auth Policy
    process.env.API_SECRET_KEY = "test-release-gate-secret";
    try {
      const unauthRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      if (unauthRes.status !== 401) {
        throw new Error(`FAIL: Mutation endpoint allowed unauthenticated request! Status: ${unauthRes.status}`);
      }
      console.log("   ✓ Mutation endpoint rejected unauthenticated request with HTTP 401.");

      const authRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-release-gate-secret",
        },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      if (authRes.status !== 200) {
        throw new Error(`FAIL: Authenticated mutation request failed! Status: ${authRes.status}`);
      }
      console.log("   ✓ Mutation endpoint accepted authenticated Bearer token with HTTP 200.");

      // 3. Runtime Zod Validation
      const badBodyRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-release-gate-secret",
        },
        body: JSON.stringify({ scenario: "ILLEGAL_INJECTION_SCENARIO" }),
      });
      if (badBodyRes.status !== 400) {
        throw new Error(`FAIL: Invalid AttackBodySchema accepted! Status: ${badBodyRes.status}`);
      }
      console.log("   ✓ Attack endpoint rejected invalid scenario schema with HTTP 400.");
    } finally {
      delete process.env.API_SECRET_KEY;
    }
    console.log("   >>> PASS: API security policies and runtime schema guards verified.\n");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  db.close();

  // =========================================================================
  // GATE 10: Release Certification Summary (Audit Point 10)
  // =========================================================================
  console.log("===============================================================================");
  console.log("          DATABASE STRUCTURAL, LINEAGE & INVARIANT GATE VERIFIED CLEAN         ");
  console.log("===============================================================================");
  console.log("\nRelease Gate Certification Checklist:");
  console.log("  [X] 1. SQLite Engine Integrity & Foreign Keys     : PASSED");
  console.log("  [X] 2. Run-Scoped Composite Primary Keys          : PASSED (all 6 tables)");
  console.log("  [X] 3. Immutable History (Run 1 preserved)        : PASSED (live verified)");
  console.log("  [X] 4. Canonical Identity (RELIANCE != RS)        : PASSED (isolated)");
  console.log("  [X] 5. SEC Revenue Fallback Exclusion             : PASSED (audited)");
  console.log("  [X] 6. Complete Orphan Reference Audit Across Runs: PASSED (0 orphans)");
  console.log("  [X] 7. Benchmark Contractual Reconciliation       : PASSED (5/5 exact)");
  console.log("  [X] 8. Concurrency Mutex Protection               : PASSED (10:1 collapsed)");
  console.log("  [X] 9. API Security & Mutation Auth Policies      : PASSED (guarded)");
  console.log("===============================================================================\n");
}

runReleaseGate().catch((err) => {
  console.error("Release Gate Failed:", err);
  process.exit(1);
});

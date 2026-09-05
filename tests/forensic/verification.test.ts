import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SqliteAdapter } from "../../src/server/infrastructure/db/sqlite-adapter.js";
import { setRepositoryForTest } from "../../src/server/infrastructure/db/repository.js";
import { verifyClaim, verifyAndFilterDebate, VerifiableClaim, isVerificationPass } from "../../src/server/domain/verification.js";
import type { Debate } from "../../src/shared/types/index.js";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";

describe("Phase 3 — LLM Automated Citation Verification Gate", () => {
  let adapter: SqliteAdapter;
  const testDbPath = resolve(process.cwd(), "data", "test_verification.db");

  beforeEach(async () => {
    try {
      await unlink(testDbPath);
    } catch (_err) {}

    adapter = new SqliteAdapter(testDbPath);
    await adapter.init();
    await adapter.seedCuratedData();
    setRepositoryForTest(adapter);
  });

  afterEach(async () => {
    setRepositoryForTest(null);
    await adapter.close();
    try {
      await unlink(testDbPath);
    } catch (_err) {}
  });

  it("PASSES valid calculation claim within tolerance", async () => {
    // NVDA revenue_growth_yoy is ~0.6547 (65.5%)
    const claim: VerifiableClaim = {
      text: "NVIDIA achieved 65.5% revenue growth",
      claimed_value: "65.5%",
      ref_id: "CALC-NVDA-revenue-growth-FY2026",
      ref_type: "calculation",
    };

    const res = await verifyClaim(claim, "NVDA", adapter);
    expect(res.pass).toBe(true);
    expect(res.resultCode).toBe("pass");

    const logs = await adapter.getVerificationLogs("NVDA");
    expect(logs.some((l) => l.result === "pass")).toBe(true);
  });

  it("REJECTS claim with non-existent ref_id (fail_missing_ref)", async () => {
    const claim: VerifiableClaim = {
      text: "Fabricated claim",
      claimed_value: "50%",
      ref_id: "CALC-NON-EXISTENT-999",
      ref_type: "calculation",
    };

    const res = await verifyClaim(claim, "NVDA", adapter);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_missing_ref");
  });

  it("REJECTS claim referencing a different company's calculation (fail_cross_company)", async () => {
    // AAPL calculation used in NVDA claim
    const claim: VerifiableClaim = {
      text: "NVIDIA revenue growth mismatch",
      claimed_value: "10%",
      ref_id: "CALC-AAPL-revenue-growth-FY2025",
      ref_type: "calculation",
    };

    const res = await verifyClaim(claim, "NVDA", adapter);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_cross_company");
  });

  it("REJECTS claim with numeric mismatch outside tolerance (fail_mismatch)", async () => {
    // NVDA revenue growth is ~65.5%, claim states 120%
    const claim: VerifiableClaim = {
      text: "NVIDIA revenue growth surged 120%",
      claimed_value: "120%",
      ref_id: "CALC-NVDA-revenue-growth-FY2026",
      ref_type: "calculation",
    };

    const res = await verifyClaim(claim, "NVDA", adapter);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_mismatch");
  });

  it("handles null calculation sign-flip label verification (Fix B intersection)", async () => {
    // Add dummy sign-flip calculation
    (adapter as any).db.prepare(`
      INSERT INTO calculations (calc_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, formula, input_fact_ids, value, sign_flip_label, unit, type)
      VALUES ('CALC-NVDA-SIGNFLIP', 'run-nvda-seed', 'NVDA', 'netIncome_growth_yoy', 'FY2026', '2026-01-25', 'annual', 'sign_flip (turned profitable)', '[]', NULL, 'turned profitable', 'PERCENT', 'CALCULATION')
    `).run();

    // 1. Claim matching label PASSES
    const passClaim: VerifiableClaim = {
      text: "NVIDIA net income turned profitable in FY2026",
      claimed_value: "N/A",
      ref_id: "CALC-NVDA-SIGNFLIP",
      ref_type: "calculation",
    };
    const passRes = await verifyClaim(passClaim, "NVDA", adapter);
    expect(passRes.pass).toBe(true);

    // 2. Claim stating a fabricated percentage for null value FAILS
    const failClaim: VerifiableClaim = {
      text: "NVIDIA net income grew by 450%",
      claimed_value: "450%",
      ref_id: "CALC-NVDA-SIGNFLIP",
      ref_type: "calculation",
    };
    const failRes = await verifyClaim(failClaim, "NVDA", adapter);
    expect(failRes.pass).toBe(false);
    expect(failRes.resultCode).toBe("fail_sign_flip");
  });

  it("REJECTS claim with cross-company calculation_ref (NVDA claim citing AAPL calculation)", async () => {
    // NVDA claim attempting to use Apple's calculation ref
    const crossCompanyClaim: VerifiableClaim = {
      text: "NVIDIA revenue growth was 10%",
      claimed_value: "10%",
      ref_id: "CALC-AAPL-revenue-growth-FY2025",
      ref_type: "calculation",
    };

    const result = await verifyClaim(crossCompanyClaim, "NVDA", adapter);
    expect(result.pass).toBe(false);
    expect(result.resultCode).toBe("fail_cross_company");
    expect(result.reason).toContain("CALC-AAPL-revenue-growth-FY2025");
    expect(result.reason).toContain("AAPL");

    // Rejection must be logged in verification_log
    const logs = await adapter.getVerificationLogs("NVDA");
    const logged = logs.find((l) => l.refId === "CALC-AAPL-revenue-growth-FY2025");
    expect(logged).toBeDefined();
    expect(logged?.result).toBe("fail_cross_company");
  });

  it("REJECTS debate containing fabricated hallucinated metrics and retains only verified arguments", async () => {
    const { verifyAndFilterDebate } = await import("../../src/server/domain/verification.js");
    const debate = {
      bullCase: {
        arguments: [
          {
            argument: "NVIDIA achieved solid revenue growth",
            evidence: [
              {
                metric: "Revenue growth",
                value: "65.5%",
                reference: "CALC-NVDA-revenue-growth-FY2026",
              },
            ],
            caveat: "Subject to cyclical demand",
          },
          {
            argument: "NVIDIA achieved miraculous profit margins of 99%",
            evidence: [
              {
                metric: "Net margin",
                value: "99.0%",
                reference: "CALC-NVDA-gross-margin-FY2026",
              },
            ],
            caveat: "Grossly fabricated figure",
          },
        ],
        overallStrength: 8,
      },
      bearCase: {
        arguments: [],
        overallStrength: 3,
      },
      judgeVerdict: {
        evidenceQuality: "HIGH" as const,
        mostImportantUnresolvedQuestion: "Can margins sustain?",
        explanation: "Mixed signals",
      },
    };

    const filtered = await verifyAndFilterDebate(debate, "NVDA", adapter);
    expect(filtered.totalClaims).toBe(2);
    expect(filtered.verifiedClaims).toBe(1);
    expect(filtered.rejectedClaims).toBe(1);
    expect(filtered.debate.bullCase.arguments).toHaveLength(1);
    expect(filtered.debate.bullCase.arguments[0].argument).toBe("NVIDIA achieved solid revenue growth");

    const logs = await adapter.getVerificationLogs("NVDA");
    expect(logs.some((l) => l.result === "fail_mismatch")).toBe(true);
  });

  it("REJECTS finding with non-existent calculation_ref and returns rejection stats", async () => {
    const { verifyAndFilterFindings } = await import("../../src/server/domain/verification.js");
    const findings = [
      {
        findingId: "FINDING-VALID-01",
        company: "NVDA",
        claim: "Valid finding",
        evidence: [{ evidenceKind: "calculation" as const, metric: "Revenue growth", value: "65.5%", calculationRef: "CALC-NVDA-revenue-growth-FY2026" }],
        observationId: "OBS-01",
        calculationRefs: ["CALC-NVDA-revenue-growth-FY2026"],
        evidenceStrength: "HIGH" as const,
        severity: "LOW" as const,
        status: "positive_signal" as const,
        category: "growth",
        contradictoryEvidence: "None",
        type: "FINDING" as const,
      },
      {
        findingId: "FINDING-INVALID-02",
        company: "NVDA",
        claim: "Invalid finding referencing missing calculation",
        evidence: [{ evidenceKind: "calculation" as const, metric: "Fake metric", value: "100%", calculationRef: "CALC-FAKE-REF-999" }],
        observationId: "OBS-02",
        calculationRefs: ["CALC-FAKE-REF-999"],
        evidenceStrength: "HIGH" as const,
        severity: "HIGH" as const,
        status: "requires_investigation" as const,
        category: "working_capital",
        contradictoryEvidence: "None",
        type: "FINDING" as const,
      },
    ];

    const res = await verifyAndFilterFindings(findings, "NVDA", adapter);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].findingId).toBe("FINDING-VALID-01");
    expect(res.totalClaims).toBe(2);
    expect(res.verifiedClaims).toBe(1);
    expect(res.rejectedClaims).toBe(1);
    expect(res.rejectedItems).toHaveLength(1);
    expect(res.rejectedItems[0].surface).toBe("finding");
    expect(res.rejectedItems[0].reason).toContain('CALC-FAKE-REF-999');
  });

  it("REJECTS multi-evidence finding when calculationRef is missing or mismatched to calculation", async () => {
    const { verifyAndFilterFindings } = await import("../../src/server/domain/verification.js");
    // Finding with missing calculationRef on evidence item supporting calculation
    const findingsWithMissingRef = [
      {
        findingId: "FINDING-NO-CALCREF",
        company: "NVDA",
        claim: "Revenue increased",
        evidence: [{ evidenceKind: "contextual" as const, metric: "Revenue growth", value: "65.5%" }], // Missing calculationRef!
        observationId: "OBS-01",
        calculationRefs: ["CALC-NVDA-revenue-growth-FY2026"],
        evidenceStrength: "HIGH" as const,
        severity: "LOW" as const,
        status: "positive_signal" as const,
        category: "growth",
        contradictoryEvidence: "None",
        type: "FINDING" as const,
      },
    ];

    const resMissing = await verifyAndFilterFindings(findingsWithMissingRef, "NVDA", adapter);
    expect(resMissing.findings).toHaveLength(0);
    expect(resMissing.rejectedClaims).toBe(1);
    expect(resMissing.rejectedItems[0].reason).toContain("missing mandatory calculationRef");

    // Finding with swapped calculationRefs: receivables value paired with revenue growth calc ID
    const swappedFindings = [
      {
        findingId: "FINDING-SWAPPED",
        company: "NVDA",
        claim: "Growth metrics",
        evidence: [
          // Receivables growth (66.8%) erroneously claimed as CALC-NVDA-revenue-growth-FY2026
          { evidenceKind: "calculation" as const, metric: "Revenue growth", value: "99.9%", calculationRef: "CALC-NVDA-revenue-growth-FY2026" },
        ],
        observationId: "OBS-02",
        calculationRefs: ["CALC-NVDA-revenue-growth-FY2026"],
        evidenceStrength: "HIGH" as const,
        severity: "LOW" as const,
        status: "positive_signal" as const,
        category: "growth",
        contradictoryEvidence: "None",
        type: "FINDING" as const,
      },
    ];

    const resSwapped = await verifyAndFilterFindings(swappedFindings, "NVDA", adapter);
    expect(resSwapped.findings).toHaveLength(0);
    expect(resSwapped.rejectedClaims).toBe(1);
  });

  it("REJECTS claim check where guidance_vs_actual figure mismatches stored fact and logs rejection details", async () => {
    const { verifyAndFilterClaimChecks } = await import("../../src/server/domain/verification.js");
    // Seed dummy fact for claim check verification
    (adapter as any).db.prepare(`
      INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, value, unit, source, source_url, type, availability)
      VALUES ('CLAIM-FACT-01', 'run-nvda-seed', 'NVDA', 'revenue', 'Q3 FY2026', '2025-11-19', 'quarterly', 57006000000, 'USD', 'Earnings release', 'https://sec.gov', 'FACT', 'reported')
    `).run();

    const claimChecks = [
      {
        claimId: "CLAIM-FACT-01",
        company: "NVDA",
        quote: "Management guided Q3 revenue of $57.0B",
        source: "Q2 FY2026 Shareholder Letter",
        sourceUrl: "https://sec.gov",
        date: "2025-08-27",
        topic: "revenue",
        guidanceVsActual: [
          {
            period: "Q3 FY2026",
            guidance: "$57.0B",
            actual: "$99.9B", // Erroneous actual figure, DB has $57.0B
            actualSourceUrl: "https://sec.gov",
          },
        ],
        assessment: "Guidance beaten",
        type: "CLAIM_CHECK" as const,
      },
    ];

    const res = await verifyAndFilterClaimChecks(claimChecks, "NVDA", adapter);
    expect(res.claimChecks).toHaveLength(0);
    expect(res.totalClaims).toBe(1);
    expect(res.verifiedClaims).toBe(0);
    expect(res.rejectedClaims).toBe(1);
    expect(res.rejectedItems).toHaveLength(1);
    expect(res.rejectedItems[0].surface).toBe("claim_check");

    const logs = await adapter.getVerificationLogs("NVDA");
    expect(logs.some((l) => l.result === "fail_mismatch" && l.surface === "claim_check")).toBe(true);
  });

  it("P0 REGRESSION: Bidirectionally REJECTS cross-company verification between RELIANCE (India) and RS (Reliance Steel US)", async () => {
    // Seed RS company, run & fact
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO companies (ticker, cik, display_name, is_live_mode, last_fetched_at, created_at, updated_at)
      VALUES ('RS', '0000861884', 'RELIANCE, INC.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO investigation_runs (run_id, company_ticker, run_timestamp, is_live_mode, is_current, run_type)
      VALUES ('run-rs-seed', 'RS', CURRENT_TIMESTAMP, 1, 1, 'seed')
    `).run();
    (adapter as any).db.prepare(`
      INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, value, unit, source, source_url, type, availability)
      VALUES ('RS-NETINCOME-FY2024', 'run-rs-seed', 'RS', 'netIncome', 'FY2024', '2024-12-31', 'annual', 1500000000, 'USD', 'EDGAR', 'https://sec.gov', 'FACT', 'reported')
    `).run();

    // Seed RELIANCE company, run & fact
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO companies (ticker, cik, display_name, is_live_mode, last_fetched_at, created_at, updated_at)
      VALUES ('RELIANCE', 'BSE-500325', 'Reliance Industries Limited', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO investigation_runs (run_id, company_ticker, run_timestamp, is_live_mode, is_current, run_type)
      VALUES ('run-reliance-seed', 'RELIANCE', CURRENT_TIMESTAMP, 0, 1, 'seed')
    `).run();
    (adapter as any).db.prepare(`
      INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, value, unit, source, source_url, type, availability)
      VALUES ('RELIANCE-REVENUE-FY2025', 'run-reliance-seed', 'RELIANCE', 'revenue', 'FY2025', '2025-03-31', 'annual', 9989080000000, 'INR', 'BSE', 'https://bseindia.com', 'FACT', 'reported')
    `).run();

    // 1. Direction 1: RS reference -> RELIANCE claim must FAIL with fail_cross_company
    const rsToRelianceClaim: VerifiableClaim = {
      text: "Reliance Industries net income for FY2024 was $1.5B",
      claimed_value: "$1.5B",
      ref_id: "RS-NETINCOME-FY2024",
      ref_type: "fact",
    };
    const rsToRelianceRes = await verifyClaim(rsToRelianceClaim, "RELIANCE", adapter);
    expect(rsToRelianceRes.pass).toBe(false);
    expect(rsToRelianceRes.resultCode).toBe("fail_cross_company");
    expect(isVerificationPass(rsToRelianceRes.resultCode)).toBe(false);

    // 2. Direction 2: RELIANCE reference -> RS claim must FAIL with fail_cross_company (inverse direction)
    const relianceToRsClaim: VerifiableClaim = {
      text: "Reliance Steel revenue was ₹998908 Cr",
      claimed_value: "9989080000000",
      ref_id: "RELIANCE-REVENUE-FY2025",
      ref_type: "fact",
    };
    const relianceToRsRes = await verifyClaim(relianceToRsClaim, "RS", adapter);
    expect(relianceToRsRes.pass).toBe(false);
    expect(relianceToRsRes.resultCode).toBe("fail_cross_company");
    expect(isVerificationPass(relianceToRsRes.resultCode)).toBe(false);

    // 3. Confirm that no other verification stage can override this failure on debate surface
    const rsInRelianceDebate: Debate = {
      bullCase: {
        arguments: [
          {
            argument: "Reliance Steel profits cross-cited into Reliance Industries",
            evidence: [
              {
                metric: "Net income",
                value: "$1.5B",
                reference: "RS-NETINCOME-FY2024",
              },
            ],
            caveat: "Unverified cross-company citation",
          },
        ],
        overallStrength: 4,
      },
      bearCase: { arguments: [], overallStrength: 3 },
      judgeVerdict: {
        evidenceQuality: "HIGH",
        mostImportantUnresolvedQuestion: "None",
        explanation: "Audit",
      },
      mode: "deterministic_fallback",
    };
    const filteredDebate = await verifyAndFilterDebate(rsInRelianceDebate, "RELIANCE", adapter);
    expect(filteredDebate.debate.bullCase.arguments).toHaveLength(0);

    // 4. AAPL evidence also FAILS for RELIANCE claims
    const aaplClaim: VerifiableClaim = {
      text: "Reliance claim using Apple calculation",
      claimed_value: "10%",
      ref_id: "CALC-AAPL-revenue-growth-FY2025",
      ref_type: "calculation",
    };
    const aaplRes = await verifyClaim(aaplClaim, "RELIANCE", adapter);
    expect(aaplRes.pass).toBe(false);
    expect(aaplRes.resultCode).toBe("fail_cross_company");
    expect(isVerificationPass(aaplRes.resultCode)).toBe(false);
  });

  it("ACCEPTS evidence from ticker alias when both tickers share the same CIK (canonical identity)", async () => {
    // Simulate a legitimate ticker alias: both 'ABC' and 'ABC.V' map to CIK '0000999999'
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO companies (ticker, cik, display_name, is_live_mode, last_fetched_at, created_at, updated_at)
      VALUES ('ABC', '0000999999', 'ABC Holdings Corp', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO companies (ticker, cik, display_name, is_live_mode, last_fetched_at, created_at, updated_at)
      VALUES ('ABCV', '0000999999', 'ABC Holdings Corp (Venture)', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    (adapter as any).db.prepare(`
      INSERT OR IGNORE INTO investigation_runs (run_id, company_ticker, run_timestamp, is_live_mode, is_current, run_type)
      VALUES ('run-abc-seed', 'ABC', CURRENT_TIMESTAMP, 0, 1, 'seed')
    `).run();
    (adapter as any).db.prepare(`
      INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, value, unit, source, source_url, type, availability)
      VALUES ('ABC-REV-FY2024', 'run-abc-seed', 'ABC', 'revenue', 'FY2024', '2024-12-31', 'annual', 5000000000, 'USD', 'EDGAR', 'https://sec.gov', 'FACT', 'reported')
    `).run();

    // Claim under ABCV referencing ABC fact should PASS (same CIK)
    const aliasClaim: VerifiableClaim = {
      text: "ABC Holdings revenue was $5B",
      claimed_value: "$5B",
      ref_id: "ABC-REV-FY2024",
      ref_type: "fact",
    };
    const res = await verifyClaim(aliasClaim, "ABCV", adapter);
    expect(res.pass).toBe(true);
    expect(res.resultCode).toBe("pass");
  });

  it("INVARIANT: A fact from Company A can never verify a claim belonging to Company B (different CIK)", async () => {
    // Ensure every company pair in the test DB with different CIKs cannot cross-verify
    const companies = (adapter as any).db.prepare("SELECT ticker, cik FROM companies").all();
    const companyPairs: Array<{a: string, b: string}> = [];
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        if (companies[i].cik !== companies[j].cik) {
          companyPairs.push({ a: companies[i].ticker, b: companies[j].ticker });
        }
      }
    }

    // Test a sample of cross-company pairs
    const sampled = companyPairs.slice(0, 5);
    for (const pair of sampled) {
      const facts = (adapter as any).db.prepare("SELECT fact_id FROM facts WHERE company_ticker = ? LIMIT 1").all(pair.a);
      if (facts.length === 0) continue;
      const claim: VerifiableClaim = {
        text: `Cross-company invariant test`,
        claimed_value: "N/A",
        ref_id: facts[0].fact_id,
        ref_type: "fact",
      };
      const res = await verifyClaim(claim, pair.b, adapter);
      expect(res.pass).toBe(false);
      expect(res.resultCode).toBe("fail_cross_company");
    }
  });

  it("REJECTS claim when referenced fact is for a different period (fail_period)", async () => {
    // Fact NVDA-REV-FY2026 is for FY2026. Claim claims FY2025 revenue.
    const periodClaim: VerifiableClaim = {
      text: "NVDA FY2025 revenue was $215.9B",
      claimed_value: "$215.9B",
      ref_id: "NVDA-REV-FY2026",
      ref_type: "fact",
    };
    const res = await verifyClaim(periodClaim, "NVDA", adapter);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_period");
    expect(res.reason).toContain("Claim references period FY2025");
  });

  it("distinguishes verification level: reference vs numeric and logs surface", async () => {
    // Reference verification
    const refClaim: VerifiableClaim = {
      text: "Referenced audited filing for FY2026",
      claimed_value: "Verified Reference",
      ref_id: "NVDA-REV-FY2026",
      ref_type: "fact",
    };
    const refRes = await verifyClaim(refClaim, "NVDA", adapter, "production", "finding");
    expect(refRes.pass).toBe(true);
    expect(refRes.verificationLevel).toBe("reference");

    // Numeric verification
    const numClaim: VerifiableClaim = {
      text: "NVDA FY2026 revenue was $215.938B",
      claimed_value: "$215.938B",
      ref_id: "NVDA-REV-FY2026",
      ref_type: "fact",
    };
    const numRes = await verifyClaim(numClaim, "NVDA", adapter, "production", "debate");
    expect(numRes.pass).toBe(true);
    expect(numRes.verificationLevel).toBe("numeric");

    // Check DB log persistence
    const logs = await adapter.getVerificationLogs("NVDA", "production");
    const findingLog = logs.find((l) => l.surface === "finding");
    expect(findingLog).toBeDefined();
    expect(findingLog?.verificationLevel).toBe("reference");

    const debateLog = logs.find((l) => l.surface === "debate");
    expect(debateLog).toBeDefined();
    expect(debateLog?.verificationLevel).toBe("numeric");
  });

  it("enforces explicit forensic allowlist for isVerificationPass", () => {
    // True for exact allowlisted pass codes
    expect(isVerificationPass("pass")).toBe(true);
    expect(isVerificationPass("pass_numeric")).toBe(true);
    expect(isVerificationPass("pass_reference")).toBe(true);
    expect(isVerificationPass("pass_semantic")).toBe(true);

    // False for non-allowlisted prefixes, partial matches, or substrings
    expect(isVerificationPass("passage")).toBe(false);
    expect(isVerificationPass("passing")).toBe(false);
    expect(isVerificationPass("pass_invalid")).toBe(false);
    expect(isVerificationPass("pass_custom")).toBe(false);

    // False for all failure codes
    expect(isVerificationPass("fail_cross_company")).toBe(false);
    expect(isVerificationPass("fail_missing_ref")).toBe(false);
    expect(isVerificationPass("fail_mismatch")).toBe(false);
    expect(isVerificationPass("fail_null_value")).toBe(false);
    expect(isVerificationPass("fail_sign_flip")).toBe(false);
    expect(isVerificationPass("fail_period")).toBe(false);

    // False for empty / null / undefined / non-string
    expect(isVerificationPass(null)).toBe(false);
    expect(isVerificationPass(undefined)).toBe(false);
    expect(isVerificationPass("")).toBe(false);
    expect(isVerificationPass(123 as any)).toBe(false);
  });
});


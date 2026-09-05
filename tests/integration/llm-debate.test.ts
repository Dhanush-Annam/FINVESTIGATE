import { describe, expect, it, beforeEach } from "vitest";
import { buildEvidencePack } from "../../src/server/infrastructure/llm/evidence-pack.js";
import { computeDeterministicStrength } from "../../src/server/infrastructure/llm/deterministic-scorer.js";
import { generateConstrainedAIDebate } from "../../src/server/infrastructure/llm/orchestrator.js";
import { verifyAndFilterDebate, verifyClaim } from "../../src/server/domain/verification.js";
import { getRepository } from "../../src/server/infrastructure/db/repository.js";
import type { Investigation } from "../../src/server/types/index.js";
import type { Debate } from "../../src/shared/types/index.js";

const mockInvestigation: Investigation = {
  company: "NVDA",
  displayName: "NVIDIA Corporation",
  cik: "0001045810",
  facts: [
    {
      factId: "NVDA-FACT-REV-2024",
      company: "NVDA",
      metric: "Revenue",
      period: { label: "FY2024", endDate: "2024-01-28", kind: "annual" },
      value: 60922000000,
      unit: "USD",
      source: "EDGAR 10-K",
      sourceUrl: "https://www.sec.gov/edgar",
      type: "FACT",
      availability: "reported",
    },
  ],
  calculations: [
    {
      calcId: "CALC-REV-GROWTH-NVDA-2024",
      company: "NVDA",
      metric: "revenue_growth_yoy",
      period: { label: "FY2024", endDate: "2024-01-28", kind: "annual" },
      formula: "YoY Growth",
      inputFactIds: ["NVDA-FACT-REV-2024"],
      value: 1.259, // 125.9%
      unit: "PERCENT",
      type: "CALCULATION",
    },
  ],
  anomalies: [],
  findings: [
    {
      findingId: "NVDA-LIVE-FINDING-001",
      company: "NVDA",
      claim: "Accounts receivable growth outpaced revenue growth.",
      evidence: [{ evidenceKind: "contextual", metric: "Receivables growth", value: "150.0%" }],
      observationId: "OBS-AR-01",
      calculationRefs: ["CALC-REV-GROWTH-NVDA-2024"],
      evidenceStrength: "HIGH",
      severity: "MEDIUM",
      status: "requires_investigation",
      category: "working_capital",
      contradictoryEvidence: "Subject to quarter end timing.",
      type: "FINDING",
    },
  ],
  claimChecks: [],
};

describe("Constrained AI Debate System", () => {
  beforeEach(async () => {
    const repo = await getRepository();
    await repo.seedCuratedData();
  });

  it("builds a JSON-serializable Evidence Pack and strict Evidence Registry", () => {
    const pack = buildEvidencePack(mockInvestigation);
    expect(pack.company.ticker).toBe("NVDA");
    expect(pack.evidenceRegistry["NVDA-FACT-REV-2024"]).toBeDefined();
    expect(pack.evidenceRegistry["CALC-REV-GROWTH-NVDA-2024"]).toBeDefined();
    expect(pack.evidenceRegistry["NVDA-LIVE-FINDING-001"]).toBeDefined();

    // Verify JSON serializability
    const jsonStr = JSON.stringify(pack);
    expect(jsonStr).toContain("NVDA-FACT-REV-2024");
  });

  it("computes deterministic argument strength scores based on evidence coverage", () => {
    const pack = buildEvidencePack(mockInvestigation);
    const score = computeDeterministicStrength(
      [
        { evidenceRefs: ["CALC-REV-GROWTH-NVDA-2024"] },
        { evidenceRefs: ["NVDA-LIVE-FINDING-001"] },
      ],
      pack.evidenceRegistry
    );
    expect(score).toBeGreaterThanOrEqual(1.0);
    expect(score).toBeLessThanOrEqual(9.5);
  });

  it("falls back gracefully to deterministic debate when API key is missing", async () => {
    const origKey = process.env.GEMINI_API_KEY;
    const origGenAiKey = process.env.GOOGLE_GENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;
    process.env.GEMINI_API_KEY = "";
    process.env.GOOGLE_GENAI_API_KEY = "";

    try {
      const debate = await generateConstrainedAIDebate(mockInvestigation);
      expect(debate.mode).toBe("deterministic_fallback");
      expect(debate.bullCase.arguments.length).toBeGreaterThan(0);
      expect(debate.bearCase.arguments.length).toBeGreaterThan(0);
    } finally {
      if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey; else delete process.env.GEMINI_API_KEY;
      if (origGenAiKey !== undefined) process.env.GOOGLE_GENAI_API_KEY = origGenAiKey; else delete process.env.GOOGLE_GENAI_API_KEY;
    }
  }, 15000);

  it("ADVERSARIAL TEST 1: REJECTS AI debate with fabricated numeric claim and falls back atomically", async () => {
    const repo = await getRepository();

    const fabricatedAIDebate: Debate = {
      bullCase: {
        arguments: [
          {
            argument: "NVIDIA achieved unprecedented 999% revenue growth.",
            evidence: [{ metric: "Revenue growth", value: "999%", reference: "CALC-REV-GROWTH-NVDA-2024" }],
            caveat: "Revenue expansion requires margin sustainability.",
          },
        ],
        overallStrength: 8.5,
      },
      bearCase: {
        arguments: [
          {
            argument: "Working capital friction observed.",
            evidence: [{ metric: "Receivables growth", value: "150.0%", reference: "CALC-REV-GROWTH-NVDA-2024" }],
            caveat: "Subject to quarter end timing.",
          },
        ],
        overallStrength: 6.0,
      },
      judgeVerdict: {
        evidenceQuality: "HIGH",
        mostImportantUnresolvedQuestion: "Can NVIDIA sustain current growth?",
        explanation: "Evaluation based on data.",
        unresolvedQuestionEvidenceRefs: ["CALC-REV-GROWTH-NVDA-2024"],
      },
      mode: "ai_grounded",
    };

    const res = await verifyAndFilterDebate(fabricatedAIDebate, "NVDA", repo, "adversarial");
    expect(res.rejectedClaims).toBeGreaterThan(0);
    expect(res.debate.mode).toBe("deterministic_fallback");
  });

  it("ADVERSARIAL TEST 2: REJECTS AI debate referencing valid Evidence ID belonging to a DIFFERENT company", async () => {
    const repo = await getRepository();

    // Verify claim directly for cross-company rejection
    const crossCompanyClaim = {
      text: "NVIDIA claims Apple revenue fact",
      claimed_value: "$416.2B",
      ref_id: "AAPL-REV-FY2025", // Belongs to AAPL, not NVDA
      ref_type: "fact" as const,
    };

    const verifyRes = await verifyClaim(crossCompanyClaim, "NVDA", repo, "adversarial");
    expect(verifyRes.pass).toBe(false);
    expect(verifyRes.resultCode).toBe("fail_cross_company");

    // Verify full debate atomic fallback
    const crossCompanyAIDebate: Debate = {
      bullCase: {
        arguments: [
          {
            argument: "NVIDIA revenue expanded based on Apple disclosure.",
            evidence: [{ metric: "Revenue", value: "$416.2B", reference: "AAPL-REV-FY2025" }],
            caveat: "Cross company data.",
          },
        ],
        overallStrength: 8.0,
      },
      bearCase: {
        arguments: [
          {
            argument: "Standard risk.",
            evidence: [{ metric: "Scope", value: "Standard", reference: "FACT" }],
            caveat: "No anomaly.",
          },
        ],
        overallStrength: 5.0,
      },
      judgeVerdict: {
        evidenceQuality: "MEDIUM",
        mostImportantUnresolvedQuestion: "Cross company data validity?",
        explanation: "Evaluation.",
      },
      mode: "ai_grounded",
    };

    const res = await verifyAndFilterDebate(crossCompanyAIDebate, "NVDA", repo, "adversarial");
    expect(res.rejectedClaims).toBeGreaterThan(0);
    expect(res.debate.mode).toBe("deterministic_fallback");
  });
});

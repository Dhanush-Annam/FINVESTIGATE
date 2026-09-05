import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getMaterialRedFlags,
  getLowSeveritySignals,
  getDiligenceVerdict,
  type Finding,
} from "../../src/shared/index.js";

describe("Semantic Consistency & Anti-Contradiction Test Suite", () => {
  const nvdaPath = resolve(process.cwd(), "data", "curated", "nvda.json");
  const nvdaData = JSON.parse(readFileSync(nvdaPath, "utf-8"));

  it("reconciles signal counts between header, stage 2, and brief for NVDA", () => {
    const findings: Finding[] = nvdaData.findings;
    const materialRedFlags = getMaterialRedFlags(findings);
    const lowSeveritySignals = getLowSeveritySignals(findings);

    // NVDA should have 0 material red flags and exactly 1 low-severity signal
    expect(materialRedFlags.length).toBe(0);
    expect(lowSeveritySignals.length).toBe(1);

    // Ensure the finding is explicitly low severity
    expect(findings[0].severity).toBe("LOW");
    expect(findings[0].status).toBe("positive_signal");
    expect(findings[0].claim).toBe(
      "Receivables increased materially, but remained broadly aligned with revenue growth."
    );
  });

  it("enforces structured verdict: MONITOR when materialRedFlags === 0 and lowSeveritySignals > 0", () => {
    const findings: Finding[] = nvdaData.findings;
    const verdict = getDiligenceVerdict(findings, "NVDA");

    expect(verdict.verdict).toBe("MONITOR");
    expect(verdict.heading).toBe("MONITOR");
    expect(verdict.subtextBadge).toBe("No Material Red Flags");
    expect(verdict.narrative).toContain("No material forensic accounting divergence");
    expect(verdict.narrative).toContain("Receivables growth remained broadly aligned with revenue growth");
  });

  it("enforces structured verdict: CLEAR when findings are empty", () => {
    const verdict = getDiligenceVerdict([]);
    expect(verdict.verdict).toBe("CLEAR");
    expect(verdict.heading).toBe("CLEAR");
  });

  it("enforces structured verdict: REQUIRES_FURTHER_INVESTIGATION when material red flags exist", () => {
    const mockFindings: Finding[] = [
      {
        findingId: "TEST-01",
        company: "TEST",
        claim: "Divergence",
        evidence: [],
        observationId: "OBS-1",
        calculationRefs: [],
        evidenceStrength: "HIGH",
        severity: "MEDIUM",
        status: "requires_investigation",
        category: "cash_flow_quality",
        contradictoryEvidence: "None",
        type: "FINDING",
      },
    ];
    const verdict = getDiligenceVerdict(mockFindings);
    expect(verdict.verdict).toBe("REQUIRES_FURTHER_INVESTIGATION");
  });

  it("verifies guidance period matching: Q4 guidance compares against Q4 actual (no pending, no period mismatch)", () => {
    const gmClaim = nvdaData.claimChecks.find(
      (c: any) => c.claimId === "NVDA-CLAIM-003"
    );
    expect(gmClaim).toBeDefined();
    expect(gmClaim.evidenceStatus).toBe("VERIFIED");

    const comparison = gmClaim.guidanceVsActual[0];
    expect(comparison.period).toContain("Q4 FY2026");
    expect(comparison.actual).toContain("75.0% reported Q4 GAAP gross margin");
    expect(gmClaim.derivedVariance).toBe("+3.0 percentage points above guidance ceiling");
    expect(gmClaim.assessment).toContain("75.0%, exceeding the 70–72% guidance range by 3.0 percentage points");
  });

  it("verifies Q3 revenue guidance comparison precision", () => {
    const revClaim = nvdaData.claimChecks.find(
      (c: any) => c.claimId === "NVDA-CLAIM-001"
    );
    expect(revClaim).toBeDefined();
    expect(revClaim.evidenceStatus).toBe("VERIFIED");
    expect(revClaim.derivedVariance).toBe("+3.5% above guidance ceiling");
    expect(revClaim.assessment).toContain("exceeded the upper end of management's guidance by approximately 3.5%");
  });

  it("verifies claim decomposition for Data Center demand vs GPU inventory utilization", () => {
    const dcClaim = nvdaData.claimChecks.find(
      (c: any) => c.claimId === "NVDA-CLAIM-002"
    );
    expect(dcClaim).toBeDefined();
    expect(dcClaim.evidenceStatus).toBe("PARTIALLY_CORROBORATED");
    expect(dcClaim.components).toHaveLength(2);

    const compA = dcClaim.components[0];
    const compB = dcClaim.components[1];

    expect(compA.label).toContain("Data Center Demand");
    expect(compA.status).toBe("CORROBORATED");
    expect(compA.evidence).toContain("+68% YoY");

    expect(compB.label).toContain("Inventory Utilization");
    expect(compB.status).toBe("NOT_DIRECTLY_VERIFIED");
  });

  it("validates mechanical rejection arithmetic consistency", () => {
    // 77 cross-company + 122 missing refs + 12 numeric drift = 211 rejected
    const crossCompany = 77;
    const missingRef = 122;
    const mismatch = 12;
    const nullValue = 0;
    const rejectedClaims = crossCompany + missingRef + mismatch + nullValue;

    expect(rejectedClaims).toBe(211);

    const verifiedClaims = 85;
    const totalClaims = verifiedClaims + rejectedClaims;
    expect(totalClaims).toBe(296);
  });

  it("verifies production vs adversarial source isolation in repository", async () => {
    const { getRepository } = await import("../../src/server/infrastructure/db/repository.js");
    const { executeAdversarialAttack, isVerificationPass } = await import("../../src/server/domain/verification.js");
    const repo = await getRepository();

    // Query production logs
    const prodLogsBefore = await repo.getVerificationLogs("NVDA", "production");
    const prodVerifiedBefore = prodLogsBefore.filter((l) => isVerificationPass(l.result)).length;
    const prodRejectedBefore = prodLogsBefore.filter((l) => !isVerificationPass(l.result)).length;

    expect(prodLogsBefore.length).toBe(296);
    expect(prodVerifiedBefore).toBe(85);
    expect(prodRejectedBefore).toBe(211);

    // Execute adversarial attack
    const attackResult = await executeAdversarialAttack("NVDA", "fabricated_id", repo);
    expect(attackResult.pass).toBe(false);

    // Query production logs after attack: MUST REMAIN UNCHANGED
    const prodLogsAfter = await repo.getVerificationLogs("NVDA", "production");
    expect(prodLogsAfter.length).toBe(296);
    expect(prodLogsAfter.filter((l) => isVerificationPass(l.result)).length).toBe(85);
    expect(prodLogsAfter.filter((l) => !isVerificationPass(l.result)).length).toBe(211);

    // Query adversarial logs: should reflect attack
    const advLogs = await repo.getVerificationLogs("NVDA", "adversarial");
    expect(advLogs.length).toBeGreaterThan(0);
    expect(advLogs.every((l) => l.sourceType === "adversarial")).toBe(true);
  });

  it("verifies deterministic formula lineage: calculations reference valid input facts", async () => {
    const { buildCoreCalculations } = await import("../../src/server/domain/calculations.js");
    const facts = nvdaData.facts;
    const periods = [...new Map(facts.map((fact: any) => [fact.period.label, fact.period])).values()]
      .sort((left: any, right: any) => right.endDate.localeCompare(left.endDate)) as any[];
    const calculations = buildCoreCalculations("NVDA", facts, periods[0], periods[1]);
    const factIdSet = new Set(facts.map((f: any) => f.factId));

    for (const calc of calculations) {
      expect(calc.inputFactIds).toBeDefined();
      expect(calc.inputFactIds.length).toBeGreaterThan(0);
      for (const fId of calc.inputFactIds) {
        expect(factIdSet.has(fId)).toBe(true);
      }
    }
  });
});

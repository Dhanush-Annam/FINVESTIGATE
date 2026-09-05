import { randomUUID } from "node:crypto";
import { CACHE_TTL_DAYS } from "../../shared/constants/index.js";
import { isVerificationPass } from "../../shared/utils/diligence.js";
import type { Investigation } from "../types/index.js";
import { resolveCik } from "../infrastructure/sources/live-cik.js";
import { getRepository } from "../infrastructure/db/repository.js";
import { generateLiveDebate } from "../infrastructure/llm/live-debate.js";
import { calculateFundamentalScores } from "../domain/fundamental-scorer.js";
import {
  verifyAndFilterDebate,
  verifyAndFilterFindings,
  verifyAndFilterClaimChecks,
} from "../domain/verification.js";
import { runFullPipeline } from "./investigation-service.js";

export { CACHE_TTL_DAYS, runFullPipeline };
export type { Investigation };

// PROCESS-LOCAL CONCURRENCY LOCK:
// Single-flight Promise coalescing to deduplicate concurrent same-ticker requests within this process.
// NOTE: This lock is strictly process-local (single-process concurrency).
// In a multi-instance or clustered deployment, a distributed locking mechanism (e.g. Redis Redlock)
// would be required to coalesce across separate processes.
const inFlightInvestigations = new Map<string, Promise<Investigation>>();

export async function loadInvestigation(ticker: string): Promise<Investigation> {
  let normalizedTicker = ticker.trim().toUpperCase();
  const cikInfo = await resolveCik(ticker);
  if (cikInfo) {
    normalizedTicker = cikInfo.ticker.toUpperCase();
  }

  const inFlight = inFlightInvestigations.get(normalizedTicker);
  if (inFlight) {
    return inFlight;
  }

  const promise = executeLoadInvestigation(normalizedTicker).finally(() => {
    inFlightInvestigations.delete(normalizedTicker);
  });

  inFlightInvestigations.set(normalizedTicker, promise);
  return promise;
}

async function executeLoadInvestigation(normalizedTicker: string): Promise<Investigation> {
  const repo = await getRepository();
  const company = await repo.getCompany(normalizedTicker);
  if (company && !(await repo.isCacheStale(normalizedTicker, CACHE_TTL_DAYS))) {
    const cached = await repo.getInvestigation(normalizedTicker);
    if (cached) {
      if (!cached.debate) {
        cached.debate = {
          ...generateLiveDebate(
            cached.company,
            cached.displayName,
            cached.calculations,
            cached.findings,
            cached.facts
          ),
          mode: "deterministic_fallback",
        };
        try {
          await repo.saveInvestigation(cached, { runId: cached.runId });
        } catch {
          // Ignore persistence errors
        }
      } else if (
        cached.debate.mode !== "ai_grounded" ||
        !cached.debate.judgeVerdict.bullScore ||
        !cached.debate.bullCase.factors
      ) {
        const scores = calculateFundamentalScores(cached.calculations, cached.findings, cached.facts);
        cached.debate.bullCase.overallStrength = scores.bullScore;
        cached.debate.bullCase.factors = scores.bullFactors;
        cached.debate.bearCase.overallStrength = scores.bearScore;
        cached.debate.bearCase.factors = scores.bearFactors;
        cached.debate.judgeVerdict.bullScore = scores.bullScore;
        cached.debate.judgeVerdict.bearScore = scores.bearScore;
        cached.debate.judgeVerdict.bullFactors = scores.bullFactors;
        cached.debate.judgeVerdict.bearFactors = scores.bearFactors;
        if (!cached.debate.judgeVerdict.evidenceQuality) {
          cached.debate.judgeVerdict.evidenceQuality = scores.evidenceQuality;
        }
      }

      if (!cached.verificationStats) {
        const logs = await repo.getVerificationLogs(normalizedTicker, "production");
        if (logs.length > 0) {
          const verified = logs.filter((l) => isVerificationPass(l.result)).length;
          const rejected = logs.filter((l) => !isVerificationPass(l.result));
          cached.verificationStats = {
            totalClaims: logs.length,
            verifiedClaims: verified,
            rejectedClaims: rejected.length,
            rejectedItems: rejected.slice(0, 10).map((l) => ({
              surface: (l.surface as "finding" | "claim_check" | "debate") || "debate",
              claimText: l.claimText,
              reason: l.detail || l.result,
            })),
          };
        }
      }
      return cached;
    }
  }

  // Cache miss or stale: run pipeline, verify claims, and save to DB
  const fresh = await runFullPipeline(normalizedTicker);
  const runId = fresh.runId || `run-${randomUUID()}`;
  fresh.runId = runId;

  // 1. Save facts and calculations first under runId so verifier can query DB rows
  await repo.saveInvestigation(fresh, { runId });

  let totalClaims = 0;
  let verifiedClaims = 0;
  let rejectedClaims = 0;
  const rejectedItems: { surface: "finding" | "claim_check" | "debate"; claimText: string; reason: string }[] = [];

  // 2. Run verification gate across all 3 LLM output surfaces (Findings, Claim Checks, Debate)
  if (fresh.findings.length > 0) {
    const res = await verifyAndFilterFindings(fresh.findings, normalizedTicker, repo);
    fresh.findings = res.findings;
    totalClaims += res.totalClaims;
    verifiedClaims += res.verifiedClaims;
    rejectedClaims += res.rejectedClaims;
    rejectedItems.push(...res.rejectedItems);
  }

  if (fresh.claimChecks.length > 0) {
    const res = await verifyAndFilterClaimChecks(fresh.claimChecks, normalizedTicker, repo);
    fresh.claimChecks = res.claimChecks;
    totalClaims += res.totalClaims;
    verifiedClaims += res.verifiedClaims;
    rejectedClaims += res.rejectedClaims;
    rejectedItems.push(...res.rejectedItems);
  }

  if (fresh.debate) {
    const res = await verifyAndFilterDebate(fresh.debate, normalizedTicker, repo);
    fresh.debate = res.debate;
    totalClaims += res.totalClaims;
    verifiedClaims += res.verifiedClaims;
    rejectedClaims += res.rejectedClaims;
    rejectedItems.push(...res.rejectedItems);
  }

  fresh.verificationStats = {
    totalClaims,
    verifiedClaims,
    rejectedClaims,
    rejectedItems,
  };

  // 3. Save final verified state under the exact same runId
  await repo.saveInvestigation(fresh, { runId });

  return fresh;
}

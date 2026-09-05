import type { EvidenceRegistry } from "./types.js";

/**
 * Computes evidence coverage / breadth score based on the diversity and volume
 * of grounded citations referenced in an argument set.
 *
 * NOTE: This measures structural citation breadth and evidence density.
 * Directional financial conviction (bullish vs bearish fundamentals) is computed
 * by `calculateFundamentalScores` in `fundamental-scorer.ts`.
 */
export function computeEvidenceCoverageScore(
  argumentsList: Array<{ evidenceRefs: string[] }>,
  registry: EvidenceRegistry
): number {
  if (!argumentsList || argumentsList.length === 0) return 3.0;

  let totalScore = 4.0;
  const uniqueRefs = new Set<string>();

  for (const arg of argumentsList) {
    for (const refId of arg.evidenceRefs) {
      if (uniqueRefs.has(refId)) continue;
      uniqueRefs.add(refId);

      const entry = registry[refId];
      if (!entry) continue;

      if (entry.type === "FINDING") {
        totalScore += 1.5;
      } else if (entry.type === "OBSERVATION") {
        totalScore += 1.2;
      } else if (entry.type === "CALCULATION") {
        totalScore += 1.0;
      } else if (entry.type === "FACT") {
        totalScore += 0.8;
      } else if (entry.type === "CLAIM_CHECK") {
        totalScore += 0.6;
      }
    }
  }

  if (argumentsList.length >= 2) {
    totalScore += 0.5;
  }

  const rounded = Math.min(9.5, Math.max(1.0, Math.round(totalScore * 10) / 10));
  return rounded;
}

/**
 * Backward-compatible alias for computeEvidenceCoverageScore.
 */
export const computeDeterministicStrength = computeEvidenceCoverageScore;

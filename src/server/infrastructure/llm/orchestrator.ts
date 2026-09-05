import type { Debate, DebateArgumentSchema } from "../../../shared/types/index.js";
import type { Investigation } from "../../types/index.js";
import { generateLiveDebate } from "./live-debate.js";
import { runBearAgent } from "./bear-agent.js";
import { runBullAgent } from "./bull-agent.js";
import { computeDeterministicStrength } from "./deterministic-scorer.js";
import { buildEvidencePack } from "./evidence-pack.js";
import { runJudgeAgent } from "./judge-agent.js";
import { getGeminiApiKey } from "./provider.js";
import type { EvidenceRegistry } from "./types.js";
import { z } from "zod";

type DebateArgument = z.infer<typeof DebateArgumentSchema>;

function mapRefsToEvidenceItems(
  refIds: string[],
  registry: EvidenceRegistry
): { metric: string; value: string; reference: string }[] {
  const items: { metric: string; value: string; reference: string }[] = [];

  for (const refId of refIds) {
    const entry = registry[refId];
    if (!entry) continue;

    let valStr = entry.value !== null && entry.value !== undefined ? String(entry.value) : "N/A";
    if (typeof entry.value === "number") {
      if (entry.unit === "PERCENT") valStr = `${(entry.value * 100).toFixed(1)}%`;
      else if (entry.unit === "USD") valStr = `$${(entry.value / 1_000_000_000).toFixed(1)}B`;
    }

    items.push({
      metric: entry.metric || "Evidence",
      value: valStr,
      reference: refId,
    });
  }

  return items;
}

export async function generateConstrainedAIDebate(investigation: Investigation): Promise<Debate> {
  const fallbackDebate = () => {
    const fallback = generateLiveDebate(
      investigation.company,
      investigation.displayName,
      investigation.calculations,
      investigation.findings,
      investigation.facts
    );
    return {
      ...fallback,
      mode: "deterministic_fallback" as const,
    };
  };

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.log("[AI Debate Orchestrator] API key not configured. Using deterministic fallback debate.");
    return fallbackDebate();
  }

  try {
    const evidencePack = buildEvidencePack(investigation);

    // Step 1: Bull Agent
    const bullOutput = await runBullAgent(evidencePack);
    if (!bullOutput) {
      console.warn("[AI Debate Orchestrator] Bull agent failed or produced ungrounded output. Falling back.");
      return fallbackDebate();
    }

    // Step 2: Bear Agent
    const bearOutput = await runBearAgent(evidencePack, bullOutput);
    if (!bearOutput) {
      console.warn("[AI Debate Orchestrator] Bear agent failed or produced ungrounded output. Falling back.");
      return fallbackDebate();
    }

    // Step 3: Judge Agent
    const judgeOutput = await runJudgeAgent(evidencePack, bullOutput, bearOutput);
    if (!judgeOutput) {
      console.warn("[AI Debate Orchestrator] Judge agent failed or produced ungrounded output. Falling back.");
      return fallbackDebate();
    }

    // Step 4: Deterministic Scoring
    const bullScore = computeDeterministicStrength(bullOutput.arguments, evidencePack.evidenceRegistry);
    const bearScore = computeDeterministicStrength(bearOutput.arguments, evidencePack.evidenceRegistry);

    // Map Bull Arguments
    const bullArguments: DebateArgument[] = bullOutput.arguments.map((arg) => {
      const evidence = mapRefsToEvidenceItems(arg.evidenceRefs, evidencePack.evidenceRegistry);
      const caveatText = arg.counterpoints && arg.counterpoints.length > 0 ? arg.counterpoints.join(" ") : "Requires ongoing tracking.";
      return {
        argument: arg.claim,
        evidence,
        caveat: caveatText,
      };
    });

    // Map Bear Arguments
    const bearArguments: DebateArgument[] = bearOutput.arguments.map((arg) => {
      const evidence = mapRefsToEvidenceItems(arg.evidenceRefs, evidencePack.evidenceRegistry);
      const caveatText = arg.counterpoints && arg.counterpoints.length > 0 ? arg.counterpoints.join(" ") : "Requires multi-quarter monitoring.";
      return {
        argument: arg.claim,
        evidence,
        caveat: caveatText,
      };
    });

    // Require non-empty arguments
    if (bullArguments.length === 0 || bearArguments.length === 0) {
      console.warn("[AI Debate Orchestrator] Empty Bull or Bear arguments after mapping. Falling back.");
      return fallbackDebate();
    }

    const aiDebate: Debate = {
      bullCase: {
        arguments: bullArguments,
        overallStrength: bullScore,
      },
      bearCase: {
        arguments: bearArguments,
        overallStrength: bearScore,
      },
      judgeVerdict: {
        evidenceQuality: judgeOutput.evidenceQuality,
        mostImportantUnresolvedQuestion: judgeOutput.mostImportantUnresolvedQuestion,
        explanation: judgeOutput.reasoning,
        unresolvedQuestionEvidenceRefs: judgeOutput.unresolvedQuestionEvidenceRefs,
        evidenceRefs: judgeOutput.evidenceRefs,
        bullScore,
        bearScore,
        confidence: judgeOutput.confidence,
      },
      mode: "ai_grounded",
    };

    return aiDebate;
  } catch (error) {
    console.warn("[AI Debate Orchestrator Exception]", error);
    return fallbackDebate();
  }
}

import { callGeminiStructuredJSONWithStats, type LLMCallResult } from "./provider.js";
import { BEAR_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { BearAgentOutputSchema, type BearAgentOutput, type BullAgentOutput, type EvidencePack } from "./types.js";
import type { AgentRunResult } from "./bull-agent.js";

export async function runBearAgent(
  evidencePack: EvidencePack,
  validatedBullOutput?: BullAgentOutput,
  overrideModel?: string
): Promise<BearAgentOutput | null> {
  const res = await runBearAgentWithDetails(evidencePack, validatedBullOutput, overrideModel);
  return res.output;
}

export async function runBearAgentWithDetails(
  evidencePack: EvidencePack,
  validatedBullOutput?: BullAgentOutput,
  overrideModel?: string
): Promise<AgentRunResult<BearAgentOutput>> {
  const userPrompt = JSON.stringify({
    company: evidencePack.company,
    availableEvidence: evidencePack.evidenceCatalog,
    bullCaseToChallenge: validatedBullOutput ? validatedBullOutput.arguments : undefined,
  }, null, 2);

  const callResult = await callGeminiStructuredJSONWithStats<unknown>(
    BEAR_AGENT_SYSTEM_PROMPT,
    userPrompt,
    8000,
    overrideModel
  );

  if (!callResult.data) {
    return {
      output: null,
      rawJson: null,
      schemaValid: false,
      grounded: false,
      ungroundedRefs: [],
      stats: callResult.stats,
      error: callResult.error || "LLM call returned null",
    };
  }

  const parseResult = BearAgentOutputSchema.safeParse(callResult.data);
  if (!parseResult.success) {
    console.warn("[Bear Agent Validation Error]", parseResult.error.format());
    return {
      output: null,
      rawJson: callResult.data,
      schemaValid: false,
      grounded: false,
      ungroundedRefs: [],
      stats: callResult.stats,
      error: "Zod Schema Validation Failed",
    };
  }

  const output = parseResult.data;
  const ungroundedRefs: string[] = [];

  // Validate every evidenceRef against EvidenceRegistry
  for (const arg of output.arguments) {
    for (const refId of arg.evidenceRefs) {
      if (!evidencePack.evidenceRegistry[refId]) {
        ungroundedRefs.push(refId);
      }
    }
  }

  if (ungroundedRefs.length > 0) {
    console.warn(`[Bear Agent Registry Rejection] Un-grounded refs: ${ungroundedRefs.join(", ")}`);
    return {
      output: null,
      rawJson: callResult.data,
      schemaValid: true,
      grounded: false,
      ungroundedRefs,
      stats: callResult.stats,
      error: `Ungrounded evidence reference IDs: ${ungroundedRefs.join(", ")}`,
    };
  }

  return {
    output,
    rawJson: callResult.data,
    schemaValid: true,
    grounded: true,
    ungroundedRefs: [],
    stats: callResult.stats,
  };
}

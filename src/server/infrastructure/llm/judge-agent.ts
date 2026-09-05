import { callGeminiStructuredJSONWithStats, type LLMCallResult } from "./provider.js";
import { JUDGE_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import { JudgeAgentOutputSchema, type BullAgentOutput, type BearAgentOutput, type EvidencePack, type JudgeAgentOutput } from "./types.js";
import type { AgentRunResult } from "./bull-agent.js";

export async function runJudgeAgent(
  evidencePack: EvidencePack,
  bullOutput: BullAgentOutput,
  bearOutput: BearAgentOutput,
  overrideModel?: string
): Promise<JudgeAgentOutput | null> {
  const res = await runJudgeAgentWithDetails(evidencePack, bullOutput, bearOutput, overrideModel);
  return res.output;
}

export async function runJudgeAgentWithDetails(
  evidencePack: EvidencePack,
  bullOutput: BullAgentOutput,
  bearOutput: BearAgentOutput,
  overrideModel?: string
): Promise<AgentRunResult<JudgeAgentOutput>> {
  const userPrompt = JSON.stringify({
    company: evidencePack.company,
    availableEvidence: evidencePack.evidenceCatalog,
    bullCase: bullOutput.arguments,
    bearCase: bearOutput.arguments,
  }, null, 2);

  const callResult = await callGeminiStructuredJSONWithStats<unknown>(
    JUDGE_AGENT_SYSTEM_PROMPT,
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

  const parseResult = JudgeAgentOutputSchema.safeParse(callResult.data);
  if (!parseResult.success) {
    console.warn("[Judge Agent Validation Error]", parseResult.error.format());
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

  // 1. Verify unresolvedQuestionEvidenceRefs against EvidenceRegistry
  for (const refId of output.unresolvedQuestionEvidenceRefs) {
    if (!evidencePack.evidenceRegistry[refId]) {
      ungroundedRefs.push(refId);
    }
  }

  // 2. Verify all other referenced evidence IDs
  for (const refId of output.evidenceRefs) {
    if (!evidencePack.evidenceRegistry[refId]) {
      ungroundedRefs.push(refId);
    }
  }

  if (ungroundedRefs.length > 0) {
    console.warn(`[Judge Agent Registry Rejection] Un-grounded refs: ${ungroundedRefs.join(", ")}`);
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

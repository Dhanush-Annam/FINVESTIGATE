import { z } from "zod";

export interface EvidenceRegistryEntry {
  id: string;
  type: "FACT" | "CALCULATION" | "OBSERVATION" | "FINDING" | "CLAIM_CHECK";
  company: string;
  metric: string;
  periodLabel: string;
  value: number | string | null;
  unit?: string;
  rawRef: string;
}

export type EvidenceRegistry = Record<string, EvidenceRegistryEntry>;

export interface EvidencePackItem {
  id: string;
  type: "FACT" | "CALCULATION" | "OBSERVATION" | "FINDING" | "CLAIM_CHECK";
  metric: string;
  period: string;
  value: string;
  detail: string;
}

export interface EvidencePack {
  company: {
    ticker: string;
    displayName: string;
    cik?: string;
    investigationPeriod: string;
  };
  evidenceCatalog: EvidencePackItem[];
  evidenceRegistry: EvidenceRegistry;
}

// Bull Agent Zod Schema & Types
export const BullArgumentSchema = z.object({
  argumentId: z.string(),
  claim: z.string(),
  reasoning: z.string(),
  evidenceRefs: z.array(z.string()).min(1, "Every Bull argument must reference at least one Evidence ID"),
  counterpoints: z.array(z.string()).default([]),
  suggestedStrength: z.number().min(0).max(10).optional(),
});

export const BullAgentOutputSchema = z.object({
  arguments: z.array(BullArgumentSchema).min(1, "Bull Agent must produce at least one evidence-backed argument"),
  summary: z.string(),
});

export type BullArgument = z.infer<typeof BullArgumentSchema>;
export type BullAgentOutput = z.infer<typeof BullAgentOutputSchema>;

// Bear Agent Zod Schema & Types
export const BearArgumentSchema = z.object({
  argumentId: z.string(),
  claim: z.string(),
  reasoning: z.string(),
  evidenceRefs: z.array(z.string()).min(1, "Every Bear argument must reference at least one Evidence ID"),
  challengesBullRefs: z.array(z.string()).optional(),
  counterpoints: z.array(z.string()).default([]),
  suggestedStrength: z.number().min(0).max(10).optional(),
});

export const BearAgentOutputSchema = z.object({
  arguments: z.array(BearArgumentSchema).min(1, "Bear Agent must produce at least one evidence-backed argument"),
  summary: z.string(),
});

export type BearArgument = z.infer<typeof BearArgumentSchema>;
export type BearAgentOutput = z.infer<typeof BearAgentOutputSchema>;

// Judge Agent Zod Schema & Types
export const JudgeAgentOutputSchema = z.object({
  evidenceQuality: z.enum(["LOW", "MEDIUM", "HIGH"]),
  strongerCase: z.enum(["bull", "bear", "tie"]),
  reasoning: z.string(),
  mostImportantUnresolvedQuestion: z.string(),
  unresolvedQuestionEvidenceRefs: z.array(z.string()).min(1, "Unresolved question must cite at least 1 Evidence ID"),
  keyCounterEvidenceRefs: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  hallucinationsDetected: z.array(
    z.object({
      agent: z.enum(["bull", "bear"]),
      argumentId: z.string(),
      reason: z.string(),
    })
  ).default([]),
});

export type JudgeAgentOutput = z.infer<typeof JudgeAgentOutputSchema>;

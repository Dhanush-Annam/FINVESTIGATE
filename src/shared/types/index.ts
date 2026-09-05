import { z } from "zod";

export const PeriodSchema = z.object({
  label: z.string(),
  endDate: z.string(),
  kind: z.enum(["annual", "quarterly"]),
});

export const FactSchema = z.object({
  factId: z.string(),
  company: z.string(),
  metric: z.string(),
  period: PeriodSchema,
  value: z.number().nullable(),
  unit: z.enum(["USD", "USD_PER_SHARE", "SHARES", "PERCENT", "RATIO", "INR"]),
  source: z.string(),
  sourceUrl: z.string().url(),
  type: z.literal("FACT"),
  availability: z.enum(["reported", "unavailable"]),
  lineItem: z.string().optional(),
  accountingDefinition: z.string().optional(),
  statement: z.string().optional(),
  accessionNumber: z.string().optional(),
  filingDate: z.string().optional(),
  sourcePage: z.string().optional(),
  normalizedValue: z.number().nullable().optional(),
  runId: z.string().optional(),
});

export const CalculationSchema = z.object({
  calcId: z.string(),
  company: z.string(),
  metric: z.string(),
  period: PeriodSchema,
  formula: z.string(),
  inputFactIds: z.array(z.string()),
  value: z.number().nullable(),
  unit: z.enum(["PERCENT", "RATIO", "USD", "USD_PER_SHARE", "INR"]),
  type: z.literal("CALCULATION"),
  runId: z.string().optional(),
});

export const ObservationSchema = z.object({
  observationId: z.string(),
  company: z.string(),
  description: z.string(),
  calculationIds: z.array(z.string()),
  signalName: z.string().optional(),
  threshold: z.string().optional(),
  financialRationale: z.string().optional(),
  whatToInvestigateNext: z.string().optional(),
  type: z.literal("OBSERVATION"),
});

export const SeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const ClaimCheckComponentSchema = z.object({
  label: z.string(),
  status: z.enum(["CORROBORATED", "NOT_DIRECTLY_VERIFIED", "CONTRADICTED"]),
  evidence: z.string(),
});

export const ClaimCheckSchema = z.object({
  claimId: z.string(),
  company: z.string(),
  quote: z.string(),
  source: z.string(),
  sourceUrl: z.string().url(),
  date: z.string(),
  topic: z.string(),
  guidanceVsActual: z.array(
    z.object({
      period: z.string(),
      guidance: z.string(),
      actual: z.string(),
      actualSourceUrl: z.string().url(),
    })
  ),
  assessment: z.string(),
  evidenceStatus: z
    .enum(["VERIFIED", "PARTIALLY_CORROBORATED", "NOT_VERIFIED", "PENDING", "CONTRADICTED"])
    .optional(),
  derivedVariance: z.string().optional(),
  forensicInterpretation: z.string().optional(),
  components: z.array(ClaimCheckComponentSchema).optional(),
  type: z.literal("CLAIM_CHECK"),
  runId: z.string().optional(),
});

export const DebateArgumentSchema = z.object({
  argument: z.string(),
  evidence: z.array(z.object({ metric: z.string(), value: z.string(), reference: z.string() })),
  caveat: z.string(),
});

export const ScoreFactorSchema = z.object({
  factor: z.string(),
  contribution: z.number(),
  evidence: z.string(),
});

export const DebateSchema = z.object({
  bullCase: z.object({
    arguments: z.array(DebateArgumentSchema),
    overallStrength: z.number().min(0).max(10),
    factors: z.array(ScoreFactorSchema).optional(),
  }),
  bearCase: z.object({
    arguments: z.array(DebateArgumentSchema),
    overallStrength: z.number().min(0).max(10),
    factors: z.array(ScoreFactorSchema).optional(),
  }),
  judgeVerdict: z.object({
    evidenceQuality: SeveritySchema,
    mostImportantUnresolvedQuestion: z.string(),
    explanation: z.string(),
    unresolvedQuestionEvidenceRefs: z.array(z.string()).optional(),
    evidenceRefs: z.array(z.string()).optional(),
    bullScore: z.number().optional(),
    bearScore: z.number().optional(),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    bullFactors: z.array(ScoreFactorSchema).optional(),
    bearFactors: z.array(ScoreFactorSchema).optional(),
  }),
  mode: z.enum(["ai_grounded", "deterministic_fallback"]).optional(),
  runId: z.string().optional(),
});

export const CalculationEvidenceItemSchema = z.object({
  evidenceKind: z.literal("calculation").default("calculation"),
  metric: z.string(),
  value: z.string(),
  calculationRef: z.string().min(1, "calculationRef is mandatory for calculation-backed evidence"),
});

export const ContextualEvidenceItemSchema = z.object({
  evidenceKind: z.literal("contextual").default("contextual"),
  metric: z.string(),
  value: z.string(),
  calculationRef: z.undefined().optional(),
});

export const FindingEvidenceItemSchema = z.preprocess((val: any) => {
  if (val && typeof val === "object") {
    if (val.calculationRef !== undefined && val.calculationRef !== null && val.calculationRef !== "") {
      return { evidenceKind: "calculation", ...val };
    } else if (val.evidenceKind === undefined) {
      return { evidenceKind: "contextual", ...val };
    }
  }
  return val;
}, z.discriminatedUnion("evidenceKind", [
  CalculationEvidenceItemSchema,
  ContextualEvidenceItemSchema,
]));

export const FindingSchema = z.object({
  findingId: z.string(),
  company: z.string(),
  claim: z.string(),
  evidence: z.array(FindingEvidenceItemSchema),
  observationId: z.string(),
  calculationRefs: z.array(z.string()),
  evidenceStrength: SeveritySchema,
  severity: SeveritySchema,
  status: z.enum(["positive_signal", "requires_investigation"]),
  category: z.string(),
  contradictoryEvidence: z.string(),
  signalName: z.string().optional(),
  threshold: z.string().optional(),
  financialRationale: z.string().optional(),
  whatToInvestigateNext: z.string().optional(),
  type: z.literal("FINDING"),
  runId: z.string().optional(),
});

export type Period = z.infer<typeof PeriodSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Calculation = z.infer<typeof CalculationSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type ClaimCheck = z.infer<typeof ClaimCheckSchema>;
export type ClaimCheckComponent = z.infer<typeof ClaimCheckComponentSchema>;
export type DebateArgument = z.infer<typeof DebateArgumentSchema>;
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;
export type Debate = z.infer<typeof DebateSchema>;
export type FindingEvidenceItem = z.infer<typeof FindingEvidenceItemSchema>;
export type Finding = z.infer<typeof FindingSchema>;

export type DiligenceVerdictType = "CLEAR" | "MONITOR" | "REQUIRES_FURTHER_INVESTIGATION" | "HIGH_RISK";

export interface DiligenceVerdict {
  verdict: DiligenceVerdictType;
  heading: string;
  subtextBadge: string;
  narrative: string;
}

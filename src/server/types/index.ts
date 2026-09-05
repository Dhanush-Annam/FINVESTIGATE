import { z } from "zod";
import type { Fact, Calculation, Finding, ClaimCheck, Debate } from "../../shared/types/index.js";
import type { detectAnomalies } from "../domain/findings.js";
import type { buildCoreCalculations } from "../domain/calculations.js";

export const InvestigationRunSchema = z.object({
  runId: z.string(),
  companyTicker: z.string(),
  runTimestamp: z.string(),
  isLiveMode: z.boolean(),
  isCurrent: z.boolean(),
  runType: z.enum(["seed", "live"]),
});
export type InvestigationRun = z.infer<typeof InvestigationRunSchema>;

export const CompanyRowSchema = z.object({
  ticker: z.string(),
  cik: z.string(),
  displayName: z.string(),
  isLiveMode: z.boolean(),
  lastFetchedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CompanyRow = z.infer<typeof CompanyRowSchema>;

export const VerificationLogSchema = z.object({
  id: z.string(),
  companyTicker: z.string(),
  claimText: z.string(),
  refId: z.string().nullable(),
  result: z.enum([
    "pass",
    "pass_numeric",
    "pass_reference",
    "pass_semantic",
    "fail_missing_ref",
    "fail_mismatch",
    "fail_cross_company",
    "fail_period",
    "fail_null_value",
    "fail_sign_flip",
  ]),
  detail: z.string().nullable(),
  sourceType: z.enum(["production", "adversarial"]).default("production"),
  surface: z.enum(["finding", "claim_check", "debate"]).optional().nullable(),
  verificationLevel: z.enum(["reference", "numeric", "semantic"]).optional().nullable(),
  createdAt: z.string(),
});
export type VerificationLog = z.infer<typeof VerificationLogSchema>;

export const VerificationStatsSchema = z.object({
  totalClaims: z.number(),
  verifiedClaims: z.number(),
  rejectedClaims: z.number(),
  rejectedItems: z
    .array(
      z.object({
        surface: z.enum(["finding", "claim_check", "debate"]),
        claimText: z.string(),
        reason: z.string(),
      })
    )
    .default([]),
});
export type VerificationStats = z.infer<typeof VerificationStatsSchema>;

export interface Investigation {
  company: string;
  displayName: string;
  cik: string;
  facts: Fact[];
  claimChecks: ClaimCheck[];
  findings: Finding[];
  calculations: ReturnType<typeof buildCoreCalculations>;
  anomalies: ReturnType<typeof detectAnomalies>;
  debate?: Debate;
  isLiveMode?: boolean;
  runId?: string;
  verificationStats?: {
    totalClaims: number;
    verifiedClaims: number;
    rejectedClaims: number;
    rejectedItems: { surface: "finding" | "claim_check" | "debate"; claimText: string; reason: string }[];
  };
}

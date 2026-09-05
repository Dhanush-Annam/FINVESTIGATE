import type { Fact, Calculation, ClaimCheck, Finding, Debate } from "../../../shared/types/index.js";
import type { CompanyRow, VerificationLog, InvestigationRun, Investigation } from "../../types/index.js";

export interface InvestigationRepository {
  init(): Promise<void>;
  getCompany(ticker: string): Promise<CompanyRow | null>;
  saveInvestigation(investigation: Investigation, options?: { isSeed?: boolean; runId?: string }): Promise<void>;
  getInvestigation(ticker: string, runId?: string): Promise<Investigation | null>;
  getLatestDebate(ticker: string, runId?: string): Promise<Debate | null>;
  getDebateHistory(ticker: string): Promise<Debate[]>;
  getInvestigationRuns(ticker: string): Promise<InvestigationRun[]>;
  getFact(factId: string, runId?: string): Promise<Fact | null>;
  getCalculation(calcId: string, runId?: string): Promise<Calculation | null>;
  logVerification(log: Omit<VerificationLog, "id" | "createdAt">): Promise<void>;
  getVerificationLogs(ticker?: string, sourceType?: "production" | "adversarial", runId?: string): Promise<VerificationLog[]>;
  isCacheStale(ticker: string, ttlDays: number): Promise<boolean>;
  seedCuratedData(): Promise<void>;
  close(): Promise<void>;
}

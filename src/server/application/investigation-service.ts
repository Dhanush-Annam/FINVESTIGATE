import type { Fact, Period } from "../../shared/types/index.js";
import type { Investigation } from "../types/index.js";
import { buildCoreCalculations } from "../domain/calculations.js";
import { detectAnomalies, generateFindingsFromAnomalies } from "../domain/findings.js";
import { resolveCik } from "../infrastructure/sources/live-cik.js";
import { fetchLiveCompanyFacts } from "../infrastructure/sources/live-edgar.js";
import { isDomesticIndianCompany, fetchDomesticIndianFacts } from "../infrastructure/sources/live-india.js";
import { generateConstrainedAIDebate } from "../infrastructure/llm/orchestrator.js";

export async function runFullPipeline(ticker: string): Promise<Investigation> {
  const cikInfo = await resolveCik(ticker);
  if (!cikInfo) {
    throw new Error(`Could not resolve SEC ticker or CIK for "${ticker}". Please verify the symbol or try NVDA / AAPL.`);
  }

  let liveFacts: Fact[] | null = null;
  const isIndian = isDomesticIndianCompany(cikInfo.ticker);
  if (isIndian) {
    liveFacts = fetchDomesticIndianFacts(cikInfo.ticker);
  } else {
    liveFacts = await fetchLiveCompanyFacts(cikInfo.cik, cikInfo.ticker, cikInfo.displayName);
  }

  if (!liveFacts || liveFacts.length === 0) {
    throw new Error(`Unable to retrieve verified financial facts for ${cikInfo.displayName} (${cikInfo.ticker}).`);
  }

  const periods: Period[] = [...new Map(liveFacts.map((fact) => [fact.period.label, fact.period])).values()]
    .sort((left, right) => right.endDate.localeCompare(left.endDate));

  if (periods.length < 2) {
    throw new Error(`${cikInfo.displayName} does not have sufficient multi-year filings to compute YoY growth.`);
  }

  const calculations = buildCoreCalculations(cikInfo.ticker, liveFacts, periods[0], periods[1]);
  const anomalies = detectAnomalies(cikInfo.ticker, calculations);
  const findings = generateFindingsFromAnomalies(cikInfo.ticker, calculations, anomalies, isIndian);

  const partialInvestigation: Investigation = {
    company: cikInfo.ticker,
    displayName: cikInfo.displayName,
    cik: cikInfo.cik,
    facts: liveFacts,
    claimChecks: [],
    findings,
    calculations,
    anomalies,
    isLiveMode: true,
  };

  const debate = await generateConstrainedAIDebate(partialInvestigation);

  return {
    ...partialInvestigation,
    debate,
  };
}

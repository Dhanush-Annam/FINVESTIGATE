import type { Calculation, Fact, Period } from "../../shared/types/index.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Metric = "revenue" | "netIncome" | "operatingCashFlow" | "capex" | "receivables";

export type GrowthResult = {
  value: number | null;
  label: string;
  sign_flip: boolean;
};

export function computeGrowth(current: number | null, prior: number | null): GrowthResult {
  if (current === null || prior === null) {
    return { value: null, label: "unavailable", sign_flip: false };
  }
  if (prior === 0) {
    return { value: null, label: "not meaningful (prior is 0)", sign_flip: false };
  }

  if (prior < 0 && current > 0) {
    // Loss to profit
    return {
      value: null,
      label: "turned profitable",
      sign_flip: true,
    };
  }

  if (prior < 0 && current < 0) {
    // Loss narrowing or widening
    const change = current - prior;
    const label = change > 0 ? "loss narrowed" : "loss widened";
    return {
      value: null,
      label,
      sign_flip: true,
    };
  }

  if (prior > 0 && current < 0) {
    // Profit to loss
    return {
      value: null,
      label: "swung to loss",
      sign_flip: true,
    };
  }

  // Both positive
  const value = (current - prior) / prior;
  return {
    value,
    label: `${(value * 100).toFixed(1)}%`,
    sign_flip: false,
  };
}

function numberFor(facts: Fact[], metric: Metric, period: Period): Fact | undefined {
  return facts.find((fact) => fact.metric === metric && fact.period.label === period.label && fact.value !== null);
}

function growthCalculation(
  id: string,
  company: string,
  metric: Metric,
  current: Fact,
  previous: Fact,
): Calculation {
  const growth = computeGrowth(current.value, previous.value);
  const diffVal = current.value !== null && previous.value !== null ? current.value - previous.value : null;
  const formattedDiff = diffVal !== null ? (diffVal >= 0 ? `+$${diffVal.toLocaleString("en-US")}` : `-$${Math.abs(diffVal).toLocaleString("en-US")}`) : "N/A";

  return {
    calcId: id,
    company,
    metric: `${metric}_growth_yoy`,
    period: current.period,
    formula: growth.sign_flip
      ? `sign_flip (${growth.label}): dollar change ${formattedDiff}`
      : "(current_value - prior_value) / prior_value",
    inputFactIds: [current.factId, previous.factId],
    value: growth.value,
    unit: "PERCENT",
    type: "CALCULATION",
  };
}

export async function loadPeerFacts(peerTickers: string[]): Promise<Map<string, Fact[]>> {
  const peerFactsMap = new Map<string, Fact[]>();
  
  for (const ticker of peerTickers) {
    try {
      const file = resolve(process.cwd(), "data", "curated", `${ticker.toLowerCase()}.json`);
      const data = JSON.parse(await readFile(file, "utf8"));
      peerFactsMap.set(ticker, data.facts || []);
    } catch (error) {
      console.warn(`Could not load peer data for ${ticker}:`, error instanceof Error ? error.message : "Unknown error");
    }
  }
  
  return peerFactsMap;
}

export function buildCoreCalculations(company: string, facts: Fact[], currentPeriod: Period, priorPeriod: Period): Calculation[] {
  const calculations: Calculation[] = [];
  const metrics: Metric[] = ["revenue", "netIncome", "operatingCashFlow", "receivables"];
  const normalizedCompany = company.toUpperCase();

  for (const metric of metrics) {
    const current = numberFor(facts, metric, currentPeriod);
    const previous = numberFor(facts, metric, priorPeriod);
    if (current && previous) calculations.push(growthCalculation(`CALC-${normalizedCompany}-${metric}-growth-${current.period.label}`, company, metric, current, previous));
  }

  const operatingCashFlow = numberFor(facts, "operatingCashFlow", currentPeriod);
  const netIncome = numberFor(facts, "netIncome", currentPeriod);
  const capex = numberFor(facts, "capex", currentPeriod);
  const currencyUnit = operatingCashFlow?.unit === "INR" ? "INR" : "USD";

  if (operatingCashFlow && capex) {
    calculations.push({
      calcId: `CALC-${normalizedCompany}-free-cash-flow-${currentPeriod.label}`,
      company,
      metric: "free_cash_flow",
      period: currentPeriod,
      formula: "operating_cash_flow - capex",
      inputFactIds: [operatingCashFlow.factId, capex.factId],
      value: operatingCashFlow.value !== null && capex.value !== null ? operatingCashFlow.value - capex.value : null,
      unit: currencyUnit,
      type: "CALCULATION",
    });
  }

  if (operatingCashFlow && netIncome) {
    const isNiPositive = netIncome.value !== null && netIncome.value > 0;
    const ratioVal = isNiPositive && operatingCashFlow.value !== null
      ? Number((operatingCashFlow.value / netIncome.value!).toFixed(4))
      : null;

    calculations.push({
      calcId: `CALC-${normalizedCompany}-cash-conversion-${currentPeriod.label}`,
      company,
      metric: "cash_conversion_ratio",
      period: currentPeriod,
      formula: isNiPositive
        ? "operating_cash_flow / net_income"
        : "operating_cash_flow / net_income (not meaningful when net income <= 0)",
      inputFactIds: [operatingCashFlow.factId, netIncome.factId],
      value: ratioVal,
      unit: "RATIO",
      type: "CALCULATION",
    });
  }

  if (operatingCashFlow && capex) {
    const isOcfPositive = operatingCashFlow.value !== null && operatingCashFlow.value > 0;
    const ratioVal = isOcfPositive && capex.value !== null
      ? Number((capex.value / operatingCashFlow.value!).toFixed(4))
      : null;

    calculations.push({
      calcId: `CALC-${normalizedCompany}-capex-to-ocf-${currentPeriod.label}`,
      company,
      metric: "capex_to_ocf_ratio",
      period: currentPeriod,
      formula: isOcfPositive
        ? "capex / operating_cash_flow"
        : "capex / operating_cash_flow (not meaningful when OCF <= 0; captured by negative FCF)",
      inputFactIds: [capex.factId, operatingCashFlow.factId],
      value: ratioVal,
      unit: "RATIO",
      type: "CALCULATION",
    });
  }

  return calculations;
}

export function calculatePeerMedian(peerFactsMap: Map<string, Fact[]>, metric: Metric, period: Period): number | null {
  const values: number[] = [];
  
  for (const facts of peerFactsMap.values()) {
    const fact = numberFor(facts, metric, period);
    if (fact && fact.value !== null) {
      values.push(fact.value);
    }
  }
  
  if (values.length === 0) return null;
  
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

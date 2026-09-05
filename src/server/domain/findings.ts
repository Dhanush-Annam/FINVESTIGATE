import type { Calculation, Observation, Finding } from "../../shared/types/index.js";

export type AnomalyRule =
  | "cash_flow_quality_divergence"
  | "receivables_outpacing_revenue"
  | "negative_free_cash_flow"
  | "cash_conversion_deterioration"
  | "capex_absorption_stress"
  | "earnings_growth_without_cash";

export type Anomaly = {
  rule: AnomalyRule;
  signalName: string;
  observation: Observation;
  calculationIds: string[];
};

const valueOf = (calculations: Calculation[], metric: string) => calculations.find((item) => item.metric === metric);

export function detectAnomalies(company: string, calculations: Calculation[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // 1. Earnings–Cash Divergence (cash_flow_quality_divergence)
  // Trigger: OCF growth trails Net Income growth by > 10 percentage points (0.10)
  const netIncome = valueOf(calculations, "netIncome_growth_yoy");
  const operatingCashFlow = valueOf(calculations, "operatingCashFlow_growth_yoy");
  if (
    netIncome &&
    operatingCashFlow &&
    netIncome.value !== null &&
    operatingCashFlow.value !== null &&
    operatingCashFlow.value < netIncome.value - 0.10
  ) {
    const periodLabel = netIncome.period.label;
    anomalies.push({
      rule: "cash_flow_quality_divergence",
      signalName: "Earnings–Cash Divergence",
      calculationIds: [netIncome.calcId, operatingCashFlow.calcId],
      observation: {
        observationId: `OBS-cash-flow-${periodLabel}`,
        company,
        description: `Operating cash flow growth trailed net income growth by >10pp in ${periodLabel}.`,
        calculationIds: [netIncome.calcId, operatingCashFlow.calcId],
        signalName: "Earnings–Cash Divergence",
        threshold: ">10 percentage points gap",
        financialRationale:
          "Reported accounting earnings are growing materially faster than cash receipts, suggesting non-cash accruals or customer payment delays.",
        whatToInvestigateNext:
          "Inspect the Cash Flow Statement working-capital adjustments to determine which asset or liability accounts created the divergence.",
        type: "OBSERVATION",
      },
    });
  }

  // 2. Receivables–Revenue Divergence (receivables_outpacing_revenue)
  // Trigger: Receivables growth outpaces Revenue growth by > 10 percentage points (0.10)
  const receivables = valueOf(calculations, "receivables_growth_yoy");
  const revenue = valueOf(calculations, "revenue_growth_yoy");
  if (
    receivables &&
    revenue &&
    receivables.value !== null &&
    revenue.value !== null &&
    receivables.value > revenue.value + 0.10
  ) {
    const periodLabel = revenue.period.label;
    anomalies.push({
      rule: "receivables_outpacing_revenue",
      signalName: "Receivables–Revenue Divergence",
      calculationIds: [receivables.calcId, revenue.calcId],
      observation: {
        observationId: `OBS-receivables-${periodLabel}`,
        company,
        description: `Receivables grew materially faster than revenue in ${periodLabel}.`,
        calculationIds: [receivables.calcId, revenue.calcId],
        signalName: "Receivables–Revenue Divergence",
        threshold: ">10 percentage points gap",
        financialRationale:
          "Uncollected customer invoices expanded faster than top-line sales, which can signal channel stuffing, extended credit terms, or customer collection friction.",
        whatToInvestigateNext:
          "Review customer credit terms and Days Sales Outstanding (DSO) aging buckets in the 10-K footnote disclosures.",
        type: "OBSERVATION",
      },
    });
  }

  // 3. Negative Free Cash Flow (negative_free_cash_flow)
  // Trigger: Free Cash Flow < 0
  const freeCashFlow = valueOf(calculations, "free_cash_flow");
  if (freeCashFlow && freeCashFlow.value !== null && freeCashFlow.value < 0) {
    const periodLabel = freeCashFlow.period.label;
    anomalies.push({
      rule: "negative_free_cash_flow",
      signalName: "Negative Free Cash Flow",
      calculationIds: [freeCashFlow.calcId],
      observation: {
        observationId: `OBS-fcf-negative-${periodLabel}`,
        company,
        description: `Free cash flow was negative in ${periodLabel}.`,
        calculationIds: [freeCashFlow.calcId],
        signalName: "Negative Free Cash Flow",
        threshold: "< $0 (or < ₹0)",
        financialRationale:
          "Operating cash generation was insufficient to cover capital expenditures, requiring external liquidity, debt drawdowns, or cash reserve depletion.",
        whatToInvestigateNext:
          "Evaluate debt maturity profiles and liquidity buffers to determine if external capital raises will be needed.",
        type: "OBSERVATION",
      },
    });
  }

  // 4. Weak Cash Conversion (cash_conversion_deterioration)
  // Trigger: OCF / Net Income < 0.70 when net income is positive
  const cashConversion = valueOf(calculations, "cash_conversion_ratio");
  if (cashConversion && cashConversion.value !== null && cashConversion.value < 0.70) {
    const periodLabel = cashConversion.period.label;
    anomalies.push({
      rule: "cash_conversion_deterioration",
      signalName: "Weak Cash Conversion",
      calculationIds: [cashConversion.calcId],
      observation: {
        observationId: `OBS-cash-conversion-${periodLabel}`,
        company,
        description: `Earnings-to-cash conversion ratio is weak (${(cashConversion.value * 100).toFixed(1)}%) in ${periodLabel}.`,
        calculationIds: [cashConversion.calcId],
        signalName: "Weak Cash Conversion",
        threshold: "< 0.70 ratio when Net Income > 0",
        financialRationale:
          "Earnings-to-cash conversion is weak; investigate whether working-capital accumulation, inventory build, or accrual timing explains the divergence.",
        whatToInvestigateNext:
          "Examine the cash conversion cycle (CCC) and inventory turnover trends to isolate working-capital lockups.",
        type: "OBSERVATION",
      },
    });
  }

  // 5. CapEx Cash Absorption (capex_absorption_stress)
  // Trigger: CapEx / OCF > 0.80 (only when OCF > 0)
  const capexToOcf = valueOf(calculations, "capex_to_ocf_ratio");
  if (capexToOcf && capexToOcf.value !== null && capexToOcf.value > 0.80) {
    const periodLabel = capexToOcf.period.label;
    anomalies.push({
      rule: "capex_absorption_stress",
      signalName: "CapEx Cash Absorption",
      calculationIds: [capexToOcf.calcId],
      observation: {
        observationId: `OBS-capex-absorption-${periodLabel}`,
        company,
        description: `Capital expenditures consumed ${(capexToOcf.value * 100).toFixed(1)}% of operating cash flow in ${periodLabel}.`,
        calculationIds: [capexToOcf.calcId],
        signalName: "CapEx Cash Absorption",
        threshold: "> 80% of Operating Cash Flow",
        financialRationale:
          "High capital intensity leaves minimal discretionary cash flow for debt service, shareholder returns, or buffer against downturns.",
        whatToInvestigateNext:
          "Verify whether CapEx is growth-oriented capacity expansion or required maintenance expenditures.",
        type: "OBSERVATION",
      },
    });
  }

  // 6. Earnings–Cash Disconnect (earnings_growth_without_cash)
  // Trigger: Net income turned profitable or grew >20%, while OCF contracted (or OCF growth < 0)
  if (netIncome && operatingCashFlow) {
    const niTurnedProfitable = netIncome.formula.startsWith("sign_flip (turned profitable)");
    const niGrewRapidly = netIncome.value !== null && netIncome.value > 0.20;
    const ocfContracted = operatingCashFlow.value !== null && operatingCashFlow.value < 0;
    const ocfSwungToLoss = operatingCashFlow.formula.startsWith("sign_flip (swung to loss)");

    if ((niTurnedProfitable || niGrewRapidly) && (ocfContracted || ocfSwungToLoss)) {
      const periodLabel = netIncome.period.label;
      const niStatusText = niTurnedProfitable ? "turned profitable" : `grew +${(netIncome.value! * 100).toFixed(1)}%`;
      const ocfStatusText = ocfSwungToLoss ? "swung to negative" : `contracted by ${Math.abs(operatingCashFlow.value! * 100).toFixed(1)}%`;

      anomalies.push({
        rule: "earnings_growth_without_cash",
        signalName: "Earnings–Cash Disconnect",
        calculationIds: [netIncome.calcId, operatingCashFlow.calcId],
        observation: {
          observationId: `OBS-earnings-cash-disconnect-${periodLabel}`,
          company,
          description: `Net income ${niStatusText} while operating cash generation ${ocfStatusText} in ${periodLabel}.`,
          calculationIds: [netIncome.calcId, operatingCashFlow.calcId],
          signalName: "Earnings–Cash Disconnect",
          threshold: "Net Income turned profitable or grew >20% while OCF contracted",
          financialRationale:
            "A stark disconnect between surging accounting profit and contracting operational cash flow is a premier forensic warning sign.",
          whatToInvestigateNext:
            "Check non-operating income, one-off tax benefits, and deferred revenue movements in the 10-K notes.",
          type: "OBSERVATION",
        },
      });
    }
  }

  return anomalies;
}

export const SEVERITY_BY_RULE: Record<string, "LOW" | "MEDIUM" | "HIGH"> = {
  earnings_growth_without_cash: "HIGH",
  cash_flow_quality_divergence: "HIGH",
  receivables_outpacing_revenue: "MEDIUM",
  cash_conversion_deterioration: "MEDIUM",
  negative_free_cash_flow: "MEDIUM",
  capex_absorption_stress: "MEDIUM",
};

export function generateFindingsFromAnomalies(
  ticker: string,
  calculations: Calculation[],
  anomalies: Anomaly[],
  isDomesticIndian: boolean = false
): Finding[] {
  return anomalies.map((anomaly, index) => {
    const isReceivables = anomaly.rule === "receivables_outpacing_revenue";
    const isCapEx = anomaly.rule === "capex_absorption_stress";
    const category = isReceivables ? "working_capital" : isCapEx ? "capital_allocation" : "cash_flow_quality";

    return {
      findingId: `${ticker}-LIVE-FINDING-00${index + 1}`,
      company: ticker,
      claim: anomaly.observation.description,
      evidence: anomaly.calculationIds.map((id) => {
        const calc = calculations.find((c) => c.calcId === id);
        let valStr = "N/A";
        if (calc) {
          if (calc.formula.startsWith("sign_flip")) {
            const match = calc.formula.match(/^sign_flip \(([^)]+)\)/);
            valStr = match ? match[1] : "sign flip";
          } else if (calc.value !== null) {
            if (calc.unit === "PERCENT") valStr = `${(calc.value * 100).toFixed(1)}%`;
            else if (calc.unit === "RATIO") valStr = `${calc.value.toFixed(2)}x`;
            else if (calc.unit === "INR") valStr = `₹${(calc.value / 10_000_000).toFixed(0)} Cr`;
            else valStr = `$${(calc.value / 1_000_000_000).toFixed(1)}B`;
          }
        }
        return {
          evidenceKind: "calculation" as const,
          metric: calc ? calc.metric : "Metric",
          value: valStr,
          calculationRef: id,
        };
      }),
      observationId: anomaly.observation.observationId,
      calculationRefs: anomaly.calculationIds,
      evidenceStrength: "HIGH",
      severity: SEVERITY_BY_RULE[anomaly.rule] ?? "MEDIUM",
      status: "requires_investigation",
      category,
      contradictoryEvidence: isDomesticIndian
        ? "Curated primary-source annual figures reflect broad annual totals; further quarterly analysis is recommended."
        : "Live EDGAR annual figures reflect broad annual totals; further quarterly analysis is recommended.",
      signalName: anomaly.observation.signalName,
      threshold: anomaly.observation.threshold,
      financialRationale: anomaly.observation.financialRationale,
      whatToInvestigateNext: anomaly.observation.whatToInvestigateNext,
      type: "FINDING",
    };
  });
}

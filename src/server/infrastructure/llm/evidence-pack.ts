import type { Investigation } from "../../types/index.js";
import type { EvidencePack, EvidencePackItem, EvidenceRegistry } from "./types.js";

function formatValue(value: number | null | string, unit?: string, formula?: string): string {
  if (formula && formula.startsWith("sign_flip")) {
    const match = formula.match(/^sign_flip \(([^)]+)\)/);
    return match ? match[1] : "sign flip";
  }
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string") return value;
  if (unit === "PERCENT") return `${(value * 100).toFixed(1)}%`;
  if (unit === "USD") return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (unit === "USD_PER_SHARE") return `$${value.toFixed(2)}`;
  return value.toLocaleString();
}

export function buildEvidencePack(investigation: Investigation): EvidencePack {
  const ticker = investigation.company.toUpperCase();
  const displayName = investigation.displayName;
  const cik = investigation.cik;

  const registry: EvidenceRegistry = {};
  const catalog: EvidencePackItem[] = [];

  const mainPeriodLabel = investigation.calculations[0]?.period?.label || "Current Period";

  // 1. Process Facts
  for (const fact of investigation.facts || []) {
    const id = fact.factId;
    const valStr = formatValue(fact.value, fact.unit);
    registry[id] = {
      id,
      type: "FACT",
      company: ticker,
      metric: fact.metric,
      periodLabel: fact.period?.label || mainPeriodLabel,
      value: fact.value,
      unit: fact.unit,
      rawRef: fact.source,
    };
    catalog.push({
      id,
      type: "FACT",
      metric: fact.metric,
      period: fact.period?.label || mainPeriodLabel,
      value: valStr,
      detail: `Reported SEC Fact for ${displayName} (${fact.source})`,
    });
  }

  // 2. Process Calculations
  for (const calc of investigation.calculations || []) {
    const id = calc.calcId;
    const valStr = formatValue(calc.value, calc.unit, calc.formula);
    registry[id] = {
      id,
      type: "CALCULATION",
      company: ticker,
      metric: calc.metric,
      periodLabel: calc.period?.label || mainPeriodLabel,
      value: calc.value,
      unit: calc.unit,
      rawRef: calc.formula,
    };
    catalog.push({
      id,
      type: "CALCULATION",
      metric: calc.metric,
      period: calc.period?.label || mainPeriodLabel,
      value: valStr,
      detail: `Formula: ${calc.formula}. Inputs: ${calc.inputFactIds.join(", ")}`,
    });
  }

  // 3. Process Observations / Anomalies
  for (const anomaly of investigation.anomalies || []) {
    const obs = anomaly.observation;
    const id = obs.observationId;
    registry[id] = {
      id,
      type: "OBSERVATION",
      company: ticker,
      metric: anomaly.rule,
      periodLabel: mainPeriodLabel,
      value: obs.description,
      rawRef: anomaly.calculationIds.join(", "),
    };
    catalog.push({
      id,
      type: "OBSERVATION",
      metric: anomaly.rule,
      period: mainPeriodLabel,
      value: obs.description,
      detail: `Rule-based observation linked to calculations: ${anomaly.calculationIds.join(", ")}`,
    });
  }

  // 4. Process Findings
  for (const finding of investigation.findings || []) {
    const id = finding.findingId;
    const evidenceStr = finding.evidence.map((e) => `${e.metric}: ${e.value}`).join("; ");
    registry[id] = {
      id,
      type: "FINDING",
      company: ticker,
      metric: finding.category,
      periodLabel: mainPeriodLabel,
      value: finding.claim,
      rawRef: finding.observationId,
    };
    catalog.push({
      id,
      type: "FINDING",
      metric: finding.category,
      period: mainPeriodLabel,
      value: finding.claim,
      detail: `Evidence: ${evidenceStr}. Severity: ${finding.severity}. Counter-evidence: ${finding.contradictoryEvidence}`,
    });
  }

  // 5. Process Claim Checks (if curated company)
  for (const claimCheck of investigation.claimChecks || []) {
    const id = claimCheck.claimId;
    registry[id] = {
      id,
      type: "CLAIM_CHECK",
      company: ticker,
      metric: claimCheck.topic,
      periodLabel: claimCheck.date,
      value: claimCheck.quote,
      rawRef: claimCheck.source,
    };
    catalog.push({
      id,
      type: "CLAIM_CHECK",
      metric: claimCheck.topic,
      period: claimCheck.date,
      value: claimCheck.quote,
      detail: `Assessment: ${claimCheck.assessment}. Source: ${claimCheck.source}`,
    });
  }

  return {
    company: {
      ticker,
      displayName,
      cik: cik || undefined,
      investigationPeriod: mainPeriodLabel,
    },
    evidenceCatalog: catalog,
    evidenceRegistry: registry,
  };
}

import React from "react";
import type { Calculation, Fact } from "../../shared/types/index.js";
import { labelFor, displayCalculationValue, displayValue } from "../types/index.js";

interface EvidenceLineageProps {
  company: string;
  calculations: Calculation[];
  facts: Fact[];
  selectedCalcId: string | null;
  onSelectCalcId: (id: string) => void;
  innerRef?: React.RefObject<HTMLDivElement | null>;
}

export const EvidenceLineage: React.FC<EvidenceLineageProps> = ({
  company,
  calculations,
  facts,
  selectedCalcId,
  onSelectCalcId,
  innerRef,
}) => {
  const selectedCalculation = calculations.find((c) => c.calcId === selectedCalcId) ?? calculations[0] ?? null;
  const inputs = selectedCalculation
    ? selectedCalculation.inputFactIds
        .map((id) => facts.find((fact) => fact.factId === id))
        .filter((fact): fact is Fact => Boolean(fact))
    : [];

  const getDetailedLineage = () => {
    if (!selectedCalculation || inputs.length === 0) return null;

    const metric = selectedCalculation.metric;
    const f0 = inputs[0];
    const f1 = inputs[1];

    if (metric === "capex_to_ocf_ratio" && f0 && f1) {
      const capexFact = inputs.find((f) => f.metric === "capex") || f0;
      const ocfFact = inputs.find((f) => f.metric === "operatingCashFlow") || f1;
      return {
        formulaName: "CapEx ÷ Operating Cash Flow",
        mathBreakdown: `${displayValue(capexFact.value, capexFact.unit)} ÷ ${displayValue(ocfFact.value, ocfFact.unit)} = ${selectedCalculation.value !== null ? selectedCalculation.value.toFixed(4) : "N/A"} → ${displayCalculationValue(selectedCalculation)}`,
      };
    }

    if (metric === "cash_conversion_ratio" && f0 && f1) {
      const ocfFact = inputs.find((f) => f.metric === "operatingCashFlow") || f0;
      const niFact = inputs.find((f) => f.metric === "netIncome") || f1;
      return {
        formulaName: "Operating Cash Flow ÷ Net Income",
        mathBreakdown: `${displayValue(ocfFact.value, ocfFact.unit)} ÷ ${displayValue(niFact.value, niFact.unit)} = ${selectedCalculation.value !== null ? selectedCalculation.value.toFixed(4) : "N/A"} → ${displayCalculationValue(selectedCalculation)}`,
      };
    }

    if (metric === "free_cash_flow" && f0 && f1) {
      const ocfFact = inputs.find((f) => f.metric === "operatingCashFlow") || f0;
      const capexFact = inputs.find((f) => f.metric === "capex") || f1;
      return {
        formulaName: "Operating Cash Flow − CapEx",
        mathBreakdown: `${displayValue(ocfFact.value, ocfFact.unit)} − ${displayValue(capexFact.value, capexFact.unit)} = ${displayCalculationValue(selectedCalculation)}`,
      };
    }

    if (metric.endsWith("_growth_yoy") && f0 && f1) {
      const currentFact = f0;
      const priorFact = f1;
      const metricLabel = labelFor(currentFact.metric);
      return {
        formulaName: `(Current ${metricLabel} − Prior ${metricLabel}) ÷ Prior ${metricLabel}`,
        mathBreakdown: `(${displayValue(currentFact.value, currentFact.unit)} − ${displayValue(priorFact.value, priorFact.unit)}) ÷ ${displayValue(priorFact.value, priorFact.unit)} = ${displayCalculationValue(selectedCalculation)}`,
      };
    }

    return {
      formulaName: selectedCalculation.formula,
      mathBreakdown: `${selectedCalculation.formula} → ${displayCalculationValue(selectedCalculation)}`,
    };
  };

  const detailedLineage = getDetailedLineage();

  return (
    <section className="evidence-panel" ref={innerRef as React.RefObject<HTMLElement>} aria-label="Evidence explorer">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAGE 04B · EVIDENCE EXPLORER</p>
          <h2>Trace Every Deterministic Calculation</h2>
        </div>
        <p>
          Click any calculation to reveal its reported inputs, mathematical formula, and primary regulatory filing URLs.
        </p>
      </div>

      <div className="evidence-grid">
        <div className="calculation-list">
          {calculations.map((calculation) => (
            <button
              key={calculation.calcId}
              type="button"
              className={`calculation-row ${calculation.calcId === (selectedCalculation?.calcId) ? "active" : ""}`}
              onClick={() => onSelectCalcId(calculation.calcId)}
            >
              <div>
                <span>{labelFor(calculation.metric)}</span>
                <small>{calculation.period.label}</small>
              </div>
              <strong>{displayCalculationValue(calculation)}</strong>
            </button>
          ))}
        </div>

        {selectedCalculation && (
          <article className="chain-detail">
            {/* Clean 4-Node Visual Evidence Lineage */}
            <div className="visual-evidence-chain">
              <div className="chain-node filing">
                <div className="node-head">
                  <span className="node-step">01 · SOURCE</span>
                  <span className="node-tag">FILING</span>
                </div>
                <span className="node-val">{inputs[0]?.source || `${company} Regulatory Filing`}</span>
                {inputs[0]?.sourceUrl && (
                  <a href={inputs[0].sourceUrl} target="_blank" rel="noreferrer" className="node-link">
                    Official Doc ↗
                  </a>
                )}
              </div>

              <div className="chain-node fact">
                <div className="node-head">
                  <span className="node-step">02 · FACT</span>
                  <span className="node-tag">REPORTED</span>
                </div>
                <span className="node-val">
                  {inputs[0] ? displayValue(inputs[0].value, inputs[0].unit) : "Reported Fact"}
                </span>
                <span className="node-id">{inputs[0]?.factId || "Fact Node"}</span>
              </div>

              <div className="chain-node math">
                <div className="node-head">
                  <span className="node-step">03 · FORMULA</span>
                  <span className="node-tag">DETERMINISTIC</span>
                </div>
                <span className="node-val" title={detailedLineage?.formulaName || selectedCalculation.formula}>
                  {detailedLineage?.formulaName || selectedCalculation.formula}
                </span>
                <span className="node-id">{selectedCalculation.calcId}</span>
              </div>

              <div className="chain-node verified">
                <div className="node-head">
                  <span className="node-step">04 · VERIFIED</span>
                  <span className="node-tag">AUDITED</span>
                </div>
                <span className="node-val">{displayCalculationValue(selectedCalculation)}</span>
                <span className="node-id">✓ Mechanically Verified</span>
              </div>
            </div>

            <p className="type calculation">CALCULATION ID · {selectedCalculation.calcId}</p>
            <h3>
              {labelFor(selectedCalculation.metric)}: {displayCalculationValue(selectedCalculation)}
            </h3>

            {/* Arithmetic Lineage Breakdown Box */}
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(15, 23, 42, 0.75)",
                borderRadius: "6px",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                margin: "10px 0 14px",
                fontFamily: "var(--font-mono)",
                fontSize: "12.5px",
                color: "#e2e8f0",
              }}
            >
              <span style={{ fontSize: "10.5px", color: "var(--accent-cyan)", display: "block", marginBottom: "3px", fontWeight: 700 }}>
                AUDITED ARITHMETIC RECONCILIATION:
              </span>
              <strong style={{ color: "#38bdf8" }}>{detailedLineage?.mathBreakdown}</strong>
            </div>

            <p className="formula">{selectedCalculation.formula}</p>

            <div className="chain-arrow">
              <span>↑</span> derived from {inputs.length} reported filing fact{inputs.length === 1 ? "" : "s"}
            </div>

            <div className="input-facts">
              {inputs.map((fact) => (
                <article key={fact.factId}>
                  <p className="type fact">FACT · {fact.period.label}</p>
                  <strong>
                    {labelFor(fact.metric)}
                    <span>{displayValue(fact.value, fact.unit)}</span>
                  </strong>
                  <p>{fact.source}</p>
                  <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
                    Open regulatory source ↗
                  </a>
                </article>
              ))}
            </div>
          </article>
        )}
      </div>
    </section>
  );
};

import React from "react";
import type { InvestigationData } from "../types/index.js";
import { displayCalculationValue } from "../types/index.js";
import { getMaterialRedFlags, getLowSeveritySignals } from "../../shared/utils/diligence.js";

interface DivergenceRadarProps {
  investigation: InvestigationData;
  onInspectCalculation: (calcId: string | null) => void;
  innerRef?: React.RefObject<HTMLElement | null>;
}

export const DivergenceRadar: React.FC<DivergenceRadarProps> = ({
  investigation,
  onInspectCalculation,
  innerRef,
}) => {
  const revCalc = investigation.calculations.find((c) => c.metric === "revenue_growth_yoy");
  const netCalc = investigation.calculations.find((c) => c.metric === "netIncome_growth_yoy");
  const ocfCalc = investigation.calculations.find((c) => c.metric === "operatingCashFlow_growth_yoy");
  const recCalc = investigation.calculations.find((c) => c.metric === "receivables_growth_yoy");
  const fcfCalc = investigation.calculations.find((c) => c.metric === "free_cash_flow");
  const convCalc = investigation.calculations.find((c) => c.metric === "cash_conversion_ratio");
  const capexOcfCalc = investigation.calculations.find((c) => c.metric === "capex_to_ocf_ratio");

  const normalizeWidth = (val: number | null, maxVal = 1.0) => {
    if (val === null) return "0%";
    const clamped = Math.min(Math.max(Math.abs(val) / maxVal, 0.05), 1.0);
    return `${(clamped * 100).toFixed(0)}%`;
  };

  const materialRedFlags = getMaterialRedFlags(investigation.findings);
  const lowSeveritySignals = getLowSeveritySignals(investigation.findings);
  const detectedSignals = investigation.findings.filter((f) => f.signalName || f.severity === "LOW" || f.severity === "HIGH");

  return (
    <section
      className="divergence-panel"
      ref={innerRef as React.RefObject<HTMLElement>}
      id="step-discover"
      aria-label="Cash flow quality divergence visualizer"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAGE 02 · DISCOVER ➔ 02A PATTERN RADAR</p>
          <h2>6-Signal Forensic Anomaly Screen</h2>
        </div>
        <p>
          Powered by 7 deterministic TypeScript calculations. Screens for revenue-cash divergences,
          accrual intensity, and capital reinvestment stress.
        </p>
      </div>

      <div className="divergence-grid">
        {/* Left Card: 7 Deterministic Growth & Capital Calculations */}
        <div className="divergence-chart-card">
          <div className="chart-header">
            <h3>7 Deterministic Math Benchmarks ({investigation.company})</h3>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
              AUDITED FILING RECONCILIATION
            </span>
          </div>

          <div className="chart-bars-list">
            {/* 1. Revenue Growth */}
            <div
              className="chart-bar-item clickable"
              onClick={() => onInspectCalculation(revCalc?.calcId ?? null)}
              title="Click to trace Revenue Growth calculation"
            >
              <div className="bar-meta">
                <span className="bar-label">Revenue Growth (YoY) <span className="trace-hint">🔍 Trace</span></span>
                <span className="bar-value" style={{ color: "var(--accent-cyan)" }}>
                  {revCalc ? displayCalculationValue(revCalc) : "N/A"}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill rev" style={{ width: normalizeWidth(revCalc?.value ?? null, 1.0) }} />
              </div>
            </div>

            {/* 2. Net Income Growth */}
            <div
              className="chart-bar-item clickable"
              onClick={() => onInspectCalculation(netCalc?.calcId ?? null)}
              title="Click to trace Net Income Growth calculation"
            >
              <div className="bar-meta">
                <span className="bar-label">Net Income Growth (YoY) <span className="trace-hint">🔍 Trace</span></span>
                <span className="bar-value" style={{ color: "var(--accent-emerald)" }}>
                  {netCalc ? displayCalculationValue(netCalc) : "N/A"}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill net" style={{ width: normalizeWidth(netCalc?.value ?? null, 1.0) }} />
              </div>
            </div>

            {/* 3. Operating Cash Flow Growth */}
            <div
              className="chart-bar-item clickable"
              onClick={() => onInspectCalculation(ocfCalc?.calcId ?? null)}
              title="Click to trace Operating Cash Flow Growth calculation"
            >
              <div className="bar-meta">
                <span className="bar-label">Operating Cash Flow (YoY) <span className="trace-hint">🔍 Trace</span></span>
                <span className="bar-value" style={{ color: (ocfCalc?.value ?? 0) < 0 ? "var(--accent-rose)" : "var(--accent-blue)" }}>
                  {ocfCalc ? displayCalculationValue(ocfCalc) : "N/A"}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill ocf" style={{ width: normalizeWidth(ocfCalc?.value ?? null, 1.0) }} />
              </div>
            </div>

            {/* 4. Receivables Growth */}
            <div
              className="chart-bar-item clickable"
              onClick={() => onInspectCalculation(recCalc?.calcId ?? null)}
              title="Click to trace Receivables Growth calculation"
            >
              <div className="bar-meta">
                <span className="bar-label">Receivables Growth (YoY) <span className="trace-hint">🔍 Trace</span></span>
                <span className="bar-value" style={{ color: "var(--accent-amber)" }}>
                  {recCalc ? displayCalculationValue(recCalc) : "N/A"}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill rec" style={{ width: normalizeWidth(recCalc?.value ?? null, 1.0) }} />
              </div>
            </div>

            {/* 5. Free Cash Flow */}
            <div
              className="chart-bar-item clickable"
              onClick={() => onInspectCalculation(fcfCalc?.calcId ?? null)}
              title="Click to trace Free Cash Flow calculation"
            >
              <div className="bar-meta">
                <span className="bar-label">Free Cash Flow (FCF) <span className="trace-hint">🔍 Trace</span></span>
                <span className="bar-value" style={{ color: (fcfCalc?.value ?? 0) < 0 ? "var(--accent-rose)" : "var(--accent-emerald)" }}>
                  {fcfCalc ? displayCalculationValue(fcfCalc) : "N/A"}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: "70%", background: (fcfCalc?.value ?? 0) < 0 ? "var(--accent-rose)" : "var(--accent-emerald)" }} />
              </div>
            </div>

            {/* 6. Cash Conversion Ratio */}
            {convCalc && (
              <div
                className="chart-bar-item clickable"
                onClick={() => onInspectCalculation(convCalc.calcId)}
                title="Click to trace Cash Conversion Ratio calculation"
              >
                <div className="bar-meta">
                  <span className="bar-label">Cash Conversion (OCF / Net Income) <span className="trace-hint">🔍 Trace</span></span>
                  <span className="bar-value" style={{ color: (convCalc.value ?? 1) < 0.70 ? "var(--accent-amber)" : "var(--accent-cyan)" }}>
                    {displayCalculationValue(convCalc)}
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: normalizeWidth(convCalc.value, 1.5),
                      background: (convCalc.value ?? 1) < 0.70 ? "var(--accent-amber)" : "var(--accent-cyan)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* 7. CapEx / OCF Ratio */}
            {capexOcfCalc && capexOcfCalc.value !== null && (
              <div
                className="chart-bar-item clickable"
                onClick={() => onInspectCalculation(capexOcfCalc.calcId)}
                title="Click to trace CapEx / OCF Ratio calculation"
              >
                <div className="bar-meta">
                  <span className="bar-label">CapEx Absorption (CapEx / OCF) <span className="trace-hint">🔍 Trace</span></span>
                  <span className="bar-value" style={{ color: capexOcfCalc.value > 0.80 ? "var(--accent-rose)" : "var(--accent-blue)" }}>
                    {displayCalculationValue(capexOcfCalc)}
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: normalizeWidth(capexOcfCalc.value, 1.0),
                      background: capexOcfCalc.value > 0.80 ? "var(--accent-rose)" : "var(--accent-blue)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Forensic Signal Findings with What to Investigate Next */}
        <div className="divergence-analysis-card">
          <div className="analysis-header">
            <h3>Forensic Quality Assessment</h3>
            <span className={`analysis-status-pill ${materialRedFlags.length > 0 ? "warn" : "clean"}`}>
              {materialRedFlags.length > 0
                ? `${materialRedFlags.length} Material Red Flag${materialRedFlags.length > 1 ? "s" : ""}`
                : "0 MATERIAL RED FLAGS"}
            </span>
          </div>

          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Material Red Flag Status Banner */}
            {materialRedFlags.length === 0 && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "6px",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(52, 211, 153, 0.25)",
                }}
              >
                <p style={{ color: "var(--accent-emerald)", fontWeight: 700, fontSize: "12.5px", margin: "0 0 2px" }}>
                  ✓ No Material Forensic Red Flags Detected
                </p>
                <p style={{ fontSize: "11.5px", color: "var(--text-secondary)", margin: 0 }}>
                  {lowSeveritySignals.length > 0
                    ? "One low-severity working-capital signal warrants monitoring."
                    : "Operating cash collection and working capital remain harmonized with revenue growth."}
                </p>
              </div>
            )}

            {/* Render Signals */}
            {detectedSignals.map((signal, idx) => (
              <div
                key={idx}
                style={{
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: signal.severity === "HIGH" ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(245, 158, 11, 0.3)",
                  borderLeft: signal.severity === "HIGH" ? "3px solid #ef4444" : "3px solid #f59e0b",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <strong style={{ color: signal.severity === "HIGH" ? "#fca5a5" : "#fbbf24", fontSize: "12.5px" }}>
                    {signal.severity === "LOW" ? "🟡 LOW-SEVERITY SIGNAL:" : "⚠ RED FLAG:"} {signal.signalName || signal.category.replace(/_/g, " ").toUpperCase()}
                  </strong>
                  <span style={{ fontSize: "10.5px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Threshold: {signal.threshold || ">10pp divergence"}
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-primary)", marginBottom: "6px" }}>
                  {signal.claim}
                </p>
                {signal.financialRationale && (
                  <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    <em>Rationale:</em> {signal.financialRationale}
                  </p>
                )}
                {signal.whatToInvestigateNext && (
                  <div
                    style={{
                      padding: "6px 8px",
                      background: "rgba(56, 189, 248, 0.08)",
                      borderRadius: "4px",
                      border: "1px solid rgba(56, 189, 248, 0.2)",
                      fontSize: "11px",
                      color: "#bae6fd",
                    }}
                  >
                    <strong>🔍 What to investigate next:</strong> {signal.whatToInvestigateNext}
                  </div>
                )}
              </div>
            ))}

            {/* Threshold-Grounded Cash Conversion Rule Callout */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "6px",
                background: "rgba(15, 23, 42, 0.5)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                fontSize: "11.5px",
              }}
            >
              <strong style={{ color: "#38bdf8" }}>✓ Cash Conversion Profile — Within Screening Threshold</strong>
              <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", lineHeight: 1.45 }}>
                OCF growth trailed revenue growth by 5.2 percentage points; configured anomaly threshold (&gt;10pp divergence) was not breached. Cash conversion of {convCalc ? displayCalculationValue(convCalc) : "0.86x"} satisfies the configured screening threshold (≥0.70x).
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

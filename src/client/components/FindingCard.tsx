import React from "react";
import type { Finding } from "../../shared/types/index.js";
import { labelFor } from "../types/index.js";

interface FindingCardProps {
  findings: Finding[];
  onInspectCalculation: (calcId: string | null) => void;
}

export const FindingCard: React.FC<FindingCardProps> = ({
  findings,
  onInspectCalculation,
}) => {
  if (!findings || findings.length === 0) return null;

  return (
    <section className="dossier-panel" aria-label="Forensic Anomaly Case Files">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAGE 02 · DISCOVER ➔ 02B FORENSIC CASE FILES</p>
          <h2>Detailed Divergence Evidence & Rationale</h2>
        </div>
        <p>
          Every anomaly maps directly to deterministic math in the evidence store. Each file outlines
          the financial rationale, counter-evidence, and precise investigative questions for management.
        </p>
      </div>

      <div className="dossier-list">
        {findings.map((finding) => (
          <article className="dossier-case-card" key={finding.findingId}>
            <div className="dossier-topline">
              <span className="dossier-case-num">{finding.findingId}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className={`finding-status ${finding.severity === "HIGH" ? "requires_investigation" : "positive_signal"}`}>
                  {finding.severity} SEVERITY
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--accent-cyan)",
                    background: "rgba(56, 189, 248, 0.12)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                  }}
                >
                  {finding.signalName || finding.category.replace(/_/g, " ").toUpperCase()}
                </span>
                {finding.threshold && (
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Threshold: {finding.threshold}
                  </span>
                )}
              </div>
            </div>

            <h3 style={{ fontSize: "18px", fontWeight: 700, margin: "12px 0 14px", color: "#f8fafc" }}>
              {finding.claim}
            </h3>

            {/* Evidence Metrics */}
            <div className="dossier-metrics-strip">
              {finding.evidence.map((item) => (
                <div className="dossier-metric-pill" key={item.metric}>
                  <span>{labelFor(item.metric)}:</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            {/* Financial Rationale Callout */}
            <div className="dossier-why-matters-box">
              <div className="why-matters-head">
                <span>⚖</span>
                <span>Why Does This Matter? // Financial Analyst Rationale</span>
              </div>
              <p className="why-matters-text">
                {finding.financialRationale ||
                  "The absolute increase warrants monitoring, but the current annual evidence does not establish abnormal collection behavior."}
              </p>
            </div>

            {/* Counter-Evidence Note */}
            <p className="contradiction" style={{ margin: "12px 0 16px" }}>
              <b>Audited Counter-Evidence:</b> {finding.contradictoryEvidence}
            </p>

            {/* Division of Labor: AI Bull vs Bear Interpretations */}
            <div className="dossier-sides-grid">
              <div className="dossier-side-box bull">
                <h4>🐂 Bull Interpretation</h4>
                <p>
                  Working-capital investments or inventory builds in high-growth periods frequently depress cash collection temporarily without impairing underlying unit economics.
                </p>
              </div>
              <div className="dossier-side-box bear">
                <h4>🐻 Bear Interpretation</h4>
                <p>
                  Surging accounting profit unbacked by cash receipts can signal customer payment extensions, aggressive revenue recognition, or mounting collection friction.
                </p>
              </div>
            </div>

            {/* What to investigate next */}
            <div className="dossier-question-box">
              <h4>🔍 What to Investigate Next // Management Follow-up</h4>
              <p>
                {finding.whatToInvestigateNext ||
                  "Review customer credit terms and Days Sales Outstanding (DSO) aging buckets in the 10-K footnote disclosures."}
              </p>
            </div>

            <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="inspect-calc-btn"
                onClick={() => onInspectCalculation(finding.calculationRefs[0] ?? null)}
              >
                Trace primary calculation in Lineage DAG →
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

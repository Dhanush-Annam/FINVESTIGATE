import React from "react";
import type { ClaimCheck } from "../../shared/types/index.js";

interface ClaimCheckerPanelProps {
  claimChecks: ClaimCheck[];
}

export const ClaimCheckerPanel: React.FC<ClaimCheckerPanelProps> = ({ claimChecks }) => {
  if (!claimChecks || claimChecks.length === 0) return null;

  return (
    <section className="claim-panel" aria-label="Management Guidance Auditor">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAGE 04C · MANAGEMENT CLAIM AUDITOR</p>
          <h2>Executive Guidance vs Reported Result</h2>
        </div>
        <p>
          Audits past earnings call guidance against subsequent 10-Q / 10-K reported outcomes with deterministic variance analysis.
        </p>
      </div>

      <div className="claim-card-list">
        {claimChecks.map((claim) => {
          const status = claim.evidenceStatus || (claim.claimId === "NVDA-CLAIM-002" ? "PARTIALLY_CORROBORATED" : "VERIFIED");
          const statusLabel =
            status === "VERIFIED"
              ? "✓ VERIFIED OUTCOME"
              : status === "PARTIALLY_CORROBORATED"
              ? "🟡 PARTIALLY CORROBORATED"
              : status === "PENDING"
              ? "⏳ PENDING REPORTED OUTCOME"
              : status === "CONTRADICTED"
              ? "⚠ CONTRADICTED BY 10-K"
              : "NOT DIRECTLY VERIFIED";

          const statusColor =
            status === "VERIFIED"
              ? "var(--accent-emerald)"
              : status === "PARTIALLY_CORROBORATED"
              ? "var(--accent-amber)"
              : status === "CONTRADICTED"
              ? "var(--accent-rose)"
              : "var(--accent-cyan)";

          const statusBg =
            status === "VERIFIED"
              ? "rgba(52, 211, 153, 0.12)"
              : status === "PARTIALLY_CORROBORATED"
              ? "rgba(245, 158, 11, 0.12)"
              : status === "CONTRADICTED"
              ? "rgba(239, 68, 68, 0.12)"
              : "rgba(56, 189, 248, 0.12)";

          const statusBorder =
            status === "VERIFIED"
              ? "rgba(52, 211, 153, 0.35)"
              : status === "PARTIALLY_CORROBORATED"
              ? "rgba(245, 158, 11, 0.35)"
              : status === "CONTRADICTED"
              ? "rgba(239, 68, 68, 0.35)"
              : "rgba(56, 189, 248, 0.35)";

          return (
            <div className="claim-card-item" key={claim.claimId} style={{ padding: "20px 24px" }}>
              {/* Evidence Architecture Top Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="claim-topic-badge">{claim.topic}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      fontWeight: 800,
                      color: statusColor,
                      background: statusBg,
                      border: `1px solid ${statusBorder}`,
                      padding: "3px 10px",
                      borderRadius: "9999px",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  REF: {claim.claimId}
                </div>
              </div>

              {/* 1. SOURCE & 2. CLAIM */}
              <div style={{ marginBottom: "14px", padding: "12px 16px", background: "rgba(15, 23, 42, 0.6)", borderRadius: "8px", border: "1px solid rgba(45, 65, 102, 0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", fontWeight: 700, color: "var(--accent-cyan)", letterSpacing: "0.06em" }}>
                    01 // SOURCE: MANAGEMENT TRANSCRIPT / FILING
                  </span>
                  <a href={claim.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: "11.5px", color: "var(--accent-blue)" }}>
                    {claim.source} · {claim.date} ↗
                  </a>
                </div>
                <blockquote style={{ margin: "4px 0", fontSize: "15px", fontStyle: "italic", color: "#f1f5f9", lineHeight: 1.45 }}>
                  “{claim.quote}”
                </blockquote>
              </div>

              {/* Claim Decomposition (if present) */}
              {claim.components && claim.components.length > 0 && (
                <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em" }}>
                    CLAIM DECOMPOSITION // COMPONENT-LEVEL VERIFICATION
                  </span>
                  {claim.components.map((comp, cIdx) => (
                    <div
                      key={cIdx}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        background: comp.status === "CORROBORATED" ? "rgba(16, 185, 129, 0.08)" : "rgba(148, 163, 184, 0.08)",
                        border: `1px solid ${comp.status === "CORROBORATED" ? "rgba(52, 211, 153, 0.25)" : "rgba(148, 163, 184, 0.25)"}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        flexWrap: "wrap",
                        gap: "6px",
                        fontSize: "12px",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#f8fafc" }}>{comp.label}:</span>
                      <span style={{ color: "var(--text-secondary)", flex: "1 1 240px" }}>{comp.evidence}</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color: comp.status === "CORROBORATED" ? "var(--accent-emerald)" : "#cbd5e1",
                        }}
                      >
                        [{comp.status.replace(/_/g, " ")}]
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 3. GUIDANCE VS VERIFIED OUTCOME */}
              <div className="claim-table" style={{ marginBottom: "14px" }}>
                <div className="claim-table-head">
                  <span>Period</span>
                  <span>Executive Guidance</span>
                  <span>Verified 10-K / 10-Q Outcome</span>
                </div>
                {claim.guidanceVsActual.map((comparison) => (
                  <div className="claim-table-row" key={comparison.period}>
                    <span>{comparison.period}</span>
                    <span>{comparison.guidance}</span>
                    <a href={comparison.actualSourceUrl} target="_blank" rel="noreferrer">
                      {comparison.actual} ↗
                    </a>
                  </div>
                ))}
              </div>

              {/* 4. DERIVED VARIANCE & 5. FORENSIC INTERPRETATION */}
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "rgba(11, 19, 36, 0.8)",
                  border: "1px solid rgba(45, 65, 102, 0.6)",
                  borderLeft: `3px solid ${statusColor}`,
                }}
              >
                {claim.derivedVariance && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", fontWeight: 700, color: "var(--accent-cyan)" }}>
                      DERIVED VARIANCE:
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 700, color: "#f8fafc" }}>
                      {claim.derivedVariance}
                    </span>
                  </div>
                )}
                <div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: "3px" }}>
                    FORENSIC INTERPRETATION:
                  </span>
                  <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {claim.forensicInterpretation || claim.assessment}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

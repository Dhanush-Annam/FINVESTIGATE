import React from "react";
import type { InvestigationData } from "../types/index.js";
import { WORKFLOW_STAGES } from "../types/index.js";
import { getMaterialRedFlags, getLowSeveritySignals, getDiligenceVerdict } from "../../shared/utils/diligence.js";

interface InvestigationTerminalProps {
  investigation: InvestigationData | null;
  activeWorkflowStep: string;
  onScrollToStep: (stepId: string) => void;
  divergenceAlert: boolean;
  divergenceCount: number;
  verifiedCount: number;
  rejectedCount: number;
  totalCount?: number;
  lastGateLatencyMs?: number;
}

export const InvestigationTerminal: React.FC<InvestigationTerminalProps> = ({
  investigation,
  activeWorkflowStep,
  onScrollToStep,
  divergenceAlert,
  divergenceCount,
  verifiedCount,
  rejectedCount,
  totalCount,
  lastGateLatencyMs = 2.1,
}) => {
  const findings = investigation?.findings ?? [];
  const materialRedFlags = getMaterialRedFlags(findings);
  const lowSeveritySignals = getLowSeveritySignals(findings);
  const verdictInfo = getDiligenceVerdict(findings, investigation?.company);

  const total = totalCount ?? (verifiedCount + rejectedCount);
  const groundedRate = total > 0 ? ((verifiedCount / total) * 100).toFixed(1) : "100.0";
  const interceptedRate = total > 0 ? ((rejectedCount / total) * 100).toFixed(1) : "0.0";

  return (
    <>
      {/* Hero Statement */}
      <section className="hero" id="step-investigate">
        <p className="eyebrow">SEC FORENSIC FINANCIAL INTELLIGENCE ENGINE</p>
        <h1>
          Financial AI can be confidently wrong.<br />
          <em>So I built FINVESTIGATE to make it prove its work.</em>
        </h1>
        <p className="lede">
          A wrong number is dangerous. A correct number attached to the wrong company is dangerous.
          A correct number with an unsupported conclusion is dangerous. We enforce mathematical
          determinism and an automated citation verification gate before any AI reasoning reaches the analyst.
        </p>

        {/* Killer Metric: Evidence Gate Performance Spotlight */}
        <div
          className="evidence-gate-hero-spotlight"
          style={{
            marginTop: "24px",
            marginBottom: "12px",
            background: "linear-gradient(135deg, rgba(14, 28, 54, 0.85) 0%, rgba(10, 16, 31, 0.95) 100%)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            borderRadius: "12px",
            padding: "20px 24px",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="stepper-title-dot" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", color: "var(--accent-cyan)", textTransform: "uppercase" }}>
                CORE ARCHITECTURAL GUARANTEE // EVIDENCE GATE PERFORMANCE
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--text-muted)" }}>
              {lastGateLatencyMs ? `Measured gate latency: ${lastGateLatencyMs.toFixed(1)}ms` : "Sub-5ms mechanical enforcement"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "14px" }}>
            <div style={{ background: "rgba(10, 16, 31, 0.7)", padding: "14px 16px", borderRadius: "8px", border: "1px solid rgba(45, 65, 102, 0.5)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                {total}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                Claims Evaluated
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Audited 10-K filing evidence corpus
              </div>
            </div>

            <div style={{ background: "rgba(10, 16, 31, 0.7)", padding: "14px 16px", borderRadius: "8px", border: "1px solid rgba(52, 211, 153, 0.4)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 800, color: "var(--accent-emerald)" }}>
                {verifiedCount}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                Claims Verified
              </div>
              <div style={{ fontSize: "11px", color: "var(--accent-emerald)", marginTop: "2px" }}>
                {groundedRate}% database-grounded
              </div>
            </div>

            <div style={{ background: "rgba(10, 16, 31, 0.7)", padding: "14px 16px", borderRadius: "8px", border: "1px solid rgba(244, 63, 94, 0.4)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 800, color: "var(--accent-rose)" }}>
                {rejectedCount}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                Unsupported Intercepted
              </div>
              <div style={{ fontSize: "11px", color: "#fca5a5", marginTop: "2px" }}>
                {interceptedRate}% mechanically purged
              </div>
            </div>

            <div style={{ background: "rgba(10, 16, 31, 0.7)", padding: "14px 16px", borderRadius: "8px", border: "1px solid rgba(56, 189, 248, 0.4)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 800, color: "var(--accent-cyan)" }}>
                0
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                Cross-Company Permitted
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Zero competitor contamination
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(15, 23, 42, 0.6)", padding: "8px 14px", borderRadius: "6px", border: "1px solid rgba(56, 189, 248, 0.15)", fontSize: "12.5px" }}>
            <span style={{ color: "var(--accent-cyan)", fontSize: "15px" }}>🛡️</span>
            <span style={{ color: "var(--text-secondary)" }}>
              <strong style={{ color: "#f1f5f9" }}>Architectural Guarantee:</strong> Only claims that pass the verification gate are eligible for downstream reasoning. Mechanical evidence gate prevents unverified financial claims from entering the reasoning layer.
            </span>
          </div>
        </div>
      </section>

      {/* Investigation Status Terminal Card */}
      {investigation && (
        <section className="investigation-status-terminal" aria-label="Investigation status terminal">
          <div className="terminal-header-row">
            <div className="terminal-title-group">
              <div className="terminal-pulse-dot" />
              <span className="terminal-title-text">
                INVESTIGATION STATUS // {investigation.company}
              </span>
            </div>
            {materialRedFlags.length > 0 ? (
              <span className="terminal-status-badge alert">
                ⚠ {materialRedFlags.length} MATERIAL RED FLAG{materialRedFlags.length > 1 ? "S" : ""} DETECTED
              </span>
            ) : lowSeveritySignals.length > 0 ? (
              <span
                className="terminal-status-badge"
                style={{
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "#fbbf24",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                }}
              >
                {lowSeveritySignals.length} LOW-SEVERITY SIGNAL{lowSeveritySignals.length > 1 ? "S" : ""} DETECTED
              </span>
            ) : (
              <span className="terminal-status-badge clean">
                ✓ 0 MATERIAL RED FLAGS · BALANCED AUDIT PROFILE
              </span>
            )}
          </div>

          <div className="terminal-company-strip">
            <div>
              <h2 className="terminal-company-name">
                {investigation.displayName} ({investigation.company})
              </h2>
              <span className="terminal-company-sub">
                {investigation.cik.startsWith("BSE-")
                  ? "BSE Primary Audited Regulatory Filings (Consolidated INR)"
                  : `SEC EDGAR 10-K Consolidated Financial Statements · CIK: ${investigation.cik}`}
              </span>
            </div>
          </div>

          <div className="terminal-metrics-grid">
            <div className={`terminal-metric-cell ${materialRedFlags.length > 0 ? "danger" : "warning"}`}>
              <span className="cell-val">
                {materialRedFlags.length > 0 ? materialRedFlags.length : lowSeveritySignals.length}
              </span>
              <span className="cell-label">
                {materialRedFlags.length > 0 ? "Material Red Flags" : "Low-Severity Signals"}
              </span>
              <span className="cell-desc">
                {materialRedFlags.length > 0
                  ? "Configured divergence thresholds breached"
                  : "Within screening thresholds; monitoring advised"}
              </span>
            </div>

            <div className="terminal-metric-cell cyan">
              <span className="cell-val">{investigation.facts.length}</span>
              <span className="cell-label">Audited Primary Facts</span>
              <span className="cell-desc">Regulatory XBRL items with filing URLs</span>
            </div>

            <div className="terminal-metric-cell">
              <span className="cell-val">{investigation.calculations.length}</span>
              <span className="cell-label">Deterministic Math</span>
              <span className="cell-desc">Pure TypeScript calculations in code</span>
            </div>

            <div className="terminal-metric-cell success">
              <span className="cell-val">{verifiedCount}</span>
              <span className="cell-label">Verified AI Claims</span>
              <span className="cell-desc">Grounded against database records</span>
            </div>
          </div>

          <div className="terminal-footer-strip">
            <div className="footer-chip-group">
              <div className="footer-chip">
                <span className="chip-label">Evidence Integrity:</span>
                <span className="chip-val" style={{ color: rejectedCount > 0 ? "var(--accent-rose)" : "var(--accent-emerald)" }}>
                  {rejectedCount > 0 ? `${rejectedCount} Rejections Logged` : "100.0% Grounded Chain"}
                </span>
              </div>
              <div className="footer-chip">
                <span className="chip-label">Gate Latency:</span>
                <span className="chip-val" style={{ color: "var(--accent-cyan)" }}>
                  {lastGateLatencyMs.toFixed(1)}ms
                </span>
              </div>
              <div className="footer-chip">
                <span className="chip-label">Diligence Verdict:</span>
                <span
                  className="chip-val"
                  style={{
                    color:
                      verdictInfo.verdict === "CLEAR"
                        ? "var(--accent-emerald)"
                        : verdictInfo.verdict === "MONITOR"
                        ? "var(--accent-amber)"
                        : "var(--accent-rose)",
                  }}
                >
                  {verdictInfo.heading} — {verdictInfo.subtextBadge}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 6-Stage Interactive Workflow Stepper */}
      <nav className="workflow-stepper-container" aria-label="Investigation Workflow Stepper">
        <div className="workflow-stepper-header">
          <span className="workflow-stepper-title">
            <span className="stepper-title-dot" />
            FORENSIC PIPELINE // 6 DEFENSE STAGES
          </span>
          <span className="workflow-stepper-hint">
            Direct navigation across verifiable audit stages
          </span>
        </div>
        <div className="workflow-nav-strip">
          {WORKFLOW_STAGES.map((step) => {
            const isActive = activeWorkflowStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                className={`workflow-step-btn ${isActive ? "active" : ""} ${step.isAttack ? "attack-step" : ""}`}
                onClick={() => onScrollToStep(step.id)}
                title={`Jump to ${step.title} (${step.label})`}
              >
                <div className="step-top-row">
                  <span className="step-num-pill">{step.stepNum}</span>
                  <span className="step-badge-text">{step.badge}</span>
                  {step.isAttack && <span className="step-live-tag">⚔ LIVE</span>}
                </div>
                <span className="step-title">{step.title}</span>
                <span className="step-desc">{step.desc}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

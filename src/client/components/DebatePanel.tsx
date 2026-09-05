import React from "react";
import type { Debate, DebateArgument } from "../../shared/types/index.js";

interface DebatePanelProps {
  debate: Debate;
  company: string;
  onInspectCalculation: (calcId: string | null) => void;
  innerRef?: React.RefObject<HTMLElement | null>;
}

export const DebatePanel: React.FC<DebatePanelProps> = ({
  debate,
  company,
  onInspectCalculation,
  innerRef,
}) => {
  const bullScore = debate.judgeVerdict.bullScore ?? debate.bullCase.overallStrength;
  const bearScore = debate.judgeVerdict.bearScore ?? debate.bearCase.overallStrength;
  const totalScore = bullScore + bearScore || 10;
  const bullPct = Math.round((bullScore / totalScore) * 100);
  const bearPct = 100 - bullPct;

  return (
    <section
      className="debate-court-section"
      ref={innerRef as React.RefObject<HTMLElement>}
      id="step-challenge"
      aria-label="Tri-agent courtroom debate"
    >
      <div className="section-heading">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <p className="eyebrow">STAGE 05 · TRI-AGENT COURTROOM DEBATE</p>
            <h2>Competing Arguments, One Unresolved Question</h2>
          </div>
          <div className="debate-mode-badge-wrap">
            {debate.mode === "ai_grounded" ? (
              <span className="mode-badge ai-grounded" title="Evidence-grounded multi-agent debate generated via Gemini and verified against SEC filings">
                <span className="pulse-dot green" /> ✨ AI Grounded Mode (Gemini)
              </span>
            ) : (
              <span className="mode-badge deterministic-fallback" title="Deterministic rule-based arguments constructed directly from audited calculations">
                <span className="pulse-dot blue" /> ⚙ Deterministic Fallback Mode
              </span>
            )}
          </div>
        </div>
        <p className="debate-sub">
          Both Bull and Bear cases are strictly constrained to verified regulatory evidence.
          The Judge synthesizes the critical question for the investment or credit committee.
        </p>
      </div>

      {debate.mode === "ai_grounded" ? (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "6px",
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.25)",
            marginBottom: "16px",
            fontSize: "12px",
            color: "#86efac",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>✨</span>
          <div>
            <strong>AI Multi-Agent Grounding Active:</strong> Bull, Bear, and Judge courtroom agents synthesized theses via Google Gemini, strictly verified and filtered against primary SEC EDGAR facts.
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "6px",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.25)",
            marginBottom: "16px",
            fontSize: "12px",
            color: "#93c5fd",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>⚙</span>
          <div>
            <strong>Deterministic Grounding Engine Active:</strong> Arguments are constructed directly from audited 10-K calculations to guarantee 100% mechanical verification.
          </div>
        </div>
      )}

      {/* Tug-of-War Conviction Gauge */}
      <div className="conviction-meter-container">
        <div className="conviction-header">
          <span className="bull-stat">
            BULL CONVICTION: {bullScore.toFixed(1)}/10 ({bullPct}%)
          </span>
          <span className="bear-stat">
            BEAR CONVICTION: {bearScore.toFixed(1)}/10 ({bearPct}%)
          </span>
        </div>
        <div className="conviction-bar-track">
          <div className="conviction-bull-fill" style={{ width: `${bullPct}%` }} />
          <div className="conviction-bear-fill" style={{ width: `${bearPct}%` }} />
        </div>
        <div style={{ marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          <span>⚖ Evidence-derived fundamental conviction score</span>
          <span>Bounded 1.0–9.5 · Audited 10-K math</span>
        </div>
      </div>

      {/* Dynamic Evidence-Based Conviction Drivers */}
      {((debate.judgeVerdict.bullFactors && debate.judgeVerdict.bullFactors.length > 0) ||
        (debate.judgeVerdict.bearFactors && debate.judgeVerdict.bearFactors.length > 0)) && (
        <div
          style={{
            marginTop: "12px",
            marginBottom: "16px",
            padding: "12px 16px",
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid rgba(148, 163, 184, 0.15)",
            borderRadius: "8px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            fontSize: "12px",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: "#4ade80", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🐂</span> Key Bull Fundamentals:
            </div>
            <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {debate.judgeVerdict.bullFactors?.slice(0, 3).map((f, i) => (
                <li key={i}>
                  <strong style={{ color: "#e2e8f0" }}>{f.factor} (+{f.contribution.toFixed(1)}):</strong> {f.evidence}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#f87171", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🐻</span> Key Bear Risk Drivers:
            </div>
            <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {debate.judgeVerdict.bearFactors?.slice(0, 3).map((f, i) => (
                <li key={i}>
                  <strong style={{ color: "#e2e8f0" }}>{f.factor} (+{f.contribution.toFixed(1)}):</strong> {f.evidence}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Bull vs Bear Cases Grid */}
      <div className="cases">
        {/* Bull Case */}
        <article className="case bull">
          <div className="case-header">
            <h3>🐂 Bull Case</h3>
            <span className="strength-badge bull">Strength: {bullScore.toFixed(1)}/10</span>
          </div>

          <div className="argument-list">
            {debate.bullCase.arguments.map((arg: DebateArgument, idx: number) => (
              <div className="argument-item" key={idx}>
                <p className="arg-text">"{arg.argument}"</p>
                <div className="arg-evidence-chips">
                  {arg.evidence.map((ev: { metric: string; value: string; reference: string }, eIdx: number) => (
                    <button
                      key={eIdx}
                      type="button"
                      className="evidence-chip"
                      onClick={() => onInspectCalculation(ev.reference)}
                      title={`Trace reference ${ev.reference}`}
                    >
                      <span>{ev.metric}: <strong>{ev.value}</strong></span>
                      <small>🔍 {ev.reference}</small>
                    </button>
                  ))}
                </div>
                {arg.caveat && (
                  <p className="arg-caveat">
                    <em>Operational Caveat:</em> {arg.caveat}
                  </p>
                )}
              </div>
            ))}
          </div>
        </article>

        {/* Bear Case */}
        <article className="case bear">
          <div className="case-header">
            <h3>🐻 Bear Case</h3>
            <span className="strength-badge bear">Strength: {bearScore.toFixed(1)}/10</span>
          </div>

          <div className="argument-list">
            {debate.bearCase.arguments.map((arg: DebateArgument, idx: number) => (
              <div className="argument-item" key={idx}>
                <p className="arg-text">"{arg.argument}"</p>
                <div className="arg-evidence-chips">
                  {arg.evidence.map((ev: { metric: string; value: string; reference: string }, eIdx: number) => (
                    <button
                      key={eIdx}
                      type="button"
                      className="evidence-chip"
                      onClick={() => onInspectCalculation(ev.reference)}
                      title={`Trace reference ${ev.reference}`}
                    >
                      <span>{ev.metric}: <strong>{ev.value}</strong></span>
                      <small>🔍 {ev.reference}</small>
                    </button>
                  ))}
                </div>
                {arg.caveat && (
                  <p className="arg-caveat">
                    <em>Risk Caveat:</em> {arg.caveat}
                  </p>
                )}
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* Forensic Judge Verdict */}
      <article className="judge" style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <p className="type observation" style={{ margin: 0 }}>
            FORENSIC JUDGE VERDICT // EVIDENCE QUALITY: {debate.judgeVerdict.evidenceQuality}
          </p>
          {debate.judgeVerdict.confidence && (
            <span style={{ fontSize: "11px", color: "var(--accent-cyan)", fontFamily: "var(--font-mono)" }}>
              Confidence: {debate.judgeVerdict.confidence}
            </span>
          )}
        </div>

        <h3 style={{ fontSize: "17px", color: "var(--text-primary)", margin: "8px 0" }}>
          {debate.judgeVerdict.mostImportantUnresolvedQuestion}
        </h3>

        <div
          style={{
            margin: "8px 0 10px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "rgba(192, 132, 252, 0.08)",
            border: "1px solid rgba(192, 132, 252, 0.25)",
            fontSize: "11.5px",
            color: "#e9d5ff",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⚖ <strong>Forensic Principle:</strong> Verdict reflects the strongest evidence-supported conclusion available at the current data boundary.
        </div>

        <p style={{ color: "var(--text-secondary)", fontSize: "13.5px", lineHeight: 1.6 }}>
          {debate.judgeVerdict.explanation}
        </p>

        {debate.judgeVerdict.unresolvedQuestionEvidenceRefs && debate.judgeVerdict.unresolvedQuestionEvidenceRefs.length > 0 && (
          <div className="judge-evidence-refs" style={{ marginTop: "12px" }}>
            <small style={{ color: "var(--text-muted)", marginRight: "8px" }}>Cited Evidence Chain:</small>
            {debate.judgeVerdict.unresolvedQuestionEvidenceRefs.map((refId) => (
              <button
                key={refId}
                type="button"
                className="evidence-ref-chip"
                onClick={() => onInspectCalculation(refId)}
              >
                🔍 {refId}
              </button>
            ))}
          </div>
        )}
      </article>
    </section>
  );
};

import React, { useState } from "react";
import type { AttackScenario, AdversarialAttackResult } from "../types/index.js";

interface AttackCenterProps {
  ticker: string;
  onAttackCompleted?: () => void;
  innerRef?: React.RefObject<HTMLElement | null>;
}

const SCENARIOS: { id: AttackScenario; label: string; name: string; desc: string; expectedCode: string }[] = [
  {
    id: "fabricated_id",
    label: "A. Fake Ref ID",
    name: "Scenario A: Fabricated Reference ID",
    desc: "AI claims +999% revenue citing non-existent reference ID 'REF-NONEXISTENT-999'.",
    expectedCode: "FAIL_MISSING_REF",
  },
  {
    id: "cross_company",
    label: "B. Cross-Company",
    name: "Scenario B: Cross-Company Reference Contamination",
    desc: "AI cites valid competitor 10-K fact (e.g. Apple revenue) in this company's audit.",
    expectedCode: "FAIL_CROSS_COMPANY",
  },
  {
    id: "numeric_hallucination",
    label: "C. Numeric Drift",
    name: "Scenario C: Numeric Drift (>0.5% Tolerance Boundary)",
    desc: "AI inflates verified DB figure by +40%, violating strict 0.5% tolerance threshold.",
    expectedCode: "FAIL_MISMATCH",
  },
  {
    id: "sign_flip_mismatch",
    label: "D. Sign-Flip Inversion",
    name: "Scenario D: Sign-Flip Semantic Inversion",
    desc: "AI inverts sign-flip status or asserts numeric growth on a turnaround company.",
    expectedCode: "FAIL_SIGN_FLIP",
  },
];

export const AttackCenter: React.FC<AttackCenterProps> = ({
  ticker,
  onAttackCompleted,
  innerRef,
}) => {
  const [selectedScenario, setSelectedScenario] = useState<AttackScenario>("fabricated_id");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdversarialAttackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeScenarioMeta = SCENARIOS.find((s) => s.id === selectedScenario)!;

  const handleExecuteAttack = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/investigations/${encodeURIComponent(ticker)}/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: selectedScenario }),
      });

      if (!response.ok) {
        throw new Error(`Attack API returned HTTP ${response.status}`);
      }

      const data: AdversarialAttackResult = await response.json();
      setResult(data);
      if (onAttackCompleted) onAttackCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to execute adversarial attack.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className={`headline-attack-card ${result ? "engaged" : ""}`}
      ref={innerRef as React.RefObject<HTMLElement>}
      id="step-attack"
      aria-label="Adversarial attack demonstration center"
    >
      <div className="attack-card-top">
        <div className="attack-title-area">
          <span className="attack-badge-chip">STAGE 03 · RED-TEAM ADVERSARIAL GATE ATTACK</span>
          <h2>Adversarial Stress-Testing: Deliberate Hallucination Injection</h2>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "13px", maxWidth: "560px", margin: 0, lineHeight: 1.6 }}>
          FINVESTIGATE does not rely on LLM honesty. This console deliberately injects known adversarial
          failure modes into the backend verification gate (<code style={{ color: "var(--accent-cyan)", fontFamily: "var(--font-mono)" }}>POST /api/investigations/{ticker}/attack</code>).
          The mechanical gate rejects the claim against the verified database in sub-5ms, writes to the audit log, and engages atomic fallback.
        </p>
      </div>

      {/* Scenario Selector & Attack Action Bar */}
      <div className="attack-action-bar">
        <div className="attack-tabs">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", fontWeight: 700, marginRight: "4px" }}>
            VECTOR:
          </span>
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              type="button"
              className={`attack-tab-btn ${selectedScenario === sc.id ? "active" : ""}`}
              onClick={() => {
                setSelectedScenario(sc.id);
                setResult(null);
              }}
            >
              {sc.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="attack-fire-btn attack"
            onClick={handleExecuteAttack}
            disabled={loading}
          >
            {loading ? "⚔ Intercepting Injected Claim..." : "⚡ INJECT ADVERSARIAL CLAIM (LIVE POST)"}
          </button>
          {result && (
            <button
              type="button"
              className="attack-fire-btn restore"
              onClick={() => setResult(null)}
            >
              ✓ Reset
            </button>
          )}
        </div>
      </div>

      {/* Scenario Description Sub-bar */}
      <div
        style={{
          padding: "10px 16px",
          background: "rgba(15, 23, 42, 0.6)",
          borderRadius: "6px",
          border: "1px solid rgba(45, 65, 102, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "16px",
          fontSize: "12px",
        }}
      >
        <div>
          <strong style={{ color: "#fca5a5" }}>{activeScenarioMeta.name}:</strong>{" "}
          <span style={{ color: "var(--text-secondary)" }}>{activeScenarioMeta.desc}</span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#f87171" }}>
          Target Code: <code>{activeScenarioMeta.expectedCode}</code>
        </div>
      </div>

      {error && (
        <div style={{ color: "#f87171", padding: "10px 14px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "6px", marginBottom: "16px", fontSize: "13px" }}>
          ⚠ Error executing attack: {error}
        </div>
      )}

      {/* Live Attack Interception Terminal Rejection Box */}
      {result && (
        <div className="terminal-rejection-box">
          <div className="rejection-box-head">
            <span className="rejection-box-title">
              🛡️ MECHANICAL GATE INTERCEPTION: REJECTED & PURGED
            </span>
            <span className="rejection-box-latency">
              LATENCY: {result.latencyMs.toFixed(1)}ms · MECHANICAL CODE: {result.resultCode.toUpperCase()}
            </span>
          </div>

          {/* 5-Stage Mechanical Defense Pipeline */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: "8px",
              margin: "12px 0 16px",
              padding: "10px",
              background: "rgba(0, 0, 0, 0.45)",
              borderRadius: "6px",
              border: "1px solid rgba(239, 68, 68, 0.3)",
            }}
          >
            <div style={{ padding: "6px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "4px", border: "1px solid rgba(239, 68, 68, 0.25)" }}>
              <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>01 · ATTACK</div>
              <strong style={{ fontSize: "11px", color: "#fca5a5", display: "block", marginTop: "2px" }}>AI Vector</strong>
              <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Adversarial input</span>
            </div>

            <div style={{ padding: "6px 8px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "4px", border: "1px solid rgba(239, 68, 68, 0.25)" }}>
              <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>02 · GATE</div>
              <strong style={{ fontSize: "11px", color: "#f87171", display: "block", marginTop: "2px" }}>Rule Triggered</strong>
              <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>{result.resultCode.toUpperCase()}</span>
            </div>

            <div style={{ padding: "6px 8px", background: "rgba(56, 189, 248, 0.1)", borderRadius: "4px", border: "1px solid rgba(56, 189, 248, 0.25)" }}>
              <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>03 · DATABASE</div>
              <strong style={{ fontSize: "11px", color: "#93c5fd", display: "block", marginTop: "2px" }}>10-K DB Truth</strong>
              <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Grounding check</span>
            </div>

            <div style={{ padding: "6px 8px", background: "rgba(239, 68, 68, 0.2)", borderRadius: "4px", border: "1px solid rgba(239, 68, 68, 0.5)" }}>
              <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>04 · ACTION</div>
              <strong style={{ fontSize: "11px", color: "#ef4444", display: "block", marginTop: "2px" }}>REJECTED: {result.resultCode.toUpperCase()}</strong>
              <span style={{ fontSize: "10px", color: "#86efac" }}>Atomic fallback engaged</span>
            </div>

            <div style={{ padding: "6px 8px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "4px", border: "1px solid rgba(52, 211, 153, 0.25)" }}>
              <div style={{ fontSize: "9.5px", color: "var(--text-muted)", fontWeight: 700 }}>05 · AUDIT LOG</div>
              <strong style={{ fontSize: "11px", color: "#86efac", display: "block", marginTop: "2px" }}>Persisted in DB</strong>
              <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>{result.latencyMs.toFixed(1)}ms record</span>
            </div>
          </div>

          <div className="rejection-box-lines">
            <div className="rejection-line">
              <span className="rejection-line-prefix">[INJECTED CLAIM]:</span>
              <span className="rejection-line-content strike">"{result.injectedClaim}"</span>
            </div>

            <div className="rejection-line">
              <span className="rejection-line-prefix">[CITED REF ID]:</span>
              <span className="rejection-line-content bad-cite">{result.citedRef}</span>
              <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>(Expected company: {result.expectedCompany})</span>
            </div>

            <div className="rejection-line">
              <span className="rejection-line-prefix">[VERDICT / REASON]:</span>
              <span className="rejection-line-content verdict-text">{result.reason}</span>
            </div>

            <div className="rejection-line">
              <span className="rejection-line-prefix">[DATABASE TRUTH]:</span>
              <span style={{ color: "#93c5fd" }}>Verified DB Record Value = <strong>{result.actualDbValue}</strong></span>
            </div>

            <div className="rejection-line" style={{ marginTop: "6px", paddingTop: "8px", borderTop: "1px dashed rgba(239, 68, 68, 0.3)" }}>
              <span className="rejection-line-prefix">[ATOMIC FALLBACK]:</span>
              <span className="rejection-line-content fallback-text">ENGAGED · Restored grounded thesis: "{result.fallbackReplacement}"</span>
            </div>
            <div className="rejection-line">
              <span className="rejection-line-prefix">[VERIFIED CITATION]:</span>
              <span style={{ color: "#86efac", fontFamily: "var(--font-mono)" }}>{result.fallbackRef} · 0 unsubstantiated tokens rendered</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

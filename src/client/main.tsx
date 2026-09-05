import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

import type { InvestigationData, VerificationScoreboardData } from "./types/index.js";
import { InvestigationHeader } from "./components/InvestigationHeader.js";
import { InvestigationTerminal } from "./components/InvestigationTerminal.js";
import { DivergenceRadar } from "./components/DivergenceRadar.js";
import { AttackCenter } from "./components/AttackCenter.js";
import { FindingCard } from "./components/FindingCard.js";
import { TrustScoreboard } from "./components/TrustScoreboard.js";
import { EvidenceLineage } from "./components/EvidenceLineage.js";
import { ClaimCheckerPanel } from "./components/ClaimCheckerPanel.js";
import { DebatePanel } from "./components/DebatePanel.js";
import { InvestigationBrief } from "./components/InvestigationBrief.js";
import { RejectedDrawer } from "./components/RejectedDrawer.js";
import { DossierModal } from "./components/DossierModal.js";

function App() {
  const [investigation, setInvestigation] = useState<InvestigationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCalcId, setSelectedCalcId] = useState<string | null>(null);
  const [ticker, setTicker] = useState("NVDA");
  const [liveQuery, setLiveQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRejectedDrawer, setShowRejectedDrawer] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Workflow navigation & Trust Scoreboard State
  const [activeWorkflowStep, setActiveWorkflowStep] = useState("investigate");
  const [scoreboardScope, setScoreboardScope] = useState<"company" | "all">("company");
  const [companyScoreboard, setCompanyScoreboard] = useState<VerificationScoreboardData | null>(null);
  const [allScoreboard, setAllScoreboard] = useState<VerificationScoreboardData | null>(null);

  // Section Refs for smooth scrolling
  const discoverRef = useRef<HTMLElement>(null);
  const attackRef = useRef<HTMLElement>(null);
  const verifyRef = useRef<HTMLElement>(null);
  const challengeRef = useRef<HTMLElement>(null);
  const concludeRef = useRef<HTMLElement>(null);
  const evidencePanelRef = useRef<HTMLDivElement>(null);

  const fetchScoreboardData = (targetTicker?: string) => {
    const symbolToFetch = targetTicker ?? ticker;
    if (symbolToFetch) {
      fetch(`/api/verification-stats?ticker=${encodeURIComponent(symbolToFetch)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setCompanyScoreboard(data))
        .catch(() => {});
    }

    fetch(`/api/verification-stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setAllScoreboard(data))
      .catch(() => {});
  };

  const fetchCompanyData = (targetTicker: string) => {
    setInvestigation(null);
    setError(null);
    setSearchError(null);
    setLoading(true);
    fetch(`/api/investigations/${encodeURIComponent(targetTicker)}`)
      .then(async (response) => {
        if (response.ok) return response.json() as Promise<InvestigationData>;
        const errJson = await response.json().catch(() => ({}));
        return Promise.reject(
          new Error(
            errJson.error ||
              `Unable to retrieve filings for "${targetTicker}". Try NVDA, AAPL, MSFT, RELIANCE, or TCS.`
          )
        );
      })
      .then((data) => {
        setInvestigation(data);
        setSelectedCalcId(data.calculations[0]?.calcId ?? null);
        setTicker(data.company);
        fetchScoreboardData(data.company);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to load investigation.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCompanyData(ticker);
    fetchScoreboardData(ticker);
  }, []);

  const scrollToWorkflowStep = (stepId: string) => {
    setActiveWorkflowStep(stepId);
    if (stepId === "investigate") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (stepId === "discover" && discoverRef.current) {
      discoverRef.current.scrollIntoView({ behavior: "smooth" });
    } else if (stepId === "attack" && attackRef.current) {
      attackRef.current.scrollIntoView({ behavior: "smooth" });
    } else if (stepId === "verify" && verifyRef.current) {
      verifyRef.current.scrollIntoView({ behavior: "smooth" });
    } else if (stepId === "challenge" && challengeRef.current) {
      challengeRef.current.scrollIntoView({ behavior: "smooth" });
    } else if (stepId === "conclude" && concludeRef.current) {
      concludeRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleCustomSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!liveQuery.trim()) {
      setSearchError("Please enter a ticker symbol or SEC CIK (e.g. INTC, TSLA, AMZN)");
      return;
    }
    setSearchError(null);
    const cleanTicker = liveQuery.trim().toUpperCase();
    setTicker(cleanTicker);
    fetchCompanyData(cleanTicker);
  };

  const inspectCalculation = (calcId: string | null) => {
    setSelectedCalcId(calcId);
    if (evidencePanelRef.current) {
      evidencePanelRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  // IntersectionObserver scroll spy to update active stage during scrolling
  useEffect(() => {
    const stageElements = [
      { id: "investigate", el: document.getElementById("step-investigate") },
      { id: "discover", el: discoverRef.current },
      { id: "attack", el: attackRef.current },
      { id: "verify", el: verifyRef.current },
      { id: "challenge", el: challengeRef.current },
      { id: "conclude", el: concludeRef.current },
    ];

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const matched = stageElements.find((s) => s.el === visible[0].target);
          if (matched && matched.id !== activeWorkflowStep) {
            setActiveWorkflowStep(matched.id);
          }
        }
      },
      {
        rootMargin: "-110px 0px -40% 0px",
        threshold: [0, 0.2],
      }
    );

    stageElements.forEach((s) => {
      if (s.el) observer.observe(s.el);
    });

    return () => observer.disconnect();
  }, [investigation, activeWorkflowStep]);

  // Compute counts strictly from production filing evidence
  const activeStats = scoreboardScope === "company" ? companyScoreboard : allScoreboard;
  const prodStats = activeStats?.production ?? activeStats;
  const verifiedCount = prodStats?.verifiedClaims ?? investigation?.verificationStats?.verifiedClaims ?? 0;
  const rejectedCount = prodStats?.rejectedClaims ?? investigation?.verificationStats?.rejectedClaims ?? 0;
  const totalCount = prodStats?.totalClaims ?? investigation?.verificationStats?.totalClaims ?? (verifiedCount + rejectedCount);

  // Divergence alert if findings exist with non-zero severity
  const divergenceCount = investigation?.findings.length ?? 0;
  const divergenceAlert = divergenceCount > 0;

  return (
    <div className="app-shell">
      {/* 1. Header with Honest Provenance & Ticker Picker */}
      <InvestigationHeader
        investigation={investigation}
        ticker={ticker}
        liveQuery={liveQuery}
        searchError={searchError}
        loading={loading}
        onSearchChange={setLiveQuery}
        onSearchSubmit={handleCustomSearch}
        onSelectTicker={(sym) => {
          setTicker(sym);
          fetchCompanyData(sym);
        }}
        onOpenExportModal={() => setShowExportModal(true)}
        onToggleDrawer={() => setShowRejectedDrawer(!showRejectedDrawer)}
        rejectedCount={rejectedCount}
        verifiedCount={verifiedCount}
        totalCount={totalCount}
      />

      {/* Rejection Audit Log Drawer */}
      <RejectedDrawer
        isOpen={showRejectedDrawer}
        onClose={() => setShowRejectedDrawer(false)}
        rejectedItems={investigation?.verificationStats?.rejectedItems ?? []}
        verifiedCount={verifiedCount}
      />

      {/* 2. Investigation Terminal & 6-Stage Stepper */}
      <InvestigationTerminal
        investigation={investigation}
        activeWorkflowStep={activeWorkflowStep}
        onScrollToStep={scrollToWorkflowStep}
        divergenceAlert={divergenceAlert}
        divergenceCount={divergenceCount}
        verifiedCount={verifiedCount}
        rejectedCount={rejectedCount}
        totalCount={totalCount}
      />

      {/* Error Fallback Banner */}
      {error && (
        <section className="error-banner" style={{ marginTop: "24px" }}>
          <h3>⚠️ Filing Retrieval Notice</h3>
          <p>{error}</p>
          <div className="error-actions">
            <button type="button" onClick={() => { setTicker("NVDA"); fetchCompanyData("NVDA"); }}>Switch to NVIDIA (NVDA)</button>
            <button type="button" onClick={() => { setTicker("AAPL"); fetchCompanyData("AAPL"); }}>Switch to Apple (AAPL)</button>
            <button type="button" onClick={() => { setTicker("RELIANCE"); fetchCompanyData("RELIANCE"); }}>Switch to Reliance (BSE)</button>
          </div>
        </section>
      )}

      {/* Main Investigation Content */}
      {investigation && (
        <>
          {/* STAGE 02: DISCOVER - 6-Signal Forensic Anomaly Screen */}
          <DivergenceRadar
            investigation={investigation}
            onInspectCalculation={inspectCalculation}
            innerRef={discoverRef}
          />

          {/* STAGE 02B: Forensic Case Files with Rationale & Next Steps */}
          <FindingCard
            findings={investigation.findings}
            onInspectCalculation={inspectCalculation}
          />

          {/* STAGE 03: ATTACK CENTER - Real Backend-Driven Red-Team Console */}
          <AttackCenter
            ticker={investigation.company}
            onAttackCompleted={() => fetchScoreboardData(investigation.company)}
            innerRef={attackRef}
          />

          {/* STAGE 03: VERIFY - 100% DB-Derived Trust Scoreboard */}
          <TrustScoreboard
            stats={activeStats}
            scope={scoreboardScope}
            ticker={investigation.company}
            onScopeChange={(scope) => {
              setScoreboardScope(scope);
              fetchScoreboardData();
            }}
            innerRef={verifyRef}
          />

          {/* 4-Node Visual Lineage DAG & Calculation Explorer */}
          <EvidenceLineage
            company={investigation.company}
            calculations={investigation.calculations}
            facts={investigation.facts}
            selectedCalcId={selectedCalcId}
            onSelectCalcId={setSelectedCalcId}
            innerRef={evidencePanelRef}
          />

          {/* Management Guidance vs Reported Outcome */}
          <ClaimCheckerPanel claimChecks={investigation.claimChecks} />

          {/* STAGE 04: CHALLENGE - Bull vs Bear Courtroom Debate */}
          {investigation.debate && (
            <DebatePanel
              debate={investigation.debate}
              company={investigation.company}
              onInspectCalculation={inspectCalculation}
              innerRef={challengeRef}
            />
          )}

          {/* STAGE 05: CONCLUDE - Culminating Investigation Brief */}
          <InvestigationBrief
            investigation={investigation}
            divergenceAlert={divergenceAlert}
            verifiedCount={verifiedCount}
            rejectedCount={rejectedCount}
            totalCount={totalCount}
            onOpenExportModal={() => setShowExportModal(true)}
            innerRef={concludeRef}
          />
        </>
      )}

      {/* Export Committee Dossier Modal */}
      <DossierModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        investigation={investigation}
        divergenceAlert={divergenceAlert}
        verifiedCount={verifiedCount}
        rejectedCount={rejectedCount}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from "react";
import type { InvestigationData } from "../types/index.js";

interface InvestigationHeaderProps {
  investigation: InvestigationData | null;
  ticker: string;
  liveQuery: string;
  searchError: string | null;
  loading: boolean;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onSelectTicker: (ticker: string) => void;
  onOpenExportModal: () => void;
  onToggleDrawer: () => void;
  rejectedCount: number;
  verifiedCount: number;
  totalCount: number;
}

const INDIAN_TICKERS = new Set(["RELIANCE", "TCS", "TATAMOTORS"]);

export const InvestigationHeader: React.FC<InvestigationHeaderProps> = ({
  investigation,
  ticker,
  liveQuery,
  searchError,
  loading,
  onSearchChange,
  onSearchSubmit,
  onSelectTicker,
  onOpenExportModal,
  onToggleDrawer,
  rejectedCount,
  verifiedCount,
  totalCount,
}) => {
  const isIndian = INDIAN_TICKERS.has(ticker.toUpperCase());
  const dataSourceLabel = isIndian
    ? "CURATED BSE AUDITED BENCHMARK"
    : investigation?.isLiveMode
    ? "SEC EDGAR 10-K LIVE"
    : "SEC CURATED 10-K REPO";

  const dataSourceSubtext = isIndian
    ? "Consolidated audited financials in INR from BSE primary regulatory filings"
    : investigation?.isLiveMode
    ? "Live XBRL extraction directly from data.sec.gov with sub-second rate-limiting"
    : "Curated audited 10-K filings with deterministic calculation grounding";

  return (
    <>
      <header className="masthead">
        <div className="brand-wrapper">
          <div className="brand-icon">F</div>
          <div>
            <div className="brand">
              FINVESTIGATE
              <span className="brand-badge">SEC FORENSIC AUDIT</span>
            </div>
            <span className="tagline">Deterministic Evidence-First Financial Intelligence</span>
          </div>
        </div>

        <div className="masthead-actions">
          <button
            type="button"
            className={`verification-shield-badge ${rejectedCount > 0 ? "stripped" : "clean"}`}
            onClick={onToggleDrawer}
            title="Production 10-K Evidence Gate: Click to view mechanical gate audit logs"
          >
            <span>{rejectedCount > 0 ? "🛡️" : "✓"}</span>
            <span>
              {rejectedCount > 0
                ? `${rejectedCount} / ${totalCount} CLAIMS REJECTED BY EVIDENCE GATE`
                : `ALL CITED CLAIMS PASS VERIFICATION (${verifiedCount}/${totalCount})`}
            </span>
          </button>

          <span
            className={`status-pill ${isIndian ? "curated" : investigation?.isLiveMode ? "live" : "curated"}`}
            title={dataSourceSubtext}
          >
            <span className="pulse-dot"></span>
            {dataSourceLabel}
          </span>

          <button
            type="button"
            className="export-button"
            onClick={onOpenExportModal}
            title="Export full investigation brief"
          >
            <span>📄</span>
            <span>Export Dossier</span>
          </button>
        </div>
      </header>

      {/* Primary Ticker Selector & Search Bar */}
      <div className="picker-container" style={{ marginTop: "24px" }}>
        <div className="quick-tickers-label">Audited Primary Benchmarks:</div>
        <div className="quick-tickers-row" aria-label="Company selection">
          {["NVDA", "AAPL", "MSFT", "RELIANCE", "TCS"].map((sym) => (
            <button
              key={sym}
              type="button"
              className={`ticker-chip ${ticker === sym ? "selected" : ""}`}
              onClick={() => onSelectTicker(sym)}
              disabled={loading}
              style={{ whiteSpace: "nowrap" }}
            >
              <strong>{sym}</strong>
              <span title={INDIAN_TICKERS.has(sym) ? "Curated Primary-Source Annual Report Data (Ind AS)" : "Audited SEC EDGAR 10-K"}>
                {INDIAN_TICKERS.has(sym) ? "BSE" : "10-K"}
              </span>
            </button>
          ))}
        </div>

        <div className="search-and-guide">
          <form className="live-search-form" onSubmit={onSearchSubmit}>
            <div className="input-group">
              <input
                type="text"
                className={`live-input ${searchError ? "input-error" : ""}`}
                placeholder="Search any SEC ticker or CIK (e.g. INTC, TSLA, AMZN)..."
                value={liveQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                disabled={loading}
                style={{ width: "380px" }}
              />
              {searchError && <span className="field-error">{searchError}</span>}
            </div>
            <button type="submit" className="live-button" disabled={loading}>
              {loading ? "Ingesting..." : "Investigate ↗"}
            </button>
          </form>
        </div>
      </div>

      <div
        style={{
          background: isIndian ? "rgba(245, 158, 11, 0.12)" : "rgba(30, 58, 138, 0.25)",
          borderBottom: isIndian ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid rgba(59, 130, 246, 0.25)",
          padding: "6px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "12px",
          color: isIndian ? "#fbbf24" : "#93c5fd",
        }}
      >
        <span>
          <strong>Data Provenance:</strong> {dataSourceSubtext}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", opacity: 0.85 }}>
          {isIndian ? "Consolidated Indian Accounting Standards (Ind AS)" : "SEC EDGAR US GAAP"}
        </span>
      </div>
    </>
  );
};

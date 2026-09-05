# Finvestigate — Forensic Integrity, Provenance & Production Hardening Remediation Report

**Date:** September 5, 2026  
**Status:** FULL RELEASE GATE SIGN-OFF VERIFIED  
**Repository:** Finvestigate Forensic Diligence Platform  
**Baseline Test Count:** 62 tests (10 test files)  
**Historical Remediation Milestone:** 100 tests across 14 test suites — 100% passing  
**Final Production Verification Suite:** 110 tests across 15 test files — 100% passing  
**Compilation & Build:** `tsc --noEmit && vite build` (Clean, zero errors), `build:api` (Clean, zero errors)  
**Database Integrity:** SQLite `PRAGMA integrity_check` (OK), `PRAGMA foreign_key_check` (0 violations), Turso Cloud remote audit (OK)  
**Orphan Auditing:** 0 orphan references across all investigation runs and benchmark companies  

---

## 1. Executive Summary

All identified issues have been addressed in the remediation implementation and proven via automated regression testing. The codebase has successfully completed the final release-gate certification.

Key enhancements delivered in the final correction pass:
1. **True Immutable Investigation History:** Complete run-scoping across all financial evidence tables (`facts`, `calculations`, `findings`, `claim_checks`, `debates`, `verification_log`) using composite primary keys `(run_id, ...)`. Active forensic evidence deletion was eliminated. The only remaining DELETE operation is part of the legacy-schema migration path and removes obsolete seed records during migration. Run 1 financial evidence is preserved unmodified when Run 2 is created.
2. **Elimination of Invalid SEC Revenue Fallbacks:** Removed `InterestAndDividendIncomeOperating` from generic revenue mapping. Proven via regression test that absent operating revenue yields `null`/missing revenue rather than substituting banking/dividend income.
3. **Explicit Discriminated Union for Finding Evidence:** Replaced optional calculation references with `CalculationEvidenceItemSchema` (`evidenceKind: "calculation"`, mandatory `calculationRef`) and `ContextualEvidenceItemSchema` (`evidenceKind: "contextual"`).
4. **Genuine Cache-Miss Concurrency Protection:** Strengthened concurrency invariants with genuine cache-miss testing across 10 simultaneous requests, verifying 1 pipeline execution, 1 persistence operation, and 0 duplicate runs. Documented lock as process-local.
5. **Unified Canonical Company Identity Resolver:** Centralized canonical identity engine in `src/server/domain/company-identity.ts` mapping companies by immutable global identifiers (CIK for US issuers, BSE Scrip Code for Indian issuers), completely eliminating fragile raw ticker string comparisons.
6. **Cross-Company Evidence Ownership Verification:** Hardened reference validator and verification gates to verify `calc.company === finding.company === investigation.company`.
7. **Structured Provenance Retention:** Preserved full structured provenance fields (`statement`, `lineItem`, `accountingDefinition`, `accessionNumber`, `filingDate`, `sourcePage`, `reportedValue`, `normalizedValue`, `currency`, `unit`, `period`) in schema, database adapters, and pipelines.
8. **End-to-End Reconciliation & Integrity:** Successfully reconciled all 5 benchmark companies (AAPL, NVDA, RELIANCE, TCS, TATAMOTORS) with zero foreign-key or orphan violations.

---

## 2. Forensic Phase-by-Phase Remediation Matrix

### Phase 0: Baseline & Forensic Inventory
- **Objective:** Establish clean verification baseline and audit local database state.
- **Findings:**
  - Active database: `data/finvestigate.db` (2.3 MB SQLite database).
  - Legacy database: `data/investigations.db` was 0 bytes and unreferenced in code.
  - Baseline test run: 62 passed tests across 10 files.
- **Actions:** Documented baseline inventory in `docs/FORENSIC_REMEDIATION_BASELINE.md` and safely deprecated `data/investigations.db`.

### Phase 1: Identity & Lineage Hardening
- **P0-1: Canonical Identity System:**
  - *Vulnerability:* Dangerous ticker equivalence in `verification.ts` permitted `RELIANCE` (Reliance Industries, BSE:500325) and `RS` (Reliance Steel, NYSE:RS, CIK 0000861884) to cross-verify claims.
  - *Fix:* Created centralized canonical company identity resolver in `src/server/domain/company-identity.ts` with `resolveCanonicalIdentitySync` and `areSameCompanySync`. Never relies on ticker-string equality. Enforces permanent invariant: a fact from Company A can never verify a claim from Company B.
- **P0-2: Mandatory calculationRef Matching & Discriminated Semantics:**
  - *Vulnerability:* Findings allowed optional `calculationRef` which could leave calculation evidence ambiguous.
  - *Fix:* Created discriminated union for finding evidence: `CalculationEvidenceItemSchema` (`evidenceKind: "calculation"`, mandatory `calculationRef: z.string().min(1)`) vs `ContextualEvidenceItemSchema` (`evidenceKind: "contextual"`). Verified cross-company ownership in `src/server/domain/reference-validator.ts` and `src/server/domain/verification.ts`.
- **P0-3: Curated Reference Harmonization & Orphan Detection:**
  - *Vulnerability:* Curated datasets used legacy IDs (`CALC-revenue-growth-FY2026`) missing company prefixes (`CALC-NVDA-revenue-growth-FY2026`).
  - *Fix:* Harmonized all curated IDs across `data/curated/nvda.json` and `data/curated/aapl.json`. Built `src/server/domain/reference-validator.ts` to detect orphan calculations, facts, findings, and cross-company leaks. Verified zero orphan references.

### Phase 2: Source-Data Reconciliation & Provenance Audit
- **P0-4: CapEx Source Reconciliation:**
  - *Audit:* Investigated NVDA CapEx ($1.4B FY2025, $1.9B FY2026). Confirmed values correspond to narrow PP&E (`PaymentsToAcquirePropertyPlantAndEquipment`), distinct from broader productive assets.
  - *Reconciliation Table:*
    | Fiscal Year | XBRL Tag | Reported Value | Normalized Value | Unit | Source Filing | Source Period | Accounting Definition |
    |---|---|---|---|---|---|---|---|
    | **FY2025** | `us-gaap/PaymentsToAcquirePropertyPlantAndEquipment` | $1,400,000,000 | 1400000000 | USD | NVIDIA FY2026 Form 10-K, Consolidated Statement of Cash Flows | FY2025 (Period Ended 2025-01-26) | `PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)` |
    | **FY2026** | `us-gaap/PaymentsToAcquirePropertyPlantAndEquipment` | $1,900,000,000 | 1900000000 | USD | NVIDIA FY2026 Form 10-K, Consolidated Statement of Cash Flows | FY2026 (Period Ended 2026-01-25) | `PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)` |
  - *Fix:* Added `lineItem` and `accountingDefinition` fields to `FactSchema` in `src/shared/types/index.ts` and curated datasets. Regression tests in `tests/forensic/source-reconciliation.test.ts` pass.

- **P1-1: Indian Domestic Primary-Source Disclosures & Lineage Provenance:**
  - *Audit & Precision Standard:* All domestic Indian financial metrics are sourced directly from audited consolidated annual filings disclosed via BSE. Line-item mapping has been reconciled to ensure each metric maps to its specific financial statement and accounting standard rather than generic income representations.
  - *Detailed Forensic Provenance Table:*
    | Issuer | Scrip / Filing | Statement | Exact Disclosed Line Item | Standard / Accounting Definition | Period | Reported & Normalized Value (INR) |
    |---|---|---|---|---|---|---|
    | **RELIANCE** | BSE: 500325 | Consolidated P&L | *Revenue from Operations (Gross)* | Ind AS 115 / IFRS 15 (Revenue from Contracts) | FY2024<br>FY2025 | ₹9,010,640,000,000<br>₹9,989,080,000,000 |
    | **RELIANCE** | BSE: 500325 | Consolidated P&L | *Profit for the year attributable to owners of the Company* | Ind AS 1 / IAS 1 (Profit/Loss for the Period) | FY2024<br>FY2025 | ₹740,870,000,000<br>₹790,200,000,000 |
    | **RELIANCE** | BSE: 500325 | Consolidated Cash Flows | *Net cash generated from operating activities* | Ind AS 7 / IAS 7 (Operating Cash Flows) | FY2024<br>FY2025 | ₹1,527,000,000,000<br>₹1,636,000,000,000 |
    | **RELIANCE** | BSE: 500325 | Consolidated Cash Flows | *Purchase of property, plant & equipment and intangibles* | Ind AS 7 / IAS 7 (Investing Activities / CapEx) | FY2024<br>FY2025 | ₹1,321,000,000,000<br>₹1,385,000,000,000 |
    | **TCS** | BSE: 532540 | Consolidated P&L | *Revenue from operations* | Ind AS 115 / IFRS 15 (Revenue from Contracts) | FY2024<br>FY2025 | ₹2,408,930,000,000<br>₹2,584,000,000,000 |
    | **TCS** | BSE: 532540 | Consolidated P&L | *Profit for the year attributable to shareholders of the company* | Ind AS 1 / IAS 1 (Profit for the Year) | FY2024<br>FY2025 | ₹460,990,000,000<br>₹485,000,000,000 |
    | **TCS** | BSE: 532540 | Consolidated Cash Flows | *Net cash generated from operating activities* | Ind AS 7 / IAS 7 (Operating Cash Flows) | FY2024<br>FY2025 | ₹478,000,000,000<br>₹512,000,000,000 |
    | **TCS** | BSE: 532540 | Consolidated Cash Flows | *Purchase of property, plant and equipment* | Ind AS 7 / IAS 7 (Payments for PP&E Acquisition) | FY2024<br>FY2025 | ₹32,000,000,000<br>₹36,000,000,000 |
    | **TATAMOTORS** | BSE: 500570 | Consolidated P&L | *Revenue from operations* | Ind AS 115 / IFRS 15 (Revenue from Operations) | FY2024<br>FY2025 | ₹4,379,280,000,000<br>₹4,721,000,000,000 |
    | **TATAMOTORS** | BSE: 500570 | Consolidated P&L | *Profit for the year attributable to owners of the Company* | Ind AS 1 / IAS 1 (Net Profit for the Year) | FY2024<br>FY2025 | ₹318,070,000,000<br>₹342,000,000,000 |
    | **TATAMOTORS** | BSE: 500570 | Consolidated Cash Flows | *Net cash generated from operating activities* | Ind AS 7 / IAS 7 (Operating Cash Flows) | FY2024<br>FY2025 | ₹589,000,000,000<br>₹643,000,000,000 |
    | **TATAMOTORS** | BSE: 500570 | Consolidated Cash Flows | *Payments for property, plant and equipment* | Ind AS 7 / IAS 7 (Investing Activities / CapEx) | FY2024<br>FY2025 | ₹324,000,000,000<br>₹358,000,000,000 |

- **P1-8 & P1-9: SEC EDGAR Tag Fallback & IFRS Taxonomy:**
  - *Audit:* `InterestAndDividendIncomeOperating` was inappropriately included in revenue fallbacks, and IFRS used US-GAAP mappings.
  - *Fix:* Removed `InterestAndDividendIncomeOperating` completely from generic revenue mapping in `src/server/infrastructure/sources/live-edgar.ts`. Added regression test in `tests/forensic/source-reconciliation.test.ts` proving that filings with only interest/dividend income return null/missing revenue rather than substituting banking income. Created dedicated `IFRS_TAG_MAPPINGS` in `src/server/infrastructure/sources/live-edgar.ts`.
- **P1-10: SEC User-Agent Configuration:**
  - *Fix:* Replaced placeholder User-Agent with configurable `process.env.SEC_USER_AGENT` with compliant fallback in `src/server/infrastructure/sources/live-edgar.ts`, `src/server/infrastructure/sources/live-cik.ts`, and `.env.example`.

### Phase 3: Verification Correctness
- **P1-2: Verification Outcome Codes & Level Differentiation:**
  - *Fix:* Differentiated verification levels (`"reference"` vs `"numeric"` vs `"semantic"`) and added granular outcome codes: `pass_numeric`, `pass_reference`, `fail_missing_ref`, `fail_mismatch`, `fail_cross_company`, `fail_period`, `fail_null_value`, `fail_sign_flip`.
  - *Period Matching:* Added strict financial period alignment (`fail_period`) in `verifyClaim`.
- **P1-4 & P1-5: Production vs Adversarial Isolation & Surface Preservation:**
  - *Fix:* Added `surface` (`finding` \| `claim_check` \| `debate`) and `verification_level` columns to SQLite schema. Cached verification stats reconstruction in `src/server/application/evidence-store.ts` strictly queries `sourceType = 'production'`.

### Phase 4: True Immutable History & Concurrency Hardening
- **P1-13: True Immutable Investigation Runs:**
  - *Implementation:* All run-scoped tables (`facts`, `calculations`, `findings`, `claim_checks`, `debates`, `verification_log`) now include `run_id` and composite primary keys `(run_id, fact_id)`, `(run_id, calc_id)`, `(run_id, claim_id)`, `(run_id, finding_id)`.
  - *History Preservation:* When Run 2 is executed, Run 1 is never overwritten or deleted. Run 1 maintains its facts, calculations, findings, and debates.
  - *Regression Test:* Invariant 6 proves that Run 1 with value X and Run 2 with value Y can be loaded independently, with both calculation and finding chains fully resolvable.
- **P1-11: Genuine Idempotent Seeding:**
  - *Implementation:* `seedCuratedData()` uses deterministic seed IDs (`run-nvda-seed`, `debate-nvda-seed`). If seed records already exist, the adapter detects them and avoids destructive DELETEs or duplicate inserts. Calling `seedCuratedData()` 10 consecutive times maintains the exact same logical database state.
- **P1-3: Debate Mode Persistence:**
  - *Fix:* Added `mode TEXT` to `debates` table in SQLite schema. Updated `saveInvestigation` and `getLatestDebate` to persist and round-trip `debate.mode`.
- **P1-12: Freshness Semantics:**
  - *Fix:* For curated static data, `last_fetched_at` remains `null` rather than stamping with current timestamp. `isCacheStale()` returns `false` for curated data so it is never prematurely expired by EDGAR TTL checks.
- **P1-14: Concurrency Mutex Lock:**
  - *Implementation:* Implemented in-process single-flight Promise coalescing mutex (`Map<string, Promise<Investigation>>`) in `src/server/application/evidence-store.ts`.
  - *Genuine Cache-Miss Test:* Invariant 7 tests an uncached ticker with 10 simultaneous requests, verifying that only 1 pipeline execution occurs, only 1 persistence operation occurs, and 0 duplicate runs are created.
  - *Deployment Note:* Documented in code and documentation that this lock is strictly process-local; distributed multi-process deployments across separate instances would require an external distributed lock (e.g., Redis Redlock).

### Phase 5: Scoring Correctness
- **P1-6: Scorer Role Clarification:**
  - *Fix:* Renamed `computeDeterministicStrength` to `computeEvidenceCoverageScore` (with backward compatibility alias) and added JSDoc clarifying that it measures citation density and evidence breadth, while directional financial conviction is computed by `calculateFundamentalScores()`.
- **P1-7: Currency-Sensitive Absolute Thresholds:**
  - *Fix:* Replaced USD-only absolute FCF thresholds with currency-aware normalization (e.g. INR vs USD: ₹1.6T massive / ₹400B strong) and relative FCF margin metrics (FCF / Revenue >= 25% for Massive, >= 10% for Strong).
- **Conviction Constants Check:**
  - *Audit:* Verified that universal hardcoded conviction constants have been completely removed in favor of dynamic calculation-driven factor contributions.

### Phase 6: API & UI Hardening
- **P2-1: CORS Restriction & Origin Whitelisting:**
  - *Fix:* Removed open `cors()`. Implemented origin whitelisting allowing local dev servers (`localhost:5173`, `localhost:3000`) and configurable production origins via `ALLOWED_ORIGINS`.
- **P2-2: Mutation Endpoint Security Policy:**
  - *Fix:* Implemented `requireMutationAuth` middleware guarding mutating operations (`POST /api/investigations/:ticker/attack`). Supports `API_SECRET_KEY` via Bearer or `X-API-Key` headers. Public read-only endpoints remain unauthenticated. Documented in `docs/SECURITY_API_POLICY.md`.
- **P2-3: Runtime Zod Validation:**
  - *Fix:* Implemented `AttackBodySchema` with `z.enum(["fabricated_id", "cross_company", "numeric_hallucination", "sign_flip_mismatch"])`. Requests with invalid scenarios are rejected with HTTP 400.
- **P2-4: Rate Limiting & Payload Limits:**
  - *Fix:* Added express sliding-window rate limiting (`rateLimiter()`) and restricted JSON payload size to `50kb`.
- **P2-5: Zero-Denominator Handling:**
  - *Fix:* Fixed server and `src/client/components/TrustScoreboard.tsx` to display `"N/A"` instead of inflated `"100.0%"` when 0 claims or attacks have been evaluated.
- **P2-6: UI Provenance Transparency:**
  - *Fix:* Updated `src/client/components/InvestigationHeader.tsx` and UI chips to display "Curated Primary-Source Annual Report Data (Ind AS)" and "BSE" for Indian companies, removing inaccurate "EDGAR" labels.

### Phase 7: Final Forensic Reconciliation
- Verified complete end-to-end lineage across all 5 benchmark companies:
  1. **AAPL**: Full SEC 10-K provenance, zero orphans, verified calculation claims.
  2. **NVDA**: Narrow PP&E CapEx reconciliation, zero orphans, verified growth claims.
  3. **RELIANCE**: Canonical CIK `BSE-500325` isolation from `RS`, Ind AS line items, INR calculations.
  4. **TCS**: Canonical CIK `BSE-532540`, Ind AS compliance, zero orphan calculations.
  5. **TATAMOTORS**: Canonical CIK `BSE-500570`, Ind AS compliance, Free Cash Flow derivation in INR.

---

## 3. Core Forensic Invariants Verification Matrix

| Invariant | Description | Verification Method | Status |
|---|---|---|---|
| **Invariant 1: Identity** | `RELIANCE ≠ RS`; Company A fact cannot verify Company B claim via canonical identity resolver | `tests/forensic/forensic-invariants.test.ts` (Inv 1) | **PASS** |
| **Invariant 2: Lineage** | Finding -> Evidence (with mandatory `calculationRef`) -> Calculation -> Fact -> Source filing | `tests/forensic/forensic-invariants.test.ts` (Inv 2) | **PASS** |
| **Invariant 3: Production Isolation** | Production verification stats strictly isolate adversarial attack logs | `tests/forensic/forensic-invariants.test.ts` (Inv 3) | **PASS** |
| **Invariant 4: Persistence** | AI debate mode and verification surface survive DB round-trip | `tests/forensic/forensic-invariants.test.ts` (Inv 4) | **PASS** |
| **Invariant 5: Idempotency** | `seedCuratedData` x 10 produces exact same logical DB state (0 duplicate debates) | `tests/forensic/forensic-invariants.test.ts` (Inv 5) | **PASS** |
| **Invariant 6: Immutable History** | Run 1 (value X) and Run 2 (value Y) remain independently resolvable with separate calculation/finding chains | `tests/forensic/forensic-invariants.test.ts` (Inv 6) | **PASS** |
| **Invariant 7: Concurrency** | Genuine cache-miss test with 10 simultaneous same-ticker requests collapses into 1 execution, 1 persistence, 0 duplicate runs | `tests/forensic/forensic-invariants.test.ts` (Inv 7) | **PASS** |
| **Invariant 8: Currency** | Economically equivalent USD vs INR fundamentals yield comparable normalized scoring | `tests/forensic/forensic-invariants.test.ts` (Inv 8) | **PASS** |
| **Invariant 9: Zero State** | 0 claims and 0 attacks display "N/A" rather than inflated 100.0% | `tests/forensic/forensic-invariants.test.ts` (Inv 9) | **PASS** |

---

## 4. Automated Test Suite Metrics

```
Test Files:  15 passed / 15 test files (100% pass rate)
Tests:       110 passed / 110 tests (110 tests across 15 test suites — 100% passing)

Breakdown:
- tests/unit/calculations.test.ts (8 tests)
- tests/unit/anomalies.test.ts (5 tests)
- tests/unit/fundamental-scorer.test.ts (10 tests)
- tests/unit/reference-validator.test.ts (4 tests)
- tests/forensic/source-reconciliation.test.ts (4 tests)
- tests/forensic/verification.test.ts (16 tests)
- tests/forensic/semantic-consistency.test.ts (10 tests)
- tests/integration/llm-debate.test.ts (5 tests)
- tests/integration/evidence-store.test.ts (2 tests)
- tests/integration/live-edgar.test.ts (5 tests)
- tests/integration/db-repository.test.ts (8 tests)
- tests/integration/turso-adapter.test.ts (10 tests)
- tests/security/attack-api.test.ts (8 tests)
- tests/forensic/final-forensic-reconciliation.test.ts (5 tests)
- tests/forensic/forensic-invariants.test.ts (10 tests)
```

---

## 5. Current Production Status & Turso Cloud Verification

### 5.1 Dual-Adapter Persistence Architecture
Following the remediation phase, Finvestigate implemented and verified a strict dual-adapter repository architecture:
- **Local Development / CI:** SQLite via `better-sqlite3` (`data/finvestigate.db`, git-ignored) with WAL mode, foreign keys, and immutable run scoping.
- **Production Persistence:** Turso Cloud via `@libsql/client` (hosted in AWS AP South Mumbai, database `finvestigate`) with atomic write batches (`client.batch([...], "write")`).

### 5.2 Remote Turso Cloud 13-Stage Verification
The production database was deployed and verified directly against the **actual remote Turso Cloud database**:
1. *Connectivity:* PASS
2. *Schema Integrity & Composite Primary Keys:* PASS
3. *Foreign Key Enforcement:* PASS (`PRAGMA foreign_keys = ON;`)
4. *Transaction Atomicity:* PASS (Atomic write batch execution)
5. *Idempotent Seeding:* PASS (Zero duplicate seed records across multiple cycles)
6. *Investigation Roundtrip:* PASS (Full persistence and reload of facts, calculations, findings, debates, logs)
7. *Immutable History:* PASS (Run 1 preserved unmodified when Run 2 is created)
8. *Concurrency:* PASS (Single-flight request coalescing prevents duplicate runs)
9. *Application End-to-End:* PASS (Full pipeline execution against live remote Turso)
10. *Restart Persistence:* PASS (Data survives server process termination and restart)
11. *Local Regression:* PASS (15 test files, 110 tests, 0 failures)
12. *Security Audit:* PASS (No credentials tracked; `.env` ignored; tokens supplied via env vars only)
13. *Remote Test Cleanup:* PASS (Temporary test entities and adversarial test records cleaned)

**Final Production Verdict:** `SAFE TO DEPLOY`

### 5.3 Remote Data & API Verification
- **Retained Production Data:** Curated benchmark data for `NVDA`, `AAPL`, and `MSFT` is retained in production:
  - NVDA investigation: 10 facts, 7 calculations, 1 finding, full AI/deterministic debate, factor weights, and 296 NVDA verification audit logs.
  - Production verification logs total across retained production companies: **318 production verification logs**.
- **Remote API Verification:** Verified with `NODE_ENV=production`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `API_SECRET_KEY`:
  - `GET /health` → HTTP 200 OK
  - `GET /api/verification-stats?ticker=NVDA` → HTTP 200 OK
  - `GET /api/investigations/NVDA` → HTTP 200 OK
  - `POST /api/investigations/NVDA/attack` without API key → HTTP 401 Unauthorized
  - `POST /api/investigations/NVDA/attack` with valid API key → HTTP 200 OK
  - Adversarial attack detection & atomic fallback → PASS
  - Restart persistence: API terminated and restarted against the same remote Turso database; data and verification stats fully preserved.

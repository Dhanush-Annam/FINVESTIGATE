# Forensic Remediation Baseline

> [!NOTE]
> **Historical Baseline Snapshot:** This document is an immutable historical record capturing the system state and defect inventory prior to the forensic remediation phase (as of 2026-09-05T01:55Z). All issues listed below were subsequently resolved, tested, and certified clean.
>
> **CURRENT STATUS / POST-REMEDIATION ARCHITECTURE NOTE:**
> Following the baseline defect resolution, Finvestigate implemented its production persistence architecture using a strict dual-adapter repository pattern (`InvestigationRepository`):
> - **Local Development / CI:** SQLite via `better-sqlite3` (`data/finvestigate.db`, git-ignored).
> - **Production Persistence:** Turso Cloud via `@libsql/client` (hosted in AWS AP South Mumbai, `finvestigate`).
> - **Production Verification:** Passed all 13 production-readiness verification stages on the remote Turso Cloud database with a verdict of **SAFE TO DEPLOY**.
> - **Current Regression Suite:** 15 test files / 110 tests / 0 failures (100% pass rate).
> For current architectural documentation and the complete remediation log, refer to [`docs/FORENSIC_REMEDIATION_REPORT.md`](file:///d:/Projects/Finvestigate/docs/FORENSIC_REMEDIATION_REPORT.md), [`docs/DATABASE_INTEGRITY_AUDIT.md`](file:///d:/Projects/Finvestigate/docs/DATABASE_INTEGRITY_AUDIT.md), and [`FINVESTIGATE_CURRENT_STATE.md`](file:///d:/Projects/Finvestigate/FINVESTIGATE_CURRENT_STATE.md).

**Date**: 2026-09-05T01:55Z  
**Commit state**: Pre-remediation baseline (Historical)

## Build & Test Status

| Check | Result |
|-------|--------|
| `vitest run` | **62/62 pass** (10 test files, 31.09s) |
| `tsc --noEmit` | **Pass** (0 errors) |
| `vite build` | **Pass** (52 modules, 1.22s) |
| `PRAGMA integrity_check` | **ok** |

## Database Inventory

### finvestigate.db (2.3 MB + 4.1 MB WAL)

| Entity | Rows |
|--------|------|
| Companies | 13 (NVDA, AAPL, MSFT, AMZN, GOOGL, BTCS, RS, TSLA, INFY, RELIANCE, HDB, META, TCS) |
| Facts | 144 across all companies |
| Calculations | 63 across all companies |
| Findings | 3 (AAPL: 2, NVDA: 1) |
| Debates | **97** (AAPL: 47, NVDA: 47, RELIANCE: 1, TCS: 2) |
| Verification logs | 716 (production: 528, adversarial: 188) |

### investigations.db - 0 bytes, empty file, not referenced in source code

## Confirmed Issues

### P0: RELIANCE/RS Cross-Company Contamination
- REPRODUCED: Both in DB: RELIANCE (BSE-500325) and RS (CIK 0000861884, "RELIANCE, INC.")
- verification.ts:126-129 explicitly treats these as equivalent

### P0: Orphan Calculation References
- REPRODUCED: 7 orphan refs (NVDA: 2, AAPL: 5) - all missing company prefix

### P0: Evidence-Calculation Matching
- REPRODUCED: verification.ts:380 uses first evidence item for all calculation refs

### P1: Debate Mode Not Persisted
- REPRODUCED: No mode column in debates table

### P1: Non-Idempotent Seeding
- REPRODUCED: 47 duplicate debate rows each for AAPL and NVDA

### P1: Freshness Semantics
- REPRODUCED: Curated data last_fetched_at set to server start time

### P1: Cached Stats Source Isolation
- REPRODUCED: evidence-store.ts:175 mixes production/adversarial logs

### P1: Verification Surface Loss
- REPRODUCED: evidence-store.ts:183 hardcodes surface as "debate"

### P1: Revenue Tag Fallback
- CONFIRMED: live-edgar.ts:59 includes InterestAndDividendIncomeOperating

### P1: SEC User-Agent Placeholder
- CONFIRMED: contact@finvestigate.example in live-edgar.ts:6 and live-cik.ts:23

### P2: Runtime Scenario Validation
- CONFIRMED: server.ts:103 uses TypeScript cast without runtime validation

### P2: Zero-Denominator Display
- CONFIRMED: server.ts:31/42 shows 100.0% when zero claims/attacks

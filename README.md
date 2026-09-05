# FINVESTIGATE — Evidence-First Financial Intelligence

> *"Don't trust the AI. Investigate its evidence."*

FINVESTIGATE is an open-source, deterministic financial investigation engine and adversarial AI debate platform for SEC EDGAR filings. 

Instead of letting Large Language Models (LLMs) summarize raw financial filings—which frequently leads to hallucinations, sign-flip calculation errors, and untraceable claims—FINVESTIGATE enforces a strict **Evidence Chain Hierarchy**: 

$$\text{SEC EDGAR Source Fact} \longrightarrow \text{Deterministic Math Engine} \longrightarrow \text{Rule Anomaly Engine} \longrightarrow \text{LLM Debate/Explanation}$$

---

## 📖 System Architecture & Engineering Story

Building FINVESTIGATE was not a linear sprint of writing UI components—it was an evolution through 4 distinct phases of engineering challenges: **Ingestion**, **Storage & Deterministic Logic**, **Runtime Reliability**, and **Verification Transparency**.

```
                           +-------------------------------------+
                           |   SEC EDGAR XBRL (data.sec.gov)     |
                           +-------------------------------------+
                                              |
                                              v
                           +-------------------------------------+
                           |  Phase 1: Multi-Scale Ingestion     |
                           |  (10-K/10-Q Filtering & Parsing)    |
                           +-------------------------------------+
                                              |
                                              v
+-----------------------------------------------------------------------------------+
| Phase 2: Deterministic Evidence Store & Domain Types                              |
|                                                                                   |
|  [Fact Schema]  --->  [Calculation Engine]  --->  [Anomaly Rules Engine]            |
|  (Source URLs)        (YoY / FCF Math)            (Cash Flow & Receivables Diverg.)|
+-----------------------------------------------------------------------------------+
                                              |
                                              v
                           +-------------------------------------+
                           | Phase 3: Runtime Reliability Gate   |
                           | (Live CIK Lookup, Retry & Timeouts) |
                           +-------------------------------------+
                                              |
                                              v
                           +-------------------------------------+
                           | Phase 4: Adversarial & Audit Layer  |
                           | (Bull vs Bear LLMs + Audit Drawer)  |
                           +-------------------------------------+
```

---

### Phase 1: Ingestion — Raw SEC EDGAR & XBRL Reality

**The Challenge:** SEC EDGAR `companyfacts` JSON contains thousands of uncurated XBRL tags across restated periods, quarterly filings (`10-Q`), annual filings (`10-K`), and overlapping durations. Early naive fetches resulted in catastrophic calculation errors (e.g., pulling a 3-month net income figure as an annual figure, producing false $-1217.7\%$ growth claims).

**The Architectural Solution:**
- **Strict XBRL Metadata Filtering:** Filtered raw SEC data strictly by `form: "10-K"`, `fp: "FY"`, and exact 365-day duration tags ($\Delta t \in [350, 380]$ days). Restated figures are resolved by taking the latest `filed` date timestamp.
- **Dynamic CIK Resolver:** Implemented real-time ticker-to-CIK mapping (`https://www.sec.gov/files/company_tickers.json`) with zero-padded 10-digit CIK formatting to support any public US ticker dynamically.

---

### Phase 2: Storage & Deterministic Calculation Engine

**The Challenge:** LLMs are notoriously unreliable at arithmetic. Allowing an LLM to calculate ratios, free cash flows, or year-over-year percentages guarantees financial hallucinations.

**The Architectural Solution:**
- **Zero-LLM Math Core:** All mathematical operations (YoY Growth, Receivables-to-Revenue divergence, Free Cash Flow $OCF - CapEx$) are implemented in pure TypeScript functions with Zod schema validation.
- **Sign-Flip Guard & Math Safety:** Standard growth formulas $\frac{\text{Current} - \text{Prior}}{\text{Prior}}$ break when prior numbers cross zero or are negative (e.g., swinging from $-\$2.7\text{B}$ to $+\$30.4\text{B}$). We introduced sign-flip detection (`sign_flip: true`) to convert raw math breaks into qualitative domain signals (`"turned profitable"`).
- **Rule-Based Anomaly Engine:**
  - `cash_flow_quality_divergence`: Triggers when Operating Cash Flow growth trails Net Income growth by $>10\%$.
  - `receivables_outpacing_revenue`: Triggers when Receivables growth outpaces Revenue growth by $>10\%$.

---

### Phase 3: Reliability & System Hardening

**The Challenge:** Live API calls to SEC EDGAR are rate-limited, subject to intermittent network timeouts, and vary dramatically in schema completeness across tickers (e.g., tech vs. retail vs. cyclical industries).

**The Architectural Solution:**
- **Hybrid Data Pipeline:** Dual-mode architecture combining a pre-curated, instant-load dataset for flagship tickers (`NVDA`, `AAPL`) with a resilient live fetch pipeline for arbitrary tickers (`MSFT`, `AMZN`, `GOOGL`, `TSLA`, `INTC`).
- **Graceful Degraded States:** When management guidance or peer comparison datasets are absent in live mode, the UI explicitly flags reduced scope (`LIVE MODE — LIMITED EVIDENCE`) rather than hallucinating fallback metrics.
- **Fault-Tolerant Retries & Timeouts:** Implemented strict fetch timeouts ($8\text{s}$) with fallback error boundaries.

---

### Phase 4: Transparency & Verification Audit Layer

**The Challenge:** AI financial tools often present LLM summaries as objective truth. If an LLM fabricates a citation or hallucinates an argument, the user has no way of knowing.

**The Architectural Solution:**
- **Adversarial Debate Engine:** A tri-agent framework where a **Bull Agent** and **Bear Agent** compete to interpret verified findings, monitored by an impartial **Judge Agent** that highlights unresolved financial risks.
- **3-Surface Verification Gate:** Every generated Finding, Claim Check, and Debate argument passes through an automated verification barrier (`verification.ts`). Any statement referencing an unverified fact or invalid citation URL is purged before rendering.
- **Audit Drawer UI:** Real-time visual header badge (`🛡️ X items removed by citation verification`) and an audit modal drawer allowing users to inspect discarded claims and rejection logs.

---

## 🛠️ Stack & Technology Choices

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React 19, Vite, Vanilla CSS | Fast rendering, glassmorphic UI, zero heavy CSS framework overhead |
| **Backend API** | Node.js, Express 5, TypeScript | Type safety across financial domains, async execution |
| **Database** | SQLite (`better-sqlite3`) & Turso/libSQL (`@libsql/client`) | Dual-adapter repository architecture: zero-dependency offline local persistence (SQLite) and hosted cloud persistence (Turso) |
| **Data Engine** | Zod, SEC EDGAR XBRL API, BSE / Ind AS | Strict runtime schema enforcement and verified statutory data sources |
| **LLM Orchestration**| Google Gen AI SDK (`@google/genai`) | Constrained Bull/Bear/Judge debate arguments with deterministic fallback |

---

## 🚦 Getting Started

### Prerequisites
- Node.js `v18.0.0` or higher
- npm `v9.0.0` or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/finvestigate.git
cd finvestigate

# Install dependencies
npm install
```

> [!NOTE]
> **Native Dependency Note (`better-sqlite3`):** `better-sqlite3` is a native C++ Node module used for local offline development. On fresh clones, npm automatically pulls prebuilt binaries for your platform.

### Dual-Adapter Persistence Architecture
- **LOCAL (Default): SQLite via `better-sqlite3` (`data/finvestigate.db`):** Zero-setup, fully offline-capable local persistence layer for development and CI requiring zero credentials or network access. Operates in WAL mode with foreign keys enabled, composite primary keys `(run_id, <id>)`, and immutable investigation runs. The local SQLite database is generated at runtime and ignored by Git (`.gitignore`).
- **PRODUCTION: Turso Cloud via `@libsql/client`:** Activated automatically when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are configured. Connects to Turso Cloud (libSQL hosted database in AWS AP South Mumbai) with atomic write batches, preserving the exact same relational schema, composite primary keys, foreign-key enforcement, and forensic invariants. Both adapters implement the shared `InvestigationRepository` interface.
- **Evidence & Reproducibility Fixtures:** The repository retains versioned ground-truth and cache fixtures under `data/cache/` (SEC ticker maps and historical facts), `data/curated/` (pre-verified benchmark company JSONs), and `data/raw/` (cached raw SEC EDGAR XBRL filings).

### Environment & Production Deployment

```bash
# Copy environment configuration
cp .env.example .env
```

#### Production Deployment Prerequisites
In production environments, configure the following environment variables by name (do not commit secrets):
- `TURSO_DATABASE_URL`: Turso Cloud libSQL connection URL.
- `TURSO_AUTH_TOKEN`: Turso Cloud authentication token.
- `API_SECRET_KEY`: Shared secret required to authorize mutating API endpoints (`POST /api/investigations/:ticker/attack`). In production (`NODE_ENV=production`), mutating endpoints fail closed with HTTP 503 if this key is unset, or HTTP 401 if an invalid key is supplied.
- `NODE_ENV`: Set to `production` for production deployments.

FINVESTIGATE supports multi-agent courtroom debate synthesis via **Google Gemini** (`GEMINI_API_KEY`) using the Google Gen AI SDK (`@google/genai`).

> [!IMPORTANT]
> **Graceful Degradation:** The application functions completely with **100% test pass rate even if no Gemini API key is provided**. If `GEMINI_API_KEY` is missing, invalid, or rate-limited, the system automatically and gracefully degrades to its deterministic grounding engine (`mode: "deterministic_fallback"`), ensuring zero crashes or blank screens during judging, CI, and offline demos.

### Running the Application

```bash
# Terminal 1: Express API backend (Runs on http://localhost:3001)
npm run dev:api

# Terminal 2: Vite React Frontend (Runs on http://localhost:5173)
npm run dev:web

# Run Verification Suite & Vitest Tests (110 tests across 15 test files — 100% passing)
npm test
```

---

## 📂 Project Structure

```
Finvestigate/
├── src/
│   ├── client/                    # Frontend Single Page Application (React 19, Vite, Vanilla CSS)
│   │   ├── components/            # Modular UI components (DebatePanel, AttackCenter, TrustScoreboard, etc.)
│   │   ├── types/                 # Client UI view models & types
│   │   ├── main.tsx               # React SPA root component & state orchestrator
│   │   └── styles.css             # Vanilla CSS design system & styles
│   ├── server/                    # Backend service layer (Express 5 REST API)
│   │   ├── api/                   # API server entry & HTTP handlers (CORS, rate limiting, mutation auth)
│   │   ├── application/           # Evidence store & pipeline orchestration services
│   │   ├── domain/                # Financial calculations, findings, scoring & verification gates
│   │   ├── infrastructure/        # External integrations
│   │   │   ├── db/                # Relational DB repositories (SqliteAdapter, TursoAdapter, InvestigationRepository)
│   │   │   ├── llm/               # Multi-agent courtroom debate orchestrator, agents & fallback
│   │   │   └── sources/           # SEC EDGAR XBRL & BSE/Ind AS statutory ingestion adapters
│   │   └── types/                 # Server domain & DB entity schemas
│   └── shared/                    # Universal cross-tier Zod schemas, constants & utilities
├── data/
│   ├── cache/                     # Cached SEC ticker maps and historical facts (reproducibility fixture)
│   ├── curated/                   # Curated benchmarks (NVDA, AAPL, MSFT, AMD, GOOGL, INTC)
│   ├── finvestigate.db            # Local SQLite database (runtime-generated & auto-seeded; git-ignored)
│   └── raw/                       # Cached raw SEC EDGAR XBRL facts (reproducibility fixture)
├── tests/                         # Vitest test suites (110 tests across 15 test files — 100% passing)
│   ├── forensic/                  # Forensic invariant & verification tests (5 files)
│   ├── integration/               # Database (SQLite & Turso), evidence store, EDGAR & LLM integration tests (5 files)
│   ├── security/                  # Adversarial attack API & mutation auth tests (1 file)
│   └── unit/                      # Anomaly rules, calculations & scorer unit tests (4 files)
├── docs/                          # Forensic reports, schema audits, and remediation baselines
├── scripts/                       # LLM benchmarks, regressions & reconciliation scripts
├── LICENSE                        # MIT License
└── README.md                      # System architecture & evaluation guide
```


---

## 🛡️ License

Distributed under the MIT License. See [LICENSE](file:///d:/Projects/Finvestigate/LICENSE) for more information.

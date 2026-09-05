# Finvestigate API Security & Deployment Policy

**Version:** 1.0 (Production Hardened)  
**Date:** September 5, 2026  
**Scope:** REST API endpoints (`src/server/api/server.ts`), Middleware, CORS, and Mutation Authorization  

---

## 1. Endpoint Classification & Authorization Matrix

| Endpoint | HTTP Method | Classification | Auth Requirement | Rate Limit | Description |
|---|---|---|---|---|---|
| `/health` | `GET` | **Public Read-Only** | None | 120 req / min | Liveness & service health check |
| `/api/verification-stats` | `GET` | **Public Read-Only** | None | 120 req / min | Segregated production filing & adversarial verification metrics |
| `/api/investigations/:ticker` | `GET` | **Public Read-Only** | None | 120 req / min | Canonical investigation report, lineage, and debate |
| `/api/investigations/:ticker/attack` | `POST` | **Mutating / Execution** | **API Secret Key Required in Production** | 120 req / min | Adversarial stress-testing injection endpoint |

---

## 2. CORS (Cross-Origin Resource Sharing) Policy

Unrestricted wildcard CORS (`cors()`) has been completely removed in favor of strict origin whitelisting:

- **Default Allowed Origins:**
  - `http://localhost:5173` (Vite dev server)
  - `http://localhost:3000`
  - `http://127.0.0.1:5173`
  - `http://127.0.0.1:3000`
- **Production Configuration:**
  - Configurable via `process.env.ALLOWED_ORIGINS` (comma-separated list of fully qualified domains, e.g. `https://finvestigate.internal,https://app.finvestigate.com`).
  - Requests originating from unapproved origins receive HTTP 403 (`Origin <origin> is not allowed by CORS policy`).
  - Non-browser requests without `Origin` headers (e.g., automated server-to-server health checks, cURL, internal job workers) are permitted.

---

## 3. Mutation Endpoint Security Policy

Mutating operations (such as `/api/investigations/:ticker/attack`) execute simulation runs and append audit logs. They are guarded by the `requireMutationAuth` middleware in `src/server/api/server.ts`:

1. **Production Mode (`NODE_ENV === "production"`):**
   - If `process.env.API_SECRET_KEY` is not configured, the mutation API fails closed immediately with **HTTP 503 Service Unavailable** (`Service Unavailable: Mutation endpoints are disabled in production because API_SECRET_KEY is not configured.`). Anonymous mutation endpoints are never exposed in production.
   - When `process.env.API_SECRET_KEY` is configured, callers must provide the secret key via:
     - `Authorization: Bearer <API_SECRET_KEY>` header, or
     - `X-API-Key: <API_SECRET_KEY>` header.
   - Missing or invalid tokens are immediately rejected with **HTTP 401 Unauthorized** (`Unauthorized: Mutating endpoints require a valid API key or Bearer token.`).
   - Valid tokens are authorized with **HTTP 200 OK** and stamped with the response header `X-Mutation-Auth: authenticated`.
2. **Development / Local Evaluation Mode (`NODE_ENV !== "production"` without `API_SECRET_KEY`):**
   - For frictionless local development, CI testing, and evaluation, requests proceed with a response header `X-Mutation-Auth: development-unrestricted`.

---

## 4. Resource & Abuse Safeguards

1. **Payload Limit:**
   - Body parser is hard-capped at `50kb` (`express.json({ limit: "50kb" })`), rejecting volumetric memory denial-of-service payloads.
2. **Fixed-Window Rate Limiting:**
   - Evaluated per IP address using a fixed 60-second window counter (default: 120 requests/window).
   - Exceeded quotas return **HTTP 429 Too Many Requests** with `retryAfterMs` metadata indicating time remaining until the epoch resets.
3. **Runtime Schema Validation:**
   - All mutation bodies are strictly validated with Zod schemas (`AttackBodySchema`), rejecting unexpected fields or unrecognized attack scenarios with **HTTP 400 Bad Request**.

---

## 5. Production Database Credentials & Secret Management

1. **Environment-Only Secrets:**
   - Turso Cloud credentials (`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`) are supplied strictly through runtime environment variables.
   - Mutation authorization key (`API_SECRET_KEY`) is supplied strictly through runtime environment variables.
2. **Zero Tracked Credentials:**
   - No actual secret values, tokens, or credentials are committed or tracked in Git.
   - All local environment files (`.env`, `.env.local`, `.env.*`) remain ignored in `.gitignore`.
   - `.env.example` provides template placeholders only with zero sensitive values.
3. **Zero-Credential Local Persistence:**
   - Local development and CI use `SqliteAdapter` on `data/finvestigate.db` (git-ignored), requiring zero external credentials, API keys, or cloud access.

import { createClient, type Client, type InStatement } from "@libsql/client";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { InvestigationRepository } from "./repository-interface.js";
import type { Investigation, CompanyRow, VerificationLog, InvestigationRun } from "../../types/index.js";
import type { Fact, Calculation, ClaimCheck, Finding, Debate, Period } from "../../../shared/types/index.js";
import { FactSchema, CalculationSchema, ClaimCheckSchema, FindingSchema, DebateSchema } from "../../../shared/types/index.js";
import { VerificationLogSchema, InvestigationRunSchema } from "../../types/index.js";

export interface TursoConfig {
  url: string;
  authToken?: string;
}

export class TursoAdapter implements InvestigationRepository {
  private client: Client;

  constructor(config?: TursoConfig) {
    const url = config?.url || process.env.TURSO_DATABASE_URL || "file:data/finvestigate.db";
    const authToken = config?.authToken || process.env.TURSO_AUTH_TOKEN;
    this.client = createClient({ url, authToken });
  }

  /**
   * Internal accessor for integration and forensic testing
   */
  getClient(): Client {
    return this.client;
  }

  async init(): Promise<void> {
    // Enable foreign keys
    try {
      await this.client.execute("PRAGMA foreign_keys = ON;");
    } catch {
      // Ignored if remote environment handles PRAGMAs differently
    }

    // Migration: If legacy facts table lacks run_id, drop legacy un-scoped tables and re-create
    try {
      const factTableInfo = await this.client.execute("PRAGMA table_info(facts)");
      const hasFactRunId = factTableInfo.rows.some((col: any) => col.name === "run_id");
      if (factTableInfo.rows.length > 0 && !hasFactRunId) {
        await this.client.executeMultiple(`
          DROP TABLE IF EXISTS findings;
          DROP TABLE IF EXISTS claim_checks;
          DROP TABLE IF EXISTS calculations;
          DROP TABLE IF EXISTS facts;
          DELETE FROM investigation_runs WHERE run_type = 'seed';
        `);
      }

      const debateInfo = await this.client.execute("PRAGMA table_info(debates)");
      const hasDebateId = debateInfo.rows.some((col: any) => col.name === "debate_id");
      if (debateInfo.rows.length > 0 && !hasDebateId) {
        await this.client.executeMultiple(`
          DROP TABLE IF EXISTS debates;
          DROP TABLE IF EXISTS verification_log;
        `);
      }
    } catch {
      // Tables do not exist yet
    }

    // DDL: Create tables and indexes preserving exact relational schema
    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS companies (
        ticker            TEXT PRIMARY KEY,
        cik               TEXT NOT NULL,
        display_name      TEXT NOT NULL,
        is_live_mode      INTEGER NOT NULL DEFAULT 0,
        last_fetched_at   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS investigation_runs (
        run_id            TEXT PRIMARY KEY,
        company_ticker    TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        run_timestamp     TEXT NOT NULL,
        is_live_mode      INTEGER NOT NULL DEFAULT 0,
        is_current        INTEGER NOT NULL DEFAULT 1,
        run_type          TEXT NOT NULL DEFAULT 'live'
      );
      CREATE INDEX IF NOT EXISTS idx_runs_company ON investigation_runs(company_ticker, is_current);

      CREATE TABLE IF NOT EXISTS facts (
        fact_id           TEXT NOT NULL,
        run_id            TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker    TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        metric            TEXT NOT NULL,
        period_label      TEXT NOT NULL,
        period_end_date   TEXT,
        period_kind       TEXT NOT NULL,
        value             REAL,
        unit              TEXT,
        source            TEXT NOT NULL,
        source_url        TEXT,
        statement         TEXT,
        line_item         TEXT,
        accounting_def    TEXT,
        accession_number  TEXT,
        filing_date       TEXT,
        source_page       TEXT,
        reported_value    REAL,
        normalized_value  REAL,
        currency          TEXT,
        type              TEXT NOT NULL DEFAULT 'FACT',
        availability      TEXT NOT NULL DEFAULT 'available',
        PRIMARY KEY (run_id, fact_id)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_company_metric ON facts(company_ticker, metric);
      CREATE INDEX IF NOT EXISTS idx_facts_run ON facts(run_id);

      CREATE TABLE IF NOT EXISTS calculations (
        calc_id           TEXT NOT NULL,
        run_id            TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker    TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        metric            TEXT NOT NULL,
        period_label      TEXT NOT NULL,
        period_end_date   TEXT,
        period_kind       TEXT NOT NULL,
        formula           TEXT NOT NULL,
        input_fact_ids    TEXT NOT NULL,
        value             REAL,
        sign_flip_label   TEXT,
        unit              TEXT,
        type              TEXT NOT NULL DEFAULT 'CALCULATION',
        PRIMARY KEY (run_id, calc_id)
      );
      CREATE INDEX IF NOT EXISTS idx_calc_company_metric ON calculations(company_ticker, metric);
      CREATE INDEX IF NOT EXISTS idx_calc_run ON calculations(run_id);

      CREATE TABLE IF NOT EXISTS claim_checks (
        claim_id            TEXT NOT NULL,
        run_id              TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker      TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        quote               TEXT NOT NULL,
        source              TEXT NOT NULL,
        source_url          TEXT,
        date                TEXT,
        topic               TEXT,
        guidance_vs_actual  TEXT NOT NULL,
        assessment          TEXT NOT NULL,
        type                TEXT NOT NULL DEFAULT 'CLAIM_CHECK',
        PRIMARY KEY (run_id, claim_id)
      );
      CREATE INDEX IF NOT EXISTS idx_claims_run ON claim_checks(run_id);

      CREATE TABLE IF NOT EXISTS findings (
        finding_id            TEXT NOT NULL,
        run_id                TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker        TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        claim                 TEXT NOT NULL,
        evidence              TEXT NOT NULL,
        observation_id        TEXT,
        calculation_refs       TEXT NOT NULL,
        evidence_strength     TEXT NOT NULL,
        severity              TEXT NOT NULL,
        status                 TEXT NOT NULL,
        category               TEXT NOT NULL,
        contradictory_evidence TEXT,
        type                   TEXT NOT NULL DEFAULT 'FINDING',
        PRIMARY KEY (run_id, finding_id)
      );
      CREATE INDEX IF NOT EXISTS idx_findings_company ON findings(company_ticker);
      CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);

      CREATE TABLE IF NOT EXISTS debates (
        debate_id         TEXT NOT NULL,
        run_id            TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker    TEXT NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
        investigated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        bull_case         TEXT NOT NULL,
        bear_case         TEXT NOT NULL,
        judge_verdict     TEXT NOT NULL,
        mode              TEXT,
        PRIMARY KEY (run_id, debate_id)
      );
      CREATE INDEX IF NOT EXISTS idx_debates_company ON debates(company_ticker);
      CREATE INDEX IF NOT EXISTS idx_debates_run ON debates(run_id);

      CREATE TABLE IF NOT EXISTS verification_log (
        verification_id    TEXT NOT NULL,
        run_id             TEXT NOT NULL REFERENCES investigation_runs(run_id) ON DELETE CASCADE,
        company_ticker     TEXT NOT NULL,
        claim_text         TEXT NOT NULL,
        ref_id             TEXT,
        result             TEXT NOT NULL,
        detail             TEXT,
        source_type        TEXT NOT NULL DEFAULT 'production',
        surface            TEXT,
        verification_level TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (run_id, verification_id)
      );
      CREATE INDEX IF NOT EXISTS idx_verification_log_company ON verification_log(company_ticker);
      CREATE INDEX IF NOT EXISTS idx_verification_log_source ON verification_log(source_type);
      CREATE INDEX IF NOT EXISTS idx_verification_log_run ON verification_log(run_id);
    `);

    // Ensure columns exist if tables were created previously
    try {
      const debateTableInfo = await this.client.execute("PRAGMA table_info(debates)");
      const hasMode = debateTableInfo.rows.some((col: any) => col.name === "mode");
      if (!hasMode) {
        await this.client.execute("ALTER TABLE debates ADD COLUMN mode TEXT");
      }
      const hasRunId = debateTableInfo.rows.some((col: any) => col.name === "run_id");
      if (!hasRunId) {
        await this.client.execute("ALTER TABLE debates ADD COLUMN run_id TEXT");
      }

      const tableInfo = await this.client.execute("PRAGMA table_info(verification_log)");
      const hasSourceType = tableInfo.rows.some((col: any) => col.name === "source_type");
      if (!hasSourceType) {
        await this.client.execute("ALTER TABLE verification_log ADD COLUMN source_type TEXT NOT NULL DEFAULT 'production'");
      }
      const hasSurface = tableInfo.rows.some((col: any) => col.name === "surface");
      if (!hasSurface) {
        await this.client.execute("ALTER TABLE verification_log ADD COLUMN surface TEXT");
      }
      const hasVerificationLevel = tableInfo.rows.some((col: any) => col.name === "verification_level");
      if (!hasVerificationLevel) {
        await this.client.execute("ALTER TABLE verification_log ADD COLUMN verification_level TEXT");
      }
      const hasRunIdVerif = tableInfo.rows.some((col: any) => col.name === "run_id");
      if (!hasRunIdVerif) {
        await this.client.execute("ALTER TABLE verification_log ADD COLUMN run_id TEXT");
      }
      await this.client.execute("CREATE INDEX IF NOT EXISTS idx_verification_log_source ON verification_log(source_type)");
      await this.client.execute("CREATE INDEX IF NOT EXISTS idx_verification_log_run ON verification_log(run_id)");
    } catch {
      // Column or index already exists
    }

    // Deterministic provenance enforcement:
    // Ensure all authoritative baseline records from nvda_baseline_verification_logs.json have source_type = 'production'
    try {
      const baselinePath = resolve(process.cwd(), "data", "curated", "nvda_baseline_verification_logs.json");
      if (existsSync(baselinePath)) {
        const baselineContent = readFileSync(baselinePath, "utf8");
        const baselineRows = JSON.parse(baselineContent);
        if (Array.isArray(baselineRows) && baselineRows.length > 0) {
          const updates: InStatement[] = baselineRows.map((r: any) => ({
            sql: "UPDATE verification_log SET source_type = 'production' WHERE verification_id = ?",
            args: [r.id],
          }));
          await this.client.batch(updates, "write");
        }
      }
    } catch {
      // Ignore if file not found in test runner
    }
  }

  async getCompany(ticker: string): Promise<CompanyRow | null> {
    const res = await this.client.execute({
      sql: "SELECT * FROM companies WHERE ticker = ?",
      args: [ticker.toUpperCase()],
    });
    const row = res.rows[0];
    if (!row) return null;
    return {
      ticker: String(row.ticker),
      cik: String(row.cik),
      displayName: String(row.display_name),
      isLiveMode: Boolean(row.is_live_mode),
      lastFetchedAt: row.last_fetched_at ? String(row.last_fetched_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async getFact(factId: string, runId?: string): Promise<Fact | null> {
    let r: any;
    if (runId) {
      const res = await this.client.execute({
        sql: "SELECT * FROM facts WHERE fact_id = ? AND run_id = ?",
        args: [factId, runId],
      });
      r = res.rows[0];
    } else {
      const res = await this.client.execute({
        sql: `
          SELECT f.* FROM facts f
          JOIN investigation_runs r ON f.run_id = r.run_id
          WHERE f.fact_id = ? AND r.is_current = 1
          LIMIT 1
        `,
        args: [factId],
      });
      r = res.rows[0];
      if (!r) {
        const fallback = await this.client.execute({
          sql: "SELECT * FROM facts WHERE fact_id = ? ORDER BY rowid DESC LIMIT 1",
          args: [factId],
        });
        r = fallback.rows[0];
      }
    }
    if (!r) return null;

    return FactSchema.parse({
      factId: String(r.fact_id),
      runId: String(r.run_id),
      company: String(r.company_ticker),
      metric: String(r.metric),
      period: {
        label: String(r.period_label),
        endDate: r.period_end_date ? String(r.period_end_date) : undefined,
        kind: String(r.period_kind) as any,
      },
      value: r.value !== null && r.value !== undefined ? Number(r.value) : null,
      unit: r.unit ? String(r.unit) : null,
      source: String(r.source),
      sourceUrl: r.source_url ? String(r.source_url) : undefined,
      type: r.type,
      availability: r.availability,
      statement: r.statement ? String(r.statement) : undefined,
      lineItem: r.line_item ? String(r.line_item) : undefined,
      accountingDefinition: r.accounting_def ? String(r.accounting_def) : undefined,
      accessionNumber: r.accession_number ? String(r.accession_number) : undefined,
      filingDate: r.filing_date ? String(r.filing_date) : undefined,
      sourcePage: r.source_page ? String(r.source_page) : undefined,
      reportedValue: r.reported_value !== null && r.reported_value !== undefined ? Number(r.reported_value) : (r.value !== null && r.value !== undefined ? Number(r.value) : null),
      normalizedValue: r.normalized_value !== null && r.normalized_value !== undefined ? Number(r.normalized_value) : (r.value !== null && r.value !== undefined ? Number(r.value) : null),
    });
  }

  async getCalculation(calcId: string, runId?: string): Promise<Calculation | null> {
    let r: any;
    if (runId) {
      const res = await this.client.execute({
        sql: "SELECT * FROM calculations WHERE calc_id = ? AND run_id = ?",
        args: [calcId, runId],
      });
      r = res.rows[0];
    } else {
      const res = await this.client.execute({
        sql: `
          SELECT c.* FROM calculations c
          JOIN investigation_runs r ON c.run_id = r.run_id
          WHERE c.calc_id = ? AND r.is_current = 1
          LIMIT 1
        `,
        args: [calcId],
      });
      r = res.rows[0];
      if (!r) {
        const fallback = await this.client.execute({
          sql: "SELECT * FROM calculations WHERE calc_id = ? ORDER BY rowid DESC LIMIT 1",
          args: [calcId],
        });
        r = fallback.rows[0];
      }
    }
    if (!r) return null;

    return CalculationSchema.parse({
      calcId: String(r.calc_id),
      runId: String(r.run_id),
      company: String(r.company_ticker),
      metric: String(r.metric),
      period: {
        label: String(r.period_label),
        endDate: r.period_end_date ? String(r.period_end_date) : undefined,
        kind: String(r.period_kind) as any,
      },
      formula: String(r.formula),
      inputFactIds: JSON.parse(String(r.input_fact_ids)),
      value: r.value !== null && r.value !== undefined ? Number(r.value) : null,
      unit: r.unit ? String(r.unit) : null,
      type: r.type,
    });
  }

  async logVerification(log: Omit<VerificationLog, "id" | "createdAt">): Promise<void> {
    const sourceType = log.sourceType || "production";
    const verificationId = (log as any).id || randomUUID();
    let runId = (log as any).runId;

    if (!runId) {
      const currentRunRes = await this.client.execute({
        sql: "SELECT run_id FROM investigation_runs WHERE company_ticker = ? AND is_current = 1",
        args: [log.companyTicker.toUpperCase()],
      });
      const currentRun = currentRunRes.rows[0];
      if (currentRun) {
        runId = String(currentRun.run_id);
      } else {
        runId = `run-${log.companyTicker.toLowerCase()}-audit`;
        const nowIso = new Date().toISOString();
        await this.client.execute({
          sql: "INSERT OR IGNORE INTO companies (ticker, cik, display_name) VALUES (?, ?, ?)",
          args: [log.companyTicker.toUpperCase(), "AUDIT", log.companyTicker.toUpperCase()],
        });
        await this.client.execute({
          sql: "INSERT OR IGNORE INTO investigation_runs (run_id, company_ticker, run_timestamp, is_current, run_type) VALUES (?, ?, ?, 0, 'live')",
          args: [runId, log.companyTicker.toUpperCase(), nowIso],
        });
      }
    }

    await this.client.execute({
      sql: `
        INSERT INTO verification_log (verification_id, run_id, company_ticker, claim_text, ref_id, result, detail, source_type, surface, verification_level, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, verification_id) DO UPDATE SET
          result = excluded.result,
          detail = excluded.detail
      `,
      args: [
        verificationId,
        runId,
        log.companyTicker.toUpperCase(),
        log.claimText,
        log.refId,
        log.result,
        log.detail,
        sourceType,
        log.surface || null,
        log.verificationLevel || null,
        new Date().toISOString(),
      ],
    });
  }

  async getVerificationLogs(ticker?: string, sourceType?: "production" | "adversarial", runId?: string): Promise<VerificationLog[]> {
    let sql = "SELECT * FROM verification_log";
    const conditions: string[] = [];
    const params: any[] = [];

    if (ticker) {
      conditions.push("company_ticker = ?");
      params.push(ticker.toUpperCase());
    }
    if (sourceType) {
      conditions.push("source_type = ?");
      params.push(sourceType);
    }
    if (runId) {
      conditions.push("run_id = ?");
      params.push(runId);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY created_at DESC";

    const res = await this.client.execute({ sql, args: params });
    return res.rows.map((r: any) =>
      VerificationLogSchema.parse({
        id: String(r.verification_id),
        companyTicker: String(r.company_ticker),
        claimText: String(r.claim_text),
        refId: r.ref_id ? String(r.ref_id) : null,
        result: String(r.result),
        detail: r.detail ? String(r.detail) : null,
        sourceType: (r.source_type as "production" | "adversarial") || "production",
        surface: r.surface ? String(r.surface) : null,
        verificationLevel: r.verification_level ? String(r.verification_level) : null,
        runId: r.run_id ? String(r.run_id) : null,
        createdAt: String(r.created_at),
      })
    );
  }

  async isCacheStale(ticker: string, ttlDays: number): Promise<boolean> {
    const company = await this.getCompany(ticker);
    if (!company) return true;
    if (!company.isLiveMode) return false;
    if (!company.lastFetchedAt) return true;
    const lastFetch = new Date(company.lastFetchedAt).getTime();
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    return Date.now() - lastFetch > ttlMs;
  }

  async saveInvestigation(investigation: Investigation, options?: { isSeed?: boolean; runId?: string }): Promise<void> {
    const ticker = investigation.company.toUpperCase();
    const nowIso = new Date().toISOString();
    const isSeed = options?.isSeed ?? false;
    const runType = isSeed ? "seed" : "live";
    const runId = options?.runId || (isSeed ? `run-${ticker.toLowerCase()}-seed` : `run-${randomUUID()}`);
    investigation.runId = runId;
    const lastFetchedAt = investigation.isLiveMode ? nowIso : ((investigation as any).lastFetchedAt || null);

    // True idempotent seeding: If seed run already exists for this company, do not duplicate or destroy history
    if (isSeed) {
      const existingSeedRun = await this.client.execute({
        sql: "SELECT run_id FROM investigation_runs WHERE company_ticker = ? AND run_type = 'seed'",
        args: [ticker],
      });
      if (existingSeedRun.rows[0]) {
        const hasDebate = await this.client.execute({
          sql: "SELECT debate_id FROM debates WHERE run_id = ?",
          args: [String(existingSeedRun.rows[0].run_id)],
        });
        if (hasDebate.rows[0]) {
          return;
        }
      }
    }

    // Compile atomic write batch to execute in a single round-trip transaction
    const batchStatements: InStatement[] = [];

    // Ensure foreign key enforcement is active in this transaction batch
    batchStatements.push("PRAGMA foreign_keys = ON;");

    // 1. Upsert Company
    batchStatements.push({
      sql: `
        INSERT INTO companies (ticker, cik, display_name, is_live_mode, last_fetched_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
          cik = excluded.cik,
          display_name = excluded.display_name,
          is_live_mode = excluded.is_live_mode,
          last_fetched_at = CASE WHEN excluded.is_live_mode = 1 THEN excluded.last_fetched_at ELSE companies.last_fetched_at END,
          updated_at = excluded.updated_at
      `,
      args: [ticker, investigation.cik, investigation.displayName, investigation.isLiveMode ? 1 : 0, lastFetchedAt, nowIso],
    });

    // 2. Mark previous runs for this company as is_current = 0
    batchStatements.push({
      sql: "UPDATE investigation_runs SET is_current = 0 WHERE company_ticker = ?",
      args: [ticker],
    });

    // 3. Upsert investigation run into immutable history
    batchStatements.push({
      sql: `
        INSERT INTO investigation_runs (run_id, company_ticker, run_timestamp, is_live_mode, is_current, run_type)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          is_current = 1,
          run_timestamp = excluded.run_timestamp
      `,
      args: [runId, ticker, nowIso, investigation.isLiveMode ? 1 : 0, runType],
    });

    // 4. Save Facts with run_id (composite key: run_id, fact_id)
    for (const fact of investigation.facts) {
      fact.runId = runId;
      batchStatements.push({
        sql: `
          INSERT INTO facts (fact_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, value, unit, source, source_url, statement, line_item, accounting_def, accession_number, filing_date, source_page, reported_value, normalized_value, currency, type, availability)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, fact_id) DO UPDATE SET
            value = excluded.value,
            unit = excluded.unit,
            source = excluded.source,
            source_url = excluded.source_url,
            statement = excluded.statement,
            line_item = excluded.line_item,
            accounting_def = excluded.accounting_def,
            accession_number = excluded.accession_number,
            filing_date = excluded.filing_date,
            source_page = excluded.source_page,
            reported_value = excluded.reported_value,
            normalized_value = excluded.normalized_value,
            currency = excluded.currency,
            availability = excluded.availability
        `,
        args: [
          fact.factId,
          runId,
          ticker,
          fact.metric,
          fact.period.label,
          fact.period.endDate || null,
          fact.period.kind,
          fact.value,
          fact.unit || null,
          fact.source,
          fact.sourceUrl || null,
          fact.statement || null,
          fact.lineItem || null,
          fact.accountingDefinition || null,
          fact.accessionNumber || null,
          fact.filingDate || null,
          fact.sourcePage || null,
          (fact as any).reportedValue ?? fact.value,
          fact.normalizedValue ?? fact.value,
          fact.unit === "INR" ? "INR" : "USD",
          fact.type,
          fact.availability,
        ],
      });
    }

    // 5. Save Calculations with run_id (composite key: run_id, calc_id)
    for (const calc of investigation.calculations) {
      calc.runId = runId;
      let signFlipLabel: string | null = null;
      if (calc.formula.startsWith("sign_flip")) {
        const match = calc.formula.match(/^sign_flip \(([^)]+)\)/);
        signFlipLabel = match ? match[1] : "sign_flip";
      }
      batchStatements.push({
        sql: `
          INSERT INTO calculations (calc_id, run_id, company_ticker, metric, period_label, period_end_date, period_kind, formula, input_fact_ids, value, sign_flip_label, unit, type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, calc_id) DO UPDATE SET
            formula = excluded.formula,
            input_fact_ids = excluded.input_fact_ids,
            value = excluded.value,
            sign_flip_label = excluded.sign_flip_label,
            unit = excluded.unit
        `,
        args: [
          calc.calcId,
          runId,
          ticker,
          calc.metric,
          calc.period.label,
          calc.period.endDate,
          calc.period.kind,
          calc.formula,
          JSON.stringify(calc.inputFactIds),
          calc.value,
          signFlipLabel,
          calc.unit,
          calc.type,
        ],
      });
    }

    // 6. Save Claim Checks with run_id (composite key: run_id, claim_id)
    for (const claim of investigation.claimChecks || []) {
      claim.runId = runId;
      batchStatements.push({
        sql: `
          INSERT INTO claim_checks (claim_id, run_id, company_ticker, quote, source, source_url, date, topic, guidance_vs_actual, assessment, type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, claim_id) DO UPDATE SET
            quote = excluded.quote,
            source = excluded.source,
            source_url = excluded.source_url,
            date = excluded.date,
            topic = excluded.topic,
            guidance_vs_actual = excluded.guidance_vs_actual,
            assessment = excluded.assessment
        `,
        args: [
          claim.claimId,
          runId,
          ticker,
          claim.quote,
          claim.source,
          claim.sourceUrl || null,
          claim.date || null,
          claim.topic || null,
          JSON.stringify(claim.guidanceVsActual),
          claim.assessment,
          claim.type,
        ],
      });
    }

    // 7. Save Findings with run_id (composite key: run_id, finding_id)
    for (const finding of investigation.findings || []) {
      finding.runId = runId;
      batchStatements.push({
        sql: `
          INSERT INTO findings (finding_id, run_id, company_ticker, claim, evidence, observation_id, calculation_refs, evidence_strength, severity, status, category, contradictory_evidence, type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, finding_id) DO UPDATE SET
            claim = excluded.claim,
            evidence = excluded.evidence,
            observation_id = excluded.observation_id,
            calculation_refs = excluded.calculation_refs,
            evidence_strength = excluded.evidence_strength,
            severity = excluded.severity,
            status = excluded.status,
            category = excluded.category,
            contradictory_evidence = excluded.contradictory_evidence
        `,
        args: [
          finding.findingId,
          runId,
          ticker,
          finding.claim,
          JSON.stringify(finding.evidence),
          finding.observationId || null,
          JSON.stringify(finding.calculationRefs),
          finding.evidenceStrength,
          finding.severity,
          finding.status,
          finding.category,
          finding.contradictoryEvidence || null,
          finding.type,
        ],
      });
    }

    // 8. Save Debate with run_id (composite key: run_id, debate_id)
    if (investigation.debate) {
      investigation.debate.runId = runId;
      const debateId = isSeed ? `debate-${ticker.toLowerCase()}-seed` : `debate-${runId}`;
      batchStatements.push({
        sql: `
          INSERT INTO debates (debate_id, run_id, company_ticker, investigated_at, bull_case, bear_case, judge_verdict, mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, debate_id) DO UPDATE SET
            bull_case = excluded.bull_case,
            bear_case = excluded.bear_case,
            judge_verdict = excluded.judge_verdict,
            mode = excluded.mode
        `,
        args: [
          debateId,
          runId,
          ticker,
          nowIso,
          JSON.stringify(investigation.debate.bullCase),
          JSON.stringify(investigation.debate.bearCase),
          JSON.stringify(investigation.debate.judgeVerdict),
          investigation.debate.mode || "deterministic_fallback",
        ],
      });
    }

    // Execute atomic batch transaction
    await this.client.batch(batchStatements, "write");
  }

  async getInvestigation(ticker: string, runId?: string): Promise<Investigation | null> {
    const normalized = ticker.toUpperCase();
    const company = await this.getCompany(normalized);
    if (!company) return null;

    let targetRunId = runId;
    if (!targetRunId) {
      const activeRun = await this.client.execute({
        sql: "SELECT run_id FROM investigation_runs WHERE company_ticker = ? AND is_current = 1 ORDER BY run_timestamp DESC LIMIT 1",
        args: [normalized],
      });
      if (activeRun.rows[0]) {
        targetRunId = String(activeRun.rows[0].run_id);
      } else {
        const latestRun = await this.client.execute({
          sql: "SELECT run_id FROM investigation_runs WHERE company_ticker = ? ORDER BY run_timestamp DESC LIMIT 1",
          args: [normalized],
        });
        if (latestRun.rows[0]) targetRunId = String(latestRun.rows[0].run_id);
      }
    }

    if (!targetRunId) return null;

    // Load Facts filtered by run_id
    const factRowsRes = await this.client.execute({
      sql: "SELECT * FROM facts WHERE company_ticker = ? AND run_id = ?",
      args: [normalized, targetRunId],
    });
    const facts: Fact[] = factRowsRes.rows.map((r: any) =>
      FactSchema.parse({
        factId: String(r.fact_id),
        runId: String(r.run_id),
        company: String(r.company_ticker),
        metric: String(r.metric),
        period: {
          label: String(r.period_label),
          endDate: r.period_end_date ? String(r.period_end_date) : undefined,
          kind: String(r.period_kind) as any,
        },
        value: r.value !== null && r.value !== undefined ? Number(r.value) : null,
        unit: r.unit ? String(r.unit) : null,
        source: String(r.source),
        sourceUrl: r.source_url ? String(r.source_url) : undefined,
        type: r.type,
        availability: r.availability,
        statement: r.statement ? String(r.statement) : undefined,
        lineItem: r.line_item ? String(r.line_item) : undefined,
        accountingDefinition: r.accounting_def ? String(r.accounting_def) : undefined,
        accessionNumber: r.accession_number ? String(r.accession_number) : undefined,
        filingDate: r.filing_date ? String(r.filing_date) : undefined,
        sourcePage: r.source_page ? String(r.source_page) : undefined,
        reportedValue: r.reported_value !== null && r.reported_value !== undefined ? Number(r.reported_value) : (r.value !== null && r.value !== undefined ? Number(r.value) : null),
        normalizedValue: r.normalized_value !== null && r.normalized_value !== undefined ? Number(r.normalized_value) : (r.value !== null && r.value !== undefined ? Number(r.value) : null),
      })
    );

    // Load Calculations filtered by run_id
    const calcRowsRes = await this.client.execute({
      sql: "SELECT * FROM calculations WHERE company_ticker = ? AND run_id = ?",
      args: [normalized, targetRunId],
    });
    const calculations: Calculation[] = calcRowsRes.rows.map((r: any) =>
      CalculationSchema.parse({
        calcId: String(r.calc_id),
        runId: String(r.run_id),
        company: String(r.company_ticker),
        metric: String(r.metric),
        period: {
          label: String(r.period_label),
          endDate: r.period_end_date ? String(r.period_end_date) : undefined,
          kind: String(r.period_kind) as any,
        },
        formula: String(r.formula),
        inputFactIds: JSON.parse(String(r.input_fact_ids)),
        value: r.value !== null && r.value !== undefined ? Number(r.value) : null,
        unit: r.unit ? String(r.unit) : null,
        type: r.type,
      })
    );

    // Load Claim Checks filtered by run_id
    const claimRowsRes = await this.client.execute({
      sql: "SELECT * FROM claim_checks WHERE company_ticker = ? AND run_id = ?",
      args: [normalized, targetRunId],
    });
    const claimChecks: ClaimCheck[] = claimRowsRes.rows.map((r: any) =>
      ClaimCheckSchema.parse({
        claimId: String(r.claim_id),
        runId: String(r.run_id),
        company: String(r.company_ticker),
        quote: String(r.quote),
        source: String(r.source),
        sourceUrl: r.source_url ? String(r.source_url) : undefined,
        date: r.date ? String(r.date) : undefined,
        topic: r.topic ? String(r.topic) : undefined,
        guidanceVsActual: JSON.parse(String(r.guidance_vs_actual)),
        assessment: r.assessment ? String(r.assessment) : "",
        type: r.type,
      })
    );

    // Load Findings filtered by run_id
    const findingRowsRes = await this.client.execute({
      sql: "SELECT * FROM findings WHERE company_ticker = ? AND run_id = ?",
      args: [normalized, targetRunId],
    });
    const findings: Finding[] = findingRowsRes.rows.map((r: any) =>
      FindingSchema.parse({
        findingId: String(r.finding_id),
        runId: String(r.run_id),
        company: String(r.company_ticker),
        claim: String(r.claim),
        evidence: JSON.parse(String(r.evidence)),
        observationId: r.observation_id ? String(r.observation_id) : undefined,
        calculationRefs: JSON.parse(String(r.calculation_refs)),
        evidenceStrength: r.evidence_strength,
        severity: r.severity,
        status: r.status,
        category: r.category,
        contradictoryEvidence: r.contradictory_evidence ? String(r.contradictory_evidence) : undefined,
        type: r.type,
      })
    );

    // Load Latest Debate for this run
    let debate = await this.getLatestDebate(normalized, targetRunId);

    // Derive anomalies
    const { detectAnomalies } = await import("../../domain/findings.js");
    const anomalies = detectAnomalies(normalized, calculations);

    if (!debate) {
      const { generateLiveDebate } = await import("../llm/live-debate.js");
      debate = {
        ...generateLiveDebate(
          company.ticker,
          company.displayName,
          calculations,
          findings,
          facts
        ),
        mode: "deterministic_fallback",
        runId: targetRunId,
      };
      const debateId = `debate-${targetRunId}`;
      try {
        await this.client.execute({
          sql: `
            INSERT INTO debates (debate_id, run_id, company_ticker, investigated_at, bull_case, bear_case, judge_verdict, mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, debate_id) DO UPDATE SET
              bull_case = excluded.bull_case,
              bear_case = excluded.bear_case,
              judge_verdict = excluded.judge_verdict,
              mode = excluded.mode
          `,
          args: [
            debateId,
            targetRunId,
            company.ticker,
            new Date().toISOString(),
            JSON.stringify(debate.bullCase),
            JSON.stringify(debate.bearCase),
            JSON.stringify(debate.judgeVerdict),
            debate.mode || null,
          ],
        });
      } catch {
        // Non-fatal
      }
    } else if (debate.mode !== "ai_grounded" || !debate.judgeVerdict.bullScore || !debate.bullCase.factors) {
      const { calculateFundamentalScores } = await import("../../domain/fundamental-scorer.js");
      const scores = calculateFundamentalScores(calculations, findings, facts);
      debate.bullCase.overallStrength = scores.bullScore;
      debate.bullCase.factors = scores.bullFactors;
      debate.bearCase.overallStrength = scores.bearScore;
      debate.bearCase.factors = scores.bearFactors;
      debate.judgeVerdict.bullScore = scores.bullScore;
      debate.judgeVerdict.bearScore = scores.bearScore;
      debate.judgeVerdict.bullFactors = scores.bullFactors;
      debate.judgeVerdict.bearFactors = scores.bearFactors;
      if (!debate.judgeVerdict.evidenceQuality) {
        debate.judgeVerdict.evidenceQuality = scores.evidenceQuality;
      }
    }

    return {
      company: company.ticker,
      displayName: company.displayName,
      cik: company.cik,
      runId: targetRunId,
      facts,
      claimChecks,
      findings,
      debate: debate || undefined,
      calculations,
      anomalies,
      isLiveMode: company.isLiveMode,
    };
  }

  async getLatestDebate(ticker: string, runId?: string): Promise<Debate | null> {
    let row: any;
    if (runId) {
      const res = await this.client.execute({
        sql: "SELECT * FROM debates WHERE company_ticker = ? AND run_id = ? ORDER BY investigated_at DESC LIMIT 1",
        args: [ticker.toUpperCase(), runId],
      });
      row = res.rows[0];
    }
    if (!row) {
      const res = await this.client.execute({
        sql: "SELECT * FROM debates WHERE company_ticker = ? ORDER BY investigated_at DESC LIMIT 1",
        args: [ticker.toUpperCase()],
      });
      row = res.rows[0];
    }

    if (!row) return null;

    return DebateSchema.parse({
      bullCase: JSON.parse(String(row.bull_case)),
      bearCase: JSON.parse(String(row.bear_case)),
      judgeVerdict: JSON.parse(String(row.judge_verdict)),
      mode: row.mode ? String(row.mode) : undefined,
      runId: row.run_id ? String(row.run_id) : undefined,
    });
  }

  async getDebateHistory(ticker: string): Promise<Debate[]> {
    const res = await this.client.execute({
      sql: "SELECT * FROM debates WHERE company_ticker = ? ORDER BY investigated_at DESC",
      args: [ticker.toUpperCase()],
    });

    return res.rows.map((row: any) =>
      DebateSchema.parse({
        bullCase: JSON.parse(String(row.bull_case)),
        bearCase: JSON.parse(String(row.bear_case)),
        judgeVerdict: JSON.parse(String(row.judge_verdict)),
        mode: row.mode ? String(row.mode) : undefined,
        runId: row.run_id ? String(row.run_id) : undefined,
      })
    );
  }

  async getInvestigationRuns(ticker: string): Promise<InvestigationRun[]> {
    const res = await this.client.execute({
      sql: "SELECT * FROM investigation_runs WHERE company_ticker = ? ORDER BY run_timestamp DESC",
      args: [ticker.toUpperCase()],
    });

    return res.rows.map((r: any) =>
      InvestigationRunSchema.parse({
        runId: String(r.run_id),
        companyTicker: String(r.company_ticker),
        runTimestamp: String(r.run_timestamp),
        isLiveMode: Boolean(r.is_live_mode),
        isCurrent: Boolean(r.is_current),
        runType: String(r.run_type),
      })
    );
  }

  async seedCuratedData(): Promise<void> {
    const curatedDir = resolve(process.cwd(), "data", "curated");
    const { buildCoreCalculations } = await import("../../domain/calculations.js");
    const { detectAnomalies } = await import("../../domain/findings.js");
    const { calculateFundamentalScores } = await import("../../domain/fundamental-scorer.js");

    // Dynamic discovery of curated files without hardcoding
    let files: string[] = [];
    try {
      files = await readdir(curatedDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".json") || file.includes("verification_logs")) continue;
      try {
        const path = join(curatedDir, file);
        const content = await readFile(path, "utf8");
        const parsed = JSON.parse(content);

        // Only seed complete curated investigation benchmarks (containing debate and facts)
        if (!parsed.company || !parsed.debate || !Array.isArray(parsed.facts)) {
          continue;
        }

        const periods: Period[] = [...new Map(parsed.facts.map((fact: any) => [fact.period.label, fact.period])).values()]
          .sort((left: any, right: any) => right.endDate.localeCompare(left.endDate)) as Period[];

        const calculations = buildCoreCalculations(parsed.company, parsed.facts, periods[0], periods[1]);
        const anomalies = detectAnomalies(parsed.company, calculations);

        const investigation: Investigation = {
          ...parsed,
          calculations,
          anomalies,
          isLiveMode: false,
        };

        if (investigation.debate) {
          const scores = calculateFundamentalScores(calculations, parsed.findings || [], parsed.facts || []);
          investigation.debate.bullCase.overallStrength = scores.bullScore;
          investigation.debate.bullCase.factors = scores.bullFactors;
          investigation.debate.bearCase.overallStrength = scores.bearScore;
          investigation.debate.bearCase.factors = scores.bearFactors;
          investigation.debate.judgeVerdict.bullScore = scores.bullScore;
          investigation.debate.judgeVerdict.bearScore = scores.bearScore;
          investigation.debate.judgeVerdict.bullFactors = scores.bullFactors;
          investigation.debate.judgeVerdict.bearFactors = scores.bearFactors;
          investigation.debate.judgeVerdict.evidenceQuality = scores.evidenceQuality;
        }

        await this.saveInvestigation(investigation, { isSeed: true });
      } catch (err) {
        console.warn(`Failed to seed curated company from ${file}:`, err instanceof Error ? err.message : err);
      }
    }

    // Seed authoritative baseline verification logs for NVDA if none exist
    try {
      const existingNvdaLogs = await this.client.execute(
        "SELECT count(*) as count FROM verification_log WHERE company_ticker = 'NVDA' AND source_type = 'production'"
      );
      const countVal = existingNvdaLogs.rows[0] ? Number(existingNvdaLogs.rows[0].count) : 0;
      if (countVal === 0) {
        const baselinePath = join(curatedDir, "nvda_baseline_verification_logs.json");
        if (existsSync(baselinePath)) {
          const baselineContent = await readFile(baselinePath, "utf8");
          const baselineRows = JSON.parse(baselineContent);
          if (Array.isArray(baselineRows) && baselineRows.length > 0) {
            const insertStatements: InStatement[] = baselineRows.map((r: any) => ({
              sql: `
                INSERT OR REPLACE INTO verification_log (verification_id, run_id, company_ticker, claim_text, ref_id, result, detail, source_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              args: [r.id, "run-nvda-seed", r.companyTicker, r.claimText, r.refId, r.result, r.detail, r.sourceType || "production", r.createdAt],
            }));
            await this.client.batch(insertStatements, "write");
          }
        }
      }
    } catch (err) {
      console.warn("Failed to seed baseline verification logs:", err instanceof Error ? err.message : err);
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

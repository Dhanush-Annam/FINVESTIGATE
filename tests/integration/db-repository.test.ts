import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SqliteAdapter } from "../../src/server/infrastructure/db/sqlite-adapter.js";
import { setRepositoryForTest } from "../../src/server/infrastructure/db/repository.js";
import { loadInvestigation } from "../../src/server/application/evidence-store.js";
import * as liveEdgar from "../../src/server/infrastructure/sources/live-edgar.js";
import * as orchestrator from "../../src/server/infrastructure/llm/orchestrator.js";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";

vi.spyOn(orchestrator, "generateConstrainedAIDebate").mockImplementation(async (inv: any) => ({
  bullCase: { arguments: [], overallStrength: 5 },
  bearCase: { arguments: [], overallStrength: 5 },
  judgeVerdict: { evidenceQuality: "HIGH", mostImportantUnresolvedQuestion: "None", explanation: "Mock" },
  mode: "deterministic_fallback",
}));

describe("Phase 2 — Relational Database Repository Suite", () => {
  let adapter: SqliteAdapter;
  const testDbPath = resolve(process.cwd(), "data", "test_finvestigate.db");

  beforeEach(async () => {
    try {
      await unlink(testDbPath);
    } catch (_err) {}

    adapter = new SqliteAdapter(testDbPath);
    await adapter.init();
    try {
      (adapter as any).db.exec("DELETE FROM companies; DELETE FROM facts; DELETE FROM calculations; DELETE FROM findings; DELETE FROM claim_checks; DELETE FROM debates; DELETE FROM verification_log;");
    } catch (_e) {}
    setRepositoryForTest(adapter);
  });

  afterEach(async () => {
    setRepositoryForTest(null);
    await adapter.close();
    try {
      await unlink(testDbPath);
    } catch (_err) {}
    vi.restoreAllMocks();
  });

  it("idempotently seeds curated dataset twice without duplication or errors", async () => {
    await adapter.seedCuratedData();
    await adapter.seedCuratedData();

    const nvda = await adapter.getInvestigation("NVDA");
    expect(nvda).not.toBeNull();
    expect(nvda?.company).toBe("NVDA");
    expect(nvda?.facts.length).toBeGreaterThan(0);

    const aapl = await adapter.getInvestigation("AAPL");
    expect(aapl).not.toBeNull();
    expect(aapl?.company).toBe("AAPL");

    // Assert debates are NOT duplicated across multiple seed runs
    const nvdaDebates = (adapter as any).db.prepare("SELECT COUNT(*) as count FROM debates WHERE company_ticker = 'NVDA'").get();
    expect(nvdaDebates.count).toBe(1);

    const aaplDebates = (adapter as any).db.prepare("SELECT COUNT(*) as count FROM debates WHERE company_ticker = 'AAPL'").get();
    expect(aaplDebates.count).toBe(1);
  });

  it("preserves exact Zod schema shape & null values on save -> load roundtrip", async () => {
    await adapter.seedCuratedData();
    const nvda = await adapter.getInvestigation("NVDA");

    expect(nvda).not.toBeNull();
    expect(nvda?.company).toBe("NVDA");
    expect(nvda?.facts).toHaveLength(10);
    expect(nvda?.claimChecks).toHaveLength(3);
    expect(nvda?.findings).toHaveLength(1);
    expect(nvda?.debate?.judgeVerdict.evidenceQuality).toBe("HIGH");

    // Test sign_flip calculation preservation with null value
    const signFlipCalc = nvda?.calculations.find((c) => c.formula.startsWith("sign_flip"));
    if (signFlipCalc) {
      expect(signFlipCalc.value).toBeNull();
    }
  });

  it("persists and round-trips debate mode ('ai_grounded' and 'deterministic_fallback')", async () => {
    await adapter.seedCuratedData();
    const nvda = await adapter.getInvestigation("NVDA");
    expect(nvda).not.toBeNull();

    // Set mode to ai_grounded and save
    nvda!.debate!.mode = "ai_grounded";
    await adapter.saveInvestigation(nvda!);

    const fetchedDebate = await adapter.getLatestDebate("NVDA");
    expect(fetchedDebate).not.toBeNull();
    expect(fetchedDebate?.mode).toBe("ai_grounded");

    // Set mode to deterministic_fallback and save
    nvda!.debate!.mode = "deterministic_fallback";
    await adapter.saveInvestigation(nvda!);

    const fetchedFallback = await adapter.getLatestDebate("NVDA");
    expect(fetchedFallback).not.toBeNull();
    expect(fetchedFallback?.mode).toBe("deterministic_fallback");
  });

  it("curated data does not set live last_fetched_at and is not subject to TTL expiration", async () => {
    await adapter.seedCuratedData();
    const company = await adapter.getCompany("NVDA");
    expect(company).not.toBeNull();
    expect(company?.isLiveMode).toBe(false);
    expect(company?.lastFetchedAt).toBeNull();

    // Curated data should never report stale
    const isStale = await adapter.isCacheStale("NVDA", 1);
    expect(isStale).toBe(false);
  });

  it("locks concurrent investigations for the same ticker to prevent duplicate fetches", async () => {
    await adapter.seedCuratedData();
    const fetchSpy = vi.spyOn(liveEdgar, "fetchLiveCompanyFacts");

    // Launch 3 concurrent loadInvestigation calls for INTC
    const [res1, res2, res3] = await Promise.all([
      loadInvestigation("INTC"),
      loadInvestigation("INTC"),
      loadInvestigation("INTC"),
    ]);

    expect(res1.company).toBe("INTC");
    expect(res2.company).toBe("INTC");
    expect(res3.company).toBe("INTC");

    // Even with 3 concurrent requests, exactly 1 EDGAR fetch was made
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }, 45000);

  it("hits DB on second call and does NOT invoke EDGAR fetch within TTL window", async () => {
    await adapter.seedCuratedData();
    const fetchSpy = vi.spyOn(liveEdgar, "fetchLiveCompanyFacts");

    // First load hits seeded DB
    const first = await loadInvestigation("NVDA");
    expect(first.company).toBe("NVDA");
    expect(fetchSpy).not.toHaveBeenCalled();

    // Second call for MSFT (live)
    const msft1 = await loadInvestigation("MSFT");
    expect(msft1.company).toBe("MSFT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Immediate second call for MSFT should hit DB, NOT EDGAR
    const msft2 = await loadInvestigation("MSFT");
    expect(msft2.company).toBe("MSFT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }, 30000);

  it("triggers refetch when database cache becomes stale beyond TTL", async () => {
    await adapter.seedCuratedData();
    const fetchSpy = vi.spyOn(liveEdgar, "fetchLiveCompanyFacts");

    await loadInvestigation("MSFT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Manually age the last_fetched_at in DB by 91 days
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    (adapter as any).db.prepare("UPDATE companies SET last_fetched_at = ? WHERE ticker = 'MSFT'").run(oldDate);

    expect(await adapter.isCacheStale("MSFT", 90)).toBe(true);

    // Call loadInvestigation again - should trigger refetch
    await loadInvestigation("MSFT");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 45000);

  it("passes PRAGMA integrity_check and foreign_key_check with zero errors", () => {
    const integrity = (adapter as any).db.pragma("integrity_check");
    expect(integrity).toEqual([{ integrity_check: "ok" }]);

    const fk = (adapter as any).db.pragma("foreign_key_check");
    expect(fk).toEqual([]);
  });
});

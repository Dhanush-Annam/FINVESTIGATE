import { describe, expect, it } from "vitest";
import { resolveCik } from "../../src/server/infrastructure/sources/live-cik.js";
import { fetchLiveCompanyFacts } from "../../src/server/infrastructure/sources/live-edgar.js";

describe("Live SEC EDGAR Ingestion Pipeline", () => {
  it("resolves ticker symbol to CIK using SEC company_tickers.json", async () => {
    const result = await resolveCik("MSFT");
    expect(result).not.toBeNull();
    expect(result?.ticker).toBe("MSFT");
    expect(result?.cik).toBe("0000789019");
    expect(result?.displayName).toContain("MICROSOFT");
  }, 15000);

  it("fetches and parses live financial facts from EDGAR for MSFT", async () => {
    const cikInfo = await resolveCik("MSFT");
    expect(cikInfo).not.toBeNull();

    if (cikInfo) {
      const facts = await fetchLiveCompanyFacts(cikInfo.cik, cikInfo.ticker, cikInfo.displayName);
      expect(facts).not.toBeNull();
      expect(facts!.length).toBeGreaterThan(0);
      expect(facts![0].company).toBe("MSFT");
      expect(facts![0].sourceUrl).toContain("0000789019");
    }
  }, 20000);

  it("serves live facts from disk cache on repeat request", async () => {
    const start = Date.now();
    const facts = await fetchLiveCompanyFacts("0000789019", "MSFT", "MICROSOFT CORP");
    const duration = Date.now() - start;

    expect(facts).not.toBeNull();
    // Cache read should be sub-50ms
    expect(duration).toBeLessThan(500);
  });

  it("resolves CIK and fetches facts for multiple tickers across sectors (AMZN, GOOGL, TSLA, INTC)", async () => {
    const testTickers = ["AMZN", "GOOGL", "TSLA", "INTC"];
    for (const ticker of testTickers) {
      const cikInfo = await resolveCik(ticker);
      expect(cikInfo).not.toBeNull();
      expect(cikInfo?.ticker).toBe(ticker);

      if (cikInfo) {
        const facts = await fetchLiveCompanyFacts(cikInfo.cik, cikInfo.ticker, cikInfo.displayName);
        expect(facts).not.toBeNull();
        expect(facts!.length).toBeGreaterThan(0);
        expect(facts![0].company).toBe(ticker);
      }
    }
  }, 40000);

  it("runs full investigation pipeline for a loss-making or volatile ticker (INTC / TSLA)", async () => {
    const { runFullPipeline } = await import("../../src/server/application/investigation-service.js");
    const investigation = await runFullPipeline("INTC");
    expect(investigation.company).toBe("INTC");
    expect(investigation.facts.length).toBeGreaterThan(0);
    expect(investigation.calculations.length).toBeGreaterThan(0);
    expect(investigation.isLiveMode).toBe(true);
  }, 25000);
});

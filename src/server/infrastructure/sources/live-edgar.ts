import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Fact, Period } from "../../../shared/types/index.js";

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || "Finvestigate Research contact@finvestigate.dev";

const SEC_DATA_HEADERS = {
  "User-Agent": SEC_USER_AGENT,
  "Accept-Encoding": "gzip, deflate",
  "Host": "data.sec.gov",
};

// Rate limiter: Max 10 requests per second across SEC requests, with strict async queueing
class SecRateLimiter {
  private lastCallTime = 0;
  private minIntervalMs = 105; // ~9.5 req/sec safety margin under SEC 10 req/sec cap
  private queue: Promise<void> = Promise.resolve();

  async throttle(): Promise<void> {
    const result = this.queue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.minIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
      }
      this.lastCallTime = Date.now();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

export const secRateLimiter = new SecRateLimiter();

type EdgarUnitFact = {
  start?: string;
  end: string;
  val: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
};

type EdgarConcept = {
  label: string;
  units?: {
    USD?: EdgarUnitFact[];
    INR?: EdgarUnitFact[];
  };
};

export const GAAP_TAG_MAPPINGS: Record<string, string[]> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractsWithCustomers",
    "Revenues",
    "SalesRevenueNet",
    "Revenue",
  ],
  netIncome: [
    "NetIncomeLoss",
    "ProfitLoss",
  ],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "CashFlowsFromUsedInOperatingActivities",
  ],
  receivables: [
    "AccountsReceivableNetCurrent",
    "TradeAndOtherCurrentReceivables",
    "CurrentTradeReceivables",
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ],
};

export const IFRS_TAG_MAPPINGS: Record<string, string[]> = {
  revenue: [
    "RevenueFromContractsWithCustomers",
    "Revenue",
    "Revenues",
  ],
  netIncome: [
    "ProfitLoss",
    "ProfitLossFromOperatingActivities",
  ],
  operatingCashFlow: [
    "CashFlowsFromUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivities",
  ],
  receivables: [
    "TradeAndOtherCurrentReceivables",
    "CurrentTradeReceivables",
    "TradeReceivables",
  ],
  capex: [
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipment",
  ],
};

const CACHE_DIR = resolve(process.cwd(), "data", "cache");
const EDGAR_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days cache on disk

interface CachedEdgarFacts {
  timestamp: number;
  facts: Fact[];
}

async function getCachedFacts(ticker: string): Promise<Fact[] | null> {
  try {
    const cachePath = join(CACHE_DIR, `${ticker.toLowerCase()}_facts.json`);
    const raw = await readFile(cachePath, "utf8");
    const data = JSON.parse(raw) as CachedEdgarFacts;
    if (Date.now() - data.timestamp < EDGAR_CACHE_TTL_MS && Array.isArray(data.facts) && data.facts.length > 0) {
      return data.facts;
    }
  } catch (_err) {
    // Cache miss or read error
  }
  return null;
}

async function setCachedFacts(ticker: string, facts: Fact[]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const cachePath = join(CACHE_DIR, `${ticker.toLowerCase()}_facts.json`);
    const payload: CachedEdgarFacts = {
      timestamp: Date.now(),
      facts,
    };
    await writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn(`Failed to write cache for ${ticker}:`, err instanceof Error ? err.message : err);
  }
}

async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    await secRateLimiter.throttle();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal as any,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      // Retry on 429 Too Many Requests or 5xx server errors
      if (response.status === 429 || response.status >= 500) {
        attempt++;
        if (attempt <= maxRetries) {
          const backoff = Math.pow(2, attempt) * 500;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      attempt++;
      if (attempt <= maxRetries) {
        const backoff = Math.pow(2, attempt) * 500;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries.`);
}

export async function fetchLiveCompanyFacts(cik: string, ticker: string, displayName: string): Promise<Fact[] | null> {
  const normalizedTicker = ticker.toUpperCase();

  // 1. Check disk cache first
  const cached = await getCachedFacts(normalizedTicker);
  if (cached) {
    return cached;
  }

  const paddedCik = cik.padStart(10, "0");
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

  try {
    const response = await fetchWithRetry(url, SEC_DATA_HEADERS);

    if (!response.ok) {
      console.warn(`SEC EDGAR returned status ${response.status} for CIK ${paddedCik}`);
      return null;
    }

    const edgarData = (await response.json()) as any;
    const isGaap = Boolean(edgarData?.facts?.["us-gaap"]);
    const isIfrs = Boolean(edgarData?.facts?.["ifrs-full"]);
    const taxonomy = isGaap
      ? edgarData.facts["us-gaap"]
      : isIfrs
      ? edgarData.facts["ifrs-full"]
      : null;
    if (!taxonomy) return null;

    const tagMappings = isGaap ? GAAP_TAG_MAPPINGS : IFRS_TAG_MAPPINGS;
    const accountingStandard = isGaap ? "US-GAAP" : "IFRS";
    const facts: Fact[] = [];

    for (const [targetMetric, tags] of Object.entries(tagMappings)) {
      let concept: EdgarConcept | undefined;
      let matchedTag = "";
      for (const tag of tags) {
        if (taxonomy[tag]) {
          concept = taxonomy[tag];
          matchedTag = tag;
          break;
        }
      }

      const unitsList = concept?.units?.USD || concept?.units?.INR;
      const factUnit = concept?.units?.USD ? "USD" : concept?.units?.INR ? "INR" : null;
      if (!concept || !unitsList || !factUnit) continue;

      // Filter for annual (10-K or 20-F) facts
      const annualFacts = unitsList.filter((u) => {
        const isAnnualForm = u.form === "10-K" || u.form === "20-F";
        if (!isAnnualForm || u.fp !== "FY" || u.val === undefined) return false;
        
        if (u.start) {
          // Duration fact (income statement, cash flow): must span ~340-390 days
          const startTime = new Date(u.start).getTime();
          const endTime = new Date(u.end).getTime();
          const days = (endTime - startTime) / (1000 * 60 * 60 * 24);
          return days >= 340 && days <= 390;
        } else {
          // Instant fact (balance sheet e.g. receivables): end date year is fiscal year
          return true;
        }
      });
      
      // Group by actual fiscal year of the end date, pick latest filed entry per year
      const yearMap = new Map<number, EdgarUnitFact>();
      for (const f of annualFacts) {
        const actualFy = parseInt(f.end.substring(0, 4), 10);
        if (isNaN(actualFy) || actualFy < 2023) continue;
        const existing = yearMap.get(actualFy);
        if (!existing || f.filed > existing.filed) {
          yearMap.set(actualFy, f);
        }
      }

      for (const [fy, u] of yearMap.entries()) {
        const period: Period = {
          label: `FY${fy}`,
          endDate: u.end,
          kind: "annual",
        };

        const factId = `${normalizedTicker}-${targetMetric.toUpperCase()}-FY${fy}`;
        facts.push({
          factId,
          company: normalizedTicker,
          metric: targetMetric,
          period,
          value: u.val,
          unit: factUnit,
          source: `${displayName} FY${fy} Form ${u.form} (${concept.label || matchedTag}), EDGAR`,
          sourceUrl: `https://www.sec.gov/edgar/browse/?CIK=${paddedCik}`,
          type: "FACT",
          availability: "reported",
          lineItem: concept.label || matchedTag,
          accountingDefinition: `${matchedTag} (${accountingStandard})`,
        });
      }
    }

    if (facts.length > 0) {
      await setCachedFacts(normalizedTicker, facts);
      return facts;
    }

    return null;
  } catch (error) {
    console.error(`Error fetching live EDGAR facts for CIK ${cik}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

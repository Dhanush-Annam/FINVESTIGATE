import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { secRateLimiter } from "./live-edgar.js";

type CompanyTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

interface TickersCacheData {
  timestamp: number;
  entries: Record<string, { cik: string; title: string }>;
}

let memoryTickersCache: Map<string, { cik: string; title: string }> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days disk cache for SEC company_tickers.json

const CACHE_FILE = resolve(process.cwd(), "data", "cache", "company_tickers.json");

const SEC_USER_AGENT = process.env.SEC_USER_AGENT || "Finvestigate Research contact@finvestigate.dev";

const SEC_HEADERS = {
  "User-Agent": SEC_USER_AGENT,
  "Accept-Encoding": "gzip, deflate",
  "Host": "www.sec.gov",
};

async function loadDiskCache(): Promise<Map<string, { cik: string; title: string }> | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as TickersCacheData;
    if (Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.entries) {
      const map = new Map<string, { cik: string; title: string }>();
      for (const [ticker, info] of Object.entries(parsed.entries)) {
        map.set(ticker, info);
      }
      return map;
    }
  } catch (_err) {
    // Disk cache missing or expired
  }
  return null;
}

async function saveDiskCache(cacheMap: Map<string, { cik: string; title: string }>): Promise<void> {
  try {
    await mkdir(resolve(process.cwd(), "data", "cache"), { recursive: true });
    const entriesObj: Record<string, { cik: string; title: string }> = {};
    for (const [ticker, info] of cacheMap.entries()) {
      entriesObj[ticker] = info;
    }
    const payload: TickersCacheData = {
      timestamp: Date.now(),
      entries: entriesObj,
    };
    await writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch (err) {
    console.warn("Failed to write SEC tickers disk cache:", err instanceof Error ? err.message : err);
  }
}

const SMART_ALIASES: Record<string, { ticker: string; cik: string; displayName: string }> = {
  HDFC: { ticker: "HDB", cik: "0001144967", displayName: "HDFC Bank Limited" },
  HDFCBANK: { ticker: "HDB", cik: "0001144967", displayName: "HDFC Bank Limited" },
  INFOSYS: { ticker: "INFY", cik: "0001067491", displayName: "Infosys Limited" },
  WIPRO: { ticker: "WIT", cik: "0001123799", displayName: "Wipro Limited" },
  ICICI: { ticker: "IBN", cik: "0001103838", displayName: "ICICI Bank Limited" },
  ICICIBANK: { ticker: "IBN", cik: "0001103838", displayName: "ICICI Bank Limited" },
  RELIANCE: { ticker: "RELIANCE", cik: "BSE-500325", displayName: "Reliance Industries Limited" },
  TCS: { ticker: "TCS", cik: "BSE-532540", displayName: "Tata Consultancy Services Ltd" },
  TATAMOTORS: { ticker: "TATAMOTORS", cik: "BSE-500570", displayName: "Tata Motors Limited" },
};

export async function resolveCik(tickerOrName: string): Promise<{ cik: string; displayName: string; ticker: string } | null> {
  const query = tickerOrName.trim().toUpperCase();
  if (!query) return null;

  if (SMART_ALIASES[query]) {
    return SMART_ALIASES[query];
  }

  try {
    const now = Date.now();

    // 1. Memory cache hit check
    if (!memoryTickersCache || now - lastFetchTime > CACHE_TTL_MS) {
      // 2. Try loading from disk cache first
      const diskMap = await loadDiskCache();
      if (diskMap) {
        memoryTickersCache = diskMap;
        lastFetchTime = now;
      } else {
        // 3. Fetch from SEC with rate limiting and exponential retry
        let response: Response | null = null;
        let attempt = 0;
        const maxRetries = 3;

        while (attempt <= maxRetries) {
          await secRateLimiter.throttle();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          try {
            const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
              headers: SEC_HEADERS,
              signal: controller.signal as any,
            });
            clearTimeout(timeoutId);

            if (res.ok) {
              response = res;
              break;
            }

            if (res.status === 429 || res.status >= 500) {
              attempt++;
              if (attempt <= maxRetries) {
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
                continue;
              }
            }

            break;
          } catch (fetchErr) {
            clearTimeout(timeoutId);
            attempt++;
            if (attempt <= maxRetries) {
              await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
              continue;
            }
            throw fetchErr;
          }
        }

        if (!response || !response.ok) {
          console.warn(`Failed to fetch company_tickers.json from SEC`);
          return null;
        }

        const data = (await response.json()) as Record<string, CompanyTickerEntry>;
        const newCache = new Map<string, { cik: string; title: string }>();

        for (const entry of Object.values(data)) {
          const cikStr = String(entry.cik_str).padStart(10, "0");
          newCache.set(entry.ticker.toUpperCase(), { cik: cikStr, title: entry.title });
        }

        memoryTickersCache = newCache;
        lastFetchTime = now;
        await saveDiskCache(newCache);
      }
    }

    // Direct ticker lookup
    const directMatch = memoryTickersCache.get(query);
    if (directMatch) {
      return { cik: directMatch.cik, displayName: directMatch.title, ticker: query };
    }

    // Name search if query isn't a direct ticker match
    for (const [ticker, info] of memoryTickersCache.entries()) {
      if (info.title.toUpperCase().includes(query)) {
        return { cik: info.cik, displayName: info.title, ticker };
      }
    }

    return null;
  } catch (error) {
    console.error("Error resolving CIK:", error instanceof Error ? error.message : error);
    return null;
  }
}

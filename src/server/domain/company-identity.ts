export interface CanonicalCompanyIdentity {
  companyId: string; // Canonical source identity (e.g. "CIK-0001045810", "BSE-500325")
  ticker: string;
  cik: string;
  displayName: string;
  country: "US" | "IN";
}

// Authoritative primary benchmark registry
const REGISTERED_COMPANIES: Record<string, CanonicalCompanyIdentity> = {
  NVDA: {
    companyId: "CIK-0001045810",
    ticker: "NVDA",
    cik: "0001045810",
    displayName: "NVIDIA CORPORATION",
    country: "US",
  },
  AAPL: {
    companyId: "CIK-0000320193",
    ticker: "AAPL",
    cik: "0000320193",
    displayName: "Apple Inc.",
    country: "US",
  },
  RELIANCE: {
    companyId: "BSE-500325",
    ticker: "RELIANCE",
    cik: "BSE-500325",
    displayName: "Reliance Industries Limited",
    country: "IN",
  },
  TCS: {
    companyId: "BSE-532540",
    ticker: "TCS",
    cik: "BSE-532540",
    displayName: "Tata Consultancy Services Ltd",
    country: "IN",
  },
  TATAMOTORS: {
    companyId: "BSE-500570",
    ticker: "TATAMOTORS",
    cik: "BSE-500570",
    displayName: "Tata Motors Limited",
    country: "IN",
  },
  RS: {
    companyId: "CIK-0000861884",
    ticker: "RS",
    cik: "0000861884",
    displayName: "Reliance Steel & Aluminum Co.",
    country: "US",
  },
  MSFT: {
    companyId: "CIK-0000789019",
    ticker: "MSFT",
    cik: "0000789019",
    displayName: "MICROSOFT CORP",
    country: "US",
  },
  INTC: {
    companyId: "CIK-0000050863",
    ticker: "INTC",
    cik: "0000050863",
    displayName: "INTEL CORP",
    country: "US",
  },
  TSLA: {
    companyId: "CIK-0001318605",
    ticker: "TSLA",
    cik: "0001318605",
    displayName: "TESLA, INC.",
    country: "US",
  },
  AMZN: {
    companyId: "CIK-0001018724",
    ticker: "AMZN",
    cik: "0001018724",
    displayName: "AMAZON COM INC",
    country: "US",
  },
  GOOGL: {
    companyId: "CIK-0001652044",
    ticker: "GOOGL",
    cik: "0001652044",
    displayName: "Alphabet Inc.",
    country: "US",
  },
  GOOG: {
    companyId: "CIK-0001652044",
    ticker: "GOOG",
    cik: "0001652044",
    displayName: "Alphabet Inc.",
    country: "US",
  },
  AMD: {
    companyId: "CIK-0000002488",
    ticker: "AMD",
    cik: "0000002488",
    displayName: "ADVANCED MICRO DEVICES INC",
    country: "US",
  },
};

// Aliases mapping CIKs and BSE scrips back to canonical identities
const ALIAS_MAP: Record<string, string> = {
  "0001045810": "NVDA",
  "1045810": "NVDA",
  "0000320193": "AAPL",
  "320193": "AAPL",
  "500325": "RELIANCE",
  "BSE-500325": "RELIANCE",
  "532540": "TCS",
  "BSE-532540": "TCS",
  "500570": "TATAMOTORS",
  "BSE-500570": "TATAMOTORS",
  "0000861884": "RS",
  "861884": "RS",
  "0000789019": "MSFT",
  "789019": "MSFT",
  "0000050863": "INTC",
  "50863": "INTC",
  "0001318605": "TSLA",
  "1318605": "TSLA",
};

export type DynamicCikResolver = (
  tickerOrName: string
) => Promise<{ cik: string; displayName: string; ticker: string } | null>;

let dynamicCikResolver: DynamicCikResolver | null = null;

export function setDynamicCikResolver(resolver: DynamicCikResolver) {
  dynamicCikResolver = resolver;
}

/**
 * Synchronously resolves a canonical identity for registered benchmark companies.
 */
export function resolveCanonicalIdentitySync(identifier: string): CanonicalCompanyIdentity | null {
  if (!identifier) return null;
  const clean = identifier.trim().toUpperCase();

  if (REGISTERED_COMPANIES[clean]) {
    return REGISTERED_COMPANIES[clean];
  }

  const aliasTarget = ALIAS_MAP[clean];
  if (aliasTarget && REGISTERED_COMPANIES[aliasTarget]) {
    return REGISTERED_COMPANIES[aliasTarget];
  }

  return null;
}

/**
 * Asynchronously resolves canonical identity for any ticker, falling back to dynamic SEC CIK resolution.
 */
export async function resolveCanonicalIdentity(identifier: string): Promise<CanonicalCompanyIdentity | null> {
  const sync = resolveCanonicalIdentitySync(identifier);
  if (sync) return sync;

  try {
    const resolver =
      dynamicCikResolver ||
      (async (t: string) => {
        const { resolveCik } = await import("../infrastructure/sources/live-cik.js");
        return resolveCik(t);
      });

    const liveCik = await resolver(identifier);
    if (liveCik) {
      const companyId = liveCik.cik.startsWith("BSE-") ? liveCik.cik : `CIK-${liveCik.cik.padStart(10, "0")}`;
      const identity: CanonicalCompanyIdentity = {
        companyId,
        ticker: liveCik.ticker,
        cik: liveCik.cik,
        displayName: liveCik.displayName,
        country: liveCik.cik.startsWith("BSE-") ? "IN" : "US",
      };
      REGISTERED_COMPANIES[liveCik.ticker] = identity;
      return identity;
    }
  } catch {
    // Dynamic lookup failed
  }

  return null;
}

/**
 * Checks whether two identifiers represent the exact same canonical corporate entity.
 * Guarantees RELIANCE (BSE:500325) and RS (CIK:0000861884) are never equal.
 */
export function areSameCompanySync(entityA: string, entityB: string): boolean {
  if (!entityA || !entityB) return false;
  const a = entityA.trim().toUpperCase();
  const b = entityB.trim().toUpperCase();

  // Strict check: if one is RELIANCE and the other is RS, immediately false
  if ((a === "RELIANCE" && b === "RS") || (a === "RS" && b === "RELIANCE")) {
    return false;
  }

  const idA = resolveCanonicalIdentitySync(a);
  const idB = resolveCanonicalIdentitySync(b);

  if (idA && idB) {
    return idA.companyId === idB.companyId;
  }

  // If neither is in registry, check if both match after trimming
  return a === b;
}

/**
 * Asynchronous canonical company equality check.
 */
export async function areSameCompany(entityA: string, entityB: string): Promise<boolean> {
  if (areSameCompanySync(entityA, entityB)) {
    return true;
  }

  const a = entityA.trim().toUpperCase();
  const b = entityB.trim().toUpperCase();
  if ((a === "RELIANCE" && b === "RS") || (a === "RS" && b === "RELIANCE")) {
    return false;
  }

  const idA = await resolveCanonicalIdentity(a);
  const idB = await resolveCanonicalIdentity(b);

  if (idA && idB) {
    return idA.companyId === idB.companyId;
  }

  return a === b;
}

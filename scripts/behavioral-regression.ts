import { loadInvestigation } from "../src/server/application/evidence-store.js";
import { createHash } from "node:crypto";

const EXPECTED = {
  NVDA: {
    factsCount: 10,
    calcsCount: 7,
    findingsCount: 1,
    claimChecksCount: 3,
    bullScore: 9.4,
    bearScore: 4.0,
    evidenceQuality: "HIGH",
    factsHash: "ca14ea82fcf520680c6b994c078efbae34cced57bafecdd0a3a3f06202a134c3",
    calcsHash: "64fcdfe3057ba2d5ccf3120b9b5d6c96d1cc2aa083a6c00bff79426b52b7c5b7",
    findingsHash: "f51f5146ab245b2309afe10667bb0941296f4c12119cef4c4bf8e792041b1971",
  },
  AAPL: {
    factsCount: 10,
    calcsCount: 7,
    findingsCount: 2,
    claimChecksCount: 3,
    bullScore: 7.1,
    bearScore: 6.5,
    evidenceQuality: "HIGH",
    factsHash: "c2153b4c6c3e75406a72a827aea7b697c0fb6a07d66792001cef7f63c472f0fe",
    calcsHash: "43f86dd615b1b5adf5b7e97fcbca05f76e1b62c7bbbe0eba66892cf5ae7457ca",
    findingsHash: "c51ecf52c91202b5f3a6e2b5fadd2ed4aa663d50f25efe26c9d798144c159099",
  },
};

async function verifyFixture(ticker: keyof typeof EXPECTED) {
  const inv = await loadInvestigation(ticker);
  const factsHash = createHash("sha256").update(JSON.stringify(inv.facts)).digest("hex");
  const calcsHash = createHash("sha256").update(JSON.stringify(inv.calculations)).digest("hex");
  const findingsHash = createHash("sha256").update(JSON.stringify(inv.findings)).digest("hex");

  const actual = {
    factsCount: inv.facts.length,
    calcsCount: inv.calculations.length,
    findingsCount: inv.findings.length,
    claimChecksCount: inv.claimChecks?.length ?? 0,
    bullScore: inv.debate?.bullCase?.overallStrength,
    bearScore: inv.debate?.bearCase?.overallStrength,
    evidenceQuality: inv.debate?.judgeVerdict?.evidenceQuality,
    factsHash,
    calcsHash,
    findingsHash,
  };

  const expected = EXPECTED[ticker];
  let failed = false;

  for (const [k, v] of Object.entries(expected)) {
    const actVal = (actual as any)[k];
    if (actVal !== v) {
      console.error(`[FAIL] ${ticker} ${k}: expected ${v}, got ${actVal}`);
      failed = true;
    }
  }

  if (failed) {
    throw new Error(`Behavioral regression detected for ${ticker}`);
  }

  console.log(`[PASS] ${ticker} 100% behaviorally equivalent.`);
  return actual;
}

async function main() {
  console.log("=== FINVESTIGATE ZERO-BEHAVIOR-CHANGE AUDIT ===");
  await verifyFixture("NVDA");
  await verifyFixture("AAPL");
  console.log("=== ALL FIXTURES 100% EQUIVALENT ===");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});

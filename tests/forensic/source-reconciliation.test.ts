import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchDomesticIndianFacts, isDomesticIndianCompany } from "../../src/server/infrastructure/sources/live-india.js";
import { GAAP_TAG_MAPPINGS, IFRS_TAG_MAPPINGS } from "../../src/server/infrastructure/sources/live-edgar.js";
import { FactSchema } from "../../src/shared/types/index.js";

describe("Phase 2 — Source-Data Reconciliation & Provenance Audit", () => {
  it("Reconciles NVDA CapEx against narrow PP&E accounting definition", async () => {
    const raw = await readFile(resolve(process.cwd(), "data", "curated", "nvda.json"), "utf8");
    const parsed = JSON.parse(raw);

    const capexFacts = parsed.facts.filter((f: any) => f.metric === "capex");
    expect(capexFacts).toHaveLength(2);

    const fy2025 = capexFacts.find((f: any) => f.period.label === "FY2025");
    const fy2026 = capexFacts.find((f: any) => f.period.label === "FY2026");

    expect(fy2025).toBeDefined();
    expect(fy2025.value).toBe(1400000000);
    expect(fy2025.accountingDefinition).toBe("PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)");
    expect(fy2025.lineItem).toContain("property, plant and equipment");

    expect(fy2026).toBeDefined();
    expect(fy2026.value).toBe(1900000000);
    expect(fy2026.accountingDefinition).toBe("PaymentsToAcquirePropertyPlantAndEquipment (US-GAAP)");
    expect(fy2026.lineItem).toContain("property, plant and equipment");

    // Must validate against FactSchema
    for (const f of capexFacts) {
      expect(() => FactSchema.parse(f)).not.toThrow();
    }
  });

  it("Verifies full audited provenance on all domestic Indian companies", () => {
    const indianTickers = ["RELIANCE", "TCS", "TATAMOTORS"];

    for (const ticker of indianTickers) {
      expect(isDomesticIndianCompany(ticker)).toBe(true);
      const facts = fetchDomesticIndianFacts(ticker);
      expect(facts).not.toBeNull();
      expect(facts!.length).toBeGreaterThanOrEqual(10); // 5 metrics * 2 periods

      for (const fact of facts!) {
        // Every fact must validate against FactSchema
        expect(() => FactSchema.parse(fact)).not.toThrow();

        // Must have non-empty lineItem, accountingDefinition, and statement in source
        expect(fact.lineItem).toBeDefined();
        expect(fact.lineItem!.length).toBeGreaterThan(0);
        expect(fact.accountingDefinition).toBeDefined();
        expect(fact.accountingDefinition).toContain("Ind AS");
        expect(fact.source).toContain("Consolidated");
        expect(fact.unit).toBe("INR");
        expect(fact.value).toBeGreaterThan(0);
      }
    }
  });

  it("Audits SEC revenue tag fallbacks and separation of GAAP vs IFRS taxonomies", () => {
    // 1. GAAP revenue: standard contract customer revenue must NOT include InterestAndDividendIncomeOperating
    const gaapRevTags = GAAP_TAG_MAPPINGS.revenue;
    expect(gaapRevTags).toBeDefined();
    const contractRevIdx = gaapRevTags.indexOf("RevenueFromContractsWithCustomers");
    const interestRevIdx = gaapRevTags.indexOf("InterestAndDividendIncomeOperating");
    expect(contractRevIdx).toBeGreaterThanOrEqual(0);
    // Invalid interest/dividend operating fallback must be completely absent from generic revenue mapping
    expect(interestRevIdx).toBe(-1);

    // 2. IFRS mappings must be distinct from GAAP mappings
    expect(IFRS_TAG_MAPPINGS).toBeDefined();
    expect(IFRS_TAG_MAPPINGS.revenue).toContain("Revenue");
    expect(IFRS_TAG_MAPPINGS.capex).toContain("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities");
    expect(IFRS_TAG_MAPPINGS.netIncome).toContain("ProfitLoss");

    // 3. GAAP CapEx must prioritize specific PP&E payments
    expect(GAAP_TAG_MAPPINGS.capex[0]).toBe("PaymentsToAcquirePropertyPlantAndEquipment");
  });

  it("Regression: When normal revenue concepts are unavailable and only interest/dividend income exists, system returns missing revenue", () => {
    // Mock taxonomy with ONLY InterestAndDividendIncomeOperating and NetIncomeLoss
    const mockTaxonomy: Record<string, any> = {
      InterestAndDividendIncomeOperating: {
        label: "Interest and Dividend Income, Operating",
        units: {
          USD: [
            {
              start: "2024-01-01",
              end: "2024-12-31",
              val: 5_000_000_000,
              fy: 2024,
              fp: "FY",
              form: "10-K",
              filed: "2025-02-15",
            },
          ],
        },
      },
      NetIncomeLoss: {
        label: "Net Income (Loss)",
        units: {
          USD: [
            {
              start: "2024-01-01",
              end: "2024-12-31",
              val: 1_200_000_000,
              fy: 2024,
              fp: "FY",
              form: "10-K",
              filed: "2025-02-15",
            },
          ],
        },
      },
    };

    // Attempt to match revenue tag against generic GAAP_TAG_MAPPINGS.revenue
    let matchedRevenueTag: string | null = null;
    for (const tag of GAAP_TAG_MAPPINGS.revenue) {
      if (mockTaxonomy[tag]) {
        matchedRevenueTag = tag;
        break;
      }
    }

    // Revenue must NOT be matched or substituted with interest income
    expect(matchedRevenueTag).toBeNull();
  });
});

import type { Finding, Calculation, Fact } from "../../shared/types/index.js";
import type { Investigation } from "../types/index.js";
import { areSameCompanySync } from "./company-identity.js";

export interface OrphanRefViolation {
  surface: "finding" | "calculation" | "debate" | "claim_check";
  itemId: string;
  refId: string;
  expectedType: "fact" | "calculation" | "claim_check" | "observation";
  reason: string;
}

export interface ReferenceValidationResult {
  valid: boolean;
  violations: OrphanRefViolation[];
}

/**
 * Validates reference integrity across an investigation to ensure zero orphan references.
 * Verifies that:
 * 1. Every finding calculationRef exists in calculations and shares canonical company identity
 * 2. Every finding evidence item with calculationRef matches a valid calculation and verifies:
 *    calculation.company === finding.company === investigation.company
 * 3. Every calculation inputFactId exists in facts and shares canonical company identity
 * 4. Every debate citation exists and shares canonical company identity
 * 5. All referenced items belong to the same canonical corporate entity (never raw ticker equality)
 */
export function validateInvestigationReferences(investigation: Investigation): ReferenceValidationResult {
  const violations: OrphanRefViolation[] = [];

  const factMap = new Map<string, Fact>();
  for (const f of investigation.facts || []) {
    factMap.set(f.factId, f);
  }

  const calcMap = new Map<string, Calculation>();
  for (const c of investigation.calculations || []) {
    calcMap.set(c.calcId, c);
  }

  const claimCheckMap = new Map<string, any>();
  for (const cc of investigation.claimChecks || []) {
    claimCheckMap.set(cc.claimId, cc);
  }

  // 1. Calculations -> Facts (Calculation Lineage)
  for (const calc of investigation.calculations || []) {
    for (const factId of calc.inputFactIds || []) {
      const fact = factMap.get(factId);
      if (!fact) {
        violations.push({
          surface: "calculation",
          itemId: calc.calcId,
          refId: factId,
          expectedType: "fact",
          reason: `Calculation "${calc.calcId}" references non-existent fact "${factId}"`,
        });
      } else if (
        !areSameCompanySync(fact.company, investigation.company) ||
        !areSameCompanySync(calc.company, fact.company)
      ) {
        violations.push({
          surface: "calculation",
          itemId: calc.calcId,
          refId: factId,
          expectedType: "fact",
          reason: `Cross-company violation: Calculation "${calc.calcId}" for ${investigation.company} references fact "${factId}" belonging to ${fact.company}`,
        });
      }
    }
  }

  // 2. Findings -> Calculations (Evidence Lineage)
  for (const finding of investigation.findings || []) {
    for (const calcRef of finding.calculationRefs || []) {
      if (!calcRef || calcRef === "FACT" || calcRef === "NONE") continue;
      const calc = calcMap.get(calcRef);
      if (!calc) {
        violations.push({
          surface: "finding",
          itemId: finding.findingId,
          refId: calcRef,
          expectedType: "calculation",
          reason: `Finding "${finding.findingId}" references non-existent calculation "${calcRef}"`,
        });
      } else if (
        !areSameCompanySync(calc.company, investigation.company) ||
        !areSameCompanySync(calc.company, finding.company)
      ) {
        violations.push({
          surface: "finding",
          itemId: finding.findingId,
          refId: calcRef,
          expectedType: "calculation",
          reason: `Cross-company violation: Finding "${finding.findingId}" for ${investigation.company} references calculation "${calcRef}" belonging to ${calc.company}`,
        });
      }
    }

    // Check evidence items with calculationRef:
    // STRICT RULE: calculation.company === finding.company === investigation.company
    for (const ev of finding.evidence || []) {
      if (ev.calculationRef) {
        const calc = calcMap.get(ev.calculationRef);
        if (!calc) {
          violations.push({
            surface: "finding",
            itemId: finding.findingId,
            refId: ev.calculationRef,
            expectedType: "calculation",
            reason: `Evidence item in finding "${finding.findingId}" references non-existent calculation "${ev.calculationRef}"`,
          });
        } else if (
          !areSameCompanySync(calc.company, finding.company) ||
          !areSameCompanySync(calc.company, investigation.company) ||
          !areSameCompanySync(finding.company, investigation.company)
        ) {
          violations.push({
            surface: "finding",
            itemId: finding.findingId,
            refId: ev.calculationRef,
            expectedType: "calculation",
            reason: `Cross-company violation: Evidence item "${ev.metric}" in finding "${finding.findingId}" (${finding.company}) references calculation "${ev.calculationRef}" belonging to ${calc.company} (investigation: ${investigation.company})`,
          });
        }
      }
    }
  }

  // 3. Debate citations -> Facts / Calculations / ClaimChecks
  if (investigation.debate) {
    const allArgs = [
      ...(investigation.debate.bullCase?.arguments || []),
      ...(investigation.debate.bearCase?.arguments || []),
    ];

    for (const arg of allArgs) {
      for (const ev of arg.evidence || []) {
        const ref = (ev as any).reference;
        if (!ref || ref === "FACT" || ref === "NONE") continue;

        const fact = factMap.get(ref);
        const calc = calcMap.get(ref);
        const claim = claimCheckMap.get(ref);

        if (!fact && !calc && !claim) {
          violations.push({
            surface: "debate",
            itemId: arg.argument.slice(0, 40),
            refId: ref,
            expectedType: ref.startsWith("CALC-") ? "calculation" : ref.startsWith("CLAIM-") ? "claim_check" : "fact",
            reason: `Debate argument cites non-existent reference "${ref}"`,
          });
        } else {
          // Verify company ownership of cited item
          const citedCompany = fact ? fact.company : calc ? calc.company : claim ? claim.company : null;
          if (citedCompany && !areSameCompanySync(citedCompany, investigation.company)) {
            violations.push({
              surface: "debate",
              itemId: arg.argument.slice(0, 40),
              refId: ref,
              expectedType: ref.startsWith("CALC-") ? "calculation" : ref.startsWith("CLAIM-") ? "claim_check" : "fact",
              reason: `Cross-company violation: Debate argument for ${investigation.company} cites reference "${ref}" belonging to ${citedCompany}`,
            });
          }
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

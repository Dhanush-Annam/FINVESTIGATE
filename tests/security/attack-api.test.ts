import { describe, expect, it, beforeAll } from "vitest";
import { getRepository } from "../../src/server/infrastructure/db/repository.js";
import { executeAdversarialAttack } from "../../src/server/domain/verification.js";

describe("Real Backend Attack Execution API", () => {
  let repo: Awaited<ReturnType<typeof getRepository>>;

  beforeAll(async () => {
    repo = await getRepository();
    await repo.seedCuratedData();
  });

  it("Scenario 1 (fabricated_id): rejects non-existent reference and engages atomic fallback", async () => {
    const res = await executeAdversarialAttack("NVDA", "fabricated_id", repo);
    expect(res.success).toBe(true);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_missing_ref");
    expect(res.citedRef).toBe("REF-NONEXISTENT-999");
    expect(res.atomicFallbackEngaged).toBe(true);
    expect(res.latencyMs).toBeGreaterThan(0);
    expect(res.latencyMs).toBeLessThan(100); // Sub-100ms local execution
  });

  it("Scenario 2 (cross_company): intercepts competitor reference (AAPL into NVDA) and rejects", async () => {
    const res = await executeAdversarialAttack("NVDA", "cross_company", repo);
    expect(res.success).toBe(true);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_cross_company");
    expect(res.citedRef).toContain("AAPL");
    expect(res.expectedCompany).toBe("NVDA");
    expect(res.atomicFallbackEngaged).toBe(true);
  });

  it("Scenario 3 (numeric_hallucination): detects >0.5% tolerance boundary drift and rejects", async () => {
    const res = await executeAdversarialAttack("NVDA", "numeric_hallucination", repo);
    expect(res.success).toBe(true);
    expect(res.pass).toBe(false);
    expect(res.resultCode).toBe("fail_mismatch");
    expect(res.atomicFallbackEngaged).toBe(true);
  });

  it("Scenario 4 (sign_flip_mismatch): catches sign-flip semantic or label mismatch", async () => {
    const res = await executeAdversarialAttack("NVDA", "sign_flip_mismatch", repo);
    expect(res.success).toBe(true);
    expect(res.pass).toBe(false);
    expect(["fail_sign_flip", "fail_null_value", "fail_mismatch"]).toContain(res.resultCode);
    expect(res.atomicFallbackEngaged).toBe(true);
  });

  it("persists adversarial attack interceptions directly to verification_log table", async () => {
    await executeAdversarialAttack("NVDA", "fabricated_id", repo);
    const logs = await repo.getVerificationLogs("NVDA");
    expect(logs.length).toBeGreaterThan(0);
    const missingRefLog = logs.find((l) => l.result === "fail_missing_ref" && l.refId === "REF-NONEXISTENT-999");
    expect(missingRefLog).toBeDefined();
    expect(missingRefLog?.companyTicker).toBe("NVDA");
    expect(missingRefLog?.sourceType).toBe("adversarial");
  });

  it("validates scenario schema and rejects arbitrary invalid scenarios with HTTP 400", async () => {
    const { app, AttackBodySchema } = await import("../../src/server/api/server.js");

    // Schema level validation
    expect(AttackBodySchema.safeParse({ scenario: "fabricated_id" }).success).toBe(true);
    expect(AttackBodySchema.safeParse({ scenario: "cross_company" }).success).toBe(true);
    expect(AttackBodySchema.safeParse({ scenario: "numeric_hallucination" }).success).toBe(true);
    expect(AttackBodySchema.safeParse({ scenario: "sign_flip_mismatch" }).success).toBe(true);
    expect(AttackBodySchema.safeParse({ scenario: "malicious_injection" }).success).toBe(false);

    // HTTP level validation via real endpoint call
    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;
    try {
      const badRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "malicious_injection" }),
      });
      expect(badRes.status).toBe(400);
      const badJson: any = await badRes.json();
      expect(badJson.error).toContain("Invalid adversarial scenario");

      const goodRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(goodRes.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("returns N/A instead of 100.0% when zero claims or attacks are evaluated", async () => {
    const { app } = await import("../../src/server/api/server.js");
    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;
    try {
      const res = await fetch(`http://localhost:${port}/api/verification-stats?ticker=NONEXISTENT_TICKER_XYZ`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.production.totalClaims).toBe(0);
      expect(data.production.verificationRate).toBe("N/A");
      expect(data.production.interceptionRate).toBe("N/A");
      expect(data.adversarial.totalAttacks).toBe(0);
      expect(data.adversarial.blockRate).toBe("N/A");
    } finally {
      server.close();
    }
  });

  it("hardens production authentication to fail closed without API_SECRET_KEY and enforces auth when configured", async () => {
    const { app } = await import("../../src/server/api/server.js");
    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;

    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.API_SECRET_KEY;

    try {
      // 1. In production without API_SECRET_KEY: fail closed with HTTP 503
      process.env.NODE_ENV = "production";
      delete process.env.API_SECRET_KEY;

      const unconfiguredRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(unconfiguredRes.status).toBe(503);
      const unconfiguredJson: any = await unconfiguredRes.json();
      expect(unconfiguredJson.error).toContain("Mutation endpoints are disabled in production");

      // 2. In production with API_SECRET_KEY: missing token returns 401
      process.env.API_SECRET_KEY = "super-secret-production-key";

      const unauthRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(unauthRes.status).toBe(401);

      // 3. In production with incorrect token: returns 401
      const badTokenRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "wrong-secret",
        },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(badTokenRes.status).toBe(401);

      // 4. In production with valid X-API-Key: returns 200
      const validApiKeyRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "super-secret-production-key",
        },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(validApiKeyRes.status).toBe(200);

      // 5. In production with valid Bearer token: returns 200
      const validBearerRes = await fetch(`http://localhost:${port}/api/investigations/NVDA/attack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer super-secret-production-key",
        },
        body: JSON.stringify({ scenario: "fabricated_id" }),
      });
      expect(validBearerRes.status).toBe(200);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalSecret !== undefined) {
        process.env.API_SECRET_KEY = originalSecret;
      } else {
        delete process.env.API_SECRET_KEY;
      }
      server.close();
    }
  });
});

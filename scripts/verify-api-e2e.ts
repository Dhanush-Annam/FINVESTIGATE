/**
 * Production Readiness E2E & Persistence Verification for Finvestigate API
 * 
 * Verifies Steps 9 & 10 against remote Turso Cloud:
 * 9. Start actual Finvestigate API in NODE_ENV=production
 *    - GET /health
 *    - GET /api/verification-stats?ticker=NVDA
 *    - GET /api/investigations/NVDA
 *    - POST /api/investigations/NVDA/attack (auth rejection and authorized attack)
 * 10. Stop API server, restart it, and verify data persists across restarts.
 * 
 * NEVER prints credentials or tokens.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

if (typeof (process as any).loadEnvFile === "function") {
  try {
    (process as any).loadEnvFile(".env");
  } catch (_e) {}
}

const remoteUrl: string = process.env.TURSO_TEST_DATABASE_URL || process.env.TURSO_DATABASE_URL || "";
const authToken: string = process.env.TURSO_AUTH_TOKEN || "";
const testApiKey = "test-prod-sec-key-7788";

if (!remoteUrl || !authToken) {
  console.error("FATAL: Missing Turso credentials.");
  process.exit(1);
}

function startServer(): Promise<ChildProcess> {
  return new Promise((resolvePromise, rejectPromise) => {
    const serverPath = resolve(process.cwd(), "server-dist", "server", "api", "server.js");
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        TURSO_DATABASE_URL: remoteUrl,
        TURSO_AUTH_TOKEN: authToken,
        API_SECRET_KEY: testApiKey,
        PORT: "3001",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;

    child.stdout.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("listening on http://localhost:3001") && !started) {
        started = true;
        resolvePromise(child);
      }
    });

    child.stderr.on("data", (_data) => {
      // ignore
    });

    child.on("error", (err) => {
      if (!started) rejectPromise(err);
    });

    child.on("exit", (code) => {
      if (!started) rejectPromise(new Error(`Server exited prematurely with code ${code}`));
    });

    // Timeout fallback after 15 seconds
    setTimeout(async () => {
      if (!started) {
        try {
          const res = await fetch("http://localhost:3001/health");
          if (res.ok) {
            started = true;
            resolvePromise(child);
            return;
          }
        } catch (_e) {}
        rejectPromise(new Error("Server start timeout"));
      }
    }, 15000);
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise) => {
    if (child.killed || child.exitCode !== null) {
      resolvePromise();
      return;
    }
    child.on("exit", () => resolvePromise());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
      resolvePromise();
    }, 3000);
  });
}

async function run() {
  console.log("================================================================================");
  console.log("STARTING API END-TO-END & PERSISTENCE VERIFICATION");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // STEP 9: APPLICATION END-TO-END
  // ---------------------------------------------------------------------------
  console.log("Starting Finvestigate production API server instance 1...");
  let server = await startServer();
  console.log("API Server instance 1 running on http://localhost:3001");

  let step9Passed = false;
  try {
    // 9A: GET /health
    const healthRes = await fetch("http://localhost:3001/health");
    const healthJson = await healthRes.json();
    const healthOk = healthRes.status === 200 && healthJson.status === "ok";
    console.log(`GET /health: status ${healthRes.status}, body:`, JSON.stringify(healthJson));

    // 9B: GET /api/verification-stats?ticker=NVDA
    const statsRes = await fetch("http://localhost:3001/api/verification-stats?ticker=NVDA");
    const statsJson = await statsRes.json();
    const statsOk =
      statsRes.status === 200 &&
      statsJson.ticker === "NVDA" &&
      statsJson.production?.totalClaims > 0 &&
      statsJson.production?.verifiedClaims > 0;
    console.log(
      `GET /api/verification-stats?ticker=NVDA: status ${statsRes.status}, totalClaims: ${statsJson.production?.totalClaims}, verifiedClaims: ${statsJson.production?.verifiedClaims}, verificationRate: ${statsJson.production?.verificationRate}`
    );

    // 9C: GET /api/investigations/NVDA
    const invRes = await fetch("http://localhost:3001/api/investigations/NVDA");
    const invJson = await invRes.json();
    const invOk =
      invRes.status === 200 &&
      invJson.company === "NVDA" &&
      Array.isArray(invJson.facts) &&
      invJson.facts.length > 0 &&
      Array.isArray(invJson.calculations) &&
      invJson.calculations.length > 0 &&
      invJson.debate !== undefined;
    console.log(
      `GET /api/investigations/NVDA: status ${invRes.status}, company: ${invJson.company}, facts: ${invJson.facts?.length}, calcs: ${invJson.calculations?.length}, hasDebate: ${!!invJson.debate}`
    );

    // 9D: Mutation / Attack endpoint authentication tests
    // Test 1: Unauthenticated request should be rejected with 401
    const unauthRes = await fetch("http://localhost:3001/api/investigations/NVDA/attack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "fabricated_id" }),
    });
    const unauthOk = unauthRes.status === 401;
    console.log(`POST /api/investigations/NVDA/attack (no auth): status ${unauthRes.status} (expected 401)`);

    // Test 2: Authenticated request with valid key should succeed and execute attack scenario
    const authRes = await fetch("http://localhost:3001/api/investigations/NVDA/attack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": testApiKey,
      },
      body: JSON.stringify({ scenario: "fabricated_id" }),
    });
    const authJson = await authRes.json();
    const authOk = authRes.status === 200 && authJson.scenario === "fabricated_id" && (authJson.atomicFallbackEngaged === true || authJson.pass === false);
    console.log(
      `POST /api/investigations/NVDA/attack (authenticated): status ${authRes.status}, scenario: ${authJson.scenario}, blocked (fallback engaged): ${authJson.atomicFallbackEngaged}, reason: ${authJson.reason}`
    );

    step9Passed = healthOk && statsOk && invOk && unauthOk && authOk;
    console.log(`[${step9Passed ? "PASS" : "FAIL"}] 9. APPLICATION END-TO-END`);
  } catch (err: any) {
    console.error("Step 9 failed:", err.message);
  } finally {
    console.log("Stopping API Server instance 1...");
    await stopServer(server);
    console.log("API Server instance 1 stopped.");
  }

  // ---------------------------------------------------------------------------
  // STEP 10: RESTART / PERSISTENCE TEST
  // ---------------------------------------------------------------------------
  console.log("\nStarting Finvestigate production API server instance 2 (RESTART PERSISTENCE)...");
  let server2 = await startServer();
  console.log("API Server instance 2 running on http://localhost:3001");

  let step10Passed = false;
  try {
    const invRes2 = await fetch("http://localhost:3001/api/investigations/NVDA");
    const invJson2 = await invRes2.json();
    const persistedOk =
      invRes2.status === 200 &&
      invJson2.company === "NVDA" &&
      invJson2.facts?.length > 0 &&
      invJson2.calculations?.length > 0 &&
      !!invJson2.debate;

    const statsRes2 = await fetch("http://localhost:3001/api/verification-stats?ticker=NVDA");
    const statsJson2 = await statsRes2.json();
    const statsPersisted = statsRes2.status === 200 && statsJson2.production?.totalClaims > 0;

    step10Passed = persistedOk && statsPersisted;
    console.log(
      `Restart verification: NVDA investigation persisted = ${persistedOk} (facts: ${invJson2.facts?.length}), stats persisted = ${statsPersisted} (claims: ${statsJson2.production?.totalClaims})`
    );
    console.log(`[${step10Passed ? "PASS" : "FAIL"}] 10. RESTART/PERSISTENCE TEST`);
  } catch (err: any) {
    console.error("Step 10 failed:", err.message);
  } finally {
    console.log("Stopping API Server instance 2...");
    await stopServer(server2);
    console.log("API Server instance 2 stopped.");
  }

  console.log("================================================================================");
  console.log("API & PERSISTENCE VERIFICATION SUMMARY:");
  console.log(`[${step9Passed ? "PASS" : "FAIL"}] 9. APPLICATION END-TO-END`);
  console.log(`[${step10Passed ? "PASS" : "FAIL"}] 10. RESTART/PERSISTENCE TEST`);
  console.log("================================================================================");

  if (!step9Passed || !step10Passed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("E2E script failed unexpectedly:", err);
  process.exit(1);
});

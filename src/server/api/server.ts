import cors from "cors";
import express from "express";
import { z } from "zod";
import { loadInvestigation } from "../application/evidence-store.js";
import { getRepository } from "../infrastructure/db/repository.js";
import { executeAdversarialAttack, isVerificationPass } from "../domain/verification.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

export function getCorsOptions(): cors.CorsOptions {
  const allowed = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return {
    origin: (origin, callback) => {
      // Allow requests without Origin header (curl, tests, server-to-server) or in whitelist
      if (!origin || allowed.includes("*") || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed by CORS policy.`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  };
}

export const app = express();
app.use(cors(getCorsOptions()));
app.use(express.json({ limit: "50kb" }));

export function requireMutationAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const secretKey = process.env.API_SECRET_KEY;
  if (!secretKey) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({
        error: "Service Unavailable: Mutation endpoints are disabled in production because API_SECRET_KEY is not configured.",
      });
      return;
    }
    // Development / demo default: Permitted with policy header
    res.setHeader("X-Mutation-Auth", "development-unrestricted");
    return next();
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  const token = apiKeyHeader || bearer;

  if (!token || token !== secretKey) {
    res.status(401).json({
      error: "Unauthorized: Mutating endpoints require a valid API key or Bearer token.",
    });
    return;
  }

  res.setHeader("X-Mutation-Auth", "authenticated");
  next();
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}
const ipRateLimits = new Map<string, RateLimitRecord>();

/**
 * Fixed-window request rate limiter by client IP.
 * Enforces maxRequests per discrete windowMs epoch (default: 120 req / 60s).
 */
export function rateLimiter(maxRequests = 120, windowMs = 60_000) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === "test" && !process.env.TEST_RATE_LIMIT) {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = ipRateLimits.get(ip);

    if (!record || now > record.resetTime) {
      ipRateLimits.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      res.status(429).json({
        error: "Rate limit exceeded. Please wait before retrying.",
        retryAfterMs: Math.max(0, record.resetTime - now),
      });
      return;
    }
    next();
  };
}

app.use(rateLimiter());

export const AttackBodySchema = z.object({
  scenario: z.enum([
    "fabricated_id",
    "cross_company",
    "numeric_hallucination",
    "sign_flip_mismatch",
  ]).default("fabricated_id"),
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "finvestigate-api" });
});

app.get("/api/verification-stats", async (request, response) => {
  try {
    const repo = await getRepository();
    const ticker = typeof request.query.ticker === "string" ? request.query.ticker : undefined;
    const allLogs = await repo.getVerificationLogs(ticker);

    // Production evidence logs (10-K filing ingestion audit)
    const prodLogs = allLogs.filter((l) => l.sourceType === "production");
    const prodTotal = prodLogs.length;
    const prodVerified = prodLogs.filter((l) => isVerificationPass(l.result)).length;
    const prodRejected = prodLogs.filter((l) => !isVerificationPass(l.result)).length;
    const prodCrossCompany = prodLogs.filter((l) => l.result === "fail_cross_company").length;
    const prodMissingRef = prodLogs.filter((l) => l.result === "fail_missing_ref").length;
    const prodMismatch = prodLogs.filter((l) => l.result === "fail_mismatch").length;
    const prodNullValue = prodLogs.filter((l) => l.result === "fail_null_value").length;
    const prodSignFlip = prodLogs.filter((l) => l.result === "fail_sign_flip").length;
    const prodRate = prodTotal > 0 ? `${((prodVerified / prodTotal) * 100).toFixed(1)}%` : "N/A";
    const interceptionRate = prodTotal > 0 ? `${((prodRejected / prodTotal) * 100).toFixed(1)}%` : "N/A";

    // Adversarial attack test traffic
    const advLogs = allLogs.filter((l) => l.sourceType === "adversarial");
    const totalAttacks = advLogs.length;
    const blockedAttacks = advLogs.filter((l) => !isVerificationPass(l.result)).length;
    const crossCompanyBlocked = advLogs.filter((l) => l.result === "fail_cross_company").length;
    const missingRefBlocked = advLogs.filter((l) => l.result === "fail_missing_ref").length;
    const numericDriftBlocked = advLogs.filter((l) => l.result === "fail_mismatch").length;
    const signFlipBlocked = advLogs.filter((l) => l.result === "fail_sign_flip" || l.result === "fail_null_value").length;
    const blockRate = totalAttacks > 0 ? `${((blockedAttacks / totalAttacks) * 100).toFixed(1)}%` : "N/A";

    const production = {
      totalClaims: prodTotal,
      verifiedClaims: prodVerified,
      rejectedClaims: prodRejected,
      crossCompany: prodCrossCompany,
      missingRef: prodMissingRef,
      mismatch: prodMismatch,
      nullValue: prodNullValue,
      signFlip: prodSignFlip,
      verificationRate: prodRate,
      interceptionRate: interceptionRate,
    };

    const adversarial = {
      totalAttacks,
      blockedAttacks,
      crossCompanyBlocked,
      missingRefBlocked,
      numericDriftBlocked,
      signFlipBlocked,
      blockRate,
    };

    response.json({
      ticker: ticker?.toUpperCase() ?? "ALL",
      // Segregated audit metrics
      production,
      adversarial,
      // Backward-compatibility top-level mappings strictly for production filing evidence
      totalClaims: prodTotal,
      verifiedClaims: prodVerified,
      rejectedClaims: prodRejected,
      crossCompany: prodCrossCompany,
      missingRef: prodMissingRef,
      mismatch: prodMismatch,
      nullValue: prodNullValue,
      verificationRate: prodRate,
      recentRejections: prodLogs.filter((l) => l.result !== "pass").slice(0, 8),
      recentAttackLogs: advLogs.slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrieve verification stats.";
    response.status(500).json({ error: message });
  }
});

app.get("/api/investigations/:ticker", async (request, response) => {
  try {
    const ticker = Array.isArray(request.params.ticker) ? request.params.ticker[0] : request.params.ticker;
    response.json(await loadInvestigation(ticker));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load investigation.";
    response.status(message.includes("ENOENT") ? 404 : 500).json({ error: message });
  }
});

app.post("/api/investigations/:ticker/attack", requireMutationAuth, async (request, response) => {
  try {
    const parsedBody = AttackBodySchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid adversarial scenario. Must be one of: 'fabricated_id', 'cross_company', 'numeric_hallucination', 'sign_flip_mismatch'",
        details: parsedBody.error.issues,
      });
      return;
    }

    const repo = await getRepository();
    const ticker = Array.isArray(request.params.ticker) ? request.params.ticker[0] : request.params.ticker;
    const { scenario } = parsedBody.data;
    const result = await executeAdversarialAttack(ticker, scenario, repo);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to execute adversarial attack.";
    response.status(500).json({ error: message });
  }
});

// Error handling middleware for CORS rejections
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.message && err.message.includes("CORS policy")) {
    res.status(403).json({ error: err.message });
    return;
  }
  next(err);
});

if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  app.listen(3001, () => console.log("FINVESTIGATE API listening on http://localhost:3001"));
}

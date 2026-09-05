import { getRepository } from "../src/server/infrastructure/db/repository.js";
import { buildEvidencePack } from "../src/server/infrastructure/llm/evidence-pack.js";
import { runBullAgentWithDetails } from "../src/server/infrastructure/llm/bull-agent.js";
import { runBearAgentWithDetails } from "../src/server/infrastructure/llm/bear-agent.js";
import { runJudgeAgentWithDetails } from "../src/server/infrastructure/llm/judge-agent.js";
import { verifyClaim } from "../src/server/domain/verification.js";
import type { InvestigationRepository } from "../src/server/infrastructure/db/repository-interface.js";
import type { EvidencePack, BullAgentOutput, BearAgentOutput, JudgeAgentOutput } from "../src/server/infrastructure/llm/types.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

interface AgentBenchmarkMetric {
  model: string;
  ticker: string;
  agent: "bull" | "bear" | "judge";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  schemaValid: boolean;
  modelGroundingPassed: boolean;
  ungroundedRefsCount: number;
  totalRefsGenerated: number;
  validRefsCount: number;
  crossCompanyRefsCount: number;
  verificationGatePassed: boolean;
  failureReason: string | null;
}

interface BenchmarkSummary {
  timestamp: string;
  modelsTested: string[];
  tickersTested: string[];
  metrics: AgentBenchmarkMetric[];
  aggregate: Record<string, {
    bullSuccessRate: string;
    bearSuccessRate: string;
    judgeSuccessRate: string;
    avgBullLatencyMs: number;
    avgBearLatencyMs: number;
    avgJudgeLatencyMs: number;
    totalPromptTokens: number;
    totalCandidatesTokens: number;
    totalTokens: number;
    groundedRefRate: string;
    verificationPassRate: string;
  }>;
}

const TICKERS = ["NVDA", "AAPL", "TSLA"];
const MODELS = ["gemini-3.5-flash-lite", "gemma-4-31b-it"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function benchmarkSingleAgent(
  model: string,
  ticker: string,
  agentType: "bull" | "bear" | "judge",
  evidencePack: EvidencePack,
  repo: InvestigationRepository,
  bullOutput?: BullAgentOutput,
  bearOutput?: BearAgentOutput
): Promise<{
  metric: AgentBenchmarkMetric;
  bullOut?: BullAgentOutput;
  bearOut?: BearAgentOutput;
  judgeOut?: JudgeAgentOutput;
}> {
  console.log(`[Benchmark] Running ${agentType.toUpperCase()} agent on ${ticker} with model "${model}"...`);

  // Enforce Rate Limiting (max 13 requests per minute = 4.6s per request)
  await sleep(4600);

  let res: any;
  if (agentType === "bull") {
    res = await runBullAgentWithDetails(evidencePack, model);
  } else if (agentType === "bear") {
    res = await runBearAgentWithDetails(evidencePack, bullOutput, model);
  } else {
    res = await runJudgeAgentWithDetails(evidencePack, bullOutput!, bearOutput!, model);
  }


  const metric: AgentBenchmarkMetric = {
    model,
    ticker,
    agent: agentType,
    inputTokens: res.stats.promptTokens || 0,
    outputTokens: res.stats.candidatesTokens || 0,
    totalTokens: res.stats.totalTokens || 0,
    latencyMs: res.stats.latencyMs,
    success: !!res.output,
    schemaValid: res.schemaValid,
    modelGroundingPassed: res.grounded,
    ungroundedRefsCount: res.ungroundedRefs.length,
    totalRefsGenerated: 0,
    validRefsCount: 0,
    crossCompanyRefsCount: 0,
    verificationGatePassed: false,
    failureReason: res.error || null,
  };

  if (!res.output) {
    return { metric };
  }

  // Verification Gate evaluation on generated output
  let totalRefs = 0;
  let validRefs = 0;
  let crossCompanyRefs = 0;
  let verificationGatePassed = true;

  if (agentType === "bull" || agentType === "bear") {
    const args = (res.output as BullAgentOutput | BearAgentOutput).arguments;
    for (const arg of args) {
      for (const refId of arg.evidenceRefs) {
        totalRefs++;
        const claimResult = await verifyClaim(
          { text: arg.claim, claimed_value: "Verified Reference", ref_id: refId, ref_type: refId.startsWith("CALC-") ? "calculation" : "fact" },
          ticker,
          repo
        );

        if (claimResult.pass) {
          validRefs++;
        } else {
          verificationGatePassed = false;
          if (claimResult.resultCode === "fail_cross_company") {
            crossCompanyRefs++;
          }
        }
      }
    }
  } else {
    const judgeOut = res.output as JudgeAgentOutput;
    const allRefs = [...judgeOut.unresolvedQuestionEvidenceRefs, ...judgeOut.evidenceRefs];
    for (const refId of allRefs) {
      totalRefs++;
      const claimResult = await verifyClaim(
        { text: judgeOut.mostImportantUnresolvedQuestion, claimed_value: "Verified Reference", ref_id: refId, ref_type: refId.startsWith("CALC-") ? "calculation" : "fact" },
        ticker,
        repo
      );

      if (claimResult.pass) {
        validRefs++;
      } else {
        verificationGatePassed = false;
        if (claimResult.resultCode === "fail_cross_company") {
          crossCompanyRefs++;
        }
      }
    }
  }

  metric.totalRefsGenerated = totalRefs;
  metric.validRefsCount = validRefs;
  metric.crossCompanyRefsCount = crossCompanyRefs;
  metric.verificationGatePassed = verificationGatePassed;

  return {
    metric,
    bullOut: agentType === "bull" ? res.output : undefined,
    bearOut: agentType === "bear" ? res.output : undefined,
    judgeOut: agentType === "judge" ? res.output : undefined,
  };
}

async function runFullBenchmark() {
  console.log("=== FINVESTIGATE LLM BENCHMARK RUNNER ===");
  console.log(`Comparing baseline gemini-3.5-flash-lite vs gemma-4-31b-it\n`);

  const repo = await getRepository();
  await repo.seedCuratedData();

  const allMetrics: AgentBenchmarkMetric[] = [];

  for (const ticker of TICKERS) {
    const inv = await repo.getInvestigation(ticker);
    if (!inv) {
      console.warn(`[Benchmark] Could not load investigation for ${ticker}. Skipping.`);
      continue;
    }

    const evidencePack = buildEvidencePack(inv);

    for (const model of MODELS) {
      console.log(`\n--- Benchmarking Model: ${model} | Ticker: ${ticker} ---`);

      // 1. Bull Agent
      const bullRes = await benchmarkSingleAgent(model, ticker, "bull", evidencePack, repo);
      allMetrics.push(bullRes.metric);

      // Dummy bull output if model failed so bear agent can still be tested fairly
      const effectiveBull: BullAgentOutput = bullRes.bullOut || {
        arguments: [{ argumentId: "BULL-1", claim: "Growth momentum", reasoning: "Strong demand", counterpoints: [], evidenceRefs: [evidencePack.evidenceCatalog[0]?.id || "FACT"] }],
        summary: "Fallback bull case",
      };

      // 2. Bear Agent
      const bearRes = await benchmarkSingleAgent(model, ticker, "bear", evidencePack, repo, effectiveBull);
      allMetrics.push(bearRes.metric);

      const effectiveBear: BearAgentOutput = bearRes.bearOut || {
        arguments: [{ argumentId: "BEAR-1", claim: "Valuation risk", reasoning: "High multiples", counterpoints: [], evidenceRefs: [evidencePack.evidenceCatalog[0]?.id || "FACT"] }],
        summary: "Fallback bear case",
      };

      // 3. Judge Agent
      const judgeRes = await benchmarkSingleAgent(model, ticker, "judge", evidencePack, repo, effectiveBull, effectiveBear);
      allMetrics.push(judgeRes.metric);
    }
  }

  // Compute aggregate statistics per model
  const aggregate: BenchmarkSummary["aggregate"] = {};

  for (const model of MODELS) {
    const modelMetrics = allMetrics.filter((m) => m.model === model);
    const bullMetrics = modelMetrics.filter((m) => m.agent === "bull");
    const bearMetrics = modelMetrics.filter((m) => m.agent === "bear");
    const judgeMetrics = modelMetrics.filter((m) => m.agent === "judge");

    const avgLatency = (arr: AgentBenchmarkMetric[]) =>
      arr.length > 0 ? Math.round(arr.reduce((acc, m) => acc + m.latencyMs, 0) / arr.length) : 0;

    const calcSuccessRate = (arr: AgentBenchmarkMetric[]) =>
      arr.length > 0
        ? `${((arr.filter((m) => m.success).length / arr.length) * 100).toFixed(1)}%`
        : "0%";

    const totalPromptTokens = modelMetrics.reduce((acc, m) => acc + m.inputTokens, 0);
    const totalCandidatesTokens = modelMetrics.reduce((acc, m) => acc + m.outputTokens, 0);
    const totalTokens = modelMetrics.reduce((acc, m) => acc + m.totalTokens, 0);

    const totalRefs = modelMetrics.reduce((acc, m) => acc + m.totalRefsGenerated, 0);
    const totalValidRefs = modelMetrics.reduce((acc, m) => acc + m.validRefsCount, 0);
    const groundedRefRate = totalRefs > 0 ? `${((totalValidRefs / totalRefs) * 100).toFixed(1)}%` : "N/A";

    const totalVerifPassed = modelMetrics.filter((m) => m.verificationGatePassed).length;
    const verificationPassRate = modelMetrics.length > 0 ? `${((totalVerifPassed / modelMetrics.length) * 100).toFixed(1)}%` : "0%";

    aggregate[model] = {
      bullSuccessRate: calcSuccessRate(bullMetrics),
      bearSuccessRate: calcSuccessRate(bearMetrics),
      judgeSuccessRate: calcSuccessRate(judgeMetrics),
      avgBullLatencyMs: avgLatency(bullMetrics),
      avgBearLatencyMs: avgLatency(bearMetrics),
      avgJudgeLatencyMs: avgLatency(judgeMetrics),
      totalPromptTokens,
      totalCandidatesTokens,
      totalTokens,
      groundedRefRate,
      verificationPassRate,
    };
  }

  const summary: BenchmarkSummary = {
    timestamp: new Date().toISOString(),
    modelsTested: MODELS,
    tickersTested: TICKERS,
    metrics: allMetrics,
    aggregate,
  };

  const resultsDir = resolve(process.cwd(), "scratch");
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const resultPath = resolve(resultsDir, "benchmark_results.json");
  writeFileSync(resultPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("\n================ BENCHMARK COMPLETED ================");
  console.log(`Results saved to ${resultPath}\n`);
  console.dir(aggregate, { depth: null });
}

runFullBenchmark().catch((err) => {
  console.error("Benchmark failed with fatal error:", err);
  process.exit(1);
});

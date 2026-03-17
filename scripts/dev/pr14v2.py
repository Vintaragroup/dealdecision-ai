#!/usr/bin/env python3
"""PR14 extraction — verified line boundaries."""
import os

ROOT = "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI"
W = ROOT + "/apps/worker/src"
IDX = W + "/index.ts"

lines = open(IDX).read().splitlines(keepends=True)
print("Lines:", len(lines))

def GL(s, e):
    return "".join(lines[s-1:e])

def chk(n, frag):
    c = lines[n-1]
    assert frag in c, f"L{n}: want {frag!r} got {c!r}"

chk(376,  "function isStringArray")
chk(744,  "HeartbeatHandle")
chk(746,  "function startHeartbeat")
chk(797,  "}")            # closing } of startHeartbeat
chk(799,  "failLatestIngestJob")
chk(830,  "getDealIdForJob")
chk(840,  "}")            # closing } of getDealIdForJob
chk(842,  "ensureNeedsOcrFlowEnqueued")
chk(2935, "registerWorker(\"analyze_deal\"")
chk(4195, "});")
chk(4197, "registerWorker(\"orchestration\"")
print("Boundaries OK")

dealsummary = GL(376, 743)
heartbeat   = GL(744, 797)
get_deal_id = GL(830, 840)
body        = GL(2936, 4194)

# 1) lib/heartbeat.ts
hb = (
    'import type { Job } from "bullmq";\n'
    'import { updateJob } from "./worker-utils";\n'
    'import { emitJobProgress } from "./job-progress";\n\n'
    + heartbeat + "\n"
)
open(W + "/lib/heartbeat.ts", "w").write(hb)
print("heartbeat.ts:", hb.count("\n"), "lines")

# 2) jobs/analyze-deal/processor.ts
os.makedirs(W + "/jobs/analyze-deal", exist_ok=True)
imp = """\
import type { Job } from "bullmq";
import { createHash } from "crypto";
import {
  generatePhase1DIOV1,
  DealOrchestrator,
  DIOStorageImpl,
  compileDIOToReport,
  compileDIOToReportWithPromotedFacts,
  SlideSequenceAnalyzer,
  MetricBenchmarkValidator,
  VisualDesignScorer,
  NarrativeArcDetector,
  FinancialHealthCalculator,
  RiskAssessmentEngine,
  sanitizeText,
} from "@dealdecision/core";
import {
  getPool,
  getDocumentsForDealWithAnalysis,
  insertPhaseBRun,
  getLatestPhaseBRun,
} from "../../lib/db";
import { hasTable } from "../../lib/visual-extraction";
import { updateJob } from "../../lib/worker-utils";
import { updateJobProgress, emitJobProgress } from "../../lib/job-progress";
import { getQueue } from "../../lib/queue";
import { makeJobId } from "../../lib/job-id";
import { startHeartbeat } from "../../lib/heartbeat";
import {
  buildPhase1DealOverviewV2,
  buildPhase1DealUnderstandingV1,
  buildPhase1UpdateReportV1,
} from "../../lib/phase1/dealOverviewV2";
import { buildPhase1BusinessArchetypeV1 } from "../../lib/phase1/businessArchetypeV1";
import {
  extractPhaseBFeaturesV1,
  fetchPhaseBVisualsFromDb,
} from "../../lib/phaseb/extract";
import { materializePhaseBVisualEvidenceForDeal } from "../../lib/phaseb/materialize-evidence";
import { generateAndPersistGovernedLlmOverviewBestEffort } from "../../lib/governed-llm-overlay";
import { promoteSlideFactsFromDocumentPageUnderstanding } from "../../lib/promote-slide-facts";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../../lib/document-page-understanding";
import { OpenAIGPT4oProvider } from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";

"""

proc = (
    imp
    + "// -- DealSummaryV2 helpers\n"
    + dealsummary + "\n"
    + "// -- getDealIdForJob\n"
    + get_deal_id + "\n"
    + "// -- Processor\n"
    + "export async function analyzeDealProcessor(job: Job): Promise<any> {\n"
    + body
    + "\n}\n"
)
open(W + "/jobs/analyze-deal/processor.ts", "w").write(proc)
print("processor.ts:", proc.count("\n"), "lines")

# 3) Rewrite index.ts — bottom to top
w = list(lines)
# R1: replace analyze_deal block (2935-4195) with single line
w[2934:4195] = ["registerWorker(\"analyze_deal\", analyzeDealProcessor);\n"]
# R2: remove getDealIdForJob (830-841 incl trailing blank)
w[829:841] = []
# R3: remove DealSummaryV2+heartbeat (376-797) + trailing blank (798)
w[375:798] = []

# Insert imports by searching content
out = list(w)
last_jobs = max((i for i, l in enumerate(out) if "./jobs/" in l and "Processor" in l), default=None)
assert last_jobs is not None, "no jobs import found"
out.insert(last_jobs + 1,
    "import { analyzeDealProcessor } from \"./jobs/analyze-deal/processor\";\n")
wutils = next(i for i, l in enumerate(out) if "\"./lib/worker-utils\"" in l)
out.insert(wutils + 1,
    "import { startHeartbeat } from \"./lib/heartbeat\";\n")

final = "".join(out)
open(IDX, "w").write(final)
print("index.ts:", final.count("\n"), "lines")

assert "from \"./jobs/analyze-deal/processor\"" in final
assert "from \"./lib/heartbeat\"" in final
assert "registerWorker(\"analyze_deal\", analyzeDealProcessor)" in final
assert "function isStringArray" not in final
assert "function startHeartbeat" not in final
assert "async function getDealIdForJob" not in final
print("All checks passed. PR14 done.")

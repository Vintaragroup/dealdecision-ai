#!/usr/bin/env python3
"""
PR14 extraction script — verified boundaries:
  DealSummaryV2 cluster:    376-743
  HeartbeatHandle+fn:       744-797
  failLatestIngestJob:      799-828  (STAYS)
  getDealIdForJob:          830-840  (MOVES)
  ensureNeedsOcr:           842+     (STAYS)
  analyze_deal block:       2935-4195
  registerWorker("orchestration"): 4197
"""
import os
import subprocess

ROOT = "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI"
WORKER = f"{ROOT}/apps/worker/src"
IDX = f"{WORKER}/index.ts"

# Read from git HEAD (untouched source of truth)
raw = subprocess.run(
    ["git", "show", "HEAD:apps/worker/src/index.ts"],
    capture_output=True, text=True, cwd=ROOT
)
if raw.returncode != 0 or not raw.stdout.strip():
    src_lines = open(IDX).read().splitlines(keepends=True)
    print("reading from disk")
else:
    src_lines = raw.stdout.splitlines(keepends=True)
    print(f"reading from git HEAD ({len(src_lines)} lines)")

def GL(s, e):
    """1-based inclusive, returns joined string."""
    return "".join(src_lines[s-1:e])

def GLS(s, e):
    """1-based inclusive, returns list of lines."""
    return src_lines[s-1:e]

# ── Verify key boundary points ────────────────────────────────────────────────
assert "function isStringArray" in src_lines[375], f"L376 unexpected: {src_lines[375]!r}"
assert "HeartbeatHandle" in src_lines[743], f"L744 unexpected: {src_lines[743]!r}"
assert "function startHeartbeat" in src_lines[745], f"L746 unexpected: {src_lines[745]!r}"
assert "failLatestIngestJob" in src_lines[798], f"L799 unexpected: {src_lines[798]!r}"
assert "getDealIdForJob" in src_lines[829], f"L830 unexpected: {src_lines[829]!r}"
assert 'registerWorker("analyze_deal"' in src_lines[2934], f"L2935 unexpected: {src_lines[2934]!r}"
print("Boundary assertions passed.")

# Find end of startHeartbeat (the `}` on its own line after last `};`)
heartbeat_end = None
for i in range(793, 800):
    if src_lines[i-1].strip() == "}":
        heartbeat_end = i
        break
assert heartbeat_end is not None, "Could not find end of startHeartbeat"
print(f"  startHeartbeat ends at line {heartbeat_end}")

# Find end of getDealIdForJob
get_deal_id_end = None
for i in range(833, 845):
    if src_lines[i-1].strip() == "}":
        get_deal_id_end = i
        break
assert get_deal_id_end is not None, "Could not find end of getDealIdForJob"
print(f"  getDealIdForJob ends at line {get_deal_id_end}")

# Find end of analyze_deal block
# It's the `});` that precedes registerWorker("orchestration"
analyze_end = None
for i in range(4200, 4215):
    if src_lines[i-1].strip() == "});" and 'registerWorker("orchestration"' in src_lines[i]:
        analyze_end = i - 1
        break
if analyze_end is None:
    # fallback: search
    for i in range(4190, 4220):
        if src_lines[i-1].strip() == "});":
            if i < len(src_lines) and 'registerWorker(' in src_lines[i]:
                analyze_end = i - 1
                break
assert analyze_end is not None, "Could not find end of analyze_deal block"
print(f"  analyze_deal block ends at line {analyze_end}")

# ── 1) Create lib/heartbeat.ts ────────────────────────────────────────────────
heartbeat_body = GL(744, heartbeat_end)

heartbeat_content = (
    'import type { Job } from "bullmq";\n'
    'import { updateJob } from "./worker-utils";\n'
    'import { emitJobProgress } from "./job-progress";\n'
    '\n'
    + heartbeat_body
    + '\n'
)

open(f"{WORKER}/lib/heartbeat.ts", "w").write(heartbeat_content)
print(f"wrote lib/heartbeat.ts ({heartbeat_content.count(chr(10))} lines)")

# ── 2) Create jobs/analyze-deal/processor.ts ─────────────────────────────────
dealsummary_cluster = GL(376, 743)      # isStringArray → end of generateDealSummaryV2
get_deal_id_fn = GL(830, get_deal_id_end)  # getDealIdForJob
analyze_body_inner = GL(2936, analyze_end - 1)  # body lines (inside the lambda)

os.makedirs(f"{WORKER}/jobs/analyze-deal", exist_ok=True)

proc_content = (
    'import type { Job } from "bullmq";\n'
    'import { createHash } from "crypto";\n'
    'import {\n'
    '  QUEUE_NAMES,\n'
    '  generatePhase1DIOV1,\n'
    '  DealOrchestrator,\n'
    '  DIOStorageImpl,\n'
    '  compileDIOToReport,\n'
    '  compileDIOToReportWithPromotedFacts,\n'
    '  SlideSequenceAnalyzer,\n'
    '  MetricBenchmarkValidator,\n'
    '  VisualDesignScorer,\n'
    '  NarrativeArcDetector,\n'
    '  FinancialHealthCalculator,\n'
    '  RiskAssessmentEngine,\n'
    '} from "@dealdecision/core";\n'
    'import {\n'
    '  getPool,\n'
    '  getDocumentsForDealWithAnalysis,\n'
    '  insertPhaseBRun,\n'
    '  getLatestPhaseBRun,\n'
    '} from "../../lib/db";\n'
    'import { sanitizeText } from "@dealdecision/core";\n'
    'import { hasTable } from "../../lib/visual-extraction";\n'
    'import { updateJob } from "../../lib/worker-utils";\n'
    'import { updateJobProgress, emitJobProgress } from "../../lib/job-progress";\n'
    'import { getQueue } from "../../lib/queue";\n'
    'import { makeJobId } from "../../lib/job-id";\n'
    'import { startHeartbeat } from "../../lib/heartbeat";\n'
    'import {\n'
    '  buildPhase1DealOverviewV2,\n'
    '  buildPhase1DealUnderstandingV1,\n'
    '  buildPhase1UpdateReportV1,\n'
    '} from "../../lib/phase1/dealOverviewV2";\n'
    'import { buildPhase1BusinessArchetypeV1 } from "../../lib/phase1/businessArchetypeV1";\n'
    'import { extractPhaseBFeaturesV1, fetchPhaseBVisualsFromDb } from "../../lib/phaseb/extract";\n'
    'import { materializePhaseBVisualEvidenceForDeal } from "../../lib/phaseb/materialize-evidence";\n'
    'import { generateAndPersistGovernedLlmOverviewBestEffort } from "../../lib/governed-llm-overlay";\n'
    'import { promoteSlideFactsFromDocumentPageUnderstanding } from "../../lib/promote-slide-facts";\n'
    'import { populateDocumentPageUnderstandingFromVisualExtractions } from "../../lib/document-page-understanding";\n'
    'import { OpenAIGPT4oProvider } from "../../lib/llm/providers/openai-provider";\n'
    'import type { ProviderConfig } from "../../lib/llm/types";\n'
    'import { maybeEnqueueAnalyzeDealGuarantee } from "../../lib/analyze-deal-guarantee";\n'
    '\n'
    '// ── DealSummaryV2 helpers (exclusively used by analyzeDealProcessor) ─────────\n'
    + dealsummary_cluster
    + '\n'
    '// ── getDealIdForJob ───────────────────────────────────────────────────────────\n'
    + get_deal_id_fn
    + '\n'
    '// ── Processor ────────────────────────────────────────────────────────────────\n'
    'export async function analyzeDealProcessor(job: Job): Promise<any> {\n'
    + analyze_body_inner
    + '\n}\n'
)

open(f"{WORKER}/jobs/analyze-deal/processor.ts", "w").write(proc_content)
print(f"wrote jobs/analyze-deal/processor.ts ({proc_content.count(chr(10))} lines)")

# ── 3) Rewrite index.ts ───────────────────────────────────────────────────────
working = list(src_lines)  # mutable copy of lines for editing

# We'll track offsets as we remove/replace.
# Work from BOTTOM to TOP so line numbers don't shift.
replacements = []

# R1: Replace analyze_deal block (lines 2935 to analyze_end) with single registration line
replacements.append((2935, analyze_end, ['registerWorker("analyze_deal", analyzeDealProcessor);\n']))

# R2: Remove getDealIdForJob (lines 830 to get_deal_id_end), including trailing blank line
replacements.append((830, get_deal_id_end + 1, []))

# R3: Remove DealSummaryV2 cluster + startHeartbeat (lines 376 to heartbeat_end)
# Replace with just the import comment
replacements.append((376, heartbeat_end, []))

# Sort by start line descending to apply bottom-up
replacements.sort(key=lambda x: x[0], reverse=True)

for (start, end, replacement) in replacements:
    working[start-1:end] = replacement

# R4: Add new imports — find the last existing processor import line
last_import_line = None
for i, l in enumerate(working):
    if 'from "./jobs/' in l and 'Processor' in l:
        last_import_line = i

assert last_import_line is not None, "Could not find last processor import line"
working.insert(last_import_line + 1, 'import { analyzeDealProcessor } from "./jobs/analyze-deal/processor";\n')
# Re-find the insertion point for heartbeat import (after worker-utils import)
worker_utils_line = None
for i, l in enumerate(working):
    if '"./lib/worker-utils"' in l:
        worker_utils_line = i
        break
assert worker_utils_line is not None, "Could not find worker-utils import"
working.insert(worker_utils_line + 1, 'import { startHeartbeat } from "./lib/heartbeat";\n')

out = "".join(working)
open(IDX, "w").write(out)
print(f"wrote index.ts ({out.count(chr(10))} lines)")
print("Done.")

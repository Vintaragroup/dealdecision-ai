#!/usr/bin/env python3
"""PR14 audit: compares original analyze_deal inline body (git HEAD) vs processor.ts."""
import subprocess, re, sys

ROOT = "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI"
PROC = ROOT + "/apps/worker/src/jobs/analyze-deal/processor.ts"

# ── Load original from git HEAD~1 (pre-PR14) ─────────────────────────────────
result = subprocess.run(
    ["git", "show", "HEAD~1:apps/worker/src/index.ts"],
    capture_output=True, text=True, cwd=ROOT
)
orig = result.stdout.splitlines()
print(f"git HEAD~1 index.ts: {len(orig)} lines (returncode={result.returncode})")
if result.returncode != 0:
    print("stderr:", result.stderr[:200])
    sys.exit(1)

# Find analyze_deal in git HEAD
orig_start = next((i for i, l in enumerate(orig) if 'registerWorker("analyze_deal"' in l), None)
if orig_start is None:
    print("ERROR: registerWorker(\"analyze_deal\" not found in git HEAD~1")
    print("Falling back to disk comparison only.")
    orig_body = []
else:
    print(f"analyze_deal starts at line {orig_start+1} (1-based): {orig[orig_start].strip()[:80]}")
    # Confirm what's near line 4195
    for probe in [4192,4193,4194,4195,4196]:
        if probe < len(orig):
            print(f"  orig[{probe}] (L{probe+1}): {orig[probe].strip()!r}")
    # Find the closing `});`
    orig_end = None
    for i in range(orig_start+10, min(orig_start+1400, len(orig))):
        if orig[i].strip() == "});" :
            # check next non-blank line is a registerWorker
            for j in range(i+1, min(i+5, len(orig))):
                if orig[j].strip() and "registerWorker(" in orig[j]:
                    orig_end = i
                    break
            if orig_end:
                break
    if orig_end is None:
        print("ERROR: Could not find end of analyze_deal block")
        sys.exit(1)
    print(f"analyze_deal ends at line {orig_end+1} (1-based): {orig[orig_end].strip()!r}")
    orig_body = orig[orig_start+1:orig_end]
    print(f"Original body: {len(orig_body)} lines")

# ── Load processor.ts body ────────────────────────────────────────────────────
proc_lines = open(PROC).read().splitlines()
proc_func_line = next(i for i, l in enumerate(proc_lines) if "export async function analyzeDealProcessor" in l)
# Find the last `}` (closing brace of the exported function)
proc_body = proc_lines[proc_func_line+1:-1]
print(f"Processor body: {len(proc_body)} lines (function at line {proc_func_line+1})")

def patterns(lines, rx_str):
    rx = re.compile(rx_str)
    return [(i+1, l.strip()) for i, l in enumerate(lines) if rx.search(l)]

def event_set(lines):
    return sorted(set(m.group(1) for _, l in patterns(lines, r'event: "') for m in [re.search(r'event: "([^"]+)"', l)] if m))

def env_set(lines):
    return sorted(set(e for _, l in patterns(lines, r'process\.env\.') for e in re.findall(r'process\.env\.(\w+)', l)))

DIVIDER = "-" * 70

if orig_body:
    # ── 1) updateJob calls ────────────────────────────────────────────────────
    orig_uj = patterns(orig_body, r'updateJob\(')
    proc_uj = patterns(proc_body, r'updateJob\(')
    print(f"\n{DIVIDER}\n=== updateJob calls: orig={len(orig_uj)}, proc={len(proc_uj)} MATCH={'YES' if len(orig_uj)==len(proc_uj) else 'NO'} ===")
    for n, l in orig_uj: print(f"  orig+{n:4}: {l[:90]}")
    print("  ---")
    for n, l in proc_uj: print(f"  proc+{n:4}: {l[:90]}")

    # ── 2) Log events ─────────────────────────────────────────────────────────
    orig_ev = event_set(orig_body)
    proc_ev = event_set(proc_body)
    only_orig = [e for e in orig_ev if e not in proc_ev]
    only_proc = [e for e in proc_ev if e not in orig_ev]
    print(f"\n{DIVIDER}\n=== Log events: orig={len(orig_ev)}, proc={len(proc_ev)} MATCH={'YES' if not only_orig and not only_proc else 'NO'} ===")
    if only_orig: print(f"  MISSING from proc: {only_orig}")
    if only_proc: print(f"  NEW in proc (unexpected): {only_proc}")
    if not only_orig and not only_proc: print("  All event names match.")

    # ── 3) SQL ────────────────────────────────────────────────────────────────
    orig_sql = patterns(orig_body, r'INSERT|UPDATE\s|SELECT\s')
    proc_sql = patterns(proc_body, r'INSERT|UPDATE\s|SELECT\s')
    print(f"\n{DIVIDER}\n=== SQL hits: orig={len(orig_sql)}, proc={len(proc_sql)} MATCH={'YES' if len(orig_sql)==len(proc_sql) else 'NO'} ===")
    for n, l in orig_sql: print(f"  orig+{n:4}: {l[:80]}")
    print("  ---")
    for n, l in proc_sql: print(f"  proc+{n:4}: {l[:80]}")

    # ── 4) Queue enqueues ─────────────────────────────────────────────────────
    orig_q = patterns(orig_body, r'getQueue\(|insightsQueue\.add\(')
    proc_q = patterns(proc_body, r'getQueue\(|insightsQueue\.add\(')
    print(f"\n{DIVIDER}\n=== Queue enqueues: orig={len(orig_q)}, proc={len(proc_q)} MATCH={'YES' if len(orig_q)==len(proc_q) else 'NO'} ===")
    for n, l in orig_q: print(f"  orig+{n:4}: {l[:80]}")
    print("  ---")
    for n, l in proc_q: print(f"  proc+{n:4}: {l[:80]}")

    # ── 5) Early exits ────────────────────────────────────────────────────────
    orig_ex = patterns(orig_body, r'return \{ ok: false')
    proc_ex = patterns(proc_body, r'return \{ ok: false')
    print(f"\n{DIVIDER}\n=== Early exits (ok:false): orig={len(orig_ex)}, proc={len(proc_ex)} MATCH={'YES' if len(orig_ex)==len(proc_ex) else 'NO'} ===")

    # ── 6) Env vars ───────────────────────────────────────────────────────────
    orig_env = env_set(orig_body)
    proc_env = env_set(proc_body)
    only_orig_e = [e for e in orig_env if e not in proc_env]
    only_proc_e = [e for e in proc_env if e not in orig_env]
    print(f"\n{DIVIDER}\n=== Env vars: orig={len(orig_env)}, proc={len(proc_env)} MATCH={'YES' if not only_orig_e and not only_proc_e else 'NO'} ===")
    print(f"  orig: {orig_env}")
    print(f"  proc: {proc_env}")
    if only_orig_e: print(f"  MISSING from proc: {only_orig_e}")
    if only_proc_e: print(f"  NEW in proc: {only_proc_e}")

    # ── 7) Return shapes ──────────────────────────────────────────────────────
    orig_ret = patterns(orig_body, r'return \{')
    proc_ret = patterns(proc_body, r'return \{')
    print(f"\n{DIVIDER}\n=== return shapes: orig={len(orig_ret)}, proc={len(proc_ret)} MATCH={'YES' if len(orig_ret)==len(proc_ret) else 'NO'} ===")
    for n, l in orig_ret: print(f"  orig+{n:4}: {l[:80]}")
    print("  ---")
    for n, l in proc_ret: print(f"  proc+{n:4}: {l[:80]}")

    # ── 8) Body line delta ────────────────────────────────────────────────────
    print(f"\n{DIVIDER}\n=== Line delta: orig={len(orig_body)}, proc={len(proc_body)}, delta={len(proc_body)-len(orig_body)} ===")
    expected_delta = 0  # should be 0 for verbatim extraction
    note = "PASS (verbatim)" if abs(len(proc_body)-len(orig_body)) <= 2 else "WARN: non-trivial delta"
    print(f"  {note}")

print(f"\n{'='*70}\nDONE\n{'='*70}")

/*
  Parse worker JSONL logs and report peak RSS per stage.

  Usage:
    pnpm tsx scripts/worker-mem-peaks.ts < render.log
    pnpm tsx scripts/worker-mem-peaks.ts --top 30 --json < render.log

  Input: any text stream; lines that contain JSON objects with { event: "mem" } are parsed.
*/

type MemEvent = {
  event?: unknown;
  stage?: unknown;
  rss_mb?: unknown;
  heap_used_mb?: unknown;
  external_mb?: unknown;
  array_buffers_mb?: unknown;
  pid?: unknown;
  meta?: unknown;
};

type StageStats = {
  count: number;
  maxRssMb: number;
  maxHeapUsedMb: number;
  maxExternalMb: number;
  maxArrayBuffersMb: number | null;
  exampleMeta?: unknown;
};

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractJsonObject(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Fast path: line is JSON.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // Fallback: find first JSON object within the line.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") {
      args.set("json", true);
      continue;
    }
    if (a === "--top") {
      const v = argv[i + 1];
      if (v) {
        args.set("top", v);
        i += 1;
      }
      continue;
    }
    if (a === "--min-mb") {
      const v = argv[i + 1];
      if (v) {
        args.set("min-mb", v);
        i += 1;
      }
      continue;
    }
  }

  const top = Math.max(1, Math.floor(Number(args.get("top") ?? 100)));
  const minMb = Math.max(0, Number(args.get("min-mb") ?? 0));
  const json = Boolean(args.get("json"));

  return { top, minMb, json };
}

async function main() {
  const { top, minMb, json } = parseArgs(process.argv.slice(2));

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const input = Buffer.concat(chunks).toString("utf8");

  const perStage = new Map<string, StageStats>();
  let totalLines = 0;
  let parsedMemEvents = 0;

  for (const line of input.split(/\r?\n/)) {
    totalLines += 1;
    const obj = extractJsonObject(line);
    if (!obj || typeof obj !== "object") continue;

    const ev = obj as MemEvent;
    if (ev.event !== "mem") continue;

    const stage = typeof ev.stage === "string" ? ev.stage : null;
    const rssMb = toNumber(ev.rss_mb);
    if (!stage || rssMb == null) continue;

    parsedMemEvents += 1;

    const heapMb = toNumber(ev.heap_used_mb) ?? 0;
    const externalMb = toNumber(ev.external_mb) ?? 0;
    const arrayBuffersMb = toNumber(ev.array_buffers_mb);

    const prev = perStage.get(stage) ?? {
      count: 0,
      maxRssMb: 0,
      maxHeapUsedMb: 0,
      maxExternalMb: 0,
      maxArrayBuffersMb: null,
    };

    prev.count += 1;
    prev.maxRssMb = Math.max(prev.maxRssMb, rssMb);
    prev.maxHeapUsedMb = Math.max(prev.maxHeapUsedMb, heapMb);
    prev.maxExternalMb = Math.max(prev.maxExternalMb, externalMb);
    if (arrayBuffersMb != null) {
      prev.maxArrayBuffersMb =
        prev.maxArrayBuffersMb == null ? arrayBuffersMb : Math.max(prev.maxArrayBuffersMb, arrayBuffersMb);
    }
    if (prev.exampleMeta == null && ev.meta != null) prev.exampleMeta = ev.meta;

    perStage.set(stage, prev);
  }

  const rows = Array.from(perStage.entries())
    .map(([stage, s]) => ({ stage, ...s }))
    .filter((r) => r.maxRssMb >= minMb)
    .sort((a, b) => b.maxRssMb - a.maxRssMb)
    .slice(0, top);

  const overallPeak = rows.reduce((max, r) => Math.max(max, r.maxRssMb), 0);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          total_lines: totalLines,
          mem_events: parsedMemEvents,
          overall_peak_rss_mb: overallPeak,
          stages: rows,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  process.stdout.write(`Parsed ${parsedMemEvents} mem events (from ${totalLines} lines)\n`);
  process.stdout.write(`Overall peak RSS (among reported stages): ${overallPeak.toFixed(1)} MB\n\n`);

  for (const r of rows) {
    const ab = r.maxArrayBuffersMb == null ? "n/a" : r.maxArrayBuffersMb.toFixed(1);
    process.stdout.write(
      `${r.maxRssMb.toFixed(1)} MB rss | heap ${r.maxHeapUsedMb.toFixed(1)} | ext ${r.maxExternalMb.toFixed(1)} | ab ${ab} | n=${r.count} | ${r.stage}\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`worker-mem-peaks failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

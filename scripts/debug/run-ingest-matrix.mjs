import fs from "node:fs";
import path from "node:path";

function usageAndExit(code = 1) {
  // eslint-disable-next-line no-console
  console.error(
    [
      "Usage:",
      "  node scripts/debug/run-ingest-matrix.mjs [--api http://localhost:9001] [--out /tmp/file.jsonl]",
      "",
      "Reads sample files from /tmp/ddai_ingest_samples by default.",
    ].join("\n")
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    api: "http://localhost:9001",
    out: null,
    dir: "/tmp/ddai_ingest_samples",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usageAndExit(0);
    if (a === "--api") {
      args.api = argv[++i];
      continue;
    }
    if (a === "--out") {
      args.out = argv[++i];
      continue;
    }
    if (a === "--dir") {
      args.dir = argv[++i];
      continue;
    }
    // eslint-disable-next-line no-console
    console.error(`Unknown arg: ${a}`);
    usageAndExit(1);
  }
  return args;
}

async function httpJson(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts?.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep json null
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    // @ts-ignore
    err.details = { status: res.status, statusText: res.statusText, body: json ?? text };
    throw err;
  }
  return json;
}

function b64File(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString("base64");
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = args.out || path.join("/tmp", `ddai_ingest_matrix_${Date.now()}.jsonl`);

  const items = [
    {
      kind: "pdf",
      file: path.join(args.dir, "sample.pdf"),
      mime: "application/pdf",
      name: "sample.pdf",
    },
    {
      kind: "xlsx",
      file: path.join(args.dir, "sample.xlsx"),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      name: "sample.xlsx",
    },
    {
      kind: "pptx",
      file: path.join(args.dir, "sample.pptx"),
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      name: "sample.pptx",
    },
    {
      kind: "docx",
      file: path.join(args.dir, "sample.docx"),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      name: "sample.docx",
    },
    {
      kind: "png",
      file: path.join(args.dir, "sample.png"),
      mime: "image/png",
      name: "sample.png",
    },
    {
      kind: "jpg",
      file: path.join(args.dir, "sample.jpg"),
      mime: "image/jpeg",
      name: "sample.jpg",
    },
  ];

  fs.writeFileSync(outPath, "");
  const ts = nowIso();

  for (const item of items) {
    if (!fs.existsSync(item.file)) {
      throw new Error(`Missing sample file: ${item.file}`);
    }

    const dealName = `ingest-matrix-${item.kind}-${ts}`;
    const deal = await httpJson(`${args.api}/api/v1/deals`, {
      method: "POST",
      body: JSON.stringify({ name: dealName, stage: "intake", priority: "medium" }),
    });

    const dealId = deal?.id;
    if (!dealId) throw new Error(`Deal create returned no id for ${item.kind}`);

    const payload = {
      file_buffer: b64File(item.file),
      file_name: item.name,
      mime_type: item.mime,
      title: item.name,
    };
    const upload = await httpJson(`${args.api}/api/v1/deals/${dealId}/documents/upload`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const rec = {
      ts,
      kind: item.kind,
      deal_id: dealId,
      document_id: upload?.document_id ?? null,
      job_id: upload?.job_id ?? null,
    };
    fs.appendFileSync(outPath, `${JSON.stringify(rec)}\n`);

    // eslint-disable-next-line no-console
    console.log(rec);
  }

  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

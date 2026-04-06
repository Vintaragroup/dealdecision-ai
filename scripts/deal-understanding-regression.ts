import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

type DealThreshold = {
  pass: number;
  fail: number;
  skip: number;
  dealId: string;
};

type SummaryRow = {
  deal: string;
  pass: number;
  fail: number;
  skip: number;
  overallScore: string;
  status: string;
};

const REPO_ROOT = path.resolve(__dirname, "..");
const VALIDATOR_PATH = path.join(
  REPO_ROOT,
  "evaluation",
  "deal_understanding",
  "scripts",
  "validate_deal_understanding.py",
);

const REQUIRED_DEALS: Record<string, DealThreshold> = {
  Palm: {
    pass: 18,
    fail: 0,
    skip: 0,
    dealId: "5c8c7d6e-c992-4be7-8b10-268eac36f663",
  },
  Probility: {
    pass: 18,
    fail: 0,
    skip: 0,
    dealId: "42be8b30-2b7d-45e0-ade0-99427a505c59",
  },
  Verse: {
    pass: 18,
    fail: 0,
    skip: 0,
    dealId: "bcd59d33-7887-41cd-80b9-742bc5ba945a",
  },
  ToxyScreen: {
    pass: 17,
    fail: 0,
    skip: 0,
    dealId: "05042123-6c4f-4dcb-9131-a95fce3cd28c",
  },
};

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      continue;
    }

    const equalIndex = token.indexOf("=");
    if (equalIndex !== -1) {
      const key = token.slice(2, equalIndex);
      const value = token.slice(equalIndex + 1);
      parsed[key] = value;
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      i += 1;
    } else {
      parsed[key] = "true";
    }
  }

  return parsed;
}

function parseSummaryRows(markdown: string): Map<string, SummaryRow> {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => line.trim() === "| Deal | Pass | Fail | Skip | Overall Score | Status |",
  );

  if (headerIndex === -1) {
    throw new Error("Could not find cross-deal summary table in validator output.");
  }

  const rows = new Map<string, SummaryRow>();

  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) {
      break;
    }

    const match = /^\|\s*(.*?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/.exec(line);
    if (!match) {
      continue;
    }

    const deal = match[1].replace(/\*/g, "").trim();
    rows.set(deal, {
      deal,
      pass: Number(match[2]),
      fail: Number(match[3]),
      skip: Number(match[4]),
      overallScore: match[5].trim(),
      status: match[6].trim(),
    });
  }

  return rows;
}

async function fetchUnderstandingPayload(url: string, token: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const bodyText = await response.text();

    let parsedBody: unknown = bodyText;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("application/json")) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = bodyText;
      }
    }

    return {
      fetchedAt: new Date().toISOString(),
      requestUrl: url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parsedBody,
    };
  } catch (error) {
    return {
      fetchedAt: new Date().toISOString(),
      requestUrl: url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = (
    args.api
    || process.env.DEAL_UNDERSTANDING_API_BASE_URL
    || process.env.API_BASE_URL
    || ""
  ).trim();

  if (!apiBase) {
    throw new Error(
      "Missing API base URL. Set DEAL_UNDERSTANDING_API_BASE_URL or pass --api <url>.",
    );
  }

  const pythonBin = (args.python || process.env.PYTHON_BIN || "python3").trim();
  const runStamp = new Date().toISOString().replace(/[.:]/g, "-");
  const runDir = path.resolve(
    REPO_ROOT,
    args["out-dir"] || path.join("artifacts", "deal-understanding-regression", runStamp),
  );
  const payloadDir = path.join(runDir, "understanding-payloads");

  await fs.mkdir(payloadDir, { recursive: true });

  const validatorReportPath = path.join(runDir, "validator-report.md");
  const validatorStdoutPath = path.join(runDir, "validator.stdout.log");
  const validatorStderrPath = path.join(runDir, "validator.stderr.log");
  const summaryPath = path.join(runDir, "regression-summary.json");

  const validatorResult = spawnSync(
    pythonBin,
    [VALIDATOR_PATH, "--api", apiBase, "--output", validatorReportPath],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );

  if (validatorResult.error) {
    throw validatorResult.error;
  }

  await fs.writeFile(validatorStdoutPath, validatorResult.stdout || "", "utf8");
  await fs.writeFile(validatorStderrPath, validatorResult.stderr || "", "utf8");

  const reportMarkdown = await fs.readFile(validatorReportPath, "utf8");
  const summaryRows = parseSummaryRows(reportMarkdown);
  const failures: string[] = [];

  const validatorExitCode = validatorResult.status ?? 1;
  if (validatorExitCode !== 0) {
    failures.push(`Validator exit code was ${validatorExitCode}.`);
  }

  for (const [dealName, threshold] of Object.entries(REQUIRED_DEALS)) {
    const row = summaryRows.get(dealName);
    if (!row) {
      failures.push(`Missing cross-deal summary row for ${dealName}.`);
      continue;
    }

    if (row.pass !== threshold.pass) {
      failures.push(`${dealName}: expected pass=${threshold.pass}, got ${row.pass}.`);
    }
    if (row.fail !== threshold.fail) {
      failures.push(`${dealName}: expected fail=${threshold.fail}, got ${row.fail}.`);
    }
    if (row.skip !== threshold.skip) {
      failures.push(`${dealName}: expected skip=${threshold.skip}, got ${row.skip}.`);
    }
  }

  for (const row of summaryRows.values()) {
    if (row.deal === "TOTAL") {
      continue;
    }
    if (row.fail > 0) {
      failures.push(`${row.deal}: cross-deal summary reports ${row.fail} failing checks.`);
    }
  }

  const authToken = (
    process.env.BENCHMARK_AUTH_TOKEN
    || process.env.AUTH_TOKEN
    || ""
  ).trim();

  for (const [dealName, threshold] of Object.entries(REQUIRED_DEALS)) {
    const url = `${apiBase}/api/v1/deals/${threshold.dealId}/understanding`;
    const payload = await fetchUnderstandingPayload(url, authToken);
    const payloadPath = path.join(payloadDir, `${dealName}.json`);
    await fs.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  const observedRows = Object.fromEntries(summaryRows.entries());
  const summary = {
    runStamp,
    apiBase,
    pythonBin,
    validator: {
      exitCode: validatorExitCode,
      reportPath: validatorReportPath,
      stdoutPath: validatorStdoutPath,
      stderrPath: validatorStderrPath,
    },
    requiredDeals: REQUIRED_DEALS,
    observedRows,
    understandingPayloadDir: payloadDir,
    failures,
    passed: failures.length === 0,
  };

  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("Deal understanding regression summary:");
  for (const [dealName, threshold] of Object.entries(REQUIRED_DEALS)) {
    const row = summaryRows.get(dealName);
    if (!row) {
      console.log(`- ${dealName}: missing row`);
      continue;
    }
    console.log(
      `- ${dealName}: pass=${row.pass}/${threshold.pass}, fail=${row.fail}, skip=${row.skip}`,
    );
  }
  console.log(`Artifacts: ${runDir}`);

  if (failures.length > 0) {
    console.error("Regression gate failed:");
    for (const issue of failures) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Regression gate passed.");
}

main().catch((error) => {
  console.error("deal-understanding-regression failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

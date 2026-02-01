export {};

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

async function loadEnvFallback(repoRoot: string) {
  if (process.env.DATABASE_URL) return;
  const candidates = [path.join(repoRoot, ".env"), path.join(repoRoot, "apps/api/.env")];
  for (const candidate of candidates) {
    try {
      const txt = await fs.readFile(candidate, "utf8");
      const parsed = parseDotenv(txt);
      if (!process.env.DATABASE_URL && parsed.DATABASE_URL) {
        process.env.DATABASE_URL = parsed.DATABASE_URL;
        return;
      }
    } catch {
      // ignore
    }
  }
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase().trim());
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : defaultValue;
}

function normalizeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function inferMimeTypeFromName(nameRaw: string): string | null {
  const name = nameRaw.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "csv":
      return "text/csv";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc":
      return "application/msword";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    default:
      return null;
  }
}

function inferDocKindFromUpload(args: { fileName?: string | null; mimeType?: string | null; title?: string | null }): string {
  const fileName = normalizeStr(args.fileName).toLowerCase();
  const title = normalizeStr(args.title).toLowerCase();
  const mimeType = normalizeStr(args.mimeType).toLowerCase();
  const hint = `${fileName} ${title} ${mimeType}`;

  if (hint.includes(".xlsx") || hint.includes(".xls") || hint.includes("spreadsheet") || hint.includes("excel")) return "excel";
  if (hint.includes("application/pdf") || hint.includes(".pdf")) return "pdf";
  if (hint.includes("presentation") || hint.includes(".pptx") || hint.includes(".ppt")) return "powerpoint";
  if (hint.includes("wordprocessingml") || hint.includes("application/msword") || hint.includes(".docx") || hint.includes(".doc")) return "word";
  if (hint.includes("image/") || hint.match(/\.(png|jpe?g|gif|webp)\b/)) return "image";
  return "unknown";
}

async function hasTable(pool: Pool, tableName: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
     ) AS ok`,
    [tableName]
  );
  return !!rows[0]?.ok;
}

async function hasColumn(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
     ) AS ok`,
    [tableName, columnName]
  );
  return !!rows[0]?.ok;
}

type DocRow = {
  id: string;
  deal_id: string | null;
  title: string | null;
  type: string | null;
  mime_type: string | null;
  extraction_metadata: any | null;
  file_name: string | null;
  file_mime_type: string | null;
};

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");
  await loadEnvFallback(repoRoot);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (set it in your shell, .env, or apps/api/.env)");
  }

  const dryRun = envFlag("DRY_RUN", true);
  const dealId = normalizeStr(process.env.DEAL_ID);
  const limit = envInt("LIMIT", 0);
  const updateUnknown = envFlag("UPDATE_UNKNOWN", false);

  const pool = new Pool({ connectionString: databaseUrl });

  const hasDocumentsMimeType = await hasColumn(pool, "documents", "mime_type");
  const hasDocumentsExtractionMetadata = await hasColumn(pool, "documents", "extraction_metadata");
  const hasDocumentsUploadedAt = await hasColumn(pool, "documents", "uploaded_at");
  const hasDocumentsCreatedAt = await hasColumn(pool, "documents", "created_at");
  const canJoinDocumentFiles = await hasTable(pool, "document_files") && (await hasColumn(pool, "document_files", "document_id"));

  if (!hasDocumentsExtractionMetadata && !hasDocumentsMimeType) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          message: "No-op: documents table has neither mime_type nor extraction_metadata columns.",
        },
        null,
        2
      )
    );
    await pool.end();
    return;
  }

  const join = canJoinDocumentFiles
    ? "LEFT JOIN document_files df ON df.document_id = d.id"
    : "";

  const selectDf = canJoinDocumentFiles
    ? ", df.file_name, df.mime_type AS file_mime_type"
    : ", NULL::text AS file_name, NULL::text AS file_mime_type";

  const whereDeal = dealId ? "AND d.deal_id = $1" : "";
  const params: any[] = dealId ? [dealId] : [];

  const whereNeedsBackfill = [
    hasDocumentsMimeType ? "(d.mime_type IS NULL OR d.mime_type = '')" : "FALSE",
    hasDocumentsExtractionMetadata
      ? "(d.extraction_metadata IS NULL OR (d.extraction_metadata->>'doc_kind') IS NULL OR (d.extraction_metadata->>'doc_kind') = '')"
      : "FALSE",
  ];

  // If UPDATE_UNKNOWN=1, treat doc_kind='unknown' as missing.
  if (hasDocumentsExtractionMetadata && updateUnknown) {
    whereNeedsBackfill[1] =
      "(d.extraction_metadata IS NULL OR (d.extraction_metadata->>'doc_kind') IS NULL OR (d.extraction_metadata->>'doc_kind') = '' OR lower(d.extraction_metadata->>'doc_kind') = 'unknown')";
  }

  const where = `WHERE 1=1 ${whereDeal} AND (${whereNeedsBackfill.join(" OR ")})`;

  const orderBy = hasDocumentsUploadedAt
    ? "d.uploaded_at DESC NULLS LAST"
    : hasDocumentsCreatedAt
      ? "d.created_at DESC NULLS LAST"
      : "d.id DESC";

  const limitSql = limit > 0 ? `LIMIT ${limit}` : "";

  const { rows } = await pool.query<DocRow>(
    `SELECT d.id, d.deal_id, d.title, d.type,
            ${hasDocumentsMimeType ? "d.mime_type" : "NULL::text AS mime_type"},
            ${hasDocumentsExtractionMetadata ? "d.extraction_metadata" : "NULL::jsonb AS extraction_metadata"}
            ${selectDf}
       FROM documents d
       ${join}
       ${where}
       ORDER BY ${orderBy}
       ${limitSql}`,
    params
  );

  let wouldUpdateMimeType = 0;
  let wouldUpdateDocKind = 0;
  let updatedMimeType = 0;
  let updatedDocKind = 0;
  let skippedNoInference = 0;

  for (const r of rows) {
    const currentMime = normalizeStr(r.mime_type).trim();
    const currentMeta = r.extraction_metadata && typeof r.extraction_metadata === "object" ? r.extraction_metadata : {};
    const currentDocKind = normalizeStr(currentMeta?.doc_kind ?? currentMeta?.docKind).trim();

    const fileName = normalizeStr(r.file_name || "").trim() || null;
    const title = normalizeStr(r.title || "").trim() || null;
    const fileMime = normalizeStr(r.file_mime_type).trim() || null;

    const inferredMime = fileMime || inferMimeTypeFromName(fileName || title || "");
    const inferredDocKind = inferDocKindFromUpload({ fileName, mimeType: inferredMime || currentMime || null, title });

    const needsMime = hasDocumentsMimeType && !currentMime && !!inferredMime;
    const treatUnknownAsMissing = updateUnknown && currentDocKind.toLowerCase() === "unknown";
    const needsDocKind =
      hasDocumentsExtractionMetadata && (!currentDocKind || treatUnknownAsMissing) && inferredDocKind !== "unknown";

    if (!needsMime && !needsDocKind) {
      if (!inferredMime && inferredDocKind === "unknown") skippedNoInference += 1;
      continue;
    }

    if (needsMime) wouldUpdateMimeType += 1;
    if (needsDocKind) wouldUpdateDocKind += 1;

    if (dryRun) continue;

    if (needsMime && inferredMime) {
      await pool.query(
        `UPDATE documents
            SET mime_type = $2,
                updated_at = now()
          WHERE id = $1
            AND (mime_type IS NULL OR mime_type = '')`,
        [r.id, inferredMime]
      );
      updatedMimeType += 1;
    }

    if (needsDocKind) {
      await pool.query(
        `UPDATE documents
            SET extraction_metadata = COALESCE(extraction_metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = now()
          WHERE id = $1
            AND (
              extraction_metadata IS NULL
              OR (extraction_metadata->>'doc_kind') IS NULL
              OR (extraction_metadata->>'doc_kind') = ''
              ${updateUnknown ? "OR lower(extraction_metadata->>'doc_kind') = 'unknown'" : ""}
            )`,
        [r.id, JSON.stringify({ doc_kind: inferredDocKind })]
      );
      updatedDocKind += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: dryRun,
        deal_id: dealId || null,
        limit: limit || null,
        update_unknown: updateUnknown,
        scanned_rows: rows.length,
        would_update: {
          mime_type: wouldUpdateMimeType,
          doc_kind: wouldUpdateDocKind,
        },
        updated: {
          mime_type: updatedMimeType,
          doc_kind: updatedDocKind,
        },
        skipped_no_inference: skippedNoInference,
        schema: {
          documents_mime_type: hasDocumentsMimeType,
          documents_extraction_metadata: hasDocumentsExtractionMetadata,
          documents_uploaded_at: hasDocumentsUploadedAt,
          documents_created_at: hasDocumentsCreatedAt,
          document_files_joinable: canJoinDocumentFiles,
        },
      },
      null,
      2
    )
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

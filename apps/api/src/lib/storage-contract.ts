export type StorageDriver = "local" | "r2";

function normalizeMode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function readNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function resolveR2Endpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  // Canonical: R2_ENDPOINT. Back-compat: R2_S3_ENDPOINT (used by older Render env templates).
  return readNonEmptyEnv(env, "R2_ENDPOINT") ?? readNonEmptyEnv(env, "R2_S3_ENDPOINT");
}

export function getStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const explicit = normalizeMode(
    env.STORAGE_DRIVER ?? env.DOCUMENT_STORAGE_MODE ?? env.DOCUMENT_STORAGE ?? env.DOCUMENT_STORAGE_DRIVER
  );
  if (explicit === "local") return "local";
  if (explicit === "r2") return "r2";

  // Back-compat default: if a bucket is configured, prefer r2; otherwise local.
  const bucket = readNonEmptyEnv(env, "R2_BUCKET");
  return bucket ? "r2" : "local";
}

export function assertProductionStorageContract(env: NodeJS.ProcessEnv = process.env): {
  storage_driver: StorageDriver;
  r2_bucket: string | null;
  r2_endpoint: string | null;
} {
  const nodeEnv = typeof env.NODE_ENV === "string" ? env.NODE_ENV.trim().toLowerCase() : "";
  const storageDriver = getStorageDriver(env);
  const r2Endpoint = resolveR2Endpoint(env);
  const r2Bucket = readNonEmptyEnv(env, "R2_BUCKET");
  const r2AccessKeyId = readNonEmptyEnv(env, "R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = readNonEmptyEnv(env, "R2_SECRET_ACCESS_KEY");

  if (nodeEnv === "production") {
    // In production we should never silently fall back to local disk.
    if (storageDriver !== "r2") {
      throw new Error(
        "Production storage contract violated: STORAGE_DRIVER must be 'r2' (or DOCUMENT_STORAGE_MODE='r2'). " +
          "Refusing to start with local filesystem storage in NODE_ENV=production."
      );
    }

    // If STORAGE_DRIVER=r2, require the full R2 config to be present.
    if (!r2Endpoint || !r2Bucket || !r2AccessKeyId || !r2SecretAccessKey) {
      throw new Error(
        "Production storage contract violated: STORAGE_DRIVER=r2 requires R2_ENDPOINT (or R2_S3_ENDPOINT), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY."
      );
    }
  }

  return { storage_driver: storageDriver, r2_bucket: r2Bucket, r2_endpoint: r2Endpoint };
}

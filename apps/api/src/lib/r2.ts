import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Transform, Readable } from "node:stream";

function stripUndefined<T extends Record<string, any>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  signedUrlTtlSeconds: number;
  publicBaseUrl?: string;
};

class CountingStream extends Transform {
  public bytes = 0;
  _transform(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null, data?: any) => void) {
    if (chunk) this.bytes += Buffer.byteLength(chunk);
    callback(null, chunk);
  }
}

let cachedClient: S3Client | null = null;
let cachedConfig: R2Config | null = null;

function readEnv(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function readR2Endpoint(): string | null {
	// Canonical: R2_ENDPOINT. Back-compat: R2_S3_ENDPOINT (older Render templates).
	return readEnv("R2_ENDPOINT") ?? readEnv("R2_S3_ENDPOINT");
}

export function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig;

  const endpoint = readR2Endpoint();
  const bucket = readEnv("R2_BUCKET");
  const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");
  const region = readEnv("R2_REGION") ?? "auto";
  const ttlRaw = readEnv("R2_SIGNED_URL_TTL_SECONDS");
  const signedUrlTtlSeconds = ttlRaw ? Math.max(1, Number(ttlRaw)) : 3600;
  const publicBaseUrl = readEnv("R2_PUBLIC_BASE_URL") ?? undefined;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 configuration env vars. Required: R2_ENDPOINT (or R2_S3_ENDPOINT), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
    );
  }
  if (!Number.isFinite(signedUrlTtlSeconds)) {
    throw new Error("Invalid R2_SIGNED_URL_TTL_SECONDS (must be a number)");
  }

  cachedConfig = {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    signedUrlTtlSeconds,
    publicBaseUrl,
  };
  return cachedConfig;
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const cfg = getR2Config();
  cachedClient = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cachedClient;
}

export async function uploadToR2(args: {
  key: string;
  body: Readable | Buffer;
  contentType?: string | null;
}): Promise<{ bucket: string; key: string; etag: string | null; size_bytes: number }> {
  const cfg = getR2Config();
  const client = getR2Client();

  let body: Buffer | Readable;
  let sizeBytes = 0;
  let contentLength: number | undefined;

  if (Buffer.isBuffer(args.body)) {
    body = args.body;
    sizeBytes = args.body.length;
    contentLength = sizeBytes;
  } else {
    const counter = new CountingStream();
    args.body.pipe(counter);
    body = counter as unknown as Readable;
    // For streaming uploads we can't reliably know length up-front; use counted bytes as the returned size.
    // Note: some S3-compatible providers are strict about chunked uploads; callers can prefer Buffer uploads.
    contentLength = undefined;
    sizeBytes = 0;
  }

  const putInput = stripUndefined({
    Bucket: cfg.bucket,
    Key: args.key,
    Body: body,
    ContentType: args.contentType ?? undefined,
    ContentLength: contentLength,
  });

  const result = await client.send(new PutObjectCommand(putInput));

  const etag = typeof (result as any)?.ETag === "string" ? (result as any).ETag : null;

  // If we streamed, the transform has the counted bytes. If we buffered, it's the buffer length.
  if (!Buffer.isBuffer(args.body)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bytes = (body as any)?.bytes;
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0) sizeBytes = bytes;
  }

  // Optional hard verification (helpful when debugging R2 permissions / bucket policies).
  if (process.env.R2_VERIFY_UPLOAD === "1") {
    try {
      await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: args.key }));
    } catch {
      // Best-effort; do not fail the upload response based on HEAD.
    }
  }

  return { bucket: cfg.bucket, key: args.key, etag, size_bytes: sizeBytes };
}

export async function getSignedDownloadUrl(args: { key: string; ttlSeconds?: number }): Promise<string> {
  const cfg = getR2Config();
  const client = getR2Client();
  const expiresIn = args.ttlSeconds ?? cfg.signedUrlTtlSeconds;
  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: args.key,
    }),
    { expiresIn }
  );
}

export function getPublicUrlForKey(key: string): string | null {
  const cfg = getR2Config();
  if (!cfg.publicBaseUrl) return null;
  return `${cfg.publicBaseUrl.replace(/\/$/, "")}/${encodeURI(key)}`;
}

export async function deleteFromR2(args: { key: string }): Promise<void> {
  const cfg = getR2Config();
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: args.key,
    })
  );
}

export async function objectExistsInR2(args: { key: string }): Promise<{
  exists: boolean;
  bucket?: string;
  key: string;
  error?: { name: string; message: string; statusCode?: number | null };
}> {
  const cfg = getR2Config();
  const client = getR2Client();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: cfg.bucket,
        Key: args.key,
      })
    );
    return { exists: true, bucket: cfg.bucket, key: args.key };
  } catch (err) {
    const e = err as any;
    const name = typeof e?.name === "string" ? e.name : "HeadObjectError";
    const message = typeof e?.message === "string" ? e.message : String(err);
    const statusCode = typeof e?.$metadata?.httpStatusCode === "number" ? e.$metadata.httpStatusCode : null;

    return {
      exists: false,
      bucket: cfg.bucket,
      key: args.key,
      error: { name, message, statusCode },
    };
  }
}

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Transform } from "node:stream";

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

export function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig;

  const endpoint = readEnv("R2_ENDPOINT");
  const bucket = readEnv("R2_BUCKET");
  const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");
  const region = readEnv("R2_REGION") ?? "auto";
  const ttlRaw = readEnv("R2_SIGNED_URL_TTL_SECONDS");
  const signedUrlTtlSeconds = ttlRaw ? Math.max(1, Number(ttlRaw)) : 3600;
  const publicBaseUrl = readEnv("R2_PUBLIC_BASE_URL") ?? undefined;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 configuration env vars. Required: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
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
  body: NodeJS.ReadableStream;
  contentType?: string | null;
}): Promise<{ bucket: string; key: string; etag: string | null; size_bytes: number }> {
  const cfg = getR2Config();
  const client = getR2Client();

  const counter = new CountingStream();
  // Pipe the request stream through a counting transform into the SDK.
  args.body.pipe(counter);

  const result = await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: args.key,
      Body: counter,
      ContentType: args.contentType ?? undefined,
    })
  );

  const etag = typeof (result as any)?.ETag === "string" ? (result as any).ETag : null;

  return {
    bucket: cfg.bucket,
    key: args.key,
    etag,
    size_bytes: counter.bytes,
  };
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

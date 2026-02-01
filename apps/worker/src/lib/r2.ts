import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

type R2Config = {
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	defaultBucket?: string;
	signedUrlTtlSeconds: number;
	publicBaseUrl?: string;
};

let cachedClient: S3Client | null = null;
let cachedConfig: R2Config | null = null;

function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const v = env[name];
	return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
	if (cachedConfig) return cachedConfig;

	const endpoint = readEnv("R2_ENDPOINT", env);
	const accessKeyId = readEnv("R2_ACCESS_KEY_ID", env);
	const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY", env);
	const region = readEnv("R2_REGION", env) ?? "auto";
	const defaultBucket = readEnv("R2_BUCKET", env) ?? undefined;
	const ttlRaw = readEnv("R2_SIGNED_URL_TTL_SECONDS", env);
	const signedUrlTtlSeconds = ttlRaw ? Math.max(1, Number(ttlRaw)) : 3600;
	const publicBaseUrl = readEnv("R2_PUBLIC_BASE_URL", env) ?? undefined;

	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"Missing R2 configuration env vars. Required: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
		);
	}
	if (!Number.isFinite(signedUrlTtlSeconds)) {
		throw new Error("Invalid R2_SIGNED_URL_TTL_SECONDS (must be a number)");
	}

	cachedConfig = { endpoint, region, accessKeyId, secretAccessKey, defaultBucket, signedUrlTtlSeconds, publicBaseUrl };
	return cachedConfig;
}

export function getR2Client(env: NodeJS.ProcessEnv = process.env): S3Client {
	if (cachedClient) return cachedClient;
	const cfg = getR2Config(env);
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

async function streamToBuffer(body: unknown): Promise<Buffer> {
	if (!body) return Buffer.alloc(0);
	if (Buffer.isBuffer(body)) return body;
	// In Node's aws-sdk v3, Body is usually a Readable.
	const readable = body as any as Readable;
	if (typeof readable?.[Symbol.asyncIterator] !== "function") {
		return Buffer.alloc(0);
	}
	const chunks: Buffer[] = [];
	for await (const chunk of readable) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

export async function downloadFromR2(args: {
	bucket?: string | null;
	key: string;
	env?: NodeJS.ProcessEnv;
}): Promise<Buffer> {
	const env = args.env ?? process.env;
	const cfg = getR2Config(env);
	const client = getR2Client(env);
	const bucket = (args.bucket ?? cfg.defaultBucket ?? "").trim();
	if (!bucket) throw new Error("Missing R2 bucket (provide documents.storage_bucket or env R2_BUCKET)");

	const res = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: args.key,
		})
	);

	const bytes = await streamToBuffer((res as any)?.Body);
	return bytes;
}

export async function uploadToR2(args: {
	bucket?: string | null;
	key: string;
	body: Buffer;
	contentType?: string | null;
	env?: NodeJS.ProcessEnv;
}): Promise<{ bucket: string; key: string; size_bytes: number }> {
	const env = args.env ?? process.env;
	const cfg = getR2Config(env);
	const client = getR2Client(env);
	const bucket = (args.bucket ?? cfg.defaultBucket ?? "").trim();
	if (!bucket) throw new Error("Missing R2 bucket (provide env R2_BUCKET)");

	const body = args.body;
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: args.key,
			Body: body,
			ContentType: args.contentType ?? undefined,
			ContentLength: body.length,
		})
	);

	return { bucket, key: args.key, size_bytes: body.length };
}

export async function getR2ObjectUrl(args: {
	bucket?: string | null;
	key: string;
	ttlSeconds?: number;
	env?: NodeJS.ProcessEnv;
}): Promise<string> {
	const env = args.env ?? process.env;
	const cfg = getR2Config(env);
	const client = getR2Client(env);
	const bucket = (args.bucket ?? cfg.defaultBucket ?? "").trim();
	if (!bucket) throw new Error("Missing R2 bucket (provide env R2_BUCKET)");

	// Prefer direct URL when configured (public bucket / CDN).
	if (cfg.publicBaseUrl) {
		const base = cfg.publicBaseUrl.replace(/\/$/, "");
		// Do not URI-encode slashes, only the segments.
		const safeKey = args.key
			.split("/")
			.map((s) => encodeURIComponent(s))
			.join("/");
		return `${base}/${safeKey}`;
	}

	const ttlSeconds = typeof args.ttlSeconds === "number" && Number.isFinite(args.ttlSeconds)
		? Math.max(1, Math.floor(args.ttlSeconds))
		: cfg.signedUrlTtlSeconds;
	return await getSignedUrl(client as any, new GetObjectCommand({ Bucket: bucket, Key: args.key }) as any, {
		expiresIn: ttlSeconds,
	});
}

export async function r2ObjectExists(args: {
	bucket?: string | null;
	key: string;
	env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
	const env = args.env ?? process.env;
	const cfg = getR2Config(env);
	const client = getR2Client(env);
	const bucket = (args.bucket ?? cfg.defaultBucket ?? "").trim();
	if (!bucket) throw new Error("Missing R2 bucket (provide env R2_BUCKET)");
	try {
		await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: args.key,
			})
		);
		return true;
	} catch {
		return false;
	}
}

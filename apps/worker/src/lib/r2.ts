import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";

type R2Config = {
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	defaultBucket?: string;
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

	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"Missing R2 configuration env vars. Required: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
		);
	}

	cachedConfig = { endpoint, region, accessKeyId, secretAccessKey, defaultBucket };
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

import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

export function getUploadsRootDir(): string {
  // Resolve to an absolute path to satisfy fastify-static requirements. Env var can be relative or absolute.
  const envDir = process.env.UPLOAD_DIR?.trim();
  const baseDir = envDir && envDir.length > 0 ? envDir : path.join(process.cwd(), "uploads");
  return path.resolve(baseDir);
}

export async function registerUploadsStatic(app: FastifyInstance): Promise<void> {
  const rootDir = getUploadsRootDir();

  if (!fs.existsSync(rootDir)) {
    app.log.warn({ uploadsRootDir: rootDir }, "UPLOAD_DIR does not exist; /uploads/* will return 404 until populated");
  } else if (process.env.NODE_ENV !== "production") {
    app.log.info({ uploadsRootDir: rootDir }, "uploads static root resolved");
  }

  await app.register(fastifyStatic, {
    root: rootDir,
    prefix: "/uploads/",
    decorateReply: false,
  });
}

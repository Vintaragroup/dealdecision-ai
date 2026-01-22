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
    try {
      fs.mkdirSync(rootDir, { recursive: true });
      app.log.info({ uploadsRootDir: rootDir }, "Created UPLOAD_DIR on startup");
    } catch (err) {
      // Do not crash startup if we cannot create the directory (e.g. read-only filesystem).
      app.log.warn({ uploadsRootDir: rootDir, err }, "Failed to create UPLOAD_DIR; uploads will be disabled");
    }
  }

  if (!fs.existsSync(rootDir)) {
    // Avoid fastify-static throwing on a missing root directory.
    app.log.warn({ uploadsRootDir: rootDir }, "UPLOAD_DIR does not exist; skipping /uploads static route");
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    app.log.info({ uploadsRootDir: rootDir }, "uploads static root resolved");
  }

  await app.register(fastifyStatic, {
    root: rootDir,
    prefix: "/uploads/",
    decorateReply: false,
  });
}

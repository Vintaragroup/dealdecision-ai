import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

export function getUploadsRootDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export async function registerUploadsStatic(app: FastifyInstance): Promise<void> {
  const rootDir = getUploadsRootDir();

  if (!fs.existsSync(rootDir)) {
    app.log.warn({ uploadsRootDir: rootDir }, "UPLOAD_DIR does not exist; /uploads/* will return 404 until populated");
  }

  await app.register(fastifyStatic, {
    root: rootDir,
    prefix: "/uploads/",
    decorateReply: false,
  });
}

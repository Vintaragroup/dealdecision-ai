import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import { registerUploadsStatic } from "../src/plugins/uploads-static";

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAKq8n0kAAAAASUVORK5CYII=";

test("GET /uploads/* serves files from UPLOAD_DIR", async () => {
  const previousUploadDir = process.env.UPLOAD_DIR;

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ddai-uploads-"));
  process.env.UPLOAD_DIR = tempRoot;

  const relativeUrlPath = "/uploads/rendered_pages/113ec3d4-70c0-4e59-80cb-6c478b355930/page_004.png";
  const diskPath = path.join(
    tempRoot,
    "rendered_pages",
    "113ec3d4-70c0-4e59-80cb-6c478b355930",
    "page_004.png",
  );

  const app = Fastify({ logger: false });

  try {
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));

    await registerUploadsStatic(app);

    const res = await app.inject({ method: "GET", url: relativeUrlPath });
    assert.equal(res.statusCode, 200);

    const contentType = String(res.headers["content-type"] ?? "");
    assert.ok(contentType.startsWith("image/png"), `unexpected content-type: ${contentType}`);

    assert.ok(res.body.length > 0);
  } finally {
    await app.close();
    await fs.rm(tempRoot, { recursive: true, force: true });

    if (typeof previousUploadDir === "string") process.env.UPLOAD_DIR = previousUploadDir;
    else delete process.env.UPLOAD_DIR;
  }
});

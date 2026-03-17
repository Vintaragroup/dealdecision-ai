import path from "path";
import fs from "fs/promises";
import os from "os";

let didWarnUploadDirFallback = false;

export async function resolveWritableUploadDir(
	env: NodeJS.ProcessEnv,
	logger: Pick<Console, "log" | "warn"> = console
): Promise<string> {
	const configured = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");
	const fallback = path.resolve(os.tmpdir(), "dealdecisionai", "uploads");

	const tryDir = async (dir: string): Promise<boolean> => {
		try {
			await fs.mkdir(dir, { recursive: true });
			const probe = path.join(dir, `.write_test_${process.pid}_${Date.now()}`);
			await fs.writeFile(probe, "ok");
			await fs.unlink(probe);
			return true;
		} catch {
			return false;
		}
	};

	if (await tryDir(configured)) return configured;
	if (await tryDir(fallback)) {
		if (!didWarnUploadDirFallback) {
			didWarnUploadDirFallback = true;
			logger.warn(
				JSON.stringify({
					event: "WORKER_UPLOAD_DIR_FALLBACK",
					configured_upload_dir: env.UPLOAD_DIR ?? null,
					using_upload_dir: fallback,
				})
			);
		}
		return fallback;
	}

	// Last resort: use configured even if not writable; downstream will handle failures.
	return configured;
}

import type { Job } from "bullmq";
import { updateJob } from "./worker-utils";
import { emitJobProgress } from "./job-progress";

export type HeartbeatHandle = { stop: () => void };

export function startHeartbeat(
	job: Job,
	options: {
		// Allow arbitrary stages so long-running jobs (e.g. analyze_deal) can emit
		// generic heartbeat updates without expanding the shared contract.
		stage: string;
		dealId?: string;
		documentId?: string;
		startPercent?: number;
		maxPercent?: number;
		intervalMs?: number;
		message: string;
	}
): HeartbeatHandle {
	const intervalMs = options.intervalMs ?? 20000;
	const maxPercent = options.maxPercent ?? 45;
	let percent = options.startPercent ?? 20;
	let stopped = false;

	const tick = async () => {
		if (stopped) return;
		percent = Math.min(maxPercent, percent + 2);
		const msg = options.message;
		try {
			await updateJob(job, "running", msg, percent);
			await emitJobProgress(job, {
				job_id: job.id ? String(job.id) : "",
				deal_id: options.dealId,
				document_id: options.documentId,
				stage: options.stage as any,
				percent,
				message: msg,
				meta: { heartbeat: true },
			} as any);
		} catch (err) {
			console.warn(
				`[heartbeat] progress emit failed job=${job.id ?? job.name}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, intervalMs);

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
}


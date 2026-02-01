import type { JobStatus, JobType } from "@dealdecision/contracts";

export type RefreshStep = "reextract" | "verify" | "evidence" | "analyze";
export type RefreshStepStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "skipped";

export type DealRefreshState = {
	deal_id: string;
	document_ids: string[];
	steps: Record<RefreshStep, {
		step: RefreshStep;
		status: RefreshStepStatus;
		job_id?: string;
		started_at?: string;
		finished_at?: string;
		error?: string;
	}>;
	ok?: boolean;
	error?: string;
	updated_at?: string;
};

export type RefreshRunnerEvent =
	| {
			type: "step_enqueued";
			deal_id: string;
			step: RefreshStep;
			job_id: string;
		}
	| {
			type: "job_polled";
			deal_id: string;
			step: RefreshStep;
			job_id: string;
			job: {
				status: JobStatus;
				progress_pct?: number;
				message?: string;
			};
		}
	| {
			type: "step_finished";
			deal_id: string;
			step: RefreshStep;
			job_id: string;
			ok: boolean;
			error?: string;
		}
	| {
			type: "deal_finished";
			deal_id: string;
			ok: boolean;
			error?: string;
		};

export function initDealRefreshState(dealId: string, documentIds: string[]): DealRefreshState {
	return {
		deal_id: dealId,
		document_ids: [...documentIds].map(String).sort((a, b) => a.localeCompare(b)),
		steps: {
			reextract: { step: "reextract", status: "pending" },
			verify: { step: "verify", status: "pending" },
			evidence: { step: "evidence", status: "pending" },
			analyze: { step: "analyze", status: "pending" },
		},
		ok: undefined,
		error: undefined,
		updated_at: new Date().toISOString(),
	};
}

type EnqueueJobInput = {
	deal_id: string;
	type: JobType;
	payload?: Record<string, unknown>;
};

type EnqueueJobResult = {
	job_id: string;
	status: JobStatus;
};

type GetJobResult = {
	job_id: string;
	status: JobStatus;
	progress_pct?: number;
	message?: string;
};

export type RunDealRefreshOptions = {
	dryRun: boolean;
	wait: boolean;
	pollIntervalMs: number;
	timeoutMs: number;
};

export type RunDealRefreshDeps = {
	enqueueJob: (input: EnqueueJobInput) => Promise<EnqueueJobResult>;
	getJob: (jobId: string) => Promise<GetJobResult>;
	sleep: (ms: number) => Promise<void>;
	nowIso: () => string;
	onEvent?: (event: RefreshRunnerEvent) => void;
};

export async function runDealRefresh(params: {
	state: DealRefreshState;
	options: RunDealRefreshOptions;
	deps: RunDealRefreshDeps;
}): Promise<DealRefreshState> {
	const { options, deps } = params;
	const dealId = String(params.state.deal_id);

	const defaultSteps: DealRefreshState["steps"] = {
		reextract: { step: "reextract", status: "pending" },
		verify: { step: "verify", status: "pending" },
		evidence: { step: "evidence", status: "pending" },
		analyze: { step: "analyze", status: "pending" },
	};

	const state: DealRefreshState = {
		...params.state,
		deal_id: dealId,
		document_ids: [...(params.state.document_ids ?? [])].map(String).sort((a, b) => a.localeCompare(b)),
		steps: {
			...defaultSteps,
			...(params.state.steps ?? ({} as Partial<DealRefreshState["steps"]>)),
		} as DealRefreshState["steps"],
		updated_at: deps.nowIso(),
	};

	const stepsInOrder: RefreshStep[] = ["reextract", "verify", "evidence", "analyze"];

	const isTerminal = (st: RefreshStepStatus | undefined) => st === "succeeded" || st === "failed" || st === "skipped";

	const jobTypeForStep = (step: RefreshStep): JobType => {
		switch (step) {
			case "reextract":
				return "reextract_documents";
			case "verify":
				return "verify_documents";
			case "evidence":
				return "fetch_evidence";
			case "analyze":
				return "analyze_deal";
		}
	};

	const isOkStatus = (status: JobStatus): boolean => status === "succeeded";
	const isBadStatus = (status: JobStatus): boolean => status === "failed";
	const isDoneStatus = (status: JobStatus): boolean => isOkStatus(status) || isBadStatus(status);

	try {
		for (const step of stepsInOrder) {
			const current = state.steps[step];
			if (current && isTerminal(current.status)) {
				continue;
			}

			if (options.dryRun) {
				state.steps[step] = {
					step,
					status: "skipped",
					started_at: deps.nowIso(),
					finished_at: deps.nowIso(),
				};
				state.updated_at = deps.nowIso();
				continue;
			}

			const enqueueRes = await deps.enqueueJob({
				deal_id: dealId,
				type: jobTypeForStep(step),
				payload: { document_ids: state.document_ids },
			});
			const jobId = String(enqueueRes.job_id);

			state.steps[step] = {
				step,
				status: options.wait ? "running" : "queued",
				job_id: jobId,
				started_at: deps.nowIso(),
			};
			state.updated_at = deps.nowIso();
			deps.onEvent?.({ type: "step_enqueued", deal_id: dealId, step, job_id: jobId });

			if (!options.wait) {
				continue;
			}

			const deadlineMs = Date.now() + Math.max(1_000, options.timeoutMs);
			while (true) {
				const job = await deps.getJob(jobId);
				deps.onEvent?.({
					type: "job_polled",
					deal_id: dealId,
					step,
					job_id: jobId,
					job: {
						status: job.status,
						progress_pct: job.progress_pct,
						message: job.message,
					},
				});

				if (isDoneStatus(job.status)) {
					const ok = isOkStatus(job.status);
					state.steps[step] = {
						...state.steps[step],
						status: ok ? "succeeded" : "failed",
						finished_at: deps.nowIso(),
						error: ok ? undefined : job.message ?? "Job failed",
					};
					state.updated_at = deps.nowIso();
					deps.onEvent?.({
						type: "step_finished",
						deal_id: dealId,
						step,
						job_id: jobId,
						ok,
						error: ok ? undefined : state.steps[step].error,
					});

					if (!ok) {
						state.ok = false;
						state.error = state.steps[step].error ?? `Step failed: ${step}`;
						state.updated_at = deps.nowIso();
						deps.onEvent?.({ type: "deal_finished", deal_id: dealId, ok: false, error: state.error });
						return state;
					}
					break;
				}

				if (Date.now() >= deadlineMs) {
					state.steps[step] = {
						...state.steps[step],
						status: "failed",
						finished_at: deps.nowIso(),
						error: `Timeout waiting for job ${jobId}`,
					};
					state.ok = false;
					state.error = state.steps[step].error;
					state.updated_at = deps.nowIso();
					deps.onEvent?.({
						type: "step_finished",
						deal_id: dealId,
						step,
						job_id: jobId,
						ok: false,
						error: state.error,
					});
					deps.onEvent?.({ type: "deal_finished", deal_id: dealId, ok: false, error: state.error });
					return state;
				}

				await deps.sleep(Math.max(250, options.pollIntervalMs));
			}
		}

		state.ok = true;
		state.error = undefined;
		state.updated_at = deps.nowIso();
		deps.onEvent?.({ type: "deal_finished", deal_id: dealId, ok: true });
		return state;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		state.ok = false;
		state.error = message;
		state.updated_at = deps.nowIso();
		deps.onEvent?.({ type: "deal_finished", deal_id: dealId, ok: false, error: message });
		return state;
	}
}

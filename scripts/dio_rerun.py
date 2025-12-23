#!/usr/bin/env python3

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class ApiConfig:
    base_url: str
    poll_interval_s: float
    poll_timeout_s: float
    verbose: bool


class ApiError(RuntimeError):
    pass


def _join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def http_json(method: str, url: str, body: Optional[Dict[str, Any]] = None) -> Any:
    data = None
    headers = {"accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = e.read().decode("utf-8")
        except Exception:
            payload = ""
        raise ApiError(f"HTTP {e.code} {method} {url}: {payload}") from e
    except urllib.error.URLError as e:
        raise ApiError(f"Network error {method} {url}: {e}") from e


def wait_for_job(cfg: ApiConfig, job_id: str) -> Dict[str, Any]:
    deadline = time.time() + cfg.poll_timeout_s
    last_line = None

    while True:
        job = http_json("GET", _join(cfg.base_url, f"/api/v1/jobs/{job_id}"))
        status = job.get("status")
        pct = job.get("progress_pct")
        msg = job.get("message")
        line = f"job={job_id} status={status} pct={pct} msg={msg}"

        if cfg.verbose and line != last_line:
            print(line)
            last_line = line

        if status in ("succeeded", "failed"):
            return job

        if time.time() > deadline:
            raise ApiError(f"Timed out waiting for job {job_id} after {cfg.poll_timeout_s}s")

        time.sleep(cfg.poll_interval_s)


def enqueue_analyze(cfg: ApiConfig, deal_id: str) -> str:
    resp = http_json(
        "POST",
        _join(cfg.base_url, f"/api/v1/deals/{deal_id}/analyze"),
        body={},
    )
    job_id = resp.get("job_id")
    if not job_id:
        raise ApiError(f"Expected job_id from analyze endpoint; got: {resp}")
    return job_id


def get_latest_dio_summary_for_deal(cfg: ApiConfig, deal_id: str) -> Optional[Dict[str, Any]]:
    # Dashboard endpoint returns latest DIO per deal including overall_score and dio_id.
    rows = http_json("GET", _join(cfg.base_url, "/api/dashboard/dios"))
    if not isinstance(rows, list):
        raise ApiError(f"Expected list from /api/dashboard/dios; got: {type(rows).__name__}")

    for row in rows:
        if isinstance(row, dict) and row.get("deal_id") == deal_id:
            return row
    return None


def get_dio_row(cfg: ApiConfig, dio_id: str) -> Dict[str, Any]:
    row = http_json("GET", _join(cfg.base_url, f"/api/dashboard/dios/{dio_id}"))
    if not isinstance(row, dict):
        raise ApiError(f"Expected object from /api/dashboard/dios/{dio_id}; got: {type(row).__name__}")
    return row


def parse_ids(ids: str) -> List[str]:
    parts = [p.strip() for p in ids.split(",")]
    return [p for p in parts if p]


def iter_all_deal_ids(cfg: ApiConfig) -> List[str]:
    deals = http_json("GET", _join(cfg.base_url, "/api/v1/deals"))
    if not isinstance(deals, list):
        raise ApiError(f"Expected list from /api/v1/deals; got: {type(deals).__name__}")
    ids: List[str] = []
    for d in deals:
        if isinstance(d, dict) and d.get("id"):
            ids.append(str(d["id"]))
    return ids


def rerun_one(cfg: ApiConfig, deal_id: str) -> Tuple[str, Optional[float]]:
    job_id = enqueue_analyze(cfg, deal_id)
    job = wait_for_job(cfg, job_id)
    if job.get("status") != "succeeded":
        raise ApiError(f"Job failed: {job}")

    summary = get_latest_dio_summary_for_deal(cfg, deal_id)
    if not summary:
        return job_id, None

    dio_id = summary.get("dio_id")
    overall = summary.get("overall_score")
    try:
        overall_num = float(overall) if overall is not None else None
    except Exception:
        overall_num = None

    if cfg.verbose and dio_id:
        row = get_dio_row(cfg, str(dio_id))
        dio_data = row.get("dio_data") or {}
        score_expl = (dio_data.get("score_explanation") or {}) if isinstance(dio_data, dict) else {}
        totals = score_expl.get("totals") or {}
        agg = score_expl.get("aggregation") or {}
        included = agg.get("included_components") or []
        excluded = agg.get("excluded_components") or []
        print(
            f"dio_id={dio_id} overall_score_col={row.get('overall_score')} totals.overall_score={totals.get('overall_score')} included={len(included)} excluded={len(excluded)}"
        )

    return job_id, overall_num


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description="Re-run DealDecision DIO analysis via API")
    p.add_argument("--base-url", default="http://localhost:9000", help="API base URL (default: http://localhost:9000)")
    p.add_argument("--poll-interval", type=float, default=2.0, help="Job poll interval seconds (default: 2)")
    p.add_argument("--poll-timeout", type=float, default=180.0, help="Job poll timeout seconds (default: 180)")
    p.add_argument("--verbose", action="store_true", help="Print job progress and extra DIO details")

    sub = p.add_subparsers(dest="cmd", required=True)

    s1 = sub.add_parser("single", help="Run a single deal by ID")
    s1.add_argument("deal_id")

    s2 = sub.add_parser("batch", help="Run a batch of deals by comma-separated IDs")
    s2.add_argument("--ids", required=True, help="Comma-separated deal IDs")

    s3 = sub.add_parser("all", help="Run all deals currently in the system")

    args = p.parse_args(argv)

    cfg = ApiConfig(
        base_url=args.base_url,
        poll_interval_s=args.poll_interval,
        poll_timeout_s=args.poll_timeout,
        verbose=bool(args.verbose),
    )

    if args.cmd == "single":
        job_id, overall = rerun_one(cfg, args.deal_id)
        print(json.dumps({"deal_id": args.deal_id, "job_id": job_id, "overall_score": overall}))
        return 0

    if args.cmd == "batch":
        deal_ids = parse_ids(args.ids)
        out = []
        for deal_id in deal_ids:
            try:
                job_id, overall = rerun_one(cfg, deal_id)
                out.append({"deal_id": deal_id, "job_id": job_id, "overall_score": overall, "ok": True})
            except Exception as e:
                out.append({"deal_id": deal_id, "job_id": None, "overall_score": None, "ok": False, "error": str(e)})
        print(json.dumps(out, indent=2))
        return 0

    if args.cmd == "all":
        deal_ids = iter_all_deal_ids(cfg)
        out = []
        for idx, deal_id in enumerate(deal_ids, start=1):
            if cfg.verbose:
                print(f"[{idx}/{len(deal_ids)}] deal={deal_id}")
            try:
                job_id, overall = rerun_one(cfg, deal_id)
                out.append({"deal_id": deal_id, "job_id": job_id, "overall_score": overall, "ok": True})
            except Exception as e:
                out.append({"deal_id": deal_id, "job_id": None, "overall_score": None, "ok": False, "error": str(e)})
        print(json.dumps(out, indent=2))
        return 0

    raise AssertionError("unreachable")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

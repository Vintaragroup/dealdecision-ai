#!/usr/bin/env python3

"""Cross-deal verification for runway semantics.

Selects 5–10 recent deals spanning:
- burn_rate < 0
- burn_rate = 0
- burn_rate > 0 and cash_balance present
- burn_rate > 0 and cash_balance missing

For each selected deal:
- Enqueue analyze job via API
- Wait for completion
- Fetch latest DIO via dashboard endpoint
- Print a compact table:
  deal_id | dio_id | burn_rate | cash_balance | runway_months | runway_risk_count | disclosure_codes | score_explanation_has_0_months_text

Defaults assume local dev API at http://localhost:9000.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class ApiConfig:
    base_url: str
    poll_interval_s: float
    poll_timeout_s: float
    progress_interval_s: float
    warn_queued_after_s: float
    max_deals_scan: int
    per_bucket: int
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


def wait_for_job(cfg: ApiConfig, job_id: str, *, label: str = "") -> Dict[str, Any]:
    deadline = time.time() + cfg.poll_timeout_s
    start = time.time()
    last_print = 0.0
    last_status: Optional[str] = None
    warned_queued = False

    while True:
        job = http_json("GET", _join(cfg.base_url, f"/api/v1/jobs/{job_id}"))
        status = job.get("status")
        pct = job.get("progress_pct")
        msg = job.get("message")
        elapsed = time.time() - start

        prefix = f"[{label}] " if label else ""
        # Always show progress periodically so it doesn't look stuck.
        should_print = (time.time() - last_print) >= cfg.progress_interval_s
        status_changed = status != last_status

        if cfg.verbose or should_print or status_changed:
            pct_part = f" pct={pct}" if pct is not None else ""
            msg_part = f" msg={msg}" if msg else ""
            print(f"{prefix}job={job_id} t={elapsed:.0f}s status={status}{pct_part}{msg_part}")
            last_print = time.time()
            last_status = status

        if not warned_queued and status == "queued" and elapsed >= cfg.warn_queued_after_s:
            print(
                f"{prefix}still queued after {elapsed:.0f}s (worker may be offline or backlogged). "
                f"If this persists, try: docker compose restart worker"
            )
            warned_queued = True

        if status in ("succeeded", "failed"):
            return job

        if time.time() > deadline:
            raise ApiError(f"Timed out waiting for job {job_id} after {cfg.poll_timeout_s}s")

        time.sleep(cfg.poll_interval_s)


def enqueue_analyze(cfg: ApiConfig, deal_id: str) -> str:
    resp = http_json("POST", _join(cfg.base_url, f"/api/v1/deals/{deal_id}/analyze"), body={})
    job_id = resp.get("job_id")
    if not job_id:
        raise ApiError(f"Expected job_id from analyze endpoint; got: {resp}")
    return str(job_id)


def get_deals(cfg: ApiConfig) -> List[Dict[str, Any]]:
    # Dashboard endpoint provides latest DIO per deal (bounded list).
    rows = http_json("GET", _join(cfg.base_url, "/api/dashboard/dios"))
    if not isinstance(rows, list):
        raise ApiError(f"Expected list from /api/dashboard/dios; got: {type(rows).__name__}")
    return [r for r in rows if isinstance(r, dict) and isinstance(r.get("deal_id"), str) and isinstance(r.get("dio_id"), str)]


def get_latest_dio_id_for_deal(cfg: ApiConfig, deal_id: str) -> Optional[str]:
    rows = http_json("GET", _join(cfg.base_url, "/api/dashboard/dios"))
    if not isinstance(rows, list):
        return None
    for r in rows:
        if isinstance(r, dict) and r.get("deal_id") == deal_id and isinstance(r.get("dio_id"), str):
            return str(r.get("dio_id"))
    return None


def get_dio_row(cfg: ApiConfig, dio_id: str) -> Dict[str, Any]:
    row = http_json("GET", _join(cfg.base_url, f"/api/dashboard/dios/{dio_id}"))
    if not isinstance(row, dict):
        raise ApiError(f"Expected object from /api/dashboard/dios/{dio_id}; got: {type(row).__name__}")
    return row


def parse_financial_fields(dio_row: Dict[str, Any]) -> Tuple[Optional[float], Optional[float], Optional[float], int, List[str], bool]:
    dio_data = dio_row.get("dio_data") if isinstance(dio_row, dict) else None
    if not isinstance(dio_data, dict):
        return None, None, None, 0, [], False

    fh = ((dio_data.get("analyzer_results") or {}).get("financial_health") or {}) if isinstance(dio_data.get("analyzer_results"), dict) else {}
    metrics = fh.get("metrics") if isinstance(fh, dict) else None

    def num(v: Any) -> Optional[float]:
        return float(v) if isinstance(v, (int, float)) else None

    burn_rate = num(metrics.get("burn_rate") if isinstance(metrics, dict) else None)
    cash_balance = num(metrics.get("cash_balance") if isinstance(metrics, dict) else None)
    runway_months = num(fh.get("runway_months") if isinstance(fh, dict) else None)

    risks = fh.get("risks") if isinstance(fh, dict) else []
    runway_risk_count = 0
    if isinstance(risks, list):
        for r in risks:
            if not isinstance(r, dict):
                continue
            code = r.get("code")
            desc = r.get("description")
            cat = r.get("category")
            blob = " ".join([str(code or ""), str(desc or ""), str(cat or "")]).lower()
            if "runway" in blob:
                runway_risk_count += 1

    disclosure_codes: List[str] = []
    disclosures_v1 = fh.get("disclosures_v1") if isinstance(fh, dict) else None
    if isinstance(disclosures_v1, list):
        for d in disclosures_v1:
            if isinstance(d, dict) and isinstance(d.get("code"), str):
                disclosure_codes.append(d["code"])

    # Fallback to legacy string disclosures (best-effort) – map to pseudo codes.
    legacy = fh.get("disclosures") if isinstance(fh, dict) else None
    if isinstance(legacy, list):
        for s in legacy:
            if isinstance(s, str):
                if "not applicable" in s.lower() and "runway" in s.lower():
                    disclosure_codes.append("runway_not_applicable_nonpositive_burn")
                if "runway may be implied" in s.lower():
                    disclosure_codes.append("missing_cash_runway_inputs")

    disclosure_codes = sorted(set([c for c in disclosure_codes if c]))

    score_expl = dio_data.get("score_explanation")
    score_expl_blob = json.dumps(score_expl) if score_expl is not None else ""
    has_0_months_text = "0 months" in score_expl_blob

    return burn_rate, cash_balance, runway_months, runway_risk_count, disclosure_codes, has_0_months_text


def categorize(burn_rate: Optional[float], cash_balance: Optional[float]) -> Optional[str]:
    if burn_rate is None:
        return None
    if burn_rate < 0:
        return "burn<0"
    if burn_rate == 0:
        return "burn=0"
    # burn > 0
    if cash_balance is None:
        return "burn>0_cash_missing"
    return "burn>0_cash_present"


def pick_deals(cfg: ApiConfig, deals: List[Dict[str, Any]]) -> List[str]:
    buckets: Dict[str, List[str]] = {
        "burn<0": [],
        "burn=0": [],
        "burn>0_cash_present": [],
        "burn>0_cash_missing": [],
    }

    def sort_key(d: Dict[str, Any]) -> str:
        return str(d.get("updated_at") or d.get("created_at") or "")

    deals_sorted = sorted(deals, key=sort_key, reverse=True)

    scanned = 0
    for d in deals_sorted:
        if scanned >= cfg.max_deals_scan:
            break
        scanned += 1

        deal_id = str(d.get("deal_id"))
        dio_id = str(d.get("dio_id"))

        try:
            dio_row = get_dio_row(cfg, dio_id)
            burn_rate, cash_balance, _, _, _, _ = parse_financial_fields(dio_row)
        except Exception:
            continue

        cat = categorize(burn_rate, cash_balance)
        if cat is None:
            continue

        if len(buckets[cat]) < cfg.per_bucket:
            buckets[cat].append(deal_id)

        if all(len(v) >= cfg.per_bucket for v in buckets.values()):
            break

    chosen: List[str] = []
    for k in ["burn<0", "burn=0", "burn>0_cash_present", "burn>0_cash_missing"]:
        chosen.extend(buckets[k])

    # Cap total to 10 for convenience
    return chosen[:10]


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description="Cross-deal runway semantics verification")
    p.add_argument("--base-url", default="http://localhost:9000", help="API base URL")
    p.add_argument("--poll-interval", type=float, default=2.0)
    p.add_argument("--poll-timeout", type=float, default=240.0)
    p.add_argument("--progress-interval", type=float, default=10.0, help="Print a heartbeat every N seconds (default: 10)")
    p.add_argument("--warn-queued-after", type=float, default=30.0, help="Warn if job stays queued past N seconds (default: 30)")
    p.add_argument("--max-deals-scan", type=int, default=200, help="Max deals to scan for candidates")
    p.add_argument("--per-bucket", type=int, default=2, help="Deals per category bucket")
    p.add_argument("--ids", default=None, help="Optional comma-separated deal IDs to verify (skips auto-pick)")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    cfg = ApiConfig(
        base_url=args.base_url,
        poll_interval_s=args.poll_interval,
        poll_timeout_s=args.poll_timeout,
        progress_interval_s=args.progress_interval,
        warn_queued_after_s=args.warn_queued_after,
        max_deals_scan=args.max_deals_scan,
        per_bucket=args.per_bucket,
        verbose=bool(args.verbose),
    )

    deals = get_deals(cfg)

    if args.ids:
        selected = [s.strip() for s in str(args.ids).split(",") if s.strip()]
    else:
        selected = pick_deals(cfg, deals)

    if not selected:
        raise ApiError("No candidate deals found with financial_health metrics")

    # Print header
    print(
        "deal_id | dio_id | burn_rate | cash_balance | runway_months | runway_risk_count | disclosure_codes | score_explanation_has_0_months_text"
    )

    for deal_id in selected:
        job_id = enqueue_analyze(cfg, deal_id)
        job = wait_for_job(cfg, job_id, label=deal_id)
        if job.get("status") != "succeeded":
            print(f"{deal_id} | (job failed) | - | - | - | - | - | -")
            continue

        dio_id = get_latest_dio_id_for_deal(cfg, deal_id)
        if not isinstance(dio_id, str) or not dio_id:
            print(f"{deal_id} | (missing dio) | - | - | - | - | - | -")
            continue

        dio_row = get_dio_row(cfg, dio_id)
        burn_rate, cash_balance, runway_months, runway_risk_count, disclosure_codes, has_0 = parse_financial_fields(dio_row)

        def fmt(v: Optional[float]) -> str:
            if v is None:
                return "null"
            if abs(v) >= 1000:
                return f"{v:.2f}"
            return f"{v:.4f}"

        codes = ",".join(disclosure_codes) if disclosure_codes else ""
        print(
            f"{deal_id} | {dio_id} | {fmt(burn_rate)} | {fmt(cash_balance)} | {fmt(runway_months)} | {runway_risk_count} | {codes} | {str(has_0).lower()}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

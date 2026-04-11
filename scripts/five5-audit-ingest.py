#!/usr/bin/env python3
"""
five5-audit-ingest.py
=====================
Full closed-loop ingestion script for the five5-audit reference deal set.

Deals ingested:
  1. Dropables   — startup pitch deck (PDF, 8.6MB)
  2. Nanochon    — pre-seed pitch deck (PDF, 4.9MB)
  3. NerdWallet  — S-1 IPO filing (PDF, 107MB)
  4. WeWork      — 10-K + EX-99.1 exhibits (3 PDFs, 11MB total)

Steps:
  1. Create deals via POST /api/v1/deals
  2. Upload documents via POST /api/v1/deals/:id/documents  (multipart)
  3. Trigger analysis via POST /api/v1/analysis/start
  4. Poll /api/v1/deals/:id/report for completion
  5. Write final report JSON to scripts/five5-audit-reports/

Usage:
  python3 scripts/five5-audit-ingest.py
"""

import json
import os
import time
import requests

API_BASE = "http://localhost:9001"
AUDIT_DIR = os.path.join(os.path.dirname(__file__), "five5-audit-reports")
os.makedirs(AUDIT_DIR, exist_ok=True)

BASE_PATH = "/Users/ryanmorrow/Documents/Projects2025/DealDecisionAI/docs/reference-deal-docs/PDF-pptx-deals/five5-audit"

DEALS = [
    {
        "name": "Dropables",
        "stage": "intake",
        "priority": "medium",
        "docs": [
            {
                "path": f"{BASE_PATH}/dropables/Dropables Pitch Deck - Revised.pdf",
                "type": "pitch_deck",
                "mime_type": "application/pdf",
            }
        ],
    },
    {
        "name": "Nanochon",
        "stage": "intake",
        "priority": "medium",
        "docs": [
            {
                "path": f"{BASE_PATH}/Nanochon/Nanochon pre-seed round 2021_UPDATED NONCONF.pdf",
                "type": "pitch_deck",
                "mime_type": "application/pdf",
            }
        ],
    },
    {
        "name": "NerdWallet",
        "stage": "intake",
        "priority": "medium",
        "docs": [
            {
                "path": f"{BASE_PATH}/nerdwallet/Nerd-Wallet.pdf",
                "type": "pitch_deck",
                "mime_type": "application/pdf",
            }
        ],
    },
    {
        "name": "WeWork",
        "stage": "intake",
        "priority": "medium",
        "docs": [
            {
                "path": f"{BASE_PATH}/wework/we-20221231.pdf",
                "type": "financial_model",
                "mime_type": "application/pdf",
            },
            {
                "path": f"{BASE_PATH}/wework/WEWORK-EX-99.1.pdf",
                "type": "pitch_deck",
                "mime_type": "application/pdf",
            },
            {
                "path": f"{BASE_PATH}/wework/WEWORK-highlights-EX-99.1.pdf",
                "type": "pitch_deck",
                "mime_type": "application/pdf",
            },
        ],
    },
]


def log(msg):
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{ts}] {msg}")


def create_deal(deal):
    """Create a deal record, return deal_id."""
    payload = {
        "name": deal["name"],
        "stage": deal["stage"],
        "priority": deal["priority"],
    }
    log(f"Creating deal: {deal['name']}")
    r = requests.post(f"{API_BASE}/api/v1/deals", json=payload, timeout=30)
    if r.status_code == 409:
        existing_id = r.json().get("existing_deal_id")
        log(f"  Deal already exists: {existing_id}")
        return existing_id
    r.raise_for_status()
    deal_id = r.json()["id"]
    log(f"  Created deal_id={deal_id}")
    return deal_id


def upload_document(deal_id, doc_cfg):
    """Upload a document file via multipart POST."""
    file_path = doc_cfg["path"]
    file_name = os.path.basename(file_path)
    size_mb = os.path.getsize(file_path) / 1024 / 1024
    log(f"  Uploading {file_name} ({size_mb:.1f} MB) ...")

    with open(file_path, "rb") as f:
        files = {"file": (file_name, f, doc_cfg["mime_type"])}
        data = {
            "type": doc_cfg["type"],
            "title": file_name,
        }
        r = requests.post(
            f"{API_BASE}/api/v1/deals/{deal_id}/documents",
            files=files,
            data=data,
            timeout=600,  # 10 min for large PDFs
        )
    if r.status_code == 409:
        log(f"  Document duplicate skipped: {file_name}")
        dupes = r.json().get("duplicates", [])
        return dupes[0].get("id") if dupes else None
    r.raise_for_status()
    resp = r.json()
    # Response: { document: { document_id: ... }, upload: {...}, job_id: ... }
    doc_id = resp.get("document", {}).get("document_id") or resp.get("document", {}).get("id") or resp.get("id")
    log(f"  Uploaded document_id={doc_id}")
    return doc_id


def trigger_analysis(deal_id):
    """Trigger full analysis pipeline."""
    log(f"  Triggering analysis for deal {deal_id}")
    r = requests.post(
        f"{API_BASE}/api/v1/deals/{deal_id}/analyze",
        json={"require_page_understanding": True, "force_refresh": False},
        timeout=60,
    )
    if r.status_code in (200, 202, 409):
        log(f"  Analysis triggered: {r.status_code}")
        return True
    log(f"  Analysis trigger returned {r.status_code}: {r.text[:200]}")
    return False


def poll_report(deal_id, timeout_secs=600, interval_secs=10):
    """Poll the report endpoint until report is ready or timeout."""
    log(f"  Polling report for deal {deal_id} (max {timeout_secs}s)...")
    deadline = time.time() + timeout_secs
    while time.time() < deadline:
        r = requests.get(
            f"{API_BASE}/api/v1/deals/{deal_id}/report",
            timeout=30,
        )
        if r.status_code == 200:
            rpt = r.json()
            ready = rpt.get("ready")
            if ready is True:
                log(f"  Report ready (grade={rpt.get('grade')}, generatedAt={rpt.get('generatedAt')})")
                return rpt
            else:
                log(f"  Report not ready yet — waiting...")
        elif r.status_code == 202:
            log(f"  Report processing (202) — waiting...")
        else:
            log(f"  Report HTTP {r.status_code} — waiting...")
        time.sleep(interval_secs)
    log(f"  Timeout: fetching partial report for {deal_id}")
    r = requests.get(f"{API_BASE}/api/v1/deals/{deal_id}/report", timeout=30)
    return r.json() if r.status_code == 200 else {"ready": False, "deal_id": deal_id}


def main():
    results = {}

    for deal in DEALS:
        log(f"\n{'=' * 60}")
        log(f"Processing: {deal['name']}")
        log(f"{'=' * 60}")

        deal_id = create_deal(deal)
        doc_ids = []

        for doc_cfg in deal["docs"]:
            doc_id = upload_document(deal_id, doc_cfg)
            if doc_id:
                doc_ids.append(doc_id)

        trigger_analysis(deal_id)

        # Wait for pipeline (ingestion + extraction + analysis)
        report = poll_report(deal_id, timeout_secs=900, interval_secs=15)

        results[deal["name"]] = {
            "deal_id": deal_id,
            "doc_ids": doc_ids,
            "report": report,
        }

        # Write per-deal JSON
        out_path = os.path.join(AUDIT_DIR, f"{deal['name'].lower()}_report.json")
        with open(out_path, "w") as f:
            json.dump(results[deal["name"]], f, indent=2, default=str)
        log(f"  Written: {out_path}")

    # Write combined results
    combined_path = os.path.join(AUDIT_DIR, "five5_all_reports.json")
    with open(combined_path, "w") as f:
        json.dump(
            {k: {"deal_id": v["deal_id"], "doc_ids": v["doc_ids"]} for k, v in results.items()},
            f,
            indent=2,
        )
    log(f"\nAll done. ID manifest: {combined_path}")

    # Print deal IDs for follow-on use
    print("\n=== DEAL IDs ===")
    for name, val in results.items():
        print(f"{name}: {val['deal_id']}")


if __name__ == "__main__":
    main()

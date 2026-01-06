from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

import requests
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from PIL import Image

from .extractors.layout import detect_layout_assets
from .extractors.ocr import run_ocr_lite
from .extractors.table import detect_table, extract_table
from .models import BBox, ExtractVisualsRequest, ExtractVisualsResponse, VisualAsset


logger = logging.getLogger("vision_worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(title="vision_worker", version="1.0.0")


def _log_event(event: str, payload: Dict[str, Any]) -> None:
    # Basic structured logging without extra dependencies.
    logger.info("%s %s", event, json.dumps(payload, sort_keys=True, default=str))


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_image_bytes(image_uri: str, *, timeout_s: float = 5.0) -> Tuple[Optional[bytes], Dict[str, Any]]:
    flags: Dict[str, Any] = {}

    if image_uri.startswith("http://") or image_uri.startswith("https://"):
        try:
            resp = requests.get(image_uri, timeout=timeout_s)
            resp.raise_for_status()
            return resp.content, flags
        except Exception as e:
            flags["image_load"] = "download_failed"
            flags["image_load_error"] = str(e)
            return None, flags

    # Local path
    try:
        with open(image_uri, "rb") as f:
            return f.read(), flags
    except Exception as e:
        flags["image_load"] = "file_read_failed"
        flags["image_load_error"] = str(e)
        return None, flags


def _open_image(image_bytes: bytes) -> Tuple[Optional[Image.Image], Dict[str, Any]]:
    flags: Dict[str, Any] = {}
    try:
        img = Image.open(io := _BytesIO(image_bytes))  # type: ignore
        img.load()
        return img, flags
    except Exception as e:
        flags["image_decode"] = "failed"
        flags["image_decode_error"] = str(e)
        return None, flags
    finally:
        try:
            io.close()  # type: ignore
        except Exception:
            pass


class _BytesIO:  # tiny local BytesIO to avoid importing io in hot path
    def __init__(self, b: bytes):
        import io

        self._io = io.BytesIO(b)

    def __getattr__(self, name: str):
        return getattr(self._io, name)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/extract-visuals")
def extract_visuals(req: ExtractVisualsRequest) -> JSONResponse:
    started = time.perf_counter()
    # Soft time budget for table extraction so we never block the worker.
    table_budget_s = float(os.getenv("TABLE_TIME_BUDGET_S", "4.0"))
    table_deadline = started + table_budget_s

    base_log = {
        "document_id": req.document_id,
        "page_index": req.page_index,
        "extractor_version": req.extractor_version,
    }

    try:
        image_bytes, load_flags = _read_image_bytes(req.image_uri)
        if not image_bytes:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            _log_event(
                "extract_visuals",
                {
                    **base_log,
                    "elapsed_ms": elapsed_ms,
                    "status": "ok",
                    "assets": 1,
                    "flags": load_flags,
                },
            )

            # Return a stable shape with a synthetic asset containing the error.
            asset = VisualAsset(
                asset_type="unknown",
                bbox=BBox(x=0.0, y=0.0, w=1.0, h=1.0),
                confidence=0.0,
                quality_flags={"error": "image_load_failed", **load_flags},
                image_uri=None,
                image_hash=None,
            )
            out = ExtractVisualsResponse(
                document_id=req.document_id,
                page_index=req.page_index,
                extractor_version=req.extractor_version,
                assets=[asset],
            )
            return JSONResponse(status_code=200, content=out.model_dump())

        image_hash = _sha256_hex(image_bytes)

        # Open image
        try:
            from io import BytesIO

            img = Image.open(BytesIO(image_bytes))
            img.load()
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            flags = {"image_decode": "failed", "image_decode_error": str(e)}
            _log_event(
                "extract_visuals",
                {**base_log, "elapsed_ms": elapsed_ms, "status": "ok", "assets": 1, "flags": flags},
            )
            asset = VisualAsset(
                asset_type="unknown",
                bbox=BBox(x=0.0, y=0.0, w=1.0, h=1.0),
                confidence=0.0,
                quality_flags={"error": "image_decode_failed", **flags},
                image_uri=None,
                image_hash=image_hash,
            )
            out = ExtractVisualsResponse(
                document_id=req.document_id,
                page_index=req.page_index,
                extractor_version=req.extractor_version,
                assets=[asset],
            )
            return JSONResponse(status_code=200, content=out.model_dump())

        # Layout-lite
        assets = detect_layout_assets(
            extractor_version=req.extractor_version,
            image_width=img.size[0],
            image_height=img.size[1],
        )

        # OCR-lite on each asset (v1: full-page only)
        table_summary: Dict[str, Any] = {
            "table_detected": False,
            "table_method": None,
            "table_rows": 0,
            "table_cols": 0,
        }

        for a in assets:
            extraction, ocr_flags = run_ocr_lite(img)
            a.extraction = extraction
            # Attach URI/hash metadata (no crop in v1)
            a.image_uri = None
            a.image_hash = image_hash
            if ocr_flags:
                a.quality_flags.update(ocr_flags)

            # Table detection/extraction (full-page only in v1)
            detect_res, table_detect_flags = detect_table(img, deadline=table_deadline)
            if table_detect_flags:
                a.quality_flags.update(table_detect_flags)

            if detect_res.detected:
                a.asset_type = "table"
                # Keep OCR output as-is; only add structured_json.table
                structured, table_flags = extract_table(
                    img,
                    detect=detect_res,
                    ocr_blocks=extraction.ocr_blocks,
                    deadline=table_deadline,
                )
                if table_flags:
                    a.quality_flags.update(table_flags)

                a.extraction.structured_json = structured

                try:
                    rows = structured.get("table", {}).get("rows", [])
                    table_rows = len(rows) if isinstance(rows, list) else 0
                    table_cols = len(rows[0]) if table_rows and isinstance(rows[0], list) else 0
                except Exception:
                    table_rows = 0
                    table_cols = 0

                table_conf = float(structured.get("table", {}).get("confidence", 0.0) or 0.0)
                table_method = structured.get("table", {}).get("method")
                table_summary = {
                    "table_detected": True,
                    "table_method": table_method,
                    "table_rows": table_rows,
                    "table_cols": table_cols,
                }

                # Bump confidences based on table extraction quality
                a.extraction.confidence = max(a.extraction.confidence, table_conf)
                a.confidence = max(a.confidence, table_conf)

            # If OCR text exists, bump confidence a bit
            if extraction.ocr_text:
                a.confidence = max(a.confidence, extraction.confidence)
            else:
                a.confidence = min(a.confidence, 0.25)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        _log_event(
            "extract_visuals",
            {
                **base_log,
                "elapsed_ms": elapsed_ms,
                "status": "ok",
                "assets": len(assets),
                **table_summary,
            },
        )

        out = ExtractVisualsResponse(
            document_id=req.document_id,
            page_index=req.page_index,
            extractor_version=req.extractor_version,
            assets=assets,
        )
        return JSONResponse(status_code=200, content=out.model_dump())

    except Exception as e:  # ultimate fail-safe
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        _log_event(
            "extract_visuals",
            {**base_log, "elapsed_ms": elapsed_ms, "status": "ok", "assets": 1, "error": str(e)},
        )

        asset = VisualAsset(
            asset_type="unknown",
            bbox=BBox(x=0.0, y=0.0, w=1.0, h=1.0),
            confidence=0.0,
            quality_flags={"error": "uncaught_exception", "error_detail": str(e)},
            image_uri=None,
            image_hash=None,
        )
        out = ExtractVisualsResponse(
            document_id=req.document_id,
            page_index=req.page_index,
            extractor_version=req.extractor_version,
            assets=[asset],
        )
        return JSONResponse(status_code=200, content=out.model_dump())

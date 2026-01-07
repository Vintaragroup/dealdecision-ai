from __future__ import annotations

import shutil
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from ..models import BBox, OcrBlock, VisualExtraction


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _norm_bbox(x: int, y: int, w: int, h: int, *, img_w: int, img_h: int) -> BBox:
    if img_w <= 0 or img_h <= 0:
        return BBox(x=0.0, y=0.0, w=1.0, h=1.0)
    return BBox(
        x=_clamp01(x / img_w),
        y=_clamp01(y / img_h),
        w=_clamp01(w / img_w),
        h=_clamp01(h / img_h),
    )


def run_ocr_lite(image: Image.Image) -> Tuple[VisualExtraction, Dict[str, Any]]:
    """OCR-lite.

    - Tries pytesseract if importable and the tesseract binary exists.
    - Never raises; returns empty OCR + quality_flags on failure.
    """

    flags: Dict[str, Any] = {}

    try:
        import pytesseract  # type: ignore
    except Exception as e:  # pragma: no cover
        flags["ocr"] = "pytesseract_missing"
        flags["ocr_error"] = str(e)
        return VisualExtraction(ocr_text=None, ocr_blocks=[], confidence=0.0), flags

    # If pytesseract is installed but tesseract binary is not, fail closed.
    if shutil.which("tesseract") is None:
        flags["ocr"] = "tesseract_binary_missing"
        return VisualExtraction(ocr_text=None, ocr_blocks=[], confidence=0.0), flags

    try:
        try:
            img = image.convert("RGB")
        except Exception:
            img = image

        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, lang="eng")
        text_items: List[str] = []
        blocks: List[OcrBlock] = []

        img_w, img_h = img.size

        n = len(data.get("text", []))
        for i in range(n):
            raw_text = data.get("text", [""])[i]
            if not raw_text:
                continue
            t = str(raw_text).strip()
            if not t:
                continue

            left = int(data.get("left", [0])[i] or 0)
            top = int(data.get("top", [0])[i] or 0)
            width = int(data.get("width", [0])[i] or 0)
            height = int(data.get("height", [0])[i] or 0)

            conf_val: Optional[float] = None
            try:
                # pytesseract conf is typically 0-100 or -1
                conf_raw = data.get("conf", [None])[i]
                if conf_raw is not None:
                    conf_num = float(conf_raw)
                    if conf_num >= 0:
                        conf_val = _clamp01(conf_num / 100.0)
            except Exception:
                conf_val = None

            blocks.append(
                OcrBlock(
                    text=t,
                    bbox=_norm_bbox(left, top, width, height, img_w=img_w, img_h=img_h),
                    confidence=conf_val,
                )
            )
            text_items.append(t)

        ocr_text = " ".join(text_items).strip() if text_items else None

        # confidence: simple aggregate (mean of block confs if present)
        confs = [b.confidence for b in blocks if b.confidence is not None]
        if confs:
            avg = sum(confs) / max(1, len(confs))
            confidence = float(_clamp01(avg))
        else:
            confidence = 0.5 if ocr_text else 0.0

        if not ocr_text:
            flags["ocr"] = "no_text_detected"

        return VisualExtraction(ocr_text=ocr_text, ocr_blocks=blocks, confidence=confidence), flags

    except Exception as e:  # pragma: no cover
        flags["ocr"] = "failed"
        flags["ocr_error"] = str(e)
        return VisualExtraction(ocr_text=None, ocr_blocks=[], confidence=0.0), flags

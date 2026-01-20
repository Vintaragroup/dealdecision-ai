from __future__ import annotations

import shutil
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image
from PIL import ImageFilter, ImageOps

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

    def _preprocess_for_ocr(img_in: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
        meta: Dict[str, Any] = {}
        img = img_in

        try:
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass

        try:
            img = img.convert("L")
            meta["mode"] = "L"
        except Exception:
            meta["mode"] = getattr(img, "mode", None)

        # Scale up small renders (common for PPTX/PDF page images) to help OCR.
        try:
            w, h = img.size
            if w > 0 and h > 0:
                target_min = 1600
                target_max = 3200
                min_side = min(w, h)
                max_side = max(w, h)
                scale = 1.0
                if min_side < target_min:
                    scale = target_min / float(min_side)
                if max_side * scale > target_max:
                    scale = target_max / float(max_side)
                if scale > 1.05:
                    img = img.resize((int(w * scale), int(h * scale)), resample=Image.Resampling.LANCZOS)
                    meta["scaled"] = float(scale)
        except Exception:
            pass

        # Contrast normalization + mild denoise/sharpen.
        try:
            img = ImageOps.autocontrast(img)
            meta["autocontrast"] = True
        except Exception:
            meta["autocontrast"] = False

        try:
            img = img.filter(ImageFilter.MedianFilter(size=3))
            meta["median"] = True
        except Exception:
            meta["median"] = False

        try:
            img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
            meta["unsharp"] = True
        except Exception:
            meta["unsharp"] = False

        # Optional binarization (Otsu) to reduce background gradients.
        # If numpy isn't available, fall back to a conservative fixed threshold.
        try:
            import numpy as np  # type: ignore

            arr = np.array(img)
            if arr.size > 0:
                # Otsu threshold
                hist = np.bincount(arr.flatten(), minlength=256).astype(np.float64)
                total = arr.size
                sum_total = float((np.arange(256) * hist).sum())
                sum_b = 0.0
                w_b = 0.0
                best_var = -1.0
                best_t = 180
                for t in range(256):
                    w_b += float(hist[t])
                    if w_b == 0.0:
                        continue
                    w_f = float(total) - w_b
                    if w_f == 0.0:
                        break
                    sum_b += float(t * hist[t])
                    m_b = sum_b / w_b
                    m_f = (sum_total - sum_b) / w_f
                    var_between = w_b * w_f * (m_b - m_f) * (m_b - m_f)
                    if var_between > best_var:
                        best_var = var_between
                        best_t = t

                bin_arr = (arr > best_t).astype(np.uint8) * 255
                img = Image.fromarray(bin_arr, mode="L")
                meta["binarize"] = "otsu"
                meta["threshold"] = int(best_t)
        except Exception:
            try:
                img = img.point(lambda p: 255 if p > 180 else 0)
                meta["binarize"] = "fixed"
                meta["threshold"] = 180
            except Exception:
                meta["binarize"] = False

        return img, meta

    try:
        try:
            # Preprocess before OCR; keep the result single-channel for Tesseract.
            img_rgb = image.convert("RGB")
        except Exception:
            img_rgb = image

        img, prep_meta = _preprocess_for_ocr(img_rgb)
        flags["ocr_preprocess_v1"] = prep_meta

        # Tesseract config tuned for slide/page-like layouts.
        # - oem 1: LSTM
        # - psm 6: assume a uniform block of text (works well for slide body)
        base_config = "--oem 1 --psm 6 -c preserve_interword_spaces=1"
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, lang="eng", config=base_config)

        # If we got almost nothing, retry with sparse text mode (helps with big headings).
        try:
            if len([t for t in data.get("text", []) if str(t).strip()]) < 10:
                sparse_config = "--oem 1 --psm 11 -c preserve_interword_spaces=1"
                data2 = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, lang="eng", config=sparse_config)
                if len([t for t in data2.get("text", []) if str(t).strip()]) > len([t for t in data.get("text", []) if str(t).strip()]):
                    data = data2
                    flags["ocr_psm"] = 11
                else:
                    flags["ocr_psm"] = 6
            else:
                flags["ocr_psm"] = 6
        except Exception:
            flags["ocr_psm"] = 6
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

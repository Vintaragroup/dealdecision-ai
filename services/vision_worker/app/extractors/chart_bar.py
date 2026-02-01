from __future__ import annotations

import re
import shutil
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from ..models import OcrBlock


def _now() -> float:
    return time.perf_counter()


def _deadline_exceeded(deadline: Optional[float]) -> bool:
    return deadline is not None and _now() > deadline


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _safe_import_cv2() -> Tuple[Optional[Any], Optional[str]]:
    try:
        import cv2  # type: ignore

        return cv2, None
    except Exception as e:
        return None, str(e)


@dataclass(frozen=True)
class BarChartDetectResult:
    detected: bool
    bar_count: int
    bars: List[Tuple[int, int, int, int]]  # (x, y, w, h) pixel bbox
    baseline_y: int
    score: float


def _pil_to_gray_np(image: Image.Image) -> np.ndarray:
    if image.mode != "L":
        image = image.convert("L")
    return np.array(image)


def _threshold_binary(gray: np.ndarray, *, cv2: Any) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw


def _subtract_thin_axis_lines(*, bw: np.ndarray, img_w: int, img_h: int, cv2: Any) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Remove thin axis/grid lines while preserving filled bars.

    Important: a naive horizontal morphology will also pick up filled bars (they contain
    long horizontal runs). We therefore only subtract components that are both (a) long
    and (b) thin.
    """

    flags: Dict[str, Any] = {}
    try:
        # Candidate horizontal line components
        kx = max(35, img_w // 14)
        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kx, 1))
        horiz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, h_kernel, iterations=1)

        h_mask = np.zeros_like(bw)
        contours, _ = cv2.findContours(horiz, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_line_w = int(img_w * 0.35)
        max_line_h = max(6, int(img_h * 0.03))
        kept_h = 0
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w >= min_line_w and h <= max_line_h:
                cv2.drawContours(h_mask, [c], -1, 255, thickness=-1)
                kept_h += 1

        # Candidate vertical line components
        ky = max(45, img_h // 10)
        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, ky))
        vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, v_kernel, iterations=1)

        v_mask = np.zeros_like(bw)
        contours, _ = cv2.findContours(vert, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_line_h = int(img_h * 0.35)
        max_line_w = max(6, int(img_w * 0.02))
        kept_v = 0
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if h >= min_line_h and w <= max_line_w:
                cv2.drawContours(v_mask, [c], -1, 255, thickness=-1)
                kept_v += 1

        line_mask = cv2.bitwise_or(h_mask, v_mask)
        cleaned = cv2.subtract(bw, line_mask)

        flags["axis_line_components_removed"] = int(kept_h + kept_v)
        return cleaned, flags
    except Exception as e:
        flags["axis_line_subtract_failed"] = True
        flags["axis_line_subtract_error"] = str(e)
        return bw, flags


def _filter_bar_candidates(
    rects: Sequence[Tuple[int, int, int, int]], *, img_w: int, img_h: int
) -> List[Tuple[int, int, int, int]]:
    out: List[Tuple[int, int, int, int]] = []
    min_area = max(80, int(img_w * img_h * 0.00008))
    min_h = max(18, int(img_h * 0.06))
    min_w = max(5, int(img_w * 0.008))

    for x, y, w, h in rects:
        if w <= 0 or h <= 0:
            continue
        if w * h < min_area:
            continue
        # Bars can be short; keep a mild aspect ratio gate to avoid flat regions.
        if (h / max(1, w)) < 0.55:
            continue
        if h < min_h:
            continue
        # Avoid extremely thin/tall strokes
        if w < min_w:
            continue
        # Avoid huge blocks (e.g., full-page)
        if w > int(img_w * 0.6) or h > int(img_h * 0.9):
            continue
        out.append((x, y, w, h))

    return out


def _cluster_by_x(
    rects: Sequence[Tuple[int, int, int, int]], *, merge_px: int
) -> List[Tuple[int, int, int, int]]:
    if not rects:
        return []
    rs = sorted(rects, key=lambda r: r[0] + r[2] / 2)
    clusters: List[List[Tuple[int, int, int, int]]] = []
    cur: List[Tuple[int, int, int, int]] = [rs[0]]
    cur_cx = rs[0][0] + rs[0][2] / 2
    for r in rs[1:]:
        cx = r[0] + r[2] / 2
        if abs(cx - cur_cx) <= merge_px:
            cur.append(r)
            cur_cx = float(sum(x + w / 2 for x, _, w, _ in cur) / len(cur))
        else:
            clusters.append(cur)
            cur = [r]
            cur_cx = cx
    clusters.append(cur)

    # For each x-cluster, pick the largest area rect
    merged: List[Tuple[int, int, int, int]] = []
    for c in clusters:
        merged.append(max(c, key=lambda r: r[2] * r[3]))
    return merged


def detect_bar_chart(
    image: Image.Image,
    *,
    deadline: Optional[float] = None,
) -> Tuple[BarChartDetectResult, Dict[str, Any]]:
    """Detect simple vertical bar charts.

    Heuristic: find repeated tall rectangles with similar widths aligned to a baseline.
    Never raises.
    """

    flags: Dict[str, Any] = {
        "chart_detected": False,
        "chart_type_bar": False,
    }

    if _deadline_exceeded(deadline):
        flags["time_budget_exceeded"] = True
        return BarChartDetectResult(False, 0, [], 0, 0.0), flags

    cv2, cv2_err = _safe_import_cv2()
    if cv2 is None:
        flags["opencv_missing"] = True
        flags["opencv_error"] = cv2_err
        return BarChartDetectResult(False, 0, [], 0, 0.0), flags

    try:
        img_w, img_h = image.size
        gray = _pil_to_gray_np(image)
        bw = _threshold_binary(gray, cv2=cv2)

        # Remove thin axis/grid lines but keep filled bars.
        bw, line_flags = _subtract_thin_axis_lines(bw=bw, img_w=img_w, img_h=img_h, cv2=cv2)
        flags.update(line_flags)

        # Break tiny unintended bridges between bars (common after blur/threshold),
        # without destroying the bars themselves.
        try:
            ksize = 5 if min(img_w, img_h) >= 300 else 3
            k = cv2.getStructuringElement(cv2.MORPH_RECT, (ksize, ksize))
            bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k, iterations=1)
            flags["denoise_open_kernel"] = int(ksize)
        except Exception:
            pass

        if _deadline_exceeded(deadline):
            flags["time_budget_exceeded"] = True
            return BarChartDetectResult(False, 0, [], 0, 0.0), flags

        # Find contours on the cleaned binary image
        contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rects: List[Tuple[int, int, int, int]] = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            rects.append((int(x), int(y), int(w), int(h)))

        candidates = _filter_bar_candidates(rects, img_w=img_w, img_h=img_h)
        if not candidates:
            return BarChartDetectResult(False, 0, [], 0, 0.0), flags

        # Merge near-duplicate bars by x center
        merge_px = max(6, int(img_w * 0.02))
        bars = _cluster_by_x(candidates, merge_px=merge_px)

        if len(bars) < 3:
            return BarChartDetectResult(False, len(bars), bars, 0, 0.0), flags

        # Baseline alignment: bottoms should be close
        bottoms = np.array([y + h for _, y, _, h in bars], dtype=np.float32)
        baseline_y = int(np.median(bottoms))
        baseline_std = float(np.std(bottoms))

        widths = np.array([w for _, _, w, _ in bars], dtype=np.float32)
        width_mean = float(np.mean(widths))
        width_cv = float(np.std(widths) / max(1e-6, width_mean))

        # Require most bars within a small tolerance from baseline
        baseline_tol = max(6.0, img_h * 0.015)
        aligned = sum(1 for b in bottoms if abs(float(b) - baseline_y) <= baseline_tol)
        aligned_ratio = aligned / max(1, len(bars))

        detected = bool(aligned_ratio >= 0.7 and width_cv <= 0.4)
        if not detected:
            return BarChartDetectResult(False, len(bars), bars, baseline_y, 0.0), flags

        # Score: more bars + tighter width/baseline alignment
        bar_count_score = _clamp01((len(bars) - 2) / 6.0)
        width_score = _clamp01(1.0 - width_cv)
        baseline_score = _clamp01(1.0 - (baseline_std / max(1.0, baseline_tol * 2.0)))
        score = float(_clamp01(0.15 + 0.45 * bar_count_score + 0.25 * width_score + 0.15 * baseline_score))

        flags["chart_detected"] = True
        flags["chart_type_bar"] = True
        return BarChartDetectResult(True, len(bars), sorted(bars, key=lambda r: r[0]), baseline_y, score), flags

    except Exception as e:
        flags["extraction_error"] = True
        flags["extraction_error_detail"] = str(e)
        return BarChartDetectResult(False, 0, [], 0, 0.0), flags


_NUM_RE = re.compile(r"[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\$?")


def _try_import_pytesseract() -> Tuple[Optional[Any], Dict[str, Any]]:
    flags: Dict[str, Any] = {}
    try:
        import pytesseract  # type: ignore

        if shutil.which("tesseract") is None:
            flags["tesseract_binary_missing"] = True
            return None, flags
        return pytesseract, flags
    except Exception as e:
        flags["pytesseract_missing"] = True
        flags["pytesseract_error"] = str(e)
        return None, flags


def _parse_number(token: str) -> Optional[float]:
    s = token.strip()
    if not s:
        return None
    is_percent = s.endswith("%")
    s = s.replace("%", "")
    s = s.replace("$", "")
    s = s.replace(",", "")
    try:
        v = float(s)
        if is_percent:
            return v / 100.0
        return v
    except Exception:
        return None


def _ocr_strip_data(
    image: Image.Image,
    *,
    region: Tuple[int, int, int, int],
    deadline: Optional[float],
    ocr_data_fn: Optional[Callable[[Image.Image], List[Tuple[str, int, int, int, int]]]] = None,
) -> Tuple[List[Tuple[str, int, int, int, int]], Dict[str, Any]]:
    flags: Dict[str, Any] = {}
    if _deadline_exceeded(deadline):
        flags["time_budget_exceeded"] = True
        return [], flags

    crop = image.crop(region)

    if ocr_data_fn is not None:
        try:
            return ocr_data_fn(crop), flags
        except Exception as e:
            flags["ocr_strip_failed"] = True
            flags["ocr_strip_error"] = str(e)
            return [], flags

    pytesseract, dep_flags = _try_import_pytesseract()
    if dep_flags:
        flags.update(dep_flags)
    if pytesseract is None:
        return [], flags

    try:
        data = pytesseract.image_to_data(crop, output_type=pytesseract.Output.DICT)
        out: List[Tuple[str, int, int, int, int]] = []
        n = len(data.get("text", []))
        for i in range(n):
            t = str(data.get("text", [""])[i] or "").strip()
            if not t:
                continue
            left = int(data.get("left", [0])[i] or 0)
            top = int(data.get("top", [0])[i] or 0)
            width = int(data.get("width", [0])[i] or 0)
            height = int(data.get("height", [0])[i] or 0)
            out.append((t, left, top, width, height))
        return out, flags
    except Exception as e:
        flags["ocr_strip_failed"] = True
        flags["ocr_strip_error"] = str(e)
        return [], flags


def _fit_linear_y_map(points: Sequence[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    # points: (y_px, value)
    if len(points) < 2:
        return None
    ys = np.array([p[0] for p in points], dtype=np.float64)
    vs = np.array([p[1] for p in points], dtype=np.float64)
    if float(np.std(ys)) < 1e-6:
        return None
    # Fit v = a*y + b
    a, b = np.polyfit(ys, vs, 1)
    return float(a), float(b)


def extract_bar_chart(
    image: Image.Image,
    *,
    detect: BarChartDetectResult,
    ocr_blocks: Optional[Sequence[OcrBlock]] = None,
    deadline: Optional[float] = None,
    ocr_data_fn: Optional[Callable[[Image.Image], List[Tuple[str, int, int, int, int]]]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Extract MVP bar chart data.

    - Returns normalized values if axis mapping can't be established.
    - Never raises.
    """

    started = _now()
    flags: Dict[str, Any] = {
        "chart_detected": bool(detect.detected),
        "chart_type_bar": True,
        "axis_mapping_succeeded": False,
        "axis_mapping_failed": False,
        "x_labels_missing": False,
        "values_normalized": True,
    }

    chart: Dict[str, Any] = {
        "type": "bar",
        "title": None,
        "x_labels": [],
        "series": [
            {
                "name": "Series 1",
                "values": [],
                "unit": None,
                "values_are_normalized": True,
            }
        ],
        "y_unit": None,
        "confidence": 0.0,
        "method": "bar_pixels_v1",
    }

    try:
        if not detect.detected or detect.bar_count < 3:
            chart["notes"] = "not_detected"
            return {"chart": chart}, flags

        img_w, img_h = image.size

        # Compute heights in pixels
        bars = sorted(detect.bars, key=lambda r: r[0])
        heights_px = [max(0, detect.baseline_y - y) for _, y, _, _ in bars]
        max_h = max(1, max(heights_px))

        if _deadline_exceeded(deadline):
            flags["time_budget_exceeded"] = True
            chart["notes"] = "time_budget_exceeded"
            return {"chart": chart}, flags

        # Attempt axis mapping (optional)
        axis_points: List[Tuple[float, float]] = []
        try:
            # left strip near bars
            min_x = min(x for x, _, _, _ in bars)
            strip_l = max(0, min_x - int(img_w * 0.22))
            strip_r = max(0, min_x - int(img_w * 0.02))
            strip_t = max(0, int(img_h * 0.05))
            strip_b = min(img_h, int(detect.baseline_y + img_h * 0.02))
            if strip_r > strip_l + 4 and strip_b > strip_t + 4:
                items, ocr_flags = _ocr_strip_data(
                    image,
                    region=(strip_l, strip_t, strip_r, strip_b),
                    deadline=deadline,
                    ocr_data_fn=ocr_data_fn,
                )
                if ocr_flags:
                    flags.update(ocr_flags)

                for t, left, top, width, height in items:
                    m = _NUM_RE.search(t)
                    if not m:
                        continue
                    v = _parse_number(m.group(0))
                    if v is None:
                        continue
                    # y position in full image coordinates
                    y_center = strip_t + top + height / 2
                    axis_points.append((float(y_center), float(v)))

                # keep distinct points
                if len(axis_points) >= 2:
                    # pick up to 6 points with varied y
                    axis_points.sort(key=lambda p: p[0])
                    thinned: List[Tuple[float, float]] = []
                    last_y: Optional[float] = None
                    for y, v in axis_points:
                        if last_y is None or abs(y - last_y) > 12:
                            thinned.append((y, v))
                            last_y = y
                        if len(thinned) >= 6:
                            break
                    axis_points = thinned

        except Exception:
            axis_points = []

        mapping = _fit_linear_y_map(axis_points) if len(axis_points) >= 2 else None

        values: List[float]
        values_are_normalized: bool
        if mapping is not None:
            a, b = mapping
            # baseline value estimated from mapping
            v_base = a * float(detect.baseline_y) + b
            values = []
            for hpx in heights_px:
                y_top = float(detect.baseline_y - hpx)
                v_top = a * y_top + b
                values.append(float(v_top - v_base))
            values_are_normalized = False
            flags["axis_mapping_succeeded"] = True
            flags["values_normalized"] = False
        else:
            values = [float(h / max_h) for h in heights_px]
            values_are_normalized = True
            flags["axis_mapping_failed"] = True

        chart["series"][0]["values"] = values
        chart["series"][0]["values_are_normalized"] = values_are_normalized

        # X labels best-effort via OCR blocks below bars
        try:
            x_centers = [x + w / 2 for x, _, w, _ in bars]
            labels: List[str] = ["" for _ in bars]

            if ocr_blocks:
                # Choose blocks below baseline (or near bottom) and near the bars x-range
                for blk in ocr_blocks:
                    if not blk.text:
                        continue
                    # Convert normalized bbox center to pixels
                    cx = (blk.bbox.x + blk.bbox.w / 2) * img_w
                    cy = (blk.bbox.y + blk.bbox.h / 2) * img_h

                    if cy < float(detect.baseline_y) + img_h * 0.03:
                        continue
                    j = int(np.argmin([abs(cx - bx) for bx in x_centers]))
                    # append words (could be multi-token)
                    labels[j] = (labels[j] + " " + blk.text.strip()).strip()

                # Drop empty labels
                if any(l.strip() for l in labels):
                    chart["x_labels"] = [l.strip() for l in labels]
                else:
                    flags["x_labels_missing"] = True
            else:
                flags["x_labels_missing"] = True
        except Exception:
            flags["x_labels_missing"] = True

        # Confidence: base from detection score + boosts
        conf = float(_clamp01(0.45 + 0.45 * detect.score))
        if flags.get("axis_mapping_succeeded"):
            conf = float(_clamp01(conf + 0.18))
        if flags.get("x_labels_missing"):
            conf = float(_clamp01(conf - 0.10))
        if values_are_normalized:
            conf = float(_clamp01(conf - 0.08))
        chart["confidence"] = conf

        # Notes for MVP limitations
        chart["notes"] = "mvp_single_series" if detect.bar_count > 0 else "no_bars"

        return {"chart": chart}, flags

    except Exception as e:
        flags["extraction_error"] = True
        flags["extraction_error_detail"] = str(e)
        chart["confidence"] = 0.0
        chart["notes"] = "extraction_error"
        return {"chart": chart}, flags
    finally:
        flags["chart_elapsed_ms"] = int((_now() - started) * 1000)

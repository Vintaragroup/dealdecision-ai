from __future__ import annotations

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
class TableDetectResult:
    detected: bool
    grid_detected: bool
    method: str
    line_pixel_ratio: float
    intersections_count: int
    x_lines: List[int]
    y_lines: List[int]


def _pil_to_gray_np(image: Image.Image) -> np.ndarray:
    # Ensure 8-bit grayscale
    if image.mode != "L":
        image = image.convert("L")
    return np.array(image)


def _threshold_binary(gray: np.ndarray, *, cv2: Any) -> np.ndarray:
    # Otsu threshold; invert so lines become white (255)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw


def _extract_lines(
    bw: np.ndarray, *, cv2: Any, axis: str, min_kernel: int = 10
) -> np.ndarray:
    h, w = bw.shape[:2]

    if axis == "h":
        k = max(min_kernel, w // 30)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, 1))
    else:
        k = max(min_kernel, h // 30)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, k))

    eroded = cv2.erode(bw, kernel, iterations=1)
    dilated = cv2.dilate(eroded, kernel, iterations=1)
    return dilated


def _segments_to_centers(indices: np.ndarray) -> List[int]:
    # indices is sorted 1D array of active positions
    if indices.size == 0:
        return []

    centers: List[int] = []
    start = int(indices[0])
    prev = int(indices[0])
    for idx in indices[1:]:
        i = int(idx)
        if i == prev + 1:
            prev = i
            continue
        centers.append((start + prev) // 2)
        start = i
        prev = i
    centers.append((start + prev) // 2)
    return centers


def _line_positions_from_mask(mask: np.ndarray, *, axis: str) -> List[int]:
    # For horizontal lines, we want y positions; for vertical lines, x positions.
    h, w = mask.shape[:2]

    if axis == "h":
        proj = np.sum(mask > 0, axis=1)  # per y
        threshold = max(10, int(w * 0.35))
    else:
        proj = np.sum(mask > 0, axis=0)  # per x
        threshold = max(10, int(h * 0.35))

    active = np.where(proj >= threshold)[0]
    return _segments_to_centers(active)


def detect_table(
    image: Image.Image,
    *,
    deadline: Optional[float] = None,
) -> Tuple[TableDetectResult, Dict[str, Any]]:
    """Heuristic table detector.

    Returns (result, flags). Never raises.
    """

    flags: Dict[str, Any] = {
        "table_detected": False,
        "grid_detected": False,
    }

    if _deadline_exceeded(deadline):
        flags["time_budget_exceeded"] = True
        return (
            TableDetectResult(
                detected=False,
                grid_detected=False,
                method="grid_lines_v1",
                line_pixel_ratio=0.0,
                intersections_count=0,
                x_lines=[],
                y_lines=[],
            ),
            flags,
        )

    cv2, cv2_err = _safe_import_cv2()
    if cv2 is None:
        flags["opencv_missing"] = True
        flags["opencv_error"] = cv2_err
        return (
            TableDetectResult(
                detected=False,
                grid_detected=False,
                method="grid_lines_v1",
                line_pixel_ratio=0.0,
                intersections_count=0,
                x_lines=[],
                y_lines=[],
            ),
            flags,
        )

    try:
        gray = _pil_to_gray_np(image)
        bw = _threshold_binary(gray, cv2=cv2)

        if _deadline_exceeded(deadline):
            flags["time_budget_exceeded"] = True
            raise TimeoutError("time budget exceeded")

        horizontal = _extract_lines(bw, cv2=cv2, axis="h")
        vertical = _extract_lines(bw, cv2=cv2, axis="v")

        combined = cv2.bitwise_or(horizontal, vertical)
        intersections = cv2.bitwise_and(horizontal, vertical)

        h, w = bw.shape[:2]
        total_pixels = float(max(1, h * w))
        line_pixels = float(np.count_nonzero(combined))
        line_ratio = float(line_pixels / total_pixels)
        intersections_count = int(np.count_nonzero(intersections))

        x_lines = _line_positions_from_mask(vertical, axis="v")
        y_lines = _line_positions_from_mask(horizontal, axis="h")

        # Table heuristic thresholds
        # - line_ratio catches grid density
        # - intersections_count catches structured crossings
        # - min lines ensures at least a 2x2 grid-ish
        min_lines_ok = len(x_lines) >= 3 and len(y_lines) >= 3
        ratio_ok = line_ratio >= 0.008
        intersections_ok = intersections_count >= 200

        detected = bool(min_lines_ok and (ratio_ok or intersections_ok))
        grid_detected = bool(min_lines_ok)

        flags["table_detected"] = detected
        flags["grid_detected"] = grid_detected

        return (
            TableDetectResult(
                detected=detected,
                grid_detected=grid_detected,
                method="grid_lines_v1",
                line_pixel_ratio=_clamp01(line_ratio * 10.0),  # normalize-ish
                intersections_count=intersections_count,
                x_lines=x_lines,
                y_lines=y_lines,
            ),
            flags,
        )

    except TimeoutError:
        # already flagged
        return (
            TableDetectResult(
                detected=False,
                grid_detected=False,
                method="grid_lines_v1",
                line_pixel_ratio=0.0,
                intersections_count=0,
                x_lines=[],
                y_lines=[],
            ),
            flags,
        )
    except Exception as e:
        flags["extraction_error"] = True
        flags["extraction_error_detail"] = str(e)
        return (
            TableDetectResult(
                detected=False,
                grid_detected=False,
                method="grid_lines_v1",
                line_pixel_ratio=0.0,
                intersections_count=0,
                x_lines=[],
                y_lines=[],
            ),
            flags,
        )


def _default_cell_ocr(image: Image.Image) -> Tuple[str, Dict[str, Any]]:
    flags: Dict[str, Any] = {}

    try:
        import pytesseract  # type: ignore
    except Exception as e:
        flags["pytesseract_missing"] = True
        flags["pytesseract_error"] = str(e)
        return "", flags

    if shutil.which("tesseract") is None:
        flags["tesseract_binary_missing"] = True
        return "", flags

    try:
        # Single-line-ish, keep it fast
        txt = pytesseract.image_to_string(image, config="--psm 6")
        return (txt or "").strip(), flags
    except Exception as e:
        flags["cell_ocr_failed"] = True
        flags["cell_ocr_error"] = str(e)
        return "", flags


def _crop_cell(image: Image.Image, left: int, top: int, right: int, bottom: int) -> Image.Image:
    w, h = image.size
    l = max(0, min(w, left))
    t = max(0, min(h, top))
    r = max(0, min(w, right))
    b = max(0, min(h, bottom))
    if r <= l + 1 or b <= t + 1:
        return image.crop((0, 0, 1, 1))
    return image.crop((l, t, r, b))


def _cap_lines(lines: Sequence[int], cap: int) -> List[int]:
    xs = sorted(set(int(v) for v in lines))
    if len(xs) <= cap:
        return xs
    # Downsample evenly to avoid worst-case OCR storms
    idxs = np.linspace(0, len(xs) - 1, cap).astype(int).tolist()
    return [xs[i] for i in idxs]


def _cluster_blocks_to_grid(
    blocks: Sequence[OcrBlock], *, img_w: int, img_h: int
) -> Tuple[List[List[str]], int, int]:
    # Simple OCR-box clustering into row groups, then fixed column buckets.
    if not blocks or img_w <= 0 or img_h <= 0:
        return [], 0, 0

    items: List[Tuple[int, int, str]] = []
    for b in blocks:
        if not b.text:
            continue
        x = int(((b.bbox.x + (b.bbox.w / 2.0)) * img_w))
        y = int(((b.bbox.y + (b.bbox.h / 2.0)) * img_h))
        items.append((x, y, b.text.strip()))
    if not items:
        return [], 0, 0

    items.sort(key=lambda t: (t[1], t[0]))
    y_tol = max(8, int(img_h * 0.02))

    rows: List[List[Tuple[int, str]]] = []
    cur: List[Tuple[int, str]] = []
    cur_y: Optional[int] = None
    for x, y, text in items:
        if cur_y is None:
            cur_y = y
            cur = [(x, text)]
            continue
        if abs(y - cur_y) <= y_tol:
            cur.append((x, text))
            # update running center
            cur_y = int((cur_y + y) / 2)
        else:
            rows.append(sorted(cur, key=lambda t: t[0]))
            cur_y = y
            cur = [(x, text)]
    if cur:
        rows.append(sorted(cur, key=lambda t: t[0]))

    # Build global column centers from all x positions
    xs = sorted(x for r in rows for x, _ in r)
    if not xs:
        return [], 0, 0

    x_gap = max(12, int(img_w * 0.04))
    centers: List[int] = [xs[0]]
    for x in xs[1:]:
        if abs(x - centers[-1]) > x_gap:
            centers.append(x)
        else:
            centers[-1] = int((centers[-1] + x) / 2)

    col_count = len(centers)

    grid: List[List[str]] = []
    for r in rows:
        cell_words: List[List[str]] = [[] for _ in range(col_count)]
        for x, text in r:
            j = int(np.argmin([abs(x - c) for c in centers]))
            cell_words[j].append(text)
        grid.append([" ".join(ws).strip() for ws in cell_words])

    return grid, len(grid), col_count


def extract_table(
    image: Image.Image,
    *,
    detect: TableDetectResult,
    ocr_blocks: Optional[Sequence[OcrBlock]] = None,
    deadline: Optional[float] = None,
    ocr_fn: Optional[Callable[[Image.Image], Tuple[str, Dict[str, Any]]]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Extract a basic table grid.

    Returns (structured_json_patch, flags). Never raises.
    """

    started = _now()
    flags: Dict[str, Any] = {
        "table_detected": bool(detect.detected),
        "grid_detected": bool(detect.grid_detected),
        "used_fallback_clustering": False,
    }

    # Default empty
    table: Dict[str, Any] = {
        "rows": [],
        "confidence": 0.0,
        "method": "grid_lines_v1",
    }

    try:
        img_w, img_h = image.size

        if _deadline_exceeded(deadline):
            flags["time_budget_exceeded"] = True
            table["notes"] = "time_budget_exceeded"
            return {"table": table}, flags

        # Prefer grid slicing when we have enough line positions
        x_lines = _cap_lines(detect.x_lines, cap=60)
        y_lines = _cap_lines(detect.y_lines, cap=80)

        if detect.grid_detected and len(x_lines) >= 3 and len(y_lines) >= 3:
            ocr = ocr_fn or _default_cell_ocr

            rows_out: List[List[str]] = []
            cell_flags: Dict[str, Any] = {}

            # Cap overall cell count
            max_rows = min(len(y_lines) - 1, 40)
            max_cols = min(len(x_lines) - 1, 20)
            pad = 2

            for ri in range(max_rows):
                if _deadline_exceeded(deadline):
                    flags["time_budget_exceeded"] = True
                    break

                top = y_lines[ri]
                bottom = y_lines[ri + 1]
                row_cells: List[str] = []
                for ci in range(max_cols):
                    if _deadline_exceeded(deadline):
                        flags["time_budget_exceeded"] = True
                        break

                    left = x_lines[ci]
                    right = x_lines[ci + 1]

                    cell_img = _crop_cell(image, left + pad, top + pad, right - pad, bottom - pad)
                    txt, f = ocr(cell_img)
                    for k, v in f.items():
                        # Keep last write; these are diagnostic flags.
                        cell_flags[k] = v
                    row_cells.append(txt if txt else "")

                rows_out.append(row_cells)

            if cell_flags:
                flags.update(cell_flags)

            table["rows"] = rows_out
            # Confidence: grid-based is higher; adjust based on intersections
            grid_strength = _clamp01(min(1.0, float(detect.intersections_count) / 4000.0))
            base = 0.65
            if flags.get("time_budget_exceeded"):
                base = 0.45
            table["confidence"] = float(_clamp01(base + 0.25 * grid_strength))
            table["method"] = "grid_lines_v1"
            if flags.get("time_budget_exceeded"):
                table["notes"] = "time_budget_exceeded"

            return {"table": table}, flags

        # Fallback: cluster OCR blocks into a grid
        flags["used_fallback_clustering"] = True
        table["method"] = "ocr_cluster_v1"

        if _deadline_exceeded(deadline):
            flags["time_budget_exceeded"] = True
            table["notes"] = "time_budget_exceeded"
            return {"table": table}, flags

        grid, r, c = _cluster_blocks_to_grid(ocr_blocks or [], img_w=img_w, img_h=img_h)
        table["rows"] = grid
        table["confidence"] = 0.35 if (r > 0 and c > 0) else 0.15
        if not grid:
            table["notes"] = "no_ocr_blocks_for_clustering"
        return {"table": table}, flags

    except Exception as e:
        flags["extraction_error"] = True
        flags["extraction_error_detail"] = str(e)
        table["method"] = "ocr_cluster_v1"
        table["notes"] = "extraction_error"
        table["confidence"] = 0.0
        return {"table": table}, flags
    finally:
        flags["table_elapsed_ms"] = int((_now() - started) * 1000)

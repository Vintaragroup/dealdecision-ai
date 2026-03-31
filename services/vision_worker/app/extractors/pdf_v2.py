from __future__ import annotations

# Text-first PDF extraction — no rasterization, no OCR performed here.
#
# PyMuPDF (fitz) was removed because:
#   1. Its AGPL license creates unacceptable exposure for a commercial product.
#   2. pdfplumber (MIT) covers all extraction needs with equivalent quality.
#   3. PyMuPDF was only ever a fallback for pages where pdfplumber returned empty
#      output; those pages are now handled by a two-attempt pdfplumber strategy.
#
# OCR is conditional, not default. Pages with no extractable native text are
# returned with word_count=0 and the correct image_count so the downstream
# Node.js classifier (needsOcr()) can gate Tesseract OCR appropriately.

import base64
from io import BytesIO
from typing import List, Tuple

import pdfplumber  # MIT licence

from app.models import BBox, PdfV2Block, PdfV2NativePage

# Weak-page thresholds: a page is considered "empty" if it has fewer words or
# characters than these values after extraction.  Downstream OCR classifiers
# apply their own gating — these are used only to decide whether to retry with
# relaxed tolerances.
_MIN_WORDS = 1
_MIN_CHARS = 5

# Relaxed extraction tolerances used on the second attempt.  pdfplumber uses
# x_tolerance / y_tolerance to cluster characters into words and lines.
# Larger values help with tight or unusual character spacing.
_RELAXED_X_TOL = 5.0
_RELAXED_Y_TOL = 5.0


def _safe_norm(n: float) -> float:
    if n != n:  # NaN guard
        return 0.0
    return max(0.0, min(1.0, float(n)))


def _norm_bbox(x0: float, y0: float, x1: float, y1: float, w: float, h: float) -> BBox:
    if w <= 0 or h <= 0:
        return BBox(x=0.0, y=0.0, w=1.0, h=1.0)
    x = _safe_norm(x0 / w)
    y = _safe_norm(y0 / h)
    bw = _safe_norm((x1 - x0) / w)
    bh = _safe_norm((y1 - y0) / h)
    return BBox(x=x, y=y, w=bw, h=bh)


def _extract_words_from_page(
    page: "pdfplumber.page.Page",
    w: float,
    h: float,
    *,
    x_tolerance: float = 3.0,
    y_tolerance: float = 3.0,
) -> List[PdfV2Block]:
    """Return word-level bounding boxes from a pdfplumber page object."""
    blocks: List[PdfV2Block] = []
    try:
        words = page.extract_words(x_tolerance=x_tolerance, y_tolerance=y_tolerance) or []
        for wd in words:
            t = str(wd.get("text") or "").strip()
            if not t:
                continue
            x0 = float(wd.get("x0") or 0.0)
            x1 = float(wd.get("x1") or 0.0)
            top = float(wd.get("top") or 0.0)
            bottom = float(wd.get("bottom") or 0.0)
            blocks.append(PdfV2Block(text=t, bbox=_norm_bbox(x0, top, x1, bottom, w, h)))
    except Exception:
        pass
    return blocks


def _attempt_extraction(
    page: "pdfplumber.page.Page",
    w: float,
    h: float,
    *,
    x_tolerance: float = 3.0,
    y_tolerance: float = 3.0,
) -> Tuple[str, int, List[PdfV2Block]]:
    """Run one text + word-block extraction attempt on an open pdfplumber page."""
    try:
        text = (page.extract_text(x_tolerance=x_tolerance, y_tolerance=y_tolerance) or "").strip()
    except Exception:
        text = ""
    word_count = len(text.split()) if text else 0
    blocks = _extract_words_from_page(page, w, h, x_tolerance=x_tolerance, y_tolerance=y_tolerance)
    return text, word_count, blocks


def _page_is_weak(text: str, word_count: int) -> bool:
    """Return True when extraction yielded too little content to be useful."""
    return word_count < _MIN_WORDS and len(text) < _MIN_CHARS


def extract_pdf_v2_native_pages(*, document_id: str, pdf_b64: str, max_pages: int) -> List[PdfV2NativePage]:
    """Extract native text from PDF pages — text-first, no rasterization.

    Strategy per page:
      1. Extract with pdfplumber at default tolerances.
      2. If the result is empty/weak, retry with relaxed tolerances.
      3. If still empty, return a page with word_count=0 and the real
         image_count.  A page with images and no text will be classified as
         "scanned" by the Node.js needsOcr() function and routed to Tesseract.

    The caller must never infer "good text" from an empty result — empty pages
    are an explicit signal, not a silent failure.
    """
    pdf_bytes = base64.b64decode(pdf_b64)
    limit = max_pages if max_pages and max_pages > 0 else 30
    pages: List[PdfV2NativePage] = []

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            # Page count comes from pdfplumber directly — no secondary library needed.
            page_count = len(pdf.pages)
            if page_count > 0:
                limit = min(limit, page_count)

            for i in range(limit):
                try:
                    page = pdf.pages[i]
                    w = float(page.width or 0.0)
                    h = float(page.height or 0.0)

                    # image_count is always collected so the OCR classifier has
                    # accurate signal even when text extraction returns nothing.
                    image_count = len(page.images or [])

                    # Attempt 1: default tolerances (fast, accurate for most PDFs).
                    text, word_count, blocks = _attempt_extraction(page, w, h)

                    if not _page_is_weak(text, word_count):
                        pages.append(
                            PdfV2NativePage(
                                page_index=i,
                                method="pdfplumber",
                                text=text,
                                word_count=word_count,
                                image_count=image_count,
                                page_width=w,
                                page_height=h,
                                blocks=blocks,
                            )
                        )
                        continue

                    # Attempt 2: relaxed tolerances for PDFs with tight or
                    # non-standard character spacing.
                    text_r, word_count_r, blocks_r = _attempt_extraction(
                        page, w, h,
                        x_tolerance=_RELAXED_X_TOL,
                        y_tolerance=_RELAXED_Y_TOL,
                    )

                    if not _page_is_weak(text_r, word_count_r):
                        pages.append(
                            PdfV2NativePage(
                                page_index=i,
                                method="pdfplumber",
                                text=text_r,
                                word_count=word_count_r,
                                image_count=image_count,
                                page_width=w,
                                page_height=h,
                                blocks=blocks_r,
                            )
                        )
                        continue

                    # Page has no extractable native text.  Return with the
                    # real image_count so the downstream OCR classifier can
                    # route this page to Tesseract if appropriate.
                    pages.append(
                        PdfV2NativePage(
                            page_index=i,
                            method="pdfplumber",
                            text="",
                            word_count=0,
                            image_count=image_count,
                            page_width=w,
                            page_height=h,
                            blocks=[],
                        )
                    )
                except Exception:
                    # Per-page failure: skip this page rather than aborting the
                    # entire document.  The OCR pipeline will handle the gap.
                    continue

    except Exception:
        # PDF could not be opened (malformed, password-protected, truncated).
        # Return whatever pages were collected before the error; callers degrade
        # gracefully to the OCR path.
        pass

    return pages


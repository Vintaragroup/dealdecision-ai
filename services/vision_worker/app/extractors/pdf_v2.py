from __future__ import annotations

import base64
from io import BytesIO
from typing import List, Tuple

from app.models import BBox, PdfV2Block, PdfV2NativePage


def _safe_norm(n: float) -> float:
    if n != n:  # NaN
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


def _extract_page_pdfplumber(pdf_bytes: bytes, page_index: int) -> Tuple[str, int, int, float, float, List[PdfV2Block]]:
    import pdfplumber  # type: ignore

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        if page_index < 0 or page_index >= len(pdf.pages):
            return "", 0, 0, 0.0, 0.0, []
        page = pdf.pages[page_index]
        w = float(page.width or 0.0)
        h = float(page.height or 0.0)

        text = (page.extract_text() or "").strip()
        image_count = len(page.images or [])

        blocks: List[PdfV2Block] = []
        try:
            words = page.extract_words() or []
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
            blocks = []

        return text, len(text.split()), image_count, w, h, blocks


def _extract_page_pymupdf(pdf_bytes: bytes, page_index: int) -> Tuple[str, int, int, float, float, List[PdfV2Block]]:
    import fitz  # type: ignore[import-not-found]  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page_index < 0 or page_index >= doc.page_count:
            return "", 0, 0, 0.0, 0.0, []
        page = doc.load_page(page_index)
        rect = page.rect
        w = float(rect.width or 0.0)
        h = float(rect.height or 0.0)

        text = (page.get_text("text") or "").strip()

        # PyMuPDF doesn't expose images count as directly; count image blocks.
        image_count = 0
        try:
            for b in page.get_text("blocks") or []:
                # blocks: (x0, y0, x1, y1, "text", block_no, block_type)
                if len(b) >= 7 and int(b[6]) == 1:
                    image_count += 1
        except Exception:
            image_count = 0

        blocks: List[PdfV2Block] = []
        try:
            words = page.get_text("words") or []
            for wd in words:
                if len(wd) < 5:
                    continue
                x0, y0, x1, y1, t = wd[0], wd[1], wd[2], wd[3], wd[4]
                t = str(t or "").strip()
                if not t:
                    continue
                blocks.append(PdfV2Block(text=t, bbox=_norm_bbox(float(x0), float(y0), float(x1), float(y1), w, h)))
        except Exception:
            blocks = []

        return text, len(text.split()), image_count, w, h, blocks
    finally:
        doc.close()


def extract_pdf_v2_native_pages(*, document_id: str, pdf_b64: str, max_pages: int) -> List[PdfV2NativePage]:
    pdf_bytes = base64.b64decode(pdf_b64)

    # Use pdfplumber per-page first; fallback to PyMuPDF for pages with empty/malformed output.
    pages: List[PdfV2NativePage] = []

    # Determine page count cheaply with PyMuPDF (fast) to avoid walking pdfplumber twice.
    page_count = 0
    try:
        import fitz  # type: ignore[import-not-found]

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = int(doc.page_count)
        doc.close()
    except Exception:
        page_count = 0

    limit = max_pages if max_pages and max_pages > 0 else 30
    if page_count and page_count > 0:
        limit = min(limit, page_count)

    for i in range(limit):
        try:
            text, word_count, image_count, w, h, blocks = _extract_page_pdfplumber(pdf_bytes, i)
            if word_count <= 0 and len(text.strip()) < 5:
                raise ValueError("empty_native")
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
        except Exception:
            pass

        try:
            text, word_count, image_count, w, h, blocks = _extract_page_pymupdf(pdf_bytes, i)
            pages.append(
                PdfV2NativePage(
                    page_index=i,
                    method="pymupdf",
                    text=text,
                    word_count=word_count,
                    image_count=image_count,
                    page_width=w,
                    page_height=h,
                    blocks=blocks,
                )
            )
        except Exception:
            pages.append(PdfV2NativePage(page_index=i, method="pymupdf", text="", word_count=0, image_count=0))

    return pages

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


AssetType = Literal["chart", "table", "map", "diagram", "image_text", "unknown"]


class BBox(BaseModel):
    """Normalized bounding box.

    Coordinates are normalized to [0, 1] relative to page/image dimensions.
    x,y represent the top-left corner; w,h represent width/height.
    """

    x: float = Field(0.0, ge=0.0, le=1.0)
    y: float = Field(0.0, ge=0.0, le=1.0)
    w: float = Field(1.0, ge=0.0, le=1.0)
    h: float = Field(1.0, ge=0.0, le=1.0)


class ExtractVisualsRequest(BaseModel):
    document_id: str
    page_index: int
    image_uri: str
    extractor_version: str = "vision_v1"


class OcrBlock(BaseModel):
    text: str
    bbox: BBox
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class VisualExtraction(BaseModel):
    ocr_text: Optional[str] = None
    ocr_blocks: List[OcrBlock] = Field(default_factory=list)
    structured_json: Dict[str, Any] = Field(default_factory=dict)
    units: Optional[str] = None
    labels: Dict[str, Any] = Field(default_factory=dict)
    model_version: Optional[str] = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class VisualAsset(BaseModel):
    asset_type: AssetType = "unknown"
    bbox: BBox = Field(default_factory=BBox)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    quality_flags: Dict[str, Any] = Field(default_factory=dict)
    image_uri: Optional[str] = None
    image_hash: Optional[str] = None
    extraction: VisualExtraction = Field(default_factory=VisualExtraction)


class ExtractVisualsResponse(BaseModel):
    document_id: str
    page_index: int
    extractor_version: str
    assets: List[VisualAsset] = Field(default_factory=list)


class ExtractXlsxRequest(BaseModel):
    """Extract structured assets from an XLSX workbook.

    We intentionally use base64-encoded bytes so the Node worker can call this without
    needing a shared filesystem path to the original file.
    """
    document_id: str
    xlsx_b64: str
    extractor_version: str = "excel_py_v1"
    max_sheets: int = Field(default=50, ge=1, le=200)
    max_tables_per_sheet: int = Field(default=24, ge=1, le=200)


class ExtractXlsxResponse(BaseModel):
    document_id: str
    extractor_version: str
    pages: List[ExtractVisualsResponse] = Field(default_factory=list)


# --- PDF Extraction v2 (native text-first) ---


class ExtractPdfV2Request(BaseModel):
    """Extract native text/blocks from a PDF.

    We use base64-encoded bytes so callers don't need a shared filesystem path.
    """

    document_id: str
    pdf_b64: str
    extractor_version: str = "pdf_native_v2"
    max_pages: int = Field(default=30, ge=1, le=200)


class PdfV2Block(BaseModel):
    text: str
    bbox: BBox
    bbox_units: str = "normalized"


class PdfV2NativePage(BaseModel):
    page_index: int
    method: Literal["pdfplumber", "pymupdf"]
    text: str
    word_count: int = 0
    image_count: int = 0
    page_width: float = 0.0
    page_height: float = 0.0
    blocks: List[PdfV2Block] = Field(default_factory=list)


class ExtractPdfV2Response(BaseModel):
    document_id: str
    extractor_version: str
    pages: List[PdfV2NativePage] = Field(default_factory=list)

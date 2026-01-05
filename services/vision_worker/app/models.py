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

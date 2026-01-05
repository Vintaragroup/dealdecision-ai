from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..models import BBox, VisualAsset


def detect_layout_assets(*, extractor_version: str, image_width: int, image_height: int) -> List[VisualAsset]:
    """Layout-lite detection.

    v1 behavior: if no layout model is available, return a single full-page asset of type image_text.
    The bbox is normalized to [0,1].
    """

    _ = (extractor_version, image_width, image_height)

    # Single full-image region.
    return [
        VisualAsset(
            asset_type="image_text",
            bbox=BBox(x=0.0, y=0.0, w=1.0, h=1.0),
            confidence=0.5,
            quality_flags={"layout": "fallback_full_page"},
        )
    ]

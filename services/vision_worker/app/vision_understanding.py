from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image


@dataclass(frozen=True)
class VisionUnderstandingChoice:
    key: str
    display: str
    prompts: Tuple[str, ...]
    segment_hint: Optional[str]


DEFAULT_CHOICES: Tuple[VisionUnderstandingChoice, ...] = (
    VisionUnderstandingChoice(
        key="floor_plan",
        display="Floor plan",
        prompts=(
            "a floor plan",
            "a building floor plan",
            "a residential floor plan",
            "an apartment floor plan",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="site_plan",
        display="Site plan",
        prompts=(
            "a site plan",
            "a property site plan",
            "a plot plan",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="map",
        display="Map",
        prompts=(
            "a map",
            "a geographic map",
            "a location map",
        ),
        segment_hint="market",
    ),
    VisionUnderstandingChoice(
        key="org_chart",
        display="Org chart",
        prompts=(
            "an organization chart",
            "an org chart",
            "a company org chart",
        ),
        segment_hint="team",
    ),
    VisionUnderstandingChoice(
        key="timeline",
        display="Timeline",
        prompts=(
            "a timeline",
            "a project timeline",
        ),
        segment_hint="traction",
    ),
    VisionUnderstandingChoice(
        key="process_diagram",
        display="Process diagram",
        prompts=(
            "a process flow diagram",
            "a workflow diagram",
            "a flowchart",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="architecture_diagram",
        display="Architecture diagram",
        prompts=(
            "a software architecture diagram",
            "a system architecture diagram",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="product_screenshot",
        display="Product screenshot",
        prompts=(
            "a screenshot of a software product",
            "a screenshot of a web application",
            "a screenshot of a mobile app",
            "a dashboard screenshot",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="product_photo",
        display="Product photo",
        prompts=(
            "a photo of a product",
            "a product photo",
            "a packaged consumer product",
        ),
        segment_hint="product",
    ),
    VisionUnderstandingChoice(
        key="logo",
        display="Logo",
        prompts=(
            "a company logo",
            "a brand logo",
        ),
        segment_hint="overview",
    ),
)


_model_cache: Dict[str, Any] = {}


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _safe_mkdir(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass


def _cache_paths(cache_dir: str, image_hash: str) -> Tuple[str, str]:
    safe = "".join(ch for ch in (image_hash or "") if ch.isalnum())
    file_path = os.path.join(cache_dir, f"{safe}.json")
    tmp_path = os.path.join(cache_dir, f"{safe}.tmp.json")
    return file_path, tmp_path


def _load_cache(cache_dir: str, image_hash: str) -> Optional[Dict[str, Any]]:
    if not cache_dir or not image_hash:
        return None
    file_path, _ = _cache_paths(cache_dir, image_hash)
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_cache(cache_dir: str, image_hash: str, payload: Dict[str, Any]) -> None:
    if not cache_dir or not image_hash:
        return
    _safe_mkdir(cache_dir)
    file_path, tmp_path = _cache_paths(cache_dir, image_hash)
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp_path, file_path)
    except Exception:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


def _get_open_clip_bundle():
    # Lazy import + singleton-ish cache.
    cached = _model_cache.get("open_clip_bundle")
    if cached is not None:
        return cached

    try:
        import torch  # type: ignore
        import open_clip  # type: ignore
    except Exception as e:
        _model_cache["open_clip_bundle"] = {"error": f"missing_deps:{e}"}
        return _model_cache["open_clip_bundle"]

    model_name = os.environ.get("VISION_UNDERSTANDING_MODEL", "ViT-B-32").strip() or "ViT-B-32"
    pretrained = os.environ.get("VISION_UNDERSTANDING_PRETRAINED", "laion2b_s34b_b79k").strip() or "laion2b_s34b_b79k"

    device = "cpu"
    try:
        if _bool_env("VISION_UNDERSTANDING_USE_CUDA", False) and torch.cuda.is_available():
            device = "cuda"
    except Exception:
        device = "cpu"

    try:
        model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
        tokenizer = open_clip.get_tokenizer(model_name)
        model.eval()
        model.to(device)
        bundle = {
            "model": model,
            "preprocess": preprocess,
            "tokenizer": tokenizer,
            "device": device,
            "model_name": model_name,
            "pretrained": pretrained,
        }
        _model_cache["open_clip_bundle"] = bundle
        return bundle
    except Exception as e:
        _model_cache["open_clip_bundle"] = {"error": f"init_failed:{e}"}
        return _model_cache["open_clip_bundle"]


def infer_vision_understanding(
    *,
    image: Image.Image,
    image_hash: str,
    enable: bool,
    cache_dir: str,
    min_confidence: float,
    choices: Tuple[VisionUnderstandingChoice, ...] = DEFAULT_CHOICES,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Returns (understanding_json, flags)."""

    flags: Dict[str, Any] = {}

    if not enable:
        flags["vision_understanding"] = "disabled"
        return None, flags

    if not image_hash:
        flags["vision_understanding"] = "missing_image_hash"
        return None, flags

    cached = _load_cache(cache_dir, image_hash)
    if cached and isinstance(cached.get("vision_understanding_v1"), dict):
        flags["vision_understanding"] = "cache_hit"
        return cached, flags

    bundle = _get_open_clip_bundle()
    if isinstance(bundle, dict) and "error" in bundle:
        flags["vision_understanding"] = "unavailable"
        flags["vision_understanding_error"] = bundle.get("error")
        return None, flags

    # Import torch only after we know deps are available.
    import torch  # type: ignore

    model = bundle["model"]
    preprocess = bundle["preprocess"]
    tokenizer = bundle["tokenizer"]
    device = bundle["device"]

    started = time.perf_counter()

    img = image.convert("RGB")
    image_tensor = preprocess(img).unsqueeze(0).to(device)

    # Flatten prompts with metadata for max-per-choice aggregation.
    flat_prompts: List[str] = []
    prompt_choice_idx: List[int] = []
    for i, ch in enumerate(choices):
        for p in ch.prompts:
            flat_prompts.append(p)
            prompt_choice_idx.append(i)

    text_tokens = tokenizer(flat_prompts)
    if hasattr(text_tokens, "to"):
        text_tokens = text_tokens.to(device)

    with torch.no_grad():
        image_features = model.encode_image(image_tensor)
        text_features = model.encode_text(text_tokens)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        logits = (100.0 * image_features @ text_features.T).softmax(dim=-1)

    probs = logits[0].detach().cpu().tolist()

    # Aggregate by choice (max over prompts).
    per_choice: List[float] = [0.0 for _ in choices]
    for p, idx in zip(probs, prompt_choice_idx):
        if p > per_choice[idx]:
            per_choice[idx] = float(p)

    best_idx = int(max(range(len(per_choice)), key=lambda i: per_choice[i]))
    best_prob = float(per_choice[best_idx])
    best = choices[best_idx]

    elapsed_ms = int((time.perf_counter() - started) * 1000)

    if best_prob < float(min_confidence):
        flags["vision_understanding"] = "low_confidence"
        flags["vision_understanding_best"] = best.key
        flags["vision_understanding_confidence"] = best_prob
        flags["vision_understanding_elapsed_ms"] = elapsed_ms
        return None, flags

    payload: Dict[str, Any] = {
        "vision_understanding_v1": {
            "label": best.key,
            "label_display": best.display,
            "confidence": best_prob,
            "title": best.display,
            "segment_hint": best.segment_hint,
            "model": {
                "family": "open_clip",
                "name": bundle.get("model_name"),
                "pretrained": bundle.get("pretrained"),
                "device": device,
            },
            "elapsed_ms": elapsed_ms,
        }
    }

    _save_cache(cache_dir, image_hash, payload)
    flags["vision_understanding"] = "ok"
    flags["vision_understanding_label"] = best.key
    flags["vision_understanding_confidence"] = best_prob
    flags["vision_understanding_elapsed_ms"] = elapsed_ms

    return payload, flags

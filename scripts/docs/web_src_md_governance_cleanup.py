#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
AUDIT_JSON = REPO_ROOT / "artifacts/web_src_markdown_audit.json"
MANIFEST_MD = REPO_ROOT / "docs/DOCS_WEB_SRC_MD_MANIFEST.md"

SRC_PREFIX = "apps/web/src/"


@dataclass(frozen=True)
class Op:
    classification: str
    src: str
    dest: str
    action: str  # MOVE/RENAME/KEEP
    tracked: bool
    notes: str


def _rel_after_src_prefix(src: str) -> str:
    if not src.startswith(SRC_PREFIX):
        raise ValueError(f"Unexpected src path (expected {SRC_PREFIX}*): {src}")
    return src[len(SRC_PREFIX) :]


def _archive_name(filename: str) -> str:
    p = Path(filename)
    return f"{p.stem}.ARCHIVED{p.suffix}"


def compute_dest(src: str, classification: str) -> str:
    rel = _rel_after_src_prefix(src)
    rel_path = Path(rel)

    if classification == "PROMOTE":
        return str(Path("docs/Active/web") / rel_path)

    if classification == "ARCHIVE":
        dest_dir = Path("docs/Archive/web") / rel_path.parent
        dest_name = _archive_name(rel_path.name)
        return str(dest_dir / dest_name)

    if classification == "QUARANTINE":
        return str(Path("docs/Quarantine/UNCLASSIFIED/web_src") / rel_path)

    if classification == "KEEP":
        return ""

    raise ValueError(f"Unknown classification: {classification}")


def compute_action(classification: str) -> str:
    if classification in ("PROMOTE", "QUARANTINE"):
        return "MOVE"
    if classification == "ARCHIVE":
        return "RENAME"
    if classification == "KEEP":
        return "KEEP"
    raise ValueError(f"Unknown classification: {classification}")


def compute_tracked(classification: str) -> bool:
    # Only PROMOTE destinations are meant to be tracked (docs/Active/** allowlisted).
    return classification == "PROMOTE"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(REPO_ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def is_tracked(path: str) -> bool:
    p = git("ls-files", "--error-unmatch", path, check=False)
    return p.returncode == 0


def load_ops() -> List[Op]:
    data = json.loads(AUDIT_JSON.read_text(encoding="utf-8"))
    ops: List[Op] = []
    for row in data.get("rows", []):
        src = row["path"]
        classification = row["classification"]
        dest = compute_dest(src, classification)
        action = compute_action(classification)
        tracked = compute_tracked(classification)

        notes = row.get("reason", "")
        json_dest = row.get("dest")
        if json_dest and dest and json_dest != dest:
            notes = (notes + f" (dest normalized from {json_dest})").strip()

        ops.append(
            Op(
                classification=classification,
                src=src,
                dest=dest,
                action=action,
                tracked=tracked,
                notes=notes,
            )
        )

    # stable ordering: class then src
    class_order = {"PROMOTE": 0, "ARCHIVE": 1, "QUARANTINE": 2, "KEEP": 3}
    ops.sort(key=lambda o: (class_order.get(o.classification, 99), o.src))
    return ops


def write_manifest(ops: List[Op]) -> None:
    MANIFEST_MD.parent.mkdir(parents=True, exist_ok=True)

    lines: List[str] = []
    lines.append("# Web src Markdown Governance Manifest")
    lines.append("")
    lines.append("Source of truth: `artifacts/web_src_markdown_audit.json`.")
    lines.append("")
    lines.append("| src | dest | classification | action | tracked? | notes |")
    lines.append("|---|---|---|---|---|---|")

    for op in ops:
        src = f"[{op.src}]({op.src})"
        dest = f"[{op.dest}]({op.dest})" if op.dest else ""
        tracked = "yes" if op.tracked else "no"
        lines.append(
            "| "
            + " | ".join(
                [
                    src,
                    dest,
                    op.classification,
                    op.action,
                    tracked,
                    op.notes.replace("|", "\\|"),
                ]
            )
            + " |"
        )

    MANIFEST_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def dry_run(ops: List[Op]) -> int:
    print("== Dry-run: counts ==")
    counts: Dict[str, int] = {}
    for op in ops:
        counts[op.classification] = counts.get(op.classification, 0) + 1
    for k in ("PROMOTE", "ARCHIVE", "QUARANTINE", "KEEP"):
        if k in counts:
            print(f"{k}: {counts[k]}")

    print("\n== Dry-run: existence check ==")
    missing: List[str] = []
    already_moved: List[str] = []
    for op in ops:
        if op.action == "KEEP":
            if not (REPO_ROOT / op.src).exists():
                missing.append(op.src)
            continue

        src_exists = (REPO_ROOT / op.src).exists()
        dest_exists = (REPO_ROOT / op.dest).exists() if op.dest else False
        if not src_exists and dest_exists:
            already_moved.append(op.src)
        elif not src_exists and not dest_exists:
            missing.append(op.src)

    if already_moved:
        print(f"Already at destination (src missing, dest present): {len(already_moved)}")
    if missing:
        print(f"Missing (neither src nor dest present): {len(missing)}")
        for p in missing[:25]:
            print(f"- {p}")

    print("\n== Dry-run: collision check ==")
    collisions: List[Tuple[str, str]] = []
    for op in ops:
        if op.action == "KEEP":
            continue
        src_p = REPO_ROOT / op.src
        dest_p = REPO_ROOT / op.dest
        if src_p.exists() and dest_p.exists():
            try:
                if sha256(src_p) != sha256(dest_p):
                    collisions.append((op.src, op.dest))
            except Exception:
                collisions.append((op.src, op.dest))

    if collisions:
        print(f"COLLISIONS FOUND: {len(collisions)}")
        for src, dest in collisions[:25]:
            print(f"- {src} -> {dest}")
    else:
        print("No collisions detected.")

    print("\n== Dry-run: first 25 ops per class ==")
    by_class: Dict[str, List[Op]] = {}
    for op in ops:
        by_class.setdefault(op.classification, []).append(op)

    for cls in ("PROMOTE", "ARCHIVE", "QUARANTINE", "KEEP"):
        if cls not in by_class:
            continue
        print(f"\n-- {cls} --")
        for op in by_class[cls][:25]:
            if op.action == "KEEP":
                print(f"KEEP {op.src}")
            else:
                print(f"{op.action} {op.src} -> {op.dest}")

    # Non-zero exit for hard issues
    if missing or collisions:
        return 2
    return 0


def ensure_parent_dir(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)


def apply_ops(ops: List[Op]) -> Dict[str, int]:
    counts = {"promote": 0, "archive": 0, "quarantine": 0, "keep": 0, "skipped": 0}

    # Hard-stop on collisions (protect against overwriting)
    for op in ops:
        if op.action == "KEEP":
            continue
        src_p = REPO_ROOT / op.src
        dest_p = REPO_ROOT / op.dest
        if src_p.exists() and dest_p.exists():
            if sha256(src_p) != sha256(dest_p):
                raise RuntimeError(f"Collision: {op.src} and {op.dest} both exist and differ")

    for op in ops:
        if op.action == "KEEP":
            counts["keep"] += 1
            continue

        src_p = REPO_ROOT / op.src
        dest_p = REPO_ROOT / op.dest

        # If already moved, skip.
        if not src_p.exists() and dest_p.exists():
            counts["skipped"] += 1
            continue

        if not src_p.exists():
            raise FileNotFoundError(f"Source missing: {op.src}")

        ensure_parent_dir(dest_p)

        if op.classification == "PROMOTE":
            if is_tracked(op.src):
                git("mv", op.src, op.dest)
            else:
                shutil.move(str(src_p), str(dest_p))
                git("add", op.dest)
            counts["promote"] += 1

        elif op.classification == "ARCHIVE":
            # Always filesystem moves to ignored destinations.
            shutil.move(str(src_p), str(dest_p))
            counts["archive"] += 1

        elif op.classification == "QUARANTINE":
            shutil.move(str(src_p), str(dest_p))
            counts["quarantine"] += 1

        else:
            raise ValueError(f"Unexpected op classification: {op.classification}")

    return counts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if not AUDIT_JSON.exists():
        raise SystemExit(f"Missing audit json: {AUDIT_JSON}")

    ops = load_ops()
    write_manifest(ops)

    rc = dry_run(ops)
    if args.dry_run and not args.apply:
        return rc

    if args.apply:
        if rc != 0:
            raise SystemExit("Refusing to apply because dry-run found missing files or collisions.")
        counts = apply_ops(ops)
        print("\n== Apply summary ==")
        for k, v in counts.items():
            print(f"{k}: {v}")
        return 0

    # default behavior: dry-run only
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

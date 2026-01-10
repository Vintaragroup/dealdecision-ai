#!/usr/bin/env python3

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class MoveOp:
    src: str
    dest: str
    method: str  # git-mv | mv


def is_git_tracked(repo: Path, rel_path: str) -> bool:
    try:
        subprocess.check_output(
            ["git", "-C", repo.as_posix(), "ls-files", "--error-unmatch", rel_path],
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def do_move(repo: Path, src_rel: str, dest_rel: str, ops: List[MoveOp]) -> None:
    src = repo / src_rel
    dest = repo / dest_rel
    ensure_parent(dest)

    if is_git_tracked(repo, src_rel):
        subprocess.run(["git", "-C", repo.as_posix(), "mv", src_rel, dest_rel], check=True)
        ops.append(MoveOp(src=src_rel, dest=dest_rel, method="git-mv"))
        return

    # filesystem move
    if dest.exists():
        raise FileExistsError(dest_rel)
    src.replace(dest)
    ops.append(MoveOp(src=src_rel, dest=dest_rel, method="mv"))


def archive_target(rel_path: str) -> str:
    if rel_path.endswith(".md"):
        return rel_path[:-3] + ".ARCHIVED.md"
    if rel_path.endswith(".mdc"):
        return rel_path[:-4] + ".ARCHIVED.mdc"
    return rel_path


def uniquify_path(repo: Path, rel_path: str) -> str:
    # If rel_path exists, append -2, -3, etc before extension
    p = Path(rel_path)
    stem = p.stem
    suffix = "".join(p.suffixes)
    parent = p.parent.as_posix()

    for i in range(2, 1000):
        cand_name = f"{stem}-{i}{suffix}"
        cand = f"{parent}/{cand_name}" if parent else cand_name
        if not (repo / cand).exists():
            return cand
    raise RuntimeError(f"Unable to uniquify path: {rel_path}")


def delete_os_junk(repo: Path) -> int:
    count = 0
    for p in (repo / "docs").rglob(".DS_Store"):
        if p.is_file():
            p.unlink()
            count += 1
    return count


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    docs = repo / "docs"

    # Step 2: Archive rename normalization
    rename_ops: List[MoveOp] = []
    rename_count = 0

    for p in sorted((docs / "Archive").rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(repo).as_posix()
        if not (rel.endswith(".md") or rel.endswith(".mdc")):
            continue
        if ".ARCHIVED." in p.name:
            continue

        target = archive_target(rel)
        if (repo / target).exists():
            target = uniquify_path(repo, target)

        do_move(repo, rel, target, rename_ops)
        rename_count += 1

    # Step 3: Unclassified quarantine
    # Keep these at docs root (explicit exception / curated):
    root_exceptions = {
        "docs/DOCS_CLEANUP_MANIFEST.md",
    }

    tier_prefixes = ("docs/Active/", "docs/Archive/", "docs/Quarantine/")
    quarantine_ops: List[MoveOp] = []
    quarantined_count = 0

    docs_files: List[str] = []
    for p in docs.rglob("*"):
        if p.is_file():
            docs_files.append(p.relative_to(repo).as_posix())

    outside_tiers = [p for p in docs_files if not p.startswith(tier_prefixes) and p not in root_exceptions]

    for src_rel in sorted(outside_tiers):
        # Ignore OS junk; we delete those separately
        if src_rel.endswith("/.DS_Store") or src_rel == "docs/.DS_Store":
            continue

        rel_under_docs = src_rel[len("docs/") :]
        dest_rel = f"docs/Quarantine/UNCLASSIFIED/{rel_under_docs}"
        if (repo / dest_rel).exists():
            dest_rel = uniquify_path(repo, dest_rel)

        do_move(repo, src_rel, dest_rel, quarantine_ops)
        quarantined_count += 1

    deleted_os_junk_count = delete_os_junk(repo)

    print("SUMMARY")
    print(f"renamed_count={rename_count}")
    print(f"quarantined_count={quarantined_count}")
    print(f"deleted_os_junk_count={deleted_os_junk_count}")

    # Persist operations for inspection
    out = repo / "artifacts" / "docs_triage" / "docs_cleanup_hybrid_ops.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    lines.append("ARCHIVE RENAMES\n")
    for op in rename_ops:
        lines.append(f"{op.method}: {op.src} -> {op.dest}\n")
    lines.append("\nUNCLASSIFIED QUARANTINE MOVES\n")
    for op in quarantine_ops:
        lines.append(f"{op.method}: {op.src} -> {op.dest}\n")
    out.write_text("".join(lines), encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

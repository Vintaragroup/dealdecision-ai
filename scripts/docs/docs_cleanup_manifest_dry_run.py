#!/usr/bin/env python3

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple


@dataclass(frozen=True)
class ManifestRow:
    src: str
    dest: str
    classification: str
    reason: str


def parse_manifest(manifest_path: Path) -> List[ManifestRow]:
    lines = manifest_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    rows: List[ManifestRow] = []
    for line in lines:
        if not line.startswith("|docs/"):
            continue
        parts = line.strip().strip("|").split("|")
        if len(parts) < 4:
            continue
        rows.append(
            ManifestRow(
                src=parts[0].strip(),
                dest=parts[1].strip(),
                classification=parts[2].strip(),
                reason=parts[3].strip(),
            )
        )
    return rows


def list_files(repo: Path, root: str) -> List[str]:
    base = repo / root
    out: List[str] = []
    for p in base.rglob("*"):
        if p.is_file():
            out.append(p.relative_to(repo).as_posix())
    return sorted(out)


def git_ls_files(repo: Path, paths: List[str]) -> List[str]:
    if not paths:
        return []
    try:
        out = subprocess.check_output(["git", "-C", repo.as_posix(), "ls-files", "--"] + paths, text=True)
        return [ln.strip() for ln in out.splitlines() if ln.strip()]
    except Exception:
        return []


def git_is_ignored(repo: Path, path: str) -> bool:
    try:
        subprocess.check_output(["git", "-C", repo.as_posix(), "check-ignore", "-q", path])
        return True
    except subprocess.CalledProcessError:
        return False


def archive_rename_target(path: str) -> str:
    # Insert .ARCHIVED before the final extension
    if path.endswith(".md"):
        return path[:-3] + ".ARCHIVED.md"
    if path.endswith(".mdc"):
        return path[:-4] + ".ARCHIVED.mdc"
    return path


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    manifest_path = repo / "docs" / "DOCS_CLEANUP_MANIFEST.md"

    rows = parse_manifest(manifest_path)
    manifest_moves = [(r.src, r.dest, r.classification, r.reason) for r in rows]

    # Current docs inventory
    docs_files = list_files(repo, "docs")
    tier_prefixes = ("docs/Active/", "docs/Archive/", "docs/Quarantine/")
    root_exceptions = {
        "docs/DOCS_CLEANUP_MANIFEST.md",
    }
    outside_tiers = sorted(
        [p for p in docs_files if not p.startswith(tier_prefixes) and p not in root_exceptions]
    )

    # Detect which manifest moves still needed (src exists, dest missing)
    missing_src: List[str] = []
    already_at_dest: List[str] = []
    needs_move: List[Tuple[str, str]] = []
    both_exist: List[Tuple[str, str]] = []
    for src, dest, _, _ in manifest_moves:
        src_path = repo / src
        dest_path = repo / dest
        # If this is an Archive row, consider the post-normalization .ARCHIVED name as satisfied.
        archive_dest = archive_rename_target(dest)
        archive_dest_path = repo / archive_dest

        if dest_path.exists() and not src_path.exists():
            already_at_dest.append(dest)
            continue
        if archive_dest != dest and archive_dest_path.exists() and not src_path.exists():
            already_at_dest.append(archive_dest)
            continue
        if src_path.exists() and not dest_path.exists():
            needs_move.append((src, dest))
            continue
        if src_path.exists() and archive_dest != dest and not dest_path.exists() and not archive_dest_path.exists():
            needs_move.append((src, dest))
            continue
        if src_path.exists() and dest_path.exists():
            both_exist.append((src, dest))
            continue
        if not src_path.exists() and not dest_path.exists() and not archive_dest_path.exists():
            missing_src.append(src)

    # Archive renames
    archive_files = [p for p in docs_files if p.startswith("docs/Archive/") and p.endswith((".md", ".mdc"))]
    to_rename: List[Tuple[str, str]] = []
    rename_collisions: List[Tuple[str, str]] = []
    for p in archive_files:
        name = Path(p).name
        if ".ARCHIVED." in name:
            continue
        target = archive_rename_target(p)
        if target == p:
            continue
        if (repo / target).exists():
            rename_collisions.append((p, target))
        else:
            to_rename.append((p, target))

    # Git tracking feasibility
    tracked_sample = git_ls_files(repo, ["docs/scoring-and-evidence.md", "docs/runbook-debugging.md", "docs/trace_audit/ROLLUP.md"])

    ignored_outside = [p for p in outside_tiers if git_is_ignored(repo, p)]

    report = {
        "manifest_total": len(manifest_moves),
        "manifest_needs_move": len(needs_move),
        "manifest_already_at_dest": len(already_at_dest),
        "manifest_both_exist": len(both_exist),
        "manifest_missing": len(missing_src),
        "archive_files_total": len(archive_files),
        "archive_rename_needed": len(to_rename),
        "archive_rename_collisions": len(rename_collisions),
        "outside_tiers_total": len(outside_tiers),
        "outside_tiers_ignored_total": len(ignored_outside),
        "tracked_samples": tracked_sample,
    }

    # Print a dry-run checklist (bounded)
    print("# DRY RUN — docs cleanup (manifest-driven)\n")

    print("## A) Manifest moves (src → dest)")
    print(f"- Total manifest rows: {len(manifest_moves)}")
    print(f"- Already satisfied (dest exists): {len(already_at_dest)}")
    print(f"- Still needs move: {len(needs_move)}")
    print(f"- Conflicts (both src+dest exist): {len(both_exist)}")
    print(f"- Missing (neither exists): {len(missing_src)}\n")

    if needs_move:
        print("First 25 moves still needed:")
        for src, dest in needs_move[:25]:
            print(f"- {src} -> {dest}")
        if len(needs_move) > 25:
            print(f"- … ({len(needs_move)-25} more)")
        print("")

    if both_exist:
        print("Conflicts (src and dest both exist):")
        for src, dest in both_exist[:25]:
            print(f"- {src} vs {dest}")
        if len(both_exist) > 25:
            print(f"- … ({len(both_exist)-25} more)")
        print("")

    if missing_src:
        print("Missing manifest sources (neither src nor dest exists):")
        for src in missing_src[:25]:
            print(f"- {src}")
        if len(missing_src) > 25:
            print(f"- … ({len(missing_src)-25} more)")
        print("")

    print("## B) Archive `.ARCHIVED` renames")
    print(f"- Archive markdown/mdc files found: {len(archive_files)}")
    print(f"- Renames needed: {len(to_rename)}")
    print(f"- Collisions: {len(rename_collisions)}\n")

    if to_rename:
        print("First 25 archive renames:")
        for src, dest in to_rename[:25]:
            print(f"- {src} -> {dest}")
        if len(to_rename) > 25:
            print(f"- … ({len(to_rename)-25} more)")
        print("")

    if rename_collisions:
        print("Archive rename collisions:")
        for src, dest in rename_collisions[:25]:
            print(f"- {src} -> {dest} (already exists)")
        if len(rename_collisions) > 25:
            print(f"- … ({len(rename_collisions)-25} more)")
        print("")

    print("## C) UNCLASSIFIED (outside tier folders)")
    print(f"- Files outside docs/(Active|Archive|Quarantine): {len(outside_tiers)}")
    print(f"- Of those, ignored-by-git: {len(ignored_outside)}")
    if outside_tiers:
        print("First 30 outside-tier paths:")
        for p in outside_tiers[:30]:
            print(f"- {p}")
        if len(outside_tiers) > 30:
            print(f"- … ({len(outside_tiers)-30} more)")
    print("")

    print("## D) HARD CONFLICT: git tracking")
    print("- This repo ignores most of docs/** via .gitignore, so those files are not under version control.")
    print("- `git mv` only works for tracked files; most docs are currently ignored/untracked.")
    print("- Tracked docs sample (from git ls-files):")
    for p in tracked_sample:
        print(f"  - {p}")
    print("")

    # Also emit machine-readable plan
    Path("/tmp/docs_cleanup_dry_run.json").write_text(
        json.dumps(
            {
                "report": report,
                "needs_move": needs_move,
                "archive_renames": to_rename,
                "outside_tiers": outside_tiers,
                "missing_manifest": missing_src,
                "both_exist": both_exist,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

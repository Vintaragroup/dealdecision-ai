#!/usr/bin/env python3

import csv
import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


@dataclass(frozen=True)
class AuditRow:
    src: str
    classification: str
    reason: str


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def run(cmd: List[str]) -> None:
    subprocess.run(cmd, check=True)


def is_git_repo(repo: Path) -> bool:
    try:
        out = subprocess.check_output([
            "git",
            "-C",
            repo.as_posix(),
            "rev-parse",
            "--is-inside-work-tree",
        ], text=True).strip()
        return out.lower() == "true"
    except Exception:
        return False


def is_git_tracked(repo: Path, path: str) -> bool:
    try:
        subprocess.check_output([
            "git",
            "-C",
            repo.as_posix(),
            "ls-files",
            "--error-unmatch",
            path,
        ], stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def parse_triage_table(triage_path: Path) -> List[AuditRow]:
    lines = triage_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    rows: List[AuditRow] = []

    for line in lines:
        if not line.startswith("|["):
            continue
        parts = line.strip().strip("|").split("|")
        if len(parts) < 9:
            continue

        file_cell = parts[0].strip()
        m = re.match(r"\[(?P<disp>[^\]]+)\]\((?P<href>[^\)]+)\)", file_cell)
        if not m:
            continue

        src = m.group("disp").strip()
        classification = parts[7].strip()
        reason = parts[8].strip()

        rows.append(AuditRow(src=src, classification=classification, reason=reason))

    return rows


def list_repo_files_under(repo: Path, subdir: str) -> List[str]:
    root = repo / subdir
    out: List[str] = []
    for p in root.rglob("*"):
        if p.is_file():
            out.append(p.relative_to(repo).as_posix())
    return sorted(out)


def ensure_dirs(repo: Path) -> None:
    for d in (repo / "docs" / "Active", repo / "docs" / "Archive", repo / "docs" / "Quarantine"):
        d.mkdir(parents=True, exist_ok=True)


def write_unclassified(repo: Path, unclassified: List[str]) -> Path:
    out_path = repo / "docs" / "UNCLASSIFIED_DOCS.md"
    lines: List[str] = ["# Unclassified docs\n", "\n", "The following files exist under /docs but are not present in the audit table.\n", "\n"]
    for p in unclassified:
        lines.append(f"- {p}\n")
    out_path.write_text("".join(lines), encoding="utf-8")
    return out_path


def write_manifest(repo: Path, moves: List[Tuple[str, str, str, str]]) -> Path:
    out_path = repo / "docs" / "DOCS_CLEANUP_MANIFEST.md"
    header = [
        "|Original path|New path|Classification|Audit reason|\n",
        "|---|---|---|---|\n",
    ]
    lines: List[str] = ["# Docs cleanup manifest\n", "\n"] + header
    for src, dest, classification, reason in moves:
        lines.append(f"|{src}|{dest}|{classification}|{reason}|\n")
    out_path.write_text("".join(lines), encoding="utf-8")
    return out_path


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    docs_dir = repo / "docs"
    triage_path = repo / "artifacts" / "docs_triage" / "docs_triage_table_ultra.md"

    git_available = is_git_repo(repo)

    if not triage_path.exists():
        print(f"Missing triage table: {triage_path}", file=sys.stderr)
        return 2

    audit_rows = parse_triage_table(triage_path)
    triage_map: Dict[str, AuditRow] = {r.src: r for r in audit_rows}

    # Step 1: Unclassified files = anything currently under docs/ not in triage table.
    docs_files_pre = list_repo_files_under(repo, "docs")

    # Exclude the required tier folders if they already exist (their contents are handled separately)
    excluded_prefixes = (
        "docs/Active/",
        "docs/Archive/",
        "docs/Quarantine/",
    )
    docs_files_pre_filtered = [p for p in docs_files_pre if not p.startswith(excluded_prefixes)]

    unclassified = sorted([p for p in docs_files_pre_filtered if p not in triage_map])

    # Step 2: Ensure required folder structure.
    ensure_dirs(repo)

    # Snapshot hashes before move for audited files.
    pre_hashes: Dict[str, str] = {}
    missing_sources: List[str] = []

    for src in sorted(triage_map.keys()):
        src_path = repo / src
        if not src_path.exists():
            missing_sources.append(src)
            continue
        pre_hashes[src] = sha256_file(src_path)

    if missing_sources:
        print("ERROR: Some audited sources are missing before move:")
        for m in missing_sources:
            print(f"- {m}")
        return 3

    # Step 2: Move audited docs according to triage. Preserve subfolders under docs/.
    moves: List[Tuple[str, str, str, str]] = []
    moved_counts = {"Active": 0, "Archive": 0, "Quarantine": 0}

    for src in sorted(triage_map.keys()):
        row = triage_map[src]
        if row.classification not in ("Active", "Archive", "Quarantine"):
            print(f"ERROR: Unexpected classification for {src}: {row.classification}", file=sys.stderr)
            return 4

        if not src.startswith("docs/"):
            # The audit table should only include docs/*
            print(f"ERROR: Audited path does not start with docs/: {src}", file=sys.stderr)
            return 5

        rel_inside_docs = src[len("docs/") :]
        dest = f"docs/{row.classification}/{rel_inside_docs}"

        src_path = repo / src
        dest_path = repo / dest

        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Use git mv for traceable history. If already moved (idempotent runs), skip.
        if dest_path.exists() and not src_path.exists():
            moves.append((src, dest, row.classification, row.reason))
            continue

        if not src_path.exists():
            print(f"ERROR: Source missing at move time: {src}", file=sys.stderr)
            return 6

        if git_available and is_git_tracked(repo, src):
            run(["git", "mv", src, dest])
        else:
            # Fallback for untracked files or non-git environments: move on filesystem.
            src_path.replace(dest_path)
        moves.append((src, dest, row.classification, row.reason))
        moved_counts[row.classification] += 1

    # Step 3: Write required outputs.
    unclassified_path = write_unclassified(repo, unclassified)
    manifest_path = write_manifest(repo, moves)

    # Step 4: Hash sanity check (content unchanged for moved audited docs).
    hash_mismatches: List[Tuple[str, str, str]] = []
    for src, dest, _, _ in moves:
        before = pre_hashes.get(src)
        after = sha256_file(repo / dest)
        if before != after:
            hash_mismatches.append((src, dest, f"{before} != {after}"))

    modified: List[str] = []
    if git_available:
        # Confirm git sees no content modifications (renames/adds/deletes only).
        diff_name_status = (
            subprocess.check_output(["git", "diff", "--name-status"], text=True)
            .strip()
            .splitlines()
        )
        modified = [ln for ln in diff_name_status if ln and not ln.startswith(("R", "A", "D"))]

    print("RESULTS")
    print(f"- moved_active={moved_counts['Active']}")
    print(f"- moved_archive={moved_counts['Archive']}")
    print(f"- moved_quarantine={moved_counts['Quarantine']}")
    print(f"- unclassified_count={len(unclassified)}")
    print(f"- wrote_manifest={manifest_path.relative_to(repo).as_posix()}")
    print(f"- wrote_unclassified={unclassified_path.relative_to(repo).as_posix()}")
    print(f"- hash_mismatch_count={len(hash_mismatches)}")
    print(f"- git_modified_non_rename_count={len(modified)}")

    if hash_mismatches:
        print("HASH MISMATCHES")
        for src, dest, msg in hash_mismatches[:20]:
            print(f"- {src} -> {dest}: {msg}")
        return 7

    if modified:
        print("UNEXPECTED GIT CHANGES")
        for ln in modified[:50]:
            print(f"- {ln}")
        return 8

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

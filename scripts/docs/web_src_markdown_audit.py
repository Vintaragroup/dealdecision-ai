#!/usr/bin/env python3

import argparse
import dataclasses
import datetime as dt
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Iterable, List, Optional, Tuple


def _run_rg(args: List[str]) -> Tuple[int, str]:
    p = subprocess.run(
        ["rg", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    return p.returncode, p.stdout


def _rg_lines(args: List[str]) -> List[str]:
    code, out = _run_rg(args)
    if code != 0:
        return []
    return [ln for ln in out.splitlines() if ln.strip()]


def _safe_read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _file_title_and_desc(text: str, max_lines: int = 16) -> Tuple[str, str]:
    lines = [ln.strip() for ln in text.splitlines()]
    nonempty = [ln for ln in lines if ln]

    title = "(no title)"
    for ln in nonempty[:max_lines]:
        if ln.startswith("#"):
            title = ln.lstrip("#").strip()
            break

    if title == "(no title)" and nonempty:
        title = nonempty[0][:140]

    desc_parts: List[str] = []
    for ln in nonempty[:max_lines]:
        if ln.startswith("#"):
            continue
        if ln.startswith(">") or ln.startswith("-") or ln.startswith("*"):
            desc_parts.append(ln)
        elif ln and ln[0].isalnum():
            desc_parts.append(ln)
        if len(desc_parts) >= 2:
            break

    desc = " | ".join(desc_parts)[:280]
    return title, desc


def _glob_markdown_files(root: Path) -> List[Path]:
    exts = {".md", ".mdx", ".mdc"}
    out: List[Path] = []
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in exts:
            out.append(p)
    return sorted(out)


def _ref_hits(repo_root: Path, file_rel: str) -> List[str]:
    """Find up to 12 references to this doc from code/content.

    We search by basename and stem. We exclude the doc file itself.
    """

    p = Path(file_rel)
    base = p.name
    stem = p.stem

    hits: List[str] = []

    def add_hits(q: str) -> None:
        nonlocal hits
        if not q or q == ".":
            return
        lines = _rg_lines(
            [
                "-n",
                "--hidden",
                "--glob",
                "!.next/**",
                "--glob",
                "!dist/**",
                "--glob",
                "!build/**",
                "--glob",
                "!node_modules/**",
                q,
                str(repo_root / "apps/web/src"),
            ]
        )
        for ln in lines:
            if ln.startswith(file_rel + ":"):
                continue
            hits.append(ln)
            if len(hits) >= 12:
                return

    add_hits(base)
    if len(hits) < 12:
        add_hits(stem)

    return hits[:12]


def _is_component_readme(path: Path) -> bool:
    if path.name.lower() != "readme.md":
        return False
    # Conservative: keep README.md when it's inside a component-ish folder.
    parts = [p.lower() for p in path.parts]
    return "components" in parts or "component" in parts


def _likely_status_artifact(title: str, desc: str, rel: str) -> bool:
    low = f"{title} {desc} {rel}".lower()
    keys = (
        "complete",
        "completed",
        "final tasks",
        "task list",
        "tasks",
        "restore point",
        "review summary",
        "improvements",
        "enhancement",
        "remaining",
        "phase1_",
        "phase 1",
    )
    return any(k in low for k in keys)


def _dup_risk_notes(text: str) -> List[str]:
    low = text.lower()
    notes: List[str] = []
    if "evidence" in low and "score" in low:
        notes.append("Duplicates scoring/evidence themes")
    if "runbook" in low or "debug" in low:
        notes.append("Duplicates runbook/debug themes")
    if "active" in low and "archive" in low and "quarantine" in low:
        notes.append("Duplicates docs governance themes")
    return notes


def _infer_classification(
    path: Path,
    rel: str,
    title: str,
    desc: str,
    text: str,
    ref_lines: List[str],
) -> Tuple[str, str, str]:
    """Return (classification, reason, proposed_dest_rel)."""

    if _is_component_readme(path):
        return "KEEP", "Component-scoped README; keep next to UI code.", ""

    nonempty = [ln for ln in text.splitlines() if ln.strip()]
    if len(nonempty) < 6:
        dest = f"docs/Quarantine/UNCLASSIFIED/web_src/{path.name}"
        return "QUARANTINE", "Too short/unclear; treat as unclassified.", dest

    # If something is referenced as an import or dependency, lean KEEP.
    if ref_lines:
        import_like = any(re.search(r"\bfrom\s+['\"]|\bimport\s+['\"]", h) for h in ref_lines)
        if import_like:
            return "KEEP", "Referenced by code/import; keep near code.", ""

    if _likely_status_artifact(title, desc, rel):
        dest = f"docs/Archive/web/{path.name}"
        return "ARCHIVE", "Status/notes artifact; keep for history but not canonical.", dest

    # Default: promote cross-cutting product/process docs into curated docs.
    dest = f"docs/Active/web/{rel.split('apps/web/src/', 1)[1]}"
    return "PROMOTE", "Cross-cutting UI/process doc; better as curated canonical docs.", dest


@dataclasses.dataclass
class AuditRow:
    path: str
    size_bytes: int
    mtime: str
    title: str
    desc: str
    ref_count: int
    refs: List[str]
    classification: str
    reason: str
    dest: str
    notes: List[str]


def _format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n/1024:.1f} KB"
    return f"{n/(1024*1024):.1f} MB"


def _md_escape(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--src-root", default="apps/web/src")
    ap.add_argument("--out-json", default="artifacts/web_src_markdown_audit.json")
    ap.add_argument("--out-md", default="artifacts/web_src_markdown_audit.md")
    args = ap.parse_args()

    repo_root = Path(args.repo_root).resolve()
    src_root = (repo_root / args.src_root).resolve()

    files = _glob_markdown_files(src_root)

    rows: List[AuditRow] = []
    for path in files:
        rel = str(path.relative_to(repo_root))
        st = path.stat()
        size = st.st_size
        mtime = dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")

        text = _safe_read_text(path)
        title, desc = _file_title_and_desc(text)

        refs = _ref_hits(repo_root, rel)
        classification, reason, dest = _infer_classification(path, rel, title, desc, text, refs)

        notes = _dup_risk_notes(text)
        if refs:
            notes.append(f"Referenced in src ({len(refs)} hits sampled)")

        rows.append(
            AuditRow(
                path=rel,
                size_bytes=size,
                mtime=mtime,
                title=title,
                desc=desc,
                ref_count=len(refs),
                refs=refs,
                classification=classification,
                reason=reason,
                dest=dest,
                notes=notes,
            )
        )

    out_json = repo_root / args.out_json
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"rows": [dataclasses.asdict(r) for r in rows]}, indent=2), encoding="utf-8")

    out_md = repo_root / args.out_md
    out_md.parent.mkdir(parents=True, exist_ok=True)

    header = [
        "# apps/web/src Markdown Audit",
        "",
        f"Scanned root: `{args.src-root if False else args.src_root}`",
        f"Files found: **{len(rows)}**",
        "",
        "## Classification Table",
        "",
        "| File | Title | Size | mtime | Refs | Class | Proposed destination | Notes |",
        "|---|---|---:|---|---:|---|---|---|",
    ]

    lines = header
    for r in rows:
        file_link = f"[{r.path}]({r.path})"
        dest = r.dest and f"[{r.dest}]({r.dest})" or ""
        notes = "; ".join(r.notes)
        lines.append(
            "| "
            + " | ".join(
                [
                    file_link,
                    _md_escape(r.title),
                    _format_bytes(r.size_bytes),
                    _md_escape(r.mtime),
                    str(r.ref_count),
                    r.classification,
                    dest,
                    _md_escape(notes),
                ]
            )
            + " |"
        )

    lines += [
        "",
        "## Per-file Reference Samples",
        "",
    ]

    for r in rows:
        lines.append(f"### [{r.path}]({r.path})")
        lines.append(f"- Proposed: **{r.classification}** — {r.reason}")
        if r.dest:
            lines.append(f"- Dest: [{r.dest}]({r.dest})")
        if r.refs:
            lines.append("- Reference hits (sample):")
            for h in r.refs:
                lines.append(f"  - {h}")
        else:
            lines.append("- Reference hits (sample): (none found)")
        lines.append("")

    out_md.write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {args.out_json} ({len(rows)} rows)")
    print(f"Wrote {args.out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

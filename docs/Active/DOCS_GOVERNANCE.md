# Docs Governance (Active / Archive / Quarantine)

This repo intentionally keeps most documentation and artifacts OUT of git.
Only curated, human-readable docs live in `docs/Active/` and are allowed to be committed.

## Folder meanings

### docs/Active/
**Canonical, curated docs** we want in git.
Rules:
- Allowed: `.md`, `.mdc`, `.mdx`, `.txt`
- Not allowed (never commit): binaries like `.pdf`, `.pptx`, `.xlsx`, images, zips
- Keep files current; edit or replace as the system changes

### docs/Archive/
**Outdated but potentially useful** historical docs.
Rules:
- Files should be renamed with `.ARCHIVED` in the filename:
  - Example: `SomeDoc.ARCHIVED.md`
- Archive stays ignored by git (by design)

### docs/Quarantine/
**Unclassified or suspicious** docs/artifacts.
Rules:
- Anything not clearly Active or Archive goes here
- Keep subpaths to preserve origin context
- Quarantine stays ignored by git (by design)

## How to classify a doc

Put in **Active** if:
- It describes current behavior or current workflow
- It is referenced by engineers during active development
- It reflects the current architecture or interfaces

Put in **Archive** if:
- It was accurate historically but no longer matches the system
- It’s superseded by newer docs
- It contains old prompts / old plans / old implementation summaries

Put in **Quarantine** if:
- You don’t know what it is
- It’s a generated artifact (export, dump, report)
- It’s a binary or large file
- It was pulled from outside sources and needs review

## Copilot rules for docs changes
When changing docs:
- Never move binaries into `docs/Active`
- Never expand `.gitignore` to include docs/Deals or binary types
- Prefer adding/updating one canonical Active doc over many partial docs
- If unsure, move to Quarantine and add a note in the PR description

## Canonical docs list (should remain small)
- `docs/Active/DOCS_GOVERNANCE.md`
- `docs/scoring-and-evidence.md`
- `docs/runbook-debugging.md`
- `docs/trace_audit/ROLLUP.md`

## Archiving workflow
When archiving:
1) Move file into `docs/Archive/...`
2) Rename to include `.ARCHIVED` before extension
3) (Optional) Add a short pointer in an Active doc if the archived item is relevant context
---
applyTo: "**/*"
---

# Docs Governance Instructions

Use docs/DOCS_GOVERNANCE_INDEX.md first.

## Authority order

Treat documentation authority in this order:

1. docs/Foundation/
2. docs/Supporting/
3. docs/Archive/ (historical only)
4. docs/Quarantine/ (unsafe unless explicitly verified)

Foundation docs are the current authoritative source of truth.

Archive and Quarantine are not valid current-state references for implementation unless the task explicitly asks for historical investigation or verification.

## Required behavior

When using docs to guide implementation:
- consult Foundation docs first
- use Supporting docs only when they do not conflict with Foundation
- treat Archive as historical context only
- treat Quarantine as unsafe unless explicitly verified against code

If a non-Foundation doc conflicts with a Foundation doc, prefer the Foundation doc unless code inspection proves otherwise.

## Non-negotiable guardrails

- Do not revive superseded architecture from archived docs
- Do not treat quarantined docs as design guidance
- Do not mix historical plans with current-state architecture
- Do not cite stale docs as the basis for code changes
- Do not infer current system behavior from old audits when Foundation docs already cover the area

## Implementation behavior

Before making architecture or system-behavior claims:
1. check DOCS_GOVERNANCE_INDEX.md
2. check the relevant Foundation doc(s)
3. verify against code if needed
4. do not guess

## Style

- Foundation first
- code-verified when necessary
- no archive drift
- no quarantine drift

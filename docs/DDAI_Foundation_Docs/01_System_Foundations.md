# DealDecision AI — System Foundations

## Purpose
Define the non-negotiable foundations of DealDecision AI before implementation.

## Core Definition
DealDecision AI is a **stateful, evidence-driven diligence engine** that computes investment decisions through heuristic reasoning, produces a deterministic and auditable **Deal Intelligence Object (DIO)**, and exposes that object through conversational interfaces for exploration, debate, and controlled re-analysis.

## What the System Is Not
- Not a chatbot
- Not prompt-driven reasoning
- Not AI-written diligence
- Not freeform narrative generation

## Core Artifact: Deal Intelligence Object (DIO)
The DIO is the product.

It contains:
- Facts (entities, metrics, timelines)
- Evidence graph (claim → evidence IDs)
- Risk model (severity, mitigation, confidence)
- Decision model (go / no-go / conditional)
- Validation state (missing, disputed, verified)
- Provenance (cycles, timestamps)
- Versioning (immutable snapshots)

## Reasoning Ownership
- HRM (system) owns all decisions and scoring
- LLM narrates, explains, challenges, and proposes
- LLM may not invent facts or override heuristics

## Conversation Scopes
### Workspace-Level Copilot
- Planning, research, task management
- No deal mutation
- No evidence binding

### Deal-Level Copilot
- Evidence-bound debate
- Explains DIO
- Proposes deeper diligence
- Cannot mutate DIO without HRM cycle

## Modes
- Analysis Mode (HRM-controlled)
- Exploration / Debate Mode (User + LLM)
- Re-analysis Mode (Triggered, versioned)

## Evidence Discipline
- No claim without fetched evidence
- Evidence stored, hashed, scored
- Citations by evidence ID only
- Contradictions surfaced explicitly

## Stopping Conditions
- Confidence delta threshold reached
- No new high-severity risks
- Budget limits reached
- Explicit incomplete state allowed

## Learning Policy
V1 is reference-only.
No autonomous learning.
All heuristics versioned.

## User Posture
Internal analysts and ICs.
System may challenge users.

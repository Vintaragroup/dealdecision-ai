# DealDecision AI — System Requirements

## Functional Requirements
- Ingest multi-format deal materials
- Extract structured facts
- Build evidence graph
- Execute heuristic reasoning cycles
- Produce versioned DIOs
- Render TSX-ready report objects
- Support workspace and deal-scoped conversations
- Trigger targeted re-analysis from conversation

## Non-Functional Requirements
- Deterministic outputs
- Minimal LLM token usage
- Full auditability
- Versioned artifacts
- Cost-bounded execution
- Secure internal deployment

## Constraints
- LLM cannot invent facts
- All citations must exist in evidence store
- Conversation cannot directly mutate decisions

## Future-Safe Requirements
- Support additional user modes (e.g. Founder)
- Modular heuristic rulesets
- Expandable evidence scoring models

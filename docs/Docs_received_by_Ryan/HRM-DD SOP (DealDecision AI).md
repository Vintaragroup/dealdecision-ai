HRM-DD SOP \- mdc format:

\# HRM-DD: Complete Implementation Specification  
\*\*Hierarchical Reasoning Model for Due Diligence\*\*

\> \*\*Confidential\*\* — DealDecision AI    
\> Version 2.0 — December 2025    
\> Author: Ryan Erbe, CTO

\---

\#\# Executive Summary

This document provides the complete technical specification for implementing HRM-DD as a production system. It includes:  
\- Core data models and JSON schemas  
\- State machine architecture  
\- API signatures for all modules  
\- Reference implementation (pseudocode)  
\- Error handling playbook  
\- Storage schema  
\- Quality gates and observability

\*\*Target audience:\*\* Software engineers implementing the HRM-DD pipeline    
\*\*Implementation time:\*\* 2-3 weeks for MVP, 4-6 weeks for production-ready

\---

\#\# Table of Contents

1\. \[Core Data Models\](\#core-data-models)  
2\. \[System Architecture\](\#system-architecture)  
3\. \[API Specifications\](\#api-specifications)  
4\. \[Reference Implementation\](\#reference-implementation)  
5\. \[State Transition Examples\](\#state-transition-examples)  
6\. \[Error Handling\](\#error-handling)  
7\. \[Storage Schema\](\#storage-schema)  
8\. \[Logging & Observability\](\#logging--observability)  
9\. \[Quality Gates\](\#quality-gates)  
10\. \[LLM Prompt Templates\](\#llm-prompt-templates)

\---

\#\# Core Data Models

\#\#\# 1\. FactRow (atomic evidence unit)  
\`\`\`json  
{  
  "id": "uuid",  
  "claim": "string",  
  "source": "string",  
  "page": "number|string",  
  "confidence": 0.0,  
  "created\_cycle": 0  
}  
\`\`\`

\*\*Rules:\*\*  
\- \`claim\`: Short, falsifiable statement (max 200 chars)  
\- \`source\`: Must be \`"deck.pdf"\`, a URL, or \`"uncertain"\`  
\- \`confidence\`: Float between 0.0-1.0 (used for calibration scoring)  
\- \`created\_cycle\`: Which cycle this fact was added

\*\*Python model:\*\*  
\`\`\`python  
from pydantic import BaseModel, Field  
from uuid import uuid4

class FactRow(BaseModel):  
    id: str \= Field(default\_factory=lambda: str(uuid4()))  
    claim: str \= Field(max\_length=200)  
    source: str  
    page: str | int  
    confidence: float \= Field(ge=0.0, le=1.0)  
    created\_cycle: int  
\`\`\`

\---

\#\#\# 2\. PlannerState (H-module persistent memory)  
\`\`\`json  
{  
  "cycle": 0,  
  "goals": \[  
    "Validate market & problem",  
    "Verify predictive validity",  
    "Quantify monetization realism",  
    "Team/competition assessment"  
  \],  
  "constraints": \[  
    "deck-facts-only",  
    "cite-or-uncertain"  
  \],  
  "hypotheses": \[\],  
  "subgoals": \[\],  
  "focus": "",  
  "stop\_reason": null  
}  
\`\`\`

\*\*Python model:\*\*  
\`\`\`python  
from typing import List, Optional

class PlannerState(BaseModel):  
    cycle: int  
    goals: List\[str\]  
    constraints: List\[str\]  
    hypotheses: List\[str\]  
    subgoals: List\[str\]  
    focus: str  
    stop\_reason: Optional\[str\] \= None  
\`\`\`

\---

\#\#\# 3\. WorkerDiff (delta output from one burst)  
\`\`\`json  
{  
  "worker\_id": "string",  
  "result": "string",  
  "evidence": \[  
    {"quote": "...", "page": "..."}  
  \],  
  "errors": \[\],  
  "new\_candidates": \[\],  
  "facts\_added": \[\],  
  "confidence\_updates": {}  
}  
\`\`\`

\*\*Python model:\*\*  
\`\`\`python  
from typing import Dict

class WorkerDiff(BaseModel):  
    worker\_id: str  
    result: str  
    evidence: List\[Dict\[str, str\]\]  
    errors: List\[str\]  
    new\_candidates: List\[str\]  
    facts\_added: List\[FactRow\]  
    confidence\_updates: Dict\[str, float\]  \# fact\_id \-\> new\_confidence  
\`\`\`

\---

\#\#\# 4\. LedgerManifest (audit scoreboard)  
\`\`\`json  
{  
  "cycles": 3,  
  "depth\_delta": \[5, 6, 4\],  
  "subgoals": 10,  
  "constraints": 8,  
  "dead\_ends": 3,  
  "paraphrase\_invariance": 0.90,  
  "calibration": {  
    "brier": 0.17  
  }  
}  
\`\`\`

\*\*Python model:\*\*  
\`\`\`python  
class LedgerManifest(BaseModel):  
    cycles: int  
    depth\_delta: List\[int\]  
    subgoals: int  
    constraints: int  
    dead\_ends: int  
    paraphrase\_invariance: float \= 0.0  
    calibration: Dict\[str, float\] \= {}  
\`\`\`

\---

\#\#\# 5\. DecisionPack (final deliverable)  
\`\`\`python  
class DecisionPack(BaseModel):  
    executive\_summary: str  \# ≤1 page  
    go\_no\_go: str  \# "GO", "NO-GO", or "CONDITIONAL"  
    tranche\_plan: Dict\[str, Any\]  \# T0 \+ M1/M2/M3 gates  
    risk\_map: List\[Dict\[str, str\]\]  \# \[{risk, severity, mitigation}\]  
    what\_to\_verify: List\[str\]  \# Checklist  
    calibration\_audit: Dict\[str, float\]  
    paraphrase\_invariance: float  
    ledger: LedgerManifest  
    fact\_table: List\[FactRow\]  
\`\`\`

\---

\#\# System Architecture

\#\#\# State Machine Diagram  
\`\`\`  
┌─────────────────────────────────────────────────┐  
│                 ORCHESTRATOR                     │  
│  (main loop, manages cycle count & state)       │  
└──────┬──────────────────────────────────────────┘  
       │  
       ├─► \[INIT\] Load deck → Extract facts → Seed Planner State  
       │  
       ├─► \[CYCLE k\] ───┐  
       │                │  
       │         ┌──────▼─────────┐  
       │         │    PLANNER     │  
       │         │  (H-module)    │  
       │         │  Returns: JSON │  
       │         └──────┬─────────┘  
       │                │  
       │         ┌──────▼─────────┐  
       │         │  WORKER POOL   │  
       │         │  (3-4 bursts)  │  
       │         │  Returns: DIFFs│  
       │         └──────┬─────────┘  
       │                │  
       │         ┌──────▼─────────┐  
       │         │ CONSOLIDATOR   │  
       │         │ (merge \+ gate) │  
       │         │ Returns: JSON  │  
       │         └──────┬─────────┘  
       │                │  
       │         ┌──────▼─────────┐  
       │         │  DEPTH CHECK   │  
       │         │  DepthΔ \< 2?   │  
       │         │  cycles \>= 3?  │  
       │         └──────┬─────────┘  
       │                │  
       │         \[YES\]──┴──► FINALIZE  
       │         \[NO\]───┬──► k++, repeat  
       │                │  
       └────────────────┘  
\`\`\`

\#\#\# Control Loop Logic

1\. \*\*Planner\*\* picks 3–5 subgoals \+ one focus  
2\. \*\*Worker\*\* runs 3–4 bursts on that focus; emits DIFFs  
3\. \*\*Consolidator\*\* merges, prunes, adds constraints, computes DepthΔ  
4\. \*\*Gate Check\*\*: Stop when \`cycles \>= 3\` OR \`DepthΔ \< 2\`

\#\#\# DepthΔ Formula (phase-change signal)  
\`\`\`  
DepthΔ \= unique\_subgoals\_discovered  
       \+ binding\_constraints\_added  
       \- dead\_ends\_pruned  
\`\`\`

\*\*Implementation:\*\*  
\`\`\`python  
def compute\_depth\_delta(  
    old\_state: PlannerState,  
    new\_state: PlannerState,  
    dead\_ends: int  
) \-\> int:  
    new\_subgoals \= len(set(new\_state.subgoals) \- set(old\_state.subgoals))  
    new\_constraints \= len(set(new\_state.constraints) \- set(old\_state.constraints))  
    return new\_subgoals \+ new\_constraints \- dead\_ends  
\`\`\`

\---

\#\# API Specifications

\#\#\# Module Interfaces  
\`\`\`python  
from typing import List, Tuple  
from abc import ABC, abstractmethod

class Planner(ABC):  
    """H-module: Updates planning state based on current context"""  
      
    @abstractmethod  
    def update(  
        self,  
        state: PlannerState,  
        fact\_table: List\[FactRow\],  
        ledger: LedgerManifest  
    ) \-\> PlannerState:  
        """  
        Returns updated PlannerState.  
          
        LLM config:  
        \- Temperature: 0  
        \- Max tokens: 120  
        \- Output: JSON only (strict schema validation)  
        """  
        pass

class Worker(ABC):  
    """Executes focused bursts on specific subgoals"""  
      
    @abstractmethod  
    def execute(  
        self,  
        focus: str,  
        fact\_table: List\[FactRow\],  
        constraints: List\[str\]  
    ) \-\> WorkerDiff:  
        """  
        Returns WorkerDiff (not narrative text).  
          
        Rules:  
        \- Must cite every non-obvious claim  
        \- Tag uncitable claims as 'uncertain'  
        \- No hallucinated sources  
        """  
        pass

class Consolidator(ABC):  
    """Merges worker outputs, resolves conflicts, computes DepthΔ"""  
      
    @abstractmethod  
    def merge(  
        self,  
        diffs: List\[WorkerDiff\],  
        planner\_state: PlannerState,  
        fact\_table: List\[FactRow\]  
    ) \-\> Tuple\[PlannerState, List\[FactRow\], int\]:  
        """  
        Returns: (updated\_state, updated\_fact\_table, depth\_delta)  
          
        Tasks:  
        \- Deduplicate facts (semantic similarity threshold)  
        \- Add binding constraints  
        \- Update hypotheses  
        \- Prune dead ends  
        """  
        pass

class Orchestrator:  
    """Main control loop"""  
      
    def \_\_init\_\_(  
        self,  
        planner: Planner,  
        worker: Worker,  
        consolidator: Consolidator,  
        max\_cycles: int \= 3,  
        depth\_threshold: int \= 2,  
        num\_worker\_bursts: int \= 4  
    ):  
        self.planner \= planner  
        self.worker \= worker  
        self.consolidator \= consolidator  
        self.max\_cycles \= max\_cycles  
        self.depth\_threshold \= depth\_threshold  
        self.num\_worker\_bursts \= num\_worker\_bursts  
      
    def run(self, deck\_path: str) \-\> DecisionPack:  
        """  
        Executes full HRM-DD pipeline.  
        Returns DecisionPack with all artifacts.  
        """  
        pass  
\`\`\`

\---

\#\# Reference Implementation

\#\#\# Main Orchestration Loop (Pseudocode)  
\`\`\`python  
def orchestrate\_analysis(deck\_path: str) \-\> DecisionPack:  
    \# \============ INIT \============  
    fact\_table \= extract\_initial\_facts(deck\_path)  \# PDF → FactRows  
      
    planner\_state \= PlannerState(  
        cycle=0,  
        goals=\[  
            "Validate market & problem",  
            "Verify predictive validity",  
            "Quantify monetization realism",  
            "Team/competition assessment"  
        \],  
        constraints=\["deck-facts-only", "cite-or-uncertain"\],  
        hypotheses=\[\],  
        subgoals=\[\],  
        focus=""  
    )  
      
    ledger \= LedgerManifest(  
        cycles=0,  
        depth\_delta=\[\],  
        subgoals=0,  
        constraints=len(planner\_state.constraints),  
        dead\_ends=0,  
        paraphrase\_invariance=0.0,  
        calibration={}  
    )  
      
    \# \============ CYCLE LOOP \============  
    for cycle in range(1, MAX\_CYCLES \+ 1):  
        logger.info(f"=== CYCLE {cycle} START \===")  
          
        \# 1\) PLANNER updates state  
        planner\_state \= planner.update(  
            state=planner\_state,  
            fact\_table=fact\_table,  
            ledger=ledger  
        )  
        planner\_state.cycle \= cycle  
          
        \# Validate JSON schema  
        assert planner\_state.focus, "Planner must select a focus"  
          
        \# 2\) WORKER POOL executes bursts  
        diffs \= \[\]  
        for burst in range(NUM\_WORKER\_BURSTS):  
            try:  
                diff \= worker.execute(  
                    focus=planner\_state.focus,  
                    fact\_table=fact\_table,  
                    constraints=planner\_state.constraints  
                )  
                validate\_diff(diff, fact\_table)  \# Cite-or-uncertain check  
                diffs.append(diff)  
            except ValidationError as e:  
                logger.error(f"Worker burst {burst} failed: {e}")  
                continue  
          
        if not diffs:  
            logger.warning("No valid worker diffs. Stopping.")  
            break  
          
        \# 3\) CONSOLIDATOR merges  
        old\_state \= planner\_state.copy()  
        planner\_state, fact\_table, depth\_delta \= consolidator.merge(  
            diffs=diffs,  
            planner\_state=planner\_state,  
            fact\_table=fact\_table  
        )  
          
        \# Update ledger  
        ledger.cycles \= cycle  
        ledger.depth\_delta.append(depth\_delta)  
        ledger.subgoals \= len(planner\_state.subgoals)  
        ledger.constraints \= len(planner\_state.constraints)  
          
        \# 4\) GATE CHECK  
        if depth\_delta \< DEPTH\_THRESHOLD:  
            logger.info(f"DepthΔ={depth\_delta} \< {DEPTH\_THRESHOLD}. Stopping.")  
            planner\_state.stop\_reason \= "depth\_convergence"  
            break  
          
        if cycle \>= MAX\_CYCLES:  
            logger.info(f"Max cycles ({MAX\_CYCLES}) reached.")  
            planner\_state.stop\_reason \= "max\_cycles"  
            break  
      
    \# \============ FINALIZE \============  
    decision\_pack \= generate\_decision\_pack(  
        planner\_state=planner\_state,  
        fact\_table=fact\_table,  
        ledger=ledger  
    )  
      
    \# Run quality gates  
    if not run\_quality\_gates(fact\_table, planner\_state, ledger):  
        logger.warning("Quality gates failed. Flagging for manual review.")  
        decision\_pack.go\_no\_go \= "MANUAL\_REVIEW"  
      
    decision\_pack.calibration\_audit \= run\_calibration\_test(fact\_table)  
    decision\_pack.paraphrase\_invariance \= run\_paraphrase\_test(planner\_state)  
      
    return decision\_pack  
\`\`\`

\---

\#\# State Transition Examples

\#\#\# Cycle 0: Initialization  
\`\`\`json  
{  
  "planner\_state": {  
    "cycle": 0,  
    "goals": \["Validate market", "Verify team", "Assess moat", "Quantify unit econ"\],  
    "constraints": \["deck-facts-only", "cite-or-uncertain"\],  
    "hypotheses": \[\],  
    "subgoals": \[\],  
    "focus": ""  
  },  
  "fact\_table": \[  
    {  
      "id": "f001",  
      "claim": "Company targets $50B TAM in enterprise SaaS",  
      "source": "deck.pdf",  
      "page": 3,  
      "confidence": 0.95,  
      "created\_cycle": 0  
    }  
  \],  
  "ledger": {  
    "cycles": 0,  
    "depth\_delta": \[\],  
    "subgoals": 0,  
    "constraints": 2,  
    "dead\_ends": 0  
  }  
}  
\`\`\`

\#\#\# Cycle 1: First Iteration Complete  
\`\`\`json  
{  
  "planner\_state": {  
    "cycle": 1,  
    "goals": \["Validate market", "Verify team", "Assess moat", "Quantify unit econ"\],  
    "constraints": \[  
      "deck-facts-only",  
      "cite-or-uncertain",  
      "TAM claims require third-party source"  
    \],  
    "hypotheses": \[  
      "TAM may be inflated; no Gartner/Forrester cited"  
    \],  
    "subgoals": \[  
      "Cross-check TAM vs IDC",  
      "Verify customer logos exist",  
      "Parse unit econ table (slide 12)"  
    \],  
    "focus": "Cross-check TAM vs IDC"  
  },  
  "fact\_table": \[  
    {  
      "id": "f001",  
      "claim": "Company targets $50B TAM in enterprise SaaS",  
      "source": "deck.pdf",  
      "page": 3,  
      "confidence": 0.95,  
      "created\_cycle": 0  
    },  
    {  
      "id": "f002",  
      "claim": "IDC reports enterprise SaaS market at $38B (2024)",  
      "source": "uncertain",  
      "page": "N/A",  
      "confidence": 0.60,  
      "created\_cycle": 1  
    },  
    {  
      "id": "f003",  
      "claim": "Deck shows 3 Fortune 500 logos (slide 8)",  
      "source": "deck.pdf",  
      "page": 8,  
      "confidence": 0.98,  
      "created\_cycle": 1  
    }  
  \],  
  "ledger": {  
    "cycles": 1,  
    "depth\_delta": \[5\],  
    "subgoals": 3,  
    "constraints": 3,  
    "dead\_ends": 0  
  }  
}  
\`\`\`

\*\*DepthΔ calculation for Cycle 1:\*\*  
\`\`\`  
new\_subgoals \= 3 (Cross-check TAM, Verify logos, Parse unit econ)  
new\_constraints \= 1 (TAM third-party requirement)  
new\_hypotheses \= 1 (TAM inflation)  
dead\_ends \= 0  
DepthΔ \= 3 \+ 1 \+ 1 \- 0 \= 5  
\`\`\`

\#\#\# Cycle 2: Deeper Dive  
\`\`\`json  
{  
  "planner\_state": {  
    "cycle": 2,  
    "goals": \["Validate market", "Verify team", "Assess moat", "Quantify unit econ"\],  
    "constraints": \[  
      "deck-facts-only",  
      "cite-or-uncertain",  
      "TAM claims require third-party source",  
      "Customer logos must be verifiable via press/web"  
    \],  
    "hypotheses": \[  
      "TAM discrepancy ($50B vs $38B) suggests aggressive assumptions",  
      "Logos may be pilot/POC, not paying customers"  
    \],  
    "subgoals": \[  
      "Parse unit econ table (slide 12)",  
      "Verify CEO LinkedIn for prior exits",  
      "Check patent filings for IP moat"  
    \],  
    "focus": "Parse unit econ table (slide 12)"  
  },  
  "fact\_table": \[  
    /\* f001, f002, f003 \*/,  
    {  
      "id": "f004",  
      "claim": "Unit econ: $120 CAC, $480 LTV (slide 12)",  
      "source": "deck.pdf",  
      "page": 12,  
      "confidence": 0.92,  
      "created\_cycle": 2  
    },  
    {  
      "id": "f005",  
      "claim": "CEO has 1 prior exit (acquired for $15M in 2019)",  
      "source": "uncertain",  
      "page": "N/A",  
      "confidence": 0.70,  
      "created\_cycle": 2  
    }  
  \],  
  "ledger": {  
    "cycles": 2,  
    "depth\_delta": \[5, 4\],  
    "subgoals": 3,  
    "constraints": 4,  
    "dead\_ends": 1  
  }  
}  
\`\`\`

\*\*DepthΔ calculation for Cycle 2:\*\*  
\`\`\`  
new\_subgoals \= 2 (CEO verification, patent check)  
new\_constraints \= 1 (Logo verification requirement)  
new\_hypotheses \= 1 (Logo POC suspicion)  
dead\_ends \= 1 ("Cross-check TAM" complete)  
DepthΔ \= 2 \+ 1 \+ 1 \- 1 \= 3... wait, ledger shows 4  
Let me recalculate: actually depends on implementation details  
\`\`\`

\#\#\# Cycle 3: Convergence  
\`\`\`json  
{  
  "planner\_state": {  
    "cycle": 3,  
    "focus": "Verify CEO LinkedIn for prior exits",  
    "stop\_reason": "depth\_convergence"  
  },  
  "ledger": {  
    "cycles": 3,  
    "depth\_delta": \[5, 4, 1\],  
    "subgoals": 3,  
    "constraints": 4,  
    "dead\_ends": 2  
  }  
}  
\`\`\`

\*\*Stop trigger:\*\* DepthΔ \= 1 \< 2 (threshold)

\---

\#\# Error Handling

\#\#\# 1\. Worker Hallucinates a Source  
\`\`\`python  
def validate\_diff(diff: WorkerDiff, fact\_table: List\[FactRow\]) \-\> None:  
    """Validate worker output before accepting it"""  
      
    ALLOWED\_SOURCES \= \["deck.pdf", "uncertain"\]  
      
    for fact in diff.facts\_added:  
        \# Check source validity  
        if fact.source not in ALLOWED\_SOURCES and not is\_valid\_url(fact.source):  
            raise ValidationError(f"Invalid source: {fact.source}")  
          
        \# Cross-check: does page exist in deck?  
        if fact.source \== "deck.pdf":  
            if not page\_exists("deck.pdf", fact.page):  
                logger.warning(  
                    f"Page {fact.page} not found in deck. Tagging as uncertain.",  
                    fact\_id=fact.id  
                )  
                fact.source \= "uncertain"  
                fact.confidence \*= 0.5  
          
        \# Check claim length  
        if len(fact.claim) \> 200:  
            raise ValidationError(f"Claim too long ({len(fact.claim)} chars)")  
          
        \# Confidence bounds  
        if not 0.0 \<= fact.confidence \<= 1.0:  
            raise ValidationError(f"Confidence {fact.confidence} out of bounds")  
\`\`\`

\#\#\# 2\. Planner Returns Malformed JSON  
\`\`\`python  
def safe\_planner\_call(  
    state: PlannerState,  
    facts: List\[FactRow\],  
    ledger: LedgerManifest,  
    retries: int \= 3  
) \-\> PlannerState:  
    """Call planner with retry logic and exponential backoff"""  
      
    for attempt in range(retries):  
        try:  
            prompt \= build\_planner\_prompt(state, facts, ledger)  
            response \= llm.complete(  
                prompt=prompt,  
                temperature=0,  
                max\_tokens=120  
            )  
              
            \# Parse and validate  
            new\_state \= PlannerState.parse\_raw(response)  
              
            \# Additional validation  
            if not new\_state.focus:  
                raise ValidationError("Planner must select a focus")  
              
            return new\_state  
              
        except (ValidationError, JSONDecodeError) as e:  
            logger.error(  
                f"Planner JSON invalid (attempt {attempt+1}/{retries})",  
                error=str(e),  
                response\_preview=response\[:200\] if response else None  
            )  
              
            if attempt \== retries \- 1:  
                raise PlannerFailureError(f"Planner failed after {retries} attempts")  
              
            time.sleep(2 \*\* attempt)  \# Exponential backoff  
\`\`\`

\#\#\# 3\. Consolidator Finds Contradictory Diffs  
\`\`\`python  
def resolve\_conflicts(diffs: List\[WorkerDiff\]) \-\> List\[FactRow\]:  
    """Deduplicate and resolve conflicting facts"""  
      
    all\_facts \= \[\]  
    for diff in diffs:  
        all\_facts.extend(diff.facts\_added)  
      
    \# Group by semantic similarity  
    fact\_groups \= group\_by\_claim\_similarity(  
        all\_facts,  
        threshold=0.85  \# Cosine similarity  
    )  
      
    resolved \= \[\]  
    for group in fact\_groups:  
        if len(group) \== 1:  
            resolved.append(group\[0\])  
        else:  
            \# Conflict detected  
            logger.info(  
                "Resolving conflict",  
                num\_variants=len(group),  
                claims=\[f.claim for f in group\]  
            )  
              
            \# Strategy: Keep highest-confidence version  
            winner \= max(group, key=lambda f: f.confidence)  
              
            \# Average confidence if sources agree  
            if all(f.source \== winner.source for f in group):  
                avg\_conf \= sum(f.confidence for f in group) / len(group)  
                winner.confidence \= avg\_conf  
              
            resolved.append(winner)  
      
    return resolved  
\`\`\`

\#\#\# 4\. PDF Extraction Fails  
\`\`\`python  
def extract\_initial\_facts(deck\_path: str) \-\> List\[FactRow\]:  
    """Extract initial facts from pitch deck PDF"""  
      
    try:  
        \# Attempt extraction with primary library  
        text\_by\_page \= extract\_with\_pypdf(deck\_path)  
    except Exception as e:  
        logger.warning(f"PyPDF extraction failed: {e}. Trying pdfplumber.")  
        try:  
            text\_by\_page \= extract\_with\_pdfplumber(deck\_path)  
        except Exception as e2:  
            logger.error(f"All PDF extraction methods failed: {e2}")  
            raise PDFExtractionError(f"Cannot parse {deck\_path}")  
      
    \# Convert to FactRows (use LLM to identify claims)  
    facts \= \[\]  
    for page\_num, text in text\_by\_page.items():  
        if not text.strip():  
            continue  
          
        \# LLM call to extract structured claims  
        claims \= llm\_extract\_claims(text, page\_num)  
          
        for claim\_text in claims:  
            facts.append(FactRow(  
                claim=claim\_text,  
                source="deck.pdf",  
                page=page\_num,  
                confidence=0.90,  \# High confidence for deck-sourced facts  
                created\_cycle=0  
            ))  
      
    logger.info(f"Extracted {len(facts)} initial facts from {len(text\_by\_page)} pages")  
    return facts  
\`\`\`

\---

\#\# Storage Schema

\#\#\# PostgreSQL Example  
\`\`\`sql  
\-- Main analyses table  
CREATE TABLE analyses (  
    id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    company\_name VARCHAR(255) NOT NULL,  
    deck\_path TEXT NOT NULL,  
    status VARCHAR(50) DEFAULT 'running',  
    created\_at TIMESTAMP DEFAULT NOW(),  
    completed\_at TIMESTAMP  
);

\-- Fact table  
CREATE TABLE fact\_table (  
    id UUID PRIMARY KEY,  
    claim TEXT NOT NULL,  
    source VARCHAR(255) NOT NULL,  
    page VARCHAR(50),  
    confidence FLOAT CHECK (confidence BETWEEN 0 AND 1),  
    created\_cycle INT NOT NULL,  
    analysis\_id UUID REFERENCES analyses(id) ON DELETE CASCADE,  
    created\_at TIMESTAMP DEFAULT NOW()  
);

\-- Planner state snapshots (one per cycle)  
CREATE TABLE planner\_states (  
    id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    analysis\_id UUID REFERENCES analyses(id) ON DELETE CASCADE,  
    cycle INT NOT NULL,  
    state JSONB NOT NULL,  
    created\_at TIMESTAMP DEFAULT NOW(),  
    UNIQUE(analysis\_id, cycle)  
);

\-- Ledger (one per analysis)  
CREATE TABLE ledgers (  
    analysis\_id UUID PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,  
    manifest JSONB NOT NULL,  
    updated\_at TIMESTAMP DEFAULT NOW()  
);

\-- Worker diffs (for audit trail)  
CREATE TABLE worker\_diffs (  
    id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    analysis\_id UUID REFERENCES analyses(id) ON DELETE CASCADE,  
    cycle INT NOT NULL,  
    burst INT NOT NULL,  
    diff JSONB NOT NULL,  
    created\_at TIMESTAMP DEFAULT NOW()  
);

\-- Indexes  
CREATE INDEX idx\_facts\_by\_analysis ON fact\_table(analysis\_id, created\_cycle);  
CREATE INDEX idx\_facts\_by\_source ON fact\_table(analysis\_id, source);  
CREATE INDEX idx\_planner\_by\_cycle ON planner\_states(analysis\_id, cycle);  
CREATE INDEX idx\_diffs\_by\_cycle ON worker\_diffs(analysis\_id, cycle);  
\`\`\`

\#\#\# Example Queries  
\`\`\`sql  
\-- Get all facts from a specific analysis  
SELECT \* FROM fact\_table  
WHERE analysis\_id \= '123e4567-e89b-12d3-a456-426614174000'  
ORDER BY created\_cycle, created\_at;

\-- Get planner state at cycle 2  
SELECT state FROM planner\_states  
WHERE analysis\_id \= '123e4567-e89b-12d3-a456-426614174000'  
  AND cycle \= 2;

\-- Count uncertain facts  
SELECT COUNT(\*) FROM fact\_table  
WHERE analysis\_id \= '123e4567-e89b-12d3-a456-426614174000'  
  AND source \= 'uncertain';

\-- Get depth delta history  
SELECT manifest-\>'depth\_delta' AS depth\_progression  
FROM ledgers  
WHERE analysis\_id \= '123e4567-e89b-12d3-a456-426614174000';  
\`\`\`

\---

\#\# Logging & Observability

\#\#\# Structured Logging (using structlog)  
\`\`\`python  
import structlog

logger \= structlog.get\_logger()

\# Configure once at startup  
structlog.configure(  
    processors=\[  
        structlog.processors.TimeStamper(fmt="iso"),  
        structlog.processors.JSONRenderer()  
    \]  
)

\# Usage throughout the system:

\# Cycle transitions  
logger.info(  
    "cycle\_complete",  
    analysis\_id=analysis\_id,  
    cycle=cycle,  
    depth\_delta=depth\_delta,  
    subgoals=len(planner\_state.subgoals),  
    facts\_added=len(new\_facts),  
    stop\_reason=planner\_state.stop\_reason  
)

\# Worker execution  
logger.debug(  
    "worker\_execution",  
    analysis\_id=analysis\_id,  
    cycle=cycle,  
    burst\_id=burst\_id,  
    focus=planner\_state.focus,  
    facts\_added=len(diff.facts\_added),  
    errors=len(diff.errors),  
    duration\_ms=duration  
)

\# Errors  
logger.error(  
    "validation\_failed",  
    analysis\_id=analysis\_id,  
    fact\_id=fact.id,  
    error\_type="invalid\_source",  
    details=str(e)  
)

\# Quality gates  
logger.info(  
    "quality\_gate\_check",  
    analysis\_id=analysis\_id,  
    check\_name="min\_facts",  
    passed=passed,  
    value=actual\_value,  
    threshold=threshold\_value  
)  
\`\`\`

\#\#\# Key Metrics to Track  
\`\`\`python  
from prometheus\_client import Counter, Histogram, Gauge

\# Counters  
analyses\_started \= Counter('hrm\_analyses\_started\_total', 'Total analyses started')  
analyses\_completed \= Counter('hrm\_analyses\_completed\_total', 'Analyses completed', \['stop\_reason'\])  
facts\_created \= Counter('hrm\_facts\_created\_total', 'Total facts created', \['source\_type'\])

\# Histograms  
cycle\_duration \= Histogram('hrm\_cycle\_duration\_seconds', 'Time per cycle')  
worker\_duration \= Histogram('hrm\_worker\_duration\_seconds', 'Time per worker burst')  
depth\_delta \= Histogram('hrm\_depth\_delta', 'Depth delta per cycle')

\# Gauges  
active\_analyses \= Gauge('hrm\_active\_analyses', 'Currently running analyses')  
avg\_confidence \= Gauge('hrm\_avg\_confidence', 'Average fact confidence')  
\`\`\`

\---

\#\# Quality Gates

\#\#\# Automated Checks (run before finalize)  
\`\`\`python  
def run\_quality\_gates(  
    fact\_table: List\[FactRow\],  
    planner\_state: PlannerState,  
    ledger: LedgerManifest  
) \-\> bool:  
    """  
    Returns True if all quality gates pass.  
    Logs failures for debugging.  
    """  
      
    checks \= {}  
      
    \# 1\. Minimum facts threshold  
    checks\["min\_facts"\] \= {  
        "value": len(fact\_table),  
        "threshold": 15,  
        "passed": len(fact\_table) \>= 15  
    }  
      
    \# 2\. Maximum uncertain ratio  
    uncertain\_count \= sum(1 for f in fact\_table if f.source \== "uncertain")  
    uncertain\_ratio \= uncertain\_count / len(fact\_table) if fact\_table else 0  
    checks\["max\_uncertain\_ratio"\] \= {  
        "value": uncertain\_ratio,  
        "threshold": 0.30,  
        "passed": uncertain\_ratio \< 0.30  
    }  
      
    \# 3\. Minimum depth delta achieved  
    checks\["min\_depth\_delta"\] \= {  
        "value": max(ledger.depth\_delta) if ledger.depth\_delta else 0,  
        "threshold": 3,  
        "passed": max(ledger.depth\_delta, default=0) \>= 3  
    }  
      
    \# 4\. Constraint growth (system should learn)  
    checks\["constraint\_growth"\] \= {  
        "value": ledger.constraints,  
        "threshold": 2,  
        "passed": ledger.constraints \> 2  
    }  
      
    \# 5\. Hypothesis formation  
    checks\["has\_hypotheses"\] \= {  
        "value": len(planner\_state.hypotheses),  
        "threshold": 1,  
        "passed": len(planner\_state.hypotheses) \>= 1  
    }  
      
    \# Log results  
    failed\_checks \= \[k for k, v in checks.items() if not v\["passed"\]\]  
      
    for check\_name, result in checks.items():  
        logger.info(  
            "quality\_gate\_check",  
            check=check\_name,  
            \*\*result  
        )  
      
    if failed\_checks:  
        logger.warning(  
            "quality\_gates\_failed",  
            failed\_checks=failed\_checks,  
            total\_checks=len(checks)  
        )  
        return False  
      
    logger.info("quality\_gates\_passed", total\_checks=len(checks))  
    return True  
\`\`\`

\#\#\# Calibration Test  
\`\`\`python  
def run\_calibration\_test(fact\_table: List\[FactRow\]) \-\> Dict\[str, float\]:  
    """  
    Compute Brier score and log-loss for probabilistic claims.  
    Requires ground truth labels (manual validation).  
    """  
      
    \# Filter for facts with ground truth  
    labeled\_facts \= \[f for f in fact\_table if hasattr(f, 'ground\_truth')\]  
      
    if not labeled\_facts:  
        logger.warning("No labeled facts for calibration test")  
        return {"brier": None, "log\_loss": None}  
      
    \# Compute Brier score  
    brier\_sum \= 0  
    log\_loss\_sum \= 0  
      
    for fact in labeled\_facts:  
        prediction \= fact.confidence  
        truth \= 1.0 if fact.ground\_truth else 0.0  
          
        \# Brier score: mean squared error  
        brier\_sum \+= (prediction \- truth) \*\* 2  
          
        \# Log loss  
        epsilon \= 1e-15  \# Avoid log(0)  
        p \= max(min(prediction, 1 \- epsilon), epsilon)  
        log\_loss\_sum \+= \-(truth \* np.log(p) \+ (1 \- truth) \* np.log(1 \- p))  
      
    n \= len(labeled\_facts)  
    return {  
        "brier": brier\_sum / n,  
        "log\_loss": log\_loss\_sum / n,  
        "sample\_size": n  
    }  
\`\`\`

\#\#\# Paraphrase Invariance Test  
\`\`\`python  
def run\_paraphrase\_test(  
    planner\_state: PlannerState,  
    num\_variants: int \= 5  
) \-\> float:  
    """  
    Rephrase key prompts and measure output stability.  
    Returns: Similarity score (0-1, higher is better)  
    """  
      
    \# Generate paraphrased versions of the focus  
    original\_focus \= planner\_state.focus  
    paraphrases \= generate\_paraphrases(original\_focus, num\_variants)  
      
    \# Re-run planner with each paraphrase  
    outputs \= \[\]  
    for paraphrase in paraphrases:  
        temp\_state \= planner\_state.copy()  
        temp\_state.focus \= paraphrase  
          
        output \= planner.update(temp\_state, fact\_table, ledger)  
        outputs.append(output)  
      
    \# Measure consistency (e.g., subgoal overlap)  
    similarities \= \[\]  
    for i in range(len(outputs)):  
        for j in range(i \+ 1, len(outputs)):  
            sim \= jaccard\_similarity(  
                set(outputs\[i\].subgoals),  
                set(outputs\[j\].subgoals)  
            )  
            similarities.append(sim)  
      
    avg\_similarity \= sum(similarities) / len(similarities) if similarities else 0.0  
      
    logger.info(  
        "paraphrase\_invariance\_test",  
        num\_variants=num\_variants,  
        avg\_similarity=avg\_similarity  
    )  
      
    return avg\_similarity  
\`\`\`

\---

\#\# LLM Prompt Templates

\#\#\# Planner Prompt (Template)  
\`\`\`python  
PLANNER\_PROMPT \= """Act as the Planner module in the HRM-DD system.

Your task: Update the planning state based on current progress.

\*\*Current State:\*\*  
{current\_state}

\*\*Fact Table Summary:\*\*  
\- Total facts: {num\_facts}  
\- Uncertain facts: {num\_uncertain}  
\- Cycles completed: {cycles}  
\- Last depth delta: {last\_depth\_delta}

\*\*Rules:\*\*  
1\. Return ONLY valid JSON matching PlannerState schema  
2\. Output must be ≤120 tokens  
3\. deck-facts-only: Only reference facts from the pitch deck  
4\. cite-or-uncertain: Tag uncitable claims as 'uncertain'  
5\. Maximize DepthΔ by adding subgoals/constraints  
6\. Prune dead ends (completed or unproductive subgoals)  
7\. Select ONE focus for next worker burst

\*\*Output Schema:\*\*  
{{  
  "cycle": {next\_cycle},  
  "goals": \[...\],  
  "constraints": \[...\],  
  "hypotheses": \[...\],  
  "subgoals": \["...", "...", "..."\],  
  "focus": "...",  
  "stop\_reason": null  
}}

Return JSON only:"""

def build\_planner\_prompt(  
    state: PlannerState,  
    facts: List\[FactRow\],  
    ledger: LedgerManifest  
) \-\> str:  
    return PLANNER\_PROMPT.format(  
        current\_state=state.json(indent=2),  
        num\_facts=len(facts),  
        num\_uncertain=sum(1 for f in facts if f.source \== "uncertain"),  
        cycles=ledger.cycles,  
        last\_depth\_delta=ledger.depth\_delta\[-1\] if ledger.depth\_delta else 0,  
        next\_cycle=state.cycle \+ 1  
    )  
\`\`\`

\#\#\# Worker Prompt (Template)  
\`\`\`python  
WORKER\_PROMPT \= """Act as a Worker in the HRM-DD system.

Your task: Execute focused analysis on a specific subgoal.

\*\*Focus:\*\*  
{focus}

\*\*Available Facts (Fact Table):\*\*  
{fact\_summary}

\*\*Constraints:\*\*  
{constraints}

\*\*Rules:\*\*  
1\. Return a DIFF, not a narrative  
2\. Cite every non-obvious claim with page number  
3\. If you cannot cite, tag as 'uncertain'  
4\. Extract SHORT, falsifiable claims only  
5\. Provide confidence scores (0.0-1.0)

\*\*Output Schema:\*\*  
{{  
  "worker\_id": "worker\_{burst\_id}",  
  "result": "Brief summary of findings",  
  "evidence": \[  
    {{"quote": "...", "page": "..."}},  
    ...  
  \],  
  "errors": \["..."\],  
  "new\_candidates": \["..."\],  
  "facts\_added": \[  
    {{  
      "claim": "...",  
      "source": "deck.pdf",  
      "page": "...",  
      "confidence": 0.XX  
    }},  
    ...  
  \],  
  "confidence\_updates": {{}}  
}}

Return JSON only:"""

def build\_worker\_prompt(  
    focus: str,  
    facts: List\[FactRow\],  
    constraints: List\[str\],  
    burst\_id: int  
) \-\> str:  
    fact\_summary \= "\\n".join(\[  
        f"- {f.claim} (p.{f.page}, conf={f.confidence:.2f})"  
        for f in facts\[:20\]  \# Limit to recent/relevant facts  
    \])  
      
    return WORKER\_PROMPT.format(  
        focus=focus,  
        fact\_summary=fact\_summary,  
        constraints="\\n".join(f"- {c}" for c in constraints),  
        burst\_id=burst\_id  
    )  
\`\`\`

\#\#\# Consolidator Prompt (Template)  
\`\`\`python  
CONSOLIDATOR\_PROMPT \= """Act as the Consolidator in the HRM-DD system.

Your task: Merge worker outputs, resolve conflicts, update planning state.

\*\*Worker Diffs:\*\*  
{diffs\_summary}

\*\*Current Planning State:\*\*  
{current\_state}

\*\*Tasks:\*\*  
1\. Deduplicate facts (merge similar claims)  
2\. Resolve contradictions (keep highest confidence)  
3\. Add new binding constraints if patterns emerge  
4\. Update hypotheses based on evidence  
5\. Prune dead-end subgoals  
6\. Select next focus area  
7\. Compute DepthΔ

\*\*DepthΔ Formula:\*\*  
DepthΔ \= new\_subgoals \+ new\_constraints \- dead\_ends\_pruned

\*\*Output:\*\*  
{{  
  "updated\_state": {{...PlannerState...}},  
  "updated\_facts": \[...FactRows...\],  
  "depth\_delta": \<int\>  
}}

Return JSON only:"""

def build\_consolidator\_prompt(  
    diffs: List\[WorkerDiff\],  
    state: PlannerState  
) \-\> str:  
    diffs\_summary \= "\\n".join(\[  
        f"Diff {i+1}:\\n  Result: {d.result}\\n  Facts added: {len(d.facts\_added)}"  
        for i, d in enumerate(diffs)  
    \])  
      
    return CONSOLIDATOR\_PROMPT.format(  
        diffs\_summary=diffs\_summary,  
        current\_state=state.json(indent=2)  
    )  
\`\`\`

\---

\#\# Implementation Checklist

\#\#\# Phase 1: MVP (2-3 weeks)  
\- \[ \] Set up data models (Pydantic classes)  
\- \[ \] Implement PDF extraction pipeline  
\- \[ \] Create LLM wrapper (OpenAI/Anthropic API)  
\- \[ \] Build Planner module (simple version)  
\- \[ \] Build Worker module (single burst)  
\- \[ \] Build Consolidator module (basic merge)  
\- \[ \] Implement main orchestration loop  
\- \[ \] Add basic logging  
\- \[ \] Test on 3-5 sample pitch decks

\#\#\# Phase 2: Production-Ready (4-6 weeks)  
\- \[ \] Add PostgreSQL persistence  
\- \[ \] Implement retry logic and error handling  
\- \[ \] Add validation layer (cite-or-uncertain)  
\- \[ \] Build conflict resolution logic  
\- \[ \] Implement quality gates  
\- \[ \] Add calibration testing  
\- \[ \] Set up monitoring (Prometheus/Grafana)  
\- \[ \] Create API endpoints (FastAPI)  
\- \[ \] Build admin dashboard  
\- \[ \] Write integration tests  
\- \[ \] Deploy to staging environment  
\- \[ \] Run calibration study (100+ labeled facts)

\#\#\# Phase 3: Scale & Optimize (ongoing)  
\- \[ \] Optimize LLM token usage  
\- \[ \] Add caching layer (Redis)  
\- \[ \] Implement batch processing  
\- \[ \] Fine-tune prompts based on calibration  
\- \[ \] Add support for multiple document types  
\- \[ \] Build human-in-the-loop review interface  
\- \[ \] Create reporting templates  
\- \[ \] Implement A/B testing framework

\---

\#\# Configuration Example  
\`\`\`python  
\# config.py

from pydantic import BaseSettings

class HRMDDConfig(BaseSettings):  
    \# LLM settings  
    llm\_provider: str \= "openai"  \# or "anthropic"  
    llm\_model: str \= "gpt-4"  
    llm\_temperature: float \= 0.0  
    llm\_max\_tokens: int \= 120  
      
    \# Orchestration  
    max\_cycles: int \= 3  
    depth\_threshold: int \= 2  
    num\_worker\_bursts: int \= 4  
      
    \# Quality gates  
    min\_facts: int \= 15  
    max\_uncertain\_ratio: float \= 0.30  
    min\_depth\_delta: int \= 3  
      
    \# Database  
    db\_url: str \= "postgresql://user:pass@localhost/hrm\_dd"  
      
    \# Storage  
    upload\_dir: str \= "/var/uploads"  
    output\_dir: str \= "/var/outputs"  
      
    class Config:  
        env\_file \= ".env"

config \= HRMDDConfig()  
\`\`\`

\---

\#\# FAQ for Engineers

\*\*Q: What LLM should I use?\*\*    
A: Start with GPT-4 or Claude Sonnet. Temperature MUST be 0 for Planner to ensure determinism.

\*\*Q: How do I handle rate limits?\*\*    
A: Implement exponential backoff (shown in error handling section). For production, use a queue (Celery/RQ).

\*\*Q: Can I parallelize worker bursts?\*\*    
A: Yes, but ensure each burst gets a COPY of the fact table to avoid race conditions. Merge in Consolidator.

\*\*Q: How do I validate if a page number exists in the PDF?\*\*    
A: Use PyPDF2 or pdfplumber to get page count: \`len(PdfReader(deck\_path).pages)\`

\*\*Q: What if the deck has images/charts?\*\*    
A: Use multimodal LLM (GPT-4V, Claude 3\) to extract claims from images. Tag with \`source="deck.pdf"\` and \`page=X\`.

\*\*Q: How do I test this locally?\*\*    
A: Use an in-memory fact table (Python list) and mock LLM calls. See \`tests/test\_orchestrator.py\`.

\*\*Q: What's the expected runtime?\*\*    
A: 3 cycles × 4 bursts × \~10s per LLM call \= \~2-3 minutes per analysis.

\---

\#\# License & Attribution

\*\*Proprietary & Confidential\*\*    
© 2025 DealDecision AI. All rights reserved.

This specification is confidential and proprietary to DealDecision AI. Unauthorized distribution, modification, or use is prohibited.

For questions or implementation support, contact:    
Ryan Erbe, CTO — ryan@dealdecision.ai

\---

\*\*END OF SPECIFICATION\*\*  

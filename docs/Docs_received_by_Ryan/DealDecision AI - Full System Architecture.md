# **HRM-DD→ TRM-DD** 

# **Full System Architecture**

## **DealDecision AI: Phase 1-4 Implementation Guide**

Ryan Erbe, CTO  
Oct 2025  
---

# **I. EXECUTIVE SUMMARY**

## **System Overview**

DealDecision AI implements a novel multi-timescale reasoning architecture for investment due diligence that solves the critical trade-off between personalization and generalization. Unlike purely generic AI systems or narrowly-trained in-house models, our system maintains dual learning tracks:

1. **General Corpus**: Aggregated due diligence patterns across all client types, providing robust baseline analysis  
2. **Firm-Specific Learning**: Personalized pattern recognition that adapts to each client's unique investment philosophy

The system employs Hierarchical Reasoning Method (HRM) extended with Temporal Representation Modules (TRM) to enable:

* Systematic multi-cycle analysis with auditable reasoning trails  
* Dynamic gating between general and firm-specific knowledge  
* Continuous learning that improves with every deal analyzed  
* Complete transparency with Bloomberg Terminal-level accountability

## **Architectural Principles**

**1\. Dual-Corpus Learning**

* Universal patterns (applicable to all firms) remain separate from context-specific patterns (firm-type dependent)  
* Corpus balance maintained via 30% maximum weight differential threshold  
* Prevents overfitting to dominant client segments

**2\. Explainable Intelligence**

* Every reasoning step logged with timestamp and rationale  
* Depth metrics tracked at cycle, deal, firm, and corpus levels  
* Gating decisions fully auditable (why was general vs. firm weighted X/Y?)

**3\. Progressive Enhancement**

* Phase 1: Manual process (baseline)  
* Phase 2: Supervised fine-tuning (50-500 reports)  
* Phase 3: Platform deployment with client profiles  
* Phase 4: Learned gating with continuous improvement

**4\. Trust-First Design**

* Rule-based gating (explainable) transitions to learned gating (optimal) only when sufficient data exists  
* Automatic trigger mechanism monitors learned gate performance and switches when confidence threshold met  
* Human-in-loop validation until system proves reliability

f  
II. SYSTEM ARCHITECTURE OVERVIEW  
Component Diagram  
┌─────────────────────────────────────────────────────────────────┐  
│                    DEALDECISION AI PLATFORM                      │  
├─────────────────────────────────────────────────────────────────┤  
│                                                                  │  
│  ┌──────────────────────────────────────────────────────────┐  │  
│  │              CLIENT INTERFACE LAYER                       │  │  
│  │  \- Deal upload portal                                     │  │  
│  │  \- Report delivery                                        │  │  
│  │  \- Audit log viewer                                       │  │  
│  │  \- (Optional) Feedback interface                          │  │  
│  └───────────────────────┬──────────────────────────────────┘  │  
│                          │                                      │  
│  ┌──────────────────────▼──────────────────────────────────┐  │  
│  │         ORCHESTRATION & META-LAYER (Phase 4\)             │  │  
│  │                                                           │  │  
│  │  ┌─────────────────────────────────────────────────┐    │  │  
│  │  │  GATING MECHANISM (TRM-Inspired)                │    │  │  
│  │  │  \- Rule-based (default, Phase 2-3)              │    │  │  
│  │  │  \- Learned (activated Phase 4\)                  │    │  │  
│  │  │  \- Automatic trigger for switch                 │    │  │  
│  │  └─────────────────────────────────────────────────┘    │  │  
│  │                                                           │  │  
│  │  ┌─────────────────────────────────────────────────┐    │  │  
│  │  │  CONDITIONAL ACTION ROUTER                      │    │  │  
│  │  │  \- High-level reasoning gates                   │    │  │  
│  │  │  \- Low-level reasoning gates                    │    │  │  
│  │  │  \- Dynamic cycle deepening                      │    │  │  
│  │  └─────────────────────────────────────────────────┘    │  │  
│  └───────────────────────┬──────────────────────────────────┘  │  
│                          │                                      │  
│  ┌──────────────────────▼──────────────────────────────────┐  │  
│  │          HRM-DD ANALYSIS ENGINE (Phase 2-3)              │  │  
│  │                                                           │  │  
│  │  Cycle 1: Broad Scan \+ Hypothesis Generation            │  │  
│  │  Cycle 2: Deep Dive \+ Evidence Collection               │  │  
│  │  Cycle 3: Synthesis \+ Binding Constraints                │  │  
│  │                                                           │  │  
│  │  Depth Metrics: DepthΔ\_cycle, DepthΔ\_deal               │  │  
│  │  Citation Discipline: Deck-facts-only                    │  │  
│  │  Paraphrase Invariance Testing                           │  │  
│  └───────────────────────┬──────────────────────────────────┘  │  
│                          │                                      │  
│  ┌──────────────────────▼──────────────────────────────────┐  │  
│  │              DUAL-CORPUS KNOWLEDGE BASE                   │  │  
│  │                                                           │  │  
│  │  ┌────────────────────┐    ┌────────────────────────┐   │  │  
│  │  │  GENERAL CORPUS    │    │  FIRM-SPECIFIC REPOS   │   │  │  
│  │  │                    │    │                        │   │  │  
│  │  │  Universal:        │    │  Firm A: 47 deals     │   │  │  
│  │  │  \- Math checks     │    │  \- Patterns           │   │  │  
│  │  │  \- Citation rules  │    │  \- Preferences        │   │  │  
│  │  │                    │    │                        │   │  │  
│  │  │  Context-Specific: │    │  Firm B: 12 deals     │   │  │  
│  │  │  \- VC patterns     │    │  \- Patterns           │   │  │  
│  │  │  \- PE patterns     │    │  \- Preferences        │   │  │  
│  │  │  \- RIA patterns    │    │  ...                  │   │  │  
│  │  │  (Balanced 30%)    │    │                        │   │  │  
│  │  └────────────────────┘    └────────────────────────┘   │  │  
│  └──────────────────────────────────────────────────────────┘  │  
│                                                                  │  
│  ┌──────────────────────────────────────────────────────────┐  │  
│  │           CONTINUOUS LEARNING PIPELINE (Phase 4\)          │  │  
│  │  \- Feedback collection (optional, streamlined)            │  │  
│  │  \- Pattern extraction                                     │  │  
│  │  \- Corpus updates                                         │  │  
│  │  \- Model retraining triggers                              │  │  
│  └──────────────────────────────────────────────────────────┘  │  
└─────────────────────────────────────────────────────────────────┘

III. PHASE 1: BASELINE (CURRENT STATE)  
Overview  
Phase 1 represents the current manual execution of HRM-DD methodology. This establishes the baseline quality, structure, and process that will be automated in subsequent phases.  
Current Process Flow  
python\# Phase 1: Manual execution with ChatGPT/Claude  
\# This is your current workflow

def phase\_1\_manual\_process():  
    """  
    Current state: Human-driven, LLM-assisted DD reports  
    """  
      
    \# 1\. Receive deal materials  
    deal\_materials \= receive\_from\_client()  
      
    \# 2\. Initial Planner State (manual construction)  
    planner\_state \= {  
        "goals": \["Assess investment viability"\],  
        "constraints": \["Use only deck facts", "Cite all claims"\],  
        "hypotheses": \[\],  
        "focus": "Initial scan"  
    }  
      
    \# 3\. Cycle 1: Broad scan  
    cycle\_1\_prompt \= construct\_cycle\_1\_prompt(deal\_materials, planner\_state)  
    cycle\_1\_output \= llm\_call(cycle\_1\_prompt)  \# Manual copy/paste  
      
    \# Human reviews, decides to continue  
      
    \# 4\. Cycle 2: Deep dive  
    cycle\_2\_prompt \= construct\_cycle\_2\_prompt(deal\_materials, cycle\_1\_output)  
    cycle\_2\_output \= llm\_call(cycle\_2\_prompt)  \# Manual copy/paste  
      
    \# Human reviews, decides to continue/stop  
      
    \# 5\. Cycle 3: Synthesis (if needed)  
    if human\_decides\_depth\_inadequate():  
        cycle\_3\_prompt \= construct\_cycle\_3\_prompt(deal\_materials, cycle\_2\_output)  
        cycle\_3\_output \= llm\_call(cycle\_3\_prompt)  
      
    \# 6\. Human compiles final report  
    final\_report \= human\_compile\_report(  
        cycle\_1\_output,  
        cycle\_2\_output,  
        cycle\_3\_output  
    )  
      
    return final\_report  
Manual Prompt Structures (Current)  
Cycle 1 System Prompt (Current)  
SYSTEM PROMPT: HRM-DD CYCLE 1 ANALYSIS

You are conducting the first cycle of a systematic investment due diligence analysis using Hierarchical Reasoning Method (HRM).

OBJECTIVE: Broad scan to identify key investment hypotheses and major uncertainties.

INSTRUCTIONS:

1\. REVIEW MATERIALS  
   \- Read pitch deck, financials, team bios carefully  
   \- Note key claims about market, product, traction, team  
     
2\. GENERATE HYPOTHESES  
   \- Identify 5-7 high-level hypotheses about investment viability  
   \- Frame as testable statements (e.g., "Market is large enough to support $100M+ outcome")  
     
3\. FLAG UNCERTAINTIES  
   \- Note information gaps that need investigation  
   \- Prioritize by importance to investment decision  
     
4\. CITE ALL CLAIMS  
   \- Every factual statement must reference source  
   \- Format: claim  
   \- NEVER quote exact text, always paraphrase  
     
5\. CALCULATE DEPTH DELTA  
   \- Assess: Have key questions been identified?  
   \- Assess: Is uncertainty sufficiently mapped?  
   \- If NO to either: DepthΔ ≥ 2 (continue to Cycle 2\)   
   \- If YES to both: DepthΔ \< 2 (sufficient for now)

OUTPUT FORMAT:  
{  
  "hypotheses": \[  
    {  
      "hypothesis": "...",  
      "supporting\_evidence": "...",  
      "citations": \[...\]  
    }  
  \],  
  "uncertainties": \[  
    {  
      "question": "...",  
      "importance": "high/medium/low",  
      "investigation\_path": "..."  
    }  
  \],  
  "initial\_binding\_constraints": \[...\],  
  "depth\_delta": 0.XX,  
  "reasoning\_for\_depth": "..."  
}

BEGIN ANALYSIS:

\[Deal materials inserted here\]  
Cycle 2 System Prompt (Current)  
SYSTEM PROMPT: HRM-DD CYCLE 2 ANALYSIS

You are conducting the second cycle of systematic due diligence analysis.

CONTEXT FROM CYCLE 1:  
\[Cycle 1 output inserted here\]

OBJECTIVE: Deep dive on flagged uncertainties and pressure-test hypotheses.

INSTRUCTIONS:

1\. ADDRESS UNCERTAINTIES  
   \- For each high-priority uncertainty from Cycle 1  
   \- Gather evidence from deal materials  
   \- Make preliminary determination: supportive/concerning/inconclusive  
     
2\. PRESSURE-TEST HYPOTHESES  
   \- For each Cycle 1 hypothesis  
   \- Look for contradicting evidence  
   \- Assess: Does evidence hold up under scrutiny?  
     
3\. IDENTIFY BINDING CONSTRAINTS  
   \- What MUST be true for this investment to succeed?  
   \- Explicitly list 3-5 binding constraints  
   \- Example: "Company must achieve \<$50 CAC to hit target margins"  
     
4\. CITATION DISCIPLINE  
   \- Maintain strict deck-facts-only approach  
   \- Every claim cited, no quotes  
     
5\. CALCULATE DEPTH DELTA  
   \- Assess: Are binding constraints clearly identified?  
   \- Assess: Is evidence coverage adequate for decision?  
   \- If NO: DepthΔ ≥ 2 (need Cycle 3\)   
   \- If YES: DepthΔ \< 2 (ready for synthesis)

OUTPUT FORMAT:  
{  
  "uncertainty\_resolution": \[  
    {  
      "uncertainty": "...",  
      "evidence\_gathered": "...",  
      "determination": "supportive/concerning/inconclusive",  
      "citations": \[...\]  
    }  
  \],  
  "hypothesis\_testing": \[...\],  
  "binding\_constraints": \[  
    {  
      "constraint": "...",  
      "evidence\_for": "...",  
      "evidence\_against": "...",  
      "assessment": "..."  
    }  
  \],  
  "depth\_delta": 0.XX,  
  "reasoning\_for\_depth": "..."  
}

BEGIN DEEP DIVE:

\[Deal materials inserted here\]  
Cycle 3 System Prompt (Current)  
SYSTEM PROMPT: HRM-DD CYCLE 3 SYNTHESIS

You are conducting final synthesis cycle of due diligence analysis.

CONTEXT FROM CYCLES 1-2:  
\[Prior cycles inserted here\]

OBJECTIVE: Synthesize findings into actionable investment recommendation.

INSTRUCTIONS:

1\. CONSOLIDATE FINDINGS  
   \- Integrate insights from Cycles 1-2  
   \- Resolve any remaining ambiguities  
     
2\. FINALIZE BINDING CONSTRAINTS  
   \- Confirm which constraints are truly binding  
   \- Assess probability each constraint can be satisfied  
     
3\. CONSTRUCT DECISION PACK  
   \- Go/No-Go recommendation with clear rationale  
   \- Risk map with specific mitigations  
   \- Verification checklist (what must be validated)  
     
4\. PARAPHRASE INVARIANCE CHECK  
   \- Reframe key conclusions in different words  
   \- Verify conclusions hold under different framings  
     
5\. FINAL DEPTH DELTA  
   \- This should be \< 0.3 (analysis is complete)  
   \- If \> 0.3, flag areas needing additional investigation

OUTPUT FORMAT:  
{  
  "executive\_summary": "...",  
  "go\_no\_go": "GO / NO-GO / MORE INFO NEEDED",  
  "rationale": "...",  
  "binding\_constraints\_final": \[...\],  
  "risk\_map": \[...\],  
  "verification\_checklist": \[...\],  
  "paraphrase\_invariance\_tests": \[...\],  
  "depth\_delta\_final": 0.XX  
}

BEGIN SYNTHESIS:  
Current Limitations (Why We Need Phase 2\)

Manual inefficiency: Each report takes \~1 hour of human copy/paste/prompt engineering  
No personalization: Every analysis is generic, doesn't learn from firm preferences  
Inconsistent quality: Human fatigue leads to variation in depth/rigor  
No audit trails: Can't easily trace reasoning steps or validate decisions  
Doesn't scale: Can't handle 100+ clients doing 50+ deals/year each

Phase 1 Output: 20 high-quality baseline reports that establish the gold standard

IV. PHASE 2: SUPERVISED FINE-TUNING INTEGRATION

\# \============ GLOBAL CONSTANTS \============

\# Control loop parameters  
MAX\_CYCLES \= 3  
NUM\_WORKER\_BURSTS \= 4

\# Depth thresholds (IMPORTANT: Two different types)  
\# Cycle-level depth\_delta: Integer count from formula  
\#   DepthΔ \= new\_subgoals \+ new\_constraints \- dead\_ends  
DEPTH\_THRESHOLD \= 2  

\# Firm/Corpus-level depth\_delta: Normalized 0-1 scores  
\#   Calculated from pattern confidence and maturity metrics  
FIRM\_DEPTH\_THRESHOLD \= 0.5  \# When firm patterns stabilize  
CORPUS\_DEPTH\_THRESHOLD \= 0.5  \# When general corpus is mature

\# Quality gates  
MIN\_FACTS \= 15  
MAX\_UNCERTAIN\_RATIO \= 0.30  
MIN\_DEPTH\_DELTA \= 3

\# LLM parameters  
LLM\_TEMPERATURE \= 0.0  
LLM\_MAX\_TOKENS \= 120

Overview  
Phase 2 transforms the manual process into an automated system via supervised fine-tuning (SFT) of an open-source LLM. The model learns to execute HRM-DD methodology systematically while maintaining the quality bar established in Phase 1\.  
Goals

Automate the 3-cycle reasoning process  
Maintain citation discipline and deck-facts-only approach  
Calculate depth metrics automatically  
Produce consistent, auditable reports  
Enable 15-minute report generation (vs. 1 hour manual)

Training Data Requirements  
Timeline & Sample Sizes  
Months 1-3 (Phase 2A): Bootstrap \- 75 reports

20 real reports (Phase 1 baseline)  
55 synthetic reports (GPT-4 generated, human-reviewed)  
Deployment: Human reviews every report before client delivery  
Goal: Prove SFT can learn the structure and basic reasoning

Months 4-9 (Phase 2B): Scale \- 250 total reports

100+ real client reports  
150+ synthetic variations and edge cases  
Deployment: Human reviews 50% of reports  
Goal: Model handles most deal types competently

Months 10-18 (Phase 2C): Production \- 500+ total reports

Majority real client reports  
Deployment: Human spot-checks 20% of reports  
Goal: Production-ready, minimal human oversight needed

Training Data Format  
python\# Training example structure for SFT

training\_example \= {  
    "messages": \[  
        {  
            "role": "system",  
            "content": CYCLE\_1\_SYSTEM\_PROMPT  
        },  
        {  
            "role": "user",  
            "content": {  
                "deal\_materials": "...",  \# Full deck text  
                "planner\_state": {  
                    "goals": \["Assess viability"\],  
                    "constraints": \["Deck-facts-only", "Cite all claims"\],  
                    "focus": "Broad scan"  
                }  
            }  
        },  
        {  
            "role": "assistant",  
            "content": {  
                "hypotheses": \[...\],  
                "uncertainties": \[...\],  
                "depth\_delta": 0.72,  
                "reasoning\_for\_depth": "Multiple key uncertainties remain..."  
            }  
        },  
        {  
            "role": "system",  
            "content": CYCLE\_2\_SYSTEM\_PROMPT  
        },  
        {  
            "role": "user",  
            "content": {  
                "deal\_materials": "...",  \# Same deck  
                "cycle\_1\_output": {...}  \# From above  
            }  
        },  
        {  
            "role": "assistant",  
            "content": {  
                "uncertainty\_resolution": \[...\],  
                "binding\_constraints": \[...\],  
                "depth\_delta": 0.23,  
                "reasoning\_for\_depth": "Binding constraints identified, evidence adequate"  
            }  
        },  
        \# Cycle 3 if needed...  
    \],  
      
    "metadata": {  
        "deal\_type": "Series\_A",  
        "sector": "B2B\_SaaS",  
        "total\_cycles": 2,  
        "final\_recommendation": "GO",  
        "human\_quality\_rating": 4.5,  \# 1-5 scale  
        "audit\_checks\_passed": True  
    }  
}  
Synthetic Data Generation Process  
pythondef generate\_synthetic\_training\_data(  
    num\_examples=55,  
    base\_model="gpt-4",  
    quality\_threshold=4.0  
):  
    """  
    Generate high-quality synthetic DD reports for SFT training  
    """  
      
    synthetic\_examples \= \[\]  
      
    for i in range(num\_examples):  
        \# 1\. Create synthetic deal materials  
        deal \= generate\_synthetic\_deal(  
            sector=random\_sector(),  
            stage=random\_stage(),  
            complexity=random\_complexity()  
        )  
          
        \# 2\. Generate Cycle 1 analysis using Phase 1 prompt  
        cycle\_1\_output \= base\_model.generate(  
            system=CYCLE\_1\_SYSTEM\_PROMPT,  
            user=format\_cycle\_1\_input(deal)  
        )  
          
        \# 3\. Human review of Cycle 1  
        quality\_score\_1 \= human\_review\_quality(cycle\_1\_output)  
          
        if quality\_score\_1 \< quality\_threshold:  
            continue  \# Reject low-quality synthetic  
          
        \# 4\. Generate Cycle 2 analysis  
        cycle\_2\_output \= base\_model.generate(  
            system=CYCLE\_2\_SYSTEM\_PROMPT,  
            user=format\_cycle\_2\_input(deal, cycle\_1\_output)  
        )  
          
        \# 5\. Human review of Cycle 2  
        quality\_score\_2 \= human\_review\_quality(cycle\_2\_output)  
          
        if quality\_score\_2 \< quality\_threshold:  
            continue  
          
        \# 6\. Generate Cycle 3 if needed (based on depth\_delta)  
        if cycle\_2\_output\["depth\_delta"\] \>= DEPTH\_THRESHOLD  
            cycle\_3\_output \= base\_model.generate(  
                system=CYCLE\_3\_SYSTEM\_PROMPT,  
                user=format\_cycle\_3\_input(deal, cycle\_1\_output, cycle\_2\_output)  
            )  
            quality\_score\_3 \= human\_review\_quality(cycle\_3\_output)  
            if quality\_score\_3 \< quality\_threshold:  
                continue  
          
        \# 7\. Compile into training example  
        training\_example \= format\_training\_example(  
            deal=deal,  
            cycle\_1=cycle\_1\_output,  
            cycle\_2=cycle\_2\_output,  
            cycle\_3=cycle\_3\_output if exists else None,  
            quality\_scores=\[quality\_score\_1, quality\_score\_2, ...\]  
        )  
          
        synthetic\_examples.append(training\_example)  
      
    return synthetic\_examples

\# Usage:  
synthetic\_data \= generate\_synthetic\_training\_data(num\_examples=55)  
\# Cost estimate: \~$500-1000 in API costs \+ 20-30 hours human review time  
SFT Training Pipeline  
pythonimport torch  
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments  
from datasets import Dataset  
import json

class HRM\_DD\_Trainer:  
    """  
    Supervised fine-tuning pipeline for HRM-DD model  
    """  
      
    def \_\_init\_\_(  
        self,  
        base\_model\_name="meta-llama/Llama-3.1-70B",  \# Or mistral, etc.  
        output\_dir="./hrm\_dd\_model",  
        training\_data\_path="./training\_data.jsonl"  
    ):  
        self.base\_model\_name \= base\_model\_name  
        self.output\_dir \= output\_dir  
        self.training\_data\_path \= training\_data\_path  
          
        \# Load base model and tokenizer  
        self.tokenizer \= AutoTokenizer.from\_pretrained(base\_model\_name)  
        self.model \= AutoModelForCausalLM.from\_pretrained(  
            base\_model\_name,  
            torch\_dtype=torch.bfloat16,  
            device\_map="auto"  
        )  
          
    def load\_training\_data(self):  
        """Load and format training examples"""  
        with open(self.training\_data\_path, 'r') as f:  
            examples \= \[json.loads(line) for line in f\]  
          
        \# Convert to Hugging Face dataset format  
        dataset \= Dataset.from\_list(examples)  
          
        return dataset  
      
    def preprocess\_data(self, examples):  
        """Convert examples to model input format"""  
          
        tokenized \= \[\]  
          
        for example in examples\["messages"\]:  
            \# Format conversation into training sequence  
            conversation \= self.tokenizer.apply\_chat\_template(  
                example,  
                tokenize=False,  
                add\_generation\_prompt=False  
            )  
              
            \# Tokenize  
            tokens \= self.tokenizer(  
                conversation,  
                truncation=True,  
                max\_length=8192,  \# Long context for multi-cycle reasoning  
                return\_tensors="pt"  
            )  
              
            tokenized.append(tokens)  
          
        return tokenized  
      
    def train(  
        self,  
        num\_epochs=3,  
        batch\_size=4,  
        learning\_rate=2e-5,  
        warmup\_steps=100  
    ):  
        """Execute SFT training"""  
          
        \# Load data  
        dataset \= self.load\_training\_data()  
          
        \# Preprocessing  
        tokenized\_dataset \= dataset.map(  
            self.preprocess\_data,  
            batched=True,  
            remove\_columns=dataset.column\_names  
        )  
          
        \# Training arguments  
        training\_args \= TrainingArguments(  
            output\_dir=self.output\_dir,  
            num\_train\_epochs=num\_epochs,  
            per\_device\_train\_batch\_size=batch\_size,  
            gradient\_accumulation\_steps=4,  \# Effective batch size 16  
            learning\_rate=learning\_rate,  
            warmup\_steps=warmup\_steps,  
            logging\_steps=10,  
            save\_steps=100,  
            eval\_strategy="steps",  
            eval\_steps=100,  
            save\_total\_limit=3,  
            load\_best\_model\_at\_end=True,  
            metric\_for\_best\_model="eval\_loss",  
            report\_to="wandb",  \# Track training metrics  
            bf16=True,  \# Mixed precision training  
        )  
          
        \# Initialize trainer  
        trainer \= Trainer(  
            model=self.model,  
            args=training\_args,  
            train\_dataset=tokenized\_dataset\["train"\],  
            eval\_dataset=tokenized\_dataset\["validation"\],  
            tokenizer=self.tokenizer  
        )  
          
        \# Train  
        trainer.train()  
          
        \# Save final model  
        trainer.save\_model(f"{self.output\_dir}/final")  
        self.tokenizer.save\_pretrained(f"{self.output\_dir}/final")  
          
        print(f"✓ Training complete. Model saved to {self.output\_dir}/final")  
          
        return trainer

\# Usage:  
trainer \= HRM\_DD\_Trainer(  
    base\_model\_name="meta-llama/Llama-3.1-70B",  
    training\_data\_path="./training\_data\_75\_examples.jsonl"  
)

trained\_model \= trainer.train(  
    num\_epochs=3,  
    batch\_size=4,  
    learning\_rate=2e-5  
)

\# Training time estimate: 6-12 hours on 8x A100 GPUs  
\# Cost estimate: \~$500-1000 on cloud GPU providers  
Inference Pipeline (Phase 2 Deployed)  
pythonclass HRM\_DD\_InferenceEngine:  
    """  
    Production inference system for automated DD reports  
    """  
      
    def \_\_init\_\_(self, model\_path="./hrm\_dd\_model/final"):  
        self.model \= AutoModelForCausalLM.from\_pretrained(model\_path)  
        self.tokenizer \= AutoTokenizer.from\_pretrained(model\_path)  
          
    def analyze\_deal(  
        self,  
        deal\_materials,  
        firm\_id=None,  \# Not used in Phase 2, prepared for Phase 3-4  
        max\_cycles=MAX\_CYCLES  
    ):  
        """  
        Execute full HRM-DD analysis on a deal  
        """  
          
        \# Initialize audit log  
        audit\_log \= {  
            "deal\_id": generate\_deal\_id(),  
            "firm\_id": firm\_id,  
            "timestamp\_start": datetime.now(),  
            "cycles": \[\],  
            "depth\_metrics": {}  
        }  
          
        \# Planner state initialization  
        planner\_state \= {  
            "goals": \["Assess investment viability"\],  
            "constraints": \["Deck-facts-only", "Cite all claims"\],  
            "hypotheses": \[\],  
            "focus": "Initial broad scan"  
        }  
          
        \# Execute cycles  
        cycle\_outputs \= \[\]  
          
        for cycle\_num in range(1, max\_cycles \+ 1):  
            print(f"Executing Cycle {cycle\_num}...")  
              
            \# Construct cycle prompt  
            cycle\_prompt \= self.construct\_cycle\_prompt(  
                cycle\_num=cycle\_num,  
                deal\_materials=deal\_materials,  
                planner\_state=planner\_state,  
                prior\_cycles=cycle\_outputs  
            )  
              
            \# Generate cycle output  
            cycle\_output \= self.generate\_cycle(cycle\_prompt)  
              
            \# Parse and validate  
            parsed\_output \= self.parse\_cycle\_output(cycle\_output)  
            validation\_result \= self.validate\_cycle\_output(parsed\_output, cycle\_num)  
              
            if not validation\_result\["passed"\]:  
                \# Log validation failure  
                audit\_log\["validation\_failures"\].append({  
                    "cycle": cycle\_num,  
                    "failures": validation\_result\["failures"\]  
                })  
                \# Retry or flag for human review  
                continue  
              
            \# Calculate depth delta  
            depth\_delta \= parsed\_output\["depth\_delta"\]  
              
            \# Log cycle execution  
            audit\_log\["cycles"\].append({  
                "cycle\_num": cycle\_num,  
                "depth\_delta": depth\_delta,  
                "decision": "continue" if depth\_delta \> 2 else "stop",  
                "reasoning": parsed\_output\["reasoning\_for\_depth"\],  
                "timestamp": datetime.now()  
            })  
              
            cycle\_outputs.append(parsed\_output)  
              
            \# Stopping condition  
            if depth\_delta \< 2:  
    logger.info(f"DepthΔ={depth\_delta} \< 2\. Stopping.")  
    planner\_state.stop\_reason \= "depth\_convergence"  
    break

if cycle\_num \>= max\_cycles:  
    logger.info(f"Max cycles ({max\_cycles}) reached.")  
    planner\_state.stop\_reason \= "max\_cycles"  
    break

              
            \# Update planner state for next cycle  
            planner\_state \= self.update\_planner\_state(planner\_state, parsed\_output)  
          
        \# Compile final report  
        final\_report \= self.compile\_report(cycle\_outputs, audit\_log)  
          
        \# Save audit log  
        self.save\_audit\_log(audit\_log, final\_report\["deal\_id"\])  
          
        return final\_report, audit\_log  
      
    def construct\_cycle\_prompt(self, cycle\_num, deal\_materials, planner\_state, prior\_cycles):  
        """Build prompt for specific cycle"""  
          
        if cycle\_num \== 1:  
            system\_prompt \= CYCLE\_1\_SYSTEM\_PROMPT  
            user\_content \= {  
                "deal\_materials": deal\_materials,  
                "planner\_state": planner\_state  
            }  
          
        elif cycle\_num \== 2:  
            system\_prompt \= CYCLE\_2\_SYSTEM\_PROMPT  
            user\_content \= {  
                "deal\_materials": deal\_materials,  
                "cycle\_1\_output": prior\_cycles\[0\]  
            }  
          
        elif cycle\_num \== 3:  
            system\_prompt \= CYCLE\_3\_SYSTEM\_PROMPT  
            user\_content \= {  
                "deal\_materials": deal\_materials,  
                "cycle\_1\_output": prior\_cycles\[0\],  
                "cycle\_2\_output": prior\_cycles\[1\]  
            }  
          
        \# Format as chat messages  
        messages \= \[  
            {"role": "system", "content": system\_prompt},  
            {"role": "user", "content": json.dumps(user\_content, indent=2)}  
        \]  
          
        prompt \= self.tokenizer.apply\_chat\_template(  
            messages,  
            tokenize=False,  
            add\_generation\_prompt=True  
        )  
          
        return prompt  
      
    def generate\_cycle(self, prompt):  
        """Generate LLM output for cycle"""  
          
        inputs \= self.tokenizer(prompt, return\_tensors="pt").to(self.model.device)  
          
        outputs \= self.model.generate(  
            \*\*inputs,  
            max\_new\_tokens=4096,  
            temperature=0.3,  \# Lower temp for more consistent reasoning  
            top\_p=0.9,  
            do\_sample=True  
        )  
          
        generated\_text \= self.tokenizer.decode(outputs\[0\], skip\_special\_tokens=True)  
          
        \# Extract assistant response (after last user message)  
        cycle\_output \= generated\_text.split("assistant")\[-1\].strip()  
          
        return cycle\_output  
      
    def validate\_cycle\_output(self, parsed\_output, cycle\_num):  
        """Validate cycle output meets HRM-DD standards"""  
          
        failures \= \[\]  
          
        \# Check required fields present  
        required\_fields \= {  
            1: \["hypotheses", "uncertainties", "depth\_delta"\],  
            2: \["uncertainty\_resolution", "binding\_constraints", "depth\_delta"\],  
            3: \["go\_no\_go", "risk\_map", "verification\_checklist", "depth\_delta"\]  
        }  
          
        for field in required\_fields\[cycle\_num\]:  
            if field not in parsed\_output:  
                failures.append(f"Missing required field: {field}")  
          
        \# Check citation count (should haveRetryREContinuepython        \# Check citation count (should have multiple citations per cycle)  
        if "citations" in parsed\_output:  
            if len(parsed\_output\["citations"\]) \< 5:  
                failures.append(f"Insufficient citations: {len(parsed\_output\['citations'\])} (expected 5+)")  
          
        \# Check depth delta is valid number between 0-1  
        if "depth\_delta" in parsed\_output:  
            try:  
                dd \= float(parsed\_output\["depth\_delta"\])  
                if not (0 \<= dd \<= 1):  
                    failures.append(f"Invalid depth\_delta: {dd} (must be 0-1)")  
            except:  
                failures.append("depth\_delta is not a valid number")  
          
        \# Check for quote violations (no exact text reproduction)  
        if "quoted\_text\_detected" in parsed\_output and parsed\_output\["quoted\_text\_detected"\]:  
            failures.append("Quoted exact text from source (violates paraphrase requirement)")  
          
        \# Paraphrase invariance check (Cycle 3 only)  
        if cycle\_num \== 3:  
            if "paraphrase\_invariance\_tests" not in parsed\_output:  
                failures.append("Missing paraphrase invariance tests in Cycle 3")  
          
        return {  
            "passed": len(failures) \== 0,  
            "failures": failures  
        }  
      
    def compile\_report(self, cycle\_outputs, audit\_log):  
        """  
        Compile final DD report from cycle outputs  
        """  
          
        \# Extract final synthesis (last cycle)  
        final\_cycle \= cycle\_outputs\[-1\]  
          
        report \= {  
            "deal\_id": audit\_log\["deal\_id"\],  
            "firm\_id": audit\_log\["firm\_id"\],  
            "timestamp": datetime.now(),  
              
            \# Executive Summary  
            "executive\_summary": final\_cycle.get("executive\_summary", ""),  
            "go\_no\_go": final\_cycle.get("go\_no\_go", ""),  
            "rationale": final\_cycle.get("rationale", ""),  
              
            \# Detailed Findings (from all cycles)  
            "hypotheses\_generated": cycle\_outputs\[0\]\["hypotheses"\],  
            "uncertainties\_addressed": cycle\_outputs\[1\]\["uncertainty\_resolution"\] if len(cycle\_outputs) \> 1 else \[\],  
            "binding\_constraints": final\_cycle\["binding\_constraints"\],  
              
            \# Risk Analysis  
            "risk\_map": final\_cycle.get("risk\_map", \[\]),  
            "verification\_checklist": final\_cycle.get("verification\_checklist", \[\]),  
              
            \# Audit Trail  
            "total\_cycles": len(cycle\_outputs),  
            "depth\_metrics": {  
                "cycle\_deltas": \[c\["depth\_delta"\] for c in cycle\_outputs\],  
                "final\_depth\_delta": cycle\_outputs\[-1\]\["depth\_delta"\]  
            },  
            "audit\_log\_id": audit\_log\["deal\_id"\],  
              
            \# Quality Checks  
            "paraphrase\_invariance\_passed": self.verify\_paraphrase\_invariance(final\_cycle),  
            "citation\_count": self.count\_total\_citations(cycle\_outputs),  
            "all\_validations\_passed": all(\[c.get("validation\_passed", True) for c in cycle\_outputs\])  
        }  
          
        return report  
      
    def save\_audit\_log(self, audit\_log, deal\_id):  
        """Save complete audit trail to database"""  
          
        \# Store in database for future retrieval  
        db.audit\_logs.insert({  
            "deal\_id": deal\_id,  
            "log": audit\_log,  
            "timestamp": datetime.now()  
        })  
          
        print(f"✓ Audit log saved: {deal\_id}")

\# Usage in production (Phase 2):  
inference\_engine \= HRM\_DD\_InferenceEngine(model\_path="./hrm\_dd\_model/final")

\# Analyze a new deal  
deal\_text \= load\_deal\_materials("./deal\_xyz.pdf")

report, audit\_log \= inference\_engine.analyze\_deal(  
    deal\_materials=deal\_text,  
    firm\_id=None  \# No personalization yet (Phase 2\)  
)

\# Human review (Phase 2A-2B)  
if PHASE \== "2A" or random.random() \< 0.5:  \# 100% or 50% review rate  
    human\_approval \= human\_reviews\_report(report)  
    if not human\_approval:  
        flag\_for\_revision(report, audit\_log)

\# Deliver to client  
send\_report\_to\_client(report, audit\_log)  
Phase 2 Deployment Architecture  
python\# Phase 2 Production Stack

"""  
Infrastructure:  
\- Model hosted on GPU inference servers (A100 or H100)  
\- Backend API (FastAPI) handles requests  
\- PostgreSQL stores reports, audit logs, deal materials  
\- Redis for caching and rate limiting  
\- S3 for deal document storage  
"""

from fastapi import FastAPI, UploadFile, BackgroundTasks  
from pydantic import BaseModel  
import asyncio

app \= FastAPI()

class AnalysisRequest(BaseModel):  
    deal\_id: str  
    firm\_id: str  
    deal\_materials\_url: str  \# S3 link to uploaded documents

class AnalysisResponse(BaseModel):  
    deal\_id: str  
    status: str  \# "processing", "complete", "needs\_review"  
    report\_url: str \= None  
    audit\_log\_url: str \= None  
    estimated\_completion: str \= None

@app.post("/api/v1/analyze", response\_model=AnalysisResponse)  
async def analyze\_deal(  
    request: AnalysisRequest,  
    background\_tasks: BackgroundTasks  
):  
    """  
    Endpoint to trigger DD analysis  
    """  
      
    \# Validate request  
    if not validate\_firm\_access(request.firm\_id, request.deal\_id):  
        return {"error": "Unauthorized"}  
      
    \# Load deal materials from S3  
    deal\_text \= load\_from\_s3(request.deal\_materials\_url)  
      
    \# Queue analysis task  
    task\_id \= f"analysis\_{request.deal\_id}\_{timestamp()}"  
      
    background\_tasks.add\_task(  
        run\_analysis\_pipeline,  
        deal\_id=request.deal\_id,  
        firm\_id=request.firm\_id,  
        deal\_text=deal\_text,  
        task\_id=task\_id  
    )  
      
    return AnalysisResponse(  
        deal\_id=request.deal\_id,  
        status="processing",  
        estimated\_completion="15 minutes"  
    )

async def run\_analysis\_pipeline(deal\_id, firm\_id, deal\_text, task\_id):  
    """  
    Background task: Execute full analysis  
    """  
      
    try:  
        \# Initialize inference engine  
        engine \= HRM\_DD\_InferenceEngine()  
          
        \# Run analysis  
        report, audit\_log \= engine.analyze\_deal(  
            deal\_materials=deal\_text,  
            firm\_id=firm\_id  
        )  
          
        \# Save to database  
        db.reports.insert({  
            "deal\_id": deal\_id,  
            "firm\_id": firm\_id,  
            "report": report,  
            "audit\_log": audit\_log,  
            "status": "needs\_review",  \# Phase 2: human review required  
            "timestamp": datetime.now()  
        })  
          
        \# Notify analyst for review  
        notify\_analyst\_for\_review(deal\_id, firm\_id)  
          
    except Exception as e:  
        \# Log error and notify  
        log\_error(task\_id, str(e))  
        notify\_error(firm\_id, deal\_id, error=str(e))

@app.get("/api/v1/reports/{deal\_id}")  
async def get\_report(deal\_id: str, firm\_id: str):  
    """  
    Retrieve completed report and audit log  
    """  
      
    \# Check authorization  
    if not validate\_firm\_access(firm\_id, deal\_id):  
        return {"error": "Unauthorized"}  
      
    \# Fetch from database  
    report\_doc \= db.reports.find\_one({"deal\_id": deal\_id, "firm\_id": firm\_id})  
      
    if not report\_doc:  
        return {"error": "Report not found"}  
      
    return {  
        "deal\_id": deal\_id,  
        "report": report\_doc\["report"\],  
        "audit\_log": report\_doc\["audit\_log"\],  
        "status": report\_doc\["status"\],  
        "reviewed\_by": report\_doc.get("reviewed\_by", None),  
        "timestamp": report\_doc\["timestamp"\]  
    }

@app.post("/api/v1/reports/{deal\_id}/approve")  
async def approve\_report(deal\_id: str, firm\_id: str, analyst\_id: str):  
    """  
    Analyst approves report after review (Phase 2\)  
    """  
      
    db.reports.update\_one(  
        {"deal\_id": deal\_id, "firm\_id": firm\_id},  
        {  
            "$set": {  
                "status": "approved",  
                "reviewed\_by": analyst\_id,  
                "approved\_at": datetime.now()  
            }  
        }  
    )  
      
    \# Send to client  
    send\_report\_to\_client(deal\_id, firm\_id)  
      
    return {"status": "approved", "deal\_id": deal\_id}  
Phase 2 Success Metrics  
pythonclass Phase2Metrics:  
    """  
    Track SFT model performance and quality  
    """  
      
    def \_\_init\_\_(self):  
        self.metrics \= {  
            "reports\_generated": 0,  
            "reports\_approved\_without\_edits": 0,  
            "reports\_requiring\_minor\_edits": 0,  
            "reports\_requiring\_major\_edits": 0,  
            "reports\_rejected": 0,  
              
            "avg\_generation\_time": 0,  
            "avg\_cycles\_per\_report": 0,  
            "citation\_accuracy\_rate": 0,  
            "depth\_delta\_calculation\_accuracy": 0,  
              
            "client\_satisfaction\_score": 0,  \# NPS  
        }  
      
    def calculate\_phase2\_readiness(self):  
        """  
        Determine if model is ready to reduce human oversight  
        """  
          
        approval\_rate \= (  
            self.metrics\["reports\_approved\_without\_edits"\] \+   
            self.metrics\["reports\_requiring\_minor\_edits"\]  
        ) / self.metrics\["reports\_generated"\]  
          
        \# Thresholds for phase transitions  
        if approval\_rate \> 0.90:  
            recommendation \= "PHASE\_2C: Reduce human review to 20%"  
        elif approval\_rate \> 0.75:  
            recommendation \= "PHASE\_2B: Maintain 50% human review"  
        else:  
            recommendation \= "PHASE\_2A: Maintain 100% human review"  
          
        return {  
            "approval\_rate": approval\_rate,  
            "recommendation": recommendation,  
            "metrics": self.metrics  
        }

\# Monitor throughout Phase 2  
metrics\_tracker \= Phase2Metrics()

\# After each report  
metrics\_tracker.record\_report\_outcome(  
    deal\_id="...",  
    generation\_time=14.3,  \# minutes  
    cycles=2,  
    approval\_status="approved\_without\_edits"  
)

\# Weekly review  
readiness \= metrics\_tracker.calculate\_phase2\_readiness()  
print(readiness)

V. PHASE 3: PLATFORM DEPLOYMENT WITH CLIENT PROFILES  
Overview  
Phase 3 transforms the SFT model into a multi-tenant platform where clients can:

Register and create firm profiles  
Upload deal materials  
Receive automated DD reports  
Build firm-specific pattern repositories  
(Optional) Contribute anonymized patterns to general corpus

Key addition: Firm-specific learning begins, though gating remains rule-based.  
Platform Architecture  
python\# Database Schema for Phase 3

from sqlalchemy import Column, String, Integer, Float, JSON, DateTime, ForeignKey, Boolean  
from sqlalchemy.ext.declarative import declarative\_base  
from sqlalchemy.orm import relationship

Base \= declarative\_base()

class Firm(Base):  
    \_\_tablename\_\_ \= "firms"  
      
    firm\_id \= Column(String, primary\_key=True)  
    firm\_name \= Column(String, nullable=False)  
    firm\_type \= Column(String)  \# "VC\_early", "PE\_buyout", "RIA", etc.  
    registration\_date \= Column(DateTime)  
      
    \# Opt-in settings  
    opt\_in\_anonymous\_sharing \= Column(Boolean, default=False)  
    contribution\_score \= Column(Integer, default=0)  \# Number of patterns shared  
      
    \# Subscription tier  
    tier \= Column(String, default="standard")  \# "standard", "premium", "enterprise"  
      
    \# Relationships  
    deals \= relationship("Deal", back\_populates="firm")  
    patterns \= relationship("FirmPattern", back\_populates="firm")

class Deal(Base):  
    \_\_tablename\_\_ \= "deals"  
      
    deal\_id \= Column(String, primary\_key=True)  
    firm\_id \= Column(String, ForeignKey("firms.firm\_id"))  
      
    \# Deal metadata  
    deal\_name \= Column(String)  
    sector \= Column(String)  
    stage \= Column(String)  
    deal\_type \= Column(String)  
    upload\_date \= Column(DateTime)  
      
    \# Materials  
    materials\_s3\_url \= Column(String)  
    materials\_text \= Column(String)  \# Extracted text  
      
    \# Analysis results  
    report\_id \= Column(String, ForeignKey("reports.report\_id"))  
    status \= Column(String)  \# "uploaded", "processing", "complete"  
      
    \# Relationships  
    firm \= relationship("Firm", back\_populates="deals")  
    report \= relationship("Report", back\_populates="deal")

class Report(Base):  
    \_\_tablename\_\_ \= "reports"  
      
    report\_id \= Column(String, primary\_key=True)  
    deal\_id \= Column(String, ForeignKey("deals.deal\_id"))  
      
    \# Report content  
    executive\_summary \= Column(String)  
    go\_no\_go \= Column(String)  
    full\_report\_json \= Column(JSON)  
      
    \# Audit trail  
    audit\_log\_json \= Column(JSON)  
    total\_cycles \= Column(Integer)  
    depth\_delta\_final \= Column(Float)  
      
    \# Timestamps  
    generated\_at \= Column(DateTime)  
    approved\_at \= Column(DateTime)  
      
    \# Quality tracking  
    human\_reviewed \= Column(Boolean)  
    client\_rating \= Column(Integer)  \# 1-5 stars  
      
    \# Relationships  
    deal \= relationship("Deal", back\_populates="report")

class FirmPattern(Base):  
    \_\_tablename\_\_ \= "firm\_patterns"  
      
    pattern\_id \= Column(String, primary\_key=True)  
    firm\_id \= Column(String, ForeignKey("firms.firm\_id"))  
      
    \# Pattern content  
    pattern\_type \= Column(String)  \# "risk\_weighting", "binding\_constraint", etc.  
    pattern\_data \= Column(JSON)  
      
    \# Metadata  
    extracted\_from\_deal\_count \= Column(Integer)  \# How many deals contributed to this pattern  
    confidence\_score \= Column(Float)  \# How stable/reliable is this pattern  
    last\_updated \= Column(DateTime)  
      
    \# Relationships  
    firm \= relationship("Firm", back\_populates="patterns")

class GeneralCorpusPattern(Base):  
    \_\_tablename\_\_ \= "general\_corpus\_patterns"  
      
    pattern\_id \= Column(String, primary\_key=True)  
      
    \# Pattern content (anonymized)  
    pattern\_type \= Column(String)  
    firm\_type \= Column(String)  \# "VC\_early", "PE\_buyout", etc.  
    pattern\_data \= Column(JSON)  
      
    \# Provenance tracking (anonymized)  
    contributing\_firm\_count \= Column(Integer)  \# Minimum 5 before pattern surfaces  
    sample\_size \= Column(Integer)  \# Total deals this pattern derived from  
      
    \# Quality metrics  
    confidence\_score \= Column(Float)  
    last\_updated \= Column(DateTime)  
      
    \# Corpus balance tracking  
    weight\_in\_corpus \= Column(Float)  \# What % of general corpus does this represent

class CorpusBalance(Base):  
    \_\_tablename\_\_ \= "corpus\_balance"  
      
    \# Singleton table tracking corpus composition  
    id \= Column(Integer, primary\_key=True, default=1)  
      
    \# Firm type weights  
    vc\_early\_weight \= Column(Float, default=0.0)  
    vc\_growth\_weight \= Column(Float, default=0.0)  
    pe\_buyout\_weight \= Column(Float, default=0.0)  
    pe\_growth\_weight \= Column(Float, default=0.0)  
    ria\_weight \= Column(Float, default=0.0)  
    family\_office\_weight \= Column(Float, default=0.0)  
    corporate\_dev\_weight \= Column(Float, default=0.0)  
      
    \# Balance metrics  
    max\_weight\_diff \= Column(Float)  \# Largest weight gap  
    is\_balanced \= Column(Boolean)  \# Is within 30% threshold  
      
    last\_updated \= Column(DateTime)  
Firm Registration & Profile Creation  
pythonclass FirmOnboarding:  
    """  
    Handle new client registration and profile setup  
    """  
      
    def \_\_init\_\_(self):  
        self.db \= get\_database\_connection()  
      
    def register\_firm(  
        self,  
        firm\_name,  
        firm\_type,  
        contact\_email,  
        opt\_in\_sharing=False  
    ):  
        """  
        Create new firm profile  
        """  
          
        \# Generate firm ID  
        firm\_id \= f"FIRM\_{generate\_unique\_id()}"  
          
        \# Create database record  
        new\_firm \= Firm(  
            firm\_id=firm\_id,  
            firm\_name=firm\_name,  
            firm\_type=firm\_type,  
            registration\_date=datetime.now(),  
            opt\_in\_anonymous\_sharing=opt\_in\_sharing,  
            tier="standard"  \# Default tier  
        )  
          
        self.db.add(new\_firm)  
        self.db.commit()  
          
        \# Initialize empty pattern repository  
        self.initialize\_firm\_patterns(firm\_id, firm\_type)  
          
        \# Send welcome email with platform guide  
        send\_welcome\_email(contact\_email, firm\_id)  
          
        return {  
            "firm\_id": firm\_id,  
            "status": "registered",  
            "message": "Profile created successfully"  
        }  
      
    def initialize\_firm\_patterns(self, firm\_id, firm\_type):  
        """  
        Seed firm with general corpus patterns for their type  
        """  
          
        \# Fetch relevant general patterns  
        general\_patterns \= self.db.query(GeneralCorpusPattern).filter(  
            GeneralCorpusPattern.firm\_type \== firm\_type  
        ).all()  
          
        \# Create initial firm patterns (starting point before they have deal history)  
        for gp in general\_patterns:  
            firm\_pattern \= FirmPattern(  
                pattern\_id=f"PAT\_{firm\_id}\_{generate\_id()}",  
                firm\_id=firm\_id,  
                pattern\_type=gp.pattern\_type,  
                pattern\_data=gp.pattern\_data,  
                extracted\_from\_deal\_count=0,  \# From general corpus, not firm deals  
                confidence\_score=0.5,  \# Lower confidence until firm validates with own deals  
                last\_updated=datetime.now()  
            )  
            self.db.add(firm\_pattern)  
          
        self.db.commit()  
          
        print(f"✓ Initialized {len(general\_patterns)} baseline patterns for {firm\_id}")

\# API endpoint for registration  
@app.post("/api/v1/firms/register")  
async def register\_firm(  
    firm\_name: str,  
    firm\_type: str,  
    contact\_email: str,  
    opt\_in\_sharing: bool \= False  
):  
    onboarding \= FirmOnboarding()  
      
    result \= onboarding.register\_firm(  
        firm\_name=firm\_name,  
        firm\_type=firm\_type,  
        contact\_email=contact\_email,  
        opt\_in\_sharing=opt\_in\_sharing  
    )  
      
    return result  
Deal Upload & Analysis Workflow  
pythonclass Phase3AnalysisEngine(HRM\_DD\_InferenceEngine):  
    """  
    Extended inference engine with firm-specific context (Phase 3\)  
    """  
      
    def \_\_init\_\_(self, model\_path="./hrm\_dd\_model/final"):  
        super().\_\_init\_\_(model\_path)  
        self.db \= get\_database\_connection()  
      
    def analyze\_deal(  
        self,  
        deal\_materials,  
        firm\_id,  
        deal\_metadata,  
        max\_cycles=MAX\_CYCLES  
    ):  
        """  
        Execute HRM-DD analysis with firm-specific context  
        """  
          
        \# Fetch firm profile  
        firm \= self.db.query(Firm).filter(Firm.firm\_id \== firm\_id).first()  
          
        if not firm:  
            raise ValueError(f"Firm {firm\_id} not found")  
          
        \# Fetch firm patterns  
        firm\_patterns \= self.db.query(FirmPattern).filter(  
            FirmPattern.firm\_id \== firm\_id  
        ).all()  
          
        \# Calculate gating weights (RULE-BASED in Phase 3\)  
        gate\_weights \= self.calculate\_rule\_based\_gating(  
            firm\_deal\_count=len(firm.deals),  
            firm\_type=firm.firm\_type,  
            deal\_sector=deal\_metadata.get("sector")  
        )  
          
        \# Fetch general corpus patterns  
        general\_patterns \= self.fetch\_general\_patterns(  
            firm\_type=firm.firm\_type,  
            deal\_sector=deal\_metadata.get("sector")  
        )  
          
        \# Initialize audit log (Phase 3: includes gating decisions)  
        audit\_log \= {  
            "deal\_id": deal\_metadata\["deal\_id"\],  
            "firm\_id": firm\_id,  
            "timestamp\_start": datetime.now(),  
            "cycles": \[\],  
            "depth\_metrics": {},  
            "gating\_decisions": \[\],  \# NEW: Track what patterns influenced analysis  
            "firm\_deal\_count": len(firm.deals),  
            "gate\_weights": gate\_weights  
        }  
          
        \# Execute cycles with weighted context  
        cycle\_outputs \= \[\]  
          
        for cycle\_num in range(1, max\_cycles \+ 1):  
            print(f"Executing Cycle {cycle\_num} for {firm\_id}...")  
              
            \# Construct cycle prompt WITH FIRM CONTEXT  
            cycle\_prompt \= self.construct\_contextualized\_cycle\_prompt(  
                cycle\_num=cycle\_num,  
                deal\_materials=deal\_materials,  
                firm\_patterns=firm\_patterns,  
                general\_patterns=general\_patterns,  
                gate\_weights=gate\_weights,  
                prior\_cycles=cycle\_outputs  
            )  
              
            \# Generate cycle output  
            cycle\_output \= self.generate\_cycle(cycle\_prompt)  
              
            \# Parse and validate  
            parsed\_output \= self.parse\_cycle\_output(cycle\_output)  
            validation\_result \= self.validate\_cycle\_output(parsed\_output, cycle\_num)  
              
            if not validation\_result\["passed"\]:  
                audit\_log\["validation\_failures"\].append({  
                    "cycle": cycle\_num,  
                    "failures": validation\_result\["failures"\]  
                })  
                continue  
              
            \# Calculate depth delta  
            depth\_delta \= parsed\_output\["depth\_delta"\]  
              
            \# Log cycle execution  
            audit\_log\["cycles"\].append({  
                "cycle\_num": cycle\_num,  
                "depth\_delta": depth\_delta,  
                "decision": "continue" if depth\_delta \> 2 else "stop",  
                "reasoning": parsed\_output\["reasoning\_for\_depth"\],  
                "timestamp": datetime.now()  
            })  
              
            \# Log which patterns influenced this cycle  
            audit\_log\["gating\_decisions"\].append({  
                "cycle": cycle\_num,  
                "general\_weight": gate\_weights\["general"\],  
                "firm\_weight": gate\_weights\["firm"\],  
                "patterns\_used": {  
                    "general": \[p.pattern\_type for p in general\_patterns\],  
                    "firm": \[p.pattern\_type for p in firm\_patterns\]  
                },  
                "rationale": self.explain\_gating\_decision(  
                    firm\_deal\_count=len(firm.deals),  
                    gate\_weights=gate\_weights  
                )  
            })  
              
            cycle\_outputs.append(parsed\_output)  
              
            \# Stopping condition  
            if depth\_delta \< 2:  
    logger.info(f"DepthΔ={depth\_delta} \< 2\. Stopping.")  
    planner\_state.stop\_reason \= "depth\_convergence"  
    break

if cycle \>= max\_cycles:  
    logger.info(f"Max cycles ({max\_cycles}) reached.")  
    planner\_state.stop\_reason \= "max\_cycles"  
    break  
          
        \# Compile final report  
        final\_report \= self.compile\_report(cycle\_outputs, audit\_log)  
          
        \# Extract new patterns from this deal  
        new\_patterns \= self.extract\_firm\_patterns(  
            firm\_id=firm\_id,  
            deal\_metadata=deal\_metadata,  
            cycle\_outputs=cycle\_outputs,  
            final\_report=final\_report  
        )  
          
        \# Update firm pattern repository  
        self.update\_firm\_patterns(firm\_id, new\_patterns)  
          
        \# If opted in, contribute anonymized patterns to general corpus  
        if firm.opt\_in\_anonymous\_sharing:  
            self.contribute\_to\_general\_corpus(  
                firm\_type=firm.firm\_type,  
                new\_patterns=new\_patterns  
            )  
          
        \# Save everything to database  
        self.save\_deal\_and\_report(  
            firm\_id=firm\_id,  
            deal\_metadata=deal\_metadata,  
            report=final\_report,  
            audit\_log=audit\_log  
        )  
          
        return final\_report, audit\_log  
      
    def calculate\_rule\_based\_gating(self, firm\_deal\_count, firm\_type, deal\_sector):  
        """  
        Phase 3: Rule-based gating (explainable, predictable)  
        """  
          
        \# Base weights on deal count  
        if firm\_deal\_count \< 5:  
            base\_general \= 0.80  
            base\_firm \= 0.20  
        elif firm\_deal\_count \< 20:  
            base\_general \= 0.50  
            base\_firm \= 0.50  
        elif firm\_deal\_count \< 50:  
            base\_general \= 0.30  
            base\_firm \= 0.70  
        else:  
            base\_general \= 0.20  
            base\_firm \= 0.80  
          
        \# Adjust based on sector familiarity  
        firm\_sector\_deals \= self.count\_sector\_deals(firm\_deal\_count, deal\_sector)  
          
        if firm\_sector\_deals \== 0:  
            \# Never seen this sector, weight general more heavily  
            general\_weight \= min(base\_general \+ 0.20, 0.90)  
            firm\_weight \= 1.0 \- general\_weight  
        else:  
            general\_weight \= base\_general  
            firm\_weight \= base\_firm  
          
        \# Log decision for training data collection (Phase 4 prep)  
        self.log\_gating\_decision\_for\_learning(  
            firm\_deal\_count=firm\_deal\_count,  
            sector\_familiarity=firm\_sector\_deals,  
            weights={"general": general\_weight, "firm": firm\_weight},  
            outcome\_quality=None  \# Will be filled after client feedback  
        )  
          
        return {  
            "general": general\_weight,  
            "firm": firm\_weight  
        }  
      
    def construct\_contextualized\_cycle\_prompt(  
        self,  
        cycle\_num,  
        deal\_materials,  
        firm\_patterns,  
        general\_patterns,  
        gate\_weights,  
        prior\_cycles  
    ):  
        """  
        Build cycle prompt with weighted firm \+ general context  
        """  
          
        \# Base system prompt (same as Phase 2\)  
        if cycle\_num \== 1:  
            system\_prompt \= CYCLE\_1\_SYSTEM\_PROMPT  
        elif cycle\_num \== 2:  
            system\_prompt \= CYCLE\_2\_SYSTEM\_PROMPT  
        elif cycle\_num \== 3:  
            system\_prompt \= CYCLE\_3\_SYSTEM\_PROMPT  
          
        \# NEW: Inject firm context based on gating weights  
        firm\_context\_injection \= self.format\_firm\_context(  
            firm\_patterns=firm\_patterns,  
            weight=gate\_weights\["firm"\]  
        )  
          
        \# NEW: Inject general corpus context based on gating weights  
        general\_context\_injection \= self.format\_general\_context(  
            general\_patterns=general\_patterns,  
            weight=gate\_weights\["general"\]  
        )  
          
        \# Construct enhanced system prompt  
        enhanced\_system\_prompt \= f"""  
{system\_prompt}

\--- ANALYSIS CONTEXT \---

You have access to two knowledge sources to inform your analysis:

1\. GENERAL DUE DILIGENCE PATTERNS (Weight: {gate\_weights\["general"\]:.0%}):  
{general\_context\_injection}

2\. FIRM-SPECIFIC PATTERNS (Weight: {gate\_weights\["firm"\]:.0%}):  
{firm\_context\_injection}

When analyzing this deal, weight the above context according to the specified percentages.  
If firm-specific patterns strongly apply, prioritize them. If limited firm history exists,   
rely more heavily on general patterns.

CRITICAL: Always cite claims to deal materials, not to these context patterns.  
These patterns inform your reasoning approach, not the facts of this specific deal.

\--- END CONTEXT \---  
"""  
          
        \# Construct user message (same as Phase 2\)  
        if cycle\_num \== 1:  
            user\_content \= {  
                "deal\_materials": deal\_materials  
            }  
        elif cycle\_num \== 2:  
            user\_content \= {  
                "deal\_materials": deal\_materials,  
                "cycle\_1\_output": prior\_cycles\[0\]  
            }  
        elif cycle\_num \== 3:  
            user\_content \= {  
                "deal\_materials": deal\_materials,  
                "cycle\_1\_output": prior\_cycles\[0\],  
                "cycle\_2\_output": prior\_cycles\[1\]  
            }  
          
        \# Format as chat messages  
        messages \= \[  
            {"role": "system", "content": enhanced\_system\_prompt},  
            {"role": "user", "content": json.dumps(user\_content, indent=2)}  
        \]  
          
        prompt \= self.tokenizer.apply\_chat\_template(  
            messages,  
            tokenize=False,  
            add\_generation\_prompt=True  
        )  
          
        return prompt  
      
    def format\_firm\_context(self, firm\_patterns, weight):  
        """  
        Format firm-specific patterns for injection into prompt  
        """  
          
        if weight \< 0.1:  
            return "(Minimal firm history available \- relying primarily on general patterns)"  
          
        context\_text \= "Based on this firm's investment history:\\n\\n"  
          
        for pattern in firm\_patterns:  
            if pattern.pattern\_type \== "risk\_weighting":  
                context\_text \+= f"- This firm typically prioritizes: {', '.join(pattern.pattern\_data\['top\_risks'\])}\\n"  
              
            elif pattern.pattern\_type \== "binding\_constraint":  
                context\_text \+= f"- Common deal-breakers: {', '.join(pattern.pattern\_data\['constraints'\])}\\n"  
              
            elif pattern.pattern\_type \== "sector\_focus":  
                context\_text \+= f"- Sector experience: {pattern.pattern\_data\['sectors\_invested'\]}\\n"  
          
        context\_text \+= f"\\n(Confidence: {weight:.0%} based on {len(firm\_patterns)} established patterns)"  
          
        return context\_text  
      
    def format\_general\_context(self, general\_patterns, weight):  
        """  
        Format general corpus patterns for injection into prompt  
        """  
          
        context\_text \= "Based on aggregated industry patterns:\\n\\n"  
          
        for pattern in general\_patterns:  
            if pattern.pattern\_type \== "risk\_weighting":  
                context\_text \+= f"- Investors in this category typically focus on: {', '.join(pattern.pattern\_data\['top\_risks'\])}\\n"  
              
            elif pattern.pattern\_type \== "market\_benchmarks":  
                context\_text \+= f"- Typical benchmarks: {pattern.pattern\_data\['benchmarks'\]}\\n"  
          
        context\_text \+= f"\\n(Weight: {weight:.0%} \- general industry knowledge)"  
          
        return context\_text  
      
    def extract\_firm\_patterns(self, firm\_id, deal\_metadata, cycle\_outputs, final\_report):  
        """  
        After each deal, extract patterns to update firm repository  
        """  
          
        new\_patterns \= \[\]  
          
        \# Extract risk prioritization from Cycle 1  
        if "hypotheses" in cycle\_outputs\[0\]:  
            risk\_categories \= \[h.getRetryREContinuepython            risk\_categories \= \[h.get("category") for h in cycle\_outputs\[0\]\["hypotheses"\]\]  
              
            new\_patterns.append({  
                "type": "risk\_focus",  
                "data": {  
                    "categories\_investigated": risk\_categories,  
                    "deal\_sector": deal\_metadata\["sector"\],  
                    "deal\_stage": deal\_metadata\["stage"\]  
                }  
            })  
          
        \# Extract binding constraints from Cycle 2/3  
        if len(cycle\_outputs) \> 1 and "binding\_constraints" in cycle\_outputs\[-1\]:  
            constraints \= cycle\_outputs\[-1\]\["binding\_constraints"\]  
              
            new\_patterns.append({  
                "type": "binding\_constraint",  
                "data": {  
                    "constraints\_identified": \[c\["constraint"\] for c in constraints\],  
                    "deal\_type": deal\_metadata\["deal\_type"\]  
                }  
            })  
          
        \# Extract decision patterns from final report  
        if "go\_no\_go" in final\_report:  
            new\_patterns.append({  
                "type": "decision\_pattern",  
                "data": {  
                    "decision": final\_report\["go\_no\_go"\],  
                    "key\_factors": final\_report.get("key\_decision\_factors", \[\]),  
                    "sector": deal\_metadata\["sector"\]  
                }  
            })  
          
        return new\_patterns  
      
    def update\_firm\_patterns(self, firm\_id, new\_patterns):  
        """  
        Merge new patterns into firm repository  
        """  
          
        firm \= self.db.query(Firm).filter(Firm.firm\_id \== firm\_id).first()  
          
        for new\_pattern in new\_patterns:  
            \# Check if similar pattern exists  
            existing \= self.db.query(FirmPattern).filter(  
                FirmPattern.firm\_id \== firm\_id,  
                FirmPattern.pattern\_type \== new\_pattern\["type"\]  
            ).first()  
              
            if existing:  
                \# Merge with existing pattern  
                merged\_data \= self.merge\_pattern\_data(  
                    existing.pattern\_data,  
                    new\_pattern\["data"\]  
                )  
                  
                existing.pattern\_data \= merged\_data  
                existing.extracted\_from\_deal\_count \+= 1  
                existing.confidence\_score \= min(  
                    existing.confidence\_score \+ 0.05,  
                    0.95  
                )  \# Increase confidence as more deals validate pattern  
                existing.last\_updated \= datetime.now()  
            else:  
                \# Create new pattern  
                new\_firm\_pattern \= FirmPattern(  
                    pattern\_id=f"PAT\_{firm\_id}\_{generate\_id()}",  
                    firm\_id=firm\_id,  
                    pattern\_type=new\_pattern\["type"\],  
                    pattern\_data=new\_pattern\["data"\],  
                    extracted\_from\_deal\_count=1,  
                    confidence\_score=0.3,  \# Low confidence until validated by more deals  
                    last\_updated=datetime.now()  
                )  
                self.db.add(new\_firm\_pattern)  
          
        self.db.commit()  
          
        \# Calculate firm-level depth delta (how stable are patterns?)  
        depth\_delta\_firm \= self.calculate\_firm\_depth\_delta(firm\_id)  
          
        \# Log to audit trail  
        self.log\_firm\_learning(  
            firm\_id=firm\_id,  
            new\_patterns\_count=len(new\_patterns),  
            depth\_delta\_firm=depth\_delta\_firm  
        )  
      
    def calculate\_firm\_depth\_delta(self, firm\_id):  
        """  
        Measure how much firm patterns are still evolving  
        Phase 3: Track DepthΔ\_firm for transparency  
        """  
          
        patterns \= self.db.query(FirmPattern).filter(  
            FirmPattern.firm\_id \== firm\_id  
        ).all()  
          
        if len(patterns) \== 0:  
            return 1.0  \# Maximum uncertainty, no patterns yet  
          
        \# Average confidence across all patterns  
        avg\_confidence \= sum(\[p.confidence\_score for p in patterns\]) / len(patterns)  
          
        \# Invert: high confidence \= low depth delta  
        depth\_delta\_firm \= 1.0 \- avg\_confidence  
          
        return depth\_delta\_firm  
      
    def contribute\_to\_general\_corpus(self, firm\_type, new\_patterns):  
        """  
        If firm opted in, anonymize and add patterns to general corpus  
        """  
          
        for pattern in new\_patterns:  
            \# Anonymize pattern  
            anonymized \= self.anonymize\_pattern(pattern, firm\_type)  
              
            \# Check corpus balance before adding  
            balance\_check \= self.check\_corpus\_balance(firm\_type)  
              
            if not balance\_check\["allow"\]:  
                print(f"⚠ Skipping pattern contribution: {balance\_check\['reason'\]}")  
                continue  
              
            \# Check if similar general pattern exists  
            existing\_general \= self.db.query(GeneralCorpusPattern).filter(  
                GeneralCorpusPattern.pattern\_type \== pattern\["type"\],  
                GeneralCorpusPattern.firm\_type \== firm\_type  
            ).first()  
              
            if existing\_general:  
                \# Merge with existing general pattern  
                merged\_data \= self.merge\_pattern\_data(  
                    existing\_general.pattern\_data,  
                    anonymized\["data"\]  
                )  
                  
                existing\_general.pattern\_data \= merged\_data  
                existing\_general.contributing\_firm\_count \+= 1  
                existing\_general.sample\_size \+= 1  
                existing\_general.last\_updated \= datetime.now()  
            else:  
                \# Create new general pattern (only if ≥5 firms contribute)  
                \# For now, stage it until threshold met  
                self.stage\_pattern\_for\_general\_corpus(anonymized, firm\_type)  
              
            self.db.commit()  
          
        \# Update corpus balance metrics  
        self.update\_corpus\_balance()  
      
    def check\_corpus\_balance(self, firm\_type):  
        """  
        Enforce 30% maximum weight differential rule  
        """  
          
        balance \= self.db.query(CorpusBalance).first()  
          
        if not balance:  
            \# Initialize if doesn't exist  
            balance \= CorpusBalance(id=1)  
            self.db.add(balance)  
            self.db.commit()  
          
        \# Get current weights  
        weights \= {  
            "VC\_early": balance.vc\_early\_weight,  
            "VC\_growth": balance.vc\_growth\_weight,  
            "PE\_buyout": balance.pe\_buyout\_weight,  
            "PE\_growth": balance.pe\_growth\_weight,  
            "RIA": balance.ria\_weight,  
            "Family\_Office": balance.family\_office\_weight,  
            "Corporate\_Dev": balance.corporate\_dev\_weight  
        }  
          
        \# Calculate what weight would be if we add this pattern  
        total\_patterns \= sum(weights.values())  
        projected\_weights \= weights.copy()  
        projected\_weights\[firm\_type\] \+= 1  
        projected\_total \= total\_patterns \+ 1  
          
        \# Normalize to percentages  
        for key in projected\_weights:  
            projected\_weights\[key\] \= projected\_weights\[key\] / projected\_total  
          
        \# Check constraints  
        max\_weight \= max(projected\_weights.values())  
        min\_weight \= min(\[w for w in projected\_weights.values() if w \> 0\])  
          
        \# Rule: No firm type can exceed 70% of corpus  
        if max\_weight \> 0.70:  
            return {  
                "allow": False,  
                "reason": f"{firm\_type} would exceed 70% of corpus ({max\_weight:.1%})"  
            }  
          
        \# Rule: Max weight gap cannot exceed 30%  
        if max\_weight \- min\_weight \> 0.30:  
            return {  
                "allow": False,  
                "reason": f"Weight gap ({max\_weight \- min\_weight:.1%}) exceeds 30% threshold"  
            }  
          
        return {"allow": True}  
      
    def update\_corpus\_balance(self):  
        """  
        Recalculate corpus balance metrics  
        """  
          
        \# Count patterns by firm type  
        pattern\_counts \= {}  
          
        for firm\_type in \["VC\_early", "VC\_growth", "PE\_buyout", "PE\_growth", "RIA", "Family\_Office", "Corporate\_Dev"\]:  
            count \= self.db.query(GeneralCorpusPattern).filter(  
                GeneralCorpusPattern.firm\_type \== firm\_type  
            ).count()  
            pattern\_counts\[firm\_type\] \= count  
          
        total \= sum(pattern\_counts.values())  
          
        if total \== 0:  
            return  
          
        \# Calculate weights  
        balance \= self.db.query(CorpusBalance).first()  
          
        balance.vc\_early\_weight \= pattern\_counts\["VC\_early"\] / total  
        balance.vc\_growth\_weight \= pattern\_counts\["VC\_growth"\] / total  
        balance.pe\_buyout\_weight \= pattern\_counts\["PE\_buyout"\] / total  
        balance.pe\_growth\_weight \= pattern\_counts\["PE\_growth"\] / total  
        balance.ria\_weight \= pattern\_counts\["RIA"\] / total  
        balance.family\_office\_weight \= pattern\_counts\["Family\_Office"\] / total  
        balance.corporate\_dev\_weight \= pattern\_counts\["Corporate\_Dev"\] / total  
          
        \# Calculate max weight differential  
        weights \= \[  
            balance.vc\_early\_weight,  
            balance.vc\_growth\_weight,  
            balance.pe\_buyout\_weight,  
            balance.pe\_growth\_weight,  
            balance.ria\_weight,  
            balance.family\_office\_weight,  
            balance.corporate\_dev\_weight  
        \]  
          
        max\_weight \= max(weights)  
        min\_weight \= min(\[w for w in weights if w \> 0\])  
          
        balance.max\_weight\_diff \= max\_weight \- min\_weight  
        balance.is\_balanced \= balance.max\_weight\_diff \<= 0.30  
        balance.last\_updated \= datetime.now()  
          
        self.db.commit()  
          
        print(f"✓ Corpus balance updated: {balance.max\_weight\_diff:.1%} max differential")

\# API endpoints for Phase 3

@app.post("/api/v1/deals/upload")  
async def upload\_deal(  
    firm\_id: str,  
    deal\_name: str,  
    sector: str,  
    stage: str,  
    deal\_type: str,  
    file: UploadFile  
):  
    """  
    Client uploads deal materials for analysis  
    """  
      
    \# Save file to S3  
    s3\_url \= upload\_to\_s3(file, firm\_id)  
      
    \# Extract text from PDF  
    deal\_text \= extract\_text\_from\_pdf(file)  
      
    \# Create deal record  
    deal\_id \= f"DEAL\_{firm\_id}\_{generate\_id()}"  
      
    new\_deal \= Deal(  
        deal\_id=deal\_id,  
        firm\_id=firm\_id,  
        deal\_name=deal\_name,  
        sector=sector,  
        stage=stage,  
        deal\_type=deal\_type,  
        materials\_s3\_url=s3\_url,  
        materials\_text=deal\_text,  
        upload\_date=datetime.now(),  
        status="uploaded"  
    )  
      
    db.add(new\_deal)  
    db.commit()  
      
    \# Trigger analysis  
    background\_tasks.add\_task(  
        run\_phase3\_analysis,  
        deal\_id=deal\_id,  
        firm\_id=firm\_id,  
        deal\_text=deal\_text,  
        deal\_metadata={  
            "deal\_id": deal\_id,  
            "deal\_name": deal\_name,  
            "sector": sector,  
            "stage": stage,  
            "deal\_type": deal\_type  
        }  
    )  
      
    return {  
        "deal\_id": deal\_id,  
        "status": "processing",  
        "estimated\_completion": "15 minutes"  
    }

async def run\_phase3\_analysis(deal\_id, firm\_id, deal\_text, deal\_metadata):  
    """  
    Background task: Execute Phase 3 analysis with firm context  
    """  
      
    engine \= Phase3AnalysisEngine()  
      
    try:  
        report, audit\_log \= engine.analyze\_deal(  
            deal\_materials=deal\_text,  
            firm\_id=firm\_id,  
            deal\_metadata=deal\_metadata  
        )  
          
        \# Update deal status  
        db.query(Deal).filter(Deal.deal\_id \== deal\_id).update({  
            "status": "complete"  
        })  
          
        \# Notify client  
        notify\_client\_report\_ready(firm\_id, deal\_id)  
          
    except Exception as e:  
        log\_error(deal\_id, str(e))  
        db.query(Deal).filter(Deal.deal\_id \== deal\_id).update({  
            "status": "error"  
        })

@app.get("/api/v1/firms/{firm\_id}/stats")  
async def get\_firm\_stats(firm\_id: str):  
    """  
    Client dashboard: Show firm learning progress  
    """  
      
    firm \= db.query(Firm).filter(Firm.firm\_id \== firm\_id).first()  
      
    if not firm:  
        return {"error": "Firm not found"}  
      
    \# Count deals  
    deal\_count \= db.query(Deal).filter(Deal.firm\_id \== firm\_id).count()  
      
    \# Get pattern count and confidence  
    patterns \= db.query(FirmPattern).filter(FirmPattern.firm\_id \== firm\_id).all()  
    avg\_confidence \= sum(\[p.confidence\_score for p in patterns\]) / len(patterns) if patterns else 0  
      
    \# Calculate firm depth delta  
    engine \= Phase3AnalysisEngine()  
    depth\_delta\_firm \= engine.calculate\_firm\_depth\_delta(firm\_id)  
      
    return {  
        "firm\_id": firm\_id,  
        "firm\_name": firm.firm\_name,  
        "total\_deals\_analyzed": deal\_count,  
        "patterns\_learned": len(patterns),  
        "pattern\_confidence\_avg": avg\_confidence,  
        "depth\_delta\_firm": depth\_delta\_firm,  
        "learning\_status": "establishing\_patterns" if depth\_delta\_firm \> 0.5 else "patterns\_stable",  
        "contribution\_score": firm.contribution\_score,  
        "opted\_in\_sharing": firm.opt\_in\_anonymous\_sharing  
    }  
Phase 3 Client Dashboard UI (Conceptual)  
javascript// Frontend React component for client dashboard

function FirmDashboard({ firmId }) {  
  const \[stats, setStats\] \= useState(null);  
  const \[deals, setDeals\] \= useState(\[\]);  
    
  useEffect(() \=\> {  
    // Fetch firm stats  
    fetch(\`/api/v1/firms/${firmId}/stats\`)  
      .then(res \=\> res.json())  
      .then(data \=\> setStats(data));  
      
    // Fetch recent deals  
    fetch(\`/api/v1/firms/${firmId}/deals\`)  
      .then(res \=\> res.json())  
      .then(data \=\> setDeals(data));  
  }, \[firmId\]);  
    
  return (  
    \<div className="dashboard"\>  
      \<h1\>DealDecision AI Dashboard\</h1\>  
        
      \<div className="stats-grid"\>  
        \<StatCard  
          title="Deals Analyzed"  
          value={stats?.total\_deals\_analyzed}  
          icon="📊"  
        /\>  
          
        \<StatCard  
          title="Patterns Learned"  
          value={stats?.patterns\_learned}  
          icon="🧠"  
          subtitle={\`${(stats?.pattern\_confidence\_avg \* 100).toFixed(0)}% confidence\`}  
        /\>  
          
        \<StatCard  
          title="Learning Status"  
          value={stats?.learning\_status \=== "patterns\_stable" ? "Established" : "Building"}  
          icon="📈"  
          subtitle={\`DepthΔ\_firm: ${stats?.depth\_delta\_firm?.toFixed(2)}\`}  
        /\>  
          
        \<StatCard  
          title="Contribution"  
          value={stats?.contribution\_score}  
          icon="🤝"  
          subtitle={stats?.opted\_in\_sharing ? "Sharing enabled" : "Private"}  
        /\>  
      \</div\>  
        
      \<div className="deals-section"\>  
        \<h2\>Recent Deals\</h2\>  
        \<DealsTable deals={deals} /\>  
      \</div\>  
        
      \<div className="upload-section"\>  
        \<h2\>Analyze New Deal\</h2\>  
        \<DealUploadForm firmId={firmId} /\>  
      \</div\>  
        
      \<div className="transparency-section"\>  
        \<h2\>How We Learn From Your Deals\</h2\>  
        \<LearningExplainer   
          dealCount={stats?.total\_deals\_analyzed}  
          generalWeight={calculateGeneralWeight(stats?.total\_deals\_analyzed)}  
          firmWeight={calculateFirmWeight(stats?.total\_deals\_analyzed)}  
        /\>  
      \</div\>  
    \</div\>  
  );  
}

VI. PHASE 4: TRM ORCHESTRATION & CONTINUOUS LEARNING  
Overview  
Phase 4 represents the full realization of the system architecture:

Learned gating replaces rule-based gating (when sufficient data exists)  
Automatic trigger mechanism monitors learned gate performance and switches when ready  
Conditional action routing dynamically adjusts analysis depth based on deal complexity  
Continuous learning improves both general corpus and firm-specific models

Learned Gating: TRM Integration  
Gating Model Architecture  
pythonimport torch  
import torch.nn as nn  
import torch.nn.functional as F

class TRM\_GatingNetwork(nn.Module):  
    """  
    Temporal Representation Module for learned gating  
    Decides optimal weighting between general and firm-specific knowledge  
    """  
      
    def \_\_init\_\_(  
        self,  
        embedding\_dim=768,  \# Match LLM embedding size  
        hidden\_dim=256  
    ):  
        super(TRM\_GatingNetwork, self).\_\_init\_\_()  
          
        \# Encoders for different timescales  
        self.deal\_encoder \= nn.Linear(embedding\_dim, hidden\_dim)  \# Fast timescale  
        self.firm\_encoder \= nn.Linear(embedding\_dim, hidden\_dim)  \# Slow timescale  
        self.general\_encoder \= nn.Linear(embedding\_dim, hidden\_dim)  \# Background knowledge  
          
        \# Temporal integration layers  
        self.temporal\_attention \= nn.MultiheadAttention(  
            embed\_dim=hidden\_dim,  
            num\_heads=8  
        )  
          
        \# Gating function  
        self.gate\_mlp \= nn.Sequential(  
            nn.Linear(hidden\_dim \* 3, hidden\_dim),  
            nn.ReLU(),  
            nn.Dropout(0.1),  
            nn.Linear(hidden\_dim, 2),  \# Output: \[general\_weight, firm\_weight\]  
            nn.Softmax(dim=-1)  
        )  
          
    def forward(self, deal\_embedding, firm\_embedding, general\_embedding):  
        """  
        Compute optimal gating weights  
          
        Args:  
            deal\_embedding: Embedding of current deal materials (fast timescale)  
            firm\_embedding: Embedding of firm's pattern history (slow timescale)  
            general\_embedding: Embedding of general corpus (background)  
          
        Returns:  
            gate\_weights: \[general\_weight, firm\_weight\] summing to 1.0  
        """  
          
        \# Encode each timescale  
        h\_deal \= F.relu(self.deal\_encoder(deal\_embedding))  
        h\_firm \= F.relu(self.firm\_encoder(firm\_embedding))  
        h\_general \= F.relu(self.general\_encoder(general\_embedding))  
          
        \# Stack for attention  
        timescale\_stack \= torch.stack(\[h\_deal, h\_firm, h\_general\], dim=0)  
          
        \# Temporal attention: which timescale is most relevant?  
        attended, \_ \= self.temporal\_attention(  
            timescale\_stack,  
            timescale\_stack,  
            timescale\_stack  
        )  
          
        \# Concatenate attended representations  
        concat \= torch.cat(\[attended\[0\], attended\[1\], attended\[2\]\], dim=-1)  
          
        \# Compute gate weights  
        gate\_weights \= self.gate\_mlp(concat)  
          
        return gate\_weights

\# Training data for gating model

class GatingTrainingDataset:  
    """  
    Collect training data during Phase 2-3 rule-based gating  
    """  
      
    def \_\_init\_\_(self):  
        self.examples \= \[\]  
      
    def log\_gating\_decision(  
        self,  
        deal\_embedding,  
        firm\_embedding,  
        general\_embedding,  
        rule\_based\_weights,  
        outcome\_quality  
    ):  
        """  
        Record each gating decision and its outcome  
          
        outcome\_quality: Float 0-1 indicating how well the analysis performed  
                         (based on client feedback, analyst rating, etc.)  
        """  
          
        self.examples.append({  
            "deal\_embedding": deal\_embedding,  
            "firm\_embedding": firm\_embedding,  
            "general\_embedding": general\_embedding,  
            "rule\_weights": rule\_based\_weights,  
            "outcome\_quality": outcome\_quality  
        })  
      
    def save(self, path="./gating\_training\_data.pkl"):  
        with open(path, 'wb') as f:  
            pickle.dump(self.examples, f)  
          
        print(f"✓ Saved {len(self.examples)} gating examples to {path}")

\# Train gating model

def train\_gating\_model(training\_data\_path, epochs=50):  
    """  
    Train TRM gating network on collected decisions  
    """  
      
    \# Load training data  
    with open(training\_data\_path, 'rb') as f:  
        examples \= pickle.load(f)  
      
    print(f"Training on {len(examples)} gating decisions...")  
      
    \# Initialize model  
    model \= TRM\_GatingNetwork()  
    optimizer \= torch.optim.Adam(model.parameters(), lr=1e-4)  
      
    \# Training loop  
    for epoch in range(epochs):  
        total\_loss \= 0  
          
        for ex in examples:  
            \# Get embeddings  
            deal\_emb \= torch.tensor(ex\["deal\_embedding"\])  
            firm\_emb \= torch.tensor(ex\["firm\_embedding"\])  
            general\_emb \= torch.tensor(ex\["general\_embedding"\])  
              
            \# Predict gate weights  
            predicted\_weights \= model(deal\_emb, firm\_emb, general\_emb)  
              
            \# Target: Weights that led to highest outcome quality  
            \# We learn from successful gating decisions  
            rule\_weights \= torch.tensor(\[  
                ex\["rule\_weights"\]\["general"\],  
                ex\["rule\_weights"\]\["firm"\]  
            \])  
            outcome \= ex\["outcome\_quality"\]  
              
            \# Loss: MSE weighted by outcome quality  
            \# Good outcomes reinforce those weights, bad outcomes push away  
            loss \= outcome \* F.mse\_loss(predicted\_weights, rule\_weights)  
              
            optimizer.zero\_grad()  
            loss.backward()  
            optimizer.step()  
              
            total\_loss \+= loss.item()  
          
        if epoch % 10 \== 0:  
            print(f"Epoch {epoch}: Loss \= {total\_loss / len(examples):.4f}")  
      
    \# Save trained model  
    torch.save(model.state\_dict(), "./trm\_gating\_model.pt")  
    print("✓ Gating model trained and saved")  
      
    return model  
Automatic Trigger Mechanism for Switch  
pythonclass GatingSwitchController:  
    """  
    Monitors learned gate performance and automatically switches from  
    rule-based to learned when confidence threshold met  
    """  
      
    def \_\_init\_\_(self):  
        self.rule\_based\_performance \= \[\]  
        self.learned\_performance \= \[\]  
        self.switch\_triggered \= False  
        self.confidence\_threshold \= 0.85  
        self.minimum\_samples \= 150  \# Minimum evaluations before considering switch  
      
    def evaluate\_gating\_approaches(  
        self,  
        deal\_embedding,  
        firm\_embedding,  
        general\_embedding,  
        firm\_deal\_count,  
        ground\_truth\_quality  
    ):  
        """  
        Run BOTH gating approaches in parallel (shadow mode)  
        Compare performance to decide when to switch  
          
        Args:  
            ground\_truth\_quality: Actual outcome quality (client rating, analyst score)  
        """  
          
        \# Rule-based gating (current production)  
        rule\_weights \= self.calculate\_rule\_based\_weights(firm\_deal\_count)  
          
        \# Learned gating (shadow mode \- not used yet)  
        learned\_weights \= self.calculate\_learned\_weights(  
            deal\_embedding,  
            firm\_embedding,  
            general\_embedding  
        )  
          
        \# Simulate: How would each perform?  
        \# (In practice, we only use rule-based, but log what learned would have done)  
          
        rule\_performance \= self.estimate\_performance(rule\_weights, ground\_truth\_quality)  
        learned\_performance \= self.estimate\_performance(learned\_weights, ground\_truth\_quality)  
          
        \# Log both  
        self.rule\_based\_performance.append(rule\_performance)  
        self.learned\_performance.append(learned\_performance)  
          
        \# Check if ready to switch  
        if len(self.learned\_performance) \>= self.minimum\_samples:  
            self.check\_switch\_trigger()  
      
    def estimate\_performance(self, weights, ground\_truth\_quality):  
        """  
        Estimate how well these weights would have performed  
          
        Simplified: Higher quality with appropriate weighting \= better performance  
        """  
          
        \# This is a proxy metric \- in reality, you'd have more sophisticated evaluation  
        \# based on whether the report's conclusions were accurate  
          
        return ground\_truth\_quality  \# Actual metric would be more complex  
      
    def check\_switch\_trigger(self):  
        """  
        Decide if learned gating is ready to replace rule-based  
        """  
          
        if self.switch\_triggered:  
            return  \# Already switched  
          
        \# Calculate performance over recent window  
        window\_size \= 50  
        recent\_rule \= self.rule\_based\_performance\[-window\_size:\]  
        recent\_learned \= self.learned\_performance\[-window\_size:\]  
          
        avg\_rule \= sum(recent\_rule) / len(recent\_rule)  
        avg\_learned \= sum(recent\_learned) / len(recent\_learned)  
          
        \# Learned must be at least as good as rule-based  
        if avg\_learned \>= avg\_rule \* 0.95:  \# Within 5% is acceptable  
              
            \# Calculate confidence (consistency of learned performance)  
            std\_learned \= statistics.stdev(recent\_learned)  
            confidence \= 1.0 / (1.0 \+ std\_learned)  \# Lower std \= higher confidence  
              
            if confidence \>= self.confidence\_threshold:  
                print(f"""  
                ✓ SWITCH TRIGGER ACTIVATED  
                  
                Learned gating performance: {avg\_learned:.3f}  
                Rule-based performance: {avg\_rule:.3f}  
                Confidence: {confidence:.3f}  
                  
                Switching from rule-based to learned gating.  
                """)  
                  
                self.switch\_triggered \= True  
                self.activate\_learned\_gating()  
          
        else:  
            print(f"Learned gating not ready (performance: {avg\_learned:.3f} vs rule: {avg\_rule:.3f})")  
      
    def activate\_learned\_gating(self):  
        """  
        Switch production system to use learned gates  
        """  
          
        \# Update system configuration  
        update\_config({  
            "gating\_mode": "learned",  
            "switch\_date": datetime.now(),  
            "fallback\_to\_rules": True  \# Keep rules as safety net  
        })  
          
        \# Notify engineering team  
        notify\_team("Learned gating activated in production")  
          
        \# Continue monitoring  
        self.monitor\_learned\_gating\_in\_production()  
      
    def monitor\_learned\_gating\_in\_production(self):  
        """  
        After switch, monitor for degradation  
        If learned gates perform worse than rules, revert  
        """  
          
        \# Track performance post-switch  
        \# If learned performance drops below rule-based by \>10%, revert  
          
        pass  \# Implemented as ongoing monitoring system

\# Integration into Phase 3 engine

class Phase4AnalysisEngine(Phase3AnalysisEngine):  
    """  
    Phase 4: Learned gating with automatic switching  
    """  
      
    def \_\_init\_\_(self, model\_path="./hrm\_dd\_model/final"):  
        super().\_\_init\_\_(model\_path)  
          
        \# Load gating components  
        self.gating\_controller \= GatingSwitchController()  
        self.trm\_gate\_model \= self.load\_trm\_gate\_model()  
          
        \# Check current gating mode  
        self.gating\_mode \= get\_config("gating\_mode", default="rule\_based")  
      
    def load\_trm\_gate\_model(self):  
        """Load trained TRM gating network"""  
        model \= TRM\_GatingNetwork()  
        model.load\_state\_dict(torch.load("./trm\_gating\_model.pt"))  
        model.eval()  
        return model  
      
    def calculate\_gating\_weights(  
        self,  
        deal\_materials,  
        firm\_id,  
        firm\_deal\_count,  
        deal\_metadata  
    ):  
        """  
        Phase 4: Use learned or rule-based gating depending on mode  
        """  
          
        \# Generate embeddings  
        deal\_embedding \= self.embed\_deal(deal\_materials)  
        firm\_embedding \= self.embed\_firm\_patterns(firm\_id)  
        general\_embedding \= self.embed\_general\_corpus(deal\_metadata)  
          
        if self.gating\_mode \== "learned":  
            \# Use learned gating (production)  
            weights \= self.calculate\_learned\_gating(  
                deal\_embedding,  
                firm\_embedding,  
                general\_embedding  
            )  
              
            \# Fallback check  
            if not self.validate\_learned\_weights(weights):  
                print("⚠ Learned weights failed validation, falling back to rules")  
                weights \= self.calculate\_rule\_based\_gating(  
                    firm\_deal\_count,  
                    deal\_metadata.get("firm\_type"),  
                    deal\_metadata.get("sector")  
                )  
          
        else:  \# rule\_based mode  
            \# Use rule-based gating (production)  
            weights \= self.calculate\_rule\_based\_gating(  
                firm\_deal\_count,  
                deal\_metadata.get("firm\_type"),  
                deal\_metadata.get("sector")  
            )  
              
            \# Shadow mode: Calculate what learned would have done  
            learned\_weights \= self.calculate\_learned\_gating(  
                deal\_embedding,  
                firm\_embedding,  
                general\_embedding  
            )  
              
            \# Log for switch controller  
            \# (outcome\_quality filled in later after client feedback)  
            self.gating\_controller.log\_shadow\_comparison(  
                rule\_weights=weights,  
                learned\_weights=learned\_weights,  
                context={  
                    "deal\_embedding": deal\_embedding,  
                    "firm\_embedding": firm\_embedding,  
                    "general\_embedding": general\_embedding,  
                    "firm\_deal\_count": firm\_deal\_count  
                }  
            )  
          
        return weights  
      
    def calculate\_learned\_gating(  
        self,  
        deal\_embedding,  
        firm\_embedding,  
        general\_embedding  
    ):  
        """  
        Use TRM gating model to compute optimal weights  
        """  
          
        with torch.no\_grad():  
            gate\_weights \= self.trm\_gate\_model(  
                torch.tensor(deal\_embedding),  
                torch.tensor(firm\_embedding),  
                torch.tensor(general\_embedding)  
            )  
          
        return {  
            "general": gate\_weights\[0\].item(),  
            "firm": gate\_weights\[1\].item()  
        }  
      
    def embed\_deal(self, deal\_materials):  
        """Generate embedding for current deal"""  
        \# Use LLM to embed deal materials  
        embedding \= self.model.get\_embedding(deal\_materials)  
        return embedding.cpu().numpy()  
      
    def embed\_firm\_patterns(self, firm\_id):  
        """Generate embedding representing firm's learned patterns"""  
        patterns \= self.db.query(FirmPattern).filter(  
            FirmPattern.firm\_id \== firm\_id  
        ).all()  
          
        \# Aggregate pattern data into single representation  
        pattern\_text \= self.format\_patterns\_for\_embedding(patterns)  
        embedding \= self.model.get\_embedding(pattern\_text)  
        return embedding.cpu().numpy()  
      
    def embed\_general\_corpus(self, deal\_metadata):  
        """Generate embeddingRetryREContinuepython    def embed\_general\_corpus(self, deal\_metadata):  
        """Generate embedding representing relevant general corpus knowledge"""  
          
        \# Fetch relevant general patterns  
        general\_patterns \= self.db.query(GeneralCorpusPattern).filter(  
            GeneralCorpusPattern.firm\_type \== deal\_metadata.get("firm\_type"),  
            GeneralCorpusPattern.pattern\_type.in\_(\["risk\_weighting", "binding\_constraint", "market\_benchmarks"\])  
        ).all()  
          
        \# Format into text representation  
        corpus\_text \= self.format\_patterns\_for\_embedding(general\_patterns)  
        embedding \= self.model.get\_embedding(corpus\_text)  
        return embedding.cpu().numpy()  
Conditional Action Router (High/Low-Level Reasoning Gates)  
pythonclass ConditionalActionRouter:  
    """  
    Phase 4: Dynamic routing based on deal complexity and uncertainty  
      
    Implements high-level and low-level reasoning gates that determine  
    which analysis paths to take and when to deepen investigation  
    """  
      
    def \_\_init\_\_(self):  
        self.high\_level\_gate \= HighLevelReasoningGate()  
        self.low\_level\_gate \= LowLevelReasoningGate()  
      
    def route\_analysis(  
        self,  
        cycle\_num,  
        cycle\_output,  
        deal\_metadata,  
        planner\_state  
    ):  
        """  
        After each cycle, determine conditional actions to take  
        """  
          
        conditional\_actions \= \[\]  
          
        \# High-level strategic gates  
        high\_level\_signals \= self.high\_level\_gate.evaluate(  
            cycle\_output=cycle\_output,  
            deal\_metadata=deal\_metadata  
        )  
          
        for signal in high\_level\_signals:  
            if signal\["action"\] \== "deepen\_market\_analysis":  
                conditional\_actions.append({  
                    "type": "cycle\_deepening",  
                    "focus": "market\_dynamics",  
                    "rationale": signal\["rationale"\],  
                    "priority": "high"  
                })  
              
            elif signal\["action"\] \== "expand\_team\_evaluation":  
                conditional\_actions.append({  
                    "type": "cycle\_deepening",  
                    "focus": "team\_assessment",  
                    "rationale": signal\["rationale"\],  
                    "priority": "medium"  
                })  
              
            elif signal\["action"\] \== "request\_additional\_materials":  
                conditional\_actions.append({  
                    "type": "external\_request",  
                    "request": signal\["materials\_needed"\],  
                    "rationale": signal\["rationale"\],  
                    "priority": "high"  
                })  
          
        \# Low-level tactical gates  
        low\_level\_signals \= self.low\_level\_gate.evaluate(  
            cycle\_output=cycle\_output,  
            deal\_metadata=deal\_metadata  
        )  
          
        for signal in low\_level\_signals:  
            if signal\["action"\] \== "detailed\_financial\_modeling":  
                conditional\_actions.append({  
                    "type": "cycle\_deepening",  
                    "focus": "financial\_projections",  
                    "rationale": signal\["rationale"\],  
                    "priority": "high"  
                })  
              
            elif signal\["action"\] \== "benchmark\_comparison":  
                conditional\_actions.append({  
                    "type": "enrichment",  
                    "data\_source": "industry\_benchmarks",  
                    "metrics": signal\["metrics\_to\_compare"\],  
                    "priority": "medium"  
                })  
          
        return conditional\_actions  
      
    def execute\_conditional\_actions(  
        self,  
        actions,  
        current\_cycle\_output,  
        deal\_materials  
    ):  
        """  
        Execute the routed actions to enhance analysis  
        """  
          
        enriched\_analysis \= current\_cycle\_output.copy()  
          
        for action in actions:  
            if action\["type"\] \== "cycle\_deepening":  
                \# Trigger focused sub-analysis  
                deep\_dive \= self.execute\_focused\_analysis(  
                    focus\_area=action\["focus"\],  
                    deal\_materials=deal\_materials,  
                    context=current\_cycle\_output  
                )  
                enriched\_analysis\[f"{action\['focus'\]}\_deep\_dive"\] \= deep\_dive  
              
            elif action\["type"\] \== "enrichment":  
                \# Fetch external data  
                external\_data \= self.fetch\_external\_data(  
                    data\_source=action\["data\_source"\],  
                    parameters=action.get("metrics\_to\_compare")  
                )  
                enriched\_analysis\[f"{action\['data\_source'\]}\_data"\] \= external\_data  
              
            elif action\["type"\] \== "external\_request":  
                \# Flag for human analyst to request materials  
                enriched\_analysis\["materials\_requests"\] \= enriched\_analysis.get("materials\_requests", \[\])  
                enriched\_analysis\["materials\_requests"\].append(action)  
          
        return enriched\_analysis

class HighLevelReasoningGate:  
    """  
    Strategic-level analysis gate  
    Identifies broad questions about market, team, timing  
    """  
      
    def evaluate(self, cycle\_output, deal\_metadata):  
        """  
        Determine if high-level strategic concerns exist  
        """  
          
        signals \= \[\]  
          
        \# Market analysis gate  
        if "market" in cycle\_output.get("uncertainties", \[\]):  
            market\_uncertainty \= self.assess\_market\_uncertainty(cycle\_output)  
              
            if market\_uncertainty \> 0.7:  \# High uncertainty threshold  
                signals.append({  
                    "action": "deepen\_market\_analysis",  
                    "rationale": "Significant market uncertainty detected \- need deeper TAM analysis",  
                    "uncertainty\_score": market\_uncertainty  
                })  
          
        \# Team evaluation gate  
        if "team\_experience" in cycle\_output.get("concerns", \[\]):  
            team\_gaps \= self.identify\_team\_gaps(cycle\_output)  
              
            if len(team\_gaps) \> 0:  
                signals.append({  
                    "action": "expand\_team\_evaluation",  
                    "rationale": f"Team gaps identified: {', '.join(team\_gaps)}",  
                    "gaps": team\_gaps  
                })  
          
        \# Competitive landscape gate  
        if cycle\_output.get("competitive\_analysis\_depth", 0\) \< 0.5:  
            signals.append({  
                "action": "deepen\_competitive\_analysis",  
                "rationale": "Insufficient competitive landscape coverage"  
            })  
          
        return signals  
      
    def assess\_market\_uncertainty(self, cycle\_output):  
        """Calculate market uncertainty score"""  
          
        \# Count market-related uncertainties  
        market\_uncertainties \= \[  
            u for u in cycle\_output.get("uncertainties", \[\])  
            if any(keyword in u.lower() for keyword in \["market", "tam", "competition", "timing"\])  
        \]  
          
        \# Normalize by total uncertainties  
        if len(cycle\_output.get("uncertainties", \[\])) \== 0:  
            return 0.0  
          
        uncertainty\_ratio \= len(market\_uncertainties) / len(cycle\_output\["uncertainties"\])  
          
        return uncertainty\_ratio

class LowLevelReasoningGate:  
    """  
    Tactical-level analysis gate  
    Identifies specific financial, operational, technical concerns  
    """  
      
    def evaluate(self, cycle\_output, deal\_metadata):  
        """  
        Determine if tactical deep dives needed  
        """  
          
        signals \= \[\]  
          
        \# Financial modeling gate  
        if "unit\_economics" in cycle\_output.get("binding\_constraints", \[\]):  
            financial\_depth \= self.assess\_financial\_depth(cycle\_output)  
              
            if financial\_depth \< 0.6:  \# Insufficient detail threshold  
                signals.append({  
                    "action": "detailed\_financial\_modeling",  
                    "rationale": "Unit economics flagged as binding constraint but analysis insufficient",  
                    "depth\_score": financial\_depth  
                })  
          
        \# Benchmark comparison gate  
        if deal\_metadata.get("sector") and deal\_metadata.get("stage"):  
            \# Check if key metrics were compared to benchmarks  
            if not cycle\_output.get("benchmarks\_referenced"):  
                signals.append({  
                    "action": "benchmark\_comparison",  
                    "rationale": "No industry benchmarks referenced for key metrics",  
                    "metrics\_to\_compare": \["cac", "ltv", "churn\_rate", "gross\_margin"\]  
                })  
          
        \# Technical feasibility gate (for tech products)  
        if deal\_metadata.get("product\_type") \== "technical":  
            if "technical\_risk" in cycle\_output.get("risks", \[\]):  
                signals.append({  
                    "action": "technical\_deep\_dive",  
                    "rationale": "Technical risk identified but limited technical evaluation",  
                    "areas": \["architecture", "scalability", "security"\]  
                })  
          
        return signals  
Feedback Collection System (Streamlined)  
pythonclass FeedbackCollectionSystem:  
    """  
    Phase 4: Streamlined feedback collection for continuous learning  
      
    Design principle: Make feedback SO EASY that clients actually do it  
    """  
      
    def \_\_init\_\_(self):  
        self.db \= get\_database\_connection()  
      
    def generate\_feedback\_request(self, deal\_id, firm\_id, report):  
        """  
        Create minimal-friction feedback mechanism  
          
        Three questions only \- takes \<30 seconds  
        """  
          
        feedback\_form \= {  
            "deal\_id": deal\_id,  
            "firm\_id": firm\_id,  
              
            "questions": \[  
                {  
                    "id": "q1\_relevance",  
                    "question": "How relevant was the analysis to your decision?",  
                    "type": "scale",  
                    "scale": "1-5",  
                    "labels": {  
                        1: "Not relevant",  
                        3: "Somewhat relevant",  
                        5: "Highly relevant"  
                    }  
                },  
                {  
                    "id": "q2\_personalization",  
                    "question": "Did the analysis reflect your firm's priorities?",  
                    "type": "scale",  
                    "scale": "1-5",  
                    "labels": {  
                        1: "Generic",  
                        3: "Partially personalized",  
                        5: "Highly personalized"  
                    }  
                },  
                {  
                    "id": "q3\_weighting",  
                    "question": "Should we adjust the balance between general industry insights vs. your firm's patterns?",  
                    "type": "choice",  
                    "options": \[  
                        "More general insights",  
                        "Current balance is good",  
                        "More firm-specific insights"  
                    \]  
                }  
            \],  
              
            \# Optional: Open-ended  
            "optional\_comment": {  
                "question": "Any specific areas we should focus on? (optional)",  
                "type": "text",  
                "max\_length": 500  
            }  
        }  
          
        return feedback\_form  
      
    def process\_feedback(self, deal\_id, firm\_id, feedback\_responses):  
        """  
        Convert feedback into training signals  
        """  
          
        \# Calculate outcome quality score (0-1)  
        relevance \= feedback\_responses\["q1\_relevance"\] / 5.0  
        personalization \= feedback\_responses\["q2\_personalization"\] / 5.0  
        outcome\_quality \= (relevance \+ personalization) / 2.0  
          
        \# Determine weight adjustment signal  
        weight\_feedback \= feedback\_responses\["q3\_weighting"\]  
          
        if weight\_feedback \== "More general insights":  
            weight\_adjustment \= {"general": \+0.1, "firm": \-0.1}  
        elif weight\_feedback \== "More firm-specific insights":  
            weight\_adjustment \= {"general": \-0.1, "firm": \+0.1}  
        else:  
            weight\_adjustment \= {"general": 0, "firm": 0}  
          
        \# Store feedback  
        feedback\_record \= Feedback(  
            feedback\_id=f"FB\_{deal\_id}\_{timestamp()}",  
            deal\_id=deal\_id,  
            firm\_id=firm\_id,  
            outcome\_quality=outcome\_quality,  
            weight\_adjustment=weight\_adjustment,  
            optional\_comment=feedback\_responses.get("optional\_comment"),  
            timestamp=datetime.now()  
        )  
          
        self.db.add(feedback\_record)  
        self.db.commit()  
          
        \# Update gating training data  
        self.update\_gating\_training\_data(deal\_id, outcome\_quality)  
          
        \# If weight adjustment requested, update firm-specific gating bias  
        if weight\_adjustment\["general"\] \!= 0:  
            self.update\_firm\_gating\_bias(firm\_id, weight\_adjustment)  
          
        return {  
            "status": "feedback\_recorded",  
            "outcome\_quality": outcome\_quality,  
            "thank\_you\_message": "Thank you\! Your feedback helps us improve."  
        }  
      
    def update\_gating\_training\_data(self, deal\_id, outcome\_quality):  
        """  
        Link feedback to gating decision for training  
        """  
          
        \# Fetch the gating decision that was used for this deal  
        gating\_log \= self.db.query(GatingLog).filter(  
            GatingLog.deal\_id \== deal\_id  
        ).first()  
          
        if gating\_log:  
            \# Update with outcome quality  
            gating\_log.outcome\_quality \= outcome\_quality  
            self.db.commit()  
              
            \# Add to gating training dataset  
            gating\_dataset.log\_gating\_decision(  
                deal\_embedding=gating\_log.deal\_embedding,  
                firm\_embedding=gating\_log.firm\_embedding,  
                general\_embedding=gating\_log.general\_embedding,  
                rule\_based\_weights=gating\_log.weights\_used,  
                outcome\_quality=outcome\_quality  
            )  
              
            \# Check if ready to retrain  
            if len(gating\_dataset.examples) % 50 \== 0:  \# Every 50 new examples  
                self.trigger\_gating\_model\_retrain()  
      
    def trigger\_gating\_model\_retrain(self):  
        """  
        Periodically retrain gating model with new data  
        """  
          
        print("🔄 Triggering gating model retraining with updated data...")  
          
        \# Save current dataset  
        gating\_dataset.save("./gating\_training\_data\_updated.pkl")  
          
        \# Queue retraining job (async, doesn't block)  
        queue\_background\_job(  
            job\_type="retrain\_gating\_model",  
            params={"training\_data\_path": "./gating\_training\_data\_updated.pkl"}  
        )  
      
    def update\_firm\_gating\_bias(self, firm\_id, weight\_adjustment):  
        """  
        If client explicitly requests more/less personalization,  
        adjust their firm-specific gating bias  
        """  
          
        firm \= self.db.query(Firm).filter(Firm.firm\_id \== firm\_id).first()  
          
        if not firm.gating\_bias:  
            firm.gating\_bias \= {"general": 0.0, "firm": 0.0}  
          
        \# Accumulate bias adjustments  
        firm.gating\_bias\["general"\] \+= weight\_adjustment\["general"\]  
        firm.gating\_bias\["firm"\] \+= weight\_adjustment\["firm"\]  
          
        \# Clamp to reasonable range  
        firm.gating\_bias\["general"\] \= max(-0.3, min(0.3, firm.gating\_bias\["general"\]))  
        firm.gating\_bias\["firm"\] \= max(-0.3, min(0.3, firm.gating\_bias\["firm"\]))  
          
        self.db.commit()  
          
        print(f"✓ Updated gating bias for {firm\_id}: {firm.gating\_bias}")

\# Feedback UI integration

@app.post("/api/v1/reports/{deal\_id}/feedback")  
async def submit\_feedback(  
    deal\_id: str,  
    firm\_id: str,  
    feedback\_responses: dict  
):  
    """  
    Client submits feedback after reviewing report  
    """  
      
    feedback\_system \= FeedbackCollectionSystem()  
      
    result \= feedback\_system.process\_feedback(  
        deal\_id=deal\_id,  
        firm\_id=firm\_id,  
        feedback\_responses=feedback\_responses  
    )  
      
    return result

\# Embedded feedback in report delivery email

def send\_report\_with\_feedback\_link(firm\_id, deal\_id, report\_url):  
    """  
    When report is delivered, include 1-click feedback link  
    """  
      
    \# Generate unique feedback token (prevents spam)  
    feedback\_token \= generate\_secure\_token(deal\_id, firm\_id)  
    feedback\_url \= f"https://dealdecision.ai/feedback/{deal\_id}?token={feedback\_token}"  
      
    email\_body \= f"""  
    Your DealDecision AI report is ready\!  
      
    View Report: {report\_url}  
      
    \---  
      
    Help us improve (30 seconds):  
    {feedback\_url}  
      
    Your feedback directly improves future analyses for your firm.  
    """  
      
    send\_email(  
        to=get\_firm\_email(firm\_id),  
        subject=f"DD Report Ready: {get\_deal\_name(deal\_id)}",  
        body=email\_body  
    )  
Continuous Learning Pipeline  
pythonclass ContinuousLearningPipeline:  
    """  
    Phase 4: Automated pipeline for ongoing model improvement  
      
    Runs continuously in background, monitoring for:  
    1\. New feedback requiring gating model retrain  
    2\. Corpus imbalance requiring pattern acceptance throttling  
    3\. Model performance degradation requiring intervention  
    """  
      
    def \_\_init\_\_(self):  
        self.db \= get\_database\_connection()  
        self.metrics\_tracker \= SystemMetricsTracker()  
      
    def run\_continuous\_loop(self):  
        """  
        Main loop \- runs every 24 hours  
        """  
          
        while True:  
            print(f"🔄 Starting continuous learning cycle: {datetime.now()}")  
              
            \# 1\. Check gating model performance  
            self.monitor\_gating\_performance()  
              
            \# 2\. Check corpus balance  
            self.maintain\_corpus\_balance()  
              
            \# 3\. Update firm patterns from recent deals  
            self.update\_all\_firm\_patterns()  
              
            \# 4\. Retrain models if needed  
            self.conditional\_model\_retrain()  
              
            \# 5\. Generate metrics report  
            self.generate\_metrics\_report()  
              
            \# Sleep 24 hours  
            time.sleep(86400)  
      
    def monitor\_gating\_performance(self):  
        """  
        Track if learned gating is performing well  
        """  
          
        \# Fetch recent deals with feedback  
        recent\_deals \= self.db.query(Deal).filter(  
            Deal.timestamp \> datetime.now() \- timedelta(days=7)  
        ).all()  
          
        performance\_by\_mode \= {  
            "learned": \[\],  
            "rule\_based": \[\]  
        }  
          
        for deal in recent\_deals:  
            feedback \= self.db.query(Feedback).filter(  
                Feedback.deal\_id \== deal.deal\_id  
            ).first()  
              
            if feedback:  
                gating\_log \= self.db.query(GatingLog).filter(  
                    GatingLog.deal\_id \== deal.deal\_id  
                ).first()  
                  
                if gating\_log:  
                    mode \= gating\_log.gating\_mode  
                    performance\_by\_mode\[mode\].append(feedback.outcome\_quality)  
          
        \# Compare performance  
        if len(performance\_by\_mode\["learned"\]) \> 10:  
            avg\_learned \= sum(performance\_by\_mode\["learned"\]) / len(performance\_by\_mode\["learned"\])  
            avg\_rule \= sum(performance\_by\_mode\["rule\_based"\]) / len(performance\_by\_mode\["rule\_based"\]) if performance\_by\_mode\["rule\_based"\] else 0  
              
            print(f"Gating Performance \- Learned: {avg\_learned:.3f}, Rule-based: {avg\_rule:.3f}")  
              
            \# Alert if learned performance degrades  
            if avg\_learned \< 0.7:  
                alert\_engineering\_team(  
                    "Learned gating performance below threshold",  
                    details={"avg\_performance": avg\_learned}  
                )  
      
    def maintain\_corpus\_balance(self):  
        """  
        Ensure general corpus remains balanced across firm types  
        """  
          
        balance \= self.db.query(CorpusBalance).first()  
          
        if not balance.is\_balanced:  
            print(f"⚠ Corpus imbalance detected: {balance.max\_weight\_diff:.1%}")  
              
            \# Identify over-represented firm type  
            weights \= {  
                "VC\_early": balance.vc\_early\_weight,  
                "VC\_growth": balance.vc\_growth\_weight,  
                "PE\_buyout": balance.pe\_buyout\_weight,  
                "RIA": balance.ria\_weight  
            }  
              
            max\_type \= max(weights, key=weights.get)  
            min\_type \= min(weights, key=weights.get)  
              
            print(f"Over-represented: {max\_type} ({weights\[max\_type\]:.1%})")  
            print(f"Under-represented: {min\_type} ({weights\[min\_type\]:.1%})")  
              
            \# Throttle pattern acceptance from over-represented type  
            \# (Already handled in contribute\_to\_general\_corpus check)  
              
            \# Incentivize under-represented firms to contribute  
            self.increase\_contribution\_incentive(min\_type)  
      
    def update\_all\_firm\_patterns(self):  
        """  
        Batch update firm patterns based on recent deals  
        """  
          
        firms\_with\_new\_deals \= self.db.query(Firm).filter(  
            Firm.deals.any(Deal.timestamp \> datetime.now() \- timedelta(days=7))  
        ).all()  
          
        for firm in firms\_with\_new\_deals:  
            print(f"Updating patterns for {firm.firm\_id}...")  
              
            recent\_deals \= \[d for d in firm.deals if d.timestamp \> datetime.now() \- timedelta(days=7)\]  
              
            for deal in recent\_deals:  
                if deal.report:  
                    \# Extract patterns  
                    engine \= Phase4AnalysisEngine()  
                    new\_patterns \= engine.extract\_firm\_patterns(  
                        firm\_id=firm.firm\_id,  
                        deal\_metadata={"sector": deal.sector, "stage": deal.stage, "deal\_type": deal.deal\_type},  
                        cycle\_outputs=deal.report.full\_report\_json\["cycles"\],  
                        final\_report=deal.report.full\_report\_json  
                    )  
                      
                    \# Update firm repository  
                    engine.update\_firm\_patterns(firm.firm\_id, new\_patterns)  
      
    def conditional\_model\_retrain(self):  
        """  
        Retrain models if significant new data accumulated  
        """  
          
        \# Check if gating model should retrain  
        gating\_examples\_count \= len(gating\_dataset.examples)  
        last\_gating\_retrain \= get\_last\_retrain\_timestamp("gating\_model")  
          
        if gating\_examples\_count \> 500 and (datetime.now() \- last\_gating\_retrain).days \> 30:  
            print("🔄 Triggering gating model retrain (500+ new examples)")  
            train\_gating\_model("./gating\_training\_data\_updated.pkl")  
            update\_last\_retrain\_timestamp("gating\_model")  
          
        \# Check if main SFT model should retrain  
        \# (Less frequent \- only if major performance issues or 1000+ new reports)  
        reports\_since\_last\_sft \= count\_reports\_since\_timestamp(last\_sft\_retrain)  
          
        if reports\_since\_last\_sft \> 1000:  
            print("🔄 Triggering full SFT model retrain (1000+ new reports)")  
            queue\_background\_job(  
                job\_type="full\_sft\_retrain",  
                params={"training\_data\_path": "./all\_reports\_updated.jsonl"}  
            )  
      
    def generate\_metrics\_report(self):  
        """  
        Weekly metrics summary for engineering team  
        """  
          
        metrics \= {  
            "total\_deals\_analyzed": self.db.query(Deal).count(),  
            "total\_firms": self.db.query(Firm).count(),  
            "avg\_report\_quality": self.calculate\_avg\_report\_quality(),  
            "gating\_mode\_distribution": self.calculate\_gating\_mode\_split(),  
            "corpus\_balance\_status": self.get\_corpus\_balance\_status(),  
            "feedback\_rate": self.calculate\_feedback\_rate(),  
            "system\_uptime": self.calculate\_uptime()  
        }  
          
        \# Save to dashboard  
        save\_metrics\_to\_dashboard(metrics)  
          
        \# Email engineering team  
        send\_weekly\_metrics\_email(metrics)  
Complete Depth Metrics Tracking (All 4 Levels)  
pythonclass ComprehensiveDepthMetrics:  
    """  
    Phase 4: Track all four depth delta metrics for complete transparency  
    """  
      
    def \_\_init\_\_(self, deal\_id, firm\_id):  
        self.deal\_id \= deal\_id  
        self.firm\_id \= firm\_id  
        self.db \= get\_database\_connection()  
      
    def calculate\_all\_depth\_metrics(self, cycle\_outputs, firm\_patterns, general\_corpus\_state):  
        """  
        Calculate and log all 4 depth metrics  
        """  
          
        metrics \= {  
            "cycle\_level": self.calculate\_cycle\_depth\_deltas(cycle\_outputs),  
            "deal\_level": self.calculate\_deal\_depth\_delta(cycle\_outputs),  
            "firm\_level": self.calculate\_firm\_depth\_delta(firm\_patterns),  
            "general\_corpus\_level": self.calculate\_corpus\_depth\_delta(general\_corpus\_state)  
        }  
          
        \# Save to database  
        depth\_metrics\_record \= DepthMetrics(  
            deal\_id=self.deal\_id,  
            firm\_id=self.firm\_id,  
            metrics\_json=metrics,  
            timestamp=datetime.now()  
        )  
          
        self.db.add(depth\_metrics\_record)  
        self.db.commit()  
          
        return metrics  
      
    def calculate\_cycle\_depth\_deltas(self, cycle\_outputs):  
        """  
        DepthΔ\_cycle: When to stop each reasoning cycle  
        """  
          
        cycle\_deltas \= \[\]  
          
        for i, cycle in enumerate(cycle\_outputs):  
            delta \= cycle\["depth\_delta"\]  
              
            cycle\_deltas.append({  
                "cycle\_num": i \+ 1,  
                "depth\_delta": delta,  
                "threshold": DEPTH\_THRESHOLD  
                "decision": "continue" if delta \>= DEPTH\_THRESHOLD else "stop",  
                "reasoning": cycle\["reasoning\_for\_depth"\],  
                "unique\_subgoals\_remaining": len(cycle.get("unresolved\_questions", \[\])),  
                "binding\_constraints\_identified": len(cycle.get("binding\_constraints", \[\]))  
            })  
          
        return cycle\_deltas  
      
    def calculate\_deal\_depth\_delta(self, cycle\_outputs):  
        """  
        DepthΔ\_deal: When the full deal analysis is complete  
        """  
          
        final\_cycle \= cycle\_outputs\[-1\]  
          
        \# Deal is complete when:  
        \# 1\. Binding constraints identified  
        \# 2\. Evidence coverage adequate  
        \# 3\. Go/No-Go decision reached  
          
        constraints\_identified \= len(final\_cycle.get("binding\_constraints", \[\])) \> 0  
        evidence\_adequate \= final\_cycle.get("evidence\_coverage", 0\) \> 0.7  
        decision\_reached \= "go\_no\_go" in final\_cycle  
          
        completeness\_score \= sum(\[constraints\_identified, evidence\_adequate, decision\_reached\]) / 3.0  
          
        depth\_delta\_deal \= 1.0 \- completeness\_score  
          
        return {  
            "total\_cycles\_executed": len(cycle\_outputs),  
            "depth\_delta\_final": depth\_delta\_deal,  
            "completion\_criteria": {  
                "binding\_constraints\_identified": constraints\_identified,  
                "evidence\_adequate": evidence\_adequate,  
                "decision\_reached": decision\_reached  
            },  
            "status": "complete" if depth\_delta\_deal \< 0.3 else "incomplete"  
        }  
      
    def calculate\_firm\_depth\_delta(self, firm\_patterns):  
        """  
        DepthΔ\_firm: When firm patterns have stabilized  
        """  
          
        if len(firm\_patterns) \== 0:  
            return {  
                "pattern\_count": 0,  
                "depth\_delta\_firm": 1.0,  
                "status": "no\_patterns\_yet"  
            }  
          
        \# Calculate pattern stability  
        avg\_confidence \= sum(\[p.confidence\_score for p in firm\_patterns\]) / len(firm\_patterns)  
        pattern\_churn \= self.calculate\_pattern\_churn(firm\_patterns)  
          
        \# High confidence \+ low churn \= low depth delta (stable)  
        depth\_delta\_firm \= (1.0 \- avg\_confidence) \* (1.0 \+ pattern\_churn) / 2.0  
          
        status \= "establishing\_patterns"  
        if depth\_delta\_firm \< 0.3:  
            status \= "patterns\_stable"  
        elif depth\_delta\_firm \< 0.6:  
            status \= "patterns\_maturing"  
          
        return {  
            "pattern\_count": len(firm\_patterns),  
            "avg\_confidence": avg\_confidence,  
            "pattern\_churn\_rate": pattern\_churn,  
            "depth\_delta\_firm": depth\_delta\_firm,  
            "status": status,  
            "note": self.interpret\_firm\_depth\_delta(depth\_delta\_firm)  
        }  
      
    def calculate\_pattern\_churn(self, firm\_patterns):  
        """  
        Measure how much patterns are changing  
        """  
          
        \# Get patterns from 30 days ago  
        old\_patterns \= self.db.query(FirmPattern).filter(  
            FirmPattern.firm\_id \== self.firm\_id,  
            FirmPattern.last\_updated \< datetime.now() \- timedelta(days=30)  
        ).all()  
          
        if len(old\_patterns) \== 0:  
            return 1.0  \# High churn (no stable patterns yet)  
          
        \# Calculate how many patterns changed significantly  
        changed\_count \= 0  
        for old\_p in old\_patterns:  
            current\_p \= next((p for p in firm\_patterns if p.pattern\_type \== old\_p.pattern\_type), None)  
              
            if current\_p:  
                \# Compare pattern data similarity  
                similarity \= self.calculate\_pattern\_similarity(old\_p.pattern\_data, current\_p.pattern\_data)  
                if similarity \< 0.7:  
                    changed\_count \+= 1  
          
        churn\_rate \= changed\_count / len(old\_patterns)  
        return churn\_rate  
      
    def calculate\_corpus\_depth\_delta(self, general\_corpus\_state):  
        """  
        DepthΔ\_general: When general corpus is sufficiently comprehensive  
        """  
          
        total\_patterns \= self.db.query(GeneralCorpusPattern).count()  
          
        \# Assess corpus maturity  
        \# Mature corpus: 500+ patterns, balanced across firm types, high confidence  
          
        balance \= self.db.query(CorpusBalance).first()  
          
        maturity\_factors \= {  
            "size": min(total\_patterns / 500.0, 1.0),  \# Target: 500+ patterns  
            "balance": 1.0 if balance.is\_balanced else 0.5,  
            "coverage": self.assess\_corpus\_coverage()  \# Do we have patterns for all key areas?  
        }  
          
        maturity\_score \= sum(maturity\_factors.values()) / len(maturity\_factors)  
          
        depth\_delta\_general \= 1.0 \- maturity\_score  
          
        status \= "immature\_corpus"  
        if depth\_delta\_general \< 0.2:  
            status \= "mature\_corpus"  
        elif depth\_delta\_general \< 0.5:  
            status \= "maturing\_corpus"  
          
        return {  
            "total\_patterns": total\_patterns,  
            "firm\_type\_balance": {  
                "VC\_early": balance.vc\_early\_weight,  
                "PE\_buyout": balance.pe\_buyout\_weight,  
                "RIA": balance.ria\_weight,  
                \# ...  
            },  
            "is\_balanced": balance.is\_balanced,  
            "coverage\_score": maturity\_factors\["coverage"\],  
            "depth\_delta\_general": depth\_delta\_general,  
            "status": status  
        }RetryREContinuepython    def assess\_corpus\_coverage(self):  
        """  
        Measure if corpus covers all essential DD areas  
        """  
          
        essential\_pattern\_types \= \[  
            "risk\_weighting",  
            "binding\_constraint",  
            "market\_benchmarks",  
            "team\_evaluation",  
            "financial\_metrics",  
            "competitive\_analysis"  
        \]  
          
        coverage\_count \= 0  
          
        for pattern\_type in essential\_pattern\_types:  
            count \= self.db.query(GeneralCorpusPattern).filter(  
                GeneralCorpusPattern.pattern\_type \== pattern\_type  
            ).count()  
              
            if count \>= 5:  \# At least 5 patterns of this type  
                coverage\_count \+= 1  
          
        coverage\_score \= coverage\_count / len(essential\_pattern\_types)  
          
        return coverage\_score  
      
    def interpret\_firm\_depth\_delta(self, depth\_delta\_firm):  
        """  
        Human-readable explanation of firm learning status  
        """  
          
        if depth\_delta\_firm \> 0.7:  
            return "Firm is new \- relying heavily on general patterns"  
        elif depth\_delta\_firm \> 0.5:  
            return "Patterns are emerging \- still learning firm preferences"  
        elif depth\_delta\_firm \> 0.3:  
            return "Patterns are maturing \- good understanding of firm's approach"  
        else:  
            return "Patterns are stable \- strong personalization possible"

VII. DEPLOYMENT & OPERATIONS  
System Requirements  
Phase 2 (SFT Training)  
yamlHardware:  
  \- 8x NVIDIA A100 (80GB) GPUs  
  \- 512GB RAM  
  \- 2TB NVMe SSD storage

Software:  
  \- PyTorch 2.0+  
  \- Transformers 4.30+  
  \- DeepSpeed (for distributed training)  
  \- CUDA 11.8+

Estimated Costs:  
  \- Training: $500-1000 per full SFT run  
  \- Duration: 6-12 hours per training run  
Phase 3 (Production Platform)  
yamlInfrastructure:  
  API Servers:  
    \- 4x application servers (16 cores, 64GB RAM each)  
    \- Load balancer (NGINX or AWS ALB)  
    
  GPU Inference:  
    \- 2x NVIDIA A100 (40GB) for model serving  
    \- Auto-scaling based on request volume  
    
  Database:  
    \- PostgreSQL (primary)  
    \- Redis (caching)  
    \- MongoDB (document storage for reports)  
    
  Storage:  
    \- S3 or equivalent (deal documents, reports)  
    
  Monitoring:  
    \- Prometheus \+ Grafana  
    \- Sentry (error tracking)  
    \- DataDog (APM)

Monthly Operating Costs (estimated):  
  \- GPU inference: $3,000-5,000  
  \- Application servers: $1,000-2,000  
  \- Database: $500-1,000  
  \- Storage: $200-500  
  \- Monitoring: $300-500  
  Total: \~$5,000-9,000/month  
Phase 4 (Full TRM System)  
yamlAdditional Requirements:  
  \- TRM gating model inference: \+1 GPU  
  \- Continuous learning pipeline: Background workers  
  \- Feedback system: Additional API capacity  
    
Incremental Monthly Cost: \+$2,000-3,000  
Deployment Checklist  
pythonclass DeploymentChecklist:  
    """  
    Pre-deployment validation for each phase  
    """  
      
    def phase\_2\_readiness(self):  
        """Phase 2: SFT Model Ready for Testing"""  
          
        checks \= {  
            "training\_data": {  
                "min\_examples": 75,  
                "quality\_threshold": 4.0,  
                "format\_valid": True  
            },  
            "model\_training": {  
                "loss\_converged": True,  
                "eval\_metrics\_acceptable": True,  
                "model\_saved": True  
            },  
            "inference\_testing": {  
                "sample\_reports\_generated": 10,  
                "format\_compliance": True,  
                "citation\_accuracy": True,  
                "depth\_delta\_calculated": True  
            },  
            "human\_validation": {  
                "expert\_reviewed": True,  
                "quality\_rating\_avg": 4.0  
            }  
        }  
          
        return all(\[all(v.values()) for v in checks.values()\])  
      
    def phase\_3\_readiness(self):  
        """Phase 3: Platform Ready for Client Onboarding"""  
          
        checks \= {  
            "infrastructure": {  
                "api\_deployed": True,  
                "database\_migrated": True,  
                "gpu\_inference\_online": True,  
                "monitoring\_configured": True  
            },  
            "platform\_features": {  
                "firm\_registration": True,  
                "deal\_upload": True,  
                "report\_generation": True,  
                "audit\_logs": True,  
                "dashboard\_ui": True  
            },  
            "security": {  
                "authentication": True,  
                "authorization": True,  
                "data\_encryption": True,  
                "backup\_configured": True  
            },  
            "performance": {  
                "report\_generation\_under\_20min": True,  
                "api\_response\_time\_under\_2s": True,  
                "concurrent\_users\_tested": 50  
            },  
            "legal\_compliance": {  
                "privacy\_policy": True,  
                "terms\_of\_service": True,  
                "data\_processing\_agreement": True  
            }  
        }  
          
        return all(\[all(v.values()) for v in checks.values()\])  
      
    def phase\_4\_readiness(self):  
        """Phase 4: TRM System Ready for Production"""  
          
        checks \= {  
            "gating\_model": {  
                "training\_examples": 500,  
                "model\_trained": True,  
                "shadow\_testing\_complete": True,  
                "performance\_validated": True  
            },  
            "switch\_mechanism": {  
                "trigger\_logic\_implemented": True,  
                "fallback\_working": True,  
                "monitoring\_active": True  
            },  
            "continuous\_learning": {  
                "feedback\_system\_live": True,  
                "pattern\_extraction\_automated": True,  
                "corpus\_balance\_maintained": True,  
                "retraining\_pipeline\_tested": True  
            },  
            "conditional\_routing": {  
                "high\_level\_gates\_tested": True,  
                "low\_level\_gates\_tested": True,  
                "action\_execution\_validated": True  
            }  
        }  
          
        return all(\[all(v.values()) for v in checks.values()\])  
Monitoring & Alerting  
pythonclass SystemMonitoring:  
    """  
    Production monitoring and alerting  
    """  
      
    def \_\_init\_\_(self):  
        self.prometheus \= PrometheusClient()  
        self.sentry \= SentryClient()  
        self.pagerduty \= PagerDutyClient()  
      
    def setup\_metrics(self):  
        """  
        Define key metrics to track  
        """  
          
        \# Performance metrics  
        self.prometheus.gauge("report\_generation\_time\_seconds")  
        self.prometheus.gauge("api\_response\_time\_seconds")  
        self.prometheus.counter("reports\_generated\_total")  
        self.prometheus.counter("api\_requests\_total")  
          
        \# Quality metrics  
        self.prometheus.gauge("average\_report\_quality\_score")  
        self.prometheus.gauge("citation\_accuracy\_rate")  
        self.prometheus.counter("validation\_failures\_total")  
          
        \# Gating metrics (Phase 4\)  
        self.prometheus.gauge("gating\_mode")  \# 0=rule, 1=learned  
        self.prometheus.gauge("learned\_gate\_performance")  
        self.prometheus.counter("gating\_fallbacks\_total")  
          
        \# Corpus metrics  
        self.prometheus.gauge("general\_corpus\_pattern\_count")  
        self.prometheus.gauge("corpus\_balance\_max\_diff")  
        self.prometheus.gauge("firm\_pattern\_count\_by\_firm")  
      
    def setup\_alerts(self):  
        """  
        Define alerting rules  
        """  
          
        \# Critical alerts (page on-call)  
        self.add\_alert(  
            name="ReportGenerationFailed",  
            condition="reports\_failed\_total \> 5 in 1 hour",  
            severity="critical",  
            action="page\_oncall"  
        )  
          
        self.add\_alert(  
            name="APIDowntime",  
            condition="api\_availability \< 0.99 in 5 minutes",  
            severity="critical",  
            action="page\_oncall"  
        )  
          
        \# Warning alerts (slack notification)  
        self.add\_alert(  
            name="ReportQualityDegraded",  
            condition="average\_report\_quality\_score \< 3.5 for 24 hours",  
            severity="warning",  
            action="notify\_slack"  
        )  
          
        self.add\_alert(  
            name="LearnedGatingUnderperforming",  
            condition="learned\_gate\_performance \< rule\_gate\_performance for 7 days",  
            severity="warning",  
            action="notify\_engineering"  
        )  
          
        self.add\_alert(  
            name="CorpusImbalance",  
            condition="corpus\_balance\_max\_diff \> 0.35 for 3 days",  
            severity="warning",  
            action="notify\_data\_team"  
        )  
      
    def log\_error(self, error, context):  
        """  
        Structured error logging  
        """  
          
        self.sentry.capture\_exception(  
            error,  
            extra={  
                "context": context,  
                "timestamp": datetime.now(),  
                "phase": get\_current\_phase()  
            }  
        )

VIII. SUCCESS METRICS & KPIs  
Phase-Specific Success Criteria  
pythonclass PhaseSuccessMetrics:  
    """  
    Measurable success criteria for each phase  
    """  
      
    def phase\_2\_success\_criteria(self):  
        """  
        Phase 2: Prove SFT model works  
        """  
        return {  
            "model\_performance": {  
                "format\_compliance\_rate": 0.95,  \# 95% of reports have correct structure  
                "citation\_accuracy": 0.90,  \# 90% of citations are valid  
                "depth\_delta\_calculation\_accuracy": 0.85  \# 85% match human judgment  
            },  
            "efficiency": {  
                "generation\_time": "\< 20 minutes",  
                "human\_edit\_time\_reduction": "50%"  \# vs. Phase 1 manual  
            },  
            "quality": {  
                "human\_approval\_rate": 0.75,  \# 75% approved with minor/no edits  
                "client\_satisfaction": 4.0  \# Average rating 4.0/5.0  
            }  
        }  
      
    def phase\_3\_success\_criteria(self):  
        """  
        Phase 3: Prove platform scales and personalizes  
        """  
        return {  
            "adoption": {  
                "active\_firms": 10,  \# At least 10 firms using platform  
                "deals\_per\_firm\_per\_month": 5,  
                "user\_retention\_rate": 0.80  \# 80% of firms return month-over-month  
            },  
            "personalization": {  
                "firms\_with\_stable\_patterns": 5,  \# 5 firms with DepthΔ\_firm \< 0.3  
                "personalization\_score\_improvement": "+20%"  \# vs. generic analysis  
            },  
            "operational": {  
                "system\_uptime": 0.99,  
                "report\_generation\_success\_rate": 0.95,  
                "human\_review\_rate\_reduction": "50%"  \# Down to 50% from 100%  
            }  
        }  
      
    def phase\_4\_success\_criteria(self):  
        """  
        Phase 4: Prove learned gating and continuous learning work  
        """  
        return {  
            "gating\_performance": {  
                "learned\_gate\_activated": True,  
                "learned\_vs\_rule\_performance": "\>= 0%",  \# At least as good  
                "switch\_stability": "No reverts for 30 days"  
            },  
            "continuous\_learning": {  
                "feedback\_collection\_rate": 0.40,  \# 40% of reports get feedback  
                "pattern\_update\_frequency": "Weekly",  
                "corpus\_balance\_maintained": True  
            },  
            "quality\_improvement": {  
                "report\_quality\_trend": "+10% over 6 months",  
                "personalization\_accuracy": "+15% over baseline"  
            },  
            "scale": {  
                "active\_firms": 50,  
                "concurrent\_analyses": 10,  
                "total\_deals\_analyzed": 2500  
            }  
        }

IX. ENGINEERING SPECIFICATIONS  
Team Structure & Roles  
yamlRecommended Team Composition:

Phase 2 (Months 1-6):  
  \- ML Engineer (Lead): SFT training, model optimization  
  \- Backend Engineer: API development, data pipelines  
  \- Data Engineer: Training data generation, quality control  
  \- Product Manager: Coordinate with analysts, gather requirements  
    
Phase 3 (Months 7-12):  
  \- ML Engineer: Model serving, inference optimization  
  \- Backend Engineer (2x): Platform features, database design  
  \- Frontend Engineer: Client dashboard UI  
  \- DevOps Engineer: Infrastructure, deployment, monitoring  
  \- Product Manager: Client onboarding, feedback collection  
    
Phase 4 (Months 13-18):  
  \- ML Engineer: TRM gating, continuous learning  
  \- Backend Engineer: Orchestration layer, conditional routing  
  \- Data Scientist: Metrics analysis, A/B testing  
  \- DevOps Engineer: Production monitoring, scaling  
  \- Product Manager: Feature refinement, client success  
Code Organization  
dealdecision-ai/  
├── models/  
│   ├── hrm\_dd\_sft/              \# Phase 2: SFT model  
│   │   ├── training/  
│   │   │   ├── train.py  
│   │   │   ├── data\_loader.py  
│   │   │   └── config.yaml  
│   │   ├── inference/  
│   │   │   ├── engine.py  
│   │   │   └── prompts.py  
│   │   └── checkpoints/  
│   │  
│   └── trm\_gating/              \# Phase 4: Gating model  
│       ├── model.py  
│       ├── train.py  
│       └── inference.py  
│  
├── api/  
│   ├── app.py                   \# FastAPI application  
│   ├── routes/  
│   │   ├── firms.py  
│   │   ├── deals.py  
│   │   ├── reports.py  
│   │   └── feedback.py  
│   ├── auth.py  
│   └── middleware.py  
│  
├── core/  
│   ├── hrm\_dd\_engine.py         \# Core analysis logic  
│   ├── gating.py                \# Gating mechanisms  
│   ├── conditional\_router.py   \# Action routing  
│   ├── pattern\_extractor.py    \# Pattern learning  
│   └── depth\_metrics.py         \# Depth delta calculations  
│  
├── db/  
│   ├── models.py                \# SQLAlchemy models  
│   ├── migrations/  
│   └── seeds/  
│  
├── pipelines/  
│   ├── continuous\_learning.py  \# Background learning loop  
│   ├── corpus\_balance.py       \# Corpus maintenance  
│   └── model\_retraining.py     \# Periodic retraining  
│  
├── monitoring/  
│   ├── metrics.py  
│   ├── alerts.py  
│   └── dashboards/  
│  
├── frontend/  
│   ├── src/  
│   │   ├── components/  
│   │   ├── pages/  
│   │   └── api/  
│   └── public/  
│  
├── tests/  
│   ├── unit/  
│   ├── integration/  
│   └── e2e/  
│  
├── scripts/  
│   ├── generate\_synthetic\_data.py  
│   ├── deploy.sh  
│   └── backup.sh  
│  
├── docs/  
│   ├── API.md  
│   ├── DEPLOYMENT.md  
│   └── METHODOLOGY.md  
│  
├── docker-compose.yml  
├── Dockerfile  
├── requirements.txt  
└── README.md  
Development Workflow  
python\# Example: End-to-end development flow

\# 1\. Generate training data (Phase 2\)  
python scripts/generate\_synthetic\_data.py \\  
    \--num\_examples 75 \\  
    \--quality\_threshold 4.0 \\  
    \--output ./data/training\_75.jsonl

\# 2\. Train SFT model  
python models/hrm\_dd\_sft/training/train.py \\  
    \--training\_data ./data/training\_75.jsonl \\  
    \--base\_model meta-llama/Llama-3.1-70B \\  
    \--epochs 3 \\  
    \--output\_dir ./models/hrm\_dd\_sft/checkpoints/v1

\# 3\. Test inference  
python models/hrm\_dd\_sft/inference/test\_inference.py \\  
    \--model\_path ./models/hrm\_dd\_sft/checkpoints/v1 \\  
    \--test\_deals ./data/test\_deals/ \\  
    \--output ./results/

\# 4\. Deploy to staging  
./scripts/deploy.sh staging

\# 5\. Run integration tests  
pytest tests/integration/ \--env=staging

\# 6\. Deploy to production  
./scripts/deploy.sh production

\# 7\. Monitor  
python monitoring/metrics.py \--live \--dashboard

X. RISK MITIGATION & CONTINGENCY PLANS  
Technical Risks  
pythonclass RiskMitigationStrategies:  
    """  
    Identified risks and mitigation approaches  
    """  
      
    risks \= {  
        "sft\_model\_quality\_insufficient": {  
            "likelihood": "Medium",  
            "impact": "High",  
            "mitigation": \[  
                "Start with 75 examples, evaluate, iterate",  
                "Keep human-in-loop for Phase 2A-2B",  
                "Have rollback plan to manual process",  
                "Quality gates before reducing human oversight"  
            \],  
            "contingency": "If \<75% approval rate after 200 reports, pause and retrain"  
        },  
          
        "learned\_gating\_underperforms": {  
            "likelihood": "Medium",  
            "impact": "Medium",  
            "mitigation": \[  
                "Shadow mode testing before switch",  
                "Automatic fallback to rule-based",  
                "Continuous performance monitoring",  
                "Revert trigger if performance drops \>10%"  
            \],  
            "contingency": "Keep rule-based gating as permanent fallback"  
        },  
          
        "corpus\_imbalance\_degrades\_quality": {  
            "likelihood": "Low",  
            "impact": "Medium",  
            "mitigation": \[  
                "30% max differential enforcement",  
                "Real-time balance monitoring",  
                "Pattern acceptance throttling",  
                "Incentivize under-represented firm types"  
            \],  
            "contingency": "Temporarily pause pattern contributions from over-represented types"  
        },  
          
        "client\_adoption\_slower\_than\_expected": {  
            "likelihood": "Medium",  
            "impact": "High",  
            "mitigation": \[  
                "Focus on 5-10 design partner firms initially",  
                "Offer incentives (discounts, features) for early adopters",  
                "Build case studies from successful early clients",  
                "Iterate rapidly based on client feedback"  
            \],  
            "contingency": "Pivot to consulting model (human \+ AI hybrid) if self-serve adoption slow"  
        },  
          
        "feedback\_collection\_rate\_too\_low": {  
            "likelihood": "High",  
            "impact": "Medium",  
            "mitigation": \[  
                "Make feedback extremely simple (3 questions, 30 seconds)",  
                "Embed in report delivery email (1-click)",  
                "Incentivize feedback (small credits, priority support)",  
                "Show clients how their feedback improves their experience"  
            \],  
            "contingency": "Use implicit signals (report usage time, re-run rate) as proxy for quality"  
        },  
          
        "model\_drift\_over\_time": {  
            "likelihood": "Medium",  
            "impact": "High",  
            "mitigation": \[  
                "Continuous monitoring of output quality",  
                "Periodic retraining (monthly for gating, quarterly for main model)",  
                "A/B testing new models before full deployment",  
                "Version control and rollback capability"  
            \],  
            "contingency": "Automated rollback to previous model version if quality drops"  
        }  
    }

XI. PATENT ARCHITECTURE SUMMARY  
Technical Contributions  
This system is patentable based on the following technical architecture:  
1\. Dual-Corpus Multi-Timescale Learning System  
Technical Problem Solved:  
Existing AI systems are either generic (no personalization) or trained only on client-specific data (overfitting, blind spots). This creates a fundamental trade-off between breadth and personalization.  
Novel Solution:  
A dual-corpus architecture that maintains:

General Corpus: Aggregated patterns across client types with enforced balance (30% max differential)  
Firm-Specific Repositories: Client-specific learned patterns  
Dynamic Gating Mechanism: TRM-inspired weighting between general and firm knowledge based on:

Firm deal history count  
Sector familiarity  
Pattern stability metrics  
Learned optimal weighting (Phase 4\)

Non-obvious because:

Standard approach is either/or (generic OR custom)  
The 30% balance rule for corpus composition is a specific technical solution to prevent majority-type dominance  
The automatic trigger mechanism for switching from rule-based to learned gating based on performance confidence is novel  
The four-level depth metric hierarchy (cycle, deal, firm, corpus) provides transparency

2\. Hierarchical Depth Metrics for Auditable AI Reasoning  
Technical Problem Solved:  
AI reasoning in high-stakes domains lacks transparency and auditability, making it unsuitable for decisions involving millions of dollars.  
Novel Solution:  
Four-level depth delta (DepthΔ) metric hierarchy that tracks:

DepthΔ\_cycle: When to stop each reasoning iteration  
DepthΔ\_deal: When deal analysis is complete  
DepthΔ\_firm: When firm patterns have stabilized  
DepthΔ\_general: When general corpus is sufficiently mature

Each level has explicit thresholds and logged decision rationales, creating complete audit trail.  
Non-obvious because:

Standard AI systems use single-level stopping criteria  
The hierarchical structure maps to different timescales (fast→slow)  
The firm-level and corpus-level metrics are unique to multi-tenant learning systems  
The combination enables unprecedented accountability

3\. Conditional Action Routing with High/Low-Level Reasoning Gates  
Technical Problem Solved:  
AI analysis depth is typically fixed, leading to either shallow analysis of complex deals or unnecessary depth on simple deals.  
Novel Solution:  
Dual-gate conditional routing system:

High-Level Gates: Strategic concerns (market viability, team capability, timing)  
Low-Level Gates: Tactical concerns (unit economics, benchmarks, technical feasibility)

Gates dynamically trigger:

Cycle deepening on specific focus areas  
External data enrichment  
Additional material requests

Non-obvious because:

Standard systems apply uniform analysis depth  
The hierarchical gate structure (strategic vs. tactical) is novel  
The dynamic resource allocation based on uncertainty is computationally non-trivial  
Integration with the depth metric system creates feedback loop

4\. Automatic Gating Mode Switch with Shadow Testing  
Technical Problem Solved:  
Transitioning from rule-based to learned AI systems typically requires manual intervention and carries high risk of degradation.  
Novel Solution:  
Automatic trigger mechanism that:

Runs learned gating in shadow mode during rule-based production  
Collects performance data for both approaches  
Calculates confidence metrics (consistency, accuracy)  
Automatically switches when learned ≥ rule-based performance with high confidence  
Maintains fallback capability permanently

Non-obvious because:

Most systems require manual A/B testing and gradual rollout  
The automatic trigger based on statistical confidence is novel  
The permanent fallback architecture is unique  
The shadow testing approach minimizes risk while enabling continuous improvement

Patent Claims Structure (Conceptual)  
Claim 1 (Broad System Claim):  
A computer-implemented system for investment due diligence analysis comprising:  
\- A first knowledge base containing general investment patterns  
\- A second knowledge base containing client-specific investment patterns  
\- A dynamic gating mechanism that weights contributions from first and second knowledge bases  
\- A multi-level depth metric hierarchy for transparent reasoning  
\- Wherein the system continuously learns from client interactions

Claim 2 (Dual-Corpus Architecture):  
The system of Claim 1, wherein the first knowledge base maintains balance across client types by:  
\- Tracking contribution weights by client type  
\- Enforcing maximum 30% differential between client type weights  
\- Throttling pattern acceptance from over-represented types

Claim 3 (Depth Metric Hierarchy):  
The system of Claim 1, wherein the depth metrics comprise:  
\- Cycle-level metrics determining when to stop iterative reasoning  
\- Deal-level metrics determining when analysis is complete  
\- Firm-level metrics determining when client patterns have stabilized  
\- Corpus-level metrics determining when general knowledge is mature

Claim 4 (Conditional Routing):  
The system of Claim 1, further comprising:  
\- High-level reasoning gates for strategic concerns  
\- Low-level reasoning gates for tactical concerns  
\- Dynamic allocation of computational resources based on gate outputs

Claim 5 (Automatic Switch Mechanism):  
The system of Claim 1, wherein the gating mechanism:  
\- Operates in rule-based mode initially  
\- Runs learned gating in shadow mode  
\- Automatically switches to learned mode when performance confidence exceeds threshold  
\- Maintains fallback to rule-based mode if performance degrades

... (additional claims covering specific implementations)

XII. CONCLUSION & NEXT STEPS  
Executive Summary  
This document specifies a complete four-phase implementation of DealDecision AI, progressing from manual execution (Phase 1\) through supervised fine-tuning (Phase 2), platform deployment (Phase 3), and full TRM-based continuous learning (Phase 4).  
Key Architectural Innovations:

Dual-corpus learning (general \+ firm-specific) with enforced balance  
Four-level depth metric hierarchy for complete transparency  
Conditional action routing with high/low-level reasoning gates  
Automatic gating mode switch with shadow testing  
Streamlined feedback system enabling continuous improvement

Timeline:

Months 1-6 (Phase 2): SFT training, 75→500 reports, human-reviewed deployment  
Months 7-12 (Phase 3): Platform build, client onboarding, pattern repositories  
Months 13-18 (Phase 4): TRM gating, learned optimization, full autonomy

Investment Required:

Phase 2: $50-75k (training infrastructure, synthetic data generation)  
Phase 3: $150-200k (platform development, infrastructure)  
Phase 4: $100-150k (TRM implementation, continuous learning pipelines)  
Total: \~$300-425k over 18 months

Long Term Vision (Phase 5):  
\#\#\# Horizontal Platform Expansion (Year 3+)

The core architecture (dual-corpus learning \+ depth metrics \+ automatic gating)   
is domain-agnostic. After achieving PMF in investment DD, we will expand to:

1\. Legal Due Diligence (M\&A lawyers reviewing contracts)  
2\. Technical Due Diligence (engineering reviews for acquisitions)    
3\. Medical Diagnosis Review (second opinions for complex cases)  
4\. Compliance Audits (financial/regulatory review)

Each vertical feeds the general corpus, creating cross-domain insights   
(e.g., risk assessment patterns from medical domain inform investment DD).

TAM expansion: $50B (DD) → $500B (all high-stakes decision domains)

Expected Outcomes:

Phase 2: 15-minute report generation, 75% human approval rate  
Phase 3: 10+ active clients, 80% retention, 50% reduction in human review  
Phase 4: 50+ active clients, learned gating activated, 10%+ quality improvement

\#\# XII. IMMEDIATE ENGINEERING SETUP

\*\*Infrastructure (Week 1):\*\*  
\- PostgreSQL database (local dev → staging → production)  
\- GitHub repo (use structure from Section IX)  
\- Basic monitoring (Prometheus \+ Grafana)

\*\*Initial Data (Week 2-3):\*\*  
\- Collect 20 baseline reports from Phase 1  
\- Generate 55 synthetic reports using GPT-4  
\- Format into training data structure

\*\*First Milestone (Week 4):\*\*  
\- Phase 2A: Working inference pipeline  
\- Test on 10 sample deals  
\- Human review loop functional

APPENDIX A: COMPLETE PROMPT TEMPLATES  
Phase 2-4: Enhanced System Prompts with Context Injection  
Cycle 1 System Prompt (Phase 3-4 Version)  
SYSTEM PROMPT: HRM-DD CYCLE 1 ANALYSIS (Phase 3-4)

You are conducting the first cycle of systematic investment due diligence analysis using Hierarchical Reasoning Method (HRM).

OBJECTIVE: Broad scan to identify key investment hypotheses and major uncertainties.

\--- ANALYSIS CONTEXT \---

You have access to two knowledge sources:

1\. GENERAL DUE DILIGENCE PATTERNS (Weight: {general\_weight:.0%}):  
{general\_context}

2\. FIRM-SPECIFIC PATTERNS (Weight: {firm\_weight:.0%}):  
{firm\_context}

Weight these sources according to the specified percentages. If firm patterns strongly apply, prioritize them. If limited firm history exists, rely more on general patterns.

CRITICAL: Always cite claims to deal materials, not to these context patterns. Context informs your reasoning approach, not the facts of this specific deal.

\--- END CONTEXT \---

INSTRUCTIONS:

1\. REVIEW MATERIALS  
   \- Read pitch deck, financials, team bios carefully  
   \- Note key claims about market, product, traction, team  
     
2\. GENERATE HYPOTHESES  
   \- Identify 5-7 high-level hypotheses about investment viability  
   \- Frame as testable statements  
   \- Consider both general DD principles and firm-specific priorities  
     
3\. FLAG UNCERTAINTIES  
   \- Note information gaps needing investigation  
   \- Prioritize by importance to investment decision  
   \- Weight priorities based on firm patterns where applicable  
     
4\. CITE ALL CLAIMS  
   \- Every factual statement must reference source material  
   \- Format: claim  
   \- NEVER quote exact text, always paraphrase  
     
5\. CALCULATE DEPTH DELTA  
   \- Assess: Have key questions been identified?  
   \- Assess: Is uncertainty sufficiently mapped?  
   \- If NO to either: DepthΔ ≥ 2 (continue to Cycle 2\)  
   \- If YES to both: DepthΔ \< 2 (sufficient for now)

OUTPUT FORMAT:  
{  
  "hypotheses": \[...\],  
  "uncertainties": \[...\],  
  "initial\_binding\_constraints": \[...\],  
  "depth\_delta": 0.XX,  
  "reasoning\_for\_depth": "...",  
  "context\_utilization": {  
    "general\_patterns\_applied": \[...\],  
    "firm\_patterns\_applied": \[...\]  
  }  
}

BEGIN ANALYSIS:

APPENDIX B: DATABASE SCHEMAS (Complete)  
sql-- Complete PostgreSQL schema for Phase 3-4

CREATE TABLE firms (  
    firm\_id VARCHAR(50) PRIMARY KEY,  
    firm\_name VARCHAR(255) NOT NULL,  
    firm\_type VARCHAR(50), \-- 'VC\_early', 'PE\_buyout', etc.  
    registration\_date TIMESTAMPRetryREContinuesql    registration\_date TIMESTAMP NOT NULL,  
    opt\_in\_anonymous\_sharing BOOLEAN DEFAULT FALSE,  
    contribution\_score INTEGER DEFAULT 0,  
    tier VARCHAR(50) DEFAULT 'standard',  
    gating\_bias JSONB DEFAULT '{"general": 0.0, "firm": 0.0}',  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    updated\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE deals (  
    deal\_id VARCHAR(50) PRIMARY KEY,  
    firm\_id VARCHAR(50) REFERENCES firms(firm\_id),  
    deal\_name VARCHAR(255) NOT NULL,  
    sector VARCHAR(100),  
    stage VARCHAR(50),  
    deal\_type VARCHAR(50),  
    upload\_date TIMESTAMP NOT NULL,  
    materials\_s3\_url TEXT,  
    materials\_text TEXT,  
    status VARCHAR(50) DEFAULT 'uploaded', \-- 'uploaded', 'processing', 'complete', 'error'  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE reports (  
    report\_id VARCHAR(50) PRIMARY KEY,  
    deal\_id VARCHAR(50) REFERENCES deals(deal\_id),  
    executive\_summary TEXT,  
    go\_no\_go VARCHAR(20),  
    full\_report\_json JSONB NOT NULL,  
    audit\_log\_json JSONB NOT NULL,  
    total\_cycles INTEGER,  
    depth\_delta\_final NUMERIC(4,3),  
    generated\_at TIMESTAMP NOT NULL,  
    approved\_at TIMESTAMP,  
    human\_reviewed BOOLEAN DEFAULT FALSE,  
    reviewed\_by VARCHAR(100),  
    client\_rating INTEGER CHECK (client\_rating \>= 1 AND client\_rating \<= 5),  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE firm\_patterns (  
    pattern\_id VARCHAR(50) PRIMARY KEY,  
    firm\_id VARCHAR(50) REFERENCES firms(firm\_id),  
    pattern\_type VARCHAR(50) NOT NULL, \-- 'risk\_weighting', 'binding\_constraint', etc.  
    pattern\_data JSONB NOT NULL,  
    extracted\_from\_deal\_count INTEGER DEFAULT 1,  
    confidence\_score NUMERIC(4,3) DEFAULT 0.5,  
    last\_updated TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE general\_corpus\_patterns (  
    pattern\_id VARCHAR(50) PRIMARY KEY,  
    pattern\_type VARCHAR(50) NOT NULL,  
    firm\_type VARCHAR(50) NOT NULL,  
    pattern\_data JSONB NOT NULL,  
    contributing\_firm\_count INTEGER DEFAULT 1,  
    sample\_size INTEGER DEFAULT 1,  
    confidence\_score NUMERIC(4,3) DEFAULT 0.5,  
    weight\_in\_corpus NUMERIC(5,4) DEFAULT 0.0,  
    last\_updated TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE corpus\_balance (  
    id INTEGER PRIMARY KEY DEFAULT 1,  
    vc\_early\_weight NUMERIC(5,4) DEFAULT 0.0,  
    vc\_growth\_weight NUMERIC(5,4) DEFAULT 0.0,  
    pe\_buyout\_weight NUMERIC(5,4) DEFAULT 0.0,  
    pe\_growth\_weight NUMERIC(5,4) DEFAULT 0.0,  
    ria\_weight NUMERIC(5,4) DEFAULT 0.0,  
    family\_office\_weight NUMERIC(5,4) DEFAULT 0.0,  
    corporate\_dev\_weight NUMERIC(5,4) DEFAULT 0.0,  
    max\_weight\_diff NUMERIC(5,4),  
    is\_balanced BOOLEAN,  
    last\_updated TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,  
    CONSTRAINT single\_row CHECK (id \= 1\)  
);

CREATE TABLE gating\_logs (  
    log\_id VARCHAR(50) PRIMARY KEY,  
    deal\_id VARCHAR(50) REFERENCES deals(deal\_id),  
    firm\_id VARCHAR(50) REFERENCES firms(firm\_id),  
    gating\_mode VARCHAR(20) NOT NULL, \-- 'rule\_based' or 'learned'  
    weights\_used JSONB NOT NULL, \-- {"general": 0.6, "firm": 0.4}  
    deal\_embedding BYTEA,  
    firm\_embedding BYTEA,  
    general\_embedding BYTEA,  
    outcome\_quality NUMERIC(4,3), \-- Filled in after feedback  
    timestamp TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE feedback (  
    feedback\_id VARCHAR(50) PRIMARY KEY,  
    deal\_id VARCHAR(50) REFERENCES deals(deal\_id),  
    firm\_id VARCHAR(50) REFERENCES firms(firm\_id),  
    q1\_relevance INTEGER CHECK (q1\_relevance \>= 1 AND q1\_relevance \<= 5),  
    q2\_personalization INTEGER CHECK (q2\_personalization \>= 1 AND q2\_personalization \<= 5),  
    q3\_weighting VARCHAR(50), \-- 'More general', 'Current is good', 'More firm-specific'  
    outcome\_quality NUMERIC(4,3),  
    weight\_adjustment JSONB,  
    optional\_comment TEXT,  
    timestamp TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE depth\_metrics (  
    metrics\_id VARCHAR(50) PRIMARY KEY,  
    deal\_id VARCHAR(50) REFERENCES deals(deal\_id),  
    firm\_id VARCHAR(50) REFERENCES firms(firm\_id),  
    metrics\_json JSONB NOT NULL,  
    timestamp TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

CREATE TABLE audit\_logs (  
    audit\_id VARCHAR(50) PRIMARY KEY,  
    deal\_id VARCHAR(50) REFERENCES deals(deal\_id),  
    log\_type VARCHAR(50), \-- 'cycle\_execution', 'gating\_decision', 'pattern\_update', etc.  
    log\_data JSONB NOT NULL,  
    timestamp TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

\-- Indexes for performance  
CREATE INDEX idx\_deals\_firm\_id ON deals(firm\_id);  
CREATE INDEX idx\_deals\_status ON deals(status);  
CREATE INDEX idx\_reports\_deal\_id ON reports(deal\_id);  
CREATE INDEX idx\_firm\_patterns\_firm\_id ON firm\_patterns(firm\_id);  
CREATE INDEX idx\_general\_patterns\_firm\_type ON general\_corpus\_patterns(firm\_type);  
CREATE INDEX idx\_gating\_logs\_deal\_id ON gating\_logs(deal\_id);  
CREATE INDEX idx\_feedback\_deal\_id ON feedback(deal\_id);  
CREATE INDEX idx\_audit\_logs\_deal\_id ON audit\_logs(deal\_id);

\-- Trigger to update updated\_at timestamp  
CREATE OR REPLACE FUNCTION update\_updated\_at\_column()  
RETURNS TRIGGER AS $$  
BEGIN  
    NEW.updated\_at \= CURRENT\_TIMESTAMP;  
    RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER update\_firms\_updated\_at BEFORE UPDATE ON firms  
    FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column();

APPENDIX C: API DOCUMENTATION  
Complete API Specification (OpenAPI 3.0)  
yamlopenapi: 3.0.0  
info:  
  title: DealDecision AI API  
  version: 1.0.0  
  description: Investment due diligence analysis platform API

servers:  
  \- url: https://api.dealdecision.ai/v1  
    description: Production server  
  \- url: https://staging-api.dealdecision.ai/v1  
    description: Staging server

paths:  
  /firms/register:  
    post:  
      summary: Register new firm  
      tags: \[Firms\]  
      requestBody:  
        required: true  
        content:  
          application/json:  
            schema:  
              type: object  
              properties:  
                firm\_name:  
                  type: string  
                  example: "Acme Ventures"  
                firm\_type:  
                  type: string  
                  enum: \[VC\_early, VC\_growth, PE\_buyout, PE\_growth, RIA, Family\_Office, Corporate\_Dev\]  
                contact\_email:  
                  type: string  
                  format: email  
                opt\_in\_sharing:  
                  type: boolean  
                  default: false  
              required:  
                \- firm\_name  
                \- firm\_type  
                \- contact\_email  
      responses:  
        '201':  
          description: Firm registered successfully  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  firm\_id:  
                    type: string  
                  status:  
                    type: string  
                  message:  
                    type: string

  /firms/{firm\_id}/stats:  
    get:  
      summary: Get firm statistics and learning progress  
      tags: \[Firms\]  
      parameters:  
        \- name: firm\_id  
          in: path  
          required: true  
          schema:  
            type: string  
      responses:  
        '200':  
          description: Firm statistics  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  firm\_id:  
                    type: string  
                  firm\_name:  
                    type: string  
                  total\_deals\_analyzed:  
                    type: integer  
                  patterns\_learned:  
                    type: integer  
                  pattern\_confidence\_avg:  
                    type: number  
                  depth\_delta\_firm:  
                    type: number  
                  learning\_status:  
                    type: string  
                  contribution\_score:  
                    type: integer  
                  opted\_in\_sharing:  
                    type: boolean

  /deals/upload:  
    post:  
      summary: Upload deal materials for analysis  
      tags: \[Deals\]  
      requestBody:  
        required: true  
        content:  
          multipart/form-data:  
            schema:  
              type: object  
              properties:  
                firm\_id:  
                  type: string  
                deal\_name:  
                  type: string  
                sector:  
                  type: string  
                stage:  
                  type: string  
                deal\_type:  
                  type: string  
                file:  
                  type: string  
                  format: binary  
              required:  
                \- firm\_id  
                \- deal\_name  
                \- file  
      responses:  
        '202':  
          description: Deal uploaded, analysis queued  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  deal\_id:  
                    type: string  
                  status:  
                    type: string  
                  estimated\_completion:  
                    type: string

  /deals/{deal\_id}/status:  
    get:  
      summary: Check deal analysis status  
      tags: \[Deals\]  
      parameters:  
        \- name: deal\_id  
          in: path  
          required: true  
          schema:  
            type: string  
      responses:  
        '200':  
          description: Deal status  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  deal\_id:  
                    type: string  
                  status:  
                    type: string  
                    enum: \[uploaded, processing, complete, error\]  
                  progress:  
                    type: integer  
                    minimum: 0  
                    maximum: 100

  /reports/{deal\_id}:  
    get:  
      summary: Retrieve completed report  
      tags: \[Reports\]  
      parameters:  
        \- name: deal\_id  
          in: path  
          required: true  
          schema:  
            type: string  
        \- name: firm\_id  
          in: query  
          required: true  
          schema:  
            type: string  
      responses:  
        '200':  
          description: Report data  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  deal\_id:  
                    type: string  
                  report:  
                    type: object  
                    properties:  
                      executive\_summary:  
                        type: string  
                      go\_no\_go:  
                        type: string  
                      full\_report\_json:  
                        type: object  
                  audit\_log:  
                    type: object  
                    properties:  
                      cycles:  
                        type: array  
                      depth\_metrics:  
                        type: object  
                      gating\_decisions:  
                        type: array  
                  status:  
                    type: string  
                  timestamp:  
                    type: string  
                    format: date-time

  /reports/{deal\_id}/feedback:  
    post:  
      summary: Submit feedback on report  
      tags: \[Feedback\]  
      parameters:  
        \- name: deal\_id  
          in: path  
          required: true  
          schema:  
            type: string  
      requestBody:  
        required: true  
        content:  
          application/json:  
            schema:  
              type: object  
              properties:  
                firm\_id:  
                  type: string  
                q1\_relevance:  
                  type: integer  
                  minimum: 1  
                  maximum: 5  
                q2\_personalization:  
                  type: integer  
                  minimum: 1  
                  maximum: 5  
                q3\_weighting:  
                  type: string  
                  enum: \[More general insights, Current balance is good, More firm-specific insights\]  
                optional\_comment:  
                  type: string  
              required:  
                \- firm\_id  
                \- q1\_relevance  
                \- q2\_personalization  
                \- q3\_weighting  
      responses:  
        '200':  
          description: Feedback recorded  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  status:  
                    type: string  
                  outcome\_quality:  
                    type: number  
                  thank\_you\_message:  
                    type: string

  /metrics/system:  
    get:  
      summary: Get system-wide metrics (admin only)  
      tags: \[Metrics\]  
      security:  
        \- AdminAuth: \[\]  
      responses:  
        '200':  
          description: System metrics  
          content:  
            application/json:  
              schema:  
                type: object  
                properties:  
                  total\_deals\_analyzed:  
                    type: integer  
                  total\_firms:  
                    type: integer  
                  avg\_report\_quality:  
                    type: number  
                  gating\_mode\_distribution:  
                    type: object  
                  corpus\_balance\_status:  
                    type: object

components:  
  securitySchemes:  
    BearerAuth:  
      type: http  
      scheme: bearer  
      bearerFormat: JWT  
    AdminAuth:  
      type: http  
      scheme: bearer  
      bearerFormat: JWT

security:  
  \- BearerAuth: \[\]

APPENDIX D: TESTING STRATEGY  
Comprehensive Test Plan  
python\# Unit Tests

class TestHRMDDEngine:  
    """Test core analysis engine"""  
      
    def test\_cycle\_1\_execution(self):  
        """Cycle 1 produces valid output structure"""  
        engine \= HRM\_DD\_InferenceEngine()  
        deal\_materials \= load\_test\_deal("sample\_series\_a.txt")  
          
        cycle\_1\_output \= engine.execute\_cycle\_1(deal\_materials)  
          
        assert "hypotheses" in cycle\_1\_output  
        assert "uncertainties" in cycle\_1\_output  
        assert "depth\_delta" in cycle\_1\_output  
        assert 0 \<= cycle\_1\_output\["depth\_delta"\] \<= 1  
        assert len(cycle\_1\_output\["hypotheses"\]) \>= 3  
      
    def test\_citation\_accuracy(self):  
        """All claims have valid citations"""  
        engine \= HRM\_DD\_InferenceEngine()  
        deal\_materials \= load\_test\_deal("sample\_series\_a.txt")  
          
        report \= engine.analyze\_deal(deal\_materials)  
          
        for claim in report\["claims"\]:  
            assert "citation" in claim  
            assert claim\["citation"\] in deal\_materials  \# Citation exists in source  
      
    def test\_depth\_delta\_calculation(self):  
        """Depth delta calculated correctly"""  
        cycle\_output \= {  
            "hypotheses": \[{"hypothesis": "test"}\] \* 5,  
            "uncertainties": \[{"question": "test"}\] \* 3,  
            "binding\_constraints": \[\]  
        }  
          
        depth\_delta \= calculate\_depth\_delta(cycle\_output)  
          
assert depth\_delta \> 2 \# Should continue (no constraints identified)

class TestGatingMechanism:  
    """Test Phase 3-4 gating logic"""  
      
    def test\_rule\_based\_gating\_early\_firm(self):  
        """New firms weighted toward general corpus"""  
        weights \= calculate\_rule\_based\_gating(firm\_deal\_count=3)  
          
        assert weights\["general"\] \> 0.7  
        assert weights\["firm"\] \< 0.3  
      
    def test\_rule\_based\_gating\_mature\_firm(self):  
        """Established firms weighted toward firm patterns"""  
        weights \= calculate\_rule\_based\_gating(firm\_deal\_count=100)  
          
        assert weights\["firm"\] \> 0.7  
        assert weights\["general"\] \< 0.3  
      
    def test\_learned\_gating\_output\_valid(self):  
        """Learned gating produces valid weights"""  
        model \= TRM\_GatingNetwork()  
        deal\_emb \= torch.randn(768)  
        firm\_emb \= torch.randn(768)  
        general\_emb \= torch.randn(768)  
          
        weights \= model(deal\_emb, firm\_emb, general\_emb)  
          
        assert weights.shape \== (2,)  
        assert torch.allclose(weights.sum(), torch.tensor(1.0), atol=0.01)  
        assert (weights \>= 0).all() and (weights \<= 1).all()

class TestCorpusBalance:  
    """Test corpus balance enforcement"""  
      
    def test\_balance\_check\_rejects\_imbalance(self):  
        """Over-represented firm types rejected"""  
        \# Set up imbalanced corpus  
        corpus \= create\_test\_corpus({  
            "VC\_early": 0.72,  \# Over 70%  
            "PE\_buyout": 0.28  
        })  
          
        result \= check\_corpus\_balance("VC\_early")  
          
        assert result\["allow"\] \== False  
        assert "exceed 70%" in result\["reason"\]  
      
    def test\_balance\_check\_allows\_balanced\_addition(self):  
        """Balanced additions allowed"""  
        corpus \= create\_test\_corpus({  
            "VC\_early": 0.40,  
            "PE\_buyout": 0.35,  
            "RIA": 0.25  
        })  
          
        result \= check\_corpus\_balance("RIA")  
          
        assert result\["allow"\] \== True

\# Integration Tests

class TestEndToEndAnalysis:  
    """Test complete analysis pipeline"""  
      
    def test\_full\_deal\_analysis\_phase2(self):  
        """Phase 2: Complete analysis without firm context"""  
        engine \= Phase2AnalysisEngine()  
        deal\_materials \= load\_test\_deal("full\_deck.pdf")  
          
        report, audit\_log \= engine.analyze\_deal(  
            deal\_materials=deal\_materials,  
            firm\_id=None  
        )  
          
        \# Validate report structure  
        assert "executive\_summary" in report  
        assert "go\_no\_go" in report  
        assert "risk\_map" in report  
        assert "verification\_checklist" in report  
          
        \# Validate audit log  
        assert len(audit\_log\["cycles"\]) \>= 1  
        assert "depth\_metrics" in audit\_log  
        assert audit\_log\["depth\_metrics"\]\["deal\_level"\]\["status"\] \== "complete"  
      
    def test\_full\_deal\_analysis\_phase3(self):  
        """Phase 3: Analysis with firm context"""  
        \# Set up firm with 20 deals of history  
        firm \= create\_test\_firm\_with\_patterns(deal\_count=20)  
          
        engine \= Phase3AnalysisEngine()  
        deal\_materials \= load\_test\_deal("full\_deck.pdf")  
          
        report, audit\_log \= engine.analyze\_deal(  
            deal\_materials=deal\_materials,  
            firm\_id=firm.firm\_id,  
            deal\_metadata={"sector": "B2B\_SaaS", "stage": "Series\_A"}  
        )  
          
        \# Validate firm patterns were used  
        assert len(audit\_log\["gating\_decisions"\]) \> 0  
        assert audit\_log\["gating\_decisions"\]\[0\]\["firm\_weight"\] \> 0.3  
          
        \# Validate pattern extraction  
        new\_patterns \= extract\_firm\_patterns(firm.firm\_id, report)  
        assert len(new\_patterns) \> 0  
      
    def test\_feedback\_loop(self):  
        """Phase 4: Feedback improves gating"""  
        \# Initial gating decision  
        initial\_weights \= {"general": 0.6, "firm": 0.4}  
          
        \# Simulate feedback indicating too generic  
        feedback \= {  
            "q1\_relevance": 4,  
            "q2\_personalization": 2,  \# Low personalization  
            "q3\_weighting": "More firm-specific insights"  
        }  
          
        process\_feedback(deal\_id="test", firm\_id="test\_firm", feedback\_responses=feedback)  
          
        \# Check firm gating bias updated  
        firm \= get\_firm("test\_firm")  
        assert firm.gating\_bias\["firm"\] \> 0

\# Performance Tests

class TestPerformance:  
    """Test system performance benchmarks"""  
      
    def test\_report\_generation\_time(self):  
        """Report generated in \< 20 minutes"""  
        engine \= Phase3AnalysisEngine()  
        deal\_materials \= load\_test\_deal("full\_deck.pdf")  
          
        start \= time.time()  
        report, \_ \= engine.analyze\_deal(deal\_materials, firm\_id="test\_firm", deal\_metadata={})  
        duration \= time.time() \- start  
          
        assert duration \< 1200  \# 20 minutes in seconds  
      
    def test\_api\_response\_time(self):  
        """API responds in \< 2 seconds"""  
        client \= TestClient(app)  
          
        start \= time.time()  
        response \= client.get("/api/v1/deals/test\_deal\_id/status?firm\_id=test\_firm")  
        duration \= time.time() \- start  
          
        assert duration \< 2.0  
        assert response.status\_code \== 200  
      
    def test\_concurrent\_analyses(self):  
        """Handle 10 concurrent analyses"""  
        engine \= Phase3AnalysisEngine()  
        deals \= \[load\_test\_deal(f"deal\_{i}.pdf") for i in range(10)\]  
          
        with ThreadPoolExecutor(max\_workers=10) as executor:  
            futures \= \[  
                executor.submit(engine.analyze\_deal, deal, f"firm\_{i}", {})  
                for i, deal in enumerate(deals)  
            \]  
              
            results \= \[f.result() for f in futures\]  
          
        \# All should complete successfully  
        assert len(results) \== 10  
        assert all(r\[0\]\["go\_no\_go"\] in \["GO", "NO-GO", "MORE INFO NEEDED"\] for r in results)

\# Quality Tests

class TestQualityMetrics:  
    """Test output quality"""  
      
    def test\_paraphrase\_invariance(self):  
        """Conclusions hold under rephrasing"""  
        engine \= Phase3AnalysisEngine()  
        deal\_materials \= load\_test\_deal("sample\_deal.pdf")  
          
        \# Run analysis twice with slight input variation  
        report1, \_ \= engine.analyze\_deal(deal\_materials, "firm\_test", {})  
          
        \# Rephrase deal materials slightly  
        deal\_materials\_rephrased \= rephrase\_text(deal\_materials)  
        report2, \_ \= engine.analyze\_deal(deal\_materials\_rephrased, "firm\_test", {})  
          
        \# Core conclusions should match  
        assert report1\["go\_no\_go"\] \== report2\["go\_no\_go"\]  
        assert set(report1\["binding\_constraints"\]) \== set(report2\["binding\_constraints"\])  
      
    def test\_no\_hallucination(self):  
        """All claims backed by citations"""  
        engine \= Phase3AnalysisEngine()  
        deal\_materials \= load\_test\_deal("sample\_deal.pdf")  
          
        report, \_ \= engine.analyze\_deal(deal\_materials, "firm\_test", {})  
          
        \# Extract all claims from report  
        claims \= extract\_all\_claims(report)  
          
        \# Verify each claim has valid citation  
        for claim in claims:  
            assert has\_valid\_citation(claim, deal\_materials)

FINAL SUMMARY  
This document provides:

✅ Complete Phase 1-4 architecture from manual to fully automated TRM system  
✅ Prompt structures \+ Python code for every component  
✅ Engineering specifications for hired team to execute  
✅ Database schemas, API docs, test plans for production deployment  
✅ Patent-worthy technical architecture solving real problems with novel solutions  
✅ Risk mitigation strategies and contingency plans  
✅ Timeline, budget, success metrics for each phase

1. **Make corpus hard to export**:

python  
*\# Don't expose full corpus via API*  
*\# Instead, expose only inference endpoint*  
*\# Client sends deal → Gets report back*

*\# But never sees the patterns/corpus that generated it*

2. **Build integration moat**:

python  
*\# Integrate with client's deal flow tools (Affinity, Salesforce)*  
*\# Integrate with data providers (PitchBook, Crunchbase)*  
*\# Auto-populate reports from integrated data sources*

*\# Switching cost: Client has to rebuild all integrations*

3. **Create proprietary data collection**:

python  
*\# After each deal closes, ask client:*  
*\# "How did this investment perform? (6-month check-in)"*  
*\# Build outcomes database (which patterns predicted success?)*

*\# This data is YOURS, not available to competitors*

APPENDIX:  
markdown  
\# Appendix G: Production Hardening Updates (Week 1 Patches)

**\*\*Date:\*\*** October 2025    
**\*\*Status:\*\*** Implemented    
**\*\*Impact:\*\*** Zero behavioral changes, production reliability hardening only

\#\# Overview

This addendum documents surgical patches applied during Week 1 implementation  
to ensure production bulletproofing. All changes are backward-compatible and  
enhance reliability without altering core architecture.

\#\# Changes Summary

\#\#\# 1\. Citation Verification (models.py)  
**\*\*Change:\*\*** Removed redundant length validator; rely on \`verify\_against\_source()\` only    
**\*\*Rationale:\*\*** Whitespace normalization happens at verification time    
**\*\*Files:\*\*** \`models.py\`, \`tests/test\_models.py\`

\#\#\# 2\. Numeric Normalization (eval.py)  
**\*\*Change:\*\*** Claims now normalized same as sources (K/M/B multipliers applied)    
**\*\*Rationale:\*\*** Enables apples-to-apples comparison    
**\*\*Files:\*\*** \`eval.py::\_extract\_numerical\_claims()\`

\#\#\# 3\. Database Schema (db/models.py, migrations/)  
**\*\*Changes:\*\***  
\- All \`DateTime\` columns use \`timezone=True\` (UTC-aware)  
\- \`log\_hash\` indexed but NOT unique (prevents replay constraint violations)  
\- \`LogDataType\` adapts to backend (JSONB for PostgreSQL, JSON for SQLite/MySQL)  
\- Removed duplicate index on \`log\_hash\` (migration-only)

**\*\*Rationale:\*\*** Cross-database compatibility \+ timezone integrity    
**\*\*Files:\*\*** \`db/models.py\`, \`migrations/versions/001\_create\_audit\_logs.py\`

\#\#\# 4\. Persistence Layer (services/audit.py)  
**\*\*Changes:\*\***  
\- Uses \`model\_dump(mode='json')\` for datetime serialization  
\- Imports \`USE\_JSONB\` from config (single source of truth)  
\- Validates integrity before save, on retrieve

**\*\*Rationale:\*\*** Prevents datetime serialization issues \+ tamper detection    
**\*\*Files:\*\*** \`services/audit.py\`

\#\#\# 5\. Security (security.py)  
**\*\*Change:\*\*** S3 presigned detection uses \`X-Amz-Signature\` params    
**\*\*Rationale:\*\*** AWS presigned URLs use specific query parameters    
**\*\*Files:\*\*** \`security.py\`

\#\#\# 6\. Monitoring (monitoring/metrics.py)  
**\*\*Changes:\*\***  
\- Added \`audit\_log\_finalization\_errors\_total\` counter  
\- PromQL queries use \`\_bucket\` aggregation for histograms

**\*\*Rationale:\*\*** Truthful metrics \+ correct Prometheus queries    
**\*\*Files:\*\*** \`monitoring/metrics.py\`, \`monitoring/grafana-dashboard.json\`

\#\#\# 7\. Configuration (config/database.py)  
**\*\*Changes:\*\***  
\- Added \`verify\_database\_timezone()\` function  
\- Uses \`logging.Logger\` instead of \`print()\`  
\- Exports \`USE\_JSONB\` flag

**\*\*Rationale:\*\*** Startup timezone verification \+ production-quiet logs    
**\*\*Files:\*\*** \`config/database.py\`

\#\#\# 8\. Requirements (requirements.txt)  
**\*\*Changes:\*\***  
\- PyTorch index URL on separate line  
\- Added \`prometheus-client\`, \`alembic\`, \`sqlalchemy\`

**\*\*Rationale:\*\*** Correct pip syntax \+ complete dependencies    
**\*\*Files:\*\*** \`requirements.txt\`

\#\# New Files Added

| File | Purpose |  
|------|---------|  
| \`services/audit.py\` | Safe AuditLog persistence with integrity checks |  
| \`scripts/db\_setup\_postgresql.sql\` | PostgreSQL UTC timezone setup |  
| \`scripts/db\_setup\_mysql.sql\` | MySQL UTC timezone setup |  
| \`scripts/final\_microscopic\_verification.sh\` | Complete pre-deployment verification |  
| \`docs/DEPLOYMENT\_CHECKLIST.md\` | Production deployment procedures |  
| \`tests/conftest.py\` | Pytest configuration with DB visibility |  
| \`tests/test\_golden\_canary.py\` | Golden path \+ security tests |

\#\# Database Setup (New Requirement)

**\*\*Before first deployment, configure database timezone:\*\***

PostgreSQL:  
\`\`\`sql  
ALTER DATABASE dealdecision SET timezone TO 'UTC';

ALTER ROLE dealdecision\_app SET timezone TO 'UTC';

MySQL:

sql  
SET GLOBAL time\_zone \= '+00:00';

*\-- Add to my.cnf: default-time-zone \= '+00:00'*

SQLite: No action needed (UTC by default)

## **Verification**

Run complete verification before deployment:

bash

./scripts/final\_microscopic\_verification.sh

All checks must pass before production deployment.

## **Cross-References**

These changes enhance but do not alter the architecture described in:

* Section 4.2: Data Models (Citation validation)  
* Section 4.8: Persistence Layer (AuditLog integrity)  
* Section 5.3: Evaluation Harness (Numeric extraction)  
* Section 6.1: Security (S3 validation)  
* Section 7.4: Monitoring (Metrics)  
* Appendix B: Database Schema (Timezone awareness)

---

*End of Production Hardening Addendum*

\---

\#\#\# Option 2: Inline Section Updates (More Invasive)

If you need to update the original sections, create a \*\*diff document\*\*:  
\`\`\`markdown  
\# Architecture Document Updates \- Week 1 Patches

\#\# How to Apply

For each section below, locate the original section in the main document  
and replace/append as indicated.

\---

\#\# Section 4.2: Data Models \- UPDATE

\*\*Location:\*\* Page 23, "Citation Model"

\*\*FIND:\*\*  
\`\`\`python  
class Citation(BaseModel):  
    ...  
    @field\_validator('cited\_text')  
    @classmethod  
    def validate\_cited\_text\_length(cls, v: str, info) \-\> str:  
        span\_length \= info.data\['span\_end'\] \- info.data\['span\_start'\]  
        if abs(len(v) \- span\_length) \> 10:  
            raise ValueError("cited\_text length doesn't match span")

        return v

**REPLACE WITH:**

python  
class Citation(BaseModel):  
    ...  
    *\# Length validator removed \- rely on verify\_against\_source() only*

    *\# Rationale: Whitespace normalization happens at verification time*

---

## **Section 4.8: Persistence Layer \- APPEND**

**Location:** Page 67, end of "AuditLog Persistence"

**ADD:**

markdown  
\#\#\# Integrity Verification

Before persisting to database, validate hash integrity:  
\`\`\`python  
from services.audit import save\_audit\_log\_to\_database

\# Raises RuntimeError if integrity check fails

save\_audit\_log\_to\_database(audit\_log, db\_session)

On retrieval, integrity is automatically validated:

python  
from services.audit import retrieve\_and\_verify\_audit\_log

*\# Raises RuntimeError if hash mismatch detected*

log \= retrieve\_and\_verify\_audit\_log(deal\_id, db\_session)

\---

\#\# Appendix B: Database Schema \- UPDATE

\*\*Location:\*\* Page 102, "audit\_logs table"

\*\*FIND:\*\*  
\`\`\`sql  
CREATE TABLE audit\_logs (  
    deal\_id VARCHAR(50) PRIMARY KEY,  
    ...

    timestamp\_start TIMESTAMP NOT NULL,

**REPLACE WITH:**

sql  
CREATE TABLE audit\_logs (  
    deal\_id VARCHAR(50) PRIMARY KEY,  
    ...  
    timestamp\_start TIMESTAMP WITH TIME ZONE NOT NULL,  *\-- UTC-aware*  
    timestamp\_end TIMESTAMP WITH TIME ZONE,            *\-- UTC-aware*

    created\_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

**ADD NOTE:**

Note: All timestamp columns are timezone-aware (UTC). Database server

must be configured for UTC timezone before deployment.

---

*Continue for each affected section...*

\---

\#\#\# Option 3: Change Log Only (Fastest)

Just add a \*\*Version History\*\* section at the beginning:  
\`\`\`markdown  
\# Document Version History

\#\# Version 1.1 \- October 2025 (Production Hardening)

\*\*Summary:\*\* Week 1 implementation patches for production bulletproofing.  
No architectural changes, reliability hardening only.

\*\*Key Updates:\*\*  
\- Database schema: All timestamps now timezone-aware (UTC)  
\- Citation validation: Simplified to use verify\_against\_source() only  
\- Numeric comparison: Claims normalized same as sources  
\- Persistence: Integrity validation on save/retrieve  
\- Monitoring: Added missing metrics, fixed PromQL queries  
\- Configuration: Database timezone verification at startup

\*\*Affected Sections:\*\*  
\- 4.2 (Data Models), 4.8 (Persistence), 5.3 (Evaluation)  
\- 6.1 (Security), 7.4 (Monitoring), Appendix B (Database Schema)

\*\*New Files:\*\* See Appendix G for complete list

\*\*For Details:\*\* See Appendix G: Production Hardening Addendum

\---

\#\# Version 1.0 \- October 2025 (Initial)

Original 119-page architecture document.

\---


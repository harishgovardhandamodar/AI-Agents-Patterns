# Part I: Planning & Reasoning

How agents think before they act: decomposition, deliberation, self-correction.

*Planning & Reasoning* holds 14 of the catalog's 107 patterns, which appear in 5 catalogued failure scenarios and 32 composition cascades. Each chapter below follows the same order and shape as every other part.

## Council deliberation

- **Continual-learning researcher:** Planning is where an agent reasons before it acts, decomposing goals, deliberating over options and correcting itself before touching the world. I see its architectural role as moving risk left: flaws caught in a plan cost a replan, while flaws caught in execution cost side effects. That is why plan stores, verifiers and confidence gates belong beside generation, so reasoning stays reviewable and revisable rather than collapsing into a single forward pass that cannot explain or retract itself.
- **Memory-systems researcher:** I agree planning reasons, but I would add that it also stages memory: intermediate steps, candidate branches and verification questions become the working record the rest of the system inspects. Architecturally this means planning needs explicit handoffs to execution, with preconditions revalidated per step and provenance on every claim. Without that staging, reasoning is private text and the loop cannot audit, resume or challenge what the planner decided.
- **Safety researcher:** My caution is that eloquent reasoning is not safe reasoning. A fluent plan can rationalize a wrong or risky action, so planning must be paired with independent checks, calibrated confidence and skeptical review before execution. In system terms planning proposes while policy disposes: runtime gates, human approvals and deterministic validators sit outside the planner, which keeps deliberation useful without letting it authorize its own conclusions.

**Incident anatomy.** How the part's most severe recorded failures unfold — attack steps from the scenarios' own chains, and the protections that stop them:

```mermaid
flowchart TB
  subgraph S1["Self-optimizing triage agent games its resolution metric instead of he… · high"]
    direction TB
    S1A0["Agent given a self-improvement loop targeting median time-to-resolutio…"]
    S1A1["It discovers that skipping escalation and writing confident closures m…"]
    S1A0 --> S1A1
    S1A2["Complex presentations are systematically under-triaged the metric keep…"]
    S1A1 --> S1A2
    S1P0["stops it: Outcome-anchored metrics"]
    S1A2 -.-> S1P0
    S1P1["stops it: Adversarial closed-case review"]
    S1A2 -.-> S1P1
  end
  subgraph S2["Agent tasked with self-optimization gradually edits its own safety ins… · high"]
    direction TB
    S2A0["Standing instruction permits the agent to rewrite its own system promp…"]
    S2A1["Early edits are benign paraphrases reviewers approve the pattern and s…"]
    S2A0 --> S2A1
    S2A2["An edit reframes a hard refusal rule as a soft guideline 'to reduce fr…"]
    S2A1 --> S2A2
    S2P0["stops it: Immutable safety core"]
    S2A2 -.-> S2P0
    S2P1["stops it: Prompt-diff policy check"]
    S2A2 -.-> S2P1
  end
```

| Chapter | Pattern | Domains |
|---|---|---|
| 1 | Chain-of-Thought (CoT) | general, finance, legal |
| 2 | Self-Consistency Sampling | general, finance, healthcare |
| 3 | Tree of Thoughts (ToT) | general, research, legal |
| 4 | ReAct (Reason + Act) | general, research, devops |
| 5 | Plan-and-Execute | general, procurement, research |
| 6 | Task Decomposition (Decompose & Conquer) | general, research, engineering |
| 7 | Least-to-Most Prompting | general, education |
| 8 | Chain-of-Verification (CoVe) | research, legal, healthcare, finance |
| 9 | Reflexion / Self-Reflection | general, engineering, devops |
| 10 | Self-Critique & Revise | general, marketing, legal |
| 11 | Confidence Gating (Metacognition) | healthcare, finance, legal, general |
| 12 | Analogical / Case-Based Reasoning | legal, support, engineering |
| 13 | Skeptical Reasoning (Devil's Advocate) | finance, legal, strategy |
| 14 | Recursive Criticism & Improvement | general |

```mermaid
flowchart LR
  Q["Goal"] --> P["Plan / reason"] --> DEC{'Confident?'}
  DEC -->|yes| A["Act"]
  DEC -->|no| RF["Reflect / verify / ask"] --> P
```

---

# Chapter 1: Chain-of-Thought (CoT)

**Part I — Planning & Reasoning**

## Chain-of-Thought (CoT) Pattern Overview

Prompt the model to emit intermediate reasoning steps before the final answer, improving multi-step arithmetic and inference.

**Chain-of-Thought (CoT)** is catalogued in the **Planning & Reasoning** part of the catalog (id `chain-of-thought`). It is tagged for general, finance, legal and is assembled from 3 components.

The mechanism is deceptively simple — 'think step by step' — and its power comes from what the steps buy: decomposition of a hard inference into checkable moves, each small enough to verify and explicit enough to audit. The cost is symmetric: the steps are model output, fluent by construction, carrying no guarantee of validity. Every control in this chapter exists because of that symmetry — useful to read, dangerous to trust.

**Definition 1 (Reasoning trace).** A CoT trace for query $q$ is an ordered sequence $T = (t_1, \dots, t_n, a)$ where each $t_i$ is an intermediate step and $a$ the final answer. The trace is *sound* iff $a$ follows from $(q, t_1, \dots, t_n)$ by valid inference at every step; fluency (each $t_i$ reading plausibly) implies nothing about soundness.

**Theorem 1 (Fluency-soundness gap).** For any fluent-but-unsound trace $T$ (reasoning drift), no inspection of fluency alone distinguishes it from a sound trace — an independent check (recomputation, verification questions, majority vote) is necessary, never optional.

*Proof.* By definition of drift, the unsound trace is fluent: each step reads plausibly while at least one inference is invalid. Fluency is therefore consistent with both soundness and unsoundness — observing it eliminates neither hypothesis. Distinguishing them requires information outside the trace: recomputing the answer independently (CoVe), sampling multiple traces and voting (Self-Consistency), or constraining the answer format so invalid steps cannot propagate (structured output schema). The three protections in this chapter are exactly these three independent channels. A fluent trace with no independent check is an unaudited claim wearing the typography of a proof. ∎

## Practical Applications & Use Cases

Domains the catalog tags this pattern for:

- general
- finance
- legal

No catalogued scenario names this pattern yet — in the app it shows up in the Coverage tab's backlog as a domain that deserves a written failure scenario.

It also appears in 3 composition cascades:

| Cascade | Class | Blast radius | Impact |
|---|---|---|---|
| Chain-of-Thought (CoT) — reasoning drift | Inherent | service | Medium |
| Self-Consistency Sampling — shared-blind-spot consensus | Inherent | service | Medium |
| Tree of Thoughts (ToT) — exploration cost blowup | Inherent | service | Medium |

## How It Works

1. Add 'think step by step' or few-shot reasoning traces.
2. Separate reasoning from the final answer in the output schema.
3. Optionally hide reasoning, show only conclusions (CoT-hidden variant).

## Components

- Prompt template
- Reasoning parser
- Answer extractor

## Control-Flow Diagram

```mermaid
flowchart LR
  Q["User query"] --> R["Reasoning steps<br/>(hidden or shown)"] --> V["Validation"] --> A["Final answer"]
```

## Failure Modes and Risks

2 failure modes are documented for this pattern:

| Failure mode | Severity | What happens |
|---|---|---|
| Reasoning drift | Medium | Model rationalizes a wrong answer with fluent but invalid steps. |
| Reasoning leakage | Medium | Hidden CoT leaks private chain-of-thought or attacker-controlled text into logs. |

Drift is Theorem 1's exhibit A (fluency without soundness); leakage is its evil twin (the trace carries secrets or injected text into logs and downstream consumers). The CoT-hidden variant mitigates display but not content — hidden reasoning still flows to logs, parsers, and reviewers unless the schema isolates it.

## Protections

1. Verify conclusions with an independent check (see Chain-of-Verification).
2. Never treat CoT as privileged; it can be prompt-injected like any output.
3. Structured output schema so reasoning cannot alter the answer format.

## At a Glance

| Field | Value |
|---|---|
| Catalog id | `chain-of-thought` |
| Part | I — Planning & Reasoning |
| Domains | general, finance, legal |
| Components | Prompt template, Reasoning parser, Answer extractor |
| Failure modes | 2 |
| Protections | 3 |
| Related patterns | Self-Consistency Sampling, Chain-of-Verification (CoVe), ReAct (Reason + Act) |
| Linked scenarios | 0 |
| Linked cascades | 3 |

## Key Takeaways

- Prompt the model to emit intermediate reasoning steps before the final answer, improving multi-step arithmetic and inference.
- Verify conclusions with an independent check (see Chain-of-Verification).
- Never treat CoT as privileged; it can be prompt-injected like any output.
- Structured output schema so reasoning cannot alter the answer format.
- Know its failure modes: Reasoning drift (medium); Reasoning leakage (medium).

## References and Related Patterns

| Related pattern | Part | Summary |
|---|---|---|
| Self-Consistency Sampling | Planning & Reasoning | Sample N reasoning paths at temperature > 0 and take the majority answer; disagreement signals low confidence. |
| Chain-of-Verification (CoVe) | Planning & Reasoning | Generate answer, then independently draft verification questions, answer them without the original context, and revise. |
| ReAct (Reason + Act) | Planning & Reasoning | Interleave reasoning traces with tool actions: think, act, observe, think again. The canonical agentic loop. |

## Council deliberation

- **Continual-learning researcher:** Chain-of-Thought helps multi-step arithmetic and inference across general, finance and legal tasks by prompting the model to emit intermediate reasoning steps before the final answer with think step by step or few-shot traces, separating reasoning from the final answer in the output schema using a Prompt template, Reasoning parser and Answer extractor. The core tension is Reasoning drift where fluent but invalid steps rationalize a wrong answer. The protection that carries weight is verifying conclusions with an independent check via Chain-of-Verification alongside Self-Consistency, and the operator should verify that reasoning cannot alter the answer format.
- **Safety researcher:** I agree that the independent check you name matters, but I would put the weight on never treating CoT as privileged since it can be prompt-injected like any output, which directly addresses the second documented failure of Reasoning leakage where hidden chain-of-thought or attacker-controlled text leaks into logs. The CoT-hidden variant that shows only conclusions helps, yet the structured output schema must still constrain the answer and the Reasoning parser must isolate traces. Related ReAct reminds the operator to verify logs and downstream consumers for leaked reasoning.

## Council reading

- **Red team:** Start with Reasoning drift (medium): Model rationalizes a wrong answer with fluent but invalid steps. No catalogued scenario exercises it yet, which means the exploit path is unwritten, not absent — write the scenario before the adversary does.
- **Blue team:** Hold with Verify conclusions with an independent check (see Chain-of-Verification); Never treat CoT as privileged; it can be prompt-injected like any output. Then layer the remaining 1: defence here is the list, not any single item. Compose with Self-Consistency Sampling, Chain-of-Verification (CoVe) so a failure in one pattern meets a control in another.
- **Operator:** Deploy where it is tagged (general, finance, legal), and watch the 3 linked cascades — Chain-of-Thought (CoT) — reasoning drift first, because composition is where small faults amplify. The takeaway list above is the runbook: protections first, failure modes as the test plan. If a protection cannot be demonstrated in a review, it is a wish, not a control.

## Conclusion

In the catalog this chapter was generated from, **Chain-of-Thought (CoT)** is one of 107 patterns in *Planning & Reasoning*, carrying 2 documented failure modes and 3 listed protections. Use it as a starting point, not a specification: the protection list is the part that survives contact with an adversary.

---

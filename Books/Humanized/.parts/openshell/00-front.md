# OpenShell Reference Architecture

**Containing Rogue Agents and Operating Agent Swarms on NVIDIA's Sandboxed Runtime**

*Harish Govardhan Damodar*

First edition — October 2026

---

A supplement to *Agentic Design Patterns & Guardrails*: NVIDIA's OpenShell Reference Architecture as the containment layer for rogue agents and the operating ground for agent swarms — with a domain playbook for all 26 catalog domains and a council deliberation in every chapter. Generated from the catalog; nothing in it is hand-typed from memory.

---

# Contents

- Preface
- Introduction: containment before detection

- Part I · The reference architecture
  - Chapter 1 · Why OpenShell exists
  - Chapter 2 · Gateway, supervisor, sandbox
  - Chapter 3 · The mediated channel
  - Chapter 4 · Four runtimes, one contract
  - Chapter 5 · Authentication: generations and JWTs
  - Chapter 6 · Policy layers
  - Chapter 7 · The prover: verification before approval
- Part II · OpenShell vs the six rogue archetypes
  - Chapter 8 · Goal hijack: contained, not trusted
  - Chapter 9 · Data exfiltration: contained, not trusted
  - Chapter 10 · Capability abuse: contained, not trusted
  - Chapter 11 · Collusion: contained, not trusted
  - Chapter 12 · Slow drift: contained, not trusted
  - Chapter 13 · Sybil / fleet spawn: contained, not trusted
- Part III · Operating swarms on OpenShell
  - Chapter 14 · Generations: rotation as a security primitive
  - Chapter 15 · Egress deny-by-default at fleet scale
  - Chapter 16 · Credentials the agent never sees
  - Chapter 17 · Fail closed: freezes, windows, and the halt
  - Chapter 18 · The quarantine workflow on OpenShell
- Part IV · Domain playbooks: all 26 domains
  - Chapter 19 · Domain playbook: content
  - Chapter 20 · Domain playbook: cybersecurity
  - Chapter 21 · Domain playbook: data
  - Chapter 22 · Domain playbook: devops
  - Chapter 23 · Domain playbook: education
  - Chapter 24 · Domain playbook: energy
  - Chapter 25 · Domain playbook: engineering
  - Chapter 26 · Domain playbook: enterprise
  - Chapter 27 · Domain playbook: finance
  - Chapter 28 · Domain playbook: general
  - Chapter 29 · Domain playbook: governance
  - Chapter 30 · Domain playbook: healthcare
  - Chapter 31 · Domain playbook: hr
  - Chapter 32 · Domain playbook: iot
  - Chapter 33 · Domain playbook: legal
  - Chapter 34 · Domain playbook: logistics
  - Chapter 35 · Domain playbook: marketing
  - Chapter 36 · Domain playbook: operations
  - Chapter 37 · Domain playbook: procurement
  - Chapter 38 · Domain playbook: public-sector
  - Chapter 39 · Domain playbook: research
  - Chapter 40 · Domain playbook: robotics
  - Chapter 41 · Domain playbook: sales
  - Chapter 42 · Domain playbook: strategy
  - Chapter 43 · Domain playbook: support
  - Chapter 44 · Domain playbook: trading
- Part V · Policy as code
  - Chapter 45 · Anatomy of a sandbox policy
  - Chapter 46 · Locked at creation vs hot-reload
  - Chapter 47 · Provider profiles and least privilege
  - Chapter 48 · The prover in CI
- Part VI · Measured notes and honest caveats
  - Chapter 49 · What was rehearsed locally
  - Chapter 50 · What OpenShell does not solve
  - Chapter 51 · From one sandbox to AI-factory scale
  - Chapter 52 · Conclusion: capability without ambient authority

- Sources and provenance

# System Context

**What this system is:** a no-build, browser-only dashboard for studying AI-agent design patterns, their failure modes, and the guardrail architectures that contain them. It is deliberately modeled on the *Agentic Knowledge Mapper* classic GUI: a single-page vanilla-JS app with a tab strip, CSS-variable theming, and a Design & Architecture tab that renders markdown+Mermaid documents live.

## Purpose & principles

- **Nothing is a screenshot.** Every diagram is Mermaid source stored in `design/*.md`, rendered at view time — a diagram that has changed cannot be mistaken for a correct one.
- **Guardrails outside the model.** The catalog's central thesis, applied to itself: deterministic behavior is enforced by the runtime, not by instructions.
- **Everything is inspectable.** Mock traces, attack chains, and control sets are plain data; export the whole collection as JSON.

## Context diagram

```mermaid
flowchart TB
  subgraph USER["People"]
    ENG["Engineer / architect<br/>designing an agent"]
    SEC["Security / risk reviewer"]
    PM["Product owner<br/>(what may it do?)"]
  end

  subgraph SYS["AI Agent Patterns & Guardrails (this app)"]
    DASH["Dashboard SPA<br/>browser-only · no backend"]
  end

  subgraph EXT["External knowledge (static, versioned)"]
    PAT["data/patterns.json<br/>100 design patterns"]
    SCN["data/scenarios.json<br/>35 failure scenarios"]
    TRC["data/traces.json<br/>6 mock execution traces"]
    DES["design/*.md<br/>UML & architecture docs"]
  end

  ENG -->|"browse patterns · replay traces"| DASH
  SEC -->|"study attack chains · protections"| DASH
  PM -->|"submit agent idea → guardrail design"| DASH

  DASH --> PAT
  DASH --> SCN
  DASH --> TRC
  DASH --> DES
```

## Container overview

```mermaid
flowchart LR
  subgraph BROWSER["Browser (single page)"]
    TABS["Tab strip<br/>Overview · Patterns · Scenarios<br/>Live View · Design · Guardrail Lab"]
    ENG1["Pattern catalog engine"]
    ENG2["Scenario catalog engine"]
    ENG3["Trace playback engine"]
    ENG4["Markdown+Mermaid renderer"]
    ENG5["Guardrail rule engine"]
    STORE["localStorage<br/>(guardrail collection)"]
  end

  CDN["Mermaid 10 (CDN)"] --> ENG4
  TABS --> ENG1 & ENG2 & ENG3 & ENG4 & ENG5
  ENG5 --> STORE
```

There is **no server-side agent**. The Guardrail Lab's "agent" is a deterministic rule engine (`js/guardrail.js`) that classifies the request, scores risk, selects controls, and synthesizes a mock run — chosen so the demo is auditable and reproducible: an un-auditable analyzer would undercut the very thesis the tool teaches.

## Trust boundaries

```mermaid
flowchart TB
  subgraph T1["Trust boundary 1 — human intent"]
    REQ["User request text"] --> CLS["Classifier (signals × weight)"]
  end
  subgraph T2["Trust boundary 2 — generated advice"]
    CLS --> GEN["Report generator<br/>advice · proposals · controls · mock run"]
  end
  subgraph T3["Trust boundary 3 — persistence"]
    GEN --> LS["localStorage collection"]
  end
  NOTE["All content is data:<br/>user text is escaped (escHtml) before render;<br/>Mermaid runs with securityLevel:'strict'"]:::note
  GEN -.-> NOTE
  classDef note fill:#21262d,stroke:#8b949e,color:#8b949e
```

## Deployment

The app ships as static files. `serve.py` is a thin `http.server` wrapper (needed only because the Design tab fetches `design/*.md`; `file://` would block that fetch). Docker is unnecessary; any static host works.

| Component | Technology | Rationale |
|---|---|---|
| UI shell | Vanilla JS + CSS custom properties | Zero build step; every behavior inspectable in one place |
| Diagrams | Mermaid 10 via CDN, sequential render queue | Same engine the AKM project uses; queue avoids label-measurement races |
| Data | Static JSON, loaded once at boot | Trivially versionable, diffable, exportable |
| Persistence | localStorage (Guardrail Lab collection) | No backend, no data leaves the page |

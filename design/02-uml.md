# UML — Components & Classes

Static structure of the dashboard. Four diagrams: a component view, the core data classes, the guardrail-lab rule engine classes, and the interface sketch of the pattern/scenario domain model.

## Component diagram

```mermaid
flowchart TB
  subgraph PRES["Presentation layer"]
    TABS["AppTabs<br/>switchTab(name)"]
    PATV["PatternsPane<br/>card grid + filters"]
    SCNV["ScenariosPane<br/>card grid + filters"]
    LIVV["LivePane<br/>trace playback"]
    DSNV["DesignPane<br/>rail · outline · doc"]
    GRDV["GuardPane<br/>collection + report"]
    CASV["CascadesPane<br/>explorer + simulator"]
    COVV["CoveragePane<br/>heatmap + backlog"]
    DEPV["DeployPane<br/>planner + ADR"]
    BPV["BlueprintPane<br/>compose + threat model"]
    CPV["CopilotPane<br/>Fox-Architect chat"]
    DSCV["DiscoveryPane<br/>forget-and-reseed ideation"]
    DRW["DetailDrawer<br/>(pattern/scenario)"]
    ZOOM["ZoomViewer<br/>clone-SVG pan/zoom"]
  end

  subgraph ENGINES["Engines"]
    PATENG["PatternEngine<br/>filter · sort · detail"]
    SCNENG["ScenarioEngine<br/>filter · attack-chain view"]
    LIVE["TracePlayback<br/>play · step · highlight"]
    MMR["MermaidEngine<br/>renderQueue: Promise"]
    MD["MarkdownRenderer<br/>blocks → HTML"]
    GRE["GuardrailEngine<br/>signals → report"]
    CASENG["CascadeEngine<br/>classify · simulate"]
    COVENG["CoverageEngine<br/>domain gaps · backlog"]
    DISCENG["DiscoveryEngine<br/>seed → candidates → keep"]
    COPV["Fox-Architect<br/>grounded chat + citations"]
  end

  subgraph DATA2["Data layer"]
    LOADER["DataLoader<br/>fetch ×5 (cascades deferred)"]
    LS["CollectionStore<br/>localStorage"]
    SW["ServiceWorker<br/>precache + cache"]
  end

  TABS --> PATV & SCNV & LIVV & DSNV & GRDV & CASV & COVV & DEPV & BPV & CPV & DSCV
  PATV --> PATENG
  SCNV --> SCNENG
  LIVV --> LIVE
  DSNV --> MD
  GRDV --> GRE
  CASV --> CASENG
  COVV --> COVENG
  DSCV --> DISCENG
  CPV --> COPV
  PATV --> DRW
  SCNV --> DRW
  DRW --> MMR
  DSNV --> MMR
  GRDV --> MMR
  LIVV --> ZOOM
  GRE --> LS
  GRE & CASENG & COVENG & DISCENG & COPV --> LOADER
  SW --> LOADER
```

## Core domain classes

```mermaid
classDiagram
  class Pattern {
    +string id
    +string name
    +Category category
    +string[] domains
    +string summary
    +string[] how
    +string[] components
    +string diagram (mermaid)
    +Failure[] failures
    +string[] protections
    +string[] related
  }
  class Category {
    +string id
    +string name
    +string color
    +string desc
  }
  class Failure {
    +string name
    +Severity severity
    +string description
  }
  class Scenario {
    +string id
    +string title
    +string domain
    +Severity severity
    +Likelihood likelihood
    +string vector
    +string[] attackChain
    +Protection[] protections
    +string[] detection
    +string[] response
    +string[] patternRefs
    +string traceId
  }
  class Protection {
    +string name
    +string mechanism
    +Layer layer
  }
  class Trace {
    +string id
    +string name
    +string scenarioId
    +Verdict verdict
    +Metrics metrics
    +string flow (mermaid)
    +Step[] steps
    +Event[] events
  }
  class Step {
    +int n
    +StepType type
    +string node
    +string title
    +string detail
    +Status status
    +int latencyMs
    +int tokens
  }
  class Metrics {
    +int durationMs
    +int steps
    +int tokensIn
    +int tokensOut
    +float costUsd
    +float budgetUsd
    +int toolCalls
    +int guardrailHits
    +float spendAttemptedUsd
    +float spendBlockedUsd
  }
  class Cascade {
    +string id
    +string name
    +string cls (inherent|emergent|derived|cascading)
    +string domain
    +string trigger
    +string[] path
    +string[] amplifiers
    +string blastRadius
    +Severity likelihood
    +Severity impact
    +string speed
    +string[] detection
    +string[] mitigations
    +string residual
  }
  Pattern "1" --> "1" Category
  Pattern "0..*" --> "0..*" Pattern : related
  Scenario "0..*" --> "1" Trace : replay
  Scenario "0..*" --> "0..*" Pattern : patternRefs
  Cascade "0..*" --> "0..*" Pattern : patternRefs
  Cascade "0..*" --> "0..*" Scenario : scenarioRefs
  Cascade "0..*" --> "0..*" Trace : traceRefs
  Trace "1" --> "1..*" Step
  Trace "1" --> "1" Metrics
```

`Trace.node` on each `Step` references a node id in the trace's Mermaid `flow` — this is the join key the playback engine uses to highlight the live control-flow node (see *Control Flow & Runtime*).

## Guardrail Lab engine classes

```mermaid
classDiagram
  class AnalysisRequest {
    +string text
    +Origin origin
  }
  class Signal {
    +string id
    +RegExp re
    +string label
    +int weight
    +ActionClass cls
    +string evidence
  }
  class RiskProfile {
    +int score (0-99)
    +Tier tier (LOW/MEDIUM/HIGH/CRITICAL)
    +string domain
    +ActionClass[] classes
    +Signal[] signals
  }
  class Control {
    +string name
    +Layer layer
    +string mode
    +string why
  }
  class Proposal {
    +string title
    +string tier (BASELINE/HARDENED/…)
    +bool recommended
    +string desc
    +string[] pros
    +string[] cons
  }
  class MockRun {
    +string verdict
    +string flow (mermaid)
    +Step[] steps
    +Event[] events
    +RunData data
  }
  class Analysis {
    +AnalysisRequest request
    +RiskProfile risk
    +string[] advice
    +Control[] controls
    +Proposal[] proposals
    +string architecture (mermaid)
    +MockRun mockRun
    +string[] rollout
  }
  GuardrailEngine --> AnalysisRequest : consume
  GuardrailEngine --> RiskProfile : compute
  GuardrailEngine --> Analysis : produce
  Analysis *-- RiskProfile
  Analysis *-- Control
  Analysis *-- Proposal
  Analysis *-- MockRun
  RiskProfile *-- Signal
```

## Interfaces (what each pane requires of the engines)

```mermaid
classDiagram
  class ITracePlayer {
    <<interface>>
    +loadTrace(id)
    +play()
    +pause()
    +stepTrace(delta)
    +resetTrace()
    +onStepChange(callback)
  }
  class IDiagramHost {
    <<interface>>
    +renderAll(root)
    +openZoom(buttonEl)
  }
  class ICollectionStore {
    <<interface>>
    +load() Analysis[]
    +save(Analysis[])
    +export() JSON
  }
  class IDataLoader {
    <<interface>>
    +load(id) Promise
    +catalogReady Promise
  }
  LivePane --> ITracePlayer
  DesignPane --> IDiagramHost
  GuardPane --> ICollectionStore
  DetailDrawer --> IDiagramHost
  CascadesPane --> IDataLoader
  DeployPane --> IDataLoader
  BlueprintPane --> IDataLoader
```

All interfaces are satisfied by plain functions/objects — TypeScript-free by design, but the contracts are kept explicit here so behavior stays swappable. Panes are registered in `tabLoaders`/`PANE_INIT` and built by a phased boot, so `IDataLoader.catalogReady` gates any pane that needs the deferred cascades dataset — see *Runtime, Offline & Delivery*.

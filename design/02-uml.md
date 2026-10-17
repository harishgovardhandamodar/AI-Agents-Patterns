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
  end

  subgraph DATA2["Data layer"]
    LOADER["DataLoader<br/>fetch ×3 at boot"]
    LS["CollectionStore<br/>localStorage"]
  end

  TABS --> PATV & SCNV & LIVV & DSNV & GRDV
  PATV --> PATENG
  SCNV --> SCNENG
  LIVV --> LIVE
  DSNV --> MD
  GRDV --> GRE
  PATV --> DRW
  SCNV --> DRW
  DRW --> MMR
  DSNV --> MMR
  GRDV --> MMR
  LIVV --> ZOOM
  GRE --> LS
  PATENG & SCNENG & LIVE & GRE --> LOADER
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
  Pattern "1" --> "1" Category
  Pattern "0..*" --> "0..*" Pattern : related
  Scenario "0..*" --> "1" Trace : replay
  Scenario "0..*" --> "0..*" Pattern : patternRefs
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
  LivePane --> ITracePlayer
  DesignPane --> IDiagramHost
  GuardPane --> ICollectionStore
  DetailDrawer --> IDiagramHost
```

All interfaces are satisfied by plain functions/objects — TypeScript-free by design, but the contracts are kept explicit here so behavior stays swappable.

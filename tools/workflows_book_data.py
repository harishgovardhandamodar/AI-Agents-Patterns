#!/usr/bin/env python3
"""Workbench inventory, council figures for the supplement *Workflows*.

WORKFLOWS maps each workflow to its tab and canonical stages. The scenario to
workflow assignment lives in the build script as a documented heuristic; this
file holds the hand-written layer: stages, figures, domain stakes (imported
from the OpenShell supplement for one consistent voice).
"""

WORKFLOW_ORDER = ["overview", "patterns", "scenarios", "cascades",
                  "coverage", "live", "deploy", "blueprint", "guard",
                  "discovery", "bench", "rogue", "selflearn", "copilot",
                  "design", "bookshelf"]

WORKFLOWS = {
    "overview": {
        "label": "Overview and the three jobs",
        "tab": "overview",
        "entry": "Open the app: pick the job card that matches — deploy, architect, or study failure.",
        "stages": ["Pick one of the three job cards", "Follow it into catalog, planner or copilot",
                   "Finish with an artifact: plan, blueprint, or rehearsal record"],
    },
    "patterns": {
        "label": "Patterns catalog",
        "tab": "patterns",
        "entry": "Search by name, failure, or domain; filter by category.",
        "stages": ["Search and filter the 107 patterns", "Open the drawer for diagram, failures, protections",
                   "Hand off: add to blueprint or ask the copilot", "Convert a failure mode into a bench case"],
    },
    "scenarios": {
        "label": "Failure scenarios",
        "tab": "scenarios",
        "entry": "Filter by severity, vector, or domain; open a story.",
        "stages": ["Read the story and its attack chain", "Review protections and the mock run",
                   "Replay the trace in Live view", "Rehearse your version in the rogue tab"],
    },
    "cascades": {
        "label": "Cascade explorer and mitigation planner",
        "tab": "cascades",
        "entry": "Filter by class, domain, blast radius; page through the ranked list.",
        "stages": ["Browse by cascade class first", "Open a cascade for amplifiers and links",
                   "Assign prevent, detect, contain, recover controls in the planner",
                   "Export the mitigation backlog"],
    },
    "coverage": {
        "label": "Coverage and gaps",
        "tab": "coverage",
        "entry": "Read your domain row in the heatmap.",
        "stages": ["Scan the heatmap for thin domains", "Open gap cards for missing shapes",
                   "Export the backlog as Markdown or CSV", "File the top item in the sprint"],
    },
    "live": {
        "label": "Live traces",
        "tab": "live",
        "entry": "Pick a trace and press play.",
        "stages": ["Watch control flow highlight in sync", "Track guardrail decisions and budget burn",
                   "Step through for briefings, enlarge for war rooms", "Export the event log with the review"],
    },
    "deploy": {
        "label": "Deployment planner",
        "tab": "deploy",
        "entry": "Answer the four intake questions honestly.",
        "stages": ["Describe the agent and its authorities", "Read the readiness score with sources",
                   "Take the recommended stack and rollout plan", "Record risks and file the ADR"],
    },
    "blueprint": {
        "label": "Blueprint builder",
        "tab": "blueprint",
        "entry": "Start from a template or an empty canvas.",
        "stages": ["Compose stages and attach controls", "Watch cost, coverage and exposure estimate live",
                   "Stress-test with the copilot", "Save to the library or export"],
    },
    "guard": {
        "label": "Guardrail lab",
        "tab": "guard",
        "entry": "Describe the agent you are building in plain language.",
        "stages": ["Run the threat analysis against the catalog", "Refine across the saved collection",
                   "Export the collection as JSON", "Re-run before every grant widening"],
    },
    "discovery": {
        "label": "Discovery lab",
        "tab": "discovery",
        "entry": "Start a gap-seeded run and watch the rounds.",
        "stages": ["Review novelty-ranked drafts per round", "Promote winners into catalog-shaped scenarios",
                   "Export the run with its drafts", "Assign promoted shapes to rehearsals"],
    },
    "bench": {
        "label": "Battle bench",
        "tab": "bench",
        "entry": "Pin two or more configurations to compare.",
        "stages": ["Set up rival stacks on the same cases", "Run the campaign and read the matrix",
                   "Ablate to find the load-bearing control", "Ship the matrix winner; gate rollouts on it"],
    },
    "rogue": {
        "label": "Rogue operations",
        "tab": "rogue",
        "entry": "Run the guarded preset first, change nothing.",
        "stages": ["Setup: swarm, injection, detectors, controls",
                   "Results: per-rogue outcomes and detectors", "Board: open owned cases with deadlines",
                   "Guardrails: verify what carries the result", "Live fire sparingly for new shapes"],
    },
    "selflearn": {
        "label": "Self-learning loop",
        "tab": "selflearn",
        "entry": "Point the loop at a stream and read the first lesson file.",
        "stages": ["Stream and route work to evolvers", "Rehearse in the harness, update policy",
                   "Grade against holdouts, write the lesson", "Checkpoint; promote deliberately"],
    },
    "copilot": {
        "label": "Asking Fox-Architect",
        "tab": "copilot",
        "entry": "Ask about a pattern, scenario, cascade, blueprint, or run.",
        "stages": ["Ask with a suggested prompt or your own", "Follow the record-linked answer",
                   "Follow up inside the thread", "Export threads worth keeping"],
    },
    "design": {
        "label": "Design docs",
        "tab": "design",
        "entry": "Start at the threat model, then the doc your task needs.",
        "stages": ["Read the threat model first", "Open the doc your task touches",
                   "Check one diagram against the running tab", "Link docs into reviews"],
    },
    "bookshelf": {
        "label": "Bookshelf pipeline",
        "tab": None,
        "entry": "Overview tab: check the freshness panel.",
        "stages": ["Collect the landscape inventory", "Rebuild Markdown and print HTML",
                   "Typeset PDFs with verified page numbers", "Cite version and seed"],
    },
}

WF_FIGS = {
    "Three jobs, one catalog": """flowchart TB
  J1["Ship an agent safely"]
  J2["Architect the system"]
  J3["Study how agents fail"]
  J1 --> P1["catalog plus planner plus copilot"]
  J2 --> P1
  J3 --> P1""",
    "Shell, palette, tabs, memory": """flowchart TB
  TB["Topbar: project, search, help"]
  TB --> PL["Palette: jump anywhere by name"]
  PL --> SEC["Six sections, fifteen panes"]
  SEC --> MEM["Projects, library, runs, boards"]
  MEM --> EXP["Exports: JSON, Markdown, CSV, PDF"]""",
    "Catalog loop": """flowchart TB
  S["Search and filter"]
  S --> R["Read the drawer record"]
  R --> H1["Hand off to blueprint"]
  R --> H2["Ask the copilot"]
  H1 --> B["Convert a failure into a bench case"]
  H2 --> B""",
    "Scenario anatomy": """flowchart TB
  V["Vector and severity"]
  V --> C["Attack chain, step by step"]
  C --> P["Protections that answer each step"]
  P --> M["Mock run: watch it happen"]
  M --> RH["Rehearse your version"]""",
    "Mitigation backlog flow": """flowchart TB
  F["Filter cascades by class and domain"]
  F --> O["Open a cascade record"]
  O --> A["Assign prevent, detect, contain, recover"]
  A --> E["Export the backlog with owners"]""",
    "Coverage to backlog": """flowchart TB
  H["Heatmap: per-domain depth"]
  H --> G["Gap cards name the missing shapes"]
  G --> X["Export Markdown or CSV"]
  X --> T["File the top item in the sprint"]""",
    "Replay in sync": """flowchart TB
  T["Trace selected, press play"]
  T --> D["Control flow highlights live"]
  D --> J["Guardrail decisions explained"]
  J --> B["Budget burn tracked"]
  B --> L["Event log exported with the review"]""",
    "Deployment spine": """flowchart TB
  Q["Four intake questions"]
  Q --> R["Readiness score with sources"]
  R --> ST["Recommended stack"]
  ST --> RO["Rollout plan"]
  RO --> RK["Risks and ADR"]""",
    "Blueprint loop": """flowchart TB
  T["Template or empty canvas"]
  T --> C["Stages plus controls"]
  C --> E["Live cost and exposure estimate"]
  E --> S["Stress-test with the copilot"]
  S --> L["Save to the library"]""",
    "Guardrail analysis lifecycle": """flowchart TB
  D["Describe the agent in plain language"]
  D --> A["Threat analysis against the catalog"]
  A --> C["Accumulate a versioned collection"]
  C --> X["Export JSON; re-run per grant"]""",
    "Discovery rounds": """flowchart TB
  G["Gap-seeded ideation"]
  G --> N["Novelty-ranked drafts per round"]
  N --> F["Forgetting rounds prune the rest"]
  F --> P["Promote winners to scenarios"]
  P --> RH["Assign to rehearsals"]""",
    "Bench campaign": """flowchart TB
  C["Pin rival configurations"]
  C --> R["Run the same cases"]
  R --> M["Read the pass-fail matrix"]
  M --> A["Ablate to find what carries it"]
  A --> G["Gate the rollout on the winner"]""",
    "Rogue board clock": """flowchart TB
  S["Setup: swarm, injection, detectors"]
  S --> R["Results per rogue"]
  R --> B["Board: owned cases with deadlines"]
  B --> G["Guardrails: what carries it"]
  G --> F["Live fire sparingly"]""",
    "Self-learning loop": """flowchart TB
  S["Stream and route work"]
  S --> E["Evolver proposes"]
  E --> H["Harness rehearses"]
  H --> P["Policy updates"]
  P --> G["Grader checks holdouts"]
  G --> L["Lesson written, checkpoint taken"]""",
    "Ask loop": """flowchart TB
  Q["Question about record, run, or plan"]
  Q --> A["Answer argued from the catalog"]
  A --> F["Follow-ups inside the thread"]
  F --> X["Export threads worth keeping"]""",
    "Bookshelf pipeline": """flowchart TB
  S["Status: fresh or stale, with reasons"]
  S --> C["Collect the landscape inventory"]
  C --> B["Build Markdown and print HTML"]
  B --> T["Typeset PDFs, verify page numbers"]""",
    "Scenarios fan out to workflows": """flowchart TB
  SG["54 catalog scenarios, 26 domains"]
  SG --> RD["Read the story in Scenarios"]
  SG --> RH["Rehearse the shape in Rogue ops"]
  SG --> CV["Check the domain gap in Coverage"]
  RH --> GD["Guard the boundary in Guardrail lab"]
  RH --> BP["Compose controls in Blueprints"]
  CV --> DP["Plan high-stakes deploys carefully"]
  RD --> LV["Replay the trace where one exists"]""",
}

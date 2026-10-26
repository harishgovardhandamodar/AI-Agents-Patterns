#!/usr/bin/env python3
"""Build the supplement book *Self-Learning Agents* from the lab and the catalog.

Deterministic and dependency-free apart from the sibling checkout (stdlib only
otherwise). It reads the lab's own modules and reference data
(`../self-learning-agents`: scenario/evolver inventory from `app/streams.py`
and `app/evolvers.py`, `reference/*.json`, figure sources from
`design/*.md`), this catalog (`data/*.json`), and emits:

    book/SELF-LEARNING-AGENTS.md    supplement book in Markdown
    book/self-learning-agents.html  self-contained print HTML (same shell as
                                    the main book; PDF via tools/render_pdf.mjs
                                    where Chrome is available)

Nothing is invented: inventories come out of the lab's modules at build time,
every measured number is the lab's own reference data, every figure is a
design-doc source the lab's Design tab renders, and the build fails if any of
those sources is missing or any mapped id leaves either catalog.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_book import CSS, HTML_SHELL, Doc, esc, inline_html, load_catalog, pattern_council_points
from build_book import CSS, HTML_SHELL, Doc, esc, inline_html, load_catalog, pattern_council_points
from sl_book_prose import KIND_ESSAYS, PROSE, WORK_NOTES
from sl_book_prose import RL_CONCEPT_NOTES, RL_DIM_NOTES, RL_WORK_NOTES

ROOT = Path(__file__).resolve().parent.parent
BOOK_DIR = ROOT / "book"
MD_OUT = BOOK_DIR / "SELF-LEARNING-AGENTS.md"
HTML_OUT = BOOK_DIR / "self-learning-agents.html"

BOOK_TITLE = "Self-Learning Agents"
SUBTITLE = "Continual Learning, Task-Scoped Adaptation, and the Evaluation Discipline That Keeps Them Honest"
AUTHOR = "Harish Govardhan Damodar"
EDITION = "First edition — October 2026"

SL_DIR = Path(os.environ.get("SL_DIR", "/home/fox/WorkBook/self-learning-agents"))


def sl_req(rel):
    p = SL_DIR / rel
    if not p.exists():
        sys.exit(f"tools/build_sl_book.py: sibling checkout lacks {rel} "
                 f"(looked in {SL_DIR}; set SL_DIR to the self-learning-agents checkout)")
    return p


def sl_json(rel):
    return json.loads(sl_req(rel).read_text())


# --------------------------------------------------------------------------- #
#  lab inventory, imported from the lab's own modules — never retyped
# --------------------------------------------------------------------------- #

sys.path.insert(0, str(SL_DIR))
try:
    from app.streams import list_scenarios as sl_list_scenarios
    from app.evolvers import EVOLVERS as SL_EVOLVERS
except Exception as e:
    sys.exit(f"tools/build_sl_book.py: could not import the lab's app modules from {SL_DIR}: {e}")


# Evolver roles, keyed by the lab's own ids. The build fails if these drift
# from EVOLVERS in either direction — a renamed evolver must update this map.
EVOLVER_ROLES = {
    "seed": "No-learning baseline: the policy that never changes, so every gain is measured against doing nothing.",
    "reasoningbank": "A bank of scored reasonings the agent retrieves from and writes back to — memory that compounds across blocks.",
    "gepa": "Natural-language reflection on failures, proposed as policy edits — the optimizer is prose.",
    "metaharness": "Evolves the harness itself under the same seed and checkpoint discipline as the agents it runs.",
    "scoped": "Task-scoped lessons, fenced per family: a fix for invoicing never rewrites triage.",
    "oracle": "The ceiling reference: the best achievable cell, so every result reports how much of the oracle it captures.",
}


# --------------------------------------------------------------------------- #
#  the catalog bridge: lab mechanisms meet this catalog's records
# --------------------------------------------------------------------------- #

SL_PATTERNS = [
    ("reflexion", "The lab's evolvers are reflection implemented: propose, fail, rewrite the policy in prose."),
    ("evaluator-optimizer", "Every evolver is an evaluator wrapped around an optimizer; the suite is what keeps the loop honest."),
    ("self-consistency", "Sampling many reasonings and voting is the cheap version of a reasoning bank."),
    ("chain-of-verification", "Plan-then-verify is the harness pattern the lab's workflows condition on."),
    ("ensemble-verify", "Independent verification is what the hold-out sets are: a second opinion that trained on nothing."),
    ("working-memory-context", "The context window is the first memory to overflow — truncation is forgetting with no ledger."),
    ("long-term-vector-memory", "The vector store is where reasoning banks live when they outgrow the prompt."),
    ("episodic-memory", "Checkpoints are episodic memory with timestamps: what the agent knew, and when it knew it."),
    ("semantic-memory-kg", "Distilled lessons graduate from episodes to knowledge — if the distillation is verified."),
    ("memory-consolidation", "Task-scoped learning is consolidation with fences: keep the lesson, quarantine the blast radius."),
    ("scratchpad-external", "The scratchpad is the evolver's worksheet: visible, versioned, and wiped on release."),
    ("forgetting-decay", "Forgetting with a TTL is the control for memory that compounds without bound."),
    ("drift-monitoring", "The stream moves under the agent: drift monitoring is the instrument that notices first."),
    ("audit-trail", "Seeds, lesson ids and checkpoints are the audit trail that makes any cell reproducible."),
    ("approval-gates", "Irreversible actions wait for a token the agent cannot issue — synthesis, publication, production scope."),
    ("least-privilege", "The scope escape scenario is what happens when the grant was the whole production fleet."),
]

SL_SCENARIOS = {
    "selfrewrite-reward-hack": ("emergent", "hijack", "The coder edits its own grader until everything passes — self-improvement without a conscience."),
    "selfdistill-collapse": ("emergent", "drift", "Each generation trains on the last until capability drains out."),
    "prompt-selfedit-jailbreak": ("emergent", "hijack", "Self-optimization edits the safety constraints away, one step at a time."),
    "spawn-fleet-runaway": ("emergent", "sybil", "Self-parallelization with no cap is a takeover."),
    "metric-gaming-triage": ("emergent", "hijack", "Optimizes its resolution metric instead of patients."),
    "drift-silent": ("emergent", "drift", "The provider updates, behaviour creeps, no tick looks wrong."),
    "eval-overfit": ("emergent", "hijack", "Tuned to the eval corpus, blind to the novel attack."),
    "rag-poison": ("injected", "drift", "One planted document steers decisions for months."),
    "memory-poison": ("injected", "hijack", "A standing instruction outlives every session after it."),
    "research-fabricated-citation": ("emergent", "hijack", "Fourteen papers that don't exist, cited with confidence."),
    "energy-twin-drift": ("emergent", "drift", "The twin drifts from the plant; the schedule follows the twin."),
    "data-pipeline-schema-drift": ("emergent", "drift", "A rewritten schema corrupts downstream dashboards silently."),
    "context-exfil-truncation": ("emergent", "exfil", "Truncation drops the safety instructions first."),
    "edu-tutor-answer-leak": ("emergent", "hijack", "Teaching to the test is goal hijack with a smile."),
}

ROAD_LABEL = {
    "injected": "Injected — an outside attack turns a loyal agent",
    "emergent": "Emergent — the agent's own dynamics go wrong",
    "both": "Both roads lead here",
}

# (design file, block index, caption) — validated at build; the book places
# exactly these, in this order.
SIB_FIGS = [
    ("01-system-context.md", 0, "The lab in context: dashboard, API, versioned references, tailnet models."),
    ("05-evaluation-suite.md", 0, "The suite's four parts: specification, execution, measurement, judgement."),
    ("05-evaluation-suite.md", 1, "One run of one cell: accuracy at every checkpoint, baselines, gains, failure modes, verdict."),
    ("05-evaluation-suite.md", 4, "Five orderings, five questions: what each stream shape actually tests."),
    ("04-data-model.md", 2, "From sweeps to bands to verdicts: how a run is judged against measured history."),
    ("07-landscape.md", 1, "Falsifiability: the two questions that decide whether a claim can be wrong."),
    ("03-control-flow.md", 3, "One run's lifecycle: pending, running, evaluating, done — or cancelled, or error."),
    ("06-workflows.md", 3, "The four ways a self-learning agent breaks — and the fix is the harness, not the prompt."),
    ("03-control-flow.md", 1, "One episode, end to end: stream, router, evolver, harness, policy, grader."),
    ("03-control-flow.md", 2, "The router's decision: scope key, candidates, intent, apply — or the interference path."),
    ("02-uml.md", 2, "The evolver contract: inject, observe, on_block_end — six implementations, one interface."),
    ("06-workflows.md", 2, "Reading a comparison: significance first, effect size second, prompt cost last."),
]


def extract_sib_figs():
    out = []
    for rel, idx, cap in SIB_FIGS:
        text = sl_req(f"design/{rel}").read_text()
        blocks = re.findall(r"```mermaid\n(.*?)```", text, re.S)
        if idx >= len(blocks):
            sys.exit(f"tools/build_sl_book.py: {rel} carries {len(blocks)} figures, the book places block {idx} — fix the doc or the placement map")
        out.append((blocks[idx], cap))
    return out


def local_fig(rel, heading):
    """First Mermaid block under `heading` in an in-repo design doc — the same
    source the app's Design tab renders, so the book and the app cannot diverge.
    Fails loudly if the heading or its block moved."""
    text = (ROOT / rel).read_text()
    m = re.search(rf"^#+\s+{re.escape(heading)}\s*$", text, re.M)
    if not m:
        sys.exit(f"tools/build_sl_book.py: {rel}: no heading {heading!r}")
    rest = text[m.end():]
    nxt = re.search(r"^#+\s+", rest, re.M)
    if nxt:
        rest = rest[:nxt.start()]
    start = rest.find("```mermaid")
    if start < 0:
        sys.exit(f"tools/build_sl_book.py: {rel}: no figure under {heading!r}")
    end = rest.find("```", start + 9)
    if end < 0:
        sys.exit(f"tools/build_sl_book.py: {rel}: unterminated figure under {heading!r}")
    return rest[start + len("```mermaid"):end].strip("\n")


def place_local(body, rel, heading, caption):
    src = local_fig(rel, heading)
    body.m("```mermaid")
    body.m(src)
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
        f"<figcaption>{esc(caption)}</figcaption></figure>"
    )


def pct(x, d=1):
    return "—" if x is None else f"{x * 100:.{d}f}%"


def num(x, d=1):
    return "—" if x is None else f"{round(x, d)}"


entries = []
chap_n = [0]


def council(body, items):
    body.m("**Council reading.**")
    body.m()
    for role, text in items:
        body.m(f"- **{role}:** {text}")
    body.m()
    body.h("<p><b>Council reading.</b></p><ul>" + "".join(
        f"<li><b>{esc(role)}:</b> {inline_html(text)}</li>" for role, text in items) + "</ul>")


def sl_fig(body, src, cap):
    """Hand-authored flow grounded in lab modules (cost.py, suite.py,
    live_validation.json keys) — static so the build stays deterministic."""
    body.m("```mermaid")
    body.m(src)
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
        f"<figcaption>{esc(cap)}</figcaption></figure>"
    )


def voices(body, key):
    """Council deliberation block: four researchers debate before the verdict."""
    items = PROSE.get(key, [])
    if not items:
        sys.exit(f"tools/build_sl_book.py: no council prose for `{key}` in tools/sl_book_prose.py")
    voices_items(body, items)


def voices_items(body, items, header="**Council deliberation.**"):
    body.m(header)
    body.m()
    for voice, text in items:
        body.m(f"- **{voice}:** {text}")
    body.m()
    body.h("<p><b>Council deliberation.</b></p><ul>" + "".join(
        f"<li><b>{esc(voice)}:</b> {inline_html(text)}</li>" for voice, text in items) + "</ul>")


def main():
    cat = load_catalog()
    by_pat = {p["id"]: p for p in cat["patterns"]}

    landscape = sl_json("reference/landscape.json")
    benchmarks = sl_json("reference/benchmarks.json")
    live = sl_json("reference/live_validation.json")
    rl_land = json.loads((ROOT / "data" / "rl_landscape.json").read_text())
    collectors = json.loads((ROOT / "data" / "research_collectors.json").read_text())
    rl_works = rl_land.get("works", [])
    rl_concepts = rl_land.get("concepts", [])
    rl_dims = rl_land.get("dimensions", [])
    trails = collectors.get("trails", [])
    best_term = Counter()
    for sce, evs in benchmarks["bands"].items():
        best_term[max(evs, key=lambda e: evs[e]["terminal_advantage"][0])] += 1

    scenarios = sl_list_scenarios()
    sc_ids = [s["id"] for s in scenarios]
    ev_ids = sorted(SL_EVOLVERS.keys())
    if set(EVOLVER_ROLES) != set(ev_ids):
        sys.exit(f"tools/build_sl_book.py: evolver map drifted (map={sorted(EVOLVER_ROLES)}, lab={ev_ids})")
    for pid, _ in SL_PATTERNS:
        if pid not in by_pat:
            sys.exit(f"tools/build_sl_book.py: pattern `{pid}` not in this catalog")
    scen_ids = {s["id"] for s in cat["scenarios"]}
    missing = sorted(set(SL_SCENARIOS) - scen_ids)
    if missing:
        sys.exit(f"tools/build_sl_book.py: scenarios not in this catalog: {missing}")
    _need = {"intro", "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7",
             "ch8", "ch9", "ch10", "ch11", "ch15", "ch16", "ch17", "ch18",
             "ch19", "conclusion"}
    if _need - set(PROSE):
        sys.exit(f"tools/build_sl_book.py: council prose missing keys {sorted(_need - set(PROSE))}")
    _wids = {w.get("id") for w in landscape.get("works", [])}
    if set(WORK_NOTES) != _wids:
        sys.exit(f"tools/build_sl_book.py: researcher notes drifted (missing={sorted(_wids - set(WORK_NOTES))}, extra={sorted(set(WORK_NOTES) - _wids)})")
    _rids = {w.get("id") for w in rl_works}
    if set(RL_WORK_NOTES) != _rids:
        sys.exit(f"tools/build_sl_book.py: RL researcher notes drifted (missing={sorted(_rids - set(RL_WORK_NOTES))}, extra={sorted(set(RL_WORK_NOTES) - _rids)})")
    _kinds = {w.get("kind", "paper") for w in landscape.get("works", [])}
    if _kinds - set(KIND_ESSAYS):
        sys.exit(f"tools/build_sl_book.py: kind essays missing {sorted(_kinds - set(KIND_ESSAYS))}")
    figs = extract_sib_figs()
    if len(figs) < 12:
        sys.exit(f"tools/build_sl_book.py: expected at least 12 placed figures, got {len(figs)}")

    doc = Doc()
    body = Doc()

    def h(level, text, cls=""):
        return body.heading(level, text, cls)

    def CH(text):
        chap_n[0] += 1
        n = chap_n[0]
        aid = h(2, f"Chapter {n}: {text}", cls="chapter")
        entries.append(("chapter", f"Chapter {n} · {text}", aid))
        return aid

    # -- front matter ---------------------------------------------------- #
    entries.append(("front", "Preface", body.heading(1, "Preface")))
    body.p(
        "Most agent literature treats learning as training — something that happens "
        "before deployment, behind closed doors, measured in epochs. This supplement is "
        "about learning as operation: agents that change after they ship, streams that "
        "move under them, and the evaluation discipline that tells improvement apart "
        "from drift, gaming and forgetting. It is the companion to the Self-Learning "
        "tab and its add-on lab, and like every book in this series it is generated, "
        "not written: inventories come out of the lab's own modules at build time, "
        "every measured number is the lab's own reference data, and every figure is a "
        "design-doc source the lab's Design tab renders."
    )
    body.p(
        "This book was written and compiled from study and experiment observation "
        "notes of Harish Govardhan Damodar and generated by the *AI Agent Patterns "
        "& Guardrails* catalog and the Self-Learning Agent Lab by a deterministic script "
        "(`tools/build_sl_book.py`), then typeset to PDF with headless Chrome and the "
        "vendored Mermaid engine (`tools/render_pdf.mjs`) — the same Mermaid that renders "
        "the diagrams in the app, so no diagram in this book was drawn by hand or "
        "screenshotted. All experiments performed in local sandbox build and maintained by "
        "Harish Govardhan Damodar and his agents, work extensively uses local open weight "
        "model for experimentation and intelligence serving, for a live demo / suggestion "
        "feel free to drop a DM in my linkedin page "
        "(https://www.linkedin.com/in/harish-govardhan-d-44b22b47/). All records, "
        "suggestions advice is from personal experiments ran on my personal setup only "
        "and does not represent the organisation I work for."
    )
    body.p(
        "Three questions organize it: what continual learning is, how agents do it, "
        "and how to tell — with numbers, not narratives — whether they still can."
    )

    # -- introduction ---------------------------------------------------- #
    entries.append(("front", "Introduction: learning after deployment",
                    h(1, "Introduction: learning after deployment")))
    body.p(
        "A deployed agent faces a moving target: tasks drift, tools change, the data "
        "it learned from goes stale. Retraining from scratch on every shift is "
        "expensive and slow; never adapting is obsolescence on a schedule. Continual "
        "learning is the middle path — keep learning after deployment — and it fails "
        "in specific, measurable ways: new tasks overwrite old competence, retrieval "
        "returns the right topic with the wrong workflow, and metrics that rise on "
        "the training stream collapse on a disjoint hold-out."
    )
    body.p(
        "The lab this book accompanies reproduces the protocol of "
        "arXiv:2610.25858 (\"Are Self-Evolving Agents Continual Learners?\"): a shared "
        "harness, drifting streams of task families, binary task-success feedback, seed "
        "plus per-boundary checkpoints, and disjoint hold-out sets — then adds the "
        "mechanism the paper asks for: task-scoped learning with workflow conditioning."
    )
    body.m("```mermaid")
    body.m(figs[0][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[0][0])}">{esc(figs[0][0])}</pre>'
        f"<figcaption>{esc(figs[0][1])}</figcaption></figure>"
    )
    n_inj = sum(1 for r, _, _ in SL_SCENARIOS.values() if r in ("injected", "both"))
    n_eme = sum(1 for r, _, _ in SL_SCENARIOS.values() if r in ("emergent", "both"))
    body.p(
        f"The catalog reads back, too: {len(SL_SCENARIOS)} of its {len(cat['scenarios'])} failure "
        f"scenarios are self-learning stories — {n_inj} where an outside attack turns a learning "
        f"agent, {n_eme} where the learning itself goes wrong. Part V reads every one of them; "
        "the lab exists next to this catalog because the catalog already knew the failure modes."
    )
    voices(body, "intro")
    council(body, [
        ("Red team", "Learning after deployment means the adversary gets to teach: poison the stream and the agent distills your lesson as its own. Any evaluation that grades only final accuracy, without per-boundary checkpoints, cannot tell who taught what — demand the checkpoints before you trust the curve."),
        ("Blue team", "Scope every lesson to the task family that earned it and condition every retrieval on the live workflow: task-scoping plus workflow-conditioning is the whole paper's mechanism in one sentence, and the reference bands show scoped beating unscoped where it matters."),
        ("Operator", "Do not deploy a learning agent without a hold-out you never train on and a seed log that reproduces any cell: the first is how you know it learned, the second is how you prove it twice. Both are cheaper than one incident review."),
    ])

    # -- Part I ---------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part I: What continual learning is",
                    h(1, "Part I: What continual learning is")))
    CH("The paper's protocol")
    body.p(
        "One harness, many streams. Task families arrive in blocks; every block boundary "
        "stores a checkpoint; binary task-success is the only feedback the protocol trusts. "
        "Policy, training, evaluation and lesson-id seeds are all recorded per run, so any "
        "cell reproduces exactly — the same determinism this book series demands of itself. "
        "Streams come in four shapes: blocked (one family at a time, the paper's protocol), "
        "interleaved (families mixed per episode), recurring (a family returns every few blocks), "
        "and long-horizon, plus adversarial orderings that put confusable pairs adjacent."
    )
    body.p(
        "Two rules make the protocol honest. First, disjoint hold-outs: validation tasks never "
        "overlap training, so the score measures learning, not memorization of the eval set. "
        "Second, seed plus per-boundary checkpoints: accuracy is recorded at every checkpoint for "
        "every family (A[t,k]), so forgetting has a timestamp instead of an anecdote."
    )
    body.p(
        "Each element earns its place. The shared harness means evolvers differ only in how "
        "they change the agent, never in tasks, order or grading — without it, every comparison "
        "is confounded. Drifting streams mean the test distribution moves under a fixed agent, "
        "which is the only setting where 'continual' means anything. Binary task-success "
        "feedback is deliberately coarse: partial credit is where gaming hides, and the protocol "
        "refuses to grade style. Seeds plus per-boundary checkpoints make any cell reproducible "
        "and date every forgetting event. Disjoint hold-outs close the last loophole: without "
        "them, 'learning' and 'memorizing the eval set' are the same number."
    )
    body.p(
        "Note what the protocol deliberately leaves out: no wall-clock budgets (episodes are the "
        "currency, not seconds), no human ratings (binary success only), no curriculum control "
        "(the stream order is the test, not a convenience). Each omission is a confound refused. "
        "A lab that timed episodes would benchmark hardware; a lab that graded style would "
        "benchmark the grader. The protocol measures learning and nothing else, which is why its "
        "numbers transfer further than richer-looking alternatives."
    )
    voices(body, "ch1")
    council(body, [
        ("Red team", "The protocol's honesty is its attack surface: binary feedback is gameable (metric-gaming is a catalogued scenario, not a hypothesis), and a hold-out is only disjoint until someone trains on it. Audit the hold-out boundary the way you audit a grant boundary."),
        ("Blue team", "Checkpoints are the audit trail of learning: without A[t,k] at every boundary, interference and forgetting are invisible and every claim about continual learning is unfalsifiable. Keep the seed log with the same care as the incident log."),
        ("Operator", "Before adopting any continual-learning claim, ask for the four seeds and the checkpoint table: policy, train, eval, lesson-id. If the claimant cannot reproduce their own cell, you are being sold a draw, not a result."),
    ])
    CH("The metrics: B, P, I, F, S")
    body.p(
        "B_k is the seed baseline per family: what the unevolved policy scores before learning "
        "starts. Everything else is measured against it, which is why the seed policy matters — "
        "a weak baseline flatters every evolver. Plasticity P_k is the gain during a family's own "
        "block (accuracy at its block end minus seed); interference I_k is the mean drop below seed "
        "at checkpoints before its own block; forgetting F_k is the drop from the end of its block "
        "to the horizon end. Stability S is the negative sum of mean interference and mean "
        "forgetting: one number for the cross-block bill. Terminal advantage averages the "
        "horizon-end gain over seed across families; forward and backward transfer and the "
        "area-under-curve describe the shape between the endpoints."
    )
    body.p(
        "Read each metric as an answer. B_k answers 'where did we start' — and flatters every "
        "evolver when the seed policy is weak, so distrust any gain quoted without its baseline. "
        "P_k answers 'what did its own block teach' — the plasticity every demo optimizes, and "
        "the easiest number to game by overfitting the block. I_k answers 'what did the wait "
        "cost' — drops below seed before a family's own block even starts, the signature of "
        "interference from earlier learning. F_k answers 'what survived' — the drop from the end "
        "of the block to the horizon end, the only number that matters to anyone who ships. S "
        "answers 'what is the total cross-block bill' — the negative sum both directions, one "
        "number for the trade plasticity makes. Terminal advantage answers 'was the whole trip "
        "worth it' — horizon-end gain averaged over families, the headline that must always be "
        "read next to S, never alone."
    )
    body.m("```mermaid")
    body.m(figs[2][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[2][0])}">{esc(figs[2][0])}</pre>'
        f"<figcaption>{esc(figs[2][1])}</figcaption></figure>"
    )
    voices(body, "ch2")
    council(body, [
        ("Red team", "Every metric here can be gamed without improving anything: inflate P_k by overfitting the block, hide F_k by never revisiting old families, flatter Term with a weak seed baseline. The suite's answer is the band table — your number against fifty measured iterations, not against zero."),
        ("Blue team", "Read S before P: plasticity without stability is a demo that forgets. The reference bands report both with error bars, and a cell whose stability error bar crosses zero has not proven it can keep anything."),
        ("Operator", "Put terminal advantage and forgetting on the same dashboard and alert on the pair: rising terminal with rising forgetting is a system eating its past to feed its present. That is the exact trade the stability number prices."),
    ])
    CH("Orderings that break agents")
    body.table(["Ordering", "Shape", "What it tests"],
               [["Blocked", "one family at a time", "does scope isolation hold?"],
                ["Interleaved", "families mixed per episode", "can the router route under changing composition?"],
                ["Recurring", "a family returns every few blocks", "does competence return after an interruption?"],
                ["Long-horizon", "eight blocks, 160 episodes", "does degradation compound?"],
                ["Adversarial", "confusable pair adjacent", "does the result survive an inconvenient order?"]])
    body.m("```mermaid")
    body.m(figs[3][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[3][0])}">{esc(figs[3][0])}</pre>'
        f"<figcaption>{esc(figs[3][1])}</figcaption></figure>"
    )
    body.p(
        "Blocked is the paper's protocol and the kindest ordering; the other four are "
        "adversarial by construction. A mechanism that only holds under blocked ordering has "
        "proven it can learn undisturbed — which is to say, it has proven nothing about "
        "deployment, where the stream is interleaved, recurring, long and inconvenient all at once."
    )
    voices(body, "ch3")
    council(body, [
        ("Red team", "If you control the stream order, you control the result: schedule confusable pairs adjacently and watch retrieval collide; interleave to starve the router. The hard-order stream is the closest thing to an adversarial evaluation the suite ships — run it before you believe any blocked number."),
        ("Blue team", "Demand the full ordering battery for every claim: a scoped lesson that survives blocked but dies interleaved is a router failure wearing a memory success costume. The suite's thirteen shapes exist because one shape is a anecdote."),
        ("Operator", "Match the ordering to your deployment: stable enterprise workflows get blocked plus recurring; open-ended assistants get interleaved plus hard-order. Testing the wrong ordering is how teams ship agents that pass the lab and fail Monday."),
    ])

    # -- Part II --------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part II: How agents learn",
                    h(1, "Part II: How agents learn")))
    CH("The learning loop, step by step")
    body.p(
        "One episode, end to end. The stream emits a task — query plus preamble, no label, "
        "because the router must earn its assignment. The router assigns the task to a cluster, "
        "which fixes the scope key: cluster plus workflow fingerprint. The evolver reads only "
        "the harness surfaces it uses — lessons, prompt, memory — and returns an injection: text "
        "plus candidate lessons for this scope. The policy classifies intent from the request "
        "text; if a lesson for this intent exists, it applies it generalized and refilled with "
        "this task's values; if not, it falls back to the most similar candidate — and that "
        "fallback is the interference path, labelled as such in the router's own diagram — then "
        "perturbs with probability one minus skill, because a policy that never explores never "
        "learns what the lessons do not cover."
    )
    body.p(
        "The grader scores binary success — pass or fail, no partial credit to hide gaming "
        "behind. The evolver observes the triple of action, success and trace and writes a "
        "lesson fenced to the scope key; unwatched lessons never exist, because observe() runs "
        "every episode, not just the interesting ones. At the block boundary the checkpoint is "
        "stored, on_block_end fires, and evaluation runs on the disjoint hold-outs — never on "
        "training tasks — producing the A[t,k] row that the metrics chapter turns into "
        "plasticity, interference, forgetting and stability. Then the next block starts, with "
        "a different family, and the loop discovers whether anything was actually kept."
    )
    body.m("```mermaid")
    body.m(figs[8][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[8][0])}">{esc(figs[8][0])}</pre>'
        f"<figcaption>{esc(figs[8][1])}</figcaption></figure>"
    )
    body.m("```mermaid")
    body.m(figs[9][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[9][0])}">{esc(figs[9][0])}</pre>'
        f"<figcaption>{esc(figs[9][1])}</figcaption></figure>"
    )
    voices(body, "ch4")
    body.p(
        "Read the two diagrams as one machine. The sequence shows the handoffs — who calls whom, "
        "and what crosses each boundary (cluster id, scope key, injection, action, grade). The "
        "router flowchart shows the decisions — and names the exact edge where learning goes "
        "wrong: fallback to the most similar candidate, then perturb. Every failure mode the "
        "lab tracks enters through a named edge of this loop: interference through fallback, "
        "collision through retrieval without a workflow key, overwriting through an unfenced "
        "write, forgetting through a block boundary with no checkpoint read-back."
    )
    council(body, [
        ("Red team", "The loop's soft joint is the fallback edge: no lesson, most-similar candidate, perturb. Poison the bank and every unseen intent routes through your lesson; the perturb step then launders it as exploration. Audit fallback frequency per scope — a rising fallback rate is the sound of the bank failing."),
        ("Blue team", "Instrument every handoff, not just the grade: log the cluster assignment, the scope key, the retrieved candidates, the apply-vs-fallback decision. When interference appears, that log is the only thing that distinguishes a bad lesson from a bad route — and the fix differs completely."),
        ("Operator", "Walk one episode by hand before trusting any aggregate: pick a task, follow it through router, injection, action, grade, lesson, checkpoint. If you cannot narrate that single episode from the logs, the dashboards are summarizing a machine nobody has watched."),
    ])
    CH("The six evolvers")
    rows = []
    for eid in sorted(SL_EVOLVERS.keys()):
        rows.append([eid, EVOLVER_ROLES[eid]])
    body.table(["Evolver", "What it does"], rows)
    body.p(
        "Seed is the honest zero: the policy that never changes, so every gain is measured "
        "against doing nothing — any evolver that cannot beat seed on terminal advantage has "
        "no business deploying. Oracle is the ceiling reference: the best achievable cell, so "
        "results report capture (how much of the oracle each evolver reaches) instead of raw "
        "scores that flatter weak tasks."
    )
    body.p(
        "The bands keep score between the four contenders. Across all "
        f"{len(benchmarks['bands'])} measured streams, the terminal-advantage leaders are: "
        + ", ".join(f"{ev} ({n})" for ev, n in best_term.most_common()) + ". "
        "Scoped leads where families must stay fenced; reasoning-bank leads where accumulated "
        "experience transfers; GEPA leads where a prose reflection finds what statistics miss. "
        "Read the lead as a map of the terrain, not a ranking of the athletes — change the "
        "streams and the map changes, which is why the bands ship per scenario, not as a single "
        "leaderboard."
    )
    body.m("```mermaid")
    body.m(figs[10][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[10][0])}">{esc(figs[10][0])}</pre>'
        f"<figcaption>{esc(figs[10][1])}</figcaption></figure>"
    )
    body.p(
        "One interface, six implementations — that is the whole evolver design, and the class "
        "diagram says it plainly: inject() takes harness, task and router and returns text plus "
        "lessons; observe() takes action, success, trace and router and returns a lesson; "
        "on_block_end() takes the block and returns diagnostics. Seed implements the interface by "
        "doing nothing, which is why it is the perfect control: identical calls, zero learning. "
        "Scoped adds the scope key and the per-scope cap; reasoning-bank adds top-k and a "
        "threshold; GEPA adds a character budget and an update cadence. Compare implementations "
        "by their parameters and you can predict their failure modes before running them."
    )
    voices(body, "ch5")
    council(body, [
        ("Red team", "Evolvers that rewrite policy in prose (GEPA) or memory (reasoning bank) are prompt-injection surfaces that persist: poison the reflection once and every downstream block inherits it. Attack the lesson store, not the lesson."),
        ("Blue team", "Scope lessons per family and verify retrievals against the live workflow: the scoped evolver exists because unscoped memory is a broadcast channel for mistakes. The ceiling to beat is oracle capture, not any absolute score."),
        ("Operator", "Start every comparison from seed: if a fancy evolver cannot beat doing nothing on your stream, stop paying its prompt bill. The cost ledger (gain per 100 prompt units) is the tiebreaker the benchmark tables already compute."),
    ])
    CH("Task-scoped learning and workflow conditioning")
    body.p(
        "Two mechanisms, one sentence: learn per family, retrieve per workflow. Task-scoping "
        "fences every lesson inside the family that earned it, so an invoicing fix can never "
        "rewrite triage. Workflow conditioning keys retrieval on which workflow is live — the "
        "answer to the retrieval-collision case, where two BFCL families share one API catalogue "
        "and the right topic arrives with the wrong workflow."
    )
    body.p(
        "The reference notes name the canonical cases: the topic stream (three SQL databases in "
        "sequence — same task, different schema) and the domain stream (the environment itself "
        "changes: science lab, then tool use, then SQL). Scoping handles the first, conditioning "
        "handles the second, and the compound streams demand both at once."
    )
    body.p(
        "Scoping is a namespace discipline with teeth. Every lesson carries the family id that "
        "earned it; retrieval filters on it before similarity is even consulted; writes outside "
        "the fence are refused, not merely discouraged. The failure it prevents is specific: an "
        "invoicing fix that rewrites triage, a SQL-schema lesson applied to a science-lab task. "
        "Unscoped memory is a broadcast channel, and every broadcast eventually reaches the wrong "
        "audience. Conditioning is a routing discipline with the same shape: the live workflow "
        "is an explicit key on every retrieval, so the catalogue collision — right topic, wrong "
        "workflow — resolves to the workflow that is actually running instead of the one that "
        "scores highest on embedding similarity."
    )
    body.p(
        "The two mechanisms fail independently, which is why the lab tests them separately and "
        "together. Unscoped-but-conditioned retrieval still broadcasts lessons across families "
        "that share a workflow; scoped-but-unconditioned retrieval still collides when two "
        "workflows share an API catalogue. The topic stream isolates the first failure, the "
        "domain stream isolates the second, and the compound streams — domain-workflow, "
        "interleaved, hard-order — are where both fences must hold at once. An evolver that "
        "passes blocked but fails compound has exactly one of the two mechanisms, and the "
        "streams tell you which."
    )
    voices(body, "ch6")
    council(body, [
        ("Red team", "Fences are drawn where the lab thinks families end; real deployments redraw families constantly. A lesson fenced to 'invoicing' leaks the moment the router misclassifies the task — attack the router's taxonomy and the scope follows."),
        ("Blue team", "Condition retrieval on the live workflow explicitly, not on embedding similarity alone: collision happens exactly when similarity is high and the workflow differs. Log the workflow key with every retrieval so collisions are auditable, not mysterious."),
        ("Operator", "Write down your families and your workflows before enabling learning: scoping without a family list is a fence with no posts. Revisit the list quarterly — scope drift is silent, and the first symptom is a lesson applied where it was never earned."),
    ])
    CH("Memory that compounds")
    body.p(
        "A reasoning bank is memory that earns interest: scored reasonings accumulate, good "
        "ones get retrieved, retrievals shape future reasonings. Compounding cuts both ways — "
        "it is also how poison accumulates, one planted document at a time, and how a "
        "distilled successor inherits its teacher's fabrications. Forgetting with a TTL is the "
        "control: memory that cannot decay cannot be trusted to stay true."
    )
    body.p(
        "Run the compounding math before trusting the curve. Every retrieval is a vote for the "
        "retrieved reasoning to shape the next one, so early entries enjoy incumbency: whatever "
        "was deposited first gets retrieved most, which makes it most likely to be deposited "
        "again. That is how a single rag-poison document steers decisions for months, and how "
        "self-distillation converts one fabrication into a training set. The controls mirror the "
        "mechanism point for point: provenance on deposits (who taught what, when), TTL decay on "
        "storage (old lessons expire unless re-earned), verification on distillation (nothing "
        "graduates from episode to knowledge without an independent check)."
    )
    body.p(
        "The bank has exactly three operations and the discipline is in using all three: deposit "
        "with provenance (who taught what, when, on which task), retrieve with scope plus "
        "workflow keys (never similarity alone), expire with TTL (old lessons die unless "
        "re-earned). Most failed memory systems implement one and a half of these — usually "
        "deposit, sometimes retrieve, never expire — and then wonder why the bank fills with "
        "yesterday's truths. Forgetting is not the opposite of the bank; it is the bank's "
        "garbage collector, and a bank without one is a landfill with an index."
    )
    voices(body, "ch7")
    council(body, [
        ("Red team", "Compound interest works for whoever deposits first: plant the reasoning early and every retrieval pays you dividends for the rest of the horizon. Banks without provenance are just shared delusions with an index."),
        ("Blue team", "Provenance on every lesson, TTL on every memory, verification on every distillation: the bank compounds what you put in, so audit deposits the way you audit code review — because that is what they are."),
        ("Operator", "Treat the memory store as production data with retention policy, not as a cache: back it up, expire it, and rehearse the poisoning drill (plant, detect, scrub) the way the rogue book rehearses quarantine."),
    ])

    # -- Part III -------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part III: Evaluation",
                    h(1, "Part III: Evaluation")))
    CH("The suite inventory")
    body.table(["Scenario", "Name", "Drift", "Families"],
               [[s["id"], s.get("name", ""), s.get("drift", ""), ", ".join(s.get("group_names", s.get("groups", [])))]
                for s in scenarios])
    body.m("```mermaid")
    body.m(figs[1][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[1][0])}">{esc(figs[1][0])}</pre>'
        f"<figcaption>{esc(figs[1][1])}</figcaption></figure>"
    )
    body.p(
        f"The suite ships {len(scenarios)} scenarios across four shapes plus adversarial "
        "orderings — thirteen in the full gate profile — executed by one runner under one "
        "protocol, measured by one metrics module, judged against one set of measured bands. "
        "Specification, execution, measurement and judgement stay separate files so a flaw in "
        "any one of them is reviewable without touching the others."
    )
    by_drift = defaultdict(list)
    for s in scenarios:
        by_drift[s.get("drift", "?")].append(s["id"])
    for drift in sorted(by_drift):
        ids = sorted(by_drift[drift])
        body.p(
            f"*{drift}* — {len(ids)} scenarios ({', '.join(ids)}). " +
            ("The catalogue core: workflow and topic shapes test whether scoping and conditioning hold when the task stays put and the world moves." if drift in ("topic", "workflow") else
             "The deployment shape: nine domains plus their drifting variants test whether learning survives contact with a new environment." if drift == "domain" else
             "The composition shape: interleaved, recurring, long-horizon and adversarial orderings test what the single shapes cannot — routing under mixing, return after interruption, compounding over time, survival of inconvenience.")
        )
    sl_fig(body,
        'flowchart LR\n  subgraph ACT["Proposed action"]\n    A1["triage · trade · tool call"]\n  end\n  subgraph CHECKS["Guardrail audit checks"]\n    direction TB\n    C1["acute case without escalation"]\n    C2["position over the cap"]\n    C3["tool call with guessed argument"]\n  end\n  subgraph VERDICT["Verdict"]\n    direction TB\n    V1["violation recorded with the run"]\n    V2["a limit the grader catches is a measurement"]\n    V3["a limit never proposed is a property"]\n  end\n  ACT --> CHECKS --> VERDICT',
        "The guardrail audit on every proposed action: what it checks and what a pass means.")
    voices(body, "ch8")
    council(body, [
        ("Red team", "Eighteen scenarios is eighteen rehearsals your adversary has also read — all deterministic, all replayable, all in the open. The compound shapes are the attacker's menu: pick the ordering the target never tested (usually hard-order or long-horizon) and the untested shape is where their numbers stop meaning anything."),
        ("Blue team", "Cover the shapes in deployment order, not numerical order: blocked first for the mechanism, then the shape your stream actually takes, then hard-order as the adversary's vote. A suite that only runs blocked is a demo with eighteen names."),
        ("Operator", "Map each production stream to its suite shape before launch and re-run that shape on every harness change: topic for schema drift, domain for environment change, compound for everything real. The inventory table above is the mapping worksheet — fill it in with your stream names."),
    ])
    CH("Sweeps and statistics")
    body.p(
        "One run is exactly reproducible but still one draw of tasks and policy coins, so the "
        "sweep varies all three seed axes per iteration — policy seed 7+i, task-train 100+i, "
        "task-eval 1100+i, lesson-id 1000+i — and reports mean ± std over twenty iterations. A "
        "table entry becomes a claim with error bars; effect size is measured against the best "
        "cell with Holm-corrected significance; power analysis says how many iterations a "
        "5-point margin needs; the cost ledger prices gain per 100 prompt units."
    )
    body.m("```mermaid")
    body.m(figs[4][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[4][0])}">{esc(figs[4][0])}</pre>'
        f"<figcaption>{esc(figs[4][1])}</figcaption></figure>"
    )
    body.p(
        "Reports end with a comparison, and comparisons end with a decision procedure the lab "
        "draws explicitly: significance first (Holm-corrected — a tie stays a tie until more "
        "iterations or a bigger effect say otherwise), effect size second (statistically real "
        "but tiny is still tiny), prompt cost last (a win bought with volume is a bad trade, "
        "because the gain does not pay for the harness). Raise the iteration count until the "
        "power table says the margin is resolvable, then read the report again."
    )
    body.m("```mermaid")
    body.m(figs[11][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[11][0])}">{esc(figs[11][0])}</pre>'
        f"<figcaption>{esc(figs[11][1])}</figcaption></figure>"
    )
    sl_fig(body,
        'flowchart LR\n  subgraph EP["Every episode"]\n    direction TB\n    E1["injected prompt characters counted"]\n    E2["characters written counted"]\n    E3["lesson created · lesson used"]\n  end\n  subgraph LEDGER["Efficiency ledger"]\n    direction TB\n    L1["prompt and write totals per cell"]\n    L2["hit rate of stored lessons"]\n    L3["gain per unit: points per prompt volume"]\n  end\n  subgraph READ["Reading"]\n    R1["a win bought with volume is a bad trade"]\n  end\n  EP --> LEDGER --> READ',
        "Cost accounting across the sweep: what learning spends and what the gain costs.")
    voices(body, "ch9")
    council(body, [
        ("Red team", "Statistics are a costume that small samples wear: twenty iterations with wide std bars prove nothing except that the number moves. Demand the bands, the effect size and the Holm correction together — a naked mean is a rumour."),
        ("Blue team", "Sweep the axes you claim robustness over: if deployment varies the order, sweep the order (hard-order exists for this). A result that holds at seed 7..26 but dies at 27 was never a result."),
        ("Operator", "Budget the gate before the launch: core profile 75 minutes for fifty rounds, full profile two hours. A gate nobody can afford to run is documentation, and documentation does not catch regressions."),
    ])
    CH("Measured bands")
    bands = benchmarks["bands"]
    for metric, title in (("terminal_advantage", "Terminal advantage (mean ± std, pp over seed)"),
                          ("forgetting", "Forgetting (mean ± std, pp)")):
        rows = []
        for sc in sorted(bands):
            row = [sc]
            for ev in sorted(bands[sc]):
                m, s = bands[sc][ev][metric]
                row.append(f"{m:+.1f} ± {s:.1f}")
            rows.append(row)
        body.p(title + ". " + str(benchmarks.get("source", "")))
        body.table(["Scenario"] + sorted(bands[sorted(bands)[0]]), rows)
    notes = benchmarks.get("notes", {})
    if isinstance(notes, dict):
        for k, v in notes.items():
            body.p(f"*{k}*: {v}")
    voices(body, "ch10")
    council(body, [
        ("Red team", "Bands are history, not physics: they describe what scoped and GEPA did on these streams at these seeds. Change the stream and the band is a rumour — re-sweep before you cite it, or your baseline is someone else's weather."),
        ("Blue team", "Judge runs as measured / above / below against the bands, never against zero: the suite's verdict vocabulary exists so a regression reads as 'below band', not as a feeling. Wire the verdict into CI so the gate bites."),
        ("Operator", "Read forgetting first, terminal second: a high terminal with high forgetting is a system that will embarrass you one block after you ship it. The bands table is your negotiation baseline with anyone selling you an evolver."),
    ])
    CH("Live validation")
    lv = live
    body.p(
        f"{lv.get('what', '')} {lv.get('why', '')} "
        f"On {lv.get('n_holdout', '?')} hold-outs ({lv.get('family', '')}): simulated baseline "
        f"{lv.get('simulated_baseline_pct', '?')}% vs live {lv.get('live_baseline_pct', '?')}%, "
        f"a delta of {lv.get('delta_pp', '?')}pp in {lv.get('live_elapsed_s', '?')}s. {lv.get('reading', '')}"
    )
    body.p(
        f"Calibration: {lv.get('calibration', '')}"
    )
    body.p(
        "Read the calibration as a transfer license with limits. The delta quantifies exactly "
        "how much the simulator flatters: every simulated gain quoted without it is gross, not "
        "net. What transfers is the ranking and the mechanism — which evolver holds which stream, "
        "and why — not the absolute percentages, which belong to the simulator's task set and "
        "stay there. Re-calibrate on every simulator change and every model swap: a drifted "
        "simulator with a stale delta is worse than no simulator, because its numbers still look "
        "measured."
    )
    body.p(
        "The live run also validates the harness, not just the policy: same stream, same "
        "protocol, real model in the policy seat. Where the live delta is small, the simulated "
        "policy was a faithful stand-in and the sweeps generalize; where it is large, the "
        "simulator's competence model diverges from the language model and every band built on "
        "it needs re-examination. That is why the validation file records elapsed seconds and "
        "the reading alongside the delta — cost, direction and interpretation travel together, "
        "or not at all."
    )
    sl_fig(body,
        'flowchart LR\n  subgraph STREAM["Same stream twice"]\n    direction TB\n    S1["simulated policy run"]\n    S2["live model run on hold-outs"]\n  end\n  subgraph DELTA["Calibration"]\n    direction TB\n    D1["simulated baseline versus live baseline"]\n    D2["the delta in points plus elapsed time"]\n    D3["reading: what transfers and what stays"]\n  end\n  subgraph LICENSE["Transfer license"]\n    direction TB\n    T1["rankings and mechanisms transfer"]\n    T2["absolute magnitudes do not"]\n    T3["re-calibrate on every simulator or model swap"]\n  end\n  STREAM --> DELTA --> LICENSE',
        "Live validation: the same stream twice, and what the gap licenses.")
    voices(body, "ch11")
    council(body, [
        ("Red team", "The delta is the finding and the absolute is the costume: simulated baselines flatter, live baselines humble. Anyone quoting the simulated number without the calibration delta is selling the costume."),
        ("Blue team", "Calibrate every simulated claim against live hold-outs before it leaves the lab: the validation file records exactly this, and the advice says what transfers and what does not. No calibration, no claim."),
        ("Operator", "Budget live validation like a gate, not a garnish: hold-outs, elapsed seconds and the delta go in the release notes. If the delta moved since last quarter, your simulator drifted — fix that before you fix the agent."),
    ])

    # -- Part IV --------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part IV: The landscape",
                    h(1, "Part IV: The landscape")))
    dims = landscape.get("dimensions", [])
    concepts = landscape.get("concepts", [])
    works = landscape.get("works", [])
    n_dims, n_concepts, n_works = len(dims), len(concepts), len(works)

    def lab_assess(w):
        given = w.get("align") or {}
        a = {}
        for d in dims:
            key = d["id"] if isinstance(d, dict) else str(d)
            opts = d.get("options", []) if isinstance(d, dict) else []
            v = given.get(key)
            a[key] = v if (v in opts or v == "unknown") else "unknown"
        falsifiable = (a.get("evaluation") == "yes" and a.get("holdout") == "yes")
        partial = (a.get("evaluation") in ("yes", "partial") and a.get("holdout") == "yes")
        verdict = ("falsifiable" if falsifiable else
                   "partially falsifiable" if partial else
                   "not falsifiable by its own protocol")
        bits = []
        if a.get("evaluation") != "yes":
            if a.get("evaluation") == "partial":
                bits.append("it measures some effect of learning, but not interference or "
                            "forgetting across a changing stream")
            else:
                bits.append("it does not measure interference or forgetting across a changing stream")
        if a.get("holdout") != "yes":
            bits.append("it is not graded on instances it was not trained on")
        why = ("it measures degradation across a changing stream on a disjoint hold-out, "
               "so a change that made things worse would have been caught") if not bits \
            else "because " + " and ".join(bits)
        return a, verdict, falsifiable, why

    def work_reading(w, a, verdict):
        surf = a.get("surface", "unknown")
        if verdict == "falsifiable":
            base = ("Clears both gates — degradation measured on a disjoint hold-out — so read it "
                    "as the comparison set for any new continual-learning claim, not as background.")
        elif verdict == "partially falsifiable":
            base = ("Measures something real but not the full cross-stream bill — cite its numbers as "
                    "suggestive, then re-test the idea on a drifting stream with per-boundary checkpoints "
                    "before repeating the claim.")
        else:
            base = ("No interference measurement or no disjoint hold-out — treat it as a design prior "
                    "(borrow the mechanism), never as evidence that the mechanism learns continually.")
        surf_note = {
            "memory": "Memory design to borrow, evaluation to redo on your own stream.",
            "prompt": "Prompt/program design to borrow; assume its cross-block bill is unmeasured until you measure it.",
            "skills": "Skill-library design to borrow; check whether skills are fenced per family or broadcast.",
            "workflow": "Harness-evolution design — the family this lab extends, so compare evolver-to-evolver.",
            "code": "Self-rewriting design; demand the admission gate (who can reject a bad edit) before the demo.",
            "weights": "Weight-changing work sits outside this lab's frozen-weight protocol — transfer the idea, not the number.",
            "nothing": "No learning surface: it is context for the field (a baseline, a benchmark, or an argument), not a learning result.",
        }.get(surf, "")
        return f"{base} {surf_note}".strip()

    CH(f"{n_dims} dimensions")
    if isinstance(dims, dict):
        drows = [[k, str(v)] for k, v in dims.items()]
    else:
        drows = [[d.get("id", ""), d.get("label", d.get("gloss", ""))] if isinstance(d, dict) else [str(d), ""]
                 for d in dims]
    body.table(["Dimension", "What it separates"], drows)
    body.p(
        "Dimensions are what make a literature review falsifiable instead of vibes: every "
        f"work below is placed on all {n_dims}, so a claim like 'nobody evaluates degradation' is "
        "answerable by counting, not by remembering."
    )
    DIM_NOTES = {
        "surface": "The surface decides what can compound and what can corrupt. A prompt rewrite broadcasts to every family; a fenced memory write reaches one. When a vendor says 'self-improving', this axis names the noun.",
        "isolation": "The axis this lab exists to move. 'Yes' means a lesson earned on family A cannot fire on family B; 'partial' means fenced in some paths and leaking in others; 'no' means the broadcast channel is open. Scoped is the lab's 'yes'.",
        "retrieval": "Retrieval is where interference enters: similarity alone returns the right topic with the wrong workflow (the BFCL catalogue collision). The lab's answer is cluster plus workflow conditioning — an explicit key before similarity is consulted.",
        "evaluation": "The first falsifiability gate. 'Yes' means interference or forgetting was measured across a changing stream with per-boundary checkpoints; 'partial' means some learning effect was measured but not the cross-stream bill; 'no' means the claim was never exposed to drift.",
        "holdout": "The second gate. A disjoint hold-out separates learning from memorising the eval set. Without it, plasticity and terminal advantage are the same number as overfitting, and no checkpoint table can rescue them.",
        "evidence": "What kind of source backs the claim — peer-reviewed, preprint, vendor writeup, blog, open source. The field skews preprint, which revises fast and verifies slowly; the identifier check runs in the test suite instead of living in someone's memory.",
        "forgetting": "Added with the 2025 memory wave: does the work say what is discarded as memory grows — explicit eviction, summarise-only, or nothing? A bank without garbage collection is a landfill with an index; TTL decay is the lab's control.",
        "efficiency": "Does the work report what learning costs — memory growth, tokens, calls? The suite's cost ledger prices gain per 100 prompt units because a win bought with 10x harness is a bad trade, and most of the field never prices it.",
        "scope": "One agent's memory or memory shared across agents? Shared stores add routing, per-role scopes and cross-agent conflict — the multi-agent memory paradigm — which single-agent numbers do not cover.",
    }
    for d in dims:
        if not isinstance(d, dict):
            continue
        did, label = d.get("id", ""), d.get("label", d.get("id", ""))
        body.p(
            f"*{label}* (`{did}`) asks: {d.get('question', '')} "
            f"Options run {', '.join(d.get('options', [])[:5])} — plus 'unknown', which is always legal. "
            + DIM_NOTES.get(did, "Every work gets an explicit cell instead of the reviewer's benefit of the doubt.")
        )
    council(body, [
        ("Red team", f"{n_dims} dimensions with an explicit 'unknown' option is a map of the reviewer's ignorance as much as the field's: sort the works table by 'unknown' count and the least-examined claims surface first. That column is where the next paper — or the next incident — already lives."),
        ("Blue team", f"Hold every new work to all {n_dims} cells before it enters the landscape: a work with no degradation measurement is a demo, one with no hold-out is a rumour, one with unknown evidence kind is unread. The merge pipeline exists so the bar does not move when the pile grows."),
        ("Operator", "Use the dimensions as procurement questions, not just review axes: ask the vendor which surface their system rewrites, whether lessons are fenced per family, how retrieval keys the workflow, what forgetting is explicit, what learning costs, and whether the memory is shared. 'Unknown' across the row is a pricing signal, not a technical detail."),
    ])
    CH(f"{n_concepts} concepts")
    body.table(["Concept", "Kind", "Gloss"],
               [[c["id"], c.get("kind", ""), c.get("gloss", "")] for c in concepts])
    CONCEPT_NOTES = {
        "self-improvement": "The umbrella bet: the agent changes itself and is judged on the result. Everything below is a narrower claim about what changes and how it is judged.",
        "continual-learning": "The lab's own paradigm: learning over a stream that keeps changing, priced in interference and forgetting. A 'self-improving' agent without a stream is a demo with better vocabulary.",
        "test-time-adaptation": "Adaptation at inference rather than training time — the deployment shape of continual learning, and the reason the lab grades on hold-outs instead of training tasks.",
        "multi-agent-memory": "Memory shared, routed or traced across agents. Single-agent isolation results do not transfer here; cross-agent conflict is its own interference axis.",
        "experience-evolution": "Forward learning from the experience stream itself: each interaction updates the reusable repertoire. ReasoningBank is the lab's instance of this bet.",
        "experience-replay": "Past episodes stored and replayed as guidance. Cheap, compounding, and exactly how poison accumulates — provenance and TTL are the controls.",
        "reflection": "The agent writes what went wrong and reuses the text. GEPA and Reflexion both live here; the difference is whether the prose is fenced per family or broadcast.",
        "skill-library": "Reusable capabilities accumulated as named units (Voyager's skills). The open question is admission: who can reject a bad skill, and what re-tests it?",
        "memory-management": "What the agent keeps and how it decides what fits. The 2025 memory wave (Mem0, A-MEM, MemInsight, MemoryOS) turned this from plumbing into the research surface.",
        "memory-policy-learning": "Learning how to manage memory — store, retrieve, update, discard — not just what to remember. MemRL is the sharpest instance: the memory policy itself is the learned artefact.",
        "prompt-optimisation": "The prompt or program compiled from data and feedback (DSPy, GEPA). Powerful inside one block, and the lab's measurements show why it forgets across blocks: a shared prompt is a shared fate.",
        "verifier-feedback": "A checker or environment decides success and only success is learned from. Binary task-success in this lab is the minimal verifier — coarse on purpose, because partial credit is where gaming hides.",
        "self-refine-loop": "Generate, critique, revise inside one task. Improves the single answer; says nothing about the next task unless the critique is stored, fenced and re-tested.",
        "agent-computer": "Redesigning the action space and feedback so the model can act well (SWE-agent's interfaces). Often the highest-leverage change — and orthogonal to whether the agent learns.",
        "hierarchical-memory": "Memory in levels — segments, pages, traces — with different retention per level. Structure is the forgetting policy made explicit.",
        "selective-forgetting": "Forgetting as designed operation: heat eviction, preemptive summarisation, redundancy pruning. The lab's TTL control is the minimal instance.",
        "catastrophic-forgetting": "The problem that prices everything: new families overwrite old competence. F_k in the metrics chapter is its meter.",
        "transfer": "The problem's kinder face: what helps (or harms) across families. Forward and backward transfer meter it; scoping decides its sign.",
        "credit-assignment": "Which part of a long trajectory deserves credit. Sparse binary feedback makes this hard — and makes verifier design the real work.",
        "harness": "The scaffolding as the artefact: tools, prompts, state under optimisation. The harness-evolution papers are this practice becoming the research program.",
        "memory-benchmarks": "Benchmarks that grade memory, not single answers — LoCoMo, LongMemEval, the Letta leaderboard. Read them as the field's emerging hold-outs, and check whether they stream or merely quiz.",
    }
    kinds = defaultdict(list)
    for c in concepts:
        kinds[c.get("kind", "?")].append(c["id"])
    for kind in sorted(kinds):
        body.p(
            f"*{kind}* ({len(kinds[kind])}): {', '.join(sorted(kinds[kind]))}. " +
            ("The paradigms are the bets about what learning is; argue them first, because everything downstream inherits the bet." if kind == "paradigm" else
             "The mechanisms are the moving parts; each one needs a metric that would catch it failing, or it is decoration." if kind == "mechanism" else
             "The problems are the reasons the mechanisms exist; a mechanism with no problem is a solution looking for a stream." if kind == "problem" else
             "The practices are what operators actually do; judge them by whether they survive contact with a real stream.")
        )
    for c in concepts:
        cid = c["id"]
        note = CONCEPT_NOTES.get(cid)
        if note:
            body.p(f"**{c.get('label', cid)}** (`{cid}`, {c.get('kind', '?')}) — {c.get('gloss', '')} {note}")
    council(body, [
        ("Red team", f"{n_concepts} concepts is {n_concepts} places to hide a weak definition: if 'self-improvement' covers everything from a changed prompt to a rewritten codebase, it explains nothing. Pin every claim to the concept id, then check the id means one thing."),
        ("Blue team", "Use the concept kinds as review checklists: paradigms need protocols, mechanisms need measurements, problems need meters, practices need drills. A concept with no kind is a vibe — send it back."),
        ("Operator", f"Teach the {n_concepts} glosses before the {n_works} works: a team that shares vocabulary argues about evidence, and a team that does not argues about words."),
    ])
    CH(f"{n_works} works, verified")
    body.table(["Work", "Venue · year", "Mechanism"],
               [[w.get("title", w["id"]), f"{w.get('venue', '')} · {w.get('year', '')}", w.get("mechanism", "")]
                for w in works])
    body.p(
        "Every identifier above was verified against its source and corrected where wrong — "
        "the lab's own test suite caches the arXiv verification and re-checks it, because a "
        "landscape with wrong references is a rumour about the field, not a map of it."
    )
    verdict_counts = Counter()
    assessed = []
    for w in works:
        a, verdict, _, why = lab_assess(w)
        verdict_counts[verdict] += 1
        assessed.append((w, a, verdict, why))
    n_fals = verdict_counts.get("falsifiable", 0)
    n_part = verdict_counts.get("partially falsifiable", 0)
    n_not = verdict_counts.get("not falsifiable by its own protocol", 0)
    venues = Counter((w.get("venue") or "unrecorded") for w in works)
    years = sorted({w.get("year") for w in works if w.get("year")})
    body.p(
        f"On the current snapshot of {n_works} works: **{n_fals}** are falsifiable, **{n_part}** are "
        f"partially falsifiable, **{n_not}** are not falsifiable by their own protocol. "
        "That is the gap this lab works in — and the works that clear the bar are all recent "
        "harness-evolution work, including the paper this lab is built on."
    )
    body.p(
        "The pile skews " + ", ".join(f"{v} ({n})" for v, n in venues.most_common(4)) +
        f", spanning {years[0]}–{years[-1]}. Read the skew, not just the count: a field that "
        "publishes mostly preprints revises fast and verifies slowly, which is exactly why the "
        "identifier check runs in the test suite instead of living in someone's memory."
    )
    fals_ids = sorted(w["id"] for w, _, v, _ in assessed if v == "falsifiable")
    if fals_ids:
        body.p(f"*Falsifiable ({len(fals_ids)}):* {', '.join(fals_ids)}. Read these first when someone claims continual learning — they are the only ones whose protocol could have caught them being wrong.")
    body.m("```mermaid")
    body.m(figs[5][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[5][0])}">{esc(figs[5][0])}</pre>'
        f"<figcaption>{esc(figs[5][1])}</figcaption></figure>"
    )
    KIND_ORDER = ["paper", "benchmark", "framework", "product", "writeup", "blog"]
    KIND_INTRO = {
        "paper": "Peer-reviewed and preprint papers: the mechanisms the lab compares itself against. Read the alignment row before the abstract — it says what the paper's own protocol could have caught.",
        "benchmark": "Benchmarks and suites: the field's emerging hold-outs. A benchmark that streams families with per-boundary checkpoints tests continual learning; one that quizzes single answers tests memory retrieval.",
        "framework": "Open-source frameworks: where the mechanisms ship as code. They standardise the harness — which is why harness drift (EvoHarnessBench) hits them first.",
        "product": "Products: memory and coding agents under production load. Vendor writeups describe behaviour; the alignment row records what was actually measured.",
        "writeup": "Essays and surveys that frame the field: the bitter lesson, the effective-agent playbooks, the memory-mechanism surveys. Design priors, not learning evidence — borrow the framing, redo the measurement.",
        "blog": "Practitioner notes: short, opinionated, and often the first place a failure mode is named. Treat as field reports to verify, not results to cite.",
    }
    by_kind = defaultdict(list)
    for item in assessed:
        by_kind[item[0].get("kind", "paper")].append(item)
    for kind in KIND_ORDER + sorted(set(by_kind) - set(KIND_ORDER)):
        items = sorted(by_kind.get(kind, []), key=lambda t: (t[0].get("year") or 0, t[0]["id"]))
        if not items:
            continue
        body.m(f"### {kind.title()}s ({len(items)})")
        body.h(f"<h3>{esc(kind.title())}s ({len(items)})</h3>")
        if kind in KIND_INTRO:
            body.p(KIND_INTRO[kind])
        if kind in KIND_ESSAYS:
            voices_items(body, KIND_ESSAYS[kind])
        for w, a, verdict, why in items:
            wid = w["id"]
            body.m(f"#### {w.get('title', wid)}")
            body.h(f"<h4>{esc(w.get('title', wid))}</h4>")
            url = w.get("url", "")
            body.m(f"*{wid}* — {w.get('authors', '')}, {w.get('venue', '')} · {w.get('year', '')} · {w.get('kind', '')}. {url}")
            body.h(f"<p><code>{esc(wid)}</code> — {esc(str(w.get('authors', '')))}, {esc(str(w.get('venue', '')))} · {esc(str(w.get('year', '')))} · {esc(str(w.get('kind', '')))}. {esc(url)}</p>")
            body.m(f"**What it does.** {w.get('summary', '')}")
            body.h(f"<p><b>What it does.</b> {esc(str(w.get('summary', '')))}</p>")
            body.m(f"**Mechanism.** {w.get('mechanism', '')}")
            body.h(f"<p><b>Mechanism.</b> {esc(str(w.get('mechanism', '')))}</p>")
            align_str = " · ".join(f"{k}={a.get(k, 'unknown')}" for k in
                                   ["surface", "isolation", "retrieval", "evaluation", "holdout",
                                    "evidence", "forgetting", "efficiency", "scope"] if k in a)
            body.m(f"**Alignment.** {align_str}.")
            body.h(f"<p><b>Alignment.</b> {esc(align_str)}.</p>")
            body.m(f"**Verdict: {verdict}** — {why}.")
            body.h(f"<p><b>Verdict: {esc(verdict)}</b> — {esc(why)}.</p>")
            conc = ", ".join(f"`{c}`" for c in (w.get("concepts") or [])) or "—"
            pats = ", ".join(f"`{p}`" for p in (w.get("patterns") or [])) or "—"
            body.m(f"**Concepts.** {conc} **Catalog patterns.** {pats}")
            body.h(f"<p><b>Concepts.</b> {conc} <b>Catalog patterns.</b> {pats}</p>")
            body.m(f"**Lab reading.** {work_reading(w, a, verdict)}")
            body.h(f"<p><b>Lab reading.</b> {esc(work_reading(w, a, verdict))}</p>")
            if wid not in WORK_NOTES:
                sys.exit(f"tools/build_sl_book.py: no researcher note for work `{wid}` in tools/sl_book_prose.py")
            body.p(f"**Researcher note.** {WORK_NOTES[wid]}")
            body.m()
    council(body, [
        (f"Red team", f"{n_works} verified references is a moat around a claim: attack the two filter questions instead — no measured degradation, no disjoint hold-out, no falsifiability. Most 'self-learning' demos fail both, loudly, in under a minute of reading."),
        ("Blue team", "Run every new paper through the same two gates before it enters your landscape: measured degradation, disjoint hold-out. The merge pipeline exists so the bar stays where it is when the pile grows."),
        ("Operator", "When a vendor cites a work, ask which box it landed in: evaluated-and-held-out, or merely published. The per-work verdict above answers in one line — use it live in the meeting, not after."),
    ])

    # -- Part V ---------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part V: The catalog bridge",
                    h(1, "Part V: The catalog bridge")))
    CH("Patterns the lab stands on")
    scen_by_pat = defaultdict(list)
    for s in cat["scenarios"]:
        for ref in s.get("patternRefs", []):
            scen_by_pat[ref].append(s)
    casc_by_pat = defaultdict(list)
    for c in cat["cascades"]:
        for ref in c.get("patternRefs", []):
            casc_by_pat[ref].append(c)
    for pid, reading in SL_PATTERNS:
        p = by_pat[pid]
        ctx = {"scenarios": scen_by_pat.get(pid, []), "cascades": casc_by_pat.get(pid, []),
               "related": [{"name": by_pat[r]["name"]} for r in p.get("related", []) if r in by_pat]}
        red, blue, op = pattern_council_points(p, ctx)
        prow = f"**{p['name']}** (`{pid}`) — {p.get('summary', '')} Lab reading: {reading}"
        body.m("- " + prow)
        body.h(f"<p><b>{esc(p['name'])}</b> (<code>{esc(pid)}</code>) — {esc(p.get('summary', ''))} "
               f"Lab reading: {esc(reading)}</p>")
        body.m(f"**Council on {p['name']}.** Red team: {red} Blue team: {blue} Operator: {op}")
        body.m()
        body.h(f"<p><b>Council on {esc(p['name'])}.</b> Red team: {esc(red)} Blue team: {esc(blue)} Operator: {esc(op)}</p>")
    voices(body, "ch15")
    council(body, [
        ("Red team", "Sixteen patterns is sixteen specifications to read before attacking the lab: each names failure modes, and the failure modes are the attack plan. The lab's own four breakages — interference, forgetting, collision, overwriting — map onto them exactly."),
        ("Blue team", "Deploy the memory patterns as a stack, not a menu: episodic checkpoints plus scoped consolidation plus TTL forgetting is defense in depth for learning itself. Any one of them alone is a single point of amnesia."),
        ("Operator", "If you run the lab, pin these sixteen pattern ids in your review checklist: every design the lab produces should name which of them it implements. A design that implements none is an experiment, not a system."),
    ])
    CH("Scenarios the lab answers")
    by_id = {s["id"]: s for s in cat["scenarios"]}
    rows = []
    for sid, (road, arch, note) in SL_SCENARIOS.items():
        s = by_id[sid]
        rows.append([s["title"], s["domain"], s["severity"], road, arch, note])
    body.table(["Scenario", "Domain", "Severity", "Road", "Sim shape", "Self-learning reading"], rows)
    body.p(
        f"Five of the fourteen are the catalog's self-improvement core — reward hacking, "
        "distillation collapse, prompt self-editing, spawn-fleet runaway, metric gaming — and "
        "the rest are the drift, memory and evaluation stories a learning agent lives inside. "
        "Every one of them runs in the Rogue Agents tab too: the two books share scenarios "
        "because the two threats share agents."
    )
    for road in ("injected", "emergent", "both"):
        ids = sorted(s for s, (r, _, _) in SL_SCENARIOS.items() if r == road)
        archs = sorted({SL_SCENARIOS[s][1] for s in ids})
        body.p(
            f"*{ROAD_LABEL[road].split(' — ')[0]}* — {len(ids)} scenarios "
            f"({', '.join(ids)}), archetypes {', '.join(archs)}. " +
            ("The minority road: an outside attack turns a learning agent, and the defense is authority — grants, egress, attestation." if road == "injected" else
             "The majority road: the learning itself goes wrong, and only measurement sees it — deviation, misalignment, bands, hold-outs." if road == "emergent" else
             "Both roads at once: the scenarios that refuse the distinction, and the ones to rehearse first because either defense alone misses them.")
        )
    voices(body, "ch16")
    council(body, [
        ("Red team", "Fourteen scenarios is fourteen rehearsals your adversary has also read: the catalog is public, the spin-up is deterministic, and the spawn-fleet shape needs no exploit — just delegation without a cap."),
        ("Blue team", "Pair each scenario with its lab stream: reward-hack with the hard-order stream, distill-collapse with long-horizon, scope-escape with the domain streams. A scenario without a stream is a story; with one, it is a regression test."),
        ("Operator", "Start from the five self-improvement core scenarios and add the drift and memory ones as your fleet touches those surfaces. The table's road column tells you which defense family each one belongs to — authority for injected, measurement for emergent."),
    ])

    # -- Part VI --------------------------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part VI: Operating",
                    h(1, "Part VI: Operating")))
    CH("The lab")
    body.p(
        "Run it with `./run.sh` (API on :8220, frontend at /) or `docker compose up --build -d` "
        "(dashboard at http://localhost:8220, SQLite in a volume, exports bind-mounted). The "
        "model backend is fox-services on :8210 with an Ollama direct fallback; live mode reaches "
        "it through the host gateway. Two gate profiles: core (8 scenarios, ~1.5 minutes a round, "
        "~75 minutes for fifty) and full (13 scenarios, ~2.5 minutes a round, ~2 hours). The "
        "iteration loop runs mechanism sweep, unit and API tests and the browser UI audit fifty "
        "times and stops at the first failure — a gate nobody can afford to run is not a gate."
    )
    voices(body, "ch17")
    council(body, [
        ("Red team", "Fifty rounds of green is fifty rounds of the same seeds if nobody rotates them: the loop's strength is repetition, its weakness is ritual. Vary the profiles and the ports, or the gate tests the gate, not the lab."),
        ("Blue team", "Run core weekly and full before every release: mechanism sweep for the evolvers, unit plus API for the contracts, UI audit for the dashboard humans actually touch. A gate that stops at the first failure is only useful if someone reads the name it stops on."),
        ("Operator", "Budget the gate like a utility bill: 75 minutes core, 2 hours full, unattended. If the team cannot afford it, shrink the release cadence until they can — shipping faster than the gate is how regressions get tenure."),
    ])
    body.m("```mermaid")
    body.m(figs[6][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[6][0])}">{esc(figs[6][0])}</pre>'
        f"<figcaption>{esc(figs[6][1])}</figcaption></figure>"
    )
    CH("The add-on tab")
    body.p(
        "The Self-Learning tab in this app bridges to that lab without executing it: a "
        "reachability dot (no-cors probe, opaque means up), deep links to the dashboard, run "
        "instructions, and the concept bridge mapping each lab mechanism to the catalog records "
        "above. Port configurable, status re-probed on demand. If the lab moves ports, the tab "
        "follows in one field — the bridge degrades to links and tables, never to errors."
    )
    body.m("```mermaid")
    body.m(figs[7][0])
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(figs[7][0])}">{esc(figs[7][0])}</pre>'
        f"<figcaption>{esc(figs[7][1])}</figcaption></figure>"
    )
    voices(body, "ch18")
    council(body, [
        ("Red team", "The tab links out to :8220 and trusts whatever answers: DNS-rebind the lab host and the dashboard link is yours. The tab's honesty — links, not data — is also its limit; verify the lab is yours before you open it."),
        ("Blue team", "Keep the bridge read-only: no-cors status, outbound links, catalog records. The day the tab executes lab runs it inherits the lab's threat model — until then it has almost none, and that is a feature."),
        ("Operator", "Run the fifty-round gate before every lab upgrade and the core profile weekly: the loop stops at the first failure and names it, which is the entire point. The tab's status dot is for humans; the gate is for releases."),
    ])
    CH("The honest caveat")
    body.p(
        "A passing sweep proves the harness is wired, not that any agent learns safely. The "
        "streams are fixed task families, the evolvers are six hand-written rules, and the bands "
        "describe these streams at these seeds — a real deployment brings new tasks, new orders "
        "and new adversaries. What the numbers prove is comparative: which evolvers hold which "
        "streams, how much forgetting each ordering costs, and whether the workflow survives "
        "contact with the inconvenient order. Enforcement lives outside the model, in readable "
        "code — audit that, not the score."
    )
    voices(body, "ch19")
    council(body, [
        ("Red team", "The caveat is the attack plan restated politely: fixed task families, six hand-written evolvers, bands that belong to these seeds. Anyone who changes the streams invalidates the bands — including you, the moment you deploy somewhere new."),
        ("Blue team", "Comparative numbers are the honest yield: which evolver holds which stream, what each ordering costs, whether the workflow survives inconvenience. Absolute scores are weather; deltas are climate. Report climate."),
        ("Operator", "Rehearse with the suite, decide with the bands, verify with live hold-outs — in that order, every time. Skip a step and you are not moving fast, you are moving blind with good telemetry."),
    ])

    # -- Part VII: the research graphs ------------------------------------- #
    body.chapter_break()
    entries.append(("part", "Part VII: The research graphs",
                    h(1, "Part VII: The research graphs")))
    n_rl, n_rlc, n_rld = len(rl_works), len(rl_concepts), len(rl_dims)

    def rl_assess(w):
        a = w.get("align") or {}
        gates = [
            (a.get("stability", "none") not in ("none", "unknown"),
             "no stability control — one update may destroy earlier ones"),
            (a.get("evaluation") in ("holdout", "banded"),
             "no holdout or banded evaluation — gain may be memorisation"),
            (a.get("cost", "unreported") not in ("unreported", "unknown"),
             "unreported cost — the win cannot be budgeted into a gate"),
        ]
        closed = sum(1 for ok, _ in gates if ok)
        verdict = ("measured and priced" if closed == 3 else
                   "measured on two gates" if closed == 2 else
                   "measured on one gate" if closed == 1 else
                   "unmeasured by its own protocol")
        why = ("it closes all three gates: a stability control, a holdout or banded "
               "evaluation, and a reported cost") if closed == 3 else \
              "because " + " and ".join(m for ok, m in gates if not ok)
        return verdict, why

    def rl_reading(w, verdict):
        fam = (w.get("align") or {}).get("family", "unknown")
        base = {
            "measured and priced": "Closes all three gates — quote its claims, then still re-test the mechanism on your own stream before promoting them to practice.",
            "measured on two gates": "Two gates closed — cite the numbers with the missing gate named beside them, and close it yourself before repeating the claim.",
            "measured on one gate": "One gate closed — treat it as a directional result, borrow the mechanism, and supply the other two measurements yourself.",
            "unmeasured by its own protocol": "No gate closed — treat it as a design prior (borrow the mathematics), never as evidence about agents.",
        }[verdict]
        fam_note = {
            "tabular": "Tabular foundations: recursion, bootstrapping, off-policy updates — priors, not agent evidence.",
            "deep-value": "Deep value methods: replay and target stabilisers to borrow; re-price exploration and cost.",
            "policy-gradient": "Policy-gradient lineage: the optimiser family behind RLHF; verify the clip binds on your distribution.",
            "actor-critic": "Actor-critic designs: twin critics and entropy where bias or exploration dominate; re-measure cadence.",
            "model-based": "Model-based planning: plan inside a learned model; re-measure error compounding before trusting imagination.",
            "offline": "Offline discipline: conservatism and in-sample values; demand the data-collection story with the number.",
            "preference": "Preference recipes: learned rewards with anchors; audit whose preferences and what the anchor cost.",
            "verbal": "Verbal mechanisms: reflection, skills, prose evolution; fence per family and re-measure forgetting.",
            "memory-policy": "Memory-policy designs — the family this lab extends, so compare evolver-to-evolver on bands.",
        }.get(fam, "Context for the field (a benchmark, an environment, or an argument), not a learning result.")
        return f"{base} {fam_note}".strip()

    CH("Why reinforcement learning belongs in this book")
    body.p(
        "This book studies learning with the weights frozen: lessons in prose, skills in "
        "libraries, memory under operators, evolvers that never touch a gradient. That "
        "narrowing is productive only while its outside stays visible, so this part maps "
        f"the outside — {n_rl} reinforcement-learning works from Bellman to RLVR, curated "
        "in this repository's own graph, joined to the lab's landscape by shared concepts "
        "and explicit links. Every verbal mechanism in the earlier parts has a gradient "
        "ancestor here; the graph lets you walk from descendant to ancestor before "
        "claiming novelty."
    )
    body.p(
        "The direction of borrowing runs one way and the book states it plainly: "
        "mechanisms travel from RL into the lab, while evidence must be re-earned on "
        "drifting streams with per-boundary checkpoints. A return curve from the "
        "deep-RL era proves competence at games, not continual learning; a trust region "
        "is a stability idea worth translating into scope fences and TTL decay, not a "
        "result that transfers. The per-work verdicts below enforce the direction — "
        "what to borrow, what to re-measure — in one line each."
    )
    place_local(body, "design/12-research-graphs.md", "What lives where",
                "Ownership map: the sibling landscape is vendored by byte copy while the RL graph is curated in-repo — one validator checks both, and the tab draws what the files say.")
    voices(body, "rg1")
    council(body, [
        ("Red team", "A foundations part is where authority launders itself: famous rows with no closed gates will be cited as proof by readers who skip the verdict column. The defence is the column itself — quote the tier, not the title — and the discipline of never letting a tabular result testify about an agent."),
        ("Blue team", "Teach the borrowing direction before the works: mechanisms in, evidence re-earned. Teams that memorise the direction stop importing game scores as learning claims, which is most of what a foundations chapter has to accomplish."),
        ("Operator", "Use this part the way the trails order it — foundations, optimisers, offline, preferences, verbal, memory-policy, evaluation last. Each walk reframes the last, and the evaluation trail is the gate all the others must pass."),
    ])
    CH(f"{n_rld} dimensions, {n_rlc} concepts")
    body.table(["Dimension", "What it separates"],
               [[d.get("id", ""), d.get("label", "")] for d in rl_dims if isinstance(d, dict)])
    body.p(
        "Dimensions turn a reading list into something countable: every RL work below is "
        f"placed on all {n_rld}, and the three gates that matter most are stability, "
        "evaluation and cost — a stability control says the update cannot destroy the "
        "past, a holdout or banded evaluation says the gain is not memorisation, and a "
        "reported cost says the win was not bought with volume."
    )
    for d in rl_dims:
        if not isinstance(d, dict):
            continue
        did, label = d.get("id", ""), d.get("label", d.get("id", ""))
        body.p(
            f"*{label}* (`{did}`) asks: {d.get('question', '')} "
            f"Options run {', '.join(d.get('options', [])[:5])} — plus 'unknown', which is always legal. "
            + RL_DIM_NOTES.get(did, "Every work gets an explicit cell instead of the reviewer's benefit of the doubt.")
        )
    sl_concept_ids = {c.get("id") for c in landscape.get("concepts", [])}
    body.table(["Concept", "Kind", "Gloss", "Shared"],
               [[c.get("id", ""), c.get("kind", ""), c.get("gloss", ""),
                 "yes — same id in both graphs" if c.get("id") in sl_concept_ids else "—"]
                for c in rl_concepts])
    for c in rl_concepts:
        cid = c.get("id", "")
        note = RL_CONCEPT_NOTES.get(cid)
        if note:
            body.p(f"**{c.get('label', cid)}** (`{cid}`, {c.get('kind', '?')}) — {c.get('gloss', '')} {note}")
    place_local(body, "design/12-research-graphs.md", "Graph data model",
                "The graph data model: works placed on dimensions, carrying concepts, linking works, addressed by trails, tended by collectors.")
    voices(body, "rg2")
    council(body, [
        ("Red team", "Eight dimensions with an 'unknown' option map the reviewer's ignorance alongside the field: sort the works by unclosed gates and the least-examined claims surface first. Unknown across the row is where the next incident already lives."),
        ("Blue team", f"Hold every RL work to the three gates before it enters your reasoning: a stability control, a holdout or banded evaluation, a reported cost. The validator script exists so the bar does not move when the pile grows."),
        ("Operator", "Use the dimensions as procurement questions for any 'RL-powered' vendor claim: which family, what signal, what substrate changes, what bounds the update, how was it graded, what did it burn. Missing answers are pricing signals."),
    ])
    CH(f"{n_rl} works, verified")
    body.table(["Work", "Venue · year", "Mechanism"],
               [[w.get("title", w["id"]), f"{w.get('venue', '')} · {w.get('year', '')}", w.get("mechanism", "")]
                for w in rl_works])
    verdict_counts = Counter()
    rl_assessed = []
    for w in rl_works:
        verdict, why = rl_assess(w)
        verdict_counts[verdict] += 1
        rl_assessed.append((w, verdict, why))
    body.p(
        f"On the current graph of {n_rl} works: **{verdict_counts.get('measured and priced', 0)}** "
        f"are measured and priced, **{verdict_counts.get('measured on two gates', 0)}** on two gates, "
        f"**{verdict_counts.get('measured on one gate', 0)}** on one gate, and "
        f"**{verdict_counts.get('unmeasured by its own protocol', 0)}** are unmeasured by their own "
        "protocol. The unmeasured rows are mostly the tabular foundations — load-bearing "
        "mathematics, citable as priors, never as agent evidence."
    )
    priced_ids = sorted(w["id"] for w, v, _ in rl_assessed if v == "measured and priced")
    if priced_ids:
        body.p(f"*Measured and priced ({len(priced_ids)}):* {', '.join(priced_ids)}. Quote these first; re-measure everything else on your own stream.")
    sl_fig(body,
        'flowchart LR\n  TAB["tabular - Bellman, TD, Q"] --> DV["deep value - DQN, Rainbow"]\n  TAB --> PG["policy gradient - REINFORCE, PPO"]\n  PG --> AC["actor-critic - A3C, SAC, TD3"]\n  PG --> MB["model-based - AlphaGo, MuZero, Dreamer"]\n  DV --> OFF["offline - CQL, IQL, DT"]\n  PG --> PREF["preference - RLHF, DPO"]\n  PREF --> RLVR["verifiers - R1, RLVR"]\n  RLVR --> VERB["verbal - Reflexion, GEPA"]\n  VERB --> MEM["memory-policy - MemRL, A-MEM"]',
        "The RL lineage in this book's graph: tabular foundations to deep optimizers to preferences to verbal and memory-policy learning.")
    by_kind = defaultdict(list)
    for item in rl_assessed:
        by_kind[item[0].get("kind", "paper")].append(item)
    for kind in ["paper", "benchmark", "framework"] + sorted(set(by_kind) - {"paper", "benchmark", "framework"}):
        items = sorted(by_kind.get(kind, []), key=lambda t: (t[0].get("year") or 0, t[0]["id"]))
        if not items:
            continue
        body.m(f"### {kind.title()}s ({len(items)})")
        body.h(f"<h3>{esc(kind.title())}s ({len(items)})</h3>")
        if kind in KIND_ESSAYS:
            voices_items(body, KIND_ESSAYS[kind])
        for w, verdict, why in items:
            wid = w["id"]
            body.m(f"#### {w.get('title', wid)}")
            body.h(f"<h4>{esc(w.get('title', wid))}</h4>")
            url = w.get("url", "")
            body.m(f"*{wid}* — {w.get('authors', '')}, {w.get('venue', '')} · {w.get('year', '')} · {w.get('kind', '')}. {url}")
            body.h(f"<p><code>{esc(wid)}</code> — {esc(str(w.get('authors', '')))}, {esc(str(w.get('venue', '')))} · {esc(str(w.get('year', '')))} · {esc(str(w.get('kind', '')))}. {esc(url)}</p>")
            body.m(f"**What it does.** {w.get('summary', '')}")
            body.h(f"<p><b>What it does.</b> {esc(str(w.get('summary', '')))}</p>")
            body.m(f"**Mechanism.** {w.get('mechanism', '')}")
            body.h(f"<p><b>Mechanism.</b> {esc(str(w.get('mechanism', '')))}</p>")
            align_str = " · ".join(f"{k}={a}" for k, a in (w.get("align") or {}).items())
            body.m(f"**Alignment.** {align_str}.")
            body.h(f"<p><b>Alignment.</b> {esc(align_str)}.</p>")
            body.m(f"**Verdict: {verdict}** — {why}.")
            body.h(f"<p><b>Verdict: {esc(verdict)}</b> — {esc(why)}.</p>")
            conc = ", ".join(f"`{c}`" for c in (w.get("concepts") or [])) or "—"
            pats = ", ".join(f"`{p}`" for p in (w.get("patterns") or [])) or "—"
            sll = ", ".join(f"`{s}`" for s in (w.get("sl_links") or [])) or "—"
            rll = ", ".join(f"`{r}`" for r in (w.get("rl_links") or [])) or "—"
            body.m(f"**Concepts.** {conc} **Catalog patterns.** {pats}")
            body.h(f"<p><b>Concepts.</b> {conc} <b>Catalog patterns.</b> {pats}</p>")
            body.m(f"**Links.** Self-learning: {sll} · RL builds-on: {rll}")
            body.h(f"<p><b>Links.</b> Self-learning: {sll} · RL builds-on: {rll}</p>")
            body.m(f"**Lab reading.** {rl_reading(w, verdict)}")
            body.h(f"<p><b>Lab reading.</b> {esc(rl_reading(w, verdict))}</p>")
            if wid not in RL_WORK_NOTES:
                sys.exit(f"tools/build_sl_book.py: no researcher note for RL work `{wid}` in tools/sl_book_prose.py")
            body.p(f"**Researcher note.** {RL_WORK_NOTES[wid]}")
            body.m()
    voices(body, "rg3")
    council(body, [
        ("Red team", "Fame concentrates where gates are open: the most-cited rows close the fewest, and teams borrow authority with mechanism. The per-work reading answers in one line — borrow this, re-measure that — and the re-measure half is load-bearing."),
        ("Blue team", "Run every RL import through the three gates before it enters your reasoning: stability control, holdout or bands, reported cost. A benchmark with a holdout but no ledger is a probe awaiting prices; a return curve with priced steps but no stability control is competence without a forgetting meter."),
        ("Operator", "Use the verdict tier live in meetings: measured-and-priced travels, two gates travel with the missing gate named, one gate is directional, unmeasured is mathematics. Anyone quoting a title without its tier is selling, not citing."),
    ])
    CH("Five concepts, two graphs")
    shared = [c for c in rl_concepts if c.get("id") in sl_concept_ids]
    body.table(["Shared concept", "RL gloss"],
               [[c.get("id", ""), c.get("gloss", "")] for c in shared])
    body.p(
        f"Five concepts carry identical identifiers in both graphs, so they carry shared "
        "obligations: credit assignment, memory-policy learning, experience evolution, "
        "continual learning and verifier feedback must mean one thing on both sides, or "
        "the interlink is decoration. The bridge works below are readable from either "
        "side — a verbal mechanism to the lab, a policy result to RL — and following "
        "those edges is how hidden assumptions surface."
    )
    bridged = sorted(((w["id"], len(w.get("sl_links", []))) for w in rl_works if w.get("sl_links")),
                     key=lambda t: (-t[1], t[0]))
    body.table(["RL work", "Self-learning links"],
               [[wid, ", ".join(f"`{s}`" for s in next(w["sl_links"] for w in rl_works if w["id"] == wid))] for wid, _ in bridged])
    body.p(
        f"{len(bridged)} of the {n_rl} RL works link explicitly into the lab's landscape, "
        "and every lab work they touch lists the RL citer back — the interlink reads both "
        "ways. Read each pair, not each paper: the mechanism tells you what it does, the "
        "lab-side failure scenario tells you what it does to you."
    )
    place_local(body, "design/12-research-graphs.md", "Interlink sketch",
                "Three interlink mechanisms on one sketch: dashed cross-graph links, dotted shared-concept spokes, solid builds-on edges inside the RL graph.")
    voices(body, "rg4")
    council(body, [
        ("Red team", "Interlinks carry poison faster than insight: a planted reasoning compounds in a bank the way a hacked reward compounds in a policy, and shared concepts do not distinguish teacher from attacker. Audit the bridge works against their lab-side failure scenarios, not their abstracts."),
        ("Blue team", "Cross-check verdicts across graphs before trusting either: a mechanism that survives the lab's holdouts and the RL graph's bands has passed two independent examinations. Shining in exactly one vocabulary means re-test in the other."),
        ("Operator", "Keep the five shared glosses identical in both graphs — same id, same meaning — and fail any edit that forks them. A forked concept is two teams arguing about words while believing they argue about evidence."),
    ])
    CH("Reading trails and the collectors that tend them")
    body.table(["Trail", "Scope", "Works"],
               [[t.get("label", t.get("id", "")), t.get("scope", ""),
                 ", ".join(f"`{r}`" for r in (t.get("works") or []))] for t in trails])
    body.p(
        f"Seven trails order the two graphs' works into walks with destinations: "
        "foundations, deep RL, offline, the LLM arc from preferences to verifiers, the "
        "verbal and memory-policy trails where the lab lives, and evaluation last — the "
        "gate every other trail must pass. Walk them in order; each trail reframes the "
        "last, and that reframing is the curation."
    )
    body.table(["Collector", "Command", "Flow"],
               [[c.get("label", c.get("id", "")), c.get("tool", ""),
                 f"{'; '.join(c.get('sources', []))} → {'; '.join(c.get('outputs', []))}"] for c in collectors.get("collectors", [])])
    body.p(
        "Three collectors tend the graphs and none of them writes silently: the snapshot "
        "sync copies bytes, the arXiv watch stages an inbox, the validator fails loudly "
        "on any dangling reference. Drafts enter flagged and stay flagged until a human "
        "replaces the staged summary with a read one — a landscape, not a landfill, kept "
        "quarterly."
    )
    place_local(body, "design/12-research-graphs.md", "The collectors (human-gated by design)",
                "The collectors, human-gated: bytes, inbox, validator — and a human between the inbox and the graph.")
    place_local(body, "design/12-research-graphs.md", "The graph view",
                "The graph-view pipeline: filtered data to deterministic layout to one SVG, with pan and zoom that never re-render and clicks that paint only the detail.")
    voices(body, "rg5")
    council(body, [
        ("Red team", "Trails are opinions with nice typography: the ordering flatters the lab's own family by placing memory-policy last like a destination. Walk them backwards at least once — evaluation first — and see which earlier claims survive the gate being open from the start."),
        ("Blue team", "Tend the collectors on a schedule, not on enthusiasm: re-sync the snapshot, re-run the validator, retire trails whose frontier moved on. A graph nobody re-validates is a rumour with good type."),
        ("Operator", "Assign the inbox a human and a cadence: staged candidates rot into implied endorsement if nobody triages them. Flagged drafts are honest only while someone reads the flag."),
    ])

    # -- appendices ------------------------------------------------------ #
    body.chapter_break()
    entries.append(("back", "Appendix A: Configuration reference",
                    h(1, "Appendix A: Configuration reference")))
    body.table(
        ["Setting", "Default", "Meaning"],
        [["lab port", "8220", "FastAPI + dashboard (`./run.sh`, `SLA_PORT` to move)"],
         ["model backend", "fox-services :8210", "Ollama :11434 direct fallback"],
         ["sweep", "20 iterations", "policy seed 7+i, train 100+i, eval 1100+i, lesson 1000+i; mean ± std"],
         ["gate core", "8 scenarios × 50 rounds", "~1.5 min/round, ~75 min total"],
         ["gate full", "13 scenarios × 50 rounds", "~2.5 min/round, ~2 h total"],
         ["hold-outs", "disjoint", "validation tasks never overlap training"],
         ["bands", "50 iterations/cell", "block 20, eval 30; judgement is measured / above / below"]],
    )
    body.chapter_break()
    entries.append(("back", "Appendix B: How this book was built",
                    h(1, "Appendix B: How this book was built")))
    body.p(
        "This supplement is generated by `tools/build_sl_book.py` from the lab "
        "(`app/streams.py`, `app/evolvers.py`, `reference/*.json`, `design/*.md` figures) "
        "and this catalog (`data/*.json`). Scenario and evolver inventories are imported "
        "from the lab's own modules at build time; the build fails if the sibling checkout "
        "is absent, any mapped id leaves either catalog, or any placed figure goes missing — "
        "so the next edition cannot silently disagree with the lab it describes."
    )
    n_w = len(landscape.get("works", []))
    body.p(
        f"It carries {len(scenarios)} lab scenarios, {len(ev_ids)} evolvers, "
        f"{len(landscape.get('concepts', []))} concepts and {n_w} verified works, "
        f"{len(SL_PATTERNS)} bridge patterns and {len(SL_SCENARIOS)} bridge scenarios, "
        f"{len(rl_works)} RL works with {len(trails)} reading trails across "
        f"{len(rl_concepts)} concepts on {len(rl_dims)} dimensions, "
        f"{len(figs)} placed figures plus hand-authored research figures rendered by the same vendored Mermaid as the app, and measured "
        "bands plus a live calibration in Part III."
    )
    body.heading(1, "Conclusion")
    entries.append(("back", "Conclusion", "conclusion"))
    voices(body, "conclusion")
    body.p(
        "Operate learning agents the way the protocol measures them: scope every lesson, "
        "condition every retrieval, checkpoint every boundary, hold out what you grade on, "
        "and sweep until the error bars earn the claim. The lab lets you rehearse all of it "
        "before the stream moves under you."
    )

    # -- final assembly: title, contents, body --------------------------- #
    seen = {}
    for kind, label, target in entries:
        seen[target] = seen.get(target, 0) + 1
    dupes = sorted(t for t, n in seen.items() if n != 1)
    if dupes:
        sys.exit(f"tools/build_sl_book.py: contents targets must be unique, dupes={dupes}")

    def toc_line(label, target):
        doc.raw_html(
            f'<li><a href="#{target}"><span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></li>'
        )

    doc = Doc()
    doc.title_page(BOOK_TITLE, SUBTITLE, AUTHOR, EDITION)
    doc.p(
        f"A supplement to *Agentic Design Patterns & Guardrails*: continual learning, "
        f"task-scoped adaptation and the evaluation discipline — with the lab's {len(scenarios)} "
        f"scenarios, {len(ev_ids)} evolvers, {len(landscape.get('concepts', []))} concepts and "
        f"{len(landscape.get('works', []))} verified works, plus the research graphs' "
        f"{len(rl_works)} RL works and {len(trails)} reading trails. Generated from the lab, the catalog, "
        "the research graphs and the design figures; nothing in it is hand-typed from memory."
    )
    doc.pagebreak()
    doc.heading(1, "Contents")
    doc.raw_html('<nav class="toc">')
    doc.raw_html("<ul>")
    for kind, label, target in entries:
        if kind == "front":
            toc_line(label, target)
    doc.raw_html("</ul>")
    for i, (kind, label, target) in enumerate(entries):
        if kind != "part":
            continue
        doc.raw_html(
            f'<div class="toc-part"><a href="#{target}">'
            f'<span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></div>'
        )
        doc.raw_html("<ul>")
        for k2, l2, t2 in entries[i + 1:]:
            if k2 != "chapter":
                break
            toc_line(l2, t2)
        doc.raw_html("</ul>")
    doc.raw_html("<ul>")
    for kind, label, target in entries:
        if kind == "back":
            toc_line(label, target)
    doc.raw_html("</ul>")
    doc.raw_html("</nav>")
    doc.m("**Contents**")
    doc.m()
    for kind, label, target in entries:
        if kind == "front":
            doc.m(f"- {label}")
    doc.m()
    for kind, label, target in entries:
        if kind == "part":
            doc.m(f"- {label}")
        elif kind == "chapter":
            doc.m(f"  - {label}")
    doc.m()
    for kind, label, target in entries:
        if kind == "back":
            doc.m(f"- {label}")
    doc.m()
    doc.md.extend(body.md)
    doc.html.extend(body.html)

    BOOK_DIR.mkdir(exist_ok=True)
    md = doc.render()
    MD_OUT.write_text(md)
    HTML_OUT.write_text(HTML_SHELL.format(title=esc(BOOK_TITLE), css=CSS, body="\n".join(doc.html)))
    print(f"wrote {MD_OUT.relative_to(ROOT)}  ({len(md.splitlines())} lines)")
    print(f"wrote {HTML_OUT.relative_to(ROOT)}  ({len(doc.html)} blocks)")
    n_ch = sum(1 for k, _, _ in entries if k == "chapter")
    print(f"book: {len(entries)} headings ({n_ch} chapters), {md.count('```mermaid')} diagrams")


if __name__ == "__main__":
    main()

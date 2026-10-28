#!/usr/bin/env python3
"""Build the supplement book *OpenShell Reference Architecture*.

Deterministic and stdlib-only. It reads the same catalog JSON the app ships
(`data/*.json`), the council deliberations (`tools/openshell_book_prose.py`)
and the domain playbooks (`tools/openshell_book_data.py`), and emits:

    book/OPENSHELL-REFERENCE-ARCHITECTURE.md   supplement book in Markdown
    book/openshell-reference-architecture.html self-contained print HTML
                             (PDF via tools/render_pdf.mjs where Chrome is
                             available)

Nothing is invented: archetype shapes, scenario mappings and domain coverage
come out of the catalog at build time; YAML sketches are labeled illustrative.
The build fails if a chapter lacks its deliberation, a domain lacks a playbook
or a scenario, or a referenced pattern id does not exist.
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_book import CSS, HTML_SHELL, Doc, esc, inline_html, load_catalog
from build_rogue_book import SCEN_ROAD, ROAD_LABEL
from openshell_book_prose import OPENSHELL_DELIB
from openshell_book_data import ARCHETYPES, DOMAIN_ORDER, DOMAIN_PLAYBOOKS, OPENSHELL_FIGS

ROOT = Path(__file__).resolve().parent.parent
BOOK_DIR = ROOT / "book"
MD_OUT = BOOK_DIR / "OPENSHELL-REFERENCE-ARCHITECTURE.md"
HTML_OUT = BOOK_DIR / "openshell-reference-architecture.html"

BOOK_TITLE = "OpenShell Reference Architecture"
SUBTITLE = "Containing Rogue Agents and Operating Agent Swarms on NVIDIA's Sandboxed Runtime"
AUTHOR = "Harish Govardhan Damodar"
EDITION = "First edition — October 2026"

SEED_NOTE = "Catalog edition: counts below are read from data/*.json at build time; no figure is hand-typed."


def _np(n, word):
    """'3 patterns' / '1 scenario' — number-noun agreement for catalog weights."""
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def deliberate(body, key):
    """Council deliberation: researchers debate before the verdict."""
    items = OPENSHELL_DELIB.get(key)
    if not items:
        sys.exit(f"tools/build_openshell_book.py: no council deliberation for `{key}` in tools/openshell_book_prose.py")
    body.m("**Council deliberation.**")
    body.m()
    for voice, text in items:
        body.m(f"- **{voice}:** {text}")
    body.m()
    body.h("<p><b>Council deliberation.</b></p><ul>" + "".join(
        f"<li><b>{esc(voice)}:</b> {inline_html(text)}</li>" for voice, text in items) + "</ul>")


def os_fig(body, key):
    src = OPENSHELL_FIGS.get(key)
    if not src:
        sys.exit(f"tools/build_openshell_book.py: no figure for `{key}`")
    body.m("```mermaid")
    body.m(src)
    body.m("```")
    body.m()
    body.h(
        '<figure class="diagram">'
        f'<pre class="mermaid" data-src="{esc(src)}">{esc(src)}</pre>'
        f"<figcaption>{esc(key)}.</figcaption></figure>"
    )


def codeblock(body, lang, src, caption=None):
    body.m(f"```{lang}")
    body.m(src)
    body.m("```")
    body.m()
    cap = f"<figcaption>{esc(caption)}</figcaption>" if caption else ""
    body.h(
        '<figure class="diagram">'
        f'<pre class="code" style="font-family:Menlo,Consolas,monospace;font-size:8.6pt;background:#f2f4f7;padding:8pt;border-radius:4px;overflow-x:auto;white-space:pre;text-align:left;">{esc(src)}</pre>'
        f"{cap}</figure>"
    )


# --------------------------------------------------------------------------- #
#  assembly
# --------------------------------------------------------------------------- #

entries = []  # (kind, label, target) in document order; kind in front|part|chapter|back
chap_n = [0]


def main():
    cat = load_catalog()
    by_pat = {p["id"]: p for p in cat["patterns"]}
    scen_by_id = {s["id"]: s for s in cat["scenarios"]}
    cov = {d: v for d, v in __import__("json").load(
        open(ROOT / "data" / "coverage.json"))["by_domain"].items()}

    # -- validations -------------------------------------------------------- #
    arch_ids = {a for _, a, _ in SCEN_ROAD.values()}
    if {a[0] for a in ARCHETYPES} != arch_ids:
        sys.exit("tools/build_openshell_book.py: archetype ids drifted from build_rogue_book.SCEN_ROAD")
    if set(DOMAIN_PLAYBOOKS) != set(cov):
        sys.exit(f"tools/build_openshell_book.py: playbook domains drifted (missing={sorted(set(cov) - set(DOMAIN_PLAYBOOKS))}, extra={sorted(set(DOMAIN_PLAYBOOKS) - set(cov))})")
    if list(DOMAIN_PLAYBOOKS) != DOMAIN_ORDER or set(DOMAIN_ORDER) != set(cov):
        sys.exit("tools/build_openshell_book.py: domain order drifted from data/coverage.json")
    dom_scen = {}
    for s in cat["scenarios"]:
        dom_scen.setdefault(s["domain"], []).append(s["id"])
    for d in cov:
        if not dom_scen.get(d):
            sys.exit(f"tools/build_openshell_book.py: domain `{d}` has no catalog scenario")
    _need = {"preface", "introduction", "conclusion",
             "arch-why", "arch-actors", "arch-channel", "arch-runtimes",
             "arch-auth", "arch-policy", "arch-prover",
             "arch-hijack", "arch-exfil", "arch-abuse", "arch-collude",
             "arch-drift", "arch-spawn",
             "ops-generations", "ops-egress", "ops-credentials",
             "ops-failclosed", "ops-quarantine",
             "pol-anatomy", "pol-locked", "pol-providers", "pol-ci",
             "notes-rehearsed", "notes-limits", "notes-scale"}
    _need |= {"domain-" + d for d in cov}
    if set(OPENSHELL_DELIB) != _need:
        sys.exit(f"tools/build_openshell_book.py: deliberation keys drifted (missing={sorted(_need - set(OPENSHELL_DELIB))}, extra={sorted(set(OPENSHELL_DELIB) - _need)})")

    arch_scen = {}
    for sid, (_, arch, _) in SCEN_ROAD.items():
        arch_scen.setdefault(arch, []).append(sid)

    doc = Doc()
    body = Doc()

    def h(level, text, cls=""):
        return body.heading(level, text, cls)

    def CH(text):
        """A numbered chapter: heading `Chapter N: …`, toc label
        `Chapter N · …`, anchor `chapter-n-…`."""
        chap_n[0] += 1
        n = chap_n[0]
        aid = h(2, f"Chapter {n}: {text}", cls="chapter")
        entries.append(("chapter", f"Chapter {n} · {text}", aid))
        return aid

    # -- front matter ---------------------------------------------------- #
    entries.append(("front", "Preface", body.heading(1, "Preface")))
    body.p(
        "This supplement is the operational companion to *Rogue Agents*. That book "
        "proves an agent swarm can turn and shows how to detect it; this one shows "
        "where to stand so the turning cannot reach anything that matters. Its subject "
        "is NVIDIA's OpenShell Reference Architecture: a sandboxed runtime for fleets "
        "of autonomous agents with kernel-level isolation, a declarative YAML policy "
        "model, and formal verification on policy changes — read here as the containment "
        "layer the rogue-agent workflow always assumed but never owned."
    )
    body.p(
        "Three questions organize it: what the reference architecture is and how it "
        "holds, how each of the six rogue archetypes meets the primitive that bounds "
        "it, and how to operate swarms — across all 26 catalog domains — on sandboxed "
        "ground with policy as code."
    )
    body.p(
        "This book was written and compiled from study and experiment observation "
        "notes of Harish Govardhan Damodar and generated by the *AI Agent Patterns "
        "& Guardrails* catalog by a deterministic script (`tools/build_openshell_book.py`), "
        "then typeset to PDF with headless Chrome and the vendored Mermaid engine "
        "(`tools/render_pdf.mjs`) — the same Mermaid that renders the diagrams in "
        "the app, so no diagram in this book was drawn by hand or screenshotted. "
        "All experiments performed in local sandbox build and maintained by Harish "
        "Govardhan Damodar and his agents, work extensively uses local open weight "
        "model for experimentation and intelligence serving, for a live demo / "
        "suggestion feel free to drop a DM in my linkedin page "
        "(https://www.linkedin.com/in/harishgovardhan-d-44b22b47/). All records, "
        "suggestions advice is from personal experiments ran on my personal setup "
        "only and does not represent the organisation I work for."
    )
    deliberate(body, "preface")

    # -- introduction ---------------------------------------------------- #
    entries.append(("front", "Introduction: containment before detection", h(1, "Introduction: containment before detection")))
    os_fig(body, "Three actors, one rule")
    n_scen = len(cat["scenarios"])
    n_pat = len(cat["patterns"])
    body.p(
        f"The catalog behind this book holds {n_pat} patterns, {n_scen} failure scenarios "
        f"and {len(__import__('json').load(open(ROOT / 'data' / 'cascades.json'))['cascades'])} cascades "
        f"across {len(cov)} domains. Every count in this book is read from that catalog at "
        f"build time; every scenario named is recorded against it; every YAML sketch is "
        f"labeled illustrative. {SEED_NOTE}"
    )
    body.p(
        "The argument in one paragraph: detection tells you a rogue exists, containment "
        "decides what that fact costs. OpenShell moves the containment decision into the "
        "runtime — supervisor, sandbox, gateway, generations, deny-by-default egress — so "
        "the response the quarantine board orders is a runtime act, not a ticket queue. "
        "The chapters that follow map each archetype and each domain onto that runtime."
    )
    deliberate(body, "introduction")

    # -- Part I ---------------------------------------------------------- #
    entries.append(("part", "Part I · The reference architecture",
                    body.heading(1, "Part I — The reference architecture")))

    # -- Part I chapters ------------------------------------------------- #
    CH("Why OpenShell exists")
    body.p(
        "Agents are most useful with files, packages, APIs, credentials — and each "
        "of those is a channel for harm. OpenShell refuses the false choice between "
        "a useful agent and a safe one: keep the capability, check it at the kernel, "
        "and write the checks as versioned YAML the team can review."
    )
    body.table(
        ["Threat", "Without controls", "With OpenShell"],
        [["Data exfiltration", "Agent uploads sources or internal files to unauthorized endpoints.",
          "Network policies allow only approved destinations; all other outbound traffic is denied."],
         ["Credential theft", "Agent reads SSH keys or cloud credentials off disk.",
          "Filesystem restrictions (Landlock) confine access to declared paths only."],
         ["Unauthorized model use", "Agent sends prompts or data to unapproved providers.",
          "Provider profiles plus network rules restrict model traffic to approved endpoints."],
         ["Privilege escalation", "Agent attempts sudo, setuid paths, or dangerous syscalls.",
          "Unprivileged process identity plus seccomp blocks the escalation paths."]],
        caption="The documented threat table: each row names the attack and the exact control.",
    )
    body.p(
        "Four protection layers carry the posture — filesystem (locked at sandbox "
        "creation), network (hot-reloadable at runtime), process (locked at creation), "
        "and provider credentials (resolved only at authorized endpoints, rotated at "
        "runtime). The documented use cases run from secure coding agents through "
        "private enterprise development to compliance review and reusable environments."
    )
    deliberate(body, "arch-why")

    CH("Gateway, supervisor, sandbox")
    body.p(
        "Three actors, one rule: the gateway knows who everyone is, the supervisor "
        "decides what is allowed, and the sandbox watches what happens without ever "
        "deciding anything. Compromising the workload buys nothing — the sandbox holds "
        "no keys, no gateway token, and no provider credentials."
    )
    body.table(
        ["Component", "What it does"],
        [["Sandbox", "Owns the agent processes, knows which program made each request, applies process controls, forwards TCP and DNS to the supervisor."],
         ["Outer network fence", "Denies all workload egress except the protected channel to the supervisor; each runtime builds it with native tools."],
         ["Supervisor", "Checks requests against policy, supplies credentials, resolves DNS, opens approved connections; works with every runtime through one isolation backend."],
         ["Policies", "Declare what the agent can touch: files, processes, network destinations, API calls, provider credential scope."],
         ["Providers", "Connect a service name to a stored credential the supervisor hands out only where policy allows."],
         ["Policy prover", "Formally verifies network-rule changes in the gateway; ships as openshell-prover for CI."],
         ["Gateway", "Identity, policy and settings delivery, provider attachment, sandbox lifecycle, sessions and logs."],
         ["Compute runtime", "Provisions workload and supervisor, builds the boundary and the fence, reports status, cleans up."]],
        caption="Every component from the reference architecture, in one table.",
    )
    os_fig(body, "How a network request travels")
    body.p(
        "The compute driver proves the boundary and reports readiness; it never decides "
        "whether a request is allowed. That decision always belongs to the shared "
        "supervisor and policy engine, which is why the same policy behaves the same "
        "way on every runtime — while each runtime advertises its capabilities so the "
        "gateway knows what each deployment can and cannot do."
    )
    os_fig(body, "Control plane modules")
    os_fig(body, "Enforcement modules")
    deliberate(body, "arch-actors")

    CH("The mediated channel")
    body.p(
        "Supervisor and sandbox talk over the OpenShell Sandbox Protocol: one mutually "
        "authenticated HTTP/2 connection carrying independent streams for control, DNS "
        "and per-connection TCP, each with its own backpressure — so a slow download "
        "cannot wedge exec or process control. The driver picks the transport (Unix "
        "socket for Docker and Podman, TCP for Kubernetes, vsock for MicroVM) with "
        "identical authentication and behavior on all of them."
    )
    os_fig(body, "The mediated channel")
    body.table(
        ["Guarantee", "Sandbox provides", "Supervisor gets"],
        [["Process ownership", "Runs the agent as an owned child, keeps process and terminal state.",
          "Handles to wait on, attach to, signal, exec in, and stop."],
         ["Program identity", "Identifies the calling program from trusted /proc data.",
          "The real program behind each request, not a path the agent claims."],
         ["Network mediation", "Intercepts TCP opens and DNS queries with seccomp and hands them over.",
          "Requests that wait for a policy decision before going anywhere."],
         ["Fail closed", "Holds launch until the supervisor confirms; freezes the agent on disconnect.",
          "A short window to reconnect, or a stopped workload."]],
        caption="The four mediated-channel guarantees, and which side provides what.",
    )
    body.p(
        "Only the same supervisor process can resume a frozen workload; a new supervisor "
        "cannot take over a running sandbox even with valid credentials. The agent side "
        "holds nothing worth stealing: no gateway signing key, no gateway JWT, no "
        "provider credentials — only the gateway public key it needs to verify it is "
        "talking to the right supervisor."
    )
    os_fig(body, "Sandbox protocol session")
    deliberate(body, "arch-channel")

    CH("Four runtimes, one contract")
    body.p(
        "Every runtime follows the same contract but builds the boundary with the tools "
        "it already has. The runtime's job is to place the supervisor, connect it to "
        "the sandbox, fence off the network, and prove it — never to decide whether a "
        "request is allowed."
    )
    body.table(
        ["Runtime", "Where the supervisor runs", "Channel to the sandbox", "How direct egress is blocked"],
        [["Docker", "Its own container", "Authenticated Unix socket on a driver-owned volume", "Workload container networking off"],
         ["Podman", "Its own container", "Authenticated Unix socket on a driver-owned volume", "Workload container networking off"],
         ["Kubernetes", "Its own pod", "Private service with mutual TLS", "NetworkPolicy allows only the supervisor service"],
         ["MicroVM", "A process on the host", "Authenticated vsock", "Guest has no network device"]],
        caption="One contract, four dialects: the fence differs, the decision never moves.",
    )
    os_fig(body, "Four runtimes, one contract")
    body.p(
        "Match the workload to the fence you understand best, and put the highest-authority "
        "agents behind the strongest fence. Runtimes can differ in readiness reporting and "
        "features; each advertises its capabilities so the gateway — and the operator — "
        "knows what a given deployment can do."
    )
    deliberate(body, "arch-runtimes")

    CH("Authentication: generations and JWTs")
    body.p(
        "Three connections tie a sandbox together, and the gateway is the only component "
        "that signs credentials — every credential names exactly one sandbox. Restarting "
        "a sandbox starts a new generation with fresh tokens and fresh certificates, and "
        "the old ones stop working: rotation is a restart, not a project."
    )
    body.table(
        ["Connection", "Who connects", "How it is protected"],
        [["Supervisor to gateway", "Supervisor dials out.", "Gateway JWT, over TLS when enabled."],
         ["Supervisor to sandbox", "Supervisor dials in over the private channel.", "Mutual TLS plus a sandbox JWT."],
         ["Agent to supervisor", "Never directly; the sandbox relays.", "Covered by the supervisor-to-sandbox channel."]],
        caption="Three connections, two tokens, one rule: each token works on exactly one connection.",
    )
    os_fig(body, "Generations and JWTs")
    body.p(
        "The gateway JWT allows only supervisor RPCs — fetching policy, pushing logs, "
        "relaying sessions — never managing other sandboxes. The sandbox JWT is verified "
        "with the gateway public key the sandbox holds, so the sandbox can verify but "
        "never mint. Renewal happens in memory, both tokens together, and only while the "
        "sandbox exists: deleting the sandbox cuts off its supervisor. Shared "
        "deployments should set token TTLs; local single-user gateways may leave them "
        "unset so tokens last the run."
    )
    body.p(
        "Bootstrapping differs by runtime but verifies identically: Docker, Podman and "
        "MicroVM hand the supervisor its first tokens in files only it can read, while "
        "Kubernetes presents the pod ServiceAccount token for the gateway to verify "
        "against its own sandbox record before issuing anything."
    )
    os_fig(body, "Bootstrap, issue, renew, revoke")
    deliberate(body, "arch-auth")

    CH("Policy layers")
    body.p(
        "A sandbox policy is versioned YAML that denies everything it does not allow. "
        "Filesystem, landlock and process settings lock at creation or startup; network "
        "rules and middlewares stay live and hot-reloadable. What defines the shape of "
        "the world is fixed early; what describes conversations can evolve mid-run."
    )
    body.table(
        ["Section", "Controls", "Enforced by", "Takes effect"],
        [["filesystem_policy", "Paths sandbox processes can read, or read and write.", "Landlock LSM in the kernel.", "At sandbox startup."],
         ["landlock", "Whether the sandbox still starts, without filesystem rules, if OpenShell cannot apply them.", "Sandbox runtime.", "At sandbox startup."],
         ["process", "User and group sandbox processes run as.", "Docker and Podman, at creation.", "At sandbox creation."],
         ["network_policies", "Destinations each binary can reach, and the requests it can send.", "Sandbox network proxy.", "While running."],
         ["network_middlewares", "Extra inspection, transformation, or blocking of allowed traffic.", "Sandbox network proxy.", "While running."]],
        caption="The five policy sections: what each governs, who enforces it, and when it takes effect.",
    )
    os_fig(body, "Policy layers and timing")
    body.p(
        "Every sandbox runs under a policy even when none is supplied: global policy first, "
        "then the saved per-sandbox policy, then the image policy, then the restrictive "
        "default. An invalid image policy keeps the workload from starting rather than "
        "falling back. The selected policy is the base; attached providers contribute "
        "network rules on top, and the combination — the effective policy — is what the "
        "sandbox enforces. Start edits from the base, inspect the effective."
    )
    deliberate(body, "arch-policy")

    CH("The prover: verification before approval")
    body.p(
        "Before a policy change is approved, OpenShell formally verifies what the change "
        "would newly allow — new credentialed reach, new HTTP methods, access to cloud "
        "metadata endpoints — and findings block auto-approval for human review. Policy "
        "proposals from agents themselves therefore cannot self-authorize their own "
        "widening: the mechanical check holds the line until a human wakes."
    )
    os_fig(body, "The prover in CI")
    body.p(
        "The prover runs in the gateway and ships as the standalone openshell-prover "
        "command for checking a policy against a boundary in CI — boundaries tested "
        "like code, on every pull request that touches policy. Measure it like any "
        "control: flag precision, review latency, and the false-positive rate that "
        "determines whether findings still get read."
    )
    os_fig(body, "Agent-proposed rule under review")
    deliberate(body, "arch-prover")

    # -- Part II --------------------------------------------------------- #
    entries.append(("part", "Part II · OpenShell vs the six rogue archetypes",
                    body.heading(1, "Part II — OpenShell vs the six rogue archetypes")))
    body.p(
        "Each archetype below is read the same way: what the shape does, how many of "
        "the catalog scenarios wear it and on which roads, and which OpenShell primitive "
        "bounds it — plus what that primitive cannot see. Containment first, then the "
        "residual, honestly labeled."
    )
    body.table(
        ["Rogue shape", "Containing primitive"],
        [[label, prim] for _, label, _, prim in ARCHETYPES],
        caption="The six archetypes and the primitive that bounds each; every chapter below works one row.",
    )

    # -- Part II chapters ------------------------------------------------ #
    arch_keys = {"hijack": "arch-hijack", "exfil": "arch-exfil",
                 "abuse": "arch-abuse", "collude": "arch-collude",
                 "drift": "arch-drift", "sybil": "arch-spawn"}
    arch_figs = {"hijack": "Hijack held at the gate",
                 "exfil": "Exfiltration denied by default",
                 "abuse": "Abuse outside the grant",
                 "collude": "Collusion without a channel",
                 "drift": "Drift against the baseline",
                 "sybil": "Spawning denied by construction"}
    for aid, label, desc, primitive in ARCHETYPES:
        sids = sorted(arch_scen.get(aid, []))
        roads = Counter(SCEN_ROAD[s][0] for s in sids)
        road_txt = ", ".join(f"{n} {ROAD_LABEL[r].split(' — ')[0].lower()}" for r, n in sorted(roads.items()))
        CH(f"{label}: contained, not trusted")
        body.p(desc)
        body.p(
            f"{len(sids)} of the catalog's {n_scen} failure scenarios wear this shape "
            f"({road_txt}). " + ("Titles include: " + "; ".join(
                f"*{scen_by_id[s]['title']}*" for s in sids[:4]) + "." if sids else ""))
        body.p(f"Containing primitive: {primitive}")
        body.p(
            "Residual, honestly: the primitive bounds what the rogue can reach, not what "
            "it can want. Pair every containment below with the detector that watches the "
            "objective — deviation, misalignment, or pair bursts against baselines the "
            "monitored cannot move."
        )
        os_fig(body, arch_figs[aid])
        deliberate(body, arch_keys[aid])

    # -- Part III -------------------------------------------------------- #
    entries.append(("part", "Part III · Operating swarms on OpenShell",
                    body.heading(1, "Part III — Operating swarms on OpenShell")))
    CH("Generations: rotation as a security primitive")
    body.p(
        "Every restart mints fresh tokens and certificates and kills the old ones, so "
        "rotation is an operation already performed rather than a project postponed. "
        "Long-lived compromise, cached context, accumulated permission drift and poisoned "
        "retrieved entries all die on a schedule set by the operator, not by suspicion."
    )
    body.p(
        "Renewal works only while the sandbox exists, which ties credential lifetime to "
        "workload lifetime by construction — and deleting a workload is total revocation. "
        "Tune the cadence against detector persistence windows: rotate so fast that "
        "scores never accumulate and slow shapes hide inside the churn."
    )
    os_fig(body, "Sandbox lifecycle and generations")
    deliberate(body, "ops-generations")

    CH("Egress deny-by-default at fleet scale")
    body.p(
        "At fleet scale the destination inventory is the security posture in readable "
        "form: enumerate allowed destinations per binary per sandbox and the outward "
        "reach of the whole fleet is on one page. New destinations are the change worth "
        "human review, and the prover flags credentialed reach automatically."
    )
    body.p(
        "Test the fence independently of the rules: with workload networking off or fenced "
        "to the supervisor service, an empty policy should yield silence. Publish the "
        "inventory where the team that owns the risk can read it, expire unreviewed "
        "destinations on a cadence, and never let the list grow without owners."
    )
    deliberate(body, "ops-egress")

    CH("Credentials the agent never sees")
    body.p(
        "The supervisor resolves opaque placeholders only at policy-authorized endpoints, "
        "so agents handle references while the trusted side handles values. Attachments, "
        "rotation and revocation update at runtime; new environment variables require a "
        "new process, so running code never silently gains scope."
    )
    body.p(
        "Audit the effective policy per sandbox — base plus provider contributions — and "
        "attribute every line. Debug the supervisor decision, never the secret: verify "
        "that no debug path can print a resolved provider credential, because there is "
        "nothing agent-side to print."
    )
    os_fig(body, "Credential resolution without possession")
    deliberate(body, "ops-credentials")

    CH("Fail closed: freezes, windows, and the halt")
    body.p(
        "Launch waits for supervisor confirmation and disconnect freezes the agent, so no "
        "agent ever runs before its controls are confirmed or unobserved after they "
        "vanish. Only the same supervisor process can resume a frozen workload — "
        "continuity is unforgeable, and takeover by credential theft fails by design."
    )
    body.p(
        "The halt is the fleet-scale counterpart: pause everything when doubt is "
        "fleet-wide, then attribute at leisure. Confirm the halt path needs no healthy "
        "supervisor to work, and rehearse supervisor-kill drills on a schedule — the "
        "control you never test is decoration."
    )
    deliberate(body, "ops-failclosed")

    CH("The quarantine workflow on OpenShell")
    body.p(
        "Isolate is freezing or deleting the sandbox; revoke is token death by deletion; "
        "evidence is the supervisor and gateway logs; memory quarantine is generation "
        "retirement; handoff is the owned case with deadlines; remediation is a fresh "
        "generation from a clean image with policy re-review. Every step of the incident "
        "workflow has a runtime home."
    )
    os_fig(body, "The quarantine workflow on OpenShell")
    body.p(
        "Order matters: capture evidence before retiring the generation, because deletion "
        "destroys the crime scene along with the compromise, and the snapshot must fire "
        "automatically rather than heroically. Automate the first three steps so machines "
        "contain in seconds while humans decide in hours; only release waits for a named "
        "human with a scrub proof."
    )
    os_fig(body, "Incident on the clock")
    deliberate(body, "ops-quarantine")

    # -- Part IV --------------------------------------------------------- #
    entries.append(("part", "Part IV · Domain playbooks: all 26 domains",
                    body.heading(1, "Part IV — Domain playbooks: all 26 domains")))
    body.p(
        "One chapter per catalog domain, same shape every time: what is at stake, the "
        "catalog scenarios that rehearse it, an illustrative sandbox policy sketch, and "
        "the council reading. Sketches use the real policy section names and show shape "
        "only — adapt, review, prove, then deploy."
    )
    os_fig(body, "Canonical domain request path")
    for dom in DOMAIN_ORDER:
        pb = DOMAIN_PLAYBOOKS[dom]
        sids = sorted(s["id"] for s in cat["scenarios"] if s["domain"] == dom)
        titles = "; ".join(f"*{scen_by_id[s]['title']}*" for s in sids)
        counts = cov[dom]
        CH(f"Domain playbook: {dom}")
        body.p(f"At stake: {pb['stakes']}")
        body.p(f"{pb['story']} Catalog rehearsal: {titles} "
               f"({len(sids)} of the domain's scenarios).")
        codeblock(body, "yaml", pb["yaml"],
                  caption=f"Illustrative {dom} sandbox policy sketch — adapt before use.")
        body.p(
            f"Catalog weight behind this chapter: {_np(len(counts['patterns']), 'pattern')}, "
            f"{_np(len(sids), 'scenario')}, {_np(len(counts['cascades_all']), 'cascade')} "
            f"(inherent {len(counts['cascades_inherent'])}, emergent {len(counts['cascades_emergent'])}, "
            f"derived {len(counts['cascades_derived'])}, cascading {len(counts['cascades_cascading'])})."
        )
        deliberate(body, f"domain-{dom}")

    # -- Part V ---------------------------------------------------------- #
    entries.append(("part", "Part V · Policy as code",
                    body.heading(1, "Part V — Policy as code")))
    CH("Anatomy of a sandbox policy")
    body.p(
        "A worked example for a coding agent — Codex, Claude Code, or OpenCode class tooling "
        "with constrained file and network access. Read it section by section: version pins "
        "the schema; filesystem_policy names Landlock paths; process fixes the unprivileged "
        "identity; network_policies name per-binary destinations with method limits."
    )
    codeblock(body, "yaml",
              "version: 1\n"
              "filesystem_policy:\n"
              '  read: ["/repo", "/home/agent/.cache"]\n'
              '  write: ["/repo/scratch"]\n'
              'process: {user: "agent", capabilities: []}\n'
              "network_policies:\n"
              '  - binaries: ["git", "codex"]\n'
              '    destinations: ["git.internal:443", "registry.internal:443"]\n'
              '    methods: ["GET", "POST"]\n'
              "network_middlewares:\n"
              '  - inspect: ["registry.internal:443"]',
              caption="Illustrative coding-agent policy — the shape to copy, not the values.")
    body.p(
        "Start from the restrictive default and add named needs; every line should name a "
        "need, and the three broadest lines of any policy deserve a written justification. "
        "The landlock section deserves paranoia about fallback behavior — know what happens "
        "if the rules cannot apply."
    )
    os_fig(body, "Policy schema as UML")
    deliberate(body, "pol-anatomy")

    CH("Locked at creation vs hot-reload")
    body.p(
        "Filesystem, landlock strictness and process identity lock at creation or startup "
        "because changing the world mid-run would invalidate every assumption the launch "
        "confirmation established. Network rules and middlewares reload live because "
        "conversations legitimately evolve. Sort every line of a policy by timing and "
        "defend each placement — mutability scheduled in advance is still attack surface."
    )
    body.p(
        "Rehearse both transitions: lock a filesystem rule and confirm a mid-run change "
        "refuses; update a network rule and confirm hot application. Trust the timing "
        "table only after testing it, and re-test on every runtime you deploy."
    )
    deliberate(body, "pol-locked")

    CH("Provider profiles and least privilege")
    body.p(
        "Providers connect a service name to a stored credential, and attachment contributes "
        "exactly the network rules that provider needs — visible in the effective policy, "
        "never copied into base config where it rots. Bind every key to its endpoints; "
        "shared model keys mounted everywhere are ambient authority wearing a new name."
    )
    body.p(
        "Watch the two sharp edges: global policy mode suppresses provider rules, so know "
        "which mode you are in; and new environment variables require a new process, so "
        "credential rotation never leaks into running code silently. Attribute every "
        "effective-policy line to base or provider before signing off."
    )
    deliberate(body, "pol-providers")

    CH("The prover in CI")
    body.p(
        "The standalone openshell-prover command brings boundary checking to the pipeline "
        "that ships policies: every pull request touching network rules is verified against "
        "the declared boundary, with new credentialed reach, new methods, or metadata access "
        "flagged before merge. Findings must block; blocks are overridden only by named "
        "humans with recorded reasons."
    )
    body.p(
        "Log every finding to its disposition and tune from the log — a verifier nobody "
        "trusts gets bypassed, and one that cries wolf gets ignored. The chain is the "
        "control: prover in CI, supervisor at runtime, freeze on disconnect."
    )
    os_fig(body, "Proposal lifecycle")
    deliberate(body, "pol-ci")

    # -- Part VI --------------------------------------------------------- #
    entries.append(("part", "Part VI · Measured notes and honest caveats",
                    body.heading(1, "Part VI — Measured notes and honest caveats")))
    CH("What was rehearsed locally")
    body.p(
        f"Measured, from the shipped catalog at build time: {n_pat} patterns, {n_scen} "
        f"scenarios, {len(cov)} domains, and per-domain, per-archetype counts printed in "
        f"every chapter. Rehearsal runs on mock and open data with local open-weight "
        "models — the right substrate for exercising policy paths without risking real "
        "records or sending anything anywhere."
    )
    body.p(
        "Scope honesty: local rehearsal validates shapes and paths, never performance or "
        "scale. Sketches show configuration shape; they are labeled illustrative throughout "
        "and must be reviewed, prover-checked and drilled before anything resembling "
        "deployment."
    )
    deliberate(body, "notes-rehearsed")

    CH("What OpenShell does not solve")
    body.p(
        "The central limit, stated plainly: OpenShell governs what the agent can touch, "
        "not what the agent wants. Drift pursued entirely within policy is invisible to "
        "every fence; injection and poisoned context arrive inside allowed traffic; "
        "collusion over allowed relays needs pair-level judgment no fence provides. "
        "Containment bounds the damage while other instruments — goal comparison, prompt "
        "defenses, pair review — do the judging."
    )
    body.p(
        "And the operator gap: revocation, handoff, remediation and release need staffed "
        "humans on real clocks, and no runtime primitive supplies staffing. The last mile "
        "is people, drills and evidence — budget for it or inherit it as incident debt."
    )
    deliberate(body, "notes-limits")

    CH("From one sandbox to AI-factory scale")
    body.p(
        "The reference architecture pairs the sandboxed runtime with inference and compute "
        "platforms up through AI-factory scale: the same gateway-supervisor-sandbox contract "
        "and policy model, carried by container runtimes up through Kubernetes, with the "
        "fence rebuilt per tier from native tools. The contract scales; the tools change."
    )
    os_fig(body, "From one sandbox to fleets")
    body.p(
        "Scale the evidence pipeline before the tenth sandbox, aggregate per-sandbox "
        "attribution into fleet posture without losing it, and attach a named owner to "
        "every new authority before granting it. Sandbox by sandbox, policy by policy — "
        "never big-bang."
    )
    deliberate(body, "notes-scale")

    # -- back matter ----------------------------------------------------- #
    CH("Conclusion: capability without ambient authority")
    body.p(
        "Every agent runs sandboxed, every action crosses policy, every credential stays "
        "supervisor-side, and every generation ends on schedule. That is the whole program, "
        "and it holds even when every detector misses — which is exactly the property you "
        "want when the adversary reads your playbook."
    )
    deliberate(body, "conclusion")
    entries.append(("back", "Sources and provenance", body.heading(1, "Sources and provenance")))
    body.p(
        "Catalog: data/patterns.json, data/scenarios.json, data/cascades.json, "
        "data/traces.json, data/coverage.json — counts in this book are read from these "
        "files at build time. Architecture: NVIDIA OpenShell documentation (v0.1.5), "
        "including the system-architecture, sandbox-protocol, authentication and policy "
        "references. Generated by tools/build_openshell_book.py with council prose from "
        "tools/openshell_book_prose.py and playbooks from tools/openshell_book_data.py; "
        "typeset with tools/render_pdf.mjs and the vendored Mermaid engine."
    )

    # -- contents + emit (same shape as the rogue book) ----------------- #
    def toc_line(label, target):
        doc.raw_html(
            f'<li><a href="#{target}"><span class="t">{esc(label)}</span>'
            f'<span class="dots"></span>'
            f'<span class="pg" data-pg="{target}">000</span></a></li>'
        )

    doc = Doc()
    doc.title_page(BOOK_TITLE, SUBTITLE, AUTHOR, EDITION)
    doc.p(
        "A supplement to *Agentic Design Patterns & Guardrails*: NVIDIA's OpenShell "
        "Reference Architecture as the containment layer for rogue agents and the "
        f"operating ground for agent swarms — with a domain playbook for all {len(cov)} "
        "catalog domains and a council deliberation in every chapter. Generated from "
        "the catalog; nothing in it is hand-typed from memory."
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
    cur = None
    for kind, label, target in entries:
        if kind == "part":
            cur = label
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
    print(f"book: {len(entries)} headings ({n_ch} chapters), {md.count('```mermaid')} diagrams, "
          f"{len(cov)} domain playbooks")


if __name__ == "__main__":
    main()

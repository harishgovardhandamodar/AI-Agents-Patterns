/* Boot check: every expected entry point must exist, otherwise offer a
   cache-busting reload instead of a silent dead tab.
   This lives in its own file (not inline in index.html) so the
   Content-Security-Policy needs no 'unsafe-inline' for scripts — and, as
   before, it depends on nothing but window, so it still runs when any of
   the app modules is stale, blocked or 404ing. */
"use strict";
window.addEventListener("load", function () {
  setTimeout(function () {
    try {
      var need = [["initDiscovery", "Discovery Lab"], ["initLanding", "Overview landing"], ["initCopilot", "Fox - Architect"], ["renderGuardReport", "Guardrail Lab"], ["initRogue", "Rogue Agents"], ["initSelflearn", "Self-Learning"]];
      var missing = need.filter(function (x) { return typeof window[x[0]] !== "function"; });
      if (!missing.length) return;
      var b = document.getElementById("freshBanner");
      if (!b) {
        b = document.createElement("div");
        b.id = "freshBanner";
        document.body.appendChild(b);
      }
      b.innerHTML = "<b>App files mismatched.</b><span>These modules did not load: " + missing.map(function (x) { return x[1]; }).join(", ") + ". The tab will look broken. </span>";
      var btn = document.createElement("button");
      btn.className = "btn sm primary";
      btn.textContent = "Reload fresh copy";
      btn.addEventListener("click", function () { location.href = location.pathname + "?v=" + Date.now() + location.hash; });
      b.appendChild(btn);
    } catch (e) { /* never break boot for the checker itself */ }
  }, 2500);
});

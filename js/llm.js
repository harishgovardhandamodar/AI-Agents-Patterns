/* llm.js — client for the local reasoning model (Qwen 3.8-27B via Fox-Services).
   Talks only to serve.py's /api/llm/* proxy (single origin, no CORS, backend
   URLs hidden). Exposes health state, a model list, and a streaming chat call.

   Exports a single global `LLM`. */

"use strict";

const LLM = (function () {
  const state = {
    probed: false,
    probing: false,
    ready: false,
    active: null,        // name of the backend currently answering ("fox-services")
    backends: [],        // [{name,url,online,models,latency_ms,error}]
    defaultModel: "quai-qwen3.8-27b:latest",
    models: [],
    lastError: null,
    lastModel: null      // model that actually served the last request
  };

  /* Ask serve.py which backends are alive. Cheap and safe to call often. */
  async function probe(force) {
    if (state.probing) return state;
    if (state.probed && !force) return state;
    state.probing = true;
    try {
      const r = await fetch("api/llm/health", { cache: "no-store" });
      const j = await r.json();
      state.ready = !!j.ready;
      state.active = j.active || null;
      state.backends = j.backends || [];
      if (j.default_model) state.defaultModel = j.default_model;
      state.lastError = null;
    } catch (e) {
      state.ready = false;
      state.active = null;
      state.lastError = String(e && e.message || e);
    } finally {
      state.probing = false;
      state.probed = true;
    }
    return state;
  }

  /* Model list from whichever backend is active. */
  async function models() {
    try {
      const r = await fetch("api/llm/models", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      state.models = j.models || [];
      if (j.default_model) state.defaultModel = j.default_model;
      if (j.online === false && state.probed) { /* health is the source of truth */ }
    } catch (e) {
      state.models = [];
    }
    return state.models;
  }

  /* Watchdog values. A backend can answer /health instantly (Fox-Services is
     "online") while the model behind it never produces a token — without a
     bound the UI would spin for the full 600s read timeout. Loaded once from
     serve.py so ops can tune via LLM_FIRST_TOKEN_TIMEOUT / LLM_STALL_TIMEOUT. */
  const wd = { firstToken: 60000, stall: 45000, loaded: false };
  let cfgPromise = null;

  function config() {
    if (!cfgPromise) {
      cfgPromise = fetch("api/llm/config", { cache: "no-store" })
        .then(r => r.json())
        .then(j => {
          if (j && j.first_token_timeout) wd.firstToken = j.first_token_timeout * 1000;
          if (j && j.stall_timeout) wd.stall = j.stall_timeout * 1000;
          if (j && j.default_model) state.defaultModel = j.default_model;
          wd.loaded = true;
        })
        .catch(() => { wd.loaded = true; });
    }
    return cfgPromise;
  }

  function timeoutErr(msg) {
    const e = new Error(msg);
    e.name = "TimeoutError";
    return e;
  }

  /* Streaming chat. Calls onDelta(textChunk) as tokens arrive and
     onMeta({backend,model}) once the served model is known.
     Returns the full concatenated text. Abortable via opts.signal.
     Throws TimeoutError when the backend goes silent past the watchdog
     before any token arrives (the caller then falls back offline). */
  async function chat(opts) {
    await config();
    const messages = opts.messages || [];
    const body = {
      model: opts.model || state.defaultModel,
      messages: messages,
      stream: true,
      temperature: opts.temperature == null ? 0.3 : opts.temperature
    };
    if (opts.max_tokens) body.max_tokens = opts.max_tokens;

    const firstMs = opts.firstTokenTimeout || wd.firstToken;
    const stallMs = opts.stallTimeout || wd.stall;

    /* Own controller so a watchdog abort is distinguishable from the caller
       cancelling (opts.signal) — the two must not look alike to the caller. */
    const ctrl = new AbortController();
    let callerAborted = false;
    if (opts.signal) {
      if (opts.signal.aborted) callerAborted = true;
      else opts.signal.addEventListener("abort", () => { callerAborted = true; ctrl.abort(); }, { once: true });
    }
    let timedOut = false;
    let timer = null;
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms); };
    const disarm = () => { clearTimeout(timer); timer = null; };

    let res;
    arm(firstMs);
    try {
      res = await fetch("api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      disarm();
      if (timedOut) {
        state.ready = false;
        state.lastError = "no response headers after " + Math.round(firstMs / 1000) + "s";
        throw timeoutErr("LLM timed out — " + state.lastError);
      }
      if (e && e.name === "AbortError") throw e;
      state.ready = false;
      state.lastError = String(e && e.message || e);
      throw new Error("LLM unreachable: " + state.lastError);
    }
    disarm();

    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.error || ""; } catch (e) {}
      state.ready = false;
      state.lastError = "HTTP " + res.status + (detail ? " — " + detail : "");
      throw new Error(state.lastError);
    }

    const backend = res.headers.get("X-Fox-Backend") || state.active || "llm";
    const ct = res.headers.get("Content-Type") || "";
    let full = "";
    let metaSent = false;

    if (ct.indexOf("text/event-stream") === -1) {
      // JSON path: either a real non-streaming completion, or our own
      // {ok:false,error} when no backend is reachable.
      let j;
      arm(firstMs);
      try { j = await res.json(); } catch (e) {
        if (timedOut) { state.ready = false; state.lastError = "body stalled"; throw timeoutErr("LLM timed out — no JSON body"); }
        throw e;
      } finally { disarm(); }
      if (j && j.ok === false) {
        state.ready = false;
        state.lastError = j.error || "no LLM backend";
        throw new Error(state.lastError);
      }
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      full = (msg && msg.content) || "";
      state.lastModel = j.model || null;
      if (opts.onMeta) opts.onMeta({ backend: backend, model: state.lastModel });
      if (opts.onDelta && full) opts.onDelta(full);
      return full;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawData = false;   // any body byte at all — proves the backend is alive
    try {
      for (;;) {
        /* First window waits for the first byte, then each window is bounded
           by the stall timeout: a wedged model must not hang the UI. */
        arm(sawData ? stallMs : firstMs);
        let chunk, done;
        try {
          const r = await reader.read();
          done = r.done; chunk = r.value;
        } catch (e) {
          if (timedOut) {
            if (full.trim()) return full;   // stalled after a partial answer: ship it
            state.ready = false;
            state.lastError = "backend silent for " + Math.round(firstMs / 1000) + "s with no tokens";
            throw timeoutErr("LLM timed out — " + state.lastError);
          }
          if (e && e.name === "AbortError") throw e;
          throw e;
        } finally {
          disarm();
        }
        if (done) break;
        if (!chunk || !chunk.length) continue;
        if (!sawData) { sawData = true; state.ready = true; }
        buf += dec.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let j;
            try { j = JSON.parse(data); } catch (e) { continue; }
            if (j.model) state.lastModel = j.model;
            if (!metaSent && (j.model || backend)) {
              metaSent = true;
              if (opts.onMeta) opts.onMeta({ backend: backend, model: j.model || state.lastModel });
            }
            const d = j.choices && j.choices[0] && j.choices[0].delta;
            if (d && d.content) { full += d.content; if (opts.onDelta) opts.onDelta(d.content); }
          }
        }
      }
      if (!sawData) {
        state.ready = false;
        state.lastError = "backend returned an empty response";
        throw new Error(state.lastError);
      }
    } finally {
      disarm();
    }
    return full;
  }

  function available() { return !!state.ready; }

  function label() {
    if (!state.probed) return "checking…";
    if (!state.ready) return "offline · local fallback";
    const b = state.backends.find(x => x.online);
    const name = b ? b.name : state.active;
    const served = state.lastModel && state.lastModel !== state.defaultModel
      ? " · served " + state.lastModel : "";
    return "online · " + name + served;
  }

  return { state, probe, models, chat, available, label };
})();

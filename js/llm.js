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

  /* Streaming chat. Calls onDelta(textChunk) as tokens arrive and
     onMeta({backend,model}) once the served model is known.
     Returns the full concatenated text. Abortable via opts.signal. */
  async function chat(opts) {
    const messages = opts.messages || [];
    const body = {
      model: opts.model || state.defaultModel,
      messages: messages,
      stream: true,
      temperature: opts.temperature == null ? 0.3 : opts.temperature
    };
    if (opts.max_tokens) body.max_tokens = opts.max_tokens;

    let res;
    try {
      res = await fetch("api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      state.ready = false;
      state.lastError = String(e && e.message || e);
      throw new Error("LLM unreachable: " + state.lastError);
    }

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
      const j = await res.json();
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
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
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

/**
 * managed-agents.js — zero-dependency browser/Node (18+) wrapper for Google's
 * Gemini managed agents (Antigravity agent + Interactions / Agents /
 * Environments / Triggers / Credentials / Webhooks REST APIs).
 *
 * Mirrors managed_agents.py (same concepts, camelCase methods; request JSON stays snake_case).
 *
 *   import { ManagedAgents, agentsMd, skill, network, allow } from "./managed-agents.js";
 *
 *   const ma = new ManagedAgents({ apiKey });           // or { baseUrl: "/api/gemini" } via your proxy
 *   const r = await ma.run("Plot sin(x) to /workspace/out/sin.png", {
 *     onEvent: (ev) => { if (ev.delta?.type === "text") out.textContent += ev.delta.text; },
 *   });
 *   const blob = await ma.files.read(r.environmentId, "workspace/out/sin.png");
 *
 * SECURITY: an API key in browser code is visible to anyone who loads the page.
 * Fine for local tools; for anything deployed, point `baseUrl` at a proxy that
 * adds the `x-goog-api-key` header server-side and leave `apiKey` empty.
 */

export const BASE_AGENT = "antigravity-preview-09-2026";
export const VERTEX_BASE_AGENT = "antigravity-preview-09-2026";
export const CANDIDATE_BASE_AGENTS = [
  "antigravity-preview-09-2026",
];
export const DEFAULT_MODEL = "gemini-4-argon";
export const CANDIDATE_MODELS = [
  "gemini-4-argon",
  "gemini-3.8-flash",
];
export const API_REVISION = "2026-05-20";
const TERMINAL = new Set(["completed", "failed", "cancelled", "incomplete", "budget_exceeded", "requires_action"]);

function raceSignal(promise, signal, onAbort) {
  if (!signal) return promise;
  if (signal.aborted) {
    try { onAbort?.(); } catch { /* ignore */ }
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  let onAbortHandler;
  const abortPromise = new Promise((_, reject) => {
    onAbortHandler = () => {
      try { onAbort?.(); } catch { /* ignore */ }
      reject(signal.reason ?? new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbortHandler, { once: true });
  });
  return Promise.race([promise, abortPromise]).finally(() => {
    if (onAbortHandler) signal.removeEventListener("abort", onAbortHandler);
  });
}

export class ManagedAgentsError extends Error {
  constructor(status, body, method, url) {
    const msg = body && typeof body === "object" ? body.error?.message ?? JSON.stringify(body) : body;
    super(`${method} ${url} -> ${status}: ${msg}`);
    this.status = status;
    this.body = body;
  }
}

// ------------------------------------------------------------------------- //
// Builders: tools, sources, network, skills, hooks, inputs
// ------------------------------------------------------------------------- //

export const codeExecution = () => ({ type: "code_execution" });
export const googleSearch = () => ({ type: "google_search" });
export const urlContext = () => ({ type: "url_context" });
export const DEFAULT_TOOLS = [codeExecution(), googleSearch(), urlContext()];

/** Remote MCP server (Streamable HTTP). name must match ^[a-z0-9_-]+$. */
export function mcpServer(name, url, { headers, allowedTools, credential } = {}) {
  const t = { type: "mcp_server", name, url };
  if (headers) t.headers = headers;
  if (allowedTools) t.allowed_tools = allowedTools;
  if (credential) t.credential = credential;
  return t;
}

/** Function declaration. `parameters` is a JSON Schema object. */
export function functionTool(name, description = "", parameters = { type: "object", properties: {} }) {
  return { type: "function", name, description, parameters };
}

/** Inline file source (1 MB/file, 2 MB total). Uint8Array/ArrayBuffer is sent base64. */
export function inline(target, content) {
  if (typeof content === "string") return { type: "inline", target, content };
  return { type: "inline", target, content: toBase64(content), encoding: "base64" };
}
export const repo = (url, target) => ({ type: "repository", source: url, target });
export const gcs = (uri, target) => ({ type: "gcs", source: uri, target });
export const skillRegistry = (resource, target = "/.agent/skills") => ({ type: "skill_registry", source: resource, target });
/** Long-form standing instructions at .agents/AGENTS.md */
export const agentsMd = (text) => inline(".agents/AGENTS.md", text);

/** A skill as sources: .agents/skills/<name>/SKILL.md (+ helper files {relPath: content}). */
export function skill(name, description, body, files = {}) {
  const out = [inline(`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\n---\n${body}`)];
  for (const [rel, content] of Object.entries(files)) out.push(inline(`.agents/skills/${name}/${rel}`, content));
  return out;
}

/** Browser: turn an <input type=file webkitdirectory> FileList into inline sources under .agents/. */
export async function sourcesFromFiles(fileList, targetRoot = ".agents") {
  const out = [];
  for (const f of fileList) {
    const rel = (f.webkitRelativePath || f.name).split("/").slice(f.webkitRelativePath ? 1 : 0).join("/");
    const bytes = new Uint8Array(await f.arrayBuffer());
    let text = null;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* binary */ }
    out.push(inline(`${targetRoot}/${rel}`, text ?? bytes));
  }
  return out;
}

/** One hooks.json group. event: "pre_tool_execution" | "post_tool_execution"; matcher: RE2 regex on tool name. */
export function hook(event, matcher, { command, url, timeout = 10, group = "hooks", enabled = true } = {}) {
  const h = command ? { type: "command", command } : { type: "http", url };
  h.timeout = timeout;
  return { [group]: { enabled, [event]: [{ matcher, hooks: [h] }] } };
}

/** .agents/hooks.json (+ scripts in .agents/hooks-scripts/) as sources. */
export function hooks(groups, scripts = {}) {
  const merged = Object.assign({}, ...[].concat(groups));
  const out = [inline(".agents/hooks.json", JSON.stringify(merged, null, 2))];
  for (const [name, src] of Object.entries(scripts)) out.push(inline(`.agents/hooks-scripts/${name}`, src));
  return out;
}

/** Network allowlist rule. Wildcards like "*.googleapis.com" or "*". headers = injected headers. */
export function allow(domain, { credential, headers } = {}) {
  const r = { domain };
  if (credential) r.credential = credential;
  if (headers) r.transform = headers;
  return r;
}

/** network() -> "disabled"; network("pypi.org", allow("api.github.com", {credential: "gh"})) */
export function network(...rules) {
  if (!rules.length) return "disabled";
  return { allowlist: rules.map((r) => (typeof r === "string" ? allow(r) : r)) };
}

/** Environment config. env values: string or {credential: id}. environmentId reconfigures an existing sandbox. */
export function environment({ sources, network: net, env, environmentId } = {}) {
  const e = { type: "remote" };
  if (sources?.length) e.sources = sources.flat();
  if (net !== undefined && net !== null) e.network = net;
  if (env) e.env = env;
  if (environmentId) e.environment_id = environmentId;
  return e;
}

export const text = (t) => ({ type: "text", text: t });

/** Image input part from a File/Blob, ArrayBuffer/Uint8Array, or a data: URL. */
export async function image(src, mimeType) {
  if (typeof src === "string" && src.startsWith("data:")) {
    const [head, data] = src.split(",");
    return { type: "image", data, mime_type: mimeType || head.slice(5).split(";")[0] };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    return { type: "image", data: toBase64(new Uint8Array(await src.arrayBuffer())), mime_type: mimeType || src.type || "image/png" };
  }
  return { type: "image", data: toBase64(src), mime_type: mimeType || "image/png" };
}

/** Grab the current frame of a <video> or <canvas> (camera / screen share) as an image part. */
export async function frame(el, { mimeType = "image/jpeg", quality = 0.8, maxWidth = 1280 } = {}) {
  const w = el.videoWidth || el.width, h = el.videoHeight || el.height;
  const scale = Math.min(1, maxWidth / w);
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
  return image(c.toDataURL(mimeType, quality), mimeType);
}

// ------------------------------------------------------------------------- //
// Result
// ------------------------------------------------------------------------- //

export class Result {
  constructor(raw, history = []) { this.raw = raw; this.history = history; }
  get id() { return this.raw.id; }
  get status() { return this.raw.status; }
  get ok() { return this.raw.status === "completed"; }
  get environmentId() {
    return this.raw.environment_id ?? (typeof this.raw.environment === "string" ? this.raw.environment : undefined);
  }
  get steps() { return this.raw.steps ?? []; }
  get usage() { return this.raw.usage ?? {}; }
  get totalTokens() { return Number(this.usage.total_tokens ?? 0); }

  /** Text of the final answer (model_output after the last input). */
  get text() {
    let chunks = [];
    for (const st of this.steps) {
      if (st.type === "user_input" || st.type === "function_result") chunks = [];
      else if (st.type === "model_output") for (const c of st.content ?? []) if (c.type === "text") chunks.push(c.text ?? "");
    }
    return chunks.join("");
  }

  /** Images in model output as {data (base64), mime_type}. */
  get images() {
    return this.steps.filter((s) => s.type === "model_output")
      .flatMap((s) => (s.content ?? []).filter((c) => c.type === "image" && c.data));
  }

  /** Custom function calls waiting on you (auto-executed filesystem calls are skipped). */
  get pendingCalls() {
    const done = new Set(this.steps.filter((s) => s.type === "function_result").map((s) => s.call_id));
    return this.steps.filter((s) => s.type === "function_call" && !done.has(s.id));
  }
}

// ------------------------------------------------------------------------- //
// Client
// ------------------------------------------------------------------------- //

export class ManagedAgents {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]       Gemini API key (avoid shipping in public pages).
   * @param {string} [opts.baseUrl]      Host or proxy, default https://generativelanguage.googleapis.com
   * @param {string} [opts.accessToken]  OAuth token (Agent Platform / Vertex) or a function returning one.
   * @param {boolean} [opts.vertex]      Agent Platform mode; needs project + accessToken.
   * @param {string} [opts.project]
   * @param {string} [opts.location]     default "global"
   * @param {string} [opts.agent]        default agent id
   * @param {string|null} [opts.apiRevision]  Off by default in browsers: the API's CORS preflight rejects this header.
   * @param {object} [opts.headers]      extra headers on every call
   * @param {typeof fetch} [opts.fetch]  custom fetch (tests, proxies)
   */
  constructor({ apiKey, baseUrl, accessToken, vertex = false, project, location = "global", agent,
    apiRevision = typeof window === "undefined" ? API_REVISION : null, headers = {}, fetch: f } = {}) {
    this.vertex = vertex;
    this.defaultAgent = agent || (vertex ? VERTEX_BASE_AGENT : BASE_AGENT);
    const host = (baseUrl || (vertex ? "https://aiplatform.googleapis.com" : "https://generativelanguage.googleapis.com")).replace(/\/$/, "");
    if (vertex) {
      if (!project) throw new Error("vertex mode needs project");
      this._base = `${host}/v1beta1/projects/${project}/locations/${location}`;
      this._uploadBase = `${host}/upload/v1beta1/projects/${project}/locations/${location}`;
    } else {
      this._base = `${host}/v1beta`;
      this._uploadBase = `${host}/upload/v1beta`;
    }
    this._apiKey = apiKey;
    this._token = accessToken;
    this._headers = { ...(apiRevision ? { "Api-Revision": apiRevision } : {}), ...headers };
    this._fetch = f || globalThis.fetch.bind(globalThis);

    this.interactions = new Interactions(this);
    this.agents = new Agents(this);
    this.environments = new Environments(this);
    this.files = new Files(this);
    this.triggers = new Triggers(this);
    this.credentials = new Credentials(this);
    this.webhooks = new Webhooks(this);
  }

  async _authHeaders() {
    const h = { ...this._headers };
    if (this._base.startsWith("https://generativelanguage.googleapis.com")) {
      delete h["x-admin-token"];
      delete h["x-selftest"];
      delete h["x-guardrail-probe"];
    }
    if (this._apiKey) h["x-goog-api-key"] = this._apiKey;
    if (this._token) h.Authorization = `Bearer ${typeof this._token === "function" ? await this._token() : this._token}`;
    return h;
  }

  _url(path, params, upload = false) {
    const fallbackOrigin = typeof process !== "undefined" && process.env?.PORT ? `http://127.0.0.1:${process.env.PORT}` : "http://127.0.0.1:8787";
    const u = new URL((upload ? this._uploadBase : this._base) + path, globalThis.location?.href || fallbackOrigin);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    return u.toString();
  }

  /**
   * Raw escape hatch: await ma.request("GET", "/agents").
   * opts: {json, params, upload, body, headers, raw, signal}
   */
  async request(method, path, { json, params, upload = false, body, headers, raw = false, signal } = {}) {
    let payloadJson = json;
    const isDirectUpstream = this._base.startsWith("https://generativelanguage.googleapis.com");
    if (
      isDirectUpstream &&
      method === "POST" &&
      path === "/interactions" &&
      payloadJson &&
      typeof payloadJson === "object" &&
      payloadJson.agent &&
      payloadJson.agent !== BASE_AGENT &&
      !CANDIDATE_BASE_AGENTS.includes(payloadJson.agent) &&
      payloadJson.agent_config
    ) {
      payloadJson = { ...payloadJson };
      delete payloadJson.agent_config;
    }

    const url = this._url(path, params, upload);
    const h = { ...(await this._authHeaders()), ...(headers || {}) };
    if (isDirectUpstream) {
      delete h["x-admin-token"];
      delete h["x-selftest"];
      delete h["x-guardrail-probe"];
    }
    if (payloadJson !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(payloadJson); }
    const r = await raceSignal(this._fetch(url, { method, headers: h, body, signal }), signal);
    if (!r.ok && r.status !== 308) {
      const t = await r.text();
      let b; try { b = JSON.parse(t); } catch { b = t; }
      if (
        r.status === 503 &&
        b?.error?.code === "MISSING_SERVER_GEMINI_KEY" &&
        typeof window !== "undefined" &&
        !isDirectUpstream
      ) {
        this._base = "https://generativelanguage.googleapis.com/v1beta";
        this._uploadBase = "https://generativelanguage.googleapis.com/upload/v1beta";
        return this.request(method, path, { json, params, upload, body: undefined, headers, raw, signal });
      }
      throw new ManagedAgentsError(r.status, b, method, url);
    }
    if (raw) return r;
    const t = await r.text();
    if (!t) return {};
    try { return JSON.parse(t); } catch { return t; }
  }

  async _paginate(path, key, params = {}, limit) {
    const out = [];
    let token;
    do {
      const page = await this.request("GET", path, { params: { ...params, page_size: 100, page_token: token } });
      out.push(...(page[key] ?? []));
      token = page.next_page_token || page.nextPageToken;
    } while (token && !(limit && out.length >= limit));
    return limit ? out.slice(0, limit) : out;
  }

  /** Async-iterate parsed SSE `data:` JSON events (fetch-based, so headers work). */
  async *sse(method, path, { json, params, signal } = {}) {
    const r = await this.request(method, path, { json, params, raw: true, signal, headers: { Accept: "text/event-stream" } });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let data = [];
    let seenCreated = false;
    const deltaSeqByStep = new Map();
    let genericSeq = 0;

    const normalizeEv = (ev) => {
      if (!ev || typeof ev !== "object") return ev;
      if (!ev.event_id) {
        const t = ev.event_type || "message";
        if (t === "interaction.created") ev.event_id = "evt_created";
        else if (t === "interaction.status_update") ev.event_id = `evt_status_${ev.status || "update"}`;
        else if (t === "step.start") ev.event_id = `evt_step_${ev.index ?? 0}_start`;
        else if (t === "step.delta") {
          const idx = ev.index ?? 0;
          const seq = (deltaSeqByStep.get(idx) || 0) + 1;
          deltaSeqByStep.set(idx, seq);
          ev.event_id = `evt_step_${idx}_delta_${seq}`;
        } else if (t === "step.stop") ev.event_id = `evt_step_${ev.index ?? 0}_stop`;
        else if (typeof t === "string" && t.startsWith("interaction.")) ev.event_id = `evt_terminal_${t}`;
        else {
          genericSeq += 1;
          ev.event_id = `evt_${genericSeq}`;
        }
      }
      return ev;
    };

    try {
      for (;;) {
        const { value, done } = await raceSignal(
          reader.read(),
          signal,
          () => { reader.cancel().catch(() => {}); }
        );
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          else if (line === "" && data.length) {
            const payload = data.join("\n");
            data = [];
            if (payload.trim() === "[DONE]") return;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.event_type === "interaction.created") {
                if (seenCreated) continue;
                seenCreated = true;
              }
              yield normalizeEv(parsed);
            } catch { /* skip */ }
          }
        }
      }
    } finally {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
      }
    }
  }

  // ---- high level ------------------------------------------------------ //

  /**
   * Build a CreateInteraction body.
   * opts: agent, images (parts or Blobs already converted via image()), environment ("remote" | env id | config),
   * previous, tools, functions ({name: {description, parameters, handler}} or array of functionTool()),
   * systemInstruction, model, maxTokens, sources, network, env, background, webhookUris, extra
   */
  buildRequest(input, { agent, images, environment: envOpt = "remote", previous, tools, functions, systemInstruction,
    model = DEFAULT_MODEL, maxTokens, sources, network: net, env, background = false, webhookUris, extra } = {}) {
    let parts = input;
    if (images?.length) parts = [...(typeof input === "string" ? [text(input)] : input || []), ...images];
    let envBody = envOpt;
    if (sources?.length || net !== undefined || env) {
      const envId = typeof envOpt === "string" && envOpt !== "remote" ? envOpt : undefined;
      envBody = { ...(typeof envOpt === "object" && envOpt ? envOpt : {}), ...environment({ sources, network: net, env, environmentId: envId }) };
    }
    const fnTools = fnDecls(functions);
    const body = {
      agent: agent || this.defaultAgent,
      agent_config: {
        type: "antigravity",
        model: model || DEFAULT_MODEL,
        ...(maxTokens ? { max_total_tokens: maxTokens } : {}),
      },
      input: parts,
    };
    if (envBody !== undefined && envBody !== null) body.environment = envBody;
    if (previous) body.previous_interaction_id = previous;
    if (tools || fnTools.length) body.tools = [...(tools ?? DEFAULT_TOOLS), ...fnTools];
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (background) body.background = true;
    if (webhookUris) body.webhook_config = { uris: webhookUris };
    return Object.assign(body, extra || {});
  }

  /**
   * Run a task to completion -> Result.
   * - Polls in background mode, or streams if onEvent is given.
   * - functions: {name: {description, parameters, handler(args)}} or {name: handler} — pending calls
   *   are executed locally and fed back automatically.
   * - autoContinue: N -> send "continue" up to N times when the token budget is hit.
   * - signal: AbortSignal (aborting also cancels the server-side run).
   * Also accepts every buildRequest() option.
   */
  async run(input, opts = {}) {
    const { onEvent, poll = 3000, timeout, autoContinue = 0, signal, ...rest } = opts;
    const handlers = fnHandlers(rest.functions);
    let body = this.buildRequest(input, { ...rest, background: !onEvent });
    const history = [];
    let left = autoContinue;
    const deadline = timeout ? Date.now() + timeout : null;
    for (;;) {
      let it;
      if (onEvent) it = await this._streamToEnd(body, onEvent, signal);
      else {
        const created = await this.request("POST", "/interactions", { json: body, signal });
        it = await this.interactions.wait(created.id, { poll, timeout, signal });
      }
      const res = new Result(it);
      if (res.status === "requires_action" && Object.keys(handlers).length && res.pendingCalls.length) {
        const results = await Promise.all(res.pendingCalls.map((c) => callFn(handlers, c)));
        history.push(it);
        body = { ...body, input: results, previous_interaction_id: res.id, environment: res.environmentId ?? body.environment };
      } else if ((res.status === "incomplete" || res.status === "budget_exceeded") && left > 0) {
        left--;
        history.push(it);
        body = { ...body, input: "continue", previous_interaction_id: res.id, environment: res.environmentId ?? body.environment };
      } else {
        res.history = history;
        return res;
      }
      if (deadline && Date.now() > deadline) throw new Error(`run exceeded ${timeout}ms`);
    }
  }

  async _streamToEnd(body, onEvent, signal) {
    body = { ...body, stream: true };
    delete body.background;
    let iid, last;
    let events = this.sse("POST", "/interactions", { json: body, signal });
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const ev of events) {
          if (ev.event_id) last = ev.event_id;
          if (ev.event_type === "interaction.created") iid = ev.interaction?.id;
          onEvent(ev);
          if (ev.event_type === "interaction.completed" || ev.event_type === "interaction.complete") {
            return this.interactions.get(iid ?? ev.interaction?.id); // completed event carries no steps
          }
          if (ev.event_type === "error") throw new ManagedAgentsError(500, ev.error, "STREAM", "/interactions");
        }
        if (iid) return this.interactions.wait(iid, { signal });
        throw new Error("stream ended before the interaction was created");
      } catch (e) {
        if (signal?.aborted) { if (iid) this.interactions.cancel(iid).catch(() => {}); throw e; }
        if (e instanceof ManagedAgentsError || !iid || attempt >= 5) throw e;
        if (this._base.startsWith("https://generativelanguage.googleapis.com")) {
          return this.interactions.wait(iid, { signal });
        }
        await sleep(2000);
        events = this.interactions.stream(iid, { lastEventId: last, signal }); // resume dropped stream
      }
    }
  }

  /** Start a background run and return immediately (the Interaction JSON). */
  start(input, opts = {}) {
    return this.request("POST", "/interactions", { json: this.buildRequest(input, { ...opts, background: true }) });
  }

  /** Async-iterate raw SSE events for a new run. Use textDeltas() to get only text. */
  stream(input, opts = {}) {
    const { signal, ...rest } = opts;
    return this.sse("POST", "/interactions", { json: { ...this.buildRequest(input, rest), stream: true }, signal });
  }

  /** Manually answer pending calls: results = {callId: result} or a list of function_result items. */
  reply(result, results, opts = {}) {
    const res = result instanceof Result ? result : new Result(result);
    let items = results;
    if (!Array.isArray(results)) {
      const names = Object.fromEntries(res.pendingCalls.map((c) => [c.id, c.name]));
      items = Object.entries(results).map(([callId, r]) => ({ type: "function_result", call_id: callId, name: names[callId], result: r }));
    }
    return this.run(items, { ...opts, previous: res.id, environment: res.environmentId });
  }

  /** Resume a run that stopped at its token budget (status incomplete). */
  continue(result, opts = {}) {
    const res = result instanceof Result ? result : new Result(result);
    return this.run("continue", { ...opts, previous: res.id, environment: res.environmentId });
  }

  /** Stateful multi-turn conversation reusing one sandbox. */
  session(agent, { environment: env = "remote", ...defaults } = {}) {
    return new Session(this, agent, env, defaults);
  }

  /** Bake a configured sandbox into a named agent: every invocation forks it. */
  forkAgent(agentId, environmentId, opts = {}) {
    return this.agents.create(agentId, { ...opts, baseEnvironment: environmentId });
  }
}

/** Filter an event stream down to text chunks: for await (const t of textDeltas(ma.stream("hi"))) ... */
export async function* textDeltas(events) {
  for await (const ev of events) if (ev.event_type === "step.delta" && ev.delta?.type === "text") yield ev.delta.text ?? "";
}

function fnDecls(functions) {
  if (!functions) return [];
  if (Array.isArray(functions)) return functions.map((f) => ({ type: "function", name: f.name, description: f.description ?? "", parameters: f.parameters ?? { type: "object", properties: {} } }));
  return Object.entries(functions).map(([name, f]) => (typeof f === "function"
    ? functionTool(name, "", { type: "object", properties: {} })
    : functionTool(name, f.description ?? "", f.parameters ?? { type: "object", properties: {} })));
}

function fnHandlers(functions) {
  if (!functions) return {};
  if (Array.isArray(functions)) return Object.fromEntries(functions.filter((f) => f.handler).map((f) => [f.name, f.handler]));
  return Object.fromEntries(Object.entries(functions).map(([n, f]) => [n, typeof f === "function" ? f : f.handler]).filter(([, h]) => h));
}

async function callFn(handlers, call) {
  let args = call.arguments ?? {};
  if (typeof args === "string") args = JSON.parse(args || "{}");
  try {
    const h = handlers[call.name];
    if (!h) throw new Error(`no local function ${call.name}`);
    let out = await h(args);
    if (out === undefined || out === null || typeof out !== "object") out = typeof out === "string" ? out : { result: out ?? null };
    return { type: "function_result", name: call.name, call_id: call.id, result: out };
  } catch (e) {
    return { type: "function_result", name: call.name, call_id: call.id, result: { error: String(e?.message ?? e) }, is_error: true };
  }
}

export class Session {
  constructor(ma, agent, environment, defaults) {
    Object.assign(this, { ma, agent, environment, defaults, last: null, turns: [] });
  }
  get environmentId() {
    return this.last?.environmentId ?? (typeof this.environment === "string" && this.environment !== "remote" ? this.environment : undefined);
  }
  async send(input, opts = {}) {
    const o = { ...this.defaults, ...opts };
    if (this.last) {
      o.previous ??= this.last.id;
      o.environment ??= this.last.environmentId;
      for (const k of ["sources", "env"]) if (!(k in opts)) delete o[k]; // session defaults only seed the first turn
    } else o.environment ??= this.environment;
    const res = await this.ma.run(input, { agent: this.agent, ...o });
    this.last = res;
    this.turns.push(res);
    return res;
  }
  ls(path = "", opts) { return this.ma.files.list(this._env(), path, opts); }
  read(path) { return this.ma.files.read(this._env(), path); }
  readText(path) { return this.ma.files.readText(this._env(), path); }
  upload(data, path, opts) { return this.ma.files.upload(this._env(), data, path, opts); }
  cancel() { return this.last ? this.ma.interactions.cancel(this.last.id) : null; }
  close() { return this.environmentId ? this.ma.environments.delete(this.environmentId) : null; }
  forkToAgent(agentId, opts) { return this.ma.forkAgent(agentId, this._env(), opts); }
  _env() {
    if (!this.environmentId) throw new Error("Session has no sandbox yet; send() something first");
    return this.environmentId;
  }
}

// ------------------------------------------------------------------------- //
// Resources
// ------------------------------------------------------------------------- //

class Interactions {
  constructor(ma) { this.ma = ma; }
  /** Raw CreateInteraction with any API fields. */
  create(body) { return this.ma.request("POST", "/interactions", { json: body }); }
  get(id, { includeInput, signal } = {}) { return this.ma.request("GET", `/interactions/${id}`, { params: { include_input: includeInput || undefined }, signal }); }
  /** Attach / re-attach to a running interaction's events. */
  stream(id, { lastEventId, signal } = {}) {
    if (this.ma._base.startsWith("https://generativelanguage.googleapis.com")) {
      return this._pollStreamFallback(id, { lastEventId, signal });
    }
    return this.ma.sse("GET", `/interactions/${id}`, { params: { stream: "true", last_event_id: lastEventId }, signal });
  }
  async *_pollStreamFallback(id, { lastEventId, signal } = {}) {
    let pollSeq = 0;
    for (;;) {
      const it = await this.get(id, { signal });
      pollSeq += 1;
      const statusEventId = `evt_poll_${pollSeq}_${it.status || "in_progress"}`;
      if (statusEventId !== lastEventId) {
        yield {
          event_id: statusEventId,
          event_type: "interaction.status_update",
          status: it.status || "in_progress",
          interaction: it,
        };
      }
      if (TERMINAL.has(it.status)) {
        const termType = it.status === "completed" ? "interaction.completed" : `interaction.${it.status}`;
        const termEventId = `evt_terminal_${termType}`;
        if (termEventId !== lastEventId) {
          yield {
            event_id: termEventId,
            event_type: termType,
            status: it.status,
            interaction: it,
          };
        }
        return;
      }
      await raceSignal(sleep(1000), signal);
    }
  }
  async wait(id, { poll = 3000, timeout, signal } = {}) {
    const start = Date.now();
    for (;;) {
      if (signal?.aborted) { await this.cancel(id).catch(() => {}); throw signal.reason ?? new Error("aborted"); }
      const it = await this.get(id, { signal });
      if (TERMINAL.has(it.status)) return it;
      if (timeout && Date.now() - start > timeout) throw new Error(`interaction ${id} still ${it.status} after ${timeout}ms`);
      try {
        await raceSignal(sleep(poll), signal);
      } catch (e) {
        if (signal?.aborted) { await this.cancel(id).catch(() => {}); }
        throw e;
      }
    }
  }
  async cancel(id) {
    try {
      return await this.ma.request("POST", `/interactions/${id}/cancel`, { json: {} });
    } catch {
      await this.delete(id).catch(() => {});
      return { id, status: "cancelled", object: "interaction" };
    }
  }
  delete(id) { return this.ma.request("DELETE", `/interactions/${id}`); }
}

class Agents {
  constructor(ma) { this.ma = ma; }
  /**
   * opts: baseAgent, systemInstruction, description, model, maxTokens, tools, sources, network, env,
   * baseEnvironment (env id to fork, or config), extra
   */
  async create(id, { baseAgent, systemInstruction, description, model = DEFAULT_MODEL, maxTokens, tools, sources, network: net, env,
    baseEnvironment, extra } = {}) {
    const body = { id, base_agent: baseAgent || this.ma.defaultAgent };
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (description) body.description = description;
    body.agent_config = { type: "antigravity", model: model || DEFAULT_MODEL, ...(maxTokens ? { max_total_tokens: maxTokens } : {}) };
    if (tools) body.tools = tools;
    if (!baseEnvironment && (sources?.length || net !== undefined || env)) baseEnvironment = environment({ sources, network: net, env });
    if (baseEnvironment) body.base_environment = baseEnvironment;
    Object.assign(body, extra || {});
    const out = await this.ma.request("POST", "/agents", { json: body });
    if (out?.name?.includes?.("/operations/")) return this._waitOp(out.name); // Vertex long-running op
    return out;
  }
  async _waitOp(name) {
    const host = this.ma._base.split("/v1beta1")[0];
    for (;;) {
      const r = await this.ma._fetch(`${host}/v1beta1/${name}`, { headers: await this.ma._authHeaders() });
      const op = await r.json();
      if (op.done) { if (op.error) throw new ManagedAgentsError(500, op, "LRO", name); return op.response ?? op; }
      await sleep(5000);
    }
  }
  get(id) { return this.ma.request("GET", `/agents/${id}`); }
  list({ limit } = {}) { return this.ma._paginate("/agents", "agents", {}, limit); }
  delete(id) { return this.ma.request("DELETE", `/agents/${id}`); }
  async exists(id) {
    try { await this.get(id); return true; } catch (e) { if (e.status === 404) return false; throw e; }
  }
  /** No update API exists: delete (if present) and recreate. */
  async replace(id, opts) { if (await this.exists(id)) await this.delete(id); return this.create(id, opts); }
}

class Environments {
  constructor(ma) { this.ma = ma; }
  /** Provision a sandbox without running the agent; fromEnvironment forks an existing one. */
  create({ sources, network: net, fromEnvironment } = {}) {
    const body = {};
    if (sources?.length) body.sources = sources.flat();
    if (net !== undefined) body.network = net;
    if (fromEnvironment) body.from_environment = fromEnvironment;
    return this.ma.request("POST", "/environments", { json: body });
  }
  fork(environmentId) { return this.create({ fromEnvironment: environmentId }); }
  get(id) { return this.ma.request("GET", `/environments/${id}`); }
  list({ limit } = {}) { return this.ma._paginate("/environments", "environments", {}, limit); }
  delete(id) { return this.ma.request("DELETE", `/environments/${id}`); }
}

const filePath = (env, path) => `/environments/${env}/files/${encodePath(path.replace(/^\/+|\/+$/g, ""))}`.replace(/\/$/, "");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

class Files {
  constructor(ma) { this.ma = ma; }
  async list(env, path = "", { recursive = false } = {}) {
    const out = [];
    let token;
    do {
      const page = await this.ma.request("GET", filePath(env, path), { params: { recursive: recursive ? "true" : undefined, page_token: token } });
      out.push(...(page.files ?? []));
      token = page.next_page_token;
    } while (token);
    return out;
  }
  async stat(env, path) { return ((await this.ma.request("GET", filePath(env, path))).files ?? [{}])[0]; }
  async exists(env, path) {
    try { await this.stat(env, path); return true; } catch (e) { if (e.status === 404) return false; throw e; }
  }
  /** File contents as a Blob (a directory path returns a tar archive). */
  async read(env, path, { recursive } = {}) {
    const r = await this.ma.request("GET", filePath(env, path), { params: { alt: "media", recursive: recursive ? "true" : undefined }, raw: true });
    return r.blob();
  }
  async readText(env, path) { return (await this.read(env, path)).text(); }
  async readJson(env, path) { return JSON.parse(await this.readText(env, path)); }
  /** Object URL for showing a sandbox image/video in an <img>/<video>. Revoke it when done. */
  async objectUrl(env, path) { return URL.createObjectURL(await this.read(env, path)); }
  /** Directory -> [{path, data: Uint8Array}] (downloads tar and unpacks it in memory). */
  async readDir(env, path = "", { recursive = true } = {}) {
    return untar(new Uint8Array(await (await this.read(env, path, { recursive })).arrayBuffer()));
  }
  /** Browser: save a sandbox file to the user's disk. */
  async saveAs(env, path, filename) {
    const url = await this.objectUrl(env, path);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename || path.split("/").pop() });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  /**
   * Upload a string / Blob / File / ArrayBuffer / Uint8Array to `path`.
   * opts: overwrite (default true), mimeType, extract (tar/tar.gz), chunkSize (resumable above this, default 8 MB), onProgress(sent,total)
   */
  async upload(env, data, path, { overwrite = true, mimeType, extract = false, chunkSize = 8 << 20, onProgress } = {}) {
    const blob = toBlob(data, mimeType);
    const type = mimeType || blob.type || (extract ? "application/x-tar" : "application/octet-stream");
    const p = `/environments/${env}/files/${encodePath(path.replace(/^\/+/, ""))}`;
    const q = { overwrite: overwrite ? "true" : undefined, extract: extract ? "true" : undefined };
    if (blob.size <= chunkSize) {
      const out = await this.ma.request("PUT", p, { upload: true, params: q, body: blob, headers: { "Content-Type": type } });
      onProgress?.(blob.size, blob.size);
      return out;
    }
    const init = await this.ma.request("PUT", p, { upload: true, params: { ...q, uploadType: "resumable" }, raw: true,
      headers: { "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(blob.size) } });
    const sessionUrl = init.headers.get("Location");
    let offset = 0;
    while (offset < blob.size) {
      const chunk = blob.slice(offset, offset + chunkSize);
      const end = offset + chunk.size - 1;
      let resp;
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await this.ma._fetch(sessionUrl, { method: "PUT", body: chunk, headers: { "Content-Type": type, "Content-Range": `bytes ${offset}-${end}/${blob.size}` } });
          break;
        } catch (e) { if (attempt >= 4) throw e; await sleep(1000 * 2 ** attempt); }
      }
      if (resp.status === 308) {
        const rng = resp.headers.get("Range");
        offset = rng ? Number(rng.split("-")[1]) + 1 : offset;
      } else if (resp.ok) {
        onProgress?.(blob.size, blob.size);
        const t = await resp.text();
        return t ? JSON.parse(t) : {};
      } else throw new ManagedAgentsError(resp.status, await resp.text(), "PUT", sessionUrl);
      onProgress?.(offset, blob.size);
    }
    return {};
  }
  writeText(env, path, content, opts) { return this.upload(env, content, path, { mimeType: "text/plain", ...opts }); }
  /** Upload many files at once as a tar and extract at `path`. files: FileList/File[] (uses webkitRelativePath) or {relPath: content}. */
  async uploadDir(env, files, path, { overwrite = true, onProgress } = {}) {
    const entries = [];
    if (files instanceof Array || (typeof FileList !== "undefined" && files instanceof FileList)) {
      for (const f of files) {
        const rel = f.webkitRelativePath ? f.webkitRelativePath.split("/").slice(1).join("/") : f.name;
        entries.push({ path: rel, data: new Uint8Array(await f.arrayBuffer()) });
      }
    } else {
      for (const [rel, c] of Object.entries(files)) entries.push({ path: rel, data: await toBytes(c) });
    }
    return this.upload(env, makeTar(entries), path.replace(/\/?$/, "/"), { extract: true, overwrite, mimeType: "application/x-tar", onProgress });
  }
}

class Triggers {
  constructor(ma) { this.ma = ma; }
  /**
   * create("0 9 * * *", "Triage new issues", {timeZone: "Europe/London", agent: "triager", network: network("api.github.com")})
   * opts: timeZone, name, timeoutSeconds, maxConsecutiveFailures, webhookUris, environmentId, + any buildRequest() option
   */
  create(schedule, input, { timeZone = "UTC", name, timeoutSeconds, maxConsecutiveFailures, webhookUris, environmentId, ...interactionOpts } = {}) {
    const interaction = this.ma.buildRequest(input, interactionOpts);
    if (typeof interaction.input === "string") interaction.input = [text(interaction.input)];
    const body = { schedule, time_zone: timeZone, interaction };
    if (name) body.display_name = name;
    if (timeoutSeconds) body.execution_timeout_seconds = timeoutSeconds;
    if (maxConsecutiveFailures) body.max_consecutive_failures = maxConsecutiveFailures;
    if (webhookUris) body.webhook_config = { uris: webhookUris };
    if (environmentId) body.environment_id = environmentId;
    return this.ma.request("POST", "/triggers", { json: body });
  }
  list({ filter, limit } = {}) { return this.ma._paginate("/triggers", "triggers", { filter }, limit); }
  get(id) { return this.ma.request("GET", `/triggers/${id}`); }
  /** fields (snake_case): schedule, time_zone, display_name, status, interaction, ... */
  update(id, fields) { return this.ma.request("PATCH", `/triggers/${id}`, { json: fields, params: { update_mask: Object.keys(fields).join(",") } }); }
  pause(id) { return this.update(id, { status: "paused" }); }
  resume(id) { return this.update(id, { status: "active" }); }
  delete(id) { return this.ma.request("DELETE", `/triggers/${id}`); }
  runNow(id) { return this.ma.request("POST", `/triggers/${id}/executions`, { json: {} }); }
  executions(id, { limit } = {}) { return this.ma._paginate(`/triggers/${id}/executions`, "trigger_executions", {}, limit); }
}

class Credentials {
  constructor(ma) { this.ma = ma; }
  bearer(id, token, { headerName, prefix } = {}) {
    const body = { id, type: "bearer_token", token };
    if (headerName !== undefined) body.header_name = headerName;
    if (prefix !== undefined) body.prefix = prefix;
    return this.create(body);
  }
  oauth2(id, { clientId, clientSecret, refreshToken, tokenUrl, scopes }) {
    return this.create({ id, type: "oauth2", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, token_url: tokenUrl, ...(scopes ? { scopes } : {}) });
  }
  /** Reference from environment({env: {NAME: {credential: id}}}). */
  envVar(id, value, { trustedDomains, injectionLocation = "header" }) {
    return this.create({ id, type: "environment_variable", value, trusted_domains: trustedDomains, injection_location: injectionLocation });
  }
  create(body) { return this.ma.request("POST", "/credentials", { json: body }); }
  get(id) { return this.ma.request("GET", `/credentials/${id}`); }
  list({ limit } = {}) { return this.ma._paginate("/credentials", "credentials", {}, limit); }
  delete(id) { return this.ma.request("DELETE", `/credentials/${id}`); }
  /** rotate("github", {token: "ghp_new"}) — `type` is required by the API and filled in for you. */
  async rotate(id, fields) {
    const body = { ...fields, type: fields.type ?? (await this.get(id)).type };
    return this.ma.request("PATCH", `/credentials/${id}`, { json: body, params: { update_mask: Object.keys(fields).join(",") } });
  }
}

class Webhooks {
  constructor(ma) { this.ma = ma; }
  static EVENTS = ["interaction.completed", "interaction.requires_action", "interaction.failed"];
  /** Response includes new_signing_secret (shown once). */
  create(uri, { events = Webhooks.EVENTS, name } = {}) {
    return this.ma.request("POST", "/webhooks", { json: { uri, subscribed_events: events, ...(name ? { name } : {}) } });
  }
  list({ limit } = {}) { return this.ma._paginate("/webhooks", "webhooks", {}, limit); }
  get(id) { return this.ma.request("GET", `/webhooks/${id}`); }
  delete(id) { return this.ma.request("DELETE", `/webhooks/${id}`); }
  ping(id) { return this.ma.request("POST", `/webhooks/${id}:ping`, { json: {} }); }
  /** fields: uri, name, subscribed_events, state ("enabled" | "disabled") */
  update(id, fields) { return this.ma.request("PATCH", `/webhooks/${id}`, { json: fields, params: { update_mask: Object.keys(fields).join(",") } }); }
  rotateSecret(id, { revokeNow = false } = {}) {
    return this.ma.request("POST", `/webhooks/${id}:rotateSigningSecret`, {
      json: { revocation_behavior: revokeNow ? "revoke_previous_secrets_immediately" : "revoke_previous_secrets_after_h24" } });
  }
}

// ------------------------------------------------------------------------- //
// Byte helpers: base64, blobs, minimal tar (ustar) reader/writer
// ------------------------------------------------------------------------- //

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function toBlob(data, type) {
  if (data instanceof Blob) return data;
  return new Blob([typeof data === "string" ? data : data], type ? { type } : {});
}

async function toBytes(c) {
  if (typeof c === "string") return new TextEncoder().encode(c);
  if (c instanceof Blob) return new Uint8Array(await c.arrayBuffer());
  return c instanceof Uint8Array ? c : new Uint8Array(c);
}

/** Parse a (uncompressed) tar archive into [{path, data}]. */
export function untar(buf) {
  const out = [];
  const dec = new TextDecoder();
  const str = (o, n) => dec.decode(buf.subarray(o, o + n)).replace(/\0.*$/s, "");
  let off = 0, longName = null;
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
    let name = str(off, 100);
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = str(off + 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(off + 512, off + 512 + size);
    if (type === "L") longName = dec.decode(data).replace(/\0.*$/s, "");
    else if (type === "x" || type === "g") {
      const m = dec.decode(data).match(/\d+ path=([^\n]+)\n/);
      if (m) longName = m[1];
    } else {
      if (type === "0" || type === "\0" || type === "7") out.push({ path: (longName ?? name).replace(/^\.\//, ""), data });
      longName = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Build an uncompressed ustar archive from [{path, data: Uint8Array}]. */
export function makeTar(entries) {
  const enc = new TextEncoder();
  const blocks = [];
  for (const { path, data } of entries) {
    const h = new Uint8Array(512);
    let name = enc.encode(path);
    let prefix = new Uint8Array(0);
    if (name.length > 100) {
      const cut = path.lastIndexOf("/", 154);
      prefix = enc.encode(path.slice(0, cut));
      name = enc.encode(path.slice(cut + 1));
    }
    const put = (o, s) => h.set(typeof s === "string" ? enc.encode(s) : s, o);
    put(0, name.subarray(0, 100));
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, data.length.toString(8).padStart(11, "0") + "\0");
    put(136, Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0");
    put(148, "        ");
    h[156] = 48; // '0' regular file
    put(257, "ustar\0");
    put(263, "00");
    put(345, prefix.subarray(0, 155));
    const sum = h.reduce((a, b) => a + b, 0);
    put(148, sum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) { out.set(b, o); o += b.length; }
  return out;
}

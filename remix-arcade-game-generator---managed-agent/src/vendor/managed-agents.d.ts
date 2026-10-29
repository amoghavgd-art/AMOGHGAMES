export const BASE_AGENT: string;
export const VERTEX_BASE_AGENT: string;
export const CANDIDATE_BASE_AGENTS: ReadonlyArray<string>;
export const CANDIDATE_MODELS: ReadonlyArray<string>;
export const DEFAULT_MODEL: string;
export const API_REVISION: string;
export const DEFAULT_TOOLS: Array<{ type: string }>;

export class ManagedAgentsError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, method: string, url: string);
}

export interface InlineSource {
  type: "inline";
  target: string;
  content: string;
  encoding?: "base64";
}

export function codeExecution(): { type: "code_execution" };
export function googleSearch(): { type: "google_search" };
export function urlContext(): { type: "url_context" };
export function inline(target: string, content: string | Uint8Array | ArrayBuffer): InlineSource;
export function repo(url: string, target: string): { type: "repository"; source: string; target: string };
export function gcs(uri: string, target: string): { type: "gcs"; source: string; target: string };
export function agentsMd(text: string): InlineSource;
export function skill(name: string, description: string, body: string, files?: Record<string, string | Uint8Array>): InlineSource[];
export function hook(event: string, matcher: string, opts?: Record<string, unknown>): Record<string, unknown>;
export function hooks(groups: unknown, scripts?: Record<string, string>): InlineSource[];
export function allow(domain: string, opts?: Record<string, unknown>): Record<string, unknown>;
export function network(...rules: unknown[]): "disabled" | { allowlist: unknown[] };
export function environment(opts?: Record<string, unknown>): Record<string, unknown>;
export function text(t: string): { type: "text"; text: string };
export function image(src: string | Blob | ArrayBuffer | Uint8Array, mimeType?: string): Promise<{ type: "image"; data: string; mime_type: string }>;
export function frame(el: HTMLVideoElement | HTMLCanvasElement, opts?: Record<string, unknown>): Promise<{ type: "image"; data: string; mime_type: string }>;
export function textDeltas(events: AsyncIterable<ManagedAgentEvent>): AsyncGenerator<string>;
export function untar(buf: Uint8Array): Array<{ path: string; data: Uint8Array }>;
export function makeTar(entries: Array<{ path: string; data: Uint8Array }>): Uint8Array;

export interface ManagedAgentEvent {
  event_id?: string;
  event_type: string;
  status?: string;
  index?: number;
  step_id?: string;
  interaction?: {
    id?: string;
    status?: string;
    environment_id?: string;
    [key: string]: unknown;
  };
  step?: {
    id?: string;
    type?: string;
    arguments?: unknown;
    result?: unknown;
    is_error?: boolean;
    exit_code?: number;
    [key: string]: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    thought?: string;
    arguments?: string;
    arguments_delta?: string;
    output?: string;
    stdout?: string;
    result?: unknown;
    is_error?: boolean;
    exit_code?: number;
    [key: string]: unknown;
  };
  error?: unknown;
  [key: string]: unknown;
}

export interface InteractionCreateBody {
  agent?: string;
  model?: string;
  agent_config?: {
    type: string;
    model: string;
    max_total_tokens?: number;
  };
  input: unknown;
  environment?: string | Record<string, unknown>;
  previous_interaction_id?: string;
  tools?: unknown[];
  system_instruction?: string;
  background?: boolean;
  stream?: boolean;
  webhook_config?: { uris: string[] };
  response_mime_type?: string;
  response_format?: unknown;
  [key: string]: unknown;
}

export interface BuildRequestOptions {
  agent?: string;
  images?: unknown[];
  environment?: string | Record<string, unknown>;
  previous?: string;
  tools?: unknown[];
  functions?: unknown;
  systemInstruction?: string;
  model?: string;
  maxTokens?: number;
  sources?: unknown[];
  network?: "disabled" | { allowlist: unknown[] };
  env?: Record<string, unknown>;
  background?: boolean;
  webhookUris?: string[];
  extra?: Record<string, unknown>;
}

export interface RunOptions extends BuildRequestOptions {
  onEvent?: (ev: ManagedAgentEvent) => void;
  poll?: number;
  timeout?: number;
  autoContinue?: number;
  signal?: AbortSignal;
}

export interface AgentCreateOptions {
  baseAgent?: string;
  systemInstruction?: string;
  description?: string;
  model?: string;
  maxTokens?: number;
  tools?: unknown[];
  sources?: unknown[];
  network?: "disabled" | { allowlist: unknown[] };
  env?: Record<string, unknown>;
  baseEnvironment?: string | Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface EnvironmentSummary {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export class Result {
  raw: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
  constructor(raw: Record<string, unknown>, history?: Array<Record<string, unknown>>);
  readonly id: string;
  readonly status: string;
  readonly ok: boolean;
  readonly environmentId: string | undefined;
  readonly steps: Array<Record<string, unknown>>;
  readonly usage: Record<string, unknown>;
  readonly totalTokens: number;
  readonly text: string;
  readonly images: Array<{ data: string; mime_type: string }>;
  readonly pendingCalls: Array<Record<string, unknown>>;
}

export interface ManagedAgentsOptions {
  apiKey?: string;
  baseUrl?: string;
  accessToken?: string | (() => string | Promise<string>);
  vertex?: boolean;
  project?: string;
  location?: string;
  agent?: string;
  apiRevision?: string | null;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class ManagedAgents {
  defaultAgent: string;
  _headers: Record<string, string>;
  interactions: {
    create(body: InteractionCreateBody | Record<string, unknown>): Promise<Record<string, unknown>>;
    get(id: string, opts?: { includeInput?: boolean }): Promise<Record<string, unknown> & { id?: string; status?: string; environment_id?: string }>;
    stream(id: string, opts?: { lastEventId?: string; signal?: AbortSignal }): AsyncGenerator<ManagedAgentEvent>;
    wait(id: string, opts?: { poll?: number; timeout?: number; signal?: AbortSignal }): Promise<Record<string, unknown>>;
    cancel(id: string): Promise<Record<string, unknown>>;
    delete(id: string): Promise<Record<string, unknown>>;
  };
  agents: {
    create(id: string, opts?: AgentCreateOptions): Promise<Record<string, unknown>>;
    get(id: string): Promise<Record<string, unknown>>;
    list(opts?: { limit?: number }): Promise<Array<Record<string, unknown>>>;
    delete(id: string): Promise<Record<string, unknown>>;
    exists(id: string): Promise<boolean>;
    replace(id: string, opts?: AgentCreateOptions): Promise<Record<string, unknown>>;
  };
  environments: {
    create(opts?: { sources?: unknown[]; network?: "disabled" | { allowlist: unknown[] }; fromEnvironment?: string }): Promise<EnvironmentSummary>;
    fork(environmentId: string): Promise<EnvironmentSummary>;
    get(id: string): Promise<EnvironmentSummary>;
    list(opts?: { limit?: number }): Promise<EnvironmentSummary[]>;
    delete(id: string): Promise<Record<string, unknown>>;
  };
  files: {
    list(env: string, path?: string, opts?: { recursive?: boolean }): Promise<Array<Record<string, unknown>>>;
    stat(env: string, path: string): Promise<Record<string, unknown>>;
    exists(env: string, path: string): Promise<boolean>;
    read(env: string, path: string, opts?: { recursive?: boolean }): Promise<Blob>;
    readText(env: string, path: string): Promise<string>;
    readJson<T = unknown>(env: string, path: string): Promise<T>;
    objectUrl(env: string, path: string): Promise<string>;
    readDir(env: string, path?: string, opts?: { recursive?: boolean }): Promise<Array<{ path: string; data: Uint8Array }>>;
    saveAs(env: string, path: string, filename?: string): Promise<void>;
    upload(env: string, data: unknown, path: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    writeText(env: string, path: string, content: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    uploadDir(env: string, files: unknown, path: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  constructor(opts?: ManagedAgentsOptions);
  request(method: string, path: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  sse(method: string, path: string, opts?: { json?: unknown; params?: Record<string, unknown>; signal?: AbortSignal }): AsyncGenerator<ManagedAgentEvent>;
  buildRequest(input: unknown, opts?: BuildRequestOptions): InteractionCreateBody;
  run(input: unknown, opts?: RunOptions): Promise<Result>;
  start(input: unknown, opts?: BuildRequestOptions): Promise<Record<string, unknown>>;
  stream(input: unknown, opts?: RunOptions): AsyncGenerator<ManagedAgentEvent>;
  forkAgent(agentId: string, environmentId: string, opts?: AgentCreateOptions): Promise<Record<string, unknown>>;
}

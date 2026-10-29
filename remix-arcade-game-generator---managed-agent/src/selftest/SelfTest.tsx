import React, { useEffect, useState, useRef } from "react";
import { ma, image, setAdminToken, BASE_AGENT, CANDIDATE_BASE_AGENTS, CANDIDATE_MODELS, ManagedAgentsError } from "../gemini";
import { CONFIG } from "../config";
import { generateDesignCard, buildPresetCard } from "../card/designCard";
import { CartHost } from "../cart/CartHost";

export interface CheckResult {
  num: number;
  name: string;
  status: "pending" | "running" | "pass" | "fail";
  latencyMs?: number;
  details?: Record<string, any>;
  error?: string;
}

const INITIAL_CHECKS: CheckResult[] = [
  { num: 1, name: "Flash structured output with GameDesignCard schema", status: "pending" },
  { num: 2, name: "Nano Banana at 21:9 and at 9:16 (< 25 s each)", status: "pending" },
  { num: 3, name: "Managed agent streamed run (write /workspace/out/hi.txt)", status: "pending" },
  { num: 4, name: 'files.readText(env, "workspace/out/hi.txt") === "hello"', status: "pending" },
  { num: 5, name: "Cancel a running interaction via AbortSignal (< 5 s)", status: "pending" },
  { num: 6, name: "Reconnect a stream with lastEventId without duplicates", status: "pending" },
  { num: 7, name: "environments.delete(env) and confirm gone from list", status: "pending" },
  { num: 8, name: "Cart sandbox iframe (cart/host.html + dodger.js @ 60 fps for 10 s)", status: "pending" },
  { num: 9, name: "Proxy guardrails (no tokens, wrong agent, 4th build/hr, reset-caps)", status: "pending" },
];

function measureBase64Image(base64: string, mimeType: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to decode base64 image in browser"));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

export const SelfTest: React.FC = () => {
  const [checks, setChecks] = useState<CheckResult[]>(INITIAL_CHECKS);
  const [done, setDone] = useState(false);
  const runningRef = useRef(false);

  const updateCheck = (num: number, patch: Partial<CheckResult>) => {
    setChecks((prev) =>
      prev.map((c) => (c.num === num ? { ...c, ...patch } : c))
    );
  };

  const runAll = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setDone(false);
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c, status: "pending", latencyMs: undefined, details: undefined, error: undefined })));

    const finalResults: CheckResult[] = INITIAL_CHECKS.map((c) => ({ ...c }));
    const recordResult = (num: number, patch: Partial<CheckResult>) => {
      const idx = finalResults.findIndex((c) => c.num === num);
      if (idx >= 0) {
        finalResults[idx] = { ...finalResults[idx], ...patch };
      }
      updateCheck(num, patch);
    };

    // Obtain admin token from ?admin= query param or local selftest helper endpoint
    let adminTok = new URLSearchParams(window.location.search).get("admin") || "";
    if (!adminTok) {
      try {
        const r = await fetch("api/admin/selftest-token", {
          headers: { "x-selftest": "1" },
        });
        if (r.ok) {
          const d = await r.json();
          adminTok = d.adminToken || "";
        }
      } catch {
        // ignore
      }
    }
    setAdminToken(adminTok || undefined);
    ma._headers["x-selftest"] = "1";

    // Run Check 8 (10s local Cart sandbox check) in parallel with network checks 1-7 so total selftest time is fast
    const check8Promise = (async () => {
      recordResult(8, { status: "running" });
      const t0 = performance.now();
      let cart: CartHost | null = null;
      try {
        const res = await fetch("house-games/dodger.js");
        if (!res.ok) throw new Error(`Failed to fetch house-games/dodger.js: ${res.status}`);
        const dodgerSource = await res.text();
        const card = buildPresetCard({
          name: "selftest",
          genre: "dodger",
          hero: "a tiny golden arcade coin",
          vibe: "sunset",
        });

        let framesReceived = 0;
        let firstNonZeroPixelSeen = false;
        const cartErrors: string[] = [];

        cart = new CartHost(document.body, {
          onFrame: (rgba) => {
            framesReceived++;
            if (!firstNonZeroPixelSeen) {
              for (let i = 0; i < rgba.length; i += 4) {
                if (rgba[i] !== 0 || rgba[i + 1] !== 0 || rgba[i + 2] !== 0) {
                  firstNonZeroPixelSeen = true;
                  break;
                }
              }
            }
          },
          onError: (e) => cartErrors.push(`${e.phase}: ${e.message}`),
        });

        const readyInfo = await cart.load(dodgerSource, card);
        const simStart = performance.now();
        // Drive 60 ticks/sec for 10 seconds using a high-precision 16.67ms timer so even background tabs hit 60fps
        await new Promise<void>((resolve) => {
          let tickCount = 0;
          const interval = setInterval(() => {
            tickCount++;
            cart?.tick(1000 / 60, {
              left: (tickCount % 60) < 30,
              right: (tickCount % 60) >= 30,
              up: false,
              down: false,
              a: false,
              b: false,
              start: tickCount === 1, // Press START on tick 1
            });
            if (performance.now() - simStart >= 10000) {
              clearInterval(interval);
              resolve();
            }
          }, 1000 / 60);
        });

        // Wait 50ms for final postMessage frame
        await new Promise((r) => setTimeout(r, 50));
        const elapsedSec = (performance.now() - simStart) / 1000;
        const avgFps = Number((framesReceived / elapsedSec).toFixed(1));
        const latencyMs = Math.round(performance.now() - t0);
        const pass = framesReceived >= 550 && firstNonZeroPixelSeen && cartErrors.length === 0;
        recordResult(8, {
          status: pass ? "pass" : "fail",
          latencyMs,
          details: {
            title: readyInfo.title,
            framesReceived,
            elapsedSec: Number(elapsedSec.toFixed(2)),
            avgFps,
            firstNonZeroPixelSeen,
            cartErrors,
          },
        });
      } catch (err: any) {
        recordResult(8, {
          status: "fail",
          latencyMs: Math.round(performance.now() - t0),
          error: err?.message || String(err),
        });
      } finally {
        cart?.destroy();
      }
    })();

    // Check 1: Flash structured output
    recordResult(1, { status: "running" });
    try {
      const res = await generateDesignCard(
        {
          name: "jess",
          genre: "runner",
          hero: "a corgi astronaut fetching stars",
          vibe: "cosmic",
        },
        { timeoutMs: 4000 }
      );
      const pass = !res.fallbackUsed && res.latencyMs < 4000 && Boolean(res.card?.title);
      recordResult(1, {
        status: pass ? "pass" : "fail",
        latencyMs: res.latencyMs,
        details: {
          model: res.model,
          title: res.card.title,
          maxLengthRespected: res.maxLengthRespected,
          fallbackUsed: res.fallbackUsed,
          under4s: res.latencyMs < 4000,
        },
      });
    } catch (err: any) {
      recordResult(1, {
        status: "fail",
        error: err?.message || String(err),
      });
    }

    // Check 2: Nano Banana at 21:9 and 9:16
    recordResult(2, { status: "running" });
    const t2 = performance.now();
    try {
      const [img21, img9] = await Promise.all([
        image(
          "Wide pixel-art arcade marquee banner background. Deep starry night gradient sky. Retro 1980s arcade style, pixel art, flat colours, no text.",
          { aspectRatio: "21:9" }
        ),
        image(
          "Tall pixel-art arcade cabinet side art. A corgi astronaut in the middle. Retro 1980s arcade side panel style, pixel art, flat colours, no text.",
          { aspectRatio: "9:16" }
        ),
      ]);
      const [dims21, dims9] = await Promise.all([
        measureBase64Image(img21.base64, img21.mimeType),
        measureBase64Image(img9.base64, img9.mimeType),
      ]);
      const latencyMs = Math.round(performance.now() - t2);
      const ok21 = dims21.width > dims21.height * 1.8 && img21.latencyMs < 25000;
      const ok9 = dims9.height > dims9.width * 1.5 && img9.latencyMs < 25000;
      recordResult(2, {
        status: ok21 && ok9 ? "pass" : "fail",
        latencyMs,
        details: {
          model: img21.model,
          configFieldNames: "config.responseModalities=['IMAGE'], config.imageConfig.aspectRatio",
          "21:9": { ...dims21, latencyMs: img21.latencyMs },
          "9:16": { ...dims9, latencyMs: img9.latencyMs },
        },
      });
    } catch (err: any) {
      recordResult(2, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t2),
        error: err?.message || String(err),
      });
    }

    // Check 3: Managed agent streamed run (try CANDIDATE_BASE_AGENTS & CANDIDATE_MODELS so external keys work)
    let sharedEnvId: string | undefined;
    let activeTestAgent = CONFIG.AGENT_ID || BASE_AGENT;
    let activeTestModel = CONFIG.AGENT_MODEL;
    recordResult(3, { status: "running" });
    const t3 = performance.now();
    try {
      const candidateAgents = Array.from(
        new Set([
          CONFIG.AGENT_ID || BASE_AGENT,
          "antigravity-preview-09-2026",
          ...CANDIDATE_BASE_AGENTS,
          CONFIG.GAMESMITH_AGENT,
        ])
      );
      const candidateModels = Array.from(
        new Set([CONFIG.AGENT_MODEL, ...CANDIDATE_MODELS])
      );
      let res: any = null;
      let eventTypes: string[] = [];
      let eventTimes: number[] = [];
      let createdId = "";
      let lastAgentErr: unknown = null;
      let check3Succeeded = false;

      for (const candidate of candidateAgents) {
        if (check3Succeeded) break;
        for (const candidateModel of candidateModels) {
          eventTypes = [];
          eventTimes = [];
          createdId = "";
          try {
            res = await ma.run(
              "Write the exact word hello (no newline, no quotes) to /workspace/out/hi.txt and finish immediately.",
              {
                agent: candidate,
                model: candidateModel,
                maxTokens: CONFIG.MAX_AGENT_TOKENS,
                onEvent: (ev) => {
                  eventTypes.push(ev.event_type);
                  eventTimes.push(Math.round(performance.now() - t3));
                  if (ev.event_type === "interaction.created") {
                    createdId = ev.interaction?.id || "";
                  }
                },
              }
            );
            activeTestAgent = candidate;
            activeTestModel = candidateModel;
            lastAgentErr = null;
            check3Succeeded = true;
            break;
          } catch (candErr) {
            lastAgentErr = candErr;
            const msg = candErr instanceof Error ? candErr.message : String(candErr);
            const isRecoverable =
              (candErr instanceof ManagedAgentsError &&
                (candErr.status === 404 || candErr.status === 403 || candErr.status === 400)) ||
              msg.includes("404") ||
              msg.includes("403") ||
              /not found|does not exist|permission|invalid|unsupported/i.test(msg);
            if (!isRecoverable) {
              throw candErr;
            }
            if (/\bagent\b/i.test(msg) && !/\bmodel\b/i.test(msg)) {
              break;
            }
          }
        }
      }

      if (lastAgentErr || !res) {
        throw lastAgentErr || new Error("No working base agent found");
      }

      const latencyMs = Math.round(performance.now() - t3);
      sharedEnvId = res.environmentId;
      const progressive =
        eventTimes.length >= 2 &&
        eventTimes[eventTimes.length - 1] - eventTimes[0] > 200;
      const pass = res.status === "completed" && progressive && Boolean(sharedEnvId);
      recordResult(3, {
        status: pass ? "pass" : "fail",
        latencyMs,
        details: {
          agent: activeTestAgent,
          model: activeTestModel,
          interactionId: createdId || res.id,
          environmentId: sharedEnvId,
          status: res.status,
          eventCount: eventTypes.length,
          firstEventMs: eventTimes[0],
          lastEventMs: eventTimes[eventTimes.length - 1],
          progressive,
        },
      });
    } catch (err: unknown) {
      recordResult(3, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t3),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check 4: files.readText(env, "workspace/out/hi.txt")
    recordResult(4, { status: "running" });
    const t4 = performance.now();
    try {
      if (!sharedEnvId) throw new Error("No environmentId from Check 3");
      const text = await ma.files.readText(sharedEnvId, "workspace/out/hi.txt");
      const latencyMs = Math.round(performance.now() - t4);
      const trimmed = text.trim();
      const pass = trimmed === "hello";
      recordResult(4, {
        status: pass ? "pass" : "fail",
        latencyMs,
        details: { content: trimmed },
      });
    } catch (err: unknown) {
      recordResult(4, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t4),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check 5: Cancel a running interaction via AbortSignal (< 5 s)
    recordResult(5, { status: "running" });
    const t5Start = performance.now();
    try {
      if (!sharedEnvId) throw new Error("No environmentId from Check 3");
      const cancelCtl = new AbortController();
      let cancelIid = "";
      let abortTime = 0;

      try {
        await ma.run(
          "Run `sleep 25` in bash using code_execution and wait for it to finish.",
          {
            agent: activeTestAgent,
            model: activeTestModel,
            environment: sharedEnvId,
            maxTokens: CONFIG.MAX_AGENT_TOKENS,
            signal: cancelCtl.signal,
            onEvent: (ev) => {
              if (ev.event_type === "interaction.created") {
                cancelIid = ev.interaction?.id || "";
              }
              if (cancelIid && ev.event_type === "step.start" && !abortTime) {
                abortTime = performance.now();
                cancelCtl.abort();
              }
            },
          }
        );
      } catch {
        // expected AbortError
      }

      if (!abortTime) abortTime = performance.now();
      let finalStatus = "in_progress";
      while (performance.now() - abortTime < 5000) {
        const info = await ma.interactions.get(cancelIid);
        finalStatus = info.status || "in_progress";
        if (finalStatus === "cancelled") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const latency5Ms = Math.round(performance.now() - abortTime);
      const pass5 = finalStatus === "cancelled" && latency5Ms <= 5000;
      recordResult(5, {
        status: pass5 ? "pass" : "fail",
        latencyMs: latency5Ms,
        details: {
          interactionId: cancelIid,
          status: finalStatus,
          cancelledUnder5s: latency5Ms <= 5000,
        },
      });
    } catch (err: unknown) {
      recordResult(5, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t5Start),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check 6: Reconnect stream with lastEventId without duplicates
    recordResult(6, { status: "running" });
    const t6 = performance.now();
    try {
      if (!sharedEnvId) throw new Error("No environmentId from Check 3");
      const body = {
        ...ma.buildRequest(
          "Write the numbers 1 to 5 to /tmp/nums.txt and reply done.",
          {
            agent: activeTestAgent,
            model: activeTestModel,
            environment: sharedEnvId,
            maxTokens: CONFIG.MAX_AGENT_TOKENS,
          }
        ),
        stream: true,
      };
      delete body.background;

      const dropCtl = new AbortController();
      let iid = "";
      let lastEventId = "";
      const seenBeforeDrop = new Set<string>();
      let eventsBeforeDrop = 0;

      try {
        for await (const ev of ma.sse("POST", "/interactions", { json: body, signal: dropCtl.signal })) {
          eventsBeforeDrop++;
          if (ev.event_id) {
            seenBeforeDrop.add(ev.event_id);
            lastEventId = ev.event_id;
          }
          if (ev.event_type === "interaction.created") {
            iid = ev.interaction?.id || "";
          }
          if (iid && lastEventId && eventsBeforeDrop >= 2) {
            dropCtl.abort();
            break;
          }
        }
      } catch {
        // expected stream drop
      }

      let duplicateCount = 0;
      let resumedEvents = 0;
      const resumeCtl = new AbortController();
      try {
        for await (const ev of ma.interactions.stream(iid, { lastEventId, signal: resumeCtl.signal })) {
          resumedEvents++;
          if (ev.event_id && seenBeforeDrop.has(ev.event_id)) {
            duplicateCount++;
          }
          if (resumedEvents >= 2 || ev.event_type === "interaction.completed") {
            resumeCtl.abort();
            break;
          }
        }
      } catch {
        // expected abort after verifying stream resume
      }

      // Ensure the interaction in sharedEnvId is cancelled before Check 7 deletes sharedEnvId
      if (iid) {
        await ma.interactions.cancel(iid).catch(() => {});
      }

      const latency6Ms = Math.round(performance.now() - t6);
      const pass6 = Boolean(iid && lastEventId && resumedEvents >= 1 && duplicateCount === 0);
      recordResult(6, {
        status: pass6 ? "pass" : "fail",
        latencyMs: latency6Ms,
        details: {
          interactionId: iid,
          lastEventId,
          eventsBeforeDrop,
          resumedEvents,
          duplicateCount,
        },
      });
    } catch (err: unknown) {
      recordResult(6, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t6),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check 7: environments.delete(env)
    recordResult(7, { status: "running" });
    const t7 = performance.now();
    try {
      if (!sharedEnvId) throw new Error("No environmentId from Check 3");
      await ma.environments.delete(sharedEnvId);
      const list = await ma.environments.list();
      const stillPresent = list.some((e) => (e.id || e.name || "").includes(sharedEnvId!));
      const latencyMs = Math.round(performance.now() - t7);
      recordResult(7, {
        status: !stillPresent ? "pass" : "fail",
        latencyMs,
        details: {
          deletedEnvId: sharedEnvId,
          stillInList: stillPresent,
        },
      });
    } catch (err: unknown) {
      recordResult(7, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t7),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Wait for Check 8 to finish before running Check 9
    await check8Promise;

    // Check 9: Proxy guardrails (run last, without admin token)
    recordResult(9, { status: "running" });
    const t9 = performance.now();
    try {
      setAdminToken(undefined);

      await fetch("api/admin/reset-caps", {
        method: "POST",
        headers: { "x-admin-token": adminTok, "x-selftest": "1" },
      });

      const resNoTokens = await fetch("api/gemini/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: CONFIG.GAMESMITH_AGENT, input: "hi" }),
      });

      const resWrongAgent = await fetch("api/gemini/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "rogue-agent",
          input: "hi",
          agent_config: { type: "antigravity", model: CONFIG.AGENT_MODEL, max_total_tokens: 100000 },
        }),
      });

      const buildStatuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await fetch("api/gemini/v1beta/interactions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-guardrail-probe": "1",
          },
          body: JSON.stringify({
            agent: CONFIG.GAMESMITH_AGENT,
            input: "hi",
            agent_config: { type: "antigravity", model: CONFIG.AGENT_MODEL, max_total_tokens: 100000 },
          }),
        });
        buildStatuses.push(r.status);
      }

      const resReset = await fetch("api/admin/reset-caps", {
        method: "POST",
        headers: { "x-admin-token": adminTok, "x-selftest": "1" },
      });

      setAdminToken(adminTok || undefined);

      const latencyMs = Math.round(performance.now() - t9);
      const pass =
        resNoTokens.status === 400 &&
        resWrongAgent.status === 403 &&
        buildStatuses[0] === 200 &&
        buildStatuses[1] === 200 &&
        buildStatuses[2] === 200 &&
        buildStatuses[3] === 429 &&
        resReset.status === 200;

      recordResult(9, {
        status: pass ? "pass" : "fail",
        latencyMs,
        details: {
          noTokensStatus: resNoTokens.status,
          wrongAgentStatus: resWrongAgent.status,
          buildStatuses,
          resetCapsStatus: resReset.status,
        },
      });
    } catch (err: unknown) {
      setAdminToken(adminTok || undefined);
      recordResult(9, {
        status: "fail",
        latencyMs: Math.round(performance.now() - t9),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    window.__SELFTEST_RESULTS__ = finalResults;
    setDone(true);
    runningRef.current = false;
  };

  useEffect(() => {
    runAll();
  }, []);

  const passCount = checks.filter((c) => c.status === "pass").length;
  const allPass = done && passCount === checks.length;

  return (
    <main
      id="selftest-page"
      data-selftest-done={done ? "true" : "false"}
      data-selftest-pass={allPass ? "true" : "false"}
      style={{
        minHeight: "100vh",
        background: "#140A0C",
        color: "#FFF1E8",
        fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
        padding: "40px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 800, fontSize: "14px" }}>
          <span
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#FFEC27",
              boxShadow: "0 0 18px rgba(255,236,39,.6)",
              display: "inline-block",
            }}
          />
          playglow · selftest
        </div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "14px", color: "rgba(255,241,232,.56)" }}>
          {done ? `${passCount} / ${checks.length} passed` : "running checks…"}
        </div>
      </header>

      <h1 style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.025em", marginBottom: "24px" }}>
        {done
          ? allPass
            ? "all 9 smoke checks passed."
            : `${passCount} of ${checks.length} checks passed.`
          : "verifying gemini proxy & cart sandbox…"}
      </h1>

      <div
        style={{
          background: "rgba(22,11,13,.5)",
          border: "1px solid rgba(255,241,232,.14)",
          borderRadius: "16px",
          overflow: "hidden",
          marginBottom: "24px",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,241,232,.14)", textAlign: "left" }}>
              <th style={{ padding: "12px 16px", width: "48px", fontFamily: '"JetBrains Mono", monospace' }}>#</th>
              <th style={{ padding: "12px 16px" }}>check</th>
              <th style={{ padding: "12px 16px", width: "110px" }}>status</th>
              <th style={{ padding: "12px 16px", width: "110px", fontFamily: '"JetBrains Mono", monospace' }}>latency</th>
              <th style={{ padding: "12px 16px" }}>details</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr
                key={c.num}
                data-check-num={c.num}
                data-check-status={c.status}
                style={{ borderBottom: "1px solid rgba(255,241,232,.08)" }}
              >
                <td style={{ padding: "12px 16px", fontFamily: '"JetBrains Mono", monospace', color: "rgba(255,241,232,.56)" }}>
                  {c.num}
                </td>
                <td style={{ padding: "12px 16px", fontWeight: 700 }}>{c.name}</td>
                <td style={{ padding: "12px 16px", fontFamily: '"JetBrains Mono", monospace' }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "999px",
                      fontSize: "12px",
                      background:
                        c.status === "pass"
                          ? "rgba(0,228,54,.2)"
                          : c.status === "fail"
                          ? "rgba(255,0,77,.25)"
                          : c.status === "running"
                          ? "rgba(255,236,39,.2)"
                          : "rgba(255,241,232,.08)",
                      color:
                        c.status === "pass"
                          ? "#00E436"
                          : c.status === "fail"
                          ? "#FF004D"
                          : c.status === "running"
                          ? "#FFEC27"
                          : "rgba(255,241,232,.56)",
                    }}
                  >
                    {c.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", fontFamily: '"JetBrains Mono", monospace', color: "rgba(255,241,232,.75)" }}>
                  {c.latencyMs !== undefined ? `${c.latencyMs} ms` : "—"}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "12px",
                    color: c.error ? "#FF6E59" : "rgba(255,241,232,.68)",
                    wordBreak: "break-word",
                  }}
                >
                  {c.error ? c.error : c.details ? JSON.stringify(c.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done && (
        <button
          id="selftest-rerun-btn"
          onClick={runAll}
          style={{
            height: "48px",
            padding: "0 24px",
            borderRadius: "999px",
            border: 0,
            background: "#FFEC27",
            color: "#1a0c0f",
            fontWeight: 700,
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          re-run checks →
        </button>
      )}
    </main>
  );
};

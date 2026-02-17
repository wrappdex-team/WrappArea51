// ══════════════════════════════════════════════════════════════════════
// Circuit Breaker — Unit Tests
// ══════════════════════════════════════════════════════════════════════
//
// Validates the three-state (CLOSED / OPEN / HALF_OPEN) circuit breaker
// that protects external service calls (SaucerSwap, Mirror Node,
// CoinGecko, 1inch). Uses short durations (50-100ms) for fast execution.
//
// Covers:
//   1. Initial state and CLOSED behavior
//   2. CLOSED → OPEN transition (failure threshold)
//   3. Rolling failure window (time-based expiry)
//   4. OPEN behavior (immediate rejection)
//   5. OPEN → HALF_OPEN transition (cooldown elapsed)
//   6. HALF_OPEN → CLOSED (probe success)
//   7. HALF_OPEN → OPEN (probe failure)
//   8. HALF_OPEN concurrency guard (single probe)
//   9. isFailure classifier (HTTP 5xx/429 detection)
//  10. getStatus() reporting accuracy
//  11. isHttpFailure classifier (shared helper)
//
// Run:  deno test supabase/functions/server/circuit-breaker.test.ts
// ══════════════════════════════════════════════════════════════════════

import {
  assertEquals,
  assert,
  assertRejects,
} from "jsr:@std/assert";

import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  isHttpFailure,
} from "./shared.ts";
import type { CircuitBreakerConfig } from "./shared.ts";


// ── Helpers ─────────────────────────────────────────────────────────

/** Short-lived breaker for tests: trips after 3 failures in 500ms, 100ms cooldown. */
function testBreaker(overrides?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker({
    name: "TestService",
    failureThreshold: 3,
    failureWindowMs: 500,
    openDurationMs: 100,
    ...overrides,
  });
}

/** Deterministic delay. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A function that always succeeds. */
const succeed = () => Promise.resolve("ok");

/** A function that always throws. */
const fail = () => Promise.reject(new Error("service unavailable"));

/** Drive the breaker to OPEN state by exhausting the failure threshold. */
async function driveToOpen(breaker: CircuitBreaker, threshold = 3): Promise<void> {
  for (let i = 0; i < threshold; i++) {
    try { await breaker.call(fail); } catch { /* expected */ }
  }
  assertEquals(breaker.currentState, "OPEN");
}


// ── 1. Initial State ────────────────────────────────────────────────

Deno.test("CircuitBreaker — initial state", async (t) => {

  await t.step("starts in CLOSED state", () => {
    const b = testBreaker();
    assertEquals(b.currentState, "CLOSED");
  });

  await t.step("getStatus reports CLOSED with 0 failures", () => {
    const b = testBreaker();
    const s = b.getStatus();
    assertEquals(s.state, "CLOSED");
    assertEquals(s.failures, 0);
    assertEquals(s.openedAt, null);
    assertEquals(s.nextProbeAt, null);
    assertEquals(s.service, "TestService");
  });

  await t.step("successful calls do not change state", async () => {
    const b = testBreaker();
    const result = await b.call(succeed);
    assertEquals(result, "ok");
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 2. CLOSED → OPEN Transition ─────────────────────────────────────

Deno.test("CircuitBreaker — CLOSED → OPEN", async (t) => {

  await t.step("N-1 failures do not trip the breaker", async () => {
    const b = testBreaker({ failureThreshold: 3 });
    try { await b.call(fail); } catch { /* 1 */ }
    try { await b.call(fail); } catch { /* 2 */ }
    assertEquals(b.currentState, "CLOSED");
    assertEquals(b.getStatus().failures, 2);
  });

  await t.step("Nth failure trips to OPEN", async () => {
    const b = testBreaker({ failureThreshold: 3 });
    await driveToOpen(b, 3);
    assertEquals(b.currentState, "OPEN");
  });

  await t.step("failures are counted correctly (exact threshold)", async () => {
    const counts = [1, 2, 5, 10];
    for (const threshold of counts) {
      const b = testBreaker({ failureThreshold: threshold });
      for (let i = 0; i < threshold - 1; i++) {
        try { await b.call(fail); } catch { /* expected */ }
        assertEquals(b.currentState, "CLOSED", `Should remain CLOSED at ${i + 1}/${threshold}`);
      }
      try { await b.call(fail); } catch { /* expected */ }
      assertEquals(b.currentState, "OPEN", `Should trip at ${threshold}/${threshold}`);
    }
  });

  await t.step("failed call rethrows the original error", async () => {
    const b = testBreaker();
    await assertRejects(
      () => b.call(() => Promise.reject(new Error("db connection refused"))),
      Error,
      "db connection refused",
    );
  });
});


// ── 3. Rolling Failure Window ───────────────────────────────────────

Deno.test("CircuitBreaker — rolling failure window", async (t) => {

  await t.step("old failures expire and do not count toward threshold", async () => {
    const b = testBreaker({ failureThreshold: 3, failureWindowMs: 100 });

    // Record 2 failures
    try { await b.call(fail); } catch { /* 1 */ }
    try { await b.call(fail); } catch { /* 2 */ }

    // Wait for failures to expire
    await sleep(150);

    // Record 1 more — only this one is in the window (total in window: 1, not 3)
    try { await b.call(fail); } catch { /* 3 overall, but only 1 in window */ }
    assertEquals(b.currentState, "CLOSED", "Expired failures should not count");
  });

  await t.step("failures within window accumulate correctly", async () => {
    const b = testBreaker({ failureThreshold: 3, failureWindowMs: 1000 });

    // All 3 within window → should trip
    try { await b.call(fail); } catch { /* 1 */ }
    try { await b.call(fail); } catch { /* 2 */ }
    try { await b.call(fail); } catch { /* 3 */ }

    assertEquals(b.currentState, "OPEN");
  });
});


// ── 4. OPEN State Behavior ──────────────────────────────────────────

Deno.test("CircuitBreaker — OPEN behavior", async (t) => {

  await t.step("immediately rejects calls with CircuitBreakerOpenError", async () => {
    const b = testBreaker();
    await driveToOpen(b);

    await assertRejects(
      () => b.call(succeed),
      CircuitBreakerOpenError,
    );
  });

  await t.step("does NOT execute the wrapped function when OPEN", async () => {
    const b = testBreaker();
    await driveToOpen(b);

    let executed = false;
    try {
      await b.call(async () => { executed = true; return "should not run"; });
    } catch { /* expected CircuitBreakerOpenError */ }

    assertEquals(executed, false, "Function should not execute when breaker is OPEN");
  });

  await t.step("error has correct service name and code", async () => {
    const b = testBreaker({ name: "SaucerSwap" });
    await driveToOpen(b);

    try {
      await b.call(succeed);
      assert(false, "Should have thrown");
    } catch (err) {
      assert(err instanceof CircuitBreakerOpenError);
      assertEquals(err.service, "SaucerSwap");
      assertEquals(err.code, "CIRCUIT_OPEN");
      assert(err.message.includes("SaucerSwap"));
    }
  });

  await t.step("getStatus reports OPEN with openedAt and nextProbeAt", async () => {
    const b = testBreaker({ openDurationMs: 200 });
    const before = Date.now();
    await driveToOpen(b);
    const s = b.getStatus();

    assertEquals(s.state, "OPEN");
    assert(s.openedAt !== null && s.openedAt >= before);
    assert(s.nextProbeAt !== null && s.nextProbeAt > s.openedAt!);
  });
});


// ── 5. OPEN → HALF_OPEN Transition ──────────────────────────────────

Deno.test("CircuitBreaker — OPEN → HALF_OPEN", async (t) => {

  await t.step("does not transition before cooldown expires", async () => {
    const b = testBreaker({ openDurationMs: 200 });
    await driveToOpen(b);
    await sleep(50); // Only 50ms of 200ms cooldown

    // Should still be OPEN
    await assertRejects(
      () => b.call(succeed),
      CircuitBreakerOpenError,
    );
  });

  await t.step("transitions to HALF_OPEN after cooldown", async () => {
    const b = testBreaker({ openDurationMs: 80 });
    await driveToOpen(b);
    await sleep(100); // Past the 80ms cooldown

    // Next call should go through (HALF_OPEN probe)
    const result = await b.call(succeed);
    assertEquals(result, "ok");
    // And now it should be CLOSED again (probe succeeded)
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 6. HALF_OPEN → CLOSED (Probe Success) ──────────────────────────

Deno.test("CircuitBreaker — HALF_OPEN → CLOSED on probe success", async (t) => {

  await t.step("successful probe resets to CLOSED with 0 failures", async () => {
    const b = testBreaker({ openDurationMs: 50 });
    await driveToOpen(b);
    await sleep(70);

    // Probe succeeds → transitions to CLOSED
    await b.call(succeed);
    assertEquals(b.currentState, "CLOSED");

    const s = b.getStatus();
    assertEquals(s.failures, 0);
    assertEquals(s.openedAt, null);
  });

  await t.step("after recovery, normal operation resumes", async () => {
    const b = testBreaker({ openDurationMs: 50 });
    await driveToOpen(b);
    await sleep(70);

    // Probe succeeds
    await b.call(succeed);

    // Normal calls should work again
    for (let i = 0; i < 5; i++) {
      const result = await b.call(succeed);
      assertEquals(result, "ok");
    }
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 7. HALF_OPEN → OPEN (Probe Failure) ─────────────────────────────

Deno.test("CircuitBreaker — HALF_OPEN → OPEN on probe failure", async (t) => {

  await t.step("failed probe returns to OPEN with reset cooldown", async () => {
    const b = testBreaker({ openDurationMs: 50 });
    await driveToOpen(b);
    await sleep(70);

    // Probe fails → back to OPEN
    try { await b.call(fail); } catch { /* expected */ }
    assertEquals(b.currentState, "OPEN");
  });

  await t.step("cooldown timer resets after probe failure", async () => {
    const b = testBreaker({ openDurationMs: 80 });
    await driveToOpen(b);
    await sleep(100); // Past first cooldown

    // Probe fails → OPEN again with fresh cooldown
    const beforeProbe = Date.now();
    try { await b.call(fail); } catch { /* expected */ }

    const s = b.getStatus();
    assertEquals(s.state, "OPEN");
    assert(s.openedAt !== null && s.openedAt >= beforeProbe, "openedAt should be reset");
  });

  await t.step("multiple probe failures keep extending OPEN period", async () => {
    const b = testBreaker({ openDurationMs: 50 });

    // First trip
    await driveToOpen(b);
    await sleep(70);

    // First probe fails
    try { await b.call(fail); } catch { /* expected */ }
    assertEquals(b.currentState, "OPEN");

    // Wait for second cooldown
    await sleep(70);

    // Second probe also fails
    try { await b.call(fail); } catch { /* expected */ }
    assertEquals(b.currentState, "OPEN");

    // Wait again and succeed
    await sleep(70);
    await b.call(succeed);
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 8. HALF_OPEN Concurrency Guard ──────────────────────────────────

Deno.test("CircuitBreaker — HALF_OPEN concurrency guard", async (t) => {

  await t.step("rejects second call while probe is in flight", async () => {
    const b = testBreaker({ openDurationMs: 50 });
    await driveToOpen(b);
    await sleep(70);

    // Start a slow probe (takes 200ms)
    const probePromise = b.call(() => sleep(200).then(() => "probe-ok"));

    // Second call should be rejected immediately
    await assertRejects(
      () => b.call(succeed),
      CircuitBreakerOpenError,
    );

    // Original probe completes and transitions to CLOSED
    const result = await probePromise;
    assertEquals(result, "probe-ok");
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 9. isFailure Classifier ─────────────────────────────────────────

Deno.test("CircuitBreaker — isFailure classifier", async (t) => {

  await t.step("counts result as failure when isFailure returns true", async () => {
    const b = testBreaker({ failureThreshold: 2 });

    // Return "bad" results that are classified as failures
    await b.call(() => Promise.resolve(500), (status) => status >= 500);
    assertEquals(b.currentState, "CLOSED"); // 1 failure, need 2

    await b.call(() => Promise.resolve(503), (status) => status >= 500);
    assertEquals(b.currentState, "OPEN"); // 2 failures → tripped
  });

  await t.step("still returns the result even when classified as failure", async () => {
    const b = testBreaker({ failureThreshold: 5 }); // Won't trip in this test

    const result = await b.call(
      () => Promise.resolve({ status: 503, body: "error" }),
      (r) => r.status >= 500,
    );

    assertEquals(result.status, 503);
    assertEquals(result.body, "error");
  });

  await t.step("does not count as failure when isFailure returns false", async () => {
    const b = testBreaker({ failureThreshold: 2 });

    // 200 OK — not a failure
    await b.call(() => Promise.resolve(200), (status) => status >= 500);
    await b.call(() => Promise.resolve(404), (status) => status >= 500);

    assertEquals(b.currentState, "CLOSED");
    assertEquals(b.getStatus().failures, 0);
  });

  await t.step("isFailure in HALF_OPEN: failed probe → OPEN", async () => {
    const b = testBreaker({ openDurationMs: 50, failureThreshold: 1 });

    // Trip with 1 failure
    try { await b.call(fail); } catch { /* expected */ }
    assertEquals(b.currentState, "OPEN");

    // Wait for cooldown
    await sleep(70);

    // Probe returns 503 → isFailure classifies it → back to OPEN
    const result = await b.call(
      () => Promise.resolve(503),
      (status) => status >= 500,
    );
    assertEquals(result, 503); // Result still returned
    assertEquals(b.currentState, "OPEN"); // But breaker went back to OPEN
  });
});


// ── 10. getStatus() Reporting ───────────────────────────────────────

Deno.test("CircuitBreaker — getStatus reporting", async (t) => {

  await t.step("CLOSED: accurate failure count", async () => {
    const b = testBreaker({ failureThreshold: 5 });
    try { await b.call(fail); } catch { /* 1 */ }
    try { await b.call(fail); } catch { /* 2 */ }

    const s = b.getStatus();
    assertEquals(s.state, "CLOSED");
    assertEquals(s.failures, 2);
  });

  await t.step("OPEN: failures reset to 0 (moved to state)", async () => {
    const b = testBreaker({ failureThreshold: 3 });
    await driveToOpen(b);

    const s = b.getStatus();
    assertEquals(s.state, "OPEN");
    assertEquals(s.failures, 0); // Cleared on transition
  });

  await t.step("OPEN: nextProbeAt = openedAt + openDurationMs", async () => {
    const b = testBreaker({ openDurationMs: 5000 });
    await driveToOpen(b);

    const s = b.getStatus();
    assert(s.openedAt !== null);
    assert(s.nextProbeAt !== null);
    assertEquals(s.nextProbeAt, s.openedAt! + 5000);
  });

  await t.step("CLOSED: openedAt and nextProbeAt are null", () => {
    const b = testBreaker();
    const s = b.getStatus();
    assertEquals(s.openedAt, null);
    assertEquals(s.nextProbeAt, null);
  });

  await t.step("service name propagates correctly", () => {
    const b = testBreaker({ name: "MirrorNode" });
    assertEquals(b.getStatus().service, "MirrorNode");
  });
});


// ── 11. isHttpFailure Shared Helper ─────────────────────────────────

Deno.test("isHttpFailure classifier", async (t) => {

  await t.step("500 → true (Internal Server Error)", () => {
    assert(isHttpFailure({ status: 500 } as Response));
  });

  await t.step("502 → true (Bad Gateway)", () => {
    assert(isHttpFailure({ status: 502 } as Response));
  });

  await t.step("503 → true (Service Unavailable)", () => {
    assert(isHttpFailure({ status: 503 } as Response));
  });

  await t.step("504 → true (Gateway Timeout)", () => {
    assert(isHttpFailure({ status: 504 } as Response));
  });

  await t.step("429 → true (Too Many Requests)", () => {
    assert(isHttpFailure({ status: 429 } as Response));
  });

  await t.step("200 → false (OK)", () => {
    assert(!isHttpFailure({ status: 200 } as Response));
  });

  await t.step("201 → false (Created)", () => {
    assert(!isHttpFailure({ status: 201 } as Response));
  });

  await t.step("400 → false (Bad Request — client error, not service failure)", () => {
    assert(!isHttpFailure({ status: 400 } as Response));
  });

  await t.step("401 → false (Unauthorized — not a service outage)", () => {
    assert(!isHttpFailure({ status: 401 } as Response));
  });

  await t.step("404 → false (Not Found — valid response, service is healthy)", () => {
    assert(!isHttpFailure({ status: 404 } as Response));
  });

  await t.step("499 → false (boundary: last non-5xx status)", () => {
    assert(!isHttpFailure({ status: 499 } as Response));
  });
});


// ── 12. Full Lifecycle Integration ──────────────────────────────────

Deno.test("CircuitBreaker — full lifecycle", async (t) => {

  await t.step("CLOSED → OPEN → HALF_OPEN → CLOSED → normal", async () => {
    const b = testBreaker({ failureThreshold: 2, openDurationMs: 60 });

    // Phase 1: CLOSED — normal operation
    assertEquals(await b.call(succeed), "ok");
    assertEquals(b.currentState, "CLOSED");

    // Phase 2: CLOSED → OPEN — failures trip the breaker
    try { await b.call(fail); } catch { /* 1 */ }
    try { await b.call(fail); } catch { /* 2 — trips */ }
    assertEquals(b.currentState, "OPEN");

    // Phase 3: OPEN — immediate rejection
    await assertRejects(() => b.call(succeed), CircuitBreakerOpenError);

    // Phase 4: OPEN → HALF_OPEN — cooldown elapses
    await sleep(80);

    // Phase 5: HALF_OPEN → CLOSED — probe succeeds
    assertEquals(await b.call(succeed), "ok");
    assertEquals(b.currentState, "CLOSED");

    // Phase 6: Back to normal — full operation resumes
    assertEquals(await b.call(succeed), "ok");
    assertEquals(await b.call(succeed), "ok");
    assertEquals(b.currentState, "CLOSED");
    assertEquals(b.getStatus().failures, 0);
  });

  await t.step("CLOSED → OPEN → HALF_OPEN → OPEN → HALF_OPEN → CLOSED", async () => {
    const b = testBreaker({ failureThreshold: 2, openDurationMs: 50 });

    // Trip the breaker
    await driveToOpen(b, 2);

    // Wait for cooldown
    await sleep(70);

    // Probe fails — back to OPEN
    try { await b.call(fail); } catch { /* probe failed */ }
    assertEquals(b.currentState, "OPEN");

    // Wait for second cooldown
    await sleep(70);

    // Probe succeeds — CLOSED
    await b.call(succeed);
    assertEquals(b.currentState, "CLOSED");
  });
});


// ── 13. Pre-configured Instance Smoke Test ──────────────────────────

Deno.test("Pre-configured breaker instances", async (t) => {

  // Import the actual singleton instances used in production
  const { saucerswapBreaker, mirrorNodeBreaker, coingeckoBreaker, oneInchBreaker } = await import("./shared.ts");

  await t.step("all breakers start CLOSED", () => {
    assertEquals(saucerswapBreaker.currentState, "CLOSED");
    assertEquals(mirrorNodeBreaker.currentState, "CLOSED");
    assertEquals(coingeckoBreaker.currentState, "CLOSED");
    assertEquals(oneInchBreaker.currentState, "CLOSED");
  });

  await t.step("all breakers report correct service names", () => {
    assertEquals(saucerswapBreaker.getStatus().service, "SaucerSwap");
    assertEquals(mirrorNodeBreaker.getStatus().service, "MirrorNode");
    assertEquals(coingeckoBreaker.getStatus().service, "CoinGecko");
    assertEquals(oneInchBreaker.getStatus().service, "1inch");
  });
});

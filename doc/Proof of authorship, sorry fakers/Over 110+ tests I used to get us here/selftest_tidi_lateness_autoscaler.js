/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const tidiAutoscaler = require(path.join(__dirname, "../../server/src/utils/tidiAutoscaler"));

const TARGET_TICK_INTERVAL_MS = runtime._testing.RUNTIME_TICK_INTERVAL_MS;

function pushIntervals(intervals, state, options = {}) {
  let lastResult = null;
  const shouldSchedule = options.schedule === true;
  const observeOptions = {
    logChange: false,
    schedule: shouldSchedule,
    ...options,
  };
  for (const intervalMs of intervals) {
    state.monotonicMs += intervalMs;
    lastResult = tidiAutoscaler._testing.observeRuntimeTickSample(
      {
        startedAtMonotonicMs: state.monotonicMs,
        actualIntervalMs: intervalMs,
        targetTickIntervalMs: TARGET_TICK_INTERVAL_MS,
        tickDurationMs: Math.max(1, intervalMs - 10),
        sceneCount: 3,
      },
      observeOptions,
    );
  }
  return lastResult;
}

function main() {
  tidiAutoscaler._testing.resetState();
  const state = { monotonicMs: 0 };

  let result = pushIntervals(new Array(11).fill(TARGET_TICK_INTERVAL_MS), state);
  assert(result, "expected healthy control window result");
  assert.strictEqual(result.changed, false, "healthy tick cadence should not enable TiDi");
  assert.strictEqual(
    tidiAutoscaler._testing.getCurrentFactor(),
    1.0,
    "healthy tick cadence should keep factor at 1.0",
  );

  result = pushIntervals(new Array(11).fill(109), state);
  assert(result, "expected jitter control window result");
  assert.strictEqual(result.changed, false, "normal 8-10ms scheduler jitter should not enable TiDi");
  assert.strictEqual(
    tidiAutoscaler._testing.getCurrentFactor(),
    1.0,
    "normal scheduler jitter should stay at full speed",
  );

  result = pushIntervals(new Array(10).fill(123), state);
  assert(result, "expected mild overload control window result");
  assert.strictEqual(result.changed, true, "sustained 20ms+ lateness should tighten TiDi");
  assert.strictEqual(result.reason, "tighten");
  assert.strictEqual(result.factor, 0.971, "123ms average on a 100ms tick should begin TiDi past the 20ms deadzone");
  assert.strictEqual(
    tidiAutoscaler._testing.getCurrentFactor(),
    0.971,
    "mild real lateness should update the active autoscaler factor",
  );

  result = pushIntervals(new Array(6).fill(TARGET_TICK_INTERVAL_MS * 2), state);
  assert(result, "expected overloaded control window result");
  assert.strictEqual(result.changed, true, "sustained late ticks should tighten TiDi");
  assert.strictEqual(result.reason, "tighten");
  assert.strictEqual(result.factor, 0.556, "200ms average on a 100ms tick should clamp to 55.6% TiDi after the 20ms deadzone");
  assert.strictEqual(
    tidiAutoscaler._testing.getCurrentFactor(),
    0.556,
    "tighten window should update the active autoscaler factor",
  );

  result = pushIntervals(new Array(11).fill(TARGET_TICK_INTERVAL_MS), state);
  assert(result, "expected first recovery control window result");
  assert.strictEqual(
    result.changed,
    false,
    "one healthy recovery window should not immediately clear TiDi",
  );
  assert.strictEqual(result.reason, "await-relax-confirmation");
  assert.strictEqual(
    tidiAutoscaler._testing.getCurrentFactor(),
    0.556,
    "factor should stay dilated until healthy recovery is confirmed",
  );

  result = pushIntervals(new Array(11).fill(TARGET_TICK_INTERVAL_MS), state);
  assert(result, "expected second recovery control window result");
  assert.strictEqual(result.changed, true, "second healthy recovery window should clear TiDi");
  assert.strictEqual(result.reason, "relax");
  assert.strictEqual(result.factor, 1.0);
  assert.strictEqual(tidiAutoscaler._testing.getCurrentFactor(), 1.0);

  tidiAutoscaler._testing.resetState();
  const transitionState = { monotonicMs: 0 };
  let scheduledCallback = null;
  result = pushIntervals(new Array(6).fill(TARGET_TICK_INTERVAL_MS * 2), transitionState, {
    schedule: true,
    getSystemIDs: () => [30000142, 30000145],
    notifySystemFn: () => {},
    applySystemFactorFn: () => {},
    setTimeoutFn: (callback) => {
      scheduledCallback = callback;
      return { unref() {} };
    },
  });
  assert.strictEqual(result.changed, true, "overload should still schedule a TiDi transition");
  assert(scheduledCallback, "expected delayed TiDi apply callback to be scheduled");
  let lockState = tidiAutoscaler._testing.getTransitionLockState(result.metrics.endedAtMonotonicMs);
  assert(lockState, "expected TiDi transition lock while the apply is pending");
  assert.strictEqual(lockState.phase, "pending");

  result = pushIntervals(new Array(11).fill(TARGET_TICK_INTERVAL_MS), transitionState);
  assert.strictEqual(
    result.changed,
    false,
    "autoscaler must not announce another TiDi move while a pending change exists",
  );
  assert.strictEqual(result.reason, "transition-pending");

  scheduledCallback();
  lockState = tidiAutoscaler._testing.getTransitionLockState(transitionState.monotonicMs + 1);
  assert(lockState, "expected TiDi transition lock after the apply landed");
  assert.strictEqual(lockState.phase, "hold");

  result = pushIntervals(new Array(11).fill(TARGET_TICK_INTERVAL_MS), transitionState);
  assert.strictEqual(
    result.changed,
    false,
    "autoscaler must hold the new TiDi level for a few seconds after apply",
  );
  assert.strictEqual(result.reason, "transition-hold");

  tidiAutoscaler._testing.resetState();
  tidiAutoscaler.setManualOverride(30000142, 0.7);
  const manualOverrideState = { monotonicMs: 0 };
  let scheduledSystems = null;
  result = pushIntervals(new Array(6).fill(TARGET_TICK_INTERVAL_MS * 2), manualOverrideState, {
    schedule: true,
    getSystemIDs: () => [30000142, 30000145],
    scheduleChange: (systemIDs) => {
      scheduledSystems = [...systemIDs];
      return null;
    },
  });
  assert.strictEqual(result.changed, true, "manual override should not disable autoscaling for other systems");
  assert.deepStrictEqual(
    scheduledSystems,
    [30000145],
    "autoscaler should exclude manually overridden solar systems from automatic TiDi changes",
  );

  console.log("selftest_tidi_lateness_autoscaler: ok");
}

main();

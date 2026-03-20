"use strict";

const path = require("path");
const os = require("os");
const pc = require("picocolors");

const log = require(path.join(__dirname, "./logger"));
const config = require(path.join(__dirname, "../config"));
const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
const {
  TIDI_ADVANCE_NOTICE_MS,
  scheduleAdvanceNoticeTimeDilationForSystems,
} = require(path.join(__dirname, "./synchronizedTimeDilation"));

const POLL_INTERVAL_MS = 10000;
const CPU_FLOOR = 60;
const CPU_CEIL = 95;
const EPSILON = 0.02;
const RELAX_CONFIRM_POLLS = 2;

function cpuToFactor(cpuPercent) {
  if (cpuPercent <= CPU_FLOOR) return 1.0;
  if (cpuPercent >= CPU_CEIL) return 0.1;
  const t = (cpuPercent - CPU_FLOOR) / (CPU_CEIL - CPU_FLOOR);
  return Math.round((1.0 - t * 0.9) * 1000) / 1000;
}

let prevSnapshot = os.cpus();
let prevProcessCpuUsage = process.cpuUsage();
let prevProcessCpuTimeNs = process.hrtime.bigint();

function getSystemCpuPercent() {
  const curr = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < curr.length; i += 1) {
    const prev = prevSnapshot[i].times;
    const now = curr[i].times;
    const idle = now.idle - prev.idle;
    const total = (now.user + now.nice + now.sys + now.irq + now.idle)
      - (prev.user + prev.nice + prev.sys + prev.irq + prev.idle);
    idleDelta += idle;
    totalDelta += total;
  }
  prevSnapshot = curr;
  return totalDelta > 0 ? 100 * (1 - idleDelta / totalDelta) : 0;
}

function getProcessCpuPercent() {
  const currProcessCpuUsage = process.cpuUsage();
  const currProcessCpuTimeNs = process.hrtime.bigint();
  const elapsedMicros = Number(
    (currProcessCpuTimeNs - prevProcessCpuTimeNs) / 1000n,
  );
  const cpuMicros =
    (currProcessCpuUsage.user - prevProcessCpuUsage.user)
    + (currProcessCpuUsage.system - prevProcessCpuUsage.system);

  prevProcessCpuUsage = currProcessCpuUsage;
  prevProcessCpuTimeNs = currProcessCpuTimeNs;

  return elapsedMicros > 0 ? (cpuMicros / elapsedMicros) * 100 : 0;
}

const LABEL = pc.bgCyan(pc.black(" TIDI "));

function logTidiChange(cpuPercent, previousFactor, newFactor, sceneCount) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const arrow = newFactor < previousFactor ? pc.red("v") : pc.green("^");
  const factorStr = newFactor >= 1.0
    ? pc.green("1.000")
    : pc.yellow(newFactor.toFixed(3));
  const cpuStr = cpuPercent >= CPU_CEIL
    ? pc.red(`${cpuPercent.toFixed(1)}%`)
    : cpuPercent >= CPU_FLOOR
      ? pc.yellow(`${cpuPercent.toFixed(1)}%`)
      : pc.green(`${cpuPercent.toFixed(1)}%`);

  const detail = newFactor >= 1.0
    ? `${arrow} TiDi cleared - factor ${factorStr} (cpu ${cpuStr})`
    : `${arrow} factor ${factorStr} (cpu ${cpuStr}, ${sceneCount} scene${sceneCount !== 1 ? "s" : ""})`;

  log.flushStack();
  console.log(`${pc.dim(timestamp)} ${LABEL} ${detail}`);
}

let currentFactor = 1.0;
let handle = null;
let pendingRelaxFactor = null;
let pendingRelaxPolls = 0;
let manualOverride = null;

function resetRelaxationState() {
  pendingRelaxFactor = null;
  pendingRelaxPolls = 0;
}

function setManualOverride(systemID, factor) {
  manualOverride = {
    systemID: Number(systemID) || 0,
    factor: Math.min(1.0, Math.max(0.1, Number(factor) || 1.0)),
  };
  currentFactor = manualOverride.factor;
  resetRelaxationState();
  return { ...manualOverride };
}

function clearManualOverride(systemID, options = {}) {
  if (
    manualOverride &&
    Number(systemID) > 0 &&
    Number(manualOverride.systemID) !== Number(systemID)
  ) {
    return false;
  }

  manualOverride = null;
  if (Number.isFinite(Number(options.resumeFactor))) {
    currentFactor = Math.min(1.0, Math.max(0.1, Number(options.resumeFactor)));
  }
  resetRelaxationState();
  return true;
}

function scheduleAutoscaledFactorChange(factor, options = {}) {
  const systemIDs = typeof options.getSystemIDs === "function"
    ? options.getSystemIDs()
    : [...spaceRuntime.scenes.keys()];
  const schedule = typeof options.scheduleChange === "function"
    ? options.scheduleChange
    : (targetSystemIDs, targetFactor) => scheduleAdvanceNoticeTimeDilationForSystems(
      targetSystemIDs,
      targetFactor,
      { delayMs: TIDI_ADVANCE_NOTICE_MS },
    );
  return schedule(systemIDs, factor);
}

function commitFactorChange(cpuPercent, factor, options = {}) {
  const previousFactor = currentFactor;
  currentFactor = factor;
  resetRelaxationState();

  const sceneCount = typeof options.getSceneCount === "function"
    ? options.getSceneCount()
    : spaceRuntime.scenes.size;
  if (options.logChange !== false) {
    logTidiChange(cpuPercent, previousFactor, factor, sceneCount);
  }

  scheduleAutoscaledFactorChange(factor, options);
  return {
    changed: true,
    previousFactor,
    factor,
    sceneCount,
  };
}

function evaluateMeasuredCpuPercent(cpuPercent, options = {}) {
  if (manualOverride) {
    resetRelaxationState();
    return {
      changed: false,
      factor: currentFactor,
      cpuPercent,
      reason: "manual-override",
    };
  }

  const targetFactor = cpuToFactor(cpuPercent);
  const factor = targetFactor;

  if (Math.abs(factor - currentFactor) < EPSILON) {
    resetRelaxationState();
    return {
      changed: false,
      factor: currentFactor,
      cpuPercent,
      targetFactor,
      reason: "stable",
    };
  }

  if (factor < currentFactor) {
    return {
      ...commitFactorChange(cpuPercent, factor, options),
      cpuPercent,
      targetFactor,
      reason: "tighten",
    };
  }

  pendingRelaxFactor = factor;
  pendingRelaxPolls += 1;
  if (pendingRelaxPolls < RELAX_CONFIRM_POLLS) {
    return {
      changed: false,
      factor: currentFactor,
      pendingFactor: pendingRelaxFactor,
      pendingRelaxPolls,
      cpuPercent,
      targetFactor,
      reason: "await-relax-confirmation",
    };
  }

  return {
    ...commitFactorChange(cpuPercent, pendingRelaxFactor, options),
    cpuPercent,
    targetFactor,
    reason: "relax",
  };
}

function tick() {
  const systemCpuPercent = getSystemCpuPercent();
  const processCpuPercent = getProcessCpuPercent();

  if (config.logLevel > 1) {
    log.flushStack();
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(
      `${pc.dim(timestamp)} ${LABEL} ${pc.dim("[tidi] testing:")} process.CPU is at ${processCpuPercent.toFixed(1)}% vs ${systemCpuPercent.toFixed(1)}% polled CPU`,
    );
  }

  evaluateMeasuredCpuPercent(systemCpuPercent);
}

function start() {
  if (handle) return;
  prevSnapshot = os.cpus();
  prevProcessCpuUsage = process.cpuUsage();
  prevProcessCpuTimeNs = process.hrtime.bigint();
  handle = setInterval(tick, POLL_INTERVAL_MS);
  handle.unref();
}

function stop() {
  if (!handle) return;
  clearInterval(handle);
  handle = null;
}

function resetState() {
  stop();
  currentFactor = 1.0;
  manualOverride = null;
  resetRelaxationState();
  prevSnapshot = os.cpus();
  prevProcessCpuUsage = process.cpuUsage();
  prevProcessCpuTimeNs = process.hrtime.bigint();
}

function logStartupStatus() {
  log.flushStack();
  const enabled = config.tidiAutoscaler !== false;
  const timestamp = new Date().toISOString().slice(11, 19);
  if (enabled) {
    console.log(
      `${pc.dim(timestamp)} ${LABEL} ${pc.cyan("autoscaler")} ${pc.bold(pc.green("enabled"))} ${pc.dim(`(poll ${POLL_INTERVAL_MS / 1000}s, cpu ${CPU_FLOOR}-${CPU_CEIL}%)`)}`,
    );
  } else {
    console.log(
      `${pc.dim(timestamp)} ${LABEL} ${pc.cyan("autoscaler")} ${pc.dim("disabled")}`,
    );
  }
}

function init() {
  logStartupStatus();
  if (config.tidiAutoscaler !== false) {
    start();
  }
}

module.exports = {
  init,
  start,
  stop,
  logStartupStatus,
  cpuToFactor,
  getSystemCpuPercent,
  setManualOverride,
  clearManualOverride,
  _testing: {
    evaluateMeasuredCpuPercent,
    getCurrentFactor: () => currentFactor,
    getManualOverride: () => (manualOverride ? { ...manualOverride } : null),
    getPendingRelaxFactor: () => pendingRelaxFactor,
    getPendingRelaxPolls: () => pendingRelaxPolls,
    resetState,
  },
};

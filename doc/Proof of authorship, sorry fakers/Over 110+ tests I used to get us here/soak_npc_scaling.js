/*
 * Proof-of-authorship note: Primary authorship and project direction for this soak test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..");
const benchmarkScriptPath = path.join(__dirname, "benchmark_npc_scaling.js");
const auditScriptPath = path.join(__dirname, "audit_npc_runtime_tables.js");
const anchorRelevanceTestPath = path.join(repoRoot, "server/tests/npcAnchorRelevance.test.js");
const ambientTestPath = path.join(repoRoot, "server/tests/npcAmbientMaterialization.test.js");
const combatTestPath = path.join(repoRoot, "server/tests/npcCombatDormancy.test.js");
const SOAK_LOCK_PATH = path.join(repoRoot, "logs", "soak_npc_scaling.lock.json");

function toPositiveInt(value, fallback) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function isProcessAlive(pid) {
  const normalizedPid = Math.trunc(Number(pid) || 0);
  if (normalizedPid <= 0 || normalizedPid === process.pid) {
    return normalizedPid === process.pid;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    if (error && (error.code === "ESRCH" || error.code === "EPERM")) {
      return error.code === "EPERM";
    }
    return false;
  }
}

function tryReadSoakLock() {
  if (!fs.existsSync(SOAK_LOCK_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(SOAK_LOCK_PATH, "utf8"));
  } catch (error) {
    return null;
  }
}

function releaseSoakLock() {
  const lock = tryReadSoakLock();
  if (!lock || Math.trunc(Number(lock.pid) || 0) !== process.pid) {
    return;
  }
  try {
    fs.unlinkSync(SOAK_LOCK_PATH);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function acquireSoakLock(options) {
  fs.mkdirSync(path.dirname(SOAK_LOCK_PATH), { recursive: true });
  const existingLock = tryReadSoakLock();
  if (
    existingLock &&
    Math.trunc(Number(existingLock.pid) || 0) > 0 &&
    Math.trunc(Number(existingLock.pid) || 0) !== process.pid &&
    isProcessAlive(existingLock.pid)
  ) {
    throw new Error(
      `Soak already running (pid=${existingLock.pid} startedAt=${existingLock.startedAt || "unknown"}). ` +
      "Refusing to start a second soak run while the lock is held.",
    );
  }
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    iterations: options.iterations,
    modes: [...options.modes],
    scenarios: [...options.scenarios],
  };
  fs.writeFileSync(SOAK_LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseCliArguments(argv) {
  const options = {
    iterations: 5,
    modes: [1],
    scenarios: [],
    progress: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }
    if (argument.startsWith("--iterations=")) {
      options.iterations = Math.max(1, toPositiveInt(argument.slice("--iterations=".length), 5));
      continue;
    }
    if (argument.startsWith("--modes=")) {
      options.modes = argument
        .slice("--modes=".length)
        .split(",")
        .map((value) => toPositiveInt(value, 0))
        .filter((value) => value > 0);
      continue;
    }
    if (argument.startsWith("--scenarios=")) {
      options.scenarios = argument
        .slice("--scenarios=".length)
        .split(",")
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      continue;
    }
    if (argument === "--no-progress") {
      options.progress = false;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.modes.length === 0) {
    throw new Error("At least one mode is required.");
  }

  return options;
}

function parseBenchmarkPayload(output) {
  const parsed = JSON.parse(String(output || "").trim());
  return Array.isArray(parsed && parsed.results) ? parsed.results : [];
}

function summarizeBenchmarks(allIterations) {
  const grouped = new Map();
  for (const iterationResults of allIterations) {
    for (const result of iterationResults) {
      const key = `${result.scenarioKey}:${result.mode}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          scenarioLabel: result.scenarioLabel,
          modeName: result.modeName || String(result.mode),
          startupMs: [],
          runtimeTickMs: [],
          ensureMs: [],
          wakeMs: [],
        });
      }
      const entry = grouped.get(key);
      entry.startupMs.push(Number(result.elapsedMs || 0));
      entry.runtimeTickMs.push(Number(result.runtimeTick && result.runtimeTick.averageTickMs || 0));
      entry.ensureMs.push(Number(result.sampleScene && result.sampleScene.ensureSceneElapsedMs || 0));
      entry.wakeMs.push(Number(result.sampleWake && result.sampleWake.wakeSceneElapsedMs || 0));
    }
  }

  const summaries = [];
  for (const entry of grouped.values()) {
    const summarize = (values) => ({
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    });
    summaries.push({
      scenarioLabel: entry.scenarioLabel,
      modeName: entry.modeName,
      startupMs: summarize(entry.startupMs),
      runtimeTickMs: summarize(entry.runtimeTickMs),
      ensureMs: summarize(entry.ensureMs),
      wakeMs: summarize(entry.wakeMs),
    });
  }
  return summaries.sort((left, right) => {
    if (left.modeName !== right.modeName) {
      return String(left.modeName).localeCompare(String(right.modeName));
    }
    return String(left.scenarioLabel).localeCompare(String(right.scenarioLabel));
  });
}

function formatRange(summary) {
  return `min ${summary.min.toFixed(3)} / avg ${summary.avg.toFixed(3)} / max ${summary.max.toFixed(3)}`;
}

function formatDuration(valueMs) {
  const normalizedMs = Math.max(0, Math.trunc(Number(valueMs) || 0));
  if (normalizedMs < 1000) {
    return `${normalizedMs}ms`;
  }
  const totalSeconds = Math.floor(normalizedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function logProgress(options, message) {
  if (options && options.progress === false) {
    return;
  }
  process.stdout.write(`[soak] ${message}\n`);
}

function readJsonFileSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function findBenchmarkProgressStateFile(benchmarkPid) {
  const logsDir = path.join(repoRoot, "logs");
  if (!fs.existsSync(logsDir)) {
    return null;
  }
  const prefix = `benchmark_worker_progress_${benchmarkPid}_`;
  const matches = fs.readdirSync(logsDir)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"))
    .map((entry) => path.join(logsDir, entry))
    .map((filePath) => ({
      filePath,
      stat: fs.statSync(filePath),
    }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return matches.length > 0 ? matches[0].filePath : null;
}

function formatBenchmarkWorkerState(state) {
  if (!state || !state.stage) {
    return "benchmark-live stage=unknown";
  }
  const totalElapsed = state.totalElapsedMs > 0
    ? ` totalElapsed=${formatDuration(state.totalElapsedMs)}`
    : "";
  if (state.stage === "preload-system") {
    const currentSystemElapsedMs = state.systemStartedAtMs ? Date.now() - state.systemStartedAtMs : 0;
    const avgSystem = state.averageCompletedSystemMs > 0
      ? ` avgSystem=${formatDuration(state.averageCompletedSystemMs)}`
      : "";
    const eta = state.estimatedRemainingMs > 0
      ? ` eta=${formatDuration(state.estimatedRemainingMs)}`
      : "";
    return (
      `benchmark-live stage=${state.stage}` +
      ` system=${state.systemIndex || 0}/${state.totalSystems || 0}` +
      ` id=${state.systemID || 0}` +
      ` name=${state.systemName || "unknown"}` +
      ` currentSystem=${formatDuration(currentSystemElapsedMs)}` +
      avgSystem +
      eta +
      totalElapsed
    );
  }
  if (state.stage === "preload-system-complete") {
    const eta = state.estimatedRemainingMs > 0
      ? ` eta=${formatDuration(state.estimatedRemainingMs)}`
      : "";
    return (
      `benchmark-live stage=${state.stage}` +
      ` system=${state.systemIndex || 0}/${state.totalSystems || 0}` +
      ` id=${state.systemID || 0}` +
      ` name=${state.systemName || "unknown"}` +
      ` systemElapsed=${formatDuration(state.systemElapsedMs || 0)}` +
      eta +
      totalElapsed
    );
  }
  if (state.stage === "preload-refresh-stargates") {
    return `benchmark-live stage=${state.stage}${totalElapsed}`;
  }
  return `benchmark-live stage=${state.stage}${totalElapsed}`;
}

function runNodeCommand(scriptPath, args = [], runOptions = {}) {
  const {
    label = path.basename(scriptPath),
    test = false,
    captureStdout = true,
    captureStderr = true,
    streamStdout = false,
    streamStderr = true,
  } = runOptions;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const childArgs = test ? ["--test", scriptPath, ...args] : [scriptPath, ...args];
    const child = spawn(
      process.execPath,
      childArgs,
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      if (captureStdout) {
        stdout += text;
      }
      if (streamStdout) {
        process.stdout.write(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      if (captureStderr) {
        stderr += text;
      }
      if (streamStderr) {
        process.stderr.write(text);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command failed: node ${test ? "--test " : ""}${path.relative(repoRoot, scriptPath)} ${args.join(" ")}\n${
              stderr || stdout || `exit ${code}`
            }`,
          ),
        );
        return;
      }
      resolve({
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
        label,
      });
    });
  });
}

function runBenchmarkCommand(args = [], options = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let progressStatePath = null;
    let progressPoll = null;
    let lastProgressUpdatedAtMs = 0;
    let lastProgressSummary = "";
    let lastProgressEmittedAtMs = 0;
    const child = spawn(
      process.execPath,
      [benchmarkScriptPath, ...args],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const clearProgressPoll = () => {
      if (progressPoll) {
        clearInterval(progressPoll);
        progressPoll = null;
      }
    };

    if (options.streamProgress !== false) {
      progressPoll = setInterval(() => {
        if (!progressStatePath) {
          progressStatePath = findBenchmarkProgressStateFile(child.pid);
          if (!progressStatePath) {
            return;
          }
        }
        const state = readJsonFileSafe(progressStatePath);
        if (!state) {
          return;
        }
        const summary = formatBenchmarkWorkerState(state);
        const stateUpdatedAtMs = Number(state.updatedAtMs || 0);
        const shouldEmitStateChange = stateUpdatedAtMs > 0 && stateUpdatedAtMs !== lastProgressUpdatedAtMs;
        const shouldEmitHeartbeat = (
          state && state.stage === "preload-system" &&
          Date.now() - lastProgressEmittedAtMs >= 10_000
        );
        if (!summary || (!shouldEmitStateChange && !shouldEmitHeartbeat)) {
          return;
        }
        lastProgressUpdatedAtMs = stateUpdatedAtMs || lastProgressUpdatedAtMs;
        lastProgressSummary = summary;
        lastProgressEmittedAtMs = Date.now();
        logProgress(options.parentOptions || null, summary);
      }, 250);
    }

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      if (options.streamStderr === true) {
        process.stderr.write(text);
      }
    });

    child.on("error", (error) => {
      clearProgressPoll();
      reject(error);
    });

    child.on("close", (code) => {
      clearProgressPoll();
      if (code !== 0) {
        reject(
          new Error(
            `Command failed: node ${path.relative(repoRoot, benchmarkScriptPath)} ${args.join(" ")}\n${
              stderr || stdout || `exit ${code}`
            }`,
          ),
        );
        return;
      }
      resolve({
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

async function main() {
  const options = parseCliArguments(process.argv);
  acquireSoakLock(options);
  process.on("exit", () => {
    try {
      releaseSoakLock();
    } catch (error) {
      // Best-effort cleanup on exit.
    }
  });

  const iterationBenchmarks = [];
  const soakStartedAt = Date.now();

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const iterationStartedAt = Date.now();
    const completedIterations = iteration;
    const averageCompletedIterationMs = completedIterations > 0
      ? (Date.now() - soakStartedAt) / completedIterations
      : 0;
    const estimatedRemainingMs = averageCompletedIterationMs > 0
      ? averageCompletedIterationMs * Math.max(0, options.iterations - completedIterations)
      : 0;
    logProgress(
      options,
      `iteration ${iteration + 1}/${options.iterations} phase=start` +
        ` totalElapsed=${formatDuration(Date.now() - soakStartedAt)}` +
        (averageCompletedIterationMs > 0
          ? ` avgIteration=${formatDuration(averageCompletedIterationMs)} eta=${formatDuration(estimatedRemainingMs)}`
          : ""),
    );

    for (const testConfig of [
      { label: "npcAnchorRelevance.test.js", path: anchorRelevanceTestPath },
      { label: "npcAmbientMaterialization.test.js", path: ambientTestPath },
      { label: "npcCombatDormancy.test.js", path: combatTestPath },
    ]) {
      logProgress(options, `iteration ${iteration + 1}/${options.iterations} phase=test-start test=${testConfig.label}`);
      const testResult = await runNodeCommand(testConfig.path, [], {
        label: testConfig.label,
        test: true,
        captureStdout: true,
        captureStderr: true,
        streamStdout: false,
        streamStderr: false,
      });
      logProgress(
        options,
        `iteration ${iteration + 1}/${options.iterations} phase=test-done test=${testConfig.label}` +
          ` elapsed=${formatDuration(testResult.elapsedMs)}`,
      );
    }

    logProgress(options, `iteration ${iteration + 1}/${options.iterations} phase=benchmark-start`);
    const benchmarkResult = await runBenchmarkCommand([
      `--modes=${options.modes.join(",")}`,
      ...(options.scenarios.length > 0 ? [`--scenarios=${options.scenarios.join(",")}`] : []),
      "--json",
      "--no-progress",
    ], {
      parentOptions: options,
      streamStderr: false,
    });
    iterationBenchmarks.push(parseBenchmarkPayload(benchmarkResult.stdout));
    logProgress(
      options,
      `iteration ${iteration + 1}/${options.iterations} phase=benchmark-done` +
        ` elapsed=${formatDuration(benchmarkResult.elapsedMs)}`,
    );

    logProgress(options, `iteration ${iteration + 1}/${options.iterations} phase=audit-start`);
    const auditResult = await runNodeCommand(auditScriptPath, [], {
      label: "audit_npc_runtime_tables.js",
      captureStdout: true,
      captureStderr: true,
      streamStdout: false,
      streamStderr: false,
    });
    process.stdout.write(auditResult.stdout);
    logProgress(
      options,
      `iteration ${iteration + 1}/${options.iterations} phase=audit-done` +
        ` elapsed=${formatDuration(auditResult.elapsedMs)}`,
    );

    const iterationElapsedMs = Date.now() - iterationStartedAt;
    const averageIterationMs = (Date.now() - soakStartedAt) / (iteration + 1);
    const iterationEtaMs = averageIterationMs * Math.max(0, options.iterations - (iteration + 1));
    logProgress(
      options,
      `iteration ${iteration + 1}/${options.iterations} phase=done` +
        ` elapsed=${formatDuration(iterationElapsedMs)}` +
        ` avgIteration=${formatDuration(averageIterationMs)}` +
        ` eta=${formatDuration(iterationEtaMs)}`,
    );
  }

  console.log("=== Soak benchmark summary ===");
  for (const summary of summarizeBenchmarks(iterationBenchmarks)) {
    console.log(
      `${summary.scenarioLabel} / ${summary.modeName}: ` +
      `startup ${formatRange(summary.startupMs)} ms, ` +
      `runtime tick ${formatRange(summary.runtimeTickMs)} ms, ` +
      `first ensure ${formatRange(summary.ensureMs)} ms, ` +
      `first wake ${formatRange(summary.wakeMs)} ms`,
    );
  }
}

try {
  Promise.resolve(main()).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}

/*
 * Proof-of-authorship note: Primary authorship and project direction for this benchmark script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..");
const workerScriptPath = path.join(__dirname, "benchmark_npc_scaling_worker.js");
const BENCHMARK_LOCK_PATH = path.join(repoRoot, "logs", "benchmark_npc_scaling.lock.json");
const SNAPSHOT_TABLES = Object.freeze([
  "characters",
  "items",
  "skills",
  "npcControlState",
  "npcRuntimeState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
]);

const DEFAULT_MODES = [1, 2];
const BENCHMARK_SCENARIOS = Object.freeze([
  {
    key: "ambient_off",
    label: "Ambient Off",
    args: [
      "--default-concord=off",
      "--station-screens=off",
    ],
  },
  {
    key: "ambient_on",
    label: "Ambient On",
    args: [
      "--default-concord=on",
      "--station-screens=on",
    ],
  },
  {
    key: "combat_startup_on",
    label: "Combat Startup On",
    sampleSystemID: 30000001,
    args: [
      "--default-concord=off",
      "--station-screens=off",
      "--authored-startup=on",
      "--enable-startup-rule=tanoo_blood_gate_ambush_startup",
    ],
  },
]);

function parseCliArguments(argv) {
  const options = {
    modes: [...DEFAULT_MODES],
    sampleSystemID: 30000142,
    json: false,
    scenarios: BENCHMARK_SCENARIOS.map((scenario) => scenario.key),
    progress: true,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--no-progress") {
      options.progress = false;
      continue;
    }
    if (argument.startsWith("--modes=")) {
      options.modes = argument
        .slice("--modes=".length)
        .split(",")
        .map((value) => Math.trunc(Number(value) || 0))
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
    if (argument.startsWith("--sample-system=")) {
      options.sampleSystemID = Math.trunc(Number(argument.slice("--sample-system=".length)) || 0) || 30000142;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.modes.length === 0) {
    throw new Error("At least one benchmark mode is required.");
  }
  if (options.scenarios.length === 0) {
    throw new Error("At least one benchmark scenario is required.");
  }

  const unknownScenario = options.scenarios.find((scenarioKey) => (
    !BENCHMARK_SCENARIOS.some((scenario) => scenario.key === scenarioKey)
  ));
  if (unknownScenario) {
    throw new Error(`Unknown benchmark scenario: ${unknownScenario}`);
  }

  return options;
}

function parseBenchmarkPayload(output) {
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("BENCHMARK_RESULT=")) {
      continue;
    }
    return JSON.parse(line.slice("BENCHMARK_RESULT=".length));
  }
  return null;
}

function getTableFilePath(table) {
  return path.join(repoRoot, "server/src/newDatabase/data", table, "data.json");
}

function sleepMs(durationMs) {
  const normalizedDurationMs = Math.max(0, Math.trunc(Number(durationMs) || 0));
  if (normalizedDurationMs <= 0) {
    return;
  }
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, normalizedDurationMs);
}

function snapshotTrackedFiles() {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [
      table,
      fs.readFileSync(getTableFilePath(table), "utf8"),
    ]),
  );
}

function restoreTrackedFiles(snapshot) {
  for (const table of SNAPSHOT_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, table)) {
      continue;
    }
    const tablePath = getTableFilePath(table);
    let restored = false;
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.writeFileSync(tablePath, snapshot[table], "utf8");
        restored = true;
        break;
      } catch (error) {
        lastError = error;
        if (!(error && (error.code === "EBUSY" || error.code === "EPERM")) || attempt >= 4) {
          throw error;
        }
        sleepMs(25 * (attempt + 1));
      }
    }
    if (!restored && lastError) {
      throw lastError;
    }
  }
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

function tryReadBenchmarkLock() {
  if (!fs.existsSync(BENCHMARK_LOCK_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(BENCHMARK_LOCK_PATH, "utf8"));
  } catch (error) {
    return null;
  }
}

function releaseBenchmarkLock() {
  const lock = tryReadBenchmarkLock();
  if (!lock || Math.trunc(Number(lock.pid) || 0) !== process.pid) {
    return;
  }
  try {
    fs.unlinkSync(BENCHMARK_LOCK_PATH);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function acquireBenchmarkLock(options) {
  fs.mkdirSync(path.dirname(BENCHMARK_LOCK_PATH), { recursive: true });
  const existingLock = tryReadBenchmarkLock();
  if (
    existingLock &&
    Math.trunc(Number(existingLock.pid) || 0) > 0 &&
    Math.trunc(Number(existingLock.pid) || 0) !== process.pid &&
    isProcessAlive(existingLock.pid)
  ) {
    const heldBy = `pid=${existingLock.pid}`;
    const startedAt = existingLock.startedAt ? ` startedAt=${existingLock.startedAt}` : "";
    const scenarios = Array.isArray(existingLock.scenarios) && existingLock.scenarios.length > 0
      ? ` scenarios=${existingLock.scenarios.join(",")}`
      : "";
    const modes = Array.isArray(existingLock.modes) && existingLock.modes.length > 0
      ? ` modes=${existingLock.modes.join(",")}`
      : "";
    throw new Error(
      `Benchmark already running (${heldBy}${startedAt}${modes}${scenarios}). ` +
      `Refusing to start a second benchmark while the lock is held.`,
    );
  }

  const lockPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    modes: [...(options.modes || [])],
    scenarios: [...(options.scenarios || [])],
    sampleSystemID: options.sampleSystemID,
    command: process.argv.slice(1),
  };
  fs.writeFileSync(BENCHMARK_LOCK_PATH, `${JSON.stringify(lockPayload, null, 2)}\n`, "utf8");
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

function formatMilliseconds(value) {
  return `${Number(value || 0).toFixed(3)} ms`;
}

function formatDuration(valueMs) {
  const normalizedMs = Math.max(0, Math.trunc(Number(valueMs) || 0));
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

function readProgressState(progressStatePath) {
  if (!progressStatePath || !fs.existsSync(progressStatePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(progressStatePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function logProgress(options, message) {
  if (options && options.progress === false) {
    return;
  }
  const stream = options && options.json === true ? process.stderr : process.stdout;
  stream.write(`${message}\n`);
}

function formatWorkerHeartbeat(mode, scenario, state) {
  const totalElapsedText = state && state.totalElapsedMs > 0
    ? ` totalElapsed=${formatDuration(state.totalElapsedMs)}`
    : "";
  if (!state || !state.stage) {
    return `[benchmark] heartbeat mode=${mode} scenario=${scenario.key} stage=unknown`;
  }
  if (state.stage === "preload-system") {
    const currentSystemElapsedMs = state.systemStartedAtMs ? Date.now() - state.systemStartedAtMs : 0;
    const avgSystemText = state.averageCompletedSystemMs > 0
      ? ` avgSystem=${formatDuration(state.averageCompletedSystemMs)}`
      : "";
    const etaText = state.estimatedRemainingMs > 0
      ? ` eta=${formatDuration(state.estimatedRemainingMs)}`
      : "";
    return (
      `[benchmark] heartbeat mode=${mode} scenario=${scenario.key} stage=${state.stage}` +
      ` system=${state.systemIndex || 0}/${state.totalSystems || 0}` +
      ` id=${state.systemID || 0} name=${state.systemName || "unknown"}` +
      ` currentSystem=${formatDuration(currentSystemElapsedMs)}` +
      ` completed=${state.completedSystems || 0}/${state.totalSystems || 0}` +
      avgSystemText +
      etaText +
      totalElapsedText
    );
  }
  if (state.stage === "preload-system-complete") {
    const etaText = state.estimatedRemainingMs > 0
      ? ` eta=${formatDuration(state.estimatedRemainingMs)}`
      : "";
    return (
      `[benchmark] heartbeat mode=${mode} scenario=${scenario.key} stage=${state.stage}` +
      ` system=${state.systemIndex || 0}/${state.totalSystems || 0}` +
      ` elapsed=${formatDuration(state.systemElapsedMs || 0)}` +
      etaText +
      totalElapsedText
    );
  }
  if (state.stage === "preload-refresh-stargates") {
    return `[benchmark] heartbeat mode=${mode} scenario=${scenario.key} stage=${state.stage}${totalElapsedText}`;
  }
  return `[benchmark] heartbeat mode=${mode} scenario=${scenario.key} stage=${state.stage}${totalElapsedText}`;
}

function runWorker(mode, scenario, sampleSystemID, options = {}) {
  const fileSnapshot = snapshotTrackedFiles();
  const resolvedSampleSystemID = Number(scenario.sampleSystemID || sampleSystemID) || sampleSystemID;
  const startedAt = Date.now();
  const progressStatePath = path.join(
    repoRoot,
    "logs",
    `benchmark_worker_progress_${process.pid}_${mode}_${scenario.key}_${startedAt}.json`,
  );
  logProgress(
    options,
    `[benchmark] start mode=${mode} scenario=${scenario.key} sampleSystem=${resolvedSampleSystemID}`,
  );
  return new Promise((resolve, reject) => {
    let restored = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const restoreSnapshot = () => {
      if (restored) {
        return;
      }
      restored = true;
      restoreTrackedFiles(fileSnapshot);
    };
    let heartbeatInterval = null;
    let lastChildOutputAtMs = Date.now();
    const clearHeartbeat = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      try {
        fs.unlinkSync(progressStatePath);
      } catch (error) {
        if (!error || error.code !== "ENOENT") {
          throw error;
        }
      }
    };

    const child = spawn(
      process.execPath,
      [
        workerScriptPath,
        `--mode=${mode}`,
        `--sample-system=${resolvedSampleSystemID}`,
        "--progress",
        ...scenario.args,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          BENCHMARK_PROGRESS_STATE_PATH: progressStatePath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (options.progress !== false) {
      heartbeatInterval = setInterval(() => {
        if (Date.now() - lastChildOutputAtMs < 10_000) {
          return;
        }
        const state = readProgressState(progressStatePath);
        if (!state) {
          return;
        }
        logProgress(options, formatWorkerHeartbeat(mode, scenario, state));
        lastChildOutputAtMs = Date.now();
      }, 3_000);
    }

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderrBuffer += text;
      lastChildOutputAtMs = Date.now();
      if (options.progress !== false) {
        const stream = options && options.json === true ? process.stderr : process.stdout;
        stream.write(text);
      }
    });
    child.on("error", (error) => {
      try {
        clearHeartbeat();
        restoreSnapshot();
      } catch (restoreError) {
        reject(restoreError);
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      try {
        clearHeartbeat();
        restoreSnapshot();
      } catch (restoreError) {
        reject(restoreError);
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Benchmark worker failed for ${scenario.label} mode ${mode}: ${
              stderrBuffer || stdoutBuffer || `exit ${code}`
            }`,
          ),
        );
        return;
      }

      const payload = parseBenchmarkPayload(stdoutBuffer);
      if (!payload) {
        reject(new Error(`Benchmark worker returned no payload for ${scenario.label} mode ${mode}.`));
        return;
      }
      logProgress(
        options,
        `[benchmark] done mode=${mode} scenario=${scenario.key} elapsedMs=${Date.now() - startedAt}`,
      );
      resolve(payload);
    });
  });
}

function renderTable(results) {
  const header = [
    "Scenario".padEnd(24),
    "Mode".padEnd(16),
    "Startup".padStart(12),
    "NPC Ships".padStart(10),
    "Controllers".padStart(12),
    "Ambient".padStart(10),
    "Virt A".padStart(10),
    "Virt C".padStart(10),
    "Combat".padStart(10),
    "RT tick".padStart(12),
    "Ticked".padStart(8),
    "1st ensure".padStart(12),
    "1st wake".padStart(12),
    "Avg tick".padStart(12),
  ].join("  ");
  const separator = "-".repeat(header.length);
  const rows = results.map((entry) => [
    entry.scenarioLabel.padEnd(24),
    String(entry.modeName || entry.mode).padEnd(16),
    formatMilliseconds(entry.elapsedMs).padStart(12),
    formatInteger(entry.npcShips).padStart(10),
    formatInteger(entry.controllerCount).padStart(12),
    formatInteger(entry.ambientControllerCount).padStart(10),
    formatInteger(entry.virtualizedAmbientControllerCount).padStart(10),
    formatInteger(entry.virtualizedCombatControllerCount).padStart(10),
    formatInteger(entry.combatControllerCount).padStart(10),
    formatMilliseconds(entry.runtimeTick.averageTickMs).padStart(12),
    Number(entry.runtimeTick.averageTickedSceneCount || 0).toFixed(1).padStart(8),
    formatMilliseconds(entry.sampleScene.ensureSceneElapsedMs).padStart(12),
    formatMilliseconds(entry.sampleWake.wakeSceneElapsedMs).padStart(12),
    formatMilliseconds(entry.sampleScene.averageTickMs).padStart(12),
  ].join("  "));
  return [header, separator, ...rows].join("\n");
}

async function main() {
  const options = parseCliArguments(process.argv);
  acquireBenchmarkLock(options);
  process.on("exit", () => {
    try {
      releaseBenchmarkLock();
    } catch (error) {
      // Best-effort cleanup on process exit.
    }
  });
  const results = [];
  const selectedScenarios = BENCHMARK_SCENARIOS.filter((scenario) => (
    options.scenarios.includes(scenario.key)
  ));
  const totalRuns = options.modes.length * selectedScenarios.length;
  let runIndex = 0;
  if (!options.json) {
    console.log("NPC scaling benchmark");
    console.log(`Sample system: ${options.sampleSystemID}`);
    console.log(`Scenarios: ${selectedScenarios.map((scenario) => scenario.key).join(", ")}`);
    console.log("");
  }
  for (const mode of options.modes) {
    for (const scenario of selectedScenarios) {
      runIndex += 1;
      logProgress(
        options,
        `[benchmark] progress ${runIndex}/${totalRuns} mode=${mode} scenario=${scenario.key}`,
      );
      const payload = await runWorker(mode, scenario, options.sampleSystemID, options);
      results.push({
        ...payload,
        scenarioKey: scenario.key,
        scenarioLabel: scenario.label,
      });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }

  console.log(renderTable(results));
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

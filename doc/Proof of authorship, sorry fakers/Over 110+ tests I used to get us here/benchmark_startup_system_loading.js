/*
 * Proof-of-authorship note: Primary authorship and project direction for this benchmark script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const PROGRESS_ENV_FLAG = "EVEJS_BENCHMARK_PROGRESS";
const BENCHMARK_SHUTDOWN_EVENTS = [
  "beforeExit",
  "exit",
  "SIGINT",
  "SIGTERM",
  "SIGBREAK",
  "SIGHUP",
];

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function roundTo(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function countSceneEntities(scenes) {
  let staticEntities = 0;
  let dynamicEntities = 0;
  let asteroidEntities = 0;
  let npcShips = 0;
  const staticKinds = new Map();
  const dynamicKinds = new Map();

  function incrementCount(map, rawKey) {
    const key = String(rawKey || "unknown").trim() || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }

  for (const scene of scenes) {
    staticEntities += Array.isArray(scene.staticEntities) ? scene.staticEntities.length : 0;
    dynamicEntities += scene.dynamicEntities instanceof Map ? scene.dynamicEntities.size : 0;

    if (Array.isArray(scene.staticEntities)) {
      for (const entity of scene.staticEntities) {
        const kind = String(entity && entity.kind || "").trim();
        incrementCount(staticKinds, kind);
        if (kind === "asteroid" || kind === "asteroidBelt") {
          asteroidEntities += 1;
        }
      }
    }

    if (scene.dynamicEntities instanceof Map) {
      for (const entity of scene.dynamicEntities.values()) {
        incrementCount(dynamicKinds, entity && entity.kind);
        if (entity && entity.npcEntityType) {
          npcShips += 1;
        }
      }
    }
  }

  const staticKindCounts = Object.fromEntries(
    [...staticKinds.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  );
  const dynamicKindCounts = Object.fromEntries(
    [...dynamicKinds.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  );

  const categorizedStaticEntities =
    (staticKinds.get("station") || 0) +
    (staticKinds.get("stargate") || 0) +
    (staticKinds.get("asteroidBelt") || 0) +
    (staticKinds.get("asteroid") || 0) +
    (staticKinds.get("planet") || 0) +
    (staticKinds.get("moon") || 0) +
    (staticKinds.get("sun") || 0);

  return {
    staticEntities,
    dynamicEntities,
    asteroidEntities,
    npcShips,
    staticKindCounts,
    dynamicKindCounts,
    stations: staticKinds.get("station") || 0,
    stargates: staticKinds.get("stargate") || 0,
    asteroidBelts: staticKinds.get("asteroidBelt") || 0,
    asteroids: staticKinds.get("asteroid") || 0,
    planets: staticKinds.get("planet") || 0,
    moons: staticKinds.get("moon") || 0,
    suns: staticKinds.get("sun") || 0,
    otherStaticEntities: Math.max(0, staticEntities - categorizedStaticEntities),
  };
}

function disableBenchmarkShutdownHooks() {
  for (const eventName of BENCHMARK_SHUTDOWN_EVENTS) {
    process.removeAllListeners(eventName);
  }
}

function createProgressEmitter(log) {
  const progressEnabled = process.env[PROGRESS_ENV_FLAG] === "1";
  let lastProgressEmitAt = 0;
  return function emitProgress(payload, options = {}) {
    if (!progressEnabled || typeof log !== "function") {
      return;
    }
    const now = Date.now();
    if (!options.force && now - lastProgressEmitAt < 100) {
      return;
    }
    lastProgressEmitAt = now;
    log(`BENCHMARK_PROGRESS=${JSON.stringify(payload)}`);
  };
}

function preloadWithProgress(preloadPlan, options = {}) {
  const emitProgress = createProgressEmitter(options.log);
  const systemIDs = Array.isArray(preloadPlan && preloadPlan.systemIDs)
    ? preloadPlan.systemIDs
    : [];
  const totalSystems = systemIDs.length;
  let loadedSystems = 0;

  emitProgress({
    phase: "starting",
    mode: preloadPlan && preloadPlan.mode,
    modeName: preloadPlan && preloadPlan.modeName,
    loadedSystems,
    totalSystems,
    percent: totalSystems > 0 ? 0 : 100,
    currentSystemID: null,
  }, { force: true });

  for (const systemID of systemIDs) {
    const numericSystemID = toPositiveInt(systemID, 0);
    if (!numericSystemID) {
      continue;
    }
    runtime.ensureScene(numericSystemID, { refreshStargates: false });
    loadedSystems += 1;
    emitProgress({
      phase: "loading",
      mode: preloadPlan.mode,
      modeName: preloadPlan.modeName,
      loadedSystems,
      totalSystems,
      percent: totalSystems > 0
        ? roundTo((loadedSystems / totalSystems) * 100, 1)
        : 100,
      currentSystemID: numericSystemID,
    });
  }

  emitProgress({
    phase: "finalizing",
    mode: preloadPlan.mode,
    modeName: preloadPlan.modeName,
    loadedSystems,
    totalSystems,
    percent: 100,
    currentSystemID: null,
  }, { force: true });

  const activationChanges = runtime.refreshStargateActivationStates({
    broadcast: options.broadcast !== false,
  });

  emitProgress({
    phase: "complete",
    mode: preloadPlan.mode,
    modeName: preloadPlan.modeName,
    loadedSystems,
    totalSystems,
    percent: 100,
    currentSystemID: null,
    activationChangeCount: Array.isArray(activationChanges)
      ? activationChanges.length
      : 0,
  }, { force: true });

  return activationChanges;
}

function run() {
  const requestedMode = toPositiveInt(
    process.argv[2] || process.env.EVEJS_NEW_EDEN_SYSTEM_LOADING,
    1,
  );

  config.NewEdenSystemLoading = requestedMode;
  config.logLevel = 0;

  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;

  disableBenchmarkShutdownHooks();
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};

  try {
    database.preloadAll();
    runtime._testing.clearScenes();
    runtime._testing.resetStargateActivationOverrides();

    const preloadPlan = runtime.getStartupSolarSystemPreloadPlan();
    const startedAt = process.hrtime.bigint();
    const activationChanges = preloadWithProgress(preloadPlan, {
      broadcast: false,
      log: originalConsoleLog,
    });
    const finishedAt = process.hrtime.bigint();
    const elapsedMs = Number(finishedAt - startedAt) / 1_000_000;
    const scenes = [...runtime.scenes.values()];
    const entityCounts = countSceneEntities(scenes);
    const memoryUsage = process.memoryUsage();

    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;

    originalConsoleLog(
      `BENCHMARK_RESULT=${JSON.stringify({
        mode: preloadPlan.mode,
        modeName: preloadPlan.modeName,
        systemCount: preloadPlan.systemIDs.length,
        activationChangeCount: Array.isArray(activationChanges) ? activationChanges.length : 0,
        elapsedMs: Math.round(elapsedMs * 1000) / 1000,
        sceneCount: scenes.length,
        staticEntities: entityCounts.staticEntities,
        dynamicEntities: entityCounts.dynamicEntities,
        asteroidEntities: entityCounts.asteroidEntities,
        npcShips: entityCounts.npcShips,
        stations: entityCounts.stations,
        stargates: entityCounts.stargates,
        asteroidBelts: entityCounts.asteroidBelts,
        asteroids: entityCounts.asteroids,
        planets: entityCounts.planets,
        moons: entityCounts.moons,
        suns: entityCounts.suns,
        otherStaticEntities: entityCounts.otherStaticEntities,
        staticKindCounts: entityCounts.staticKindCounts,
        dynamicKindCounts: entityCounts.dynamicKindCounts,
        rssMb: roundTo(memoryUsage.rss / (1024 * 1024), 2),
        heapUsedMb: roundTo(memoryUsage.heapUsed / (1024 * 1024), 2),
        heapTotalMb: roundTo(memoryUsage.heapTotal / (1024 * 1024), 2),
      })}`,
    );
    process.exit(0);
  } catch (error) {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

run();

/*
 * Proof-of-authorship note: Primary authorship and project direction for this benchmark script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const path = require("path");
const { performance } = require("perf_hooks");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));

function nowMs() {
  return performance.now();
}

function roundTo(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function parseSystemIDs(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }

    if (argument.startsWith("--systems=")) {
      return argument
        .slice("--systems=".length)
        .split(",")
        .map((value) => toPositiveInt(value, 0))
        .filter((value) => value > 0);
    }

    if (argument === "--systems") {
      return String(argv[index + 1] || "")
        .split(",")
        .map((value) => toPositiveInt(value, 0))
        .filter((value) => value > 0);
    }
  }

  return [];
}

function parseSystemCount(argv, fallback = 5) {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }

    if (argument.startsWith("--count=")) {
      return Math.max(1, toPositiveInt(argument.slice("--count=".length), fallback));
    }

    if (argument === "--count") {
      return Math.max(1, toPositiveInt(argv[index + 1], fallback));
    }
  }

  return fallback;
}

function parseSeed(argv, fallback = "1337") {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }

    if (argument.startsWith("--seed=")) {
      return String(argument.slice("--seed=".length) || fallback);
    }

    if (argument === "--seed") {
      return String(argv[index + 1] || fallback);
    }
  }

  return fallback;
}

function parseRandomSelectionEnabled(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim().toLowerCase();
    if (!argument) {
      continue;
    }

    if (argument === "--random" || argument === "--selection=random") {
      return true;
    }
  }

  return false;
}

function hashSeed(seed) {
  const text = String(seed || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseRandomSystems(systems, count, seed) {
  const random = createSeededRandom(seed);
  const shuffled = [...systems];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled.slice(0, Math.max(1, Math.min(count, shuffled.length)));
}

function createSceneMetrics(system) {
  return {
    systemID: Number(system && system.solarSystemID) || 0,
    name: String(system && system.solarSystemName || ""),
    security: Number(system && system.security) || 0,
    phases: Object.create(null),
    counts: Object.create(null),
  };
}

function addMetric(sceneMetrics, key, value) {
  if (!sceneMetrics || !key) {
    return;
  }
  sceneMetrics.phases[key] = (sceneMetrics.phases[key] || 0) + Number(value || 0);
}

function setCount(sceneMetrics, key, value) {
  if (!sceneMetrics || !key) {
    return;
  }
  sceneMetrics.counts[key] = value;
}

function wrapMeasuredArray(items, sceneMetrics, metricPrefix) {
  const array = Array.isArray(items) ? [...items] : Array.from(items || []);
  setCount(sceneMetrics, `${metricPrefix}.count`, array.length);
  Object.defineProperty(array, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value() {
      let index = 0;
      let iterationStartedAt = 0;
      let waitingForBody = false;
      return {
        next() {
          const currentNow = nowMs();
          if (waitingForBody) {
            addMetric(sceneMetrics, `${metricPrefix}.loopMs`, currentNow - iterationStartedAt);
          }
          if (index >= array.length) {
            waitingForBody = false;
            return {
              done: true,
              value: undefined,
            };
          }
          const value = array[index];
          index += 1;
          iterationStartedAt = nowMs();
          waitingForBody = true;
          return {
            done: false,
            value,
          };
        },
      };
    },
  });
  return array;
}

function sumValues(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function listKindCounts(entities = []) {
  const counts = Object.create(null);
  for (const entity of entities) {
    const key = String(entity && entity.kind || "unknown").trim() || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function roundObjectValues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => roundObjectValues(entry));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "number" ? roundTo(value) : value;
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = roundObjectValues(entry);
  }
  return next;
}

let activeSceneMetrics = null;
let activeService = null;
let benchmarkLoadActive = false;

function patchMeasuredArrayGetter(target, fnName, metricPrefix, options = {}) {
  const original = target[fnName];
  target[fnName] = function patchedMeasuredArrayGetter(...args) {
    const shouldMeasure =
      activeSceneMetrics &&
      (options.service ? activeService === options.service : activeService === "constructor");
    const startedAt = shouldMeasure ? nowMs() : 0;
    const result = original.apply(this, args);
    if (!shouldMeasure) {
      return result;
    }
    addMetric(activeSceneMetrics, `${metricPrefix}.retrieveMs`, nowMs() - startedAt);
    return wrapMeasuredArray(result, activeSceneMetrics, metricPrefix);
  };
}

function patchMeasuredValueGetter(target, fnName, metricKey, options = {}) {
  const original = target[fnName];
  target[fnName] = function patchedMeasuredValueGetter(...args) {
    const shouldMeasure =
      activeSceneMetrics &&
      (options.service ? activeService === options.service : activeService === "constructor");
    const startedAt = shouldMeasure ? nowMs() : 0;
    const result = original.apply(this, args);
    if (shouldMeasure) {
      addMetric(activeSceneMetrics, metricKey, nowMs() - startedAt);
    }
    return result;
  };
}

function patchMeasuredSubstep(target, fnName, metricKey, options = {}) {
  const original = target[fnName];
  target[fnName] = function patchedMeasuredSubstep(...args) {
    const shouldMeasure =
      activeSceneMetrics &&
      (options.service ? activeService === options.service : true);
    const startedAt = shouldMeasure ? nowMs() : 0;
    try {
      return original.apply(this, args);
    } finally {
      if (shouldMeasure) {
        addMetric(activeSceneMetrics, metricKey, nowMs() - startedAt);
      }
    }
  };
}

function patchMeasuredService(target, fnName, serviceName, metricKey, options = {}) {
  const original = target[fnName];
  target[fnName] = function patchedMeasuredService(...args) {
    if (!activeSceneMetrics) {
      return original.apply(this, args);
    }
    const previousService = activeService;
    activeService = serviceName;
    const startedAt = nowMs();
    try {
      const result = original.apply(this, args);
      if (typeof options.collectCounts === "function") {
        options.collectCounts(activeSceneMetrics, result);
      }
      return result;
    } finally {
      addMetric(activeSceneMetrics, metricKey, nowMs() - startedAt);
      activeService = previousService;
    }
  };
}

function buildHighLevelAggregate(systemResults, refreshStargatesMs) {
  const constructorMs = sumValues(systemResults.map((result) => result.constructorMs));
  const asteroidMs = sumValues(systemResults.map((result) => result.asteroidMs));
  const miningMs = sumValues(systemResults.map((result) => result.miningMs));
  const npcMs = sumValues(systemResults.map((result) => result.npcMs));
  const totalMs = constructorMs + asteroidMs + miningMs + npcMs + refreshStargatesMs;
  return [
    {
      phase: "constructor",
      ms: constructorMs,
    },
    {
      phase: "npcStartup",
      ms: npcMs,
    },
    {
      phase: "asteroidFields",
      ms: asteroidMs,
    },
    {
      phase: "miningStartup",
      ms: miningMs,
    },
    {
      phase: "refreshStargateActivationStates",
      ms: refreshStargatesMs,
    },
  ]
    .map((entry) => ({
      ...entry,
      pctOfMeasuredLoad: totalMs > 0 ? roundTo((entry.ms / totalMs) * 100, 2) : 0,
    }))
    .sort((left, right) => right.ms - left.ms);
}

function buildConstructorAggregate(systemResults) {
  const keys = [
    "constructor.systemLookupMs",
    "constructor.stations.retrieveMs",
    "constructor.stations.loopMs",
    "constructor.structures.retrieveMs",
    "constructor.structures.loopMs",
    "constructor.asteroidBelts.retrieveMs",
    "constructor.asteroidBelts.loopMs",
    "constructor.celestials.retrieveMs",
    "constructor.celestials.loopMs",
    "constructor.stargates.retrieveMs",
    "constructor.stargates.loopMs",
    "constructor.dynamicItems.retrieveMs",
    "constructor.dynamicItems.loopMs",
    "constructor.otherMs",
  ];

  return keys
    .map((key) => ({
      phase: key.replace(/^constructor\./, ""),
      ms: sumValues(systemResults.map((result) => result.rawPhases[key] || 0)),
    }))
    .filter((entry) => entry.ms > 0)
    .sort((left, right) => right.ms - left.ms);
}

function buildSlowestPhaseInstance(systemResults) {
  const candidates = [];
  for (const result of systemResults) {
    const phaseEntries = [
      ["constructor", result.constructorMs],
      ["constructor.other", result.constructorBreakdown.otherMs],
      ["constructor.asteroidBelts.loop", result.constructorBreakdown.asteroidBelts.loopMs],
      ["constructor.stargates.loop", result.constructorBreakdown.stargates.loopMs],
      ["constructor.celestials.loop", result.constructorBreakdown.celestials.loopMs],
      ["constructor.stations.loop", result.constructorBreakdown.stations.loopMs],
      ["constructor.dynamicItems.loop", result.constructorBreakdown.dynamicItems.loopMs],
      ["asteroidFields", result.asteroidMs],
      ["miningStartup", result.miningMs],
      ["npcStartup", result.npcMs],
      ["npc.spawnRulesAndOther", result.npcBreakdown.spawnRulesAndOtherMs],
    ];
    for (const [phase, ms] of phaseEntries) {
      candidates.push({
        systemID: result.systemID,
        name: result.name,
        phase,
        ms,
      });
    }
  }
  candidates.sort((left, right) => right.ms - left.ms);
  const slowest = candidates[0] || null;
  return slowest
    ? {
        ...slowest,
        ms: roundTo(slowest.ms),
      }
    : null;
}

function stripRawPhases(systemResult) {
  if (!systemResult) {
    return null;
  }
  const { rawPhases, ...withoutRawPhases } = systemResult;
  return withoutRawPhases;
}

function main() {
  const requestedSystemIDs = parseSystemIDs(process.argv);
  const requestedCount = parseSystemCount(process.argv, 5);
  const requestedSeed = parseSeed(process.argv, "1337");
  const useRandomSelection = parseRandomSelectionEnabled(process.argv);
  const benchmarkStartedAt = nowMs();

  config.logLevel = 0;

  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;

  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};

  try {
    const databasePreloadStartedAt = nowMs();
    database.preloadAll();
    const databasePreloadMs = nowMs() - databasePreloadStartedAt;

    const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
    const itemStore = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));

    const worldDataLoadStartedAt = nowMs();
    worldData.ensureLoaded();
    const worldDataLoadMs = nowMs() - worldDataLoadStartedAt;

    patchMeasuredValueGetter(worldData, "getSolarSystemByID", "constructor.systemLookupMs");
    patchMeasuredArrayGetter(worldData, "getStationsForSystem", "constructor.stations");
    patchMeasuredArrayGetter(worldData, "getStructuresForSystem", "constructor.structures");
    patchMeasuredArrayGetter(worldData, "getAsteroidBeltsForSystem", "constructor.asteroidBelts");
    patchMeasuredArrayGetter(worldData, "getCelestialsForSystem", "constructor.celestials");
    patchMeasuredArrayGetter(worldData, "getStargatesForSystem", "constructor.stargates");
    patchMeasuredArrayGetter(itemStore, "listSystemSpaceItems", "constructor.dynamicItems");

    const miningRuntimeState = require(path.join(
      repoRoot,
      "server/src/services/mining/miningRuntimeState",
    ));
    patchMeasuredSubstep(
      miningRuntimeState,
      "ensureSceneMiningState",
      "services.mining.ensureSceneStateMs",
      { service: "mining" },
    );

    const miningResourceSiteService = require(path.join(
      repoRoot,
      "server/src/services/mining/miningResourceSiteService",
    ));
    patchMeasuredService(
      miningResourceSiteService,
      "handleSceneCreated",
      "mining",
      "services.mining.resourceSitesMs",
      {
        collectCounts(sceneMetrics, result) {
          const spawned = Array.isArray(result && result.data && result.data.spawned)
            ? result.data.spawned.length
            : 0;
          setCount(sceneMetrics, "services.mining.generatedResourceSites", spawned);
        },
      },
    );

    const miningNpcOperations = require(path.join(
      repoRoot,
      "server/src/services/mining/miningNpcOperations",
    ));
    patchMeasuredSubstep(
      miningNpcOperations,
      "handleSceneCreated",
      "services.mining.npcOperationsMs",
      { service: "mining" },
    );

    const miningRuntime = require(path.join(repoRoot, "server/src/services/mining/miningRuntime"));
    patchMeasuredService(
      miningRuntime,
      "handleSceneCreated",
      "mining",
      "services.mining.totalMs",
    );

    const asteroidService = require(path.join(repoRoot, "server/src/space/asteroids"));
    patchMeasuredService(
      asteroidService,
      "handleSceneCreated",
      "asteroid",
      "services.asteroid.totalMs",
      {
        collectCounts(sceneMetrics, result) {
          const spawned = Array.isArray(result && result.data && result.data.spawned)
            ? result.data.spawned.length
            : 0;
          setCount(sceneMetrics, "services.asteroid.generatedAsteroids", spawned);
        },
      },
    );

    const runtime = require(path.join(repoRoot, "server/src/space/runtime"));

    const legacySyntheticNpcCleanup = require(path.join(
      repoRoot,
      "server/src/space/npc/legacySyntheticNpcCleanup",
    ));
    patchMeasuredSubstep(
      legacySyntheticNpcCleanup,
      "cleanupLegacySyntheticNpcShips",
      "services.npc.cleanupLegacyMs",
      { service: "npc" },
    );

    const nativeNpcService = require(path.join(repoRoot, "server/src/space/npc/nativeNpcService"));
    patchMeasuredSubstep(
      nativeNpcService,
      "cleanupStaleNativeStartupControllers",
      "services.npc.cleanupStaleControllersMs",
      { service: "npc" },
    );

    const npcService = require(path.join(repoRoot, "server/src/space/npc"));
    patchMeasuredService(
      npcService,
      "handleSceneCreated",
      "npc",
      "services.npc.totalMs",
      {
        collectCounts(sceneMetrics, result) {
          const removedLegacySyntheticNpcs = Array.isArray(
            result && result.data && result.data.removedLegacySyntheticNpcs,
          )
            ? result.data.removedLegacySyntheticNpcs.length
            : 0;
          const removedStaleNativeStartupNpcs = Array.isArray(
            result && result.data && result.data.removedStaleNativeStartupNpcs,
          )
            ? result.data.removedStaleNativeStartupNpcs.length
            : 0;
          const applied = Array.isArray(result && result.data && result.data.applied)
            ? result.data.applied.length
            : 0;
          setCount(sceneMetrics, "services.npc.removedLegacySyntheticNpcs", removedLegacySyntheticNpcs);
          setCount(sceneMetrics, "services.npc.removedStaleNativeStartupNpcs", removedStaleNativeStartupNpcs);
          setCount(sceneMetrics, "services.npc.appliedStartupRules", applied);
        },
      },
    );

    runtime._testing.clearScenes();
    runtime._testing.resetStargateActivationOverrides();

    const allSystems = worldData.getSolarSystems()
      .map((system) => ({
        solarSystemID: Number(system && system.solarSystemID) || 0,
        solarSystemName: String(system && system.solarSystemName || ""),
        security: Number(system && system.security) || 0,
      }))
      .filter((system) => system.solarSystemID > 0)
      .sort((left, right) => left.solarSystemID - right.solarSystemID);

    const selectedSystems =
      requestedSystemIDs.length > 0
        ? requestedSystemIDs
            .map((systemID) => worldData.getSolarSystemByID(systemID))
            .filter(Boolean)
            .map((system) => ({
              solarSystemID: Number(system && system.solarSystemID) || 0,
              solarSystemName: String(system && system.solarSystemName || ""),
              security: Number(system && system.security) || 0,
            }))
        : useRandomSelection
          ? chooseRandomSystems(allSystems, requestedCount, requestedSeed)
          : allSystems.slice(0, requestedCount);

    if (selectedSystems.length <= 0) {
      throw new Error("No solar systems were selected for benchmarking.");
    }

    const sceneMetricsByID = new Map(
      selectedSystems.map((system) => [system.solarSystemID, createSceneMetrics(system)]),
    );

    const originalEnsureScene = runtime.ensureScene.bind(runtime);
    let ensureSceneInstrumentationDepth = 0;
    runtime.ensureScene = function patchedEnsureScene(systemID, options = {}) {
      const numericSystemID = toPositiveInt(systemID, 0);
      const sceneMetrics = sceneMetricsByID.get(numericSystemID) || null;
      const shouldMeasure =
        benchmarkLoadActive === true &&
        sceneMetrics !== null &&
        ensureSceneInstrumentationDepth === 0 &&
        !runtime.scenes.has(numericSystemID);
      if (!shouldMeasure) {
        return originalEnsureScene(systemID, options);
      }

      ensureSceneInstrumentationDepth = 1;
      activeSceneMetrics = sceneMetrics;
      activeService = "constructor";
      const ensureSceneStartedAt = nowMs();
      try {
        return originalEnsureScene(systemID, options);
      } finally {
        addMetric(sceneMetrics, "ensureScene.totalMs", nowMs() - ensureSceneStartedAt);
        activeService = null;
        activeSceneMetrics = null;
        ensureSceneInstrumentationDepth = 0;
      }
    };

    const originalRefreshStargates = runtime.refreshStargateActivationStates.bind(runtime);
    let refreshStargatesMs = 0;
    let refreshInstrumentationDepth = 0;
    runtime.refreshStargateActivationStates = function patchedRefreshStargates(...args) {
      const shouldMeasure = benchmarkLoadActive === true && refreshInstrumentationDepth === 0;
      const refreshStartedAt = shouldMeasure ? nowMs() : 0;
      if (shouldMeasure) {
        refreshInstrumentationDepth = 1;
      }
      try {
        return originalRefreshStargates(...args);
      } finally {
        if (shouldMeasure) {
          refreshStargatesMs += nowMs() - refreshStartedAt;
          refreshInstrumentationDepth = 0;
        }
      }
    };

    benchmarkLoadActive = true;
    const preloadSolarSystemsStartedAt = nowMs();
    const activationChanges = runtime.preloadSolarSystems(
      selectedSystems.map((system) => system.solarSystemID),
      {
        broadcast: true,
      },
    );
    const preloadSolarSystemsMs = nowMs() - preloadSolarSystemsStartedAt;
    benchmarkLoadActive = false;
    const sceneLoadOnlyMs = Math.max(0, preloadSolarSystemsMs - refreshStargatesMs);

    const systemResults = selectedSystems.map((system) => {
      const sceneMetrics = sceneMetricsByID.get(system.solarSystemID);
      const rawPhases = sceneMetrics.phases;
      const rawCounts = sceneMetrics.counts;
      const scene = runtime.scenes.get(system.solarSystemID);

      const constructorMs =
        (rawPhases["ensureScene.totalMs"] || 0) -
        (rawPhases["services.asteroid.totalMs"] || 0) -
        (rawPhases["services.mining.totalMs"] || 0) -
        (rawPhases["services.npc.totalMs"] || 0);

      const constructorKnownMs = sumValues([
        rawPhases["constructor.systemLookupMs"],
        rawPhases["constructor.stations.retrieveMs"],
        rawPhases["constructor.stations.loopMs"],
        rawPhases["constructor.structures.retrieveMs"],
        rawPhases["constructor.structures.loopMs"],
        rawPhases["constructor.asteroidBelts.retrieveMs"],
        rawPhases["constructor.asteroidBelts.loopMs"],
        rawPhases["constructor.celestials.retrieveMs"],
        rawPhases["constructor.celestials.loopMs"],
        rawPhases["constructor.stargates.retrieveMs"],
        rawPhases["constructor.stargates.loopMs"],
        rawPhases["constructor.dynamicItems.retrieveMs"],
        rawPhases["constructor.dynamicItems.loopMs"],
      ]);
      const constructorOtherMs = Math.max(0, constructorMs - constructorKnownMs);

      const miningMs = rawPhases["services.mining.totalMs"] || 0;
      const miningKnownMs = sumValues([
        rawPhases["services.mining.resourceSitesMs"],
        rawPhases["services.mining.ensureSceneStateMs"],
        rawPhases["services.mining.npcOperationsMs"],
      ]);
      const miningOtherMs = Math.max(0, miningMs - miningKnownMs);

      const npcMs = rawPhases["services.npc.totalMs"] || 0;
      const npcKnownMs = sumValues([
        rawPhases["services.npc.cleanupLegacyMs"],
        rawPhases["services.npc.cleanupStaleControllersMs"],
      ]);
      const npcSpawnRulesAndOtherMs = Math.max(0, npcMs - npcKnownMs);

      return {
        systemID: system.solarSystemID,
        name: system.solarSystemName,
        security: roundTo(system.security, 6),
        ensureSceneMs: roundTo(rawPhases["ensureScene.totalMs"] || 0),
        constructorMs: roundTo(constructorMs),
        asteroidMs: roundTo(rawPhases["services.asteroid.totalMs"] || 0),
        miningMs: roundTo(miningMs),
        npcMs: roundTo(npcMs),
        constructorBreakdown: roundObjectValues({
          systemLookupMs: rawPhases["constructor.systemLookupMs"] || 0,
          stations: {
            retrieveMs: rawPhases["constructor.stations.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.stations.loopMs"] || 0,
          },
          structures: {
            retrieveMs: rawPhases["constructor.structures.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.structures.loopMs"] || 0,
          },
          asteroidBelts: {
            retrieveMs: rawPhases["constructor.asteroidBelts.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.asteroidBelts.loopMs"] || 0,
          },
          celestials: {
            retrieveMs: rawPhases["constructor.celestials.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.celestials.loopMs"] || 0,
          },
          stargates: {
            retrieveMs: rawPhases["constructor.stargates.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.stargates.loopMs"] || 0,
          },
          dynamicItems: {
            retrieveMs: rawPhases["constructor.dynamicItems.retrieveMs"] || 0,
            loopMs: rawPhases["constructor.dynamicItems.loopMs"] || 0,
          },
          otherMs: constructorOtherMs,
        }),
        miningBreakdown: roundObjectValues({
          resourceSitesMs: rawPhases["services.mining.resourceSitesMs"] || 0,
          ensureSceneStateMs: rawPhases["services.mining.ensureSceneStateMs"] || 0,
          npcOperationsMs: rawPhases["services.mining.npcOperationsMs"] || 0,
          otherMs: miningOtherMs,
        }),
        npcBreakdown: roundObjectValues({
          cleanupLegacyMs: rawPhases["services.npc.cleanupLegacyMs"] || 0,
          cleanupStaleControllersMs: rawPhases["services.npc.cleanupStaleControllersMs"] || 0,
          spawnRulesAndOtherMs: npcSpawnRulesAndOtherMs,
        }),
        counts: {
          constructor: {
            stations: rawCounts["constructor.stations.count"] || 0,
            structures: rawCounts["constructor.structures.count"] || 0,
            asteroidBelts: rawCounts["constructor.asteroidBelts.count"] || 0,
            celestials: rawCounts["constructor.celestials.count"] || 0,
            stargates: rawCounts["constructor.stargates.count"] || 0,
            dynamicItems: rawCounts["constructor.dynamicItems.count"] || 0,
          },
          generated: {
            asteroids: rawCounts["services.asteroid.generatedAsteroids"] || 0,
            miningResourceSites: rawCounts["services.mining.generatedResourceSites"] || 0,
          },
          npc: {
            appliedStartupRules: rawCounts["services.npc.appliedStartupRules"] || 0,
            removedLegacySyntheticNpcs: rawCounts["services.npc.removedLegacySyntheticNpcs"] || 0,
            removedStaleNativeStartupNpcs:
              rawCounts["services.npc.removedStaleNativeStartupNpcs"] || 0,
          },
          scene: {
            staticEntities: scene && Array.isArray(scene.staticEntities)
              ? scene.staticEntities.length
              : 0,
            dynamicEntities: scene && scene.dynamicEntities instanceof Map
              ? scene.dynamicEntities.size
              : 0,
            staticKinds: listKindCounts(
              scene && Array.isArray(scene.staticEntities) ? scene.staticEntities : [],
            ),
            dynamicKinds: listKindCounts(
              scene && scene.dynamicEntities instanceof Map
                ? [...scene.dynamicEntities.values()]
                : [],
            ),
          },
        },
        rawPhases: roundObjectValues(rawPhases),
      };
    });

    const slowestSystem = stripRawPhases(
      [...systemResults].sort((left, right) => right.ensureSceneMs - left.ensureSceneMs)[0] || null,
    );
    const highLevelAggregate = buildHighLevelAggregate(systemResults, refreshStargatesMs);
    const constructorAggregate = buildConstructorAggregate(systemResults).map((entry) => ({
      phase: entry.phase,
      ms: roundTo(entry.ms),
    }));
    const slowestPhaseInstance = buildSlowestPhaseInstance(systemResults);

    const result = roundObjectValues({
      benchmarkDate: new Date().toISOString(),
      selection: {
        mode: requestedSystemIDs.length > 0 ? "explicit" : (useRandomSelection ? "random" : "first-n"),
        seed: requestedSystemIDs.length > 0 ? null : (useRandomSelection ? String(requestedSeed) : null),
      },
      selectedSystemCount: selectedSystems.length,
      selectedSystems: selectedSystems.map((system) => ({
        systemID: system.solarSystemID,
        name: system.solarSystemName,
        security: system.security,
      })),
      config: {
        NewEdenSystemLoading: config.NewEdenSystemLoading,
        asteroidFieldsEnabled: config.asteroidFieldsEnabled === true,
        miningEnabled: config.miningEnabled === true,
        npcAuthoredStartupEnabled: config.npcAuthoredStartupEnabled === true,
        npcDefaultConcordStartupEnabled: config.npcDefaultConcordStartupEnabled === true,
        npcDefaultConcordStationScreensEnabled: config.npcDefaultConcordStationScreensEnabled === true,
        skipNpcStartup: process.env.EVEJS_SKIP_NPC_STARTUP === "1",
      },
      topLevelTimings: {
        databasePreloadMs,
        worldDataLoadMs,
        preloadSolarSystemsMs,
        sceneLoadOnlyMs,
        refreshStargatesMs,
        measuredSystemLoadMs: preloadSolarSystemsMs,
        measuredFiveSystemLoadMs: sceneLoadOnlyMs + refreshStargatesMs,
        totalBenchmarkWallclockMs: nowMs() - benchmarkStartedAt,
      },
      activationChangeCount: Array.isArray(activationChanges) ? activationChanges.length : 0,
      systems: systemResults.map((systemResult) => stripRawPhases(systemResult)),
      aggregate: {
        slowestSystem,
        highLevelPhases: highLevelAggregate.map((entry) => ({
          phase: entry.phase,
          ms: roundTo(entry.ms),
          pctOfMeasuredLoad: entry.pctOfMeasuredLoad,
        })),
        constructorPhases: constructorAggregate,
        slowestPhaseInstance,
      },
    });

    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    originalConsoleLog(`BENCHMARK_RESULT=${JSON.stringify(result)}`);
  } catch (error) {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

main();

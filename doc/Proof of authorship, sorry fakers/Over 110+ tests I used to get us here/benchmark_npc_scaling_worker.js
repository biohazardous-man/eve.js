/*
 * Proof-of-authorship note: Primary authorship and project direction for this benchmark script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const {
  setStartupRuleEnabledOverride,
} = require(path.join(repoRoot, "server/src/space/npc/npcControlState"));
const {
  clearControllers,
  listControllers,
} = require(path.join(repoRoot, "server/src/space/npc/npcRegistry"));
const nativeNpcStore = require(path.join(repoRoot, "server/src/space/npc/nativeNpcStore"));
const {
  isAmbientStartupControllerRecord,
} = require(path.join(repoRoot, "server/src/space/npc/npcAmbientMaterialization"));
const {
  isCombatDormantControllerRecord,
} = require(path.join(repoRoot, "server/src/space/npc/npcCombatDormancy"));
const PROGRESS_STATE_PATH = String(process.env.BENCHMARK_PROGRESS_STATE_PATH || "").trim();

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

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function roundTo(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function sleepMs(durationMs) {
  const normalizedDurationMs = Math.max(0, Math.trunc(Number(durationMs) || 0));
  if (normalizedDurationMs <= 0) {
    return;
  }
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, normalizedDurationMs);
}

function parseBooleanFlag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCliArguments(argv) {
  const options = {
    mode: null,
    defaultConcordStartupEnabled: undefined,
    authoredStartupEnabled: undefined,
    defaultConcordStationScreensEnabled: undefined,
    enabledStartupRuleIDs: [],
    sampleSystemID: 30000142,
    tickIterations: 20,
    tickStepMs: runtime._testing.RUNTIME_TICK_INTERVAL_MS,
    progress: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }

    if (/^\d+$/.test(argument) && options.mode === null) {
      options.mode = toPositiveInt(argument, 1);
      continue;
    }
    if (argument.startsWith("--mode=")) {
      options.mode = toPositiveInt(argument.slice("--mode=".length), 1);
      continue;
    }
    if (argument === "--mode") {
      options.mode = toPositiveInt(argv[index + 1], 1);
      index += 1;
      continue;
    }
    if (argument.startsWith("--default-concord=")) {
      options.defaultConcordStartupEnabled = parseBooleanFlag(
        argument.slice("--default-concord=".length),
        undefined,
      );
      continue;
    }
    if (argument.startsWith("--authored-startup=")) {
      options.authoredStartupEnabled = parseBooleanFlag(
        argument.slice("--authored-startup=".length),
        undefined,
      );
      continue;
    }
    if (argument.startsWith("--station-screens=")) {
      options.defaultConcordStationScreensEnabled = parseBooleanFlag(
        argument.slice("--station-screens=".length),
        undefined,
      );
      continue;
    }
    if (argument.startsWith("--sample-system=")) {
      options.sampleSystemID = toPositiveInt(argument.slice("--sample-system=".length), 30000142);
      continue;
    }
    if (argument.startsWith("--enable-startup-rule=")) {
      const startupRuleID = String(argument.slice("--enable-startup-rule=".length) || "").trim();
      if (startupRuleID) {
        options.enabledStartupRuleIDs.push(startupRuleID);
      }
      continue;
    }
    if (argument === "--progress") {
      options.progress = true;
      continue;
    }
    if (argument.startsWith("--tick-iterations=")) {
      options.tickIterations = Math.max(1, toPositiveInt(argument.slice("--tick-iterations=".length), 20));
      continue;
    }
    if (argument.startsWith("--tick-step-ms=")) {
      options.tickStepMs = Math.max(1, toPositiveInt(argument.slice("--tick-step-ms=".length), runtime._testing.RUNTIME_TICK_INTERVAL_MS));
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function writeProgress(options, message) {
  if (!options || options.progress !== true) {
    return;
  }
  process.stderr.write(`[worker] ${message}\n`);
}

let currentProgressOptions = null;
let currentProgressState = null;
let benchmarkRunStartedAtMs = 0;

function writeProgressState(patch = {}) {
  if (!PROGRESS_STATE_PATH) {
    return;
  }
  currentProgressState = {
    ...(currentProgressState || {}),
    ...patch,
    updatedAtMs: Date.now(),
  };
  fs.writeFileSync(PROGRESS_STATE_PATH, `${JSON.stringify(currentProgressState, null, 2)}\n`, "utf8");
}

function applyConfigOverrides(options) {
  if (options.mode !== null) {
    config.NewEdenSystemLoading = options.mode;
  }
  if (options.defaultConcordStartupEnabled !== undefined) {
    config.npcDefaultConcordStartupEnabled = options.defaultConcordStartupEnabled === true;
  }
  if (options.authoredStartupEnabled !== undefined) {
    config.npcAuthoredStartupEnabled = options.authoredStartupEnabled === true;
  }
  if (options.defaultConcordStationScreensEnabled !== undefined) {
    config.npcDefaultConcordStationScreensEnabled =
      options.defaultConcordStationScreensEnabled === true;
  }
  config.logLevel = 0;
  for (const startupRuleID of options.enabledStartupRuleIDs || []) {
    setStartupRuleEnabledOverride(startupRuleID, true);
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(table) {
  const result = database.read(table, "/");
  if (!result.success || result.data === null || result.data === undefined) {
    return {};
  }
  return cloneValue(result.data);
}

function getTableFilePath(table) {
  return path.join(repoRoot, "server/src/newDatabase/data", table, "data.json");
}

function writeTableSnapshot(table, snapshot) {
  const writeResult = database.write(table, "/", cloneValue(snapshot));
  if (!writeResult.success) {
    throw new Error(`Failed to restore table ${table}: ${writeResult.errorMsg || "WRITE_ERROR"}`);
  }
}

function snapshotMutableTables() {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [
      table,
      {
        data: readTableSnapshot(table),
        rawContents: fs.readFileSync(getTableFilePath(table), "utf8"),
      },
    ]),
  );
}

function restoreMutableTables(snapshot) {
  runtime._testing.clearScenes();
  clearControllers();
  runtime._testing.resetStargateActivationOverrides();
  for (const table of SNAPSHOT_TABLES) {
    writeTableSnapshot(table, snapshot[table] && snapshot[table].data || {});
  }
  database.flushAllSync();
  for (const table of SNAPSHOT_TABLES) {
    const tableSnapshot = snapshot[table];
    if (!tableSnapshot || typeof tableSnapshot.rawContents !== "string") {
      continue;
    }
    const tablePath = getTableFilePath(table);
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.writeFileSync(tablePath, tableSnapshot.rawContents, "utf8");
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!(error && (error.code === "EBUSY" || error.code === "EPERM")) || attempt >= 4) {
          throw error;
        }
        sleepMs(25 * (attempt + 1));
      }
    }
    if (lastError) {
      throw lastError;
    }
  }
}

function countSceneEntities(scenes) {
  let dynamicEntities = 0;
  let npcShips = 0;
  for (const scene of scenes) {
    dynamicEntities += scene.dynamicEntities instanceof Map ? scene.dynamicEntities.size : 0;
    if (scene.dynamicEntities instanceof Map) {
      for (const entity of scene.dynamicEntities.values()) {
        if (entity && entity.npcEntityType) {
          npcShips += 1;
        }
      }
    }
  }
  return {
    dynamicEntities,
    npcShips,
  };
}

function buildRelevantWakePositions(scene) {
  if (!scene || !Array.isArray(scene.staticEntities)) {
    return [];
  }
  const preferredAnchor =
    scene.staticEntities.find((entity) => entity && entity.kind === "stargate") ||
    scene.staticEntities.find((entity) => entity && entity.kind === "station") ||
    null;
  if (!preferredAnchor || !preferredAnchor.position) {
    return [];
  }
  return [{
    x: Number(preferredAnchor.position.x || 0) + 1_000,
    y: Number(preferredAnchor.position.y || 0),
    z: Number(preferredAnchor.position.z || 0) + 1_000,
  }];
}

function countControllers(systemIDs = null) {
  const allowedSystems = Array.isArray(systemIDs)
    ? new Set(
        systemIDs
          .map((systemID) => toPositiveInt(systemID, 0))
          .filter((systemID) => systemID > 0),
      )
    : null;
  const controllers = listControllers();
  const liveEntityIDs = new Set();
  const counts = {
    total: 0,
    ambient: 0,
    combat: 0,
    virtualizedAmbient: 0,
    virtualizedCombat: 0,
  };
  for (const controller of controllers) {
    const systemID = toPositiveInt(controller && controller.systemID, 0);
    if (allowedSystems && !allowedSystems.has(systemID)) {
      continue;
    }
    counts.total += 1;
    liveEntityIDs.add(toPositiveInt(controller && controller.entityID, 0));
    const runtimeKind = String(controller && controller.runtimeKind || "").trim();
    if (runtimeKind === "nativeAmbient") {
      counts.ambient += 1;
    } else {
      counts.combat += 1;
    }
  }
  for (const controllerRecord of nativeNpcStore.listNativeControllers()) {
    const systemID = toPositiveInt(controllerRecord && controllerRecord.systemID, 0);
    if (allowedSystems && !allowedSystems.has(systemID)) {
      continue;
    }
    const entityID = toPositiveInt(controllerRecord && controllerRecord.entityID, 0);
    if (!entityID || liveEntityIDs.has(entityID)) {
      continue;
    }
    if (isAmbientStartupControllerRecord(controllerRecord)) {
      counts.virtualizedAmbient += 1;
      continue;
    }
    if (isCombatDormantControllerRecord(controllerRecord)) {
      counts.virtualizedCombat += 1;
    }
  }
  return counts;
}

function preloadStartupScenes(preloadPlan) {
  const totalSystems = Array.isArray(preloadPlan && preloadPlan.systemIDs)
    ? preloadPlan.systemIDs.length
    : 0;
  let cumulativeSystemElapsedMs = 0;
  for (let index = 0; index < totalSystems; index += 1) {
    const systemID = preloadPlan.systemIDs[index];
    const systemRecord = worldData.getSolarSystemByID(systemID);
    const systemName =
      String(
        (systemRecord && (
          systemRecord.solarSystemName ||
          systemRecord.itemName ||
          systemRecord.name
        )) ||
        systemID,
      ).trim() || String(systemID);
    const systemStartedAtMs = Date.now();
    const completedSystems = index;
    const averageCompletedSystemMs = completedSystems > 0
      ? cumulativeSystemElapsedMs / completedSystems
      : 0;
    const estimatedRemainingMs = averageCompletedSystemMs > 0
      ? averageCompletedSystemMs * Math.max(0, totalSystems - completedSystems)
      : null;
    writeProgressState({
      stage: "preload-system",
      totalElapsedMs: benchmarkRunStartedAtMs > 0 ? Date.now() - benchmarkRunStartedAtMs : 0,
      totalSystems,
      systemIndex: index + 1,
      systemID,
      systemName,
      systemStartedAtMs,
      completedSystems,
      averageCompletedSystemMs: roundTo(averageCompletedSystemMs, 3),
      estimatedRemainingMs: estimatedRemainingMs === null ? null : roundTo(estimatedRemainingMs, 3),
    });
    writeProgress(
      currentProgressOptions,
      `preload system ${index + 1}/${totalSystems} phase=begin id=${systemID} name=${systemName}` +
        ` completed=${completedSystems}/${totalSystems}` +
        (averageCompletedSystemMs > 0
          ? ` avgSystemMs=${roundTo(averageCompletedSystemMs, 3)} etaMs=${roundTo(estimatedRemainingMs, 3)}`
          : ""),
    );
    runtime.ensureScene(systemID, { refreshStargates: false });
    const systemElapsedMs = Date.now() - systemStartedAtMs;
    cumulativeSystemElapsedMs += systemElapsedMs;
    const averageSystemMs = cumulativeSystemElapsedMs / (index + 1);
    const etaMs = averageSystemMs * Math.max(0, totalSystems - (index + 1));
    writeProgressState({
      stage: "preload-system-complete",
      totalElapsedMs: benchmarkRunStartedAtMs > 0 ? Date.now() - benchmarkRunStartedAtMs : 0,
      totalSystems,
      systemIndex: index + 1,
      systemID,
      systemName,
      systemStartedAtMs,
      systemElapsedMs: roundTo(systemElapsedMs, 3),
      completedSystems: index + 1,
      averageCompletedSystemMs: roundTo(averageSystemMs, 3),
      estimatedRemainingMs: roundTo(etaMs, 3),
    });
    writeProgress(
      currentProgressOptions,
      `preload system ${index + 1}/${totalSystems} phase=done id=${systemID} name=${systemName}` +
        ` elapsedMs=${roundTo(systemElapsedMs, 3)}` +
        ` avgSystemMs=${roundTo(averageSystemMs, 3)}` +
        ` etaMs=${roundTo(etaMs, 3)}`,
    );
  }
  writeProgressState({
    stage: "preload-refresh-stargates",
    totalElapsedMs: benchmarkRunStartedAtMs > 0 ? Date.now() - benchmarkRunStartedAtMs : 0,
    totalSystems,
    completedSystems: totalSystems,
    averageCompletedSystemMs: totalSystems > 0 ? roundTo(cumulativeSystemElapsedMs / totalSystems, 3) : 0,
    estimatedRemainingMs: 0,
  });
  writeProgress(currentProgressOptions, "preload phase=refresh-stargates begin");
  const activationChanges = runtime.refreshStargateActivationStates({
    broadcast: false,
  });
  writeProgress(currentProgressOptions, "preload phase=refresh-stargates done");
  return Array.isArray(activationChanges) ? activationChanges.length : 0;
}

function measureRuntimeTick(options) {
  const tickDurationsMs = [];
  const tickedSceneCounts = [];

  for (let index = 0; index < 3; index += 1) {
    runtime.tick();
  }

  for (let index = 0; index < options.tickIterations; index += 1) {
    const tickStartedAt = process.hrtime.bigint();
    const tickSummary = runtime.tick() || {};
    const tickFinishedAt = process.hrtime.bigint();
    tickDurationsMs.push(Number(tickFinishedAt - tickStartedAt) / 1_000_000);
    tickedSceneCounts.push(toPositiveInt(tickSummary.tickedSceneCount, 0));
  }

  const averageTickMs =
    tickDurationsMs.reduce((sum, value) => sum + value, 0) / tickDurationsMs.length;
  const averageTickedSceneCount =
    tickedSceneCounts.reduce((sum, value) => sum + value, 0) / tickedSceneCounts.length;

  return {
    averageTickMs,
    minimumTickMs: Math.min(...tickDurationsMs),
    maximumTickMs: Math.max(...tickDurationsMs),
    averageTickedSceneCount,
    minimumTickedSceneCount: Math.min(...tickedSceneCounts),
    maximumTickedSceneCount: Math.max(...tickedSceneCounts),
    tickIterations: options.tickIterations,
  };
}

function measureSampleScene(systemID, options) {
  runtime._testing.clearScenes();
  clearControllers();
  runtime._testing.resetStargateActivationOverrides();

  const ensureStartedAt = process.hrtime.bigint();
  const scene = runtime.ensureScene(systemID, { refreshStargates: false });
  const ensureFinishedAt = process.hrtime.bigint();
  runtime.refreshStargateActivationStates({
    broadcast: false,
  });

  const sceneEntityCounts = countSceneEntities([scene]);
  const controllerCounts = countControllers([systemID]);

  let wallclockNow = scene.getCurrentWallclockMs();
  for (let index = 0; index < 3; index += 1) {
    wallclockNow += options.tickStepMs;
    scene.tick(wallclockNow);
  }

  const tickDurationsMs = [];
  for (let index = 0; index < options.tickIterations; index += 1) {
    wallclockNow += options.tickStepMs;
    const tickStartedAt = process.hrtime.bigint();
    scene.tick(wallclockNow);
    const tickFinishedAt = process.hrtime.bigint();
    tickDurationsMs.push(Number(tickFinishedAt - tickStartedAt) / 1_000_000);
  }

  const averageTickMs = tickDurationsMs.reduce((sum, value) => sum + value, 0) / tickDurationsMs.length;
  const minimumTickMs = Math.min(...tickDurationsMs);
  const maximumTickMs = Math.max(...tickDurationsMs);

  return {
    systemID,
    ensureSceneElapsedMs: Number(ensureFinishedAt - ensureStartedAt) / 1_000_000,
    dynamicEntities: sceneEntityCounts.dynamicEntities,
    npcShips: sceneEntityCounts.npcShips,
    controllerCount: controllerCounts.total,
    ambientControllerCount: controllerCounts.ambient,
    combatControllerCount: controllerCounts.combat,
    virtualizedAmbientControllerCount: controllerCounts.virtualizedAmbient,
    virtualizedCombatControllerCount: controllerCounts.virtualizedCombat,
    averageTickMs,
    minimumTickMs,
    maximumTickMs,
    tickIterations: options.tickIterations,
    tickStepMs: options.tickStepMs,
  };
}

function measureSceneWake(systemID) {
  runtime._testing.clearScenes();
  clearControllers();
  runtime._testing.resetStargateActivationOverrides();

  runtime.ensureScene(systemID, { refreshStargates: false });
  runtime.refreshStargateActivationStates({
    broadcast: false,
  });
  const wakeRelevanceScene = runtime.ensureScene(systemID, { refreshStargates: false });
  const relevantPositions = buildRelevantWakePositions(wakeRelevanceScene);

  const wakeStartedAt = process.hrtime.bigint();
  const wakeResult = runtime.wakeSceneForImmediateUse(systemID, {
    reason: "benchmark-scene-wake",
    relevantPositions,
  });
  const wakeFinishedAt = process.hrtime.bigint();
  if (!wakeResult.success || !wakeResult.data || !wakeResult.data.scene) {
    throw new Error(wakeResult.errorMsg || "SCENE_WAKE_FAILED");
  }

  const scene = wakeResult.data.scene;
  const sceneEntityCounts = countSceneEntities([scene]);
  const controllerCounts = countControllers([systemID]);
  return {
    systemID,
    wakeSceneElapsedMs: Number(wakeFinishedAt - wakeStartedAt) / 1_000_000,
    dynamicEntities: sceneEntityCounts.dynamicEntities,
    npcShips: sceneEntityCounts.npcShips,
    controllerCount: controllerCounts.total,
    ambientControllerCount: controllerCounts.ambient,
    combatControllerCount: controllerCounts.combat,
    virtualizedAmbientControllerCount: controllerCounts.virtualizedAmbient,
    virtualizedCombatControllerCount: controllerCounts.virtualizedCombat,
    materializedAmbientCount: toPositiveInt(
      wakeResult.data.ambientMaterialization &&
        wakeResult.data.ambientMaterialization.materializedCount,
      0,
    ),
    materializedCombatCount: toPositiveInt(
      wakeResult.data.combatMaterialization &&
        wakeResult.data.combatMaterialization.materializedCount,
      0,
    ),
  };
}

function run() {
  const options = parseCliArguments(process.argv);
  currentProgressOptions = options;
  benchmarkRunStartedAtMs = Date.now();
  writeProgressState({
    stage: "start",
    startedAtMs: benchmarkRunStartedAtMs,
    totalElapsedMs: 0,
    mode: options.mode || null,
    sampleSystemID: options.sampleSystemID,
  });
  writeProgress(options, `start mode=${options.mode || "default"} sampleSystem=${options.sampleSystemID}`);
  database.preloadAll();
  writeProgressState({
    stage: "database-preload-complete",
    totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
  });
  writeProgress(options, "database preload complete");
  const tableSnapshot = snapshotMutableTables();
  applyConfigOverrides(options);
  writeProgressState({
    stage: "config-overrides-applied",
    totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
  });
  writeProgress(options, "config overrides applied");
  if (runtime._tickHandle) {
    clearInterval(runtime._tickHandle);
    runtime._tickHandle = null;
  }

  try {
    runtime._testing.clearScenes();
    clearControllers();
    runtime._testing.resetStargateActivationOverrides();

    const preloadPlan = runtime.getStartupSolarSystemPreloadPlan();
    writeProgressState({
      stage: "preload-begin",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
      totalSystems: preloadPlan.systemIDs.length,
      preloadMode: preloadPlan.mode,
      preloadModeName: preloadPlan.modeName,
    });
    writeProgress(
      options,
      `preload begin mode=${preloadPlan.mode} systems=${preloadPlan.systemIDs.length}`,
    );
    const preloadStartedAt = process.hrtime.bigint();
    const activationChangeCount = preloadStartupScenes(preloadPlan);
    const preloadFinishedAt = process.hrtime.bigint();
    writeProgressState({
      stage: "preload-complete",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
      totalSystems: preloadPlan.systemIDs.length,
      completedSystems: preloadPlan.systemIDs.length,
      estimatedRemainingMs: 0,
    });
    writeProgress(
      options,
      `preload complete elapsedMs=${roundTo(Number(preloadFinishedAt - preloadStartedAt) / 1_000_000, 3)}`,
    );
    const preloadScenes = [...runtime.scenes.values()];
    const preloadEntityCounts = countSceneEntities(preloadScenes);
    const preloadControllerCounts = countControllers(preloadPlan.systemIDs);
    writeProgressState({
      stage: "measure-runtime-tick",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
    });
    writeProgress(options, "measuring runtime tick");
    const runtimeTickMetrics = measureRuntimeTick(options);
    writeProgressState({
      stage: "measure-sample-scene",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
    });
    writeProgress(options, "measuring sample scene");
    const sampleSceneMetrics = measureSampleScene(options.sampleSystemID, options);
    writeProgressState({
      stage: "measure-sample-wake",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
    });
    writeProgress(options, "measuring sample wake");
    const sampleWakeMetrics = measureSceneWake(options.sampleSystemID);

    const result = {
      mode: preloadPlan.mode,
      modeName: preloadPlan.modeName,
      systemCount: preloadPlan.systemIDs.length,
      activationChangeCount,
      elapsedMs: roundTo(Number(preloadFinishedAt - preloadStartedAt) / 1_000_000, 3),
      sceneCount: preloadScenes.length,
      dynamicEntities: preloadEntityCounts.dynamicEntities,
      npcShips: preloadEntityCounts.npcShips,
      controllerCount: preloadControllerCounts.total,
      ambientControllerCount: preloadControllerCounts.ambient,
      combatControllerCount: preloadControllerCounts.combat,
      virtualizedAmbientControllerCount: preloadControllerCounts.virtualizedAmbient,
      virtualizedCombatControllerCount: preloadControllerCounts.virtualizedCombat,
      runtimeTick: {
        averageTickMs: roundTo(runtimeTickMetrics.averageTickMs, 3),
        minimumTickMs: roundTo(runtimeTickMetrics.minimumTickMs, 3),
        maximumTickMs: roundTo(runtimeTickMetrics.maximumTickMs, 3),
        averageTickedSceneCount: roundTo(runtimeTickMetrics.averageTickedSceneCount, 3),
        minimumTickedSceneCount: runtimeTickMetrics.minimumTickedSceneCount,
        maximumTickedSceneCount: runtimeTickMetrics.maximumTickedSceneCount,
        tickIterations: runtimeTickMetrics.tickIterations,
      },
      sampleScene: {
        systemID: sampleSceneMetrics.systemID,
        ensureSceneElapsedMs: roundTo(sampleSceneMetrics.ensureSceneElapsedMs, 3),
        dynamicEntities: sampleSceneMetrics.dynamicEntities,
        npcShips: sampleSceneMetrics.npcShips,
        controllerCount: sampleSceneMetrics.controllerCount,
        ambientControllerCount: sampleSceneMetrics.ambientControllerCount,
        combatControllerCount: sampleSceneMetrics.combatControllerCount,
        virtualizedAmbientControllerCount:
          sampleSceneMetrics.virtualizedAmbientControllerCount,
        virtualizedCombatControllerCount:
          sampleSceneMetrics.virtualizedCombatControllerCount,
        averageTickMs: roundTo(sampleSceneMetrics.averageTickMs, 3),
        minimumTickMs: roundTo(sampleSceneMetrics.minimumTickMs, 3),
        maximumTickMs: roundTo(sampleSceneMetrics.maximumTickMs, 3),
        tickIterations: sampleSceneMetrics.tickIterations,
        tickStepMs: sampleSceneMetrics.tickStepMs,
      },
      sampleWake: {
        systemID: sampleWakeMetrics.systemID,
        wakeSceneElapsedMs: roundTo(sampleWakeMetrics.wakeSceneElapsedMs, 3),
        dynamicEntities: sampleWakeMetrics.dynamicEntities,
        npcShips: sampleWakeMetrics.npcShips,
        controllerCount: sampleWakeMetrics.controllerCount,
        ambientControllerCount: sampleWakeMetrics.ambientControllerCount,
        combatControllerCount: sampleWakeMetrics.combatControllerCount,
        virtualizedAmbientControllerCount:
          sampleWakeMetrics.virtualizedAmbientControllerCount,
        virtualizedCombatControllerCount:
          sampleWakeMetrics.virtualizedCombatControllerCount,
        materializedAmbientCount: sampleWakeMetrics.materializedAmbientCount,
        materializedCombatCount: sampleWakeMetrics.materializedCombatCount,
      },
      configSnapshot: {
        NewEdenSystemLoading: config.NewEdenSystemLoading,
        npcDefaultConcordStartupEnabled: config.npcDefaultConcordStartupEnabled === true,
        npcAuthoredStartupEnabled: config.npcAuthoredStartupEnabled === true,
        npcDefaultConcordStationScreensEnabled:
          config.npcDefaultConcordStationScreensEnabled !== false,
        npcColdSceneSleepEnabled:
          process.env.EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP !== "1",
        npcAmbientVirtualizationEnabled:
          process.env.EVEJS_DISABLE_NPC_AMBIENT_VIRTUALIZATION !== "1",
        npcCombatDormancyEnabled:
          process.env.EVEJS_DISABLE_NPC_COMBAT_DORMANCY !== "1",
        npcAnchorRelevanceEnabled:
          process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE !== "1",
        enabledStartupRuleIDs: [...(options.enabledStartupRuleIDs || [])],
      },
    };

    console.log(`BENCHMARK_RESULT=${JSON.stringify(result)}`);
  } finally {
    writeProgressState({
      stage: "restoring-mutable-tables",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
    });
    writeProgress(options, "restoring mutable tables");
    restoreMutableTables(tableSnapshot);
    writeProgressState({
      stage: "done",
      totalElapsedMs: Date.now() - benchmarkRunStartedAtMs,
      completedAtMs: Date.now(),
    });
    writeProgress(options, "done");
    currentProgressOptions = null;
    currentProgressState = null;
    benchmarkRunStartedAtMs = 0;
  }
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}

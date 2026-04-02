const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const {
  ejectSession,
  rebuildDockedSessionAtStation,
} = require(path.join(__dirname, "./transitions"));
const {
  CAPSULE_TYPE_ID,
  ITEM_FLAGS,
  createSpaceItemForCharacter,
  findShipItemById,
  removeInventoryItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  resolveShipByTypeID,
} = require(path.join(__dirname, "../services/chat/shipTypeRegistry"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
const {
  getSpaceDebrisLifetimeMs,
} = require(path.join(__dirname, "../services/inventory/spaceDebrisState"));
const {
  resolveLocationDeathOutcome,
} = require(path.join(__dirname, "../services/killmail/deathOutcomeResolver"));

const DEFAULT_DEATH_TEST_COUNT = 6;
const DEFAULT_DEATH_TEST_RADIUS_METERS = 20_000;
const DEFAULT_DEATH_TEST_DELAY_MS = 2_000;
const DESTRUCTION_EFFECT_EXPLOSION = 3;
const RACE_WRECK_PREFIX_BY_ID = Object.freeze({
  1: "Caldari",
  2: "Minmatar",
  4: "Amarr",
  8: "Gallente",
  32: "Jove",
  64: "CONCORD",
  128: "ORE",
  256: "Triglavian",
  512: "EDENCOM",
});

const pendingDeathTests = new Map();
let nextPendingDeathTestID = 1;
let pendingDeathTestTimer = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function buildDunRotationFromDirection(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(Math.max(-1, Math.min(1, forward.y))) * (180 / Math.PI);
  return [yawDegrees, pitchDegrees, 0];
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function buildRandomDirection(baseDirection) {
  const forward = normalizeVector(baseDirection, { x: 1, y: 0, z: 0 });
  const angle = Math.random() * Math.PI * 2;
  const vertical = (Math.random() - 0.5) * 0.3;
  return normalizeVector({
    x: forward.x + Math.cos(angle),
    y: forward.y + vertical,
    z: forward.z + Math.sin(angle),
  }, forward);
}

function buildShipDeathPositions(anchorEntity, count, radiusMeters) {
  const anchorPosition = cloneVector(anchorEntity && anchorEntity.position);
  const anchorDirection = normalizeVector(
    anchorEntity && anchorEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const positions = [];
  const maxRadius = Math.max(3_000, toFiniteNumber(radiusMeters, DEFAULT_DEATH_TEST_RADIUS_METERS));

  for (let index = 0; index < count; index += 1) {
    let accepted = null;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const direction = buildRandomDirection(anchorDirection);
      const offset = 3_000 + (Math.random() * Math.max(0, maxRadius - 3_000));
      const candidate = addVectors(anchorPosition, scaleVector(direction, offset));
      const collides = positions.some((existing) => distance(existing, candidate) < 1_500);
      if (!collides) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) {
      break;
    }
    positions.push(accepted);
  }

  return positions;
}

function resolveShipWreckRacePrefix(shipMeta = {}, itemMeta = {}) {
  const raceID = toPositiveInt(
    shipMeta.raceID !== undefined ? shipMeta.raceID : itemMeta.raceID,
    0,
  );
  return RACE_WRECK_PREFIX_BY_ID[raceID] || null;
}

function resolveShipHullClassName(shipMeta = {}, itemMeta = {}) {
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  if (!groupName) {
    return null;
  }
  if (groupName.includes("titan")) {
    return "Titan";
  }
  if (groupName.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (groupName.includes("carrier")) {
    return "Carrier";
  }
  if (groupName.includes("dread")) {
    return "Dreadnought";
  }
  if (groupName.includes("jump freighter") || groupName.includes("freighter")) {
    return "Freighter";
  }
  if (groupName.includes("mining barge") || groupName.includes("barge") || groupName.includes("exhumer")) {
    return "Mining Barge";
  }
  if (groupName.includes("industrial") || groupName.includes("hauler") || groupName.includes("transport ship")) {
    return "Hauler";
  }
  if (groupName.includes("battleship") || groupName.includes("marauder") || groupName.includes("black ops")) {
    return "Battleship";
  }
  if (groupName.includes("battlecruiser") || groupName.includes("command ship")) {
    return "Battlecruiser";
  }
  if (groupName.includes("cruiser") || groupName.includes("heavy interdictor") || groupName.includes("strategic cruiser")) {
    return "Cruiser";
  }
  if (groupName.includes("destroyer") || groupName.includes("interdictor")) {
    return "Destroyer";
  }
  if (groupName.includes("shuttle")) {
    return "Shuttle";
  }
  if (groupName.includes("frigate") || groupName.includes("corvette")) {
    return "Frigate";
  }
  return null;
}

function buildShipWreckCandidateNames(shipMeta = {}, itemMeta = {}) {
  const hullClassName = resolveShipHullClassName(shipMeta, itemMeta);
  const racePrefix = resolveShipWreckRacePrefix(shipMeta, itemMeta);
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  const candidates = [];

  if (groupName.includes("capsule")) {
    candidates.push("Mysterious Capsule Wreck");
  }
  if (racePrefix && hullClassName) {
    candidates.push(`${racePrefix} ${hullClassName} Wreck`);
  }
  if (hullClassName) {
    candidates.push(`${hullClassName} Wreck`);
  }
  candidates.push("Wreck");
  return [...new Set(candidates)];
}

function releaseControlledCraftForDestroyedShip(systemID, shipEntity) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
    return;
  }

  const scene = spaceRuntime.ensureScene(numericSystemID);
  if (!scene) {
    return;
  }

  try {
    const droneRuntime = require(path.join(__dirname, "../services/drone/droneRuntime"));
    if (droneRuntime && typeof droneRuntime.handleControllerLost === "function") {
      droneRuntime.handleControllerLost(scene, shipEntity, {
        lifecycleReason: "ship-destroyed",
        attemptBayRecovery: false,
      });
    }
  } catch (error) {
    log.warn(`[ShipDestruction] Drone cleanup failed for ship=${shipEntity.itemID}: ${error.message}`);
  }

  try {
    const fighterRuntime = require(path.join(__dirname, "../services/fighter/fighterRuntime"));
    if (fighterRuntime && typeof fighterRuntime.handleControllerLost === "function") {
      fighterRuntime.handleControllerLost(scene, shipEntity, {
        lifecycleReason: "ship-destroyed",
        attemptTubeRecovery: false,
      });
    }
  } catch (error) {
    log.warn(`[ShipDestruction] Fighter cleanup failed for ship=${shipEntity.itemID}: ${error.message}`);
  }
}

function clearPendingDeathTestTimer() {
  if (!pendingDeathTestTimer) {
    return;
  }
  clearInterval(pendingDeathTestTimer);
  pendingDeathTestTimer = null;
}

function ensurePendingDeathTestTimer() {
  if (pendingDeathTestTimer) {
    return;
  }
  pendingDeathTestTimer = setInterval(() => {
    try {
      processPendingDeathTests();
    } catch (error) {
      log.warn(`[ShipDestruction] Pending death-test processing failed: ${error.message}`);
    }
  }, 100);
  if (pendingDeathTestTimer && typeof pendingDeathTestTimer.unref === "function") {
    pendingDeathTestTimer.unref();
  }
}

function resolveShipWreckType(shipTypeID) {
  const shipMeta = resolveShipByTypeID(shipTypeID) || {};
  const itemMeta = resolveItemByTypeID(shipTypeID) || {};
  const candidates = buildShipWreckCandidateNames(shipMeta, itemMeta);

  for (const candidate of candidates) {
    const lookup = resolveItemByName(candidate);
    if (
      lookup &&
      lookup.success &&
      lookup.match &&
      String(lookup.match.groupName || "").trim().toLowerCase() === "wreck"
    ) {
      return lookup.match;
    }
  }

  return null;
}

function processPendingDeathTests() {
  if (pendingDeathTests.size <= 0) {
    clearPendingDeathTestTimer();
    return 0;
  }

  let processedCount = 0;
  for (const [pendingID, pending] of [...pendingDeathTests.entries()]) {
    if (!pending) {
      pendingDeathTests.delete(pendingID);
      continue;
    }

    const currentSimTimeMs = spaceRuntime.getSimulationTimeMsForSystem(
      pending.systemID,
      0,
    );
    if (currentSimTimeMs < pending.completeAtSimMs) {
      continue;
    }

    pendingDeathTests.delete(pendingID);
    processedCount += 1;

    const scene = spaceRuntime.ensureScene(pending.systemID);
    const destroyed = [];
    for (const spawnedEntityID of pending.spawnedEntityIDs) {
      const liveEntity = scene ? scene.getEntityByID(spawnedEntityID) : null;
      if (!liveEntity) {
        continue;
      }
      const destroyResult = destroyShipEntityWithWreck(
        pending.systemID,
        liveEntity,
        {
          ownerCharacterID: pending.ownerCharacterID,
        },
      );
      if (destroyResult.success) {
        destroyed.push({
          shipID: liveEntity.itemID,
          wreckID: destroyResult.data.wreck.itemID,
        });
      }
    }

    pending.resolve({
      shipType: pending.shipType,
      spawnedCount: pending.spawnedCount,
      destroyed,
    });
  }

  if (pendingDeathTests.size <= 0) {
    clearPendingDeathTestTimer();
  }
  return processedCount;
}

function queuePendingDeathTest({
  systemID,
  ownerCharacterID,
  shipType,
  spawnedEntityIDs,
  spawnedCount,
  delayMs,
}) {
  const scene = spaceRuntime.ensureScene(systemID);
  const currentSimTimeMs = scene
    ? scene.getCurrentSimTimeMs()
    : spaceRuntime.getSimulationTimeMsForSystem(systemID);
  const pendingID = nextPendingDeathTestID++;
  let resolvePromise = null;
  const completionPromise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  pendingDeathTests.set(pendingID, {
    systemID,
    ownerCharacterID,
    shipType,
    spawnedEntityIDs: [...spawnedEntityIDs],
    spawnedCount,
    completeAtSimMs: currentSimTimeMs + Math.max(0, toFiniteNumber(delayMs, 0)),
    resolve: resolvePromise,
  });
  ensurePendingDeathTestTimer();
  processPendingDeathTests();

  return {
    completionPromise,
    completeAtSimMs: currentSimTimeMs + Math.max(0, toFiniteNumber(delayMs, 0)),
  };
}

function destroyShipEntityWithWreck(systemID, shipEntity, options = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (shipEntity && shipEntity.nativeNpc === true) {
    const {
      destroyNativeNpcEntityWithWreck,
    } = require(path.join(__dirname, "./npc/nativeNpcWreckService"));
    return destroyNativeNpcEntityWithWreck(numericSystemID, shipEntity, options);
  }

  const ownerCharacterID = toPositiveInt(
    options.ownerCharacterID ||
      options.characterID ||
      (shipEntity && shipEntity.pilotCharacterID) ||
      (shipEntity && shipEntity.characterID) ||
      (shipEntity && shipEntity.ownerID),
    0,
  );
  if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (!ownerCharacterID) {
    return {
      success: false,
      errorMsg: "OWNER_CHARACTER_REQUIRED",
    };
  }

  releaseControlledCraftForDestroyedShip(numericSystemID, shipEntity);

  const shipRecord =
    options.shipRecord ||
    (shipEntity.persistSpaceState === true
      ? getActiveShipRecord(ownerCharacterID)
      : findShipItemById(shipEntity.itemID)) ||
    null;
  const wreckType = resolveShipWreckType(shipEntity.typeID);
  if (!wreckType) {
    return {
      success: false,
      errorMsg: "WRECK_TYPE_NOT_FOUND",
    };
  }

  const now = spaceRuntime.getSimulationTimeMsForSystem(numericSystemID);
  const wreckCreateResult = createSpaceItemForCharacter(
    ownerCharacterID,
    numericSystemID,
    wreckType,
    {
      itemName: wreckType.name,
      position: cloneVector(shipEntity.position),
      direction: normalizeVector(shipEntity.direction, { x: 1, y: 0, z: 0 }),
      velocity: { x: 0, y: 0, z: 0 },
      targetPoint: cloneVector(shipEntity.position),
      mode: "STOP",
      speedFraction: 0,
      transient: shipEntity.transient === true,
      createdAtMs: now,
      expiresAtMs: now + getSpaceDebrisLifetimeMs(),
      launcherID: shipEntity.itemID,
      spaceRadius: toFiniteNumber(shipEntity.radius, 0),
      dunRotation: buildDunRotationFromDirection(shipEntity.direction),
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  if (!wreckCreateResult.success || !wreckCreateResult.data) {
    return {
      success: false,
      errorMsg: "WRECK_CREATE_FAILED",
    };
  }

  const wreckItem = wreckCreateResult.data;
  const deathOutcomeResult = shipRecord
    ? resolveLocationDeathOutcome(shipRecord.itemID, {
        rootLootLocationID: wreckItem.itemID,
        seed: `ship:${shipEntity.itemID}:${now}`,
      })
    : {
        success: true,
        data: {
          items: [],
          movedChanges: [],
          destroyChanges: [],
        },
      };
  const killmailItems =
    deathOutcomeResult &&
    deathOutcomeResult.success &&
    deathOutcomeResult.data &&
    Array.isArray(deathOutcomeResult.data.items)
      ? deathOutcomeResult.data.items
      : [];
  const movedChanges =
    deathOutcomeResult &&
    deathOutcomeResult.success &&
    deathOutcomeResult.data &&
    Array.isArray(deathOutcomeResult.data.movedChanges)
      ? deathOutcomeResult.data.movedChanges
      : [];
  const contentDestroyChanges =
    deathOutcomeResult &&
    deathOutcomeResult.success &&
    deathOutcomeResult.data &&
    Array.isArray(deathOutcomeResult.data.destroyChanges)
      ? deathOutcomeResult.data.destroyChanges
      : [];

  let destroyResult = null;
  let destroyChanges = [];
  if (shipEntity.persistSpaceState === true && !shipEntity.session) {
    destroyResult = spaceRuntime.removeDynamicEntity(
      numericSystemID,
      shipEntity.itemID,
      {
        allowSessionOwned: false,
        terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
      },
    );
    if (!destroyResult.success) {
      return destroyResult;
    }

    const removeShipItemResult = removeInventoryItem(shipEntity.itemID, {
      removeContents: false,
    });
    if (!removeShipItemResult.success) {
      return removeShipItemResult;
    }

    destroyChanges = [
      ...contentDestroyChanges,
      ...(
        destroyResult.data && Array.isArray(destroyResult.data.changes)
          ? destroyResult.data.changes
          : []
      ),
      ...(
        removeShipItemResult.data && Array.isArray(removeShipItemResult.data.changes)
          ? removeShipItemResult.data.changes
          : []
      ),
    ];
  } else if (shipEntity.persistSpaceState === true) {
    destroyResult = spaceRuntime.destroyDynamicInventoryEntity(
      numericSystemID,
      shipEntity.itemID,
      {
        removeContents: false,
        terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
      },
    );
    if (!destroyResult.success) {
      return destroyResult;
    }
    destroyChanges =
      [
        ...contentDestroyChanges,
        ...(
          destroyResult.data && Array.isArray(destroyResult.data.changes)
            ? destroyResult.data.changes
            : []
        ),
      ];
  } else {
    destroyResult = spaceRuntime.removeDynamicEntity(
      numericSystemID,
      shipEntity.itemID,
      {
        allowSessionOwned: false,
        terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
      },
    );
    if (!destroyResult.success) {
      return destroyResult;
    }
    destroyChanges =
      [
        ...contentDestroyChanges,
        ...(
          destroyResult.data && Array.isArray(destroyResult.data.changes)
            ? destroyResult.data.changes
            : []
        ),
      ];
  }

  const wreckSpawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    numericSystemID,
    wreckItem.itemID,
  );
  if (!wreckSpawnResult.success) {
    return wreckSpawnResult;
  }

  log.info(
    `[ShipDestruction] Destroyed ship=${shipEntity.itemID} type=${shipEntity.typeID} wreck=${wreckItem.itemID} system=${numericSystemID}`,
  );

  return {
    success: true,
    data: {
      wreck: wreckItem,
      shipID: shipEntity.itemID,
      movedChanges,
      destroyChanges,
      lootOutcome: {
        items: killmailItems,
      },
      wreckChanges:
        wreckCreateResult.changes ||
        (wreckCreateResult.data && wreckCreateResult.data.changes) ||
        [],
    },
  };
}

function destroyShipEntityWithoutWreck(systemID, shipEntity, options = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  releaseControlledCraftForDestroyedShip(numericSystemID, shipEntity);

  const deathOutcomeResult =
    options.removeContents === true
      ? resolveLocationDeathOutcome(shipEntity.itemID, {
          forceAllDestroyed: true,
          seed: `ship-destroyed:${shipEntity.itemID}:${numericSystemID}`,
        })
      : {
          success: true,
          data: {
            items: [],
            destroyChanges: [],
          },
        };
  const killmailItems =
    deathOutcomeResult &&
    deathOutcomeResult.success &&
    deathOutcomeResult.data &&
    Array.isArray(deathOutcomeResult.data.items)
      ? deathOutcomeResult.data.items
      : [];
  const contentDestroyChanges =
    deathOutcomeResult &&
    deathOutcomeResult.success &&
    deathOutcomeResult.data &&
    Array.isArray(deathOutcomeResult.data.destroyChanges)
      ? deathOutcomeResult.data.destroyChanges
      : [];
  const removeEntityResult = spaceRuntime.removeDynamicEntity(
    numericSystemID,
    shipEntity.itemID,
    {
      allowSessionOwned: options.allowSessionOwned === true,
      terminalDestructionEffectID: toPositiveInt(
        options.terminalDestructionEffectID,
        DESTRUCTION_EFFECT_EXPLOSION,
      ),
    },
  );
  if (!removeEntityResult.success) {
    return removeEntityResult;
  }

  const removeShipItemResult = removeInventoryItem(shipEntity.itemID, {
    removeContents: options.removeContents === true,
  });
  if (!removeShipItemResult.success) {
    return removeShipItemResult;
  }

  return {
    success: true,
    data: {
      shipID: shipEntity.itemID,
      lootOutcome: {
        items: killmailItems,
      },
      changes: [
        ...contentDestroyChanges,
        ...(
          removeShipItemResult.data &&
          Array.isArray(removeShipItemResult.data.changes)
            ? removeShipItemResult.data.changes
            : []
        ),
      ],
    },
  };
}

function reseedDestroyedPilotSession(scene, session, capsuleEntity) {
  if (!scene || !session || !session._space || !capsuleEntity) {
    return false;
  }

  // Root-level victim parity: the stale part after same-scene ship
  // destruction is the server's non-ego visibility cache, not the victim's
  // new capsule. Tearing down the full view here can remove the fresh pod ego
  // ball and leave the client in "no valid ego" limbo. `eject.txt` showed the
  // extra owner SetState in this handoff was also replaying a stale hull view
  // after the client had already switched session/dogma to the capsule. Keep
  // the capsule/HUD alive, clear only the server-side non-ego visibility
  // bookkeeping, and let the normal same-scene refresh re-add any missing
  // CONCORD/wreck balls.
  session._space.visibleDynamicEntityIDs = new Set();
  scene.sendAddBallsToSession(session, [capsuleEntity]);
  scene.syncDynamicVisibilityForSession(session);
  return true;
}

function purgeDestroyedShipEntityFromScene(scene, shipID) {
  if (!scene) {
    return false;
  }

  const numericShipID = toPositiveInt(shipID, 0);
  if (!numericShipID) {
    return false;
  }

  const staleEntity = scene.dynamicEntities.get(numericShipID) || null;
  if (!staleEntity || staleEntity.kind !== "ship") {
    return false;
  }

  scene.removeEntityFromBubble(staleEntity);
  scene.dynamicEntities.delete(numericShipID);
  scene.publicGridCompositionDirty = true;
  scene.ensurePublicGridComposition();

  for (const activeSession of scene.sessions.values()) {
    if (!activeSession || !activeSession._space) {
      continue;
    }
    if (activeSession._space.visibleDynamicEntityIDs instanceof Set) {
      activeSession._space.visibleDynamicEntityIDs.delete(numericShipID);
    }
    if (activeSession._space.freshlyVisibleDynamicEntityIDs instanceof Set) {
      activeSession._space.freshlyVisibleDynamicEntityIDs.delete(numericShipID);
    }
  }

  return true;
}

function destroySessionShip(session, options = {}) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (Number(activeShip.typeID) === CAPSULE_TYPE_ID) {
    return destroySessionCapsuleToHomeStation(session, activeShip, options);
  }

  session.sessionChangeReason = options.sessionChangeReason || "selfdestruct";
  const ejectResult = ejectSession(session, {
    // Combat destruction is not manual eject parity. Replaying the abandoned
    // hull back to the victim before we destroy it re-seeds the stale ship
    // view, leaves the wreck/explosion handoff inconsistent, and lets NPCs
    // keep shooting at what the victim still sees as a live burning hull.
    sendAbandonedShipSlimToVictim: false,
    refreshAbandonedShipViewForVictim: false,
    syncAllSessionsVisibilityAfterSwap: false,
  });
  if (!ejectResult.success || !ejectResult.data) {
    return ejectResult;
  }

  const systemID = toPositiveInt(
    session._space && session._space.systemID,
    toPositiveInt(activeShip.locationID, 0),
  );
  const scene = spaceRuntime.ensureScene(systemID);
  const abandonedEntity = scene ? scene.getEntityByID(activeShip.itemID) : null;
  if (!scene || !abandonedEntity) {
    return {
      success: false,
      errorMsg: "ABANDONED_SHIP_NOT_FOUND",
    };
  }

  const destroyResult = destroyShipEntityWithWreck(systemID, abandonedEntity, {
    ownerCharacterID: session.characterID,
    shipRecord: activeShip,
  });
  if (!destroyResult.success) {
    return destroyResult;
  }

  const purgedStaleDestroyedEntity = purgeDestroyedShipEntityFromScene(
    scene,
    activeShip.itemID,
  );

  const capsuleEntity =
    session && session._space
      ? scene.getEntityByID(toPositiveInt(session._space.shipID, 0))
      : null;
  if (capsuleEntity && session && session._space) {
    reseedDestroyedPilotSession(scene, session, capsuleEntity);
  }
  if (purgedStaleDestroyedEntity) {
    scene.syncDynamicVisibilityForAllSessions(scene.getCurrentSimTimeMs());
  }

  return {
    success: true,
    data: {
      capsule: ejectResult.data.capsule,
      wreck: destroyResult.data.wreck,
      destroyedShipID: activeShip.itemID,
      movedChanges: destroyResult.data.movedChanges,
      destroyChanges: destroyResult.data.destroyChanges,
      wreckChanges: destroyResult.data.wreckChanges,
      boundResult: ejectResult.data.boundResult,
    },
  };
}

function destroySessionCapsuleToHomeStation(session, activeShip, options = {}) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(
    session._space && session._space.systemID,
    toPositiveInt(activeShip && activeShip.locationID, 0),
  );
  const scene = spaceRuntime.ensureScene(systemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const characterRecord = getCharacterRecord(session.characterID) || {};
  const targetStationID =
    Number(
      characterRecord.homeStationID ||
      characterRecord.cloneStationID ||
      session.homeStationID ||
      session.homestationid ||
      session.cloneStationID ||
      session.clonestationid ||
      60003760,
    ) || 60003760;

  session.sessionChangeReason = options.sessionChangeReason || "selfdestruct";
  const abandonedCapsuleEntity = spaceRuntime.disembarkSession(session, {
    broadcast: false,
  });
  if (!abandonedCapsuleEntity) {
    return {
      success: false,
      errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
    };
  }

  const destroyResult = destroyShipEntityWithWreck(
    systemID,
    abandonedCapsuleEntity,
    {
      ownerCharacterID: session.characterID,
      shipRecord: activeShip,
    },
  );
  if (!destroyResult.success) {
    log.warn(
      `[ShipDestruction] Capsule destroy cleanup failed for char=${session.characterID} pod=${abandonedCapsuleEntity.itemID} error=${destroyResult.errorMsg}`,
    );
  }

  const respawnResult = rebuildDockedSessionAtStation(session, targetStationID, {
    emitNotifications: true,
    logSelection: true,
    boardNewbieShip: true,
    newbieShipLogLabel: "PodRespawn",
  });
  if (!respawnResult.success || !respawnResult.data) {
    return respawnResult;
  }

  log.info(
    `[ShipDestruction] Podded ${session.characterName || session.characterID} pod=${abandonedCapsuleEntity.itemID} station=${targetStationID} ship=${respawnResult.data.ship && respawnResult.data.ship.itemID}`,
  );

  return {
    success: true,
    data: {
      station: respawnResult.data.station,
      capsule: respawnResult.data.capsule,
      ship: respawnResult.data.ship,
      destroyedShipID: activeShip.itemID,
      wreck:
        destroyResult.success && destroyResult.data
          ? destroyResult.data.wreck || null
          : null,
      movedChanges:
        destroyResult.success &&
        destroyResult.data &&
        Array.isArray(destroyResult.data.movedChanges)
          ? destroyResult.data.movedChanges
          : [],
      destroyChanges:
        destroyResult.success &&
        destroyResult.data &&
        Array.isArray(destroyResult.data.destroyChanges)
          ? destroyResult.data.destroyChanges
          : [],
      wreckChanges:
        destroyResult.success &&
        destroyResult.data &&
        Array.isArray(destroyResult.data.wreckChanges)
          ? destroyResult.data.wreckChanges
          : [],
      boundResult: respawnResult.data.boundResult,
    },
  };
}

function spawnShipDeathTestField(session, options = {}) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const scene = spaceRuntime.ensureScene(systemID);
  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!scene || !anchorEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const count = toPositiveInt(options.count, DEFAULT_DEATH_TEST_COUNT);
  const radiusMeters = Math.max(
    3_000,
    toFiniteNumber(options.radiusMeters, DEFAULT_DEATH_TEST_RADIUS_METERS),
  );
  const delayMs = Math.max(
    0,
    toFiniteNumber(options.delayMs, DEFAULT_DEATH_TEST_DELAY_MS),
  );
  const shipType =
    options.shipType ||
    resolveShipByTypeID(options.typeID) ||
    resolveShipByTypeID(anchorEntity.typeID) ||
    null;
  if (!shipType) {
    return {
      success: false,
      errorMsg: "SHIP_TYPE_NOT_FOUND",
    };
  }

  const positions = buildShipDeathPositions(anchorEntity, count, radiusMeters);
  const spawned = [];
  for (const position of positions) {
    const spawnResult = spaceRuntime.spawnDynamicShip(systemID, {
      typeID: shipType.typeID,
      groupID: shipType.groupID,
      categoryID: shipType.categoryID || 6,
      itemName: shipType.name,
      ownerID: 0,
      characterID: 0,
      corporationID: 0,
      allianceID: 0,
      warFactionID: 0,
      position,
      direction: buildRandomDirection(anchorEntity.direction),
      velocity: { x: 0, y: 0, z: 0 },
      targetPoint: position,
      mode: "STOP",
      speedFraction: 0,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    });
    if (spawnResult.success && spawnResult.data && spawnResult.data.entity) {
      spawned.push(spawnResult.data.entity);
    }
  }

  const scheduledDetonation = queuePendingDeathTest({
    systemID,
    ownerCharacterID: session.characterID,
    shipType,
    spawnedEntityIDs: spawned.map((entity) => entity.itemID),
    spawnedCount: spawned.length,
    delayMs,
  });

  return {
    success: true,
    data: {
      shipType,
      radiusMeters,
      delayMs,
      spawned,
      completionPromise: scheduledDetonation.completionPromise,
      detonateAtSimMs: scheduledDetonation.completeAtSimMs,
    },
  };
}

module.exports = {
  destroyShipEntityWithWreck,
  destroySessionShip,
  spawnShipDeathTestField,
};

module.exports._testing = {
  destroyShipEntityWithWreck,
  destroyShipEntityWithoutWreck,
  resolveShipWreckType,
  buildShipDeathPositions,
  processPendingDeathTests,
  clearPendingDeathTests() {
    pendingDeathTests.clear();
    clearPendingDeathTestTimer();
  },
};

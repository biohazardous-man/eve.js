const {
  getActiveShipRecord,
  getCharacterRecord,
} = require("../character/characterState");
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  grantItemsToCharacterStationHangar,
  listContainerItems,
  moveItemTypeFromCharacterLocation,
  moveShipToSpace,
} = require("../inventory/itemStore");
const {
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
} = require("../fitting/liveFittingState");
const {
  ejectSession,
  boardSpaceShip,
} = require("../../space/transitions");
const spaceRuntime = require("../../space/runtime");
const {
  pickRandomTitanSuperweaponLoadout,
} = require("./superweaponCatalog");

const CAPSULE_TYPE_ID = 670;
const DEFAULT_HOME_STATION_ID = 60003760;
const SUPERTITAN_SHOW_DEFAULT_COUNT = 5;
const SUPERTITAN_SHOW_ENTITY_ID_START = 3950000000000000;
const SUPERTITAN_SHOW_FLEET_OFFSET_METERS = 120_000;
const SUPERTITAN_SHOW_MIDPOINT_DISTANCE_METERS = 240_000;
const SUPERTITAN_SHOW_LATERAL_SPACING_METERS = 25_000;
const SUPERTITAN_SHOW_ROW_SPACING_METERS = 22_500;
const SUPERTITAN_SHOW_APPROACH_SPEED_FRACTION = 0.3;
const SUPERTITAN_SHOW_TARGET_DELAY_MS = 4_000;
const SUPERTITAN_SHOW_FX_DURATION_MS = 12_000;
const SUPERTITAN_BOARD_OFFSET_METERS = 1_000;
const SUPERTITAN_SHOW_SPAWN_BATCH_SIZE = 4;

let nextSuperTitanShowEntityID = SUPERTITAN_SHOW_ENTITY_ID_START;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const numeric = toInt(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function addVectors(left, right) {
  return {
    x: Number(left && left.x || 0) + Number(right && right.x || 0),
    y: Number(left && left.y || 0) + Number(right && right.y || 0),
    z: Number(left && left.z || 0) + Number(right && right.z || 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: Number(left && left.x || 0) - Number(right && right.x || 0),
    y: Number(left && left.y || 0) - Number(right && right.y || 0),
    z: Number(left && left.z || 0) - Number(right && right.z || 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: Number(vector && vector.x || 0) * scalar,
    y: Number(vector && vector.y || 0) * scalar,
    z: Number(vector && vector.z || 0) * scalar,
  };
}

function crossVectors(left, right) {
  return {
    x: (Number(left && left.y || 0) * Number(right && right.z || 0)) -
      (Number(left && left.z || 0) * Number(right && right.y || 0)),
    y: (Number(left && left.z || 0) * Number(right && right.x || 0)) -
      (Number(left && left.x || 0) * Number(right && right.z || 0)),
    z: (Number(left && left.x || 0) * Number(right && right.y || 0)) -
      (Number(left && left.y || 0) * Number(right && right.x || 0)),
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (Number(vector && vector.x || 0) ** 2) +
    (Number(vector && vector.y || 0) ** 2) +
    (Number(vector && vector.z || 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (length <= 1e-9) {
    return {
      x: Number(fallback && fallback.x || 1),
      y: Number(fallback && fallback.y || 0),
      z: Number(fallback && fallback.z || 0),
    };
  }

  return {
    x: Number(vector.x || 0) / length,
    y: Number(vector.y || 0) / length,
    z: Number(vector.z || 0) / length,
  };
}

function buildFormationBasis(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(Number(forward.y || 0)) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeVector(
    crossVectors(right, forward),
    upReference,
  );
  return { forward, right, up };
}

function resolvePreferredStationID(session) {
  const characterRecord = getCharacterRecord(session && session.characterID) || {};
  return Number(
    characterRecord.homeStationID ||
    characterRecord.cloneStationID ||
    session && (session.stationid || session.stationID) ||
    DEFAULT_HOME_STATION_ID,
  ) || DEFAULT_HOME_STATION_ID;
}

function createShipItemInHangar(characterID, stationID, shipType) {
  const createResult = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipType,
    1,
  );
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    data: {
      shipItem: createResult.data && createResult.data.items
        ? createResult.data.items[0] || null
        : null,
      changes: createResult.data && createResult.data.changes
        ? createResult.data.changes
        : [],
    },
  };
}

function fitModuleTypeToShip(characterID, stationID, shipItem, moduleType) {
  const fittedItems = listFittedItems(characterID, shipItem.itemID);
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    Number(moduleType && moduleType.typeID) || 0,
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = {
    itemID: -1,
    typeID: moduleType.typeID,
    groupID: moduleType.groupID,
    categoryID: moduleType.categoryID,
    flagID: nextFlagID,
    itemName: moduleType.name,
    stacksize: 1,
    singleton: 1,
  };
  const validation = validateFitForShip(
    characterID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  return moveItemTypeFromCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    nextFlagID,
    moduleType.typeID,
    1,
  );
}

function computeMaxFuelUnitsForCargo(loadout) {
  const cargoCapacity = Math.max(0, Number(loadout && loadout.hullType && loadout.hullType.capacity) || 0);
  const fuelVolume = Math.max(0, Number(loadout && loadout.fuelType && loadout.fuelType.volume) || 0);
  const minimumFuelUnits = Math.max(1, Number(loadout && loadout.fuelPerActivation) || 1);
  if (cargoCapacity <= 0 || fuelVolume <= 0) {
    return minimumFuelUnits;
  }

  return Math.max(
    minimumFuelUnits,
    Math.floor(cargoCapacity / fuelVolume),
  );
}

function buildStoppedSpawnStateNearEntity(entity, offsetMeters = SUPERTITAN_BOARD_OFFSET_METERS) {
  const direction = normalizeVector(
    entity && entity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const position = addVectors(
    entity && entity.position,
    scaleVector(direction, Math.max(100, Number(offsetMeters) || SUPERTITAN_BOARD_OFFSET_METERS)),
  );
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function seedSuperTitanShip(characterID, stationID, loadout) {
  const createResult = createShipItemInHangar(
    characterID,
    stationID,
    loadout.hullType,
  );
  if (!createResult.success || !createResult.data || !createResult.data.shipItem) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "SHIP_CREATE_FAILED",
    };
  }

  const shipItem = createResult.data.shipItem;
  const fuelUnits = computeMaxFuelUnitsForCargo(loadout);
  const grantResult = grantItemsToCharacterStationHangar(
    characterID,
    stationID,
    [
      {
        itemType: loadout.moduleType,
        quantity: 1,
      },
      {
        itemType: loadout.fuelType,
        quantity: fuelUnits,
      },
    ],
  );
  if (!grantResult.success) {
    return {
      success: false,
      errorMsg: grantResult.errorMsg || "GRANT_FAILED",
    };
  }

  const fitResult = fitModuleTypeToShip(
    characterID,
    stationID,
    shipItem,
    loadout.moduleType,
  );
  if (!fitResult.success) {
    return {
      success: false,
      errorMsg: fitResult.errorMsg || "FIT_FAILED",
      data: {
        shipItem,
      },
    };
  }

  const fuelMoveResult = moveItemTypeFromCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    loadout.fuelType.typeID,
    fuelUnits,
  );
  if (!fuelMoveResult.success) {
    return {
      success: false,
      errorMsg: fuelMoveResult.errorMsg || "MOVE_FAILED",
      data: {
        shipItem,
      },
    };
  }

  const cargoFuelStack = listContainerItems(
    characterID,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  ).find((item) => Number(item && item.typeID) === Number(loadout.fuelType.typeID));

  return {
    success: true,
    data: {
      shipItem,
      cargoFuelUnits: Number(cargoFuelStack && cargoFuelStack.quantity) || fuelUnits,
    },
  };
}

function allocateSuperTitanShowEntityID() {
  const allocated = nextSuperTitanShowEntityID;
  nextSuperTitanShowEntityID += 1;
  return allocated;
}

function buildFleetSlots(count) {
  const normalizedCount = Math.max(1, normalizePositiveInteger(count, SUPERTITAN_SHOW_DEFAULT_COUNT));
  const columns = Math.max(1, Math.ceil(Math.sqrt(normalizedCount)));
  const rows = Math.ceil(normalizedCount / columns);
  const slots = [];

  for (let index = 0; index < normalizedCount; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const centeredColumn = column - ((columns - 1) / 2);
    const centeredRow = row - ((rows - 1) / 2);
    slots.push({
      lateral: centeredColumn,
      vertical: centeredRow,
    });
  }

  return slots;
}

function buildFleetFormation(center, facingDirection, count) {
  const basis = buildFormationBasis(facingDirection);
  const slots = buildFleetSlots(count);
  return slots.map((slot) => ({
    position: addVectors(
      center,
      addVectors(
        scaleVector(basis.right, slot.lateral * SUPERTITAN_SHOW_LATERAL_SPACING_METERS),
        scaleVector(basis.up, slot.vertical * SUPERTITAN_SHOW_ROW_SPACING_METERS),
      ),
    ),
    direction: basis.forward,
  }));
}

function resolveSceneTickIntervalMs(scene, fallback = 1000) {
  const tickIntervalMs = normalizePositiveInteger(
    scene && scene._tickIntervalMs,
    fallback,
  );
  return tickIntervalMs || fallback;
}

function pickTitanShowLoadout(random, config = {}) {
  if (typeof config.pickLoadout === "function") {
    return config.pickLoadout({
      random,
    }) || null;
  }

  return pickRandomTitanSuperweaponLoadout({
    random,
    requireFxGuid: true,
  });
}

function spawnShowFleetWave(
  scene,
  ownerSession,
  formation,
  fleetLabel,
  midpoint,
  config,
  startIndex = 0,
) {
  const spawned = [];
  const batchSize = Math.max(
    1,
    normalizePositiveInteger(
      config && config.spawnBatchSize,
      SUPERTITAN_SHOW_SPAWN_BATCH_SIZE,
    ),
  );
  const endIndex = Math.min(
    formation.length,
    Math.max(0, startIndex) + batchSize,
  );

  for (let index = Math.max(0, startIndex); index < endIndex; index += 1) {
    const loadout = pickTitanShowLoadout(config.random, config);
    if (!loadout) {
      continue;
    }

    const slot = formation[index];
    const shipType = loadout.hullType;
    const spawnResult = spaceRuntime.spawnDynamicShip(
      scene.systemID,
      {
        itemID: allocateSuperTitanShowEntityID(),
        typeID: shipType.typeID,
        groupID: shipType.groupID,
        categoryID: shipType.categoryID || 6,
        itemName: `${shipType.name} ${fleetLabel}${index + 1}`,
        ownerID: Number(ownerSession && ownerSession.characterID || 0) || 0,
        characterID: 0,
        corporationID: Number(ownerSession && ownerSession.corporationID || 0) || 0,
        allianceID: Number(ownerSession && ownerSession.allianceID || 0) || 0,
        warFactionID: Number(ownerSession && ownerSession.warFactionID || 0) || 0,
        position: slot.position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: slot.direction,
        targetPoint: midpoint,
        mode: "GOTO",
        speedFraction: SUPERTITAN_SHOW_APPROACH_SPEED_FRACTION,
        conditionState: {
          damage: 0,
          charge: 1,
          armorDamage: 0,
          shieldCharge: 1,
          incapacitated: false,
        },
      },
      {
        // Giant synthetic show/test formations are especially prone to
        // same-tick AddBalls2 storms. Deferring the initial acquire lets the
        // next visibility sync group the whole wave into one fresh-acquire
        // pass instead of emitting one immediate AddBalls2 per hull.
        broadcastOptions: {
          deferUntilVisibilitySync: true,
        },
      },
    );
    if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
      continue;
    }

    spawned.push({
      entity: spawnResult.data.entity,
      loadout,
      fleetLabel,
    });
  }

  return spawned;
}

function scheduleShowFleetSpawns(
  scene,
  ownerSession,
  formationA,
  formationB,
  midpoint,
  config,
) {
  const scheduler = config.scheduleFn;
  const fleetA = [];
  const fleetB = [];
  const batchSize = Math.max(
    1,
    normalizePositiveInteger(
      config.spawnBatchSize,
      SUPERTITAN_SHOW_SPAWN_BATCH_SIZE,
    ),
  );
  const waveIntervalMs = Math.max(
    1,
    normalizePositiveInteger(
      config.spawnWaveIntervalMs,
      resolveSceneTickIntervalMs(scene),
    ),
  );
  const waveCount = Math.max(
    Math.ceil(formationA.length / batchSize),
    Math.ceil(formationB.length / batchSize),
    1,
  );

  const runWave = (waveIndex) => {
    const startIndex = Math.max(0, waveIndex) * batchSize;
    fleetA.push(
      ...spawnShowFleetWave(
        scene,
        ownerSession,
        formationA,
        "A",
        midpoint,
        config,
        startIndex,
      ),
    );
    fleetB.push(
      ...spawnShowFleetWave(
        scene,
        ownerSession,
        formationB,
        "B",
        midpoint,
        config,
        startIndex,
      ),
    );
  };

  runWave(0);
  for (let waveIndex = 1; waveIndex < waveCount; waveIndex += 1) {
    schedule(
      () => runWave(waveIndex),
      waveIndex * waveIntervalMs,
      scheduler,
    );
  }

  return {
    fleetA,
    fleetB,
    waveCount,
    spawnCompletionDelayMs: Math.max(0, waveCount - 1) * waveIntervalMs,
  };
}

function schedule(callback, delayMs, scheduleFn) {
  const run =
    typeof scheduleFn === "function"
      ? scheduleFn
      : setTimeout;
  return run(callback, Math.max(0, toInt(delayMs, 0)));
}

function defaultRandomTarget(list, random) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const boundedRandom = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return list[Math.floor(boundedRandom * list.length)] || list[0];
}

function scheduleTitanShowVolley(session, scene, fleetA, fleetB, config) {
  const scheduler = config.scheduleFn;
  const random = typeof config.random === "function" ? config.random : Math.random;
  const showState = {
    sourceFleetA: fleetA,
    sourceFleetB: fleetB,
    systemID: scene.systemID,
  };

  schedule(() => {
    if (!session || !session._space || Number(session._space.systemID || 0) !== Number(showState.systemID)) {
      return;
    }

    const allSources = [
      ...showState.sourceFleetA.map((entry) => ({
        source: entry,
        targets: showState.sourceFleetB,
      })),
      ...showState.sourceFleetB.map((entry) => ({
        source: entry,
        targets: showState.sourceFleetA,
      })),
    ];
    const nowMs =
      typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now();

    for (const entry of allSources) {
      const sourceEntity = entry.source && entry.source.entity;
      const targetEntry = defaultRandomTarget(entry.targets, random);
      const targetEntity = targetEntry && targetEntry.entity;
      const loadout = entry.source && entry.source.loadout;
      if (!sourceEntity || !targetEntity || !loadout || !loadout.fxGuid) {
        continue;
      }
      if (!scene.getEntityByID(sourceEntity.itemID) || !scene.getEntityByID(targetEntity.itemID)) {
        continue;
      }

      if (typeof scene.finalizeTargetLock === "function") {
        scene.finalizeTargetLock(sourceEntity, targetEntity, { nowMs });
      }
      sourceEntity.mode = "FOLLOW";
      sourceEntity.targetEntityID = targetEntity.itemID;
      sourceEntity.followRange = 45_000;
      sourceEntity.targetPoint = targetEntity.position;
      sourceEntity.direction = normalizeVector(
        subtractVectors(targetEntity.position, sourceEntity.position),
        sourceEntity.direction,
      );

      scene.broadcastSpecialFx(
        sourceEntity.itemID,
        loadout.fxGuid,
        {
          targetID: targetEntity.itemID,
          start: true,
          duration: SUPERTITAN_SHOW_FX_DURATION_MS,
          moduleTypeID: loadout.moduleType.typeID,
          isOffensive: true,
          useCurrentVisibleStamp: true,
          resultSession: session,
        },
        sourceEntity,
      );

      schedule(() => {
        if (!scene.getEntityByID(sourceEntity.itemID)) {
          return;
        }
        scene.broadcastSpecialFx(
          sourceEntity.itemID,
          loadout.fxGuid,
          {
            targetID: targetEntity.itemID,
            start: false,
            active: false,
            moduleTypeID: loadout.moduleType.typeID,
            isOffensive: true,
            useCurrentVisibleStamp: true,
            resultSession: session,
          },
          sourceEntity,
        );
      }, config.fxDurationMs, scheduler);
    }
  }, config.volleyStartDelayMs, scheduler);
}

function buildSuperTitanShowConfig(scene, options = {}) {
  const testing = options && options.superTitanTestConfig || {};
  const tickIntervalMs = resolveSceneTickIntervalMs(scene);
  return {
    random: typeof testing.random === "function" ? testing.random : Math.random,
    scheduleFn: typeof testing.scheduleFn === "function" ? testing.scheduleFn : setTimeout,
    targetDelayMs: normalizePositiveInteger(testing.targetDelayMs, SUPERTITAN_SHOW_TARGET_DELAY_MS),
    fxDurationMs: normalizePositiveInteger(testing.fxDurationMs, SUPERTITAN_SHOW_FX_DURATION_MS),
    spawnBatchSize: normalizePositiveInteger(testing.spawnBatchSize, SUPERTITAN_SHOW_SPAWN_BATCH_SIZE),
    spawnWaveIntervalMs: normalizePositiveInteger(testing.spawnWaveIntervalMs, tickIntervalMs),
    volleyStartDelayMs: normalizePositiveInteger(testing.volleyStartDelayMs, 0),
    pickLoadout: typeof testing.pickLoadout === "function" ? testing.pickLoadout : null,
  };
}

function handleSuperTitanCommand(session, argumentText, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /supertitan.",
    };
  }
  if (!session._space) {
    return {
      success: false,
      message: "You must be in space before using /supertitan.",
    };
  }

  const testing = options && options.superTitanTestConfig || {};
  const loadout = pickRandomTitanSuperweaponLoadout({
    random: typeof testing.random === "function" ? testing.random : Math.random,
  });
  if (!loadout) {
    return {
      success: false,
      message: "No directed titan superweapon loadouts could be resolved from local SDE data.",
    };
  }

  const stationID = resolvePreferredStationID(session);
  const seededResult = seedSuperTitanShip(
    session.characterID,
    stationID,
    loadout,
  );
  if (!seededResult.success || !seededResult.data || !seededResult.data.shipItem) {
    return {
      success: false,
      message: `Failed to seed the titan hull and superweapon: ${seededResult.errorMsg || "SEED_FAILED"}.`,
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      message: "Active ship not found for /supertitan.",
    };
  }

  if (Number(activeShip.typeID) !== CAPSULE_TYPE_ID) {
    const ejectResult = ejectSession(session);
    if (!ejectResult.success) {
      return {
        success: false,
        message: `SuperTitan eject failed: ${ejectResult.errorMsg || "EJECT_FAILED"}.`,
      };
    }
  }

  const capsuleEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!capsuleEntity) {
    return {
      success: false,
      message: "Capsule entity not found after eject.",
    };
  }

  const titanSpawnState = buildStoppedSpawnStateNearEntity(capsuleEntity);
  const moveResult = moveShipToSpace(
    seededResult.data.shipItem.itemID,
    session._space.systemID,
    {
      ...titanSpawnState,
      systemID: session._space.systemID,
    },
  );
  if (!moveResult.success) {
    return {
      success: false,
      message: `Titan launch to space failed: ${moveResult.errorMsg || "MOVE_FAILED"}.`,
    };
  }

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    seededResult.data.shipItem.itemID,
  );
  if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
    return {
      success: false,
      message: `Titan runtime spawn failed: ${spawnResult.errorMsg || "SPAWN_FAILED"}.`,
    };
  }

  const boardResult = boardSpaceShip(session, seededResult.data.shipItem.itemID);
  if (!boardResult.success) {
    return {
      success: false,
      message: `Titan boarding failed: ${boardResult.errorMsg || "BOARD_FAILED"}.`,
    };
  }

  return {
    success: true,
    message: [
      `Ejected and boarded a ${loadout.hullType.name}.`,
      `Fitted 1x ${loadout.moduleType.name}.`,
      `Loaded ${Number(seededResult.data.cargoFuelUnits || 0).toLocaleString("en-US")} ${loadout.fuelType.name} into cargo (${Number(loadout.fuelPerActivation || 0).toLocaleString("en-US")} per activation).`,
      "Your abandoned ship remains in space like a normal eject.",
    ].join(" "),
  };
}

function handleSuperTitanShowCommand(session, argumentText, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      message: "Select a character before using /supertitanshow.",
    };
  }
  if (!session._space) {
    return {
      success: false,
      message: "You must be in space before using /supertitanshow.",
    };
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const scene = spaceRuntime.getSceneForSession(session);
  if (!anchorEntity || !scene) {
    return {
      success: false,
      message: "Current space scene was not found for /supertitanshow.",
    };
  }

  const trimmed = String(argumentText || "").trim();
  const requestedCount = trimmed
    ? normalizePositiveInteger(trimmed)
    : SUPERTITAN_SHOW_DEFAULT_COUNT;
  if (trimmed && !requestedCount) {
    return {
      success: false,
      message: "Usage: /supertitanshow [count]",
    };
  }

  const perFleetCount = requestedCount || SUPERTITAN_SHOW_DEFAULT_COUNT;
  const config = buildSuperTitanShowConfig(scene, options);
  const basis = buildFormationBasis(anchorEntity.direction);
  const midpoint = addVectors(
    anchorEntity.position,
    scaleVector(basis.forward, SUPERTITAN_SHOW_MIDPOINT_DISTANCE_METERS),
  );
  const fleetACenter = addVectors(
    midpoint,
    scaleVector(basis.forward, -SUPERTITAN_SHOW_FLEET_OFFSET_METERS),
  );
  const fleetBCenter = addVectors(
    midpoint,
    scaleVector(basis.forward, SUPERTITAN_SHOW_FLEET_OFFSET_METERS),
  );
  const formationA = buildFleetFormation(
    fleetACenter,
    basis.forward,
    perFleetCount,
  );
  const formationB = buildFleetFormation(
    fleetBCenter,
    scaleVector(basis.forward, -1),
    perFleetCount,
  );
  const spawnPlan = scheduleShowFleetSpawns(
    scene,
    session,
    formationA,
    formationB,
    midpoint,
    config,
  );
  const fleetA = spawnPlan.fleetA;
  const fleetB = spawnPlan.fleetB;
  config.volleyStartDelayMs = Math.max(
    config.volleyStartDelayMs,
    spawnPlan.spawnCompletionDelayMs + config.targetDelayMs,
  );

  if (fleetA.length === 0 && fleetB.length === 0) {
    return {
      success: false,
      message: "SuperTitan show spawn failed.",
    };
  }

  scheduleTitanShowVolley(session, scene, fleetA, fleetB, config);
  return {
    success: true,
    message: [
      `Spawned ${fleetA.length} + ${fleetB.length} transient titan dummies.`,
      `Staged across ${spawnPlan.waveCount} wave${spawnPlan.waveCount === 1 ? "" : "s"} to avoid same-tick AddBalls bursts.`,
      `Each fleet is centered about ${(SUPERTITAN_SHOW_FLEET_OFFSET_METERS / 1000).toFixed(0)} km from the midpoint and starts moving toward the other fleet.`,
      "The show currently uses the directed doomsday and titan-lance FX families only, because those are the superweapon visuals we can prove from the client mirror today.",
    ].join(" "),
  };
}

module.exports = {
  handleSuperTitanCommand,
  handleSuperTitanShowCommand,
};

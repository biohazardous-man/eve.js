const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));
const {
  flushPendingCommandSessionEffects,
  tryFlushPendingShipFittingReplay,
} = require(path.join(
  __dirname,
  "../services/chat/commandSessionEffects",
));
const {
  applyCharacterToSession,
  flushCharacterSessionNotificationPlan,
  getCharacterRecord,
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  CAPSULE_TYPE_ID,
  ITEM_FLAGS,
  ensureCapsuleForCharacter,
  findCharacterShipByType,
  moveShipToSpace,
  dockShipToStation,
  setActiveShipForCharacter,
  updateShipItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
const worldData = require(path.join(__dirname, "./worldData"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const TRANSITION_GUARD_WINDOW_MS = 5000;
const STARGATE_JUMP_HANDOFF_DELAY_MS = 1250;
const STARGATE_JUMP_RANGE_METERS = 2500;
const SPACE_BOARDING_RANGE_METERS = 2500;
const SESSION_CHANGE_COOLDOWN_MS = 7000;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;

function getCrimewatchReferenceMs(session) {
  if (session && session._space && Number.isFinite(Number(session._space.simTimeMs))) {
    return Number(session._space.simTimeMs);
  }
  return Date.now();
}

function restoreShipForUndock(shipId) {
  return updateShipItem(shipId, (currentShip) => ({
    ...currentShip,
    conditionState: {
      ...(currentShip.conditionState || {}),
      damage: 0.0,
      charge: 1.0,
      armorDamage: 0.0,
      shieldCharge: 1.0,
      incapacitated: false,
    },
  }));
}

function buildBoundResult(session) {
  if (!session) {
    return null;
  }

  const preferredBoundId =
    session.currentBoundObjectID ||
    (session._boundObjectIDs && (session._boundObjectIDs.ship || session._boundObjectIDs.beyonce)) ||
    session.lastBoundObjectID ||
    null;
  if (!preferredBoundId) {
    return null;
  }

  const readyAtMs = Date.now() + SESSION_CHANGE_COOLDOWN_MS;
  const readyAtFileTime =
    BigInt(Math.trunc(readyAtMs)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "build-bound-result", {
      preferredBoundId,
      readyAtMs,
      readyAtFileTime: readyAtFileTime.toString(),
      cooldownMs: SESSION_CHANGE_COOLDOWN_MS,
    });
  }
  return [preferredBoundId, readyAtFileTime];
}

function buildLocationIdentityPatch(record, solarSystemID, extra = {}) {
  const targetSolarSystemID = Number(solarSystemID || 0) || Number(record.solarSystemID || 30000142) || 30000142;
  const system = worldData.getSolarSystemByID(targetSolarSystemID);

  return {
    ...record,
    ...extra,
    solarSystemID: targetSolarSystemID,
    constellationID:
      Number((system && system.constellationID) || record.constellationID || 0) ||
      20000020,
    regionID:
      Number((system && system.regionID) || record.regionID || 0) ||
      10000002,
    worldSpaceID: 0,
  };
}

function beginTransition(session, kind, targetID = 0) {
  if (!session) {
    return false;
  }

  const now = Date.now();
  const activeTransition = session._transitionState || null;
  if (
    activeTransition &&
    activeTransition.kind === kind &&
    (now - Number(activeTransition.startedAt || 0)) < TRANSITION_GUARD_WINDOW_MS
  ) {
    return false;
  }

  session._transitionState = {
    kind,
    targetID: Number(targetID || 0) || 0,
    startedAt: now,
  };
  return true;
}

function endTransition(session, kind) {
  if (
    session &&
    session._transitionState &&
    session._transitionState.kind === kind
  ) {
    session._transitionState = null;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vectorSource =
    source && typeof source === "object"
      ? source
      : null;
  return {
    x: toFiniteNumber(vectorSource ? vectorSource.x : undefined, fallback.x),
    y: toFiniteNumber(vectorSource ? vectorSource.y : undefined, fallback.y),
    z: toFiniteNumber(vectorSource ? vectorSource.z : undefined, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  const delta = subtractVectors(left, right);
  return Math.sqrt((delta.x ** 2) + (delta.y ** 2) + (delta.z ** 2));
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function buildSharedWorldPosition(systemPosition, localPosition) {
  return {
    x: toFiniteNumber(systemPosition && systemPosition.x, 0) -
      toFiniteNumber(localPosition && localPosition.x, 0),
    y: toFiniteNumber(systemPosition && systemPosition.y, 0) +
      toFiniteNumber(localPosition && localPosition.y, 0),
    z: toFiniteNumber(systemPosition && systemPosition.z, 0) +
      toFiniteNumber(localPosition && localPosition.z, 0),
  };
}

function getDirectionFromDunRotation(dunRotation) {
  if (!Array.isArray(dunRotation) || dunRotation.length < 2) {
    return null;
  }

  const yaw = toFiniteNumber(dunRotation[0], 0) * (Math.PI / 180);
  const pitch = toFiniteNumber(dunRotation[1], 0) * (Math.PI / 180);
  return normalizeVector({
    x: Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  });
}

function getDerivedStargateForwardDirection(stargate) {
  const sourceSystem = worldData.getSolarSystemByID(stargate && stargate.solarSystemID);
  const destinationGate = worldData.getStargateByID(stargate && stargate.destinationID);
  const destinationSystem = worldData.getSolarSystemByID(
    stargate && stargate.destinationSolarSystemID,
  );
  if (!sourceSystem || !destinationGate || !destinationSystem) {
    return null;
  }

  return normalizeVector(
    subtractVectors(
      buildSharedWorldPosition(destinationSystem.position, destinationGate.position),
      buildSharedWorldPosition(sourceSystem.position, stargate.position),
    ),
  );
}

function getResolvedStargateForwardDirection(stargate) {
  return (
    getDirectionFromDunRotation(stargate && stargate.dunRotation) ||
    getDerivedStargateForwardDirection(stargate) ||
    normalizeVector(cloneVector(stargate && stargate.position), { x: 1, y: 0, z: 0 })
  );
}

function buildGateSpawnState(stargate) {
  const direction = getResolvedStargateForwardDirection(stargate);
  const offset = Math.max((stargate.radius || 15000) * 0.4, 5000);

  return {
    direction,
    position: addVectors(
      cloneVector(stargate.position),
      scaleVector(direction, offset),
    ),
  };
}

function buildOffsetSpawnState(anchor, options = {}) {
  const fallbackDirection = cloneVector(
    options.fallbackDirection,
    { x: 1, y: 0, z: 0 },
  );
  const anchorPosition = cloneVector(anchor && anchor.position);
  const direction = normalizeVector(
    magnitude(anchorPosition) > 0 ? anchorPosition : fallbackDirection,
    fallbackDirection,
  );
  const minOffset = Math.max(toFiniteNumber(options.minOffset, 0), 0);
  const clearance = Math.max(toFiniteNumber(options.clearance, 0), 0);
  const offset = Math.max(toFiniteNumber(anchor && anchor.radius, 0) + clearance, minOffset);
  const position = addVectors(anchorPosition, scaleVector(direction, offset));

  return {
    direction,
    position,
  };
}

function buildSolarSystemSpawnState(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  if (!system) {
    return null;
  }

  const stargates = worldData.getStargatesForSystem(solarSystemID);
  if (stargates.length > 0) {
    const stargate = stargates[0];
    return {
      anchorType: "stargate",
      anchorID: stargate.itemID,
      anchorName: stargate.itemName || `Stargate ${stargate.itemID}`,
      ...buildOffsetSpawnState(stargate, {
        minOffset: Math.max((stargate.radius || 15000) * 0.4, 5000),
      }),
    };
  }

  const stations = worldData.getStationsForSystem(solarSystemID);
  if (stations.length > 0) {
    const station = stations[0];
    return {
      anchorType: "station",
      anchorID: station.stationID,
      anchorName: station.stationName || `Station ${station.stationID}`,
      ...buildOffsetSpawnState(station, {
        minOffset: Math.max((station.radius || 15000) * 0.4, 5000),
        clearance: 5000,
      }),
    };
  }

  const celestials = worldData.getCelestialsForSystem(solarSystemID);
  const celestial =
    celestials.find((entry) => entry.kind !== "sun" && entry.groupID !== 6) ||
    celestials.find((entry) => entry.kind === "sun" || entry.groupID === 6) ||
    celestials[0] ||
    null;
  if (celestial) {
    return {
      anchorType: celestial.kind || "celestial",
      anchorID: celestial.itemID,
      anchorName: celestial.itemName || `Celestial ${celestial.itemID}`,
      ...buildOffsetSpawnState(celestial, {
        minOffset: 100000,
        clearance: celestial.kind === "sun" || celestial.groupID === 6
          ? 250000
          : 25000,
      }),
    };
  }

  return {
    anchorType: "fallback",
    anchorID: system.solarSystemID,
    anchorName: system.solarSystemName || `System ${system.solarSystemID}`,
    direction: { x: 1, y: 0, z: 0 },
    position: { x: 1000000, y: 0, z: 0 },
  };
}

function broadcastOnCharNoLongerInStation(session, stationID) {
  if (!session || !stationID) {
    return;
  }

  const payload = [[
    session.characterID || 0,
    session.corporationID || 0,
    session.allianceID || 0,
    session.warFactionID || 0,
  ]];

  for (const guest of sessionRegistry.getSessions()) {
    if (guest === session) {
      continue;
    }

    const guestStationID = guest.stationid || guest.stationID || 0;
    if (guestStationID !== stationID) {
      continue;
    }

    guest.sendNotification("OnCharNoLongerInStation", "stationid", payload);
  }
}

function queuePendingSessionEffects(session, options = {}) {
  if (!session || typeof session !== "object") {
    return;
  }

  if (
    options.forceInitialBallpark ||
    options.awaitBeyonceBoundBallpark
  ) {
    session._pendingCommandInitialBallpark = {
      force: options.forceInitialBallpark === true,
      awaitBeyonceBound: options.awaitBeyonceBoundBallpark === true,
    };
  }

  if (Object.prototype.hasOwnProperty.call(options, "previousLocalChannelID")) {
    session._pendingLocalChannelSync = {
      previousChannelID: Number(options.previousLocalChannelID || 0) || 0,
    };
  }

  if (options.shipFittingReplay) {
    session._pendingCommandShipFittingReplay = {
      ...options.shipFittingReplay,
    };
  }
}

function queuePostSpaceAttachFittingHydration(
  session,
  shipID,
  options = {},
) {
  if (!session || !session._space) {
    return false;
  }

  const resolvedShipID =
    Number(shipID) ||
    Number(
      session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) ||
    0;
  if (resolvedShipID <= 0) {
    return false;
  }

  const inventoryBootstrapPending =
    options.inventoryBootstrapPending === true;

  // CCP client contract for the inflight HUD needs both:
  // - MakeShipActive/GetAllInfo to seed ship state and tuple-backed charges
  // - a post-prime fitted-module OnItemChange replay so clientDogmaIM fits
  //   the real module dogma items used by HUD right-click/tooltip/module
  //   ownership paths
  //
  // Keep loaded charges off the fitted inv-item replay in space. They must
  // stay tuple-backed and arrive through the shared late charge bootstrap
  // after the module replay, otherwise the rack can end up treating charge
  // tuples or real charge rows as the slot owner.
  session._space.loginInventoryBootstrapPending = inventoryBootstrapPending;
  session._space.loginShipInventoryPrimed = false;
  session._space.loginChargeDogmaReplayPending =
    options.enableChargeDogmaReplay !== false;
  // The inflight rack's first loaded-ammo render comes from godma ship
  // sublocations, not from the later tuple OnItemChange repair rows. Keep the
  // delayed charge bootstrap on the shared godma-prime path for all
  // space-attach transitions so login, /solar, stargate, and undock all seed
  // the same authoritative loaded-charge state before the HUD starts live
  // reload/type-swap updates.
  session._space.loginChargeDogmaReplayMode =
    options.chargeDogmaReplayMode ||
    "prime-and-refresh";
  session._space.loginChargeDogmaReplayFlushed = false;
  session._space.loginChargeDogmaReplayHudBootstrapSeen = false;
  session._space.loginChargeHudFinalizePending =
    options.enableChargeDogmaReplay !== false;
  session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
  if (session._space.loginChargeDogmaReplayTimer) {
    clearTimeout(session._space.loginChargeDogmaReplayTimer);
  }
  if (session._space.loginChargeHudFinalizeTimer) {
    clearTimeout(session._space.loginChargeHudFinalizeTimer);
  }
  session._space.loginChargeHudFinalizeTimer = null;
  session._space.loginChargeDogmaReplayTimer = null;

  session._pendingCommandShipFittingReplay =
    options.queueModuleReplay !== false
      ? {
          shipID: resolvedShipID,
          includeOfflineModules: true,
          includeCharges: false,
          emitChargeInventoryRows: false,
          emitOnlineEffects: options.emitOnlineEffects === true,
          syntheticFitTransition: options.syntheticFitTransition !== false,
          awaitBeyonceBound: options.awaitBeyonceBound !== false,
          awaitInitialBallpark: options.awaitInitialBallpark !== false,
          awaitPostLoginShipInventoryList: true,
        }
      : null;

  if (session._pendingCommandShipFittingReplay) {
    tryFlushPendingShipFittingReplay(session);
  }
  return true;
}

function getSurfaceDistanceBetweenEntities(entity, targetEntity) {
  const centerDistance = distance(entity.position, targetEntity.position);
  return Math.max(
    0,
    centerDistance -
      Math.max(0, toFiniteNumber(entity && entity.radius, 0)) -
      Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0)),
  );
}

function buildStoppedSpaceStateFromEntity(entity) {
  const position = cloneVector(entity && entity.position);
  return {
    position,
    direction: normalizeVector(
      cloneVector(entity && entity.direction, { x: 1, y: 0, z: 0 }),
      { x: 1, y: 0, z: 0 },
    ),
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: position,
  };
}

function captureSpaceSessionState(session) {
  return {
    beyonceBound: Boolean(session && session._space && session._space.beyonceBound),
    initialStateSent: Boolean(
      session && session._space && session._space.initialStateSent,
    ),
  };
}

function refreshSameSceneSessionView(
  scene,
  session,
  egoEntity,
  additionalEntities = [],
) {
  if (!scene || !session || !session._space || !egoEntity) {
    return false;
  }

  const needsFullBootstrap =
    session._space.initialStateSent !== true ||
    session._space.initialBallparkVisualsSent !== true ||
    session._space.initialBallparkClockSynced !== true;
  if (needsFullBootstrap && scene.ensureInitialBallpark(session, { force: true })) {
    return true;
  }

  const refreshEntities = [egoEntity, ...additionalEntities].filter(Boolean);
  if (refreshEntities.length > 0) {
    scene.sendAddBallsToSession(session, refreshEntities);
  }
  scene.syncDynamicVisibilityForSession(session);
  scene.sendStateRefresh(session, egoEntity);
  return true;
}

function flushSameSceneShipSwapNotificationPlan(session, plan) {
  return flushCharacterSessionNotificationPlan(session, plan, {
    sessionChangeOptions: {
      // Same-scene ship swaps should behave like remote attribute updates, not a
      // hard session-version transition. Otherwise the client can stall queued
      // Destiny packets behind "waiting for session change" during eject/board.
      sessionId: 0n,
    },
  });
}

function resolveReusableCapsuleForCharacter(
  characterID,
  excludedShipID,
  currentSolarSystemID,
  preferredStationID,
) {
  const excludedItemID = Number(excludedShipID || 0) || 0;
  const ships = getCharacterShips(characterID).filter(
    (shipItem) =>
      Number(shipItem && shipItem.typeID) === CAPSULE_TYPE_ID &&
      Number(shipItem && shipItem.itemID) !== excludedItemID,
  );

  const currentSystemCapsule = ships.find(
    (shipItem) =>
      Number(shipItem.locationID) === Number(currentSolarSystemID || 0) &&
      Number(shipItem.flagID) === 0,
  );
  if (currentSystemCapsule) {
    return {
      success: true,
      created: false,
      data: currentSystemCapsule,
    };
  }

  const storedCapsule = ships.find(
    (shipItem) => Number(shipItem.flagID) === ITEM_FLAGS.HANGAR,
  );
  if (storedCapsule) {
    return {
      success: true,
      created: false,
      data: storedCapsule,
    };
  }

  const existingCapsule = findCharacterShipByType(characterID, CAPSULE_TYPE_ID);
  if (existingCapsule && Number(existingCapsule.itemID) !== excludedItemID) {
    return {
      success: true,
      created: false,
      data: existingCapsule,
    };
  }

  return ensureCapsuleForCharacter(characterID, preferredStationID);
}

function completeStargateJump(
  session,
  sourceGate,
  destinationGate,
  activeShip,
) {
  if (
    !session ||
    !session.characterID ||
    !sourceGate ||
    !destinationGate ||
    !activeShip
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "INVALID_STARGATE_JUMP_STATE",
    };
  }

  if (
    !session._transitionState ||
    session._transitionState.kind !== "stargate-jump"
  ) {
    return {
      success: false,
      errorMsg: "STARGATE_JUMP_CANCELLED",
    };
  }

  const spawnState = buildGateSpawnState(destinationGate);
  const sourceSimTimeMs =
    session && session._space
      ? spaceRuntime.getSimulationTimeMsForSession(session, null)
      : null;
  const sourceTimeDilation =
    session && session._space
      ? spaceRuntime.getSolarSystemTimeDilation(session._space.systemID)
      : null;
  const sourceClockCapturedAtWallclockMs = Date.now();
  if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
    spaceRuntime.beginSessionJumpTimingTrace(session, "stargate-jump", {
      sourceSystemID: sourceGate.solarSystemID,
      destinationSystemID: destinationGate.solarSystemID,
      sourceGateID: sourceGate.itemID,
      destinationGateID: destinationGate.itemID,
      sourceSimTimeMs,
      sourceTimeDilation,
      sourceClockCapturedAtWallclockMs,
      shipID: activeShip.itemID,
    });
  }

  spaceRuntime.detachSession(session, { broadcast: true });

  const moveResult = moveShipToSpace(activeShip.itemID, destinationGate.solarSystemID, {
    position: spawnState.position,
    direction: spawnState.direction,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: spawnState.position,
  });
  if (!moveResult.success) {
    endTransition(session, "stargate-jump");
    return moveResult;
  }

  syncInventoryItemForSession(
    session,
    moveResult.data,
    {
      locationID: moveResult.previousData.locationID,
      flagID: moveResult.previousData.flagID,
      quantity: moveResult.previousData.quantity,
      singleton: moveResult.previousData.singleton,
      stacksize: moveResult.previousData.stacksize,
    },
    {
      emitCfgLocation: false,
    },
  );

  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, destinationGate.solarSystemID, {
      stationID: null,
    }),
  );
  if (!updateResult.success) {
    endTransition(session, "stargate-jump");
    return updateResult;
  }

  const previousLocalChannelID = Number(
    session.solarsystemid2 ||
    session.solarsystemid ||
    session.stationid ||
    session.stationID ||
    0,
  ) || 0;

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: true,
    selectionEvent: false,
  });
  if (!applyResult.success) {
    endTransition(session, "stargate-jump");
    return applyResult;
  }

  spaceRuntime.attachSession(session, moveResult.data, {
    systemID: destinationGate.solarSystemID,
    beyonceBound: false,
    pendingUndockMovement: false,
    broadcast: true,
    emitSimClockRebase: false,
    previousSimTimeMs: sourceSimTimeMs,
    initialBallparkPreviousSimTimeMs: sourceSimTimeMs,
    initialBallparkPreviousTimeDilation: sourceTimeDilation,
    initialBallparkPreviousCapturedAtWallclockMs: sourceClockCapturedAtWallclockMs,
    deferInitialBallparkStateUntilBind: true,
  });
  if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
    spaceRuntime.recordSessionJumpTimingTrace(session, "stargate-jump-attached", {
      destinationSystemID: destinationGate.solarSystemID,
      shipID: moveResult.data && moveResult.data.itemID,
      spawnState,
    });
  }
  queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {
    inventoryBootstrapPending: false,
  });
  flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
  queuePendingSessionEffects(session, {
    awaitBeyonceBoundBallpark: true,
    previousLocalChannelID,
  });
  flushPendingCommandSessionEffects(session);

  log.info(
    `[SpaceTransition] Stargate jump ${session.characterName || session.characterID} ship=${activeShip.itemID} from=${sourceGate.itemID} to=${destinationGate.itemID}`,
  );

  endTransition(session, "stargate-jump");
  return {
    success: true,
    data: {
      stargate: destinationGate,
      spawnState,
      boundResult: buildBoundResult(session),
    },
  };
}

function syncDockedShipTransitionForSession(session, dockResult, options = {}) {
  if (!session || !dockResult || !dockResult.success || !dockResult.data) {
    return;
  }

  const dockedShip = dockResult.data;
  const previousData = dockResult.previousData || {};

  // Docking moves the active hull into the station hangar. The client needs
  // the location/flag delta for the move itself, then a second cache refresh
  // so the hangar scene can resolve the active hull immediately.
  syncInventoryItemForSession(
    session,
    dockedShip,
    {
      locationID: previousData.locationID,
      flagID: previousData.flagID,
      quantity: previousData.quantity,
      singleton: previousData.singleton,
      stacksize: previousData.stacksize,
    },
    {
      emitCfgLocation: true,
    },
  );

  if (options.refreshActiveShip !== false) {
    syncInventoryItemForSession(
      session,
      dockedShip,
      {
        locationID: dockedShip.locationID,
        flagID: dockedShip.flagID,
        quantity: dockedShip.quantity,
        singleton: dockedShip.singleton,
        stacksize: dockedShip.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );
  }
}

function undockSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  if (!stationID) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const station = worldData.getStationByID(stationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "undock", stationID)) {
    return {
      success: false,
      errorMsg: "UNDOCK_IN_PROGRESS",
    };
  }

  try {
    const previousLocalChannelID = Number(
      session.stationid ||
      session.stationID ||
      session.solarsystemid2 ||
      session.solarsystemid ||
      0,
    ) || 0;
    const undockState = spaceRuntime.getStationUndockSpawnState(station);

    const moveResult = moveShipToSpace(activeShip.itemID, station.solarSystemID, {
      position: undockState.position,
      direction: undockState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: undockState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    const restoreResult = restoreShipForUndock(moveResult.data.itemID);
    if (restoreResult && restoreResult.success) {
      moveResult.data = restoreResult.data;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    broadcastOnCharNoLongerInStation(session, stationID);

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID:
          Number(record.homeStationID || record.cloneStationID || station.stationID) ||
          station.stationID,
        cloneStationID:
          Number(record.cloneStationID || record.homeStationID || station.stationID) ||
          station.stationID,
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: station.solarSystemID,
      undockDirection: undockState.direction,
      speedFraction: 1,
      pendingUndockMovement: false,
      skipLegacyStationNormalization: true,
      broadcast: true,
      emitSimClockRebase: false,
    });
    queuePostSpaceAttachFittingHydration(session, moveResult.data.itemID, {
      inventoryBootstrapPending: false,
    });
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    queuePendingSessionEffects(session, {
      previousLocalChannelID,
    });
    flushPendingCommandSessionEffects(session);

    log.info(
      `[SpaceTransition] Undocked ${session.characterName || session.characterID} ship=${moveResult.data.itemID} station=${stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        ship: moveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "undock");
  }
}

function dockSession(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  if (session.stationid || session.stationID) {
    return {
      success: false,
      errorMsg: "ALREADY_DOCKED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (crimewatchState.isCriminallyFlagged(session.characterID, getCrimewatchReferenceMs(session))) {
    return {
      success: false,
      errorMsg: "CRIMINAL_TIMER_ACTIVE",
    };
  }

  if (!beginTransition(session, "dock", targetStationID)) {
    return {
      success: false,
      errorMsg: "DOCK_IN_PROGRESS",
    };
  }

  try {
    spaceRuntime.detachSession(session, { broadcast: true });

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID:
          Number(record.homeStationID || record.cloneStationID || station.stationID) ||
          station.stationID,
        cloneStationID:
          Number(record.cloneStationID || record.homeStationID || station.stationID) ||
          station.stationID,
        stationID: station.stationID,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    syncDockedShipTransitionForSession(session, dockResult);

    log.info(
      `[SpaceTransition] Docked ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "dock");
  }
}

function restoreSpaceSession(session) {
  if (!session || !session.characterID || session.stationid || session.stationID) {
    return false;
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.spaceState) {
    return false;
  }

  const shipEntity = spaceRuntime.attachSession(session, activeShip, {
    systemID:
      activeShip.spaceState.systemID ||
      session.solarsystemid ||
      session.solarsystemid2,
    pendingUndockMovement: false,
    broadcast: true,
    emitSimClockRebase: false,
  });
  if (!shipEntity) {
    return false;
  }

  queuePostSpaceAttachFittingHydration(session, activeShip.itemID, {
    // Direct login-in-space issues one early ship-inventory List(flag=None)
    // before the HUD stabilizes. Let invbroker suppress only that first call;
    // later explicit None requests still need the full ship contents.
    inventoryBootstrapPending: session._loginInventoryBootstrapPending === true,
  });
  flushPendingCommandSessionEffects(session);

  return true;
}

function ejectSession(session) {
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
    return {
      success: false,
      errorMsg: "ALREADY_IN_CAPSULE",
    };
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const currentEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  if (!scene || !currentEntity) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "eject", activeShip.itemID)) {
    return {
      success: false,
      errorMsg: "EJECT_IN_PROGRESS",
    };
  }

  try {
    const currentSystemID = Number(session._space.systemID || session.solarsystemid2 || session.solarsystemid || 0);
    const characterRecord = getCharacterRecord(session.characterID) || {};
    const preferredStationID =
      Number(
        characterRecord.homeStationID ||
          characterRecord.cloneStationID ||
          session.stationid ||
          session.stationID ||
          60003760,
      ) || 60003760;
    const preservedSpaceState = captureSpaceSessionState(session);
    const capsuleResult = resolveReusableCapsuleForCharacter(
      session.characterID,
      activeShip.itemID,
      currentSystemID,
      preferredStationID,
    );
    if (!capsuleResult.success || !capsuleResult.data) {
      return {
        success: false,
        errorMsg: capsuleResult.errorMsg || "CAPSULE_NOT_FOUND",
      };
    }

    const abandonedShipEntity = spaceRuntime.disembarkSession(session, {
      broadcast: true,
    });
    if (!abandonedShipEntity) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
      };
    }

    const capsuleMoveResult = moveShipToSpace(
      capsuleResult.data.itemID,
      currentSystemID,
      buildStoppedSpaceStateFromEntity(currentEntity),
    );
    if (!capsuleMoveResult.success) {
      return capsuleMoveResult;
    }

    const activeShipResult = setActiveShipForCharacter(
      session.characterID,
      capsuleMoveResult.data.itemID,
    );
    if (!activeShipResult.success) {
      return activeShipResult;
    }

    syncInventoryItemForSession(
      session,
      capsuleMoveResult.data,
      {
        locationID: capsuleMoveResult.previousData.locationID,
        flagID: capsuleMoveResult.previousData.flagID,
        quantity: capsuleMoveResult.previousData.quantity,
        singleton: capsuleMoveResult.previousData.singleton,
        stacksize: capsuleMoveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, currentSystemID, {
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    const capsuleEntity = spaceRuntime.attachSession(session, capsuleMoveResult.data, {
      systemID: currentSystemID,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: false,
      beyonceBound: preservedSpaceState.beyonceBound,
      initialStateSent: preservedSpaceState.initialStateSent,
    });
    if (!capsuleEntity) {
      return {
        success: false,
        errorMsg: "CAPSULE_ATTACH_FAILED",
      };
    }

    queuePostSpaceAttachFittingHydration(session, capsuleMoveResult.data.itemID, {
      inventoryBootstrapPending: false,
      enableChargeDogmaReplay: false,
    });
    flushSameSceneShipSwapNotificationPlan(session, applyResult.notificationPlan);

    // CCP parity: After the ejecting player is attached to their capsule, send
    // an explicit slim-item update for the abandoned ship so the client knows
    // charID is now 0 (unpiloted).  The earlier broadcastSlimItemChanges in
    // disembarkSession cannot reach this session because it was already removed
    // from the scene's session map at that point.  Without this, the client's
    // cached slim item still shows a pilot, blocking re-boarding.
    scene.sendSlimItemChangesToSession(session, [abandonedShipEntity]);
    refreshSameSceneSessionView(scene, session, capsuleEntity, [abandonedShipEntity]);
    scene.syncDynamicVisibilityForAllSessions();

    scene.broadcastSpecialFx(activeShip.itemID, "effects.ShipEjector", {
      targetID: capsuleMoveResult.data.itemID,
      start: true,
      active: false,
      duration: 4000,
      graphicInfo: {
        poseID: 0,
      },
    }, abandonedShipEntity);
    scene.broadcastSpecialFx(capsuleMoveResult.data.itemID, "effects.CapsuleFlare", {
      start: true,
      active: false,
      duration: 4000,
      graphicInfo: {
        poseID: 0,
      },
    }, capsuleEntity);

    log.info(
      `[SpaceTransition] Ejected ${session.characterName || session.characterID} from ship=${activeShip.itemID} into capsule=${capsuleMoveResult.data.itemID} system=${currentSystemID}`,
    );

    return {
      success: true,
      data: {
        abandonedShip: activeShip,
        capsule: capsuleMoveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "eject");
  }
}

function boardSpaceShip(session, shipID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const targetShipID = Number(shipID || 0) || 0;
  if (!targetShipID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const currentShip = getActiveShipRecord(session.characterID);
  if (!currentShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (Number(currentShip.itemID) === targetShipID) {
    return {
      success: true,
      data: {
        ship: currentShip,
        boundResult: buildBoundResult(session),
      },
    };
  }

  const scene = spaceRuntime.getSceneForSession(session);
  const currentEntity = spaceRuntime.getEntity(session, currentShip.itemID);
  if (!scene || !currentEntity) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const targetShip = findCharacterShip(session.characterID, targetShipID);
  if (!targetShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_OWNED",
    };
  }
  if (Number(targetShip.locationID) !== Number(scene.systemID)) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_IN_SYSTEM",
    };
  }

  const targetEntity = scene.getEntityByID(targetShipID);
  if (!targetEntity || targetEntity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "TARGET_SHIP_NOT_ON_GRID",
    };
  }
  if (!scene.canSessionSeeDynamicEntity(session, targetEntity)) {
    return {
      success: false,
      errorMsg: "TARGET_SHIP_NOT_ON_GRID",
    };
  }
  if (targetEntity.session && targetEntity.session !== session) {
    return {
      success: false,
      errorMsg: "SHIP_ALREADY_OCCUPIED",
    };
  }

  const boardingDistance = getSurfaceDistanceBetweenEntities(
    currentEntity,
    targetEntity,
  );
  if (boardingDistance > SPACE_BOARDING_RANGE_METERS) {
    return {
      success: false,
      errorMsg: "TOO_FAR_AWAY",
      data: {
        distanceMeters: boardingDistance,
        maxDistanceMeters: SPACE_BOARDING_RANGE_METERS,
      },
    };
  }

  if (!beginTransition(session, "board", targetShipID)) {
    return {
      success: false,
      errorMsg: "BOARD_IN_PROGRESS",
    };
  }

  try {
    const currentSystemID = Number(scene.systemID || session.solarsystemid2 || session.solarsystemid || 0);
    const preservedSpaceState = captureSpaceSessionState(session);
    const abandonedCurrentEntity = spaceRuntime.disembarkSession(session, {
      broadcast: true,
    });
    if (!abandonedCurrentEntity) {
      return {
        success: false,
        errorMsg: "ACTIVE_SHIP_ENTITY_NOT_FOUND",
      };
    }

    const activeShipResult = setActiveShipForCharacter(
      session.characterID,
      targetShipID,
    );
    if (!activeShipResult.success) {
      return activeShipResult;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, currentSystemID, {
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    const boardedEntity = spaceRuntime.attachSessionToExistingEntity(
      session,
      targetShip,
      targetEntity,
      {
        systemID: currentSystemID,
        pendingUndockMovement: false,
        broadcast: false,
        beyonceBound: preservedSpaceState.beyonceBound,
        initialStateSent: preservedSpaceState.initialStateSent,
      },
    );
    if (!boardedEntity) {
      return {
        success: false,
        errorMsg: "BOARD_ATTACH_FAILED",
      };
    }

    queuePostSpaceAttachFittingHydration(session, targetShipID, {
      inventoryBootstrapPending: false,
    });
    flushSameSceneShipSwapNotificationPlan(session, applyResult.notificationPlan);
    scene.broadcastSlimItemChanges([boardedEntity]);
    scene.broadcastBallRefresh([boardedEntity], session);
    scene.syncDynamicVisibilityForAllSessions();
    scene.sendSlimItemChangesToSession(session, [abandonedCurrentEntity]);
    refreshSameSceneSessionView(scene, session, boardedEntity, [abandonedCurrentEntity]);

    log.info(
      `[SpaceTransition] Boarded ${session.characterName || session.characterID} ship=${targetShipID} from=${currentShip.itemID} system=${currentSystemID}`,
    );

    return {
      success: true,
      data: {
        ship: targetShip,
        previousShip: currentShip,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "board");
  }
}

function jumpSessionViaStargate(session, fromStargateID, toStargateID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const sourceGate = worldData.getStargateByID(fromStargateID);
  const destinationGate = worldData.getStargateByID(
    toStargateID || (sourceGate && sourceGate.destinationID),
  );
  if (!sourceGate || !destinationGate) {
    return {
      success: false,
      errorMsg: "STARGATE_NOT_FOUND",
    };
  }
  if (!beginTransition(session, "stargate-jump", sourceGate.itemID)) {
    return {
      success: false,
      errorMsg: "STARGATE_JUMP_IN_PROGRESS",
    };
  }
  if (
    Number(sourceGate.destinationID || 0) !== Number(destinationGate.itemID || 0)
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "STARGATE_DESTINATION_MISMATCH",
    };
  }
  if (
    Number(sourceGate.solarSystemID || 0) !== Number(session._space.systemID || 0)
  ) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "WRONG_SOLAR_SYSTEM",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (crimewatchState.isCriminallyFlagged(session.characterID, getCrimewatchReferenceMs(session))) {
    endTransition(session, "stargate-jump");
    return {
      success: false,
      errorMsg: "CRIMINAL_TIMER_ACTIVE",
    };
  }

  const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  const sourceEntity = spaceRuntime.getEntity(session, sourceGate.itemID);
  if (shipEntity && sourceEntity) {
    const jumpDistance = getSurfaceDistanceBetweenEntities(shipEntity, sourceEntity);
    if (jumpDistance > STARGATE_JUMP_RANGE_METERS) {
      endTransition(session, "stargate-jump");
      return {
        success: false,
        errorMsg: "TOO_FAR_FROM_STARGATE",
      };
    }
  }

  const startResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  if (!startResult.success) {
    endTransition(session, "stargate-jump");
    return startResult;
  }

  // Scale the handoff delay by the TiDi factor so the client-side gate FX
  // (which plays in dilated sim time) has enough wallclock time to finish
  // before we detach the session and reset TiDi to 1.0.
  const tidiFactor = spaceRuntime.getSolarSystemTimeDilation(sourceGate.solarSystemID);
  const scaledDelay = Math.round(STARGATE_JUMP_HANDOFF_DELAY_MS / tidiFactor);

  setTimeout(() => {
    const completionResult = completeStargateJump(
      session,
      sourceGate,
      destinationGate,
      activeShip,
    );
    if (!completionResult.success) {
      log.warn(
        `[SpaceTransition] Delayed stargate jump failed for ${session.characterName || session.characterID}: ${completionResult.errorMsg}`,
      );
    }
  }, scaledDelay);

  return {
    success: true,
    data: {
      stargate: destinationGate,
      jumpOutStamp: startResult.data.stamp,
      boundResult: buildBoundResult(session),
    },
  };
}

function rebuildDockedSessionAtStation(session, stationID, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const previousLocalChannelID = Number(
    session.solarsystemid2 ||
    session.solarsystemid ||
    session.stationid ||
    session.stationID ||
    0,
  ) || 0;

  const capsuleResult = ensureCapsuleForCharacter(
    session.characterID,
    station.stationID,
  );
  if (!capsuleResult.success || !capsuleResult.data) {
    return {
      success: false,
      errorMsg: capsuleResult.errorMsg || "CAPSULE_NOT_FOUND",
    };
  }

  const capsuleShip = capsuleResult.data;
  const activeShipResult = setActiveShipForCharacter(
    session.characterID,
    capsuleShip.itemID,
  );
  if (!activeShipResult.success) {
    return activeShipResult;
  }

  const currentRecord = getCharacterRecord(session.characterID);
  const authoritativeHomeStationID =
    Number(
      (currentRecord && (
        currentRecord.homeStationID ||
        currentRecord.cloneStationID
      )) ||
      session.homeStationID ||
      session.homestationid ||
      session.cloneStationID ||
      session.clonestationid ||
      0,
    ) || 0;

  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, station.solarSystemID, {
      homeStationID: authoritativeHomeStationID || station.stationID,
      cloneStationID:
        Number(record.cloneStationID || authoritativeHomeStationID || station.stationID) ||
        station.stationID,
      stationID: station.stationID,
    }),
  );
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: false,
    logSelection: options.logSelection !== false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  if (!applyResult.success) {
    return applyResult;
  }

  if (options.emitNotifications !== false) {
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
  }

  const capsuleChanges = Array.isArray(capsuleResult.changes)
    ? capsuleResult.changes
    : [];
  for (const change of capsuleChanges) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForSession(
      session,
      change.item,
      change.previousState || {
        locationID: 0,
        flagID: ITEM_FLAGS.HANGAR,
      },
      {
        emitCfgLocation: true,
      },
    );
  }

  const refreshedCapsule = getActiveShipRecord(session.characterID) || capsuleShip;
  syncInventoryItemForSession(
    session,
    refreshedCapsule,
    {
      locationID: refreshedCapsule.locationID,
      flagID: refreshedCapsule.flagID,
      quantity: refreshedCapsule.quantity,
      singleton: refreshedCapsule.singleton,
      stacksize: refreshedCapsule.stacksize,
    },
    {
      emitCfgLocation: true,
    },
  );

  queuePendingSessionEffects(session, {
    previousLocalChannelID,
  });
  flushPendingCommandSessionEffects(session);

  let newbieShipResult = null;
  if (options.boardNewbieShip === true) {
    const DogmaService = require(path.join(
      __dirname,
      "../services/dogma/dogmaService",
    ));
    if (typeof DogmaService.boardNewbieShipForSession === "function") {
      newbieShipResult = DogmaService.boardNewbieShipForSession(session, {
        emitNotifications: options.emitNotifications !== false,
        logSelection: false,
        repairExistingShip: true,
        logLabel: options.newbieShipLogLabel || "PodRespawn",
      });
      if (!newbieShipResult.success) {
        log.warn(
          `[SpaceTransition] Failed to auto-board corvette for ${session.characterName || session.characterID} station=${station.stationID} error=${newbieShipResult.errorMsg}`,
        );
      }
    }
  }

  const activeShip =
    getActiveShipRecord(session.characterID) ||
    (newbieShipResult && newbieShipResult.data && newbieShipResult.data.ship) ||
    refreshedCapsule;

  log.info(
    `[SpaceTransition] Rebuilt docked session for ${session.characterName || session.characterID} station=${station.stationID} ship=${activeShip && activeShip.itemID}`,
  );

  return {
    success: true,
    data: {
      station,
      capsule: refreshedCapsule,
      ship: activeShip,
      newbieShipResult,
      boundResult: buildBoundResult(session),
    },
  };
}

function jumpSessionToStation(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "station-jump", targetStationID)) {
    return {
      success: false,
      errorMsg: "STATION_JUMP_IN_PROGRESS",
    };
  }

  try {
    const previousLocalChannelID = Number(
      session.solarsystemid2 ||
      session.solarsystemid ||
      session.stationid ||
      session.stationID ||
      0,
    ) || 0;

    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const currentRecord = getCharacterRecord(session.characterID);
    const authoritativeHomeStationID =
      Number(
        (currentRecord && (
          currentRecord.homeStationID ||
          currentRecord.cloneStationID
        )) ||
        session.homeStationID ||
        session.homestationid ||
        session.cloneStationID ||
        session.clonestationid ||
        0,
      ) || 0;

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID: authoritativeHomeStationID || station.stationID,
        cloneStationID:
          Number(record.cloneStationID || authoritativeHomeStationID || station.stationID) ||
          station.stationID,
        stationID: station.stationID,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    syncDockedShipTransitionForSession(session, dockResult);

    queuePendingSessionEffects(session, {
      previousLocalChannelID,
    });

    log.info(
      `[SpaceTransition] Station jump ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "station-jump");
  }
}

function jumpSessionToSolarSystem(session, solarSystemID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetSolarSystemID = Number(solarSystemID || 0);
  const system = worldData.getSolarSystemByID(targetSolarSystemID);
  if (!system) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "solar-jump", targetSolarSystemID)) {
    return {
      success: false,
      errorMsg: "SOLAR_JUMP_IN_PROGRESS",
    };
  }

  try {
    const sourceStationID = Number(session.stationid || session.stationID || 0);
    const wasInSpace = Boolean(session._space);
    const sourceSimTimeMs = wasInSpace
      ? spaceRuntime.getSimulationTimeMsForSession(session, null)
      : null;
    const sourceTimeDilation = wasInSpace
      ? spaceRuntime.getSolarSystemTimeDilation(session._space.systemID)
      : null;
    const sourceClockCapturedAtWallclockMs = wasInSpace ? Date.now() : null;
    if (typeof spaceRuntime.beginSessionJumpTimingTrace === "function") {
      spaceRuntime.beginSessionJumpTimingTrace(session, "solar-jump", {
        sourceSystemID:
          wasInSpace && session && session._space
            ? Number(session._space.systemID || 0) || null
            : null,
        destinationSystemID: targetSolarSystemID,
        sourceSimTimeMs,
        sourceTimeDilation,
        sourceClockCapturedAtWallclockMs,
        shipID: activeShip.itemID,
      });
    }
    const previousLocalChannelID = Number(
      session.solarsystemid2 ||
      session.solarsystemid ||
      session.stationid ||
      session.stationID ||
      0,
    ) || 0;
    const spawnState = buildSolarSystemSpawnState(targetSolarSystemID);
    if (!spawnState) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    if (wasInSpace) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const moveResult = moveShipToSpace(activeShip.itemID, targetSolarSystemID, {
      position: spawnState.position,
      direction: spawnState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: spawnState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    if (sourceStationID) {
      broadcastOnCharNoLongerInStation(session, sourceStationID);
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, targetSolarSystemID, {
        ...(sourceStationID
          ? {
              homeStationID:
                Number(record.homeStationID || record.cloneStationID || sourceStationID) ||
                sourceStationID,
              cloneStationID:
                Number(record.cloneStationID || record.homeStationID || sourceStationID) ||
                sourceStationID,
            }
          : {}),
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: false,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: targetSolarSystemID,
      beyonceBound: false,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: true,
      emitSimClockRebase: false,
      previousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousSimTimeMs: sourceSimTimeMs,
      initialBallparkPreviousTimeDilation: sourceTimeDilation,
      initialBallparkPreviousCapturedAtWallclockMs: sourceClockCapturedAtWallclockMs,
      deferInitialBallparkStateUntilBind: true,
    });
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "solar-jump-attached", {
        destinationSystemID: targetSolarSystemID,
        shipID: moveResult.data && moveResult.data.itemID,
        spawnState,
      });
    }
    queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {
      inventoryBootstrapPending: false,
    });
    flushCharacterSessionNotificationPlan(session, applyResult.notificationPlan);
    queuePendingSessionEffects(session, {
      awaitBeyonceBoundBallpark: true,
      previousLocalChannelID,
    });
    flushPendingCommandSessionEffects(session);

    log.info(
      `[SpaceTransition] Solar jump ${session.characterName || session.characterID} ship=${activeShip.itemID} system=${targetSolarSystemID} anchor=${spawnState.anchorType}:${spawnState.anchorID}`,
    );

    return {
      success: true,
      data: {
        solarSystem: system,
        ship: moveResult.data,
        spawnState,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "solar-jump");
  }
}

module.exports = {
  buildBoundResult,
  buildSolarSystemSpawnState,
  undockSession,
  dockSession,
  restoreSpaceSession,
  ejectSession,
  boardSpaceShip,
  jumpSessionViaStargate,
  rebuildDockedSessionAtStation,
  jumpSessionToStation,
  jumpSessionToSolarSystem,
};
module.exports._testing = {
  buildBoundResultForTesting: buildBoundResult,
  buildGateSpawnState,
  completeStargateJumpForTesting: completeStargateJump,
  getResolvedStargateForwardDirection,
  getSurfaceDistanceBetweenEntities,
};

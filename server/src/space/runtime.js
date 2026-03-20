const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require(path.join(__dirname, "../config"));
const log = require(path.join(__dirname, "../utils/logger"));
const {
  updateShipItem,
  updateInventoryItem,
  removeInventoryItem,
  listContainerItems,
  listSystemSpaceItems,
  findItemById,
  findShipItemById,
  getShipConditionState,
  normalizeShipConditionState,
  getItemMetadata,
  pruneExpiredSpaceItems,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  resolveRuntimeWreckRadius,
} = require(path.join(__dirname, "../services/inventory/wreckRadius"));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  getAppliedSkinMaterialSetID,
} = require(path.join(__dirname, "../services/ship/shipCosmeticsState"));
const {
  buildSlimModuleTuples,
  buildCharacterTargetingState,
  buildChargeTupleItemID,
  buildShipResourceState,
  getAttributeIDByNames,
  getEffectIDByNames,
  getTypeDogmaAttributes,
  getTypeDogmaEffects,
  getTypeAttributeValue,
  getEffectTypeRecord,
  getLoadedChargeByFlag,
  isModuleOnline,
} = require(path.join(__dirname, "../services/fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../services/skills/skillState"));
const {
  currentFileTime,
  buildMarshalReal,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const worldData = require(path.join(__dirname, "./worldData"));
const destiny = require(path.join(__dirname, "./destiny"));
const {
  applyDamageToEntity,
  buildLiveDamageState,
  hasDamageableHealth,
  getEntityCurrentHealthLayers,
  getEntityMaxHealthLayers,
} = require(path.join(__dirname, "./combat/damage"));
const {
  buildWeaponModuleSnapshot,
  resolveWeaponFamily,
} = require(path.join(__dirname, "./combat/weaponDogma"));
const {
  resolveLaserTurretShot,
} = require(path.join(__dirname, "./combat/laserTurrets"));
//testing: import TiDi notification helpers for system entry/leave
const {
  sendTimeDilationNotificationToSession,
} = require(path.join(__dirname, "../utils/synchronizedTimeDilation"));

const ONE_AU_IN_METERS = 149597870700;
const MIN_WARP_DISTANCE_METERS = 150000;
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const VALID_MODES = new Set(["STOP", "GOTO", "FOLLOW", "WARP", "ORBIT"]);
const INCLUDE_STARGATES_IN_SCENE = true;
const STARGATE_ACTIVATION_STATE = Object.freeze({
  CLOSED: 0,
  OPEN: 1,
  ACTIVATING: 2,
});
const STARGATE_ACTIVATION_TRANSITION_MS = 3000;
const NEW_EDEN_SYSTEM_LOADING = Object.freeze({
  LAZY: 1,
  HIGHSEC: 2,
  ALL: 3,
});
// Mode 1 intentionally preserves the current startup behavior so a fresh boot
// still only opens the known Jita <-> New Caldari path by default.
const STARTUP_PRELOADED_SYSTEM_IDS = Object.freeze([30000142, 30000145]);
const DEFAULT_STARGATE_INTERACTION_RADIUS = 1;
const DEFAULT_STATION_INTERACTION_RADIUS = 1000;
const DEFAULT_STATION_UNDOCK_DISTANCE = 8000;
const DEFAULT_STATION_DOCKING_RADIUS = 2500;
const WARP_EXIT_VARIANCE_RADIUS_METERS = 2500;
const DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS = 250_000;
const STATION_DOCK_ACCEPT_DELAY_MS = 4000;
const LEGACY_STATION_NORMALIZATION_RADIUS = 100000;
const MOVEMENT_DEBUG_PATH = path.join(__dirname, "../../logs/space-movement-debug.log");
const DESTINY_DEBUG_PATH = path.join(__dirname, "../../logs/space-destiny-debug.log");
const WARP_DEBUG_PATH = path.join(__dirname, "../../logs/space-warp-debug.log");
const BALL_DEBUG_PATH = path.join(__dirname, "../../logs/space-ball-debug.log");
const BUBBLE_DEBUG_PATH = path.join(__dirname, "../../logs/space-bubble-debug.log");
const JUMP_TIMING_TRACE_PATH = path.join(__dirname, "../../logs/space-jump-timing-trace.log");
const SHIP_FITTING_FLAG_RANGES = Object.freeze([
  Object.freeze([11, 34]),
  Object.freeze([92, 99]),
  Object.freeze([125, 132]),
]);
const WATCHER_CORRECTION_INTERVAL_MS = 500;
const WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS = 250;
// Keep active subwarp watcher velocity corrections tight, but do not spam
// position anchors faster than the 1-second Destiny stamp cadence. Repeated
// same-stamp SetBallPosition rebases are what made remote ships jolt and drift.
const ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const WARP_POSITION_CORRECTION_INTERVAL_MS = 250;
// Local CCP code consistently treats scene membership as bubble ownership
// (`ball.newBubbleId`, `current_bubble_members`) rather than one global
// visibility radius. Crucible EVEmu uses 300km bubbles but also documents
// retail as 250km, so use 250km as the default server-side bubble radius and
// keep hysteresis explicit to avoid churn at the edge.
const BUBBLE_RADIUS_METERS = 250_000;
const BUBBLE_HYSTERESIS_METERS = 5_000;
const BUBBLE_RADIUS_SQUARED = BUBBLE_RADIUS_METERS * BUBBLE_RADIUS_METERS;
const BUBBLE_CENTER_MIN_DISTANCE_METERS = BUBBLE_RADIUS_METERS * 2;
const BUBBLE_CENTER_MIN_DISTANCE_SQUARED =
  BUBBLE_CENTER_MIN_DISTANCE_METERS * BUBBLE_CENTER_MIN_DISTANCE_METERS;
const BUBBLE_RETENTION_RADIUS_METERS =
  BUBBLE_RADIUS_METERS + BUBBLE_HYSTERESIS_METERS;
const BUBBLE_RETENTION_RADIUS_SQUARED =
  BUBBLE_RETENTION_RADIUS_METERS * BUBBLE_RETENTION_RADIUS_METERS;
// CCP expanded the player-facing grid from 250km to 8000km on
// December 8, 2015, and CCP Nullarbor clarified the underlying grid-box size
// as 7,864,320m. Keep 250km bubbles as the INTERNAL ownership unit, but drive
// player-facing dynamic visibility from these larger public-grid boxes.
const PUBLIC_GRID_BOX_METERS = 7_864_320;
const PUBLIC_GRID_HALF_BOX_METERS = PUBLIC_GRID_BOX_METERS / 2;
const MOVEMENT_TRACE_WINDOW_MS = 5000;
const MAX_SUBWARP_SPEED_FRACTION = 1.0;
const DESTINY_STAMP_INTERVAL_MS = 1000;
const DESTINY_STAMP_MAX_LEAD = 1;
const DESTINY_ACCEL_LOG_DENOMINATOR = Math.log(10000);
const DESTINY_ALIGN_LOG_DENOMINATOR = Math.log(4);
// The published passive recharge curve is asymptotic near full. Settle the
// final client-visible capacitor unit so ships do not linger at 6749/6750.
const PASSIVE_RECHARGE_FULL_SNAP_UNITS = 1;
const TURN_ALIGNMENT_RADIANS = 4 * (Math.PI / 180);
const WARP_ALIGNMENT_RADIANS = 6 * (Math.PI / 180);
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
const MIN_TIME_DILATION = 0.1;
const MAX_TIME_DILATION = 1.0;
const SIM_CLOCK_REBASE_INTERVAL_MS = 250;
const PROPULSION_EFFECT_AFTERBURNER = "moduleBonusAfterburner";
const PROPULSION_EFFECT_MICROWARPDRIVE = "moduleBonusMicrowarpdrive";
const PROPULSION_GUID_BY_EFFECT = Object.freeze({
  [PROPULSION_EFFECT_AFTERBURNER]: "effects.Afterburner",
  [PROPULSION_EFFECT_MICROWARPDRIVE]: "effects.MicroWarpDrive",
});
const EFFECT_ID_AFTERBURNER = getEffectIDByNames(PROPULSION_EFFECT_AFTERBURNER) || 6731;
const EFFECT_ID_MICROWARPDRIVE = getEffectIDByNames(PROPULSION_EFFECT_MICROWARPDRIVE) || 6730;
const SESSION_JUMP_TRACE_WINDOW_MS = 120000;
let nextSessionJumpTraceID = 1;
const PROPULSION_SKILL_AFTERBURNER = 3450;
const PROPULSION_SKILL_FUEL_CONSERVATION = 3451;
const PROPULSION_SKILL_ACCELERATION_CONTROL = 3452;
const PROPULSION_SKILL_HIGH_SPEED_MANEUVERING = 3454;
const MODULE_ATTRIBUTE_CAPACITOR_NEED = 6;
const MODULE_ATTRIBUTE_SPEED_FACTOR = 20;
const MODULE_ATTRIBUTE_SPEED = 51;
const MODULE_ATTRIBUTE_DURATION = 73;
const MODULE_ATTRIBUTE_CAPACITOR_CAPACITY_MULTIPLIER = 147;
const MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS = 554;
const MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR = 567;
const MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE = 763;
const MODULE_ATTRIBUTE_MASS_ADDITION = 796;
const MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT = 1028;
const MODULE_ATTRIBUTE_REACTIVATION_DELAY = 669;
const SPECIAL_FX_REPEAT_WINDOW_MS = 12 * 60 * 60 * 1000;
const WARP_ENTRY_SPEED_FRACTION = 0.749;
const WARP_NATIVE_ACTIVATION_SPEED_FRACTION = 0.75;
const WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS = 1;
const WARP_DECEL_RATE_MAX = 2;
const WARP_DROPOUT_SPEED_MAX_MS = 100;
const WARP_ACCEL_EXPONENT = 5;
const WARP_DECEL_EXPONENT = 5;
const WARP_MEDIUM_DISTANCE_AU = 12;
const WARP_LONG_DISTANCE_AU = 24;
// The native DLL solver starts its elapsed timer ~5 seconds after the server
// builds the warp state (network transmission + client processing + WarpState
// transition delay).  The old 100 km minimum caused the server's distance-based
// completion check to fire while the DLL still had tens of thousands of km of
// decel remaining, producing a visible snap-to-target teleport.
// Fix: distance check effectively disabled (1 m threshold), and durationMs gets
// a grace period (WARP_NATIVE_DECEL_GRACE_MS) so the server waits for the DLL
// solver to finish its decel before sending the completion snap.
const WARP_COMPLETION_DISTANCE_RATIO = 0;
const WARP_COMPLETION_DISTANCE_MIN_METERS = 1;
const WARP_COMPLETION_DISTANCE_MAX_METERS = 1;
const WARP_NATIVE_DECEL_GRACE_MS = 5000;
// Keep the prepare-phase pilot seed only slightly above subwarp max. The
// activation AddBalls2 refresh still resets the ego ball's raw maxVelocity back
// to its subwarp ceiling, so the only activation nudge that matches the client
// gate cleanly is a tiny pre-WarpTo velocity floor just above
// `0.75 * subwarpMaxVelocity`.
const WARP_START_ACTIVATION_SEED_SCALE = 1.1;
// Option A is closed after a clean no-hook run: the pilot really received the
// bumped warpFactor, but the client still stayed on the same wrapper-only path.
const ENABLE_PILOT_WARP_FACTOR_OPTION_A = false;
const PILOT_WARP_FACTOR_OPTION_A_SCALE = 1.15;
// Option B: keep the live branch honest and isolated by sending one late
// pilot-only SetMaxSpeed assist at the predicted start of exit / deceleration.
const ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B = false;
const PILOT_WARP_SOLVER_ASSIST_SCALE = 1.5;
const PILOT_WARP_SOLVER_ASSIST_LEAD_MS = DESTINY_STAMP_INTERVAL_MS;
const ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE = true;
// `auditwarp7.txt` and `overshoot1.txt` both showed the pilot still receiving
// a same-stamp AddBalls2 -> SetState replay on the already-existing ego ball at
// activation. Michelle applies both full-state reads, so keep the live warp
// handoff on WarpTo / SetBallVelocity / FX instead of rebootstraping the ego
// ball mid-warp.
const ENABLE_PILOT_WARP_EGO_STATE_REFRESH = false;
// `auditwarp12.txt` showed that later in-warp pilot `SetMaxSpeed` bumps freeze
// the client exactly when it enters the later warp phase.
// `auditwarp14.txt` then narrowed the remaining long-warp failure down further:
// the current one-shot activation `SetMaxSpeed` keeps the pilot on the slow
// forced-warp fallback, because it raises the native `0.75 * maxVelocity` gate
// far above the carried align speed. Leave the later in-warp ramp disabled and
// keep activation help on the velocity floor instead.
const ENABLE_PILOT_WARP_MAX_SPEED_RAMP = false;
// Active-warp pilot SetBallPosition / SetBallVelocity pushes are currently
// worse than the original freeze: the client visibly fights them, snaps nose,
// and then stalls its own active-warp traversal. Keep the handoff on the
// activation bundle and let the local warp solver own the flight.
const ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS = false;
const PILOT_WARP_SPEED_RAMP_FRACTIONS = Object.freeze([0.2, 0.45, 0.7, 1.0]);
const PILOT_WARP_SPEED_RAMP_SCALES = Object.freeze([0.6, 0.75, 0.9, 0.95]);

let nextMovementTraceID = 1;
let nextRuntimeEntityID = 900_000_000_000;
let nextFallbackStamp = 0;

function getCurrentDestinyStamp(now = Date.now()) {
  const numericNow = Number(now);
  const stampSource = Number.isFinite(numericNow)
    ? Math.floor(numericNow / DESTINY_STAMP_INTERVAL_MS)
    : Math.floor(Date.now() / DESTINY_STAMP_INTERVAL_MS);
  return (stampSource & 0x7fffffff) >>> 0;
}

function getMovementStamp(now = Date.now()) {
  return getCurrentDestinyStamp(now);
}

function getNextStamp(now = Date.now()) {
  const currentStamp = getCurrentDestinyStamp(now);
  const maxAllowedStamp = (currentStamp + DESTINY_STAMP_MAX_LEAD) >>> 0;
  if (nextFallbackStamp < currentStamp) {
    nextFallbackStamp = currentStamp;
    return nextFallbackStamp;
  }
  if (nextFallbackStamp >= maxAllowedStamp) {
    nextFallbackStamp = maxAllowedStamp;
    return nextFallbackStamp;
  }
  nextFallbackStamp = (nextFallbackStamp + 1) >>> 0;
  return nextFallbackStamp;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function roundNumber(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
}

function advancePassiveRechargeRatio(currentRatio, deltaSeconds, rechargeSeconds) {
  const clampedRatio = clamp(toFiniteNumber(currentRatio, 0), 0, 1);
  const elapsedSeconds = Math.max(0, toFiniteNumber(deltaSeconds, 0));
  const totalRechargeSeconds = Math.max(0, toFiniteNumber(rechargeSeconds, 0));
  if (
    clampedRatio <= 0 ||
    clampedRatio >= 1 ||
    elapsedSeconds <= 0 ||
    totalRechargeSeconds <= 0
  ) {
    return clampedRatio;
  }

  // Closed-form progression of CCP's published capacitor curve:
  //   C1/Cmax = (1 + (sqrt(C0/Cmax) - 1) * e^(-5 * dt / T))^2
  const nextRoot =
    1 + ((Math.sqrt(clampedRatio) - 1) * Math.exp((-5 * elapsedSeconds) / totalRechargeSeconds));
  return clamp(nextRoot * nextRoot, 0, 1);
}

function settlePassiveRechargeRatio(nextRatio, capacity) {
  const clampedRatio = clamp(toFiniteNumber(nextRatio, 0), 0, 1);
  const maxCapacity = Math.max(0, toFiniteNumber(capacity, 0));
  if (clampedRatio >= 1 || maxCapacity <= 0) {
    return clampedRatio >= 1 ? 1 : clampedRatio;
  }

  const remainingUnits = maxCapacity * (1 - clampedRatio);
  return remainingUnits <= PASSIVE_RECHARGE_FULL_SNAP_UNITS ? 1 : clampedRatio;
}

function toFileTimeFromMs(value, fallback = currentFileTime()) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function fileTimeToMs(value, fallback = Date.now()) {
  try {
    const numericValue =
      typeof value === "bigint"
        ? value
        : BigInt(value && value.type === "long" ? value.value : value);
    if (numericValue <= FILETIME_EPOCH_OFFSET) {
      return fallback;
    }
    return Number((numericValue - FILETIME_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
  } catch (error) {
    return fallback;
  }
}

function clampTimeDilationFactor(value, fallback = 1) {
  return clamp(
    toFiniteNumber(value, fallback),
    MIN_TIME_DILATION,
    MAX_TIME_DILATION,
  );
}

function unwrapMarshalNumber(value, fallback = 0) {
  if (value && typeof value === "object" && value.type === "real") {
    return toFiniteNumber(value.value, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function marshalModuleDurationWireValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "real") {
    return value;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return value;
  }
  if (numericValue < 0) {
    return Math.trunc(numericValue);
  }
  return buildMarshalReal(numericValue, 0);
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function clonePilotWarpMaxSpeedRamp(rawRamp, fallback = []) {
  const source = Array.isArray(rawRamp) ? rawRamp : fallback;
  return source
    .map((entry) => ({
      atMs: toFiniteNumber(entry && entry.atMs, 0),
      stamp: toInt(entry && entry.stamp, 0),
      speed: Math.max(toFiniteNumber(entry && entry.speed, 0), 0),
      label: String((entry && entry.label) || ""),
    }))
    .filter((entry) => entry.atMs > 0 && entry.speed > 0);
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

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function crossProduct(left, right) {
  return {
    x: (left.y * right.z) - (left.z * right.y),
    y: (left.z * right.x) - (left.x * right.z),
    z: (left.x * right.y) - (left.y * right.x),
  };
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function distanceSquared(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx ** 2) + (dy ** 2) + (dz ** 2);
}

function getPublicGridAxisIndex(value) {
  return Math.floor(toFiniteNumber(value, 0) / PUBLIC_GRID_BOX_METERS);
}

function buildPublicGridKeyFromIndices(xIndex, yIndex, zIndex) {
  return `${toInt(xIndex, 0)}:${toInt(yIndex, 0)}:${toInt(zIndex, 0)}`;
}

function buildPublicGridKey(position) {
  const resolvedPosition = cloneVector(position);
  return buildPublicGridKeyFromIndices(
    getPublicGridAxisIndex(resolvedPosition.x),
    getPublicGridAxisIndex(resolvedPosition.y),
    getPublicGridAxisIndex(resolvedPosition.z),
  );
}

function parsePublicGridKey(key) {
  if (typeof key !== "string" || key.trim() === "") {
    return {
      key: buildPublicGridKeyFromIndices(0, 0, 0),
      xIndex: 0,
      yIndex: 0,
      zIndex: 0,
    };
  }

  const [rawX, rawY, rawZ] = key.split(":");
  const xIndex = toInt(rawX, 0);
  const yIndex = toInt(rawY, 0);
  const zIndex = toInt(rawZ, 0);
  return {
    key: buildPublicGridKeyFromIndices(xIndex, yIndex, zIndex),
    xIndex,
    yIndex,
    zIndex,
  };
}

function summarizePublicGrid(position) {
  const resolvedPosition = cloneVector(position);
  return {
    key: buildPublicGridKey(resolvedPosition),
    xIndex: getPublicGridAxisIndex(resolvedPosition.x),
    yIndex: getPublicGridAxisIndex(resolvedPosition.y),
    zIndex: getPublicGridAxisIndex(resolvedPosition.z),
    boxMeters: PUBLIC_GRID_BOX_METERS,
  };
}

// Debug/test-only helper for slash-command FX previews. This is intentionally
// not gameplay target acquisition logic and should not be reused for modules.
function resolveDebugTestNearestStationTarget(
  scene,
  sourceEntity,
  maxRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
) {
  if (!scene || !sourceEntity) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_CONTEXT_MISSING",
    };
  }

  const numericMaxRangeMeters = Math.max(0, toFiniteNumber(
    maxRangeMeters,
    DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
  ));
  let nearestStation = null;
  let nearestDistanceMeters = Number.POSITIVE_INFINITY;
  for (const entity of scene.staticEntities) {
    if (!entity || entity.kind !== "station") {
      continue;
    }

    const entityDistanceMeters = distance(sourceEntity.position, entity.position);
    if (entityDistanceMeters < nearestDistanceMeters) {
      nearestStation = entity;
      nearestDistanceMeters = entityDistanceMeters;
    }
  }

  if (!nearestStation) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_NO_STATION",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
      },
    };
  }

  if (nearestDistanceMeters > numericMaxRangeMeters) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_OUT_OF_RANGE",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
        nearestDistanceMeters,
        targetID: nearestStation.itemID,
        targetName: nearestStation.itemName || `station ${nearestStation.itemID}`,
      },
    };
  }

  return {
    success: true,
    data: {
      maxRangeMeters: numericMaxRangeMeters,
      nearestDistanceMeters,
      target: nearestStation,
    },
  };
}

function getTurnMetrics(currentDirection, targetDirection) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const alignment = clamp(dotProduct(current, target), -1, 1);
  const radians = Math.acos(alignment);
  const turnFraction = Math.sqrt(Math.max(0, (alignment + 1) * 0.5));
  return {
    alignment,
    radians: Number.isFinite(radians) ? radians : 0,
    turnFraction: Number.isFinite(turnFraction) ? turnFraction : 1,
  };
}

function summarizeVector(vector) {
  return {
    x: roundNumber(vector && vector.x),
    y: roundNumber(vector && vector.y),
    z: roundNumber(vector && vector.z),
  };
}

function isMovementTraceActive(entity, now = Date.now()) {
  return Boolean(
    entity &&
      entity.movementTrace &&
      Number(entity.movementTrace.untilMs || 0) > Number(now || Date.now()),
  );
}

function getMovementTraceSnapshot(entity, now = Date.now()) {
  if (!isMovementTraceActive(entity, now)) {
    return null;
  }

  return {
    id: toInt(entity.movementTrace.id, 0),
    reason: entity.movementTrace.reason || "unknown",
    stamp: toInt(entity.movementTrace.stamp, 0),
    ageMs: Math.max(0, toInt(now, Date.now()) - toInt(entity.movementTrace.startedAtMs, 0)),
    remainingMs: Math.max(0, toInt(entity.movementTrace.untilMs, 0) - toInt(now, Date.now())),
    context: entity.movementTrace.context || null,
  };
}

function summarizePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    stopDistance: roundNumber(pendingWarp.stopDistance),
    totalDistance: roundNumber(pendingWarp.totalDistance),
    warpSpeedAU: roundNumber(pendingWarp.warpSpeedAU, 3),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
    targetPoint: summarizeVector(pendingWarp.targetPoint),
    rawDestination: summarizeVector(pendingWarp.rawDestination),
  };
}

function armMovementTrace(entity, reason, context = {}, now = Date.now()) {
  if (!entity) {
    return null;
  }

  entity.movementTrace = {
    id: nextMovementTraceID++,
    reason,
    startedAtMs: now,
    untilMs: now + MOVEMENT_TRACE_WINDOW_MS,
    stamp: getCurrentDestinyStamp(now),
    context,
  };
  return entity.movementTrace;
}

function appendMovementDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(MOVEMENT_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      MOVEMENT_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write movement debug log: ${error.message}`);
  }
}

function appendDestinyDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(DESTINY_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      DESTINY_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write destiny debug log: ${error.message}`);
  }
}

function appendWarpDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(WARP_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      WARP_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write warp debug log: ${error.message}`);
  }
}

function appendBallDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(BALL_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      BALL_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write ball debug log: ${error.message}`);
  }
}

function appendBubbleDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(BUBBLE_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      BUBBLE_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to append bubble debug log: ${error.message}`);
  }
}

function normalizeTraceValue(value, depth = 0) {
  if (depth > 4) {
    return "[depth-limit]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTraceValue(entry, depth + 1));
  }
  if (value instanceof Set) {
    return Array.from(value.values()).map((entry) =>
      normalizeTraceValue(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") {
        continue;
      }
      normalized[key] = normalizeTraceValue(entry, depth + 1);
    }
    return normalized;
  }
  return String(value);
}

function buildSessionJumpTraceSnapshot(session) {
  if (!session) {
    return null;
  }
  return normalizeTraceValue({
    clientID: session.clientID || null,
    characterID: session.characterID || null,
    characterName: session.characterName || null,
    transitionState: session._transitionState || null,
    space: session._space
      ? {
          systemID: session._space.systemID,
          shipID: session._space.shipID,
          beyonceBound: session._space.beyonceBound === true,
          initialStateSent: session._space.initialStateSent === true,
          initialBallparkVisualsSent:
            session._space.initialBallparkVisualsSent === true,
          initialBallparkClockSynced:
            session._space.initialBallparkClockSynced === true,
          deferInitialBallparkClockUntilBind:
            session._space.deferInitialBallparkClockUntilBind === true,
          deferInitialBallparkStateUntilBind:
            session._space.deferInitialBallparkStateUntilBind === true,
          timeDilation: session._space.timeDilation,
          simTimeMs: session._space.simTimeMs,
          simFileTime: session._space.simFileTime,
        }
      : null,
    nextInitialBallparkPreviousSimTimeMs:
      session._nextInitialBallparkPreviousSimTimeMs ?? null,
    nextInitialBallparkPreviousTimeDilation:
      session._nextInitialBallparkPreviousTimeDilation ?? null,
    nextInitialBallparkPreviousCapturedAtWallclockMs:
      session._nextInitialBallparkPreviousCapturedAtWallclockMs ?? null,
    skipNextInitialBallparkRebase:
      session._skipNextInitialBallparkRebase === true,
  });
}

function appendJumpTimingTrace(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(JUMP_TIMING_TRACE_PATH), { recursive: true });
    fs.appendFileSync(
      JUMP_TIMING_TRACE_PATH,
      `${JSON.stringify(normalizeTraceValue({
        loggedAt: new Date().toISOString(),
        ...entry,
      }))}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to append jump timing trace log: ${error.message}`);
  }
}

function getActiveSessionJumpTrace(session) {
  if (!session || !session._jumpTimingTrace) {
    return null;
  }
  const trace = session._jumpTimingTrace;
  const now = Date.now();
  if (Number(trace.untilMs || 0) > 0 && now > Number(trace.untilMs)) {
    session._jumpTimingTrace = null;
    return null;
  }
  return trace;
}

function beginSessionJumpTimingTrace(session, kind, details = {}) {
  if (!session) {
    return null;
  }
  const now = Date.now();
  const trace = {
    id: nextSessionJumpTraceID++,
    kind,
    startedAtMs: now,
    untilMs: now + SESSION_JUMP_TRACE_WINDOW_MS,
  };
  session._jumpTimingTrace = trace;
  appendJumpTimingTrace({
    traceID: trace.id,
    event: "trace-start",
    kind,
    atMs: now,
    details,
    session: buildSessionJumpTraceSnapshot(session),
  });
  return trace;
}

function recordSessionJumpTimingTrace(session, event, details = {}) {
  const trace = getActiveSessionJumpTrace(session);
  if (!trace) {
    return false;
  }
  appendJumpTimingTrace({
    traceID: trace.id,
    event,
    kind: trace.kind,
    atMs: Date.now(),
    details,
    session: buildSessionJumpTraceSnapshot(session),
  });
  return true;
}

function logBubbleDebug(event, details = {}) {
  appendBubbleDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    ...details,
  }));
}

function summarizeBubbleEntity(entity) {
  if (!entity) {
    return null;
  }

  return {
    itemID: toInt(entity.itemID, 0),
    name: String(entity.itemName || entity.name || ""),
    mode: String(entity.mode || ""),
    bubbleID: toInt(entity.bubbleID, 0),
    departureBubbleID: toInt(entity.departureBubbleID, 0),
    position: summarizeVector(entity.position),
    velocityMs: roundNumber(magnitude(entity.velocity || { x: 0, y: 0, z: 0 }), 3),
  };
}

function summarizeBubbleState(bubble) {
  if (!bubble) {
    return null;
  }

  return {
    id: toInt(bubble.id, 0),
    uuid: String(bubble.uuid || ""),
    center: summarizeVector(bubble.center),
    entityCount: bubble.entityIDs instanceof Set ? bubble.entityIDs.size : 0,
    entityIDs:
      bubble.entityIDs instanceof Set
        ? [...bubble.entityIDs].map((itemID) => toInt(itemID, 0))
        : [],
  };
}

function buildPerpendicular(vector) {
  const direction = normalizeVector(vector, DEFAULT_RIGHT);
  const firstPass = crossProduct(direction, DEFAULT_UP);
  if (magnitude(firstPass) > 0) {
    return normalizeVector(firstPass, DEFAULT_RIGHT);
  }

  return normalizeVector(crossProduct(direction, DEFAULT_RIGHT), DEFAULT_UP);
}

function normalizeMode(value, fallback = "STOP") {
  return VALID_MODES.has(value) ? value : fallback;
}

function allocateRuntimeEntityID(preferredItemID = null) {
  const numericPreferred = toInt(preferredItemID, 0);
  if (numericPreferred > 0) {
    nextRuntimeEntityID = Math.max(nextRuntimeEntityID, numericPreferred + 1);
    return numericPreferred;
  }

  const allocated = nextRuntimeEntityID;
  nextRuntimeEntityID += 1;
  return allocated;
}

function deriveAgilitySeconds(alignTime, maxAccelerationTime, mass = 0, inertia = 0) {
  const numericMass = toFiniteNumber(mass, 0);
  const numericInertia = toFiniteNumber(inertia, 0);
  const officialTauSeconds = (numericMass * numericInertia) / 1_000_000;
  if (officialTauSeconds > 0) {
    return Math.max(officialTauSeconds, 0.05);
  }

  const accelSeconds =
    toFiniteNumber(maxAccelerationTime, 0) / DESTINY_ACCEL_LOG_DENOMINATOR;
  if (accelSeconds > 0) {
    return Math.max(accelSeconds, 0.05);
  }

  const alignSeconds =
    toFiniteNumber(alignTime, 0) / DESTINY_ALIGN_LOG_DENOMINATOR;
  if (alignSeconds > 0) {
    return Math.max(alignSeconds, 0.05);
  }

  return 1;
}

function getCurrentAlignmentDirection(entity, fallbackDirection = DEFAULT_RIGHT) {
  const resolvedFallback = normalizeVector(
    fallbackDirection,
    normalizeVector(entity && entity.direction, DEFAULT_RIGHT),
  );
  const currentVelocity = cloneVector(entity && entity.velocity);
  const currentSpeed = magnitude(currentVelocity);
  const maxVelocity = Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
  const minimumAlignmentSpeed = Math.max(0.5, maxVelocity * 0.01);
  if (currentSpeed > minimumAlignmentSpeed) {
    return normalizeVector(currentVelocity, resolvedFallback);
  }
  return normalizeVector(entity && entity.direction, resolvedFallback);
}

function integrateVelocityTowardTarget(
  currentVelocity,
  desiredVelocity,
  responseSeconds,
  deltaSeconds,
) {
  const tau = Math.max(toFiniteNumber(responseSeconds, 0.05), 0.05);
  const delta = Math.max(toFiniteNumber(deltaSeconds, 0), 0);
  const decay = Math.exp(-(delta / tau));
  const velocityOffset = subtractVectors(currentVelocity, desiredVelocity);
  const nextVelocity = addVectors(
    desiredVelocity,
    scaleVector(velocityOffset, decay),
  );
  const positionDelta = addVectors(
    scaleVector(desiredVelocity, delta),
    scaleVector(velocityOffset, tau * (1 - decay)),
  );
  return {
    nextVelocity,
    positionDelta,
    decay,
    tau,
  };
}

function deriveTurnDegreesPerTick(agilitySeconds) {
  const normalizedAgility = Math.max(toFiniteNumber(agilitySeconds, 0.05), 0.05);
  // The old linear falloff effectively stalled capital-class turns once
  // agility drifted past ~60s. Use a bounded inverse curve instead so large
  // hulls still converge in a finite, client-like amount of time while small
  // hulls retain noticeably sharper turns.
  return clamp(75 / normalizedAgility, 0.75, 12);
}

function slerpDirection(current, target, fraction, radians) {
  const clampedFraction = clamp(fraction, 0, 1);
  if (clampedFraction <= 0) {
    return current;
  }
  if (clampedFraction >= 1) {
    return target;
  }

  const totalRadians = Math.max(toFiniteNumber(radians, 0), 0);
  const sinTotal = Math.sin(totalRadians);
  if (!Number.isFinite(sinTotal) || Math.abs(sinTotal) < 0.000001) {
    return normalizeVector(
      addVectors(
        scaleVector(current, 1 - clampedFraction),
        scaleVector(target, clampedFraction),
      ),
      target,
    );
  }

  const leftWeight =
    Math.sin((1 - clampedFraction) * totalRadians) / sinTotal;
  const rightWeight =
    Math.sin(clampedFraction * totalRadians) / sinTotal;

  return normalizeVector(
    addVectors(
      scaleVector(current, leftWeight),
      scaleVector(target, rightWeight),
    ),
    target,
  );
}

function getStationConfiguredUndockDistance(station) {
  const undockPosition = station && station.undockPosition;
  if (!station || !station.position || !undockPosition) {
    return 0;
  }

  return distance(
    cloneVector(station.position),
    cloneVector(undockPosition),
  );
}

function hasRealStationDockData(station) {
  return Boolean(
    station &&
      station.dockPosition &&
      station.dockOrientation &&
      magnitude(cloneVector(station.dockOrientation)) > 0,
  );
}

function getStationDockPosition(station) {
  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getStationApproachPosition(station) {
  return cloneVector(station && station.position);
}

function getStationWarpTargetPosition(station) {
  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getStargateInteractionRadius(stargate) {
  const configuredRadius = toFiniteNumber(
    stargate && stargate.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  // The SDE stores the physical gate radius in the `radius` field (e.g. 15 000 m
  // for a Caldari system gate).  Use it so the ball's logical sphere matches the
  // visual model, which fixes overview distance and warp-landing offsets.
  const sdeRadius = toFiniteNumber(stargate && stargate.radius, 0);
  if (sdeRadius > 0) {
    return sdeRadius;
  }

  return DEFAULT_STARGATE_INTERACTION_RADIUS;
}

function getRandomPointInSphere(radius) {
  const maxRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (maxRadius <= 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const theta = Math.random() * Math.PI * 2;
  const vertical = (Math.random() * 2) - 1;
  const distanceScale = Math.cbrt(Math.random());
  const radialDistance = maxRadius * distanceScale;
  const planarDistance = Math.sqrt(Math.max(0, 1 - (vertical * vertical))) * radialDistance;

  return {
    x: Math.cos(theta) * planarDistance,
    y: vertical * radialDistance,
    z: Math.sin(theta) * planarDistance,
  };
}

function getStargateWarpExitPoint(entity, stargate, minimumRange = 0) {
  const gateRadius = Math.max(0, toFiniteNumber(stargate && stargate.radius, 0));
  const shipRadius = Math.max(0, toFiniteNumber(entity && entity.radius, 0));
  // "Warp to 0" in EVE means 0 m from the EDGE of the object, which is
  // gateRadius meters from the center.  The DLL uses the full gateRadius
  // as the ball's collision sphere, so the ship must land outside it or the
  // elastic collision physics will punt the ship at thousands of m/s.
  const minimumOffset = gateRadius + shipRadius + 500;
  const requestedRange = Math.max(minimumOffset, toFiniteNumber(minimumRange, 0));
  const gatePosition = cloneVector(stargate && stargate.position);
  const fallbackDirection = normalizeVector(
    entity && entity.direction,
    DEFAULT_RIGHT,
  );
  const fromGateToShip = normalizeVector(
    subtractVectors(entity && entity.position, gatePosition),
    fallbackDirection,
  );

  return addVectors(
    gatePosition,
    scaleVector(fromGateToShip, requestedRange),
  );
}

function getStargateWarpLandingPoint(entity, stargate, minimumRange = 0) {
  return addVectors(
    getStargateWarpExitPoint(entity, stargate, minimumRange),
    getRandomPointInSphere(WARP_EXIT_VARIANCE_RADIUS_METERS),
  );
}

function getTargetMotionPosition(target, options = {}) {
  if (target && target.kind === "station") {
    return getStationApproachPosition(target);
  }

  return cloneVector(target && target.position);
}

function getFollowMotionProfile(entity, target) {
  return {
    targetPoint: getTargetMotionPosition(target),
    rangeRadius: Math.max(0, toFiniteNumber(target && target.radius, 0)),
  };
}

function getStationDockDirection(station) {
  if (station && station.dockOrientation) {
    return normalizeVector(station.dockOrientation, DEFAULT_RIGHT);
  }

  return normalizeVector(
    station && station.undockDirection,
    DEFAULT_RIGHT,
  );
}

function coerceDunRotationTuple(source) {
  if (!Array.isArray(source) || source.length !== 3) {
    return null;
  }

  const tuple = source.map((value) => roundNumber(value, 6));
  return tuple.every((value) => Number.isFinite(value)) ? tuple : null;
}

function getStationRenderMetadata(station, fieldName) {
  if (!station || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(station, fieldName)) {
    return station[fieldName];
  }

  const stationType = worldData.getStationTypeByID(station.stationTypeID);
  if (
    stationType &&
    Object.prototype.hasOwnProperty.call(stationType, fieldName)
  ) {
    return stationType[fieldName];
  }

  return undefined;
}

function getStationAuthoredDunRotation(station) {
  return coerceDunRotationTuple(
    getStationRenderMetadata(station, "dunRotation"),
  );
}

function coerceStageTuple(source) {
  if (!Array.isArray(source) || source.length !== 2) {
    return [0, 1];
  }

  const stage = roundNumber(source[0], 6);
  const maximum = Math.max(roundNumber(source[1], 6), 1);
  return Number.isFinite(stage) && Number.isFinite(maximum)
    ? [stage, maximum]
    : [0, 1];
}

function coerceActivationState(value, fallback = STARGATE_ACTIVATION_STATE.CLOSED) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function coerceStableActivationState(
  value,
  fallback = STARGATE_ACTIVATION_STATE.CLOSED,
) {
  const state = coerceActivationState(value, fallback);
  if (state <= STARGATE_ACTIVATION_STATE.CLOSED) {
    return STARGATE_ACTIVATION_STATE.CLOSED;
  }
  if (state === STARGATE_ACTIVATION_STATE.ACTIVATING) {
    return STARGATE_ACTIVATION_STATE.OPEN;
  }
  return state;
}

function getSolarSystemPseudoSecurity(system) {
  const security = clamp(toFiniteNumber(system && system.security, 0), 0, 1);
  if (security > 0 && security < 0.05) {
    return 0.05;
  }

  return security;
}

function getSystemSecurityClass(system) {
  const security = getSolarSystemPseudoSecurity(system);
  if (security <= 0) {
    return 0;
  }
  if (security < 0.45) {
    return 1;
  }
  return 2;
}

function getSystemOwnerID(system) {
  const factionID = toInt(system && system.factionID, 0);
  return factionID > 0 ? factionID : null;
}

function getSecurityStatusIconKey(system) {
  const securityTenths = clamp(
    Math.round(getSolarSystemPseudoSecurity(system) * 10),
    0,
    10,
  );
  const whole = Math.floor(securityTenths / 10);
  const tenths = securityTenths % 10;
  return `SEC_${whole}_${tenths}`;
}

function getDisplayedSecurityForStartupLoading(system) {
  return Math.round(getSolarSystemPseudoSecurity(system) * 10) / 10;
}

function getConfiguredStartupSystemLoadingMode() {
  const configuredMode = toInt(
    config.NewEdenSystemLoading,
    NEW_EDEN_SYSTEM_LOADING.LAZY,
  );
  if (
    configuredMode === NEW_EDEN_SYSTEM_LOADING.HIGHSEC ||
    configuredMode === NEW_EDEN_SYSTEM_LOADING.ALL
  ) {
    return configuredMode;
  }
  return NEW_EDEN_SYSTEM_LOADING.LAZY;
}

function normalizeStartupSystemIDs(systemIDs) {
  return [...new Set(
    (Array.isArray(systemIDs) ? systemIDs : [])
      .map((value) => toInt(value, 0))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
}

function resolveStartupSolarSystemPreloadPlan() {
  const mode = getConfiguredStartupSystemLoadingMode();

  if (mode === NEW_EDEN_SYSTEM_LOADING.HIGHSEC) {
    return {
      mode,
      modeName: "High-Sec Preload",
      label:
        "preloading every high-security system with displayed security 0.5+ from world data",
      selectionRule: "Displayed security >= 0.5, resolved dynamically from world data",
      targetSummary: "All high-security systems",
      systemIDs: normalizeStartupSystemIDs(
        worldData.getSolarSystems()
          .filter(
            (system) => getDisplayedSecurityForStartupLoading(system) >= 0.5,
          )
          .map((system) => system && system.solarSystemID),
      ),
    };
  }

  if (mode === NEW_EDEN_SYSTEM_LOADING.ALL) {
    return {
      mode,
      modeName: "All Systems",
      label: "preloading every solar system in New Eden",
      selectionRule: "Every solar system row is queued during startup",
      targetSummary: "All solar systems",
      systemIDs: normalizeStartupSystemIDs(
        worldData.getSolarSystems().map((system) => system && system.solarSystemID),
      ),
    };
  }

  return {
    mode: NEW_EDEN_SYSTEM_LOADING.LAZY,
    modeName: "Lazy Default",
    label: "preloading only the default startup systems (Jita and New Caldari)",
    selectionRule: "Preserves the current startup behavior",
    targetSummary: "Jita and New Caldari",
    systemIDs: [...STARTUP_PRELOADED_SYSTEM_IDS],
  };
}

function resolveStartupPreloadedSystemIDs() {
  return resolveStartupSolarSystemPreloadPlan().systemIDs;
}

function isHazardousSecurityTransition(sourceSystem, destinationSystem) {
  const sourceSecurityClass = getSystemSecurityClass(sourceSystem);
  const destinationSecurityClass = getSystemSecurityClass(destinationSystem);
  return (
    (sourceSecurityClass === 2 && destinationSecurityClass !== 2) ||
    (sourceSecurityClass === 1 && destinationSecurityClass === 0)
  );
}

function getStargateAuthoredDunRotation(stargate) {
  return coerceDunRotationTuple(stargate && stargate.dunRotation);
}

function getSharedWorldPosition(systemPosition, localPosition) {
  if (!systemPosition || !localPosition) {
    return null;
  }

  return {
    x: toFiniteNumber(systemPosition.x, 0) - toFiniteNumber(localPosition.x, 0),
    y: toFiniteNumber(systemPosition.y, 0) + toFiniteNumber(localPosition.y, 0),
    z: toFiniteNumber(systemPosition.z, 0) + toFiniteNumber(localPosition.z, 0),
  };
}

function buildDunRotationFromDirection(direction) {
  if (!direction || magnitude(direction) <= 0) {
    return null;
  }

  const forward = scaleVector(direction, 1 / magnitude(direction));
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(clamp(forward.y, -1, 1)) * (180 / Math.PI);
  return coerceDunRotationTuple([yawDegrees, pitchDegrees, 0]);
}

function getStargateDerivedDunRotation(stargate) {
  if (!stargate) {
    return null;
  }

  const sourceSystem = worldData.getSolarSystemByID(stargate.solarSystemID);
  const destinationGate = worldData.getStargateByID(stargate.destinationID);
  if (!sourceSystem || !destinationGate) {
    return null;
  }

  const destinationSystem = worldData.getSolarSystemByID(
    destinationGate.solarSystemID,
  );
  if (!destinationSystem) {
    return null;
  }

  const originGateWorldPosition = getSharedWorldPosition(
    sourceSystem.position,
    stargate.position,
  );
  const destinationGateWorldPosition = getSharedWorldPosition(
    destinationSystem.position,
    destinationGate.position,
  );
  if (!originGateWorldPosition || !destinationGateWorldPosition) {
    return null;
  }

  const forward = subtractVectors(
    destinationGateWorldPosition,
    originGateWorldPosition,
  );
  if (magnitude(forward) <= 0) {
    return null;
  }

  return buildDunRotationFromDirection(forward);
}

function getResolvedStargateDunRotation(stargate) {
  return (
    getStargateAuthoredDunRotation(stargate) ||
    getStargateDerivedDunRotation(stargate)
  );
}

function getStargateTypeMetadata(stargate, fieldName) {
  if (!stargate || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(stargate, fieldName)) {
    return stargate[fieldName];
  }

  const stargateType = worldData.getStargateTypeByID(stargate.typeID);
  if (
    stargateType &&
    Object.prototype.hasOwnProperty.call(stargateType, fieldName)
  ) {
    return stargateType[fieldName];
  }

  return undefined;
}

function getStargateStatusIcons(stargate, destinationSystem) {
  const configuredIcons = Array.isArray(stargate && stargate.destinationSystemStatusIcons)
    ? stargate.destinationSystemStatusIcons
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  if (configuredIcons.length > 0) {
    return configuredIcons;
  }

  if (!destinationSystem) {
    return [];
  }

  return [getSecurityStatusIconKey(destinationSystem)];
}

function getStargateWarningIcon(stargate, sourceSystem, destinationSystem) {
  if (stargate && stargate.destinationSystemWarningIcon) {
    return String(stargate.destinationSystemWarningIcon);
  }

  return isHazardousSecurityTransition(sourceSystem, destinationSystem)
    ? "stargate_travelwarning3.dds"
    : null;
}

function resolveShipSkinMaterialSetID(shipItem) {
  if (!shipItem) {
    return null;
  }

  return getAppliedSkinMaterialSetID(shipItem.itemID);
}

function isShipFittingFlag(flagID) {
  const numericFlagID = toInt(flagID, 0);
  return SHIP_FITTING_FLAG_RANGES.some(
    ([minimum, maximum]) =>
      numericFlagID >= minimum && numericFlagID <= maximum,
  );
}

function normalizeSlimShipModules(modules) {
  if (!Array.isArray(modules)) {
    return [];
  }

  return modules
    .map((entry) => {
      if (Array.isArray(entry)) {
        return [
          toInt(entry[0], 0),
          toInt(entry[1], 0),
          toInt(entry[2], 0),
        ];
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      return [
        toInt(entry.itemID, 0),
        toInt(entry.typeID, 0),
        toInt(entry.flagID, 0),
      ];
    })
    .filter(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 3 &&
        entry.every((value) => Number.isInteger(value) && value > 0),
    )
    .sort((left, right) => {
      if (left[2] !== right[2]) {
        return left[2] - right[2];
      }
      return left[0] - right[0];
    });
}

function getShipEntityInventoryCharacterID(entity, fallback = 0) {
  return toInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    fallback,
  );
}

function getShipEntityVisibleCharacterID(entity, fallback = 0) {
  return toInt(entity && entity.characterID, fallback);
}

function getShipEntityDebugCharacterID(entity, fallback = 0) {
  const inventoryCharacterID = getShipEntityInventoryCharacterID(entity, 0);
  if (inventoryCharacterID > 0) {
    return inventoryCharacterID;
  }
  return getShipEntityVisibleCharacterID(entity, fallback);
}

function getCharacterBackedShipPresentation(entity) {
  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID <= 0) {
    return null;
  }

  return getCharacterRecord(characterID) || null;
}

function resolveShipSlimModules(entity) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const characterID = getShipEntityInventoryCharacterID(entity, 0);
  if (characterID > 0) {
    return normalizeSlimShipModules(
      buildSlimModuleTuples(characterID, entity.itemID),
    );
  }

  return normalizeSlimShipModules(entity.modules);
}

function refreshShipConditionFields(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const shipItem = findShipItemById(entity.itemID) || null;
  const conditionState = shipItem
    ? getShipConditionState(shipItem)
    : normalizeShipConditionState(entity.conditionState);
  entity.conditionState = conditionState;
  entity.capacitorChargeRatio = clamp(
    toFiniteNumber(
      conditionState && conditionState.charge,
      toFiniteNumber(entity.capacitorChargeRatio, 1),
    ),
    0,
    1,
  );
  return entity;
}

function refreshShipPresentationFields(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const characterData = getCharacterBackedShipPresentation(entity);
  const resolvedSkinMaterialSetID = getAppliedSkinMaterialSetID(entity.itemID);
  refreshShipConditionFields(entity);
  entity.skinMaterialSetID =
    resolvedSkinMaterialSetID !== null &&
    resolvedSkinMaterialSetID !== undefined
      ? resolvedSkinMaterialSetID
      : entity.skinMaterialSetID ?? null;
  entity.modules = resolveShipSlimModules(entity);
  entity.securityStatus = toFiniteNumber(
    characterData && (characterData.securityStatus ?? characterData.securityRating),
    toFiniteNumber(entity.securityStatus, 0),
  );
  entity.bounty = toFiniteNumber(
    characterData && characterData.bounty,
    toFiniteNumber(entity.bounty, 0),
  );
  return entity;
}

function isEntityUsingAlternateSlimCategory(entity) {
  if (!entity || entity.kind !== "ship") {
    return false;
  }

  const categoryID = toInt(entity.categoryID, 0);
  const slimCategoryID = toInt(
    entity.slimCategoryID,
    categoryID,
  );
  return categoryID > 0 && slimCategoryID > 0 && slimCategoryID !== categoryID;
}

function resolveSpecialFxOptionsForEntity(shipID, options = {}, visibilityEntity = null) {
  if (!visibilityEntity || !isEntityUsingAlternateSlimCategory(visibilityEntity)) {
    return options;
  }

  const moduleID = toInt(options && options.moduleID, 0);
  if (moduleID <= 0) {
    return options;
  }

  return {
    ...options,
    // Local CCP client EntityShip hardpoints are keyed by shipID for NPC/entity
    // presentation, not by the underlying fitted module itemID.
    moduleID: toInt(shipID, toInt(visibilityEntity.itemID, moduleID)),
  };
}

function isInventoryBackedDynamicEntity(entity) {
  return Boolean(
    entity &&
    (entity.kind === "container" || entity.kind === "wreck"),
  );
}

function refreshInventoryBackedEntityPresentationFields(entity) {
  if (!isInventoryBackedDynamicEntity(entity)) {
    return entity;
  }

  const itemRecord = findItemById(entity.itemID) || null;
  if (!itemRecord) {
    return entity;
  }

  const metadata = getItemMetadata(itemRecord.typeID, itemRecord.itemName);
  const resolvedRadius = resolveRuntimeInventoryEntityRadius(
    entity.kind,
    itemRecord,
    metadata,
    toFiniteNumber(entity.radius, 1),
  );
  entity.ownerID = toInt(itemRecord.ownerID, toInt(entity.ownerID, 0));
  entity.itemName = String(itemRecord.itemName || metadata.name || entity.itemName || "Container");
  entity.typeID = toInt(itemRecord.typeID, entity.typeID);
  entity.groupID = toInt(itemRecord.groupID, entity.groupID);
  entity.categoryID = toInt(itemRecord.categoryID, entity.categoryID);
  entity.radius = resolvedRadius;
  entity.signatureRadius = resolveRuntimeInventoryEntitySignatureRadius(
    itemRecord,
    metadata,
    resolvedRadius,
  );
  entity.spaceState = itemRecord.spaceState || entity.spaceState || null;
  entity.conditionState = normalizeShipConditionState(itemRecord.conditionState);
  entity.createdAtMs = toFiniteNumber(itemRecord.createdAtMs, 0) || null;
  entity.expiresAtMs = toFiniteNumber(itemRecord.expiresAtMs, 0) || null;
  entity.isEmpty = listContainerItems(null, entity.itemID).length === 0;
  return entity;
}

function applySessionStateToShipEntity(entity, session, shipItem = null) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  const characterID = toInt(session && session.characterID, 0);
  const characterData =
    characterID > 0 ? getCharacterRecord(characterID) || null : null;

  entity.session = session || null;
  entity.persistSpaceState = true;
  entity.ownerID = toInt(
    shipItem && shipItem.ownerID,
    toInt(entity.ownerID, characterID),
  );
  entity.characterID = characterID;
  entity.pilotCharacterID = characterID;
  entity.corporationID = toInt(session && session.corporationID, 0);
  entity.allianceID = toInt(session && session.allianceID, 0);
  entity.warFactionID = toInt(session && session.warFactionID, 0);
  entity.itemName = String(
    (shipItem && shipItem.itemName) ||
      (session && session.shipName) ||
      entity.itemName ||
      "Ship",
  );
  entity.conditionState = normalizeShipConditionState(
    (shipItem && shipItem.conditionState) || entity.conditionState,
  );

  const resolvedSkinMaterialSetID = resolveShipSkinMaterialSetID(shipItem);
  entity.skinMaterialSetID =
    resolvedSkinMaterialSetID !== null &&
    resolvedSkinMaterialSetID !== undefined
      ? resolvedSkinMaterialSetID
      : entity.skinMaterialSetID ?? null;
  entity.modules = normalizeSlimShipModules(
    buildSlimModuleTuples(characterID, entity.itemID),
  );
  entity.securityStatus = toFiniteNumber(
    characterData && (characterData.securityStatus ?? characterData.securityRating),
    0,
  );
  entity.bounty = toFiniteNumber(characterData && characterData.bounty, 0);
  return entity;
}

function clearSessionStateFromShipEntity(entity) {
  if (!entity || entity.kind !== "ship") {
    return entity;
  }

  entity.session = null;
  entity.characterID = 0;
  entity.pilotCharacterID = 0;
  entity.corporationID = 0;
  entity.allianceID = 0;
  entity.warFactionID = 0;
  entity.securityStatus = 0;
  entity.bounty = 0;
  return entity;
}

function refreshEntitiesForSlimPayload(entities) {
  if (!Array.isArray(entities)) {
    return [];
  }

  for (const entity of entities) {
    refreshShipPresentationFields(entity);
    refreshInventoryBackedEntityPresentationFields(entity);
  }

  return entities;
}

function isBubbleScopedStaticEntity(entity) {
  return entity && entity.staticVisibilityScope === "bubble";
}

function getStationInteractionRadius(station) {
  const configuredVisualRadius = toFiniteNumber(station && station.radius, 0);
  if (configuredVisualRadius > 0) {
    return configuredVisualRadius;
  }

  const configuredRadius = toFiniteNumber(
    station && station.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  return DEFAULT_STATION_INTERACTION_RADIUS;
}

function getStationUndockSpawnState(station) {
  const dockDirection = normalizeVector(
    cloneVector(
      station &&
        (station.dockOrientation || station.undockDirection),
      DEFAULT_RIGHT,
    ),
    DEFAULT_RIGHT,
  );
  const storedUndockOffset = station
    ? subtractVectors(
        cloneVector(station.undockPosition, station.position),
        cloneVector(station.position),
      )
    : null;
  const direction = normalizeVector(
    magnitude(storedUndockOffset) > 0
      ? storedUndockOffset
      : dockDirection,
    DEFAULT_RIGHT,
  );
  const spawnDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + 2500,
  );

  return {
    direction,
    position: addVectors(
      cloneVector(station && station.position),
      scaleVector(direction, spawnDistance),
    ),
  };
}

function getCommandDirection(entity, fallback = DEFAULT_RIGHT) {
  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector(
      subtractVectors(entity.targetPoint, entity.position),
      entity.direction || fallback,
    );
  }

  return normalizeVector(entity && entity.direction, fallback);
}

function getShipDockingDistanceToStation(entity, station) {
  if (!entity || !station) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    distance(entity.position, station.position) -
      entity.radius -
      getStationInteractionRadius(station),
  );
}

function canShipDockAtStation(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  return getShipDockingDistanceToStation(entity, station) <= Math.max(0, toFiniteNumber(maxDistance, DEFAULT_STATION_DOCKING_RADIUS));
}

function buildDockingDebugState(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  if (!entity || !station) {
    return null;
  }

  const dockPosition = getStationDockPosition(station);
  const approachPosition = getStationApproachPosition(station);

  return {
    canDock: canShipDockAtStation(entity, station, maxDistance),
    dockingDistance: roundNumber(
      getShipDockingDistanceToStation(entity, station),
    ),
    distanceToStationCenter: roundNumber(distance(entity.position, station.position)),
    distanceToDockPoint: roundNumber(distance(entity.position, dockPosition)),
    distanceToApproachPoint: roundNumber(distance(entity.position, approachPosition)),
    dockingThreshold: roundNumber(maxDistance),
    shipRadius: roundNumber(entity.radius),
    stationRadius: roundNumber(getStationInteractionRadius(station)),
    shipPosition: summarizeVector(entity.position),
    shipVelocity: summarizeVector(entity.velocity),
    stationPosition: summarizeVector(station.position),
    approachPosition: summarizeVector(approachPosition),
    dockPosition: summarizeVector(dockPosition),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    mode: entity.mode,
    speedFraction: roundNumber(entity.speedFraction, 3),
  };
}

function snapShipToStationPerimeter(entity, station) {
  const desiredDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + entity.radius + 500,
  );
  const approachDirection = normalizeVector(
    subtractVectors(entity.position, station.position),
    cloneVector(station.undockDirection, DEFAULT_RIGHT),
  );

  entity.position = addVectors(
    cloneVector(station.position),
    scaleVector(approachDirection, desiredDistance),
  );
  entity.targetPoint = cloneVector(station.position);
}

function getLegacyStationNormalizationTarget(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.targetEntityID &&
    (entity.mode === "FOLLOW" || entity.mode === "GOTO")
  ) {
    const trackedStation = worldData.getStationByID(entity.targetEntityID);
    if (trackedStation && canShipDockAtStation(entity, trackedStation)) {
      return trackedStation;
    }
  }

  if (
    entity.mode !== "STOP" ||
    toFiniteNumber(entity.speedFraction, 0) > 0 ||
    magnitude(entity.velocity) > 1
  ) {
    return null;
  }

  let closestStation = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const station of worldData.getStationsForSystem(entity.systemID)) {
    const stationDistance = getShipDockingDistanceToStation(entity, station);
    if (stationDistance < closestDistance) {
      closestDistance = stationDistance;
      closestStation = station;
    }
  }

  return closestDistance <= LEGACY_STATION_NORMALIZATION_RADIUS ? closestStation : null;
}

function normalizeLegacyStationState(entity) {
  if (
    !entity ||
    entity.kind !== "ship"
  ) {
    return false;
  }

  const station = getLegacyStationNormalizationTarget(entity);
  if (!station) {
    return false;
  }

  snapShipToStationPerimeter(entity, station);
  return true;
}

function serializeWarpState(entity) {
  if (!entity.warpState) {
    return null;
  }

  return {
    startTimeMs: toFiniteNumber(entity.warpState.startTimeMs, Date.now()),
    durationMs: toFiniteNumber(entity.warpState.durationMs, 0),
    accelTimeMs: toFiniteNumber(entity.warpState.accelTimeMs, 0),
    cruiseTimeMs: toFiniteNumber(entity.warpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(entity.warpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(entity.warpState.totalDistance, 0),
    stopDistance: toFiniteNumber(entity.warpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(entity.warpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(entity.warpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      entity.warpState.warpDropoutSpeedMs,
      toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    ),
    accelDistance: toFiniteNumber(entity.warpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(entity.warpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(entity.warpState.decelDistance, 0),
    accelExponent: toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: toFiniteNumber(
      entity.warpState.accelRate,
      toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    ),
    decelRate: toFiniteNumber(
      entity.warpState.decelRate,
      toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    ),
    warpSpeed: toInt(entity.warpState.warpSpeed, 3000),
    commandStamp: toInt(entity.warpState.commandStamp, 0),
    startupGuidanceAtMs: toFiniteNumber(entity.warpState.startupGuidanceAtMs, 0),
    startupGuidanceStamp: toInt(entity.warpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      entity.warpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs: toFiniteNumber(entity.warpState.cruiseBumpAtMs, 0),
    cruiseBumpStamp: toInt(entity.warpState.cruiseBumpStamp, 0),
    effectAtMs: toFiniteNumber(entity.warpState.effectAtMs, 0),
    effectStamp: toInt(entity.warpState.effectStamp, 0),
    targetEntityID: toInt(entity.warpState.targetEntityID, 0),
    followID: toInt(entity.warpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      entity.warpState.followRangeMarker,
      entity.warpState.stopDistance,
    ),
    profileType: String(entity.warpState.profileType || "legacy"),
    origin: cloneVector(entity.warpState.origin, entity.position),
    rawDestination: cloneVector(entity.warpState.rawDestination, entity.position),
    targetPoint: cloneVector(entity.warpState.targetPoint, entity.position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(
      entity.warpState.pilotMaxSpeedRamp,
    ),
  };
}

function serializePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    stopDistance: toFiniteNumber(pendingWarp.stopDistance, 0),
    totalDistance: toFiniteNumber(pendingWarp.totalDistance, 0),
    warpSpeedAU: toFiniteNumber(pendingWarp.warpSpeedAU, 0),
    rawDestination: cloneVector(pendingWarp.rawDestination),
    targetPoint: cloneVector(pendingWarp.targetPoint),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
  };
}

function buildOfficialWarpReferenceProfile(
  warpDistanceMeters,
  warpSpeedAU,
  maxSubwarpSpeedMs,
) {
  const totalDistance = Math.max(toFiniteNumber(warpDistanceMeters, 0), 0);
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const resolvedSubwarpSpeedMs = Math.max(
    Math.min(toFiniteNumber(maxSubwarpSpeedMs, 0) / 2, WARP_DROPOUT_SPEED_MAX_MS),
    1,
  );
  const kAccel = resolvedWarpSpeedAU;
  const kDecel = Math.min(resolvedWarpSpeedAU / 3, 2);

  let maxWarpSpeedMs = resolvedWarpSpeedAU * ONE_AU_IN_METERS;
  let accelDistance = maxWarpSpeedMs / kAccel;
  let decelDistance = maxWarpSpeedMs / kDecel;
  const minimumDistance = accelDistance + decelDistance;
  const cruiseDistance = Math.max(totalDistance - minimumDistance, 0);
  let cruiseTimeSeconds = 0;
  let profileType = "long";

  if (minimumDistance > totalDistance) {
    profileType = "short";
    maxWarpSpeedMs =
      (totalDistance * kAccel * kDecel) /
      Math.max(kAccel + kDecel, 0.001);
    accelDistance = maxWarpSpeedMs / kAccel;
    decelDistance = maxWarpSpeedMs / kDecel;
  } else {
    cruiseTimeSeconds = cruiseDistance / maxWarpSpeedMs;
  }

  const accelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / kAccel, 1)) / kAccel;
  const decelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / resolvedSubwarpSpeedMs, 1)) / kDecel;
  const totalTimeSeconds =
    accelTimeSeconds + cruiseTimeSeconds + decelTimeSeconds;

  return {
    profileType,
    warpDistanceMeters: roundNumber(totalDistance, 3),
    warpDistanceAU: roundNumber(totalDistance / ONE_AU_IN_METERS, 6),
    warpSpeedAU: roundNumber(resolvedWarpSpeedAU, 3),
    kAccel: roundNumber(kAccel, 6),
    kDecel: roundNumber(kDecel, 6),
    warpDropoutSpeedMs: roundNumber(resolvedSubwarpSpeedMs, 3),
    maxWarpSpeedMs: roundNumber(maxWarpSpeedMs, 3),
    maxWarpSpeedAU: roundNumber(maxWarpSpeedMs / ONE_AU_IN_METERS, 6),
    accelDistance: roundNumber(accelDistance, 3),
    accelDistanceAU: roundNumber(accelDistance / ONE_AU_IN_METERS, 6),
    cruiseDistance: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0),
      3,
    ),
    cruiseDistanceAU: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0) /
        ONE_AU_IN_METERS,
      6,
    ),
    decelDistance: roundNumber(decelDistance, 3),
    decelDistanceAU: roundNumber(decelDistance / ONE_AU_IN_METERS, 6),
    minimumDistance: roundNumber(
      Math.min(minimumDistance, totalDistance),
      3,
    ),
    minimumDistanceAU: roundNumber(
      Math.min(minimumDistance, totalDistance) / ONE_AU_IN_METERS,
      6,
    ),
    accelTimeMs: roundNumber(accelTimeSeconds * 1000, 3),
    cruiseTimeMs: roundNumber(cruiseTimeSeconds * 1000, 3),
    decelTimeMs: roundNumber(decelTimeSeconds * 1000, 3),
    totalTimeMs: roundNumber(totalTimeSeconds * 1000, 3),
    ceilTotalSeconds: Math.ceil(totalTimeSeconds),
  };
}

function buildWarpProfileDelta(warpState, officialProfile) {
  if (!warpState || !officialProfile) {
    return null;
  }

  return {
    durationMs: roundNumber(
      toFiniteNumber(warpState.durationMs, 0) -
        toFiniteNumber(officialProfile.totalTimeMs, 0),
      3,
    ),
    accelTimeMs: roundNumber(
      toFiniteNumber(warpState.accelTimeMs, 0) -
        toFiniteNumber(officialProfile.accelTimeMs, 0),
      3,
    ),
    cruiseTimeMs: roundNumber(
      toFiniteNumber(warpState.cruiseTimeMs, 0) -
        toFiniteNumber(officialProfile.cruiseTimeMs, 0),
      3,
    ),
    decelTimeMs: roundNumber(
      toFiniteNumber(warpState.decelTimeMs, 0) -
        toFiniteNumber(officialProfile.decelTimeMs, 0),
      3,
    ),
    maxWarpSpeedMs: roundNumber(
      toFiniteNumber(warpState.maxWarpSpeedMs, 0) -
        toFiniteNumber(officialProfile.maxWarpSpeedMs, 0),
      3,
    ),
    accelDistance: roundNumber(
      toFiniteNumber(warpState.accelDistance, 0) -
        toFiniteNumber(officialProfile.accelDistance, 0),
      3,
    ),
    cruiseDistance: roundNumber(
      toFiniteNumber(warpState.cruiseDistance, 0) -
        toFiniteNumber(officialProfile.cruiseDistance, 0),
      3,
    ),
    decelDistance: roundNumber(
      toFiniteNumber(warpState.decelDistance, 0) -
        toFiniteNumber(officialProfile.decelDistance, 0),
      3,
    ),
  };
}

function getWarpPhaseName(warpState, elapsedMs) {
  const elapsed = Math.max(toFiniteNumber(elapsedMs, 0), 0);
  const accelTimeMs = Math.max(toFiniteNumber(warpState && warpState.accelTimeMs, 0), 0);
  const cruiseTimeMs = Math.max(toFiniteNumber(warpState && warpState.cruiseTimeMs, 0), 0);
  const durationMs = Math.max(toFiniteNumber(warpState && warpState.durationMs, 0), 0);

  if (elapsed < accelTimeMs) {
    return "accel";
  }
  if (elapsed < accelTimeMs + cruiseTimeMs) {
    return "cruise";
  }
  if (elapsed < durationMs) {
    return "decel";
  }
  return "complete";
}

function buildWarpRuntimeDiagnostics(entity, now = Date.now()) {
  if (!entity || !entity.warpState) {
    return null;
  }

  const warpState = entity.warpState;
  const elapsedMs = Math.max(
    0,
    toFiniteNumber(now, Date.now()) - toFiniteNumber(warpState.startTimeMs, now),
  );
  const progress = getWarpProgress(warpState, now);
  const positionRemainingDistance = Math.max(
    distance(entity.position, warpState.targetPoint),
    0,
  );
  const profileRemainingDistance = Math.max(
    toFiniteNumber(warpState.totalDistance, 0) - toFiniteNumber(progress.traveled, 0),
    0,
  );
  const velocityMagnitude = magnitude(entity.velocity);

  return {
    stamp: getCurrentDestinyStamp(now),
    phase: getWarpPhaseName(warpState, elapsedMs),
    elapsedMs: roundNumber(elapsedMs, 3),
    remainingMs: roundNumber(
      Math.max(toFiniteNumber(warpState.durationMs, 0) - elapsedMs, 0),
      3,
    ),
    progressComplete: Boolean(progress.complete),
    progressDistance: roundNumber(toFiniteNumber(progress.traveled, 0), 3),
    progressDistanceAU: roundNumber(
      toFiniteNumber(progress.traveled, 0) / ONE_AU_IN_METERS,
      6,
    ),
    progressRemainingDistance: roundNumber(profileRemainingDistance, 3),
    progressRemainingDistanceAU: roundNumber(
      profileRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    progressSpeedMs: roundNumber(toFiniteNumber(progress.speed, 0), 3),
    progressSpeedAU: roundNumber(
      toFiniteNumber(progress.speed, 0) / ONE_AU_IN_METERS,
      6,
    ),
    entitySpeedMs: roundNumber(velocityMagnitude, 3),
    entitySpeedAU: roundNumber(velocityMagnitude / ONE_AU_IN_METERS, 6),
    positionRemainingDistance: roundNumber(positionRemainingDistance, 3),
    positionRemainingDistanceAU: roundNumber(
      positionRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    remainingDistanceDelta: roundNumber(
      positionRemainingDistance - profileRemainingDistance,
      3,
    ),
  };
}

function logWarpDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendWarpDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    maxVelocity: roundNumber(entity.maxVelocity, 3),
    speedFraction: roundNumber(entity.speedFraction, 3),
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
    warpRuntime: buildWarpRuntimeDiagnostics(entity, now),
    ...extra,
  }));
}

function logBallDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  appendBallDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    ...destiny.debugDescribeEntityBall(entity),
    ...extra,
  }));
}

function serializeSpaceState(entity) {
  return {
    systemID: entity.systemID,
    position: cloneVector(entity.position),
    velocity: cloneVector(entity.velocity),
    direction: cloneVector(entity.direction),
    targetPoint: cloneVector(entity.targetPoint, entity.position),
    speedFraction: entity.speedFraction,
    mode: normalizeMode(entity.mode),
    targetEntityID: entity.targetEntityID || null,
    followRange: entity.followRange || 0,
    orbitDistance: entity.orbitDistance || 0,
    orbitNormal: cloneVector(entity.orbitNormal, buildPerpendicular(entity.direction)),
    orbitSign: entity.orbitSign < 0 ? -1 : 1,
    pendingWarp: serializePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
  };
}

function getActualSpeedFraction(entity) {
  if (!entity) {
    return 0;
  }

  const maxVelocity = Math.max(toFiniteNumber(entity.maxVelocity, 0), 0.001);
  return clamp(magnitude(entity.velocity) / maxVelocity, 0, 1);
}

function isReadyForDestiny(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.initialStateSent &&
      session.socket &&
      !session.socket.destroyed,
  );
}

function buildShipPrimeUpdates(entity, stampOverride = null) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const stamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  return [
    {
      stamp,
      payload: destiny.buildSetBallAgilityPayload(entity.itemID, entity.inertia),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassPayload(entity.itemID, entity.mass),
    },
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
}

function buildShipPrimeUpdatesForEntities(entities, stampOverride = null) {
  const updates = [];
  for (const entity of entities) {
    updates.push(...buildShipPrimeUpdates(entity, stampOverride));
  }
  return updates;
}

function buildPositionVelocityCorrectionUpdates(entity, options = {}) {
  const stamp = toInt(options.stamp, getMovementStamp());
  const updates = [];
  if (options.includePosition === true) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    });
  }
  updates.push({
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
  });
  return updates;
}

function buildPilotWarpCorrectionUpdates(entity, stamp) {
  return buildPositionVelocityCorrectionUpdates(entity, {
    stamp,
    includePosition: true,
  });
}

function usesActiveSubwarpWatcherCorrections(entity) {
  return Boolean(
    entity &&
      entity.mode !== "WARP" &&
      entity.pendingDock == null &&
      (entity.mode === "GOTO" ||
        entity.mode === "FOLLOW" ||
        entity.mode === "ORBIT"),
  );
}

function getWatcherCorrectionIntervalMs(entity) {
  return usesActiveSubwarpWatcherCorrections(entity)
    ? ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS
    : WATCHER_CORRECTION_INTERVAL_MS;
}

function getWatcherPositionCorrectionIntervalMs(entity) {
  return usesActiveSubwarpWatcherCorrections(entity)
    ? ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS
    : WATCHER_POSITION_CORRECTION_INTERVAL_MS;
}

function buildPilotPreWarpAddBallUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildAddBallPayload(entity.itemID, {
      mass: entity.mass,
      radius: entity.radius,
      maxSpeed: entity.maxVelocity,
      isFree: true,
      isGlobal: false,
      isMassive: false,
      isInteractive: true,
      isMoribund: false,
      position: entity.position,
      velocity: entity.velocity,
      inertia: entity.inertia,
      speedFraction: clamp(
        toFiniteNumber(entity.speedFraction, 1),
        0,
        MAX_SUBWARP_SPEED_FRACTION,
      ),
    }),
  };
}

function buildPilotPreWarpRebaselineUpdates(entity, pendingWarp, stamp) {
  // Align the rebaseline velocity to the exact warp direction so the DLL
  // sees the ball already pointing at the destination.  The server's
  // alignment check tolerates up to 6 degrees, but even a small mismatch
  // makes the DLL's WarpState=1 solver do a visible re-alignment turn.
  //
  // IMPORTANT: Do NOT send SetBallPosition here.  Moving the ball to the
  // server position changes the DLL's direction-to-target, which makes the
  // just-aligned velocity no longer match, dropping alignment progress from
  // 100% back to ~90%.  Only sync the velocity direction; the position
  // difference at subwarp speeds is negligible.
  const speed = magnitude(entity.velocity);
  let alignedVelocity = entity.velocity;
  if (speed > 0.5 && pendingWarp && pendingWarp.targetPoint) {
    const warpDir = normalizeVector(
      subtractVectors(pendingWarp.targetPoint, entity.position),
      entity.direction,
    );
    alignedVelocity = scaleVector(warpDir, speed);
  }
  return [
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(
        entity.itemID,
        alignedVelocity,
      ),
    },
  ];
}

function buildPilotWarpEgoStateRefreshUpdates(
  system,
  entity,
  stamp,
  simFileTime = currentFileTime(),
) {
  const egoEntities = [entity];
  return [
    {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, egoEntities, simFileTime),
    },
    {
      stamp,
      payload: destiny.buildSetStatePayload(
        stamp,
        system,
        entity.itemID,
        egoEntities,
        simFileTime,
      ),
    },
  ];
}

function buildPilotWarpActivationStateRefreshUpdates(
  entity,
  stamp,
  simFileTime = currentFileTime(),
) {
  return [
    {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, [entity], simFileTime),
    },
  ];
}

function getNominalWarpFactor(entity, warpState) {
  return Math.max(
    1,
    toInt(
      warpState && warpState.warpSpeed,
      Math.round(toFiniteNumber(entity && entity.warpSpeedAU, 0) * 1000),
    ),
  );
}

function getPilotWarpFactorOptionA(entity, warpState) {
  const nominalWarpFactor = getNominalWarpFactor(entity, warpState);
  if (!ENABLE_PILOT_WARP_FACTOR_OPTION_A) {
    return nominalWarpFactor;
  }
  return Math.max(
    nominalWarpFactor + 1,
    Math.round(nominalWarpFactor * PILOT_WARP_FACTOR_OPTION_A_SCALE),
  );
}

function buildWarpStartCommandUpdate(entity, stamp, warpState, options = {}) {
  const warpFactor = Math.max(
    1,
    toInt(options.warpFactor, getNominalWarpFactor(entity, warpState)),
  );
  return {
    stamp,
    payload: destiny.buildWarpToPayload(
      entity.itemID,
      // WarpTo expects the raw destination plus a separate stop distance.
      // Feeding the already stop-adjusted target point here leaves the
      // piloting client stuck in a half-initialized local warp.
      warpState.rawDestination,
      warpState.stopDistance,
      warpFactor,
    ),
  };
}

function buildWarpPrepareCommandUpdate(entity, stamp, warpState) {
  return buildWarpStartCommandUpdate(entity, stamp, warpState);
}

function getPilotWarpPeakSpeed(entity, warpState) {
  if (!warpState) {
    return Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
  }

  const peakWarpSpeedMs =
    warpState.profileType === "short"
      ? toFiniteNumber(warpState.maxWarpSpeedMs, 0)
      : toFiniteNumber(warpState.cruiseWarpSpeedMs, 0);
  return Math.max(
    peakWarpSpeedMs,
    toFiniteNumber(warpState.maxWarpSpeedMs, 0),
    toFiniteNumber(entity && entity.maxVelocity, 0),
  );
}

function buildPilotWarpMaxSpeedRamp(entity, warpState, warpStartStamp) {
  if (!warpState) {
    return [];
  }

  const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
  if (startTimeMs <= 0) {
    return [];
  }

  const ramp = [];
  let previousStamp = toInt(warpStartStamp, 0);
  const cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
    ? getPilotWarpCruiseBumpStamp(warpStartStamp, warpState)
    : 0;
  if (ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B) {
    const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
    const cruiseTimeMs = Math.max(toFiniteNumber(warpState.cruiseTimeMs, 0), 0);
    const decelAssistAtMs = Math.max(
      startTimeMs,
      (startTimeMs + accelTimeMs + cruiseTimeMs) - PILOT_WARP_SOLVER_ASSIST_LEAD_MS,
    );
    const resolvedStamp = Math.max(
      previousStamp + 1,
      getCurrentDestinyStamp(decelAssistAtMs),
    );
    const assistSpeed = Math.max(
      getPilotWarpActivationSeedSpeed(entity) * PILOT_WARP_SOLVER_ASSIST_SCALE,
      toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
    );
    if (assistSpeed > 0) {
      ramp.push({
        atMs: decelAssistAtMs,
        stamp: resolvedStamp >>> 0,
        speed: assistSpeed,
        label: "decel_assist",
      });
      previousStamp = resolvedStamp >>> 0;
    }
  }

  if (!ENABLE_PILOT_WARP_MAX_SPEED_RAMP) {
    return ramp;
  }

  const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
  const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
  if (accelTimeMs <= 0 || peakWarpSpeedMs <= 0) {
    return ramp;
  }

  for (let index = 0; index < PILOT_WARP_SPEED_RAMP_FRACTIONS.length; index += 1) {
    const phaseFraction = clamp(PILOT_WARP_SPEED_RAMP_FRACTIONS[index], 0, 1);
    const speedScale = clamp(PILOT_WARP_SPEED_RAMP_SCALES[index], 0, 0.95);
    const atMs = startTimeMs + (accelTimeMs * phaseFraction);
    const resolvedStamp = Math.max(
      previousStamp + 1,
      getCurrentDestinyStamp(atMs),
    );
    const speed = peakWarpSpeedMs * speedScale;
    if (speed <= 0) {
      continue;
    }
    // Long warps already get an explicit cruise-speed SetMaxSpeed handoff.
    // Avoid stacking a second accel-ramp SetMaxSpeed onto that exact same
    // stamp, because the live client logs show that long-warp-only duplicate
    // tick is one of the remaining native-solver mismatches.
    if (cruiseBumpStamp > 0 && resolvedStamp === cruiseBumpStamp) {
      continue;
    }
    ramp.push({
      atMs,
      stamp: resolvedStamp >>> 0,
      speed,
      label: `accel_${index + 1}`,
    });
    previousStamp = resolvedStamp >>> 0;
  }

  return ramp;
}

function getPilotWarpActivationSeedSpeed(entity) {
  return Math.max(
    toFiniteNumber(entity && entity.maxVelocity, 0) * WARP_START_ACTIVATION_SEED_SCALE,
    0,
  );
}

function buildPilotWarpSeedUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(
      entity.itemID,
      getPilotWarpActivationSeedSpeed(entity),
    ),
  };
}

function getPilotWarpActivationKickoffSpeed(entity, warpState) {
  const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
  const firstRampScale = clamp(
    PILOT_WARP_SPEED_RAMP_SCALES[0],
    0,
    0.95,
  );
  return Math.max(
    peakWarpSpeedMs * firstRampScale,
    getPilotWarpActivationSeedSpeed(entity),
    toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
  );
}

function buildPilotWarpActivationKickoffUpdate(entity, stamp, warpState) {
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(
      entity.itemID,
      getPilotWarpActivationKickoffSpeed(entity, warpState),
    ),
  };
}

function buildEntityWarpInUpdate(entity, stamp, warpState) {
  const warpFactor = Math.max(
    1,
    toInt(getNominalWarpFactor(entity, warpState), 30),
  );
  return {
    stamp,
    // Use stop-adjusted targetPoint since EntityWarpIn has no separate
    // stopDistance parameter (DLL internally hardcodes stopDistance to 0).
    payload: destiny.buildEntityWarpInPayload(
      entity.itemID,
      warpState.targetPoint,
      warpFactor,
    ),
  };
}

function getPilotWarpNativeActivationSpeedFloor(entity) {
  return Math.max(
    (toFiniteNumber(entity && entity.maxVelocity, 0) *
      WARP_NATIVE_ACTIVATION_SPEED_FRACTION) +
      WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
    WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
  );
}

function buildWarpActivationVelocityUpdate(entity, stamp, warpState) {
  const currentVelocity = cloneVector(entity && entity.velocity);
  const currentSpeed = magnitude(currentVelocity);
  const activationSpeedFloor = getPilotWarpNativeActivationSpeedFloor(entity);
  let resolvedVelocity = currentVelocity;

  if (currentSpeed + 0.0001 < activationSpeedFloor) {
    const targetPoint = cloneVector(
      warpState && warpState.targetPoint,
      entity && entity.targetPoint,
    );
    const direction = normalizeVector(
      subtractVectors(targetPoint, cloneVector(entity && entity.position)),
      cloneVector(entity && entity.direction, DEFAULT_RIGHT),
    );
    resolvedVelocity = scaleVector(direction, activationSpeedFloor);
  }

  if (magnitude(resolvedVelocity) <= 0.5) {
    return null;
  }
  return {
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, resolvedVelocity),
  };
}

function buildWarpStartVelocityCarryoverUpdate(entity, stamp, warpState) {
  const startupGuidanceVelocity = cloneVector(
    warpState && warpState.startupGuidanceVelocity,
    { x: 0, y: 0, z: 0 },
  );
  if (magnitude(startupGuidanceVelocity) <= 0.5) {
    return null;
  }
  return {
    stamp,
    payload: destiny.buildSetBallVelocityPayload(
      entity.itemID,
      startupGuidanceVelocity,
    ),
  };
}

function shouldSchedulePilotWarpCruiseBump(warpState) {
  return (
    ENABLE_PILOT_WARP_MAX_SPEED_RAMP &&
    toFiniteNumber(warpState && warpState.cruiseDistance, 0) > 0 &&
    toFiniteNumber(warpState && warpState.cruiseWarpSpeedMs, 0) > 0
  );
}

function getPilotWarpStartupGuidanceAtMs(warpState) {
  if (!warpState) {
    return 0;
  }
  const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
  if (startTimeMs <= 0) {
    return 0;
  }
  return startTimeMs + DESTINY_STAMP_INTERVAL_MS;
}

function getPilotWarpStartupGuidanceStamp(warpStartStamp, warpState) {
  const scheduledStamp = getCurrentDestinyStamp(
    getPilotWarpStartupGuidanceAtMs(warpState),
  );
  return (Math.max(toInt(warpStartStamp, 0) + 1, scheduledStamp) & 0x7fffffff) >>> 0;
}

function getPilotWarpCruiseBumpAtMs(warpState) {
  const startTimeMs = toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
  const accelTimeMs = Math.max(
    toFiniteNumber(warpState && warpState.accelTimeMs, 0),
    0,
  );
  const accelEndAtMs = startTimeMs + accelTimeMs;
  const startupGuidanceAtMs = getPilotWarpStartupGuidanceAtMs(warpState);
  return Math.max(
    accelEndAtMs,
    startupGuidanceAtMs + DESTINY_STAMP_INTERVAL_MS,
  );
}

function getPilotWarpEffectAtMs(warpState) {
  // The client's active warp loop is keyed off ball.effectStamp > 0. Delaying
  // the pilot effect until the end of accel leaves the ego ball entering
  // "active warp" late and consistently stalling far behind the server curve.
  return toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
}

function getPilotWarpCruiseBumpStamp(warpStartStamp, warpState) {
  return getCurrentDestinyStamp(getPilotWarpCruiseBumpAtMs(warpState));
}

function getPilotWarpEffectStamp(warpStartStamp, warpState) {
  return warpStartStamp;
}

function buildWarpCruiseMaxSpeedUpdate(entity, stamp, warpState) {
  const cruiseWarpSpeedMs = Math.max(
    toFiniteNumber(warpState && warpState.cruiseWarpSpeedMs, 0),
    toFiniteNumber(entity && entity.maxVelocity, 0),
  );
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(entity.itemID, cruiseWarpSpeedMs),
  };
}

function getWarpAccelRate(warpSpeedAU) {
  return Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
}

function getWarpDecelRate(warpSpeedAU) {
  return clamp(getWarpAccelRate(warpSpeedAU) / 3, 0.001, WARP_DECEL_RATE_MAX);
}

function getWarpDropoutSpeedMs(entity) {
  return Math.max(
    Math.min(
      toFiniteNumber(entity && entity.maxVelocity, 0) / 2,
      WARP_DROPOUT_SPEED_MAX_MS,
    ),
    1,
  );
}

function getWarpCompletionDistance(warpState) {
  const stopDistance = Math.max(
    toFiniteNumber(warpState && warpState.stopDistance, 0),
    0,
  );
  return clamp(
    stopDistance * WARP_COMPLETION_DISTANCE_RATIO,
    WARP_COMPLETION_DISTANCE_MIN_METERS,
    WARP_COMPLETION_DISTANCE_MAX_METERS,
  );
}

function buildWarpStartEffectUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildOnSpecialFXPayload(entity.itemID, "effects.Warping", {
      active: false,
    }),
  };
}

function buildWarpPrepareDispatch(entity, stamp, warpState) {
  const sharedUpdates = [
    buildWarpPrepareCommandUpdate(entity, stamp, warpState),
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 1),
    },
  ];
  const pilotPrepareUpdates = [
    buildPilotWarpSeedUpdate(entity, stamp),
    sharedUpdates[0],
    // Seed the pilot-local tunnel FX and destination label in the SAME
    // prepare packet as WarpTo. Sending it later during WarpState=1 causes
    // the mid-alignment rebase/regression, but omitting it entirely leaves
    // the UI stuck on the generic "warp tunnel destination" fallback.
    buildWarpStartEffectUpdate(entity, stamp),
    sharedUpdates[1],
  ];

  return {
    sharedUpdates,
    pilotUpdates: pilotPrepareUpdates,
  };
}

function buildPilotWarpActivationUpdates(entity, stamp, warpState) {
  // The pilot-local warp FX/real destination label are now seeded in the
  // initial prepare dispatch, so this activation phase intentionally stays
  // empty to avoid another state-history rebase during WarpState=1.
  // Return NOTHING for the pilot.  Any DoDestinyUpdate arriving between the
  // WarpTo prepare dispatch and the DLL's own WarpState=2 transition causes
  // a state-history rebase that disrupts alignment progress (the
  // "establishing warp vector" bar drops from 100% to ~90%).  This happens
  // even with a single merged packet — OnSpecialFX itself perturbs the
  // DLL's WarpState=1 solver (it fires the warp tunnel visual which changes
  // the client's IndicateWarp label and the SpaceObject's internal state).
  //
  // The DLL transitions WarpState 1→2 entirely on its own once the ball
  // passes the alignment + speed thresholds.  The warp tunnel visual is
  // triggered by the DLL's own WarpState=2 transition (IsWarping = True).
  // OnSpecialFX is only needed for WATCHERS who see the ship warp from
  // outside — the pilot's own effects are driven by the DLL state machine.
  return [];
}

function buildWarpCompletionUpdates(entity, stamp) {
  // Send a tiny velocity in the warp direction (entity.direction) instead of
  // zero so the DLL retains the warp heading through the Stop transition.
  // Sending (0,0,0) removes the velocity-derived heading, causing the DLL to
  // snap to a pre-warp orientation once the ball exits warp mode.
  const dir = normalizeVector(entity.direction, { x: 0, y: 0, z: 1 });
  const headingVelocity = scaleVector(dir, 0.01);
  return [
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
    },
    {
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    },
    {
      stamp,
      payload: destiny.buildStopPayload(entity.itemID),
    },
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, headingVelocity),
    },
  ];
}

function buildPilotWarpCompletionUpdates(entity, stamp) {
  return [
    ...buildWarpCompletionUpdates(entity, stamp),
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
  ];
}

function buildWarpStartUpdates(entity, warpState, stampOverride = null, options = {}) {
  const stamp =
    stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  const updates = [
    buildWarpStartCommandUpdate(entity, stamp, warpState),
    buildWarpStartEffectUpdate(entity, stamp),
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
  if (options.includeEntityWarpIn !== false) {
    updates.splice(1, 0, buildEntityWarpInUpdate(entity, stamp, warpState));
  }
  if (magnitude(entity.velocity) > 0.5) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
    });
  }
  return updates;
}

function buildWarpInFlightAcquireUpdates(entity, warpState, stampOverride = null) {
  const stamp =
    stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  // Observers who first acquire a ship that is already in active warp need the
  // mid-warp acquisition contract, not the original departure contract. Replaying
  // WarpTo here leaves the retail client with a malformed/invisible ball for
  // sessionless Crimewatch responders even though the server-side ship exists.
  return [
    buildEntityWarpInUpdate(entity, stamp, warpState),
    buildWarpStartEffectUpdate(entity, stamp),
  ];
}

function summarizeDestinyArgs(name, args) {
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
      ];
    case "SetSpeedFraction":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1]), 3),
      ];
    case "FollowBall":
    case "Orbit":
      return [
        toInt(args && args[0], 0),
        toInt(args && args[1], 0),
        roundNumber(args && args[2]),
      ];
    case "Stop":
      return [toInt(args && args[0], 0)];
    case "WarpTo":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        roundNumber(unwrapMarshalNumber(args && args[4])),
        toInt(args && args[5], 0),
      ];
    case "AddBall":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        toInt(args && args[4], 0),
        toInt(args && args[5], 0),
        toInt(args && args[6], 0),
        toInt(args && args[7], 0),
        toInt(args && args[8], 0),
        roundNumber(unwrapMarshalNumber(args && args[9])),
        roundNumber(unwrapMarshalNumber(args && args[10])),
        roundNumber(unwrapMarshalNumber(args && args[11])),
        roundNumber(unwrapMarshalNumber(args && args[12])),
        roundNumber(unwrapMarshalNumber(args && args[13])),
        roundNumber(unwrapMarshalNumber(args && args[14])),
        roundNumber(unwrapMarshalNumber(args && args[15]), 3),
        roundNumber(unwrapMarshalNumber(args && args[16]), 3),
      ];
    case "AddBalls2":
      return ["omitted"];
    case "SetState":
      return ["omitted"];
    default:
      return args;
  }
}

function getPayloadPrimaryEntityID(payload) {
  if (!Array.isArray(payload) || payload.length < 2) {
    return 0;
  }
  const [name, args] = payload;
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
    case "SetSpeedFraction":
    case "FollowBall":
    case "Orbit":
    case "Stop":
    case "WarpTo":
    case "EntityWarpIn":
    case "OnSpecialFX":
    case "SetBallMassive":
    case "SetMaxSpeed":
    case "SetBallMass":
    case "SetBallAgility":
      return toInt(args && args[0], 0);
    default:
      return 0;
  }
}

function logDestinyDispatch(session, payloads, waitForBubble) {
  if (!session || payloads.length === 0) {
    return;
  }

  const dispatchDestinyStamp = getCurrentDestinyStamp();
  const stampLeads = payloads.map((update) => (
    toInt(update && update.stamp, 0) - dispatchDestinyStamp
  ));
  appendDestinyDebug(JSON.stringify({
    event: "destiny.send",
    charID: session.characterID || 0,
    shipID: session._space ? session._space.shipID || 0 : 0,
    systemID: session._space ? session._space.systemID || 0 : 0,
    waitForBubble: Boolean(waitForBubble),
    dispatchDestinyStamp,
    maxLeadFromDispatch: stampLeads.length > 0 ? Math.max(...stampLeads) : 0,
    updates: payloads.map((update) => ({
      stamp: toInt(update && update.stamp, 0),
      leadFromDispatch: toInt(update && update.stamp, 0) - dispatchDestinyStamp,
      name: update && update.payload ? update.payload[0] : null,
      args: summarizeDestinyArgs(
        update && update.payload ? update.payload[0] : null,
        update && update.payload ? update.payload[1] : null,
      ),
    })),
  }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function sessionMatchesIdentity(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const leftClientID = Number(left.clientID ?? left.clientId ?? 0);
  const rightClientID = Number(right.clientID ?? right.clientId ?? 0);
  return leftClientID > 0 && rightClientID > 0 && leftClientID === rightClientID;
}

function clearPendingDock(entity) {
  if (entity) {
    entity.pendingDock = null;
  }
}

function logMovementDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendMovementDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: getShipEntityDebugCharacterID(entity, 0),
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    speedFraction: roundNumber(entity.speedFraction, 3),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetPoint: summarizeVector(entity.targetPoint),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    speed: roundNumber(magnitude(entity.velocity), 3),
    turn: entity.lastTurnMetrics || null,
    motion: entity.lastMotionDebug || null,
    trace: getMovementTraceSnapshot(entity, now),
    ...extra,
  }));
}

function buildStaticStationEntity(station) {
  const dunRotation = getStationAuthoredDunRotation(station);
  return {
    kind: "station",
    itemID: station.stationID,
    typeID: station.stationTypeID,
    groupID: station.groupID,
    categoryID: station.categoryID,
    itemName: station.stationName,
    ownerID: station.corporationID || 1,
    corporationID: station.corporationID || 0,
    allianceID: 0,
    warFactionID: 0,
    radius: getStationInteractionRadius(station),
    position: cloneVector(station.position),
    dockPosition: station.dockPosition
      ? cloneVector(station.dockPosition)
      : null,
    dockOrientation: station.dockOrientation
      ? normalizeVector(station.dockOrientation, station.undockDirection || DEFAULT_RIGHT)
      : normalizeVector(station.undockDirection, DEFAULT_RIGHT),
    dunRotation,
    activityLevel: getStationRenderMetadata(station, "activityLevel") ?? null,
    skinMaterialSetID: getStationRenderMetadata(station, "skinMaterialSetID") ?? null,
    celestialEffect: getStationRenderMetadata(station, "celestialEffect") ?? null,
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticCelestialEntity(celestial) {
  return {
    kind: celestial.kind || "celestial",
    itemID: celestial.itemID,
    typeID: celestial.typeID,
    groupID: celestial.groupID,
    categoryID: celestial.categoryID,
    itemName: celestial.itemName,
    ownerID: 1,
    radius: celestial.radius || (celestial.groupID === 10 ? 15000 : 1000),
    position: cloneVector(celestial.position),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticStargateEntity(stargate) {
  const sourceSystem = worldData.getSolarSystemByID(stargate && stargate.solarSystemID);
  const destinationSystem = worldData.getSolarSystemByID(
    stargate && stargate.destinationSolarSystemID,
  );
  const originSystemOwnerID = getSystemOwnerID(sourceSystem);
  const destinationSystemOwnerID = getSystemOwnerID(destinationSystem);
  const destinationSystemStatusIcons = getStargateStatusIcons(
    stargate,
    destinationSystem,
  );
  const destinationSystemWarningIcon = getStargateWarningIcon(
    stargate,
    sourceSystem,
    destinationSystem,
  );
  const dunRotation = getResolvedStargateDunRotation(stargate);
  const groupID = toInt(getStargateTypeMetadata(stargate, "groupID"), 10);
  const categoryID = toInt(getStargateTypeMetadata(stargate, "categoryID"), 2);

  return {
    kind: "stargate",
    itemID: stargate.itemID,
    typeID: stargate.typeID,
    groupID,
    categoryID,
    itemName: stargate.itemName,
    ownerID: originSystemOwnerID || 1,
    radius: getStargateInteractionRadius(stargate),
    position: cloneVector(stargate.position),
    velocity: { x: 0, y: 0, z: 0 },
    typeName: getStargateTypeMetadata(stargate, "typeName") || null,
    groupName: getStargateTypeMetadata(stargate, "groupName") || null,
    graphicID: toInt(getStargateTypeMetadata(stargate, "graphicID"), 0) || null,
    raceID: toInt(getStargateTypeMetadata(stargate, "raceID"), 0) || null,
    destinationID: stargate.destinationID,
    destinationSolarSystemID: stargate.destinationSolarSystemID,
    activationState: coerceStableActivationState(
      stargate.activationState,
      STARGATE_ACTIVATION_STATE.OPEN,
    ),
    activationTransitionAtMs: 0,
    poseID: toInt(stargate.poseID, 0),
    localCorruptionStageAndMaximum: coerceStageTuple(
      stargate.localCorruptionStageAndMaximum,
    ),
    destinationCorruptionStageAndMaximum: coerceStageTuple(
      stargate.destinationCorruptionStageAndMaximum,
    ),
    localSuppressionStageAndMaximum: coerceStageTuple(
      stargate.localSuppressionStageAndMaximum,
    ),
    destinationSuppressionStageAndMaximum: coerceStageTuple(
      stargate.destinationSuppressionStageAndMaximum,
    ),
    hasVolumetricDrifterCloud: Boolean(stargate.hasVolumetricDrifterCloud),
    originSystemOwnerID,
    destinationSystemOwnerID,
    destinationSystemWarning: destinationSystemWarningIcon,
    destinationSystemWarningIcon,
    destinationSystemStatusIcons,
    dunRotation,
  };
}

function buildWarpState(rawWarpState, position, warpSpeedAU) {
  if (!rawWarpState || typeof rawWarpState !== "object") {
    return null;
  }
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const startTimeMs = toFiniteNumber(rawWarpState.startTimeMs, Date.now());
  const accelTimeMs = toFiniteNumber(rawWarpState.accelTimeMs, 0);
  const startupGuidanceAtMs = toFiniteNumber(
    rawWarpState.startupGuidanceAtMs,
    0,
  );
  const cruiseBumpAtMs = toFiniteNumber(
    rawWarpState.cruiseBumpAtMs,
    startTimeMs + Math.max(accelTimeMs, 0),
  );
  const effectAtMs = toFiniteNumber(
    rawWarpState.effectAtMs,
    startTimeMs,
  );

  return {
    startTimeMs,
    durationMs: toFiniteNumber(rawWarpState.durationMs, 0),
    accelTimeMs,
    cruiseTimeMs: toFiniteNumber(rawWarpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(rawWarpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(rawWarpState.totalDistance, 0),
    stopDistance: toFiniteNumber(rawWarpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(rawWarpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(rawWarpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(rawWarpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      rawWarpState.warpDropoutSpeedMs,
      toFiniteNumber(rawWarpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
    ),
    accelDistance: toFiniteNumber(rawWarpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(rawWarpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(rawWarpState.decelDistance, 0),
    accelExponent: toFiniteNumber(rawWarpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(rawWarpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: Math.max(
      toFiniteNumber(rawWarpState.accelRate, 0) ||
        toFiniteNumber(rawWarpState.accelExponent, 0) ||
        getWarpAccelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    decelRate: Math.max(
      toFiniteNumber(rawWarpState.decelRate, 0) ||
        toFiniteNumber(rawWarpState.decelExponent, 0) ||
        getWarpDecelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    warpSpeed: toInt(rawWarpState.warpSpeed, Math.round(warpSpeedAU * 1000)),
    commandStamp: toInt(rawWarpState.commandStamp, 0),
    startupGuidanceAtMs,
    startupGuidanceStamp: toInt(rawWarpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      rawWarpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs,
    cruiseBumpStamp: toInt(rawWarpState.cruiseBumpStamp, 0),
    effectAtMs,
    effectStamp: toInt(rawWarpState.effectStamp, 0),
    targetEntityID: toInt(rawWarpState.targetEntityID, 0),
    followID: toInt(rawWarpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      rawWarpState.followRangeMarker,
      rawWarpState.stopDistance,
    ),
    profileType: String(rawWarpState.profileType || "legacy"),
    origin: cloneVector(rawWarpState.origin, position),
    rawDestination: cloneVector(rawWarpState.rawDestination, position),
    targetPoint: cloneVector(rawWarpState.targetPoint, position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(rawWarpState.pilotMaxSpeedRamp),
  };
}

function buildShipSpaceState(source = {}) {
  if (source && typeof source.spaceState === "object" && source.spaceState !== null) {
    return source.spaceState;
  }

  return {
    position: cloneVector(source.position),
    velocity: cloneVector(source.velocity),
    direction: cloneVector(source.direction, DEFAULT_RIGHT),
    targetPoint: source.targetPoint ? cloneVector(source.targetPoint) : undefined,
    speedFraction: source.speedFraction,
    mode: source.mode,
    targetEntityID: source.targetEntityID,
    followRange: source.followRange,
    orbitDistance: source.orbitDistance,
    orbitNormal: source.orbitNormal ? cloneVector(source.orbitNormal) : undefined,
    orbitSign: source.orbitSign,
    pendingWarp: source.pendingWarp,
    warpState: source.warpState,
  };
}

function calculateAlignTimeSecondsFromMassInertia(mass, inertia, fallback = 0) {
  const numericMass = toFiniteNumber(mass, 0);
  const numericInertia = toFiniteNumber(inertia, 0);
  if (numericMass > 0 && numericInertia > 0) {
    return (DESTINY_ALIGN_LOG_DENOMINATOR * numericMass * numericInertia) / 1_000_000;
  }
  return toFiniteNumber(fallback, 0);
}

function buildPassiveShipResourceState(characterID, shipItem, options = {}) {
  if (!shipItem || !shipItem.typeID) {
    return null;
  }

  const numericCharacterID = toInt(characterID, 0);
  if (numericCharacterID <= 0) {
    // Sessionless runtime ships such as `/fire` dummies still need a real
    // dogma-derived health envelope so targeting, damage, death, and damage
    // state updates all follow the same authoritative combat path.
    return buildShipResourceState(0, shipItem, {
      fittedItems: Array.isArray(options.fittedItems) ? options.fittedItems : [],
      skillMap: options.skillMap instanceof Map ? options.skillMap : new Map(),
    });
  }

  if (!shipItem.itemID) {
    return null;
  }

  return buildShipResourceState(numericCharacterID, shipItem, options);
}

function getSkillLevel(skillMap, skillTypeID) {
  const skill = skillMap instanceof Map ? skillMap.get(skillTypeID) : null;
  if (!skill) {
    return 0;
  }

  return Math.max(
    0,
    toInt(
      skill.effectiveSkillLevel ??
        skill.trainedSkillLevel ??
        skill.skillLevel,
      0,
    ),
  );
}

function getPropulsionModuleRuntimeAttributes(characterID, moduleItem) {
  if (!moduleItem || !moduleItem.typeID) {
    return null;
  }

  const skillMap = getCharacterSkillMap(toInt(characterID, 0));
  const groupID = toInt(moduleItem.groupID, 0);
  const speedFactorBase = toFiniteNumber(
    getTypeAttributeValue(moduleItem.typeID, "speedFactor"),
    0,
  );
  const capNeedBase = toFiniteNumber(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_CAPACITOR_NEED),
    0,
  );
  const durationMs = Math.max(
    1,
    toFiniteNumber(getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_DURATION), 10000),
  );
  const accelerationControlLevel = getSkillLevel(
    skillMap,
    PROPULSION_SKILL_ACCELERATION_CONTROL,
  );
  let speedFactor = speedFactorBase * (1 + ((5 * accelerationControlLevel) / 100));
  let capNeed = capNeedBase;

  if (groupID === 46) {
    const fuelConservationLevel = getSkillLevel(
      skillMap,
      PROPULSION_SKILL_FUEL_CONSERVATION,
    );
    capNeed *= 1 + ((-10 * fuelConservationLevel) / 100);
  } else if (groupID === 475) {
    const highSpeedLevel = getSkillLevel(
      skillMap,
      PROPULSION_SKILL_HIGH_SPEED_MANEUVERING,
    );
    capNeed *= 1 + ((-5 * highSpeedLevel) / 100);
  }

  return {
    capNeed: Math.max(0, roundNumber(capNeed, 6)),
    durationMs: Math.max(1, roundNumber(durationMs, 3)),
    speedFactor: roundNumber(speedFactor, 6),
    speedBoostFactor: toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR),
      0,
    ),
    massAddition: toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_MASS_ADDITION),
      0,
    ),
    signatureRadiusBonus: toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS),
      0,
    ),
    maxGroupActive: toInt(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE),
      0,
    ),
    maxVelocityActivationLimit: toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT),
      0,
    ),
    reactivationDelayMs: Math.max(
      0,
      toFiniteNumber(
        getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_REACTIVATION_DELAY),
        0,
      ),
    ),
  };
}

function getTypeDogmaAttributeValueByID(typeID, attributeID, fallback = null) {
  const attributeValue = getTypeAttributeValue(typeID, getAttributeNameByID(attributeID));
  if (attributeValue !== null && attributeValue !== undefined) {
    return attributeValue;
  }
  const attributes = getTypeDogmaAttributes(typeID);
  const rawValue = attributes && attributes[String(attributeID)];
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getAttributeNameByID(attributeID) {
  switch (toInt(attributeID, 0)) {
    case MODULE_ATTRIBUTE_SPEED_FACTOR:
      return "speedFactor";
    case MODULE_ATTRIBUTE_DURATION:
      return "duration";
    case MODULE_ATTRIBUTE_SIGNATURE_RADIUS_BONUS:
      return "signatureRadiusBonus";
    case MODULE_ATTRIBUTE_SPEED_BOOST_FACTOR:
      return "speedBoostFactor";
    case MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE:
      return "maxGroupActive";
    case MODULE_ATTRIBUTE_MASS_ADDITION:
      return "massAddition";
    case MODULE_ATTRIBUTE_REACTIVATION_DELAY:
      return "moduleReactivationDelay";
    case MODULE_ATTRIBUTE_MAX_VELOCITY_ACTIVATION_LIMIT:
      return "maxVelocityActivationLimit";
    default:
      return "";
  }
}

function applyPassiveResourceStateToEntity(entity, resourceState, options = {}) {
  if (!entity || !resourceState) {
    return entity;
  }

  const movement =
    worldData.getMovementAttributesForType(entity.typeID) || null;
  const nextMass =
    toFiniteNumber(resourceState.mass, 0) > 0
      ? toFiniteNumber(resourceState.mass, 0)
      : toFiniteNumber(entity.mass, 0);
  const nextInertia =
    toFiniteNumber(resourceState.agility, 0) > 0
      ? toFiniteNumber(resourceState.agility, 0)
      : toFiniteNumber(entity.inertia, 0);
  const fallbackAlignTime =
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : toFiniteNumber(entity.alignTime, 0);

  entity.passiveDerivedState = resourceState;
  entity.mass = nextMass > 0 ? nextMass : entity.mass;
  entity.inertia = nextInertia > 0 ? nextInertia : entity.inertia;
  entity.maxVelocity =
    toFiniteNumber(resourceState.maxVelocity, 0) > 0
      ? toFiniteNumber(resourceState.maxVelocity, 0)
      : entity.maxVelocity;
  entity.maxTargetRange = toFiniteNumber(
    resourceState.maxTargetRange,
    toFiniteNumber(entity.maxTargetRange, 0),
  );
  entity.maxLockedTargets = toFiniteNumber(
    resourceState.maxLockedTargets,
    toFiniteNumber(entity.maxLockedTargets, 0),
  );
  entity.signatureRadius = toFiniteNumber(
    resourceState.signatureRadius,
    toFiniteNumber(entity.signatureRadius, 0),
  );
  entity.cloakingTargetingDelay = toFiniteNumber(
    resourceState.cloakingTargetingDelay,
    toFiniteNumber(entity.cloakingTargetingDelay, 0),
  );
  entity.scanResolution = toFiniteNumber(
    resourceState.scanResolution,
    toFiniteNumber(entity.scanResolution, 0),
  );
  entity.capacitorCapacity = toFiniteNumber(
    resourceState.capacitorCapacity,
    toFiniteNumber(entity.capacitorCapacity, 0),
  );
  entity.capacitorRechargeRate = toFiniteNumber(
    resourceState.capacitorRechargeRate,
    toFiniteNumber(entity.capacitorRechargeRate, 0),
  );
  entity.shieldCapacity = toFiniteNumber(
    resourceState.shieldCapacity,
    toFiniteNumber(entity.shieldCapacity, 0),
  );
  entity.shieldRechargeRate = toFiniteNumber(
    resourceState.shieldRechargeRate,
    toFiniteNumber(entity.shieldRechargeRate, 0),
  );
  entity.armorHP = toFiniteNumber(
    resourceState.armorHP,
    toFiniteNumber(entity.armorHP, 0),
  );
  entity.structureHP = toFiniteNumber(
    resourceState.structureHP,
    toFiniteNumber(entity.structureHP, 0),
  );
  entity.alignTime = calculateAlignTimeSecondsFromMassInertia(
    entity.mass,
    entity.inertia,
    fallbackAlignTime,
  );
  entity.agilitySeconds = deriveAgilitySeconds(
    entity.alignTime,
    entity.maxAccelerationTime,
    entity.mass,
    entity.inertia,
  );
  if (options.recalculateSpeedFraction === true) {
    entity.speedFraction = getActualSpeedFraction(entity);
  }
  return entity;
}

function ensureEntityTargetingState(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  if (!(entity.lockedTargets instanceof Map)) {
    entity.lockedTargets = new Map();
  }
  if (!(entity.pendingTargetLocks instanceof Map)) {
    entity.pendingTargetLocks = new Map();
  }
  if (!(entity.targetedBy instanceof Set)) {
    entity.targetedBy = new Set();
  }
  return entity;
}

function getEntityTargetingRadius(entity) {
  return Math.max(0, toFiniteNumber(entity && entity.radius, 0));
}

function getEntityLockSignatureRadius(entity) {
  const signatureRadius = toFiniteNumber(entity && entity.signatureRadius, NaN);
  if (Number.isFinite(signatureRadius) && signatureRadius > 0) {
    return signatureRadius;
  }

  const fallbackRadius = getEntityTargetingRadius(entity);
  return fallbackRadius > 0 ? fallbackRadius : 1;
}

function getEntitySurfaceDistance(sourceEntity, targetEntity) {
  if (!sourceEntity || !targetEntity) {
    return Infinity;
  }

  return Math.max(
    0,
    distance(sourceEntity.position, targetEntity.position) -
      getEntityTargetingRadius(sourceEntity) -
      getEntityTargetingRadius(targetEntity),
  );
}

function clampTargetLockDurationMs(value) {
  const numericValue = toFiniteNumber(value, TARGETING_CLIENT_FALLBACK_LOCK_MS);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  return Math.min(Math.max(numericValue, 1), TARGETING_MAX_LOCK_MS);
}

function computeTargetLockDurationMs(sourceEntity, targetEntity) {
  const scanResolution = Math.max(
    toFiniteNumber(sourceEntity && sourceEntity.scanResolution, 0),
    0,
  );
  const signatureRadius = Math.max(getEntityLockSignatureRadius(targetEntity), 1);
  if (scanResolution <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  const logTerm = Math.log(
    signatureRadius + Math.sqrt(signatureRadius * signatureRadius + 1),
  );
  if (!Number.isFinite(logTerm) || logTerm <= 0) {
    return TARGETING_CLIENT_FALLBACK_LOCK_MS;
  }

  return clampTargetLockDurationMs(
    (40000000.0 / scanResolution) / (logTerm ** 2),
  );
}

function buildEntityTargetingAttributeSnapshot(entity) {
  return {
    maxTargetRange: roundNumber(toFiniteNumber(entity && entity.maxTargetRange, 0), 6),
    maxLockedTargets: roundNumber(toFiniteNumber(entity && entity.maxLockedTargets, 0), 6),
    signatureRadius: roundNumber(toFiniteNumber(entity && entity.signatureRadius, 0), 6),
    cloakingTargetingDelay: roundNumber(
      toFiniteNumber(entity && entity.cloakingTargetingDelay, 0),
      6,
    ),
    scanResolution: roundNumber(toFiniteNumber(entity && entity.scanResolution, 0), 6),
  };
}

function getEntityCapacitorRatio(entity) {
  return clamp(toFiniteNumber(entity && entity.capacitorChargeRatio, 1), 0, 1);
}

function setEntityCapacitorRatio(entity, nextRatio) {
  if (!entity) {
    return 0;
  }
  entity.capacitorChargeRatio = clamp(toFiniteNumber(nextRatio, 0), 0, 1);
  if (entity.kind === "ship") {
    entity.conditionState = normalizeShipConditionState({
      ...(entity.conditionState || {}),
      charge: entity.capacitorChargeRatio,
    });
  }
  return entity.capacitorChargeRatio;
}

function getEntityCapacitorAmount(entity) {
  return (
    toFiniteNumber(entity && entity.capacitorCapacity, 0) *
    getEntityCapacitorRatio(entity)
  );
}

function persistEntityCapacitorRatio(entity) {
  if (!entity || entity.kind !== "ship" || entity.persistSpaceState !== true) {
    return false;
  }

  const nextRatio = getEntityCapacitorRatio(entity);
  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    conditionState: {
      ...(currentItem.conditionState || {}),
      charge: nextRatio,
    },
  }));
  return Boolean(result && result.success);
}

function consumeEntityCapacitor(entity, amount) {
  const requestedAmount = Math.max(0, toFiniteNumber(amount, 0));
  const capacitorCapacity = Math.max(
    toFiniteNumber(entity && entity.capacitorCapacity, 0),
    0,
  );
  if (!entity || capacitorCapacity <= 0) {
    return requestedAmount <= 0;
  }

  const currentAmount = getEntityCapacitorAmount(entity);
  if (requestedAmount > currentAmount + 1e-6) {
    return false;
  }

  setEntityCapacitorRatio(entity, (currentAmount - requestedAmount) / capacitorCapacity);
  persistEntityCapacitorRatio(entity);
  return true;
}

function hasActivePropulsionEffect(entity, effectName, excludeModuleID = 0) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return false;
  }

  for (const effectState of entity.activeModuleEffects.values()) {
    if (!effectState || effectState.effectName !== effectName) {
      continue;
    }
    if (
      excludeModuleID > 0 &&
      toInt(effectState.moduleID, 0) === toInt(excludeModuleID, 0)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function applyPropulsionEffectStateToEntity(entity, effectState) {
  if (!entity || !effectState) {
    return entity;
  }

  const passiveState = entity.passiveDerivedState || null;
  const passiveMass =
    toFiniteNumber(passiveState && passiveState.mass, toFiniteNumber(entity.mass, 0));
  const passiveMaxVelocity =
    toFiniteNumber(
      passiveState && passiveState.maxVelocity,
      toFiniteNumber(entity.maxVelocity, 0),
    );
  const passiveSignatureRadius =
    toFiniteNumber(
      passiveState && passiveState.signatureRadius,
      toFiniteNumber(entity.signatureRadius, 0),
    );
  const massAfterAddition = passiveMass + toFiniteNumber(effectState.massAddition, 0);
  const speedMultiplier =
    1 +
    (0.01 *
      toFiniteNumber(effectState.speedFactor, 0) *
      toFiniteNumber(effectState.speedBoostFactor, 0) /
      Math.max(massAfterAddition, 1));

  entity.mass = roundNumber(massAfterAddition, 6);
  entity.maxVelocity = roundNumber(
    passiveMaxVelocity * Math.max(speedMultiplier, 0),
    6,
  );
  if (effectState.effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
    entity.signatureRadius = roundNumber(
      passiveSignatureRadius *
        (1 + (toFiniteNumber(effectState.signatureRadiusBonus, 0) / 100)),
      6,
    );
  }
  entity.alignTime = calculateAlignTimeSecondsFromMassInertia(
    entity.mass,
    entity.inertia,
    entity.alignTime,
  );
  entity.agilitySeconds = deriveAgilitySeconds(
    entity.alignTime,
    entity.maxAccelerationTime,
    entity.mass,
    entity.inertia,
  );
  return entity;
}

function getPropulsionEffectID(effectName) {
  if (effectName === PROPULSION_EFFECT_AFTERBURNER) {
    return EFFECT_ID_AFTERBURNER;
  }
  if (effectName === PROPULSION_EFFECT_MICROWARPDRIVE) {
    return EFFECT_ID_MICROWARPDRIVE;
  }
  return 0;
}

function resolveSessionNotificationFileTime(session, whenMs = null) {
  const scene =
    runtimeExports &&
    typeof runtimeExports.getSceneForSession === "function"
      ? runtimeExports.getSceneForSession(session)
      : null;
  if (whenMs != null) {
    if (scene) {
      return scene.getCurrentSessionFileTime(session, whenMs);
    }
    return toFileTimeFromMs(whenMs);
  }
  if (scene) {
    return scene.getCurrentSessionFileTime(session);
  }
  if (session && session._space && session._space.simFileTime) {
    return session._space.simFileTime;
  }
  return currentFileTime();
}

function resolveModuleEffectChargeContext(session, entity, effectState) {
  const shipID = toInt(entity && entity.itemID, 0);
  const moduleFlagID = toInt(effectState && effectState.moduleFlagID, 0);
  let chargeTypeID = toInt(effectState && effectState.chargeTypeID, 0);

  if (
    chargeTypeID <= 0 &&
    shipID > 0 &&
    moduleFlagID > 0
  ) {
    const characterID = Math.max(
      toInt(session && session.characterID, 0),
      getShipEntityInventoryCharacterID(entity, 0),
    );
    if (characterID > 0) {
      const loadedCharge = getLoadedChargeByFlag(
        characterID,
        shipID,
        moduleFlagID,
      );
      chargeTypeID = toInt(loadedCharge && loadedCharge.typeID, 0);
    }
  }

  return {
    moduleFlagID,
    chargeTypeID,
    subLocation:
      shipID > 0 && moduleFlagID > 0 && chargeTypeID > 0
        ? buildChargeTupleItemID(shipID, moduleFlagID, chargeTypeID)
        : null,
  };
}

function buildModuleEffectEnvironment(session, entity, effectState, effectID) {
  const chargeContext = resolveModuleEffectChargeContext(
    session,
    entity,
    effectState,
  );
  return {
    environment: [
      toInt(effectState && effectState.moduleID, 0),
      toInt(entity && entity.ownerID, 0),
      toInt(entity && entity.itemID, 0),
      toInt(effectState && effectState.targetID, 0) > 0
        ? toInt(effectState && effectState.targetID, 0)
        : null,
      chargeContext.subLocation,
      [],
      effectID,
    ],
    chargeContext,
  };
}

function logModuleEffectNotification(kind, active, effectState, effectID, chargeContext, environment) {
  const normalizedSubLocation = Array.isArray(chargeContext.subLocation)
    ? `(${chargeContext.subLocation.join(",")})`
    : "null";
  log.debug(
    [
      `[module-fx:${kind}]`,
      `active=${active ? 1 : 0}`,
      `moduleID=${toInt(effectState && effectState.moduleID, 0)}`,
      `moduleFlagID=${toInt(chargeContext && chargeContext.moduleFlagID, 0)}`,
      `chargeTypeID=${toInt(chargeContext && chargeContext.chargeTypeID, 0)}`,
      `targetID=${toInt(effectState && effectState.targetID, 0)}`,
      `effectID=${toInt(effectID, 0)}`,
      `subLoc=${normalizedSubLocation}`,
      `environment=${JSON.stringify(environment)}`,
    ].join(" "),
  );
}

function notifyModuleEffectState(
  session,
  entity,
  effectState,
  active,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const effectID = getPropulsionEffectID(effectState.effectName);
  if (effectID <= 0) {
    return false;
  }

  let when;
  if (options.whenMs != null) {
    when = resolveSessionNotificationFileTime(session, options.whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyModuleEffectState: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const resolvedStartedAt = resolveSessionNotificationFileTime(
    session,
    options.startTimeMs === undefined || options.startTimeMs === null
      ? effectState.startedAtMs
      : options.startTimeMs,
  );
  const durationMs = Number.isFinite(Number(effectState.durationMs))
    ? Math.max(Number(effectState.durationMs), -1)
    : -1;
  const duration = marshalModuleDurationWireValue(durationMs);
  const repeat = normalizeEffectRepeatCount(effectState.repeat, -1);
  const { environment, chargeContext } = buildModuleEffectEnvironment(
    session,
    entity,
    effectState,
    effectID,
  );
  session.sendNotification("OnGodmaShipEffect", "clientID", [
    toInt(effectState.moduleID, 0),
    effectID,
    when,
    active ? 1 : 0,
    active ? 1 : 0,
    environment,
    resolvedStartedAt,
    duration,
    repeat,
    null,
    options.actualStopTimeMs === undefined || options.actualStopTimeMs === null
      ? null
      : resolveSessionNotificationFileTime(session, options.actualStopTimeMs),
  ]);
  logModuleEffectNotification(
    "propulsion",
    active,
    effectState,
    effectID,
    chargeContext,
    environment,
  );
  recordSessionJumpTimingTrace(session, "module-effect-state", {
    moduleID: toInt(effectState.moduleID, 0),
    moduleFlagID: toInt(chargeContext.moduleFlagID, 0),
    chargeTypeID: toInt(chargeContext.chargeTypeID, 0),
    chargeSubLocation: chargeContext.subLocation,
    effectName: effectState.effectName || null,
    effectID,
    active: active === true,
    when,
    startedAt: resolvedStartedAt,
    durationMs,
    repeat,
    sessionSimTimeMs: session && session._space ? session._space.simTimeMs : null,
    sessionTimeDilation:
      session && session._space ? session._space.timeDilation : null,
  });
  return true;
}

// -----------------------------------------------------------------------
// Generic module activation — supports any module with an activatable
// effect (effectCategoryID 1=activation, 2=targeted, 3=area).  This gives
// all modules proper cycle timing so the HUD radial ring works.
// -----------------------------------------------------------------------

const ACTIVATABLE_EFFECT_CATEGORIES = new Set([1, 2, 3]);
const PASSIVE_SLOT_EFFECTS = new Set(["online", "hipower", "medpower", "lopower",
  "rigslot", "subsystem", "turretfitted", "launcherfitted"]);

function resolveDefaultActivationEffect(typeID) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0) {
    return null;
  }

  const effectIDs = getTypeDogmaEffects(numericTypeID);
  for (const effectID of effectIDs) {
    const record = getEffectTypeRecord(effectID);
    if (
      !record ||
      !ACTIVATABLE_EFFECT_CATEGORIES.has(record.effectCategoryID)
    ) {
      continue;
    }
    const normalizedName = String(record.name || "").toLowerCase();
    if (PASSIVE_SLOT_EFFECTS.has(normalizedName)) {
      continue;
    }
    return record;
  }
  return null;
}

function resolveEffectByName(typeID, effectName) {
  const numericTypeID = toInt(typeID, 0);
  if (numericTypeID <= 0 || !effectName) {
    return null;
  }

  const normalized = String(effectName).toLowerCase()
    .replace(/^effects\./, "").replace(/^dogmaxp\./, "");
  const effectIDs = getTypeDogmaEffects(numericTypeID);
  for (const effectID of effectIDs) {
    const record = getEffectTypeRecord(effectID);
    if (!record) {
      continue;
    }
    const recordName = String(record.name || "").toLowerCase();
    if (recordName === normalized) {
      return record;
    }
    const guidSuffix = String(record.guid || "").toLowerCase()
      .replace(/^effects\./, "");
    if (guidSuffix && guidSuffix === normalized) {
      return record;
    }
  }
  return null;
}

function getBaseGenericModuleRuntimeAttributes(moduleItem) {
  if (!moduleItem || !moduleItem.typeID) {
    return null;
  }
  if (!resolveDefaultActivationEffect(moduleItem.typeID)) {
    return null;
  }

  const capNeed = toFiniteNumber(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_CAPACITOR_NEED),
    0,
  );
  // CCP parity: repairers/boosters use "duration" (73), weapons use "speed" (51)
  const rawDuration = getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_DURATION);
  const rawSpeed = getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_SPEED);
  const durationAttributeID =
    toFiniteNumber(rawDuration, 0) > 0
      ? MODULE_ATTRIBUTE_DURATION
      : MODULE_ATTRIBUTE_SPEED;
  const durationMs = Math.max(
    1,
    toFiniteNumber(rawDuration, 0) > 0
      ? toFiniteNumber(rawDuration, 10000)
      : toFiniteNumber(rawSpeed, 10000),
  );
  const reactivationDelayMs = Math.max(
    0,
    toFiniteNumber(
      getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_REACTIVATION_DELAY),
      0,
    ),
  );
  const maxGroupActive = toInt(
    getTypeDogmaAttributeValueByID(moduleItem.typeID, MODULE_ATTRIBUTE_MAX_GROUP_ACTIVE),
    0,
  );

  return {
    capNeed: Math.max(0, roundNumber(capNeed, 6)),
    durationMs: Math.max(1, roundNumber(durationMs, 3)),
    durationAttributeID,
    reactivationDelayMs,
    maxGroupActive,
  };
}

function getGenericModuleRuntimeAttributes(
  characterID,
  shipItem,
  moduleItem,
  chargeItem = null,
  weaponSnapshot = null,
) {
  const baseRuntimeAttributes = getBaseGenericModuleRuntimeAttributes(moduleItem);
  if (!baseRuntimeAttributes) {
    return null;
  }

  const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
  if (weaponFamily !== "laserTurret") {
    return {
      ...baseRuntimeAttributes,
      weaponFamily: weaponFamily || null,
      weaponSnapshot: null,
    };
  }

  const resolvedWeaponSnapshot =
    weaponSnapshot ||
    (
      shipItem &&
      chargeItem
        ? buildWeaponModuleSnapshot({
          characterID,
          shipItem,
          moduleItem,
          chargeItem,
        })
        : null
    );
  if (!resolvedWeaponSnapshot) {
    return {
      ...baseRuntimeAttributes,
      durationAttributeID: MODULE_ATTRIBUTE_SPEED,
      weaponFamily,
      weaponSnapshot: null,
    };
  }

  return {
    ...baseRuntimeAttributes,
    capNeed: resolvedWeaponSnapshot.capNeed,
    durationMs: resolvedWeaponSnapshot.durationMs,
    durationAttributeID: MODULE_ATTRIBUTE_SPEED,
    weaponFamily,
    weaponSnapshot: resolvedWeaponSnapshot,
  };
}

function notifyGenericModuleEffectState(
  session,
  entity,
  effectState,
  active,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const effectID = toInt(effectState.effectID, 0);
  if (effectID <= 0) {
    return false;
  }

  let when;
  if (options.whenMs != null) {
    when = resolveSessionNotificationFileTime(session, options.whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyGenericModuleEffectState: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const startedAt = resolveSessionNotificationFileTime(
    session,
    options.startTimeMs === undefined || options.startTimeMs === null
      ? effectState.startedAtMs
      : options.startTimeMs,
  );
  const durationMs = Number.isFinite(Number(effectState.durationMs))
    ? Math.max(Number(effectState.durationMs), -1)
    : -1;
  const duration = marshalModuleDurationWireValue(durationMs);
  const repeat = normalizeEffectRepeatCount(effectState.repeat, -1);
  const { environment, chargeContext } = buildModuleEffectEnvironment(
    session,
    entity,
    effectState,
    effectID,
  );
  session.sendNotification("OnGodmaShipEffect", "clientID", [
    toInt(effectState.moduleID, 0),
    effectID,
    when,
    active ? 1 : 0,
    active ? 1 : 0,
    environment,
    startedAt,
    duration,
    repeat,
    null,
    options.actualStopTimeMs === undefined || options.actualStopTimeMs === null
      ? null
      : resolveSessionNotificationFileTime(session, options.actualStopTimeMs),
  ]);
  logModuleEffectNotification(
    "generic",
    active,
    effectState,
    effectID,
    chargeContext,
    environment,
  );
  recordSessionJumpTimingTrace(session, "generic-module-effect-state", {
    moduleID: toInt(effectState.moduleID, 0),
    moduleFlagID: toInt(chargeContext.moduleFlagID, 0),
    chargeTypeID: toInt(chargeContext.chargeTypeID, 0),
    chargeSubLocation: chargeContext.subLocation,
    effectName: effectState.effectName || null,
    effectID,
    active: active === true,
    when,
    startedAt,
    durationMs,
    repeat,
    sessionSimTimeMs: session && session._space ? session._space.simTimeMs : null,
    sessionTimeDilation:
      session && session._space ? session._space.timeDilation : null,
  });
  return true;
}

function getEffectCycleBoundaryMs(effectState, fallbackNow = Date.now()) {
  if (!effectState) {
    return Math.max(toFiniteNumber(fallbackNow, Date.now()), 0);
  }

  const durationMs = Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
  const nextCycleAtMs = toFiniteNumber(effectState.nextCycleAtMs, 0);
  if (nextCycleAtMs > 0) {
    return nextCycleAtMs;
  }

  const startedAtMs = toFiniteNumber(effectState.startedAtMs, 0);
  if (startedAtMs > 0) {
    return startedAtMs + durationMs;
  }

  return Math.max(toFiniteNumber(fallbackNow, Date.now()), 0);
}

function normalizeEffectRepeatCount(rawRepeat, fallbackRepeat = null) {
  if (
    rawRepeat === undefined ||
    rawRepeat === null ||
    rawRepeat === true ||
    rawRepeat === false
  ) {
    return fallbackRepeat;
  }

  const normalizedRepeat = Math.trunc(Number(rawRepeat));
  if (!Number.isFinite(normalizedRepeat) || normalizedRepeat <= 0) {
    return fallbackRepeat;
  }

  return normalizedRepeat;
}

function resolveSpecialFxRepeatCount(effectState, fallbackRepeat = null) {
  const explicitRepeat = normalizeEffectRepeatCount(
    effectState && effectState.repeat,
    null,
  );
  if (explicitRepeat !== null) {
    return explicitRepeat;
  }

  if (!effectState || effectState.weaponFamily !== "laserTurret") {
    return fallbackRepeat;
  }

  const durationMs = Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
  return Math.max(1, Math.ceil(SPECIAL_FX_REPEAT_WINDOW_MS / durationMs));
}

function resolvePreservedSimTimeMs(
  preservedPreviousSimTimeMs,
  previousTimeDilation,
  capturedAtWallclockMs,
  fallbackMs = null,
) {
  const normalizedPreservedPreviousSimTimeMs =
    preservedPreviousSimTimeMs === undefined || preservedPreviousSimTimeMs === null
      ? null
      : toFiniteNumber(preservedPreviousSimTimeMs, fallbackMs);
  if (normalizedPreservedPreviousSimTimeMs === null) {
    return fallbackMs;
  }

  const normalizedCapturedAtWallclockMs =
    capturedAtWallclockMs === undefined || capturedAtWallclockMs === null
      ? null
      : toFiniteNumber(capturedAtWallclockMs, null);
  const normalizedPreviousTimeDilation =
    previousTimeDilation === undefined || previousTimeDilation === null
      ? null
      : clampTimeDilationFactor(previousTimeDilation);
  if (
    normalizedCapturedAtWallclockMs === null ||
    normalizedPreviousTimeDilation === null
  ) {
    return normalizedPreservedPreviousSimTimeMs;
  }

  const elapsedWallclockMs = Math.max(
    0,
    toFiniteNumber(Date.now(), normalizedCapturedAtWallclockMs) -
      normalizedCapturedAtWallclockMs,
  );
  return roundNumber(
    normalizedPreservedPreviousSimTimeMs +
      (elapsedWallclockMs * normalizedPreviousTimeDilation),
    3,
  );
}

function resolveBootstrapPreviousSimTimeMs(session, fallbackMs = null) {
  if (!session) {
    return fallbackMs;
  }

  return resolvePreservedSimTimeMs(
    session._nextInitialBallparkPreviousSimTimeMs,
    session._nextInitialBallparkPreviousTimeDilation,
    session._nextInitialBallparkPreviousCapturedAtWallclockMs,
    fallbackMs,
  );
}

// CCP parity: After consuming capacitor, notify the owning session so the
// client's HUD gauge updates in real-time.  Attribute 18 ("charge") is the
// current capacitor energy in GJ.
const ATTRIBUTE_CHARGE = 18;
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_SHIP_DAMAGE = getAttributeIDByNames("damage") || 3;
const ATTRIBUTE_SHIP_SHIELD_CHARGE =
  getAttributeIDByNames("shieldCharge") || 264;
const ATTRIBUTE_SHIP_ARMOR_DAMAGE =
  getAttributeIDByNames("armorDamage") || 266;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE =
  getAttributeIDByNames("crystalVolatilityChance") || 783;
const ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE =
  getAttributeIDByNames("crystalVolatilityDamage") || 784;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE =
  getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const TARGETING_MAX_LOCK_MS = 180000;
const TARGETING_CLIENT_FALLBACK_LOCK_MS = 2000;
const TARGET_LOSS_REASON_ATTEMPT_CANCELLED = "TargetingAttemptCancelled";
const TARGET_LOSS_REASON_EXPLODING = "Exploding";
const DESTRUCTION_EFFECT_EXPLOSION = 3;

function notifyAttributeChanges(session, changes = []) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !Array.isArray(changes) ||
    changes.length === 0
  ) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: changes,
  }]);
  return true;
}

function isModuleTimingAttribute(attributeID) {
  const normalizedAttributeID = toInt(attributeID, 0);
  return (
    normalizedAttributeID === MODULE_ATTRIBUTE_DURATION ||
    normalizedAttributeID === MODULE_ATTRIBUTE_SPEED
  );
}

function buildAttributeChange(
  session,
  itemID,
  attributeID,
  newValue,
  oldValue = null,
  when = null,
) {
  let resolvedWhen;
  if (when != null) {
    resolvedWhen = when;
  } else if (session && session._space && session._space.simFileTime) {
    resolvedWhen = session._space.simFileTime;
  } else {
    log.warn("buildAttributeChange: no sim time source, using wallclock fallback");
    resolvedWhen = currentFileTime();
  }
  const normalizedAttributeID = toInt(attributeID, 0);
  return [
    "OnModuleAttributeChanges",
    toInt(session && session.characterID, 0),
    itemID,
    normalizedAttributeID,
    resolvedWhen,
    isModuleTimingAttribute(normalizedAttributeID)
      ? marshalModuleDurationWireValue(newValue)
      : Number.isFinite(Number(newValue))
        ? Number(newValue)
        : newValue,
    isModuleTimingAttribute(normalizedAttributeID)
      ? marshalModuleDurationWireValue(oldValue)
      : oldValue,
    null,
  ];
}

function notifyCapacitorChangeToSession(
  session,
  entity,
  whenMs = null,
  previousChargeAmount = null,
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !entity
  ) {
    return;
  }

  const capacitorCapacity = Math.max(
    toFiniteNumber(entity.capacitorCapacity, 0),
    0,
  );
  const chargeAmount = Number(
    (capacitorCapacity * getEntityCapacitorRatio(entity)).toFixed(6),
  );
  const shipID = toInt(entity.itemID, 0);
  let when;
  if (whenMs != null) {
    when = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    when = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyCapacitorChangeToSession: no sim time source, using wallclock fallback");
    when = currentFileTime();
  }
  const hasExplicitPreviousChargeAmount =
    previousChargeAmount !== null &&
    previousChargeAmount !== undefined &&
    Number.isFinite(Number(previousChargeAmount));
  const normalizedPreviousChargeAmount = hasExplicitPreviousChargeAmount
    ? Number(Number(previousChargeAmount).toFixed(6))
    : Number.isFinite(Number(entity._lastCapNotifiedAmount))
      ? Number(Number(entity._lastCapNotifiedAmount).toFixed(6))
      : chargeAmount;

  notifyAttributeChanges(session, [buildAttributeChange(
    session,
    shipID,
    ATTRIBUTE_CHARGE,
    chargeAmount,
    normalizedPreviousChargeAmount,
    when,
  )]);
  entity._lastCapNotifiedAmount = chargeAmount;
}

function isEntityLockedTarget(entity, targetID) {
  const normalizedTargetID = toInt(targetID, 0);
  if (!entity || normalizedTargetID <= 0) {
    return false;
  }

  return ensureEntityTargetingState(entity).lockedTargets.has(normalizedTargetID);
}

function notifyChargeDamageChangeToSession(
  session,
  shipID,
  moduleFlagID,
  chargeTypeID,
  nextDamage,
  previousDamage,
  when = null,
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (
    !session ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0
  ) {
    return false;
  }

  return notifyAttributeChanges(session, [buildAttributeChange(
    session,
    buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
    ATTRIBUTE_ITEM_DAMAGE,
    roundNumber(toFiniteNumber(nextDamage, 0), 6),
    roundNumber(toFiniteNumber(previousDamage, 0), 6),
    when,
  )]);
}

function notifyChargeQuantityChangeToSession(
  session,
  shipID,
  moduleFlagID,
  chargeTypeID,
  nextQuantity,
  previousQuantity,
  when = null,
) {
  const numericShipID = toInt(shipID, 0);
  const numericFlagID = toInt(moduleFlagID, 0);
  const numericChargeTypeID = toInt(chargeTypeID, 0);
  if (
    !session ||
    numericShipID <= 0 ||
    numericFlagID <= 0 ||
    numericChargeTypeID <= 0
  ) {
    return false;
  }

  return notifyAttributeChanges(session, [buildAttributeChange(
    session,
    buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
    ATTRIBUTE_QUANTITY,
    Math.max(0, toInt(nextQuantity, 0)),
    Math.max(0, toInt(previousQuantity, 0)),
    when,
  )]);
}

function buildShipHealthAttributeSnapshotFromDamageResult(damageResult) {
  const damageData =
    damageResult && damageResult.success === true && damageResult.data
      ? damageResult.data
      : null;
  if (!damageData) {
    return null;
  }

  const maxLayers = damageData.maxLayers || {};
  const beforeLayers = damageData.beforeLayers || {};
  const afterLayers = damageData.afterLayers || {};
  return {
    shieldCharge: {
      previous: roundNumber(toFiniteNumber(beforeLayers.shield, 0), 6),
      next: roundNumber(toFiniteNumber(afterLayers.shield, 0), 6),
    },
    armorDamage: {
      previous: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.armor, 0) - toFiniteNumber(beforeLayers.armor, 0),
        ),
        6,
      ),
      next: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.armor, 0) - toFiniteNumber(afterLayers.armor, 0),
        ),
        6,
      ),
    },
    structureDamage: {
      previous: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.structure, 0) - toFiniteNumber(beforeLayers.structure, 0),
        ),
        6,
      ),
      next: roundNumber(
        Math.max(
          0,
          toFiniteNumber(maxLayers.structure, 0) - toFiniteNumber(afterLayers.structure, 0),
        ),
        6,
      ),
    },
  };
}

function buildShipHealthTransitionResult(entity, previousConditionState = null) {
  if (!entity) {
    return null;
  }

  const normalizedPreviousConditionState = normalizeShipConditionState(
    previousConditionState === null || previousConditionState === undefined
      ? entity.conditionState
      : previousConditionState,
  );
  const maxLayers = getEntityMaxHealthLayers(entity);
  const beforeLayers = getEntityCurrentHealthLayers(
    {
      ...entity,
      conditionState: normalizedPreviousConditionState,
    },
    maxLayers,
  );
  const afterLayers = getEntityCurrentHealthLayers(entity, maxLayers);

  return {
    success: true,
    data: {
      maxLayers: {
        shield: roundNumber(toFiniteNumber(maxLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(maxLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(maxLayers.structure, 0), 6),
      },
      beforeLayers: {
        shield: roundNumber(toFiniteNumber(beforeLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(beforeLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(beforeLayers.structure, 0), 6),
      },
      afterLayers: {
        shield: roundNumber(toFiniteNumber(afterLayers.shield, 0), 6),
        armor: roundNumber(toFiniteNumber(afterLayers.armor, 0), 6),
        structure: roundNumber(toFiniteNumber(afterLayers.structure, 0), 6),
      },
      beforeConditionState: {
        ...normalizedPreviousConditionState,
      },
      afterConditionState: {
        ...normalizeShipConditionState(entity.conditionState),
      },
      destroyed: false,
    },
  };
}

function notifyShipHealthAttributesToSession(
  session,
  entity,
  damageResult,
  whenMs = null,
) {
  if (!session || !entity) {
    return false;
  }

  const shipID = toInt(entity.itemID, 0);
  const snapshot = buildShipHealthAttributeSnapshotFromDamageResult(damageResult);
  if (shipID <= 0 || !snapshot) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyShipHealthAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const changes = [];
  const candidates = [
    [
      ATTRIBUTE_SHIP_SHIELD_CHARGE,
      snapshot.shieldCharge.next,
      snapshot.shieldCharge.previous,
    ],
    [
      ATTRIBUTE_SHIP_ARMOR_DAMAGE,
      snapshot.armorDamage.next,
      snapshot.armorDamage.previous,
    ],
    [
      ATTRIBUTE_SHIP_DAMAGE,
      snapshot.structureDamage.next,
      snapshot.structureDamage.previous,
    ],
  ];

  for (const [attributeID, nextValue, previousValue] of candidates) {
    if (attributeID <= 0 || Number(nextValue) === Number(previousValue)) {
      continue;
    }
    changes.push(
      buildAttributeChange(
        session,
        shipID,
        attributeID,
        nextValue,
        previousValue,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function sendAddBallsRefreshToSession(scene, session, entity, whenMs = null) {
  if (!scene || !session || !entity || !isReadyForDestiny(session)) {
    return false;
  }

  refreshShipPresentationFields(entity);
  const refreshedEntities = refreshEntitiesForSlimPayload([entity]).filter(Boolean);
  if (refreshedEntities.length === 0) {
    return false;
  }

  const rawSimTimeMs =
    whenMs === null || whenMs === undefined
      ? scene.getCurrentSimTimeMs()
      : toFiniteNumber(whenMs, scene.getCurrentSimTimeMs());
  const rawStamp = ((scene.getCurrentDestinyStamp(rawSimTimeMs) + 1) >>> 0);
  scene.nextStamp = Math.max(toInt(scene.nextStamp, 0), rawStamp);
  const stamp = scene.translateDestinyStampForSession(session, rawStamp);
  const simFileTime = scene.getCurrentSessionFileTime(session, rawSimTimeMs);
  scene.sendDestinyUpdates(session, [
    {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, refreshedEntities, simFileTime),
    },
  ], false, { translateStamps: false });
  return true;
}

function healShipResourcesForSession(session, scene, entity, options = {}) {
  if (!entity || entity.kind !== "ship") {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const ownerSession = session || entity.session || null;
  const previousConditionState = normalizeShipConditionState(entity.conditionState);
  const previousChargeAmount = getEntityCapacitorAmount(entity);
  const healedConditionState = normalizeShipConditionState({
    ...previousConditionState,
    damage: 0,
    charge: 1,
    armorDamage: 0,
    shieldCharge: 1,
  });

  entity.conditionState = healedConditionState;
  setEntityCapacitorRatio(entity, healedConditionState.charge);
  persistDynamicEntity(entity);

  const nextConditionState = normalizeShipConditionState(entity.conditionState);
  const healthTransitionResult = buildShipHealthTransitionResult(
    entity,
    previousConditionState,
  );
  const healthChanged =
    Math.abs(
      toFiniteNumber(previousConditionState.shieldCharge, 0) -
        toFiniteNumber(nextConditionState.shieldCharge, 0),
    ) > 1e-6 ||
    Math.abs(
      toFiniteNumber(previousConditionState.armorDamage, 0) -
        toFiniteNumber(nextConditionState.armorDamage, 0),
    ) > 1e-6 ||
    Math.abs(
      toFiniteNumber(previousConditionState.damage, 0) -
        toFiniteNumber(nextConditionState.damage, 0),
    ) > 1e-6;
  const resolvedWhenMs =
    options.whenMs !== undefined && options.whenMs !== null
      ? toFiniteNumber(options.whenMs, Date.now())
      : scene
        ? scene.getCurrentSimTimeMs()
        : Date.now();

  if (ownerSession) {
    notifyShipHealthAttributesToSession(
      ownerSession,
      entity,
      healthTransitionResult,
      resolvedWhenMs,
    );
    notifyCapacitorChangeToSession(
      ownerSession,
      entity,
      resolvedWhenMs,
      previousChargeAmount,
    );
  }

  const deliveredCount =
    scene && healthChanged
      ? broadcastDamageStateChange(scene, entity, resolvedWhenMs)
      : 0;

  const canRefreshOwnerDamagePresentation =
    scene &&
    healthChanged &&
    ownerSession &&
    isReadyForDestiny(ownerSession) &&
    (
      !entity.session ||
      sessionMatchesIdentity(ownerSession, entity.session)
    );
  const shouldRefreshOwnerDamagePresentation =
    options.refreshOwnerDamagePresentation !== false &&
    canRefreshOwnerDamagePresentation;
  if (shouldRefreshOwnerDamagePresentation) {
    // Pilot HUD health already rides dogma attribute updates, but the ego ship's
    // in-space impact visuals can still need a fresh SetState re-read of the
    // authoritative damage-state map. Keep this owner-only because observers
    // already update from OnDamageStateChange. Callers can disable it for
    // live operator/debug actions like /heal where a full SetState rebase is
    // riskier than leaving stale impact visuals until the next normal refresh.
    const refreshStamp = ((scene.getCurrentDestinyStamp(resolvedWhenMs) + 1) >>> 0);
    scene.sendStateRefresh(ownerSession, entity, refreshStamp);
  } else if (
    options.refreshOwnerDamagePresentation === false &&
    canRefreshOwnerDamagePresentation &&
    entity.mode !== "WARP"
  ) {
    // /heal still needs the pilot's own ship model to re-read the healed
    // damage state, but a full SetState rebase rebuilds the local ballpark and
    // can desync fittings. A pilot-only AddBalls2 refresh is enough to redraw
    // the ego ball without tearing down the whole session bootstrap. Skip warp:
    // pilot DoDestinyUpdate during warp bootstrap is intentionally kept quiet.
    sendAddBallsRefreshToSession(scene, ownerSession, entity, resolvedWhenMs);
  }

  return {
    success: true,
    data: {
      entity,
      whenMs: resolvedWhenMs,
      previousChargeAmount: roundNumber(previousChargeAmount, 6),
      currentChargeAmount: roundNumber(getEntityCapacitorAmount(entity), 6),
      previousConditionState,
      currentConditionState: nextConditionState,
      healthChanged,
      deliveredCount,
    },
  };
}

function broadcastDamageStateChange(scene, entity, whenMs = null) {
  if (!scene || !entity) {
    return 0;
  }

  const resolvedFileTime =
    whenMs === null || whenMs === undefined
      ? scene.getCurrentFileTime()
      : scene.toFileTimeFromSimMs(whenMs, scene.getCurrentFileTime());
  const damageState = buildLiveDamageState(entity, resolvedFileTime);
  const rawBaseStamp =
    whenMs === null || whenMs === undefined
      ? scene.getCurrentDestinyStamp()
      : scene.getCurrentDestinyStamp(whenMs);
  let deliveredCount = 0;
  const recipientSessions = new Set();

  for (const session of scene.sessions.values()) {
    if (!isReadyForDestiny(session)) {
      continue;
    }
    if (
      entity.kind !== "station" &&
      !scene.canSessionSeeDynamicEntity(session, entity)
    ) {
      continue;
    }
    recipientSessions.add(session);
  }

  if (entity.session && isReadyForDestiny(entity.session)) {
    recipientSessions.add(entity.session);
  }

  const targetingState = ensureEntityTargetingState(entity);
  if (targetingState && targetingState.targetedBy instanceof Set) {
    for (const sourceID of targetingState.targetedBy) {
      const sourceEntity = scene.getEntityByID(sourceID);
      if (
        !sourceEntity ||
        !sourceEntity.session ||
        !isReadyForDestiny(sourceEntity.session)
      ) {
        continue;
      }
      recipientSessions.add(sourceEntity.session);
    }
  }

  for (const session of recipientSessions) {
    const stamp = scene.getImmediateDestinyStampForSession(
      session,
      rawBaseStamp,
    );
    scene.sendDestinyUpdates(session, [{
      stamp,
      payload: destiny.buildOnDamageStateChangePayload(
        entity.itemID,
        damageState,
      ),
    }], false, {
      translateStamps: false,
    });
    deliveredCount += 1;
  }

  return deliveredCount;
}

function getCombatMessageHitQuality(shotResult) {
  if (!shotResult || shotResult.hit !== true) {
    return 0;
  }

  const quality = toFiniteNumber(shotResult.quality, 0);
  if (quality >= 3) {
    return 6;
  }
  if (quality >= 1.2) {
    return 5;
  }
  if (quality >= 1.0) {
    return 4;
  }
  if (quality >= 0.85) {
    return 3;
  }
  if (quality >= 0.65) {
    return 2;
  }
  return 1;
}

function getAppliedDamageAmount(damageResult) {
  if (!damageResult || damageResult.success !== true || !damageResult.data) {
    return 0;
  }

  const perLayer = Array.isArray(damageResult.data.perLayer)
    ? damageResult.data.perLayer
    : [];
  return roundNumber(
    perLayer.reduce(
      (sum, layerEntry) => sum + toFiniteNumber(layerEntry && layerEntry.appliedEffective, 0),
      0,
    ),
    6,
  );
}

function buildMarshalDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildCombatMessageDamageDict(damageVector = {}) {
  return buildMarshalDict([
    [
      ATTRIBUTE_EM_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.em, 0), 6),
    ],
    [
      ATTRIBUTE_THERMAL_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.thermal, 0), 6),
    ],
    [
      ATTRIBUTE_KINETIC_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.kinetic, 0), 6),
    ],
    [
      ATTRIBUTE_EXPLOSIVE_DAMAGE,
      roundNumber(toFiniteNumber(damageVector && damageVector.explosive, 0), 6),
    ],
  ]);
}

function getCombatNotificationSession(entity) {
  return entity && entity.session && typeof entity.session.sendNotification === "function"
    ? entity.session
    : null;
}

function buildLaserDamageMessagePayload({
  attackType = "me",
  attackerEntity = null,
  targetEntity = null,
  moduleItem = null,
  shotDamage = null,
  totalDamage = 0,
  hitQuality = 0,
  includeAttackerID = false,
} = {}) {
  const resolvedShotDamage =
    shotDamage && typeof shotDamage === "object"
      ? shotDamage
      : {};
  const attackerID = toInt(attackerEntity && attackerEntity.itemID, 0);
  const targetID = toInt(targetEntity && targetEntity.itemID, 0);
  const entries = [
    ["attackType", String(attackType || "me")],
    ["source", attackerID],
    ["target", targetID],
    ["weapon", toInt(moduleItem && moduleItem.typeID, 0)],
    ["damage", roundNumber(toFiniteNumber(totalDamage, 0), 6)],
    ["damageAttributes", buildCombatMessageDamageDict(resolvedShotDamage)],
    ["damageTypes", buildMarshalDict([
      ["em", roundNumber(toFiniteNumber(resolvedShotDamage.em, 0), 6)],
      ["thermal", roundNumber(toFiniteNumber(resolvedShotDamage.thermal, 0), 6)],
      ["kinetic", roundNumber(toFiniteNumber(resolvedShotDamage.kinetic, 0), 6)],
      ["explosive", roundNumber(toFiniteNumber(resolvedShotDamage.explosive, 0), 6)],
    ])],
    ["hitQuality", toInt(hitQuality, 0)],
    ["isBanked", false],
  ];

  if (includeAttackerID && attackerID > 0) {
    entries.push(["attackerID", attackerID]);
  }

  return buildMarshalDict(entries);
}

function notifyLaserDamageMessages(
  attackerEntity,
  targetEntity,
  moduleItem,
  shotResult,
  damageResult,
) {
  if (!targetEntity || !moduleItem || !shotResult) {
    return false;
  }

  const totalDamage = getAppliedDamageAmount(damageResult);
  const shotDamage =
    shotResult && shotResult.shotDamage && typeof shotResult.shotDamage === "object"
      ? shotResult.shotDamage
      : {};
  const hitQuality = getCombatMessageHitQuality(shotResult);
  let notified = false;

  const attackerSession = getCombatNotificationSession(attackerEntity);
  if (attackerSession) {
    attackerSession.sendNotification("OnDamageMessage", "clientID", [
      buildLaserDamageMessagePayload({
        attackType: "me",
        attackerEntity,
        targetEntity,
        moduleItem,
        shotDamage,
        totalDamage,
        hitQuality,
      }),
    ]);
    notified = true;
  }

  const targetSession = getCombatNotificationSession(targetEntity);
  if (targetSession && targetSession !== attackerSession) {
    targetSession.sendNotification("OnDamageMessage", "clientID", [
      buildLaserDamageMessagePayload({
        attackType: "otherPlayerWeapons",
        attackerEntity,
        targetEntity,
        moduleItem,
        shotDamage,
        totalDamage,
        hitQuality,
        includeAttackerID: true,
      }),
    ]);
    notified = true;
  }

  return notified;
}

function applyCrystalVolatilityDamage(
  scene,
  attackerEntity,
  moduleItem,
  chargeItem,
  whenMs = null,
) {
  if (!scene || !attackerEntity || !moduleItem || !chargeItem) {
    return {
      success: false,
      errorMsg: "CRYSTAL_NOT_FOUND",
    };
  }

  const chargeAttributes = getTypeDogmaAttributes(chargeItem.typeID);
  const volatilityChance = clamp(
    toFiniteNumber(
      chargeAttributes && chargeAttributes[String(ATTRIBUTE_CRYSTAL_VOLATILITY_CHANCE)],
      0,
    ),
    0,
    1,
  );
  const volatilityDamage = Math.max(
    0,
    toFiniteNumber(
      chargeAttributes && chargeAttributes[String(ATTRIBUTE_CRYSTAL_VOLATILITY_DAMAGE)],
      0,
    ),
  );
  if (volatilityChance <= 0 || volatilityDamage <= 0) {
    return {
      success: true,
      data: {
        chargeItem,
        damaged: false,
        burnedOut: false,
      },
    };
  }
  if (Math.random() > volatilityChance) {
    return {
      success: true,
      data: {
        chargeItem,
        damaged: false,
        burnedOut: false,
      },
    };
  }

  const previousDamage = clamp(
    toFiniteNumber(
      chargeItem && chargeItem.moduleState && chargeItem.moduleState.damage,
      0,
    ),
    0,
    1,
  );
  const nextDamage = clamp(previousDamage + volatilityDamage, 0, 1);
  const when = resolveSessionNotificationFileTime(attackerEntity.session, whenMs);

  const updateResult = updateInventoryItem(chargeItem.itemID, (currentItem) => ({
    ...currentItem,
    moduleState: {
      ...(currentItem && currentItem.moduleState ? currentItem.moduleState : {}),
      damage: nextDamage,
    },
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  const updatedChargeItem = findItemById(chargeItem.itemID) || chargeItem;
  if (attackerEntity.session) {
    notifyChargeDamageChangeToSession(
      attackerEntity.session,
      attackerEntity.itemID,
      moduleItem.flagID,
      chargeItem.typeID,
      nextDamage,
      previousDamage,
      when,
    );
  }

  if (nextDamage < 1 - 1e-9) {
    return {
      success: true,
      data: {
        chargeItem: updatedChargeItem,
        damaged: true,
        burnedOut: false,
        previousDamage,
        nextDamage,
      },
    };
  }

  const removeResult = removeInventoryItem(chargeItem.itemID);
  if (removeResult.success && attackerEntity.session) {
    notifyChargeQuantityChangeToSession(
      attackerEntity.session,
      attackerEntity.itemID,
      moduleItem.flagID,
      chargeItem.typeID,
      0,
      1,
      when,
    );
  }

  return {
    success: removeResult.success,
    errorMsg: removeResult.success ? null : removeResult.errorMsg,
    data: {
      chargeItem: removeResult.success ? null : updatedChargeItem,
      damaged: true,
      burnedOut: removeResult.success,
      previousDamage,
      nextDamage,
    },
  };
}

function destroyCombatEntity(scene, entity) {
  if (!scene || !entity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  if (entity.kind === "ship") {
    const {
      destroySessionShip,
      destroyShipEntityWithWreck,
    } = require(path.join(__dirname, "./shipDestruction"));
    if (entity.session) {
      return destroySessionShip(entity.session, {
        sessionChangeReason: "combat",
      });
    }
    return destroyShipEntityWithWreck(scene.systemID, entity, {
      ownerCharacterID: toInt(
        getShipEntityInventoryCharacterID(entity, 0) || entity.ownerID,
        0,
      ),
      shipRecord: findShipItemById(entity.itemID) || null,
    });
  }

  if (isInventoryBackedDynamicEntity(entity)) {
    return scene.destroyInventoryBackedDynamicEntity(entity.itemID, {
      terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
    });
  }

  return {
    success: false,
    errorMsg: "ENTITY_NOT_DAMAGEABLE",
  };
}

function executeLaserTurretCycle(scene, attackerEntity, effectState, cycleBoundaryMs) {
  const session = attackerEntity && attackerEntity.session ? attackerEntity.session : null;
  const attackerCharacterID = getShipEntityInventoryCharacterID(attackerEntity, 0);
  const moduleItem = findItemById(effectState && effectState.moduleID);
  if (!attackerEntity || !effectState || !moduleItem) {
    return {
      success: false,
      errorMsg: "MODULE_NOT_FOUND",
      stopReason: "module",
    };
  }

  const chargeItem =
    attackerCharacterID > 0
      ? getLoadedChargeByFlag(
        attackerCharacterID,
        attackerEntity.itemID,
        moduleItem.flagID,
      )
      : null;
  const family = resolveWeaponFamily(moduleItem, chargeItem);
  if (family !== "laserTurret" || !chargeItem) {
    return {
      success: false,
      errorMsg: "NO_AMMO",
      stopReason: "ammo",
    };
  }

  const targetEntity = scene.getEntityByID(effectState.targetID);
  if (
    !targetEntity ||
    !hasDamageableHealth(targetEntity) ||
    !isEntityLockedTarget(attackerEntity, effectState.targetID)
  ) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
      stopReason: "target",
    };
  }

  const shipRecord =
    attackerCharacterID > 0
      ? getActiveShipRecord(attackerCharacterID) || findShipItemById(attackerEntity.itemID)
      : findShipItemById(attackerEntity.itemID);
  if (!shipRecord) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
      stopReason: "ship",
    };
  }

  const weaponSnapshot = buildWeaponModuleSnapshot({
    characterID: attackerCharacterID,
    shipItem: shipRecord,
    moduleItem,
    chargeItem,
  });
  if (!weaponSnapshot) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_WEAPON",
      stopReason: "weapon",
    };
  }

  const shotResult = resolveLaserTurretShot({
    attackerEntity,
    targetEntity,
    weaponSnapshot,
  });
  let damageResult = null;
  let destroyResult = null;

  if (shotResult.hit && hasDamageableHealth(targetEntity)) {
    damageResult = applyDamageToEntity(targetEntity, shotResult.shotDamage);
    if (damageResult.success) {
      try {
        const npcService = require(path.join(__dirname, "./npc"));
        if (npcService && typeof npcService.noteNpcIncomingAggression === "function") {
          npcService.noteNpcIncomingAggression(
            targetEntity,
            attackerEntity,
            cycleBoundaryMs,
          );
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] NPC aggression note failed: ${error.message}`);
      }
      persistDynamicEntity(targetEntity);
      if (targetEntity.session) {
        notifyShipHealthAttributesToSession(
          targetEntity.session,
          targetEntity,
          damageResult,
          cycleBoundaryMs,
        );
      }
      broadcastDamageStateChange(scene, targetEntity, cycleBoundaryMs);
      if (damageResult.data && damageResult.data.destroyed) {
        destroyResult = destroyCombatEntity(scene, targetEntity);
      }
    }
  }

  notifyLaserDamageMessages(
    attackerEntity,
    targetEntity,
    moduleItem,
    shotResult,
    damageResult,
  );

  const crystalResult = applyCrystalVolatilityDamage(
    scene,
    attackerEntity,
    moduleItem,
    chargeItem,
    cycleBoundaryMs,
  );

  return {
    success: true,
    data: {
      moduleItem,
      chargeItem,
      targetEntity,
      weaponSnapshot,
      shotResult,
      damageResult,
      destroyResult,
      crystalResult,
      stopReason:
        !crystalResult.success
          ? "ammo"
          : crystalResult.data && crystalResult.data.burnedOut
            ? "ammo"
            : null,
    },
  };
}

function notifyPropulsionDerivedAttributesToSession(
  session,
  entity,
  effectState,
  whenMs = null,
) {
  if (
    !session ||
    !entity ||
    !effectState
  ) {
    return false;
  }

  const changes = [];
  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyPropulsionDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }
  const moduleID = toInt(effectState.moduleID, 0);
  const shipID = toInt(entity.itemID, 0);

  if (moduleID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_SPEED_FACTOR,
        roundNumber(toFiniteNumber(effectState.speedFactor, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_CAPACITOR_NEED,
        roundNumber(toFiniteNumber(effectState.capNeed, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        moduleID,
        MODULE_ATTRIBUTE_DURATION,
        roundNumber(toFiniteNumber(effectState.durationMs, 0), 3),
        null,
        timestamp,
      ),
    );
  }

  if (shipID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_MASS,
        roundNumber(toFiniteNumber(entity.mass, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_MAX_VELOCITY,
        roundNumber(toFiniteNumber(entity.maxVelocity, 0), 6),
        null,
        timestamp,
      ),
      buildAttributeChange(
        session,
        shipID,
        ATTRIBUTE_SIGNATURE_RADIUS,
        roundNumber(toFiniteNumber(entity.signatureRadius, 0), 6),
        null,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function notifyGenericDerivedAttributesToSession(
  session,
  effectState,
  whenMs = null,
) {
  if (!session || !effectState) {
    return false;
  }

  const moduleID = toInt(effectState.moduleID, 0);
  const durationAttributeID = toInt(
    effectState.durationAttributeID,
    MODULE_ATTRIBUTE_DURATION,
  );
  if (moduleID <= 0) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyGenericDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const changes = [
    buildAttributeChange(
      session,
      moduleID,
      MODULE_ATTRIBUTE_CAPACITOR_NEED,
      roundNumber(toFiniteNumber(effectState.capNeed, 0), 6),
      null,
      timestamp,
    ),
  ];

  if (durationAttributeID > 0) {
    changes.push(
      buildAttributeChange(
        session,
        moduleID,
        durationAttributeID,
        roundNumber(toFiniteNumber(effectState.durationMs, 0), 3),
        null,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, changes);
}

function notifyTargetingDerivedAttributesToSession(
  session,
  entity,
  previousSnapshot,
  whenMs = null,
) {
  if (!session || !entity || !previousSnapshot) {
    return false;
  }

  let timestamp;
  if (whenMs != null) {
    timestamp = resolveSessionNotificationFileTime(session, whenMs);
  } else if (session && session._space && session._space.simFileTime) {
    timestamp = resolveSessionNotificationFileTime(session);
  } else {
    log.warn("notifyTargetingDerivedAttributesToSession: no sim time source, using wallclock fallback");
    timestamp = currentFileTime();
  }

  const shipID = toInt(entity.itemID, 0);
  if (shipID <= 0) {
    return false;
  }

  const currentSnapshot = buildEntityTargetingAttributeSnapshot(entity);
  const attributeChanges = [];
  const candidates = [
    [ATTRIBUTE_MAX_TARGET_RANGE, currentSnapshot.maxTargetRange, previousSnapshot.maxTargetRange],
    [ATTRIBUTE_MAX_LOCKED_TARGETS, currentSnapshot.maxLockedTargets, previousSnapshot.maxLockedTargets],
    [ATTRIBUTE_SIGNATURE_RADIUS, currentSnapshot.signatureRadius, previousSnapshot.signatureRadius],
    [ATTRIBUTE_CLOAKING_TARGETING_DELAY, currentSnapshot.cloakingTargetingDelay, previousSnapshot.cloakingTargetingDelay],
    [ATTRIBUTE_SCAN_RESOLUTION, currentSnapshot.scanResolution, previousSnapshot.scanResolution],
  ];

  for (const [attributeID, nextValue, previousValue] of candidates) {
    if (Number(nextValue) === Number(previousValue)) {
      continue;
    }

    attributeChanges.push(
      buildAttributeChange(
        session,
        shipID,
        attributeID,
        nextValue,
        previousValue,
        timestamp,
      ),
    );
  }

  return notifyAttributeChanges(session, attributeChanges);
}

function buildShipEntityCore(source, systemID, options = {}) {
  const movement =
    worldData.getMovementAttributesForType(source.typeID) || null;
  const passiveResourceState = source.passiveResourceState || null;
  const spaceState = buildShipSpaceState(source);
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const velocity = cloneVector(spaceState.velocity);
  const targetPoint = cloneVector(
    spaceState.targetPoint,
    addVectors(position, scaleVector(direction, 1.0e16)),
  );
  const maxVelocity =
    toFiniteNumber(passiveResourceState && passiveResourceState.maxVelocity, 0) > 0
      ? toFiniteNumber(passiveResourceState.maxVelocity, 0)
      : toFiniteNumber(movement && movement.maxVelocity, 0) > 0
        ? toFiniteNumber(movement.maxVelocity, 0)
        : 200;
  const warpSpeedAU =
    toFiniteNumber(movement && movement.warpSpeedMultiplier, 0) > 0
      ? toFiniteNumber(movement.warpSpeedMultiplier, 0)
      : 3;
  const resolvedMass =
    toFiniteNumber(passiveResourceState && passiveResourceState.mass, 0) > 0
      ? toFiniteNumber(passiveResourceState.mass, 0)
      : toFiniteNumber(movement && movement.mass, 0) > 0
        ? toFiniteNumber(movement.mass, 0)
        : 1_000_000;
  const resolvedInertia =
    toFiniteNumber(passiveResourceState && passiveResourceState.agility, 0) > 0
      ? toFiniteNumber(passiveResourceState.agility, 0)
      : toFiniteNumber(movement && movement.inertia, 0) > 0
        ? toFiniteNumber(movement.inertia, 0)
        : 1;
  const alignTime = calculateAlignTimeSecondsFromMassInertia(
    resolvedMass,
    resolvedInertia,
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : 3,
  );
  const maxAccelerationTime =
    toFiniteNumber(movement && movement.maxAccelerationTime, 0) > 0
      ? toFiniteNumber(movement.maxAccelerationTime, 0)
      : 6;
  const speedFraction = clamp(
    toFiniteNumber(spaceState.speedFraction, magnitude(velocity) > 0 ? 1 : 0),
    0,
    MAX_SUBWARP_SPEED_FRACTION,
  );
  const mode = normalizeMode(
    spaceState.mode,
    magnitude(velocity) > 0 ? "GOTO" : "STOP",
  );
  const orbitNormal = normalizeVector(
    cloneVector(spaceState.orbitNormal, buildPerpendicular(direction)),
    buildPerpendicular(direction),
  );
  const pendingWarp = buildPendingWarp(spaceState.pendingWarp, position);
  const pilotCharacterID = toInt(
    source.pilotCharacterID,
    toInt(source.characterID, 0),
  );

  const entity = {
    kind: "ship",
    systemID,
    itemID: allocateRuntimeEntityID(source.itemID),
    typeID: source.typeID,
    groupID: toInt(source.groupID, 25),
    categoryID: toInt(source.categoryID, 6),
    itemName: String(source.itemName || source.name || "Ship"),
    ownerID: toInt(
      source.ownerID,
      toInt(source.characterID, toInt(source.corporationID, 0)),
    ),
    slimTypeID: toInt(source.slimTypeID, toInt(source.typeID, 0)),
    slimGroupID: toInt(source.slimGroupID, toInt(source.groupID, 25)),
    slimCategoryID: toInt(source.slimCategoryID, toInt(source.categoryID, 6)),
    slimName: String(
      source.slimName ||
        source.itemName ||
        source.name ||
        "Ship",
    ),
    characterID: toInt(source.characterID, 0),
    pilotCharacterID,
    npcEntityType: source.npcEntityType || null,
    corporationID: toInt(source.corporationID, 0),
    allianceID: toInt(source.allianceID, 0),
    warFactionID: toInt(source.warFactionID, 0),
    skinMaterialSetID:
      options.skinMaterialSetID !== undefined
        ? options.skinMaterialSetID
        : source.skinMaterialSetID ?? null,
    modules: normalizeSlimShipModules(source.modules),
    securityStatus: toFiniteNumber(
      source.securityStatus ?? source.securityRating,
      0,
    ),
    bounty: toFiniteNumber(source.bounty, 0),
    position,
    velocity,
    direction,
    targetPoint,
    mode,
    speedFraction,
    mass: resolvedMass,
    inertia: resolvedInertia,
    radius:
      toFiniteNumber(source && source.radius, 0) > 0
        ? toFiniteNumber(source.radius, 0)
        : toFiniteNumber(movement && movement.radius, 0) > 0
          ? toFiniteNumber(movement.radius, 0)
        : 50,
    maxVelocity,
    alignTime,
    maxAccelerationTime,
    agilitySeconds: deriveAgilitySeconds(
      alignTime,
      maxAccelerationTime,
      resolvedMass,
      resolvedInertia,
    ),
    passiveDerivedState: passiveResourceState,
    maxTargetRange: toFiniteNumber(
      passiveResourceState && passiveResourceState.maxTargetRange,
      0,
    ),
    maxLockedTargets: toFiniteNumber(
      passiveResourceState && passiveResourceState.maxLockedTargets,
      0,
    ),
    signatureRadius: toFiniteNumber(
      passiveResourceState && passiveResourceState.signatureRadius,
      0,
    ),
    cloakingTargetingDelay: toFiniteNumber(
      passiveResourceState && passiveResourceState.cloakingTargetingDelay,
      0,
    ),
    scanResolution: toFiniteNumber(
      passiveResourceState && passiveResourceState.scanResolution,
      0,
    ),
    capacitorCapacity: toFiniteNumber(
      passiveResourceState && passiveResourceState.capacitorCapacity,
      0,
    ),
    capacitorRechargeRate: toFiniteNumber(
      passiveResourceState && passiveResourceState.capacitorRechargeRate,
      0,
    ),
    shieldCapacity: toFiniteNumber(
      passiveResourceState && passiveResourceState.shieldCapacity,
      0,
    ),
    shieldRechargeRate: toFiniteNumber(
      passiveResourceState && passiveResourceState.shieldRechargeRate,
      0,
    ),
    armorHP: toFiniteNumber(passiveResourceState && passiveResourceState.armorHP, 0),
    structureHP: toFiniteNumber(
      passiveResourceState && passiveResourceState.structureHP,
      0,
    ),
    conditionState: normalizeShipConditionState(source && source.conditionState),
    capacitorChargeRatio: clamp(
      toFiniteNumber(source && source.conditionState && source.conditionState.charge, 1),
      0,
      1,
    ),
    warpSpeedAU,
    targetEntityID: toInt(spaceState.targetEntityID, 0) || null,
    followRange: toFiniteNumber(spaceState.followRange, 0),
    orbitDistance: toFiniteNumber(spaceState.orbitDistance, 0),
    orbitNormal,
    orbitSign: toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1,
    bubbleID: null,
    publicGridKey: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    warpState: null,
    pendingWarp,
    dockingTargetID: null,
    pendingDock: null,
    session: options.session || null,
    persistSpaceState: options.persistSpaceState === true,
    lastPersistAt: 0,
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverCorrectionBroadcastStamp: -1,
    lastObserverPositionBroadcastAt: 0,
    lastObserverPositionBroadcastStamp: -1,
    lastWarpCorrectionBroadcastAt: 0,
    lastWarpPositionBroadcastStamp: -1,
    lastPilotWarpStartupGuidanceStamp: 0,
    lastPilotWarpVelocityStamp: 0,
    lastPilotWarpEffectStamp: 0,
    lastPilotWarpCruiseBumpStamp: 0,
    lastPilotWarpMaxSpeedRampIndex: -1,
    lastWarpDiagnosticStamp: 0,
    lastMovementDebugAt: 0,
    lastMotionDebug: null,
    movementTrace: null,
    lockedTargets: new Map(),
    pendingTargetLocks: new Map(),
    targetedBy: new Set(),
    activeModuleEffects: new Map(),
    moduleReactivationLocks: new Map(),
  };

  if (mode === "WARP") {
    entity.warpState =
      buildWarpState(spaceState.warpState, position, warpSpeedAU) ||
      buildPreparingWarpState(entity, pendingWarp);
  }

  return entity;
}

function buildShipEntity(session, shipItem, systemID) {
  const characterData = getCharacterRecord(session && session.characterID) || {};
  const passiveResourceState = buildPassiveShipResourceState(
    session && session.characterID,
    shipItem,
  );
  const initialModules = resolveShipSlimModules({
    kind: "ship",
    itemID: shipItem && shipItem.itemID,
    characterID: session && session.characterID,
    pilotCharacterID: session && session.characterID,
    modules: shipItem && shipItem.modules,
  });
  return buildShipEntityCore({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName || session.shipName || "Ship",
    ownerID: shipItem.ownerID || session.characterID,
    characterID: session.characterID || 0,
    pilotCharacterID: session.characterID || 0,
    corporationID: session.corporationID || 0,
    allianceID: session.allianceID || 0,
    warFactionID: session.warFactionID || 0,
    radius: shipItem.radius,
    conditionState: shipItem.conditionState || {},
    passiveResourceState,
    spaceState: shipItem.spaceState || {},
    modules: initialModules,
    securityStatus:
      characterData.securityStatus ?? characterData.securityRating ?? 0,
    bounty: characterData.bounty ?? 0,
  }, systemID, {
    session,
    persistSpaceState: true,
    skinMaterialSetID: resolveShipSkinMaterialSetID(shipItem),
  });
}

function buildRuntimeShipEntity(shipSpec, systemID, options = {}) {
  const source = shipSpec || {};
  const passiveResourceState =
    source.passiveResourceState ||
    buildPassiveShipResourceState(
      source.pilotCharacterID ?? source.characterID,
      {
        itemID: source.itemID,
        typeID: source.typeID,
        groupID: source.groupID,
        categoryID: source.categoryID,
        itemName: source.itemName,
        radius: source.radius,
      },
      {
        fittedItems: Array.isArray(source.fittedItems) ? source.fittedItems : [],
        skillMap: source.skillMap instanceof Map ? source.skillMap : undefined,
      },
    );

  return buildShipEntityCore({
    ...source,
    passiveResourceState,
  }, systemID, {
    session: options.session || null,
    persistSpaceState: options.persistSpaceState === true,
  });
}

function isPlayerOwnedActiveSpaceShipRecord(shipItem, characterData) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return false;
  }
  if (!characterData) {
    return false;
  }

  const accountID = toInt(characterData.accountId ?? characterData.accountID, 0);
  if (accountID <= 0) {
    return false;
  }

  return toInt(characterData.shipID, 0) === toInt(shipItem.itemID, 0);
}

function isPlayerOwnedPersistedSpaceShipRecord(shipItem, characterData) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return false;
  }
  if (!characterData) {
    return false;
  }

  return toInt(characterData.accountId ?? characterData.accountID, 0) > 0;
}

function buildRuntimePersistedSpaceShipEntity(shipItem, systemID, options = {}) {
  if (!shipItem || toInt(shipItem.categoryID, 0) !== 6 || !shipItem.spaceState) {
    return null;
  }

  const inventoryCharacterID = toInt(shipItem.ownerID, 0);
  const resolveCharacterRecord =
    typeof options.resolveCharacterRecord === "function"
      ? options.resolveCharacterRecord
      : getCharacterRecord;
  const characterData =
    inventoryCharacterID > 0
      ? resolveCharacterRecord(inventoryCharacterID, shipItem) || null
      : null;
  if (
    options.includeOfflinePlayerShips === false &&
    isPlayerOwnedPersistedSpaceShipRecord(shipItem, characterData)
  ) {
    return null;
  }
  const entity = buildRuntimeShipEntity({
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName,
    ownerID: shipItem.ownerID,
    characterID: 0,
    pilotCharacterID: inventoryCharacterID,
    corporationID: toInt(characterData && characterData.corporationID, 0),
    allianceID: toInt(characterData && characterData.allianceID, 0),
    warFactionID: toInt(
      characterData && (characterData.factionID ?? characterData.warFactionID),
      0,
    ),
    conditionState: shipItem.conditionState || {},
    spaceState: shipItem.spaceState || {},
    securityStatus:
      characterData && (characterData.securityStatus ?? characterData.securityRating),
    bounty: characterData && characterData.bounty,
  }, systemID, {
    persistSpaceState: true,
  });

  return refreshShipPresentationFields(entity);
}

function getRuntimeInventoryEntityKind(item) {
  if (!item) {
    return null;
  }

  const metadata = getItemMetadata(item.typeID, item.itemName);
  const groupName = String(metadata && metadata.groupName || "").trim().toLowerCase();
  if (groupName === "wreck") {
    return "wreck";
  }
  if (
    groupName.includes("container") ||
    groupName === "spawn container"
  ) {
    return "container";
  }
  return null;
}

function resolveRuntimeInventoryEntityRadius(kind, item, metadata, fallback = 40) {
  const staticRadius =
    toFiniteNumber(item && item.radius, 0) > 0
      ? toFiniteNumber(item && item.radius, 0)
      : toFiniteNumber(metadata && metadata.radius, 0);
  const explicitSpaceRadius = toFiniteNumber(item && item.spaceRadius, 0);
  if (explicitSpaceRadius > 0) {
    return explicitSpaceRadius;
  }
  if (kind === "wreck") {
    return resolveRuntimeWreckRadius(
      {
        ...metadata,
        itemName: item && item.itemName,
        name: String(item && item.itemName || metadata && metadata.name || "Wreck"),
        radius: staticRadius,
      },
      staticRadius,
    );
  }
  return staticRadius > 0 ? staticRadius : fallback;
}

function resolveRuntimeInventoryEntitySignatureRadius(item, metadata, ballRadius = 0) {
  const typeID = toInt(
    item && item.typeID,
    toInt(metadata && metadata.typeID, 0),
  );
  const typeSignatureRadius = getTypeAttributeValue(typeID, "signatureRadius");
  if (typeSignatureRadius !== null && typeSignatureRadius !== undefined) {
    const resolvedTypeSignatureRadius = toFiniteNumber(typeSignatureRadius, 0);
    if (resolvedTypeSignatureRadius > 0) {
      return resolvedTypeSignatureRadius;
    }
  }

  const runtimeBallRadius = toFiniteNumber(ballRadius, 0);
  if (runtimeBallRadius > 0) {
    return runtimeBallRadius;
  }

  const staticTypeRadius = toFiniteNumber(metadata && metadata.radius, 0);
  if (staticTypeRadius > 0) {
    return staticTypeRadius;
  }

  return 1;
}

function buildRuntimeInventoryEntity(item, systemID, nowMs) {
  if (nowMs === undefined || nowMs === null) {
    log.warn("buildRuntimeInventoryEntity: nowMs not provided, using wallclock fallback — caller should pass scene sim time");
    nowMs = Date.now();
  }
  if (!item || !item.itemID) {
    return null;
  }
  if (
    Number.isFinite(Number(item.expiresAtMs)) &&
    Number(item.expiresAtMs) > 0 &&
    Number(item.expiresAtMs) <= nowMs
  ) {
    return null;
  }

  const kind = getRuntimeInventoryEntityKind(item);
  if (!kind) {
    return null;
  }

  const metadata = getItemMetadata(item.typeID, item.itemName);
  const spaceState = item.spaceState || {};
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const resolvedRadius = resolveRuntimeInventoryEntityRadius(
    kind,
    item,
    metadata,
    40,
  );
  const resolvedSignatureRadius = resolveRuntimeInventoryEntitySignatureRadius(
    item,
    metadata,
    resolvedRadius,
  );

  return {
    kind,
    systemID,
    itemID: allocateRuntimeEntityID(item.itemID),
    typeID: toInt(item.typeID, 0),
    groupID: toInt(item.groupID, toInt(metadata.groupID, 0)),
    categoryID: toInt(item.categoryID, toInt(metadata.categoryID, 0)),
    itemName: String(item.itemName || metadata.name || "Container"),
    ownerID: toInt(item.ownerID, 0),
    position,
    velocity: cloneVector(spaceState.velocity),
    direction,
    targetPoint: cloneVector(spaceState.targetPoint, position),
    mode: normalizeMode(spaceState.mode, "STOP"),
    speedFraction: clamp(toFiniteNumber(spaceState.speedFraction, 0), 0, 1),
    radius: resolvedRadius,
    // Retail lock timing prefers the type dogma signature radius and only
    // falls back to the ball/static radius when that attribute is absent.
    signatureRadius: resolvedSignatureRadius,
    passiveDerivedState: {
      attributes: getTypeDogmaAttributes(item.typeID),
    },
    shieldCapacity: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "shieldCapacity"),
      0,
    )),
    shieldRechargeRate: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "shieldRechargeRate"),
      0,
    )),
    armorHP: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "armorHP"),
      0,
    )),
    structureHP: Math.max(0, toFiniteNumber(
      getTypeAttributeValue(item.typeID, "hp", "structureHP"),
      0,
    )),
    bubbleID: null,
    publicGridKey: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    persistSpaceState: true,
    lastPersistAt: 0,
    spaceState: item.spaceState || null,
    conditionState: normalizeShipConditionState(item.conditionState),
    createdAtMs: toFiniteNumber(item.createdAtMs, 0) || null,
    expiresAtMs: toFiniteNumber(item.expiresAtMs, 0) || null,
    isEmpty: listContainerItems(null, item.itemID).length === 0,
    launcherID: toInt(item.launcherID, 0) || null,
    dunRotation: coerceDunRotationTuple(item.dunRotation),
  };
}

function buildRuntimeSpaceEntityFromItem(item, systemID, nowMs, options = {}) {
  if (toInt(item && item.categoryID, 0) === 6 && item && item.spaceState) {
    return buildRuntimePersistedSpaceShipEntity(item, systemID, options);
  }
  return buildRuntimeInventoryEntity(item, systemID, nowMs);
}

function persistShipEntity(entity) {
  if (!entity || entity.kind !== "ship" || entity.persistSpaceState !== true) {
    return;
  }

  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
    conditionState: normalizeShipConditionState(entity.conditionState),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ship ${entity.itemID}: ${result.errorMsg}`,
    );
  }

  entity.lastPersistAt = Date.now();
}

function persistInventoryBackedEntity(entity) {
  if (!isInventoryBackedDynamicEntity(entity) || entity.persistSpaceState !== true) {
    return;
  }

  const result = updateInventoryItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
    conditionState: normalizeShipConditionState(entity.conditionState),
    createdAtMs: toFiniteNumber(entity.createdAtMs, 0) || null,
    expiresAtMs: toFiniteNumber(entity.expiresAtMs, 0) || null,
    launcherID: toInt(entity.launcherID, 0) || null,
    dunRotation: coerceDunRotationTuple(entity.dunRotation),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ${entity.kind} ${entity.itemID}: ${result.errorMsg}`,
    );
    return;
  }

  entity.lastPersistAt = Date.now();
}

function persistDynamicEntity(entity) {
  if (!entity) {
    return;
  }
  if (entity.kind === "ship") {
    persistShipEntity(entity);
    return;
  }
  persistInventoryBackedEntity(entity);
}

function clearTrackingState(entity) {
  entity.targetEntityID = null;
  entity.followRange = 0;
  entity.orbitDistance = 0;
  entity.warpState = null;
  entity.pendingWarp = null;
  entity.dockingTargetID = null;
  entity.lastPilotWarpStartupGuidanceStamp = 0;
  entity.lastPilotWarpVelocityStamp = 0;
  entity.lastPilotWarpEffectStamp = 0;
  entity.lastPilotWarpCruiseBumpStamp = 0;
  entity.lastPilotWarpMaxSpeedRampIndex = -1;
  entity.lastWarpDiagnosticStamp = 0;
}

function resetEntityMotion(entity) {
  clearTrackingState(entity);
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetPoint = cloneVector(entity.position);
}

function buildUndockMovement(entity, direction, speedFraction = 1) {
  clearTrackingState(entity);
  entity.direction = normalizeVector(direction, entity.direction);
  entity.targetPoint = addVectors(
    cloneVector(entity.position),
    scaleVector(entity.direction, 1.0e16),
  );
  entity.speedFraction = clamp(speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  entity.mode = "GOTO";
  entity.velocity = { x: 0, y: 0, z: 0 };
}

function rotateDirectionToward(
  currentDirection,
  targetDirection,
  deltaSeconds,
  agilitySeconds,
  currentSpeedFraction = 0,
) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const turnMetrics = getTurnMetrics(current, target);
  const degrees = (turnMetrics.radians * 180) / Math.PI;

  if (!Number.isFinite(turnMetrics.radians) || turnMetrics.radians <= TURN_ALIGNMENT_RADIANS) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Destiny turns much faster than it changes speed, and from near-rest the
  // client effectively snaps to the requested heading before accelerating.
  if (currentSpeedFraction <= 0.1) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Match the classic destiny turn shape more closely than a slow exponential
  // blend: heading changes in noticeable per-tick steps and large turns begin
  // by shedding speed while the nose swings through the arc.
  const degPerTick = deriveTurnDegreesPerTick(agilitySeconds);
  const tickScale = Math.max(deltaSeconds / 0.1, 0.05);
  const maxStepDegrees = degPerTick * tickScale;
  const turnPercent = clamp(maxStepDegrees / Math.max(degrees, 0.001), 0.001, 1);
  const turnSeconds = Math.max(agilitySeconds / 2.2, 0.05);
  return {
    direction: slerpDirection(current, target, turnPercent, turnMetrics.radians),
    degrees,
    turnFraction: turnMetrics.turnFraction,
    turnPercent,
    degPerTick,
    maxStepDegrees,
    turnSeconds,
    snapped: false,
  };
}

function deriveTurnSpeedCap(turnMetrics) {
  const baseCap = clamp(toFiniteNumber(turnMetrics && turnMetrics.turnFraction, 1), 0.1, 1);
  const radians = Math.max(0, toFiniteNumber(turnMetrics && turnMetrics.radians, 0));

  if (radians >= (2 * Math.PI) / 3) {
    return Math.max(0.12, baseCap ** 3);
  }
  if (radians >= Math.PI / 4) {
    return Math.max(0.15, baseCap ** 2);
  }

  return baseCap;
}

function applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds) {
  const previousPosition = cloneVector(entity.position);
  const previousVelocity = cloneVector(entity.velocity);
  const headingSource = normalizeVector(entity.direction, desiredDirection);
  const targetDirection = normalizeVector(desiredDirection, headingSource);
  const agilitySeconds = Math.max(
    toFiniteNumber(entity.agilitySeconds, 0) ||
      deriveAgilitySeconds(
        entity.alignTime,
        entity.maxAccelerationTime,
        entity.mass,
        entity.inertia,
      ),
    0.05,
  );
  const currentSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, magnitude(entity.velocity) / entity.maxVelocity)
      : 0;
  const targetSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, desiredSpeed / entity.maxVelocity)
      : 0;
  const currentAlignmentDirection = getCurrentAlignmentDirection(
    entity,
    targetDirection,
  );
  const turnMetrics = getTurnMetrics(currentAlignmentDirection, targetDirection);
  const desiredVelocity = scaleVector(targetDirection, Math.max(0, desiredSpeed));
  const integration = integrateVelocityTowardTarget(
    previousVelocity,
    desiredVelocity,
    agilitySeconds,
    deltaSeconds,
  );
  const nextSpeed = magnitude(integration.nextVelocity);
  const nextSpeedFraction =
    entity.maxVelocity > 0 ? Math.max(0, nextSpeed / entity.maxVelocity) : 0;

  const turnStep = rotateDirectionToward(
    headingSource,
    targetDirection,
    deltaSeconds,
    agilitySeconds,
    currentSpeedFraction,
  );
  entity.direction =
    nextSpeed > 0.05
      ? normalizeVector(integration.nextVelocity, turnStep.direction)
      : turnStep.direction;
  entity.velocity =
    nextSpeed <= 0.05
      ? { x: 0, y: 0, z: 0 }
      : integration.nextVelocity;
  if (desiredSpeed <= 0.001 && magnitude(entity.velocity) < 0.1) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }

  entity.position = addVectors(entity.position, integration.positionDelta);
  const positionDelta = subtractVectors(entity.position, previousPosition);
  const velocityDelta = subtractVectors(entity.velocity, previousVelocity);
  const appliedTurnMetrics = getTurnMetrics(currentAlignmentDirection, entity.direction);
  entity.lastTurnMetrics = {
    degrees: roundNumber(turnStep.degrees, 2),
    appliedDegrees: roundNumber((appliedTurnMetrics.radians * 180) / Math.PI, 2),
    turnFraction: roundNumber(turnMetrics.turnFraction, 3),
    currentSpeedFraction: roundNumber(currentSpeedFraction, 3),
    targetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    effectiveTargetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    turnSpeedCap: roundNumber(targetSpeedFraction, 3),
    speedDeltaFraction: roundNumber(
      Math.abs(currentSpeedFraction - targetSpeedFraction),
      3,
    ),
    speedResponseSeconds: roundNumber(agilitySeconds, 3),
    agilitySeconds: roundNumber(agilitySeconds, 3),
    exponentialDecay: roundNumber(integration.decay, 6),
    degPerTick: roundNumber(turnStep.degPerTick, 3),
    maxStepDegrees: roundNumber(turnStep.maxStepDegrees, 3),
    turnPercent: roundNumber(turnStep.turnPercent, 3),
    turnSeconds: roundNumber(turnStep.turnSeconds, 3),
    snapped: Boolean(turnStep.snapped),
  };
  entity.lastMotionDebug = {
    deltaSeconds: roundNumber(deltaSeconds, 4),
    previousPosition: summarizeVector(previousPosition),
    positionDelta: summarizeVector(positionDelta),
    previousVelocity: summarizeVector(previousVelocity),
    velocityDelta: summarizeVector(velocityDelta),
    headingSource: summarizeVector(currentAlignmentDirection),
    desiredDirection: summarizeVector(targetDirection),
    currentSpeed: roundNumber(magnitude(previousVelocity), 3),
    desiredSpeed: roundNumber(desiredSpeed, 3),
    nextSpeed: roundNumber(magnitude(entity.velocity), 3),
    turnAngleDegrees: roundNumber((turnMetrics.radians * 180) / Math.PI, 2),
    remainingTurnDegrees: roundNumber(turnStep.degrees, 2),
  };

  return {
    changed:
      distance(previousPosition, entity.position) > 1 ||
      distance(previousVelocity, entity.velocity) > 0.5,
  };
}

function advanceGotoMovement(entity, deltaSeconds) {
  const desiredDirection = getCommandDirection(entity, entity.direction);
  const desiredSpeed =
    entity.maxVelocity * clamp(entity.speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function advanceFollowMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.dockingTargetID = null;
    return { changed: true };
  }

  const motionProfile = getFollowMotionProfile(entity, target);
  const targetPoint = motionProfile.targetPoint;
  const separation = subtractVectors(targetPoint, entity.position);
  const currentDistance = magnitude(separation);
  const desiredRange = Math.max(
    0,
    toFiniteNumber(entity.followRange, 0) +
      entity.radius +
      motionProfile.rangeRadius,
  );
  const gap = currentDistance - desiredRange;
  const targetSpeed = magnitude(target.velocity || { x: 0, y: 0, z: 0 });
  const desiredDirection =
    gap > 50
      ? normalizeVector(separation, entity.direction)
      : normalizeVector(target.velocity, normalizeVector(separation, entity.direction));
  const desiredSpeed =
    gap > 50
      ? Math.min(
          entity.maxVelocity,
          Math.max(targetSpeed, Math.max(gap * 0.5, entity.maxVelocity * 0.25)),
        )
      : Math.min(entity.maxVelocity, targetSpeed);

  entity.targetPoint = targetPoint;
  const movementResult = applyDesiredVelocity(
    entity,
    desiredDirection,
    desiredSpeed,
    deltaSeconds,
  );

  return movementResult;
}

function advanceOrbitMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    return { changed: true };
  }

  const radialVector = subtractVectors(entity.position, target.position);
  const radialDirection = normalizeVector(radialVector, buildPerpendicular(entity.direction));
  let orbitNormal = normalizeVector(entity.orbitNormal, buildPerpendicular(radialDirection));
  if (Math.abs(dotProduct(orbitNormal, radialDirection)) > 0.95) {
    orbitNormal = buildPerpendicular(radialDirection);
  }

  const tangentDirection = normalizeVector(
    scaleVector(crossProduct(orbitNormal, radialDirection), entity.orbitSign || 1),
    entity.direction,
  );
  const currentDistance = magnitude(radialVector);
  const desiredDistance = Math.max(
    toFiniteNumber(entity.orbitDistance, 0) + entity.radius + (target.radius || 0),
    entity.radius + (target.radius || 0) + 500,
  );
  const radialError = currentDistance - desiredDistance;
  const correction = scaleVector(
    radialDirection,
    clamp(-radialError / Math.max(desiredDistance, 1), -0.75, 0.75),
  );
  const desiredDirection = normalizeVector(
    addVectors(tangentDirection, correction),
    tangentDirection,
  );
  const desiredSpeed = clamp(
    Math.max(entity.maxVelocity * 0.35, Math.abs(radialError) * 0.5),
    0,
    entity.maxVelocity,
  );

  entity.orbitNormal = orbitNormal;
  entity.targetPoint = addVectors(
    target.position,
    scaleVector(radialDirection, desiredDistance),
  );
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function buildWarpProfile(entity, destination, options = {}) {
  const rawDestination = cloneVector(destination, entity.position);
  const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
  const travelVector = subtractVectors(rawDestination, entity.position);
  const direction = normalizeVector(travelVector, entity.direction);
  const targetPoint = subtractVectors(rawDestination, scaleVector(direction, stopDistance));
  const totalDistance = distance(entity.position, targetPoint);
  if (totalDistance < MIN_WARP_DISTANCE_METERS) {
    return null;
  }

  const warpSpeedAU =
    toFiniteNumber(options.warpSpeedAU, 0) > 0
      ? toFiniteNumber(options.warpSpeedAU, 0)
      : entity.warpSpeedAU;
  const cruiseWarpSpeedMs = Math.max(warpSpeedAU * ONE_AU_IN_METERS, 10000);
  const accelRate = getWarpAccelRate(warpSpeedAU);
  const decelRate = getWarpDecelRate(warpSpeedAU);
  const warpDropoutSpeedMs = getWarpDropoutSpeedMs(entity);

  let profileType = "long";
  let accelDistance = 0;
  let cruiseDistance = 0;
  let decelDistance = 0;
  let accelTimeMs = 0;
  let cruiseTimeMs = 0;
  let decelTimeMs = 0;
  let maxWarpSpeedMs = cruiseWarpSpeedMs;
  const accelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / accelRate, 0);
  const decelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / decelRate, 0);
  const shortWarpDistanceThreshold = accelDistanceAtCruise + decelDistanceAtCruise;

  if (totalDistance < shortWarpDistanceThreshold) {
    profileType = "short";
    maxWarpSpeedMs =
      (totalDistance * accelRate * decelRate) /
      Math.max(accelRate + decelRate, 0.001);
    accelDistance = Math.max(maxWarpSpeedMs / accelRate, 0);
    decelDistance = Math.max(maxWarpSpeedMs / decelRate, 0);
    accelTimeMs =
      (Math.log(Math.max(maxWarpSpeedMs / accelRate, 1)) /
        accelRate) *
      1000;
    decelTimeMs =
      (Math.log(Math.max(maxWarpSpeedMs / warpDropoutSpeedMs, 1)) /
        decelRate) *
      1000;
  } else {
    accelDistance = accelDistanceAtCruise;
    decelDistance = decelDistanceAtCruise;
    accelTimeMs =
      (Math.log(Math.max(cruiseWarpSpeedMs / accelRate, 1)) /
        accelRate) *
      1000;
    decelTimeMs =
      (Math.log(Math.max(cruiseWarpSpeedMs / warpDropoutSpeedMs, 1)) /
        decelRate) *
      1000;
    cruiseDistance = Math.max(
      totalDistance - accelDistance - decelDistance,
      0,
    );
    cruiseTimeMs = (cruiseDistance / cruiseWarpSpeedMs) * 1000;
  }

  return {
    startTimeMs: toFiniteNumber(options.nowMs, Date.now()),
    durationMs:
      accelTimeMs +
      cruiseTimeMs +
      decelTimeMs +
      Math.max(WARP_NATIVE_DECEL_GRACE_MS, 0),
    accelTimeMs,
    cruiseTimeMs,
    decelTimeMs,
    totalDistance,
    stopDistance,
    maxWarpSpeedMs,
    cruiseWarpSpeedMs,
    warpFloorSpeedMs: warpDropoutSpeedMs,
    warpDropoutSpeedMs,
    accelDistance,
    cruiseDistance,
    decelDistance,
    accelExponent: accelRate,
    decelExponent: decelRate,
    accelRate,
    decelRate,
    // DLL solver uses tau0 = ball98 * 0.001, so ball98 = warpSpeedAU * 1000
    // to match server-side kAccel = warpSpeedAU.
    warpSpeed: Math.max(1, Math.round(warpSpeedAU * 1000)),
    commandStamp: toInt(options.commandStamp, 0),
    startupGuidanceStamp: toInt(options.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      options.startupGuidanceVelocity,
      entity.velocity,
    ),
    cruiseBumpStamp: toInt(options.cruiseBumpStamp, 0),
    effectStamp: toInt(options.effectStamp, toInt(options.defaultEffectStamp, 0)),
    targetEntityID: toInt(options.targetEntityID, 0),
    // The live client expects opaque warp markers here, not echoed target ids
    // or stop distances.
    followID: toFiniteNumber(options.followID, 15000),
    followRangeMarker: toFiniteNumber(options.followRangeMarker, -1),
    profileType,
    origin: cloneVector(entity.position),
    rawDestination,
    targetPoint,
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(options.pilotMaxSpeedRamp),
  };
}

function buildPendingWarp(rawPendingWarp, position = { x: 0, y: 0, z: 0 }) {
  if (!rawPendingWarp || typeof rawPendingWarp !== "object") {
    return null;
  }

  return {
    requestedAtMs: toInt(rawPendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(rawPendingWarp.preWarpSyncStamp, 0),
    stopDistance: Math.max(0, toFiniteNumber(rawPendingWarp.stopDistance, 0)),
    totalDistance: Math.max(0, toFiniteNumber(rawPendingWarp.totalDistance, 0)),
    warpSpeedAU: Math.max(0, toFiniteNumber(rawPendingWarp.warpSpeedAU, 0)),
    rawDestination: cloneVector(rawPendingWarp.rawDestination, position),
    targetPoint: cloneVector(rawPendingWarp.targetPoint, position),
    targetEntityID: toInt(rawPendingWarp.targetEntityID, 0) || null,
  };
}

function buildPendingWarpRequest(entity, destination, options = {}) {
  const rawDestination = cloneVector(destination, entity.position);
  const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
  const travelVector = subtractVectors(rawDestination, entity.position);
  const direction = normalizeVector(travelVector, entity.direction);
  const targetPoint = subtractVectors(
    rawDestination,
    scaleVector(direction, stopDistance),
  );
  const totalDistance = distance(entity.position, targetPoint);
  if (totalDistance < MIN_WARP_DISTANCE_METERS) {
    return null;
  }

  const warpSpeedAU =
    toFiniteNumber(options.warpSpeedAU, 0) > 0
      ? toFiniteNumber(options.warpSpeedAU, 0)
      : entity.warpSpeedAU;

  return {
    requestedAtMs: toFiniteNumber(options.nowMs, Date.now()),
    preWarpSyncStamp: 0,
    stopDistance,
    totalDistance,
    warpSpeedAU,
    rawDestination,
    targetPoint,
    targetEntityID: toInt(options.targetEntityID, 0) || null,
  };
}

function buildDirectedMovementUpdates(
  entity,
  commandDirection,
  speedFractionChanged,
  movementStamp,
) {
  const updates = [
    {
      stamp: movementStamp,
      payload: destiny.buildGotoDirectionPayload(entity.itemID, commandDirection),
    },
  ];
  if (speedFractionChanged) {
    updates.push({
      stamp: updates[0].stamp,
      payload: destiny.buildSetSpeedFractionPayload(
        entity.itemID,
        entity.speedFraction,
      ),
    });
  }
  return updates;
}

function buildPreparingWarpState(entity, pendingWarp, options = {}) {
  const warpState = buildWarpProfile(entity, pendingWarp && pendingWarp.rawDestination, {
    stopDistance: pendingWarp && pendingWarp.stopDistance,
    targetEntityID: pendingWarp && pendingWarp.targetEntityID,
    warpSpeedAU: pendingWarp && pendingWarp.warpSpeedAU,
    nowMs:
      options.nowMs === undefined || options.nowMs === null
        ? pendingWarp && pendingWarp.requestedAtMs
        : options.nowMs,
    commandStamp: 0,
    startupGuidanceStamp: 0,
    startupGuidanceVelocity: entity && entity.velocity,
    cruiseBumpStamp: 0,
    effectStamp: -1,
    defaultEffectStamp: toInt(options.defaultEffectStamp, 0),
  });
  if (!warpState) {
    return null;
  }

  warpState.commandStamp = 0;
  warpState.startupGuidanceAtMs = 0;
  warpState.startupGuidanceStamp = 0;
  warpState.startupGuidanceVelocity = cloneVector(
    entity && entity.velocity,
    { x: 0, y: 0, z: 0 },
  );
  warpState.cruiseBumpAtMs = 0;
  warpState.cruiseBumpStamp = 0;
  warpState.effectAtMs = 0;
  warpState.effectStamp = -1;
  warpState.pilotMaxSpeedRamp = [];
  return warpState;
}

function refreshPreparingWarpState(entity) {
  if (!entity || !entity.pendingWarp) {
    return null;
  }

  const refreshed = buildPreparingWarpState(entity, entity.pendingWarp);
  if (refreshed) {
    entity.warpState = refreshed;
  }
  return refreshed;
}

function evaluatePendingWarp(entity, pendingWarp, now = Date.now()) {
  const desiredDirection = normalizeVector(
    subtractVectors(pendingWarp.targetPoint, entity.position),
    entity.direction,
  );
  const alignmentDirection = getCurrentAlignmentDirection(
    entity,
    desiredDirection,
  );
  const turnMetrics = getTurnMetrics(alignmentDirection, desiredDirection);
  const degrees = (turnMetrics.radians * 180) / Math.PI;
  const actualSpeedFraction = getActualSpeedFraction(entity);
  const alignTimeMs = Math.max(
    1000,
    toFiniteNumber(entity.alignTime, 0) * 1000,
  );
  const elapsedMs = Math.max(
    0,
    toInt(now, Date.now()) - toInt(pendingWarp.requestedAtMs, 0),
  );
  const forced = elapsedMs >= (alignTimeMs + 300);
  return {
    ready:
      (Number.isFinite(degrees) &&
        degrees <= (WARP_ALIGNMENT_RADIANS * 180) / Math.PI &&
        actualSpeedFraction >= WARP_ENTRY_SPEED_FRACTION) ||
      forced,
    forced,
    degrees: roundNumber(degrees, 3),
    actualSpeedFraction: roundNumber(actualSpeedFraction, 3),
    elapsedMs,
    desiredDirection,
    alignmentDirection,
  };
}

function getPilotWarpActivationVelocity(entity, warpState) {
  if (!warpState) {
    return { x: 0, y: 0, z: 0 };
  }

  const direction = normalizeVector(
    subtractVectors(warpState.targetPoint, entity.position),
    entity.direction,
  );
  const startupGuidanceVelocity = cloneVector(
    warpState && warpState.startupGuidanceVelocity,
    entity && entity.velocity,
  );
  const activationSpeed = magnitude(startupGuidanceVelocity);
  if (activationSpeed <= 0.5) {
    return { x: 0, y: 0, z: 0 };
  }
  return scaleVector(direction, activationSpeed);
}

function activatePendingWarp(entity, pendingWarp, options = {}) {
  const startupGuidanceVelocity = cloneVector(entity.velocity);
  const warpState = buildWarpProfile(entity, pendingWarp.rawDestination, {
    stopDistance: pendingWarp.stopDistance,
    targetEntityID: pendingWarp.targetEntityID,
    warpSpeedAU: pendingWarp.warpSpeedAU,
    nowMs: toFiniteNumber(options.nowMs, pendingWarp && pendingWarp.requestedAtMs),
    commandStamp: 0,
    startupGuidanceStamp: 0,
    startupGuidanceVelocity,
    cruiseBumpStamp: 0,
    effectStamp: 0,
    defaultEffectStamp: toInt(options.defaultEffectStamp, 0),
  });
  if (!warpState) {
    return null;
  }

  entity.mode = "WARP";
  entity.speedFraction = 1;
  entity.direction = normalizeVector(
    subtractVectors(warpState.targetPoint, entity.position),
    entity.direction,
  );
  entity.targetPoint = cloneVector(warpState.targetPoint);
  entity.targetEntityID = warpState.targetEntityID || null;
  entity.warpState = warpState;
  entity.pendingWarp = null;
  entity.velocity = getPilotWarpActivationVelocity(entity, warpState);
  entity.lastWarpCorrectionBroadcastAt = 0;
  entity.lastWarpPositionBroadcastStamp = -1;
  entity.lastPilotWarpStartupGuidanceStamp = 0;
  entity.lastPilotWarpVelocityStamp = 0;
  entity.lastPilotWarpEffectStamp = 0;
  entity.lastPilotWarpCruiseBumpStamp = 0;
  entity.lastPilotWarpMaxSpeedRampIndex = -1;
  entity.lastWarpDiagnosticStamp = 0;
  return warpState;
}

function getWarpProgress(warpState, now) {
  const elapsedMs = Math.max(0, toFiniteNumber(now, Date.now()) - warpState.startTimeMs);
  const accelMs = warpState.accelTimeMs;
  const cruiseMs = warpState.cruiseTimeMs;
  const decelMs = warpState.decelTimeMs;
  const resolvedWarpSpeedAU = Math.max(
    toFiniteNumber(warpState.warpSpeed, 0) / 1000,
    toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
    0.001,
  );
  const accelRate = Math.max(
    toFiniteNumber(warpState.accelRate, 0) ||
      toFiniteNumber(warpState.accelExponent, 0) ||
      getWarpAccelRate(resolvedWarpSpeedAU),
    0.001,
  );
  const decelRate = Math.max(
    toFiniteNumber(warpState.decelRate, 0) ||
      toFiniteNumber(warpState.decelExponent, 0) ||
      getWarpDecelRate(resolvedWarpSpeedAU),
    0.001,
  );
  const maxWarpSpeedMs = Math.max(toFiniteNumber(warpState.maxWarpSpeedMs, 0), 0);
  const warpDropoutSpeedMs = Math.max(
    Math.min(
      toFiniteNumber(
        warpState.warpDropoutSpeedMs,
        toFiniteNumber(warpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
      ),
      maxWarpSpeedMs || 1,
    ),
    1,
  );
  const accelDistance = Math.max(toFiniteNumber(warpState.accelDistance, 0), 0);
  const cruiseDistance = Math.max(toFiniteNumber(warpState.cruiseDistance, 0), 0);
  const decelDistance = Math.max(toFiniteNumber(warpState.decelDistance, 0), 0);
  const cruiseWarpSpeedMs = Math.max(
    toFiniteNumber(warpState.cruiseWarpSpeedMs, maxWarpSpeedMs),
    0,
  );
  const decelSeconds = Math.max(decelMs / 1000, 0);
  const decelStartMs = accelMs + cruiseMs;

  if (elapsedMs >= warpState.durationMs) {
    return { complete: true, traveled: warpState.totalDistance, speed: 0 };
  }

  if (elapsedMs < accelMs) {
    const seconds = elapsedMs / 1000;
    const speed = Math.min(
      maxWarpSpeedMs,
      accelRate * Math.exp(accelRate * seconds),
    );
    return {
      complete: false,
      traveled: Math.min(
        accelDistance,
        Math.max(speed / accelRate, 0),
      ),
      speed,
    };
  }

  if (elapsedMs < accelMs + cruiseMs) {
    const seconds = (elapsedMs - accelMs) / 1000;
    return {
      complete: false,
      traveled: accelDistance + (cruiseWarpSpeedMs * seconds),
      speed: cruiseWarpSpeedMs,
    };
  }

  const seconds = Math.min(
    (elapsedMs - decelStartMs) / 1000,
    decelSeconds,
  );
  const speed = Math.max(
    warpDropoutSpeedMs,
    maxWarpSpeedMs * Math.exp(-decelRate * seconds),
  );
  const progress = {
    complete: false,
    traveled:
      accelDistance +
      cruiseDistance +
      Math.min(
        decelDistance,
        Math.max((maxWarpSpeedMs - speed) / decelRate, 0),
      ),
    speed,
  };
  const remainingDistance = Math.max(
    toFiniteNumber(warpState.totalDistance, 0) - progress.traveled,
    0,
  );
  if (remainingDistance <= getWarpCompletionDistance(warpState)) {
    return {
      complete: true,
      traveled: warpState.totalDistance,
      speed: 0,
    };
  }
  return progress;
}

function getWarpStopDistanceForTarget(shipEntity, targetEntity, minimumRange = 0) {
  const targetRadius = Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0));
  const desiredRange = Math.max(0, toFiniteNumber(minimumRange, 0));

  switch (targetEntity && targetEntity.kind) {
    case "planet":
    case "moon":
      return Math.max(targetRadius + 1000000, desiredRange) + (shipEntity.radius * 2);
    case "sun":
      return Math.max(targetRadius + 5000000, desiredRange) + (shipEntity.radius * 2);
    case "station":
      return targetRadius + desiredRange + (shipEntity.radius * 2);
    case "stargate":
      return Math.max(Math.max(2500, targetRadius * 0.3), desiredRange) + (shipEntity.radius * 2);
    default:
      return Math.max(Math.max(1000, targetRadius), desiredRange) + (shipEntity.radius * 2);
  }
}

function advanceMovement(entity, scene, deltaSeconds, now) {
  switch (entity.mode) {
    case "STOP":
      return applyDesiredVelocity(entity, entity.direction, 0, deltaSeconds);
    case "GOTO":
      return advanceGotoMovement(entity, deltaSeconds);
    case "FOLLOW":
      return advanceFollowMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "ORBIT":
      return advanceOrbitMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "WARP": {
      if (entity.pendingWarp) {
        const result = advanceGotoMovement(entity, deltaSeconds);
        refreshPreparingWarpState(entity);
        return result;
      }
      if (!entity.warpState) {
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.velocity = { x: 0, y: 0, z: 0 };
        entity.targetPoint = cloneVector(entity.position);
        return { changed: false };
      }

      const previousPosition = cloneVector(entity.position);
      const previousVelocity = cloneVector(entity.velocity);
      const progress = getWarpProgress(entity.warpState, now);
      const direction = normalizeVector(
        subtractVectors(entity.warpState.targetPoint, entity.warpState.origin),
        entity.direction,
      );
      entity.direction = direction;
      entity.position = progress.complete
        ? cloneVector(entity.warpState.targetPoint)
        : addVectors(
            entity.warpState.origin,
            scaleVector(direction, progress.traveled),
          );
      entity.velocity = progress.complete
        ? { x: 0, y: 0, z: 0 }
        : scaleVector(direction, progress.speed);

      if (progress.complete) {
        const completedWarpState = serializeWarpState({
          warpState: entity.warpState,
          position: entity.position,
        });
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.targetPoint = cloneVector(entity.position);
        entity.warpState = null;
        return {
          changed:
            distance(previousPosition, entity.position) > 1 ||
            distance(previousVelocity, entity.velocity) > 0.5,
          warpCompleted: true,
          completedWarpState,
        };
      }

      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
      };
    }
    default:
      return { changed: false };
  }
}

class SolarSystemScene {
  constructor(systemID) {
    this.systemID = Number(systemID);
    this.system = worldData.getSolarSystemByID(this.systemID);
    this.sessions = new Map();
    this.dynamicEntities = new Map();
    this.publicGridClustersByBoxKey = new Map();
    this.publicGridOccupiedBoxes = new Map();
    this.publicGridCompositionDirty = true;
    this.bubbles = new Map();
    this.nextBubbleID = 1;
    this.nextTargetSequence = 1;
    this.lastWallclockTickAt = Date.now();
    this.simTimeMs = this.lastWallclockTickAt;
    this.timeDilation = 1;
    this.nextStamp = getCurrentDestinyStamp(this.simTimeMs);
    this.lastSimClockBroadcastWallclockAt = this.lastWallclockTickAt;
    this.staticEntities = [];
    this.staticEntitiesByID = new Map();

    for (const station of worldData.getStationsForSystem(this.systemID)) {
      const entity = buildStaticStationEntity(station);
      this.addStaticEntity(entity);
    }
    for (const celestial of worldData.getCelestialsForSystem(this.systemID)) {
      const entity = buildStaticCelestialEntity(celestial);
      this.addStaticEntity(entity);
    }
    if (INCLUDE_STARGATES_IN_SCENE) {
      for (const stargate of worldData.getStargatesForSystem(this.systemID)) {
        const entity = buildStaticStargateEntity(stargate);
        this.addStaticEntity(entity);
      }
    }

    for (const item of listSystemSpaceItems(this.systemID)) {
      const entity = buildRuntimeSpaceEntityFromItem(
        item,
        this.systemID,
        this.getCurrentSimTimeMs(),
        {
          // Fresh scenes should not resurrect persisted player-owned ships for
          // bystanders. The owning pilot is reattached explicitly on login,
          // and other player hulls should not leak back into space on restart.
          includeOfflinePlayerShips: false,
        },
      );
      if (!entity) {
        continue;
      }
      this.dynamicEntities.set(entity.itemID, entity);
      this.reconcileEntityPublicGrid(entity);
      this.reconcileEntityBubble(entity);
    }
    this.ensurePublicGridComposition();
  }

  addStaticEntity(entity) {
    if (!entity || !entity.itemID) {
      return false;
    }

    const normalizedItemID = Number(entity.itemID);
    if (!Number.isInteger(normalizedItemID) || normalizedItemID <= 0) {
      return false;
    }

    if (this.staticEntitiesByID.has(normalizedItemID)) {
      return false;
    }

    this.staticEntities.push(entity);
    this.staticEntitiesByID.set(normalizedItemID, entity);
    this.reconcileEntityPublicGrid(entity);
    if (isBubbleScopedStaticEntity(entity)) {
      this.reconcileEntityBubble(entity);
    }
    this.publicGridCompositionDirty = true;
    return true;
  }

  getCurrentWallclockMs() {
    return Date.now();
  }

  getCurrentSimTimeMs() {
    return this.peekSimTimeForWallclock();
  }

  peekSimTimeForWallclock(wallclockNow = this.getCurrentWallclockMs()) {
    const normalizedWallclockNow = toFiniteNumber(
      wallclockNow,
      this.getCurrentWallclockMs(),
    );
    const lastWallclockTickAt = toFiniteNumber(
      this.lastWallclockTickAt,
      normalizedWallclockNow,
    );
    const wallclockDeltaMs = Math.max(0, normalizedWallclockNow - lastWallclockTickAt);
    return Math.max(
      0,
      toFiniteNumber(this.simTimeMs, normalizedWallclockNow) +
        (wallclockDeltaMs * clampTimeDilationFactor(this.timeDilation)),
    );
  }

  advanceClock(wallclockNow = this.getCurrentWallclockMs()) {
    const normalizedWallclockNow = toFiniteNumber(
      wallclockNow,
      this.getCurrentWallclockMs(),
    );
    const nextSimTimeMs = this.peekSimTimeForWallclock(normalizedWallclockNow);
    const previousSimTimeMs = Math.max(0, toFiniteNumber(this.simTimeMs, normalizedWallclockNow));
    const previousWallclockTickAt = toFiniteNumber(
      this.lastWallclockTickAt,
      normalizedWallclockNow,
    );
    this.lastWallclockTickAt = normalizedWallclockNow;
    this.simTimeMs = nextSimTimeMs;
    return {
      wallclockNowMs: normalizedWallclockNow,
      wallclockDeltaMs: Math.max(0, normalizedWallclockNow - previousWallclockTickAt),
      simNowMs: nextSimTimeMs,
      simDeltaMs: Math.max(0, nextSimTimeMs - previousSimTimeMs),
    };
  }

  getCurrentFileTime() {
    return toFileTimeFromMs(this.getCurrentSimTimeMs(), currentFileTime());
  }

  toFileTimeFromSimMs(value, fallback = this.getCurrentFileTime()) {
    return toFileTimeFromMs(value, fallback);
  }

  getSessionClockOffsetMs(session) {
    if (!session || !session._space) {
      return 0;
    }
    return toFiniteNumber(session._space.clockOffsetMs, 0);
  }

  getLastSentDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    if (!session || !session._space) {
      return toInt(fallbackStamp, 0) >>> 0;
    }
    const fallback = toInt(fallbackStamp, 0) >>> 0;
    const lastSentStamp = toInt(session._space.lastSentDestinyStamp, fallback) >>> 0;
    return lastSentStamp > fallback ? fallback : lastSentStamp;
  }

  getImmediateDestinyStampForSession(
    session,
    fallbackStamp = this.getCurrentDestinyStamp(),
  ) {
    const currentStamp = toInt(fallbackStamp, this.getCurrentDestinyStamp()) >>> 0;
    const previousStamp = currentStamp > 0 ? ((currentStamp - 1) >>> 0) : currentStamp;
    if (!session || !session._space) {
      return previousStamp;
    }
    const lastVisibleStamp = toInt(
      session._space.lastSentDestinyStamp,
      previousStamp,
    ) >>> 0;
    return lastVisibleStamp > previousStamp
      ? lastVisibleStamp
      : previousStamp;
  }

  translateSimTimeForSession(session, rawSimTimeMs) {
    const normalizedRawSimTimeMs = toFiniteNumber(
      rawSimTimeMs,
      this.getCurrentSimTimeMs(),
    );
    return roundNumber(
      normalizedRawSimTimeMs + this.getSessionClockOffsetMs(session),
      3,
    );
  }

  getCurrentSessionSimTimeMs(session, rawSimTimeMs = this.getCurrentSimTimeMs()) {
    return this.translateSimTimeForSession(session, rawSimTimeMs);
  }

  getCurrentSessionFileTime(session, rawSimTimeMs = this.getCurrentSimTimeMs()) {
    const currentSessionSimTimeMs = this.getCurrentSessionSimTimeMs(
      session,
      rawSimTimeMs,
    );
    return toFileTimeFromMs(currentSessionSimTimeMs, this.getCurrentFileTime());
  }

  translateDestinyStampForSession(session, rawStamp) {
    const normalizedRawStamp = toInt(rawStamp, 0) >>> 0;
    const clockOffsetMs = this.getSessionClockOffsetMs(session);
    if (Math.abs(clockOffsetMs) < 0.000001) {
      return normalizedRawStamp;
    }
    return getCurrentDestinyStamp((normalizedRawStamp * 1000) + clockOffsetMs);
  }

  refreshSessionClockSnapshot(
    session,
    rawSimTimeMs = this.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!session || !session._space) {
      return null;
    }

    const currentSessionSimTimeMs =
      options.currentSimTimeMs === undefined || options.currentSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session, rawSimTimeMs)
        : toFiniteNumber(options.currentSimTimeMs, this.getCurrentSessionSimTimeMs(session, rawSimTimeMs));
    const currentSessionSimFileTime = toFileTimeFromMs(
      currentSessionSimTimeMs,
      this.getCurrentFileTime(),
    );
    session._space.timeDilation = this.getTimeDilation();
    session._space.simTimeMs = currentSessionSimTimeMs;
    session._space.simFileTime = currentSessionSimFileTime;
    return {
      currentSimTimeMs: currentSessionSimTimeMs,
      currentSimFileTime: currentSessionSimFileTime,
      timeDilation: this.getTimeDilation(),
    };
  }

  getCurrentDestinyStamp(nowMs = this.getCurrentSimTimeMs()) {
    return getCurrentDestinyStamp(nowMs);
  }

  getMovementStamp(nowMs = this.getCurrentSimTimeMs()) {
    return getMovementStamp(nowMs);
  }

  getNextDestinyStamp(nowMs = this.getCurrentSimTimeMs()) {
    const currentStamp = this.getCurrentDestinyStamp(nowMs);
    const maxAllowedStamp = (currentStamp + DESTINY_STAMP_MAX_LEAD) >>> 0;
    if (this.nextStamp < currentStamp) {
      this.nextStamp = currentStamp;
      return this.nextStamp;
    }
    if (this.nextStamp >= maxAllowedStamp) {
      this.nextStamp = maxAllowedStamp;
      return this.nextStamp;
    }
    this.nextStamp = (this.nextStamp + 1) >>> 0;
    return this.nextStamp;
  }

  getTimeDilation() {
    return clampTimeDilationFactor(this.timeDilation);
  }

  buildTimeStateSnapshot() {
    return {
      systemID: this.systemID,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
      destinyStamp: this.getCurrentDestinyStamp(),
    };
  }

  syncSessionSimClock(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? fileTimeToMs(session._space.simFileTime, this.getCurrentSimTimeMs())
        : toFiniteNumber(options.previousSimTimeMs, this.getCurrentSimTimeMs());
    const currentSimTimeMs =
      options.currentSimTimeMs === undefined || options.currentSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session)
        : toFiniteNumber(
            options.currentSimTimeMs,
            this.getCurrentSessionSimTimeMs(session),
          );
    const previousSimFileTime = toFileTimeFromMs(
      previousSimTimeMs,
      this.getCurrentFileTime(),
    );
    const currentSimFileTime = toFileTimeFromMs(
      currentSimTimeMs,
      this.getCurrentFileTime(),
    );

    this.refreshSessionClockSnapshot(session, currentSimTimeMs, {
      currentSimTimeMs,
    });

    if (
      options.emit !== false &&
      typeof session.sendNotification === "function" &&
      (options.forceRebase === true || previousSimFileTime !== currentSimFileTime)
    ) {
      session.sendNotification("DoSimClockRebase", "clientID", [[
        { type: "long", value: previousSimFileTime },
        { type: "long", value: currentSimFileTime },
      ]]);
    }

    const result = {
      previousSimTimeMs,
      currentSimTimeMs,
      previousSimFileTime,
      currentSimFileTime,
      timeDilation: this.getTimeDilation(),
    };
    recordSessionJumpTimingTrace(session, "sync-session-sim-clock", {
      emit: options.emit !== false,
      forceRebase: options.forceRebase === true,
      deltaMs: roundNumber(currentSimTimeMs - previousSimTimeMs, 3),
      result,
    });
    return result;
  }

  syncAllSessionSimClocks(options = {}) {
    const synced = [];
    for (const session of this.sessions.values()) {
      const result = this.syncSessionSimClock(session, options);
      if (result) {
        synced.push({
          clientID: session.clientID,
          characterID: session.characterID,
          ...result,
        });
      }
    }
    return synced;
  }

  maybeBroadcastSimClockUpdate(clockState) {
    if (!clockState || this.sessions.size === 0) {
      return [];
    }

    const wallclockNowMs = toFiniteNumber(
      clockState.wallclockNowMs,
      this.getCurrentWallclockMs(),
    );
    const minimumIntervalMs =
      this.getTimeDilation() < 1
        ? SIM_CLOCK_REBASE_INTERVAL_MS
        : DESTINY_STAMP_INTERVAL_MS;
    if (
      wallclockNowMs - toFiniteNumber(
        this.lastSimClockBroadcastWallclockAt,
        0,
      ) < minimumIntervalMs
    ) {
      return [];
    }

    this.lastSimClockBroadcastWallclockAt = wallclockNowMs;
    return this.syncAllSessionSimClocks({
      emit: true,
      forceRebase: true,
      currentSimTimeMs: clockState.simNowMs,
    });
  }

  //testing: Sets the server-side time dilation factor for this scene.
  //testing: Affects sim clock advancement (warp, movement, destiny stamps).
  //testing: Client-side TiDi HUD notification is sent separately by the /tidi command
  //testing: and autoscaler via synchronizedTimeDilation.js.
  setTimeDilation(value, options = {}) {
    const previousFactor = this.getTimeDilation();
    const nextFactor = clampTimeDilationFactor(value, previousFactor);

    const clockState = this.advanceClock(options.wallclockNowMs);
    const previousSimTimeMs = clockState.simNowMs;
    this.timeDilation = nextFactor;

    this.lastSimClockBroadcastWallclockAt = clockState.wallclockNowMs;
    if (options.syncSessions !== false) {
      this.syncAllSessionSimClocks({
        ...options,
        previousSimTimeMs,
        currentSimTimeMs: this.getCurrentSimTimeMs(),
        forceRebase: options.forceRebase === true,
      });
    }

    return {
      systemID: this.systemID,
      previousFactor,
      factor: nextFactor,
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
      syncedSessionCount: this.sessions.size,
    };
  }

  getAllVisibleEntities() {
    return [...this.staticEntities, ...this.dynamicEntities.values()];
  }

  resolveBubbleCenter(center) {
    let resolvedCenter = cloneVector(center);
    for (let index = 0; index < 8; index += 1) {
      let overlappingBubble = null;
      for (const bubble of this.bubbles.values()) {
        if (
          distanceSquared(resolvedCenter, bubble.center) <
          BUBBLE_CENTER_MIN_DISTANCE_SQUARED
        ) {
          overlappingBubble = bubble;
          break;
        }
      }
      if (!overlappingBubble) {
        return resolvedCenter;
      }

      const offset = subtractVectors(resolvedCenter, overlappingBubble.center);
      const direction = normalizeVector(
        magnitude(offset) > 0 ? offset : DEFAULT_RIGHT,
        DEFAULT_RIGHT,
      );
      resolvedCenter = addVectors(
        cloneVector(overlappingBubble.center),
        scaleVector(direction, BUBBLE_CENTER_MIN_DISTANCE_METERS),
      );
    }

    return resolvedCenter;
  }

  createBubble(center) {
    const bubble = {
      id: this.nextBubbleID,
      uuid: crypto.randomUUID(),
      center: this.resolveBubbleCenter(center),
      entityIDs: new Set(),
    };
    this.nextBubbleID += 1;
    this.bubbles.set(bubble.id, bubble);
    logBubbleDebug("bubble.created", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
      radiusMeters: BUBBLE_RADIUS_METERS,
      hysteresisMeters: BUBBLE_HYSTERESIS_METERS,
    });
    return bubble;
  }

  getBubbleByID(bubbleID) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (!numericBubbleID) {
      return null;
    }
    return this.bubbles.get(numericBubbleID) || null;
  }

  removeBubbleIfEmpty(bubbleID) {
    const bubble = this.getBubbleByID(bubbleID);
    if (!bubble || bubble.entityIDs.size > 0) {
      return;
    }
    logBubbleDebug("bubble.removed", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
    });
    this.bubbles.delete(bubble.id);
  }

  getDynamicEntitiesInBubble(bubbleID) {
    const bubble = this.getBubbleByID(bubbleID);
    if (!bubble) {
      return [];
    }

    const entities = [];
    for (const entityID of bubble.entityIDs.values()) {
      const entity = this.dynamicEntities.get(entityID);
      if (entity) {
        entities.push(entity);
      }
    }
    return entities;
  }

  getShipsInBubble(bubbleID) {
    return this.getDynamicEntitiesInBubble(bubbleID).filter(
      (entity) => entity && entity.kind === "ship",
    );
  }

  getBubbleForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getBubbleByID(egoEntity.bubbleID) : null;
  }

  getPublicGridKeyForEntity(entity) {
    if (!entity) {
      return null;
    }
    return String(entity.publicGridKey || buildPublicGridKey(entity.position || null));
  }

  getPublicGridClusterKeyForEntity(entity) {
    if (!entity) {
      return null;
    }
    this.ensurePublicGridComposition();
    const publicGridKey = this.getPublicGridKeyForEntity(entity);
    if (!publicGridKey) {
      return null;
    }
    const clusterKey = String(
      entity.publicGridClusterKey ||
      this.publicGridClustersByBoxKey.get(publicGridKey) ||
      publicGridKey
    );
    entity.publicGridClusterKey = clusterKey;
    return clusterKey;
  }

  getPublicGridKeyForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getPublicGridKeyForEntity(egoEntity) : null;
  }

  getPublicGridClusterKeyForSession(session) {
    const egoEntity = this.getShipEntityForSession(session);
    return egoEntity ? this.getPublicGridClusterKeyForEntity(egoEntity) : null;
  }

  getSessionsInBubble(bubbleID) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (!numericBubbleID) {
      return [];
    }

    const sessions = [];
    for (const session of this.sessions.values()) {
      const egoEntity = this.getShipEntityForSession(session);
      if (egoEntity && toInt(egoEntity.bubbleID, 0) === numericBubbleID) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  buildBubbleCenterForEntity(entity, position = entity && entity.position) {
    const numericPosition = cloneVector(position, { x: 0, y: 0, z: 0 });
    const velocity = cloneVector(entity && entity.velocity, { x: 0, y: 0, z: 0 });
    const direction = cloneVector(entity && entity.direction, DEFAULT_RIGHT);
    const motionDirection = normalizeVector(
      magnitude(velocity) > 1 ? velocity : direction,
      DEFAULT_RIGHT,
    );
    return addVectors(
      numericPosition,
      scaleVector(motionDirection, BUBBLE_RADIUS_METERS / 2),
    );
  }

  findBestBubbleForPosition(position, radiusSquared = BUBBLE_RADIUS_SQUARED) {
    let bestBubble = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const bubble of this.bubbles.values()) {
      const currentDistanceSquared = distanceSquared(position, bubble.center);
      if (
        currentDistanceSquared <= radiusSquared &&
        currentDistanceSquared < bestDistanceSquared
      ) {
        bestBubble = bubble;
        bestDistanceSquared = currentDistanceSquared;
      }
    }
    return bestBubble;
  }

  selectBubbleForEntity(entity, position = entity && entity.position) {
    if (!entity) {
      return null;
    }
    const numericPosition = cloneVector(position, entity.position);
    const currentBubble = this.getBubbleByID(entity.bubbleID);
    if (
      currentBubble &&
      distanceSquared(numericPosition, currentBubble.center) <=
        BUBBLE_RETENTION_RADIUS_SQUARED
    ) {
      return currentBubble;
    }
    const existingBubble = this.findBestBubbleForPosition(
      numericPosition,
      BUBBLE_RADIUS_SQUARED,
    );
    if (existingBubble) {
      return existingBubble;
    }
    return this.createBubble(this.buildBubbleCenterForEntity(entity, numericPosition));
  }

  moveEntityToBubble(entity, bubble) {
    if (!entity || !bubble) {
      return null;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (previousBubbleID && previousBubbleID === bubble.id) {
      bubble.entityIDs.add(entity.itemID);
      return bubble;
    }
    if (previousBubbleID) {
      const previousBubble = this.getBubbleByID(previousBubbleID);
      if (previousBubble) {
        previousBubble.entityIDs.delete(entity.itemID);
      }
      this.removeBubbleIfEmpty(previousBubbleID);
    }
    bubble.entityIDs.add(entity.itemID);
    entity.bubbleID = bubble.id;
    logBubbleDebug("bubble.entity_entered", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(bubble),
    });
    return bubble;
  }

  removeEntityFromBubble(entity) {
    if (!entity) {
      return 0;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (!previousBubbleID) {
      entity.bubbleID = null;
      return 0;
    }
    const previousBubble = this.getBubbleByID(previousBubbleID);
    if (previousBubble) {
      previousBubble.entityIDs.delete(entity.itemID);
    }
    entity.bubbleID = null;
    logBubbleDebug("bubble.entity_removed", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(previousBubble),
    });
    this.removeBubbleIfEmpty(previousBubbleID);
    return previousBubbleID;
  }

  reconcileEntityBubble(entity) {
    if (!entity || entity.mode === "WARP") {
      return null;
    }
    const bubble = this.selectBubbleForEntity(entity);
    this.moveEntityToBubble(entity, bubble);
    if (entity.departureBubbleID) {
      entity.departureBubbleID = null;
      entity.departureBubbleVisibleUntilMs = 0;
    }
    return bubble;
  }

  reconcileEntityPublicGrid(entity) {
    if (!entity) {
      return null;
    }

    const previousPublicGridKey = String(entity.publicGridKey || "");
    const nextPublicGridKey = buildPublicGridKey(entity.position || null);
    entity.publicGridKey = nextPublicGridKey;
    entity.publicGridClusterKey = null;
    if (previousPublicGridKey !== nextPublicGridKey) {
      this.publicGridCompositionDirty = true;
    }
    if (previousPublicGridKey && previousPublicGridKey !== nextPublicGridKey) {
      logBubbleDebug("public_grid.entity_moved", {
        systemID: this.systemID,
        entity: summarizeBubbleEntity(entity),
        previousPublicGridKey,
        publicGrid: summarizePublicGrid(entity.position),
      });
    }
    return nextPublicGridKey;
  }

  collectOccupiedPublicGridBoxes() {
    const occupiedBoxes = new Map();
    const noteEntity = (entity, source) => {
      if (!entity || !entity.position) {
        return;
      }
      const parsed = parsePublicGridKey(this.reconcileEntityPublicGrid(entity));
      let entry = occupiedBoxes.get(parsed.key);
      if (!entry) {
        entry = {
          key: parsed.key,
          xIndex: parsed.xIndex,
          yIndex: parsed.yIndex,
          zIndex: parsed.zIndex,
          staticEntityIDs: new Set(),
          dynamicEntityIDs: new Set(),
        };
        occupiedBoxes.set(parsed.key, entry);
      }
      if (source === "static") {
        entry.staticEntityIDs.add(toInt(entity.itemID, 0));
      } else {
        entry.dynamicEntityIDs.add(toInt(entity.itemID, 0));
      }
    };

    for (const entity of this.staticEntities) {
      noteEntity(entity, "static");
    }
    for (const entity of this.dynamicEntities.values()) {
      noteEntity(entity, "dynamic");
    }

    return occupiedBoxes;
  }

  rebuildPublicGridComposition() {
    const occupiedBoxes = this.collectOccupiedPublicGridBoxes();
    const clusterByBoxKey = new Map();
    const visited = new Set();
    const sortedBoxKeys = [...occupiedBoxes.keys()].sort();

    const visitNeighborKeys = (entry) => {
      // Treat giant-grid composition as face-connected box occupancy.
      // Diagonal/corner joins over-compose dense systems like Jita and cause
      // login/bootstrap visibility to leak across nearby but distinct gates.
      return [
        buildPublicGridKeyFromIndices(entry.xIndex - 1, entry.yIndex, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex + 1, entry.yIndex, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex - 1, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex + 1, entry.zIndex),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex, entry.zIndex - 1),
        buildPublicGridKeyFromIndices(entry.xIndex, entry.yIndex, entry.zIndex + 1),
      ];
    };

    for (const boxKey of sortedBoxKeys) {
      if (visited.has(boxKey)) {
        continue;
      }
      const seed = occupiedBoxes.get(boxKey);
      if (!seed) {
        continue;
      }
      const stack = [seed];
      const clusterKeys = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.key)) {
          continue;
        }
        visited.add(current.key);
        clusterKeys.push(current.key);
        for (const neighborKey of visitNeighborKeys(current)) {
          if (visited.has(neighborKey) || !occupiedBoxes.has(neighborKey)) {
            continue;
          }
          stack.push(occupiedBoxes.get(neighborKey));
        }
      }
      clusterKeys.sort();
      const clusterKey = `cluster:${clusterKeys[0]}`;
      for (const clusterBoxKey of clusterKeys) {
        clusterByBoxKey.set(clusterBoxKey, clusterKey);
      }
    }

    this.publicGridOccupiedBoxes = occupiedBoxes;
    this.publicGridClustersByBoxKey = clusterByBoxKey;
    this.publicGridCompositionDirty = false;

    for (const entity of this.staticEntities) {
      const publicGridKey = this.getPublicGridKeyForEntity(entity);
      entity.publicGridClusterKey = publicGridKey
        ? String(clusterByBoxKey.get(publicGridKey) || publicGridKey)
        : null;
    }
    for (const entity of this.dynamicEntities.values()) {
      const publicGridKey = this.getPublicGridKeyForEntity(entity);
      entity.publicGridClusterKey = publicGridKey
        ? String(clusterByBoxKey.get(publicGridKey) || publicGridKey)
        : null;
    }

    return clusterByBoxKey;
  }

  ensurePublicGridComposition() {
    if (this.publicGridCompositionDirty !== true) {
      return this.publicGridClustersByBoxKey;
    }
    return this.rebuildPublicGridComposition();
  }

  reconcileAllDynamicEntityPublicGrids() {
    let changed = false;
    for (const entity of this.dynamicEntities.values()) {
      const previousKey = this.getPublicGridKeyForEntity(entity);
      const nextKey = this.reconcileEntityPublicGrid(entity);
      if (previousKey !== nextKey) {
        changed = true;
      }
    }
    if (changed) {
      this.publicGridCompositionDirty = true;
    }
    return changed;
  }

  reconcileAllDynamicEntityBubbles() {
    for (const entity of this.dynamicEntities.values()) {
      if (entity.mode === "WARP") {
        continue;
      }
      this.reconcileEntityBubble(entity);
    }
  }

  beginWarpDepartureOwnership(entity, now = this.getCurrentSimTimeMs()) {
    if (!entity) {
      return;
    }
    entity.departureBubbleID = this.removeEntityFromBubble(entity);
    entity.departureBubbleVisibleUntilMs = 0;
    logBubbleDebug("bubble.warp_departure_ownership_started", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      departureBubbleVisibleUntilMs: 0,
      publicGrid: summarizePublicGrid(entity.position),
    });
  }

  canSessionSeeWarpingDynamicEntity(
    session,
    entity,
    now = this.getCurrentSimTimeMs(),
  ) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode !== "WARP" || !entity.warpState) {
      return false;
    }
    if (toFiniteNumber(entity.visibilitySuppressedUntilMs, 0) > now) {
      return false;
    }
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    const egoPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(egoEntity);
    const entityPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(entity);
    if (!egoPublicGridClusterKey || !entityPublicGridClusterKey) {
      return false;
    }
    return egoPublicGridClusterKey === entityPublicGridClusterKey;
  }

  canSessionSeeDynamicEntity(session, entity, now = this.getCurrentSimTimeMs()) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode === "WARP" && entity.warpState) {
      return this.canSessionSeeWarpingDynamicEntity(session, entity, now);
    }
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    const egoPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(egoEntity);
    const entityPublicGridClusterKey = this.getPublicGridClusterKeyForEntity(entity);
    if (!egoPublicGridClusterKey || !entityPublicGridClusterKey) {
      return false;
    }
    return egoPublicGridClusterKey === entityPublicGridClusterKey;
  }

  getVisibleDynamicEntitiesForSession(
    session,
    now = this.getCurrentSimTimeMs(),
  ) {
    const visible = [];
    for (const entity of this.dynamicEntities.values()) {
      if (this.canSessionSeeDynamicEntity(session, entity, now)) {
        visible.push(entity);
      }
    }
    return visible;
  }

  getVisibleEntitiesForSession(session, now = this.getCurrentSimTimeMs()) {
    const egoEntity = this.getShipEntityForSession(session);
    const egoBubbleID = toInt(egoEntity && egoEntity.bubbleID, 0);
    const visibleStaticEntities = this.staticEntities.filter((entity) => {
      if (!isBubbleScopedStaticEntity(entity)) {
        return true;
      }
      return egoBubbleID > 0 && egoBubbleID === toInt(entity.bubbleID, 0);
    });

    return [
      ...visibleStaticEntities,
      ...this.getVisibleDynamicEntitiesForSession(session, now),
    ];
  }

  getDynamicEntities() {
    return [...this.dynamicEntities.values()];
  }

  getEntityByID(entityID) {
    const numericID = Number(entityID);
    if (!numericID) {
      return null;
    }

    return (
      this.dynamicEntities.get(numericID) ||
      this.staticEntitiesByID.get(numericID) ||
      null
    );
  }

  refreshInventoryBackedEntityPresentation(entityID, options = {}) {
    const entity = this.getEntityByID(entityID);
    if (!isInventoryBackedDynamicEntity(entity)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    refreshInventoryBackedEntityPresentationFields(entity);
    if (options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity], options.excludedSession || null);
    }

    return {
      success: true,
      data: {
        entity,
      },
    };
  }

  getShipEntityForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.dynamicEntities.get(session._space.shipID) || null;
  }

  getActiveModuleEffect(shipID, moduleID) {
    const entity = this.getEntityByID(shipID);
    if (!entity || !(entity.activeModuleEffects instanceof Map)) {
      return null;
    }
    return entity.activeModuleEffects.get(toInt(moduleID, 0)) || null;
  }

  allocateTargetSequence() {
    const sequence = toInt(this.nextTargetSequence, 1);
    this.nextTargetSequence = sequence + 1;
    return sequence;
  }

  getEntityTargetingStats(entity) {
    if (!entity) {
      return null;
    }

    const numericCharID = getShipEntityInventoryCharacterID(entity, 0);
    const characterTargetingState =
      numericCharID > 0
        ? buildCharacterTargetingState(numericCharID)
        : { maxLockedTargets: toInt(entity.maxLockedTargets, 0) };
    const shipMaxLockedTargets = Math.max(0, toInt(entity.maxLockedTargets, 0));
    const characterMaxLockedTargets = Math.max(
      0,
      toInt(characterTargetingState.maxLockedTargets, shipMaxLockedTargets),
    );
    const effectiveMaxLockedTargets =
      shipMaxLockedTargets > 0 && characterMaxLockedTargets > 0
        ? Math.min(shipMaxLockedTargets, characterMaxLockedTargets)
        : Math.max(shipMaxLockedTargets, characterMaxLockedTargets);

    return {
      maxTargetRange: Math.max(0, toFiniteNumber(entity.maxTargetRange, 0)),
      shipMaxLockedTargets,
      characterMaxLockedTargets,
      effectiveMaxLockedTargets,
      scanResolution: Math.max(0, toFiniteNumber(entity.scanResolution, 0)),
      cloakingTargetingDelay: Math.max(
        0,
        toFiniteNumber(entity.cloakingTargetingDelay, 0),
      ),
    };
  }

  getTargetsForEntity(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.lockedTargets.values()]
      .sort(
        (left, right) =>
          toInt(left && left.sequence, 0) - toInt(right && right.sequence, 0) ||
          toInt(left && left.targetID, 0) - toInt(right && right.targetID, 0),
      )
      .map((entry) => toInt(entry && entry.targetID, 0))
      .filter((targetID) => targetID > 0);
  }

  getTargetersForEntity(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.targetedBy]
      .map((sourceID) => toInt(sourceID, 0))
      .filter((sourceID) => sourceID > 0)
      .sort((left, right) => left - right);
  }

  getSortedPendingTargetLocks(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return [];
    }

    return [...state.pendingTargetLocks.values()].sort(
      (left, right) =>
        toFiniteNumber(left && left.completeAtMs, 0) -
          toFiniteNumber(right && right.completeAtMs, 0) ||
        toInt(left && left.sequence, 0) - toInt(right && right.sequence, 0),
    );
  }

  notifyTargetEvent(session, what, targetID = null, reason = null) {
    if (!session || typeof session.sendNotification !== "function") {
      return false;
    }

    const payload = [String(what || "")];
    if (targetID !== null && targetID !== undefined) {
      payload.push(toInt(targetID, 0));
    }
    if (reason !== null && reason !== undefined) {
      payload.push(String(reason));
    }

    session.sendNotification("OnTarget", "clientID", payload);
    return true;
  }

  notifyTargetLockFailure(session, targetID) {
    if (!session) {
      return false;
    }

    const normalizedTargetID = toInt(targetID, 0);
    if (normalizedTargetID <= 0) {
      return false;
    }

    if (typeof session.sendServiceNotification === "function") {
      session.sendServiceNotification("target", "FailLockTarget", [
        normalizedTargetID,
      ]);
      return true;
    }

    return this.notifyTargetEvent(
      session,
      "lost",
      normalizedTargetID,
      TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    );
  }

  isTargetLockRangeValid(sourceEntity, targetEntity) {
    if (!sourceEntity || !targetEntity) {
      return false;
    }

    const targetingStats = this.getEntityTargetingStats(sourceEntity);
    if (!targetingStats || targetingStats.maxTargetRange <= 0) {
      return false;
    }

    return getEntitySurfaceDistance(sourceEntity, targetEntity) < targetingStats.maxTargetRange;
  }

  validateTargetLockRequest(session, sourceEntity, targetEntity, options = {}) {
    if ((!session || !session._space) && !sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }
    if (!targetEntity) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }
    if (toInt(sourceEntity.itemID, 0) === toInt(targetEntity.itemID, 0)) {
      return {
        success: false,
        errorMsg: "TARGET_SELF",
      };
    }
    if (
      (sourceEntity.mode === "WARP" && sourceEntity.warpState) ||
      sourceEntity.pendingWarp
    ) {
      return {
        success: false,
        errorMsg: "SOURCE_WARPING",
      };
    }
    if (
      (targetEntity.mode === "WARP" && targetEntity.warpState) ||
      targetEntity.pendingWarp
    ) {
      return {
        success: false,
        errorMsg: "TARGET_WARPING",
      };
    }
    if (!this.isTargetLockRangeValid(sourceEntity, targetEntity)) {
      return {
        success: false,
        errorMsg: "TARGET_OUT_OF_RANGE",
      };
    }

    const targetingStats = this.getEntityTargetingStats(sourceEntity);
    if (!targetingStats || targetingStats.effectiveMaxLockedTargets <= 0) {
      return {
        success: false,
        errorMsg: "TARGET_LOCK_LIMIT_REACHED",
      };
    }

    if (options.ignoreCapacity !== true) {
      const state = ensureEntityTargetingState(sourceEntity);
      const totalTargets =
        state.lockedTargets.size + state.pendingTargetLocks.size;
      if (totalTargets >= targetingStats.effectiveMaxLockedTargets) {
        return {
          success: false,
          errorMsg: "TARGET_LOCK_LIMIT_REACHED",
        };
      }
    }

    return {
      success: true,
      data: {
        targetingStats,
      },
    };
  }

  rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now = this.getCurrentSimTimeMs()) {
    if (!sourceEntity || !pendingLock || !targetEntity) {
      return null;
    }

    const oldDurationMs = Math.max(
      1,
      toFiniteNumber(pendingLock.totalDurationMs, TARGETING_CLIENT_FALLBACK_LOCK_MS),
    );
    const nowMs = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const elapsedMs = clamp(
      nowMs - toFiniteNumber(pendingLock.requestedAtMs, nowMs),
      0,
      oldDurationMs,
    );
    const progressRatio = clamp(elapsedMs / oldDurationMs, 0, 1);
    const newDurationMs = computeTargetLockDurationMs(sourceEntity, targetEntity);

    pendingLock.totalDurationMs = newDurationMs;
    pendingLock.requestedAtMs = nowMs - (newDurationMs * progressRatio);
    pendingLock.completeAtMs = pendingLock.requestedAtMs + newDurationMs;
    return pendingLock;
  }

  rebasePendingTargetLocksForSource(sourceEntity, now = this.getCurrentSimTimeMs()) {
    const state = ensureEntityTargetingState(sourceEntity);
    if (!state) {
      return;
    }

    for (const pendingLock of state.pendingTargetLocks.values()) {
      const targetEntity = this.getEntityByID(pendingLock.targetID);
      if (!targetEntity) {
        continue;
      }
      this.rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now);
    }
  }

  rebaseIncomingPendingTargetLocksForTarget(targetEntity, now = this.getCurrentSimTimeMs()) {
    if (!targetEntity) {
      return;
    }

    const targetID = toInt(targetEntity.itemID, 0);
    if (targetID <= 0) {
      return;
    }

    for (const sourceEntity of this.dynamicEntities.values()) {
      const sourceState = ensureEntityTargetingState(sourceEntity);
      if (!sourceState) {
        continue;
      }
      const pendingLock = sourceState.pendingTargetLocks.get(targetID) || null;
      if (!pendingLock) {
        continue;
      }
      this.rebasePendingTargetLock(sourceEntity, pendingLock, targetEntity, now);
    }
  }

  cancelPendingTargetLock(sourceEntity, targetEntityID, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return false;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceState.pendingTargetLocks.has(normalizedTargetID)) {
      return false;
    }

    sourceState.pendingTargetLocks.delete(normalizedTargetID);
    if (options.notifySelf !== false && sourceEntity && sourceEntity.session) {
      this.notifyTargetLockFailure(sourceEntity.session, normalizedTargetID);
    }
    return true;
  }

  finalizeTargetLock(sourceEntity, targetEntity, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    const targetState = ensureEntityTargetingState(targetEntity);
    if (!sourceState || !targetState) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    const targetID = toInt(targetEntity.itemID, 0);
    const pendingLock =
      options.pendingLock || sourceState.pendingTargetLocks.get(targetID) || null;
    const validation = this.validateTargetLockRequest(
      sourceEntity && sourceEntity.session,
      sourceEntity,
      targetEntity,
      {
        ignoreCapacity: true,
      },
    );
    if (!validation.success) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return validation;
    }

    const targetingStats = validation.data.targetingStats;
    if (sourceState.lockedTargets.has(targetID)) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return {
        success: true,
        data: {
          pending: false,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }
    if (sourceState.lockedTargets.size >= targetingStats.effectiveMaxLockedTargets) {
      if (pendingLock) {
        sourceState.pendingTargetLocks.delete(targetID);
      }
      return {
        success: false,
        errorMsg: "TARGET_LOCK_LIMIT_REACHED",
      };
    }

    if (pendingLock) {
      sourceState.pendingTargetLocks.delete(targetID);
    }

    const sourceID = toInt(sourceEntity.itemID, 0);
    sourceState.lockedTargets.set(targetID, {
      targetID,
      sequence: toInt(pendingLock && pendingLock.sequence, 0) || this.allocateTargetSequence(),
      acquiredAtMs: toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
    });
    targetState.targetedBy.add(sourceID);

    if (sourceEntity.session) {
      this.notifyTargetEvent(sourceEntity.session, "add", targetID);
    }
    if (
      targetEntity.session &&
      targetEntity.session !== sourceEntity.session
    ) {
      this.notifyTargetEvent(targetEntity.session, "otheradd", sourceID);
    }

    return {
      success: true,
      data: {
        pending: false,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeLockedTarget(sourceEntity, targetEntityID, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return false;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceState.lockedTargets.has(normalizedTargetID)) {
      return false;
    }

    sourceState.lockedTargets.delete(normalizedTargetID);
    this.stopTargetedModuleEffects(sourceEntity, normalizedTargetID, {
      reason: options.reason ?? "target",
    });
    const targetEntity = this.getEntityByID(normalizedTargetID);
    if (targetEntity) {
      ensureEntityTargetingState(targetEntity).targetedBy.delete(
        toInt(sourceEntity && sourceEntity.itemID, 0),
      );
    }

    if (options.notifySelf !== false && sourceEntity && sourceEntity.session) {
      this.notifyTargetEvent(
        sourceEntity.session,
        "lost",
        normalizedTargetID,
        options.reason ?? null,
      );
    }
    if (
      options.notifyTarget !== false &&
      targetEntity &&
      targetEntity.session &&
      targetEntity.session !== sourceEntity.session
    ) {
      this.notifyTargetEvent(
        targetEntity.session,
        "otherlost",
        sourceEntity.itemID,
        options.reason ?? null,
      );
    }

    return true;
  }

  stopTargetedModuleEffects(sourceEntity, targetEntityID, options = {}) {
    if (
      !sourceEntity ||
      !(sourceEntity.activeModuleEffects instanceof Map)
    ) {
      return 0;
    }

    const normalizedTargetID = toInt(targetEntityID, 0);
    if (normalizedTargetID <= 0) {
      return 0;
    }

    const stopReason = String(options.reason || "target");
    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(options.nowMs, this.getCurrentSimTimeMs()),
    );
    let stoppedCount = 0;

    for (const effectState of [...sourceEntity.activeModuleEffects.values()]) {
      if (!effectState || toInt(effectState.targetID, 0) !== normalizedTargetID) {
        continue;
      }

      const moduleID = toInt(effectState.moduleID, 0);
      if (moduleID <= 0) {
        continue;
      }

      let stopResult = null;
      if (sourceEntity.session && isReadyForDestiny(sourceEntity.session)) {
        stopResult = effectState.isGeneric
          ? this.finalizeGenericModuleDeactivation(
              sourceEntity.session,
              moduleID,
              {
                reason: stopReason,
                nowMs: stopTimeMs,
              },
            )
          : this.finalizePropulsionModuleDeactivation(
              sourceEntity.session,
              moduleID,
              {
                reason: stopReason,
                nowMs: stopTimeMs,
              },
            );
      } else {
        sourceEntity.activeModuleEffects.delete(moduleID);
        if (!(sourceEntity.moduleReactivationLocks instanceof Map)) {
          sourceEntity.moduleReactivationLocks = new Map();
        }
        sourceEntity.moduleReactivationLocks.set(
          moduleID,
          stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
        );
        effectState.deactivatedAtMs = stopTimeMs;
        effectState.deactivationRequestedAtMs = 0;
        effectState.deactivateAtMs = 0;
        effectState.stopReason = stopReason;

        if (effectState.guid) {
          this.broadcastSpecialFx(
            sourceEntity.itemID,
            effectState.guid,
            {
              moduleID: effectState.moduleID,
              moduleTypeID: effectState.typeID,
              targetID: effectState.targetID || null,
              chargeTypeID: effectState.chargeTypeID || null,
              isOffensive: effectState.weaponFamily === "laserTurret",
              start: false,
              active: false,
              duration: effectState.durationMs,
              useCurrentStamp: true,
            },
            sourceEntity,
          );
        }

        stopResult = { success: true };
      }

      if (stopResult && stopResult.success) {
        stoppedCount += 1;
      }
    }

    return stoppedCount;
  }

  clearOutgoingTargetLocks(sourceEntity, options = {}) {
    const sourceState = ensureEntityTargetingState(sourceEntity);
    if (!sourceState) {
      return {
        clearedTargetIDs: [],
        cancelledPendingIDs: [],
      };
    }

    const notifySelf = options.notifySelf !== false;
    const notifyTarget = options.notifyTarget !== false;
    const cancelledPendingIDs = [...sourceState.pendingTargetLocks.keys()]
      .map((targetID) => toInt(targetID, 0))
      .filter((targetID) => targetID > 0);
    for (const pendingTargetID of cancelledPendingIDs) {
      this.cancelPendingTargetLock(sourceEntity, pendingTargetID, {
        notifySelf,
        reason: options.pendingReason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
    }

    const clearedTargetIDs = this.getTargetsForEntity(sourceEntity);
    const sourceID = toInt(sourceEntity && sourceEntity.itemID, 0);
    for (const targetID of clearedTargetIDs) {
      sourceState.lockedTargets.delete(targetID);
      this.stopTargetedModuleEffects(sourceEntity, targetID, {
        reason: options.activeReason ?? "target",
      });
      const targetEntity = this.getEntityByID(targetID);
      if (!targetEntity) {
        continue;
      }
      ensureEntityTargetingState(targetEntity).targetedBy.delete(sourceID);
      if (
        notifyTarget &&
        targetEntity.session &&
        targetEntity.session !== sourceEntity.session
      ) {
        this.notifyTargetEvent(
          targetEntity.session,
          "otherlost",
          sourceID,
          options.activeReason ?? null,
        );
      }
    }

    if (notifySelf && clearedTargetIDs.length > 0 && sourceEntity && sourceEntity.session) {
      this.notifyTargetEvent(sourceEntity.session, "clear");
    }

    return {
      clearedTargetIDs,
      cancelledPendingIDs,
    };
  }

  clearAllTargetingForEntity(entity, options = {}) {
    if (!entity) {
      return {
        clearedTargetIDs: [],
        cancelledPendingIDs: [],
      };
    }

    const reason = options.reason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED;
    const outgoingResult = this.clearOutgoingTargetLocks(entity, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      activeReason: reason === TARGET_LOSS_REASON_EXPLODING ? TARGET_LOSS_REASON_EXPLODING : null,
      pendingReason: reason,
    });

    const normalizedEntityID = toInt(entity.itemID, 0);
    for (const sourceEntity of this.dynamicEntities.values()) {
      if (!sourceEntity || toInt(sourceEntity.itemID, 0) === normalizedEntityID) {
        continue;
      }

      const sourceState = ensureEntityTargetingState(sourceEntity);
      if (!sourceState) {
        continue;
      }

      if (sourceState.pendingTargetLocks.has(normalizedEntityID)) {
        this.cancelPendingTargetLock(sourceEntity, normalizedEntityID, {
          notifySelf: true,
          reason,
        });
      }
      if (sourceState.lockedTargets.has(normalizedEntityID)) {
        this.removeLockedTarget(sourceEntity, normalizedEntityID, {
          notifySelf: true,
          notifyTarget: false,
          reason: reason === TARGET_LOSS_REASON_EXPLODING ? TARGET_LOSS_REASON_EXPLODING : null,
        });
      }
    }

    ensureEntityTargetingState(entity).targetedBy.clear();
    return outgoingResult;
  }

  enforceEntityTargetCap(entity) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return;
    }

    const targetingStats = this.getEntityTargetingStats(entity);
    const maximumTargets = Math.max(
      0,
      toInt(
        targetingStats && targetingStats.effectiveMaxLockedTargets,
        0,
      ),
    );

    const pendingLocksDescending = [...state.pendingTargetLocks.values()].sort(
      (left, right) => toInt(right && right.sequence, 0) - toInt(left && left.sequence, 0),
    );
    while (
      state.lockedTargets.size + state.pendingTargetLocks.size > maximumTargets &&
      pendingLocksDescending.length > 0
    ) {
      const pendingLock = pendingLocksDescending.shift();
      if (!pendingLock || !state.pendingTargetLocks.has(pendingLock.targetID)) {
        continue;
      }
      this.cancelPendingTargetLock(entity, pendingLock.targetID, {
        notifySelf: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
    }

    const activeLocksDescending = [...state.lockedTargets.values()].sort(
      (left, right) => toInt(right && right.sequence, 0) - toInt(left && left.sequence, 0),
    );
    while (
      state.lockedTargets.size > maximumTargets &&
      activeLocksDescending.length > 0
    ) {
      const lockState = activeLocksDescending.shift();
      if (!lockState || !state.lockedTargets.has(lockState.targetID)) {
        continue;
      }
      this.removeLockedTarget(entity, lockState.targetID, {
        notifySelf: true,
        reason: null,
      });
    }
  }

  validateEntityTargetLocks(entity, now = this.getCurrentSimTimeMs()) {
    const state = ensureEntityTargetingState(entity);
    if (!state) {
      return;
    }

    if (
      (entity.mode === "WARP" && entity.warpState) ||
      entity.pendingWarp
    ) {
      this.clearOutgoingTargetLocks(entity, {
        notifySelf: true,
        notifyTarget: true,
        activeReason: null,
        pendingReason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      return;
    }

    this.enforceEntityTargetCap(entity);

    for (const pendingLock of this.getSortedPendingTargetLocks(entity)) {
      if (!state.pendingTargetLocks.has(pendingLock.targetID)) {
        continue;
      }

      const targetEntity = this.getEntityByID(pendingLock.targetID);
      const validation = this.validateTargetLockRequest(
        entity.session,
        entity,
        targetEntity,
        {
          ignoreCapacity: true,
        },
      );
      if (!validation.success) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
        continue;
      }

      const targetingStats = validation.data.targetingStats;
      if (state.lockedTargets.size >= targetingStats.effectiveMaxLockedTargets) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
        continue;
      }

      if (toFiniteNumber(pendingLock.completeAtMs, 0) > now) {
        continue;
      }

      const finalizeResult = this.finalizeTargetLock(entity, targetEntity, {
        pendingLock,
        nowMs: now,
      });
      if (!finalizeResult.success) {
        this.cancelPendingTargetLock(entity, pendingLock.targetID, {
          notifySelf: true,
          reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
        });
      }
    }

    for (const targetID of this.getTargetsForEntity(entity)) {
      if (!state.lockedTargets.has(targetID)) {
        continue;
      }

      const targetEntity = this.getEntityByID(targetID);
      const validation = this.validateTargetLockRequest(
        entity.session,
        entity,
        targetEntity,
        {
          ignoreCapacity: true,
        },
      );
      if (!validation.success) {
        this.removeLockedTarget(entity, targetID, {
          notifySelf: true,
          reason:
            validation.errorMsg === "TARGET_NOT_FOUND"
              ? TARGET_LOSS_REASON_ATTEMPT_CANCELLED
              : null,
        });
      }
    }

    this.enforceEntityTargetCap(entity);
  }

  validateAllTargetLocks(now = this.getCurrentSimTimeMs()) {
    for (const entity of this.dynamicEntities.values()) {
      this.validateEntityTargetLocks(entity, now);
    }
  }

  handleEntityTargetingAttributeChanges(entity, previousSnapshot, now = this.getCurrentSimTimeMs()) {
    if (!entity || !previousSnapshot) {
      return buildEntityTargetingAttributeSnapshot(entity);
    }

    const currentSnapshot = buildEntityTargetingAttributeSnapshot(entity);
    if (currentSnapshot.scanResolution !== previousSnapshot.scanResolution) {
      this.rebasePendingTargetLocksForSource(entity, now);
    }
    if (currentSnapshot.signatureRadius !== previousSnapshot.signatureRadius) {
      this.rebaseIncomingPendingTargetLocksForTarget(entity, now);
    }

    this.enforceEntityTargetCap(entity);
    this.validateEntityTargetLocks(entity, now);
    return currentSnapshot;
  }

  addTarget(session, targetEntityID) {
    const sourceEntity = this.getShipEntityForSession(session);
    const targetEntity = this.getEntityByID(targetEntityID);
    const sourceState = ensureEntityTargetingState(sourceEntity);
    const normalizedTargetID = toInt(targetEntityID, 0);
    if (!sourceEntity || !sourceState) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    if (sourceState.lockedTargets.has(normalizedTargetID)) {
      return {
        success: true,
        data: {
          pending: false,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }
    if (sourceState.pendingTargetLocks.has(normalizedTargetID)) {
      return {
        success: true,
        data: {
          pending: true,
          targets: this.getTargetsForEntity(sourceEntity),
        },
      };
    }

    const validation = this.validateTargetLockRequest(session, sourceEntity, targetEntity);
    if (!validation.success) {
      return validation;
    }

    const now = this.getCurrentSimTimeMs();
    const lockDurationMs = computeTargetLockDurationMs(sourceEntity, targetEntity);
    if (lockDurationMs <= 1) {
      return this.finalizeTargetLock(sourceEntity, targetEntity, {
        nowMs: now,
      });
    }

    sourceState.pendingTargetLocks.set(normalizedTargetID, {
      targetID: normalizedTargetID,
      sequence: this.allocateTargetSequence(),
      requestedAtMs: now,
      completeAtMs: now + lockDurationMs,
      totalDurationMs: lockDurationMs,
    });

    return {
      success: true,
      data: {
        pending: true,
        targets: this.getTargetsForEntity(sourceEntity),
        lockDurationMs,
      },
    };
  }

  cancelAddTarget(session, targetEntityID, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const cancelled = this.cancelPendingTargetLock(sourceEntity, targetEntityID, {
      notifySelf: options.notifySelf === true,
      reason: options.reason ?? TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    return {
      success: true,
      data: {
        cancelled,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeTarget(session, targetEntityID, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const removed = this.removeLockedTarget(sourceEntity, targetEntityID, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      reason: options.reason ?? null,
    });
    return {
      success: true,
      data: {
        removed,
        targets: this.getTargetsForEntity(sourceEntity),
      },
    };
  }

  removeTargets(session, targetEntityIDs = [], options = {}) {
    const removedTargetIDs = [];
    for (const targetEntityID of targetEntityIDs) {
      const result = this.removeTarget(session, targetEntityID, options);
      if (result.success && result.data && result.data.removed) {
        removedTargetIDs.push(toInt(targetEntityID, 0));
      }
    }

    return {
      success: true,
      data: {
        removedTargetIDs,
      },
    };
  }

  clearTargets(session, options = {}) {
    const sourceEntity = this.getShipEntityForSession(session);
    if (!sourceEntity) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const result = this.clearOutgoingTargetLocks(sourceEntity, {
      notifySelf: options.notifySelf !== false,
      notifyTarget: options.notifyTarget !== false,
      activeReason: options.reason ?? null,
      pendingReason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    return {
      success: true,
      data: result,
    };
  }

  getTargets(session) {
    return this.getTargetsForEntity(this.getShipEntityForSession(session));
  }

  getTargeters(session) {
    return this.getTargetersForEntity(this.getShipEntityForSession(session));
  }

  refreshSessionShipDerivedState(session, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || !session || !session.characterID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const shipRecord = getActiveShipRecord(session.characterID) || null;
    if (!shipRecord) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const previousCommandedSpeedFraction = clamp(
      toFiniteNumber(entity.speedFraction, 0),
      0,
      MAX_SUBWARP_SPEED_FRACTION,
    );
    const previousTargetingSnapshot = buildEntityTargetingAttributeSnapshot(entity);
    const previousMass = toFiniteNumber(entity.mass, 0);
    const previousMaxVelocity = toFiniteNumber(entity.maxVelocity, 0);
    const previousVelocity = cloneVector(entity.velocity);
    const passiveResourceState = buildPassiveShipResourceState(
      session.characterID,
      shipRecord,
    );
    applyPassiveResourceStateToEntity(entity, passiveResourceState, {
      recalculateSpeedFraction: false,
    });
    if (entity.activeModuleEffects instanceof Map) {
      for (const effectState of entity.activeModuleEffects.values()) {
        applyPropulsionEffectStateToEntity(entity, effectState);
      }
    }

    entity.speedFraction = previousCommandedSpeedFraction;
    this.handleEntityTargetingAttributeChanges(entity, previousTargetingSnapshot);

    persistDynamicEntity(entity);

    if (options.broadcast !== false) {
      const updates = buildShipPrimeUpdates(entity, this.getNextDestinyStamp());
      if (updates.length > 0) {
        this.broadcastMovementUpdates(updates);
      }
      if (session && isReadyForDestiny(session)) {
        notifyTargetingDerivedAttributesToSession(
          session,
          entity,
          previousTargetingSnapshot,
        );
      }
    }

    return {
      success: true,
      data: {
        entity,
        previousMass,
        previousMaxVelocity,
        previousVelocity,
      },
    };
  }

  getShipCapacitorState(session) {
    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return null;
    }

    return {
      capacity: toFiniteNumber(entity.capacitorCapacity, 0),
      amount: getEntityCapacitorAmount(entity),
      ratio: getEntityCapacitorRatio(entity),
    };
  }

  setShipCapacitorRatio(session, nextRatio) {
    const entity = this.getShipEntityForSession(session);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    setEntityCapacitorRatio(entity, nextRatio);
    persistEntityCapacitorRatio(entity);
    return {
      success: true,
      data: this.getShipCapacitorState(session),
    };
  }

  activatePropulsionModule(session, moduleItem, effectName, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || !moduleItem) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const normalizedModuleID = toInt(moduleItem.itemID, 0);
    if (
      normalizedModuleID <= 0 ||
      toInt(moduleItem.locationID, 0) !== toInt(entity.itemID, 0)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    if (!isModuleOnline(moduleItem)) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ONLINE",
      };
    }
    if (!(entity.activeModuleEffects instanceof Map)) {
      entity.activeModuleEffects = new Map();
    }
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    if (entity.activeModuleEffects.has(normalizedModuleID)) {
      return {
        success: false,
        errorMsg: "MODULE_ALREADY_ACTIVE",
      };
    }

    const lockUntil = toFiniteNumber(
      entity.moduleReactivationLocks.get(normalizedModuleID),
      0,
    );
    const now = this.getCurrentSimTimeMs();
    if (lockUntil > now) {
      return {
        success: false,
        errorMsg: "MODULE_REACTIVATING",
      };
    }

    const runtimeAttributes = getPropulsionModuleRuntimeAttributes(
      session.characterID,
      moduleItem,
    );
    if (!runtimeAttributes) {
      return {
        success: false,
        errorMsg: "UNSUPPORTED_EFFECT",
      };
    }

    const currentSpeed = magnitude(entity.velocity);
    if (
      runtimeAttributes.maxVelocityActivationLimit > 0 &&
      currentSpeed > runtimeAttributes.maxVelocityActivationLimit + 1e-6
    ) {
      return {
        success: false,
        errorMsg: "MAX_VELOCITY_ACTIVATION_LIMIT",
      };
    }

    if (runtimeAttributes.maxGroupActive > 0) {
      const activeCount = [...entity.activeModuleEffects.values()].filter(
        (effectState) => toInt(effectState.groupID, 0) === toInt(moduleItem.groupID, 0),
      ).length;
      if (activeCount >= runtimeAttributes.maxGroupActive) {
        return {
          success: false,
          errorMsg: "MAX_GROUP_ACTIVE",
        };
      }
    }

    const previousChargeAmount = getEntityCapacitorAmount(entity);
    if (!consumeEntityCapacitor(entity, runtimeAttributes.capNeed)) {
      return {
        success: false,
        errorMsg: "NOT_ENOUGH_CAPACITOR",
      };
    }
    // CCP parity: Notify the client that capacitor has been consumed so the
    // HUD gauge updates immediately rather than waiting for the next poll.
    notifyCapacitorChangeToSession(session, entity, now, previousChargeAmount);

    const effectState = {
      moduleID: normalizedModuleID,
      moduleFlagID: toInt(moduleItem.flagID, 0),
      effectName,
      groupID: toInt(moduleItem.groupID, 0),
      typeID: toInt(moduleItem.typeID, 0),
      startedAtMs: now,
      durationMs: runtimeAttributes.durationMs,
      nextCycleAtMs: now + runtimeAttributes.durationMs,
      capNeed: runtimeAttributes.capNeed,
      speedFactor: runtimeAttributes.speedFactor,
      speedBoostFactor: runtimeAttributes.speedBoostFactor,
      massAddition: runtimeAttributes.massAddition,
      signatureRadiusBonus: runtimeAttributes.signatureRadiusBonus,
      reactivationDelayMs: runtimeAttributes.reactivationDelayMs,
      guid: PROPULSION_GUID_BY_EFFECT[effectName] || "",
      repeat: normalizeEffectRepeatCount(options.repeat, null),
      deactivationRequestedAtMs: 0,
      deactivateAtMs: 0,
      stopReason: null,
    };
    entity.activeModuleEffects.set(normalizedModuleID, effectState);
    const refreshResult = this.refreshSessionShipDerivedState(session, {
      broadcast: true,
    });
    if (refreshResult.success) {
      notifyPropulsionDerivedAttributesToSession(session, entity, effectState, now);
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          start: true,
          active: true,
          duration: effectState.durationMs,
          useCurrentStamp: true,
        },
        entity,
      );
      notifyModuleEffectState(session, entity, effectState, true, {
        whenMs: now,
        startTimeMs: now,
      });
    }

    return {
      success: true,
      data: {
        entity,
        effectState,
      },
    };
  }

  finalizePropulsionModuleDeactivation(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(
        options.nowMs,
        getEffectCycleBoundaryMs(effectState, this.getCurrentSimTimeMs()),
      ),
    );

    entity.activeModuleEffects.delete(normalizedModuleID);
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    entity.moduleReactivationLocks.set(
      normalizedModuleID,
      stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
    );

    effectState.deactivatedAtMs = stopTimeMs;
    effectState.deactivationRequestedAtMs = 0;
    effectState.deactivateAtMs = 0;
    effectState.stopReason = options.reason || effectState.stopReason || null;

    const refreshResult = this.refreshSessionShipDerivedState(session, {
      broadcast: true,
    });
    if (refreshResult.success) {
      notifyPropulsionDerivedAttributesToSession(session, entity, effectState, stopTimeMs);
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          isOffensive:
            effectState.weaponFamily === "laserTurret",
          start: false,
          active: false,
          duration: effectState.durationMs,
          useCurrentStamp: true,
        },
        entity,
      );
      notifyModuleEffectState(session, entity, effectState, false, {
        whenMs: stopTimeMs,
      });
    }

    return {
      success: true,
      data: {
        entity,
        effectState,
        stoppedAtMs: stopTimeMs,
      },
    };
  }

  deactivatePropulsionModule(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_ACTIVE",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const reason = String(options.reason || "manual");
    const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
    const shouldDefer = options.deferUntilCycle !== false && reason === "manual";

    if (effectState.deactivateAtMs > 0 && effectState.deactivateAtMs > now) {
      return {
        success: true,
        data: {
          entity,
          effectState,
          pending: true,
          deactivateAtMs: effectState.deactivateAtMs,
        },
      };
    }

    if (shouldDefer && cycleBoundaryMs > now + 1) {
      effectState.deactivationRequestedAtMs = now;
      effectState.deactivateAtMs = cycleBoundaryMs;
      effectState.stopReason = reason;
      persistDynamicEntity(entity);
      return {
        success: true,
        data: {
          entity,
          effectState,
          pending: true,
          deactivateAtMs: cycleBoundaryMs,
        },
      };
    }

    return this.finalizePropulsionModuleDeactivation(session, normalizedModuleID, {
      reason,
      nowMs: cycleBoundaryMs > 0 ? cycleBoundaryMs : now,
    });
  }

  // -------------------------------------------------------------------
  // Generic module activation (non-propulsion) — weapons, repairers,
  // shield boosters, etc.  Sends OnGodmaShipEffect with proper timing
  // so the HUD radial cycle ring animates correctly.
  // -------------------------------------------------------------------

  activateGenericModule(session, moduleItem, effectName, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || !moduleItem) {
      return { success: false, errorMsg: "SHIP_NOT_FOUND" };
    }

    const normalizedModuleID = toInt(moduleItem.itemID, 0);
    if (
      normalizedModuleID <= 0 ||
      toInt(moduleItem.locationID, 0) !== toInt(entity.itemID, 0)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_FOUND" };
    }
    if (!isModuleOnline(moduleItem)) {
      return { success: false, errorMsg: "MODULE_NOT_ONLINE" };
    }
    if (!(entity.activeModuleEffects instanceof Map)) {
      entity.activeModuleEffects = new Map();
    }
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    if (entity.activeModuleEffects.has(normalizedModuleID)) {
      return { success: false, errorMsg: "MODULE_ALREADY_ACTIVE" };
    }

    const lockUntil = toFiniteNumber(
      entity.moduleReactivationLocks.get(normalizedModuleID),
      0,
    );
    const now = this.getCurrentSimTimeMs();
    if (lockUntil > now) {
      return { success: false, errorMsg: "MODULE_REACTIVATING" };
    }

    // Resolve the activation effect from the module's type dogma
    let effectRecord = effectName
      ? resolveEffectByName(moduleItem.typeID, effectName)
      : null;
    if (!effectRecord) {
      effectRecord = resolveDefaultActivationEffect(moduleItem.typeID);
    }
    if (!effectRecord) {
      return { success: false, errorMsg: "NO_ACTIVATABLE_EFFECT" };
    }

    const chargeItem =
      session && session.characterID
        ? getLoadedChargeByFlag(session.characterID, entity.itemID, moduleItem.flagID)
        : null;
    const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
    let weaponSnapshot = null;
    let targetEntity = null;
    if (weaponFamily === "laserTurret") {
      if (!chargeItem) {
        return { success: false, errorMsg: "NO_AMMO" };
      }
      const normalizedTargetID = toInt(options.targetID, 0);
      if (normalizedTargetID <= 0) {
        return { success: false, errorMsg: "TARGET_REQUIRED" };
      }
      targetEntity = this.getEntityByID(normalizedTargetID);
      if (!targetEntity || !hasDamageableHealth(targetEntity)) {
        return { success: false, errorMsg: "TARGET_NOT_FOUND" };
      }
      if (!isEntityLockedTarget(entity, normalizedTargetID)) {
        return { success: false, errorMsg: "TARGET_NOT_LOCKED" };
      }
      const shipRecord = getActiveShipRecord(session.characterID) || findShipItemById(entity.itemID);
      if (!shipRecord) {
        return { success: false, errorMsg: "SHIP_NOT_FOUND" };
      }
      weaponSnapshot = buildWeaponModuleSnapshot({
        characterID: session.characterID,
        shipItem: shipRecord,
        moduleItem,
        chargeItem,
      });
      if (!weaponSnapshot) {
        return { success: false, errorMsg: chargeItem ? "UNSUPPORTED_WEAPON" : "NO_AMMO" };
      }
    }
    const shipRecord =
      session && session.characterID
        ? getActiveShipRecord(session.characterID) || findShipItemById(entity.itemID)
        : null;
    const runtimeAttrs = getGenericModuleRuntimeAttributes(
      session && session.characterID,
      shipRecord,
      moduleItem,
      chargeItem,
      weaponSnapshot,
    );
    if (!runtimeAttrs) {
      return { success: false, errorMsg: "UNSUPPORTED_MODULE" };
    }

    if (runtimeAttrs.maxGroupActive > 0) {
      const activeCount = [...entity.activeModuleEffects.values()].filter(
        (es) => toInt(es.groupID, 0) === toInt(moduleItem.groupID, 0),
      ).length;
      if (activeCount >= runtimeAttrs.maxGroupActive) {
        return { success: false, errorMsg: "MAX_GROUP_ACTIVE" };
      }
    }

    const previousChargeAmount = getEntityCapacitorAmount(entity);
    if (!consumeEntityCapacitor(entity, runtimeAttrs.capNeed)) {
      return { success: false, errorMsg: "NOT_ENOUGH_CAPACITOR" };
    }
    notifyCapacitorChangeToSession(session, entity, now, previousChargeAmount);

    const effectState = {
      moduleID: normalizedModuleID,
      moduleFlagID: toInt(moduleItem.flagID, 0),
      effectName: effectRecord.name,
      effectID: toInt(effectRecord.effectID, 0),
      effectCategoryID: toInt(effectRecord.effectCategoryID, 0),
      guid: effectRecord.guid || "",
      groupID: toInt(moduleItem.groupID, 0),
      typeID: toInt(moduleItem.typeID, 0),
      startedAtMs: now,
      durationMs: runtimeAttrs.durationMs,
      durationAttributeID: runtimeAttrs.durationAttributeID,
      nextCycleAtMs: now + runtimeAttrs.durationMs,
      capNeed: runtimeAttrs.capNeed,
      reactivationDelayMs: runtimeAttrs.reactivationDelayMs,
      repeat: normalizeEffectRepeatCount(options.repeat, null),
      targetID:
        weaponSnapshot && weaponSnapshot.family === "laserTurret"
          ? toInt(options.targetID, 0)
          : 0,
      chargeTypeID: toInt(
        (chargeItem && chargeItem.typeID) ||
          (weaponSnapshot && weaponSnapshot.chargeTypeID),
        0,
      ),
      weaponFamily:
        weaponSnapshot && weaponSnapshot.family
          ? weaponSnapshot.family
          : null,
      deactivationRequestedAtMs: 0,
      deactivateAtMs: 0,
      stopReason: null,
      isGeneric: true,
    };
    entity.activeModuleEffects.set(normalizedModuleID, effectState);

    if (effectState.guid) {
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          isOffensive:
            effectState.weaponFamily === "laserTurret" ||
            effectRecord.isOffensive === true,
          start: true,
          active: true,
          duration: effectState.durationMs,
          repeat: resolveSpecialFxRepeatCount(effectState),
          useCurrentStamp: true,
        },
        entity,
      );
    }
    notifyGenericDerivedAttributesToSession(session, effectState, now);
    notifyGenericModuleEffectState(session, entity, effectState, true, {
      whenMs: now,
      startTimeMs: now,
    });

    if (
      targetEntity &&
      (
        effectState.weaponFamily === "laserTurret" ||
        effectRecord.isOffensive === true
      )
    ) {
      try {
        const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
        if (
          crimewatchState &&
          typeof crimewatchState.recordHighSecCriminalAggression === "function"
        ) {
          crimewatchState.recordHighSecCriminalAggression(
            this,
            entity,
            targetEntity,
            now,
          );
        }
      } catch (error) {
        log.warn(`[SpaceRuntime] Crimewatch activation hook failed: ${error.message}`);
      }
    }

    if (effectState.weaponFamily === "laserTurret") {
      const initialCycleResult = executeLaserTurretCycle(
        this,
        entity,
        effectState,
        now,
      );
      if (!initialCycleResult.success) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCycleResult.stopReason || "weapon",
          nowMs: now,
        });
      } else if (
        initialCycleResult.data &&
        initialCycleResult.data.stopReason
      ) {
        this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
          reason: initialCycleResult.data.stopReason,
          nowMs: now,
        });
      }
    }

    return {
      success: true,
      data: { entity, effectState },
    };
  }

  finalizeGenericModuleDeactivation(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const stopTimeMs = Math.max(
      0,
      toFiniteNumber(
        options.nowMs,
        getEffectCycleBoundaryMs(effectState, this.getCurrentSimTimeMs()),
      ),
    );

    entity.activeModuleEffects.delete(normalizedModuleID);
    if (!(entity.moduleReactivationLocks instanceof Map)) {
      entity.moduleReactivationLocks = new Map();
    }
    entity.moduleReactivationLocks.set(
      normalizedModuleID,
      stopTimeMs + Math.max(0, toFiniteNumber(effectState.reactivationDelayMs, 0)),
    );

    effectState.deactivatedAtMs = stopTimeMs;
    effectState.deactivationRequestedAtMs = 0;
    effectState.deactivateAtMs = 0;
    effectState.stopReason = options.reason || effectState.stopReason || null;

    if (effectState.guid) {
      this.broadcastSpecialFx(
        entity.itemID,
        effectState.guid,
        {
          moduleID: effectState.moduleID,
          moduleTypeID: effectState.typeID,
          targetID: effectState.targetID || null,
          chargeTypeID: effectState.chargeTypeID || null,
          isOffensive: effectState.weaponFamily === "laserTurret",
          start: false,
          active: false,
          duration: effectState.durationMs,
          useCurrentStamp: true,
        },
        entity,
      );
    }
    notifyGenericDerivedAttributesToSession(session, effectState, stopTimeMs);
    notifyGenericModuleEffectState(session, entity, effectState, false, {
      whenMs: stopTimeMs,
    });

    return {
      success: true,
      data: { entity, effectState, stoppedAtMs: stopTimeMs },
    };
  }

  deactivateGenericModule(session, moduleID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const normalizedModuleID = toInt(moduleID, 0);
    if (
      !entity ||
      normalizedModuleID <= 0 ||
      !(entity.activeModuleEffects instanceof Map)
    ) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const effectState = entity.activeModuleEffects.get(normalizedModuleID) || null;
    if (!effectState) {
      return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
    }

    const now = this.getCurrentSimTimeMs();
    const reason = String(options.reason || "manual");
    const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
    const shouldDefer = options.deferUntilCycle !== false && reason === "manual";

    if (effectState.deactivateAtMs > 0 && effectState.deactivateAtMs > now) {
      return {
        success: true,
        data: { entity, effectState, pending: true, deactivateAtMs: effectState.deactivateAtMs },
      };
    }

    if (shouldDefer && cycleBoundaryMs > now + 1) {
      effectState.deactivationRequestedAtMs = now;
      effectState.deactivateAtMs = cycleBoundaryMs;
      effectState.stopReason = reason;
      return {
        success: true,
        data: { entity, effectState, pending: true, deactivateAtMs: cycleBoundaryMs },
      };
    }

    return this.finalizeGenericModuleDeactivation(session, normalizedModuleID, {
      reason,
      nowMs: cycleBoundaryMs > 0 ? cycleBoundaryMs : now,
    });
  }

  spawnDynamicEntity(entity, options = {}) {
    if (!entity || !entity.itemID) {
      return {
        success: false,
        errorMsg: "INVALID_DYNAMIC_ENTITY",
      };
    }
    if (this.dynamicEntities.has(entity.itemID)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_ALREADY_EXISTS",
      };
    }

    entity.systemID = this.systemID;
    entity.session = entity.session || null;
    this.reconcileEntityPublicGrid(entity);
    entity.departureBubbleID = null;
    entity.departureBubbleVisibleUntilMs = 0;
    ensureEntityTargetingState(entity);
    this.dynamicEntities.set(entity.itemID, entity);
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistDynamicEntity(entity);

    if (options.broadcast !== false) {
      this.broadcastAddBalls([entity], options.excludedSession || null);
    }

    return {
      success: true,
      data: {
        entity,
      },
    };
  }

  unregisterDynamicEntity(entity, options = {}) {
    if (!entity) {
      return null;
    }

    const visibilityEntity =
      options.broadcast !== false
        ? {
            ...entity,
            publicGridKey: this.getPublicGridKeyForEntity(entity),
            publicGridClusterKey: this.getPublicGridClusterKeyForEntity(entity),
          }
        : null;

    this.clearAllTargetingForEntity(entity, {
      notifySelf: entity.session ? isReadyForDestiny(entity.session) : false,
      notifyTarget: true,
      reason:
        toInt(options && options.terminalDestructionEffectID, 0) > 0
          ? TARGET_LOSS_REASON_EXPLODING
          : TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
    });
    persistDynamicEntity(entity);
    this.removeEntityFromBubble(entity);
    entity.publicGridKey = null;
    entity.publicGridClusterKey = null;
    entity.departureBubbleID = null;
    entity.departureBubbleVisibleUntilMs = 0;
    this.dynamicEntities.delete(entity.itemID);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    if (options.broadcast !== false) {
      this.broadcastRemoveBall(entity.itemID, options.excludedSession || null, {
        terminalDestructionEffectID: options.terminalDestructionEffectID,
        visibilityEntity,
      });
    } else {
      for (const session of this.sessions.values()) {
        if (
          session &&
          session._space &&
          session._space.visibleDynamicEntityIDs instanceof Set
        ) {
          session._space.visibleDynamicEntityIDs.delete(entity.itemID);
        }
      }
    }
    return entity;
  }

  removeDynamicEntity(entityID, options = {}) {
    const entity = this.dynamicEntities.get(Number(entityID)) || null;
    if (!entity) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }
    if (entity.session && options.allowSessionOwned !== true) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_SESSION_OWNED",
      };
    }

    this.unregisterDynamicEntity(entity, options);
    return {
      success: true,
      data: {
        entityID: entity.itemID,
      },
    };
  }

  destroyInventoryBackedDynamicEntity(entityID, options = {}) {
    const entity = this.dynamicEntities.get(Number(entityID)) || null;
    if (!isInventoryBackedDynamicEntity(entity)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    this.unregisterDynamicEntity(entity, options);
    const removeResult = removeInventoryItem(entity.itemID, {
      removeContents: options.removeContents !== false,
    });
    if (!removeResult.success) {
      return removeResult;
    }

    return {
      success: true,
      data: {
        entityID: entity.itemID,
        changes: removeResult.data && removeResult.data.changes,
      },
    };
  }

  destroyExpiredInventoryBackedEntities(now = this.getCurrentSimTimeMs()) {
    const numericNow = toFiniteNumber(now, this.getCurrentSimTimeMs());
    const expiredEntityIDs = [...this.dynamicEntities.values()]
      .filter((entity) =>
        isInventoryBackedDynamicEntity(entity) &&
        toFiniteNumber(entity.expiresAtMs, 0) > 0 &&
        toFiniteNumber(entity.expiresAtMs, 0) <= numericNow,
      )
      .map((entity) => entity.itemID);

    const destroyedEntityIDs = [];
    for (const entityID of expiredEntityIDs) {
      const destroyResult = this.destroyInventoryBackedDynamicEntity(entityID);
      if (destroyResult.success) {
        destroyedEntityIDs.push(entityID);
      }
    }

    return destroyedEntityIDs;
  }

  sendSlimItemChangesToSession(session, entities) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(entities) ||
      entities.length === 0
    ) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    const stamp = this.getNextDestinyStamp();
    const updates = refreshedEntities
      .filter(Boolean)
      .map((entity) => ({
        stamp,
        payload: destiny.buildOnSlimItemChangePayload(
          entity.itemID,
          destiny.buildSlimItemObject(entity),
        ),
      }));
    if (updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates);
  }

  broadcastSpecialFx(shipID, guid, options = {}, visibilityEntity = null) {
    const resolvedOptions = resolveSpecialFxOptionsForEntity(
      shipID,
      options,
      visibilityEntity,
    );
    const payload = destiny.buildOnSpecialFXPayload(
      shipID,
      guid,
      resolvedOptions,
    );
    // Use current stamp when requested so Michelle dispatches immediately rather
    // than queuing for a future tick. Critical under TiDi where the next tick is
    // delayed and a session change can tear down the ballpark before it arrives.
    const baseStamp = resolvedOptions.useCurrentStamp
      ? this.getCurrentDestinyStamp()
      : this.getNextDestinyStamp();
    let deliveredCount = 0;
    let resultStamp = null;

    for (const session of this.sessions.values()) {
      if (!isReadyForDestiny(session)) {
        continue;
      }
      if (
        visibilityEntity &&
        !this.canSessionSeeDynamicEntity(session, visibilityEntity)
      ) {
        continue;
      }

      const useImmediateVisibleStamp =
        resolvedOptions.useImmediateClientVisibleStamp === true &&
        sessionMatchesIdentity(session, resolvedOptions.resultSession);
      const stamp = useImmediateVisibleStamp
        ? this.getImmediateDestinyStampForSession(session, baseStamp)
        : resolvedOptions.useLastClientVisibleStamp
          ? this.getLastSentDestinyStampForSession(session, baseStamp)
          : baseStamp;
      this.sendDestinyUpdates(session, [
        {
          stamp,
          payload,
        },
      ], false, {
        translateStamps:
          useImmediateVisibleStamp || options.useLastClientVisibleStamp
            ? false
            : undefined,
      });
      deliveredCount += 1;
      if (
        resultStamp === null &&
        (
          resolvedOptions.resultSession === undefined ||
          resolvedOptions.resultSession === null ||
          sessionMatchesIdentity(session, resolvedOptions.resultSession)
        )
      ) {
        resultStamp = stamp;
      }
    }

    return {
      stamp: resultStamp === null ? baseStamp : resultStamp,
      deliveredCount,
    };
  }

  broadcastSlimItemChanges(entities, excludedSession = null) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendSlimItemChangesToSession(session, entities);
    }
  }

  broadcastBallRefresh(entities, excludedSession = null) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const visibleEntities = refreshedEntities.filter((entity) =>
        this.canSessionSeeDynamicEntity(session, entity),
      );
      if (visibleEntities.length === 0) {
        continue;
      }
      this.sendAddBallsToSession(session, visibleEntities);
    }
  }

  sendAddBallsToSession(session, entities) {
    if (!session || !isReadyForDestiny(session) || entities.length === 0) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    const rawStamp = this.getNextDestinyStamp();
    const rawSimTimeMs = this.getCurrentSimTimeMs();
    const stamp = this.translateDestinyStampForSession(session, rawStamp);
    const simFileTime = this.getCurrentSessionFileTime(session, rawSimTimeMs);
    this.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildAddBalls2Payload(stamp, refreshedEntities, simFileTime),
      },
    ], false, { translateStamps: false });
    const primeUpdates = buildShipPrimeUpdatesForEntities(refreshedEntities, stamp);
    if (primeUpdates.length > 0) {
      this.sendDestinyUpdates(session, primeUpdates, false, {
        translateStamps: false,
      });
    }
    const modeUpdates = [];
    for (const entity of refreshedEntities) {
      modeUpdates.push(...this.buildModeUpdates(entity, stamp));
    }
    if (modeUpdates.length > 0) {
      this.sendDestinyUpdates(session, modeUpdates, false, {
        translateStamps: false,
      });
    }
  }

  sendRemoveBallsToSession(session, entityIDs) {
    if (!session || !isReadyForDestiny(session) || entityIDs.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, [
      {
        stamp: this.getNextDestinyStamp(),
        payload: destiny.buildRemoveBallsPayload(entityIDs),
      },
    ]);
  }

  broadcastDestinyUpdatesToBubble(bubbleID, updates, options = {}) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return {
        deliveredCount: 0,
      };
    }

    let deliveredCount = 0;
    for (const session of this.getSessionsInBubble(bubbleID)) {
      if (session === options.excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(session, updates, options.waitForBubble === true);
      deliveredCount += 1;
    }

    return {
      deliveredCount,
    };
  }

  syncDynamicVisibilityForSession(session, now = this.getCurrentSimTimeMs()) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return;
    }

    const desiredEntities = this.getVisibleDynamicEntitiesForSession(session, now).filter(
      (entity) => entity.itemID !== egoEntity.itemID,
    );
    const desiredIDs = new Set(desiredEntities.map((entity) => entity.itemID));
    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();

    const addedEntities = desiredEntities.filter(
      (entity) => !currentIDs.has(entity.itemID),
    );
    const removedIDs = [...currentIDs].filter((entityID) => !desiredIDs.has(entityID));

    if (removedIDs.length > 0) {
      this.sendRemoveBallsToSession(session, removedIDs);
    }
    if (addedEntities.length > 0) {
      this.sendAddBallsToSession(session, addedEntities);
    }

    if (removedIDs.length > 0 || addedEntities.length > 0) {
      logBubbleDebug("bubble.visibility_sync", {
        systemID: this.systemID,
        sessionCharacterID: toInt(session.charID, 0),
        sessionShipID: toInt(session._space.shipID, 0),
        egoBubbleID: toInt(egoEntity.bubbleID, 0),
        addedEntityIDs: addedEntities.map((entity) => toInt(entity.itemID, 0)),
        removedEntityIDs: removedIDs.map((entityID) => toInt(entityID, 0)),
        desiredVisibleEntityIDs: [...desiredIDs].map((entityID) => toInt(entityID, 0)),
      });
    }

    session._space.visibleDynamicEntityIDs = desiredIDs;
  }

  syncDynamicVisibilityForAllSessions(now = this.getCurrentSimTimeMs()) {
    for (const session of this.sessions.values()) {
      this.syncDynamicVisibilityForSession(session, now);
    }
  }

  buildModeUpdates(entity, stampOverride = null) {
    const updates = [];
    const modeStamp =
      stampOverride === null
        ? this.getNextDestinyStamp()
        : toInt(stampOverride, this.getNextDestinyStamp());

    switch (entity.mode) {
      case "GOTO":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildGotoDirectionPayload(
            entity.itemID,
            getCommandDirection(entity, entity.direction),
          ),
        });
        break;
      case "FOLLOW":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildFollowBallPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.followRange,
          ),
        });
        break;
      case "ORBIT":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildOrbitPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.orbitDistance,
          ),
        });
        break;
      case "WARP":
        if (entity.warpState) {
          if (entity.pendingWarp && toInt(entity.warpState.effectStamp, 0) < 0) {
            updates.push(
              buildWarpPrepareCommandUpdate(
                entity,
                modeStamp,
                entity.warpState,
              ),
            );
          } else {
            updates.push(
              ...buildWarpInFlightAcquireUpdates(
                entity,
                entity.warpState,
                modeStamp,
              ),
            );
          }
        }
        break;
      default:
        break;
    }

    if (entity.mode !== "WARP" && entity.speedFraction > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }
    if (entity.mode !== "WARP" && magnitude(entity.velocity) > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetBallVelocityPayload(
          entity.itemID,
          entity.velocity,
        ),
      });
    }

    return updates;
  }

  attachSession(session, shipItem, options = {}) {
    if (!session || !shipItem) {
      return null;
    }

    const shipEntity = buildShipEntity(session, shipItem, this.systemID);
    if (
      shipEntity.mode === "WARP" &&
      shipEntity.warpState &&
      !shipEntity.pendingWarp
    ) {
      log.warn(
        `[SpaceRuntime] Restoring persisted warp state for ship=${shipEntity.itemID} on login is unsupported; spawning stopped at current position instead.`,
      );
      resetEntityMotion(shipEntity);
      shipEntity.warpState = null;
      shipEntity.pendingWarp = null;
      shipEntity.targetEntityID = null;
    }
    if (options.skipLegacyStationNormalization !== true) {
      normalizeLegacyStationState(shipEntity);
    }
    if (options.spawnStopped) {
      resetEntityMotion(shipEntity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        shipEntity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    ensureEntityTargetingState(shipEntity);
    session._space = {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: Boolean(options.initialStateSent),
      initialBallparkVisualsSent: false,
      initialBallparkClockSynced: false,
      deferInitialBallparkClockUntilBind:
        options.deferInitialBallparkClockUntilBind === true,
      deferInitialBallparkStateUntilBind:
        options.deferInitialBallparkStateUntilBind === true,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
      visibleDynamicEntityIDs: new Set(),
      clockOffsetMs: 0,
      lastSentDestinyStamp: null,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
    };

    this.sessions.set(session.clientID, session);
    this.dynamicEntities.set(shipEntity.itemID, shipEntity);
    this.reconcileEntityPublicGrid(shipEntity);
    this.reconcileEntityBubble(shipEntity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistShipEntity(shipEntity);
    session._skipNextInitialBallparkRebase =
      options.skipNextInitialBallparkRebase === true;
    session._nextInitialBallparkPreviousSimTimeMs =
      options.initialBallparkPreviousSimTimeMs === undefined ||
      options.initialBallparkPreviousSimTimeMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousSimTimeMs, null);
    session._nextInitialBallparkPreviousTimeDilation =
      options.initialBallparkPreviousTimeDilation === undefined ||
      options.initialBallparkPreviousTimeDilation === null
        ? null
        : clampTimeDilationFactor(options.initialBallparkPreviousTimeDilation);
    session._nextInitialBallparkPreviousCapturedAtWallclockMs =
      options.initialBallparkPreviousCapturedAtWallclockMs === undefined ||
      options.initialBallparkPreviousCapturedAtWallclockMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousCapturedAtWallclockMs, null);
    const attachedSceneCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const preservedCurrentSessionSimTimeMs = resolvePreservedSimTimeMs(
      options.initialBallparkPreviousSimTimeMs,
      options.initialBallparkPreviousTimeDilation,
      options.initialBallparkPreviousCapturedAtWallclockMs,
      null,
    );
    if (preservedCurrentSessionSimTimeMs !== null) {
      session._space.clockOffsetMs = roundNumber(
        preservedCurrentSessionSimTimeMs - attachedSceneCurrentSimTimeMs,
        3,
      );
    }
    const syncResult = this.syncSessionSimClock(session, {
      previousSimTimeMs: options.previousSimTimeMs,
      currentSimTimeMs:
        preservedCurrentSessionSimTimeMs === null
          ? undefined
          : preservedCurrentSessionSimTimeMs,
      emit: options.emitSimClockRebase !== false,
      forceRebase: options.forceSimClockRebase === true,
    });
    recordSessionJumpTimingTrace(session, "attach-session", {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      options: {
        beyonceBound: options.beyonceBound === true,
        pendingUndockMovement: options.pendingUndockMovement === true,
        spawnStopped: options.spawnStopped === true,
        broadcast: options.broadcast !== false,
        emitSimClockRebase: options.emitSimClockRebase !== false,
        forceSimClockRebase: options.forceSimClockRebase === true,
        previousSimTimeMs:
          options.previousSimTimeMs === undefined ? null : options.previousSimTimeMs,
        initialBallparkPreviousSimTimeMs:
          options.initialBallparkPreviousSimTimeMs === undefined
            ? null
            : options.initialBallparkPreviousSimTimeMs,
        initialBallparkPreviousTimeDilation:
          options.initialBallparkPreviousTimeDilation === undefined
            ? null
            : options.initialBallparkPreviousTimeDilation,
        initialBallparkPreviousCapturedAtWallclockMs:
          options.initialBallparkPreviousCapturedAtWallclockMs === undefined
            ? null
            : options.initialBallparkPreviousCapturedAtWallclockMs,
        deferInitialBallparkClockUntilBind:
          options.deferInitialBallparkClockUntilBind === true,
        deferInitialBallparkStateUntilBind:
          options.deferInitialBallparkStateUntilBind === true,
      },
      sceneTimeState: this.buildTimeStateSnapshot(),
      sessionClockOffsetMs: session._space.clockOffsetMs,
      syncResult,
    });

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} ship=${shipEntity.itemID} to system ${this.systemID}`,
    );

    if (options.broadcast !== false) {
      if (options.emitEgoBallAdd === true && isReadyForDestiny(session)) {
        // Same-ballpark ship swaps (for example ejecting into a fresh capsule)
        // still need the new ego ball inserted into Michelle. Visibility sync
        // intentionally excludes the ego ship, so seed it explicitly first.
        this.sendAddBallsToSession(session, [shipEntity]);
      }
      this.syncDynamicVisibilityForAllSessions();
    }

    return shipEntity;
  }

  attachSessionToExistingEntity(session, shipItem, entity, options = {}) {
    if (!session || !shipItem || !entity || entity.kind !== "ship") {
      return null;
    }

    applySessionStateToShipEntity(entity, session, shipItem);
    ensureEntityTargetingState(entity);
    if (
      entity.mode === "WARP" &&
      entity.warpState &&
      !entity.pendingWarp
    ) {
      log.warn(
        `[SpaceRuntime] Restoring persisted warp state for boarded ship=${entity.itemID} is unsupported; spawning stopped at current position instead.`,
      );
      resetEntityMotion(entity);
      entity.warpState = null;
      entity.pendingWarp = null;
      entity.targetEntityID = null;
    }
    if (options.skipLegacyStationNormalization !== true) {
      normalizeLegacyStationState(entity);
    }
    if (options.spawnStopped) {
      resetEntityMotion(entity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        entity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    session._space = {
      systemID: this.systemID,
      shipID: entity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: Boolean(options.initialStateSent),
      initialBallparkVisualsSent: false,
      initialBallparkClockSynced: false,
      deferInitialBallparkClockUntilBind:
        options.deferInitialBallparkClockUntilBind === true,
      deferInitialBallparkStateUntilBind:
        options.deferInitialBallparkStateUntilBind === true,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
      visibleDynamicEntityIDs: new Set(),
      clockOffsetMs: 0,
      lastSentDestinyStamp: null,
      timeDilation: this.getTimeDilation(),
      simTimeMs: this.getCurrentSimTimeMs(),
      simFileTime: this.getCurrentFileTime(),
    };

    this.sessions.set(session.clientID, session);
    this.reconcileEntityPublicGrid(entity);
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistShipEntity(entity);
    session._skipNextInitialBallparkRebase =
      options.skipNextInitialBallparkRebase === true;
    session._nextInitialBallparkPreviousSimTimeMs =
      options.initialBallparkPreviousSimTimeMs === undefined ||
      options.initialBallparkPreviousSimTimeMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousSimTimeMs, null);
    session._nextInitialBallparkPreviousTimeDilation =
      options.initialBallparkPreviousTimeDilation === undefined ||
      options.initialBallparkPreviousTimeDilation === null
        ? null
        : clampTimeDilationFactor(options.initialBallparkPreviousTimeDilation);
    session._nextInitialBallparkPreviousCapturedAtWallclockMs =
      options.initialBallparkPreviousCapturedAtWallclockMs === undefined ||
      options.initialBallparkPreviousCapturedAtWallclockMs === null
        ? null
        : toFiniteNumber(options.initialBallparkPreviousCapturedAtWallclockMs, null);
    const attachedExistingSceneCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const preservedExistingSessionSimTimeMs = resolvePreservedSimTimeMs(
      options.initialBallparkPreviousSimTimeMs,
      options.initialBallparkPreviousTimeDilation,
      options.initialBallparkPreviousCapturedAtWallclockMs,
      null,
    );
    if (preservedExistingSessionSimTimeMs !== null) {
      session._space.clockOffsetMs = roundNumber(
        preservedExistingSessionSimTimeMs - attachedExistingSceneCurrentSimTimeMs,
        3,
      );
    }
    const syncResult = this.syncSessionSimClock(session, {
      previousSimTimeMs: options.previousSimTimeMs,
      currentSimTimeMs:
        preservedExistingSessionSimTimeMs === null
          ? undefined
          : preservedExistingSessionSimTimeMs,
      emit: options.emitSimClockRebase !== false,
      forceRebase: options.forceSimClockRebase === true,
    });
    recordSessionJumpTimingTrace(session, "attach-session-existing-entity", {
      systemID: this.systemID,
      shipID: entity.itemID,
      options: {
        beyonceBound: options.beyonceBound === true,
        pendingUndockMovement: options.pendingUndockMovement === true,
        spawnStopped: options.spawnStopped === true,
        broadcast: options.broadcast !== false,
        emitSimClockRebase: options.emitSimClockRebase !== false,
        forceSimClockRebase: options.forceSimClockRebase === true,
        previousSimTimeMs:
          options.previousSimTimeMs === undefined ? null : options.previousSimTimeMs,
        initialBallparkPreviousSimTimeMs:
          options.initialBallparkPreviousSimTimeMs === undefined
            ? null
            : options.initialBallparkPreviousSimTimeMs,
        initialBallparkPreviousTimeDilation:
          options.initialBallparkPreviousTimeDilation === undefined
            ? null
            : options.initialBallparkPreviousTimeDilation,
        initialBallparkPreviousCapturedAtWallclockMs:
          options.initialBallparkPreviousCapturedAtWallclockMs === undefined
            ? null
            : options.initialBallparkPreviousCapturedAtWallclockMs,
        deferInitialBallparkClockUntilBind:
          options.deferInitialBallparkClockUntilBind === true,
        deferInitialBallparkStateUntilBind:
          options.deferInitialBallparkStateUntilBind === true,
      },
      sceneTimeState: this.buildTimeStateSnapshot(),
      sessionClockOffsetMs: session._space.clockOffsetMs,
      syncResult,
    });

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} to existing ship=${entity.itemID} in system ${this.systemID}`,
    );

    if (options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity]);
      this.broadcastBallRefresh([entity], session);
      this.syncDynamicVisibilityForAllSessions();
    }

    return entity;
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    recordSessionJumpTimingTrace(session, "detach-session", {
      systemID: session._space.systemID,
      shipID: session._space.shipID,
      broadcast: options.broadcast !== false,
      sessionSimTimeMs: session._space.simTimeMs,
      sessionSimFileTime: session._space.simFileTime,
      sessionTimeDilation: session._space.timeDilation,
    });
    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);
    if (entity) {
      this.clearAllTargetingForEntity(entity, {
        notifySelf: false,
        notifyTarget: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      this.unregisterDynamicEntity(entity, {
        broadcast: options.broadcast !== false,
        excludedSession: session,
      });
    }

    session._space = null;
  }

  disembarkSession(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);

    if (entity) {
      this.clearAllTargetingForEntity(entity, {
        notifySelf: true,
        notifyTarget: true,
        reason: TARGET_LOSS_REASON_ATTEMPT_CANCELLED,
      });
      clearSessionStateFromShipEntity(entity);
      persistShipEntity(entity);
    }

    session._space = null;

    if (entity && options.broadcast !== false) {
      this.broadcastSlimItemChanges([entity]);
      this.broadcastBallRefresh([entity], session);
    }

    return entity;
  }

  markBeyonceBound(session) {
    if (session && session._space) {
      session._space.beyonceBound = true;
    }
  }

  sendDestinyUpdates(session, payloads, waitForBubble = false, options = {}) {
    if (!session || payloads.length === 0) {
      return;
    }

    this.refreshSessionClockSnapshot(session);
    const translateStamps = options.translateStamps === true;
    let groupedUpdates = [];
    let currentStamp = null;
    let firstGroup = true;
    const flushGroup = () => {
      if (groupedUpdates.length === 0) {
        return;
      }

      logDestinyDispatch(session, groupedUpdates, waitForBubble && firstGroup);
      session.sendNotification(
        "DoDestinyUpdate",
        "clientID",
        destiny.buildDestinyUpdatePayload(
          groupedUpdates,
          waitForBubble && firstGroup,
        ),
      );
      if (session._space) {
        session._space.lastSentDestinyStamp = currentStamp;
      }
      groupedUpdates = [];
      currentStamp = null;
      firstGroup = false;
    };

    for (const rawPayload of payloads) {
      const payload =
        !translateStamps || !rawPayload
          ? rawPayload
          : {
              ...rawPayload,
              stamp: this.translateDestinyStampForSession(
                session,
                rawPayload.stamp,
              ),
            };
      const stamp = Number(payload && payload.stamp);
      if (groupedUpdates.length === 0) {
        groupedUpdates.push(payload);
        currentStamp = stamp;
        continue;
      }

      if (stamp === currentStamp) {
        groupedUpdates.push(payload);
        continue;
      }

      flushGroup();
      groupedUpdates.push(payload);
      currentStamp = stamp;
    }

    flushGroup();
  }

  sendDestinyBatch(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    logDestinyDispatch(session, payloads, waitForBubble);
    session.sendNotification(
      "DoDestinyUpdate",
      "clientID",
      destiny.buildDestinyUpdatePayload(payloads, waitForBubble),
    );
  }

  sendDestinyUpdatesIndividually(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    for (let index = 0; index < payloads.length; index += 1) {
      this.sendDestinyUpdates(session, [payloads[index]], waitForBubble && index === 0);
    }
  }

  sendMovementUpdatesToSession(session, updates) {
    if (!session || !isReadyForDestiny(session) || updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates);
  }

  sendStateRefresh(session, egoEntity, stampOverride = null) {
    if (!session || !egoEntity || !isReadyForDestiny(session)) {
      return;
    }

    refreshShipPresentationFields(egoEntity);
    const visibleEntities = refreshEntitiesForSlimPayload(
      this.getVisibleEntitiesForSession(session),
    );
    const rawStamp =
      stampOverride === null
        ? this.getNextDestinyStamp()
        : toInt(stampOverride, this.getNextDestinyStamp());
    const rawSimTimeMs = this.getCurrentSimTimeMs();
    const stamp = this.translateDestinyStampForSession(session, rawStamp);
    const simFileTime = this.getCurrentSessionFileTime(session, rawSimTimeMs);
    this.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildSetStatePayload(
          stamp,
          this.system,
          egoEntity.itemID,
          visibleEntities,
          simFileTime,
        ),
      },
    ], false, { translateStamps: false });
  }

  ensureInitialBallpark(session, options = {}) {
    if (!session || !session._space) {
      return false;
    }

    if (session._space.initialStateSent && options.force !== true) {
      return true;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }

    refreshShipPresentationFields(egoEntity);
    const dynamicEntities = refreshEntitiesForSlimPayload(
      this.getVisibleDynamicEntitiesForSession(session),
    );
    const visibleEntities = refreshEntitiesForSlimPayload(
      this.getVisibleEntitiesForSession(session),
    );
    // V23.02 expects the initial bootstrap as a split AddBalls2 -> SetState ->
    // prime/mode sequence. Collapsing everything into one waitForBubble batch
    // leaves Michelle stuck in "state waiting: yes" on login.
    const deferInitialBallparkStateUntilBind =
      session._space.deferInitialBallparkStateUntilBind === true;
    const deferInitialBallparkClockUntilBind =
      session._space.deferInitialBallparkClockUntilBind === true;
    const allowDeferredJumpBootstrapVisuals =
      options.allowDeferredJumpBootstrapVisuals === true;
    const skipInitialBallparkRebase = session._skipNextInitialBallparkRebase === true;
    const initialBallparkPreviousSimTimeMs = resolveBootstrapPreviousSimTimeMs(
      session,
      undefined,
    );
    const currentFactor = this.getTimeDilation();
    const rawCurrentSimTimeMs = this.getCurrentSimTimeMs();
    const currentSimTimeMs =
      initialBallparkPreviousSimTimeMs === undefined ||
      initialBallparkPreviousSimTimeMs === null
        ? this.getCurrentSessionSimTimeMs(session, rawCurrentSimTimeMs)
        : initialBallparkPreviousSimTimeMs;
    session._space.clockOffsetMs = roundNumber(
      currentSimTimeMs - rawCurrentSimTimeMs,
      3,
    );
    this.refreshSessionClockSnapshot(session, rawCurrentSimTimeMs, {
      currentSimTimeMs,
    });
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-enter", {
      options,
      deferInitialBallparkStateUntilBind,
      deferInitialBallparkClockUntilBind,
      allowDeferredJumpBootstrapVisuals,
      skipInitialBallparkRebase,
      initialBallparkPreviousSimTimeMs,
      currentFactor,
      sceneTimeState: this.buildTimeStateSnapshot(),
    });

    const syncClockOnce = () => {
      if (session._space.initialBallparkClockSynced === true) {
        return;
      }

      // Always announce the destination scene's TiDi factor as part of the
      // first jump bootstrap. Cross-system jumps that leave TiDi need the
      // client clock resynced immediately, but seeding SetState too early
      // causes Michelle to run backwards when the destination scene swaps in.
      sendTimeDilationNotificationToSession(session, currentFactor);

      const syncResult = this.syncSessionSimClock(session, {
        previousSimTimeMs: initialBallparkPreviousSimTimeMs,
        currentSimTimeMs,
        emit: skipInitialBallparkRebase ? false : true,
        forceRebase: skipInitialBallparkRebase ? false : true,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-sync-clock", {
        currentFactor,
        skipInitialBallparkRebase,
        initialBallparkPreviousSimTimeMs,
        syncResult,
      });
      session._skipNextInitialBallparkRebase = false;
      session._nextInitialBallparkPreviousSimTimeMs = null;
      session._nextInitialBallparkPreviousTimeDilation = null;
      session._nextInitialBallparkPreviousCapturedAtWallclockMs = null;
      session._space.initialBallparkClockSynced = true;
    };

    const updateVisibleDynamicEntities = () => {
      session._space.visibleDynamicEntityIDs = new Set(
        dynamicEntities
          .filter((entity) => entity.itemID !== egoEntity.itemID)
          .map((entity) => entity.itemID),
      );
    };

    const bootstrapBaseRawStamp = this.getCurrentDestinyStamp(rawCurrentSimTimeMs);
    const bootstrapFileTime = this.getCurrentSessionFileTime(
      session,
      rawCurrentSimTimeMs,
    );
    const addBallsStamp = this.translateDestinyStampForSession(
      session,
      bootstrapBaseRawStamp,
    );
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-bootstrap-state", {
      currentSimTimeMs,
      bootstrapBaseStamp: addBallsStamp,
      bootstrapBaseRawStamp,
      bootstrapFileTime,
      addBallsStamp,
      dynamicEntityCount: dynamicEntities.length,
      visibleEntityCount: visibleEntities.length,
    });

    if (
      deferInitialBallparkStateUntilBind &&
      allowDeferredJumpBootstrapVisuals === true
    ) {
      if (!deferInitialBallparkClockUntilBind) {
        syncClockOnce();
      }
      if (session._space.initialBallparkVisualsSent !== true) {
        this.sendDestinyUpdates(session, [
          {
            stamp: addBallsStamp,
            payload: destiny.buildAddBalls2Payload(
              addBallsStamp,
              dynamicEntities,
              bootstrapFileTime,
            ),
          },
        ], true, { translateStamps: false });
        recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-addballs-only", {
          addBallsStamp,
          bootstrapFileTime,
          dynamicEntityCount: dynamicEntities.length,
        });
        session._space.initialBallparkVisualsSent = true;
        updateVisibleDynamicEntities();
      }

      return true;
    }

    syncClockOnce();
    const setStateRawStamp = (bootstrapBaseRawStamp + 1) >>> 0;
    const setStateStamp = this.translateDestinyStampForSession(
      session,
      setStateRawStamp,
    );
    const primeStamp = setStateStamp;
    const modeStamp = setStateStamp;
    this.nextStamp = Math.max(this.nextStamp, setStateRawStamp);

    const setStateUpdate = {
      stamp: setStateStamp,
      payload: destiny.buildSetStatePayload(
        setStateStamp,
        this.system,
        egoEntity.itemID,
        visibleEntities,
        bootstrapFileTime,
      ),
    };

    const primeUpdates = buildShipPrimeUpdatesForEntities(dynamicEntities, primeStamp);
    const followUp = this.buildModeUpdates(egoEntity, modeStamp);
    logBallDebug("bootstrap.ego", egoEntity, {
      addBallsStamp,
      setStateStamp,
      primeStamp,
      modeStamp,
      dynamicEntityCount: dynamicEntities.length,
      visibleEntityCount: visibleEntities.length,
      addBallsAlreadySent: session._space.initialBallparkVisualsSent === true,
      deferredStateUntilBind: deferInitialBallparkStateUntilBind,
    });

    if (session._space.initialBallparkVisualsSent !== true) {
      this.sendDestinyUpdates(session, [
        {
          stamp: addBallsStamp,
          payload: destiny.buildAddBalls2Payload(
            addBallsStamp,
            dynamicEntities,
            bootstrapFileTime,
          ),
        },
      ], true, { translateStamps: false });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-addballs", {
        addBallsStamp,
        bootstrapFileTime,
        dynamicEntityCount: dynamicEntities.length,
      });
      session._space.initialBallparkVisualsSent = true;
    }

    this.sendDestinyUpdates(session, [setStateUpdate], false, {
      translateStamps: false,
    });
    recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-setstate", {
      setStateStamp,
      bootstrapFileTime,
      visibleEntityCount: visibleEntities.length,
    });
    if (primeUpdates.length > 0) {
      this.sendDestinyUpdates(session, primeUpdates, false, {
        translateStamps: false,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-prime", {
        primeStamp,
        primeUpdateCount: primeUpdates.length,
      });
    }
    if (followUp.length > 0) {
      this.sendDestinyUpdates(session, followUp, false, {
        translateStamps: false,
      });
      recordSessionJumpTimingTrace(session, "ensure-initial-ballpark-followup", {
        modeStamp,
        followUpCount: followUp.length,
      });
    }

    session._space.initialStateSent = true;
    session._space.pendingUndockMovement = false;
    session._space.deferInitialBallparkClockUntilBind = false;
    session._space.deferInitialBallparkStateUntilBind = false;
    updateVisibleDynamicEntities();
    return true;
  }

  broadcastAddBalls(entities, excludedSession = null) {
    if (entities.length === 0) {
      return;
    }

    const refreshedEntities = refreshEntitiesForSlimPayload(entities);
    const rawStamp = this.getNextDestinyStamp();
    const rawSimTimeMs = this.getCurrentSimTimeMs();

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const visibleEntities = refreshedEntities.filter((entity) =>
        this.canSessionSeeDynamicEntity(session, entity),
      );
      if (visibleEntities.length === 0) {
        continue;
      }
      const stamp = rawStamp;
      const translatedStamp = this.translateDestinyStampForSession(session, rawStamp);
      const simFileTime = this.getCurrentSessionFileTime(session, rawSimTimeMs);
      this.sendDestinyUpdates(session, [
        {
          payload: destiny.buildAddBalls2Payload(
            translatedStamp,
            visibleEntities,
            simFileTime,
          ),
          stamp: translatedStamp,
        },
      ], false, { translateStamps: false });
      const primeUpdates = buildShipPrimeUpdatesForEntities(
        visibleEntities,
        translatedStamp,
      );
      if (primeUpdates.length > 0) {
        this.sendDestinyUpdates(session, primeUpdates, false, {
          translateStamps: false,
        });
      }
      const modeUpdates = [];
      for (const entity of visibleEntities) {
        modeUpdates.push(...this.buildModeUpdates(entity, translatedStamp));
      }
      if (modeUpdates.length > 0) {
        this.sendDestinyUpdates(session, modeUpdates, false, {
          translateStamps: false,
        });
      }
      if (session._space) {
        const currentIDs =
          session._space.visibleDynamicEntityIDs instanceof Set
            ? session._space.visibleDynamicEntityIDs
            : new Set();
        for (const entity of visibleEntities) {
          if (entity.itemID !== session._space.shipID) {
            currentIDs.add(entity.itemID);
          }
        }
        session._space.visibleDynamicEntityIDs = currentIDs;
      }
    }
  }

  broadcastRemoveBall(entityID, excludedSession = null, options = {}) {
    const normalizedEntityID = toInt(entityID, 0);
    const terminalDestructionEffectID = toInt(
      options && options.terminalDestructionEffectID,
      0,
    );
    const visibilityEntity =
      options && options.visibilityEntity && typeof options.visibilityEntity === "object"
        ? options.visibilityEntity
        : null;
    const stamp = this.getNextDestinyStamp();
    const updates = [];
    if (terminalDestructionEffectID > 0) {
      updates.push({
        stamp,
        payload: destiny.buildTerminalPlayDestructionEffectPayload(
          normalizedEntityID,
          terminalDestructionEffectID,
        ),
      });
    }
    updates.push({
      stamp,
      payload: destiny.buildRemoveBallsPayload([normalizedEntityID]),
    });

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const visibleEntityIDs =
        session._space && session._space.visibleDynamicEntityIDs instanceof Set
          ? session._space.visibleDynamicEntityIDs
          : null;
      const wasMarkedVisible =
        visibleEntityIDs instanceof Set && visibleEntityIDs.has(normalizedEntityID);
      const canStillSeeEntity =
        visibilityEntity && this.canSessionSeeDynamicEntity(session, visibilityEntity);
      if (!wasMarkedVisible && !canStillSeeEntity) {
        continue;
      }

      // Be tolerant of visibility-cache drift so observers still drop ghost balls
      // when the scene says they can see the entity but the cached set missed it.
      this.sendDestinyUpdates(session, updates);
      if (visibleEntityIDs instanceof Set) {
        visibleEntityIDs.delete(normalizedEntityID);
      }
    }
  }

  broadcastMovementUpdates(updates, excludedSession = null) {
    if (updates.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const filteredUpdates = updates.filter((update) => {
        const entityID = getPayloadPrimaryEntityID(update && update.payload);
        if (!entityID) {
          return true;
        }
        if (session._space && entityID === session._space.shipID) {
          return true;
        }
        const entity = this.dynamicEntities.get(entityID);
        if (!entity) {
          return true;
        }
        return this.canSessionSeeDynamicEntity(session, entity);
      });
      if (filteredUpdates.length > 0) {
        this.sendDestinyUpdates(session, filteredUpdates);
      }
    }
  }

  scheduleWatcherMovementAnchor(
    entity,
    now = this.getCurrentSimTimeMs(),
    reason = "movement",
  ) {
    if (!entity) {
      return false;
    }

    // Mark watcher correction cadence dirty after command changes. Non-active
    // movers may still emit a quick correction, but active subwarp movers now
    // stay entirely on client-side command simulation until an explicit stop /
    // resync / warp-edge anchor is needed.
    entity.lastObserverCorrectionBroadcastAt = 0;
    logMovementDebug("observer.anchor.scheduled", entity, {
      reason,
    });
    return true;
  }

  gotoDirection(session, direction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const commandDirection = normalizeVector(direction, entity.direction);
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const speedFractionChanged = entity.speedFraction <= 0;
    if (speedFractionChanged) {
      entity.speedFraction = 1.0;
    }
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "goto", {
      commandDirection: summarizeVector(commandDirection),
    }, now);
    logMovementDebug("cmd.goto", entity, {
      commandDirection: summarizeVector(commandDirection),
    });

    const movementStamp = this.getMovementStamp(now);
    const updates = buildDirectedMovementUpdates(
      entity,
      commandDirection,
      speedFractionChanged,
      movementStamp,
    );

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "gotoDirection");

    return true;
  }

  alignTo(session, targetEntityID) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const alignTargetPosition = getTargetMotionPosition(target);
    const commandDirection = normalizeVector(
      subtractVectors(alignTargetPosition, entity.position),
      entity.direction,
    );
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 0.75;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "align", {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(alignTargetPosition),
    }, now);
    logMovementDebug("cmd.align", entity, {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(alignTargetPosition),
    });

    const movementStamp = this.getMovementStamp(now);
    const updates = buildDirectedMovementUpdates(
      entity,
      commandDirection,
      speedFractionChanged,
      movementStamp,
    );

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "alignTo");

    return true;
  }

  followBall(session, targetEntityID, range = 0, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const explicitDockingTargetID =
      target.kind === "station" &&
      Number(options.dockingTargetID || 0) === target.itemID
        ? target.itemID
        : null;
    const preservedDockingTargetID =
      explicitDockingTargetID === null &&
      target.kind === "station" &&
      Number(entity.targetEntityID || 0) === target.itemID &&
      Number(entity.dockingTargetID || 0) === target.itemID
        ? target.itemID
        : null;
    const dockingTargetID = explicitDockingTargetID || preservedDockingTargetID;
    const normalizedRange = Math.max(0, toFiniteNumber(range, 0));
    if (
      entity.mode === "FOLLOW" &&
      entity.targetEntityID === target.itemID &&
      entity.dockingTargetID === dockingTargetID &&
      Math.abs(toFiniteNumber(entity.followRange, 0) - normalizedRange) < 1
    ) {
      logMovementDebug("cmd.follow.duplicate", entity, {
        followTargetID: target.itemID,
        followRange: roundNumber(normalizedRange),
        dockingTargetID: dockingTargetID || 0,
      });
      return true;
    }

    const followTargetPosition = getTargetMotionPosition(target, {
      useDockPosition: dockingTargetID === target.itemID,
    });
    clearTrackingState(entity);
    entity.mode = "FOLLOW";
    entity.targetEntityID = target.itemID;
    entity.dockingTargetID = dockingTargetID;
    entity.followRange = normalizedRange;
    entity.targetPoint = followTargetPosition;
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "follow", {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetPosition: summarizeVector(followTargetPosition),
      dockingTargetID: dockingTargetID || 0,
      preservedDockingTargetID: preservedDockingTargetID || 0,
    }, now);
    logMovementDebug("cmd.follow", entity, {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetKind: target.kind,
      followTargetPosition: summarizeVector(followTargetPosition),
      explicitDockingTargetID: explicitDockingTargetID || 0,
      preservedDockingTargetID: preservedDockingTargetID || 0,
      dockPosition:
        target.kind === "station" && target.dockPosition
          ? summarizeVector(target.dockPosition)
          : null,
      dockingDistance:
        target.kind === "station"
          ? roundNumber(getShipDockingDistanceToStation(entity, target))
          : null,
    });

    const movementStamp = this.getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildFollowBallPayload(
          entity.itemID,
          target.itemID,
          entity.followRange,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "followBall");

    return true;
  }

  orbit(session, targetEntityID, distanceValue = 0) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const radial = normalizeVector(
      subtractVectors(entity.position, target.position),
      buildPerpendicular(entity.direction),
    );

    clearTrackingState(entity);
    entity.mode = "ORBIT";
    entity.targetEntityID = target.itemID;
    entity.orbitDistance = Math.max(0, toFiniteNumber(distanceValue, 0));
    entity.orbitNormal = normalizeVector(
      crossProduct(radial, DEFAULT_UP),
      buildPerpendicular(radial),
    );
    entity.orbitSign = 1;
    entity.targetPoint = cloneVector(target.position);
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "orbit", {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    }, now);
    logMovementDebug("cmd.orbit", entity, {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    });

    const movementStamp = this.getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildOrbitPayload(
          entity.itemID,
          target.itemID,
          entity.orbitDistance,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "orbit");

    return true;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    if (target.kind === "stargate") {
      return this.warpToPoint(
        session,
        getStargateWarpLandingPoint(
          entity,
          target,
          toFiniteNumber(options.minimumRange, 0),
        ),
        {
          ...options,
          stopDistance: 0,
          targetEntityID: target.itemID,
        },
      );
    }

    const stopDistance = getWarpStopDistanceForTarget(
      entity,
      target,
      toFiniteNumber(options.minimumRange, 0),
    );
    const warpTargetPoint =
      target && target.kind === "station"
        ? getStationWarpTargetPosition(target)
        : getTargetMotionPosition(target);
    return this.warpToPoint(session, warpTargetPoint, {
      ...options,
      stopDistance,
      targetEntityID: target.itemID,
    });
  }

  warpToPoint(session, point, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    try {
      const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
      const crimewatchNow =
        session &&
        session._space &&
        Number.isFinite(Number(session._space.simTimeMs))
          ? Number(session._space.simTimeMs)
          : this.getCurrentSimTimeMs();
      if (
        crimewatchState &&
        crimewatchState.isCriminallyFlagged(session && session.characterID, crimewatchNow)
      ) {
        return {
          success: false,
          errorMsg: "CRIMINAL_TIMER_ACTIVE",
        };
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Crimewatch warp check failed: ${error.message}`);
    }

    const pendingWarp = buildPendingWarpRequest(entity, point, {
      ...options,
      nowMs: this.getCurrentSimTimeMs(),
      warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
    });
    if (!pendingWarp) {
      return {
        success: false,
        errorMsg: "WARP_DISTANCE_TOO_CLOSE",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const movementStamp = this.getMovementStamp(now);
    clearTrackingState(entity);
    entity.pendingWarp = pendingWarp;
    entity.mode = "WARP";
    entity.speedFraction = 1;
    entity.direction = normalizeVector(
      subtractVectors(pendingWarp.targetPoint, entity.position),
      entity.direction,
    );
    entity.targetPoint = cloneVector(pendingWarp.targetPoint);
    entity.targetEntityID = pendingWarp.targetEntityID || null;
    entity.warpState = buildPreparingWarpState(entity, pendingWarp, {
      nowMs: now,
    });
    persistShipEntity(entity);
    armMovementTrace(entity, "warp", {
      pendingWarp: summarizePendingWarp(pendingWarp),
    }, now);
    logMovementDebug("warp.requested", entity);
    logWarpDebug("warp.requested", entity, {
      officialProfile: buildOfficialWarpReferenceProfile(
        pendingWarp.totalDistance,
        pendingWarp.warpSpeedAU,
        entity.maxVelocity,
      ),
    });

    const prepareDispatch = buildWarpPrepareDispatch(
      entity,
      movementStamp,
      entity.warpState,
    );
    if (session && isReadyForDestiny(session)) {
      this.sendDestinyUpdates(session, prepareDispatch.pilotUpdates);
      this.broadcastMovementUpdates(prepareDispatch.sharedUpdates, session);
    } else {
      this.broadcastMovementUpdates(prepareDispatch.sharedUpdates);
    }
    return {
      success: true,
      data: pendingWarp,
    };
  }

  warpDynamicEntityToPoint(entityOrID, point, options = {}) {
    const entity =
      typeof entityOrID === "object" && entityOrID !== null
        ? entityOrID
        : this.getEntityByID(entityOrID);
    if (!entity || entity.kind !== "ship" || entity.pendingDock) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const pendingWarp = buildPendingWarpRequest(entity, point, {
      ...options,
      nowMs: now,
      warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
    });
    if (!pendingWarp) {
      return {
        success: false,
        errorMsg: "WARP_DISTANCE_TOO_CLOSE",
      };
    }

    const desiredDirection = normalizeVector(
      subtractVectors(pendingWarp.targetPoint, entity.position),
      entity.direction,
    );
    clearTrackingState(entity);
    entity.pendingWarp = pendingWarp;
    entity.mode = "WARP";
    entity.speedFraction = 1;
    entity.direction = desiredDirection;
    entity.targetPoint = cloneVector(pendingWarp.targetPoint);
    entity.targetEntityID = pendingWarp.targetEntityID || null;
    if (options.forceImmediateStart === true) {
      entity.velocity = scaleVector(desiredDirection, entity.maxVelocity);
      pendingWarp.requestedAtMs = now - Math.max(
        1_000,
        (toFiniteNumber(entity.alignTime, 0) * 1000) + 500,
      );
    }
    entity.warpState = buildPreparingWarpState(entity, pendingWarp, {
      nowMs: now,
    });
    persistShipEntity(entity);
    armMovementTrace(entity, "warp", {
      pendingWarp: summarizePendingWarp(pendingWarp),
      forceImmediateStart: options.forceImmediateStart === true,
    }, now);
    logMovementDebug("warp.requested.sessionless", entity, {
      forceImmediateStart: options.forceImmediateStart === true,
    });
    logWarpDebug("warp.requested.sessionless", entity, {
      forceImmediateStart: options.forceImmediateStart === true,
      officialProfile: buildOfficialWarpReferenceProfile(
        pendingWarp.totalDistance,
        pendingWarp.warpSpeedAU,
        entity.maxVelocity,
      ),
    });

    const movementStamp = this.getMovementStamp(now);
    const prepareDispatch = buildWarpPrepareDispatch(
      entity,
      movementStamp,
      entity.warpState,
    );
    this.broadcastMovementUpdates(prepareDispatch.sharedUpdates);
    return {
      success: true,
      data: pendingWarp,
    };
  }

  teleportDynamicEntityToPoint(entityOrID, point, options = {}) {
    const entity =
      typeof entityOrID === "object" && entityOrID !== null
        ? entityOrID
        : this.getEntityByID(entityOrID);
    if (!entity || !this.dynamicEntities.has(entity.itemID)) {
      return {
        success: false,
        errorMsg: "DYNAMIC_ENTITY_NOT_FOUND",
      };
    }

    const now = this.getCurrentSimTimeMs();
    const movementStamp = this.getMovementStamp(now);
    const previousBubbleID = toInt(entity.bubbleID, 0);
    const previousPublicGridClusterKey = entity.publicGridClusterKey || null;

    entity.position = cloneVector(point, entity.position);
    entity.direction = normalizeVector(
      options.direction,
      entity.direction || { x: 1, y: 0, z: 0 },
    );
    resetEntityMotion(entity);
    entity.lastObserverCorrectionBroadcastAt = 0;
    entity.lastObserverPositionBroadcastAt = 0;
    entity.lastWarpCorrectionBroadcastAt = 0;
    this.reconcileEntityPublicGrid(entity);
    this.reconcileEntityBubble(entity);
    this.publicGridCompositionDirty = true;
    this.ensurePublicGridComposition();
    persistDynamicEntity(entity);

    const visibilityChanged =
      toInt(entity.bubbleID, 0) !== previousBubbleID ||
      (entity.publicGridClusterKey || null) !== previousPublicGridClusterKey;
    if (visibilityChanged) {
      this.syncDynamicVisibilityForAllSessions(now);
    }

    this.broadcastMovementUpdates([
      {
        stamp: movementStamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp: movementStamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    if (
      visibilityChanged &&
      options.refreshOwnerSession !== false &&
      entity.session &&
      isReadyForDestiny(entity.session)
    ) {
      this.sendStateRefresh(entity.session, entity, movementStamp);
    }

    return {
      success: true,
      data: {
        entity,
        stamp: movementStamp,
      },
    };
  }

  setSpeedFraction(session, fraction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const normalizedFraction = clamp(fraction, 0, MAX_SUBWARP_SPEED_FRACTION);
    if (normalizedFraction <= 0) {
      return this.stop(session);
    }

    entity.speedFraction = normalizedFraction;
    if (entity.speedFraction > 0 && entity.mode === "STOP") {
      entity.mode = "GOTO";
      entity.targetPoint = addVectors(
        cloneVector(entity.position),
        scaleVector(entity.direction, 1.0e16),
      );
    }
    persistShipEntity(entity);
    armMovementTrace(entity, "speed", {
      requestedSpeedFraction: roundNumber(normalizedFraction, 3),
    }, now);
    logMovementDebug("cmd.speed", entity);

    const stamp = this.getMovementStamp(now);
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      },
    ]);
    this.scheduleWatcherMovementAnchor(entity, now, "setSpeedFraction");

    return true;
  }

  stop(session) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return false;
    }

    if (entity.mode === "WARP" && entity.warpState && !entity.pendingWarp) {
      logMovementDebug("cmd.stop.ignored.activeWarp", entity);
      return false;
    }

    const now = this.getCurrentSimTimeMs();
    const wasAlreadyStopped =
      entity.mode === "STOP" &&
      entity.speedFraction <= 0 &&
      magnitude(entity.velocity) < 0.1;
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.targetPoint = cloneVector(entity.position);
    clearTrackingState(entity);
    persistShipEntity(entity);
    armMovementTrace(entity, "stop", {}, now);
    logMovementDebug("cmd.stop", entity);

    if (wasAlreadyStopped) {
      return true;
    }

    const stamp = this.getMovementStamp(now);
    const updates = [
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
    ];
    if (magnitude(entity.velocity) > 0) {
      updates.push({
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      });
    }
    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "stop");

    return true;
  }

  acceptDocking(session, stationID) {
    const entity = this.getShipEntityForSession(session);
    const station = this.getEntityByID(stationID);
    if (!entity || !station || station.kind !== "station") {
      return {
        success: false,
        errorMsg: "STATION_NOT_FOUND",
      };
    }

    if (
      entity.pendingDock &&
      Number(entity.pendingDock.stationID || 0) === station.itemID
    ) {
      return {
        success: true,
        data: {
          acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
          pending: true,
        },
      };
    }

    if (!canShipDockAtStation(entity, station)) {
      return {
        success: false,
        errorMsg: "DOCKING_APPROACH_REQUIRED",
      };
    }

    clearTrackingState(entity);
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.pendingDock = {
      stationID: station.itemID,
      acceptedAtMs: this.getCurrentSimTimeMs(),
      completeAtMs: this.getCurrentSimTimeMs() + STATION_DOCK_ACCEPT_DELAY_MS,
      acceptedAtFileTime: this.getCurrentFileTime(),
    };
    persistShipEntity(entity);
    logMovementDebug("dock.accepted", entity, {
      stationID: station.itemID,
      dockingState: buildDockingDebugState(entity, station),
    });

    const stamp = this.getNextDestinyStamp();
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    if (session && typeof session.sendNotification === "function") {
      const dockingAcceptedPayload = destiny.buildOnDockingAcceptedPayload(
        entity.position,
        station.position,
        station.itemID,
      );
      session.sendNotification(
        "OnDockingAccepted",
        "charid",
        dockingAcceptedPayload,
      );
    }

    return {
      success: true,
      data: {
        acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
      },
    };
  }

  tick(wallclockNow) {
    const clockState = this.advanceClock(wallclockNow);
    const now = clockState.simNowMs;
    const deltaSeconds = Math.max(clockState.simDeltaMs / 1000, 0);
    // DoSimClockRebase mirrors native client sim-clock changes. Broadcasting
    // it as a periodic keepalive made Michelle's ball time run backwards, so
    // rebases are now limited to scene entry/bootstrap and explicit TiDi
    // changes until the native TiDi update path is reproduced.

    const settledStargates = this.settleTransientStargateActivationStates(
      clockState.wallclockNowMs,
    );
    if (settledStargates.length > 0) {
      this.broadcastSlimItemChanges(settledStargates);
    }

    const sharedUpdates = [];
    const sessionOnlyPreEffectUpdates = [];
    const sessionOnlyUpdates = [];
    const watcherOnlyUpdates = [];
    const dockRequests = new Map();
    try {
      const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
      if (crimewatchState && typeof crimewatchState.tickScene === "function") {
        crimewatchState.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Crimewatch tick failed for system=${this.systemID}: ${error.message}`);
    }
    try {
      const npcService = require(path.join(__dirname, "./npc"));
      if (npcService && typeof npcService.tickScene === "function") {
        npcService.tickScene(this, now);
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] NPC tick failed for system=${this.systemID}: ${error.message}`);
    }
    for (const entity of this.dynamicEntities.values()) {
      if (entity.activeModuleEffects instanceof Map && entity.activeModuleEffects.size > 0) {
        for (const effectState of [...entity.activeModuleEffects.values()]) {
          const cycleBoundaryMs = getEffectCycleBoundaryMs(effectState, now);
          if (!effectState || now < cycleBoundaryMs) {
            continue;
          }

          const isGenericEffect = Boolean(effectState.isGeneric);
          const finalizeDeactivation = isGenericEffect
            ? (sess, modID, opts) => this.finalizeGenericModuleDeactivation(sess, modID, opts)
            : (sess, modID, opts) => this.finalizePropulsionModuleDeactivation(sess, modID, opts);
          const notifyEffect = isGenericEffect
            ? notifyGenericModuleEffectState
            : notifyModuleEffectState;

          if (toFiniteNumber(effectState.deactivateAtMs, 0) > 0) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              finalizeDeactivation(
                entity.session,
                effectState.moduleID,
                {
                  reason: effectState.stopReason || "manual",
                  nowMs: Math.max(
                    cycleBoundaryMs,
                    toFiniteNumber(effectState.deactivateAtMs, 0),
                  ),
                },
              );
            } else {
              entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
            }
            continue;
          }

          const previousChargeAmount = getEntityCapacitorAmount(entity);
          if (!consumeEntityCapacitor(entity, effectState.capNeed)) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              notifyCapacitorChangeToSession(
                entity.session,
                entity,
                now,
                previousChargeAmount,
              );
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: "capacitor",
                nowMs: cycleBoundaryMs,
              });
            } else {
              entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
            }
            continue;
          }
          // CCP parity: Update the client's capacitor gauge each cycle.
          if (entity.session && isReadyForDestiny(entity.session)) {
            notifyCapacitorChangeToSession(
              entity.session,
              entity,
              now,
              previousChargeAmount,
            );
          }

          let cycleStopReason = null;
          if (effectState.weaponFamily === "laserTurret") {
            const cycleResult = executeLaserTurretCycle(
              this,
              entity,
              effectState,
              cycleBoundaryMs,
            );
            if (!cycleResult.success) {
              cycleStopReason = cycleResult.stopReason || "weapon";
            } else if (cycleResult.data) {
              if (
                (
                  cycleResult.data.destroyResult &&
                  cycleResult.data.destroyResult.success
                ) ||
                (
                  cycleResult.data.damageResult &&
                  cycleResult.data.damageResult.success &&
                  cycleResult.data.damageResult.data &&
                  cycleResult.data.damageResult.data.destroyed
                )
              ) {
                cycleStopReason = "target";
              } else if (cycleResult.data.stopReason) {
                cycleStopReason = cycleResult.data.stopReason;
              }
            }
          }
          if (cycleStopReason) {
            if (entity.session && isReadyForDestiny(entity.session)) {
              finalizeDeactivation(entity.session, effectState.moduleID, {
                reason: cycleStopReason,
                nowMs: cycleBoundaryMs,
              });
            } else {
              entity.activeModuleEffects.delete(toInt(effectState.moduleID, 0));
            }
            continue;
          }

          effectState.startedAtMs = cycleBoundaryMs;
          effectState.nextCycleAtMs =
            cycleBoundaryMs + Math.max(1, toFiniteNumber(effectState.durationMs, 1000));
          if (entity.session && isReadyForDestiny(entity.session)) {
            notifyEffect(entity.session, entity, effectState, true, {
              whenMs: cycleBoundaryMs,
              startTimeMs: cycleBoundaryMs,
            });
          }
        }
      }

      // -----------------------------------------------------------------
      // CCP parity: Non-linear capacitor recharge.
      //
      // Formula (instantaneous rate):
      //   dC/dt = (10 * Cmax / tau) * ( sqrt(C/Cmax) - C/Cmax )
      //
      // Where Cmax = capacitorCapacity (GJ), tau = rechargeRate (ms → s),
      // C = current capacitor level.  Peak recharge occurs at exactly 25%
      // capacitor.  This matches CCP's Dogma engine as verified by
      // community tools (Pyfa, EFT) and the EVE University wiki.
      //
      // Notifications are throttled to ~500 ms to avoid flooding the
      // client (which itself only polls at 500 ms intervals).
      // -----------------------------------------------------------------
      if (
        entity.kind === "ship" &&
        toFiniteNumber(entity.capacitorCapacity, 0) > 0 &&
        toFiniteNumber(entity.capacitorRechargeRate, 0) > 0
      ) {
        const capRatio = getEntityCapacitorRatio(entity);
        if (capRatio < 1) {
          const Cmax = entity.capacitorCapacity;
          const tauSeconds = entity.capacitorRechargeRate / 1000;
          const previousChargeAmount = Cmax * capRatio;
          const rechargedRatio = advancePassiveRechargeRatio(
            capRatio,
            deltaSeconds,
            tauSeconds,
          );
          const newRatio = settlePassiveRechargeRatio(rechargedRatio, Cmax);
          if (newRatio !== capRatio) {
            setEntityCapacitorRatio(entity, newRatio);
            // Throttle persistence and client notifications to ~500 ms.
            const lastCapNotify = toFiniteNumber(entity._lastCapNotifyAtMs, 0);
            if (now - lastCapNotify >= 500) {
              persistEntityCapacitorRatio(entity);
              if (entity.session && isReadyForDestiny(entity.session)) {
                notifyCapacitorChangeToSession(
                  entity.session,
                  entity,
                  now,
                  previousChargeAmount,
                );
              }
              entity._lastCapNotifyAtMs = now;
            }
          }
        }
      }

      // -----------------------------------------------------------------
      // Server-authoritative passive shield recharge.
      //
      // The client animates shield recovery from the damage-state tau, but
      // combat must still consume a server-side shield pool first. Keep the
      // runtime conditionState in sync so later shots hit regenerated shield
      // instead of incorrectly continuing straight into hull.
      // -----------------------------------------------------------------
      if (
        entity.kind === "ship" &&
        toFiniteNumber(entity.shieldCapacity, 0) > 0 &&
        toFiniteNumber(entity.shieldRechargeRate, 0) > 0
      ) {
        const previousConditionState = normalizeShipConditionState(entity.conditionState);
        const shieldRatio = clamp(
          toFiniteNumber(previousConditionState.shieldCharge, 0),
          0,
          1,
        );
        if (shieldRatio < 1) {
          const shieldCapacity = entity.shieldCapacity;
          const rechargeSeconds = entity.shieldRechargeRate / 1000;
          const seededShieldRatio =
            shieldRatio > 0
              ? shieldRatio
              : Math.min(1, 1 / Math.max(1, shieldCapacity));
          const rechargedRatio = advancePassiveRechargeRatio(
            seededShieldRatio,
            deltaSeconds,
            rechargeSeconds,
          );
          const newShieldRatio = settlePassiveRechargeRatio(rechargedRatio, shieldCapacity);
          if (Math.abs(newShieldRatio - shieldRatio) > 1e-9) {
            entity.conditionState = normalizeShipConditionState({
              ...previousConditionState,
              shieldCharge: newShieldRatio,
            });
            const lastShieldNotify = toFiniteNumber(entity._lastShieldNotifyAtMs, 0);
            if (now - lastShieldNotify >= 500) {
              const healthTransitionResult = buildShipHealthTransitionResult(
                entity,
                previousConditionState,
              );
              persistDynamicEntity(entity);
              if (entity.session && isReadyForDestiny(entity.session)) {
                notifyShipHealthAttributesToSession(
                  entity.session,
                  entity,
                  healthTransitionResult,
                  now,
                );
              }
              broadcastDamageStateChange(this, entity, now);
              entity._lastShieldNotifyAtMs = now;
            }
          }
        }
      }

      const traceActive = isMovementTraceActive(entity, now);
      if (entity.pendingDock) {
        if (
          entity.session &&
          entity.session._space &&
          now >= Number(entity.pendingDock.completeAtMs || 0)
        ) {
          dockRequests.set(entity.session.clientID, {
            session: entity.session,
            stationID: entity.pendingDock.stationID,
          });
        }
        continue;
      }

      const result = advanceMovement(entity, this, deltaSeconds, now);
      if (entity.pendingWarp) {
        const pendingWarp = entity.pendingWarp;
        const pendingWarpState = evaluatePendingWarp(entity, pendingWarp, now);
        if (pendingWarpState.ready) {
          const currentStamp = this.getCurrentDestinyStamp(now);
          const pilotCanReceiveWarpEgoStateRefresh =
            ENABLE_PILOT_WARP_EGO_STATE_REFRESH &&
            entity.session &&
            isReadyForDestiny(entity.session);
          const pilotCanReceivePreWarpRebaseline =
            ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE &&
            entity.session &&
            isReadyForDestiny(entity.session);
          // Build rebaseline updates if enabled — these are merged into the
          // SAME DoDestinyUpdate packet as activation so the DLL processes
          // everything in a single state-history rebase.  The old two-tick
          // separation (rebaseline on tick N, activation on tick N+1) caused
          // two separate rebases; the second one disrupted alignment progress
          // (100% → ~90% → 100%) because the replayed state diverged from
          // the DLL's local simulation.
          // Do NOT send any pilot rebaseline or activation updates.  ANY
          // DoDestinyUpdate during WarpState=1 causes a state-history rebase
          // that disrupts alignment progress.  The DLL handles WarpState 1→2
          // entirely on its own after the initial WarpTo prepare dispatch.
          if (pilotCanReceivePreWarpRebaseline) {
            pendingWarp.preWarpSyncStamp = currentStamp;
          }
          logBallDebug("warp.pre_start.ego", entity, {
            pendingWarp: summarizePendingWarp(pendingWarp),
            pendingWarpState,
            preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
          });
          const warpState = activatePendingWarp(entity, pendingWarp, {
            nowMs: now,
            defaultEffectStamp: currentStamp,
          });
          if (warpState) {
            this.beginWarpDepartureOwnership(entity, now);
            const warpStartStamp =
              entity.session && isReadyForDestiny(entity.session)
                ? currentStamp
                : this.getNextDestinyStamp(now);
            warpState.commandStamp = warpStartStamp;
            warpState.startupGuidanceAtMs = 0;
            warpState.startupGuidanceStamp = 0;
            warpState.cruiseBumpAtMs = shouldSchedulePilotWarpCruiseBump(warpState)
              ? getPilotWarpCruiseBumpAtMs(warpState)
              : 0;
            warpState.cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
              ? getPilotWarpCruiseBumpStamp(warpStartStamp, warpState)
              : 0;
            warpState.effectAtMs = getPilotWarpEffectAtMs(warpState);
            warpState.effectStamp = getPilotWarpEffectStamp(warpStartStamp, warpState);
            warpState.pilotMaxSpeedRamp = buildPilotWarpMaxSpeedRamp(
              entity,
              warpState,
              warpStartStamp,
            );
            const pilotWarpFactor = getPilotWarpFactorOptionA(entity, warpState);
            const warpStartUpdates = buildWarpStartUpdates(
              entity,
              warpState,
              warpStartStamp,
              {
                includeEntityWarpIn: false,
              },
            );
            if (entity.session && isReadyForDestiny(entity.session)) {
              // Do NOT send any DoDestinyUpdate to the pilot between the
              // WarpTo prepare dispatch and warp completion.  ANY server update
              // during WarpState=1 causes a state-history rebase that disrupts
              // alignment progress (the "establishing warp vector" bar drops).
              // The DLL handles WarpState 1→2 entirely on its own.
              // Watchers still need the live warp-start contract so the
              // client can drive departure motion and FX locally.
              watcherOnlyUpdates.push({
                excludedSession: entity.session,
                updates: warpStartUpdates,
              });
            } else {
              sharedUpdates.push(...warpStartUpdates);
            }
            persistShipEntity(entity);
            logBallDebug("warp.started.ego", entity, {
              pendingWarpState,
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            logMovementDebug("warp.started", entity, {
              pendingWarpState,
              warpState: serializeWarpState(entity),
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            const officialProfile = buildOfficialWarpReferenceProfile(
              warpState.totalDistance,
              Math.max(
                toFiniteNumber(warpState.warpSpeed, 0) / 1000,
                toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            );
            logWarpDebug("warp.started", entity, {
              pendingWarpState,
              officialProfile,
              profileDelta: buildWarpProfileDelta(warpState, officialProfile),
              pilotPlan: {
                bootstrapLiteRefresh: pilotCanReceiveWarpEgoStateRefresh,
                dualWarpCommand: false,
                preWarpAddBall: pilotCanReceivePreWarpRebaseline,
                preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
                watcherWarpFactor: getNominalWarpFactor(entity, warpState),
                pilotWarpFactor,
                pilotWarpFactorScale: ENABLE_PILOT_WARP_FACTOR_OPTION_A
                  ? PILOT_WARP_FACTOR_OPTION_A_SCALE
                  : 1,
                optionBDecelAssistScale: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_SCALE
                  : 1,
                optionBDecelAssistLeadMs: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_LEAD_MS
                  : 0,
                seedSpeedMs: roundNumber(getPilotWarpActivationSeedSpeed(entity), 3),
                seedSpeedAU: roundNumber(
                  getPilotWarpActivationSeedSpeed(entity) / ONE_AU_IN_METERS,
                  9,
                ),
                startupGuidanceVelocityMs: roundNumber(
                  magnitude(warpState.startupGuidanceVelocity),
                  3,
                ),
                activationVelocityFloorMs: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity),
                  3,
                ),
                activationVelocityFloorAU: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity) /
                    ONE_AU_IN_METERS,
                  9,
                ),
                maxSpeedRamp: warpState.pilotMaxSpeedRamp.map((entry) => ({
                  atMs: roundNumber(entry.atMs, 3),
                  stamp: entry.stamp,
                  speedMs: roundNumber(entry.speed, 3),
                  speedAU: roundNumber(entry.speed / ONE_AU_IN_METERS, 6),
                  label: entry.label,
                })),
                commandStamp: warpStartStamp,
                cruiseBumpAtMs: roundNumber(
                  toFiniteNumber(warpState.cruiseBumpAtMs, 0),
                  3,
                ),
                cruiseBumpStamp: warpState.cruiseBumpStamp,
                effectAtMs: roundNumber(
                  toFiniteNumber(warpState.effectAtMs, 0),
                  3,
                ),
                effectStamp: warpState.effectStamp,
              },
            });
            continue;
          }

          entity.pendingWarp = null;
          logMovementDebug("warp.aborted", entity, {
            reason: "WARP_DISTANCE_TOO_CLOSE_AFTER_ALIGN",
            pendingWarpState,
          });
        }
      }

      if (!result.changed) {
        if (traceActive) {
          logMovementDebug("trace.tick.idle", entity, {
            deltaSeconds: roundNumber(deltaSeconds, 4),
            correction: null,
          });
        }
        continue;
      }

      let correctionDebug = null;
      if (entity.mode === "WARP") {
        const warpState = entity.warpState || null;
        const warpCommandStamp = toInt(
          warpState && warpState.commandStamp,
          0,
        );
        const warpEffectStamp = toInt(
          warpState && warpState.effectStamp,
          warpCommandStamp,
        );
        const warpCruiseBumpStamp = toInt(warpState && warpState.cruiseBumpStamp, 0);
        const warpCruiseBumpAtMs = toFiniteNumber(
          warpState && warpState.cruiseBumpAtMs,
          shouldSchedulePilotWarpCruiseBump(warpState)
            ? getPilotWarpCruiseBumpAtMs(warpState)
            : 0,
        );
        const warpEffectAtMs = toFiniteNumber(
          warpState && warpState.effectAtMs,
          getPilotWarpEffectAtMs(warpState),
        );
        const warpElapsedMs = Math.max(
          0,
          toFiniteNumber(now, Date.now()) -
            toFiniteNumber(warpState && warpState.startTimeMs, now),
        );
        const warpCorrectionStamp = Math.max(
          this.getMovementStamp(now),
          warpCommandStamp,
        );
        const hasMeaningfulWarpVelocity = magnitude(entity.velocity) > 0.5;
        if (
          !result.warpCompleted &&
          entity.session &&
          isReadyForDestiny(entity.session)
        ) {
          const pilotWarpPhaseStamp = warpCorrectionStamp;
          const pilotMaxSpeedRamp = clonePilotWarpMaxSpeedRamp(
            warpState && warpState.pilotMaxSpeedRamp,
          );
          let duePilotWarpRampIndex = entity.lastPilotWarpMaxSpeedRampIndex;
          for (
            let index = entity.lastPilotWarpMaxSpeedRampIndex + 1;
            index < pilotMaxSpeedRamp.length;
            index += 1
          ) {
            if (now >= toFiniteNumber(pilotMaxSpeedRamp[index].atMs, 0)) {
              duePilotWarpRampIndex = index;
            } else {
              break;
            }
          }
          const shouldSendPilotWarpCruiseBump =
            warpCruiseBumpStamp > warpCommandStamp &&
            now >= warpCruiseBumpAtMs &&
            entity.lastPilotWarpCruiseBumpStamp !== warpCruiseBumpStamp;
          const shouldSendPilotWarpEffect =
            warpEffectStamp > warpCommandStamp &&
            now >= warpEffectAtMs &&
            entity.lastPilotWarpEffectStamp !== warpEffectStamp;
          const pilotWarpPhaseUpdates = [];
          let rampDebug = null;
          const shouldFoldDueRampIntoCruiseBump =
            shouldSendPilotWarpCruiseBump &&
            duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex;
          if (shouldFoldDueRampIntoCruiseBump) {
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
          } else if (duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex) {
            const rampEntry = pilotMaxSpeedRamp[duePilotWarpRampIndex];
            pilotWarpPhaseUpdates.push({
              stamp: pilotWarpPhaseStamp,
              payload: destiny.buildSetMaxSpeedPayload(
                entity.itemID,
                rampEntry.speed,
              ),
            });
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
            rampDebug = {
              index: duePilotWarpRampIndex,
              label: rampEntry.label,
              speedMs: roundNumber(rampEntry.speed, 3),
              speedAU: roundNumber(
                rampEntry.speed / ONE_AU_IN_METERS,
                6,
              ),
            };
          }
          if (shouldSendPilotWarpCruiseBump) {
            pilotWarpPhaseUpdates.push(
              buildWarpCruiseMaxSpeedUpdate(
                entity,
                pilotWarpPhaseStamp,
                warpState,
              ),
            );
            entity.lastPilotWarpCruiseBumpStamp = warpCruiseBumpStamp;
          }
          if (shouldSendPilotWarpEffect) {
            pilotWarpPhaseUpdates.push(
              buildWarpStartEffectUpdate(entity, pilotWarpPhaseStamp),
            );
            entity.lastPilotWarpEffectStamp = warpEffectStamp;
          }
          if (pilotWarpPhaseUpdates.length > 0) {
            sessionOnlyUpdates.push({
              session: entity.session,
              updates: pilotWarpPhaseUpdates,
            });
            logWarpDebug("warp.pilot.phase", entity, {
              stamp: pilotWarpPhaseStamp,
              ramp: rampDebug,
              cruiseBump: shouldSendPilotWarpCruiseBump,
              effect: shouldSendPilotWarpEffect,
            });
          }
          const inActivePilotWarpPhase =
            !entity.pendingWarp &&
            warpCommandStamp > 0;
          const shouldSendPilotWarpCorrection =
            ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS &&
            inActivePilotWarpPhase &&
            warpCorrectionStamp > warpCommandStamp &&
            warpCorrectionStamp !==
              toInt(entity.lastWarpPositionBroadcastStamp, -1);
          if (shouldSendPilotWarpCorrection) {
            const pilotWarpCorrectionUpdates = buildPilotWarpCorrectionUpdates(
              entity,
              warpCorrectionStamp,
            );
            if (pilotWarpCorrectionUpdates.length > 0) {
              sessionOnlyUpdates.push({
                session: entity.session,
                updates: pilotWarpCorrectionUpdates,
              });
            }
            entity.lastWarpCorrectionBroadcastAt = now;
            entity.lastWarpPositionBroadcastStamp = warpCorrectionStamp;
            correctionDebug = {
              stamp: warpCorrectionStamp,
              includePosition: true,
              includeVelocity: true,
              target: "pilot-active-warp-hops+watchers-local-warpto",
              dispatched: pilotWarpCorrectionUpdates.length > 0,
            };
          } else {
            correctionDebug = {
              stamp: warpCorrectionStamp,
              includePosition: false,
              includeVelocity: false,
              target: inActivePilotWarpPhase
                ? "pilot-warp-edges+watchers-local-warpto"
                : "pilot-prep-no-hops+watchers-local-warpto",
              dispatched: false,
            };
          }
        }
        if (!correctionDebug) {
          correctionDebug = {
            stamp: warpCorrectionStamp,
            includePosition: false,
            includeVelocity: false,
            target: "pilot-warp-edges+watchers-local-warpto",
            dispatched: false,
          };
        }
        // Remote watchers should stay on their own WarpTo simulation once they
        // have received the warp-start contract. Mid-warp SetBallPosition /
        // SetBallVelocity corrections fight that local simulation and produce
        // the observed "jolt in place, then teleport" behavior on observers.
        // Keep only the normal warp-start and warp-completion updates for
        // watchers; the pilot still gets authoritative mid-warp hop updates.
        if (entity.lastWarpDiagnosticStamp !== warpCorrectionStamp) {
          logWarpDebug("warp.progress", entity, {
            stamp: warpCorrectionStamp,
          });
          entity.lastWarpDiagnosticStamp = warpCorrectionStamp;
        }
      } else {
        const correctionStamp = this.getMovementStamp(now);
        // `client/jolt3.txt` confirmed the remaining shared-space jolt was not
        // an NPC-only issue: every moving remote player / NPC / entity in
        // active GOTO/FOLLOW/ORBIT was still receiving a once-per-stamp
        // watcher SetBallVelocity, and Michelle rebased on those batches.
        // Keep active subwarp watchers entirely on the original command
        // contract (GotoDirection / FollowBall / Orbit / SetSpeedFraction)
        // until a mode transition or explicit recovery path needs a hard
        // anchor. That removes the periodic heading/orientation snap while
        // staying TiDi-safe because the command stamps are still scene-clock
        // driven.
        if (usesActiveSubwarpWatcherCorrections(entity)) {
          correctionDebug = {
            stamp: correctionStamp,
            includePosition: false,
            includeVelocity: false,
            target: "watchers-local-subwarp-command",
            dispatched: false,
          };
        } else {
          const observerNeedsPositionAnchor = false;
          const correctionUpdates = buildPositionVelocityCorrectionUpdates(entity, {
            stamp: correctionStamp,
            includePosition: observerNeedsPositionAnchor,
          });
          correctionDebug = {
            stamp: correctionStamp,
            includePosition: observerNeedsPositionAnchor,
            includeVelocity: true,
            target: "watchers-only",
            dispatched: false,
          };
          if (
            !result.warpCompleted &&
            now - entity.lastObserverCorrectionBroadcastAt >=
              getWatcherCorrectionIntervalMs(entity) &&
            correctionStamp !== toInt(entity.lastObserverCorrectionBroadcastStamp, -1)
          ) {
            watcherOnlyUpdates.push({
              excludedSession: entity.session || null,
              updates: correctionUpdates,
            });
            if (
              entity.session &&
              isReadyForDestiny(entity.session) &&
              entity.mode === "STOP" &&
              magnitude(entity.velocity) > 0.01
            ) {
              sessionOnlyUpdates.push({
                session: entity.session,
                updates: correctionUpdates,
              });
            }
            entity.lastObserverCorrectionBroadcastAt = now;
            entity.lastObserverCorrectionBroadcastStamp = correctionStamp;
            correctionDebug.dispatched = correctionUpdates.length > 0;
          }
        }
      }

      if (traceActive) {
        logMovementDebug("trace.tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
      }

      if (
        entity.session &&
        entity.mode !== "STOP" &&
        (now - entity.lastMovementDebugAt) >= 2000
      ) {
        logMovementDebug("tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
        entity.lastMovementDebugAt = now;
      }

      if (result.warpCompleted) {
        const warpCompletionStamp = this.getNextDestinyStamp();
        entity.lastWarpCorrectionBroadcastAt = now;
        entity.lastWarpPositionBroadcastStamp = warpCompletionStamp;
        entity.lastObserverCorrectionBroadcastAt = now;
        entity.lastObserverPositionBroadcastAt = now;
        entity.lastObserverPositionBroadcastStamp = warpCompletionStamp;
        const warpCompletionUpdates = buildWarpCompletionUpdates(
          entity,
          warpCompletionStamp,
        );
        if (entity.session && isReadyForDestiny(entity.session)) {
          sessionOnlyUpdates.push({
            session: entity.session,
            updates: buildPilotWarpCompletionUpdates(entity, warpCompletionStamp),
          });
          watcherOnlyUpdates.push({
            excludedSession: entity.session,
            updates: warpCompletionUpdates,
          });
        } else {
          sharedUpdates.push(...warpCompletionUpdates);
        }
        logMovementDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
        });
        logWarpDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
          completedWarpState: result.completedWarpState,
          officialProfile: buildOfficialWarpReferenceProfile(
            result.completedWarpState.totalDistance,
            Math.max(
              toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 1000,
              toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                ONE_AU_IN_METERS,
            ),
            entity.maxVelocity,
          ),
          profileDelta: buildWarpProfileDelta(
            result.completedWarpState,
            buildOfficialWarpReferenceProfile(
              result.completedWarpState.totalDistance,
              Math.max(
                toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 1000,
                toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                  ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            ),
          ),
        });
        if (!entity.session) {
          try {
            const npcService = require(path.join(__dirname, "./npc"));
            if (npcService && typeof npcService.wakeNpcController === "function") {
              npcService.wakeNpcController(entity.itemID, now);
            }
          } catch (error) {
            log.warn(`[SpaceRuntime] NPC warp completion wake failed: ${error.message}`);
          }
        }
      }

      if (now - entity.lastPersistAt >= 2000 || result.warpCompleted) {
        persistShipEntity(entity);
      }
    }

    if (dockRequests.size > 0) {
      const { dockSession } = require(path.join(__dirname, "./transitions"));
      for (const request of dockRequests.values()) {
        const result = dockSession(request.session, request.stationID);
        if (!result.success) {
          const entity = this.getShipEntityForSession(request.session);
          clearPendingDock(entity);
          log.warn(
            `[SpaceRuntime] Delayed dock failed for char=${request.session && request.session.characterID} station=${request.stationID}: ${result.errorMsg}`,
          );
        }
      }
    }

    this.validateAllTargetLocks(now);
    this.reconcileAllDynamicEntityPublicGrids();
    this.ensurePublicGridComposition();
    this.reconcileAllDynamicEntityBubbles();
    this.syncDynamicVisibilityForAllSessions(now);

    for (const batch of sessionOnlyPreEffectUpdates) {
      if (batch.splitUpdates) {
        this.sendDestinyUpdatesIndividually(batch.session, batch.updates);
      } else {
        this.sendDestinyUpdates(batch.session, batch.updates);
      }
    }
    this.broadcastMovementUpdates(sharedUpdates);
    for (const batch of sessionOnlyUpdates) {
      this.sendDestinyUpdates(batch.session, batch.updates);
    }
    for (const batch of watcherOnlyUpdates) {
      this.broadcastMovementUpdates(batch.updates, batch.excludedSession);
    }
  }

  settleTransientStargateActivationStates(now) {
    const changed = [];
    for (const entity of this.staticEntities) {
      if (entity.kind !== "stargate") {
        continue;
      }
      if (entity.activationState !== STARGATE_ACTIVATION_STATE.ACTIVATING) {
        continue;
      }
      if (toFiniteNumber(entity.activationTransitionAtMs, 0) > now) {
        continue;
      }
      entity.activationState = STARGATE_ACTIVATION_STATE.OPEN;
      entity.activationTransitionAtMs = 0;
      changed.push(entity);
    }
    return changed;
  }
}

class SpaceRuntime {
  constructor() {
    this.scenes = new Map();
    this.solarSystemGateActivationOverrides = new Map();
    this.stargateActivationOverrides = new Map();
    pruneExpiredSpaceItems(Date.now());
    this._tickHandle = setInterval(() => this.tick(), 100);
    if (this._tickHandle && typeof this._tickHandle.unref === "function") {
      this._tickHandle.unref();
    }
  }

  isSolarSystemSceneLoaded(systemID) {
    const numericSystemID = toInt(systemID, 0);
    return numericSystemID > 0 && this.scenes.has(numericSystemID);
  }

  getSolarSystemStargateActivationState(systemID) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return STARGATE_ACTIVATION_STATE.CLOSED;
    }
    if (this.solarSystemGateActivationOverrides.has(numericSystemID)) {
      return this.solarSystemGateActivationOverrides.get(numericSystemID);
    }
    return this.isSolarSystemSceneLoaded(numericSystemID)
      ? STARGATE_ACTIVATION_STATE.OPEN
      : STARGATE_ACTIVATION_STATE.CLOSED;
  }

  resolveStargateActivationState(stargate) {
    const numericGateID = toInt(stargate && stargate.itemID, 0);
    if (numericGateID && this.stargateActivationOverrides.has(numericGateID)) {
      return this.stargateActivationOverrides.get(numericGateID);
    }

    const destinationSystemID = toInt(
      stargate && stargate.destinationSolarSystemID,
      0,
    );
    if (destinationSystemID) {
      return this.getSolarSystemStargateActivationState(destinationSystemID);
    }

    return coerceStableActivationState(
      stargate && stargate.activationState,
      STARGATE_ACTIVATION_STATE.CLOSED,
    );
  }

  refreshStargateActivationStates(options = {}) {
    const targetGateID = toInt(options.targetGateID, 0);
    const targetSystemID = toInt(options.targetSystemID, 0);
    const now = Date.now();
    const animateOpenTransitions =
      options.animateOpenTransitions !== false && options.broadcast !== false;
    const changedByScene = new Map();

    for (const scene of this.scenes.values()) {
      for (const entity of scene.staticEntities) {
        if (entity.kind !== "stargate") {
          continue;
        }
        if (targetGateID && toInt(entity.itemID, 0) !== targetGateID) {
          continue;
        }
        if (
          targetSystemID &&
          toInt(entity.destinationSolarSystemID, 0) !== targetSystemID
        ) {
          continue;
        }

        const nextActivationState = this.resolveStargateActivationState(entity);
        const currentStableActivationState = coerceStableActivationState(
          entity.activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        );
        if (currentStableActivationState === nextActivationState) {
          continue;
        }

        if (
          animateOpenTransitions &&
          currentStableActivationState === STARGATE_ACTIVATION_STATE.CLOSED &&
          nextActivationState === STARGATE_ACTIVATION_STATE.OPEN
        ) {
          entity.activationState = STARGATE_ACTIVATION_STATE.ACTIVATING;
          entity.activationTransitionAtMs =
            now + STARGATE_ACTIVATION_TRANSITION_MS;
        } else {
          entity.activationState = nextActivationState;
          entity.activationTransitionAtMs = 0;
        }
        if (!changedByScene.has(scene)) {
          changedByScene.set(scene, []);
        }
        changedByScene.get(scene).push(entity);
      }
    }

    if (options.broadcast !== false) {
      for (const [scene, entities] of changedByScene.entries()) {
        scene.broadcastSlimItemChanges(entities);
      }
    }

    return [...changedByScene.entries()].flatMap(([scene, entities]) =>
      entities.map((entity) => ({
        systemID: scene.systemID,
        itemID: entity.itemID,
        activationState: entity.activationState,
      })),
    );
  }

  setSolarSystemStargateActivationState(systemID, activationState, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.solarSystemGateActivationOverrides.delete(numericSystemID);
    } else {
      this.solarSystemGateActivationOverrides.set(
        numericSystemID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetSystemID: numericSystemID,
    });
  }

  setStargateActivationState(stargateID, activationState, options = {}) {
    const numericStargateID = toInt(stargateID, 0);
    if (!numericStargateID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.stargateActivationOverrides.delete(numericStargateID);
    } else {
      this.stargateActivationOverrides.set(
        numericStargateID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetGateID: numericStargateID,
    });
  }

  preloadSolarSystems(systemIDs, options = {}) {
    const preloadList = Array.isArray(systemIDs) ? systemIDs : [systemIDs];
    for (const systemID of preloadList) {
      const numericSystemID = toInt(systemID, 0);
      if (!numericSystemID) {
        continue;
      }
      this.ensureScene(numericSystemID, { refreshStargates: false });
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
    });
  }

  preloadStartupSolarSystems(options = {}) {
    const preloadPlan = resolveStartupSolarSystemPreloadPlan();
    const startedAt = Date.now();
    log.info(
      `[SpaceRuntime] Starting startup solar-system preload: mode=${preloadPlan.mode} ` +
        `${preloadPlan.modeName} count=${preloadPlan.systemIDs.length}`,
    );
    const activationChanges = this.preloadSolarSystems(preloadPlan.systemIDs, options);
    log.success(
      `[SpaceRuntime] Startup solar-system preload complete in ${Date.now() - startedAt}ms ` +
        `(${preloadPlan.systemIDs.length} systems, ${activationChanges.length} stargate activation updates)`,
    );
    return activationChanges;
  }

  getStartupSolarSystemPreloadPlan() {
    return resolveStartupSolarSystemPreloadPlan();
  }

  ensureScene(systemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return null;
    }

    let created = false;
    if (!this.scenes.has(numericSystemID)) {
      this.scenes.set(numericSystemID, new SolarSystemScene(numericSystemID));
      created = true;
    }
    const scene = this.scenes.get(numericSystemID);
    if (created && options.refreshStargates !== false) {
      this.refreshStargateActivationStates({
        broadcast: options.broadcastStargateChanges !== false,
      });
    }
    if (created) {
      if (config.asteroidFieldsEnabled === true) {
        try {
          const asteroidService = require(path.join(__dirname, "./asteroids"));
          if (asteroidService && typeof asteroidService.handleSceneCreated === "function") {
            asteroidService.handleSceneCreated(scene);
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] Failed to initialize asteroid fields for system ${numericSystemID}: ${error.message}`,
          );
        }
      } else {
        scene._asteroidFieldsInitialized = true;
      }
      if (process.env.EVEJS_SKIP_NPC_STARTUP !== "1") {
        try {
          const npcService = require(path.join(__dirname, "./npc"));
          if (npcService && typeof npcService.handleSceneCreated === "function") {
            npcService.handleSceneCreated(scene);
          }
        } catch (error) {
          log.warn(
            `[SpaceRuntime] NPC scene startup failed for system=${numericSystemID}: ${error.message}`,
          );
        }
      }
    }
    return scene;
  }

  getSceneTimeSnapshot(systemID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.buildTimeStateSnapshot() : null;
  }

  getSolarSystemTimeDilation(systemID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getTimeDilation() : 1;
  }

  setSolarSystemTimeDilation(systemID, factor, options = {}) {
    const scene = this.ensureScene(systemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    return {
      success: true,
      data: scene.setTimeDilation(factor, {
        ...options,
        syncSessions: options.syncSessions !== false,
        emit: options.emit !== false,
        forceRebase: options.forceRebase !== false,
      }),
    };
  }

  getSceneForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.scenes.get(Number(session._space.systemID)) || null;
  }

  getSimulationTimeMsForSession(session, fallback = Date.now()) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.getCurrentSessionSimTimeMs(session)
      : toFiniteNumber(fallback, Date.now());
  }

  getSimulationFileTimeForSession(session, fallback = currentFileTime()) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getCurrentSessionFileTime(session) : fallback;
  }

  getSimulationTimeMsForSystem(systemID, fallback = Date.now()) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getCurrentSimTimeMs() : toFiniteNumber(fallback, Date.now());
  }

  getSimulationFileTimeForSystem(systemID, fallback = currentFileTime()) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getCurrentFileTime() : fallback;
  }

  syncSessionSimClock(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.syncSessionSimClock(session, options) : null;
  }

  getEntity(session, entityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getEntityByID(entityID) : null;
  }

  healSessionShipResources(session, options = {}) {
    const shipID = toInt(
      session &&
        session._space &&
        session._space.shipID,
      0,
    );
    if (!shipID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const entity = scene.getEntityByID(shipID);
    if (!entity || entity.kind !== "ship") {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    return healShipResourcesForSession(session, scene, entity, options);
  }

  getEntitySpaceStateSnapshot(session, entityID) {
    const entity = this.getEntity(session, entityID);
    return entity ? serializeSpaceState(entity) : null;
  }

  getBubbleForSession(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getBubbleForSession(session) : null;
  }

  getSessionsInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getSessionsInBubble(bubbleID) : [];
  }

  getDynamicEntitiesInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getDynamicEntitiesInBubble(bubbleID) : [];
  }

  getShipsInBubble(systemID, bubbleID) {
    const scene = this.ensureScene(systemID);
    return scene ? scene.getShipsInBubble(bubbleID) : [];
  }

  broadcastDestinyUpdatesToBubble(systemID, bubbleID, updates, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.broadcastDestinyUpdatesToBubble(bubbleID, updates, options)
      : { deliveredCount: 0 };
  }

  spawnDynamicShip(systemID, shipSpec, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const entity = buildRuntimeShipEntity(shipSpec || {}, numericSystemID, {
      session: options.session || null,
      persistSpaceState: options.persistSpaceState === true,
    });
    return scene.spawnDynamicEntity(entity, options);
  }

  spawnDynamicInventoryEntity(systemID, itemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    const numericItemID = toInt(itemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }
    if (!numericItemID) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const existingEntity = scene.getEntityByID(numericItemID);
    if (isInventoryBackedDynamicEntity(existingEntity)) {
      return scene.refreshInventoryBackedEntityPresentation(numericItemID, options);
    }
    if (existingEntity) {
      return {
        success: true,
        data: {
          entity: existingEntity,
        },
      };
    }

    const itemRecord = findItemById(numericItemID);
    if (!itemRecord) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }

    const entity = buildRuntimeSpaceEntityFromItem(
      itemRecord,
      numericSystemID,
      scene.getCurrentSimTimeMs(),
    );
    if (!entity) {
      return {
        success: false,
        errorMsg: "UNSUPPORTED_DYNAMIC_ITEM",
      };
    }

    return scene.spawnDynamicEntity(entity, options);
  }

  refreshInventoryBackedEntityPresentation(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.ensureScene(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.refreshInventoryBackedEntityPresentation(entityID, options);
  }

  removeDynamicEntity(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.scenes.get(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.removeDynamicEntity(entityID, options);
  }

  destroyDynamicInventoryEntity(systemID, entityID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    const scene = this.scenes.get(numericSystemID);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    return scene.destroyInventoryBackedDynamicEntity(entityID, options);
  }

  attachSession(session, shipItem, options = {}) {
    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? (
          session && session._space
            ? this.getSimulationTimeMsForSession(session, null)
            : null
        )
        : toFiniteNumber(options.previousSimTimeMs, null);
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    return scene.attachSession(session, shipItem, {
      ...options,
      forceSimClockRebase: options.forceSimClockRebase === true,
      previousSimTimeMs,
    });
  }

  attachSessionToExistingEntity(session, shipItem, entity, options = {}) {
    const previousSimTimeMs =
      options.previousSimTimeMs === undefined || options.previousSimTimeMs === null
        ? (
          session && session._space
            ? this.getSimulationTimeMsForSession(session, null)
            : null
        )
        : toFiniteNumber(options.previousSimTimeMs, null);
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    return scene.attachSessionToExistingEntity(session, shipItem, entity, {
      ...options,
      forceSimClockRebase: options.forceSimClockRebase === true,
      previousSimTimeMs,
    });
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (scene) {
      scene.detachSession(session, options);
    } else {
      session._space = null;
    }
  }

  disembarkSession(session, options = {}) {
    if (!session || !session._space) {
      return null;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (!scene) {
      session._space = null;
      return null;
    }

    return scene.disembarkSession(session, options);
  }

  markBeyonceBound(session) {
    const scene = this.getSceneForSession(session);
    if (scene) {
      scene.markBeyonceBound(session);
    }
  }

  ensureInitialBallpark(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.ensureInitialBallpark(session, options) : false;
  }

  gotoDirection(session, direction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.gotoDirection(session, direction) : false;
  }

  alignTo(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.alignTo(session, targetEntityID) : false;
  }

  followBall(session, targetEntityID, range, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.followBall(session, targetEntityID, range, options) : false;
  }

  orbit(session, targetEntityID, distanceValue) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.orbit(session, targetEntityID, distanceValue) : false;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToEntity(session, targetEntityID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToPoint(session, point, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpDynamicEntityToPoint(systemID, entityOrID, point, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.warpDynamicEntityToPoint(entityOrID, point, options)
      : { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }

  teleportSessionShipToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.teleportDynamicEntityToPoint(
        session && session._space ? session._space.shipID : null,
        point,
        {
          ...options,
          refreshOwnerSession: options.refreshOwnerSession !== false,
        },
      )
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  teleportDynamicEntityToPoint(systemID, entityOrID, point, options = {}) {
    const scene = this.ensureScene(systemID);
    return scene
      ? scene.teleportDynamicEntityToPoint(entityOrID, point, options)
      : { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }

  setSpeedFraction(session, fraction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.setSpeedFraction(session, fraction) : false;
  }

  stop(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.stop(session) : false;
  }

  refreshShipDerivedState(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.refreshSessionShipDerivedState(session, options)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  getShipCapacitorState(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getShipCapacitorState(session) : null;
  }

  setShipCapacitorRatio(session, nextRatio) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.setShipCapacitorRatio(session, nextRatio)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  getActiveModuleEffect(session, moduleID) {
    const scene = this.getSceneForSession(session);
    const shipEntity = scene ? scene.getShipEntityForSession(session) : null;
    if (!scene || !shipEntity) {
      return null;
    }

    return scene.getActiveModuleEffect(shipEntity.itemID, moduleID);
  }

  getPropulsionModuleRuntimeAttributes(characterID, moduleItem) {
    return getPropulsionModuleRuntimeAttributes(characterID, moduleItem);
  }

  getGenericModuleRuntimeAttributes(
    characterID,
    shipItem,
    moduleItem,
    chargeItem = null,
    weaponSnapshot = null,
  ) {
    return getGenericModuleRuntimeAttributes(
      characterID,
      shipItem,
      moduleItem,
      chargeItem,
      weaponSnapshot,
    );
  }

  getShipAttributeSnapshot(session) {
    const scene = this.getSceneForSession(session);
    const entity = scene ? scene.getShipEntityForSession(session) : null;
    if (!entity) {
      return null;
    }

    return {
      itemID: toInt(entity.itemID, 0),
      mass: roundNumber(toFiniteNumber(entity.mass, 0), 6),
      maxVelocity: roundNumber(toFiniteNumber(entity.maxVelocity, 0), 6),
      maxLockedTargets: roundNumber(toFiniteNumber(entity.maxLockedTargets, 0), 6),
      maxTargetRange: roundNumber(toFiniteNumber(entity.maxTargetRange, 0), 6),
      cloakingTargetingDelay: roundNumber(
        toFiniteNumber(entity.cloakingTargetingDelay, 0),
        6,
      ),
      scanResolution: roundNumber(toFiniteNumber(entity.scanResolution, 0), 6),
      signatureRadius: roundNumber(
        toFiniteNumber(entity.signatureRadius, 0),
        6,
      ),
      alignTime: roundNumber(toFiniteNumber(entity.alignTime, 0), 6),
    };
  }

  addTarget(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.addTarget(session, targetEntityID)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  cancelAddTarget(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.cancelAddTarget(session, targetEntityID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  removeTarget(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.removeTarget(session, targetEntityID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  removeTargets(session, targetEntityIDs = [], options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.removeTargets(session, targetEntityIDs, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  clearTargets(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.clearTargets(session, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  getTargets(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getTargets(session) : [];
  }

  getTargeters(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getTargeters(session) : [];
  }

  activatePropulsionModule(session, moduleItem, effectName, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.activatePropulsionModule(session, moduleItem, effectName, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  deactivatePropulsionModule(session, moduleID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.deactivatePropulsionModule(session, moduleID, options)
      : {
          success: false,
          errorMsg: "NOT_IN_SPACE",
        };
  }

  activateGenericModule(session, moduleItem, effectName, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.activateGenericModule(session, moduleItem, effectName, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  deactivateGenericModule(session, moduleID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.deactivateGenericModule(session, moduleID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  playSpecialFx(session, guid, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    if (!isReadyForDestiny(session)) {
      return {
        success: false,
        errorMsg: "DESTINY_NOT_READY",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const {
      shipID: requestedShipID = null,
      debugAutoTarget = null,
      debugAutoTargetRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
      debugOnly = false,
      ...fxOptions
    } = options || {};
    const shipID = Number(requestedShipID || session._space.shipID || 0) || 0;
    if (!shipID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const entity = scene.getEntityByID(shipID);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const resolvedFxOptions = { ...fxOptions };
    let debugAutoTargetResult = null;
    const hasExplicitTargetID = Number(resolvedFxOptions.targetID || 0) > 0;
    if (!hasExplicitTargetID && debugAutoTarget === "nearest_station") {
      debugAutoTargetResult = resolveDebugTestNearestStationTarget(
        scene,
        entity,
        debugAutoTargetRangeMeters,
      );
      if (debugAutoTargetResult.success) {
        resolvedFxOptions.targetID = debugAutoTargetResult.data.target.itemID;
      } else {
        const stopLikeRequest =
          resolvedFxOptions.start === false || resolvedFxOptions.active === false;
        if (!stopLikeRequest) {
          return {
            success: false,
            errorMsg: debugAutoTargetResult.errorMsg,
            data: {
              ...(debugAutoTargetResult.data || {}),
              debugAutoTarget,
              debugOnly,
            },
          };
        }
      }
    }

    const stamp = scene.getNextDestinyStamp();
    scene.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildOnSpecialFXPayload(shipID, guid, resolvedFxOptions),
      },
    ]);
    return {
      success: true,
      data: {
        autoTarget:
          debugAutoTargetResult && debugAutoTargetResult.success
            ? {
                mode: debugAutoTarget,
                maxRangeMeters: debugAutoTargetResult.data.maxRangeMeters,
                distanceMeters: debugAutoTargetResult.data.nearestDistanceMeters,
                targetID: debugAutoTargetResult.data.target.itemID,
                targetName:
                  debugAutoTargetResult.data.target.itemName ||
                  `station ${debugAutoTargetResult.data.target.itemID}`,
              }
            : null,
        debugOnly,
        guid: String(guid || ""),
        shipID,
        stamp,
      },
    };
  }

  startStargateJump(session, sourceGateID, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const shipEntity = scene.getShipEntityForSession(session);
    if (!shipEntity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const sourceGateEntity = scene.getEntityByID(sourceGateID);
    if (!sourceGateEntity || sourceGateEntity.kind !== "stargate") {
      return {
        success: false,
        errorMsg: "STARGATE_NOT_FOUND",
      };
    }

    const currentActivationState = coerceActivationState(
      sourceGateEntity.activationState,
      this.resolveStargateActivationState(sourceGateEntity),
    );
    if (currentActivationState !== STARGATE_ACTIVATION_STATE.OPEN) {
      return {
        success: false,
        errorMsg: "STARGATE_NOT_ACTIVE",
      };
    }

    if (
      options.freezeMotion !== false &&
      (
        shipEntity.mode !== "STOP" ||
        shipEntity.speedFraction > 0 ||
        magnitude(shipEntity.velocity) > 0.5
      )
    ) {
      resetEntityMotion(shipEntity);
      persistShipEntity(shipEntity);
    }

    const fxOptions = {
      ...(options.fxOptions || {}),
    };
    if (
      !Object.prototype.hasOwnProperty.call(fxOptions, "graphicInfo") &&
      Number(sourceGateEntity.destinationSolarSystemID || 0) > 0
    ) {
      fxOptions.graphicInfo = [
        Number(sourceGateEntity.destinationSolarSystemID),
      ];
    }

    const { stamp, deliveredCount } = scene.broadcastSpecialFx(
      shipEntity.itemID,
      "effects.JumpOut",
      {
        targetID: sourceGateEntity.itemID,
        start: true,
        active: false,
        // Use current stamp so Michelle dispatches the FX immediately. Under TiDi,
        // getNextDestinyStamp() puts the FX 1 tick ahead, but the dilated sim clock
        // won't reach that tick before completeStargateJump tears down the scene.
        useCurrentStamp: true,
        // For the jumping pilot, raw "current" can be one Michelle step ahead
        // of the live client history under TiDi, but clamping to the last sent
        // stamp can also backstep too far after the client has locally evolved.
        // Use the immediate visible window instead: max(last visible, current-1).
        useImmediateClientVisibleStamp: true,
        resultSession: session,
        ...fxOptions,
      },
      shipEntity,
    );

    return {
      success: true,
      data: {
        shipID: shipEntity.itemID,
        sourceGateID: sourceGateEntity.itemID,
        stamp,
        deliveredCount,
      },
    };
  }

  getStationInteractionRadius(station) {
    return getStationInteractionRadius(station);
  }

  getStationUndockSpawnState(station) {
    return getStationUndockSpawnState(station);
  }

  canDockAtStation(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    try {
      const crimewatchState = require(path.join(__dirname, "../services/security/crimewatchState"));
      const crimewatchNow =
        session &&
        session._space &&
        Number.isFinite(Number(session._space.simTimeMs))
          ? Number(session._space.simTimeMs)
          : Date.now();
      if (
        crimewatchState &&
        crimewatchState.isCriminallyFlagged(session && session.characterID, crimewatchNow)
      ) {
        return false;
      }
    } catch (error) {
      log.warn(`[SpaceRuntime] Crimewatch dock check failed: ${error.message}`);
    }

    const entity = this.getEntity(session, session && session._space ? session._space.shipID : null);
    const station = worldData.getStationByID(stationID);
    if (!entity || !station) {
      return false;
    }

    return canShipDockAtStation(entity, station, maxDistance);
  }

  getDockingDebugState(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(
      session,
      session && session._space ? session._space.shipID : null,
    );
    const station = worldData.getStationByID(stationID);
    return buildDockingDebugState(entity, station, maxDistance);
  }

  acceptDocking(session, stationID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.acceptDocking(session, stationID)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  tick() {
    const now = Date.now();
    for (const scene of this.scenes.values()) {
      scene.destroyExpiredInventoryBackedEntities();
      scene.tick(now);
    }
  }
}

// Preserve the original CommonJS exports object so modules that observed it
// during a circular load still see the fully initialized runtime singleton.
const runtimeSingleton = new SpaceRuntime();
const runtimeExports = module.exports;
Object.setPrototypeOf(runtimeExports, Object.getPrototypeOf(runtimeSingleton));
Object.assign(runtimeExports, runtimeSingleton);
runtimeExports.beginSessionJumpTimingTrace = beginSessionJumpTimingTrace;
runtimeExports.recordSessionJumpTimingTrace = recordSessionJumpTimingTrace;

runtimeExports._testing = {
  BUBBLE_RADIUS_METERS,
  BUBBLE_HYSTERESIS_METERS,
  BUBBLE_CENTER_MIN_DISTANCE_METERS,
  PUBLIC_GRID_BOX_METERS,
  PUBLIC_GRID_HALF_BOX_METERS,
  STARGATE_ACTIVATION_STATE,
  STARGATE_ACTIVATION_TRANSITION_MS,
  NEW_EDEN_SYSTEM_LOADING,
  STARTUP_PRELOADED_SYSTEM_IDS,
  getStartupSolarSystemPreloadPlanForTesting: resolveStartupSolarSystemPreloadPlan,
  getConfiguredStartupSystemLoadingModeForTesting: getConfiguredStartupSystemLoadingMode,
  resolveStartupPreloadedSystemIDsForTesting: resolveStartupPreloadedSystemIDs,
  resolveStartupSolarSystemPreloadPlanForTesting: resolveStartupSolarSystemPreloadPlan,
  ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS,
  ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  WATCHER_CORRECTION_INTERVAL_MS,
  WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  buildPositionVelocityCorrectionUpdates,
  getWatcherCorrectionIntervalMs,
  getWatcherPositionCorrectionIntervalMs,
  usesActiveSubwarpWatcherCorrections,
  buildShipEntityForTesting: buildShipEntity,
  buildRuntimeShipEntityForTesting: buildRuntimeShipEntity,
  buildRuntimeSpaceEntityFromItemForTesting: buildRuntimeSpaceEntityFromItem,
  refreshShipPresentationFieldsForTesting: refreshShipPresentationFields,
  buildPublicGridKeyForTesting: buildPublicGridKey,
  applyDesiredVelocityForTesting: applyDesiredVelocity,
  deriveAgilitySecondsForTesting: deriveAgilitySeconds,
  evaluatePendingWarpForTesting: evaluatePendingWarp,
  buildWarpPrepareDispatchForTesting: buildWarpPrepareDispatch,
  buildPilotWarpActivationStateRefreshUpdatesForTesting:
    buildPilotWarpActivationStateRefreshUpdates,
  buildPilotWarpActivationUpdatesForTesting: buildPilotWarpActivationUpdates,
  buildWarpStartEffectUpdateForTesting: buildWarpStartEffectUpdate,
  buildDirectedMovementUpdatesForTesting: buildDirectedMovementUpdates,
  buildAttributeChangeForTesting: buildAttributeChange,
  computeTargetLockDurationMsForTesting: computeTargetLockDurationMs,
  notifyCapacitorChangeToSessionForTesting: notifyCapacitorChangeToSession,
  notifyShipHealthAttributesToSessionForTesting: notifyShipHealthAttributesToSession,
  notifyModuleEffectStateForTesting: notifyModuleEffectState,
  notifyGenericModuleEffectStateForTesting: notifyGenericModuleEffectState,
  resolveSpecialFxOptionsForEntityForTesting: resolveSpecialFxOptionsForEntity,
  resolveSpecialFxRepeatCountForTesting: resolveSpecialFxRepeatCount,
  buildStaticStargateEntityForTesting: buildStaticStargateEntity,
  buildRuntimeInventoryEntityForTesting: buildRuntimeInventoryEntity,
  isPlayerOwnedActiveSpaceShipRecordForTesting: isPlayerOwnedActiveSpaceShipRecord,
  getSharedWorldPosition,
  getStargateDerivedDunRotation,
  resetStargateActivationOverrides() {
    runtimeExports.solarSystemGateActivationOverrides.clear();
    runtimeExports.stargateActivationOverrides.clear();
  },
  clearScenes() {
    runtimeExports.scenes.clear();
    nextRuntimeEntityID = 900_000_000_000;
    nextFallbackStamp = 0;
  },
  getSecurityStatusIconKey,
  resolveShipSkinMaterialSetID,
  allocateRuntimeEntityIDForTesting: allocateRuntimeEntityID,
};

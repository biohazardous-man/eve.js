const path = require("path");
const config = require(path.join(__dirname, "../../config"));

const {
  buildDict,
  buildFiletimeLong,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));

const SAFETY_LEVEL_NONE = 0;
const SAFETY_LEVEL_PARTIAL = 1;
const SAFETY_LEVEL_FULL = 2;

const WEAPONS_TIMER_STATE_IDLE = 100;
const WEAPONS_TIMER_STATE_TIMER = 102;
const PVP_TIMER_STATE_IDLE = 200;
const PVP_TIMER_STATE_TIMER = 202;
const CRIMINAL_TIMER_STATE_IDLE = 300;
const CRIMINAL_TIMER_STATE_TIMER_CRIMINAL = 303;
const CRIMINAL_TIMER_STATE_TIMER_SUSPECT = 304;
const NPC_TIMER_STATE_IDLE = 400;
const NPC_TIMER_STATE_TIMER = 402;
const DISAPPROVAL_TIMER_STATE_IDLE = 500;
const DISAPPROVAL_TIMER_STATE_TIMER = 502;
const ATTRIBUTE_PILOT_SECURITY_STATUS = 2610;

const WEAPON_TIMER_DURATION_MS = 60_000;
const PVP_TIMER_DURATION_MS = 15 * 60_000;
const NPC_TIMER_DURATION_MS = 5 * 60_000;
const CRIMINAL_TIMER_DURATION_MS = 15 * 60_000;
const DISAPPROVAL_TIMER_DURATION_MS = 5 * 60_000;
const SECURITY_STATUS_MIN = -10;
const SECURITY_STATUS_MAX = 10;
const SECURITY_STATUS_SHIP_AGGRESSION_MODIFIER = -0.025;
const SECURITY_STATUS_CAPSULE_AGGRESSION_MODIFIER = -0.25;
const SECURITY_STATUS_ROUND_DIGITS = 4;
const SECURITY_STATUS_DUPLICATE_WINDOW_MS = WEAPON_TIMER_DURATION_MS;
const GROUP_CAPSULE = 29;

const CONCORD_RESPONSE_WARP_ORIGIN_MIN_DISTANCE_METERS = 500_000;
const CONCORD_RESPONSE_WARP_ORIGIN_MAX_DISTANCE_METERS = 1_000_000;
const CONCORD_RESPONSE_WARP_ORIGIN_LOCAL_SPAWN_DISTANCE_METERS = 1_000;
const CONCORD_RESPONSE_WARP_ORIGIN_LOCAL_SPAWN_SPREAD_METERS = 12_000;
const CONCORD_RESPONSE_WARP_ORIGIN_BOX_OFFSET = 4;
const CONCORD_RESPONSE_WARP_ORIGIN_BOX_MARGIN_METERS = 1_000;
const CONCORD_RESPONSE_WARP_VISIBILITY_SUPPRESS_MS = 750;
const FALLBACK_PUBLIC_GRID_BOX_METERS = 7_864_320;
const CONCORD_RESPONSE_ARRIVAL_RING_METERS = 20_000;
const CONCORD_RESPONSE_AMOUNT = 3;
const CONCORD_RESPONSE_RETASK_INTERVAL_MS = 1_000;
const CONCORD_RESPONSE_COMPLETION_CLEAR_MS = 3_000;

const characterCrimewatchState = new Map();
const systemConcordResponses = new Map();
const lastBroadcastTimerSnapshots = new Map();
const lastBroadcastFlagSnapshots = new Map();
const lastBroadcastDisapprovalSnapshots = new Map();
const recentSecurityPenaltyTargets = new Map();

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(toFiniteNumber(value, minimum), toFiniteNumber(minimum, value)),
    toFiniteNumber(maximum, value),
  );
}

function roundNumber(value, digits = 6) {
  const numeric = toFiniteNumber(value, 0);
  const factor = 10 ** Math.max(0, Math.trunc(toFiniteNumber(digits, 0)));
  return Math.round(numeric * factor) / factor;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(value && value.x, fallback.x),
    y: toFiniteNumber(value && value.y, fallback.y),
    z: toFiniteNumber(value && value.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(resolved, 1 / length);
}

function distanceSquared(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx ** 2) + (dy ** 2) + (dz ** 2);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getSharedPublicGridBoxMeters() {
  try {
    const runtime = require(path.join(__dirname, "../../space/runtime"));
    return Math.max(
      1,
      toFiniteNumber(
        runtime &&
          runtime._testing &&
          runtime._testing.PUBLIC_GRID_BOX_METERS,
        FALLBACK_PUBLIC_GRID_BOX_METERS,
      ),
    );
  } catch (error) {
    return FALLBACK_PUBLIC_GRID_BOX_METERS;
  }
}

function getPublicGridAxisIndex(value, boxMeters) {
  return Math.floor(
    toFiniteNumber(value, 0) /
      Math.max(1, toFiniteNumber(boxMeters, FALLBACK_PUBLIC_GRID_BOX_METERS)),
  );
}

function buildConcordResponseClusterBounds(scene, offenderEntity, boxMeters) {
  const offenderPosition = cloneVector(offenderEntity && offenderEntity.position);
  const defaultBounds = {
    minX: getPublicGridAxisIndex(offenderPosition.x, boxMeters),
    maxX: getPublicGridAxisIndex(offenderPosition.x, boxMeters),
    minY: getPublicGridAxisIndex(offenderPosition.y, boxMeters),
    maxY: getPublicGridAxisIndex(offenderPosition.y, boxMeters),
    minZ: getPublicGridAxisIndex(offenderPosition.z, boxMeters),
    maxZ: getPublicGridAxisIndex(offenderPosition.z, boxMeters),
  };
  if (
    !scene ||
    typeof scene.ensurePublicGridComposition !== "function" ||
    typeof scene.getPublicGridKeyForEntity !== "function" ||
    typeof scene.getPublicGridClusterKeyForEntity !== "function"
  ) {
    return defaultBounds;
  }

  scene.ensurePublicGridComposition();
  const offenderPublicGridKey = String(
    scene.getPublicGridKeyForEntity(offenderEntity) || "",
  );
  const offenderClusterKey = String(
    scene.getPublicGridClusterKeyForEntity(offenderEntity) || offenderPublicGridKey,
  );
  const occupiedBoxes = scene.publicGridOccupiedBoxes instanceof Map
    ? scene.publicGridOccupiedBoxes
    : null;
  const clusterByBoxKey = scene.publicGridClustersByBoxKey instanceof Map
    ? scene.publicGridClustersByBoxKey
    : null;
  if (!occupiedBoxes || !clusterByBoxKey || !offenderClusterKey) {
    return defaultBounds;
  }

  const bounds = { ...defaultBounds };
  let foundClusterMember = false;
  for (const entry of occupiedBoxes.values()) {
    if (!entry || typeof entry.key !== "string") {
      continue;
    }
    const entryClusterKey = String(
      clusterByBoxKey.get(entry.key) || entry.key,
    );
    if (entryClusterKey !== offenderClusterKey) {
      continue;
    }
    foundClusterMember = true;
    bounds.minX = Math.min(bounds.minX, toInt(entry.xIndex, bounds.minX));
    bounds.maxX = Math.max(bounds.maxX, toInt(entry.xIndex, bounds.maxX));
    bounds.minY = Math.min(bounds.minY, toInt(entry.yIndex, bounds.minY));
    bounds.maxY = Math.max(bounds.maxY, toInt(entry.yIndex, bounds.maxY));
    bounds.minZ = Math.min(bounds.minZ, toInt(entry.zIndex, bounds.minZ));
    bounds.maxZ = Math.max(bounds.maxZ, toInt(entry.zIndex, bounds.maxZ));
  }

  return foundClusterMember ? bounds : defaultBounds;
}

function buildConcordResponseOriginCandidate(offenderPosition, bounds, axis, direction, boxMeters) {
  const resolvedBoxMeters = Math.max(
    1,
    toFiniteNumber(boxMeters, FALLBACK_PUBLIC_GRID_BOX_METERS),
  );
  const margin = Math.min(
    CONCORD_RESPONSE_WARP_ORIGIN_BOX_MARGIN_METERS,
    Math.max(1, resolvedBoxMeters / 4),
  );
  const candidate = cloneVector(offenderPosition);
  const offsetBoxes = Math.max(2, toInt(CONCORD_RESPONSE_WARP_ORIGIN_BOX_OFFSET, 2));

  switch (axis) {
    case "x":
      candidate.x = direction > 0
        ? ((toInt(bounds.maxX, 0) + offsetBoxes) * resolvedBoxMeters) + margin
        : ((toInt(bounds.minX, 0) - offsetBoxes + 1) * resolvedBoxMeters) - margin;
      break;
    case "y":
      candidate.y = direction > 0
        ? ((toInt(bounds.maxY, 0) + offsetBoxes) * resolvedBoxMeters) + margin
        : ((toInt(bounds.minY, 0) - offsetBoxes + 1) * resolvedBoxMeters) - margin;
      break;
    case "z":
    default:
      candidate.z = direction > 0
        ? ((toInt(bounds.maxZ, 0) + offsetBoxes) * resolvedBoxMeters) + margin
        : ((toInt(bounds.minZ, 0) - offsetBoxes + 1) * resolvedBoxMeters) - margin;
      break;
  }

  return candidate;
}

function buildConcordResponseOriginAnchor(scene, offenderEntity) {
  const offenderPosition = cloneVector(offenderEntity && offenderEntity.position);
  const fallbackDirection = normalizeVector(
    offenderEntity && offenderEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  const fallbackOffsetDirection = normalizeVector(
    scaleVector(fallbackDirection, -1),
    { x: -1, y: 0, z: 0 },
  );
  const fallbackPosition = addVectors(
    offenderPosition,
    scaleVector(
      fallbackOffsetDirection,
      CONCORD_RESPONSE_WARP_ORIGIN_MIN_DISTANCE_METERS,
    ),
  );
  if (!scene || !offenderEntity) {
    return {
      position: fallbackPosition,
      direction: normalizeVector(
        subtractVectors(offenderPosition, fallbackPosition),
        fallbackDirection,
      ),
    };
  }

  const boxMeters = getSharedPublicGridBoxMeters();
  const bounds = buildConcordResponseClusterBounds(scene, offenderEntity, boxMeters);
  const candidates = [
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "x", 1, boxMeters),
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "x", -1, boxMeters),
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "y", 1, boxMeters),
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "y", -1, boxMeters),
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "z", 1, boxMeters),
    buildConcordResponseOriginCandidate(offenderPosition, bounds, "z", -1, boxMeters),
  ]
    .map((candidate) => ({
      position: candidate,
      distanceSquared: distanceSquared(candidate, offenderPosition),
    }))
    .filter((candidate) => (
      candidate.distanceSquared >=
      (CONCORD_RESPONSE_WARP_ORIGIN_MIN_DISTANCE_METERS ** 2)
    ))
    .sort((left, right) => left.distanceSquared - right.distanceSquared);

  const selectedCandidate = candidates.length > 0 ? candidates[0] : null;
  const offsetDirection = normalizeVector(
    subtractVectors(
      selectedCandidate ? selectedCandidate.position : fallbackPosition,
      offenderPosition,
    ),
    fallbackOffsetDirection,
  );
  // Keep the approach direction derived from the occupied public-grid bounds,
  // but cap the actual spawn distance. Huge public-grid clusters like Jita can
  // otherwise place the response origin tens of megameters away, which traps
  // responders in a pathological "short warp" crawl that never looks like a
  // real warp-in to clients.
  const originDistance = clamp(
    selectedCandidate
      ? Math.sqrt(selectedCandidate.distanceSquared)
      : CONCORD_RESPONSE_WARP_ORIGIN_MIN_DISTANCE_METERS,
    CONCORD_RESPONSE_WARP_ORIGIN_MIN_DISTANCE_METERS,
    CONCORD_RESPONSE_WARP_ORIGIN_MAX_DISTANCE_METERS,
  );
  const originPosition = addVectors(
    offenderPosition,
    scaleVector(offsetDirection, originDistance),
  );

  return {
    position: originPosition,
    direction: normalizeVector(
      subtractVectors(offenderPosition, originPosition),
      fallbackDirection,
    ),
  };
}

function buildDefaultCharacterState(characterID) {
  return {
    characterID: toPositiveInt(characterID, 0),
    safetyLevel: SAFETY_LEVEL_FULL,
    weaponTimerExpiresAtMs: 0,
    pvpTimerExpiresAtMs: 0,
    npcTimerExpiresAtMs: 0,
    criminalTimerExpiresAtMs: 0,
    disapprovalTimerExpiresAtMs: 0,
    criminal: false,
    suspect: false,
    lastKnownSystemID: 0,
    lastCriminalAtMs: 0,
  };
}

function ensureCharacterState(characterID) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  if (!characterCrimewatchState.has(normalizedCharacterID)) {
    characterCrimewatchState.set(
      normalizedCharacterID,
      buildDefaultCharacterState(normalizedCharacterID),
    );
  }

  return characterCrimewatchState.get(normalizedCharacterID);
}

function pruneCharacterState(characterID, now = Date.now()) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  const state = characterCrimewatchState.get(normalizedCharacterID) || null;
  pruneSecurityPenaltyTracker(normalizedCharacterID, now);
  if (!state) {
    return;
  }

  if (toFiniteNumber(state.weaponTimerExpiresAtMs, 0) <= now) {
    state.weaponTimerExpiresAtMs = 0;
  }
  if (toFiniteNumber(state.pvpTimerExpiresAtMs, 0) <= now) {
    state.pvpTimerExpiresAtMs = 0;
  }
  if (toFiniteNumber(state.npcTimerExpiresAtMs, 0) <= now) {
    state.npcTimerExpiresAtMs = 0;
  }
  if (toFiniteNumber(state.criminalTimerExpiresAtMs, 0) <= now) {
    state.criminalTimerExpiresAtMs = 0;
    state.criminal = false;
    state.suspect = false;
  }
  if (toFiniteNumber(state.disapprovalTimerExpiresAtMs, 0) <= now) {
    state.disapprovalTimerExpiresAtMs = 0;
  }

  const shouldKeep =
    state.safetyLevel !== SAFETY_LEVEL_FULL ||
    state.weaponTimerExpiresAtMs > now ||
    state.pvpTimerExpiresAtMs > now ||
    state.npcTimerExpiresAtMs > now ||
    state.criminalTimerExpiresAtMs > now ||
    state.disapprovalTimerExpiresAtMs > now ||
    state.criminal === true ||
    state.suspect === true;

  if (!shouldKeep) {
    characterCrimewatchState.delete(normalizedCharacterID);
    lastBroadcastTimerSnapshots.delete(normalizedCharacterID);
    recentSecurityPenaltyTargets.delete(normalizedCharacterID);
  }
}

function pruneAllCharacterStates(now = Date.now()) {
  for (const characterID of characterCrimewatchState.keys()) {
    pruneCharacterState(characterID, now);
  }
}

function ensureSystemResponseMap(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return null;
  }

  if (!systemConcordResponses.has(normalizedSystemID)) {
    systemConcordResponses.set(normalizedSystemID, new Map());
  }
  return systemConcordResponses.get(normalizedSystemID);
}

function pruneSystemResponseMap(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const responseMap = systemConcordResponses.get(normalizedSystemID) || null;
  if (responseMap && responseMap.size === 0) {
    systemConcordResponses.delete(normalizedSystemID);
  }
}

function normalizeSafetyLevel(safetyLevel) {
  const numeric = Math.trunc(Number(safetyLevel));
  if (!Number.isFinite(numeric)) {
    return SAFETY_LEVEL_FULL;
  }

  return Math.max(
    SAFETY_LEVEL_NONE,
    Math.min(SAFETY_LEVEL_FULL, numeric),
  );
}

function getSolarSystemPseudoSecurity(system) {
  const security = Math.max(0, Math.min(1, toFiniteNumber(system && system.security, 0)));
  if (security > 0 && security < 0.05) {
    return 0.05;
  }
  return security;
}

function getConcordResponseDelayMsForSystem(system) {
  const security = Math.round(getSolarSystemPseudoSecurity(system) * 10) / 10;
  if (security >= 0.9) {
    return 6_000;
  }
  if (security >= 0.8) {
    return 7_000;
  }
  if (security >= 0.7) {
    return 10_000;
  }
  if (security >= 0.6) {
    return 14_000;
  }
  if (security >= 0.5) {
    return 19_000;
  }
  return 0;
}

function isHighSecuritySystem(system) {
  return getSolarSystemPseudoSecurity(system) >= 0.5;
}

function isCrimewatchConcordResponseEnabled() {
  return config.crimewatchConcordResponseEnabled !== false;
}

function isCrimewatchConcordPodKillEnabled() {
  return config.crimewatchConcordPodKillEnabled === true;
}

function getEntityActorKind(entity) {
  if (!entity) {
    return null;
  }

  const npcEntityType = String(
    entity.npcEntityType ||
    entity.entityType ||
    "",
  ).trim().toLowerCase();
  if (npcEntityType === "concord") {
    return "concord";
  }
  if (npcEntityType) {
    return "npc";
  }

  const sessionCharacterID = toPositiveInt(
    entity.session && (entity.session.characterID || entity.session.charID),
    0,
  );
  if (sessionCharacterID > 0 || toPositiveInt(entity.characterID, 0) > 0) {
    return "player";
  }

  return null;
}

function getEntityCharacterID(entity) {
  if (!entity) {
    return 0;
  }

  const actorKind = getEntityActorKind(entity);
  if (actorKind !== "player") {
    return 0;
  }

  return toPositiveInt(
    entity.session && (entity.session.characterID || entity.session.charID),
    toPositiveInt(entity.characterID, 0),
  );
}

function roundSecurityStatus(value) {
  return Number(
    toFiniteNumber(value, 0).toFixed(SECURITY_STATUS_ROUND_DIGITS),
  );
}

function clampSecurityStatus(value) {
  return roundSecurityStatus(
    Math.max(
      SECURITY_STATUS_MIN,
      Math.min(SECURITY_STATUS_MAX, toFiniteNumber(value, 0)),
    ),
  );
}

function isCapsuleEntity(entity) {
  return toPositiveInt(entity && entity.groupID, 0) === GROUP_CAPSULE;
}

function getCharacterSecurityStatus(characterID, fallback = 0) {
  const record = characterID > 0 ? getCharacterRecord(characterID) || null : null;
  return clampSecurityStatus(
    record && (record.securityStatus ?? record.securityRating) !== undefined
      ? record.securityStatus ?? record.securityRating
      : fallback,
  );
}

function getEntitySecurityStatus(entity, fallback = 0) {
  const characterID = getEntityCharacterID(entity);
  if (characterID > 0) {
    const record = getCharacterRecord(characterID) || null;
    if (record) {
      return clampSecurityStatus(record.securityStatus ?? record.securityRating ?? fallback);
    }
  }

  return clampSecurityStatus(
    entity && (entity.securityStatus ?? entity.securityRating) !== undefined
      ? entity.securityStatus ?? entity.securityRating
      : fallback,
  );
}

function setCharacterSecurityStatus(
  characterID,
  nextSecurityStatus,
  options = {},
) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const characterRecord = getCharacterRecord(normalizedCharacterID) || null;
  if (!characterRecord) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const previousSecurityStatus = getCharacterSecurityStatus(normalizedCharacterID, 0);
  const clampedSecurityStatus = clampSecurityStatus(nextSecurityStatus);
  const updateResult = updateCharacterRecord(normalizedCharacterID, (record) => ({
    ...record,
    securityStatus: clampedSecurityStatus,
    securityRating: clampedSecurityStatus,
  }));
  if (!updateResult.success) {
    return {
      success: false,
      errorMsg: updateResult.errorMsg || "WRITE_ERROR",
    };
  }

  const syncResult = synchronizeLiveSecurityStatus(
    options.scene || null,
    options.entity || null,
    previousSecurityStatus,
    clampedSecurityStatus,
    options.now,
  );

  if (!options.entity && options.session) {
    notifyOwnSecurityStatusUpdate(
      options.session,
      clampedSecurityStatus,
      previousSecurityStatus,
    );
  }

  return {
    success: true,
    data: {
      characterID: normalizedCharacterID,
      previousSecurityStatus,
      securityStatus: clampedSecurityStatus,
      securityRating: clampedSecurityStatus,
      slimRecipients: toPositiveInt(syncResult && syncResult.slimRecipients, 0),
      attributeNotified: Boolean(syncResult && syncResult.attributeNotified),
      selfStatusNotified: Boolean(syncResult && syncResult.selfStatusNotified),
    },
  };
}

function getSecurityPenaltyTracker(characterID) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  if (!recentSecurityPenaltyTargets.has(normalizedCharacterID)) {
    recentSecurityPenaltyTargets.set(normalizedCharacterID, new Map());
  }
  return recentSecurityPenaltyTargets.get(normalizedCharacterID);
}

function pruneSecurityPenaltyTracker(characterID, now = Date.now()) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  const tracker = recentSecurityPenaltyTargets.get(normalizedCharacterID) || null;
  if (!tracker) {
    return;
  }

  for (const [targetKey, expiresAtMs] of tracker.entries()) {
    if (toFiniteNumber(expiresAtMs, 0) <= now) {
      tracker.delete(targetKey);
    }
  }

  if (tracker.size === 0) {
    recentSecurityPenaltyTargets.delete(normalizedCharacterID);
  }
}

function getSecurityPenaltyTargetKey(targetEntity) {
  const targetEntityID = toPositiveInt(targetEntity && targetEntity.itemID, 0);
  if (!targetEntityID) {
    return null;
  }

  return `${targetEntityID}:${isCapsuleEntity(targetEntity) ? "capsule" : "ship"}`;
}

function hasRecentSecurityPenaltyTarget(characterID, targetKey, now = Date.now()) {
  pruneSecurityPenaltyTracker(characterID, now);
  const tracker = recentSecurityPenaltyTargets.get(toPositiveInt(characterID, 0)) || null;
  if (!tracker || !targetKey) {
    return false;
  }

  return toFiniteNumber(tracker.get(targetKey), 0) > now;
}

function rememberRecentSecurityPenaltyTarget(characterID, targetKey, expiresAtMs) {
  const tracker = getSecurityPenaltyTracker(characterID);
  if (!tracker || !targetKey) {
    return false;
  }

  tracker.set(
    targetKey,
    Math.max(0, Math.trunc(toFiniteNumber(expiresAtMs, Date.now()))),
  );
  return true;
}

function resolveSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
}

function resolveSessionSystemID(session) {
  return toPositiveInt(
    session && (
      (session._space && session._space.systemID) ||
      session.solarsystemid2 ||
      session.solarsystemid
    ),
    0,
  );
}

function getCharacterCrimewatchState(characterID, now = Date.now()) {
  const normalizedCharacterID = toPositiveInt(characterID, 0);
  if (!normalizedCharacterID) {
    return null;
  }

  pruneCharacterState(normalizedCharacterID, now);
  const state = characterCrimewatchState.get(normalizedCharacterID) || null;
  return state ? cloneValue(state) : null;
}

function isCharacterCriminal(characterID, now = Date.now()) {
  const state = getCharacterCrimewatchState(characterID, now);
  return Boolean(
    state &&
    state.criminal === true &&
    toFiniteNumber(state.criminalTimerExpiresAtMs, 0) > now
  );
}

function isCharacterSuspect(characterID, now = Date.now()) {
  const state = getCharacterCrimewatchState(characterID, now);
  return Boolean(
    state &&
    state.suspect === true &&
    state.criminal !== true &&
    toFiniteNumber(state.criminalTimerExpiresAtMs, 0) > now
  );
}

function getSafetyLevel(characterID) {
  const state = ensureCharacterState(characterID);
  return state ? normalizeSafetyLevel(state.safetyLevel) : SAFETY_LEVEL_FULL;
}

function setSafetyLevel(characterID, safetyLevel) {
  const state = ensureCharacterState(characterID);
  if (!state) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  state.safetyLevel = normalizeSafetyLevel(safetyLevel);
  return {
    success: true,
    data: {
      characterID: state.characterID,
      safetyLevel: state.safetyLevel,
    },
  };
}

function buildFiletimeFromExpiryMs(expiresAtMs) {
  return buildFiletimeLong(BigInt(Math.trunc(expiresAtMs)) * 10000n + 116444736000000000n);
}

function buildSecurityStatusPenaltyResult({
  applied = false,
  reason = "NOT_APPLIED",
  characterID = 0,
  systemSecurity = 0,
  targetKind = "ship",
  previousSecurityStatus = 0,
  nextSecurityStatus = previousSecurityStatus,
  targetSecurityStatus = 0,
  modification = 0,
} = {}) {
  return {
    applied,
    reason,
    characterID: toPositiveInt(characterID, 0),
    targetKind,
    systemSecurity: roundNumber(toFiniteNumber(systemSecurity, 0), 6),
    previousSecurityStatus: clampSecurityStatus(previousSecurityStatus),
    nextSecurityStatus: clampSecurityStatus(nextSecurityStatus),
    deltaSecurityStatus: roundSecurityStatus(
      clampSecurityStatus(nextSecurityStatus) -
        clampSecurityStatus(previousSecurityStatus),
    ),
    targetSecurityStatus: clampSecurityStatus(targetSecurityStatus),
    modificationPercent: roundNumber(toFiniteNumber(modification, 0) * 100, 6),
  };
}

function buildSecurityStatusAttributeChange(characterID, itemID, nextValue, previousValue, whenMs) {
  return [
    "OnModuleAttributeChanges",
    toPositiveInt(characterID, 0),
    toPositiveInt(itemID, 0),
    ATTRIBUTE_PILOT_SECURITY_STATUS,
    buildFiletimeFromExpiryMs(whenMs),
    clampSecurityStatus(nextValue),
    clampSecurityStatus(previousValue),
    null,
  ];
}

function notifySecurityStatusAttributeChange(
  session,
  characterID,
  itemID,
  nextValue,
  previousValue,
  whenMs,
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    toPositiveInt(itemID, 0) <= 0 ||
    Number(clampSecurityStatus(nextValue)) ===
      Number(clampSecurityStatus(previousValue))
  ) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: [
      buildSecurityStatusAttributeChange(
        characterID,
        itemID,
        nextValue,
        previousValue,
        whenMs,
      ),
    ],
  }]);
  return true;
}

function notifyOwnSecurityStatusUpdate(session, nextValue, previousValue) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    Number(clampSecurityStatus(nextValue)) ===
      Number(clampSecurityStatus(previousValue))
  ) {
    return false;
  }

  session.sendNotification("OnSecurityStatusUpdate", "clientID", [
    clampSecurityStatus(nextValue),
  ]);
  return true;
}

function synchronizeLiveSecurityStatus(
  scene,
  entity,
  previousSecurityStatus,
  nextSecurityStatus,
  now = Date.now(),
) {
  if (
    !scene ||
    !entity ||
    Number(clampSecurityStatus(previousSecurityStatus)) ===
      Number(clampSecurityStatus(nextSecurityStatus))
  ) {
    return {
      slimRecipients: 0,
      attributeNotified: false,
      selfStatusNotified: false,
    };
  }

  entity.securityStatus = clampSecurityStatus(nextSecurityStatus);
  let slimRecipients = 0;

  for (const session of getSceneSessions(scene)) {
    if (
      session !== entity.session &&
      typeof scene.canSessionSeeDynamicEntity === "function" &&
      !scene.canSessionSeeDynamicEntity(session, entity)
    ) {
      continue;
    }
    if (typeof scene.sendSlimItemChangesToSession === "function") {
      scene.sendSlimItemChangesToSession(session, [entity]);
      slimRecipients += 1;
    }
  }

  const characterID = getEntityCharacterID(entity);
  const attributeNotified = notifySecurityStatusAttributeChange(
    entity.session,
    characterID,
    entity.itemID,
    nextSecurityStatus,
    previousSecurityStatus,
    Math.max(0, Math.trunc(toFiniteNumber(now, Date.now()))),
  );
  const selfStatusNotified = notifyOwnSecurityStatusUpdate(
    entity.session,
    nextSecurityStatus,
    previousSecurityStatus,
  );

  return {
    slimRecipients,
    attributeNotified,
    selfStatusNotified,
  };
}

function applySecurityStatusPenaltyForAggression(
  scene,
  attackerEntity,
  targetEntity,
  now = Date.now(),
) {
  if (!scene || !attackerEntity || !targetEntity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  if (
    getEntityActorKind(attackerEntity) !== "player" ||
    getEntityActorKind(targetEntity) !== "player"
  ) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "NON_PLAYER_COMBAT",
      }),
    };
  }

  const attackerCharacterID = getEntityCharacterID(attackerEntity);
  const targetCharacterID = getEntityCharacterID(targetEntity);
  if (
    !attackerCharacterID ||
    !targetCharacterID ||
    attackerCharacterID === targetCharacterID
  ) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "FRIENDLY_OR_SELF",
        characterID: attackerCharacterID,
      }),
    };
  }

  const systemSecurity = getSolarSystemPseudoSecurity(scene.system);
  if (systemSecurity <= 0) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "NOT_EMPIRE_SPACE",
        characterID: attackerCharacterID,
      }),
    };
  }

  const attackerRecord = getCharacterRecord(attackerCharacterID) || null;
  if (!attackerRecord) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "CHARACTER_RECORD_NOT_FOUND",
        characterID: attackerCharacterID,
      }),
    };
  }

  const targetKind = isCapsuleEntity(targetEntity) ? "capsule" : "ship";
  const targetKey = getSecurityPenaltyTargetKey(targetEntity);
  const previousSecurityStatus = getCharacterSecurityStatus(attackerCharacterID, 0);
  const targetSecurityStatus = getEntitySecurityStatus(targetEntity, 0);
  if (targetKey && hasRecentSecurityPenaltyTarget(attackerCharacterID, targetKey, now)) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "DUPLICATE_TARGET",
        characterID: attackerCharacterID,
        previousSecurityStatus,
        nextSecurityStatus: previousSecurityStatus,
        targetSecurityStatus,
        systemSecurity,
        targetKind,
      }),
    };
  }

  const modificationBase = targetKind === "capsule"
    ? SECURITY_STATUS_CAPSULE_AGGRESSION_MODIFIER
    : SECURITY_STATUS_SHIP_AGGRESSION_MODIFIER;
  const modification =
    modificationBase *
    systemSecurity *
    (1 + ((targetSecurityStatus - previousSecurityStatus) / 100));
  const nextSecurityStatus = clampSecurityStatus(
    previousSecurityStatus + ((10 - previousSecurityStatus) * modification),
  );

  if (targetKey) {
    rememberRecentSecurityPenaltyTarget(
      attackerCharacterID,
      targetKey,
      now + SECURITY_STATUS_DUPLICATE_WINDOW_MS,
    );
  }

  if (Number(nextSecurityStatus) === Number(previousSecurityStatus)) {
    return {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "SECURITY_STATUS_FLOOR_REACHED",
        characterID: attackerCharacterID,
        systemSecurity,
        targetKind,
        previousSecurityStatus,
        nextSecurityStatus,
        targetSecurityStatus,
        modification,
      }),
    };
  }

  const updateResult = updateCharacterRecord(attackerCharacterID, (record) => ({
    ...record,
    securityStatus: nextSecurityStatus,
    securityRating: nextSecurityStatus,
  }));
  if (!updateResult.success) {
    return {
      success: false,
      errorMsg: updateResult.errorMsg || "WRITE_ERROR",
    };
  }

  const syncResult = synchronizeLiveSecurityStatus(
    scene,
    attackerEntity,
    previousSecurityStatus,
    nextSecurityStatus,
    now,
  );

  return {
    success: true,
    data: {
      ...buildSecurityStatusPenaltyResult({
        applied: true,
        reason: "APPLIED",
        characterID: attackerCharacterID,
        systemSecurity,
        targetKind,
        previousSecurityStatus,
        nextSecurityStatus,
        targetSecurityStatus,
        modification,
      }),
      slimRecipients: toPositiveInt(syncResult && syncResult.slimRecipients, 0),
      attributeNotified: Boolean(syncResult && syncResult.attributeNotified),
      selfStatusNotified: Boolean(syncResult && syncResult.selfStatusNotified),
    },
  };
}

function buildTimerTuple(stateCode, expiresAtMs, now = Date.now()) {
  const normalizedExpiry = Math.max(0, Math.trunc(toFiniteNumber(expiresAtMs, 0)));
  if (normalizedExpiry <= now) {
    return [stateCode, null];
  }

  return [
    stateCode + 2,
    buildFiletimeFromExpiryMs(normalizedExpiry),
  ];
}

function buildWeaponTimerTuple(state, now = Date.now()) {
  return buildTimerTuple(
    WEAPONS_TIMER_STATE_IDLE,
    state && state.weaponTimerExpiresAtMs,
    now,
  );
}

function buildPvpTimerTuple(state, now = Date.now()) {
  return buildTimerTuple(
    PVP_TIMER_STATE_IDLE,
    state && state.pvpTimerExpiresAtMs,
    now,
  );
}

function buildNpcTimerTuple(state, now = Date.now()) {
  return buildTimerTuple(
    NPC_TIMER_STATE_IDLE,
    state && state.npcTimerExpiresAtMs,
    now,
  );
}

function buildCriminalTimerTuple(state, now = Date.now()) {
  const normalizedState = state || buildDefaultCharacterState(0);
  const normalizedExpiry = Math.max(
    0,
    Math.trunc(toFiniteNumber(normalizedState.criminalTimerExpiresAtMs, 0)),
  );
  if (
    normalizedExpiry <= now ||
    (!normalizedState.criminal && !normalizedState.suspect)
  ) {
    return [CRIMINAL_TIMER_STATE_IDLE, null];
  }

  return [
    normalizedState.criminal
      ? CRIMINAL_TIMER_STATE_TIMER_CRIMINAL
      : CRIMINAL_TIMER_STATE_TIMER_SUSPECT,
    buildFiletimeFromExpiryMs(normalizedExpiry),
  ];
}

function buildDisapprovalTimerTuple(state, now = Date.now()) {
  return buildTimerTuple(
    DISAPPROVAL_TIMER_STATE_IDLE,
    state && state.disapprovalTimerExpiresAtMs,
    now,
  );
}

function buildCombatTimerTuplesFromState(state, now = Date.now()) {
  return [
    buildWeaponTimerTuple(state, now),
    buildPvpTimerTuple(state, now),
    buildNpcTimerTuple(state, now),
    buildCriminalTimerTuple(state, now),
    buildDisapprovalTimerTuple(state, now),
  ];
}

function buildFlaggedCharacterSnapshot(systemID, now = Date.now()) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const criminals = [];
  const suspects = [];

  for (const state of characterCrimewatchState.values()) {
    if (
      normalizedSystemID > 0 &&
      toPositiveInt(state.lastKnownSystemID, 0) !== normalizedSystemID
    ) {
      continue;
    }
    if (
      state.criminal === true &&
      toFiniteNumber(state.criminalTimerExpiresAtMs, 0) > now
    ) {
      criminals.push(state.characterID);
    } else if (
      state.suspect === true &&
      toFiniteNumber(state.criminalTimerExpiresAtMs, 0) > now
    ) {
      suspects.push(state.characterID);
    }
  }

  criminals.sort((left, right) => left - right);
  suspects.sort((left, right) => left - right);
  return { criminals, suspects };
}

function buildDisapprovalSnapshot(systemID, now = Date.now()) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const disapproved = [];

  for (const state of characterCrimewatchState.values()) {
    if (
      normalizedSystemID > 0 &&
      toPositiveInt(state.lastKnownSystemID, 0) !== normalizedSystemID
    ) {
      continue;
    }
    if (toFiniteNumber(state.disapprovalTimerExpiresAtMs, 0) > now) {
      disapproved.push(state.characterID);
    }
  }

  disapproved.sort((left, right) => left - right);
  return { disapproved };
}

function buildFlaggedCharactersForSession(session, now = Date.now()) {
  const snapshot = buildFlaggedCharacterSnapshot(
    resolveSessionSystemID(session),
    now,
  );
  return [
    buildList(snapshot.criminals),
    buildList(snapshot.suspects),
  ];
}

function buildClientStatesForSession(session, now = Date.now()) {
  const characterID = resolveSessionCharacterID(session);
  const state = getCharacterCrimewatchState(characterID, now) ||
    buildDefaultCharacterState(characterID);

  return [
    buildCombatTimerTuplesFromState(state, now),
    buildDict([]),
    buildFlaggedCharactersForSession(session, now),
    normalizeSafetyLevel(state.safetyLevel),
  ];
}

function buildComparableTupleKey(tuple) {
  if (!Array.isArray(tuple)) {
    return "invalid";
  }

  const stateCode = Number(tuple[0]) || 0;
  const expiryValue =
    tuple[1] &&
    typeof tuple[1] === "object" &&
    Object.prototype.hasOwnProperty.call(tuple[1], "value")
      ? String(tuple[1].value)
      : "";
  return `${stateCode}:${expiryValue}`;
}

function arraysEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function getSceneSessions(scene) {
  return scene && scene.sessions instanceof Map
    ? [...scene.sessions.values()].filter(
      (session) => Boolean(session && typeof session.sendNotification === "function"),
    )
    : [];
}

function buildTimerBroadcastSnapshot(characterID, now = Date.now()) {
  const state = getCharacterCrimewatchState(characterID, now) ||
    buildDefaultCharacterState(characterID);
  return {
    weapons: buildWeaponTimerTuple(state, now),
    pvp: buildPvpTimerTuple(state, now),
    npc: buildNpcTimerTuple(state, now),
    criminal: buildCriminalTimerTuple(state, now),
    disapproval: buildDisapprovalTimerTuple(state, now),
  };
}

function sendTimerNotificationIfChanged(
  session,
  notificationName,
  previousTuple,
  nextTuple,
) {
  if (buildComparableTupleKey(previousTuple) === buildComparableTupleKey(nextTuple)) {
    return;
  }

  session.sendNotification(notificationName, "clientID", [
    nextTuple[0],
    nextTuple[1],
  ]);
}

function synchronizeSessionTimerNotifications(scene, session, now = Date.now()) {
  if (!session) {
    return;
  }

  const characterID = resolveSessionCharacterID(session);
  if (!characterID) {
    return;
  }

  const snapshot = buildTimerBroadcastSnapshot(characterID, now);
  const previous = lastBroadcastTimerSnapshots.get(characterID) || {
    weapons: [WEAPONS_TIMER_STATE_IDLE, null],
    pvp: [PVP_TIMER_STATE_IDLE, null],
    npc: [NPC_TIMER_STATE_IDLE, null],
    criminal: [CRIMINAL_TIMER_STATE_IDLE, null],
    disapproval: [DISAPPROVAL_TIMER_STATE_IDLE, null],
  };

  sendTimerNotificationIfChanged(
    session,
    "OnWeaponsTimerUpdate",
    previous.weapons,
    snapshot.weapons,
  );
  sendTimerNotificationIfChanged(
    session,
    "OnPvpTimerUpdate",
    previous.pvp,
    snapshot.pvp,
  );
  sendTimerNotificationIfChanged(
    session,
    "OnNpcTimerUpdate",
    previous.npc,
    snapshot.npc,
  );
  sendTimerNotificationIfChanged(
    session,
    "OnCriminalTimerUpdate",
    previous.criminal,
    snapshot.criminal,
  );
  sendTimerNotificationIfChanged(
    session,
    "OnDisapprovalTimerUpdate",
    previous.disapproval,
    snapshot.disapproval,
  );

  lastBroadcastTimerSnapshots.set(characterID, snapshot);
}

function diffArray(previousItems, nextItems) {
  const previousSet = new Set(Array.isArray(previousItems) ? previousItems : []);
  const nextSet = new Set(Array.isArray(nextItems) ? nextItems : []);
  return {
    removed: [...previousSet]
      .filter((item) => !nextSet.has(item))
      .sort((left, right) => left - right),
    added: [...nextSet]
      .filter((item) => !previousSet.has(item))
      .sort((left, right) => left - right),
  };
}

function synchronizeSystemFlagNotifications(scene, now = Date.now()) {
  if (!scene) {
    return;
  }

  const systemID = toPositiveInt(scene.systemID, 0);
  const snapshot = buildFlaggedCharacterSnapshot(systemID, now);
  const previous = lastBroadcastFlagSnapshots.get(systemID) || {
    criminals: [],
    suspects: [],
  };
  const criminalDiff = diffArray(previous.criminals, snapshot.criminals);
  const suspectDiff = diffArray(previous.suspects, snapshot.suspects);
  const newIdles = [...new Set([
    ...criminalDiff.removed,
    ...suspectDiff.removed,
  ])].sort((left, right) => left - right);

  if (
    newIdles.length > 0 ||
    suspectDiff.added.length > 0 ||
    criminalDiff.added.length > 0
  ) {
    for (const session of getSceneSessions(scene)) {
      session.sendNotification("OnSystemCriminalFlagUpdates", "clientID", [
        newIdles,
        suspectDiff.added,
        criminalDiff.added,
      ]);
    }
  }

  lastBroadcastFlagSnapshots.set(systemID, snapshot);
}

function synchronizeSystemDisapprovalNotifications(scene, now = Date.now()) {
  if (!scene) {
    return;
  }

  const systemID = toPositiveInt(scene.systemID, 0);
  const snapshot = buildDisapprovalSnapshot(systemID, now);
  const previous = lastBroadcastDisapprovalSnapshots.get(systemID) || {
    disapproved: [],
  };
  const diff = diffArray(previous.disapproved, snapshot.disapproved);
  if (diff.removed.length > 0 || diff.added.length > 0) {
    for (const session of getSceneSessions(scene)) {
      session.sendNotification("OnSystemDisapprovalFlagUpdates", "clientID", [
        diff.removed,
        diff.added,
      ]);
    }
  }

  lastBroadcastDisapprovalSnapshots.set(systemID, snapshot);
}

function synchronizeSceneClientState(scene, now = Date.now()) {
  if (!scene) {
    return;
  }

  for (const session of getSceneSessions(scene)) {
    synchronizeSessionTimerNotifications(scene, session, now);
  }
  synchronizeSystemFlagNotifications(scene, now);
  synchronizeSystemDisapprovalNotifications(scene, now);
}

function ensureConcordResponseRecord(scene, attackerEntity, targetEntity, now) {
  const responseMap = ensureSystemResponseMap(scene && scene.systemID);
  if (!responseMap) {
    return null;
  }

  const offenderEntityID = toPositiveInt(attackerEntity && attackerEntity.itemID, 0);
  if (!offenderEntityID) {
    return null;
  }

  if (!responseMap.has(offenderEntityID)) {
    responseMap.set(offenderEntityID, {
      systemID: toPositiveInt(scene && scene.systemID, 0),
      offenderEntityID,
      offenderCharacterID: getEntityCharacterID(attackerEntity),
      victimEntityID: toPositiveInt(
        (targetEntity && targetEntity.itemID) ||
          (attackerEntity && attackerEntity.itemID),
        0,
      ),
      dueAtMs: now + getConcordResponseDelayMsForSystem(scene && scene.system),
      lastOffenseAtMs: now,
      respondedAtMs: 0,
      responderEntityIDs: [],
      nextRetaskAtMs: 0,
      completionClearAtMs: 0,
      capsuleTargeted: false,
    });
  }

  const response = responseMap.get(offenderEntityID);
  response.systemID = toPositiveInt(scene && scene.systemID, response.systemID);
  response.offenderCharacterID = getEntityCharacterID(attackerEntity);
  response.victimEntityID = toPositiveInt(
    (targetEntity && targetEntity.itemID) ||
      (attackerEntity && attackerEntity.itemID),
    response.victimEntityID,
  );
  response.lastOffenseAtMs = now;
  response.completionClearAtMs = Math.max(
    0,
    Math.trunc(toFiniteNumber(response.completionClearAtMs, 0)),
  );
  response.capsuleTargeted = response.capsuleTargeted === true;
  if (toFiniteNumber(response.respondedAtMs, 0) <= 0) {
    response.dueAtMs = Math.min(
      Math.max(now, toFiniteNumber(response.dueAtMs, now)),
      now + getConcordResponseDelayMsForSystem(scene && scene.system),
    );
  }
  return response;
}

function scheduleConcordResponse(scene, offenderEntity, now = Date.now(), targetEntity = null) {
  if (
    !scene ||
    !offenderEntity ||
    !isHighSecuritySystem(scene.system) ||
    !isCrimewatchConcordResponseEnabled()
  ) {
    return null;
  }

  return ensureConcordResponseRecord(
    scene,
    offenderEntity,
    targetEntity || offenderEntity,
    now,
  );
}

function triggerHighSecCriminalOffense(scene, attackerEntity, options = {}) {
  const now = Math.max(
    0,
    Math.trunc(toFiniteNumber(options.now, Date.now())),
  );
  const targetEntity = options.targetEntity || null;
  const securityPenaltyTargetEntity =
    options.securityPenaltyTargetEntity || targetEntity || null;

  if (!scene || !attackerEntity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  if (getEntityActorKind(attackerEntity) !== "player") {
    return {
      success: true,
      data: {
        applied: false,
        reason: "NON_PLAYER_ATTACKER",
      },
    };
  }

  const attackerCharacterID = getEntityCharacterID(attackerEntity);
  if (!attackerCharacterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const state = ensureCharacterState(attackerCharacterID);
  if (!state) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  state.weaponTimerExpiresAtMs = Math.max(
    toFiniteNumber(state.weaponTimerExpiresAtMs, 0),
    now + WEAPON_TIMER_DURATION_MS,
  );
  state.pvpTimerExpiresAtMs = Math.max(
    toFiniteNumber(state.pvpTimerExpiresAtMs, 0),
    now + PVP_TIMER_DURATION_MS,
  );
  state.lastKnownSystemID = toPositiveInt(scene.systemID, 0);

  if (!isHighSecuritySystem(scene.system)) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "NOT_HIGHSEC",
        characterID: attackerCharacterID,
        weaponTimerExpiresAtMs: state.weaponTimerExpiresAtMs,
        pvpTimerExpiresAtMs: state.pvpTimerExpiresAtMs,
      },
    };
  }

  state.criminalTimerExpiresAtMs = Math.max(
    toFiniteNumber(state.criminalTimerExpiresAtMs, 0),
    now + CRIMINAL_TIMER_DURATION_MS,
  );
  state.criminal = true;
  state.suspect = false;
  state.lastCriminalAtMs = now;

  const response = scheduleConcordResponse(
    scene,
    attackerEntity,
    now,
    targetEntity,
  );
  const securityStatusPenalty = securityPenaltyTargetEntity
    ? applySecurityStatusPenaltyForAggression(
      scene,
      attackerEntity,
      securityPenaltyTargetEntity,
      now,
    )
    : {
      success: true,
      data: buildSecurityStatusPenaltyResult({
        applied: false,
        reason: "NO_TARGET_ENTITY",
        characterID: attackerCharacterID,
      }),
    };

  return {
    success: true,
    data: {
      applied: true,
      reason: String(options.reason || "CRIMINAL_OFFENSE").trim() || "CRIMINAL_OFFENSE",
      characterID: attackerCharacterID,
      systemID: scene.systemID,
      criminalTimerExpiresAtMs: state.criminalTimerExpiresAtMs,
      weaponTimerExpiresAtMs: state.weaponTimerExpiresAtMs,
      pvpTimerExpiresAtMs: state.pvpTimerExpiresAtMs,
      concordResponseDueAtMs: response ? response.dueAtMs : 0,
      securityStatusPenalty:
        securityStatusPenalty && securityStatusPenalty.data
          ? securityStatusPenalty.data
          : buildSecurityStatusPenaltyResult({
            applied: false,
            reason:
              securityStatusPenalty && securityStatusPenalty.errorMsg
                ? securityStatusPenalty.errorMsg
                : "NOT_APPLIED",
            characterID: attackerCharacterID,
          }),
    },
  };
}

function setCharacterCrimewatchDebugState(characterID, updates = {}, options = {}) {
  const state = ensureCharacterState(characterID);
  if (!state) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const now = Math.max(0, Math.trunc(toFiniteNumber(options.now, Date.now())));
  const numericSystemID = toPositiveInt(
    options.systemID,
    toPositiveInt(state.lastKnownSystemID, 0),
  );

  if (Object.prototype.hasOwnProperty.call(updates, "safetyLevel")) {
    state.safetyLevel = normalizeSafetyLevel(updates.safetyLevel);
  }

  if (updates.clearTimers === true || updates.clearAll === true) {
    state.weaponTimerExpiresAtMs = 0;
    state.pvpTimerExpiresAtMs = 0;
    state.npcTimerExpiresAtMs = 0;
    state.criminalTimerExpiresAtMs = 0;
    state.disapprovalTimerExpiresAtMs = 0;
    state.criminal = false;
    state.suspect = false;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "weaponTimerMs")) {
    const durationMs = Math.max(0, Math.trunc(toFiniteNumber(updates.weaponTimerMs, 0)));
    state.weaponTimerExpiresAtMs = durationMs > 0 ? now + durationMs : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "pvpTimerMs")) {
    const durationMs = Math.max(0, Math.trunc(toFiniteNumber(updates.pvpTimerMs, 0)));
    state.pvpTimerExpiresAtMs = durationMs > 0 ? now + durationMs : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "npcTimerMs")) {
    const durationMs = Math.max(0, Math.trunc(toFiniteNumber(updates.npcTimerMs, 0)));
    state.npcTimerExpiresAtMs = durationMs > 0 ? now + durationMs : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "disapprovalTimerMs")) {
    const durationMs = Math.max(0, Math.trunc(toFiniteNumber(updates.disapprovalTimerMs, 0)));
    state.disapprovalTimerExpiresAtMs = durationMs > 0 ? now + durationMs : 0;
  }

  let penaltyDurationWasExplicit = false;
  if (Object.prototype.hasOwnProperty.call(updates, "criminalTimerMs")) {
    penaltyDurationWasExplicit = true;
    const durationMs = Math.max(0, Math.trunc(toFiniteNumber(updates.criminalTimerMs, 0)));
    state.criminalTimerExpiresAtMs = durationMs > 0 ? now + durationMs : 0;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "criminal")) {
    if (updates.criminal) {
      state.criminal = true;
      state.suspect = false;
      if (
        !penaltyDurationWasExplicit &&
        toFiniteNumber(state.criminalTimerExpiresAtMs, 0) <= now
      ) {
        state.criminalTimerExpiresAtMs = now + CRIMINAL_TIMER_DURATION_MS;
      }
      state.lastCriminalAtMs = now;
    } else if (!updates.suspect) {
      state.criminal = false;
      if (!state.suspect) {
        state.criminalTimerExpiresAtMs = 0;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "suspect")) {
    if (updates.suspect) {
      state.suspect = true;
      state.criminal = false;
      if (
        !penaltyDurationWasExplicit &&
        toFiniteNumber(state.criminalTimerExpiresAtMs, 0) <= now
      ) {
        state.criminalTimerExpiresAtMs = now + CRIMINAL_TIMER_DURATION_MS;
      }
    } else if (!updates.criminal) {
      state.suspect = false;
      if (!state.criminal) {
        state.criminalTimerExpiresAtMs = 0;
      }
    }
  }

  if (
    !state.criminal &&
    !state.suspect &&
    toFiniteNumber(state.criminalTimerExpiresAtMs, 0) <= now
  ) {
    state.criminalTimerExpiresAtMs = 0;
  }

  if (numericSystemID > 0) {
    state.lastKnownSystemID = numericSystemID;
  }

  pruneCharacterState(state.characterID, now);

  if (
    updates.refreshConcord === true &&
    state.criminal === true &&
    toFiniteNumber(state.criminalTimerExpiresAtMs, 0) > now &&
    options.scene &&
    options.offenderEntity
  ) {
    scheduleConcordResponse(
      options.scene,
      options.offenderEntity,
      now,
      options.targetEntity || null,
    );
  }

  return {
    success: true,
    data: getCharacterCrimewatchState(state.characterID, now) ||
      buildDefaultCharacterState(state.characterID),
  };
}

function recordHighSecCriminalAggression(scene, attackerEntity, targetEntity, now = Date.now()) {
  if (!scene || !attackerEntity || !targetEntity) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  if (
    getEntityActorKind(attackerEntity) !== "player" ||
    getEntityActorKind(targetEntity) !== "player"
  ) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "NON_PLAYER_COMBAT",
      },
    };
  }

  const attackerCharacterID = getEntityCharacterID(attackerEntity);
  const targetCharacterID = getEntityCharacterID(targetEntity);
  if (
    !attackerCharacterID ||
    !targetCharacterID ||
    attackerCharacterID === targetCharacterID
  ) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "FRIENDLY_OR_SELF",
      },
    };
  }

  const state = ensureCharacterState(attackerCharacterID);
  if (!state) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  state.weaponTimerExpiresAtMs = Math.max(
    toFiniteNumber(state.weaponTimerExpiresAtMs, 0),
    now + WEAPON_TIMER_DURATION_MS,
  );
  state.pvpTimerExpiresAtMs = Math.max(
    toFiniteNumber(state.pvpTimerExpiresAtMs, 0),
    now + PVP_TIMER_DURATION_MS,
  );
  state.lastKnownSystemID = toPositiveInt(scene.systemID, 0);

  if (!isHighSecuritySystem(scene.system)) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "NOT_HIGHSEC",
        characterID: attackerCharacterID,
        weaponTimerExpiresAtMs: state.weaponTimerExpiresAtMs,
        pvpTimerExpiresAtMs: state.pvpTimerExpiresAtMs,
      },
    };
  }

  if (isCharacterCriminal(targetCharacterID, now)) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "TARGET_ALREADY_CRIMINAL",
        characterID: attackerCharacterID,
        weaponTimerExpiresAtMs: state.weaponTimerExpiresAtMs,
        pvpTimerExpiresAtMs: state.pvpTimerExpiresAtMs,
      },
    };
  }

  if (isCharacterSuspect(targetCharacterID, now)) {
    return {
      success: true,
      data: {
        applied: false,
        reason: "TARGET_ALREADY_SUSPECT",
        characterID: attackerCharacterID,
        weaponTimerExpiresAtMs: state.weaponTimerExpiresAtMs,
        pvpTimerExpiresAtMs: state.pvpTimerExpiresAtMs,
      },
    };
  }

  return triggerHighSecCriminalOffense(
    scene,
    attackerEntity,
    {
      now,
      reason: "HIGHSEC_PLAYER_AGGRESSION",
      targetEntity,
      securityPenaltyTargetEntity: targetEntity,
    },
  );
}

function getActiveResponderEntityIDs(scene, response) {
  const currentIDs = Array.isArray(response && response.responderEntityIDs)
    ? response.responderEntityIDs
    : [];
  return currentIDs.filter((entityID) => Boolean(scene && scene.getEntityByID(entityID)));
}

function buildConcordArrivalPoint(offenderEntity, index = 0, total = 1) {
  const center = cloneVector(offenderEntity && offenderEntity.position);
  const divisor = Math.max(1, toPositiveInt(total, 1));
  const angle = ((Math.PI * 2) / divisor) * Math.max(0, index);
  return {
    x: center.x + (Math.cos(angle) * CONCORD_RESPONSE_ARRIVAL_RING_METERS),
    y: center.y,
    z: center.z + (Math.sin(angle) * CONCORD_RESPONSE_ARRIVAL_RING_METERS),
  };
}

function clearConcordResponders(scene, responderEntityIDs) {
  if (!scene || !Array.isArray(responderEntityIDs) || responderEntityIDs.length === 0) {
    return 0;
  }

  const npcService = require(path.join(__dirname, "../../space/npc"));
  let clearedCount = 0;
  for (const responderEntityID of responderEntityIDs) {
    const destroyResult = npcService.destroyNpcControllerByEntityID(
      responderEntityID,
      {
        removeContents: true,
      },
    );
    if (destroyResult && destroyResult.success) {
      clearedCount += 1;
    }
  }
  return clearedCount;
}

function stopResponders(scene, responderEntityIDs) {
  if (
    !scene ||
    !Array.isArray(responderEntityIDs) ||
    responderEntityIDs.length === 0
  ) {
    return 0;
  }

  const npcService = require(path.join(__dirname, "../../space/npc"));
  let stoppedCount = 0;
  for (const responderEntityID of responderEntityIDs) {
    const responderEntity = scene.getEntityByID(responderEntityID);
    if (!responderEntity) {
      continue;
    }

    const needsAuthoritativeParkRefresh =
      responderEntity.mode !== "STOP" ||
      toFiniteNumber(responderEntity.speedFraction, 0) > 0 ||
      magnitude(responderEntity.velocity) > 0.1 ||
      responderEntity.warpState ||
      responderEntity.pendingWarp ||
      toPositiveInt(responderEntity.targetEntityID, 0) > 0 ||
      toFiniteNumber(responderEntity.followRange, 0) > 0 ||
      toFiniteNumber(responderEntity.orbitDistance, 0) > 0;

    if (needsAuthoritativeParkRefresh) {
      // Crime-scene cleanup happens after different responders have reached
      // different movement phases. A plain STOP leaves clients extrapolating
      // from their own last-known movement history, which can desync one
      // responder into "flying off forever" for a single observer. Re-anchor
      // moving responders onto one authoritative parked position first so every
      // client collapses to the same on-grid state before the controller idles.
      const parkedPosition =
        responderEntity.mode === "WARP" &&
        responderEntity.warpState &&
        !responderEntity.pendingWarp
          ? cloneVector(
              responderEntity.warpState.targetPoint,
              responderEntity.position,
            )
          : cloneVector(responderEntity.position);
      scene.teleportDynamicEntityToPoint(
        responderEntity,
        parkedPosition,
        {
          direction: responderEntity.direction,
          refreshOwnerSession: false,
        },
      );
    }

    const orderResult = npcService.issueManualOrder(responderEntityID, {
      type: "stop",
    });
    if (orderResult && orderResult.success) {
      stoppedCount += 1;
    }
  }
  return stoppedCount;
}

function spawnConcordResponders(scene, offenderEntity, response) {
  if (!scene || !offenderEntity || !response) {
    return [];
  }

  const npcService = require(path.join(__dirname, "../../space/npc"));
  const responseOriginAnchor = buildConcordResponseOriginAnchor(
    scene,
    offenderEntity,
  );
  const spawnResult = npcService.spawnNpcBatchInSystem(scene.systemID, {
    amount: CONCORD_RESPONSE_AMOUNT,
    entityType: "concord",
    defaultPoolID: "concord_response_fleet",
    fallbackProfileID: "concord_response",
    anchorDescriptor: {
      kind: "coordinates",
      position: responseOriginAnchor.position,
      direction: responseOriginAnchor.direction,
      name: "Crimewatch CONCORD Response Origin",
    },
    preferredTargetID: offenderEntity.itemID,
    behaviorOverrides: {
      autoAggro: false,
      autoActivateWeapons: true,
      returnToHomeWhenIdle: false,
      leashRangeMeters: 0,
      allowPodKill: isCrimewatchConcordPodKillEnabled(),
    },
    transient: true,
    broadcast: false,
    spawnDistanceMeters: CONCORD_RESPONSE_WARP_ORIGIN_LOCAL_SPAWN_DISTANCE_METERS,
    spreadMeters: CONCORD_RESPONSE_WARP_ORIGIN_LOCAL_SPAWN_SPREAD_METERS,
  });
  if (
    !spawnResult.success ||
    !spawnResult.data ||
    !Array.isArray(spawnResult.data.spawned)
  ) {
    return [];
  }

  const totalSpawned = spawnResult.data.spawned.length;
  const responderEntityIDs = [];
  spawnResult.data.spawned.forEach((entry, index) => {
    const entity = entry && entry.entity;
    const entityID = toPositiveInt(entity && entity.itemID, 0);
    if (!entity || !entityID) {
      return;
    }

    const arrivalPoint = buildConcordArrivalPoint(
      offenderEntity,
      index,
      totalSpawned,
    );
    entity.visibilitySuppressedUntilMs =
      scene.getCurrentSimTimeMs() + CONCORD_RESPONSE_WARP_VISIBILITY_SUPPRESS_MS;
    scene.warpDynamicEntityToPoint(entity, arrivalPoint, {
      forceImmediateStart: true,
      targetEntityID: offenderEntity.itemID,
    });
    responderEntityIDs.push(entityID);
  });

  return responderEntityIDs;
}

function retaskResponders(scene, offenderEntityID, responderEntityIDs, options = {}) {
  if (
    !scene ||
    !offenderEntityID ||
    !Array.isArray(responderEntityIDs) ||
    responderEntityIDs.length === 0
  ) {
    return 0;
  }

  const npcService = require(path.join(__dirname, "../../space/npc"));
  const allowPodKill = options.allowPodKill === true;
  let retaskedCount = 0;
  for (const responderEntityID of responderEntityIDs) {
    const responderEntity = scene.getEntityByID(responderEntityID);
    if (!responderEntity) {
      continue;
    }
    const orderResult = npcService.issueManualOrder(responderEntityID, {
      type: "attack",
      targetID: offenderEntityID,
      allowWeapons: true,
      keepLock: true,
      allowPodKill,
    });
    if (orderResult && orderResult.success) {
      retaskedCount += 1;
    }
  }

  return retaskedCount;
}

function resolveCurrentOffenderEntity(scene, offenderCharacterID, fallbackEntityID = 0) {
  if (!scene) {
    return null;
  }

  const liveSession =
    offenderCharacterID > 0
      ? sessionRegistry.findSessionByCharacterID(offenderCharacterID)
      : null;
  if (
    liveSession &&
    liveSession._space &&
    toPositiveInt(liveSession._space.systemID, 0) === toPositiveInt(scene.systemID, 0)
  ) {
    const sessionEntity = scene.getEntityByID(
      toPositiveInt(liveSession._space.shipID, 0),
    );
    if (sessionEntity) {
      return sessionEntity;
    }
  }

  if (offenderCharacterID > 0) {
    for (const entity of scene.dynamicEntities.values()) {
      if (
        toPositiveInt(entity && entity.pilotCharacterID, 0) === offenderCharacterID ||
        getEntityCharacterID(entity) === offenderCharacterID
      ) {
        return entity;
      }
    }
  }

  return scene.getEntityByID(toPositiveInt(fallbackEntityID, 0));
}

function tickScene(scene, now = Date.now()) {
  if (!scene) {
    return;
  }

  pruneAllCharacterStates(now);
  synchronizeSceneClientState(scene, now);

  if (!isHighSecuritySystem(scene.system)) {
    return;
  }

  if (!isCrimewatchConcordResponseEnabled()) {
    const disabledResponseMap = systemConcordResponses.get(toPositiveInt(scene.systemID, 0)) || null;
    if (disabledResponseMap) {
      for (const response of disabledResponseMap.values()) {
        clearConcordResponders(scene, response && response.responderEntityIDs);
      }
    }
    systemConcordResponses.delete(toPositiveInt(scene.systemID, 0));
    pruneSystemResponseMap(scene.systemID);
    return;
  }

  const responseMap = systemConcordResponses.get(toPositiveInt(scene.systemID, 0)) || null;
  if (!responseMap || responseMap.size === 0) {
    pruneSystemResponseMap(scene.systemID);
    return;
  }

  for (const [offenderEntityID, response] of responseMap.entries()) {
    const allowConcordPodKill = isCrimewatchConcordPodKillEnabled();
    const offenderCharacterID = toPositiveInt(response && response.offenderCharacterID, 0);
    const criminalActive = offenderCharacterID > 0 && isCharacterCriminal(offenderCharacterID, now);
    if (!criminalActive) {
      clearConcordResponders(scene, response && response.responderEntityIDs);
      responseMap.delete(offenderEntityID);
      continue;
    }

    const offenderEntity = resolveCurrentOffenderEntity(
      scene,
      offenderCharacterID,
      offenderEntityID,
    );
    response.responderEntityIDs = getActiveResponderEntityIDs(scene, response);
    if (
      toFiniteNumber(response.respondedAtMs, 0) <= 0 &&
      toFiniteNumber(response.dueAtMs, 0) > now
    ) {
      continue;
    }

    if (!offenderEntity) {
      if (response.responderEntityIDs.length > 0) {
        stopResponders(scene, response.responderEntityIDs);
        if (allowConcordPodKill && response.capsuleTargeted === true) {
          if (toFiniteNumber(response.completionClearAtMs, 0) <= 0) {
            response.completionClearAtMs = now + CONCORD_RESPONSE_COMPLETION_CLEAR_MS;
          }
          if (toFiniteNumber(response.completionClearAtMs, 0) <= now) {
            clearConcordResponders(scene, response.responderEntityIDs);
            responseMap.delete(offenderEntityID);
            continue;
          }
        } else {
          response.completionClearAtMs = 0;
        }
      }
      response.nextRetaskAtMs = now + CONCORD_RESPONSE_RETASK_INTERVAL_MS;
      continue;
    }

    if (response.responderEntityIDs.length === 0) {
      response.responderEntityIDs = spawnConcordResponders(
        scene,
        offenderEntity,
        response,
      );
      if (response.responderEntityIDs.length === 0) {
        response.dueAtMs = now + 1_000;
        continue;
      }
      response.respondedAtMs = now;
      response.nextRetaskAtMs = 0;
    }

    if (toFiniteNumber(response.nextRetaskAtMs, 0) > now) {
      continue;
    }

    response.currentTargetEntityID = offenderEntity.itemID;
    response.completionClearAtMs = 0;
    if (isCapsuleEntity(offenderEntity)) {
      response.capsuleTargeted = true;
      if (!allowConcordPodKill) {
        stopResponders(scene, response.responderEntityIDs);
        response.nextRetaskAtMs = now + CONCORD_RESPONSE_RETASK_INTERVAL_MS;
        continue;
      }
    } else {
      response.capsuleTargeted = false;
    }

    retaskResponders(scene, offenderEntity.itemID, response.responderEntityIDs, {
      allowPodKill: allowConcordPodKill,
    });
    response.nextRetaskAtMs = now + CONCORD_RESPONSE_RETASK_INTERVAL_MS;
  }

  pruneSystemResponseMap(scene.systemID);
}

function isCriminallyFlagged(characterID, now = Date.now()) {
  return isCharacterCriminal(characterID, now);
}

function clearAllCrimewatchState() {
  characterCrimewatchState.clear();
  systemConcordResponses.clear();
  lastBroadcastTimerSnapshots.clear();
  lastBroadcastFlagSnapshots.clear();
  lastBroadcastDisapprovalSnapshots.clear();
  recentSecurityPenaltyTargets.clear();
}

module.exports = {
  SECURITY_STATUS_MIN,
  SECURITY_STATUS_MAX,
  SAFETY_LEVEL_NONE,
  SAFETY_LEVEL_PARTIAL,
  SAFETY_LEVEL_FULL,
  WEAPONS_TIMER_STATE_IDLE,
  WEAPONS_TIMER_STATE_TIMER,
  PVP_TIMER_STATE_IDLE,
  PVP_TIMER_STATE_TIMER,
  CRIMINAL_TIMER_STATE_IDLE,
  CRIMINAL_TIMER_STATE_TIMER_CRIMINAL,
  CRIMINAL_TIMER_STATE_TIMER_SUSPECT,
  NPC_TIMER_STATE_IDLE,
  NPC_TIMER_STATE_TIMER,
  DISAPPROVAL_TIMER_STATE_IDLE,
  DISAPPROVAL_TIMER_STATE_TIMER,
  WEAPON_TIMER_DURATION_MS,
  PVP_TIMER_DURATION_MS,
  NPC_TIMER_DURATION_MS,
  CRIMINAL_TIMER_DURATION_MS,
  DISAPPROVAL_TIMER_DURATION_MS,
  buildClientStatesForSession,
  clearAllCrimewatchState,
  getCharacterCrimewatchState,
  getCharacterSecurityStatus,
  getConcordResponseDelayMsForSystem,
  getSafetyLevel,
  isCrimewatchConcordPodKillEnabled,
  isCriminallyFlagged,
  recordHighSecCriminalAggression,
  scheduleConcordResponse,
  setCharacterSecurityStatus,
  setCharacterCrimewatchDebugState,
  setSafetyLevel,
  tickScene,
  triggerHighSecCriminalOffense,
};

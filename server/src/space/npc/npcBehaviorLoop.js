const path = require("path");

const {
  getFittedModuleItems,
  getLoadedChargeByFlag,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveWeaponFamily,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const {
  getControllerByEntityID,
  listControllersBySystem,
  unregisterController,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  normalizeTargetClassList,
  isCharacterInvulnerable,
} = require(path.join(__dirname, "./npcControlState"));

const CAPSULE_GROUP_ID = 29;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeOrderType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function distance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
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

function isDirectionChangeSignificant(left, right) {
  if (!left || !right) {
    return true;
  }

  const leftLength = Math.sqrt((left.x ** 2) + (left.y ** 2) + (left.z ** 2));
  const rightLength = Math.sqrt((right.x ** 2) + (right.y ** 2) + (right.z ** 2));
  if (leftLength <= 0 || rightLength <= 0) {
    return true;
  }

  const dot = (
    ((left.x * right.x) + (left.y * right.y) + (left.z * right.z)) /
    (leftLength * rightLength)
  );
  return dot < 0.995;
}

function getSurfaceDistance(left, right) {
  return Math.max(
    0,
    distance(left && left.position, right && right.position) -
      toFiniteNumber(left && left.radius, 0) -
      toFiniteNumber(right && right.radius, 0),
  );
}

function buildNpcPseudoSession(entity) {
  const pilotCharacterID = toPositiveInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
  return {
    characterID: pilotCharacterID,
    corporationID: toPositiveInt(entity && entity.corporationID, 0),
    allianceID: toPositiveInt(entity && entity.allianceID, 0),
    _space: {
      systemID: toPositiveInt(entity && entity.systemID, 0),
      shipID: toPositiveInt(entity && entity.itemID, 0),
    },
  };
}

function resolveCombatActorClass(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.session &&
    toPositiveInt(entity.session.characterID, 0) > 0
  ) {
    return "player";
  }

  const npcEntityType = String(entity.npcEntityType || "").trim().toLowerCase();
  if (npcEntityType === "concord") {
    return "concord";
  }
  if (npcEntityType === "npc") {
    return "npc";
  }

  return null;
}

function getEntityCharacterID(entity) {
  if (!entity || entity.kind !== "ship") {
    return 0;
  }

  return toPositiveInt(
    entity.session && entity.session.characterID
      ? entity.session.characterID
      : entity.pilotCharacterID ?? entity.characterID,
    0,
  );
}

function isPlayerShip(entity) {
  return resolveCombatActorClass(entity) === "player";
}

function isIgnoredInvulnerablePlayer(target) {
  if (resolveCombatActorClass(target) !== "player") {
    return false;
  }

  return isCharacterInvulnerable(getEntityCharacterID(target));
}

function isFriendlyCombatTarget(entity, target) {
  const sourceClass = resolveCombatActorClass(entity);
  const targetClass = resolveCombatActorClass(target);
  if (!sourceClass || !targetClass) {
    return false;
  }

  if (sourceClass === "concord") {
    return targetClass === "concord";
  }
  if (sourceClass === "npc") {
    return targetClass === "npc";
  }

  return false;
}

function resolveAutoAggroTargetClasses(behaviorProfile) {
  const explicitClasses = normalizeTargetClassList(
    behaviorProfile && behaviorProfile.autoAggroTargetClasses,
  );
  if (
    explicitClasses.length > 0 ||
    (
      behaviorProfile &&
      Object.prototype.hasOwnProperty.call(behaviorProfile, "autoAggroTargetClasses")
    )
  ) {
    return explicitClasses;
  }

  const targetPreference = String(
    behaviorProfile && behaviorProfile.targetPreference || "preferredTargetThenNearestPlayer",
  )
    .trim()
    .toLowerCase();
  switch (targetPreference) {
    case "none":
    case "preferredtargetonly":
      return [];
    case "nearestnpc":
    case "preferredtargetthennearestnpc":
    case "preferredtargetthennearestrat":
      return ["npc"];
    case "preferredtargetthennearestnonconcord":
      return ["player", "npc"];
    case "nearesteligible":
    case "preferredtargetthennearesteligible":
      return ["player", "npc", "concord"];
    case "nearestplayer":
    case "preferredtargetthennearestplayer":
    default:
      return ["player"];
  }
}

function normalizeBehaviorOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    return {};
  }

  const normalized = {};
  const booleanFields = [
    "autoAggro",
    "autoActivateWeapons",
    "returnToHomeWhenIdle",
    "allowPodKill",
    "idleAnchorOrbit",
  ];
  for (const field of booleanFields) {
    if (overrides[field] !== undefined) {
      normalized[field] = overrides[field] === true;
    }
  }

  const numericFields = [
    "thinkIntervalMs",
    "orbitDistanceMeters",
    "followRangeMeters",
    "aggressionRangeMeters",
    "leashRangeMeters",
    "homeArrivalMeters",
    "idleAnchorOrbitDistanceMeters",
  ];
  for (const field of numericFields) {
    if (overrides[field] !== undefined) {
      normalized[field] = Math.max(0, toFiniteNumber(overrides[field], 0));
    }
  }

  if (overrides.movementMode !== undefined) {
    normalized.movementMode = String(overrides.movementMode || "").trim().toLowerCase() || "orbit";
  }
  if (overrides.targetPreference !== undefined) {
    normalized.targetPreference =
      String(overrides.targetPreference || "").trim() ||
      "preferredTargetThenNearestPlayer";
  }
  if (overrides.autoAggroTargetClasses !== undefined) {
    normalized.autoAggroTargetClasses = normalizeTargetClassList(
      overrides.autoAggroTargetClasses,
    );
  }

  return normalized;
}

function resolveEffectiveBehaviorProfile(controller) {
  return {
    ...(controller && controller.behaviorProfile ? controller.behaviorProfile : {}),
    ...normalizeBehaviorOverrides(controller && controller.behaviorOverrides),
  };
}

function isCapsuleEntity(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    toPositiveInt(entity.groupID, 0) === CAPSULE_GROUP_ID,
  );
}

function isValidCombatTarget(entity, target, options = {}) {
  return Boolean(
    entity &&
    target &&
    target.kind === "ship" &&
    target.itemID !== entity.itemID &&
    !isFriendlyCombatTarget(entity, target) &&
    !isIgnoredInvulnerablePlayer(target) &&
    (
      options.allowPodKill === true ||
      !isCapsuleEntity(target)
    ),
  );
}

function findNearestCombatTarget(scene, entity, maxRangeMeters, options = {}) {
  const maxRange = Math.max(0, toFiniteNumber(maxRangeMeters, 0));
  const allowedTargetClasses = normalizeTargetClassList(
    options.allowedTargetClasses,
  );
  if (allowedTargetClasses.length === 0) {
    return null;
  }

  let bestTarget = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of scene.dynamicEntities.values()) {
    if (
      !allowedTargetClasses.includes(resolveCombatActorClass(candidate)) ||
      !isValidCombatTarget(entity, candidate, options)
    ) {
      continue;
    }
    if (entity.bubbleID && candidate.bubbleID && entity.bubbleID !== candidate.bubbleID) {
      continue;
    }

    const candidateDistance = getSurfaceDistance(entity, candidate);
    if (maxRange > 0 && candidateDistance > maxRange) {
      continue;
    }
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function normalizeManualOrder(order) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const normalizedType = normalizeOrderType(order.type);
  if (!normalizedType || normalizedType === "resume" || normalizedType === "resumebehavior") {
    return null;
  }

  const mappedType = {
    attack: "attack",
    orbit: "orbit",
    follow: "follow",
    holdfire: "holdFire",
    stop: "stop",
    returnhome: "returnHome",
  }[normalizedType] || String(order.type || "");

  return {
    ...order,
    type: mappedType,
    targetID: toPositiveInt(order.targetID, 0),
    movementMode: String(order.movementMode || "").trim().toLowerCase() || null,
    orbitDistanceMeters: Math.max(0, toFiniteNumber(order.orbitDistanceMeters, 0)),
    followRangeMeters: Math.max(0, toFiniteNumber(order.followRangeMeters, 0)),
    allowWeapons:
      order.allowWeapons === undefined ? null : order.allowWeapons === true,
    keepLock:
      order.keepLock === undefined ? null : order.keepLock === true,
    allowPodKill:
      order.allowPodKill === undefined ? null : order.allowPodKill === true,
  };
}

function resolveBehaviorTarget(scene, controller, entity, behaviorProfile) {
  const allowPodKill = behaviorProfile.allowPodKill === true;
  const aggressionRangeMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.aggressionRangeMeters, 0),
  );
  const preferredTarget = scene.getEntityByID(toPositiveInt(controller.preferredTargetID, 0));
  if (
    isValidCombatTarget(entity, preferredTarget, { allowPodKill }) &&
    (
      aggressionRangeMeters <= 0 ||
      getSurfaceDistance(entity, preferredTarget) <= aggressionRangeMeters
    )
  ) {
    return preferredTarget;
  }

  if (behaviorProfile.autoAggro === false) {
    return null;
  }

  const autoAggroTargetClasses = resolveAutoAggroTargetClasses(behaviorProfile);
  if (autoAggroTargetClasses.length === 0) {
    return null;
  }

  return findNearestCombatTarget(scene, entity, aggressionRangeMeters, {
    allowPodKill,
    allowedTargetClasses: autoAggroTargetClasses,
  });
}

function resolveDesiredTarget(scene, controller, entity, behaviorProfile, manualOrder) {
  const allowPodKill =
    manualOrder && manualOrder.allowPodKill !== null
      ? manualOrder.allowPodKill === true
      : behaviorProfile.allowPodKill === true;
  if (
    manualOrder &&
    (
      manualOrder.type === "attack" ||
      manualOrder.type === "orbit" ||
      manualOrder.type === "follow"
    ) &&
    manualOrder.targetID > 0
  ) {
    const manualTarget = scene.getEntityByID(manualOrder.targetID);
    return isValidCombatTarget(entity, manualTarget, { allowPodKill }) ? manualTarget : null;
  }

  if (manualOrder && manualOrder.type === "stop") {
    return null;
  }
  if (manualOrder && manualOrder.type === "returnHome") {
    return null;
  }

  if (manualOrder && manualOrder.type === "holdFire" && manualOrder.targetID > 0) {
    const manualTarget = scene.getEntityByID(manualOrder.targetID);
    return isValidCombatTarget(entity, manualTarget, { allowPodKill }) ? manualTarget : null;
  }

  return resolveBehaviorTarget(scene, controller, entity, behaviorProfile);
}

function deactivateNpcWeapons(scene, entity) {
  const pseudoSession = buildNpcPseudoSession(entity);
  for (const effectState of [...(entity.activeModuleEffects || new Map()).values()]) {
    scene.deactivateGenericModule(pseudoSession, effectState.moduleID, {
      reason: "npc",
      deferUntilCycle: false,
    });
  }
}

function clearNpcTargetLocks(scene, entity) {
  scene.clearTargets(buildNpcPseudoSession(entity), {
    notifySelf: false,
    notifyTarget: true,
  });
}

function stopNpcMovement(scene, entity) {
  if (entity.mode !== "STOP" || toFiniteNumber(entity.speedFraction, 0) > 0) {
    scene.stop(buildNpcPseudoSession(entity));
  }
}

function clearNpcCombatState(scene, entity, controller, options = {}) {
  if (options.deactivateWeapons !== false) {
    deactivateNpcWeapons(scene, entity);
  }
  if (options.clearTargets !== false) {
    clearNpcTargetLocks(scene, entity);
  }
  if (options.stopShip !== false) {
    stopNpcMovement(scene, entity);
  }
  controller.currentTargetID = 0;
  controller.returningHome = false;
}

function resolveMovementDirective(manualOrder, behaviorProfile) {
  const manualMovementMode = manualOrder && manualOrder.movementMode
    ? manualOrder.movementMode
    : null;
  const typeDrivenMode =
    manualOrder && manualOrder.type === "follow"
      ? "follow"
      : manualOrder && manualOrder.type === "orbit"
        ? "orbit"
        : null;
  return {
    movementMode: String(
      manualMovementMode ||
        typeDrivenMode ||
        behaviorProfile.movementMode ||
        "orbit"
    ).trim().toLowerCase(),
    orbitDistanceMeters: Math.max(
      0,
      toFiniteNumber(
        manualOrder && manualOrder.orbitDistanceMeters > 0
          ? manualOrder.orbitDistanceMeters
          : behaviorProfile.orbitDistanceMeters,
        0,
      ),
    ),
    followRangeMeters: Math.max(
      0,
      toFiniteNumber(
        manualOrder && manualOrder.followRangeMeters > 0
          ? manualOrder.followRangeMeters
          : behaviorProfile.followRangeMeters,
        0,
      ),
    ),
  };
}

function syncNpcMovement(scene, entity, target, movementDirective) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const movementMode = String(movementDirective && movementDirective.movementMode || "orbit");
  if (movementMode === "follow") {
    const followRangeMeters = Math.max(
      0,
      toFiniteNumber(movementDirective && movementDirective.followRangeMeters, 0),
    );
    if (
      entity.mode !== "FOLLOW" ||
      toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(target.itemID, 0) ||
      Math.abs(toFiniteNumber(entity.followRange, 0) - followRangeMeters) > 1
    ) {
      scene.followBall(pseudoSession, target.itemID, followRangeMeters);
    }
    return;
  }

  const orbitDistanceMeters = Math.max(
    0,
    toFiniteNumber(movementDirective && movementDirective.orbitDistanceMeters, 0),
  );
  if (
    entity.mode !== "ORBIT" ||
    toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(target.itemID, 0) ||
    Math.abs(toFiniteNumber(entity.orbitDistance, 0) - orbitDistanceMeters) > 1
  ) {
    scene.orbit(pseudoSession, target.itemID, orbitDistanceMeters);
  }
}

function getNpcWeaponModules(entity) {
  const characterID = toPositiveInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
  const shipID = toPositiveInt(entity && entity.itemID, 0);
  if (!characterID || !shipID) {
    return [];
  }

  return getFittedModuleItems(characterID, shipID)
    .filter((moduleItem) => {
      const chargeItem = getLoadedChargeByFlag(characterID, shipID, moduleItem.flagID);
      return resolveWeaponFamily(moduleItem, chargeItem) === "laserTurret";
    })
    .sort((left, right) => toPositiveInt(left.flagID, 0) - toPositiveInt(right.flagID, 0));
}

function syncNpcWeapons(scene, entity, target) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const modules = getNpcWeaponModules(entity);
  for (const moduleItem of modules) {
    const activeEffect = entity.activeModuleEffects instanceof Map
      ? entity.activeModuleEffects.get(toPositiveInt(moduleItem.itemID, 0)) || null
      : null;
    if (
      activeEffect &&
      toPositiveInt(activeEffect.targetID, 0) !== toPositiveInt(target.itemID, 0)
    ) {
      scene.deactivateGenericModule(pseudoSession, moduleItem.itemID, {
        reason: "npc",
        deferUntilCycle: false,
      });
      continue;
    }
    if (activeEffect) {
      continue;
    }

    scene.activateGenericModule(
      pseudoSession,
      moduleItem,
      null,
      {
        targetID: target.itemID,
      },
    );
  }
}

function syncNpcReturnHome(scene, entity, controller, behaviorProfile, now) {
  const pseudoSession = buildNpcPseudoSession(entity);
  const homePosition = controller && controller.homePosition;
  if (!homePosition || behaviorProfile.returnToHomeWhenIdle === false) {
    controller.returningHome = false;
    stopNpcMovement(scene, entity);
    return;
  }

  const arrivalMeters = Math.max(
    250,
    toFiniteNumber(behaviorProfile.homeArrivalMeters, 1500),
  );
  const distanceToHome = distance(entity.position, homePosition);
  if (distanceToHome <= arrivalMeters) {
    controller.returningHome = false;
    stopNpcMovement(scene, entity);
    return;
  }

  const homeDirection = normalizeVector(
    subtractVectors(homePosition, entity.position),
    entity.direction || controller.homeDirection || { x: 1, y: 0, z: 0 },
  );
  const shouldRefreshCommand =
    entity.mode !== "GOTO" ||
    toFiniteNumber(controller.lastHomeCommandAtMs, 0) + 1_000 <= now ||
    isDirectionChangeSignificant(controller.lastHomeDirection || null, homeDirection);

  controller.returningHome = true;
  if (!shouldRefreshCommand) {
    return;
  }

  scene.gotoDirection(pseudoSession, homeDirection);
  controller.lastHomeCommandAtMs = now;
  controller.lastHomeDirection = homeDirection;
}

function resolveIdleAnchorEntity(scene, controller, entity) {
  const anchorID = toPositiveInt(controller && controller.anchorID, 0);
  if (!scene || !anchorID || anchorID === toPositiveInt(entity && entity.itemID, 0)) {
    return null;
  }

  return scene.getEntityByID(anchorID);
}

function resolveIdleAnchorOrbitDistance(entity, controller, anchorEntity, behaviorProfile) {
  const explicitDistance = Math.max(
    0,
    toFiniteNumber(behaviorProfile && behaviorProfile.idleAnchorOrbitDistanceMeters, 0),
  );
  if (explicitDistance > 0) {
    return explicitDistance;
  }

  const homePosition = controller && controller.homePosition;
  if (homePosition && anchorEntity && anchorEntity.position) {
    const derivedSurfaceDistance = Math.max(
      0,
      distance(homePosition, anchorEntity.position) -
        toFiniteNumber(entity && entity.radius, 0) -
        toFiniteNumber(anchorEntity && anchorEntity.radius, 0),
    );
    if (derivedSurfaceDistance > 0) {
      return derivedSurfaceDistance;
    }
  }

  return Math.max(
    2_500,
    toFiniteNumber(behaviorProfile && behaviorProfile.orbitDistanceMeters, 0),
  );
}

function syncNpcIdleAnchorOrbit(scene, entity, controller, behaviorProfile) {
  if (behaviorProfile.idleAnchorOrbit !== true) {
    return false;
  }

  const anchorEntity = resolveIdleAnchorEntity(scene, controller, entity);
  if (!anchorEntity) {
    return false;
  }

  const orbitDistanceMeters = resolveIdleAnchorOrbitDistance(
    entity,
    controller,
    anchorEntity,
    behaviorProfile,
  );
  if (orbitDistanceMeters <= 0) {
    return false;
  }

  if (
    entity.mode !== "ORBIT" ||
    toPositiveInt(entity.targetEntityID, 0) !== toPositiveInt(anchorEntity.itemID, 0) ||
    Math.abs(toFiniteNumber(entity.orbitDistance, 0) - orbitDistanceMeters) > 1
  ) {
    scene.orbit(
      buildNpcPseudoSession(entity),
      anchorEntity.itemID,
      orbitDistanceMeters,
    );
  }

  controller.returningHome = false;
  return true;
}

function isBeyondLeash(entity, controller, behaviorProfile) {
  const leashRangeMeters = Math.max(
    0,
    toFiniteNumber(behaviorProfile.leashRangeMeters, 0),
  );
  if (leashRangeMeters <= 0) {
    return false;
  }

  if (controller && controller.homePosition) {
    return distance(entity.position, controller.homePosition) > leashRangeMeters;
  }

  return false;
}

function shouldMaintainLock(manualOrder) {
  if (!manualOrder) {
    return true;
  }
  if (manualOrder.keepLock !== null) {
    return manualOrder.keepLock === true;
  }

  return (
    manualOrder.type === "attack" ||
    manualOrder.type === "holdFire"
  );
}

function shouldAllowWeapons(manualOrder, behaviorProfile) {
  if (manualOrder && manualOrder.allowWeapons !== null) {
    return manualOrder.allowWeapons === true;
  }
  if (manualOrder && manualOrder.type === "holdFire") {
    return false;
  }
  if (manualOrder && (manualOrder.type === "orbit" || manualOrder.type === "follow")) {
    return false;
  }
  return behaviorProfile.autoActivateWeapons !== false;
}

function scheduleNextThink(controller, behaviorProfile, now, forcedAtMs = null) {
  const defaultNextThinkAtMs =
    now + Math.max(50, toFiniteNumber(behaviorProfile.thinkIntervalMs, 250));
  const normalizedForcedAtMs = toFiniteNumber(forcedAtMs, 0);
  controller.nextThinkAtMs =
    normalizedForcedAtMs > now
      ? Math.min(defaultNextThinkAtMs, normalizedForcedAtMs)
      : defaultNextThinkAtMs;
}

function tickController(scene, controller, now) {
  const entity = scene.getEntityByID(controller.entityID);
  if (!entity || entity.kind !== "ship") {
    unregisterController(controller.entityID);
    return;
  }

  const behaviorProfile = resolveEffectiveBehaviorProfile(controller);
  const manualOrder = normalizeManualOrder(controller.manualOrder);
  if (!manualOrder && controller.manualOrder) {
    controller.manualOrder = null;
  }

  if (manualOrder && manualOrder.type === "stop") {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: true,
    });
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  if (manualOrder && manualOrder.type === "returnHome") {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: false,
    });
    syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  const desiredTarget = resolveDesiredTarget(
    scene,
    controller,
    entity,
    behaviorProfile,
    manualOrder,
  );
  if (!desiredTarget) {
    const targetOnlyManualOrder = Boolean(
      manualOrder &&
      manualOrder.targetID > 0 &&
      (
        manualOrder.type === "attack" ||
        manualOrder.type === "orbit" ||
        manualOrder.type === "follow"
      ),
    );
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: targetOnlyManualOrder,
    });
    if (!targetOnlyManualOrder) {
      const handledIdleAnchorOrbit = syncNpcIdleAnchorOrbit(
        scene,
        entity,
        controller,
        behaviorProfile,
      );
      if (!handledIdleAnchorOrbit) {
        syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
      }
    }
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  if (isBeyondLeash(entity, controller, behaviorProfile)) {
    clearNpcCombatState(scene, entity, controller, {
      deactivateWeapons: true,
      clearTargets: true,
      stopShip: false,
    });
    syncNpcReturnHome(scene, entity, controller, behaviorProfile, now);
    scheduleNextThink(controller, behaviorProfile, now);
    return;
  }

  const movementDirective = resolveMovementDirective(manualOrder, behaviorProfile);
  const maintainLock = shouldMaintainLock(manualOrder);
  const allowWeapons = shouldAllowWeapons(manualOrder, behaviorProfile);
  let nextThinkOverrideMs = null;

  controller.currentTargetID = toPositiveInt(desiredTarget.itemID, 0);
  controller.returningHome = false;
  syncNpcMovement(scene, entity, desiredTarget, movementDirective);

  if (maintainLock) {
    scene.validateEntityTargetLocks(entity, now);
  }

  const lockedTargets = scene.getTargetsForEntity(entity);
  const pendingTargetLocks = scene.getSortedPendingTargetLocks(entity);
  const hasDesiredLock = lockedTargets.includes(desiredTarget.itemID);
  const hasPendingDesiredLock = pendingTargetLocks.some(
    (pendingLock) => toPositiveInt(pendingLock && pendingLock.targetID, 0) === desiredTarget.itemID,
  );

  if (maintainLock) {
    if (!hasDesiredLock && !hasPendingDesiredLock) {
      scene.addTarget(buildNpcPseudoSession(entity), desiredTarget.itemID);
      const pendingLock = scene.getSortedPendingTargetLocks(entity).find(
        (entry) => toPositiveInt(entry && entry.targetID, 0) === desiredTarget.itemID,
      );
      if (pendingLock) {
        nextThinkOverrideMs = toFiniteNumber(pendingLock.completeAtMs, null);
      }
    }
  } else if (lockedTargets.length > 0 || pendingTargetLocks.length > 0) {
    clearNpcTargetLocks(scene, entity);
  }

  if (nextThinkOverrideMs === null && hasPendingDesiredLock) {
    const pendingLock = pendingTargetLocks.find(
      (entry) => toPositiveInt(entry && entry.targetID, 0) === desiredTarget.itemID,
    );
    if (pendingLock) {
      nextThinkOverrideMs = toFiniteNumber(pendingLock.completeAtMs, null);
    }
  }

  if (maintainLock && allowWeapons && hasDesiredLock) {
    syncNpcWeapons(scene, entity, desiredTarget);
  } else {
    deactivateNpcWeapons(scene, entity);
  }

  scheduleNextThink(controller, behaviorProfile, now, nextThinkOverrideMs);
}

function tickScene(scene, now) {
  if (!scene) {
    return;
  }

  for (const controller of listControllersBySystem(scene.systemID)) {
    if (toFiniteNumber(controller.nextThinkAtMs, 0) > now) {
      continue;
    }
    tickController(scene, controller, now);
  }
}

function issueManualOrder(entityID, order) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  controller.manualOrder = normalizeManualOrder(order);
  controller.nextThinkAtMs = 0;
  return {
    success: true,
    data: controller,
  };
}

function setBehaviorOverrides(entityID, overrides) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  controller.behaviorOverrides = normalizeBehaviorOverrides(overrides);
  controller.nextThinkAtMs = 0;
  return {
    success: true,
    data: controller,
  };
}

function noteIncomingAggression(entityID, attackerEntityID, now = Date.now()) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedAttackerEntityID = toPositiveInt(attackerEntityID, 0);
  if (!normalizedAttackerEntityID) {
    return {
      success: false,
      errorMsg: "ATTACKER_NOT_FOUND",
    };
  }

  controller.preferredTargetID = normalizedAttackerEntityID;
  controller.lastAggressorID = normalizedAttackerEntityID;
  controller.lastAggressedAtMs = toFiniteNumber(now, Date.now());
  controller.nextThinkAtMs = Math.min(
    toFiniteNumber(controller.nextThinkAtMs, controller.lastAggressedAtMs),
    controller.lastAggressedAtMs,
  );
  return {
    success: true,
    data: controller,
  };
}

module.exports = {
  normalizeBehaviorOverrides,
  tickScene,
  issueManualOrder,
  setBehaviorOverrides,
  noteIncomingAggression,
};

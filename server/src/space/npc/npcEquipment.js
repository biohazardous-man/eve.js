const path = require("path");

const {
  getFittedModuleItems,
  getLoadedChargeByFlag,
  getAttributeIDByNames,
  getTypeAttributeMap,
  typeHasEffectName,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  isMissileWeaponFamily,
  isTurretWeaponFamily,
  resolveWeaponFamily,
  buildWeaponModuleSnapshot,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  resolveNpcPropulsionEffectName: resolveNpcCapabilityPropulsionEffectName,
  NPC_ENABLE_FITTED_PROPULSION_MODULES,
} = require(path.join(__dirname, "./npcCapabilityResolver"));

const PROPULSION_EFFECT_AFTERBURNER = "moduleBonusAfterburner";
const PROPULSION_EFFECT_MICROWARPDRIVE = "moduleBonusMicrowarpdrive";
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER =
  getAttributeIDByNames("missileDamageMultiplier") || 212;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_EXPLOSION_DELAY = getAttributeIDByNames("explosionDelay") || 281;
const ATTRIBUTE_AOE_VELOCITY = getAttributeIDByNames("aoeVelocity") || 653;
const ATTRIBUTE_AOE_CLOUD_SIZE = getAttributeIDByNames("aoeCloudSize") || 654;
const ATTRIBUTE_AOE_DAMAGE_REDUCTION_FACTOR =
  getAttributeIDByNames("aoeDamageReductionFactor") || 1353;
const ATTRIBUTE_AOE_DAMAGE_REDUCTION_SENSITIVITY =
  getAttributeIDByNames("aoeDamageReductionSensitivity") || 1354;
const ATTRIBUTE_ENTITY_MISSILE_TYPE_ID =
  getAttributeIDByNames("entityMissileTypeID") || 507;
const ATTRIBUTE_MISSILE_ENTITY_VELOCITY_MULTIPLIER =
  getAttributeIDByNames("missileEntityVelocityMultiplier") || 645;
const ATTRIBUTE_MISSILE_ENTITY_FLIGHT_TIME_MULTIPLIER =
  getAttributeIDByNames("missileEntityFlightTimeMultiplier") || 646;
const ATTRIBUTE_MISSILE_ENTITY_AOE_VELOCITY_MULTIPLIER =
  getAttributeIDByNames("missileEntityAoeVelocityMultiplier") || 647;
const ATTRIBUTE_MISSILE_ENTITY_AOE_CLOUD_SIZE_MULTIPLIER =
  getAttributeIDByNames("missileEntityAoeCloudSizeMultiplier") || 648;
const DEFAULT_MISSILE_DAMAGE_REDUCTION_SENSITIVITY = 5.5;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function isNativeNpcEntity(entity) {
  return Boolean(
    entity &&
    entity.kind === "ship" &&
    entity.nativeNpc === true,
  );
}

function getNpcShipID(entity) {
  return toPositiveInt(entity && entity.itemID, 0);
}

function getNpcPilotCharacterID(entity) {
  return toPositiveInt(
    entity && (
      entity.pilotCharacterID ??
      entity.characterID
    ),
    0,
  );
}

function getNativeNpcFittedModuleItems(entity) {
  if (Array.isArray(entity && entity.fittedItems)) {
    return entity.fittedItems.map((moduleItem) => ({ ...moduleItem }));
  }
  const entityID = getNpcShipID(entity);
  if (!entityID) {
    return [];
  }
  return nativeNpcStore.buildNativeFittedItems(entityID);
}

function getNativeNpcCargoItems(entity) {
  if (Array.isArray(entity && entity.nativeCargoItems)) {
    return entity.nativeCargoItems.map((cargoItem) => ({
      ...cargoItem,
      moduleState:
        cargoItem && cargoItem.moduleState && typeof cargoItem.moduleState === "object"
          ? { ...cargoItem.moduleState }
          : cargoItem && cargoItem.moduleState ? cargoItem.moduleState : null,
    }));
  }
  const entityID = getNpcShipID(entity);
  if (!entityID) {
    return [];
  }
  return nativeNpcStore.buildNativeCargoItems(entityID);
}

function getNpcFittedModuleItems(entity) {
  if (isNativeNpcEntity(entity)) {
    return getNativeNpcFittedModuleItems(entity);
  }

  const characterID = getNpcPilotCharacterID(entity);
  const shipID = getNpcShipID(entity);
  if (!characterID || !shipID) {
    return [];
  }

  return getFittedModuleItems(characterID, shipID);
}

function getNpcLoadedChargeForModule(entity, moduleItem) {
  const shipID = getNpcShipID(entity);
  const moduleID = toPositiveInt(moduleItem && moduleItem.itemID, 0);
  const flagID = toPositiveInt(moduleItem && moduleItem.flagID, 0);
  if (!shipID || !moduleID || !flagID) {
    return null;
  }

  if (isNativeNpcEntity(entity)) {
    const cargoItem = getNativeNpcCargoItems(entity).find(
      (entry) => toPositiveInt(entry && entry.moduleID, 0) === moduleID,
    ) || null;
    if (!cargoItem) {
      return null;
    }
    return {
      ...cargoItem,
      flagID,
    };
  }

  const characterID = getNpcPilotCharacterID(entity);
  if (!characterID) {
    return null;
  }
  return getLoadedChargeByFlag(characterID, shipID, flagID);
}

function getNpcWeaponModules(entity) {
  return getNpcFittedModuleItems(entity)
    .filter((moduleItem) => {
      const chargeItem = getNpcLoadedChargeForModule(entity, moduleItem);
      const family = resolveWeaponFamily(moduleItem, chargeItem);
      return (
        isTurretWeaponFamily(family) ||
        isMissileWeaponFamily(family)
      );
    })
    .sort((left, right) => toPositiveInt(left.flagID, 0) - toPositiveInt(right.flagID, 0));
}

function buildNpcWeaponModuleSnapshot(entity, moduleItem) {
  if (!entity || !moduleItem) {
    return null;
  }

  const shipID = getNpcShipID(entity);
  const shipTypeID = toPositiveInt(entity && entity.typeID, 0);
  if (!shipID || !shipTypeID) {
    return null;
  }

  return buildWeaponModuleSnapshot({
    characterID: getNpcPilotCharacterID(entity),
    shipItem: {
      itemID: shipID,
      typeID: shipTypeID,
    },
    moduleItem,
    chargeItem: getNpcLoadedChargeForModule(entity, moduleItem),
    fittedItems: getNpcFittedModuleItems(entity),
    activeModuleContexts: [],
  });
}

function estimateNpcWeaponEffectiveRange(entity, moduleItem) {
  const snapshot = buildNpcWeaponModuleSnapshot(entity, moduleItem);
  if (!snapshot) {
    return 0;
  }
  if (isMissileWeaponFamily(snapshot.family)) {
    return Math.max(0, round6(toFiniteNumber(snapshot.approxRange, 0)));
  }
  return Math.max(
    0,
    round6(
      toFiniteNumber(snapshot.optimalRange, 0) +
      toFiniteNumber(snapshot.falloff, 0),
    ),
  );
}

function getNpcEntityMissileWeaponSource(entity) {
  const shipTypeID = toPositiveInt(entity && entity.typeID, 0);
  if (
    !entity ||
    entity.kind !== "ship" ||
    shipTypeID <= 0 ||
    !typeHasEffectName(shipTypeID, "missileLaunchingForEntity")
  ) {
    return null;
  }

  const shipAttributes = getTypeAttributeMap(shipTypeID);
  const missileTypeID = toPositiveInt(
    shipAttributes && shipAttributes[ATTRIBUTE_ENTITY_MISSILE_TYPE_ID],
    0,
  );
  if (missileTypeID <= 0) {
    return null;
  }

  const missileType = resolveItemByTypeID(missileTypeID);
  const missileAttributes = getTypeAttributeMap(missileTypeID);
  const damageMultiplier = Math.max(
    0,
    toFiniteNumber(shipAttributes[ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER], 1),
  );
  const velocityMultiplier = Math.max(
    0,
    toFiniteNumber(shipAttributes[ATTRIBUTE_MISSILE_ENTITY_VELOCITY_MULTIPLIER], 1),
  );
  const flightTimeMultiplier = Math.max(
    0,
    toFiniteNumber(shipAttributes[ATTRIBUTE_MISSILE_ENTITY_FLIGHT_TIME_MULTIPLIER], 1),
  );
  const aoeVelocityMultiplier = Math.max(
    0,
    toFiniteNumber(shipAttributes[ATTRIBUTE_MISSILE_ENTITY_AOE_VELOCITY_MULTIPLIER], 1),
  );
  const aoeCloudSizeMultiplier = Math.max(
    0,
    toFiniteNumber(shipAttributes[ATTRIBUTE_MISSILE_ENTITY_AOE_CLOUD_SIZE_MULTIPLIER], 1),
  );
  const baseDamage = {
    em: Math.max(0, toFiniteNumber(missileAttributes[ATTRIBUTE_EM_DAMAGE], 0)),
    thermal: Math.max(0, toFiniteNumber(missileAttributes[ATTRIBUTE_THERMAL_DAMAGE], 0)),
    kinetic: Math.max(0, toFiniteNumber(missileAttributes[ATTRIBUTE_KINETIC_DAMAGE], 0)),
    explosive: Math.max(0, toFiniteNumber(missileAttributes[ATTRIBUTE_EXPLOSIVE_DAMAGE], 0)),
  };
  const maxVelocity = Math.max(
    0,
    round6(toFiniteNumber(missileAttributes[ATTRIBUTE_MAX_VELOCITY], 0) * velocityMultiplier),
  );
  const flightTimeMs = Math.max(
    1,
    round6(
      toFiniteNumber(missileAttributes[ATTRIBUTE_EXPLOSION_DELAY], 1000) * flightTimeMultiplier,
    ),
  );

  return {
    family: "missileLauncher",
    sourceKind: "npcEntityMissile",
    moduleID: 0,
    moduleTypeID: 0,
    chargeTypeID: missileTypeID,
    chargeGroupID: toPositiveInt(missileType && missileType.groupID, 0),
    chargeCategoryID: toPositiveInt(missileType && missileType.categoryID, 8),
    chargeName: String(missileType && missileType.name || "Missile"),
    durationMs: Math.max(1, round6(toFiniteNumber(shipAttributes[ATTRIBUTE_SPEED], 1000))),
    damageMultiplier,
    rawShotDamage: {
      em: round6(baseDamage.em * damageMultiplier),
      thermal: round6(baseDamage.thermal * damageMultiplier),
      kinetic: round6(baseDamage.kinetic * damageMultiplier),
      explosive: round6(baseDamage.explosive * damageMultiplier),
    },
    maxVelocity,
    flightTimeMs,
    explosionRadius: Math.max(
      1,
      round6(toFiniteNumber(missileAttributes[ATTRIBUTE_AOE_CLOUD_SIZE], 1) * aoeCloudSizeMultiplier),
    ),
    explosionVelocity: Math.max(
      0.001,
      round6(toFiniteNumber(missileAttributes[ATTRIBUTE_AOE_VELOCITY], 0.001) * aoeVelocityMultiplier),
    ),
    damageReductionFactor: Math.max(
      0.000001,
      Math.min(1, toFiniteNumber(missileAttributes[ATTRIBUTE_AOE_DAMAGE_REDUCTION_FACTOR], 1)),
    ),
    damageReductionSensitivity: Math.max(
      0.000001,
      round6(toFiniteNumber(
        missileAttributes[ATTRIBUTE_AOE_DAMAGE_REDUCTION_SENSITIVITY],
        DEFAULT_MISSILE_DAMAGE_REDUCTION_SENSITIVITY,
      )),
    ),
    approxRange: round6(maxVelocity * (flightTimeMs / 1000)),
    launchModules: [0],
  };
}

function resolveNpcPropulsionEffectName(moduleItem) {
  return resolveNpcCapabilityPropulsionEffectName(moduleItem);
}

function getNpcPropulsionModules(entity) {
  if (NPC_ENABLE_FITTED_PROPULSION_MODULES !== true) {
    return [];
  }

  return getNpcFittedModuleItems(entity)
    .map((moduleItem) => ({
      moduleItem,
      effectName: resolveNpcPropulsionEffectName(moduleItem),
    }))
    .filter((entry) => Boolean(entry.effectName))
    .sort((left, right) => {
      const leftPriority =
        left.effectName === PROPULSION_EFFECT_MICROWARPDRIVE ? 0 : 1;
      const rightPriority =
        right.effectName === PROPULSION_EFFECT_MICROWARPDRIVE ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return (
        toPositiveInt(left.moduleItem && left.moduleItem.flagID, 0) -
        toPositiveInt(right.moduleItem && right.moduleItem.flagID, 0)
      );
    });
}

module.exports = {
  PROPULSION_EFFECT_AFTERBURNER,
  PROPULSION_EFFECT_MICROWARPDRIVE,
  isNativeNpcEntity,
  getNpcShipID,
  getNpcPilotCharacterID,
  getNpcFittedModuleItems,
  getNpcLoadedChargeForModule,
  getNpcWeaponModules,
  buildNpcWeaponModuleSnapshot,
  estimateNpcWeaponEffectiveRange,
  getNpcEntityMissileWeaponSource,
  resolveNpcPropulsionEffectName,
  getNpcPropulsionModules,
};

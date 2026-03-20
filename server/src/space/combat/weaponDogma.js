const path = require("path");

const {
  getAttributeIDByNames,
  getTypeDogmaAttributes,
  getTypeDogmaEffects,
  getEffectTypeRecord,
  typeHasEffectName,
  listFittedItems,
  isModuleOnline,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  getCharacterSkillMap,
} = require(path.join(__dirname, "../../services/skills/skillState"));

const ATTRIBUTE_CAPACITOR_NEED = getAttributeIDByNames("capacitorNeed") || 6;
const ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
const ATTRIBUTE_MAX_RANGE = getAttributeIDByNames("maxRange") || 54;
const ATTRIBUTE_FALLOFF = getAttributeIDByNames("falloff") || 158;
const ATTRIBUTE_TRACKING_SPEED = getAttributeIDByNames("trackingSpeed") || 160;
const ATTRIBUTE_OPTIMAL_SIG_RADIUS = getAttributeIDByNames("optimalSigRadius") || 620;
const ATTRIBUTE_DAMAGE_MULTIPLIER = getAttributeIDByNames("damageMultiplier") || 64;
const ATTRIBUTE_EM_DAMAGE = getAttributeIDByNames("emDamage") || 114;
const ATTRIBUTE_EXPLOSIVE_DAMAGE = getAttributeIDByNames("explosiveDamage") || 116;
const ATTRIBUTE_KINETIC_DAMAGE = getAttributeIDByNames("kineticDamage") || 117;
const ATTRIBUTE_THERMAL_DAMAGE = getAttributeIDByNames("thermalDamage") || 118;
const ATTRIBUTE_SKILL_LEVEL = getAttributeIDByNames("skillLevel") || 280;

const ENERGY_TURRET_GROUP_ID = 53;
const FREQUENCY_CRYSTAL_GROUP_ID = 86;
const STACKING_DENOMINATORS = Object.freeze(
  Array.from({ length: 8 }, (_, index) => Math.exp((index / 2.67) ** 2)),
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function normalizeNumericAttributeMap(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );
}

function cloneAttributeMap(source = {}) {
  return Object.fromEntries(
    Object.entries(source || {}).map(([attributeID, value]) => [
      Number(attributeID),
      Number(value),
    ]),
  );
}

function getTypeAttributeMap(typeID) {
  return normalizeNumericAttributeMap(getTypeDogmaAttributes(typeID));
}

function getTypeEffects(typeID) {
  return [...getTypeDogmaEffects(typeID)]
    .map((effectID) => getEffectTypeRecord(effectID))
    .filter(Boolean);
}

function getRequiredSkillTypeIDs(typeID) {
  const attributeMap = getTypeAttributeMap(typeID);
  const requiredSkillTypeIDs = [];
  for (let index = 1; index <= 6; index += 1) {
    const requiredSkillTypeID = toInt(
      attributeMap[getAttributeIDByNames(`requiredSkill${index}`)],
      0,
    );
    if (requiredSkillTypeID > 0) {
      requiredSkillTypeIDs.push(requiredSkillTypeID);
    }
  }
  return requiredSkillTypeIDs;
}

function moduleRequiresSkillType(moduleItem, skillTypeID) {
  if (!moduleItem || !skillTypeID) {
    return false;
  }
  return getRequiredSkillTypeIDs(moduleItem.typeID).includes(toInt(skillTypeID, 0));
}

function buildSkillEffectiveAttributes(skillRecord) {
  const typeID = toInt(skillRecord && skillRecord.typeID, 0);
  const level = Math.max(
    0,
    toInt(
      skillRecord && (
        skillRecord.effectiveSkillLevel ??
        skillRecord.trainedSkillLevel ??
        skillRecord.skillLevel
      ),
      0,
    ),
  );
  const attributes = getTypeAttributeMap(typeID);
  attributes[ATTRIBUTE_SKILL_LEVEL] = level;

  for (const effectRecord of getTypeEffects(typeID)) {
    if (String(effectRecord.name || "").toLowerCase() === "skilleffect") {
      continue;
    }
    for (const modifier of effectRecord.modifierInfo || []) {
      if (
        modifier.func !== "ItemModifier" ||
        modifier.domain !== "itemID" ||
        toInt(modifier.modifiedAttributeID, 0) === ATTRIBUTE_SKILL_LEVEL
      ) {
        continue;
      }

      applyDirectModifier(
        attributes,
        modifier.modifiedAttributeID,
        attributes[modifier.modifyingAttributeID],
        modifier.operation,
      );
    }
  }

  return attributes;
}

function isPassiveModifierSource(item) {
  if (!item || toInt(item.typeID, 0) <= 0) {
    return false;
  }

  const familyFlags = [
    [92, 99],
    [125, 132],
  ];
  const flagID = toInt(item.flagID, 0);
  if (familyFlags.some(([start, end]) => flagID >= start && flagID <= end)) {
    return true;
  }

  const hasExplicitActivation = getTypeEffects(item.typeID).some((effectRecord) => {
    const effectCategoryID = toInt(effectRecord && effectRecord.effectCategoryID, 0);
    if (![1, 2, 3].includes(effectCategoryID)) {
      return false;
    }
    const normalizedName = String(effectRecord && effectRecord.name || "").toLowerCase();
    return !new Set([
      "online",
      "hipower",
      "medpower",
      "lopower",
      "rigslot",
      "subsystem",
      "turretfitted",
      "launcherfitted",
    ]).has(normalizedName);
  });

  if (hasExplicitActivation) {
    return false;
  }

  return isModuleOnline(item) || item.moduleState === undefined || item.moduleState === null;
}

function getStackedMultiplierFactor(factors = []) {
  const normalizedFactors = (Array.isArray(factors) ? factors : [])
    .map((factor) => toFiniteNumber(factor, NaN))
    .filter((factor) => Number.isFinite(factor) && factor > 0);
  if (normalizedFactors.length === 0) {
    return 1;
  }

  const sortedFactors = [...normalizedFactors].sort((left, right) => left - right);
  const splitPoint = sortedFactors.findIndex((factor) => factor > 1);
  const belowOrEqual = splitPoint === -1 ? sortedFactors : sortedFactors.slice(0, splitPoint);
  const above = splitPoint === -1 ? [] : sortedFactors.slice(splitPoint).reverse();
  let combined = 1;

  belowOrEqual.forEach((factor, index) => {
    const denominator = STACKING_DENOMINATORS[index];
    if (!denominator) {
      return;
    }
    combined *= ((factor - 1) * (1 / denominator)) + 1;
  });
  above.forEach((factor, index) => {
    const denominator = STACKING_DENOMINATORS[index];
    if (!denominator) {
      return;
    }
    combined *= ((factor - 1) * (1 / denominator)) + 1;
  });

  return combined;
}

function applyDirectModifier(attributes, attributeID, rawValue, operation) {
  const numericAttributeID = toInt(attributeID, 0);
  const value = toFiniteNumber(rawValue, NaN);
  if (numericAttributeID <= 0 || !Number.isFinite(value)) {
    return;
  }

  const currentValue = toFiniteNumber(attributes[numericAttributeID], NaN);
  switch (toInt(operation, 0)) {
    case 0:
    case 4: {
      const base = Number.isFinite(currentValue) ? currentValue : 1;
      attributes[numericAttributeID] = round6(base * value);
      break;
    }
    case 2: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base + value);
      break;
    }
    case 3: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base - value);
      break;
    }
    case 5: {
      const base = Number.isFinite(currentValue) ? currentValue : 1;
      if (Math.abs(value) > 1e-9) {
        attributes[numericAttributeID] = round6(base / value);
      }
      break;
    }
    case 6: {
      const base = Number.isFinite(currentValue) ? currentValue : 0;
      attributes[numericAttributeID] = round6(base * (1 + (value / 100)));
      break;
    }
    case 7: {
      attributes[numericAttributeID] = round6(value);
      break;
    }
    default:
      break;
  }
}

function applyModifierGroups(attributes, modifierEntries = []) {
  const groups = new Map();
  for (const modifierEntry of modifierEntries) {
    if (!modifierEntry) {
      continue;
    }
    const attributeID = toInt(modifierEntry.modifiedAttributeID, 0);
    const operation = toInt(modifierEntry.operation, 0);
    const value = toFiniteNumber(modifierEntry.value, NaN);
    if (attributeID <= 0 || !Number.isFinite(value)) {
      continue;
    }
    const key = `${attributeID}:${operation}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(modifierEntry);
  }

  const operationOrder = [0, 2, 3, 4, 6, 5, 7];
  for (const operation of operationOrder) {
    for (const [key, entries] of groups.entries()) {
      const [, rawOperation] = key.split(":");
      if (Number(rawOperation) !== operation) {
        continue;
      }
      const attributeID = toInt(entries[0] && entries[0].modifiedAttributeID, 0);
      const currentValue = toFiniteNumber(attributes[attributeID], NaN);
      if (attributeID <= 0) {
        continue;
      }

      switch (operation) {
        case 0:
        case 4:
        case 5:
        case 6: {
          const directFactors = [];
          const penalizedFactors = [];
          for (const entry of entries) {
            let factor = 1;
            if (operation === 6) {
              factor = 1 + (toFiniteNumber(entry.value, 0) / 100);
            } else if (operation === 5) {
              const divisor = toFiniteNumber(entry.value, NaN);
              factor = Number.isFinite(divisor) && Math.abs(divisor) > 1e-9
                ? 1 / divisor
                : 1;
            } else {
              factor = toFiniteNumber(entry.value, 1);
            }
            if (!Number.isFinite(factor) || factor <= 0) {
              continue;
            }
            if (entry.stackingPenalized) {
              penalizedFactors.push(factor);
            } else {
              directFactors.push(factor);
            }
          }

          const base = Number.isFinite(currentValue)
            ? currentValue
            : operation === 6
              ? 0
              : 1;
          const directFactor = directFactors.reduce(
            (result, factor) => result * factor,
            1,
          );
          const penalizedFactor = getStackedMultiplierFactor(penalizedFactors);
          attributes[attributeID] = round6(base * directFactor * penalizedFactor);
          break;
        }
        case 2: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          const totalAdd = entries.reduce(
            (sum, entry) => sum + toFiniteNumber(entry.value, 0),
            0,
          );
          attributes[attributeID] = round6(base + totalAdd);
          break;
        }
        case 3: {
          const base = Number.isFinite(currentValue) ? currentValue : 0;
          const totalSub = entries.reduce(
            (sum, entry) => sum + toFiniteNumber(entry.value, 0),
            0,
          );
          attributes[attributeID] = round6(base - totalSub);
          break;
        }
        case 7: {
          const lastEntry = entries[entries.length - 1] || null;
          if (lastEntry) {
            attributes[attributeID] = round6(lastEntry.value);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return attributes;
}

function collectShipModifierAttributes(shipItem, skillMap) {
  const shipAttributes = getTypeAttributeMap(shipItem && shipItem.typeID);
  for (const skillRecord of skillMap.values()) {
    const effectiveSkillAttributes = buildSkillEffectiveAttributes(skillRecord);
    for (const effectRecord of getTypeEffects(skillRecord.typeID)) {
      for (const modifier of effectRecord.modifierInfo || []) {
        if (
          modifier.func !== "ItemModifier" ||
          modifier.domain !== "shipID"
        ) {
          continue;
        }
        applyDirectModifier(
          shipAttributes,
          modifier.modifiedAttributeID,
          effectiveSkillAttributes[modifier.modifyingAttributeID],
          modifier.operation,
        );
      }
    }
  }
  return shipAttributes;
}

function appendLocationModifierEntries(
  destination,
  sourceAttributes,
  sourceEffects,
  sourceKind,
  moduleItem,
) {
  for (const effectRecord of sourceEffects) {
    for (const modifier of effectRecord.modifierInfo || []) {
      const func = String(modifier.func || "");
      if (
        func !== "LocationRequiredSkillModifier" &&
        func !== "LocationGroupModifier" &&
        func !== "LocationModifier" &&
        func !== "OwnerRequiredSkillModifier"
      ) {
        continue;
      }

      const domain = String(modifier.domain || "");
      if (
        domain !== "shipID" &&
        domain !== "charID"
      ) {
        continue;
      }
      if (
        modifier.skillTypeID &&
        !moduleRequiresSkillType(moduleItem, modifier.skillTypeID)
      ) {
        continue;
      }
      if (
        modifier.groupID &&
        toInt(moduleItem && moduleItem.groupID, 0) !== toInt(modifier.groupID, 0)
      ) {
        continue;
      }

      const value = toFiniteNumber(
        sourceAttributes && sourceAttributes[modifier.modifyingAttributeID],
        NaN,
      );
      if (!Number.isFinite(value)) {
        continue;
      }

      destination.push({
        modifiedAttributeID: modifier.modifiedAttributeID,
        operation: modifier.operation,
        value,
        stackingPenalized: sourceKind === "fittedModule",
      });
    }
  }
}

function applyChargeModifiers(moduleAttributes, chargeItem) {
  if (!chargeItem || toInt(chargeItem.typeID, 0) <= 0) {
    return moduleAttributes;
  }

  const chargeAttributes = getTypeAttributeMap(chargeItem.typeID);
  for (const effectRecord of getTypeEffects(chargeItem.typeID)) {
    for (const modifier of effectRecord.modifierInfo || []) {
      if (
        modifier.func !== "ItemModifier" ||
        modifier.domain !== "otherID"
      ) {
        continue;
      }
      applyDirectModifier(
        moduleAttributes,
        modifier.modifiedAttributeID,
        chargeAttributes[modifier.modifyingAttributeID],
        modifier.operation,
      );
    }
  }

  return moduleAttributes;
}

function resolveWeaponFamily(moduleItem, chargeItem = null) {
  const moduleGroupID = toInt(moduleItem && moduleItem.groupID, 0);
  const chargeGroupID = toInt(chargeItem && chargeItem.groupID, 0);
  const isTurret = typeHasEffectName(moduleItem && moduleItem.typeID, "turretFitted");
  if (
    isTurret &&
    (
      moduleGroupID === ENERGY_TURRET_GROUP_ID ||
      chargeGroupID === FREQUENCY_CRYSTAL_GROUP_ID
    )
  ) {
    return "laserTurret";
  }
  return null;
}

function buildWeaponModuleSnapshot({
  characterID,
  shipItem,
  moduleItem,
  chargeItem = null,
  fittedItems = null,
  skillMap = null,
} = {}) {
  if (!shipItem || !moduleItem) {
    return null;
  }

  const family = resolveWeaponFamily(moduleItem, chargeItem);
  if (!family) {
    return null;
  }

  const resolvedFittedItems = Array.isArray(fittedItems)
    ? fittedItems
    : listFittedItems(characterID, shipItem.itemID);
  const resolvedSkillMap = skillMap instanceof Map
    ? skillMap
    : getCharacterSkillMap(characterID);
  const shipModifierAttributes = collectShipModifierAttributes(shipItem, resolvedSkillMap);
  const moduleAttributes = cloneAttributeMap(getTypeAttributeMap(moduleItem.typeID));
  const modifierEntries = [];

  for (const skillRecord of resolvedSkillMap.values()) {
    appendLocationModifierEntries(
      modifierEntries,
      buildSkillEffectiveAttributes(skillRecord),
      getTypeEffects(skillRecord.typeID),
      "skill",
      moduleItem,
    );
  }

  appendLocationModifierEntries(
    modifierEntries,
    shipModifierAttributes,
    getTypeEffects(shipItem.typeID),
    "ship",
    moduleItem,
  );

  for (const fittedItem of resolvedFittedItems) {
    if (
      !isPassiveModifierSource(fittedItem) ||
      toInt(fittedItem.itemID, 0) === toInt(moduleItem.itemID, 0)
    ) {
      continue;
    }

    appendLocationModifierEntries(
      modifierEntries,
      getTypeAttributeMap(fittedItem.typeID),
      getTypeEffects(fittedItem.typeID),
      "fittedModule",
      moduleItem,
    );
  }

  applyModifierGroups(moduleAttributes, modifierEntries);
  applyChargeModifiers(moduleAttributes, chargeItem);

  const damageMultiplier = Math.max(
    0,
    toFiniteNumber(moduleAttributes[ATTRIBUTE_DAMAGE_MULTIPLIER], 1),
  );
  const chargeDamage = {
    em: Math.max(0, toFiniteNumber(
      chargeItem ? getTypeAttributeMap(chargeItem.typeID)[ATTRIBUTE_EM_DAMAGE] : 0,
      0,
    )),
    thermal: Math.max(0, toFiniteNumber(
      chargeItem ? getTypeAttributeMap(chargeItem.typeID)[ATTRIBUTE_THERMAL_DAMAGE] : 0,
      0,
    )),
    kinetic: Math.max(0, toFiniteNumber(
      chargeItem ? getTypeAttributeMap(chargeItem.typeID)[ATTRIBUTE_KINETIC_DAMAGE] : 0,
      0,
    )),
    explosive: Math.max(0, toFiniteNumber(
      chargeItem ? getTypeAttributeMap(chargeItem.typeID)[ATTRIBUTE_EXPLOSIVE_DAMAGE] : 0,
      0,
    )),
  };

  return {
    family,
    moduleID: toInt(moduleItem.itemID, 0),
    moduleTypeID: toInt(moduleItem.typeID, 0),
    chargeItemID: toInt(chargeItem && chargeItem.itemID, 0),
    chargeTypeID: toInt(chargeItem && chargeItem.typeID, 0),
    effectGUID: "effects.Laser",
    durationMs: Math.max(1, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_SPEED], 1000))),
    capNeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_CAPACITOR_NEED], 0))),
    optimalRange: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_MAX_RANGE], 0))),
    falloff: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_FALLOFF], 0))),
    trackingSpeed: Math.max(0, round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_TRACKING_SPEED], 0))),
    optimalSigRadius: Math.max(
      1,
      round6(toFiniteNumber(moduleAttributes[ATTRIBUTE_OPTIMAL_SIG_RADIUS], 40000)),
    ),
    damageMultiplier,
    baseDamage: chargeDamage,
    rawShotDamage: {
      em: round6(chargeDamage.em * damageMultiplier),
      thermal: round6(chargeDamage.thermal * damageMultiplier),
      kinetic: round6(chargeDamage.kinetic * damageMultiplier),
      explosive: round6(chargeDamage.explosive * damageMultiplier),
    },
    moduleAttributes,
    shipModifierAttributes,
  };
}

module.exports = {
  ENERGY_TURRET_GROUP_ID,
  FREQUENCY_CRYSTAL_GROUP_ID,
  resolveWeaponFamily,
  buildWeaponModuleSnapshot,
};

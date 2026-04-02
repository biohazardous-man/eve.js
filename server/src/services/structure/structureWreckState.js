const path = require("path");

const { TABLE, readStaticRows } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));
const {
  createSpaceItemForCharacter,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getStructureSpaceDirection,
} = require(path.join(__dirname, "./structureSpaceInterop"));

let cachedStructureWreckTypes = null;

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

function normalizeRotation(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return [0, 0, 0];
  }
  return [
    toFiniteNumber(value[0], 0),
    toFiniteNumber(value[1], 0),
    toFiniteNumber(value[2], 0),
  ];
}

function normalizeStructureWreckLookupName(value) {
  return String(value || "")
    .replace(/^[^A-Za-z0-9']+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getStructureWreckTypeIndex() {
  if (cachedStructureWreckTypes) {
    return cachedStructureWreckTypes;
  }

  const itemTypes = readStaticRows(TABLE.ITEM_TYPES);
  const wreckByName = new Map();

  for (const row of itemTypes) {
    if (String(row && row.groupName || "").trim().toLowerCase() !== "wreck") {
      continue;
    }
    const normalizedName = normalizeStructureWreckLookupName(row && row.name);
    if (!normalizedName) {
      continue;
    }
    wreckByName.set(normalizedName, row);
  }

  const byStructureTypeID = new Map();
  for (const row of itemTypes) {
    if (toPositiveInt(row && row.categoryID, 0) !== 65) {
      continue;
    }
    const exactName = normalizeStructureWreckLookupName(
      `${String(row && row.name || "").trim()} Wreck`,
    );
    if (exactName && wreckByName.has(exactName)) {
      byStructureTypeID.set(toPositiveInt(row && row.typeID, 0), wreckByName.get(exactName));
      continue;
    }

    const strippedName = normalizeStructureWreckLookupName(
      `${String(row && row.name || "").replace(/^[^A-Za-z0-9']+\s*/g, "").trim()} Wreck`,
    );
    if (strippedName && wreckByName.has(strippedName)) {
      byStructureTypeID.set(toPositiveInt(row && row.typeID, 0), wreckByName.get(strippedName));
    }
  }

  cachedStructureWreckTypes = {
    byStructureTypeID,
  };
  return cachedStructureWreckTypes;
}

function clearStructureWreckTypeCache() {
  cachedStructureWreckTypes = null;
}

function resolveStructureWreckType(structureOrTypeID) {
  const structureTypeID =
    typeof structureOrTypeID === "object" && structureOrTypeID !== null
      ? toPositiveInt(structureOrTypeID.typeID, 0)
      : toPositiveInt(structureOrTypeID, 0);
  if (!structureTypeID) {
    return null;
  }
  return getStructureWreckTypeIndex().byStructureTypeID.get(structureTypeID) || null;
}

function createStructureWreck(structure, ownerCharacterID, options = {}) {
  const { getSpaceDebrisLifetimeMs } = require(path.join(
    __dirname,
    "../inventory/spaceDebrisState",
  ));
  const wreckType = resolveStructureWreckType(structure);
  if (!wreckType) {
    return {
      success: false,
      errorMsg: "WRECK_TYPE_NOT_FOUND",
    };
  }

  const numericOwnerCharacterID = toPositiveInt(ownerCharacterID, 0);
  const solarSystemID = toPositiveInt(structure && structure.solarSystemID, 0);
  if (!numericOwnerCharacterID || !solarSystemID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  const nowMs = Math.max(0, Math.trunc(toFiniteNumber(options.nowMs, Date.now())));
  const createResult = createSpaceItemForCharacter(
    numericOwnerCharacterID,
    solarSystemID,
    wreckType,
    {
      itemName: String(wreckType.name || "Wreck"),
      position: cloneVector(structure && structure.position),
      direction: getStructureSpaceDirection(structure),
      velocity: { x: 0, y: 0, z: 0 },
      targetPoint: cloneVector(structure && structure.position),
      mode: "STOP",
      speedFraction: 0,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + getSpaceDebrisLifetimeMs(),
      launcherID: toPositiveInt(structure && structure.structureID, 0),
      dunRotation: normalizeRotation(structure && structure.rotation),
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 0,
        incapacitated: false,
      },
    },
  );
  if (!createResult.success || !createResult.data) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "WRECK_CREATE_FAILED",
    };
  }

  return {
    success: true,
    data: createResult.data,
  };
}

module.exports = {
  clearStructureWreckTypeCache,
  resolveStructureWreckType,
  createStructureWreck,
};

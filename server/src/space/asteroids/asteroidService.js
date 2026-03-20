const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const asteroidData = require(path.join(__dirname, "./asteroidData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));

const STATIC_ASTEROID_ITEM_ID_BASE = 5_000_000_000_000;
const STATIC_ASTEROID_ITEM_ID_STRIDE = 128;

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

function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAsteroidItemID(beltID, asteroidIndex) {
  return (
    STATIC_ASTEROID_ITEM_ID_BASE +
    (toPositiveInt(beltID, 0) * STATIC_ASTEROID_ITEM_ID_STRIDE) +
    asteroidIndex
  );
}

function pickWeightedEntry(entries, rng) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      ...entry,
      weight: Math.max(0, toFiniteNumber(entry && entry.weight, 0)),
    }))
    .filter((entry) => entry.weight > 0);
  if (normalizedEntries.length <= 0) {
    return null;
  }

  const totalWeight = normalizedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;
  for (const entry of normalizedEntries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry;
    }
  }
  return normalizedEntries[normalizedEntries.length - 1];
}

function pickIntegerInRange(minimum, maximum, rng) {
  const min = Math.trunc(Math.min(minimum, maximum));
  const max = Math.trunc(Math.max(minimum, maximum));
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * ((max - min) + 1));
}

function buildClusterOffsets(belt, rng) {
  const clusterCount = Math.max(1, toPositiveInt(belt.clusterCount, 1));
  const fieldRadiusMeters = Math.max(4_000, toFiniteNumber(belt.fieldRadiusMeters, 32_000));
  const verticalSpreadMeters = Math.max(1_000, toFiniteNumber(belt.verticalSpreadMeters, 4_500));
  const offsets = [];

  for (let index = 0; index < clusterCount; index += 1) {
    const theta = rng() * Math.PI * 2;
    const distanceRatio = Math.sqrt(rng());
    const radialDistance = fieldRadiusMeters * 0.2 + (distanceRatio * fieldRadiusMeters * 0.65);
    offsets.push({
      x: Math.cos(theta) * radialDistance,
      y: ((rng() * 2) - 1) * verticalSpreadMeters,
      z: Math.sin(theta) * radialDistance,
    });
  }

  return offsets;
}

function buildAsteroidOffset(belt, clusterOffset, rng) {
  const clusterRadiusMeters = Math.max(1_500, toFiniteNumber(belt.clusterRadiusMeters, 6_000));
  const verticalSpreadMeters = Math.max(800, toFiniteNumber(belt.verticalSpreadMeters, 4_500));
  const theta = rng() * Math.PI * 2;
  const distanceRatio = Math.sqrt(rng());
  const radialDistance = distanceRatio * clusterRadiusMeters;
  const localOffset = {
    x: Math.cos(theta) * radialDistance,
    y: ((rng() * 2) - 1) * verticalSpreadMeters,
    z: Math.sin(theta) * radialDistance,
  };

  return addVectors(clusterOffset, localOffset);
}

function buildGeneratedAsteroidEntity(belt, style, asteroidIndex, clusterOffsets, rng) {
  const totalCount = Math.max(1, toPositiveInt(belt.asteroidCount, 1));
  const largeCount = Math.min(totalCount, Math.max(0, toPositiveInt(belt.largeAsteroidCount, 0)));
  const useLargeType = asteroidIndex < largeCount;
  const selection = pickWeightedEntry(
    useLargeType ? style.largeTypes : style.decorativeTypes,
    rng,
  ) || pickWeightedEntry(style.decorativeTypes, rng);
  if (!selection) {
    return null;
  }

  const typeRow = resolveItemByTypeID(selection.typeID);
  if (!typeRow) {
    return null;
  }

  const clusterOffset = clusterOffsets[asteroidIndex % clusterOffsets.length] || { x: 0, y: 0, z: 0 };
  const asteroidOffset = buildAsteroidOffset(belt, clusterOffset, rng);
  const position = addVectors(cloneVector(belt.position), asteroidOffset);
  const defaultRadius = useLargeType
    ? Math.max(4_000, toFiniteNumber(typeRow.radius, 6_000))
    : Math.max(
        750,
        pickIntegerInRange(
          toPositiveInt(selection.radiusMinMeters, 900),
          toPositiveInt(selection.radiusMaxMeters, 2_200),
          rng,
        ),
      );

  return {
    kind: "asteroid",
    itemID: buildAsteroidItemID(belt.itemID, asteroidIndex + 1),
    typeID: typeRow.typeID,
    groupID: typeRow.groupID,
    categoryID: typeRow.categoryID,
    itemName: typeRow.name || `${belt.itemName} Asteroid ${asteroidIndex + 1}`,
    slimName: typeRow.name || `${belt.itemName} Asteroid ${asteroidIndex + 1}`,
    ownerID: 1,
    radius: Math.max(500, toFiniteNumber(typeRow.radius, defaultRadius)),
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    beltID: belt.itemID,
    fieldStyleID: belt.fieldStyleID,
    staticVisibilityScope: "bubble",
  };
}

function populateBeltField(scene, belt) {
  const style = asteroidData.getFieldStyleByID(belt.fieldStyleID);
  if (!scene || !belt || !style) {
    return [];
  }

  const totalCount = Math.max(0, toPositiveInt(belt.asteroidCount, 0));
  if (totalCount <= 0) {
    return [];
  }

  const rng = createRng(toPositiveInt(belt.fieldSeed, belt.itemID));
  const clusterOffsets = buildClusterOffsets(belt, rng);
  const spawned = [];

  for (let asteroidIndex = 0; asteroidIndex < totalCount; asteroidIndex += 1) {
    const entity = buildGeneratedAsteroidEntity(
      belt,
      style,
      asteroidIndex,
      clusterOffsets,
      rng,
    );
    if (!entity) {
      continue;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  return spawned;
}

function handleSceneCreated(scene) {
  if (!scene || scene._asteroidFieldsInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  if (config.asteroidFieldsEnabled !== true) {
    scene._asteroidFieldsInitialized = true;
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._asteroidFieldsInitialized = true;
  const belts = asteroidData.getBeltsForSystem(scene.systemID);
  const spawned = [];
  for (const belt of belts) {
    spawned.push(...populateBeltField(scene, belt));
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

module.exports = {
  handleSceneCreated,
  _testing: {
    buildAsteroidItemID,
    buildGeneratedAsteroidEntity,
    populateBeltField,
  },
};

const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const BaseService = require(path.join(__dirname, "../baseService"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const ICE_SITE_ITEM_ID_BASE = 5_100_000_000_000;
const GAS_SITE_ITEM_ID_BASE = 5_200_000_000_000;
const SITE_ID_SYSTEM_STRIDE = 10_000;
const SITE_ID_SITE_STRIDE = 100;
const DEFAULT_SITE_RADIUS_METERS = 18_000;
const DEFAULT_SITE_ANCHOR_OFFSET_METERS = 120_000;
const DEFAULT_ICE_CHUNKS_PER_SITE = 12;
const DEFAULT_GAS_CLOUDS_PER_SITE = 14;
const DEFAULT_ICE_QUANTITY_RANGE = Object.freeze([1_500, 4_500]);
const DEFAULT_GAS_QUANTITY_RANGE = Object.freeze([4_000, 12_000]);
const TEMPLATE_NAMES = Object.freeze({
  ice: Object.freeze({
    highsec: Object.freeze(["Blue Ice", "Clear Icicle", "White Glaze", "Glacial Mass"]),
    lowsec: Object.freeze(["Dark Glitter", "Glare Crust", "Gelidus"]),
    nullsec: Object.freeze(["Krystallos", "Gelidus", "Dark Glitter", "Glare Crust", "Azure Ice", "Crystalline Icicle"]),
    wormhole: Object.freeze([]),
  }),
  gas: Object.freeze({
    highsec: Object.freeze([]),
    lowsec: Object.freeze([
      "Amber Mykoserocin",
      "Golden Mykoserocin",
      "Lime Mykoserocin",
      "Viridian Mykoserocin",
      "Amber Cytoserocin",
      "Golden Cytoserocin",
      "Lime Cytoserocin",
      "Viridian Cytoserocin",
    ]),
    nullsec: Object.freeze([
      "Azure Mykoserocin",
      "Celadon Mykoserocin",
      "Malachite Mykoserocin",
      "Vermillion Mykoserocin",
      "Azure Cytoserocin",
      "Celadon Cytoserocin",
      "Malachite Cytoserocin",
      "Vermillion Cytoserocin",
    ]),
    wormhole: Object.freeze([
      "Fullerite-C50",
      "Fullerite-C60",
      "Fullerite-C70",
      "Fullerite-C72",
      "Fullerite-C84",
      "Fullerite-C28",
      "Fullerite-C32",
      "Fullerite-C320",
      "Fullerite-C540",
    ]),
  }),
});

let cachedTypeRecordByName = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(toFiniteNumber(value, minimum), minimum),
    maximum,
  );
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
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

function hashValue(value) {
  let state = toInt(value, 0) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function createRng(seed) {
  let state = hashValue(seed) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function getSecurityBand(systemID) {
  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  const securityStatus = toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
  if (toInt(systemID, 0) >= 31_000_000 && toInt(systemID, 0) <= 31_999_999) {
    return "wormhole";
  }
  if (securityStatus >= 0.45) {
    return "highsec";
  }
  if (securityStatus >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function getConfiguredSiteCount(kind, securityBand) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  switch (`${normalizedKind}:${securityBand}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config.miningIceSitesHighSecPerSystem, 1));
    case "ice:lowsec":
      return Math.max(0, toInt(config.miningIceSitesLowSecPerSystem, 1));
    case "ice:nullsec":
      return Math.max(0, toInt(config.miningIceSitesNullSecPerSystem, 1));
    case "ice:wormhole":
      return Math.max(0, toInt(config.miningIceSitesWormholePerSystem, 0));
    case "gas:highsec":
      return Math.max(0, toInt(config.miningGasSitesHighSecPerSystem, 0));
    case "gas:lowsec":
      return Math.max(0, toInt(config.miningGasSitesLowSecPerSystem, 1));
    case "gas:nullsec":
      return Math.max(0, toInt(config.miningGasSitesNullSecPerSystem, 1));
    case "gas:wormhole":
      return Math.max(0, toInt(config.miningGasSitesWormholePerSystem, 2));
    default:
      return 0;
  }
}

function getAnchorCandidates(scene) {
  const sceneEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  const beltEntities = sceneEntities.filter((entity) => (
    entity &&
    entity.kind === "asteroidBelt" &&
    entity.position
  ));
  if (beltEntities.length > 0) {
    return beltEntities.map((entity) => ({
      itemID: toInt(entity.itemID, 0),
      itemName: String(entity.itemName || ""),
      position: cloneVector(entity.position),
    }));
  }

  const celestialEntities = sceneEntities.filter((entity) => (
    entity &&
    entity.position &&
    entity.kind !== "station" &&
    entity.kind !== "structure" &&
    entity.kind !== "stargate"
  ));
  if (celestialEntities.length > 0) {
    return celestialEntities.map((entity) => ({
      itemID: toInt(entity.itemID, 0),
      itemName: String(entity.itemName || ""),
      position: cloneVector(entity.position),
    }));
  }

  return [{ itemID: toInt(scene && scene.systemID, 0), itemName: "System", position: { x: 0, y: 0, z: 0 } }];
}

function ensureTypeRecordCache() {
  if (cachedTypeRecordByName) {
    return cachedTypeRecordByName;
  }
  cachedTypeRecordByName = new Map();
  for (const name of new Set([
    "Ice Field",
    "Gas Cloud 1",
    ...Object.values(TEMPLATE_NAMES.ice).flat(),
    ...Object.values(TEMPLATE_NAMES.gas).flat(),
  ])) {
    const lookup = resolveItemByName(name);
    if (lookup && lookup.success && lookup.match) {
      cachedTypeRecordByName.set(name, lookup.match);
    }
  }
  return cachedTypeRecordByName;
}

function getTypeRecordByName(name) {
  return ensureTypeRecordCache().get(String(name || "").trim()) || null;
}

function getTemplateTypeRecords(kind, securityBand) {
  const templateNames = (
    TEMPLATE_NAMES[kind] &&
    TEMPLATE_NAMES[kind][securityBand]
  ) || [];
  let records = templateNames
    .map((name) => getTypeRecordByName(name))
    .filter(Boolean);
  if (records.length > 0) {
    return records;
  }

  const fallbackBands = kind === "gas"
    ? ["lowsec", "nullsec", "wormhole", "highsec"]
    : ["nullsec", "lowsec", "highsec", "wormhole"];
  for (const fallbackBand of fallbackBands) {
    if (fallbackBand === securityBand) {
      continue;
    }
    records = ((TEMPLATE_NAMES[kind] && TEMPLATE_NAMES[kind][fallbackBand]) || [])
      .map((name) => getTypeRecordByName(name))
      .filter(Boolean);
    if (records.length > 0) {
      return records;
    }
  }
  return [];
}

function buildAnchorItemID(kind, systemID, siteIndex) {
  const base = kind === "gas" ? GAS_SITE_ITEM_ID_BASE : ICE_SITE_ITEM_ID_BASE;
  return (
    base +
    (normalizePositiveInt(systemID, 0) * SITE_ID_SYSTEM_STRIDE) +
    (siteIndex * SITE_ID_SITE_STRIDE)
  );
}

function buildChildItemID(kind, systemID, siteIndex, childIndex) {
  return buildAnchorItemID(kind, systemID, siteIndex) + childIndex + 1;
}

function buildFieldCenter(anchorPosition, seed) {
  const rng = createRng(seed);
  const angle = rng() * Math.PI * 2;
  const distance = Math.max(
    25_000,
    toFiniteNumber(
      config.miningGeneratedSiteAnchorOffsetMeters,
      DEFAULT_SITE_ANCHOR_OFFSET_METERS,
    ),
  );
  return addVectors(anchorPosition, {
    x: Math.cos(angle) * distance,
    y: ((rng() * 2) - 1) * (distance * 0.12),
    z: Math.sin(angle) * distance,
  });
}

function buildMineablePosition(center, siteRadiusMeters, siteIndex, childIndex) {
  const rng = createRng(hashValue(siteIndex * 4099 + childIndex * 131 + toInt(center.x, 0)));
  const angle = ((Math.PI * 2) / Math.max(1, childIndex + 1)) * childIndex + (rng() * 0.35);
  const radialDistance = Math.sqrt(rng()) * siteRadiusMeters;
  return addVectors(center, {
    x: Math.cos(angle) * radialDistance,
    y: ((rng() * 2) - 1) * Math.max(500, siteRadiusMeters * 0.18),
    z: Math.sin(angle) * radialDistance,
  });
}

function pickTemplateType(templateTypeRecords, seed) {
  if (!Array.isArray(templateTypeRecords) || templateTypeRecords.length <= 0) {
    return null;
  }
  const index = hashValue(seed) % templateTypeRecords.length;
  return templateTypeRecords[index] || null;
}

function getQuantityRange(kind) {
  return kind === "gas" ? DEFAULT_GAS_QUANTITY_RANGE : DEFAULT_ICE_QUANTITY_RANGE;
}

function buildMineableQuantity(kind, seed) {
  const rng = createRng(seed);
  const [minimum, maximum] = getQuantityRange(kind);
  return Math.max(
    1,
    Math.round(minimum + ((maximum - minimum) * rng())),
  );
}

function buildAnchorEntity(kind, systemID, siteIndex, position) {
  const anchorType = kind === "gas"
    ? getTypeRecordByName("Gas Cloud 1")
    : getTypeRecordByName("Ice Field");
  if (!anchorType) {
    return null;
  }
  const anchorID = buildAnchorItemID(kind, systemID, siteIndex);
  const fieldLabel = kind === "gas" ? "Gas Field" : "Ice Field";
  return {
    kind: kind === "gas" ? "gasFieldAnchor" : "iceFieldAnchor",
    generatedMiningSite: true,
    generatedMiningSiteAnchor: true,
    generatedMiningSiteKind: kind,
    generatedMiningSiteIndex: siteIndex,
    itemID: anchorID,
    typeID: anchorType.typeID,
    groupID: anchorType.groupID,
    categoryID: anchorType.categoryID,
    ownerID: 1,
    itemName: `${fieldLabel} ${siteIndex + 1}`,
    slimName: `${fieldLabel} ${siteIndex + 1}`,
    position: cloneVector(position),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: Math.max(1_500, toFiniteNumber(anchorType.radius, 2_000)),
    staticVisibilityScope: "bubble",
  };
}

function buildMineableEntity(kind, systemID, siteIndex, childIndex, center, templateTypeRecord) {
  if (!templateTypeRecord) {
    return null;
  }
  const siteRadiusMeters = Math.max(
    5_000,
    toFiniteNumber(config.miningGeneratedSiteRadiusMeters, DEFAULT_SITE_RADIUS_METERS),
  );
  return {
    kind: kind === "gas" ? "gasCloud" : "iceChunk",
    generatedMiningSite: true,
    generatedMiningSiteKind: kind,
    generatedMiningSiteIndex: siteIndex,
    itemID: buildChildItemID(kind, systemID, siteIndex, childIndex),
    typeID: templateTypeRecord.typeID,
    groupID: templateTypeRecord.groupID,
    categoryID: templateTypeRecord.categoryID,
    ownerID: 1,
    itemName: String(templateTypeRecord.name || `${kind} ${childIndex + 1}`),
    slimName: String(templateTypeRecord.name || `${kind} ${childIndex + 1}`),
    position: buildMineablePosition(center, siteRadiusMeters, siteIndex, childIndex),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: kind === "gas"
      ? 1_800 + ((childIndex % 4) * 250)
      : 3_000 + ((childIndex % 5) * 450),
    staticVisibilityScope: "bubble",
    resourceQuantity: buildMineableQuantity(
      kind,
      hashValue(systemID * 8191 + siteIndex * 257 + childIndex * 13 + templateTypeRecord.typeID),
    ),
  };
}

function getChildCountForKind(kind) {
  return kind === "gas"
    ? Math.max(1, toInt(config.miningGasCloudsPerSite, DEFAULT_GAS_CLOUDS_PER_SITE))
    : Math.max(1, toInt(config.miningIceChunksPerSite, DEFAULT_ICE_CHUNKS_PER_SITE));
}

function buildSiteEntities(scene, kind, siteIndex, securityBand, anchorCandidates) {
  const systemID = toInt(scene && scene.systemID, 0);
  const templateTypeRecords = getTemplateTypeRecords(kind, securityBand);
  if (templateTypeRecords.length <= 0) {
    return [];
  }
  const sourceAnchor = anchorCandidates[siteIndex % anchorCandidates.length] || anchorCandidates[0];
  if (!sourceAnchor || !sourceAnchor.position) {
    return [];
  }

  const center = buildFieldCenter(
    sourceAnchor.position,
    hashValue(systemID * 12289 + siteIndex * 257 + (kind === "gas" ? 17 : 5)),
  );
  const entities = [];
  const anchorEntity = buildAnchorEntity(kind, systemID, siteIndex, center);
  if (anchorEntity) {
    entities.push(anchorEntity);
  }

  const childCount = getChildCountForKind(kind);
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    const templateType = pickTemplateType(
      templateTypeRecords,
      hashValue(systemID * 4099 + siteIndex * 97 + childIndex * 17),
    );
    const entity = buildMineableEntity(
      kind,
      systemID,
      siteIndex,
      childIndex,
      center,
      templateType,
    );
    if (entity) {
      entities.push(entity);
    }
  }

  return entities;
}

function buildGeneratedResourceSitePlan(scene) {
  const systemID = toInt(scene && scene.systemID, 0);
  if (!scene || systemID <= 0) {
    return [];
  }
  const securityBand = getSecurityBand(systemID);
  const anchorCandidates = getAnchorCandidates(scene);
  const entities = [];

  if (config.miningGeneratedIceSitesEnabled === true) {
    const iceSiteCount = getConfiguredSiteCount("ice", securityBand);
    for (let siteIndex = 0; siteIndex < iceSiteCount; siteIndex += 1) {
      entities.push(
        ...buildSiteEntities(scene, "ice", siteIndex, securityBand, anchorCandidates),
      );
    }
  }

  if (config.miningGeneratedGasSitesEnabled === true) {
    const gasSiteCount = getConfiguredSiteCount("gas", securityBand);
    for (let siteIndex = 0; siteIndex < gasSiteCount; siteIndex += 1) {
      entities.push(
        ...buildSiteEntities(scene, "gas", siteIndex + 100, securityBand, anchorCandidates),
      );
    }
  }

  return entities;
}

function listGeneratedResourceSiteEntities(scene) {
  return (Array.isArray(scene && scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => entity && entity.generatedMiningSite === true);
}

function handleSceneCreated(scene) {
  if (!scene || scene._miningResourceSitesInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._miningResourceSitesInitialized = true;
  const spawned = [];
  for (const entity of buildGeneratedResourceSitePlan(scene)) {
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function resetSceneGeneratedResourceSites(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const removedEntityIDs = [];
  for (const entity of listGeneratedResourceSiteEntities(scene)) {
    const removeResult = scene.removeStaticEntity(entity.itemID, {
      broadcast: options.broadcast === true,
      nowMs: options.nowMs,
    });
    if (removeResult && removeResult.success) {
      removedEntityIDs.push(entity.itemID);
    }
  }

  scene._miningResourceSitesInitialized = false;
  const spawnResult = handleSceneCreated(scene);
  if (!spawnResult.success) {
    return spawnResult;
  }

  return {
    success: true,
    data: {
      removedEntityIDs,
      removedCount: removedEntityIDs.length,
      spawned: Array.isArray(spawnResult.data && spawnResult.data.spawned)
        ? spawnResult.data.spawned
        : [],
    },
  };
}

class MiningResourceSiteService extends BaseService {
  constructor() {
    super("miningResourceSite");
  }
}

module.exports = MiningResourceSiteService;
module.exports.handleSceneCreated = handleSceneCreated;
module.exports.resetSceneGeneratedResourceSites = resetSceneGeneratedResourceSites;
module.exports._testing = {
  buildGeneratedResourceSitePlan,
  getSecurityBand,
  getConfiguredSiteCount,
  getAnchorCandidates,
  listGeneratedResourceSiteEntities,
};

const fs = require("fs");
const path = require("path");

const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const DATA_DIRECTORY_PATH = path.join(__dirname, "../../../../data");
const STATIC_DATA_DIRECTORY_PATTERN = /^eve-online-static-data-\d+-jsonl$/i;

let cachedStaticDirectoryPath = null;
let cachedStaticPayload = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveLatestStaticDirectoryPath() {
  if (cachedStaticDirectoryPath !== null) {
    return cachedStaticDirectoryPath;
  }

  try {
    const entries = fs.readdirSync(DATA_DIRECTORY_PATH, {
      withFileTypes: true,
    });
    const selectedEntry = entries
      .filter((entry) => entry && entry.isDirectory() && STATIC_DATA_DIRECTORY_PATTERN.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name))[0];
    cachedStaticDirectoryPath = selectedEntry
      ? path.join(DATA_DIRECTORY_PATH, selectedEntry.name)
      : "";
  } catch (error) {
    cachedStaticDirectoryPath = "";
  }

  return cachedStaticDirectoryPath;
}

function parseJsonlFile(filePath, onRow) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }
    onRow(parsed);
  }
}

function freezeMaterialEntry(entry = {}) {
  return Object.freeze({
    materialTypeID: toInt(entry.materialTypeID, 0),
    quantity: Math.max(0, toInt(entry.quantity, 0)),
  });
}

function buildStaticPayload() {
  const materialsByTypeID = new Map();
  const compressedTypeBySourceTypeID = new Map();
  const sourceTypesByCompressedTypeID = new Map();
  const directoryPath = resolveLatestStaticDirectoryPath();

  if (!directoryPath) {
    return {
      materialsByTypeID,
      compressedTypeBySourceTypeID,
      sourceTypesByCompressedTypeID,
    };
  }

  parseJsonlFile(path.join(directoryPath, "typeMaterials.jsonl"), (row) => {
    const typeID = toInt(row && row._key, 0);
    if (typeID <= 0) {
      return;
    }

    const materialEntries = Object.freeze(
      (Array.isArray(row && row.materials) ? row.materials : [])
        .map((entry) => freezeMaterialEntry(entry))
        .filter((entry) => entry.materialTypeID > 0 && entry.quantity > 0),
    );
    if (materialEntries.length > 0) {
      materialsByTypeID.set(typeID, materialEntries);
    }
  });

  parseJsonlFile(path.join(directoryPath, "compressibleTypes.jsonl"), (row) => {
    const sourceTypeID = toInt(row && row._key, 0);
    const compressedTypeID = toInt(row && row.compressedTypeID, 0);
    if (sourceTypeID <= 0 || compressedTypeID <= 0) {
      return;
    }

    compressedTypeBySourceTypeID.set(sourceTypeID, compressedTypeID);
    if (!sourceTypesByCompressedTypeID.has(compressedTypeID)) {
      sourceTypesByCompressedTypeID.set(compressedTypeID, []);
    }
    sourceTypesByCompressedTypeID.get(compressedTypeID).push(sourceTypeID);
  });

  for (const [compressedTypeID, sourceTypeIDs] of sourceTypesByCompressedTypeID.entries()) {
    sourceTypesByCompressedTypeID.set(
      compressedTypeID,
      Object.freeze([...new Set(sourceTypeIDs)].sort((left, right) => left - right)),
    );
  }

  return {
    materialsByTypeID,
    compressedTypeBySourceTypeID,
    sourceTypesByCompressedTypeID,
  };
}

function ensureStaticPayload() {
  if (!cachedStaticPayload) {
    cachedStaticPayload = buildStaticPayload();
  }
  return cachedStaticPayload;
}

function getTypeMaterials(typeID) {
  return ensureStaticPayload().materialsByTypeID.get(toInt(typeID, 0)) || Object.freeze([]);
}

function hasTypeMaterials(typeID) {
  return getTypeMaterials(typeID).length > 0;
}

function getCompressedTypeID(sourceTypeID) {
  return ensureStaticPayload().compressedTypeBySourceTypeID.get(toInt(sourceTypeID, 0)) || null;
}

function isCompressibleType(sourceTypeID) {
  return getCompressedTypeID(sourceTypeID) !== null;
}

function getCompressionSourceTypeIDs(compressedTypeID) {
  return ensureStaticPayload().sourceTypesByCompressedTypeID.get(toInt(compressedTypeID, 0)) || Object.freeze([]);
}

function isCompressedType(typeID) {
  return getCompressionSourceTypeIDs(typeID).length > 0;
}

function getAdjustedAveragePrice(typeID) {
  const itemType = resolveItemByTypeID(toInt(typeID, 0));
  if (!itemType) {
    return 0;
  }
  const basePrice = Number(itemType.basePrice);
  return Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
}

function refreshMiningStaticData() {
  cachedStaticDirectoryPath = null;
  cachedStaticPayload = null;
  return ensureStaticPayload();
}

module.exports = {
  getTypeMaterials,
  hasTypeMaterials,
  getCompressedTypeID,
  isCompressibleType,
  getCompressionSourceTypeIDs,
  isCompressedType,
  getAdjustedAveragePrice,
  refreshMiningStaticData,
};

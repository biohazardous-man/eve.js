const path = require("path");

const {
  TABLE,
  clearReferenceCache,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const DEFAULT_CHARACTER_TYPE_ID = 1373;
// The client still expects these legacy character typeIDs for paperdoll payloads.
const BLOODLINE_CHARACTER_TYPE_ID = Object.freeze({
  1: 1373,
  2: 1374,
  3: 1375,
  4: 1376,
  5: 1377,
  6: 1378,
  7: 1379,
  8: 1380,
  11: 1383,
  12: 1384,
  13: 1385,
  14: 1386,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeStarterSkillEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typeID = toNumber(entry.typeID, 0);
  if (typeID <= 0) {
    return null;
  }

  return {
    typeID,
    level: Math.max(0, Math.min(5, toNumber(entry.level, 0))),
  };
}

function normalizeCharacterCreationRace(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const raceID = toNumber(entry.raceID, 0);
  if (raceID <= 0) {
    return null;
  }

  return {
    raceID,
    name: typeof entry.name === "string" ? entry.name : "",
    shipTypeID: toNumber(entry.shipTypeID, 0) || null,
    shipName: typeof entry.shipName === "string" ? entry.shipName : "",
    skills: (Array.isArray(entry.skills) ? entry.skills : [])
      .map((skillEntry) => normalizeStarterSkillEntry(skillEntry))
      .filter(Boolean),
  };
}

function normalizeCharacterCreationBloodline(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const bloodlineID = toNumber(entry.bloodlineID, 0);
  if (bloodlineID <= 0) {
    return null;
  }

  return {
    bloodlineID,
    name: typeof entry.name === "string" ? entry.name : "",
    raceID: toNumber(entry.raceID, 0) || null,
    corporationID: toNumber(entry.corporationID, 0) || null,
  };
}

function getCharacterCreationRaces(options = {}) {
  if (options && options.refresh) {
    clearReferenceCache(TABLE.CHARACTER_CREATION_RACES);
  }

  return readStaticRows(TABLE.CHARACTER_CREATION_RACES)
    .map((entry) => normalizeCharacterCreationRace(entry))
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
}

function getCharacterCreationRace(raceID, options = {}) {
  const numericRaceID = toNumber(raceID, 0);
  return (
    getCharacterCreationRaces(options).find((entry) => entry.raceID === numericRaceID) ||
    null
  );
}

function getCharacterCreationBloodlines(options = {}) {
  if (options && options.refresh) {
    clearReferenceCache(TABLE.CHARACTER_CREATION_BLOODLINES);
  }

  return readStaticRows(TABLE.CHARACTER_CREATION_BLOODLINES)
    .map((entry) => normalizeCharacterCreationBloodline(entry))
    .filter(Boolean)
    .map((entry) => cloneValue(entry));
}

function getCharacterCreationBloodline(bloodlineID, options = {}) {
  const numericBloodlineID = toNumber(bloodlineID, 0);
  return (
    getCharacterCreationBloodlines(options).find(
      (entry) => entry.bloodlineID === numericBloodlineID,
    ) || null
  );
}

function resolveCharacterCreationBloodlineProfile(bloodlineID, fallback = {}) {
  const numericBloodlineID = toNumber(bloodlineID, 0);
  const bloodline = getCharacterCreationBloodline(numericBloodlineID);
  return {
    bloodlineID: numericBloodlineID || toNumber(fallback.bloodlineID, 1) || 1,
    name: (bloodline && bloodline.name) || "",
    raceID:
      (bloodline && bloodline.raceID) ||
      toNumber(fallback.raceID, 1) ||
      1,
    corporationID:
      (bloodline && bloodline.corporationID) ||
      toNumber(fallback.corporationID, 1000009) ||
      1000009,
    typeID:
      BLOODLINE_CHARACTER_TYPE_ID[numericBloodlineID] ||
      toNumber(fallback.typeID, DEFAULT_CHARACTER_TYPE_ID) ||
      DEFAULT_CHARACTER_TYPE_ID,
  };
}

module.exports = {
  getCharacterCreationBloodline,
  getCharacterCreationBloodlines,
  getCharacterCreationRace,
  getCharacterCreationRaces,
  resolveCharacterCreationBloodlineProfile,
};

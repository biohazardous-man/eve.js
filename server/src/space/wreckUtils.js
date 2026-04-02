const path = require("path");

const {
  resolveShipByTypeID,
} = require(path.join(__dirname, "../services/chat/shipTypeRegistry"));
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));

const RACE_WRECK_PREFIX_BY_ID = Object.freeze({
  1: "Caldari",
  2: "Minmatar",
  4: "Amarr",
  8: "Gallente",
  32: "Jove",
  64: "CONCORD",
  128: "ORE",
  256: "Triglavian",
  512: "EDENCOM",
});

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

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
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

function buildDunRotationFromDirection(direction) {
  const forward = normalizeVector(direction, { x: 1, y: 0, z: 0 });
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(Math.max(-1, Math.min(1, forward.y))) * (180 / Math.PI);
  return [yawDegrees, pitchDegrees, 0];
}

function resolveShipWreckRacePrefix(shipMeta = {}, itemMeta = {}) {
  const raceID = toPositiveInt(
    shipMeta.raceID !== undefined ? shipMeta.raceID : itemMeta.raceID,
    0,
  );
  return RACE_WRECK_PREFIX_BY_ID[raceID] || null;
}

function resolveShipHullClassName(shipMeta = {}, itemMeta = {}) {
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  if (!groupName) {
    return null;
  }
  if (groupName.includes("titan")) {
    return "Titan";
  }
  if (groupName.includes("supercarrier")) {
    return "Supercarrier";
  }
  if (groupName.includes("carrier")) {
    return "Carrier";
  }
  if (groupName.includes("dread")) {
    return "Dreadnought";
  }
  if (groupName.includes("jump freighter") || groupName.includes("freighter")) {
    return "Freighter";
  }
  if (groupName.includes("mining barge") || groupName.includes("barge") || groupName.includes("exhumer")) {
    return "Mining Barge";
  }
  if (groupName.includes("industrial") || groupName.includes("hauler") || groupName.includes("transport ship")) {
    return "Hauler";
  }
  if (groupName.includes("battleship") || groupName.includes("marauder") || groupName.includes("black ops")) {
    return "Battleship";
  }
  if (groupName.includes("battlecruiser") || groupName.includes("command ship")) {
    return "Battlecruiser";
  }
  if (groupName.includes("cruiser") || groupName.includes("heavy interdictor") || groupName.includes("strategic cruiser")) {
    return "Cruiser";
  }
  if (groupName.includes("destroyer") || groupName.includes("interdictor")) {
    return "Destroyer";
  }
  if (groupName.includes("shuttle")) {
    return "Shuttle";
  }
  if (groupName.includes("frigate") || groupName.includes("corvette")) {
    return "Frigate";
  }
  return null;
}

function buildShipWreckCandidateNames(shipMeta = {}, itemMeta = {}) {
  const hullClassName = resolveShipHullClassName(shipMeta, itemMeta);
  const racePrefix = resolveShipWreckRacePrefix(shipMeta, itemMeta);
  const groupName = String(
    shipMeta.groupName ||
    itemMeta.groupName ||
    "",
  ).trim().toLowerCase();
  const candidates = [];

  if (groupName.includes("capsule")) {
    candidates.push("Mysterious Capsule Wreck");
  }
  if (racePrefix && hullClassName) {
    candidates.push(`${racePrefix} ${hullClassName} Wreck`);
  }
  if (hullClassName) {
    candidates.push(`${hullClassName} Wreck`);
  }
  candidates.push("Wreck");
  return [...new Set(candidates)];
}

function resolveShipWreckType(shipTypeID) {
  const shipMeta = resolveShipByTypeID(shipTypeID) || {};
  const itemMeta = resolveItemByTypeID(shipTypeID) || {};
  const candidates = buildShipWreckCandidateNames(shipMeta, itemMeta);

  for (const candidate of candidates) {
    const lookup = resolveItemByName(candidate);
    if (
      lookup &&
      lookup.success &&
      lookup.match &&
      String(lookup.match.groupName || "").trim().toLowerCase() === "wreck"
    ) {
      return lookup.match;
    }
  }

  return null;
}

module.exports = {
  buildDunRotationFromDirection,
  resolveShipWreckType,
};

const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStandingData(record = {}) {
  const source =
    record && record.standingData && typeof record.standingData === "object"
      ? record.standingData
      : {};
  return [
    ...(Array.isArray(source.char) ? source.char : []),
    ...(Array.isArray(source.corp) ? source.corp : []),
    ...(Array.isArray(source.npc) ? source.npc : []),
  ];
}

function dedupePositiveIntegers(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => toInt(value, 0))
      .filter((value) => value > 0),
  )];
}

function resolveEntityCharacterID(entity) {
  return toInt(
    entity &&
      entity.session &&
      entity.session.characterID
      ? entity.session.characterID
      : entity && (
        entity.characterID ??
        entity.pilotCharacterID
      ),
    0,
  );
}

function resolveEntityOwnerIDs(entity) {
  return dedupePositiveIntegers([
    entity && entity.ownerID,
    entity && entity.corporationID,
    entity && entity.factionID,
    entity && entity.warFactionID,
    entity && entity.allianceID,
  ]);
}

function buildStandingSourceIDs(characterID, characterRecord = {}) {
  return dedupePositiveIntegers([
    characterID,
    characterRecord && characterRecord.corporationID,
    characterRecord && characterRecord.allianceID,
    characterRecord && characterRecord.factionID,
    characterRecord && characterRecord.warFactionID,
  ]);
}

function getSourcePriority(sourceID, characterID) {
  if (toInt(sourceID, 0) === toInt(characterID, 0)) {
    return 3;
  }
  return 2;
}

function resolveStandingValue(characterID, targetOwnerIDs = []) {
  const normalizedCharacterID = toInt(characterID, 0);
  const normalizedTargetOwnerIDs = dedupePositiveIntegers(targetOwnerIDs);
  if (normalizedCharacterID <= 0 || normalizedTargetOwnerIDs.length <= 0) {
    return {
      characterID: normalizedCharacterID,
      standing: 0,
      matchedOwnerID: 0,
      matchedSourceID: 0,
      matchedEntry: null,
    };
  }

  const characterRecord = getCharacterRecord(normalizedCharacterID) || {};
  const sourceIDs = new Set(
    buildStandingSourceIDs(normalizedCharacterID, characterRecord),
  );
  const standingRows = normalizeStandingData(characterRecord);
  let bestMatch = null;
  let bestPriority = -1;
  let bestAbsoluteStanding = -1;

  for (const row of standingRows) {
    const fromID = toInt(row && row.fromID, 0);
    const toID = toInt(row && row.toID, 0);
    if (!sourceIDs.has(fromID) || !normalizedTargetOwnerIDs.includes(toID)) {
      continue;
    }

    const standing = toFiniteNumber(row && row.standing, 0);
    const priority = getSourcePriority(fromID, normalizedCharacterID);
    const absoluteStanding = Math.abs(standing);
    if (
      !bestMatch ||
      priority > bestPriority ||
      (
        priority === bestPriority &&
        absoluteStanding > bestAbsoluteStanding
      )
    ) {
      bestMatch = {
        characterID: normalizedCharacterID,
        standing,
        matchedOwnerID: toID,
        matchedSourceID: fromID,
        matchedEntry: {
          fromID,
          toID,
          standing,
        },
      };
      bestPriority = priority;
      bestAbsoluteStanding = absoluteStanding;
    }
  }

  return bestMatch || {
    characterID: normalizedCharacterID,
    standing: 0,
    matchedOwnerID: 0,
    matchedSourceID: 0,
    matchedEntry: null,
  };
}

function hasGenericNpcThresholds(hostileResponseThreshold, friendlyResponseThreshold) {
  return (
    hostileResponseThreshold === 11 &&
    friendlyResponseThreshold === 11
  );
}

function resolveStandingThresholdsForEntity(entity) {
  const hostileResponseThreshold = toFiniteNumber(
    entity && entity.hostileResponseThreshold,
    NaN,
  );
  const friendlyResponseThreshold = toFiniteNumber(
    entity && entity.friendlyResponseThreshold,
    NaN,
  );

  if (
    Number.isFinite(hostileResponseThreshold) &&
    Number.isFinite(friendlyResponseThreshold) &&
    !hasGenericNpcThresholds(hostileResponseThreshold, friendlyResponseThreshold)
  ) {
    return {
      hostileResponseThreshold,
      friendlyResponseThreshold,
      source: "entity",
    };
  }

  const configuredHostileThreshold = toFiniteNumber(
    config.miningNpcHostileStandingThreshold,
    -5,
  );
  const configuredFriendlyThreshold = Math.max(
    configuredHostileThreshold,
    toFiniteNumber(
      config.miningNpcFriendlyStandingThreshold,
      5,
    ),
  );
  return {
    hostileResponseThreshold: configuredHostileThreshold,
    friendlyResponseThreshold: configuredFriendlyThreshold,
    source: "config",
  };
}

function classifyStandingValue(standing, thresholds = {}) {
  const numericStanding = toFiniteNumber(standing, 0);
  if (numericStanding <= toFiniteNumber(thresholds.hostileResponseThreshold, -5)) {
    return "hostile";
  }
  if (numericStanding >= toFiniteNumber(thresholds.friendlyResponseThreshold, 5)) {
    return "friendly";
  }
  return "neutral";
}

function resolveAggressorStandingProfile(aggressorEntity, npcEntity) {
  const characterID = resolveEntityCharacterID(aggressorEntity);
  const ownerIDs = resolveEntityOwnerIDs(npcEntity);
  const thresholds = resolveStandingThresholdsForEntity(npcEntity);
  const standingResult = resolveStandingValue(characterID, ownerIDs);
  return {
    ...standingResult,
    ownerIDs,
    thresholds,
    standingClass: classifyStandingValue(standingResult.standing, thresholds),
  };
}

module.exports = {
  resolveEntityCharacterID,
  resolveEntityOwnerIDs,
  resolveStandingValue,
  resolveStandingThresholdsForEntity,
  classifyStandingValue,
  resolveAggressorStandingProfile,
};

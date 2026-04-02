const path = require("path");

const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
const {
  getSessionStationID,
  getSessionStructureID,
} = require(path.join(__dirname, "../structure/structureLocation"));

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function buildGuestIdentityTuple(session) {
  return [
    normalizePositiveInt(
      session && (session.characterID || session.charid),
      0,
    ),
    normalizePositiveInt(
      session && (session.corporationID || session.corpid),
      0,
    ),
    normalizePositiveInt(
      session && (session.allianceID || session.allianceid),
      0,
    ),
    normalizePositiveInt(
      session && (session.warFactionID || session.warfactionid),
      0,
    ),
  ];
}

function buildStructureGuestTuple(session) {
  const [, corporationID, allianceID, warFactionID] = buildGuestIdentityTuple(session);
  return [corporationID, allianceID, warFactionID];
}

function getStationGuestTuples(stationID) {
  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return [];
  }

  return sessionRegistry
    .getSessions()
    .filter((guestSession) => getSessionStationID(guestSession) === resolvedStationID)
    .map((guestSession) => buildGuestIdentityTuple(guestSession))
    .filter(([characterID]) => characterID > 0)
    .sort((left, right) => left[0] - right[0]);
}

function getStructureGuestEntries(structureID) {
  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return [];
  }

  return sessionRegistry
    .getSessions()
    .filter((guestSession) => getSessionStructureID(guestSession) === resolvedStructureID)
    .map((guestSession) => {
      const [characterID] = buildGuestIdentityTuple(guestSession);
      return [characterID, buildStructureGuestTuple(guestSession)];
    })
    .filter(([characterID]) => characterID > 0)
    .sort((left, right) => left[0] - right[0]);
}

function broadcastStationGuestJoined(session, stationID) {
  const guestTuple = buildGuestIdentityTuple(session);
  if (!guestTuple[0]) {
    return;
  }

  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (guestSession === session) {
      continue;
    }
    if (getSessionStationID(guestSession) !== resolvedStationID) {
      continue;
    }

    guestSession.sendNotification("OnCharNowInStation", "stationid", [guestTuple]);
  }
}

function broadcastStationGuestLeft(session, stationID) {
  const guestTuple = buildGuestIdentityTuple(session);
  if (!guestTuple[0]) {
    return;
  }

  const resolvedStationID = normalizePositiveInt(stationID, 0);
  if (!resolvedStationID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (guestSession === session) {
      continue;
    }
    if (getSessionStationID(guestSession) !== resolvedStationID) {
      continue;
    }

    guestSession.sendNotification("OnCharNoLongerInStation", "stationid", [guestTuple]);
  }
}

function broadcastStructureGuestJoined(session, structureID) {
  const guestTuple = buildGuestIdentityTuple(session);
  if (!guestTuple[0]) {
    return;
  }

  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (guestSession === session) {
      continue;
    }
    if (getSessionStructureID(guestSession) !== resolvedStructureID) {
      continue;
    }

    guestSession.sendNotification(
      "OnCharacterEnteredStructure",
      "clientID",
      guestTuple,
    );
  }
}

function broadcastStructureGuestLeft(session, structureID) {
  const [characterID] = buildGuestIdentityTuple(session);
  if (!characterID) {
    return;
  }

  const resolvedStructureID = normalizePositiveInt(structureID, 0);
  if (!resolvedStructureID) {
    return;
  }

  for (const guestSession of sessionRegistry.getSessions()) {
    if (guestSession === session) {
      continue;
    }
    if (getSessionStructureID(guestSession) !== resolvedStructureID) {
      continue;
    }

    guestSession.sendNotification("OnCharacterLeftStructure", "clientID", [
      characterID,
    ]);
  }
}

module.exports = {
  broadcastStationGuestJoined,
  broadcastStationGuestLeft,
  broadcastStructureGuestJoined,
  broadcastStructureGuestLeft,
  buildGuestIdentityTuple,
  getStationGuestTuples,
  getStructureGuestEntries,
  normalizePositiveInt,
};

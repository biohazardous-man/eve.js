const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const worldData = require(path.join(__dirname, "../worldData"));
const {
  ensureMigrated,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));

const CHARACTERS_TABLE = "characters";
const NPC_RUNTIME_STATE_TABLE = "npcRuntimeState";
const NPC_CHARACTER_ID_START = 980000000;
let nextTransientCharacterID = null;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFileTimeString(nowMs = Date.now()) {
  return (
    (BigInt(Math.trunc(Number(nowMs) || Date.now())) * 10000n) +
    116444736000000000n
  ).toString();
}

function readRuntimeState() {
  const result = database.read(NPC_RUNTIME_STATE_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {
      nextCharacterID: NPC_CHARACTER_ID_START,
      nextSequence: 1,
    };
  }

  return {
    nextCharacterID: toPositiveInt(result.data.nextCharacterID, NPC_CHARACTER_ID_START),
    nextSequence: toPositiveInt(result.data.nextSequence, 1),
  };
}

function writeRuntimeState(state) {
  return database.write(NPC_RUNTIME_STATE_TABLE, "/", state);
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function allocateNpcIdentity() {
  const runtimeState = readRuntimeState();
  const characters = readCharacters();
  let nextCharacterID = toPositiveInt(
    runtimeState.nextCharacterID,
    NPC_CHARACTER_ID_START,
  );

  while (characters[String(nextCharacterID)]) {
    nextCharacterID += 1;
  }

  const nextSequence = toPositiveInt(runtimeState.nextSequence, 1);
  writeRuntimeState({
    nextCharacterID: nextCharacterID + 1,
    nextSequence: nextSequence + 1,
  });

  return {
    characterID: nextCharacterID,
    sequence: nextSequence,
  };
}

function allocateTransientNpcIdentity() {
  if (nextTransientCharacterID === null) {
    const runtimeState = readRuntimeState();
    const characters = readCharacters();
    let maxCharacterID = Math.max(
      toPositiveInt(runtimeState.nextCharacterID, NPC_CHARACTER_ID_START),
      NPC_CHARACTER_ID_START,
    );
    for (const charIdKey of Object.keys(characters)) {
      maxCharacterID = Math.max(maxCharacterID, toPositiveInt(charIdKey, 0));
    }
    nextTransientCharacterID = maxCharacterID + 1;
  }

  const allocatedCharacterID = nextTransientCharacterID;
  nextTransientCharacterID += 1;
  return {
    characterID: allocatedCharacterID,
    sequence: 1,
  };
}

function buildNpcCharacterRecord(characterID, profile, systemID, sequence, options = {}) {
  const nowFileTime = toFileTimeString();
  const solarSystem = worldData.getSolarSystemByID(systemID) || {};
  const characterName = String(
    options.characterName ||
      options.shipName ||
      profile.shipNameTemplate ||
      profile.name ||
      `NPC ${sequence}`,
  ).trim();

  return {
    accountId: 0,
    characterName,
    gender: 1,
    bloodlineID: 1,
    ancestryID: 1,
    raceID: 1,
    typeID: 1380,
    corporationID: toPositiveInt(profile.corporationID, 1000001),
    allianceID: toPositiveInt(profile.allianceID, 0),
    factionID: toPositiveInt(profile.factionID, 0) || null,
    stationID: null,
    solarSystemID: toPositiveInt(systemID, 30000142),
    constellationID: toPositiveInt(solarSystem.constellationID, 0),
    regionID: toPositiveInt(solarSystem.regionID, 0),
    createDateTime: nowFileTime,
    startDateTime: nowFileTime,
    logoffDate: nowFileTime,
    deletePrepareDateTime: null,
    lockTypeID: null,
    securityRating: Number(profile.securityStatus || 0) || 0,
    securityStatus: Number(profile.securityStatus || 0) || 0,
    title: String(options.title || profile.name || "NPC"),
    description: String(options.description || profile.description || "Synthetic NPC owner"),
    balance: 0,
    aurBalance: 0,
    plexBalance: 0,
    balanceChange: 0,
    skillPoints: 0,
    shipTypeID: toPositiveInt(profile.shipTypeID, 606),
    shipName: characterName,
    bounty: Number(profile.bounty || 0) || 0,
    skillQueueEndTime: 0,
    daysLeft: 365,
    userType: 30,
    paperDollState: 0,
    petitionMessage: "",
    worldSpaceID: 0,
    unreadMailCount: 0,
    upcomingEventCount: 0,
    unprocessedNotifications: 0,
    shipID: 0,
    shortName: "npc",
    employmentHistory: [
      {
        corporationID: toPositiveInt(profile.corporationID, 1000001),
        startDate: nowFileTime,
        deleted: 0,
      },
    ],
    standingData: {
      char: [],
      corp: [],
      npc: [],
    },
    characterAttributes: {
      charisma: 20,
      intelligence: 20,
      memory: 20,
      perception: 20,
      willpower: 20,
    },
    respecInfo: {
      freeRespecs: 0,
      lastRespecDate: null,
      nextTimedRespec: null,
    },
    freeSkillPoints: 0,
    skillHistory: [],
    boosters: [],
    implants: [],
    jumpClones: [],
    timeLastCloneJump: "0",
    allianceMemberStartDate: 0,
    skillTypeID: null,
    toLevel: null,
    trainingStartTime: null,
    trainingEndTime: null,
    queueEndTime: null,
    finishSP: null,
    trainedSP: null,
    finishedSkills: [],
  };
}

function createNpcCharacter(profile, systemID, options = {}) {
  ensureMigrated();

  const transient = options.transient === true;
  const identity = transient
    ? allocateTransientNpcIdentity()
    : allocateNpcIdentity();
  const record = buildNpcCharacterRecord(
    identity.characterID,
    profile,
    systemID,
    identity.sequence,
    options,
  );
  const writeResult = database.write(
    CHARACTERS_TABLE,
    `/${String(identity.characterID)}`,
    record,
    {
      transient,
    },
  );
  if (!writeResult || !writeResult.success) {
    return {
      success: false,
      errorMsg: "CHARACTER_WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: {
      characterID: identity.characterID,
      sequence: identity.sequence,
      record,
    },
  };
}

module.exports = {
  createNpcCharacter,
};

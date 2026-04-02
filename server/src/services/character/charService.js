/**
 * CHARACTER SERVICE
 * (skeleton code by AI, updated by Icey)
 *
 * handles character selection, creation, and related operations
 *
 * TODO: update support for new database controller
 */

const BaseService = require("../baseService");
const log = require("../../utils/logger");
const database = require("../../newDatabase");
const sessionRegistry = require("../chat/sessionRegistry");
const { throwWrappedUserError } = require("../../common/machoErrors");
const {
  applyCharacterToSession,
  flushCharacterSessionNotificationPlan,
  getCharacterRecord,
  updateCharacterRecord,
} = require("./characterState");
const {
  getCharacterCreationBloodlines,
  getCharacterCreationRace,
  getCharacterCreationRaces,
  resolveCharacterCreationBloodlineProfile,
} = require("./characterCreationData");
const { restoreSpaceSession } = require("../../space/transitions");
const {
  getCharacterSkillPointTotal,
} = require("../skills/skillState");
const {
  ACCOUNT_KEY,
  JOURNAL_CURRENCY,
  JOURNAL_ENTRY_TYPE,
} = require("../account/walletState");
const {
  PLEX_LOG_CATEGORY,
  getTransactionID,
} = require("../account/plexVaultLogState");
const {
  clonePaperDollPayload,
  resolvePaperDollState,
} = require("./paperDollPayloads");
const {
  broadcastStationGuestJoined,
  broadcastStructureGuestJoined,
} = require("../_shared/guestLists");

/**
 * Build a util.KeyVal PyObject — the only working PyObject type in V23.02
 */
function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function unwrapCreationArg(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapCreationArg(value.value);
    }
    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      return unwrapCreationArg(value.name);
    }
  }

  return value;
}

function readCreationIntArg(args, index, fallback, legacyIndex = null) {
  const rawPrimary = args && args.length > index ? unwrapCreationArg(args[index]) : undefined;
  const rawLegacy =
    legacyIndex !== null && args && args.length > legacyIndex
      ? unwrapCreationArg(args[legacyIndex])
      : undefined;
  const candidate =
    rawPrimary !== undefined && rawPrimary !== null && rawPrimary !== ""
      ? rawPrimary
      : rawLegacy;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeCreationGender(value, fallback = 1) {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function isModernCreateCharacterSignature(args) {
  return Array.isArray(args) && args.length >= 8;
}

function readCreationPayloadArg(args, index, legacyIndex = null) {
  const candidate =
    args && args.length > index
      ? args[index]
      : legacyIndex !== null && args && args.length > legacyIndex
        ? args[legacyIndex]
        : null;

  return clonePaperDollPayload(candidate);
}

function readKeywordArg(kwargs, keys = []) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    for (const key of keys) {
      const entry = kwargs.entries.find((candidate) => candidate[0] === key);
      if (entry) {
        return unwrapCreationArg(entry[1]);
      }
    }
    return undefined;
  }

  if (typeof kwargs === "object") {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
        return unwrapCreationArg(kwargs[key]);
      }
    }
  }

  return undefined;
}

function readKeywordIntArg(kwargs, keys = [], fallback = 0) {
  const numeric = Number(readKeywordArg(kwargs, keys));
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveCharacterRequestId(args, kwargs, fallback = 0) {
  const directArg =
    args && args.length > 0 ? Number(unwrapCreationArg(args[0])) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }

  return readKeywordIntArg(kwargs, ["charID", "characterID"], fallback);
}

function summarizeCreationArg(value, depth = 0) {
  if (depth > 3) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    const summarized = value
      .slice(0, 8)
      .map((entry) => summarizeCreationArg(entry, depth + 1));
    if (value.length > 8) {
      summarized.push(`<+${value.length - 8} more>`);
    }
    return summarized;
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value).slice(0, 8)) {
      summary[key] = summarizeCreationArg(entryValue, depth + 1);
    }
    if (Object.keys(value).length > 8) {
      summary.__truncated__ = `<+${Object.keys(value).length - 8} more>`;
    }
    return summary;
  }

  return String(value);
}

class CharService extends BaseService {
  constructor() {
    super("charUnboundMgr");
  }

  _normalizeAllianceId(value) {
    const numeric = Number(value) || 0;
    return numeric > 0 ? numeric : null;
  }

  /**
   * GetCharactersToSelect — V23.02 client calls this locally, which
   * internally calls GetCharacterSelectionData remotely. This handler
   * may still be called by older clients.
   */
  Handle_GetCharactersToSelect(args, session) {
    log.info("[CharService] GetCharactersToSelect");

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    const userId = session ? session.userid : 0;

    const charList = [];
    for (const [charId, charData] of Object.entries(characters)) {
      if (charData.accountId === userId) {
        charList.push(
          buildKeyVal([
            ["characterID", parseInt(charId, 10)],
            ["characterName", charData.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", charData.gender || 1],
            ["typeID", charData.typeID || 1373],
          ]),
        );
      }
    }

    log.debug(
      `[CharService] Returning ${charList.length} characters for userId=${userId}`,
    );

    return { type: "list", items: charList };
  }

  /**
   * GetCharacterSelectionData — V23.02 primary entry point.
   *
   * From decompiled charselData.py line 31:
   *   userDetails, trainingDetails, characterDetails, wars = \
   *       self.charRemoteSvc.GetCharacterSelectionData()
   *
   * Returns 4-tuple: (userDetails, trainingDetails, characterDetails, wars)
   */
  Handle_GetCharacterSelectionData(args, session) {
    log.debug("[CharService] GetCharacterSelectionData");

    const accountResult = database.read("accounts", "/");
    const accounts = accountResult.success ? accountResult.data : {};

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};

    const userId = session ? session.userid : 0;
    let accountUsername = "user";
    if (accounts) {
      for (const [username, acct] of Object.entries(accounts)) {
        if (acct.id === userId) {
          accountUsername = username;
          break;
        }
      }
    }

    const userDetailsKeyVal = buildKeyVal([
      ["characterSlots", 3],
      ["userName", accountUsername],
      ["creationDate", { type: "long", value: 132000000000000000 }],
      ["subscriptionEndTime", { type: "long", value: 157469184000000000 }],
      ["maxCharacterSlots", 3],
    ]);
    const userDetails = { type: "list", items: [userDetailsKeyVal] };

    const trainingDetails = [null, null];

    const characterDetails = [];
    for (const [charId, rawCharacter] of Object.entries(characters)) {
      if (rawCharacter.accountId === userId) {
        const character = getCharacterRecord(charId) || rawCharacter;
        const cid = parseInt(charId, 10);
        const allianceID = this._normalizeAllianceId(character.allianceID);
        const skillPoints = getCharacterSkillPointTotal(cid) || character.skillPoints || 50000;
        const paperDollState = resolvePaperDollState(character, 2);
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", character.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", character.gender || 1],
            ["typeID", character.typeID || 1373],
            ["raceID", character.raceID || 1],
            ["bloodlineID", character.bloodlineID || 1],
            ["ancestryID", character.ancestryID || 1],
            ["schoolID", character.schoolID ?? character.corporationID ?? null],
            ["corporationID", character.corporationID || 1000009],
            ["allianceID", allianceID],
            // Keep character-select payload close to upstream.
            // Exposing empire/school/faction state here caused the client to
            // incorrectly surface war/faction UI on the selection screen.
            ["factionID", null],
            ["stationID", character.stationID ?? null],
            ["solarSystemID", character.solarSystemID || 30000142],
            ["constellationID", character.constellationID || 20000020],
            ["regionID", character.regionID || 10000002],
            ["balance", character.balance ?? 100000.0],
            ["plexBalance", character.plexBalance ?? 2222],
            ["balanceChange", 0.0],
            ["skillPoints", skillPoints],
            ["shipTypeID", character.shipTypeID || 606],
            ["shipName", character.shipName || "Velator"],
            ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
            ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
            ["title", character.title || ""],
            ["unreadMailCount", character.unreadMailCount || 0],
            ["paperdollState", paperDollState],
            ["lockTypeID", null],
            [
              "logoffDate",
              { type: "long", value: character.logoffDate || 132000000000000000 },
            ],
            ["skillTypeID", null],
            ["toLevel", null],
            ["trainingStartTime", null],
            ["trainingEndTime", null],
            ["queueEndTime", null],
            ["finishSP", null],
            ["trainedSP", null],
            ["finishedSkills", { type: "list", items: [] }],
          ]),
        );
      }
    }

    const wars = { type: "list", items: [] };

    log.debug(
      `[CharService] GetCharacterSelectionData: returning ${characterDetails.length} chars`,
    );

    return [
      userDetails,
      trainingDetails,
      { type: "list", items: characterDetails },
      wars,
    ];
  }

  /**
   * GetCharacterToSelect — returns detailed info for one character
   */
  Handle_GetCharacterToSelect(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const character = getCharacterRecord(charId) || characters[String(charId)];
    const allianceID = this._normalizeAllianceId(character && character.allianceID);
    const skillPoints =
      getCharacterSkillPointTotal(charId) ||
      (character && character.skillPoints) ||
      50000;
    const paperDollState = resolvePaperDollState(character, 2);

    if (!character) {
      log.warn(`[CharService] Character ${charId} not found`);
      return null;
    }

    return buildKeyVal([
      ["unreadMailCount", character.unreadMailCount || 0],
      ["upcomingEventCount", character.upcomingEventCount || 0],
      ["unprocessedNotifications", character.unprocessedNotifications || 0],
      ["characterID", parseInt(charId, 10)],
      ["petitionMessage", character.petitionMessage || ""],
      ["gender", character.gender || 1],
      ["raceID", character.raceID || 1],
      ["bloodlineID", character.bloodlineID || 1],
      ["ancestryID", character.ancestryID || 1],
      ["schoolID", character.schoolID ?? character.corporationID ?? null],
      [
        "createDateTime",
        { type: "long", value: character.createDateTime || 132000000000000000 },
      ],
      [
        "startDateTime",
        { type: "long", value: character.startDateTime || 132000000000000000 },
      ],
      ["corporationID", character.corporationID || 1000009],
      ["worldSpaceID", character.worldSpaceID || 0],
      ["stationID", character.stationID ?? null],
      ["solarSystemID", character.solarSystemID || 30000142],
      ["constellationID", character.constellationID || 20000020],
      ["regionID", character.regionID || 10000002],
      ["allianceID", allianceID],
      ["allianceMemberStartDate", allianceID ? character.allianceMemberStartDate || 0 : null],
      ["shortName", character.shortName || "none"],
      ["bounty", character.bounty || 0.0],
      ["skillQueueEndTime", { type: "long", value: character.skillQueueEndTime || 0 }],
      ["skillPoints", skillPoints],
      ["shipTypeID", character.shipTypeID || 606],
      ["shipName", character.shipName || "Ship"],
      ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
      ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
      ["title", character.title || ""],
      ["balance", character.balance ?? 100000.0],
      ["aurBalance", character.aurBalance ?? 0.0],
      ["plexBalance", character.plexBalance ?? 2222],
      ["daysLeft", character.daysLeft || 365],
      ["userType", character.userType || 30],
      ["paperDollState", paperDollState],
      ["paperdollState", paperDollState],
    ]);
  }

  /**
   * CreateCharacterWithDoll — V23.02 character creation
   * V23.02 signature: (characterName, raceID, bloodlineID, genderID, ancestryID, characterInfo, portraitInfo, schoolID)
   * Legacy EVEmu signature: (characterName, bloodlineID, genderID, ancestryID, characterInfo, portraitInfo, schoolID)
   * Returns the new characterID
   */
  Handle_CreateCharacterWithDoll(args, session) {
    const modernSignature = isModernCreateCharacterSignature(args);
    let characterName = args && args.length > 0 ? args[0] : "New Character";
    const raceID = modernSignature ? readCreationIntArg(args, 1, 1) : 1;
    const bloodlineID = modernSignature
      ? readCreationIntArg(args, 2, 1)
      : readCreationIntArg(args, 1, 1);
    const parsedGenderID = modernSignature
      ? readCreationIntArg(args, 3, 1)
      : readCreationIntArg(args, 2, 1);
    const genderID = normalizeCreationGender(parsedGenderID, 1);
    const ancestryID = modernSignature
      ? readCreationIntArg(args, 4, 1)
      : readCreationIntArg(args, 3, 1);
    const charInfo = modernSignature
      ? readCreationPayloadArg(args, 5)
      : readCreationPayloadArg(args, 4);
    const portraitInfo = modernSignature
      ? readCreationPayloadArg(args, 6)
      : readCreationPayloadArg(args, 5);
    const schoolID = modernSignature
      ? readCreationIntArg(args, 7, 11)
      : readCreationIntArg(args, 6, 11, 7);

    if (Buffer.isBuffer(characterName)) {
      characterName = characterName.toString("utf8");
    } else if (characterName && typeof characterName === "object") {
      characterName =
        characterName.value ||
        characterName.name ||
        JSON.stringify(characterName);
    }

    log.info(
      `[CharService] CreateCharacterWithDoll rawArgs=${JSON.stringify(
        summarizeCreationArg(args),
      )}`,
    );
    if (parsedGenderID !== genderID) {
      log.warn(
        `[CharService] CreateCharacterWithDoll clamped invalid gender=${parsedGenderID} -> ${genderID}`,
      );
    }
    log.info(
      `[CharService] CreateCharacterWithDoll: name="${characterName}" race=${raceID} bloodline=${bloodlineID} gender=${genderID} ancestry=${ancestryID} school=${schoolID} modern=${modernSignature}`,
    );

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};

    const existingIds = Object.keys(characters).map(Number);
    const newCharId =
      existingIds.length > 0 ? Math.max(...existingIds) + 1 : 140000001;

    const bloodlineProfile = resolveCharacterCreationBloodlineProfile(
      bloodlineID,
      {
        raceID: raceID || 1,
        typeID: 1373,
        corporationID: 1000009,
      },
    );
    const raceProfile = getCharacterCreationRace(bloodlineProfile.raceID) || null;
    const starterShipTypeID = Number((raceProfile && raceProfile.shipTypeID) || 606) || 606;
    const starterShipName =
      (raceProfile && raceProfile.shipName) || "Velator";
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const initialWalletReason = "Initial character creation ISK grant";
    const initialPlexReason = "Initial character creation PLEX grant";
    const initialWalletTransactionID = getTransactionID();
    const initialPlexTransactionID = getTransactionID();

    characters[String(newCharId)] = {
      accountId: session ? session.userid : 1,
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
      gender: genderID,
      bloodlineID,
      ancestryID,
      raceID: bloodlineProfile.raceID,
      typeID: bloodlineProfile.typeID,
      corporationID: bloodlineProfile.corporationID,
      schoolID: schoolID || bloodlineProfile.corporationID,
      allianceID: 0,
      factionID: null,
      stationID: 60003760,
      homeStationID: 60003760,
      cloneStationID: 60003760,
      solarSystemID: 30000142,
      constellationID: 20000020,
      regionID: 10000002,
      createDateTime: now.toString(),
      startDateTime: now.toString(),
      logoffDate: now.toString(),
      deletePrepareDateTime: null,
      lockTypeID: null,
      securityRating: 0.0,
      title: "",
      description: "Character created via EVE.js",
      balance: 100000.0,
      aurBalance: 0.0,
      plexBalance: 2222,
      balanceChange: 0.0,
      walletJournal: [
        {
          transactionID: initialWalletTransactionID,
          transactionDate: now.toString(),
          referenceID: newCharId,
          entryTypeID: JOURNAL_ENTRY_TYPE.GM_CASH_TRANSFER,
          ownerID1: newCharId,
          ownerID2: newCharId,
          accountKey: ACCOUNT_KEY.CASH,
          amount: 100000.0,
          balance: 100000.0,
          description: initialWalletReason,
          currency: JOURNAL_CURRENCY.ISK,
          sortValue: 1,
        },
      ],
      plexVaultTransactions: [
        {
          transactionID: initialPlexTransactionID,
          transactionDate: now.toString(),
          amount: 2222,
          balance: 2222,
          categoryMessageID: PLEX_LOG_CATEGORY.CCP,
          summaryMessageID: PLEX_LOG_CATEGORY.CCP,
          summaryText: initialPlexReason,
          reason: initialPlexReason,
        },
      ],
      skillPoints: 50000,
      shipTypeID: starterShipTypeID,
      shipName: starterShipName,
      bounty: 0.0,
      skillQueueEndTime: 0,
      daysLeft: 365,
      userType: 30,
      petitionMessage: "",
      worldSpaceID: 0,
      unreadMailCount: 0,
      upcomingEventCount: 0,
      unprocessedNotifications: 0,
      shipID: newCharId + 100,
      shortName: "none",
      employmentHistory: [
        {
          corporationID: bloodlineProfile.corporationID,
          startDate: now.toString(),
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
        freeRespecs: 3,
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
      appearanceInfo: charInfo,
      portraitInfo,
      paperDollState: charInfo ? 0 : 2,
    };

    database.write(
      "characters",
      `/${String(newCharId)}`,
      characters[String(newCharId)],
    );
    const createdCharacter = getCharacterRecord(newCharId);

    log.success(
      `[CharService] Created character "${characterName}" with ID ${newCharId} ship=${createdCharacter ? createdCharacter.shipID : "unknown"}`,
    );

    return newCharId;
  }

  Handle_GetNumCharacters(args, session) {
    const userId = session ? session.userid : 0;
    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    return Object.values(characters).filter(
      (character) => character && character.accountId === userId,
    ).length;
  }

  Handle_UpdateCharacterGender(args, session) {
    const charId = readCreationIntArg(args, 0, 0);
    const requestedGenderID = readCreationIntArg(args, 1, 1);
    const genderID = normalizeCreationGender(requestedGenderID, 1);

    log.info(
      `[CharService] UpdateCharacterGender(${charId}) gender=${genderID}`,
    );

    const updateResult = updateCharacterRecord(charId, (record) => ({
      ...record,
      gender: genderID,
    }));
    if (!updateResult.success) {
      log.warn(
        `[CharService] UpdateCharacterGender failed for ${charId}: ${updateResult.errorMsg}`,
      );
      return null;
    }

    if (session && Number(session.charid || session.characterID || 0) === Number(charId)) {
      session.genderID = genderID;
      session.genderid = genderID;
    }

    return null;
  }

  Handle_UpdateCharacterBloodline(args, session) {
    const charId = readCreationIntArg(args, 0, 0);
    const bloodlineID = readCreationIntArg(args, 1, 1);
    const currentRecord = getCharacterRecord(charId);
    if (!currentRecord) {
      log.warn(`[CharService] UpdateCharacterBloodline(${charId}) missing character`);
      return null;
    }

    const bloodlineProfile = resolveCharacterCreationBloodlineProfile(
      bloodlineID,
      {
        raceID: currentRecord.raceID || 1,
        typeID: currentRecord.typeID || 1373,
        corporationID: currentRecord.corporationID || 1000009,
      },
    );

    log.info(
      `[CharService] UpdateCharacterBloodline(${charId}) bloodline=${bloodlineID} race=${bloodlineProfile.raceID}`,
    );

    const updateResult = updateCharacterRecord(charId, (record) => ({
      ...record,
      bloodlineID: bloodlineProfile.bloodlineID,
      raceID: bloodlineProfile.raceID,
      typeID: bloodlineProfile.typeID,
      paperDollState: resolvePaperDollState(record, 2),
    }));
    if (!updateResult.success) {
      log.warn(
        `[CharService] UpdateCharacterBloodline failed for ${charId}: ${updateResult.errorMsg}`,
      );
      return null;
    }

    if (session && Number(session.charid || session.characterID || 0) === Number(charId)) {
      session.bloodlineID = bloodlineProfile.bloodlineID;
      session.bloodlineid = bloodlineProfile.bloodlineID;
      session.raceID = bloodlineProfile.raceID;
      session.raceid = bloodlineProfile.raceID;
      session.characterTypeID = bloodlineProfile.typeID;
    }

    return null;
  }

  Handle_GetCohortsForUser(args, session) {
    log.debug("[CharService] GetCohortsForUser");
    return { type: "list", items: [] };
  }

  Handle_GetTopBounties(args, session) {
    log.debug("[CharService] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetCharCreationInfo(args, session) {
    log.debug("[CharService] GetCharCreationInfo");
    return {
      type: "dict",
      entries: [
        [
          "races",
          {
            type: "list",
            items: getCharacterCreationRaces().map((race) =>
              buildKeyVal([
                ["raceID", race.raceID],
                ["raceName", race.name],
                ["shipTypeID", race.shipTypeID],
                ["shipName", race.shipName],
              ]),
            ),
          },
        ],
        [
          "bloodlines",
          {
            type: "list",
            items: getCharacterCreationBloodlines().map((bloodline) =>
              buildKeyVal([
                ["bloodlineID", bloodline.bloodlineID],
                ["bloodlineName", bloodline.name],
                ["raceID", bloodline.raceID],
                ["corporationID", bloodline.corporationID],
              ]),
            ),
          },
        ],
      ],
    };
  }

  Handle_GetCharNewExtraCreationInfo(args, session) {
    log.debug("[CharService] GetCharNewExtraCreationInfo");
    return this.Handle_GetCharCreationInfo(args, session);
  }

  Handle_IsUserReceivingCharacter(args, session) {
    log.debug("[CharService] IsUserReceivingCharacter");
    return false;
  }

  Handle_GetCharacterInfo(args, session) {
    log.debug("[CharService] GetCharacterInfo");
    return this.Handle_GetCharacterToSelect(args, session);
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    const charId = resolveCharacterRequestId(args, kwargs, 0);
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) {
      return null;
    }

    const existingSession = sessionRegistry.findSessionByCharacterID(charId, {
      excludeSession: session,
    });
    if (existingSession) {
      const characterRecord = getCharacterRecord(charId);
      const characterLabel =
        (characterRecord && characterRecord.characterName) ||
        existingSession.characterName ||
        `Character ${charId}`;
      log.warn(
        `[CharService] Rejected duplicate login for ${characterLabel}(${charId}); already active on user=${existingSession.userName || "unknown"} client=${existingSession.clientID || 0}`,
      );
      throwWrappedUserError("CustomInfo", {
        info: `${characterLabel} is already online.`,
      });
    }

    const applyResult = applyCharacterToSession(session, charId, {
      emitNotifications: false,
      logSelection: true,
    });

    if (!applyResult.success) {
      log.warn(
        `[CharService] Failed to select character ${charId}: ${applyResult.errorMsg}`,
      );
    } else {
      if (!session.stationid && !session.stationID) {
        restoreSpaceSession(session);
      }
      flushCharacterSessionNotificationPlan(
        session,
        applyResult.notificationPlan,
      );
      const stationID = Number(session.stationid || session.stationID || 0);
      const structureID = Number(session.structureid || session.structureID || 0);
      if (stationID) {
        broadcastStationGuestJoined(session, stationID);
      } else if (structureID) {
        broadcastStructureGuestJoined(session, structureID);
      }
    }

    return null;
  }

  Handle_ValidateNameEx(args, session) {
    log.debug("[CharService] ValidateNameEx");
    return true;
  }

  Handle_GetCharacterLockType(args, session) {
    log.debug("[CharService] GetCharacterLockType");
    return null;
  }
}

CharService._testing = {
  resolveCharacterRequestId,
};

module.exports = CharService;

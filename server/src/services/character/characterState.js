const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const { toClientSafeDisplayName } = require(path.join(
  __dirname,
  "../_shared/clientNameUtils",
));
const {
  ensureMigrated,
  getCharacterShipItems,
  getCharacterHangarShipItems,
  findCharacterShipItem,
  getActiveShipItem,
  ITEM_FLAGS,
  grantItemToCharacterStationHangar,
  setActiveShipForCharacter,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  ensureCharacterSkills,
  getCharacterSkillPointTotal,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  normalizeRoleValue,
} = require(path.join(__dirname, "../account/accountRoleProfiles"));
const {
  getFittedModuleItems,
  getLoadedChargeItems,
  buildChargeTupleItemID,
  getAttributeIDByNames,
  getEffectIDByNames,
  isModuleOnline,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const CHARACTERS_TABLE = "characters";
const INV_UPDATE_LOCATION = 3;
const INV_UPDATE_FLAG = 4;
const INV_UPDATE_QUANTITY = 5;
const INV_UPDATE_SINGLETON = 9;
const INV_UPDATE_STACKSIZE = 10;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const EFFECT_ONLINE = getEffectIDByNames("online") || 16;
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 3],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];
const CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 129],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 3],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];
const EMPIRE_BY_CORPORATION = Object.freeze({
  1000044: 500001,
  1000115: 500002,
  1000009: 500003,
  1000006: 500004,
});
const DEFAULT_PLEX_BALANCE = 2222;
const DEFAULT_CHARACTER_ATTRIBUTES = Object.freeze({
  charisma: 20,
  intelligence: 20,
  memory: 20,
  perception: 20,
  willpower: 20,
});
const DEFAULT_RESPEC_INFO = Object.freeze({
  freeRespecs: 3,
  lastRespecDate: null,
  nextTimedRespec: null,
});
const DEFAULT_MCT_EXPIRY_FILETIME = "157469184000000000";
const CHARGE_BOOTSTRAP_REPAIR_DELAY_MS = 100;
const CHARGE_TRANSITION_FINALIZE_DELAY_MS = 125;
const CHARGE_BOOTSTRAP_MODE_PRIME_AND_REFRESH = "prime-and-refresh";
const CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY = "refresh-only";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function resolveSystemIdentity(solarSystemID, fallback = {}) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  return {
    constellationID:
      Number((system && system.constellationID) || fallback.constellationID || 0) ||
      20000020,
    regionID:
      Number((system && system.regionID) || fallback.regionID || 0) ||
      10000002,
  };
}

function buildList(items) {
  return { type: "list", items };
}

function isCfgLocationBackedInventoryItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  // The client uses cfg.evelocations for ship item labels in the hangar tree.
  // Regular items/modules/charges do not need location rows, and sending them
  // through OnCfgDataChanged can poison the cache the tree reads from.
  return Number(item.categoryID) === 6;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharacterRecord(charId, record) {
  const clonedRecord = cloneValue(record);
  const writeResult = database.write(
    CHARACTERS_TABLE,
    `/${String(charId)}`,
    clonedRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: clonedRecord,
  };
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function normalizeSessionShipValue(value) {
  if (value === undefined || value === null || value === 0) {
    return null;
  }

  return value;
}

function appendSessionChange(changes, key, oldValue, newValue) {
  if (oldValue === newValue) {
    return;
  }

  changes[key] = [oldValue, newValue];
}

function normalizeOptionalRoleMask(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return normalizeRoleValue(value, 0n);
}

function hasLocationID(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function normalizeWorldSpaceID(record = {}) {
  const stationID = hasLocationID(record.stationID) ? Number(record.stationID) : null;
  const worldSpaceID = hasLocationID(record.worldSpaceID)
    ? Number(record.worldSpaceID)
    : null;

  if (!worldSpaceID) {
    return 0;
  }

  // NPC station hangars are station sessions, not separate worldspaces.
  // Mirroring stationID into worldSpaceID makes the client treat login/dock as
  // a mixed location transition and it rebuilds the hangar presentation twice.
  if (stationID && worldSpaceID === stationID) {
    return 0;
  }

  return worldSpaceID;
}

function deriveEmpireID(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "empireID")) {
    if (record.empireID === null || record.empireID === undefined || record.empireID === 0) {
      return null;
    }

    return Number(record.empireID) || null;
  }

  const corporationID = Number(record.corporationID || 0);
  return EMPIRE_BY_CORPORATION[corporationID] || null;
}

function deriveFactionID(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "factionID")) {
    if (record.factionID === null || record.factionID === undefined || record.factionID === 0) {
      return null;
    }

    return Number(record.factionID) || null;
  }

  return null;
}

function buildDefaultEmploymentHistory(record = {}) {
  const createdAt =
    String(record.startDateTime || record.createDateTime || "132000000000000000");
  const schoolCorpID = Number(record.schoolID || record.corporationID || 1000009) || 1000009;
  const currentCorpID = Number(record.corporationID || schoolCorpID) || schoolCorpID;
  const history = [
    {
      corporationID: schoolCorpID,
      startDate: createdAt,
      deleted: 0,
    },
  ];

  if (currentCorpID !== schoolCorpID) {
    history.push({
      corporationID: currentCorpID,
      startDate: createdAt,
      deleted: 0,
    });
  }

  return history;
}

function normalizeEmploymentHistory(record = {}) {
  const source = Array.isArray(record.employmentHistory)
    ? record.employmentHistory
    : buildDefaultEmploymentHistory(record);
  const normalized = source
    .map((entry) => ({
      corporationID: Number(entry && entry.corporationID) || Number(record.corporationID || 1000009) || 1000009,
      startDate: String(
        (entry && (entry.startDate || entry.startDateTime)) ||
          record.startDateTime ||
          record.createDateTime ||
          "132000000000000000",
      ),
      deleted: entry && entry.deleted ? 1 : 0,
    }))
    .sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)));

  return normalized.length ? normalized : buildDefaultEmploymentHistory(record);
}

function getCurrentCorporationStartDate(
  record = {},
  employmentHistory = null,
) {
  const currentCorporationID = Number(record.corporationID || 0) || 0;
  const history = Array.isArray(employmentHistory)
    ? employmentHistory
    : normalizeEmploymentHistory(record);
  const currentEntry = history
    .filter(
      (entry) =>
        (Number(entry && entry.corporationID) || 0) === currentCorporationID,
    )
    .sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)))
    .pop();

  return String(
    (currentEntry && currentEntry.startDate) ||
      record.startDateTime ||
      record.createDateTime ||
      "132000000000000000",
  );
}

function buildDefaultStandingData(charId, record = {}) {
  const characterID = Number(charId || 0) || 0;
  const corporationID = Number(record.corporationID || 1000009) || 1000009;
  const empireID = Number(record.empireID || deriveEmpireID(record) || 0) || 0;
  const factionID = Number(record.factionID || 0) || empireID || 0;
  const npcRows = [];

  if (characterID && corporationID) {
    npcRows.push({ fromID: characterID, toID: corporationID, standing: 1.25 });
    npcRows.push({ fromID: corporationID, toID: characterID, standing: 1.25 });
  }

  if (characterID && factionID) {
    npcRows.push({ fromID: characterID, toID: factionID, standing: 0.75 });
    npcRows.push({ fromID: factionID, toID: characterID, standing: 0.75 });
  }

  if (corporationID && factionID) {
    npcRows.push({ fromID: corporationID, toID: factionID, standing: 2.0 });
    npcRows.push({ fromID: factionID, toID: corporationID, standing: 2.0 });
  }

  return {
    char: npcRows.filter(
      (entry) => entry.fromID === characterID || entry.toID === characterID,
    ),
    corp: npcRows.filter(
      (entry) => entry.fromID === corporationID || entry.toID === corporationID,
    ),
    npc: npcRows,
  };
}

function normalizeStandingRows(rows = [], fallbackRows = []) {
  const source = Array.isArray(rows) && rows.length ? rows : fallbackRows;
  return source
    .map((entry) => ({
      fromID:
        entry && Object.prototype.hasOwnProperty.call(entry, "fromID")
          ? entry.fromID
          : null,
      toID:
        entry && Object.prototype.hasOwnProperty.call(entry, "toID")
          ? entry.toID
          : null,
      standing: Number(entry && entry.standing) || 0.0,
    }))
    .filter((entry) => entry.fromID !== undefined && entry.toID !== undefined);
}

function normalizeStandingData(charId, record = {}) {
  const fallback = buildDefaultStandingData(charId, record);
  const source =
    record.standingData && typeof record.standingData === "object"
      ? record.standingData
      : {};

  return {
    char: normalizeStandingRows(source.char, fallback.char),
    corp: normalizeStandingRows(source.corp, fallback.corp),
    npc: normalizeStandingRows(source.npc, fallback.npc),
  };
}

function normalizeCharacterAttributes(record = {}) {
  const source =
    record.characterAttributes && typeof record.characterAttributes === "object"
      ? record.characterAttributes
      : {};

  return {
    charisma: normalizeInteger(
      source.charisma ?? source[164],
      DEFAULT_CHARACTER_ATTRIBUTES.charisma,
    ),
    intelligence: normalizeInteger(
      source.intelligence ?? source[165],
      DEFAULT_CHARACTER_ATTRIBUTES.intelligence,
    ),
    memory: normalizeInteger(
      source.memory ?? source[166],
      DEFAULT_CHARACTER_ATTRIBUTES.memory,
    ),
    perception: normalizeInteger(
      source.perception ?? source[167],
      DEFAULT_CHARACTER_ATTRIBUTES.perception,
    ),
    willpower: normalizeInteger(
      source.willpower ?? source[168],
      DEFAULT_CHARACTER_ATTRIBUTES.willpower,
    ),
  };
}

function normalizeRespecInfo(record = {}) {
  const source =
    record.respecInfo && typeof record.respecInfo === "object"
      ? record.respecInfo
      : DEFAULT_RESPEC_INFO;

  return {
    freeRespecs: normalizeInteger(
      source.freeRespecs,
      DEFAULT_RESPEC_INFO.freeRespecs,
    ),
    lastRespecDate: source.lastRespecDate || null,
    nextTimedRespec: source.nextTimedRespec || null,
  };
}

function resolveHomeStationInfo(charData = {}, session = null) {
  const authoritativeHomeStationID =
    Number(charData.homeStationID || charData.cloneStationID || 0) || 0;
  const fallbackHomeStationID =
    Number(
      charData.stationID ||
        charData.worldSpaceID ||
        (session &&
          (session.homeStationID ||
            session.cloneStationID ||
            session.stationID ||
            session.stationid ||
            session.worldspaceid)) ||
        60003760,
    ) || 60003760;
  const homeStationID = authoritativeHomeStationID || fallbackHomeStationID;

  return {
    homeStationID,
    cloneStationID:
      Number(charData.cloneStationID || authoritativeHomeStationID || homeStationID) ||
      homeStationID,
    isFallback: !authoritativeHomeStationID,
  };
}

function reconcileCharacterLocationFromActiveShip(charId, record = {}, activeShip = null) {
  if (!record || typeof record !== "object" || !activeShip) {
    return record;
  }

  const currentStationID = hasLocationID(record.stationID) ? Number(record.stationID) : null;
  const currentSolarSystemID = hasLocationID(record.solarSystemID)
    ? Number(record.solarSystemID)
    : null;
  const shipLocationID = hasLocationID(activeShip.locationID)
    ? Number(activeShip.locationID)
    : null;
  const shipFlagID = Number(activeShip.flagID || 0);
  const shipSpaceSystemID = hasLocationID(activeShip.spaceState && activeShip.spaceState.systemID)
    ? Number(activeShip.spaceState.systemID)
    : null;

  let repairedStationID = currentStationID;
  let repairedSolarSystemID = currentSolarSystemID;

  if (shipFlagID === ITEM_FLAGS.HANGAR && shipLocationID) {
    const station = worldData.getStationByID(shipLocationID);
    if (station) {
      repairedStationID = station.stationID;
      repairedSolarSystemID = Number(station.solarSystemID || currentSolarSystemID || 0) || 30000142;
    }
  } else if (shipFlagID === 0) {
    const inferredSolarSystemID =
      shipSpaceSystemID ||
      (shipLocationID && worldData.getSolarSystemByID(shipLocationID) ? shipLocationID : null);
    if (inferredSolarSystemID) {
      repairedStationID = null;
      repairedSolarSystemID = inferredSolarSystemID;
    }
  }

  if (
    repairedStationID === currentStationID &&
    repairedSolarSystemID === currentSolarSystemID
  ) {
    return record;
  }

  const nextRecord = {
    ...record,
    stationID: repairedStationID,
    solarSystemID: repairedSolarSystemID || currentSolarSystemID || 30000142,
  };
  const systemIdentity = resolveSystemIdentity(nextRecord.solarSystemID, nextRecord);
  nextRecord.constellationID = systemIdentity.constellationID;
  nextRecord.regionID = systemIdentity.regionID;

  log.warn(
    `[CharacterState] Reconciled location from active ship for char=${charId} ship=${activeShip.itemID} station=${currentStationID}=>${nextRecord.stationID} system=${currentSolarSystemID}=>${nextRecord.solarSystemID}`,
  );

  return nextRecord;
}

function normalizeCharacterRecord(charId, record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  ensureMigrated();
  ensureCharacterSkills(charId);

  const normalized = {
    ...record,
  };
  const activeShip = getActiveShipItem(charId);
  const totalSkillPoints = getCharacterSkillPointTotal(charId);
  const gender = Number(normalized.gender);

  normalized.gender = gender === 0 || gender === 1 || gender === 2 ? gender : 1;

  if (activeShip) {
    normalized.shipID = activeShip.itemID;
    normalized.shipTypeID = activeShip.typeID;
    normalized.shipName = activeShip.itemName;
    Object.assign(
      normalized,
      reconcileCharacterLocationFromActiveShip(charId, normalized, activeShip),
    );
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, "factionID")) {
    normalized.factionID = null;
  }
  normalized.factionID = deriveFactionID(normalized);
  normalized.empireID = deriveEmpireID(normalized);
  normalized.plexBalance = normalizeInteger(
    normalized.plexBalance,
    DEFAULT_PLEX_BALANCE,
  );
  if (!normalized.schoolID) {
    normalized.schoolID = normalized.corporationID || null;
  }
  normalized.securityStatus = Number(
    normalized.securityStatus ?? normalized.securityRating ?? 0,
  );
  normalized.securityRating = normalized.securityStatus;
  normalized.worldSpaceID = normalizeWorldSpaceID(normalized);
  normalized.characterAttributes = normalizeCharacterAttributes(normalized);
  normalized.respecInfo = normalizeRespecInfo(normalized);
  normalized.freeSkillPoints = normalizeInteger(normalized.freeSkillPoints, 0);
  normalized.skillHistory = Array.isArray(normalized.skillHistory)
    ? normalized.skillHistory.map((entry) => ({ ...entry }))
    : [];
  normalized.boosters = Array.isArray(normalized.boosters)
    ? normalized.boosters.map((entry) => ({ ...entry }))
    : [];
  normalized.implants = Array.isArray(normalized.implants)
    ? normalized.implants.map((entry) => ({ ...entry }))
    : [];
  normalized.jumpClones = Array.isArray(normalized.jumpClones)
    ? normalized.jumpClones.map((entry) => ({ ...entry }))
    : [];
  normalized.timeLastCloneJump = String(normalized.timeLastCloneJump || "0");
  normalized.employmentHistory = normalizeEmploymentHistory(normalized);
  normalized.startDateTime = getCurrentCorporationStartDate(
    normalized,
    normalized.employmentHistory,
  );
  normalized.standingData = normalizeStandingData(charId, normalized);
  if (Number.isFinite(totalSkillPoints) && totalSkillPoints > 0) {
    normalized.skillPoints = totalSkillPoints;
  }

  const homeStationInfo = resolveHomeStationInfo(normalized);
  normalized.homeStationID = homeStationInfo.homeStationID;
  normalized.cloneStationID = homeStationInfo.cloneStationID;

  if (Object.prototype.hasOwnProperty.call(normalized, "storedShips")) {
    delete normalized.storedShips;
  }

  return normalized;
}

function getCharacterRecord(charId) {
  ensureMigrated();

  const characters = readCharacters();
  const rawRecord = characters[String(charId)];
  if (!rawRecord) {
    return null;
  }

  const normalizedRecord = normalizeCharacterRecord(charId, rawRecord);
  if (!normalizedRecord) {
    return null;
  }

  if (JSON.stringify(rawRecord) !== JSON.stringify(normalizedRecord)) {
    writeCharacterRecord(charId, normalizedRecord);
  }

  return normalizedRecord;
}

function updateCharacterRecord(charId, updater) {
  const currentRecord = getCharacterRecord(charId);
  if (!currentRecord) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const updatedRecord =
    typeof updater === "function" ? updater(cloneValue(currentRecord)) : updater;
  const normalizedRecord = normalizeCharacterRecord(charId, updatedRecord);
  return writeCharacterRecord(charId, normalizedRecord);
}

function getCharacterShips(charId) {
  return getCharacterShipItems(charId);
}

function findCharacterShip(charId, shipId) {
  return findCharacterShipItem(charId, shipId);
}

function getActiveShipRecord(charId) {
  return getActiveShipItem(charId);
}

function buildInventoryItemRow(item) {
  return {
    type: "packedrow",
    header: {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INVENTORY_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    },
    columns: INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    fields: {
      itemID: item.itemID,
      typeID: item.typeID,
      ownerID: item.ownerID,
      locationID: item.locationID,
      flagID: item.flagID,
      quantity: item.quantity,
      groupID: item.groupID,
      categoryID: item.categoryID,
      customInfo: item.customInfo || "",
      singleton: item.singleton,
      stacksize: item.stacksize,
    },
  };
}

function buildChargeSublocationRow(item) {
  return {
    type: "packedrow",
    header: {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    },
    columns: CHARGE_SUBLOCATION_ROW_DESCRIPTOR_COLUMNS,
    fields: {
      itemID: item.itemID,
      typeID: item.typeID,
      ownerID: item.ownerID ?? null,
      locationID: item.locationID,
      flagID: item.flagID,
      quantity: item.quantity,
      groupID: item.groupID,
      categoryID: item.categoryID,
      customInfo: item.customInfo || "",
      singleton: item.singleton ?? 0,
      stacksize: item.stacksize,
    },
  };
}

function buildDogmaInfoInventoryRow(item) {
  const normalizedChargeQuantity = Math.max(
    0,
    Number(item && (item.stacksize ?? item.quantity ?? 0)) || 0,
  );
  return {
    type: "object",
    name: "util.Row",
    args: {
      type: "dict",
      entries: [
        ["header", [
          "itemID",
          "typeID",
          "ownerID",
          "locationID",
          "flagID",
          "quantity",
          "groupID",
          "categoryID",
          "customInfo",
          "singleton",
          "stacksize",
        ]],
        ["line", [
          item.itemID,
          item.typeID,
          item.ownerID ?? null,
          item.locationID,
          item.flagID,
          normalizedChargeQuantity,
          item.groupID,
          item.categoryID,
          item.customInfo || "",
          item.singleton ?? 0,
          normalizedChargeQuantity,
        ]],
      ],
    },
  };
}

function buildChargeDogmaPrimeEntry(item, options = {}) {
  const normalizedChargeQuantity = Math.max(
    0,
    Number(item && (item.stacksize ?? item.quantity ?? 0)) || 0,
  );
  const now =
    typeof options.now === "bigint"
      ? options.now
      : currentFileTime();

  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["itemID", item.itemID],
        ["invItem", buildDogmaInfoInventoryRow(item)],
        ["activeEffects", { type: "dict", entries: [] }],
        ["attributes", {
          type: "dict",
          entries: [[ATTRIBUTE_QUANTITY, normalizedChargeQuantity]],
        }],
        ["description", options.description || "charge"],
        ["time", now],
        ["wallclockTime", now],
      ],
    },
  };
}

function syncChargeGodmaPrimeForSession(
  session,
  locationID,
  item,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !item ||
    typeof item !== "object"
  ) {
    return;
  }

  session.sendNotification("OnGodmaPrimeItem", "clientID", [
    Number(locationID) || 0,
    buildChargeDogmaPrimeEntry(item, options),
  ]);
}

function buildLocationChangePayload(session, item) {
  const solarSystemID = Number(
    (session && (session.solarsystemid2 || session.solarsystemid)) || 0,
  ) || null;
  const fallbackName =
    Number(item && item.categoryID) === 6
      ? `Ship ${Number(item && item.itemID) || ""}`.trim()
      : `Item ${Number(item && item.itemID) || ""}`.trim();

  return buildList([
    item.itemID,
    toClientSafeDisplayName(item.itemName || "Item", fallbackName),
    solarSystemID,
    0.0,
    0.0,
    0.0,
    null,
  ]);
}

function buildItemChangePayload(item, previousState = {}) {
  const entries = [];
  const currentQuantity = Number(item && item.quantity);
  const previousQuantity = Number(previousState.quantity);
  const currentStackSize = Number(item && item.stacksize);
  const previousStackSize = Number(previousState.stacksize);
  const prefersStackSizeOnly =
    Number(item && item.singleton) !== 1 &&
    Number.isFinite(currentQuantity) &&
    Number.isFinite(previousQuantity) &&
    Number.isFinite(currentStackSize) &&
    Number.isFinite(previousStackSize) &&
    currentQuantity >= 0 &&
    previousQuantity >= 0 &&
    currentQuantity === currentStackSize &&
    previousQuantity === previousStackSize;

  if (
    previousState.locationID !== undefined &&
    previousState.locationID !== item.locationID
  ) {
    entries.push([INV_UPDATE_LOCATION, previousState.locationID]);
  }

  if (previousState.flagID !== undefined && previousState.flagID !== item.flagID) {
    entries.push([INV_UPDATE_FLAG, previousState.flagID]);
  }

  if (
    !prefersStackSizeOnly &&
    previousState.quantity !== undefined &&
    Number.isFinite(previousQuantity) &&
    Number.isFinite(currentQuantity) &&
    previousQuantity >= 0 &&
    currentQuantity >= 0 &&
    previousQuantity !== currentQuantity
  ) {
    entries.push([INV_UPDATE_QUANTITY, previousState.quantity]);
  }

  if (
    previousState.singleton !== undefined &&
    previousState.singleton !== item.singleton
  ) {
    entries.push([INV_UPDATE_SINGLETON, previousState.singleton]);
  }

  if (
    previousState.stacksize !== undefined &&
    previousState.stacksize !== item.stacksize
  ) {
    // CCP's invCache logs a traceback for ixQuantity on normal stackable item
    // updates, but ixStackSize is sufficient for cargo/hangar stack deltas.
    entries.push([INV_UPDATE_STACKSIZE, previousState.stacksize]);
  }

  return [
    buildInventoryItemRow(item),
    {
      type: "dict",
      entries,
    },
    null,
  ];
}

function buildChargeSublocationChangePayload(item, previousState = {}) {
  const entries = [];
  const currentStackSize = Number(item && item.stacksize);
  const previousStackSize = Number(previousState.stacksize);

  if (
    previousState.locationID !== undefined &&
    previousState.locationID !== item.locationID
  ) {
    entries.push([INV_UPDATE_LOCATION, previousState.locationID]);
  }

  if (previousState.flagID !== undefined && previousState.flagID !== item.flagID) {
    entries.push([INV_UPDATE_FLAG, previousState.flagID]);
  }

  if (
    previousState.stacksize !== undefined &&
    Number.isFinite(previousStackSize) &&
    Number.isFinite(currentStackSize) &&
    previousStackSize >= 0 &&
    currentStackSize >= 0 &&
    previousStackSize !== currentStackSize
  ) {
    entries.push([INV_UPDATE_STACKSIZE, previousState.stacksize]);
  }

  return [
    buildChargeSublocationRow(item),
    {
      type: "dict",
      entries,
    },
    null,
  ];
}

function buildChargeSublocationItem({
  shipID,
  flagID,
  typeID,
  quantity,
  ownerID = null,
  groupID = null,
  categoryID = null,
}) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  const numericQuantity = Math.max(0, Number(quantity) || 0);
  const typeRow = resolveItemByTypeID(numericTypeID) || null;

  return {
    itemID: buildChargeTupleItemID(numericShipID, numericFlagID, numericTypeID),
    typeID: numericTypeID,
    ownerID: Number(ownerID) || null,
    locationID: numericShipID,
    flagID: numericFlagID,
    quantity: numericQuantity,
    groupID: Number(groupID ?? (typeRow && typeRow.groupID)) || 0,
    categoryID: Number(categoryID ?? (typeRow && typeRow.categoryID)) || 8,
    customInfo: "",
    singleton: 0,
    stacksize: numericQuantity,
  };
}

function buildChargeSublocationRepairPreviousState({
  previousTypeID = 0,
  previousQuantity = 0,
  nextTypeID = 0,
  nextQuantity = 0,
} = {}) {
  const normalizedPreviousTypeID = Number(previousTypeID) || 0;
  const normalizedNextTypeID = Number(nextTypeID) || 0;
  const normalizedPreviousQuantity = Math.max(
    0,
    Number(previousQuantity) || 0,
  );
  const normalizedNextQuantity = Math.max(0, Number(nextQuantity) || 0);
  const repairPreviousState = {
    locationID: 0,
    flagID: 0,
  };

  // CCP's fitted charge path keys HUD repair off ixStackSize, while ixQuantity
  // on tuple-backed sublocations goes through invCache and produces noisy or
  // outright broken updates. Keep tuple repairs on the location/flag/stacksize
  // contract only.
  const previousStackSize =
    normalizedPreviousTypeID > 0 &&
    normalizedPreviousTypeID === normalizedNextTypeID
      ? normalizedPreviousQuantity
      : 0;
  if (previousStackSize !== normalizedNextQuantity) {
    repairPreviousState.stacksize = previousStackSize;
  }

  return repairPreviousState;
}

function syncChargeSublocationForSession(
  session,
  item,
  previousState = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !item ||
    typeof item !== "object"
  ) {
    return;
  }

  session.sendNotification(
    "OnItemChange",
    "clientID",
    buildChargeSublocationChangePayload(item, previousState),
  );
}

function syncChargeSublocationForSessionAfterDelay(
  session,
  item,
  previousState = {},
  delayMs = 0,
) {
  const numericDelayMs = Math.max(0, Number(delayMs) || 0);
  if (numericDelayMs <= 0) {
    syncChargeSublocationForSession(session, item, previousState);
    return false;
  }

  const timerHost = session && (session._space || session);
  if (!timerHost) {
    return false;
  }

  if (!timerHost._chargeSublocationReplayTimers) {
    timerHost._chargeSublocationReplayTimers = new Map();
  }

  const timerKey = `${Number(item && item.locationID) || 0}:${
    Number(item && item.flagID) || 0
  }`;
  const existingTimer = timerHost._chargeSublocationReplayTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    if (timerHost._chargeSublocationReplayTimers) {
      timerHost._chargeSublocationReplayTimers.delete(timerKey);
    }

    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      (session.socket && session.socket.destroyed)
    ) {
      return;
    }

    syncChargeSublocationForSession(session, item, previousState);
  }, numericDelayMs);

  timerHost._chargeSublocationReplayTimers.set(timerKey, timer);
  return true;
}

function syncChargeSublocationTransitionForSession(
  session,
  {
    shipID,
    flagID,
    ownerID = null,
    previousState = null,
    nextState = null,
    primeNextCharge = false,
    nextChargeRepairDelayMs = CHARGE_BOOTSTRAP_REPAIR_DELAY_MS,
  } = {},
) {
  if (!session) {
    return;
  }

  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  if (numericShipID <= 0 || numericFlagID <= 0) {
    return;
  }

  const previousTypeID = Number(previousState && previousState.typeID) || 0;
  const nextTypeID = Number(nextState && nextState.typeID) || 0;
  const previousQuantity = Math.max(
    0,
    Number(previousState && previousState.quantity) || 0,
  );
  const nextQuantity = Math.max(0, Number(nextState && nextState.quantity) || 0);

  if (previousTypeID === nextTypeID && previousQuantity === nextQuantity) {
    return;
  }

  if (previousTypeID > 0 && (previousTypeID !== nextTypeID || nextQuantity <= 0)) {
    const removedCharge = buildChargeSublocationItem({
      shipID: numericShipID,
      flagID: numericFlagID,
      typeID: previousTypeID,
      quantity: previousQuantity,
      ownerID,
    });
    removedCharge.locationID = 6;
    syncChargeSublocationForSession(session, removedCharge, {
      locationID: numericShipID,
      flagID: numericFlagID,
    });
  }

  if (nextTypeID > 0 && nextQuantity > 0) {
    const nextCharge = buildChargeSublocationItem({
      shipID: numericShipID,
      flagID: numericFlagID,
      typeID: nextTypeID,
      quantity: nextQuantity,
      ownerID,
    });
    const shouldPrimeNextCharge =
      primeNextCharge === true && previousTypeID !== nextTypeID;
    if (shouldPrimeNextCharge) {
      syncChargeGodmaPrimeForSession(session, numericShipID, nextCharge, {
        description: "charge",
      });
      log.debug(
        `[charge-transition] shipID=${numericShipID} ` +
        `flagID=${numericFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
        `itemID=${JSON.stringify(buildChargeTupleItemID(
          numericShipID,
          numericFlagID,
          nextTypeID,
        ))} mode=godma-prime`,
      );
    }

    const finalizeDelayMs = Math.max(
      0,
      Number(CHARGE_TRANSITION_FINALIZE_DELAY_MS) || 0,
    );
    const repairDelayMs = shouldPrimeNextCharge
      ? Math.max(
        0,
        Number(nextChargeRepairDelayMs) || 0,
        finalizeDelayMs,
      )
      : 0;
    const scheduled = syncChargeSublocationForSessionAfterDelay(
      session,
      nextCharge,
      buildChargeSublocationRepairPreviousState({
        previousTypeID,
        previousQuantity,
        nextTypeID,
        nextQuantity,
      }),
      repairDelayMs,
    );
    log.debug(
      `[charge-transition] shipID=${numericShipID} ` +
      `flagID=${numericFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
      `itemID=${JSON.stringify(buildChargeTupleItemID(
        numericShipID,
        numericFlagID,
        nextTypeID,
      ))} mode=${
        shouldPrimeNextCharge
          ? scheduled
            ? "post-prime-item-change-delayed"
            : "post-prime-item-change"
          : "item-change"
      }${
        scheduled ? ` delayMs=${repairDelayMs}` : ""
      }`,
    );

    if (!shouldPrimeNextCharge && previousTypeID !== nextTypeID) {
      const finalizeScheduled = syncChargeSublocationForSessionAfterDelay(
        session,
        nextCharge,
        buildChargeSublocationRepairPreviousState({
          previousTypeID,
          previousQuantity,
          nextTypeID,
          nextQuantity,
        }),
        finalizeDelayMs,
      );
      if (finalizeScheduled) {
        log.debug(
          `[charge-transition] shipID=${numericShipID} ` +
          `flagID=${numericFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
          `itemID=${JSON.stringify(buildChargeTupleItemID(
            numericShipID,
            numericFlagID,
            nextTypeID,
          ))} mode=item-change-finalize-delayed ` +
          `delayMs=${finalizeDelayMs}`,
        );
      }
    }
  }
}

function syncLoadedChargeSublocationsForSession(session, shipID = null) {
  if (
    !session ||
    typeof session.sendNotification !== "function"
  ) {
    return 0;
  }

  const charId = session.characterID || session.charid || 0;
  if (!charId) {
    return 0;
  }

  const resolvedShipID =
    normalizeSessionShipValue(shipID) ||
    normalizeSessionShipValue(session.shipID || session.shipid || null);
  if (!resolvedShipID) {
    return 0;
  }

  const loadedCharges = getLoadedChargeItems(charId, resolvedShipID);
  for (const chargeItem of loadedCharges) {
    syncChargeSublocationForSession(
      session,
      buildChargeSublocationItem({
        shipID: resolvedShipID,
        flagID: chargeItem.flagID,
        typeID: chargeItem.typeID,
        quantity: chargeItem.stacksize ?? chargeItem.quantity ?? 0,
        ownerID: chargeItem.ownerID,
        groupID: chargeItem.groupID,
        categoryID: chargeItem.categoryID,
      }),
      buildChargeSublocationRepairPreviousState({
        nextTypeID: chargeItem.typeID,
        nextQuantity: chargeItem.stacksize ?? chargeItem.quantity ?? 0,
      }),
    );
  }

  return loadedCharges.length;
}

function syncLoadedChargeDogmaBootstrapForSession(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function"
  ) {
    return 0;
  }

  const charId = session.characterID || session.charid || 0;
  if (!charId) {
    return 0;
  }

  const resolvedShipID =
    normalizeSessionShipValue(shipID) ||
    normalizeSessionShipValue(session.shipID || session.shipid || null);
  if (!resolvedShipID) {
    return 0;
  }

  const loadedCharges = getLoadedChargeItems(charId, resolvedShipID)
    .slice()
    .sort((left, right) => {
      const leftFlag = Number(left && left.flagID) || 0;
      const rightFlag = Number(right && right.flagID) || 0;
      if (leftFlag !== rightFlag) {
        return leftFlag - rightFlag;
      }
      return (Number(left && left.typeID) || 0) - (Number(right && right.typeID) || 0);
    });
  if (loadedCharges.length === 0) {
    return 0;
  }

  const mode =
    options.mode === CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY
      ? CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY
      : CHARGE_BOOTSTRAP_MODE_PRIME_AND_REFRESH;
  const refreshDelayMs =
    mode === CHARGE_BOOTSTRAP_MODE_PRIME_AND_REFRESH
      ? Math.max(
          0,
          Number(options.refreshDelayMs) || CHARGE_BOOTSTRAP_REPAIR_DELAY_MS,
        )
      : 0;
  const bootstrapEntries = [];

  for (const chargeItem of loadedCharges) {
    const nextQuantity = Math.max(
      0,
      Number(chargeItem.stacksize ?? chargeItem.quantity ?? 0) || 0,
    );
    const nextTypeID = Number(chargeItem.typeID) || 0;
    const nextFlagID = Number(chargeItem.flagID) || 0;
    if (nextTypeID <= 0 || nextFlagID <= 0 || nextQuantity <= 0) {
      continue;
    }
    const chargeBootstrapItem = buildChargeSublocationItem({
      shipID: resolvedShipID,
      flagID: nextFlagID,
      typeID: nextTypeID,
      quantity: nextQuantity,
      ownerID: Number(charId) || 0,
      groupID: chargeItem.groupID,
      categoryID: chargeItem.categoryID,
    });

    bootstrapEntries.push({
      nextFlagID,
      nextQuantity,
      nextTypeID,
      chargeBootstrapItem,
    });
  }

  const timerHost = session._space || session;
  if (timerHost._chargeBootstrapRepairTimer) {
    clearTimeout(timerHost._chargeBootstrapRepairTimer);
    timerHost._chargeBootstrapRepairTimer = null;
  }

  if (mode === CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY) {
    for (const entry of bootstrapEntries) {
      const {
        nextFlagID,
        nextQuantity,
        nextTypeID,
        chargeBootstrapItem,
      } = entry;
      syncChargeSublocationForSession(session, chargeBootstrapItem, {
        ...buildChargeSublocationRepairPreviousState({
          nextTypeID,
          nextQuantity,
        }),
      });
      log.debug(
        `[charge-bootstrap] shipID=${Number(resolvedShipID) || 0} ` +
        `flagID=${nextFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
        `itemID=${JSON.stringify(buildChargeTupleItemID(
          Number(resolvedShipID) || 0,
          nextFlagID,
          nextTypeID,
        ))} mode=refresh-only-item-change`,
      );
    }

    return loadedCharges.length;
  }

  for (const entry of bootstrapEntries) {
    const {
      nextFlagID,
      nextQuantity,
      nextTypeID,
      chargeBootstrapItem,
    } = entry;

    // Post-jump / post-undock charge reseed has no MakeShipActive tuple
    // hydration to lean on, so prime the tuple charge into godma first and
    // then repair the HUD-facing tuple row after the client emits its own
    // malformed synthetic sublocation rows.
    syncChargeGodmaPrimeForSession(
      session,
      resolvedShipID,
      chargeBootstrapItem,
      {
        description: "charge",
      },
    );
    log.debug(
      `[charge-bootstrap] shipID=${Number(resolvedShipID) || 0} ` +
      `flagID=${nextFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
      `itemID=${JSON.stringify(buildChargeTupleItemID(
        Number(resolvedShipID) || 0,
        nextFlagID,
        nextTypeID,
      ))} mode=godma-prime`,
    );
  }

  timerHost._chargeBootstrapRepairTimer = setTimeout(() => {
    if (timerHost._chargeBootstrapRepairTimer) {
      timerHost._chargeBootstrapRepairTimer = null;
    }

    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      (session.socket && session.socket.destroyed)
    ) {
      return;
    }

    for (const entry of bootstrapEntries) {
      const {
        nextFlagID,
        nextQuantity,
        nextTypeID,
        chargeBootstrapItem,
      } = entry;

      // CCP's OnGodmaPrimeItem path creates a usable tuple item in godma, but
      // it leaves the HUD's later ModuleButton charge object with
      // stacksize=None until a real tuple OnItemChange arrives after the HUD
      // buttons have registered with svc.inv. Send that repair on a short
      // follow-up tick so it lands after the client finishes synthesizing the
      // broken prime rows.
      //
      // Important: do not advertise ixQuantity on this bootstrap row. The HUD
      // repair needs ixStackSize so clientDogmaLocation heals the fitted tuple
      // charge object that ModuleButton still points at, but ixQuantity on a
      // tuple row sends invCache down a broken path.
      syncChargeSublocationForSession(
        session,
        chargeBootstrapItem,
        buildChargeSublocationRepairPreviousState({
          nextTypeID,
          nextQuantity,
        }),
      );
      log.debug(
        `[charge-bootstrap] shipID=${Number(resolvedShipID) || 0} ` +
        `flagID=${nextFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
        `itemID=${JSON.stringify(buildChargeTupleItemID(
          Number(resolvedShipID) || 0,
          nextFlagID,
          nextTypeID,
        ))} mode=post-prime-item-change-delayed ` +
        `delayMs=${refreshDelayMs}`,
      );
    }
  }, refreshDelayMs);

  return loadedCharges.length;
}

function syncLoadedChargeQuantityBootstrapForSession(session, shipID = null) {
  return syncLoadedChargeDogmaBootstrapForSession(session, shipID);
}

function syncInventoryItemForSession(session, item, previousState = {}, options = {}) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !item ||
    typeof item !== "object"
  ) {
    return;
  }

  session.sendNotification(
    "OnItemChange",
    "clientID",
    buildItemChangePayload(item, previousState),
  );

  if (
    options.emitCfgLocation !== false &&
    isCfgLocationBackedInventoryItem(item)
  ) {
    session.sendNotification("OnCfgDataChanged", "charid", [
      "evelocations",
      buildLocationChangePayload(session, item),
    ]);
  }

  log.info(
    `[CharacterState] Synced inventory item ${item.itemID} (${item.itemName || item.typeID}) to client inventory`,
  );
}

function syncModuleOnlineEffectForSession(session, item, options = {}) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !item ||
    typeof item !== "object"
  ) {
    return false;
  }

  const moduleID = Number(item.itemID) || 0;
  const ownerID = Number(item.ownerID) || 0;
  const shipID = Number(item.locationID) || 0;
  if (moduleID <= 0 || shipID <= 0) {
    return false;
  }

  const active =
    options.active === undefined ? isModuleOnline(item) : Boolean(options.active);
  // Use scene sim filetime when in space so online-effect timestamps stay
  // coherent with the solar system's TiDi clock.  Fall back to wallclock when
  // docked (no scene attached).
  const now = (session._space && typeof session._space.simFileTime === "bigint")
    ? session._space.simFileTime
    : currentFileTime();
  const environment = [
    moduleID,
    ownerID,
    shipID,
    null,
    null,
    [],
    EFFECT_ONLINE,
  ];

  session.sendNotification("OnGodmaShipEffect", "clientID", [
    moduleID,
    EFFECT_ONLINE,
    now,
    active ? 1 : 0,
    active ? 1 : 0,
    environment,
    now,
    -1,
    -1,
    null,
    null,
  ]);
  return true;
}

function syncFittedModulesForSession(session, shipID = null, options = {}) {
  if (
    !session ||
    typeof session.sendNotification !== "function"
  ) {
    return 0;
  }

  const charId = session.characterID || session.charid || 0;
  if (!charId) {
    return 0;
  }

  const resolvedShipID =
    normalizeSessionShipValue(shipID) ||
    normalizeSessionShipValue(session.shipID || session.shipid || null);
  if (!resolvedShipID) {
    return 0;
  }

  const onlyOnline = options.onlyOnline !== false;
  const onlyCharges = options.onlyCharges === true;
  const includeCharges = options.includeCharges === true || onlyCharges;
  const isInSpaceSession = Boolean(
    session &&
      session._space &&
      !session.stationid &&
      !session.stationID,
  );
  const emitChargeInventoryRows =
    options.emitChargeInventoryRows === undefined
      ? !isInSpaceSession
      : options.emitChargeInventoryRows === true && !isInSpaceSession;
  const emitOnlineEffects = options.emitOnlineEffects === true;
  const fittedItems = onlyCharges
    ? []
    : getFittedModuleItems(charId, resolvedShipID)
      .filter((item) => (onlyOnline ? isModuleOnline(item) : true));
  if (includeCharges && emitChargeInventoryRows) {
    fittedItems.push(...getLoadedChargeItems(charId, resolvedShipID));
  }

  fittedItems.sort((left, right) => {
    const leftFlag = Number(left && left.flagID) || 0;
    const rightFlag = Number(right && right.flagID) || 0;
    if (leftFlag !== rightFlag) {
      return leftFlag - rightFlag;
    }
    const leftCategoryID = Number(left && left.categoryID) || 0;
    const rightCategoryID = Number(right && right.categoryID) || 0;
    const leftChargeSort = leftCategoryID === 8 ? 1 : 0;
    const rightChargeSort = rightCategoryID === 8 ? 1 : 0;
    if (leftChargeSort !== rightChargeSort) {
      // Login-in-space fitting replays must fit the weapon module before the
      // loaded charge/crystal on the same slot so the client dogma layer can
      // safely materialize the ammo item against an already-fitted parent.
      return leftChargeSort - rightChargeSort;
    }
    return (Number(left && left.itemID) || 0) - (Number(right && right.itemID) || 0);
  });

  for (const moduleItem of fittedItems) {
    const isLoadedCharge = Number(moduleItem && moduleItem.categoryID) === 8;
    const previousState =
      options.syntheticFitTransition === true
        ? {
            // Login-in-space replays are synthetic refreshes, so give the
            // client an actual location/flag delta instead of a no-op update.
            locationID: 0,
            flagID: 0,
            singleton: 0,
            // Real loaded charge rows stay docked/fitting-window only. In
            // space the HUD must remain tuple-backed, so fitted charge rows are
            // filtered out above and never reach this path.
            stacksize:
              isLoadedCharge
                ? undefined
                : Number(moduleItem && (moduleItem.stacksize ?? moduleItem.quantity)) >= 0
                ? 0
                : undefined,
            quantity:
              isLoadedCharge
                ? undefined
                : Number(moduleItem && moduleItem.quantity) >= 0
                ? 0
                : undefined,
          }
        : {
            locationID: moduleItem.locationID,
            flagID: moduleItem.flagID,
            quantity: moduleItem.quantity,
            singleton: moduleItem.singleton,
            stacksize: moduleItem.stacksize,
          };
    syncInventoryItemForSession(
      session,
      moduleItem,
      previousState,
      {
        emitCfgLocation: false,
      },
    );
    if (emitOnlineEffects && isModuleOnline(moduleItem)) {
      syncModuleOnlineEffectForSession(session, moduleItem, {
        active: true,
      });
    }
  }

  return fittedItems.length;
}

function syncShipFittingStateForSession(session, shipID = null, options = {}) {
  return syncFittedModulesForSession(session, shipID, {
    onlyOnline: options.includeOfflineModules === true ? false : true,
    includeCharges: options.includeCharges !== false,
    onlyCharges: options.onlyCharges === true,
    emitOnlineEffects: options.emitOnlineEffects === true,
    emitChargeInventoryRows: options.emitChargeInventoryRows,
    syntheticFitTransition: options.syntheticFitTransition === true,
  });
}

function queueDeferredDockedShipSessionChange(
  session,
  shipID,
  previousClientShipID = null,
  options = {},
) {
  if (!session) {
    return;
  }

  const normalizedShipID = normalizeSessionShipValue(shipID);
  if (!normalizedShipID) {
    session._deferredDockedShipSessionChange = null;
    return;
  }

  session._deferredDockedShipSessionChange = {
    shipID: normalizedShipID,
    previousClientShipID: normalizeSessionShipValue(previousClientShipID),
    loginSelection: options.loginSelection === true,
    queuedAt: Date.now(),
    stationHangarListCount: 0,
    stationHangarSelfSeen: false,
    selfFlushTimer: null,
  };
}

function clearDeferredDockedShipSessionChangeTimer(pending) {
  if (!pending || !pending.selfFlushTimer) {
    return;
  }

  clearTimeout(pending.selfFlushTimer);
  pending.selfFlushTimer = null;
}

function scheduleDeferredDockedShipSessionChangeSelfFlush(session) {
  if (!session || !session._deferredDockedShipSessionChange) {
    return;
  }

  const pending = session._deferredDockedShipSessionChange;
  if (pending.selfFlushTimer) {
    return;
  }

  pending.selfFlushTimer = setTimeout(() => {
    if (session._deferredDockedShipSessionChange !== pending) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: "invbroker.GetSelfInvItemTimer",
    });
  }, 350);
}

function clearDeferredDockedShipSessionChange(session) {
  if (!session) {
    return;
  }

  clearDeferredDockedShipSessionChangeTimer(
    session._deferredDockedShipSessionChange,
  );
  session._deferredDockedShipSessionChange = null;
}

function clearDeferredDockedFittingReplayTimer(pending) {
  if (!pending || !pending.selfFlushTimer) {
    return;
  }

  clearTimeout(pending.selfFlushTimer);
  pending.selfFlushTimer = null;
}

function scheduleDeferredDockedFittingReplaySelfFlush(session, delayMs = 1500) {
  if (!session || !session._deferredDockedFittingReplay) {
    return;
  }

  const pending = session._deferredDockedFittingReplay;
  if (pending.selfFlushTimer) {
    return;
  }

  pending.selfFlushTimer = setTimeout(() => {
    if (session._deferredDockedFittingReplay !== pending) {
      return;
    }

    flushDeferredDockedFittingReplay(session, {
      trigger: "timer",
    });
  }, Math.max(0, Number(delayMs) || 0));
}

function clearDeferredDockedFittingReplay(session) {
  if (!session) {
    return;
  }

  clearDeferredDockedFittingReplayTimer(
    session._deferredDockedFittingReplay,
  );
  session._deferredDockedFittingReplay = null;
}

function queueDeferredDockedFittingReplay(session, replay, options = {}) {
  if (!session || !replay) {
    return false;
  }

  clearDeferredDockedFittingReplay(session);

  const shipID = Number(replay.shipID) || 0;
  if (shipID <= 0) {
    return false;
  }

  session._deferredDockedFittingReplay = {
    shipID,
    includeOfflineModules: replay.includeOfflineModules === true,
    includeCharges: replay.includeCharges === true,
    emitChargeInventoryRows: replay.emitChargeInventoryRows !== false,
    emitOnlineEffects: replay.emitOnlineEffects === true,
    syntheticFitTransition: replay.syntheticFitTransition === true,
    loginSelection: options.loginSelection === true,
    queuedAt: Date.now(),
    selfFlushTimer: null,
  };
  scheduleDeferredDockedFittingReplaySelfFlush(session, options.delayMs);
  return true;
}

function flushDeferredDockedFittingReplay(session, options = {}) {
  if (!session || !session._deferredDockedFittingReplay) {
    return false;
  }

  const pending = session._deferredDockedFittingReplay;
  clearDeferredDockedFittingReplayTimer(pending);
  session._deferredDockedFittingReplay = null;

  syncShipFittingStateForSession(session, pending.shipID, {
    includeOfflineModules: pending.includeOfflineModules === true,
    includeCharges: pending.includeCharges === true,
    emitChargeInventoryRows: pending.emitChargeInventoryRows !== false,
    emitOnlineEffects: pending.emitOnlineEffects === true,
    syntheticFitTransition: pending.syntheticFitTransition === true,
  });
  log.info(
    `[CharacterState] Flushed deferred docked fitting replay shipid=${pending.shipID} ` +
    `trigger=${options.trigger || "unknown"}`,
  );
  return true;
}

function shouldFlushDeferredDockedShipSessionChange(session, method) {
  if (!session || !session._deferredDockedShipSessionChange) {
    return false;
  }

  const pending = session._deferredDockedShipSessionChange;
  if (method === "GetSelfInvItem") {
    pending.stationHangarSelfSeen = true;
    if (pending.stationHangarListCount >= 1) {
      scheduleDeferredDockedShipSessionChangeSelfFlush(session);
    }
    return false;
  }

  if (method !== "List") {
    return false;
  }

  pending.stationHangarListCount =
    (pending.stationHangarListCount || 0) + 1;

  // Login needs the active ship restored as soon as the station hangar starts
  // listing ships. Waiting for a later pass can miss the hangar's initial
  // ship-presentation window entirely, which is exactly the "visible for one
  // character, invisible for most others" behavior in the latest traces.
  if (pending.loginSelection) {
    return pending.stationHangarListCount >= 1;
  }

  // The first station-hangar list is part of the initial bind/metadata pass.
  // Waiting for the follow-up list keeps shipid restoration closer to the
  // actual hangar open path instead of the char-select transition.
  return Boolean(
    pending.stationHangarSelfSeen || pending.stationHangarListCount >= 2,
  );
}

function flushDeferredDockedShipSessionChange(session, options = {}) {
  if (
    !session ||
    typeof session.sendSessionChange !== "function" ||
    !session._deferredDockedShipSessionChange
  ) {
    return false;
  }

  const pending = session._deferredDockedShipSessionChange;
  clearDeferredDockedShipSessionChangeTimer(pending);
  const shipID = normalizeSessionShipValue(pending.shipID);
  if (!shipID) {
    session._deferredDockedShipSessionChange = null;
    return false;
  }

  session.sendSessionChange(
    {
      shipid: [null, shipID],
    },
    {
      // Login's deferred active-ship restore behaves like a late remote
      // attribute update, not the initial character-select session bootstrap.
      // Using the bootstrap SID here correlates with the client creating a
      // second local session and logging "Session SID collision!".
      sessionId: 0n,
    },
  );

  session._deferredDockedShipSessionChange = null;
  log.info(
    `[CharacterState] Flushed deferred docked shipid=${shipID} trigger=${options.trigger || "unknown"}`,
  );
  return true;
}

function buildCharacterSessionNotificationPlan(session, options = {}) {
  if (!session) {
    return null;
  }

  const isDocked = options.isDocked === true;
  const isCharacterSelection = options.isCharacterSelection === true;
  const isInitialCharacterSelection =
    options.isInitialCharacterSelection === true;
  const oldShipID = normalizeSessionShipValue(options.oldShipID);
  const newShipID = normalizeSessionShipValue(
    options.newShipID === undefined ? session.shipID : options.newShipID,
  );
  const enteredStationFromNonStation =
    isDocked &&
    !options.oldStationID &&
    !isInitialCharacterSelection &&
    Boolean(
      options.oldLocationID ||
        options.oldSolarSystemID ||
        options.oldSolarSystemID2,
    );
  const deferDockedShipSessionChange =
    options.deferDockedShipSessionChange !== false &&
    isDocked &&
    enteredStationFromNonStation;

  const sessionChanges = {};
  appendSessionChange(
    sessionChanges,
    "charid",
    options.oldCharID || null,
    options.charID,
  );
  appendSessionChange(
    sessionChanges,
    "corpid",
    options.oldCorpID || null,
    session.corporationID,
  );
  appendSessionChange(
    sessionChanges,
    "allianceid",
    options.oldAllianceID || null,
    session.allianceID || null,
  );
  appendSessionChange(
    sessionChanges,
    "genderID",
    isInitialCharacterSelection ? null : options.oldGenderID,
    session.genderID,
  );
  appendSessionChange(
    sessionChanges,
    "bloodlineID",
    isInitialCharacterSelection ? null : options.oldBloodlineID,
    session.bloodlineID,
  );
  appendSessionChange(
    sessionChanges,
    "raceID",
    isInitialCharacterSelection ? null : options.oldRaceID,
    session.raceID,
  );
  appendSessionChange(
    sessionChanges,
    "schoolID",
    options.oldSchoolID,
    session.schoolID,
  );
  appendSessionChange(
    sessionChanges,
    "stationid",
    options.oldStationID || null,
    session.stationid || null,
  );
  appendSessionChange(
    sessionChanges,
    "stationid2",
    options.oldStationID2 || null,
    session.stationid2 || null,
  );
  appendSessionChange(
    sessionChanges,
    "solarsystemid",
    options.oldSolarSystemID || null,
    session.solarsystemid || null,
  );
  appendSessionChange(
    sessionChanges,
    "solarsystemid2",
    options.oldSolarSystemID2 || null,
    session.solarsystemid2 || null,
  );
  appendSessionChange(
    sessionChanges,
    "constellationid",
    options.oldConstellationID || null,
    session.constellationID,
  );
  appendSessionChange(
    sessionChanges,
    "regionid",
    options.oldRegionID || null,
    session.regionID,
  );
  appendSessionChange(
    sessionChanges,
    "shipid",
    oldShipID,
    deferDockedShipSessionChange ? null : newShipID,
  );
  appendSessionChange(
    sessionChanges,
    "locationid",
    options.oldLocationID || null,
    session.locationid || null,
  );
  appendSessionChange(
    sessionChanges,
    "worldspaceid",
    options.oldWorldspaceID || null,
    session.worldspaceid || null,
  );
  appendSessionChange(
    sessionChanges,
    "warfactionid",
    options.oldWarFactionID || null,
    session.warfactionid || session.warFactionID || null,
  );

  if (isCharacterSelection) {
    appendSessionChange(
      sessionChanges,
      "role",
      isInitialCharacterSelection
        ? null
        : normalizeOptionalRoleMask(options.oldRole),
      normalizeOptionalRoleMask(session.role),
    );
    appendSessionChange(
      sessionChanges,
      "corprole",
      normalizeOptionalRoleMask(options.oldCorpRole),
      normalizeOptionalRoleMask(session.corprole),
    );
    appendSessionChange(
      sessionChanges,
      "rolesAtAll",
      normalizeOptionalRoleMask(options.oldRolesAtAll),
      normalizeOptionalRoleMask(session.rolesAtAll),
    );
    appendSessionChange(
      sessionChanges,
      "rolesAtBase",
      normalizeOptionalRoleMask(options.oldRolesAtBase),
      normalizeOptionalRoleMask(session.rolesAtBase),
    );
    appendSessionChange(
      sessionChanges,
      "rolesAtHQ",
      normalizeOptionalRoleMask(options.oldRolesAtHQ),
      normalizeOptionalRoleMask(session.rolesAtHQ),
    );
    appendSessionChange(
      sessionChanges,
      "rolesAtOther",
      normalizeOptionalRoleMask(options.oldRolesAtOther),
      normalizeOptionalRoleMask(session.rolesAtOther),
    );
  }

  return {
    sendOnCharacterSelected: isCharacterSelection,
    sessionChanges,
    deferDockedShipSessionChange,
    oldShipID,
    newShipID,
    loginSelection: isInitialCharacterSelection,
    fittingReplay:
      isDocked && !deferDockedShipSessionChange
        ? {
            shipID:
              Number(options.shipID) ||
              Number(newShipID) ||
              Number(session.shipID || session.shipid || 0) ||
              0,
            includeOfflineModules: true,
            includeCharges: true,
          }
        : null,
  };
}

function flushCharacterSessionNotificationPlan(session, plan, options = {}) {
  if (!session || !plan) {
    return false;
  }

  if (plan.sendOnCharacterSelected === true) {
    session.sendNotification("OnCharacterSelected", "clientID", []);
  }

  if (
    plan.sessionChanges &&
    Object.keys(plan.sessionChanges).length > 0
  ) {
    session.sendSessionChange(plan.sessionChanges, options.sessionChangeOptions);
  }

  if (plan.deferDockedShipSessionChange === true) {
    queueDeferredDockedShipSessionChange(
      session,
      plan.newShipID,
      plan.oldShipID,
      {
        loginSelection: plan.loginSelection === true,
      },
    );
  } else {
    clearDeferredDockedShipSessionChange(session);
  }

  if (
    options.includeFittingReplay !== false &&
    plan.fittingReplay &&
    Number(plan.fittingReplay.shipID) > 0
  ) {
    if (session.stationid || session.stationID) {
      queueDeferredDockedFittingReplay(
        session,
        plan.fittingReplay,
        {
          loginSelection: plan.loginSelection === true,
        },
      );
    } else {
      syncShipFittingStateForSession(session, plan.fittingReplay.shipID, {
        includeOfflineModules:
          plan.fittingReplay.includeOfflineModules === true,
        includeCharges: plan.fittingReplay.includeCharges === true,
      });
    }
  }

  return true;
}

function applyCharacterToSession(session, charId, options = {}) {
  if (!session) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  // Character selection reuses the same client session object. Any deferred
  // docked-ship restore still hanging off a previous character selection can
  // flush into the new login and restore the wrong shipid a second later.
  // Start every fresh SelectCharacterID from a clean deferred state.
  if (options.selectionEvent !== false) {
    clearDeferredDockedShipSessionChange(session);
    clearDeferredDockedFittingReplay(session);
  }

  const charData = getCharacterRecord(charId);
  if (!charData) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const activeShip =
    getActiveShipRecord(charId) ||
    resolveShipByTypeID(charData.shipTypeID || 606) || {
      itemID: charData.shipID || Number(charId) + 100,
      typeID: charData.shipTypeID || 606,
      itemName: charData.shipName || "Ship",
    };

  const oldCharID = session.characterID;
  const oldCorpID = session.corporationID;
  const oldAllianceID = session.allianceID;
  const oldStationID = session.stationID || session.stationid || null;
  const oldStationID2 = session.stationid2 || null;
  const oldSolarSystemID = session.solarsystemid || null;
  const oldSolarSystemID2 = session.solarsystemid2 || null;
  const oldConstellationID = session.constellationID;
  const oldRegionID = session.regionID;
  const oldGenderID = session.genderID ?? session.genderid ?? null;
  const oldBloodlineID = session.bloodlineID ?? session.bloodlineid ?? null;
  const oldRaceID = session.raceID ?? session.raceid ?? null;
  const oldSchoolID = session.schoolID ?? session.schoolid ?? null;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldLocationID = session.locationid ?? null;
  const oldWorldspaceID = session.worldspaceid ?? null;
  const oldHqID = session.hqID;
  const oldBaseID = session.baseID;
  const oldWarFactionID = session.warFactionID;
  const oldRole = session.role ?? null;
  const oldCorpRole = session.corprole ?? null;
  const oldRolesAtAll = session.rolesAtAll ?? null;
  const oldRolesAtBase = session.rolesAtBase ?? null;
  const oldRolesAtHQ = session.rolesAtHQ ?? null;
  const oldRolesAtOther = session.rolesAtOther ?? null;
  const storedStationID = hasLocationID(charData.stationID)
    ? Number(charData.stationID)
    : null;
  const storedWorldSpaceID = hasLocationID(charData.worldSpaceID)
    ? Number(charData.worldSpaceID)
    : null;
  const storedSolarSystemID = hasLocationID(charData.solarSystemID)
    ? Number(charData.solarSystemID)
    : 30000142;
  const homeStationInfo = resolveHomeStationInfo(charData, session);
  const homeStationID = homeStationInfo.homeStationID;
  const cloneStationID = homeStationInfo.cloneStationID;
  const isDocked = Boolean(storedStationID);
  const stationID = isDocked ? storedStationID : null;
  const solarSystemID = storedSolarSystemID || 30000142;
  const systemIdentity = resolveSystemIdentity(solarSystemID, charData);
  const shipID = activeShip.itemID || charData.shipID || Number(charId) + 100;
  const shipTypeID = activeShip.typeID || charData.shipTypeID || 601;
  const shipMetadata = resolveShipByTypeID(shipTypeID);

  session.characterID = charId;
  session.charid = charId;
  session.characterName = charData.characterName || "Unknown";
  session.characterTypeID = charData.typeID || 1373;
  session.genderID = charData.gender || 1;
  session.genderid = session.genderID;
  session.bloodlineID = charData.bloodlineID || 1;
  session.bloodlineid = session.bloodlineID;
  session.raceID = charData.raceID || 1;
  session.raceid = session.raceID;
  session.schoolID = charData.schoolID || charData.corporationID || null;
  session.schoolid = session.schoolID;
  session.corporationID = charData.corporationID || 1000009;
  session.corpid = session.corporationID;
  session.allianceID = charData.allianceID || null;
  session.allianceid = session.allianceID || null;
  session.stationid = isDocked ? stationID : null;
  session.stationID = isDocked ? stationID : null;
  session.stationid2 = isDocked ? stationID : null;
  session.worldspaceid = storedWorldSpaceID || null;
  session.locationid = isDocked ? stationID : solarSystemID;
  session.homeStationID = homeStationID;
  session.homestationid = homeStationID;
  session.cloneStationID = cloneStationID;
  session.clonestationid = cloneStationID;
  session.solarsystemid2 = solarSystemID;
  session.solarsystemid = isDocked ? null : solarSystemID;
  session.constellationID = systemIdentity.constellationID;
  session.constellationid = session.constellationID;
  session.regionID = systemIdentity.regionID;
  session.regionid = session.regionID;
  session.activeShipID = shipID;
  // V23.02 station flow still expects the active ship to remain present in the
  // session while docked. Clearing it breaks hangar ship presentation and ship
  // boarding updates in invCache/godma.
  session.shipID = shipID;
  session.shipid = shipID;
  session.shipTypeID = shipTypeID;
  session.shipName =
    (shipMetadata && shipMetadata.name) ||
    activeShip.itemName ||
    charData.shipName ||
    "Ship";
  session.skillPoints = charData.skillPoints || 0;
  session.plexBalance = normalizeInteger(
    charData.plexBalance,
    DEFAULT_PLEX_BALANCE,
  );
  session.hqID = charData.hqID || null;
  session.baseID = charData.baseID || null;
  session.warFactionID = charData.warFactionID || null;
  session.warfactionid = session.warFactionID || null;
  session.corprole = 0n;
  session.rolesAtAll = 0n;
  session.rolesAtBase = 0n;
  session.rolesAtHQ = 0n;
  session.rolesAtOther = 0n;
  const isCharacterSelection =
    options.selectionEvent !== false &&
    (oldCharID === undefined || oldCharID === null || oldCharID !== charId);
  const isInitialCharacterSelection =
    isCharacterSelection &&
    (oldCharID === undefined || oldCharID === null || oldCharID === 0);
  session._loginInventoryBootstrapPending =
    !isDocked && isCharacterSelection;
  const notificationPlan = buildCharacterSessionNotificationPlan(session, {
    ...options,
    charID: charId,
    shipID,
    isDocked,
    isCharacterSelection,
    isInitialCharacterSelection,
    oldCharID,
    oldCorpID,
    oldAllianceID,
    oldStationID,
    oldStationID2,
    oldSolarSystemID,
    oldSolarSystemID2,
    oldConstellationID,
    oldRegionID,
    oldGenderID,
    oldBloodlineID,
    oldRaceID,
    oldSchoolID,
    oldShipID,
    oldLocationID,
    oldWorldspaceID,
    oldWarFactionID,
    oldRole,
    oldCorpRole,
    oldRolesAtAll,
    oldRolesAtBase,
    oldRolesAtHQ,
    oldRolesAtOther,
  });

  if (options.emitNotifications !== false) {
    flushCharacterSessionNotificationPlan(session, notificationPlan);
  }

  if (options.logSelection !== false) {
    log.info(
      `[CharState] Applied ${session.characterName}(${charId}) ship=${session.shipName}(${session.shipTypeID}) activeShipID=${session.activeShipID} docked=${isDocked} station=${session.stationid} system=${solarSystemID}`,
    );
  }

  return {
    success: true,
    data: charData,
    notificationPlan,
  };
}

function activateShipForSession(session, shipId, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const docked = Boolean(session.stationid || session.stationID);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const currentShip = getActiveShipRecord(charId);
  const targetShip = findCharacterShip(charId, shipId);
  if (!targetShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updateResult = setActiveShipForCharacter(charId, targetShip.itemID);
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, charId, {
    emitNotifications: options.emitNotifications !== false,
    logSelection: options.logSelection !== false,
    selectionEvent: false,
  });

  if (
    applyResult.success &&
    options.emitNotifications !== false
  ) {
    // Docked boarding does not move the hull between containers, so the client
    // only sees a shipid session change unless we explicitly refresh the item
    // cache entries that back the hangar/active-ship presentation.
    const refreshedTargetShip = getActiveShipRecord(charId) || targetShip;
    const refreshQueue = [];
    const seenItemIds = new Set();

    if (currentShip && currentShip.itemID !== targetShip.itemID) {
      refreshQueue.push(currentShip);
    }
    refreshQueue.push(refreshedTargetShip);

    for (const shipItem of refreshQueue) {
      if (
        !shipItem ||
        seenItemIds.has(shipItem.itemID)
      ) {
        continue;
      }

      seenItemIds.add(shipItem.itemID);
      syncInventoryItemForSession(
        session,
        shipItem,
        {
          locationID: shipItem.locationID,
          flagID: shipItem.flagID,
          quantity: shipItem.quantity,
          singleton: shipItem.singleton,
          stacksize: shipItem.stacksize,
        },
        {
          emitCfgLocation: true,
        },
      );
    }
  }

  return {
    ...applyResult,
    changed: !currentShip || currentShip.itemID !== targetShip.itemID,
    activeShip: targetShip,
  };
}

function clearCharacterFromSession(session, options = {}) {
  if (!session) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  const oldCharID = session.characterID || null;
  const oldCorpID = session.corporationID || null;
  const oldAllianceID = session.allianceID || null;
  const oldStationID = session.stationID || session.stationid || null;
  const oldStationID2 = session.stationid2 || null;
  const oldSolarSystemID = session.solarsystemid || null;
  const oldSolarSystemID2 = session.solarsystemid2 || null;
  const oldConstellationID = session.constellationID || null;
  const oldRegionID = session.regionID || null;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldLocationID = session.locationid ?? null;
  const oldWorldspaceID = session.worldspaceid ?? null;
  const oldSchoolID = session.schoolID ?? session.schoolid ?? null;
  const oldGenderID = session.genderID ?? session.genderid ?? null;
  const oldBloodlineID = session.bloodlineID ?? session.bloodlineid ?? null;
  const oldRaceID = session.raceID ?? session.raceid ?? null;
  const oldWarFactionID = session.warFactionID ?? session.warfactionid ?? null;
  const oldCorpRole = session.corprole ?? null;
  const oldRolesAtAll = session.rolesAtAll ?? null;
  const oldRolesAtBase = session.rolesAtBase ?? null;
  const oldRolesAtHQ = session.rolesAtHQ ?? null;
  const oldRolesAtOther = session.rolesAtOther ?? null;

  clearDeferredDockedShipSessionChange(session);

  session.characterID = 0;
  session.charid = null;
  session.characterName = "";
  session.characterTypeID = 1373;
  session.genderID = 1;
  session.genderid = session.genderID;
  session.bloodlineID = 1;
  session.bloodlineid = session.bloodlineID;
  session.raceID = 1;
  session.raceid = session.raceID;
  session.schoolID = null;
  session.schoolid = null;
  session.corporationID = 0;
  session.corpid = 0;
  session.allianceID = null;
  session.allianceid = null;
  session.stationid = null;
  session.stationID = null;
  session.stationid2 = null;
  session.worldspaceid = null;
  session.locationid = null;
  session.homeStationID = 0;
  session.homestationid = 0;
  session.cloneStationID = 0;
  session.clonestationid = 0;
  session.solarsystemid = null;
  session.solarsystemid2 = null;
  session.constellationID = 0;
  session.constellationid = 0;
  session.regionID = 0;
  session.regionid = 0;
  session.activeShipID = 0;
  session.shipID = null;
  session.shipid = null;
  session.shipTypeID = 0;
  session.shipName = "";
  session.skillPoints = 0;
  session.hqID = null;
  session.baseID = null;
  session.warFactionID = null;
  session.warfactionid = null;
  session.corprole = 0n;
  session.rolesAtAll = 0n;
  session.rolesAtBase = 0n;
  session.rolesAtHQ = 0n;
  session.rolesAtOther = 0n;

  if (options.emitNotifications !== false) {
    const sessionChanges = {};
    appendSessionChange(sessionChanges, "charid", oldCharID, null);
    appendSessionChange(sessionChanges, "corpid", oldCorpID, null);
    appendSessionChange(sessionChanges, "allianceid", oldAllianceID, null);
    appendSessionChange(sessionChanges, "genderID", oldGenderID, null);
    appendSessionChange(sessionChanges, "bloodlineID", oldBloodlineID, null);
    appendSessionChange(sessionChanges, "raceID", oldRaceID, null);
    appendSessionChange(sessionChanges, "schoolID", oldSchoolID, null);
    appendSessionChange(sessionChanges, "stationid", oldStationID, null);
    appendSessionChange(sessionChanges, "stationid2", oldStationID2, null);
    appendSessionChange(sessionChanges, "worldspaceid", oldWorldspaceID, null);
    appendSessionChange(sessionChanges, "locationid", oldLocationID, null);
    appendSessionChange(sessionChanges, "solarsystemid", oldSolarSystemID, null);
    appendSessionChange(sessionChanges, "solarsystemid2", oldSolarSystemID2, null);
    appendSessionChange(sessionChanges, "constellationid", oldConstellationID, null);
    appendSessionChange(sessionChanges, "regionid", oldRegionID, null);
    appendSessionChange(sessionChanges, "shipid", oldShipID, null);
    appendSessionChange(sessionChanges, "warfactionid", oldWarFactionID, null);
    appendSessionChange(sessionChanges, "corprole", oldCorpRole, 0n);
    appendSessionChange(sessionChanges, "rolesAtAll", oldRolesAtAll, 0n);
    appendSessionChange(sessionChanges, "rolesAtBase", oldRolesAtBase, 0n);
    appendSessionChange(sessionChanges, "rolesAtHQ", oldRolesAtHQ, 0n);
    appendSessionChange(sessionChanges, "rolesAtOther", oldRolesAtOther, 0n);

    if (Object.keys(sessionChanges).length > 0) {
      session.sendSessionChange(sessionChanges);
    }
  }

  return {
    success: true,
    data: {
      oldCharID,
    },
  };
}

function giveItemToHangarForSession(session, itemType, quantity = 1) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const docked = Boolean(session.stationid || session.stationID);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const stationId = session.stationid || session.stationID || 60003760;
  const grantResult = grantItemToCharacterStationHangar(
    charId,
    stationId,
    itemType,
    quantity,
  );
  if (!grantResult.success) {
    return grantResult;
  }

  for (const change of grantResult.data.changes || []) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForSession(
      session,
      change.item,
      change.previousState || {
        locationID: 0,
        flagID: ITEM_FLAGS.HANGAR,
      },
      {
        emitCfgLocation: true,
      },
    );
  }

  return {
    success: true,
    data: grantResult.data,
  };
}

function spawnShipInHangarForSession(session, shipType) {
  const spawnResult = giveItemToHangarForSession(session, shipType, 1);
  if (!spawnResult.success) {
    return spawnResult;
  }

  return {
    success: true,
    created: Boolean(
      spawnResult.data.changes &&
        spawnResult.data.changes.some((change) => change && change.created),
    ),
    ship: (spawnResult.data.items && spawnResult.data.items[0]) || null,
    data: spawnResult.data,
  };
}

function setActiveShipForSession(session, shipType) {
  return spawnShipInHangarForSession(session, shipType);
}

module.exports = {
  CHARACTERS_TABLE,
  DEFAULT_PLEX_BALANCE,
  DEFAULT_MCT_EXPIRY_FILETIME,
  getCharacterRecord,
  updateCharacterRecord,
  resolveHomeStationInfo,
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  applyCharacterToSession,
  clearCharacterFromSession,
  activateShipForSession,
  giveItemToHangarForSession,
  spawnShipInHangarForSession,
  setActiveShipForSession,
  buildInventoryItemRow,
  buildItemChangePayload,
  syncInventoryItemForSession,
  syncChargeSublocationForSession,
  syncChargeSublocationTransitionForSession,
  syncLoadedChargeSublocationsForSession,
  syncLoadedChargeDogmaBootstrapForSession,
  syncLoadedChargeQuantityBootstrapForSession,
  syncFittedModulesForSession,
  syncShipFittingStateForSession,
  syncModuleOnlineEffectForSession,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  clearDeferredDockedFittingReplay,
  flushDeferredDockedFittingReplay,
  flushCharacterSessionNotificationPlan,
  toBigInt,
  deriveEmpireID,
  deriveFactionID,
  buildLocationChangePayload,
};

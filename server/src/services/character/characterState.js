const fs = require("fs");
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
  getItemMutationVersion,
  ITEM_FLAGS,
  grantItemToCharacterStationHangar,
  setActiveShipForCharacter,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  ensureCharacterSkills,
  getCharacterSkillPointTotal,
  getSkillMutationVersion,
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
  buildEffectiveItemAttributeMap,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  buildWeaponDogmaAttributeOverrides,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
} = require(path.join(__dirname, "../../space/modules/moduleLoadParity"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getFactionIDForCorporation,
} = require(path.join(__dirname, "../faction/factionState"));
const {
  getDockedLocationKind,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  getSessionFleetState,
} = require(path.join(__dirname, "../fleets/fleetHelpers"));

function getStructureState() {
  return require(path.join(__dirname, "../structure/structureState"));
}

const CHARACTERS_TABLE = "characters";
const INV_UPDATE_LOCATION = 3;
const INV_UPDATE_FLAG = 4;
const INV_UPDATE_QUANTITY = 5;
const INV_UPDATE_SINGLETON = 9;
const INV_UPDATE_STACKSIZE = 10;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const ATTRIBUTE_VOLUME = getAttributeIDByNames("volume") || 161;
const EFFECT_ONLINE = getEffectIDByNames("online") || 16;
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
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
  ["locationID", 20],
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
const CHARGE_BOOTSTRAP_MODE_PRIME_AND_REPAIR =
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR;
const CHARGE_BOOTSTRAP_MODE_QUANTITY_AND_REPAIR =
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR;
const CHARGE_BOOTSTRAP_MODE_REPAIR_THEN_QUANTITY =
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY;
const CHARGE_BOOTSTRAP_MODE_PRIME_REPAIR_THEN_QUANTITY =
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY;
const CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY =
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY;
const MISSILE_DEBUG_PATH = path.join(__dirname, "../../logs/space-missile-debug.log");
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_EXPLOSION_DELAY = getAttributeIDByNames("explosionDelay") || 281;
const ATTRIBUTE_DETONATION_RANGE = getAttributeIDByNames("detonationRange") || 108;

function appendMissileDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(MISSILE_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      MISSILE_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[missile-debug] characterState write failed: ${error.message}`);
  }
}

function roundMissileTraceNumber(value, digits = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : 0;
}

function summarizeMissileDebugItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    itemID: Number(item.itemID) || 0,
    typeID: Number(item.typeID) || 0,
    ownerID: Number(item.ownerID) || 0,
    locationID: Number(item.locationID) || 0,
    flagID: Number(item.flagID) || 0,
    groupID: Number(item.groupID) || 0,
    categoryID: Number(item.categoryID) || 0,
    quantity: Math.max(0, Number(item.quantity) || 0),
    stacksize: Math.max(0, Number(item.stacksize) || 0),
    singleton: Number(item.singleton) || 0,
    launcherID: Number(item.launcherID) || 0,
    itemName: typeof item.itemName === "string" ? item.itemName : null,
    moduleState:
      item.moduleState && typeof item.moduleState === "object"
        ? {
            damage: roundMissileTraceNumber(item.moduleState.damage, 6),
            armorDamage: roundMissileTraceNumber(item.moduleState.armorDamage, 6),
            shieldCharge: roundMissileTraceNumber(item.moduleState.shieldCharge, 6),
            incapacitated: item.moduleState.incapacitated === true,
          }
        : null,
  };
}

function summarizeMissileDogmaSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const chargeAttributes =
    snapshot.chargeAttributes && typeof snapshot.chargeAttributes === "object"
      ? snapshot.chargeAttributes
      : {};
  const moduleAttributes =
    snapshot.moduleAttributes && typeof snapshot.moduleAttributes === "object"
      ? snapshot.moduleAttributes
      : {};
  return {
    family: snapshot.family || null,
    moduleID: Number(snapshot.moduleID) || 0,
    moduleTypeID: Number(snapshot.moduleTypeID) || 0,
    chargeItemID: Number(snapshot.chargeItemID) || 0,
    chargeTypeID: Number(snapshot.chargeTypeID) || 0,
    chargeQuantity: Math.max(0, Number(snapshot.chargeQuantity) || 0),
    durationMs: roundMissileTraceNumber(snapshot.durationMs, 6),
    capNeed: roundMissileTraceNumber(snapshot.capNeed, 6),
    damageMultiplier: roundMissileTraceNumber(snapshot.damageMultiplier, 6),
    rawShotDamage:
      snapshot.rawShotDamage && typeof snapshot.rawShotDamage === "object"
        ? {
            em: roundMissileTraceNumber(snapshot.rawShotDamage.em, 6),
            thermal: roundMissileTraceNumber(snapshot.rawShotDamage.thermal, 6),
            kinetic: roundMissileTraceNumber(snapshot.rawShotDamage.kinetic, 6),
            explosive: roundMissileTraceNumber(snapshot.rawShotDamage.explosive, 6),
          }
        : null,
    flightTimeMs: roundMissileTraceNumber(snapshot.flightTimeMs, 6),
    maxVelocity: roundMissileTraceNumber(snapshot.maxVelocity, 6),
    approxRange: roundMissileTraceNumber(snapshot.approxRange, 6),
    relevantChargeAttributes: {
      explosionDelay: roundMissileTraceNumber(
        chargeAttributes[ATTRIBUTE_EXPLOSION_DELAY],
        6,
      ),
      maxVelocity: roundMissileTraceNumber(
        chargeAttributes[ATTRIBUTE_MAX_VELOCITY],
        6,
      ),
      detonationRange: roundMissileTraceNumber(
        chargeAttributes[ATTRIBUTE_DETONATION_RANGE],
        6,
      ),
    },
    moduleAttributes,
    chargeAttributes,
    shipModifierAttributes:
      snapshot.shipModifierAttributes && typeof snapshot.shipModifierAttributes === "object"
        ? snapshot.shipModifierAttributes
        : {},
    characterAttributes:
      snapshot.characterAttributes && typeof snapshot.characterAttributes === "object"
        ? snapshot.characterAttributes
        : {},
  };
}

function logMissileChargeDebug(event, details = {}) {
  appendMissileDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    ...details,
  }));
}
const characterRecordCache = new Map();

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

  characterRecordCache.delete(String(charId));

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

function appendSessionChange(changes, key, oldValue, newValue, options = {}) {
  if (!options.force && oldValue === newValue) {
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
    if (
      record.factionID !== null &&
      record.factionID !== undefined &&
      record.factionID !== 0
    ) {
      return Number(record.factionID) || null;
    }
  }

  return getFactionIDForCorporation(record.corporationID) || null;
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

function normalizeStandingOwnerID(value) {
  const numeric = normalizeInteger(value, 0);
  return numeric > 0 ? numeric : null;
}

function normalizeStandingRows(rows = [], fallbackRows = []) {
  const source = Array.isArray(rows) && rows.length ? rows : fallbackRows;
  return source
    .map((entry) => ({
      fromID: normalizeStandingOwnerID(
        entry && Object.prototype.hasOwnProperty.call(entry, "fromID")
          ? entry.fromID
          : null,
      ),
      toID: normalizeStandingOwnerID(
        entry && Object.prototype.hasOwnProperty.call(entry, "toID")
          ? entry.toID
          : null,
      ),
      standing: Number(entry && entry.standing) || 0.0,
    }))
    .filter(
      (entry) =>
        entry.fromID !== null &&
        entry.toID !== null &&
        entry.fromID !== entry.toID,
    );
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
  const currentStructureID = hasLocationID(record.structureID)
    ? Number(record.structureID)
    : null;
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
  let repairedStructureID = currentStructureID;
  let repairedSolarSystemID = currentSolarSystemID;

  if (shipFlagID === ITEM_FLAGS.HANGAR && shipLocationID) {
    const station = worldData.getStationByID(shipLocationID);
    if (station) {
      repairedStationID = station.stationID;
      repairedStructureID = null;
      repairedSolarSystemID = Number(station.solarSystemID || currentSolarSystemID || 0) || 30000142;
    } else {
      const structure = getStructureState().getStructureByID(shipLocationID, {
        refresh: false,
      });
      if (structure) {
        repairedStationID = null;
        repairedStructureID = structure.structureID;
        repairedSolarSystemID = Number(structure.solarSystemID || currentSolarSystemID || 0) || 30000142;
      }
    }
  } else if (shipFlagID === 0) {
    const inferredSolarSystemID =
      shipSpaceSystemID ||
      (shipLocationID && worldData.getSolarSystemByID(shipLocationID) ? shipLocationID : null);
    if (inferredSolarSystemID) {
      repairedStationID = null;
      repairedStructureID = null;
      repairedSolarSystemID = inferredSolarSystemID;
    }
  }

  if (
    repairedStationID === currentStationID &&
    repairedStructureID === currentStructureID &&
    repairedSolarSystemID === currentSolarSystemID
  ) {
    return record;
  }

  const nextRecord = {
    ...record,
    stationID: repairedStationID,
    structureID: repairedStructureID,
    solarSystemID: repairedSolarSystemID || currentSolarSystemID || 30000142,
  };
  const systemIdentity = resolveSystemIdentity(nextRecord.solarSystemID, nextRecord);
  nextRecord.constellationID = systemIdentity.constellationID;
  nextRecord.regionID = systemIdentity.regionID;

  log.warn(
    `[CharacterState] Reconciled location from active ship for char=${charId} ship=${activeShip.itemID} station=${currentStationID}=>${nextRecord.stationID} structure=${currentStructureID}=>${nextRecord.structureID} system=${currentSolarSystemID}=>${nextRecord.solarSystemID}`,
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
  normalized.structureID = hasLocationID(normalized.structureID)
    ? Number(normalized.structureID)
    : null;
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
  normalized.walletJournal = Array.isArray(normalized.walletJournal)
    ? normalized.walletJournal.map((entry) => cloneValue(entry))
    : [];
  normalized.marketTransactions = Array.isArray(normalized.marketTransactions)
    ? normalized.marketTransactions.map((entry) => cloneValue(entry))
    : [];
  normalized.plexVaultTransactions = Array.isArray(normalized.plexVaultTransactions)
    ? normalized.plexVaultTransactions.map((entry) => cloneValue(entry))
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
  const itemMutationVersion = getItemMutationVersion();
  const skillMutationVersion = getSkillMutationVersion();
  const cacheKey = String(charId);
  const cachedEntry = characterRecordCache.get(cacheKey);
  if (
    cachedEntry &&
    cachedEntry.rawRecord === rawRecord &&
    cachedEntry.itemMutationVersion === itemMutationVersion &&
    cachedEntry.skillMutationVersion === skillMutationVersion
  ) {
    return cloneValue(cachedEntry.record);
  }

  const normalizedRecord = normalizeCharacterRecord(charId, rawRecord);
  if (!normalizedRecord) {
    return null;
  }

  if (JSON.stringify(rawRecord) !== JSON.stringify(normalizedRecord)) {
    writeCharacterRecord(charId, normalizedRecord);
  }

  const currentCharacters = readCharacters();
  characterRecordCache.set(cacheKey, {
    rawRecord: currentCharacters[String(charId)] || rawRecord,
    itemMutationVersion,
    skillMutationVersion,
    record: cloneValue(normalizedRecord),
  });
  return cloneValue(normalizedRecord);
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

function buildInventoryDogmaInfoInventoryRow(item) {
  const singleton = Number(item && item.singleton) === 1 ? 1 : 0;
  const normalizedStacksize = singleton === 1
    ? 1
    : Math.max(0, Number(item && (item.stacksize ?? item.quantity ?? 0)) || 0);
  const normalizedQuantity = singleton === 1
    ? -1
    : normalizedStacksize;
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
          "stacksize",
          "singleton",
        ]],
        ["line", [
          item.itemID,
          item.typeID,
          item.ownerID ?? null,
          item.locationID,
          item.flagID,
          normalizedQuantity,
          item.groupID,
          item.categoryID,
          item.customInfo || "",
          normalizedStacksize,
          singleton,
        ]],
      ],
    },
  };
}

function normalizeDogmaNumericAttributeMap(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([attributeID, value]) => [Number(attributeID), Number(value)])
      .filter(
        ([attributeID, value]) =>
          Number.isInteger(attributeID) && Number.isFinite(value),
      ),
  );
}

function resolveChargeDogmaPrimeWeaponContext(item, options = {}) {
  if (!item || Number(item.categoryID) !== 8) {
    return null;
  }

  const session = options.session || null;
  const characterID = Number(
    options.characterID ??
      options.charID ??
      item.ownerID ??
      (session && (session.characterID ?? session.charid)) ??
      0,
  ) || 0;
  const shipID = Number(
    options.shipID ??
      options.locationID ??
      item.locationID ??
      (session && (session.shipID ?? session.shipid)) ??
      0,
  ) || 0;
  const flagID = Number(options.flagID ?? item.flagID ?? 0) || 0;

  if (characterID <= 0 || shipID <= 0 || flagID <= 0) {
    return null;
  }

  const shipItem =
    findCharacterShip(characterID, shipID) ||
    (() => {
      const activeShip = getActiveShipRecord(characterID);
      return activeShip && Number(activeShip.itemID) === shipID ? activeShip : null;
    })();
  if (!shipItem) {
    return null;
  }

  const moduleItem = getFittedModuleItems(characterID, shipID).find(
    (candidate) => Number(candidate && candidate.flagID) === flagID,
  );
  if (!moduleItem) {
    return null;
  }

  return {
    characterID,
    shipItem,
    moduleItem,
    chargeItem: item,
  };
}

function buildChargeDogmaPrimeAttributes(item, options = {}) {
  const normalizedChargeQuantity = Math.max(
    0,
    Number(item && (item.stacksize ?? item.quantity ?? 0)) || 0,
  );
  const typeRow =
    resolveItemByTypeID(Number(item && item.typeID) || 0) || null;
  const attributes = normalizeDogmaNumericAttributeMap(
    buildEffectiveItemAttributeMap(item),
  );
  const weaponContext = resolveChargeDogmaPrimeWeaponContext(item, options);

  if (weaponContext) {
    try {
      const weaponOverrides = buildWeaponDogmaAttributeOverrides(weaponContext);
      const chargeAttributes = normalizeDogmaNumericAttributeMap(
        weaponOverrides && weaponOverrides.chargeAttributes,
      );
      for (const [attributeID, value] of Object.entries(chargeAttributes)) {
        attributes[attributeID] = value;
      }
    } catch (error) {
      log.warn(
        `[charge-prime] failed to resolve fitted charge overrides for ` +
          `${JSON.stringify(item && item.itemID)}: ${error.message}`,
      );
    }
  }

  const resolvedVolume = Number(
    (item && item.volume) ??
      (typeRow && typeRow.volume) ??
      NaN,
  );
  if (Number.isFinite(resolvedVolume) && resolvedVolume >= 0) {
    attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
  }

  attributes[ATTRIBUTE_QUANTITY] = normalizedChargeQuantity;
  return attributes;
}

function buildChargeDogmaPrimeEntry(item, options = {}) {
  const chargeAttributes = buildChargeDogmaPrimeAttributes(item, options);
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
          entries: Object.entries(chargeAttributes).map(([attributeID, value]) => [
            Number(attributeID),
            Number(value),
          ]),
        }],
        ["description", options.description || "charge"],
        ["time", now],
        ["wallclockTime", now],
      ],
    },
  };
}

function buildInventoryDogmaPrimeEntry(item, options = {}) {
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
        ["invItem", buildInventoryDogmaInfoInventoryRow(item)],
        ["activeEffects", { type: "dict", entries: [] }],
        ["attributes", { type: "dict", entries: [] }],
        ["description", options.description || "item"],
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

function buildModuleAttributeChangePayload(
  session,
  itemID,
  attributeID,
  value,
  oldValue = null,
) {
  const when =
    session && session._space && typeof session._space.simFileTime === "bigint"
      ? session._space.simFileTime
      : currentFileTime();

  return [
    "OnModuleAttributeChanges",
    Number(session && (session.characterID || session.charid)) || 0,
    itemID,
    Number(attributeID) || 0,
    when,
    Number.isFinite(Number(value)) ? Number(value) : value,
    oldValue,
    null,
  ];
}

function syncModuleAttributeChangesForSession(session, changes = []) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !Array.isArray(changes)
  ) {
    return false;
  }

  const normalizedChanges = changes.filter(
    (change) => Array.isArray(change) && change.length >= 6,
  );
  if (normalizedChanges.length === 0) {
    return false;
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: normalizedChanges,
  }]);
  return true;
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
  options = {},
) {
  const afterSync =
    options && typeof options.afterSync === "function"
      ? options.afterSync
      : null;
  const numericDelayMs = Math.max(0, Number(delayMs) || 0);
  if (numericDelayMs <= 0) {
    syncChargeSublocationForSession(session, item, previousState);
    if (afterSync) {
      afterSync();
    }
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
    if (afterSync) {
      afterSync();
    }
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
    forceRepair = false,
    forcePrimeNextCharge = false,
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
  const shouldForceRepair =
    forceRepair === true &&
    nextTypeID > 0 &&
    nextQuantity > 0;

  if (
    previousTypeID === nextTypeID &&
    previousQuantity === nextQuantity &&
    !shouldForceRepair
  ) {
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
      (primeNextCharge === true && previousTypeID !== nextTypeID) ||
      (forcePrimeNextCharge === true && shouldForceRepair);
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
    const shouldSendPostRepairQuantityBootstrap =
      shouldPrimeNextCharge &&
      previousTypeID !== nextTypeID &&
      nextTypeID > 0 &&
      nextQuantity > 0;
    const repairDelayMs =
      shouldPrimeNextCharge || shouldForceRepair
        ? Math.max(
          0,
          Number(nextChargeRepairDelayMs) || 0,
          finalizeDelayMs,
        )
        : 0;
    const scheduled = syncChargeSublocationForSessionAfterDelay(
      session,
      nextCharge,
      shouldForceRepair
        ? buildChargeSublocationRepairPreviousState({
          previousTypeID: 0,
          previousQuantity: 0,
          nextTypeID,
          nextQuantity,
        })
        : buildChargeSublocationRepairPreviousState({
          previousTypeID,
          previousQuantity,
          nextTypeID,
          nextQuantity,
        }),
      repairDelayMs,
      {
        afterSync: shouldSendPostRepairQuantityBootstrap
          ? () => {
            syncModuleAttributeChangesForSession(session, [
              buildModuleAttributeChangePayload(
                session,
                nextCharge.itemID,
                ATTRIBUTE_QUANTITY,
                nextQuantity,
                0,
              ),
            ]);
            log.debug(
              `[charge-transition] shipID=${numericShipID} ` +
              `flagID=${numericFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
              `itemID=${JSON.stringify(buildChargeTupleItemID(
                numericShipID,
                numericFlagID,
                nextTypeID,
              ))} mode=post-item-change-quantity`,
            );
          }
          : null,
      },
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
            ? shouldForceRepair
              ? "forced-post-prime-item-change-delayed"
              : "post-prime-item-change-delayed"
            : "post-prime-item-change"
          : shouldForceRepair
            ? scheduled
              ? "forced-item-change-delayed"
              : "forced-item-change"
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
    log.debug(
      `[charge-bootstrap] skipped charID=${Number(charId) || 0} ` +
      `shipID=${Number(resolvedShipID) || 0} reason=no-loaded-charges`,
    );
    return 0;
  }
  const shipItem = findCharacterShipItem(charId, resolvedShipID);
  const fittedModuleItems = getFittedModuleItems(charId, resolvedShipID)
    .slice()
    .sort((left, right) => (Number(left && left.flagID) || 0) - (Number(right && right.flagID) || 0));

  const mode =
    options.mode === CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY
      ? CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY
      : options.mode === CHARGE_BOOTSTRAP_MODE_QUANTITY_AND_REPAIR
        ? CHARGE_BOOTSTRAP_MODE_QUANTITY_AND_REPAIR
        : options.mode === CHARGE_BOOTSTRAP_MODE_REPAIR_THEN_QUANTITY
          ? CHARGE_BOOTSTRAP_MODE_REPAIR_THEN_QUANTITY
        : options.mode === CHARGE_BOOTSTRAP_MODE_PRIME_REPAIR_THEN_QUANTITY
          ? CHARGE_BOOTSTRAP_MODE_PRIME_REPAIR_THEN_QUANTITY
        : CHARGE_BOOTSTRAP_MODE_PRIME_AND_REPAIR;
  const defaultRefreshDelayMs =
    mode === CHARGE_BOOTSTRAP_MODE_REFRESH_ONLY
      ? CHARGE_TRANSITION_FINALIZE_DELAY_MS
      : CHARGE_BOOTSTRAP_REPAIR_DELAY_MS;
  const refreshDelayMs =
    options.refreshDelayMs === undefined || options.refreshDelayMs === null
      ? Math.max(0, Number(defaultRefreshDelayMs) || 0)
      : Math.max(0, Number(options.refreshDelayMs) || 0);
  const bootstrapEntries = [];

  log.debug(
    `[charge-bootstrap] begin charID=${Number(charId) || 0} ` +
    `shipID=${Number(resolvedShipID) || 0} mode=${mode} ` +
    `refreshDelayMs=${refreshDelayMs} loadedCharges=${JSON.stringify(
      loadedCharges.map((chargeItem) => summarizeMissileDebugItem(chargeItem)),
    )} fittedModules=${JSON.stringify(
      fittedModuleItems.map((moduleItem) => summarizeMissileDebugItem(moduleItem)),
    )}`,
  );

  logMissileChargeDebug("missile.charge.login-bootstrap.begin", {
    charID: Number(charId) || 0,
    shipID: Number(resolvedShipID) || 0,
    mode,
    refreshDelayMs,
    loadedChargeCount: loadedCharges.length,
    shipItem: summarizeMissileDebugItem(shipItem),
    loadedCharges: loadedCharges.map((chargeItem) => summarizeMissileDebugItem(chargeItem)),
    fittedModules: fittedModuleItems.map((moduleItem) => summarizeMissileDebugItem(moduleItem)),
  });

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
    const moduleItem =
      fittedModuleItems.find((candidate) => (Number(candidate && candidate.flagID) || 0) === nextFlagID)
      || null;
    const dogmaOverrides =
      shipItem && moduleItem
        ? buildWeaponDogmaAttributeOverrides({
            characterID: charId,
            shipItem,
            moduleItem,
            chargeItem,
            fittedItems: fittedModuleItems,
          })
        : null;
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

    logMissileChargeDebug("missile.charge.login-bootstrap.entry", {
      charID: Number(charId) || 0,
      shipID: Number(resolvedShipID) || 0,
      mode,
      refreshDelayMs,
      tupleItemID: buildChargeTupleItemID(
        Number(resolvedShipID) || 0,
        nextFlagID,
        nextTypeID,
      ),
      moduleItem: summarizeMissileDebugItem(moduleItem),
      chargeItem: summarizeMissileDebugItem(chargeItem),
      chargeBootstrapItem: summarizeMissileDebugItem(chargeBootstrapItem),
      dogmaSnapshot: summarizeMissileDogmaSnapshot(
        dogmaOverrides && dogmaOverrides.snapshot ? dogmaOverrides.snapshot : null,
      ),
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
      // Late HUD refreshes should only restate the clean tuple-backed slot row.
      // Re-priming here reopens the client's synthetic sublocation path and can
      // churn active-ship launcher state long after the initial bootstrap.
      syncChargeSublocationForSession(session, chargeBootstrapItem, {
        ...buildChargeSublocationRepairPreviousState({
          previousTypeID: 0,
          previousQuantity: 0,
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

    if (refreshDelayMs > 0) {
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
            ))} mode=refresh-only-item-change-delayed ` +
            `delayMs=${refreshDelayMs}`,
          );
        }
      }, refreshDelayMs);
    }

    return loadedCharges.length;
  }

  if (
    mode === CHARGE_BOOTSTRAP_MODE_PRIME_AND_REPAIR ||
    mode === CHARGE_BOOTSTRAP_MODE_PRIME_REPAIR_THEN_QUANTITY
  ) {
    for (const entry of bootstrapEntries) {
      const {
        nextFlagID,
        nextQuantity,
        nextTypeID,
        chargeBootstrapItem,
      } = entry;

      // The working shared attach path is to prime the tuple charge into godma
      // first, let the client materialize the tuple item, and then repair the
      // HUD-facing tuple row after the short stale synthetic-row window. Login
      // now reuses this same one-shot attach replay once the active ship
      // inventory has been primed.
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
  }

  if (mode === CHARGE_BOOTSTRAP_MODE_REPAIR_THEN_QUANTITY) {
    for (const entry of bootstrapEntries) {
      const {
        nextFlagID,
        nextQuantity,
        nextTypeID,
        chargeBootstrapItem,
      } = entry;

      // Login traces showed quantity landing before the tuple row still leaves
      // environment.godma without a live tuple-backed item, which blocks the
      // ModuleButton active state. Restate the tuple row first, then send the
      // quantity bootstrap on the follow-up tick.
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
        ))} mode=repair-then-quantity-item-change`,
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

      syncModuleAttributeChangesForSession(
        session,
        bootstrapEntries.map(({ nextQuantity, chargeBootstrapItem }) =>
          buildModuleAttributeChangePayload(
            session,
            chargeBootstrapItem.itemID,
            ATTRIBUTE_QUANTITY,
            nextQuantity,
            0,
          )
        ),
      );

      for (const entry of bootstrapEntries) {
        const {
          nextFlagID,
          nextQuantity,
          nextTypeID,
        } = entry;

        log.debug(
          `[charge-bootstrap] shipID=${Number(resolvedShipID) || 0} ` +
          `flagID=${nextFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
          `itemID=${JSON.stringify(buildChargeTupleItemID(
            Number(resolvedShipID) || 0,
            nextFlagID,
            nextTypeID,
          ))} mode=post-item-change-quantity-delayed ` +
          `delayMs=${refreshDelayMs}`,
        );
      }
    }, refreshDelayMs);

    return loadedCharges.length;
  }

  if (mode === CHARGE_BOOTSTRAP_MODE_PRIME_REPAIR_THEN_QUANTITY) {
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

        // Login's late HUD finalize still needs the tuple prime so ModuleButton
        // can point at a real loaded charge item, but login12 showed the first
        // two slots still missing when the follow-up quantity landed before the
        // repaired tuple row. Restate the row first, then resend quantity.
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
          ))} mode=post-prime-item-change-before-quantity-delayed ` +
          `delayMs=${refreshDelayMs}`,
        );
      }

      syncModuleAttributeChangesForSession(
        session,
        bootstrapEntries.map(({ nextQuantity, chargeBootstrapItem }) =>
          buildModuleAttributeChangePayload(
            session,
            chargeBootstrapItem.itemID,
            ATTRIBUTE_QUANTITY,
            nextQuantity,
            0,
          )
        ),
      );

      for (const entry of bootstrapEntries) {
        const {
          nextFlagID,
          nextQuantity,
          nextTypeID,
        } = entry;

        log.debug(
          `[charge-bootstrap] shipID=${Number(resolvedShipID) || 0} ` +
          `flagID=${nextFlagID} typeID=${nextTypeID} quantity=${nextQuantity} ` +
          `itemID=${JSON.stringify(buildChargeTupleItemID(
            Number(resolvedShipID) || 0,
            nextFlagID,
            nextTypeID,
          ))} mode=post-prime-post-item-change-quantity-delayed ` +
          `delayMs=${refreshDelayMs}`,
        );
      }
    }, refreshDelayMs);

    return loadedCharges.length;
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

    syncModuleAttributeChangesForSession(
      session,
      bootstrapEntries.map(({ nextQuantity, chargeBootstrapItem }) =>
        buildModuleAttributeChangePayload(
          session,
          chargeBootstrapItem.itemID,
          ATTRIBUTE_QUANTITY,
          nextQuantity,
          0,
        )
      ),
    );

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
        ))} mode=${
          mode === CHARGE_BOOTSTRAP_MODE_QUANTITY_AND_REPAIR
            ? "post-quantity-item-change-delayed"
            : "post-prime-item-change-delayed"
        } ` +
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
  log.debug(
    `[module-effect-sync] shipID=${shipID} moduleID=${moduleID} ` +
    `flagID=${Number(item.flagID) || 0} typeID=${Number(item.typeID) || 0} ` +
    `active=${active} inSpace=${Boolean(session && session._space)} effect=online`,
  );
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
      !isDockedSession(session),
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

  log.debug(
    `[fitting-sync] begin charID=${Number(charId) || 0} ` +
    `shipID=${Number(resolvedShipID) || 0} onlyOnline=${onlyOnline} ` +
    `onlyCharges=${onlyCharges} includeCharges=${includeCharges} ` +
    `emitChargeInventoryRows=${emitChargeInventoryRows} ` +
    `emitOnlineEffects=${emitOnlineEffects} ` +
    `syntheticFit=${options.syntheticFitTransition === true} ` +
    `items=${JSON.stringify(
      fittedItems.map((item) => summarizeMissileDebugItem(item)),
    )}`,
  );

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
    log.debug(
      `[fitting-sync] emit shipID=${Number(resolvedShipID) || 0} ` +
      `item=${JSON.stringify(summarizeMissileDebugItem(moduleItem))} ` +
      `previousState=${JSON.stringify(previousState)} ` +
      `emitOnlineEffect=${emitOnlineEffects && isModuleOnline(moduleItem)}`,
    );
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

  if (!isDockedSession(session)) {
    log.info(
      `[CharacterState] Dropped deferred docked fitting replay shipid=${pending.shipID} ` +
      `trigger=${options.trigger || "unknown"} reason=session-not-docked`,
    );
    return false;
  }

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
  const oldDockedLocationID =
    Number(options.oldStructureID || options.oldStationID || 0) || 0;
  const enteredStationFromNonStation =
    isDocked &&
    !oldDockedLocationID &&
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
    "factionid",
    options.oldFactionID || null,
    session.factionid || session.factionID || null,
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
    "structureid",
    options.oldStructureID || null,
    session.structureid || null,
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
    "fleetid",
    options.oldFleetID || null,
    session.fleetid || null,
  );
  appendSessionChange(
    sessionChanges,
    "fleetrole",
    options.oldFleetRole || null,
    session.fleetrole || null,
  );
  appendSessionChange(
    sessionChanges,
    "wingid",
    options.oldWingID || null,
    session.wingid || null,
  );
  appendSessionChange(
    sessionChanges,
    "squadid",
    options.oldSquadID || null,
    session.squadid || null,
  );
  appendSessionChange(
    sessionChanges,
    "warfactionid",
    options.oldWarFactionID || null,
    session.warfactionid || session.warFactionID || null,
  );
  appendSessionChange(
    sessionChanges,
    "corpAccountKey",
    options.oldCorpAccountKey ?? null,
    session.corpAccountKey ?? session.corpaccountkey ?? null,
    {
      force:
        options.forceCorpAccountKeyChange === true ||
        Object.prototype.hasOwnProperty.call(sessionChanges, "corpid"),
    },
  );

  if (isCharacterSelection || options.includeRoleChanges === true) {
    appendSessionChange(
      sessionChanges,
      "hqID",
      options.oldHqID ?? null,
      session.hqID ?? null,
    );
    appendSessionChange(
      sessionChanges,
      "baseID",
      options.oldBaseID ?? null,
      session.baseID ?? null,
    );
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
    if (isDockedSession(session)) {
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
  const oldStructureID = session.structureID || session.structureid || null;
  const oldSolarSystemID = session.solarsystemid || null;
  const oldSolarSystemID2 = session.solarsystemid2 || null;
  const oldConstellationID = session.constellationID;
  const oldRegionID = session.regionID;
  const oldGenderID = session.genderID ?? session.genderid ?? null;
  const oldBloodlineID = session.bloodlineID ?? session.bloodlineid ?? null;
  const oldRaceID = session.raceID ?? session.raceid ?? null;
  const oldSchoolID = session.schoolID ?? session.schoolid ?? null;
  const oldFactionID = session.factionID ?? session.factionid ?? null;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldLocationID = session.locationid ?? null;
  const oldWorldspaceID = session.worldspaceid ?? null;
  const oldFleetID = session.fleetid ?? null;
  const oldFleetRole = session.fleetrole ?? null;
  const oldWingID = session.wingid ?? null;
  const oldSquadID = session.squadid ?? null;
  const oldHqID = session.hqID;
  const oldBaseID = session.baseID;
  const oldWarFactionID = session.warFactionID;
  const oldCorpAccountKey =
    session.corpAccountKey ?? session.corpaccountkey ?? null;
  const oldRole = session.role ?? null;
  const oldCorpRole = session.corprole ?? null;
  const oldRolesAtAll = session.rolesAtAll ?? null;
  const oldRolesAtBase = session.rolesAtBase ?? null;
  const oldRolesAtHQ = session.rolesAtHQ ?? null;
  const oldRolesAtOther = session.rolesAtOther ?? null;
  const storedStationID = hasLocationID(charData.stationID)
    ? Number(charData.stationID)
    : null;
  const storedStructureID = hasLocationID(charData.structureID)
    ? Number(charData.structureID)
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
  const isDocked = Boolean(storedStationID || storedStructureID);
  const stationID = isDocked ? storedStationID : null;
  const structureID = isDocked ? storedStructureID : null;
  const solarSystemID = storedSolarSystemID || 30000142;
  const systemIdentity = resolveSystemIdentity(solarSystemID, charData);
  const shipID = activeShip.itemID || charData.shipID || Number(charId) + 100;
  const shipTypeID = activeShip.typeID || charData.shipTypeID || 601;
  const shipMetadata = resolveShipByTypeID(shipTypeID);
  const {
    getCorporationSessionRoleState,
  } = require(path.join(
    __dirname,
    "../corporation/corporationRuntimeState",
  ));
  const corporationRoleState = getCorporationSessionRoleState(
    charData.corporationID || 1000009,
    charId,
  );

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
  session.factionID = charData.factionID || null;
  session.factionid = session.factionID || null;
  session.stationid = isDocked ? stationID : null;
  session.stationID = isDocked ? stationID : null;
  session.stationid2 = isDocked ? stationID : null;
  session.structureid = isDocked ? structureID : null;
  session.structureID = isDocked ? structureID : null;
  session.structureTypeID = structureID
    ? (getStructureState().getStructureByID(structureID, { refresh: false }) || {}).typeID || null
    : null;
  session.worldspaceid = storedWorldSpaceID || null;
  session.locationid = isDocked ? (structureID || stationID) : solarSystemID;
  session.homeStationID = homeStationID;
  session.homestationid = homeStationID;
  session.cloneStationID = cloneStationID;
  session.clonestationid = cloneStationID;
  session.solarsystemid2 = solarSystemID;
  // Structure hangars still resolve inventory through the solar-system
  // inventory manager in the stock client. Leaving solarsystemid null while
  // docked in an Upwell makes invCache/eveMoniker reject the hangar bootstrap.
  session.solarsystemid = structureID
    ? solarSystemID
    : (isDocked ? null : solarSystemID);
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
  session.hqID = charData.hqID || corporationRoleState.baseID || null;
  session.baseID = charData.baseID || corporationRoleState.baseID || null;
  session.warFactionID = charData.warFactionID || null;
  session.warfactionid = session.warFactionID || null;
  const fleetSessionState = getSessionFleetState(session);
  session.fleetid = fleetSessionState.fleetid;
  session.fleetrole = fleetSessionState.fleetrole;
  session.wingid = fleetSessionState.wingid;
  session.squadid = fleetSessionState.squadid;
  session.corprole = corporationRoleState.corprole;
  session.rolesAtAll = corporationRoleState.rolesAtAll;
  session.rolesAtBase = corporationRoleState.rolesAtBase;
  session.rolesAtHQ = corporationRoleState.rolesAtHQ;
  session.rolesAtOther = corporationRoleState.rolesAtOther;
  session.corpAccountKey = corporationRoleState.accountKey || 1000;
  session.corpaccountkey = session.corpAccountKey;
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
    oldStructureID,
    oldSolarSystemID,
    oldSolarSystemID2,
    oldConstellationID,
    oldRegionID,
    oldGenderID,
    oldBloodlineID,
    oldRaceID,
    oldSchoolID,
    oldFactionID,
    oldShipID,
    oldLocationID,
    oldWorldspaceID,
    oldFleetID,
    oldFleetRole,
    oldWingID,
    oldSquadID,
    oldHqID,
    oldBaseID,
    oldWarFactionID,
    oldCorpAccountKey,
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
      `[CharState] Applied ${session.characterName}(${charId}) ship=${session.shipName}(${session.shipTypeID}) activeShipID=${session.activeShipID} docked=${isDocked} station=${session.stationid} structure=${session.structureid} system=${solarSystemID}`,
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

  const docked = isDockedSession(session);
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
  const oldStructureID = session.structureID || session.structureid || null;
  const oldSolarSystemID = session.solarsystemid || null;
  const oldSolarSystemID2 = session.solarsystemid2 || null;
  const oldConstellationID = session.constellationID || null;
  const oldRegionID = session.regionID || null;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldLocationID = session.locationid ?? null;
  const oldWorldspaceID = session.worldspaceid ?? null;
  const oldFleetID = session.fleetid ?? null;
  const oldFleetRole = session.fleetrole ?? null;
  const oldWingID = session.wingid ?? null;
  const oldSquadID = session.squadid ?? null;
  const oldSchoolID = session.schoolID ?? session.schoolid ?? null;
  const oldGenderID = session.genderID ?? session.genderid ?? null;
  const oldBloodlineID = session.bloodlineID ?? session.bloodlineid ?? null;
  const oldRaceID = session.raceID ?? session.raceid ?? null;
  const oldFactionID = session.factionID ?? session.factionid ?? null;
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
  session.factionID = null;
  session.factionid = null;
  session.stationid = null;
  session.stationID = null;
  session.stationid2 = null;
  session.structureid = null;
  session.structureID = null;
  session.structureTypeID = null;
  session.worldspaceid = null;
  session.locationid = null;
  session.fleetid = null;
  session.fleetrole = null;
  session.wingid = null;
  session.squadid = null;
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
  session.corpAccountKey = null;
  session.corpaccountkey = null;

  if (options.emitNotifications !== false) {
    const sessionChanges = {};
    appendSessionChange(sessionChanges, "charid", oldCharID, null);
    appendSessionChange(sessionChanges, "corpid", oldCorpID, null);
    appendSessionChange(sessionChanges, "allianceid", oldAllianceID, null);
    appendSessionChange(sessionChanges, "factionid", oldFactionID, null);
    appendSessionChange(sessionChanges, "genderID", oldGenderID, null);
    appendSessionChange(sessionChanges, "bloodlineID", oldBloodlineID, null);
    appendSessionChange(sessionChanges, "raceID", oldRaceID, null);
    appendSessionChange(sessionChanges, "schoolID", oldSchoolID, null);
    appendSessionChange(sessionChanges, "stationid", oldStationID, null);
    appendSessionChange(sessionChanges, "stationid2", oldStationID2, null);
    appendSessionChange(sessionChanges, "structureid", oldStructureID, null);
    appendSessionChange(sessionChanges, "worldspaceid", oldWorldspaceID, null);
    appendSessionChange(sessionChanges, "locationid", oldLocationID, null);
    appendSessionChange(sessionChanges, "fleetid", oldFleetID, null);
    appendSessionChange(sessionChanges, "fleetrole", oldFleetRole, null);
    appendSessionChange(sessionChanges, "wingid", oldWingID, null);
    appendSessionChange(sessionChanges, "squadid", oldSquadID, null);
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

  const docked = isDockedSession(session);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const dockedLocationKind = getDockedLocationKind(session);
  const stationId =
    dockedLocationKind === "structure"
      ? (session.structureid || session.structureID || 60003760)
      : (session.stationid || session.stationID || 60003760);
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
  clearDeferredDockedShipSessionChange,
  clearDeferredDockedFittingReplay,
  flushDeferredDockedFittingReplay,
  flushCharacterSessionNotificationPlan,
  toBigInt,
  deriveEmpireID,
  deriveFactionID,
  buildLocationChangePayload,
  buildChargeDogmaPrimeEntry,
  buildInventoryDogmaPrimeEntry,
};

module.exports._testing = {
  buildChargeDogmaPrimeEntry,
  buildInventoryDogmaPrimeEntry,
  buildCharacterSessionNotificationPlan,
};

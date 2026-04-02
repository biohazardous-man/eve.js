/**
 * Dogma IM Service (dogmaIM)
 *
 * Handles dogma (attributes/effects) related calls.
 */
const path = require("path");
const database = require(path.join(__dirname, "../../newDatabase"));
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  findCharacterShip,
  activateShipForSession,
  spawnShipInHangarForSession,
  syncInventoryItemForSession,
  syncChargeSublocationTransitionForSession,
  syncShipFittingStateForSession,
  syncModuleOnlineEffectForSession,
  flushDeferredDockedFittingReplay,
  buildChargeDogmaPrimeEntry,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getShipConditionState,
  normalizeShipConditionState,
  ITEM_FLAGS,
  SHIP_CATEGORY_ID,
  findCharacterShipByType,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
  updateInventoryItem,
  updateShipItem,
  mergeItemStacks,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getCharacterSkills,
  getCharacterSkillPointTotal,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  getAttributeIDByNames,
  getFittedModuleItems,
  getFittedModuleByFlag,
  getItemModuleState,
  getLoadedChargeByFlag,
  getLoadedChargeItems,
  getModuleChargeCapacity,
  getEffectIDByNames,
  isModuleOnline,
  isChargeCompatibleWithModule,
  listFittedItems,
  buildChargeTupleItemID,
  buildChargeSublocationData,
  buildModuleStatusSnapshot,
  buildCharacterTargetingState,
  buildEffectiveItemAttributeMap,
  calculateShipDerivedAttributes,
  buildShipResourceState,
  getTypeAttributeValue,
  isShipFittingFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  collectCharacterModifierAttributes,
  buildWeaponDogmaAttributeOverrides,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  extractDictEntries,
  extractList,
  normalizeNumber,
  currentFileTime,
  buildList,
  buildKeyVal,
  buildMarshalReal,
  buildDict,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const REMOVED_ITEM_JUNK_LOCATION_ID = 6;
const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const ATTRIBUTE_PILOT_SECURITY_STATUS = 2610;
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_MAX_TARGET_RANGE =
  getAttributeIDByNames("maxTargetRange") || 76;
// CCP parity: attribute 18 ("charge") is the current capacitor energy level in
// GJ.  The client reads shipItem.charge to display the capacitor gauge.
const ATTRIBUTE_CHARGE = 18;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_MAX_LOCKED_TARGETS =
  getAttributeIDByNames("maxLockedTargets") || 192;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;
const ATTRIBUTE_VOLUME = 161;
const ATTRIBUTE_RADIUS = 162;
const ATTRIBUTE_CLOAKING_TARGETING_DELAY =
  getAttributeIDByNames("cloakingTargetingDelay") || 560;
const ATTRIBUTE_SCAN_RESOLUTION =
  getAttributeIDByNames("scanResolution") || 564;
const ATTRIBUTE_SIGNATURE_RADIUS =
  getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_RELOAD_TIME = getAttributeIDByNames("reloadTime") || 1795;
const ATTRIBUTE_NEXT_ACTIVATION_TIME =
  getAttributeIDByNames("nextActivationTime") || 1796;
const ATTRIBUTE_DRONE_IS_AGGRESSIVE =
  getAttributeIDByNames("droneIsAggressive") || 1275;
const ATTRIBUTE_DRONE_FOCUS_FIRE =
  getAttributeIDByNames("droneFocusFire") || 1297;
const DRONE_CATEGORY_ID = 18;
const ATTRIBUTE_SHIELD_CAPACITY = 263;
const ATTRIBUTE_SHIELD_CHARGE_HELPER = 264;
const ATTRIBUTE_ARMOR_HP = 265;
const ATTRIBUTE_ARMOR_DAMAGE = 266;
const MODULE_ATTRIBUTE_CAPACITOR_NEED =
  getAttributeIDByNames("capacitorNeed") || 6;
const MODULE_ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;
const MODULE_ATTRIBUTE_SPEED = getAttributeIDByNames("speed") || 51;
function clampRatio(value, fallback = 1) {
  const numericValue = normalizeNumber(value, fallback);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  if (numericValue <= 0) {
    return 0;
  }
  if (numericValue >= 1) {
    return 1;
  }
  return numericValue;
}
const MODULE_ATTRIBUTE_DURATION = getAttributeIDByNames("duration") || 73;
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const FLAG_PILOT = 57;
const DBTYPE_I4 = 0x03;
const DBTYPE_R8 = 0x05;
const DBTYPE_BOOL = 0x0b;
const DBTYPE_I8 = 0x14;
const CORVETTE_GROUP_ID = 237;
const CORVETTE_TYPE_ID_BY_RACE_ID = Object.freeze({
  1: 601, // Ibis
  2: 588, // Reaper
  4: 596, // Impairor
  8: 606, // Velator
});
const ONLINE_CAPACITOR_CHARGE_RATIO = 95;
const ONLINE_CAPACITOR_REMAINDER_RATIO = 5;
const EFFECT_ONLINE = getEffectIDByNames("online") || 16;
const EFFECT_AFTERBURNER =
  getEffectIDByNames("moduleBonusAfterburner") || 6731;
const EFFECT_MICROWARPDRIVE =
  getEffectIDByNames("moduleBonusMicrowarpdrive") || 6730;
const INSTANCE_ROW_DESCRIPTOR_COLUMNS = [
  ["instanceID", DBTYPE_I8],
  ["online", DBTYPE_BOOL],
  ["damage", DBTYPE_R8],
  ["charge", DBTYPE_R8],
  ["skillPoints", DBTYPE_I4],
  ["armorDamage", DBTYPE_R8],
  ["shieldCharge", DBTYPE_R8],
  ["incapacitated", DBTYPE_BOOL],
];
const pendingModuleReloads = new Map();
let pendingModuleReloadTimer = null;
const RELOAD_PUMP_POLL_MS = 50;
const VALID_DRONE_SETTING_ATTRIBUTE_IDS = new Set([
  ATTRIBUTE_DRONE_IS_AGGRESSIVE,
  ATTRIBUTE_DRONE_FOCUS_FIRE,
]);
function isNewbieShipItem(item) {
  if (!item) {
    return false;
  }
  const metadata =
    resolveShipByTypeID(Number(item.typeID || 0)) || item || {};
  return Number(metadata.groupID || item.groupID || 0) === CORVETTE_GROUP_ID;
}
function resolveNewbieShipTypeID(session, characterRecord = null) {
  const charData = characterRecord || getCharacterRecord(session && session.characterID) || {};
  const raceID = Number(
    charData.raceID || (session && (session.raceID || session.raceid)) || 0,
  );
  return CORVETTE_TYPE_ID_BY_RACE_ID[raceID] || 606;
}
function repairShipAndFittedItemsForSession(session, shipItem) {
  if (!session || !shipItem || !shipItem.itemID) {
    return;
  }
  const shipUpdateResult = updateShipItem(shipItem.itemID, (currentShip) => ({
    ...currentShip,
    conditionState: {
      ...(currentShip.conditionState || {}),
      damage: 0.0,
      charge: 1.0,
      armorDamage: 0.0,
      shieldCharge: 1.0,
      incapacitated: false,
    },
  }));
  if (shipUpdateResult.success) {
    syncInventoryItemForSession(
      session,
      shipUpdateResult.data,
      shipUpdateResult.previousData || {},
      { emitCfgLocation: true },
    );
  }
  const fittedItems = listFittedItems(
    Number(session.characterID || 0) || 0,
    shipItem.itemID,
  );
  for (const fittedItem of fittedItems) {
    const moduleUpdateResult = updateInventoryItem(
      fittedItem.itemID,
      (currentItem) => ({
        ...currentItem,
        moduleState: {
          ...(currentItem.moduleState || {}),
          damage: 0.0,
          armorDamage: 0.0,
          incapacitated: false,
        },
      }),
    );
    if (!moduleUpdateResult.success) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      moduleUpdateResult.data,
      moduleUpdateResult.previousData || {},
      { emitCfgLocation: false },
    );
  }
}
function boardNewbieShipForSession(session, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }
  const stationID = getDockedLocationID(session) || 0;
  if (!stationID) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }
  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  if (isNewbieShipItem(activeShip)) {
    if (options.allowAlreadyInNewbieShip === true) {
      return {
        success: true,
        data: {
          ship: activeShip,
          corvetteTypeID: Number(activeShip.typeID || 0) || 0,
          reusedExistingShip: true,
          alreadyInNewbieShip: true,
        },
      };
    }
    return {
      success: false,
      errorMsg: "ALREADY_IN_NEWBIE_SHIP",
      data: {
        ship: activeShip,
      },
    };
  }
  const characterID = Number(session.characterID || 0) || 0;
  const corvetteTypeID = resolveNewbieShipTypeID(session);
  let corvetteShip = findCharacterShipByType(characterID, corvetteTypeID, stationID);
  const reusedExistingShip = Boolean(corvetteShip);
  const logLabel = String(options.logLabel || "BoardNewbieShip");
  if (!corvetteShip) {
    const spawnResult = spawnShipInHangarForSession(session, corvetteTypeID);
    if (!spawnResult.success || !spawnResult.ship) {
      log.warn(
        `[DogmaIM] ${logLabel} failed to create corvette for char=${characterID} typeID=${corvetteTypeID} error=${spawnResult.errorMsg}`,
      );
      return {
        success: false,
        errorMsg: "CORVETTE_CREATE_FAILED",
        data: {
          corvetteTypeID,
          innerErrorMsg: spawnResult.errorMsg || null,
        },
      };
    }
    corvetteShip = spawnResult.ship;
  }
  const activateResult = activateShipForSession(session, corvetteShip.itemID, {
    emitNotifications: options.emitNotifications !== false,
    logSelection: options.logSelection !== false,
  });
  if (!activateResult.success) {
    log.warn(
      `[DogmaIM] ${logLabel} failed to activate corvette ship=${corvetteShip.itemID} char=${characterID} error=${activateResult.errorMsg}`,
    );
    return {
      success: false,
      errorMsg: "SHIP_ACTIVATION_FAILED",
      data: {
        corvetteTypeID,
        ship: corvetteShip,
        innerErrorMsg: activateResult.errorMsg || null,
      },
    };
  }
  const boardedShip = activateResult.activeShip || corvetteShip;
  if (reusedExistingShip && options.repairExistingShip !== false) {
    repairShipAndFittedItemsForSession(session, boardedShip);
  }
  log.info(
    `[DogmaIM] ${logLabel} boarded char=${characterID} ship=${corvetteShip.itemID} typeID=${corvetteTypeID} reusedExisting=${reusedExistingShip}`,
  );
  return {
    success: true,
    data: {
      ship: boardedShip,
      corvetteTypeID,
      reusedExistingShip,
      alreadyInNewbieShip: false,
    },
  };
}
function marshalModuleDurationWireValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (value && typeof value === "object" && value.type === "real") {
    return value;
  }
  const numericValue = normalizeNumber(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return value;
  }
  if (numericValue < 0) {
    return Math.trunc(numericValue);
  }
  return buildMarshalReal(numericValue, 0);
}
function isModuleTimingAttribute(attributeID) {
  const numericAttributeID = Number(attributeID) || 0;
  return (
    numericAttributeID === MODULE_ATTRIBUTE_DURATION ||
    numericAttributeID === MODULE_ATTRIBUTE_SPEED
  );
}
function marshalDogmaAttributeValue(attributeID, value) {
  return isModuleTimingAttribute(attributeID)
    ? marshalModuleDurationWireValue(value)
    : value;
}
function normalizeModuleAttributeChange(change) {
  if (!Array.isArray(change) || change.length === 0) {
    return change;
  }
  const normalized = change.slice();
  const attributeID = normalized[3];
  if (normalized.length > 5) {
    normalized[5] = marshalDogmaAttributeValue(attributeID, normalized[5]);
  }
  if (normalized.length > 6) {
    normalized[6] = marshalDogmaAttributeValue(attributeID, normalized[6]);
  }
  return normalized;
}
function summarizeDogmaLogValue(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => summarizeDogmaLogValue(entry));
  }
  if (value && typeof value === "object") {
    if (
      Array.isArray(value.entries) ||
      Array.isArray(value.items)
    ) {
      return JSON.parse(JSON.stringify(value, (key, entryValue) => (
        typeof entryValue === "bigint"
          ? entryValue.toString()
          : entryValue
      )));
    }
    return `[${value.constructor && value.constructor.name ? value.constructor.name : "object"}]`;
  }
  return value;
}
function summarizeModuleAttributeChangeLog(change) {
  const normalized = normalizeModuleAttributeChange(change);
  if (!Array.isArray(normalized)) {
    return summarizeDogmaLogValue(normalized);
  }
  return {
    target: summarizeDogmaLogValue(normalized[2]),
    attributeID: Number(normalized[3]) || 0,
    timestamp: summarizeDogmaLogValue(normalized[4]),
    newValue: summarizeDogmaLogValue(normalized[5]),
    oldValue: summarizeDogmaLogValue(normalized[6]),
  };
}
function summarizeModuleItemForLog(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    itemID: Number(item.itemID) || 0,
    typeID: Number(item.typeID) || 0,
    locationID: Number(item.locationID) || 0,
    flagID: Number(item.flagID) || 0,
    groupID: Number(item.groupID) || 0,
    categoryID: Number(item.categoryID) || 0,
    online: isModuleOnline(item),
    quantity: Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0),
  };
}
function summarizeRuntimeEffectForLog(effect) {
  if (!effect || typeof effect !== "object") {
    return null;
  }
  return {
    effectID: Number(effect.effectID) || 0,
    effectName: String(effect.effectName || ""),
    targetID: Number(effect.targetID) || 0,
    repeat: Number(effect.repeat) || 0,
    durationMs: Number(effect.durationMs) || 0,
    startedAtMs: Number(effect.startedAtMs) || 0,
    pendingDeactivation: effect.pendingDeactivation === true,
    isGeneric: effect.isGeneric === true,
  };
}
function extractKeyValEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return extractDictEntries(value);
}
function buildAmmoLoadRequest(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const itemID = Math.trunc(Number(value) || 0);
    return itemID > 0 ? { itemID, typeID: 0, quantity: null } : null;
  }
  if (typeof value === "string") {
    const itemID = Math.trunc(Number(value) || 0);
    return itemID > 0 ? { itemID, typeID: 0, quantity: null } : null;
  }
  if (Array.isArray(value)) {
    const numericValues = value.map((entry) => Math.trunc(normalizeNumber(entry, 0)));
    if (numericValues.length === 0) {
      return null;
    }
    if (numericValues.length === 1) {
      return numericValues[0] > 0
        ? { itemID: numericValues[0], typeID: 0, quantity: null }
        : null;
    }
    if (numericValues.length === 2) {
      return numericValues[0] > 0
        ? {
            itemID: 0,
            typeID: numericValues[0],
            quantity: numericValues[1] > 0 ? numericValues[1] : null,
          }
        : null;
    }
    // Charge sublocation tuples commonly end with the charge typeID.
    return numericValues[numericValues.length - 1] > 0
      ? {
          itemID: 0,
          typeID: numericValues[numericValues.length - 1],
          quantity: numericValues.length > 1 && numericValues[1] > 0
            ? numericValues[1]
            : null,
        }
      : null;
  }
  if (value && typeof value === "object" && value.type === "packedrow" && value.fields) {
    return buildAmmoLoadRequest(value.fields);
  }
  if (value && typeof value === "object" && value.type === "list") {
    return buildAmmoLoadRequest(extractList(value));
  }
  if (value && typeof value === "object") {
    const mapped = {};
    for (const [key, entryValue] of extractKeyValEntries(value)) {
      mapped[String(key)] = entryValue;
    }
    const source = Object.keys(mapped).length > 0 ? mapped : value;
    let itemID = 0;
    let typeID = 0;
    let quantity = null;
    if (Array.isArray(source.itemID)) {
      const tupleRequest = buildAmmoLoadRequest(source.itemID);
      itemID = tupleRequest ? tupleRequest.itemID || 0 : 0;
      typeID = tupleRequest ? tupleRequest.typeID || 0 : 0;
      quantity = tupleRequest ? tupleRequest.quantity : null;
    } else {
      itemID = Math.trunc(normalizeNumber(
        source.itemID ??
          source.chargeItemID ??
          source.chargeID,
        0,
      ));
      typeID = Math.trunc(normalizeNumber(
        source.typeID ??
          source.chargeTypeID ??
          source.ammoTypeID,
        0,
      ));
      quantity = Math.trunc(normalizeNumber(
        source.quantity ??
          source.qty ??
          source.chargeQty ??
          source.stacksize,
        0,
      )) || null;
    }
    if (itemID <= 0 && typeID <= 0) {
      return null;
    }
    return {
      itemID: itemID > 0 ? itemID : 0,
      typeID: typeID > 0 ? typeID : 0,
      quantity,
    };
  }
  return null;
}
function normalizeAmmoLoadRequests(rawValue) {
  const listValues = extractList(rawValue);
  const sourceValues = listValues.length > 0 ? listValues : [rawValue];
  const requests = [];
  const seen = new Set();
  for (const sourceValue of sourceValues) {
    const request = buildAmmoLoadRequest(sourceValue);
    if (!request) {
      continue;
    }
    const dedupeKey = `${request.itemID || 0}:${request.typeID || 0}:${request.quantity || 0}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    requests.push(request);
  }
  return requests;
}
function extractSequenceValues(value) {
  if (Array.isArray(value)) {
    return value;
  }
  const listValues = extractList(value);
  if (listValues.length > 0) {
    return listValues;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "tuple" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "substream"
  ) {
    return extractSequenceValues(value.value);
  }
  return [];
}
function summarizeAmmoLoadRequests(requests = []) {
  return requests.map((request) => (
    request.itemID > 0
      ? `item:${request.itemID}`
      : `type:${request.typeID}${request.quantity ? `x${request.quantity}` : ""}`
  ));
}
function toFileTimeFromMs(value, fallback = currentFileTime()) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return BigInt(Math.trunc(numericValue)) * 10000n + 116444736000000000n;
}
function getSessionSimulationTimeMs(session, fallback = Date.now()) {
  if (session && session._space) {
    return spaceRuntime.getSimulationTimeMsForSession(session, fallback);
  }
  return fallback;
}
function getSessionSimulationFileTime(session, fallback = currentFileTime()) {
  if (session && session._space) {
    return spaceRuntime.getSimulationFileTimeForSession(session, fallback);
  }
  return fallback;
}
function getReloadStateCurrentTimeMs(reloadState, fallback = Date.now()) {
  const session = reloadState && reloadState.session;
  if (session && session._space) {
    return getSessionSimulationTimeMs(session, fallback);
  }
  const systemID = Number(reloadState && reloadState.systemID) || 0;
  if (systemID > 0) {
    return spaceRuntime.getSimulationTimeMsForSystem(systemID, fallback);
  }
  return fallback;
}
function normalizeReloadSourceItemIDs(rawItemIDs = []) {
  return [...new Set(
    (Array.isArray(rawItemIDs) ? rawItemIDs : [rawItemIDs])
      .map((itemID) => Number(itemID) || 0)
      .filter((itemID) => itemID > 0),
  )];
}
function schedulePendingModuleReloadPump() {
  if (pendingModuleReloadTimer) {
    clearTimeout(pendingModuleReloadTimer);
    pendingModuleReloadTimer = null;
  }
  if (pendingModuleReloads.size === 0) {
    return;
  }
  pendingModuleReloadTimer = setTimeout(() => {
    pendingModuleReloadTimer = null;
    if (
      DogmaService._testing &&
      typeof DogmaService._testing.flushPendingModuleReloads === "function"
    ) {
      DogmaService._testing.flushPendingModuleReloads();
    }
  }, RELOAD_PUMP_POLL_MS);
  if (typeof pendingModuleReloadTimer.unref === "function") {
    pendingModuleReloadTimer.unref();
  }
}
class DogmaService extends BaseService {
  constructor() {
    super("dogmaIM");
  }
  _coalesce(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }
  _getCharID(session) {
    return (session && (session.characterID || session.charid || session.userid)) || 140000001;
  }
  _isControllingStructureSession(session) {
    const structureID = Number(
      session && (session.structureID || session.structureid),
    ) || 0;
    const shipID = Number(session && (session.shipID || session.shipid)) || 0;
    return structureID > 0 && shipID === structureID;
  }
  _getShipID(session) {
    if (this._isControllingStructureSession(session)) {
      return (
        session &&
        (session.shipID || session.shipid)
      ) || 140000101;
    }
    return (
      session &&
      (session.activeShipID || session.shipID || session.shipid)
    ) || 140000101;
  }
  _getShipTypeID(session) {
    return session && Number.isInteger(session.shipTypeID) && session.shipTypeID > 0
      ? session.shipTypeID
      : 606;
  }
  _buildStructureControlShipMetadata(structure = null) {
    if (!structure) {
      return null;
    }
    const typeID = Number(structure.typeID) || 0;
    const itemType = resolveItemByTypeID(typeID) || {};
    return {
      itemID: Number(structure.structureID) || 0,
      typeID,
      ownerID: Number(structure.ownerCorpID || structure.ownerID) || 0,
      // The controlled structure is a location dogma item; the client expects
      // it to behave like the docked structure itself rather than a solar-
      // system station row.
      locationID: Number(structure.structureID || structure.locationID) || 0,
      flagID: 0,
      quantity: 1,
      singleton: 1,
      stacksize: 1,
      groupID: Number(itemType.groupID) || 0,
      categoryID: Number(itemType.categoryID) || 0,
      customInfo: String(structure.itemName || structure.name || ""),
      radius: Number(structure.radius) || 0,
      shieldCapacity: Number(structure.shieldCapacity) || 0,
      armorHP: Number(structure.armorHP) || 0,
      hullHP: Number(structure.hullHP || structure.structureHP) || 0,
      conditionState:
        structure && structure.conditionState && typeof structure.conditionState === "object"
          ? { ...structure.conditionState }
          : null,
    };
  }
  _getControlledStructureShipMetadata(session) {
    if (!this._isControllingStructureSession(session)) {
      return null;
    }
    return this._buildStructureControlShipMetadata(
      this._getDockedStructureRecord(session),
    );
  }
  _getShipMetadata(session) {
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (controlledStructureShip) {
      return controlledStructureShip;
    }
    const shipTypeID = this._getShipTypeID(session);
    return (
      resolveShipByTypeID(shipTypeID) || {
        typeID: shipTypeID,
        name: (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }
  _getCharacterRecord(session) {
    return getCharacterRecord(this._getCharID(session));
  }
  _getPersistedDroneSettingAttributes(session) {
    const characterRecord = this._getCharacterRecord(session) || {};
    const storedSettings =
      characterRecord.droneSettings &&
      typeof characterRecord.droneSettings === "object"
        ? characterRecord.droneSettings
        : {};
    const normalizedSettings = {};
    for (const attributeID of VALID_DRONE_SETTING_ATTRIBUTE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(storedSettings, attributeID)) {
        continue;
      }
      normalizedSettings[attributeID] = Boolean(storedSettings[attributeID]);
    }
    return normalizedSettings;
  }
  _normalizeDroneSettingChanges(rawChanges) {
    const normalizedChanges = {};
    for (const [rawAttributeID, rawValue] of extractDictEntries(rawChanges)) {
      const attributeID = Number(normalizeNumber(rawAttributeID, 0)) || 0;
      if (!VALID_DRONE_SETTING_ATTRIBUTE_IDS.has(attributeID)) {
        continue;
      }
      normalizedChanges[attributeID] = Boolean(normalizeNumber(rawValue, 0));
    }
    return normalizedChanges;
  }
  _persistDroneSettingChanges(session, droneSettingChanges = {}) {
    const characterID = this._getCharID(session);
    if (characterID <= 0) {
      return this._getPersistedDroneSettingAttributes(session);
    }
    const characterRecord = this._getCharacterRecord(session);
    if (!characterRecord) {
      return {};
    }
    const nextDroneSettings = {
      ...this._getPersistedDroneSettingAttributes(session),
      ...droneSettingChanges,
    };
    const nextCharacterRecord = {
      ...characterRecord,
      droneSettings: nextDroneSettings,
    };
    const writeResult = database.write(
      "characters",
      `/${characterID}`,
      nextCharacterRecord,
      { silent: true },
    );
    if (!writeResult.success) {
      log.warn(
        `[DogmaService] Failed to persist drone settings for char=${characterID}: ${writeResult.errorMsg || "WRITE_ERROR"}`,
      );
      return this._getPersistedDroneSettingAttributes(session);
    }
    return nextDroneSettings;
  }
  _buildDroneSettingAttributesPayload(session) {
    return buildDict(
      Object.entries(this._getPersistedDroneSettingAttributes(session)).map(
        ([attributeID, value]) => [
          Number(attributeID) || 0,
          Boolean(value),
        ],
      ),
    );
  }
  _getActiveShipRecord(session) {
    return getActiveShipRecord(this._getCharID(session));
  }
  _getCurrentDogmaShipContext(session) {
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (controlledStructureShip) {
      return {
        shipID: controlledStructureShip.itemID,
        shipMetadata: controlledStructureShip,
        shipRecord: controlledStructureShip,
        controllingStructure: true,
      };
    }
    const activeShip = this._getActiveShipRecord(session);
    const shipMetadata = activeShip || this._getShipMetadata(session);
    return {
      shipID: activeShip ? activeShip.itemID : this._getShipID(session),
      shipMetadata,
      shipRecord: activeShip,
      controllingStructure: false,
    };
  }
  _getLocationID(session) {
    return (
      (getDockedLocationID(session) || (session && (session.locationid || session.solarsystemid2 || session.solarsystemid))) ||
      60003760
    );
  }
  _nowFileTime() {
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }
  // Scene-aware filetime: returns the solar system's sim filetime when the
  // session is in space, wallclock filetime otherwise.  Use this for any
  // timestamp that is sent to the client so it stays coherent with TiDi.
  _sessionFileTime(session) {
    return getSessionSimulationFileTime(session, this._nowFileTime());
  }
  _toFileTime(value, fallback = null) {
    const fallbackValue =
      typeof fallback === "bigint" ? fallback : this._nowFileTime();
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallbackValue;
    }
    return BigInt(Math.trunc(numericValue)) * 10000n + 116444736000000000n;
  }
  _toBoolArg(value, fallback = true) {
    if (value === undefined) {
      return fallback;
    }
    if (value === null) {
      return fallback;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "object") {
      if (value.type === "bool") {
        return Boolean(value.value);
      }
      if (value.type === "none") {
        return fallback;
      }
    }
    return fallback;
  }
  _buildInvRow({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            [
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
            ],
          ],
          [
            "line",
            [
              itemID,
              typeID,
              ownerID,
              locationID,
              flagID,
              quantity,
              groupID,
              categoryID,
              customInfo,
              stacksize,
              singleton,
            ],
          ],
        ],
      },
    };
  }
  _buildCommonGetInfoEntry({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
    description,
    attributes = null,
    activeEffects = null,
    session = null,
  }) {
    const invItem = this._buildInvRow({
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      groupID,
      categoryID,
      quantity,
      singleton,
      stacksize,
      customInfo,
    });
    // Keep dogma bootstrap timestamps on the same solar-system sim clock that
    // Michelle is about to use for the initial ballpark. Raw wallclock here
    // causes client-only reconnects into a lagged scene to seed module timers
    // off a different clock than space bootstrap.
    const now = session ? this._sessionFileTime(session) : this._nowFileTime();
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["invItem", invItem],
          ["activeEffects", activeEffects || { type: "dict", entries: [] }],
          ["attributes", attributes || { type: "dict", entries: [] }],
          ["description", description || ""],
          ["time", now],
          ["wallclockTime", now],
        ],
      },
    };
  }
  _buildStatusRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "online", "damage", "charge", "skillPoints", "armorDamage", "shieldCharge", "incapacitated"]],
          ["line", [itemID, online, damage, charge, skillPoints, armorDamage, shieldCharge, incapacitated]],
        ],
      },
    };
  }
  _buildInstanceRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INSTANCE_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }
  _buildPackedInstanceRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "packedrow",
      header: this._buildInstanceRowDescriptor(),
      columns: INSTANCE_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        instanceID: itemID,
        online,
        damage,
        charge,
        skillPoints,
        armorDamage,
        shieldCharge,
        incapacitated,
      },
    };
  }
  _buildCharacterAttributes(charData = {}) {
    const source = charData.characterAttributes || {};
    const securityStatus = Number(
      charData.securityStatus ?? charData.securityRating ?? source.securityStatus ?? 0,
    );
    const characterTargetingState = buildCharacterTargetingState(
      Number(charData.characterID ?? charData.charID ?? charData.charid ?? 0) || 0,
      {
        characterAttributes: source,
      },
    );
    return {
      [ATTRIBUTE_CHARISMA]: Number(source[ATTRIBUTE_CHARISMA] ?? source.charisma ?? 20),
      [ATTRIBUTE_INTELLIGENCE]: Number(
        source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence ?? 20,
      ),
      [ATTRIBUTE_MEMORY]: Number(source[ATTRIBUTE_MEMORY] ?? source.memory ?? 20),
      [ATTRIBUTE_PERCEPTION]: Number(
        source[ATTRIBUTE_PERCEPTION] ?? source.perception ?? 20,
      ),
      [ATTRIBUTE_WILLPOWER]: Number(source[ATTRIBUTE_WILLPOWER] ?? source.willpower ?? 20),
      [ATTRIBUTE_MAX_LOCKED_TARGETS]: Number(
        characterTargetingState.maxLockedTargets ?? source[ATTRIBUTE_MAX_LOCKED_TARGETS] ?? 0,
      ),
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    };
  }
  _buildCharacterAttributeDict(charData = {}) {
    const attributes = this._buildCharacterAttributes(charData);
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }
  _getShipRuntimeAttributeOverrides(session, shipData = {}) {
    if (!session || !session._space || !shipData) {
      return null;
    }
    const activeShipID = Number(
      shipData.itemID ??
      shipData.shipID ??
      this._getShipID(session),
    ) || 0;
    const runtimeState = spaceRuntime.getShipAttributeSnapshot(session);
    if (!runtimeState || Number(runtimeState.itemID) !== activeShipID) {
      return null;
    }
    return runtimeState;
  }
  _getPropulsionModuleAttributeOverrides(item, session) {
    if (!item || !session) {
      return null;
    }
    const runtimeAttributes = spaceRuntime.getPropulsionModuleRuntimeAttributes(
      this._getCharID(session),
      item,
    );
    if (
      !runtimeAttributes ||
      !Number.isFinite(Number(runtimeAttributes.speedBoostFactor)) ||
      Number(runtimeAttributes.speedBoostFactor) <= 0
    ) {
      return null;
    }
    return runtimeAttributes;
  }
  _getGenericModuleAttributeOverrides(item, session) {
    if (!item || !session) {
      return null;
    }
    const charID = this._getCharID(session);
    const shipItem = getActiveShipRecord(charID);
    if (
      !shipItem ||
      Number(shipItem.itemID) !== Number(item.locationID)
    ) {
      return null;
    }
    const chargeItem = getLoadedChargeByFlag(
      charID,
      shipItem.itemID,
      item.flagID,
    );
    return spaceRuntime.getGenericModuleRuntimeAttributes(
      charID,
      shipItem,
      item,
      chargeItem,
    );
  }
  _resolveLoadedChargeItem(item, session = null) {
    if (!item || !session || !isShipFittingFlag(item.flagID)) {
      return null;
    }
    if (
      item.loadedChargeItem &&
      Number(item.loadedChargeItem.typeID) > 0 &&
      Number(item.loadedChargeItem.flagID) === Number(item.flagID)
    ) {
      return item.loadedChargeItem;
    }
    const charID = this._getCharID(session);
    const shipID = Number(item.locationID) || 0;
    const flagID = Number(item.flagID) || 0;
    if (charID <= 0 || shipID <= 0 || flagID <= 0) {
      return null;
    }
    return getLoadedChargeByFlag(charID, shipID, flagID);
  }
  _getWeaponDogmaAttributeOverrides(item, session = null) {
    if (!item || !isShipFittingFlag(item.flagID)) {
      return null;
    }
    const characterID = Number(item.ownerID) || this._getCharID(session);
    const shipID = Number(item.locationID) || 0;
    if (characterID <= 0 || shipID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(characterID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      );
    if (!shipItem) {
      return null;
    }
    const isChargeItem = Number(item.categoryID) === 8;
    const moduleItem = isChargeItem
      ? getFittedModuleByFlag(characterID, shipID, item.flagID)
      : item;
    const chargeItem = isChargeItem
      ? item
      : this._resolveLoadedChargeItem(item, session);
    if (!moduleItem) {
      return null;
    }
    return this._getWeaponDogmaAttributeOverridesForCharge(
      moduleItem,
      chargeItem,
      session,
    );
  }
  _getWeaponDogmaAttributeOverridesForCharge(
    moduleItem,
    chargeItem = null,
    session = null,
  ) {
    if (!moduleItem || !isShipFittingFlag(moduleItem.flagID)) {
      return null;
    }
    const characterID = Number(moduleItem.ownerID) || this._getCharID(session);
    const shipID = Number(moduleItem.locationID) || 0;
    if (characterID <= 0 || shipID <= 0) {
      return null;
    }
    const activeShipRecord = this._getActiveShipRecord(session);
    const shipItem =
      findCharacterShip(characterID, shipID) ||
      (
        activeShipRecord &&
        Number(activeShipRecord.itemID) === shipID
          ? activeShipRecord
          : null
      );
    if (!shipItem) {
      return null;
    }
    return buildWeaponDogmaAttributeOverrides({
      characterID,
      shipItem,
      moduleItem,
      chargeItem,
    });
  }
  _buildWeaponModuleAttributeMap(moduleItem, chargeItem = null, session = null) {
    const weaponDogmaAttributes = this._getWeaponDogmaAttributeOverridesForCharge(
      moduleItem,
      chargeItem,
      session,
    );
    const moduleAttributes =
      weaponDogmaAttributes &&
      weaponDogmaAttributes.moduleAttributes &&
      typeof weaponDogmaAttributes.moduleAttributes === "object"
        ? weaponDogmaAttributes.moduleAttributes
        : null;
    if (!moduleAttributes) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(moduleAttributes)
        .map(([attributeID, value]) => [Number(attributeID), Number(value)])
        .filter(
          ([attributeID, value]) =>
            Number.isInteger(attributeID) && Number.isFinite(value),
        ),
    );
  }
  _buildShipAttributes(charData = {}, shipData = {}, session = null) {
    const securityStatus = Number(
      charData.securityStatus ??
        charData.securityRating ??
        shipData.securityStatus ??
        shipData.securityRating ??
        0,
    );
    const shipCondition = getShipConditionState(shipData);
    const numericCharID = Number(charData.characterID ?? charData.charID ?? charData.charid ?? shipData.ownerID ?? 0) || 0;
    const { attributes, resourceState } = calculateShipDerivedAttributes(
      numericCharID,
      shipData,
    );
    const characterCombatAttributes = collectCharacterModifierAttributes(
      resourceState && resourceState.skillMap,
      resourceState && resourceState.fittedItems,
      [],
    );
    const runtimeAttributeOverrides = this._getShipRuntimeAttributeOverrides(
      session,
      shipData,
    );
    const shipTypeID = Number(shipData.typeID);
    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;
    const resolvedMass = Number(shipData.mass ?? (shipMetadata && shipMetadata.mass));
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }
    const resolvedVolume = Number(shipData.volume ?? (shipMetadata && shipMetadata.volume));
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }
    const resolvedRadius = Number(shipData.radius ?? (shipMetadata && shipMetadata.radius));
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }
    for (const [attributeID, value] of Object.entries(characterCombatAttributes || {})) {
      const numericAttributeID = Number(attributeID);
      const numericValue = Number(value);
      if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
        continue;
      }
      attributes[numericAttributeID] = numericValue;
    }
    if (
      runtimeAttributeOverrides &&
      runtimeAttributeOverrides.attributes &&
      typeof runtimeAttributeOverrides.attributes === "object"
    ) {
      for (const [attributeID, value] of Object.entries(runtimeAttributeOverrides.attributes)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (!Number.isInteger(numericAttributeID) || !Number.isFinite(numericValue)) {
          continue;
        }
        attributes[numericAttributeID] = numericValue;
      }
    }
    if (runtimeAttributeOverrides) {
      attributes[ATTRIBUTE_MASS] = Number(runtimeAttributeOverrides.mass);
      attributes[ATTRIBUTE_MAX_VELOCITY] = Number(
        runtimeAttributeOverrides.maxVelocity,
      );
      attributes[ATTRIBUTE_MAX_TARGET_RANGE] = Number(
        runtimeAttributeOverrides.maxTargetRange,
      );
      attributes[ATTRIBUTE_MAX_LOCKED_TARGETS] = Number(
        runtimeAttributeOverrides.maxLockedTargets,
      );
      attributes[ATTRIBUTE_SIGNATURE_RADIUS] = Number(
        runtimeAttributeOverrides.signatureRadius,
      );
      attributes[ATTRIBUTE_CLOAKING_TARGETING_DELAY] = Number(
        runtimeAttributeOverrides.cloakingTargetingDelay,
      );
      attributes[ATTRIBUTE_SCAN_RESOLUTION] = Number(
        runtimeAttributeOverrides.scanResolution,
      );
    }
    const shieldCapacity = Number(attributes[ATTRIBUTE_SHIELD_CAPACITY]);
    if (
      Number.isFinite(shieldCapacity) &&
      shieldCapacity >= 0 &&
      Number.isFinite(shipCondition.shieldCharge)
    ) {
      attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(
        (shieldCapacity * shipCondition.shieldCharge).toFixed(6),
      );
    }
    const armorHP = Number(attributes[ATTRIBUTE_ARMOR_HP]);
    if (
      Number.isFinite(armorHP) &&
      armorHP >= 0 &&
      Number.isFinite(shipCondition.armorDamage)
    ) {
      attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(
        (armorHP * shipCondition.armorDamage).toFixed(6),
      );
    }
    if (Number.isFinite(shipCondition.damage)) {
      attributes[ATTRIBUTE_ITEM_DAMAGE] = shipCondition.damage;
    }
    // CCP parity: Set attribute 18 ("charge") to the current capacitor energy
    // in GJ so the client's HUD capacitor gauge displays correctly.  The value
    // is capacitorCapacity * chargeRatio (conditionState.charge stores 0-1).
    const capacitorCapacity = Number(attributes[482]); // ATTRIBUTE_CAPACITOR_CAPACITY
    if (
      Number.isFinite(capacitorCapacity) &&
      capacitorCapacity > 0 &&
      Number.isFinite(shipCondition.charge)
    ) {
      attributes[ATTRIBUTE_CHARGE] = Number(
        (capacitorCapacity * shipCondition.charge).toFixed(6),
      );
    }
    attributes[ATTRIBUTE_PILOT_SECURITY_STATUS] = Number.isFinite(securityStatus)
      ? securityStatus
      : 0;
    return {
      ...attributes,
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    };
  }
  _buildShipAttributeDict(charData = {}, shipData = {}, session = null) {
    const attributes = this._buildShipAttributes(charData, shipData, session);
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }
  _buildAttributeValueDict(attributes = {}) {
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        marshalDogmaAttributeValue(attributeID, value),
      ]),
    };
  }
  _buildInventoryItemAttributes(item, session = null) {
    const loadedChargeItem = this._resolveLoadedChargeItem(item, session);
    const typeAttributes = buildEffectiveItemAttributeMap(item, loadedChargeItem);
    const attributes = Object.fromEntries(
      Object.entries(typeAttributes || {})
        .map(([attributeID, value]) => [Number(attributeID), Number(value)])
        .filter(
          ([attributeID, value]) =>
            Number.isInteger(attributeID) && Number.isFinite(value),
        )
        .map(([attributeID, value]) => [
          attributeID,
          marshalDogmaAttributeValue(attributeID, value),
        ]),
    );
    const weaponDogmaAttributes = this._getWeaponDogmaAttributeOverrides(
      item,
      session,
    );
    const overrideAttributes =
      Number(item && item.categoryID) === 8
        ? weaponDogmaAttributes && weaponDogmaAttributes.chargeAttributes
        : weaponDogmaAttributes && weaponDogmaAttributes.moduleAttributes;
    if (overrideAttributes && typeof overrideAttributes === "object") {
      for (const [attributeID, value] of Object.entries(overrideAttributes)) {
        const numericAttributeID = Number(attributeID);
        const numericValue = Number(value);
        if (
          !Number.isInteger(numericAttributeID) ||
          !Number.isFinite(numericValue)
        ) {
          continue;
        }
        attributes[numericAttributeID] = marshalDogmaAttributeValue(
          numericAttributeID,
          numericValue,
        );
      }
    }
    const quantityAttributeID = getAttributeIDByNames("quantity");
    if (quantityAttributeID) {
      attributes[quantityAttributeID] = Number(
        item && (item.stacksize ?? item.quantity ?? 0),
      ) || 0;
    }
    const isOnlineAttributeID = getAttributeIDByNames("isOnline");
    if (isOnlineAttributeID && item && item.moduleState) {
      attributes[isOnlineAttributeID] = isModuleOnline(item) ? 1 : 0;
    }
    if (item && item.moduleState) {
      if (Number.isFinite(Number(item.moduleState.damage))) {
        attributes[ATTRIBUTE_ITEM_DAMAGE] = Number(item.moduleState.damage);
      }
      if (Number.isFinite(Number(item.moduleState.armorDamage))) {
        attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(item.moduleState.armorDamage);
      }
      if (Number.isFinite(Number(item.moduleState.shieldCharge))) {
        attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(item.moduleState.shieldCharge);
      }
    }
    const propulsionRuntimeAttributes = this._getPropulsionModuleAttributeOverrides(
      item,
      session,
    );
    if (propulsionRuntimeAttributes) {
      attributes[MODULE_ATTRIBUTE_CAPACITOR_NEED] = Number(
        propulsionRuntimeAttributes.capNeed,
      );
      attributes[MODULE_ATTRIBUTE_SPEED_FACTOR] = Number(
        propulsionRuntimeAttributes.speedFactor,
      );
      attributes[MODULE_ATTRIBUTE_DURATION] = marshalDogmaAttributeValue(
        MODULE_ATTRIBUTE_DURATION,
        Number(propulsionRuntimeAttributes.durationMs),
      );
    } else {
      const genericRuntimeAttributes = this._getGenericModuleAttributeOverrides(
        item,
        session,
      );
      if (genericRuntimeAttributes) {
        attributes[MODULE_ATTRIBUTE_CAPACITOR_NEED] = Number(
          genericRuntimeAttributes.capNeed,
        );
        const durationAttributeID = Number(
          genericRuntimeAttributes.durationAttributeID,
        ) || MODULE_ATTRIBUTE_DURATION;
        attributes[durationAttributeID] = marshalDogmaAttributeValue(
          durationAttributeID,
          Number(genericRuntimeAttributes.durationMs),
        );
        if (
          durationAttributeID !== MODULE_ATTRIBUTE_DURATION &&
          MODULE_ATTRIBUTE_DURATION in attributes
        ) {
          delete attributes[MODULE_ATTRIBUTE_DURATION];
        }
        if (
          durationAttributeID !== MODULE_ATTRIBUTE_SPEED &&
          MODULE_ATTRIBUTE_SPEED in attributes
        ) {
          delete attributes[MODULE_ATTRIBUTE_SPEED];
        }
      }
    }
    const reloadRuntimeAttributes = this._getModuleReloadAttributeOverrides(
      item,
      session,
    );
    if (reloadRuntimeAttributes) {
      if (
        ATTRIBUTE_RELOAD_TIME &&
        Number.isFinite(Number(reloadRuntimeAttributes.reloadTime))
      ) {
        attributes[ATTRIBUTE_RELOAD_TIME] = Number(reloadRuntimeAttributes.reloadTime);
      }
      if (
        ATTRIBUTE_NEXT_ACTIVATION_TIME &&
        typeof reloadRuntimeAttributes.nextActivationTime === "bigint"
      ) {
        attributes[ATTRIBUTE_NEXT_ACTIVATION_TIME] =
          reloadRuntimeAttributes.nextActivationTime;
      }
    }
    return attributes;
  }
  _getPendingModuleReload(moduleID) {
    const numericModuleID = Number(moduleID) || 0;
    if (numericModuleID <= 0) {
      return null;
    }
    const reloadState = pendingModuleReloads.get(numericModuleID) || null;
    if (!reloadState) {
      return null;
    }
    const completeAtMs = Number(reloadState.completeAtMs) || 0;
    const currentTimeMs = getReloadStateCurrentTimeMs(reloadState, Date.now());
    if (completeAtMs > 0 && completeAtMs > currentTimeMs) {
      return reloadState;
    }
    pendingModuleReloads.delete(numericModuleID);
    schedulePendingModuleReloadPump();
    return null;
  }
  _getModuleReloadTimeMs(moduleItem) {
    const reloadTimeMs = Number(
      getTypeAttributeValue(
        Number(moduleItem && moduleItem.typeID) || 0,
        "reloadTime",
      ),
    );
    if (!Number.isFinite(reloadTimeMs) || reloadTimeMs <= 0) {
      return 0;
    }
    return Math.max(0, Math.round(reloadTimeMs));
  }
  _getModuleReloadAttributeOverrides(item, _session = null) {
    const reloadState = this._getPendingModuleReload(item && item.itemID);
    if (!reloadState) {
      return null;
    }
    return {
      reloadTime: Number(reloadState.reloadTimeMs) || 0,
      nextActivationTime: toFileTimeFromMs(reloadState.completeAtMs, 0n),
    };
  }
  _notifyChargeBeingLoadedToModule(session, moduleIDs = [], chargeTypeID, reloadTimeMs) {
    if (!session || typeof session.sendNotification !== "function") {
      return;
    }
    const numericModuleIDs = (Array.isArray(moduleIDs) ? moduleIDs : [moduleIDs])
      .map((moduleID) => Number(moduleID) || 0)
      .filter((moduleID) => moduleID > 0);
    if (numericModuleIDs.length === 0) {
      return;
    }
    session.sendNotification("OnChargeBeingLoadedToModule", "clientID", [
      {
        type: "list",
        items: numericModuleIDs,
      },
      Number(chargeTypeID) > 0 ? Number(chargeTypeID) : null,
      Math.max(0, Math.round(Number(reloadTimeMs) || 0)),
    ]);
    log.debug(
      `[DogmaIM] OnChargeBeingLoadedToModule modules=${JSON.stringify(
        numericModuleIDs,
      )} chargeTypeID=${Number(chargeTypeID) || 0} ` +
      `reloadTimeMs=${Math.max(0, Math.round(Number(reloadTimeMs) || 0))}`,
    );
  }
  _notifyModuleNextActivationTime(
    session,
    moduleID,
    nextActivationTime = 0n,
    previousActivationTime = 0n,
  ) {
    if (!ATTRIBUTE_NEXT_ACTIVATION_TIME) {
      return;
    }
    const numericModuleID = Number(moduleID) || 0;
    if (numericModuleID <= 0) {
      return;
    }
    this._notifyModuleAttributeChanges(session, [[
      "OnModuleAttributeChanges",
      this._getCharID(session),
      numericModuleID,
      ATTRIBUTE_NEXT_ACTIVATION_TIME,
      this._sessionFileTime(session),
      typeof nextActivationTime === "bigint" ? nextActivationTime : 0n,
      typeof previousActivationTime === "bigint" ? previousActivationTime : 0n,
      null,
    ]]);
    log.debug(
      `[DogmaIM] NextActivationTime moduleID=${numericModuleID} ` +
      `next=${typeof nextActivationTime === "bigint" ? nextActivationTime.toString() : String(nextActivationTime)} ` +
      `previous=${typeof previousActivationTime === "bigint" ? previousActivationTime.toString() : String(previousActivationTime)}`,
    );
  }
  _buildInventoryItemAttributeDict(item, session = null) {
    return this._buildAttributeValueDict(
      this._buildInventoryItemAttributes(item, session),
    );
  }
  _buildActiveEffectEntry(item, effectID, options = {}, session = null) {
    if (!item || effectID <= 0) {
      return null;
    }
    const now = session ? this._sessionFileTime(session) : this._nowFileTime();
    const timestamp = this._toFileTime(options.startedAt, now);
    const durationMs = Number.isFinite(Number(options.duration))
      ? Math.max(Number(options.duration), -1)
      : -1;
    const duration = marshalModuleDurationWireValue(durationMs);
    const repeat = options.repeat === undefined || options.repeat === null
      ? -1
      : Number(options.repeat);
    return [
      effectID,
      [
        Number(item.itemID) || 0,
        Number(item.ownerID) || 0,
        Number(item.locationID) || 0,
        Number(options.targetID) > 0 ? Number(options.targetID) : null,
        Number(options.otherID) > 0 ? Number(options.otherID) : null,
        [],
        effectID,
        timestamp,
        duration,
        Number.isFinite(repeat) ? repeat : -1,
      ],
    ];
  }
  _getPropulsionEffectID(effectName) {
    switch (String(effectName || "")) {
      case "moduleBonusAfterburner":
        return EFFECT_AFTERBURNER;
      case "moduleBonusMicrowarpdrive":
        return EFFECT_MICROWARPDRIVE;
      default:
        return 0;
    }
  }
  _buildInventoryItemActiveEffects(item, session = null) {
    if (!item) {
      return this._buildEmptyDict();
    }
    const entries = [];
    // CCP parity: modules without an explicit moduleState default to online
    // (fitted before the auto-online migration).
    const effectivelyOnline =
      isModuleOnline(item) ||
      item.moduleState === undefined ||
      item.moduleState === null;
    if (effectivelyOnline) {
      const onlineEntry = this._buildActiveEffectEntry(item, EFFECT_ONLINE, {}, session);
      if (onlineEntry) {
        entries.push(onlineEntry);
      }
    }
    if (session && session._space) {
      const activeEffect = spaceRuntime.getActiveModuleEffect(session, item.itemID);
      if (activeEffect) {
        const activeEffectID =
          Number(activeEffect.effectID) > 0
            ? Number(activeEffect.effectID)
            : this._getPropulsionEffectID(activeEffect.effectName);
        const activeEntry = this._buildActiveEffectEntry(
          item,
          activeEffectID,
          {
            startedAt: activeEffect.startedAtMs,
            duration: activeEffect.durationMs,
            repeat: activeEffect.repeat,
            targetID: activeEffect.targetID,
          },
          session,
        );
        if (activeEntry) {
          entries.push(activeEntry);
        }
      }
    }
    return entries.length > 0
      ? {
          type: "dict",
          entries,
        }
      : this._buildEmptyDict();
  }
  _buildShipInventoryInfoEntries(
    charID,
    shipID,
    ownerID,
    locationID,
    session = null,
    options = {},
  ) {
    const inventoryEntries = [];
    if (options.includeFittedItems !== false) {
      const fittedItems = getFittedModuleItems(charID, shipID);
      if (Array.isArray(fittedItems)) {
        inventoryEntries.push(
          ...fittedItems.map((item) => [
            item.itemID,
            this._buildCommonGetInfoEntry({
              itemID: item.itemID,
              typeID: item.typeID,
              ownerID: item.ownerID || ownerID,
              locationID: this._coalesce(item.locationID, shipID),
              flagID: item.flagID,
              groupID: item.groupID,
              categoryID: item.categoryID,
              quantity: item.quantity,
              singleton: item.singleton,
              stacksize: item.stacksize,
              customInfo: item.customInfo || "",
              description: item.itemName || "item",
              activeEffects: this._buildInventoryItemActiveEffects(item, session),
              attributes: this._buildInventoryItemAttributeDict(item, session),
              session,
            }),
          ]),
        );
      }
    }
    if (options.includeLoadedCharges === true) {
      const loadedCharges = getLoadedChargeItems(charID, shipID);
      if (Array.isArray(loadedCharges)) {
        inventoryEntries.push(
          ...loadedCharges.map((item) => [
            item.itemID,
            this._buildCommonGetInfoEntry({
              itemID: item.itemID,
              typeID: item.typeID,
              ownerID: item.ownerID || ownerID,
              locationID: this._coalesce(item.locationID, shipID),
              flagID: item.flagID,
              groupID: item.groupID,
              categoryID: item.categoryID,
              quantity: item.quantity,
              singleton: item.singleton,
              stacksize: item.stacksize,
              customInfo: item.customInfo || "",
              description: item.itemName || "charge",
              attributes: this._buildInventoryItemAttributeDict(item, session),
              session,
            }),
          ]),
        );
      }
    }
    if (options.includeChargeSublocations !== false) {
      const tupleChargeEntries = buildChargeSublocationData(charID, shipID)
        .map((entry) => {
          const loadedCharge = getLoadedChargeByFlag(charID, shipID, entry.flagID);
          if (!loadedCharge) {
            return null;
          }
          const quantity = Math.max(
            0,
            Number(loadedCharge.stacksize ?? loadedCharge.quantity ?? 0) || 0,
          );
          const tupleChargeItem = {
            ...loadedCharge,
            itemID: buildChargeTupleItemID(shipID, entry.flagID, entry.typeID),
            ownerID: loadedCharge.ownerID || ownerID,
            locationID: shipID,
            flagID: entry.flagID,
            typeID: entry.typeID,
            quantity,
            stacksize: quantity,
            singleton: 0,
            customInfo: loadedCharge.customInfo || "",
          };
          return [
            tupleChargeItem.itemID,
            this._buildCommonGetInfoEntry({
              itemID: tupleChargeItem.itemID,
              typeID: tupleChargeItem.typeID,
              ownerID: tupleChargeItem.ownerID || ownerID,
              locationID: shipID,
              flagID: tupleChargeItem.flagID,
              groupID: tupleChargeItem.groupID,
              categoryID: tupleChargeItem.categoryID,
              quantity,
              singleton: 0,
              stacksize: quantity,
              customInfo: tupleChargeItem.customInfo || "",
              description: "charge",
              // Login tooltip parity: the active-ship HUD resolves current-ship
              // charge DPS through `svc.godma`, not only clientDogmaLocation.
              // Stock `GetAllInfo.shipInfo` therefore has to seed the tuple
              // charge rows with the full attribute dict, not just quantity.
              attributes: this._buildInventoryItemAttributeDict(
                tupleChargeItem,
                session,
              ),
              session,
            }),
          ];
        })
        .filter(Boolean);
      inventoryEntries.push(...tupleChargeEntries);
    }
    return inventoryEntries;
  }
  _buildChargeSublocationRow({
    locationID,
    flagID,
    typeID,
    quantity,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "flagID", "typeID", "quantity"]],
          ["line", [locationID, flagID, typeID, quantity]],
        ],
      },
    };
  }
  _buildChargeStateDict(charID, shipID) {
    const chargesByFlag = buildChargeSublocationData(charID, shipID);
    if (chargesByFlag.length === 0) {
      return this._buildEmptyDict();
    }
    return {
      type: "dict",
      entries: [[
        shipID,
        {
          type: "dict",
          entries: chargesByFlag.map((entry) => [
            entry.flagID,
            this._buildChargeSublocationRow({
              locationID: shipID,
              flagID: entry.flagID,
              typeID: entry.typeID,
              quantity: entry.quantity,
            }),
          ]),
        },
      ]],
    };
  }
  _findInventoryItemContext(requestedItemID, session) {
    const charID = this._getCharID(session);
    if (Array.isArray(requestedItemID) && requestedItemID.length >= 3) {
      const [shipID, flagID, typeID] = requestedItemID;
      const chargeItem = getLoadedChargeByFlag(charID, Number(shipID), Number(flagID));
      if (
        chargeItem &&
        Number(chargeItem.typeID) === Number(typeID)
      ) {
        return {
          itemID: requestedItemID,
          typeID: Number(typeID),
          item: chargeItem,
          attributes: this._buildInventoryItemAttributes(chargeItem, session),
          baseAttributes: this._buildInventoryItemAttributes(chargeItem),
        };
      }
      return null;
    }
    const numericItemID = Number.parseInt(String(requestedItemID), 10) || 0;
    if (numericItemID <= 0) {
      return null;
    }
    const item = findItemById(numericItemID);
    if (
      !item ||
      Number(item.ownerID) !== charID ||
      Number(item.categoryID) === SHIP_CATEGORY_ID
    ) {
      return null;
    }
    return {
      itemID: item.itemID,
      typeID: Number(item.typeID),
      item,
      attributes: this._buildInventoryItemAttributes(item, session),
      baseAttributes: this._buildInventoryItemAttributes(item),
    };
  }
  _notifyModuleAttributeChanges(session, changes = []) {
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }
    const normalizedChanges = changes.map((change) => normalizeModuleAttributeChange(change));
    session.sendNotification("OnModuleAttributeChanges", "clientID", [{
      type: "list",
      items: normalizedChanges,
    }]);
    log.debug(
      `[DogmaIM] OnModuleAttributeChanges count=${normalizedChanges.length} ` +
      `changes=${JSON.stringify(
        normalizedChanges.map((change) => summarizeModuleAttributeChangeLog(change)),
      )}`,
    );
  }
  _refreshDockedFittingState(session, changes = []) {
    if (
      !session ||
      !isDockedSession(session) ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }
    const activeShipID = Number(
      session.activeShipID || session.shipID || session.shipid || 0,
    ) || 0;
    if (activeShipID <= 0) {
      return;
    }
    const touchesFittingState = changes.some((change) => {
      if (!change || !change.item) {
        return false;
      }
      const previousState = change.previousData || change.previousState || {};
      const previousLocationID = Number(previousState.locationID) || 0;
      const previousFlagID = Number(previousState.flagID) || 0;
      const nextLocationID = Number(change.item.locationID) || 0;
      const nextFlagID = Number(change.item.flagID) || 0;
      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }
      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    });
    if (!touchesFittingState) {
      return;
    }
    syncShipFittingStateForSession(session, activeShipID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: false,
    });
  }
  _captureChargeStateSnapshot(charID, shipID, flagID) {
    const chargeItem = getLoadedChargeByFlag(charID, shipID, flagID);
    if (!chargeItem) {
      return {
        typeID: 0,
        quantity: 0,
      };
    }
    return {
      typeID: Number(chargeItem.typeID) || 0,
      quantity: Math.max(
        0,
        Number(chargeItem.stacksize ?? chargeItem.quantity ?? 0) || 0,
      ),
    };
  }
  _captureChargeItemSnapshot(charID, shipID, flagID) {
    const chargeItem = getLoadedChargeByFlag(charID, shipID, flagID);
    return chargeItem ? { ...chargeItem } : null;
  }
  _notifyWeaponModuleAttributeTransition(
    session,
    moduleItem,
    previousChargeItem = null,
    nextChargeItem = null,
  ) {
    if (!session || typeof session.sendNotification !== "function" || !moduleItem) {
      return;
    }
    const numericModuleID = Number(moduleItem.itemID) || 0;
    const numericCharID = Number(moduleItem.ownerID) || this._getCharID(session);
    if (numericModuleID <= 0 || numericCharID <= 0) {
      return;
    }
    const previousAttributes =
      this._buildWeaponModuleAttributeMap(
        moduleItem,
        previousChargeItem,
        session,
      ) || {};
    const nextAttributes =
      this._buildWeaponModuleAttributeMap(
        moduleItem,
        nextChargeItem,
        session,
      ) || {};
    const changedAttributeIDs = new Set([
      ...Object.keys(previousAttributes),
      ...Object.keys(nextAttributes),
    ]);
    const when = this._sessionFileTime(session);
    const changes = [];
    for (const rawAttributeID of changedAttributeIDs) {
      const attributeID = Number(rawAttributeID);
      if (!Number.isInteger(attributeID) || attributeID <= 0) {
        continue;
      }
      const previousValue = Object.prototype.hasOwnProperty.call(
        previousAttributes,
        attributeID,
      )
        ? Number(previousAttributes[attributeID])
        : 0;
      const nextValue = Object.prototype.hasOwnProperty.call(
        nextAttributes,
        attributeID,
      )
        ? Number(nextAttributes[attributeID])
        : 0;
      if (
        !Number.isFinite(previousValue) ||
        !Number.isFinite(nextValue) ||
        Math.abs(nextValue - previousValue) <= 1e-9
      ) {
        continue;
      }
      changes.push([
        "OnModuleAttributeChanges",
        numericCharID,
        numericModuleID,
        attributeID,
        when,
        nextValue,
        previousValue,
        null,
      ]);
    }
    if (changes.length > 0) {
      this._notifyModuleAttributeChanges(session, changes);
    }
  }
  _notifyChargeQuantityTransition(
    session,
    charID,
    shipID,
    flagID,
    previousState = null,
    nextState = null,
    options = {},
  ) {
    if (!ATTRIBUTE_QUANTITY) {
      return;
    }
    const numericCharID = Number(charID) || 0;
    const numericShipID = Number(shipID) || 0;
    const numericFlagID = Number(flagID) || 0;
    if (numericCharID <= 0 || numericShipID <= 0 || numericFlagID <= 0) {
      return;
    }
    const previousTypeID = Number(previousState && previousState.typeID) || 0;
    const nextTypeID = Number(nextState && nextState.typeID) || 0;
    const previousQuantity = Math.max(
      0,
      Number(previousState && previousState.quantity) || 0,
    );
    const nextQuantity = Math.max(
      0,
      Number(nextState && nextState.quantity) || 0,
    );
    const forceTupleRepair = options.forceTupleRepair === true;
    if (
      previousTypeID === nextTypeID &&
      previousQuantity === nextQuantity
    ) {
      if (
        session &&
        session._space &&
        forceTupleRepair &&
        nextTypeID > 0 &&
        nextQuantity > 0
      ) {
        syncChargeSublocationTransitionForSession(session, {
          shipID: numericShipID,
          flagID: numericFlagID,
          ownerID: numericCharID,
          previousState,
          nextState,
          forceRepair: true,
          forcePrimeNextCharge: true,
          nextChargeRepairDelayMs: 0,
        });
      }
      return;
    }
    if (session && session._space) {
      // Live tuple-backed ammo swaps are very order-sensitive on the client:
      // clear the previous tuple through quantity=0, then godma-prime the new
      // tuple identity, and only let the delayed clean OnItemChange row
      // materialize the replacement charge. Advertising quantity>0 for the new
      // tuple before that clean row lands reopens the stale synthetic-row path.
      if (previousTypeID !== nextTypeID) {
        let now = this._nowFileTime();
        const changes = [];
        const pushQuantityChange = (typeID, newValue, oldValue) => {
          const numericTypeID = Number(typeID) || 0;
          if (numericTypeID <= 0 || Number(newValue) === Number(oldValue)) {
            return;
          }
          changes.push([
            "OnModuleAttributeChanges",
            numericCharID,
            buildChargeTupleItemID(numericShipID, numericFlagID, numericTypeID),
            ATTRIBUTE_QUANTITY,
            now,
            Number(newValue) || 0,
            Number(oldValue) || 0,
            null,
          ]);
          now = typeof now === "bigint" ? now + 1n : now + 1;
        };
        pushQuantityChange(previousTypeID, 0, previousQuantity);
        if (changes.length > 0) {
          this._notifyModuleAttributeChanges(session, changes);
        }
      }
      syncChargeSublocationTransitionForSession(session, {
        shipID: numericShipID,
        flagID: numericFlagID,
        ownerID: numericCharID,
        previousState,
        nextState,
        primeNextCharge: previousTypeID !== nextTypeID,
      });
      return;
    }
    const now = this._nowFileTime();
    const changes = [];
    const pushQuantityChange = (typeID, newValue, oldValue) => {
      const numericTypeID = Number(typeID) || 0;
      if (numericTypeID <= 0 || Number(newValue) === Number(oldValue)) {
        return;
      }
      changes.push([
        "OnModuleAttributeChanges",
        numericCharID,
        buildChargeTupleItemID(numericShipID, numericFlagID, numericTypeID),
        ATTRIBUTE_QUANTITY,
        now,
        Number(newValue) || 0,
        Number(oldValue) || 0,
        null,
      ]);
    };
    if (previousTypeID > 0 && previousTypeID === nextTypeID) {
      pushQuantityChange(previousTypeID, nextQuantity, previousQuantity);
    } else {
      pushQuantityChange(previousTypeID, 0, previousQuantity);
      pushQuantityChange(nextTypeID, nextQuantity, 0);
    }
    this._notifyModuleAttributeChanges(session, changes);
  }
  _syncInventoryChanges(session, changes = []) {
    if (!session || !Array.isArray(changes)) {
      return;
    }
    const normalizedChanges = this._normalizeInventoryChanges(changes);
    const clientFacingChanges = this._filterInventoryChangesForClient(
      session,
      normalizedChanges,
    );
    for (const change of clientFacingChanges) {
      if (!change) {
        continue;
      }
      if (change.item) {
        syncInventoryItemForSession(
          session,
          change.item,
          change.previousData || change.previousState || {},
          {
          emitCfgLocation: false,
          },
        );
      }
    }
    this._refreshDockedFittingState(session, normalizedChanges);
  }
  _buildRemovedInventoryNotificationState(item = {}) {
    return {
      ...item,
      locationID: REMOVED_ITEM_JUNK_LOCATION_ID,
      quantity:
        Number(item.singleton) === 1
          ? -1
          : Number(item.stacksize ?? item.quantity ?? 0) || 0,
      stacksize:
        Number(item.singleton) === 1
          ? 1
          : Number(item.stacksize ?? item.quantity ?? 0) || 0,
    };
  }
  _filterInventoryChangesForClient(session, changes = []) {
    if (!Array.isArray(changes)) {
      return [];
    }
    if (!session || !session._space) {
      return changes.filter((change) => Boolean(change));
    }
    const activeShipID = Number(
      (session._space && session._space.shipID) ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) || 0;
    return changes.flatMap((change) => {
      if (!change) {
        return [];
      }
      const currentItem = change.item || null;
      const previousItem = change.previousData || change.previousState || null;
      const candidateItem = currentItem || previousItem || null;
      if (!candidateItem || typeof candidateItem !== "object") {
        return [change];
      }
      if (Number(candidateItem.categoryID) !== 8) {
        return [change];
      }
      const currentLocationID = Number(currentItem && currentItem.locationID) || 0;
      const previousLocationID =
        Number(previousItem && previousItem.locationID) || 0;
      const currentFlagID = Number(currentItem && currentItem.flagID) || 0;
      const previousFlagID = Number(previousItem && previousItem.flagID) || 0;
      const currentFitted =
        currentLocationID === activeShipID &&
        isShipFittingFlag(currentFlagID);
      const previousFitted =
        previousLocationID === activeShipID &&
        isShipFittingFlag(previousFlagID);
      if (!currentFitted && !previousFitted) {
        return [change];
      }

      const movedWholeCargoStackIntoSlot =
        previousItem &&
        currentFitted &&
        !previousFitted &&
        previousLocationID === activeShipID;
      if (movedWholeCargoStackIntoSlot) {
        // Keep live dogma tuple-backed by suppressing the fitted charge row, but
        // still tell invCache that the source cargo stack disappeared so it does
        // not keep stale ammo itemIDs around after repeated crystal swaps.
        return [{
          ...change,
          item: this._buildRemovedInventoryNotificationState(previousItem),
          previousData: previousItem,
        }];
      }

      // Do not stream real fitted charge rows into the live in-space godma
      // inventory model. They end up in shipItem.modules, override the
      // tuple-backed slot charge rows, and the HUD then hovers real charge
      // itemIDs that clientDogmaIM never loaded.
      return [];
    });
  }
  _normalizeInventoryChanges(changes = []) {
    if (!Array.isArray(changes)) {
      return [];
    }
    return changes
      .filter((change) => change && change.item)
      .map((change) => ({
        ...change,
        previousData: change.previousData || change.previousState || {},
      }));
  }
  _moveLoadedChargeToDestination(
    chargeItem,
    destinationLocationID,
    destinationFlagID,
    quantity = null,
  ) {
    const sourceItemID = Number(chargeItem && chargeItem.itemID) || 0;
    const ownerID = Number(chargeItem && chargeItem.ownerID) || 0;
    const sourceFlagID = Number(chargeItem && chargeItem.flagID) || 0;
    const sourceQuantity = Math.max(
      0,
      Number(chargeItem && (chargeItem.stacksize ?? chargeItem.quantity ?? 0)) || 0,
    );
    const numericDestinationLocationID = Number(destinationLocationID) || 0;
    const numericDestinationFlagID = Number(destinationFlagID) || 0;
    const requestedQuantity =
      quantity === null || quantity === undefined
        ? sourceQuantity
        : Math.max(1, Math.min(sourceQuantity, Number(quantity) || 0));
    if (
      sourceItemID <= 0 ||
      ownerID <= 0 ||
      requestedQuantity <= 0 ||
      numericDestinationLocationID <= 0
    ) {
      return {
        success: false,
        errorMsg: "ITEM_NOT_FOUND",
      };
    }
    const sourceIsLoadedCharge =
      Number(chargeItem.categoryID) === 8 &&
      isShipFittingFlag(sourceFlagID) &&
      !isShipFittingFlag(numericDestinationFlagID);
    if (!sourceIsLoadedCharge) {
      return moveItemToLocation(
        sourceItemID,
        numericDestinationLocationID,
        numericDestinationFlagID,
        requestedQuantity,
      );
    }
    const matchingDestinationCandidates = listContainerItems(
      ownerID,
      numericDestinationLocationID,
      numericDestinationFlagID,
    )
      .filter(
        (item) =>
          item &&
          Number(item.itemID) !== sourceItemID &&
          Number(item.singleton) !== 1 &&
          Number(item.typeID) === Number(chargeItem.typeID),
      )
      .sort((left, right) => Number(left.itemID) - Number(right.itemID));
    const preferredOriginStackID = Number(chargeItem && chargeItem.stackOriginID) || 0;
    const matchingDestinationStack =
      (preferredOriginStackID > 0
        ? matchingDestinationCandidates.find(
          (item) =>
            item &&
            Number(item.itemID) === preferredOriginStackID &&
            Number(item.singleton) !== 1 &&
            Number(item.typeID) === Number(chargeItem.typeID),
        )
        : null) ||
      matchingDestinationCandidates[0] ||
      null;
    if (matchingDestinationStack) {
      return mergeItemStacks(
        sourceItemID,
        matchingDestinationStack.itemID,
        requestedQuantity,
      );
    }
    if (requestedQuantity < sourceQuantity) {
      return moveItemToLocation(
        sourceItemID,
        numericDestinationLocationID,
        numericDestinationFlagID,
        requestedQuantity,
      );
    }
    const grantResult = grantItemToCharacterLocation(
      ownerID,
      numericDestinationLocationID,
      numericDestinationFlagID,
      Number(chargeItem.typeID) || 0,
      requestedQuantity,
      {
        itemName: chargeItem.itemName || "",
        customInfo: chargeItem.customInfo || "",
      },
    );
    if (!grantResult.success) {
      return grantResult;
    }
    const removeResult = removeInventoryItem(sourceItemID, {
      removeContents: false,
    });
    if (!removeResult.success) {
      return removeResult;
    }
    return {
      success: true,
      data: {
        quantity: requestedQuantity,
        changes: [
          ...this._normalizeInventoryChanges(grantResult.data && grantResult.data.changes),
          ...this._normalizeInventoryChanges(removeResult.data && removeResult.data.changes),
        ],
      },
    };
  }
  _buildShipBaseAttributes(shipData = {}) {
    const payload = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
    const shipTypeID = Number(shipData.typeID);
    const staticEntry =
      Number.isInteger(shipTypeID) &&
      payload &&
      payload.shipAttributesByTypeID &&
      typeof payload.shipAttributesByTypeID === "object"
        ? payload.shipAttributesByTypeID[String(shipTypeID)] || null
        : null;
    const staticAttributes =
      staticEntry && staticEntry.attributes && typeof staticEntry.attributes === "object"
        ? staticEntry.attributes
        : null;
    const attributes = staticAttributes
      ? Object.fromEntries(
          Object.entries(staticAttributes)
            .map(([attributeID, value]) => [Number(attributeID), Number(value)])
            .filter(
              ([attributeID, value]) =>
                Number.isInteger(attributeID) && Number.isFinite(value),
            ),
        )
      : {};
    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;
    const resolvedMass = Number(shipData.mass ?? (shipMetadata && shipMetadata.mass));
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }
    const resolvedCapacity = Number(
      shipData.capacity ?? (shipMetadata && shipMetadata.capacity),
    );
    if (!(ATTRIBUTE_CAPACITY in attributes) && Number.isFinite(resolvedCapacity)) {
      attributes[ATTRIBUTE_CAPACITY] = resolvedCapacity;
    }
    const resolvedVolume = Number(shipData.volume ?? (shipMetadata && shipMetadata.volume));
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }
    const resolvedRadius = Number(shipData.radius ?? (shipMetadata && shipMetadata.radius));
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }
    return attributes;
  }
  _isNewbieShipItem(item) {
    return isNewbieShipItem(item);
  }
  _resolveNewbieShipTypeID(session) {
    return resolveNewbieShipTypeID(
      session,
      this._getCharacterRecord(session) || {},
    );
  }
  _repairShipAndFittedItems(session, shipItem) {
    repairShipAndFittedItemsForSession(session, shipItem);
  }
  _resolveItemAttributeContext(requestedItemID, session) {
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const tupleItemID = Array.isArray(requestedItemID) ? requestedItemID[0] : requestedItemID;
    const numericItemID =
      Number.parseInt(String(tupleItemID), 10) || this._getShipID(session);
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) =>
          skill.itemID === numericItemID ||
          skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;
    if (numericItemID === charID) {
      const attributes = this._buildCharacterAttributes(charData);
      return {
        itemID: charID,
        typeID: Number(charData.typeID || CHARACTER_TYPE_ID),
        attributes,
        baseAttributes: { ...attributes },
      };
    }
    if (skillRecord) {
      return {
        itemID: skillRecord.itemID,
        typeID: Number(skillRecord.typeID),
        attributes: {},
        baseAttributes: {},
      };
    }
    const inventoryContext = this._findInventoryItemContext(requestedItemID, session);
    if (inventoryContext) {
      return inventoryContext;
    }
    const controlledStructureShip = this._getControlledStructureShipMetadata(session);
    if (
      controlledStructureShip &&
      Number(controlledStructureShip.itemID) === numericItemID
    ) {
      const attributes = this._buildInventoryItemAttributes(
        controlledStructureShip,
        session,
      );
      return {
        itemID: controlledStructureShip.itemID,
        typeID: Number(controlledStructureShip.typeID),
        attributes,
        baseAttributes: { ...attributes },
      };
    }
    const shipRecord =
      findCharacterShip(charID, numericItemID) ||
      this._getActiveShipRecord(session) ||
      this._getShipMetadata(session);
    const attributes = this._buildShipAttributes(charData, shipRecord || {}, session);
    return {
      itemID: shipRecord && shipRecord.itemID ? shipRecord.itemID : numericItemID,
      typeID: Number(shipRecord && shipRecord.typeID),
      attributes,
      baseAttributes: this._buildShipBaseAttributes(shipRecord || {}),
    };
  }
  _formatDebugValue(value, fallback = "[n/a]") {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "True" : "False";
    }
    return String(value);
  }
  _buildEmptyDict() {
    return { type: "dict", entries: [] };
  }
  _buildEmptyList() {
    return { type: "list", items: [] };
  }
  _buildActivationState(charID, shipID, shipRecord = null, options = {}) {
    // The live 23.02 client build in use here still expects a 4-slot
    // shipState tuple during MakeShipActive on station boarding/login paths.
    // Keep the fourth slot as an empty reserved payload for compatibility.
    return [
      this._buildShipState(charID, shipID, shipRecord, options),
      options.includeCharges === false
        ? this._buildEmptyDict()
        : this._buildChargeStateDict(charID, shipID),
      this._buildEmptyDict(),
      this._buildEmptyDict(),
    ];
  }
  _getCharacterItemLocationID(session, options = {}) {
    const allowShipLocation = options.allowShipLocation !== false;
    if (
      !allowShipLocation ||
      (session && session._deferredDockedShipSessionChange)
    ) {
      return this._getLocationID(session);
    }
    return this._getShipID(session);
  }
  _buildCharacterInfoDict(charID, charData, locationID) {
    return {
      type: "dict",
      entries: this._buildCharacterInfoEntries(charID, charData, locationID),
    };
  }
  _buildCharacterInfoEntries(charID, charData, locationID) {
    return [
      [
        charID,
        this._buildCommonGetInfoEntry({
          itemID: charID,
          typeID: charData.typeID || CHARACTER_TYPE_ID,
          ownerID: charID,
          locationID,
          flagID: FLAG_PILOT,
          groupID: CHARACTER_GROUP_ID,
          categoryID: CHARACTER_CATEGORY_ID,
          quantity: -1,
          singleton: 1,
          stacksize: 1,
          description: "character",
          attributes: this._buildCharacterAttributeDict(charData),
        }),
      ],
    ];
  }
  _buildCharacterBrain() {
    // V23.02 treats the brain as a versioned tuple with at least two payload
    // collections. During login it rewrites this to (-1, ...) and later unpacks
    // it again in ApplyBrainEffects/RemoveBrainEffects. Empirically this client
    // unpacks four slots from the stored brain, so keep all collections present
    // even when they are empty.
    return [0, [], [], []];
  }
  _getDockedStructureRecord(session) {
    const structureID = Number(
      session && (session.structureid || session.structureID),
    ) || 0;
    if (structureID <= 0) {
      return null;
    }
    return worldData.getStructureByID(structureID) || null;
  }
  _buildStructureInfoDict(structure, session = null) {
    if (!structure) {
      return this._buildEmptyDict();
    }
    const itemType = resolveItemByTypeID(structure.typeID) || {};
    const structureItem = {
      itemID: Number(structure.structureID) || 0,
      typeID: Number(structure.typeID) || 0,
      ownerID: Number(structure.ownerCorpID || structure.ownerID) || 0,
      locationID: Number(structure.solarSystemID) || 0,
      flagID: 0,
      quantity: -1,
      singleton: 1,
      stacksize: 1,
      groupID: Number(itemType.groupID) || 0,
      categoryID: Number(itemType.categoryID) || 0,
      customInfo: String(structure.itemName || structure.name || ""),
    };
    return {
      type: "dict",
      entries: [[
        structureItem.itemID,
        this._buildCommonGetInfoEntry({
          itemID: structureItem.itemID,
          typeID: structureItem.typeID,
          ownerID: structureItem.ownerID,
          locationID: structureItem.locationID,
          flagID: structureItem.flagID,
          groupID: structureItem.groupID,
          categoryID: structureItem.categoryID,
          quantity: structureItem.quantity,
          singleton: structureItem.singleton,
          stacksize: structureItem.stacksize,
          customInfo: structureItem.customInfo,
          description: "structure",
          attributes: this._buildInventoryItemAttributeDict(
            structureItem,
            session,
          ),
          session,
        }),
      ]],
    };
  }
  _shouldDeferLoginShipFittingBootstrap(session) {
    const pendingReplay =
      session && session._pendingCommandShipFittingReplay
        ? session._pendingCommandShipFittingReplay
        : null;
    return Boolean(
      session &&
      !isDockedSession(session) &&
      pendingReplay &&
      pendingReplay.deferDogmaShipFittingBootstrap === true,
    );
  }
  _shouldDeferLoginShipChargeBootstrap(session) {
    return Boolean(
      session &&
      !isDockedSession(session) &&
      session._space &&
      session._space.loginInventoryBootstrapPending === true &&
      session._space.loginChargeDogmaReplayPending === true,
    );
  }
  _shouldPrimeLoginShipInfoChargeSublocations(session) {
    // CCP login already seeds loaded charges through shipState /
    // instanceFlagQuantityCache during MakeShipActive. Feeding tuple charge
    // rows through GetAllInfo.shipInfo during session change makes the client
    // explode inside godma.ProcessAllInfo -> PrimeLocation -> UpdateItem
    // ("sequence is too short"), which then leaves invByID unset and the HUD
    // never recovers. Keep login tuple charges out of shipInfo; the later
    // in-space attach replay handles any runtime repair after inventory/HUD
    // bootstrap.
    void session;
    return false;
  }
  _shouldIncludeLoginShipInfoLoadedCharges(session) {
    // CCP login primes the ship first through GetAllInfo/PrimeLocation and only
    // later calls LoadItemsInLocation(shipID). Keeping the real loaded charge
    // rows in the initial shipInfo payload gives OnCharacterEmbarkation the
    // same fitted module+charge picture before the follow-up inventory list,
    // while still avoiding the tuple charge rows that break ProcessAllInfo.
    return Boolean(
      session &&
        !isDockedSession(session) &&
        session._space &&
        session._space.loginChargeHydrationProfile === "login",
    );
  }
  _buildShipState(charID, shipID, shipRecord = null, options = {}) {
    const shipCondition = getShipConditionState(shipRecord);
    const fittedItems =
      options.includeFittedItems === false
        ? []
        : getFittedModuleItems(charID, shipID);
    return {
      type: "dict",
      entries: [
        [
          shipID,
          this._buildPackedInstanceRow({
            itemID: shipID,
            damage: shipCondition.damage,
            charge: shipCondition.charge,
            armorDamage: shipCondition.armorDamage,
            shieldCharge: shipCondition.shieldCharge,
            incapacitated: shipCondition.incapacitated,
          }),
        ],
        [
          charID,
          this._buildPackedInstanceRow({
            itemID: charID,
            online: true,
            skillPoints: getCharacterSkillPointTotal(charID) || 0,
          }),
        ],
        ...fittedItems.map((item) => [
          item.itemID,
          this._buildPackedInstanceRow(buildModuleStatusSnapshot(item)),
        ]),
      ],
    };
  }
  Handle_GetCharacterAttributes(args, session) {
    log.debug("[DogmaIM] GetCharacterAttributes");
    return this._buildCharacterAttributeDict(this._getCharacterRecord(session) || {});
  }
  Handle_ChangeDroneSettings(args, session) {
    const rawDroneSettingChanges = args && args.length > 0 ? args[0] : null;
    const droneSettingChanges = this._normalizeDroneSettingChanges(
      rawDroneSettingChanges,
    );
    const nextDroneSettings = this._persistDroneSettingChanges(
      session,
      droneSettingChanges,
    );
    if (session && typeof session === "object") {
      session.droneSettings = {
        ...nextDroneSettings,
      };
    }
    log.debug(
      `[DogmaService] ChangeDroneSettings char=${this._getCharID(session)} keys=${Object.keys(droneSettingChanges).join(",")}`,
    );
    return buildDict(
      Object.entries(nextDroneSettings).map(([attributeID, value]) => [
        Number(attributeID) || 0,
        Boolean(value),
      ]),
    );
  }
  Handle_GetDroneSettingAttributes(args, session) {
    void args;
    return this._buildDroneSettingAttributesPayload(session);
  }
  _extractRequestedItemIDs(rawValue) {
    const unwrapped = unwrapMarshalValue(rawValue);
    const values = Array.isArray(unwrapped) ? unwrapped : extractList(rawValue);
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value) || 0)
        .filter((itemID) => itemID > 0),
    )];
  }
  _buildItemLayerDamageValues(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const categoryID = Number(item.categoryID) || 0;
    const rawConditionState =
      item.conditionState && typeof item.conditionState === "object"
        ? item.conditionState
        : null;
    const conditionState = rawConditionState
      ? normalizeShipConditionState(rawConditionState)
      : (
        categoryID === SHIP_CATEGORY_ID || categoryID === DRONE_CATEGORY_ID
          ? normalizeShipConditionState({})
          : {
              damage: clampRatio(item && item.moduleState && item.moduleState.damage, 0),
              charge: clampRatio(item && item.moduleState && item.moduleState.charge, 0),
              armorDamage: clampRatio(
                item && item.moduleState && item.moduleState.armorDamage,
                0,
              ),
              shieldCharge: clampRatio(
                item && item.moduleState && item.moduleState.shieldCharge,
                1,
              ),
              incapacitated: Boolean(
                item && item.moduleState && item.moduleState.incapacitated,
              ),
            }
      );
    const shieldCapacity = Number(
      getTypeAttributeValue(item.typeID, "shieldCapacity"),
    ) || 0;
    const shieldRechargeRate = Number(
      getTypeAttributeValue(item.typeID, "shieldRechargeRate"),
    ) || 0;
    const armorHP = Number(getTypeAttributeValue(item.typeID, "armorHP")) || 0;
    const structureHP = Number(
      getTypeAttributeValue(item.typeID, "hp", "structureHP"),
    ) || 0;
    const shieldRatio =
      shieldCapacity > 0 ? clampRatio(conditionState.shieldCharge, 1) : 0;
    const armorRatio =
      armorHP > 0 ? clampRatio(1 - clampRatio(conditionState.armorDamage, 0), 1) : 0;
    const hullRatio =
      structureHP > 0 ? clampRatio(1 - clampRatio(conditionState.damage, 0), 1) : 0;
    const currentShield = shieldCapacity > 0 ? shieldCapacity * shieldRatio : 0;
    const armorDamageAmount =
      armorHP > 0 ? armorHP * clampRatio(conditionState.armorDamage, 0) : 0;
    const hullDamageAmount =
      structureHP > 0 ? structureHP * clampRatio(conditionState.damage, 0) : 0;
    const currentArmor = armorHP > 0 ? armorHP - armorDamageAmount : 0;
    const currentHull = structureHP > 0 ? structureHP - hullDamageAmount : 0;
    return buildKeyVal([
      [
        "shieldInfo",
        shieldCapacity > 0
          ? buildList([
              buildMarshalReal(currentShield, currentShield),
              buildMarshalReal(shieldCapacity, shieldCapacity),
              buildMarshalReal(Math.max(0, shieldRechargeRate), 0),
            ])
          : buildMarshalReal(0, 0),
      ],
      // Drone bay damage parity: the client reads armorInfo/hullInfo as max
      // layer values and armorDamage/hullDamage as absolute damage amounts.
      ["armorInfo", buildMarshalReal(armorHP, armorHP)],
      ["hullInfo", buildMarshalReal(structureHP, structureHP)],
      ["armorDamage", buildMarshalReal(armorDamageAmount, armorDamageAmount)],
      ["hullDamage", buildMarshalReal(hullDamageAmount, hullDamageAmount)],
      ["shieldRatio", buildMarshalReal(shieldRatio, shieldRatio)],
      ["armorRatio", buildMarshalReal(armorRatio, armorRatio)],
      ["hullRatio", buildMarshalReal(hullRatio, hullRatio)],
      ["armorMax", buildMarshalReal(armorHP, armorHP)],
      ["hullMax", buildMarshalReal(structureHP, structureHP)],
    ]);
  }
  Handle_GetLayerDamageValuesByItems(args, session) {
    const requestedItemIDs = this._extractRequestedItemIDs(args && args[0]);
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    const entries = [];
    for (const itemID of requestedItemIDs) {
      const item = findItemById(itemID);
      if (!item) {
        continue;
      }
      const ownerID = Number(item.ownerID) || 0;
      const locationID = Number(item.locationID) || 0;
      if (
        charID > 0 &&
        ownerID > 0 &&
        ownerID !== charID &&
        locationID !== shipID
      ) {
        continue;
      }
      const layerDamageValues = this._buildItemLayerDamageValues(item);
      if (!layerDamageValues) {
        continue;
      }
      entries.push([itemID, layerDamageValues]);
    }
    return buildDict(entries);
  }
  Handle_ShipOnlineModules(args, session) {
    log.debug("[DogmaIM] ShipOnlineModules");
    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    // CCP parity: modules without explicit moduleState are treated as online
    // (fitted before auto-online migration).
    return {
      type: "list",
      items: getFittedModuleItems(charID, shipID)
        .filter((item) =>
          isModuleOnline(item) ||
          item.moduleState === undefined ||
          item.moduleState === null,
        )
        .map((item) => item.itemID),
    };
  }
  _buildTargetIDList(targetIDs = []) {
    return {
      type: "list",
      items: (Array.isArray(targetIDs) ? targetIDs : [])
        .map((targetID) => Number(targetID) || 0)
        .filter((targetID) => targetID > 0),
    };
  }
  _throwTargetingUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "TARGET_SELF":
        throwWrappedUserError("DeniedTargetSelf");
        break;
      case "SOURCE_WARPING":
        throwWrappedUserError("DeniedTargetSelfWarping");
        break;
      case "TARGET_WARPING":
        throwWrappedUserError("DeniedTargetOtherWarping");
        break;
      case "TARGET_OUT_OF_RANGE":
        throwWrappedUserError("TargetTooFar");
        break;
      case "TARGET_NOT_FOUND":
        throwWrappedUserError("TargetingAttemptCancelled");
        break;
      default:
        throwWrappedUserError("DeniedTargetAttemptFailed");
        break;
    }
  }
  Handle_AddTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] AddTarget targetID=${targetID}`);
    const result = spaceRuntime.addTarget(session, targetID);
    if (!result || !result.success) {
      this._throwTargetingUserError(result && result.errorMsg);
    }
    return [
      result.data && result.data.pending ? 1 : 0,
      this._buildTargetIDList(
        (result.data && result.data.targets) || spaceRuntime.getTargets(session),
      ),
    ];
  }
  Handle_CancelAddTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] CancelAddTarget targetID=${targetID}`);
    spaceRuntime.cancelAddTarget(session, targetID, {
      notifySelf: false,
    });
    return null;
  }
  Handle_RemoveTarget(args, session) {
    const targetID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[DogmaIM] RemoveTarget targetID=${targetID}`);
    spaceRuntime.removeTarget(session, targetID, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_RemoveTargets(args, session) {
    const rawTargetIDs = args && args.length > 0 ? args[0] : [];
    const targetIDs = extractList(rawTargetIDs)
      .map((targetID) => Number(targetID) || 0)
      .filter((targetID) => targetID > 0);
    log.debug(`[DogmaIM] RemoveTargets count=${targetIDs.length}`);
    spaceRuntime.removeTargets(session, targetIDs, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_ClearTargets(args, session) {
    log.debug("[DogmaIM] ClearTargets");
    spaceRuntime.clearTargets(session, {
      notifySelf: true,
      notifyTarget: true,
    });
    return null;
  }
  Handle_GetTargets(args, session) {
    log.debug("[DogmaIM] GetTargets");
    return this._buildTargetIDList(spaceRuntime.getTargets(session));
  }
  Handle_GetTargeters(args, session) {
    log.debug("[DogmaIM] GetTargeters");
    return this._buildTargetIDList(spaceRuntime.getTargeters(session));
  }
  _setModuleOnlineState(shipID, moduleID, online, session) {
    const charID = this._getCharID(session);
    const numericShipID = Number(shipID) || this._getShipID(session);
    const numericModuleID = Number(moduleID) || 0;
    const moduleItem = findItemById(numericModuleID);
    if (
      !moduleItem ||
      Number(moduleItem.ownerID) !== charID ||
      Number(moduleItem.locationID) !== numericShipID
    ) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const previousState = getItemModuleState(moduleItem);
    const inSpace = Boolean(session && session._space);
    if (online && !previousState.online) {
      const shipRecord =
        findCharacterShip(charID, numericShipID) ||
        this._getActiveShipRecord(session) ||
        null;
      const fittedItems = listFittedItems(charID, numericShipID);
      const resourceState = buildShipResourceState(charID, shipRecord || {
        itemID: numericShipID,
        typeID: this._getShipTypeID(session),
      }, {
        fittedItems,
      });
      const moduleCpuLoad = Number(
        getTypeAttributeValue(moduleItem.typeID, "cpuLoad", "cpu"),
      ) || 0;
      const modulePowerLoad = Number(
        getTypeAttributeValue(moduleItem.typeID, "powerLoad", "power"),
      ) || 0;
      if (resourceState.cpuLoad + moduleCpuLoad > resourceState.cpuOutput + 1e-6) {
        return {
          success: false,
          errorMsg: "NOT_ENOUGH_CPU",
        };
      }
      if (resourceState.powerLoad + modulePowerLoad > resourceState.powerOutput + 1e-6) {
        return {
          success: false,
          errorMsg: "NOT_ENOUGH_POWER",
        };
      }
      if (inSpace) {
        const capacitorState = spaceRuntime.getShipCapacitorState(session);
        if (
          !capacitorState ||
          !Number.isFinite(Number(capacitorState.ratio)) ||
          Number(capacitorState.ratio) < (ONLINE_CAPACITOR_CHARGE_RATIO / 100)
        ) {
          return {
            success: false,
            errorMsg: "NOT_ENOUGH_CAPACITOR",
          };
        }
      }
    }
    if (!online && inSpace) {
      const activeEffect = spaceRuntime.getActiveModuleEffect(session, numericModuleID);
      if (activeEffect) {
        if (activeEffect.isGeneric) {
          spaceRuntime.deactivateGenericModule(session, numericModuleID, {
            reason: "offline",
            deferUntilCycle: false,
          });
        } else {
          spaceRuntime.deactivatePropulsionModule(session, numericModuleID, {
            reason: "offline",
          });
        }
      }
    }
    const updateResult = updateInventoryItem(numericModuleID, (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: Boolean(online),
      },
    }));
    if (!updateResult.success) {
      return updateResult;
    }
    const isOnlineAttributeID = getAttributeIDByNames("isOnline");
    if (isOnlineAttributeID) {
      this._notifyModuleAttributeChanges(session, [[
        "OnModuleAttributeChanges",
        charID,
        numericModuleID,
        isOnlineAttributeID,
        this._sessionFileTime(session),
        online ? 1 : 0,
        previousState.online ? 1 : 0,
        null,
      ]]);
    }
    syncModuleOnlineEffectForSession(session, updateResult.data, {
      active: Boolean(online),
    });
    log.debug(
      `[DogmaIM] SetModuleOnlineState applied shipID=${numericShipID} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(updateResult.data))} ` +
      `previousOnline=${previousState.online === true} nextOnline=${Boolean(online)} ` +
      `inSpace=${inSpace}`,
    );
    if (inSpace) {
      if (online && !previousState.online) {
        spaceRuntime.setShipCapacitorRatio(
          session,
          ONLINE_CAPACITOR_REMAINDER_RATIO / 100,
        );
      }
      spaceRuntime.refreshShipDerivedState(session, {
        broadcast: true,
      });
    }
    return {
      success: true,
      data: updateResult.data,
    };
  }
  _resolveUnloadDestination(destination, session, shipID) {
    const numericShipID = Number(shipID) || this._getShipID(session);
    const destinationValues = extractSequenceValues(destination);
    if (destinationValues.length > 0) {
      const locationID = Number(destinationValues[0]) || 0;
      const flagID = Number(destinationValues[2]) || ITEM_FLAGS.HANGAR;
      return {
        locationID,
        flagID,
      };
    }
    const numericDestination = Number(destination) || 0;
    if (numericDestination === numericShipID) {
      return {
        locationID: numericShipID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
      };
    }
    return {
      locationID: numericDestination || this._getLocationID(session),
      flagID: ITEM_FLAGS.HANGAR,
    };
  }
  _normalizeEffectName(rawEffectName) {
    if (typeof rawEffectName === "string") {
      return rawEffectName;
    }
    if (Buffer.isBuffer(rawEffectName)) {
      return rawEffectName.toString("utf8");
    }
    if (rawEffectName === undefined || rawEffectName === null) {
      return "";
    }
    return String(rawEffectName);
  }
  _normalizeActivationEffectName(rawEffectName) {
    const normalized = this._normalizeEffectName(rawEffectName).trim().toLowerCase();
    switch (normalized) {
      case "online":
        return "online";
      case "modulebonusafterburner":
      case "effectmodulebonusafterburner":
      case "effects.afterburner":
      case "dogmaxp.afterburner":
      case "afterburner":
        return "moduleBonusAfterburner";
      case "modulebonusmicrowarpdrive":
      case "effectmodulebonusmicrowarpdrive":
      case "effects.microwarpdrive":
      case "dogmaxp.microwarpdrive":
      case "microwarpdrive":
      case "mwd":
        return "moduleBonusMicrowarpdrive";
      default:
        return normalized;
    }
  }
  _resolveAmmoSourceStacks(charID, ammoLocationID, sourceFlagID, chargeTypeID, chargeRequests = []) {
    const explicitItemIDs = new Set(
      chargeRequests
        .map((request) => Number(request && request.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    const requestedTypeIDs = new Set(
      chargeRequests
        .map((request) => Number(request && request.typeID) || 0)
        .filter((typeID) => typeID > 0),
    );
    const normalizedChargeTypeID = Number(chargeTypeID) || 0;
    const locationItems = listContainerItems(charID, ammoLocationID, sourceFlagID)
      .filter((item) => Number(item.typeID) === normalizedChargeTypeID)
      .filter((item) => (Number(item.stacksize || item.quantity || 0) || 0) > 0);
    if (explicitItemIDs.size > 0) {
      return locationItems
        .filter((item) => explicitItemIDs.has(Number(item.itemID) || 0))
        .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
    }
    if (requestedTypeIDs.size > 0 && !requestedTypeIDs.has(normalizedChargeTypeID)) {
      return [];
    }
    return locationItems.sort(
      (left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0),
    );
  }
  _resolveRequestedAmmoTypeID(charID, ammoLocationID, sourceFlagID, chargeRequests = []) {
    for (const request of chargeRequests) {
      const itemID = Number(request && request.itemID) || 0;
      if (itemID <= 0) {
        continue;
      }
      const candidate = findItemById(itemID);
      if (
        candidate &&
        Number(candidate.ownerID) === charID &&
        Number(candidate.locationID) === ammoLocationID &&
        Number(candidate.flagID) === sourceFlagID
      ) {
        return Number(candidate.typeID) || 0;
      }
    }
    for (const request of chargeRequests) {
      const typeID = Number(request && request.typeID) || 0;
      if (typeID > 0) {
        return typeID;
      }
    }
    return 0;
  }
  _resolvePendingReloadSourceStacks(
    charID,
    ammoLocationID,
    sourceFlagID,
    chargeTypeID,
    sourceItemIDs = [],
  ) {
    const explicitItemIDs = new Set(normalizeReloadSourceItemIDs(sourceItemIDs));
    return listContainerItems(charID, ammoLocationID, sourceFlagID)
      .filter((item) => Number(item.typeID) === Number(chargeTypeID))
      .filter((item) => (Number(item.stacksize || item.quantity || 0) || 0) > 0)
      .filter((item) => explicitItemIDs.size === 0 || explicitItemIDs.has(Number(item.itemID) || 0))
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
  }
  _queuePendingModuleReload(session, moduleItem, options = {}) {
    const numericModuleID = Number(moduleItem && moduleItem.itemID) || 0;
    if (numericModuleID <= 0) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const reloadTimeMs = Math.max(
      0,
      Math.round(
        Number(options.reloadTimeMs) || this._getModuleReloadTimeMs(moduleItem),
      ),
    );
    if (reloadTimeMs <= 0) {
      return {
        success: false,
        errorMsg: "NO_RELOAD_TIME",
      };
    }
    const existingReload = this._getPendingModuleReload(numericModuleID);
    if (existingReload) {
      return {
        success: true,
        data: {
          reloadState: existingReload,
          alreadyPending: true,
        },
      };
    }
    const startedAtMs = getSessionSimulationTimeMs(session, Date.now());
    const completeAtMs = startedAtMs + reloadTimeMs;
    const reloadState = {
      action: String(options.action || "load"),
      moduleID: numericModuleID,
      moduleFlagID: Number(moduleItem.flagID) || 0,
      moduleTypeID: Number(moduleItem.typeID) || 0,
      shipID: Number(options.shipID) || Number(moduleItem.locationID) || 0,
      charID: this._getCharID(session),
      chargeTypeID: Number(options.chargeTypeID) || 0,
      ammoLocationID: Number(options.ammoLocationID) || 0,
      sourceFlagID: Number(options.sourceFlagID) || ITEM_FLAGS.CARGO_HOLD,
      sourceItemIDs: normalizeReloadSourceItemIDs(options.sourceItemIDs),
      destinationLocationID: Number(options.destinationLocationID) || 0,
      destinationFlagID: Number(options.destinationFlagID) || 0,
      quantity:
        options.quantity === undefined || options.quantity === null
          ? null
          : Math.max(1, Number(options.quantity) || 0),
      reloadTimeMs,
      startedAtMs,
      completeAtMs,
      systemID: Number(session && session._space && session._space.systemID) || 0,
      session,
    };
    pendingModuleReloads.set(numericModuleID, reloadState);
    schedulePendingModuleReloadPump();
    const nextActivationTime = toFileTimeFromMs(completeAtMs, 0n);
    this._notifyModuleNextActivationTime(session, numericModuleID, nextActivationTime, 0n);
    if (reloadState.chargeTypeID > 0) {
      this._notifyChargeBeingLoadedToModule(
        session,
        [numericModuleID],
        reloadState.chargeTypeID,
        reloadTimeMs,
      );
    }
    return {
      success: true,
      data: {
        reloadState,
      },
    };
  }
  queueAutomaticModuleReload(session, moduleItem, options = {}) {
    const normalizedModuleItem = moduleItem || null;
    const numericModuleID = Number(normalizedModuleItem && normalizedModuleItem.itemID) || 0;
    if (numericModuleID <= 0) {
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const shipID =
      Number(options.shipID) ||
      Number(normalizedModuleItem.locationID) ||
      this._getShipID(session);
    const charID = this._getCharID(session);
    if (shipID <= 0 || charID <= 0) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }
    const chargeTypeID = Number(options.chargeTypeID) || 0;
    if (chargeTypeID <= 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    if (!isChargeCompatibleWithModule(normalizedModuleItem.typeID, chargeTypeID)) {
      return {
        success: false,
        errorMsg: "INCOMPATIBLE_AMMO",
      };
    }
    const ammoLocationID = Number(options.ammoLocationID) || shipID;
    const sourceFlagID = Number(options.sourceFlagID) || ITEM_FLAGS.CARGO_HOLD;
    const sourceStacks = this._resolvePendingReloadSourceStacks(
      charID,
      ammoLocationID,
      sourceFlagID,
      chargeTypeID,
      options.sourceItemIDs,
    );
    if (sourceStacks.length === 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    const requestedQuantity =
      options.quantity === undefined || options.quantity === null
        ? getModuleChargeCapacity(normalizedModuleItem.typeID, chargeTypeID)
        : Math.max(1, Number(options.quantity) || 0);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      return {
        success: false,
        errorMsg: "NO_AMMO",
      };
    }
    return this._queuePendingModuleReload(session, normalizedModuleItem, {
      action: "load",
      shipID,
      chargeTypeID,
      ammoLocationID,
      sourceFlagID,
      sourceItemIDs: sourceStacks.map((item) => item.itemID),
      reloadTimeMs:
        Number(options.reloadTimeMs) || this._getModuleReloadTimeMs(normalizedModuleItem),
      quantity: requestedQuantity,
    });
  }
  _completePendingModuleReload(
    reloadState,
    nowMs = getReloadStateCurrentTimeMs(reloadState, Date.now()),
  ) {
    if (!reloadState) {
      return {
        success: false,
        errorMsg: "RELOAD_NOT_FOUND",
      };
    }
    const numericModuleID = Number(reloadState.moduleID) || 0;
    if (numericModuleID > 0) {
      pendingModuleReloads.delete(numericModuleID);
    }
    schedulePendingModuleReloadPump();
    const session =
      reloadState.session &&
      reloadState.session.socket &&
      !reloadState.session.socket.destroyed
        ? reloadState.session
        : reloadState.session || null;
    const moduleItem = findItemById(numericModuleID);
    const charID = Number(reloadState.charID) || 0;
    const shipID = Number(reloadState.shipID) || 0;
    const moduleFlagID = Number(reloadState.moduleFlagID) || 0;
    const previousNextActivationTime = toFileTimeFromMs(
      Number(reloadState.completeAtMs) || nowMs,
      0n,
    );
    if (
      !moduleItem ||
      Number(moduleItem.ownerID) !== charID ||
      Number(moduleItem.locationID) !== shipID ||
      Number(moduleItem.flagID) !== moduleFlagID
    ) {
      this._notifyModuleNextActivationTime(session, numericModuleID, 0n, previousNextActivationTime);
      return {
        success: false,
        errorMsg: "MODULE_NOT_FOUND",
      };
    }
    const previousChargeState = this._captureChargeStateSnapshot(
      charID,
      shipID,
      moduleFlagID,
    );
    const previousChargeItem = this._captureChargeItemSnapshot(
      charID,
      shipID,
      moduleFlagID,
    );
    try {
      if (reloadState.action === "load") {
        let existingCharge = getLoadedChargeByFlag(charID, shipID, moduleFlagID);
        let activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
        const chargeTypeID = Number(reloadState.chargeTypeID) || 0;
        if (
          chargeTypeID > 0 &&
          isChargeCompatibleWithModule(moduleItem.typeID, chargeTypeID)
        ) {
          const sourceStacks = this._resolvePendingReloadSourceStacks(
            charID,
            reloadState.ammoLocationID,
            reloadState.sourceFlagID,
            chargeTypeID,
            reloadState.sourceItemIDs,
          );
          if (
            sourceStacks.length > 0 ||
            (existingCharge && activeChargeTypeID === chargeTypeID)
          ) {
            if (existingCharge && activeChargeTypeID !== chargeTypeID) {
              const unloadResult = this._moveLoadedChargeToDestination(
                existingCharge,
                reloadState.ammoLocationID,
                reloadState.sourceFlagID,
              );
              if (unloadResult.success) {
                this._syncInventoryChanges(session, unloadResult.data.changes);
              }
              existingCharge = null;
              activeChargeTypeID = 0;
            }
            const moduleCapacity = getModuleChargeCapacity(moduleItem.typeID, chargeTypeID);
            const existingQuantity = existingCharge
              ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
              : 0;
            let neededQuantity = Math.max(0, moduleCapacity - existingQuantity);
            for (const sourceCharge of sourceStacks) {
              if (neededQuantity <= 0) {
                break;
              }
              const chargeItem = findItemById(sourceCharge.itemID);
              if (
                !chargeItem ||
                Number(chargeItem.ownerID) !== charID ||
                Number(chargeItem.locationID) !== Number(reloadState.ammoLocationID) ||
                Number(chargeItem.flagID) !== Number(reloadState.sourceFlagID) ||
                Number(chargeItem.typeID) !== chargeTypeID
              ) {
                continue;
              }
              const availableQuantity = Number(chargeItem.stacksize || chargeItem.quantity || 0) || 0;
              if (availableQuantity <= 0) {
                continue;
              }
              const moveQuantity = Math.min(neededQuantity, availableQuantity);
              const moveResult =
                existingCharge && activeChargeTypeID === chargeTypeID
                  ? mergeItemStacks(
                    chargeItem.itemID,
                    existingCharge.itemID,
                    moveQuantity,
                  )
                  : moveItemToLocation(
                    chargeItem.itemID,
                    shipID,
                    moduleFlagID,
                    moveQuantity,
                  );
              if (!moveResult.success) {
                continue;
              }
              this._syncInventoryChanges(session, moveResult.data.changes);
              neededQuantity -= moveQuantity;
              if (existingCharge && activeChargeTypeID === chargeTypeID) {
                existingCharge = findItemById(existingCharge.itemID) || existingCharge;
              } else if (!existingCharge) {
                existingCharge = getLoadedChargeByFlag(charID, shipID, moduleFlagID);
                activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
              }
            }
          }
        }
      }
    } finally {
      const nextChargeState = this._captureChargeStateSnapshot(
        charID,
        shipID,
        moduleFlagID,
      );
      this._notifyChargeQuantityTransition(
        session,
        charID,
        shipID,
        moduleFlagID,
        previousChargeState,
        nextChargeState,
        {
          forceTupleRepair: reloadState.action === "load",
        },
      );
      this._notifyWeaponModuleAttributeTransition(
        session,
        moduleItem,
        previousChargeItem,
        this._captureChargeItemSnapshot(charID, shipID, moduleFlagID),
      );
      this._notifyModuleNextActivationTime(
        session,
        numericModuleID,
        0n,
        previousNextActivationTime,
      );
    }
    return {
      success: true,
      data: {
        moduleID: numericModuleID,
      },
    };
  }
  Handle_Activate(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectName = this._normalizeActivationEffectName(
      args && args.length > 1 ? args[1] : "",
    );
    const targetID = args && args.length > 2 ? args[2] : null;
    const repeat = args && args.length > 3 ? args[3] : null;
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] Activate(itemID=${itemID}, effect=${effectName}, target=${String(targetID)}, repeat=${String(repeat)}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    if (effectName === "online") {
      const shipID = Number(item && item.locationID) || this._getShipID(session);
      const result = this._setModuleOnlineState(shipID, itemID, true, session);
      if (!result.success) {
        log.warn(
          `[DogmaIM] Activate online rejected itemID=${itemID} shipID=${shipID} error=${result.errorMsg}`,
        );
        return null;
      }
      return 1;
    }
    if (!item || !isModuleOnline(item)) {
      log.warn(
        `[DogmaIM] Activate rejected itemID=${itemID} effect=${effectName} error=MODULE_NOT_ONLINE`,
      );
      return null;
    }
    // Propulsion modules (AB/MWD) use the dedicated propulsion path which
    // applies speed/mass bonuses.  All other activatable modules use the
    // generic path that provides cycle timing for the HUD radial ring.
    const isPropulsion =
      effectName === "moduleBonusAfterburner" ||
      effectName === "moduleBonusMicrowarpdrive";
    const result = isPropulsion
      ? spaceRuntime.activatePropulsionModule(session, item, effectName, {
          targetID,
          repeat,
        })
      : spaceRuntime.activateGenericModule(session, item, effectName, {
          targetID,
          repeat,
        });
    if (!result.success) {
      log.warn(
        `[DogmaIM] Activate rejected itemID=${itemID} effect=${effectName} error=${result.errorMsg}`,
      );
      return null;
    }
    log.debug(
      `[DogmaIM] Activate accepted itemID=${itemID} effect=${effectName} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} ` +
      `runtime=${JSON.stringify(
        summarizeRuntimeEffectForLog(
          session && session._space
            ? spaceRuntime.getActiveModuleEffect(session, itemID)
            : null,
        ),
      )}`,
    );
    return 1;
  }
  Handle_Deactivate(args, session) {
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const effectName = this._normalizeActivationEffectName(
      args && args.length > 1 ? args[1] : "",
    );
    const item = findItemById(itemID);
    log.debug(
      `[DogmaIM] Deactivate(itemID=${itemID}, effect=${effectName}) ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} inSpace=${Boolean(session && session._space)}`,
    );
    if (effectName === "online") {
      const item = findItemById(itemID);
      const shipID = Number(item && item.locationID) || this._getShipID(session);
      const result = this._setModuleOnlineState(shipID, itemID, false, session);
      if (!result.success) {
        log.warn(
          `[DogmaIM] Deactivate online rejected itemID=${itemID} shipID=${shipID} error=${result.errorMsg}`,
        );
        return null;
      }
      return 1;
    }
    const isPropulsion =
      effectName === "moduleBonusAfterburner" ||
      effectName === "moduleBonusMicrowarpdrive";
    const result = isPropulsion
      ? spaceRuntime.deactivatePropulsionModule(session, itemID, {
          reason: "manual",
        })
      : spaceRuntime.deactivateGenericModule(session, itemID, {
          reason: "manual",
        });
    if (!result.success) {
      log.warn(
        `[DogmaIM] Deactivate rejected itemID=${itemID} effect=${effectName} error=${result.errorMsg}`,
      );
      return null;
    }
    log.debug(
      `[DogmaIM] Deactivate accepted itemID=${itemID} effect=${effectName} ` +
      `module=${JSON.stringify(summarizeModuleItemForLog(item))} ` +
      `runtime=${JSON.stringify(
        summarizeRuntimeEffectForLog(
          session && session._space
            ? spaceRuntime.getActiveModuleEffect(session, itemID)
            : null,
        ),
      )}`,
    );
    return 1;
  }
  Handle_SetModuleOnline(args, session) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const moduleID = args && args.length > 1 ? args[1] : null;
    log.debug(`[DogmaIM] SetModuleOnline(shipID=${shipID}, moduleID=${moduleID})`);
    const result = this._setModuleOnlineState(shipID, moduleID, true, session);
    if (!result.success) {
      log.warn(`[DogmaIM] SetModuleOnline rejected moduleID=${moduleID} error=${result.errorMsg}`);
    }
    return null;
  }
  Handle_TakeModuleOffline(args, session) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const moduleID = args && args.length > 1 ? args[1] : null;
    log.debug(`[DogmaIM] TakeModuleOffline(shipID=${shipID}, moduleID=${moduleID})`);
    return this._setModuleOnlineState(shipID, moduleID, false, session).success
      ? null
      : null;
  }
  Handle_CreateNewbieShip(args, session) {
    const requestedShipID =
      args && args.length > 0 ? Number(args[0]) || 0 : this._getShipID(session);
    const requestedLocationID =
      args && args.length > 1 ? Number(args[1]) || 0 : this._getLocationID(session);
    const stationID = getDockedLocationID(session) || 0;
    log.info(
      `[DogmaIM] CreateNewbieShip(shipID=${requestedShipID}, locationID=${requestedLocationID})`,
    );
    if (!session || !session.characterID || !stationID) {
      throwWrappedUserError("MustBeDocked");
    }
    const boardResult = boardNewbieShipForSession(session, {
      emitNotifications: true,
      logSelection: false,
      repairExistingShip: true,
      logLabel: "CreateNewbieShip",
    });
    if (!boardResult.success) {
      if (boardResult.errorMsg === "DOCK_REQUIRED") {
        throwWrappedUserError("MustBeDocked");
      }
      if (boardResult.errorMsg === "ALREADY_IN_NEWBIE_SHIP") {
        throwWrappedUserError("AlreadyInNewbieShip");
      }
      throwWrappedUserError("ErrorCreatingNewbieShip");
    }
    return null;
  }
  Handle_LoadAmmo(args, session) {
    const shipID = args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const rawModuleIDs = args && args.length > 1 ? args[1] : [];
    const rawChargeItemIDs = args && args.length > 2 ? args[2] : [];
    const ammoLocationID = args && args.length > 3 ? Number(args[3]) || shipID : shipID;
    const charID = this._getCharID(session);
    const moduleIDs = extractList(rawModuleIDs).length > 0
      ? extractList(rawModuleIDs)
      : (Array.isArray(rawModuleIDs) ? rawModuleIDs : [rawModuleIDs]);
    const chargeRequests = normalizeAmmoLoadRequests(rawChargeItemIDs);
    log.info(
      `[DogmaIM] LoadAmmo(shipID=${shipID}, modules=[${moduleIDs}], charges=[${summarizeAmmoLoadRequests(chargeRequests)}], ammoLocationID=${ammoLocationID})`,
    );
    const sourceFlagID = ammoLocationID === shipID ? ITEM_FLAGS.CARGO_HOLD : ITEM_FLAGS.HANGAR;
    for (const moduleID of moduleIDs.map((value) => Number(value) || 0).filter((value) => value > 0)) {
      const moduleItem = findItemById(moduleID);
      if (
        !moduleItem ||
        Number(moduleItem.ownerID) !== charID ||
        Number(moduleItem.locationID) !== shipID
      ) {
        log.warn(
          `[DogmaIM] LoadAmmo: module ${moduleID} not found or not owned (owner=${moduleItem && moduleItem.ownerID}, loc=${moduleItem && moduleItem.locationID}, charID=${charID}, shipID=${shipID})`,
        );
        continue;
      }
      const previousChargeState = this._captureChargeStateSnapshot(
        charID,
        shipID,
        moduleItem.flagID,
      );
      const previousChargeItem = this._captureChargeItemSnapshot(
        charID,
        shipID,
        moduleItem.flagID,
      );
      try {
        let existingCharge = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
        let activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
        const requestedChargeTypeID = this._resolveRequestedAmmoTypeID(
          charID,
          ammoLocationID,
          sourceFlagID,
          chargeRequests,
        );
        if (requestedChargeTypeID <= 0) {
          log.warn(
            `[DogmaIM] LoadAmmo: no valid charge found for module ${moduleID} (flag=${moduleItem.flagID}) in location ${ammoLocationID} requests=[${summarizeAmmoLoadRequests(chargeRequests)}]`,
          );
          continue;
        }
        const chargeTypeID = requestedChargeTypeID;
        if (!isChargeCompatibleWithModule(moduleItem.typeID, chargeTypeID)) {
          log.warn(
            `[DogmaIM] LoadAmmo: incompatible charge typeID=${chargeTypeID} for module ${moduleID} typeID=${moduleItem.typeID}`,
          );
          continue;
        }
        const moduleCapacity = getModuleChargeCapacity(moduleItem.typeID, chargeTypeID);
        const existingQuantity = existingCharge
          ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
          : 0;
        const resolvedChargeSources = this._resolveAmmoSourceStacks(
          charID,
          ammoLocationID,
          sourceFlagID,
          chargeTypeID,
          chargeRequests,
        );
        if (
          session &&
          session._space &&
          this._getModuleReloadTimeMs(moduleItem) > 0
        ) {
          if (
            existingCharge &&
            activeChargeTypeID === chargeTypeID &&
            existingQuantity >= moduleCapacity
          ) {
            this._notifyChargeQuantityTransition(
              session,
              charID,
              shipID,
              moduleItem.flagID,
              previousChargeState,
              previousChargeState,
              {
                forceTupleRepair: true,
              },
            );
            continue;
          }
          if (
            resolvedChargeSources.length === 0 &&
            !(existingCharge && activeChargeTypeID === chargeTypeID)
          ) {
            log.warn(
              `[DogmaIM] LoadAmmo: no source stacks resolved for reload module ${moduleID} typeID=${chargeTypeID} in location ${ammoLocationID}`,
            );
            continue;
          }
          this._queuePendingModuleReload(session, moduleItem, {
            action: "load",
            shipID,
            chargeTypeID,
            ammoLocationID,
            sourceFlagID,
            sourceItemIDs: resolvedChargeSources.map((item) => item.itemID),
            reloadTimeMs: this._getModuleReloadTimeMs(moduleItem),
          });
          continue;
        }
        if (existingCharge && activeChargeTypeID !== chargeTypeID) {
          const unloadResult = this._moveLoadedChargeToDestination(
            existingCharge,
            ammoLocationID,
            sourceFlagID,
          );
          if (unloadResult.success) {
            this._syncInventoryChanges(session, unloadResult.data.changes);
          }
          existingCharge = null;
          activeChargeTypeID = 0;
        }
        // Re-read current charge state after potential unload so that modules
        // with capacity 1 (crystals, lenses, scripts) correctly compute the
        // needed quantity instead of using the stale pre-unload count.
        const currentChargeQuantity = existingCharge
          ? Number(existingCharge.stacksize || existingCharge.quantity || 0) || 0
          : 0;
        let neededQuantity = Math.max(0, moduleCapacity - currentChargeQuantity);
        if (neededQuantity <= 0) {
          if (
            session &&
            session._space &&
            existingCharge &&
            activeChargeTypeID === chargeTypeID
          ) {
            // Explicit same-ammo LoadAmmo requests are a safe on-demand repair
            // hook for tuple-backed charge dogma even on weapons that do not
            // use a timed reload path (for example crystals/scripts).
            this._notifyChargeQuantityTransition(
              session,
              charID,
              shipID,
              moduleItem.flagID,
              previousChargeState,
              previousChargeState,
              {
                forceTupleRepair: true,
              },
            );
          }
          continue;
        }
        if (resolvedChargeSources.length === 0) {
          log.warn(
            `[DogmaIM] LoadAmmo: no source stacks resolved for module ${moduleID} typeID=${chargeTypeID} in location ${ammoLocationID}`,
          );
          continue;
        }
        for (const sourceCharge of resolvedChargeSources) {
          if (neededQuantity <= 0) {
            break;
          }
          const chargeItem = findItemById(sourceCharge.itemID);
          if (
            !chargeItem ||
            Number(chargeItem.ownerID) !== charID ||
            Number(chargeItem.flagID) !== sourceFlagID ||
            Number(chargeItem.locationID) !== ammoLocationID ||
            Number(chargeItem.typeID) !== chargeTypeID
          ) {
            continue;
          }
          const availableQuantity = Number(chargeItem.stacksize || chargeItem.quantity || 0) || 0;
          if (availableQuantity <= 0) {
            continue;
          }
          const moveQuantity = Math.min(neededQuantity, availableQuantity);
          const moveResult =
            existingCharge && activeChargeTypeID === chargeTypeID
              ? mergeItemStacks(
                chargeItem.itemID,
                existingCharge.itemID,
                moveQuantity,
              )
              : moveItemToLocation(
                chargeItem.itemID,
                shipID,
                moduleItem.flagID,
                moveQuantity,
              );
          if (!moveResult.success) {
            log.warn(
              `[DogmaIM] LoadAmmo: move failed for charge ${chargeItem.itemID} -> module flag ${moduleItem.flagID}: ${moveResult.errorMsg}`,
            );
            continue;
          }
          log.info(
            `[DogmaIM] LoadAmmo: loaded ${moveQuantity}x typeID=${chargeTypeID} into module ${moduleID} (flag=${moduleItem.flagID})`,
          );
          neededQuantity -= moveQuantity;
          this._syncInventoryChanges(session, moveResult.data.changes);
          if (existingCharge && activeChargeTypeID === chargeTypeID) {
            existingCharge = findItemById(existingCharge.itemID) || existingCharge;
          } else if (!existingCharge) {
            existingCharge = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
            activeChargeTypeID = existingCharge ? Number(existingCharge.typeID) || 0 : 0;
          }
        }
      } finally {
        const nextChargeState = this._captureChargeStateSnapshot(
          charID,
          shipID,
          moduleItem.flagID,
        );
        this._notifyChargeQuantityTransition(
          session,
          charID,
          shipID,
          moduleItem.flagID,
          previousChargeState,
          nextChargeState,
        );
        this._notifyWeaponModuleAttributeTransition(
          session,
          moduleItem,
          previousChargeItem,
          this._captureChargeItemSnapshot(charID, shipID, moduleItem.flagID),
        );
      }
    }
    return null;
  }
  Handle_UnloadAmmo(args, session) {
    const shipID = args && args.length > 0 ? Number(args[0]) || this._getShipID(session) : this._getShipID(session);
    const rawModuleIDs = args && args.length > 1 ? args[1] : [];
    const destination = args && args.length > 2 ? args[2] : shipID;
    const quantity = args && args.length > 3 ? Number(args[3]) || null : null;
    const charID = this._getCharID(session);
    const normalizedModuleIDs = extractSequenceValues(rawModuleIDs);
    const moduleIDs =
      normalizedModuleIDs.length > 0 ? normalizedModuleIDs : [rawModuleIDs];
    const resolvedDestination = this._resolveUnloadDestination(destination, session, shipID);
    log.debug(
      `[DogmaIM] UnloadAmmo(shipID=${shipID}, moduleCount=${moduleIDs.length}, destination=${JSON.stringify(resolvedDestination)})`,
    );
    for (const moduleID of moduleIDs.map((value) => Number(value) || 0).filter((value) => value > 0)) {
      const moduleItem = findItemById(moduleID);
      if (
        !moduleItem ||
        Number(moduleItem.ownerID) !== charID ||
        Number(moduleItem.locationID) !== shipID
      ) {
        continue;
      }
      const chargeItem = getLoadedChargeByFlag(charID, shipID, moduleItem.flagID);
      if (!chargeItem) {
        continue;
      }
      const previousChargeState = this._captureChargeStateSnapshot(
        charID,
        shipID,
        moduleItem.flagID,
      );
      const previousChargeItem = this._captureChargeItemSnapshot(
        charID,
        shipID,
        moduleItem.flagID,
      );
      try {
        const unloadResult = this._moveLoadedChargeToDestination(
          chargeItem,
          resolvedDestination.locationID,
          resolvedDestination.flagID,
          quantity,
        );
        if (!unloadResult.success) {
          continue;
        }
        this._syncInventoryChanges(session, unloadResult.data.changes);
      } finally {
        const nextChargeState = this._captureChargeStateSnapshot(
          charID,
          shipID,
          moduleItem.flagID,
        );
        this._notifyChargeQuantityTransition(
          session,
          charID,
          shipID,
          moduleItem.flagID,
          previousChargeState,
          nextChargeState,
        );
        this._notifyWeaponModuleAttributeTransition(
          session,
          moduleItem,
          previousChargeItem,
          this._captureChargeItemSnapshot(charID, shipID, moduleItem.flagID),
        );
      }
    }
    return null;
  }
  Handle_GetAllInfo(args, session) {
    log.debug("[DogmaIM] GetAllInfo");
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const shipContext = this._getCurrentDogmaShipContext(session);
    const shipID = shipContext.shipID;
    const shipMetadata = shipContext.shipMetadata;
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const getCharInfo = this._toBoolArg(args && args[0], true);
    const getShipInfo = this._toBoolArg(args && args[1], true);
    const getStructureInfo = this._toBoolArg(
      args && args[2],
      Boolean(session && (session.structureid || session.structureID)),
    );
    const includeDockedCharInfo =
      getShipInfo &&
      !getCharInfo &&
      isDockedSession(session);
    const includeCharInfo = getCharInfo || includeDockedCharInfo;
    const deferLoginShipFittingBootstrap =
      getShipInfo && this._shouldDeferLoginShipFittingBootstrap(session);
    const primeLoginShipInfoChargeSublocations =
      getShipInfo && this._shouldPrimeLoginShipInfoChargeSublocations(session);
    const includeLoginShipInfoLoadedCharges =
      getShipInfo && this._shouldIncludeLoginShipInfoLoadedCharges(session);
    const characterLocationID = this._getCharacterItemLocationID(session, {
      allowShipLocation: getShipInfo,
    });
    const locationInfo = this._buildEmptyDict();
    const dockedStructureRecord = getStructureInfo
      ? this._getDockedStructureRecord(session)
      : null;
    const shipInfoEntry = getShipInfo
      ? this._buildCommonGetInfoEntry({
          itemID: shipID,
          typeID: shipMetadata.typeID,
          ownerID: shipMetadata.ownerID || ownerID,
          locationID: this._coalesce(shipMetadata.locationID, locationID),
          flagID: this._coalesce(shipMetadata.flagID, 4),
          groupID: shipMetadata.groupID,
          categoryID: shipMetadata.categoryID,
          quantity:
            shipMetadata.quantity === undefined ||
            shipMetadata.quantity === null
              ? -1
              : shipMetadata.quantity,
          singleton:
            shipMetadata.singleton === undefined ||
            shipMetadata.singleton === null
              ? 1
              : shipMetadata.singleton,
          stacksize:
            shipMetadata.stacksize === undefined ||
            shipMetadata.stacksize === null
              ? 1
              : shipMetadata.stacksize,
          customInfo: shipMetadata.customInfo || "",
          description: shipContext.controllingStructure ? "structure" : "ship",
          attributes: shipContext.controllingStructure
            ? this._buildInventoryItemAttributeDict(shipMetadata, session)
            : this._buildShipAttributeDict(charData, shipMetadata, session),
          session,
        })
      : null;
    const shipInventoryInfoEntries = getShipInfo
      ? shipContext.controllingStructure
        ? []
        : this._buildShipInventoryInfoEntries(
          charID,
          shipID,
          shipMetadata.ownerID || ownerID,
          this._coalesce(shipMetadata.locationID, locationID),
          session,
          {
            includeFittedItems: !deferLoginShipFittingBootstrap,
            includeLoadedCharges: includeLoginShipInfoLoadedCharges,
            includeChargeSublocations: primeLoginShipInfoChargeSublocations,
          },
        )
      : [];
    const shipInfoTupleChargeEntries = shipInventoryInfoEntries.filter(
      (entry) => Array.isArray(Array.isArray(entry) ? entry[0] : null),
    ).length;
    log.debug(
      `[DogmaIM] GetAllInfo shipInfo entries=${shipInventoryInfoEntries.length} ` +
      `tupleCharges=${shipInfoTupleChargeEntries} ` +
      `loadedCharges=${includeLoginShipInfoLoadedCharges ? 1 : 0} ` +
      `deferredFitting=${deferLoginShipFittingBootstrap ? 1 : 0} ` +
      `loginTuplePrime=${primeLoginShipInfoChargeSublocations ? 1 : 0} ` +
      `docked=${isDockedSession(session) ? 1 : 0}`,
    );
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["activeShipID", shipID],
          ["locationInfo", getShipInfo ? locationInfo : null],
          ["shipModifiedCharAttribs", null],
          [
            "charInfo",
            includeCharInfo
              ? [
                  this._buildCharacterInfoDict(
                    charID,
                    charData,
                    characterLocationID,
                  ),
                  // Station boarding/login still runs a ship-info-dominant
                  // GetAllInfo path. The client seeds charBrain exclusively
                  // from charInfo, and without it docked MakeShipActive later
                  // crashes in RemoveBrainEffects while switching ships.
                  this._buildCharacterBrain(),
                ]
              : null,
          ],
          [
            "shipInfo",
            getShipInfo
              ? {
                  type: "dict",
                  entries: [[shipID, shipInfoEntry], ...shipInventoryInfoEntries],
                }
              : this._buildEmptyDict(),
          ],
          [
            "shipState",
            getShipInfo
                ? this._buildActivationState(charID, shipID, shipContext.shipRecord, {
                    includeFittedItems:
                      shipContext.controllingStructure
                        ? false
                        : !deferLoginShipFittingBootstrap,
                    includeCharges: shipContext.controllingStructure ? false : true,
                  })
              : null,
          ],
          ["systemWideEffectsOnShip", null],
          [
            "structureInfo",
            dockedStructureRecord
              ? this._buildStructureInfoDict(dockedStructureRecord, session)
              : null,
          ],
        ],
      },
    };
  }
  Handle_ShipGetInfo(args, session) {
    log.debug("[DogmaIM] ShipGetInfo");
    const shipContext = this._getCurrentDogmaShipContext(session);
    const shipID = shipContext.shipID;
    const shipMetadata = shipContext.shipMetadata;
    const ownerID = shipMetadata.ownerID || this._getCharID(session);
    const locationID = shipMetadata.locationID || this._getLocationID(session);
    const entry = this._buildCommonGetInfoEntry({
      itemID: shipID,
      typeID: shipMetadata.typeID,
      ownerID,
      locationID,
      flagID: this._coalesce(shipMetadata.flagID, 4),
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      quantity:
        shipMetadata.quantity === undefined || shipMetadata.quantity === null
          ? -1
          : shipMetadata.quantity,
      singleton:
        shipMetadata.singleton === undefined || shipMetadata.singleton === null
          ? 1
          : shipMetadata.singleton,
      stacksize:
        shipMetadata.stacksize === undefined || shipMetadata.stacksize === null
          ? 1
          : shipMetadata.stacksize,
      customInfo: shipMetadata.customInfo || "",
      description: shipContext.controllingStructure ? "structure" : "ship",
      attributes: shipContext.controllingStructure
        ? this._buildInventoryItemAttributeDict(shipMetadata, session)
        : this._buildShipAttributeDict(
          this._getCharacterRecord(session) || {},
          shipMetadata,
          session,
        ),
      session,
    });
    return { type: "dict", entries: [[shipID, entry]] };
  }
  Handle_CharGetInfo(args, session) {
    log.debug("[DogmaIM] CharGetInfo");
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const characterLocationID = this._getCharacterItemLocationID(session);
    return this._buildCharacterInfoDict(charID, charData, characterLocationID);
  }
  Handle_ItemGetInfo(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] ItemGetInfo(itemID=${requestedItemID})`);
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) => skill.itemID === requestedItemID || skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;
    const numericItemID = Number.parseInt(String(requestedItemID), 10) || this._getShipID(session);
    const shipRecord = findCharacterShip(charID, numericItemID);
    const isCharacter = numericItemID === charID;
    if (skillRecord) {
      return this._buildCommonGetInfoEntry({
        itemID: skillRecord.itemID,
        typeID: skillRecord.typeID,
        ownerID: skillRecord.ownerID || charID,
        locationID: this._coalesce(skillRecord.locationID, charID),
        flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
        groupID: skillRecord.groupID,
        categoryID: skillRecord.categoryID,
        quantity: 1,
        singleton: 1,
        stacksize: 1,
        description: skillRecord.itemName || "skill",
        session,
      });
    }
    const inventoryContext = this._findInventoryItemContext(requestedItemID, session);
    if (inventoryContext && inventoryContext.item) {
      const item = inventoryContext.item;
      return this._buildCommonGetInfoEntry({
        itemID: Array.isArray(requestedItemID) ? requestedItemID : item.itemID,
        typeID: item.typeID,
        ownerID: item.ownerID || charID,
        locationID: item.locationID,
        flagID: item.flagID,
        groupID: item.groupID,
        categoryID: item.categoryID,
        quantity: item.quantity,
        singleton: item.singleton,
        stacksize: item.stacksize,
        customInfo: item.customInfo || "",
        description: item.itemName || "item",
        activeEffects: this._buildInventoryItemActiveEffects(item, session),
        attributes: this._buildInventoryItemAttributeDict(item, session),
        session,
      });
    }
    const shipContext = this._getCurrentDogmaShipContext(session);
    if (
      shipContext.controllingStructure &&
      numericItemID === Number(shipContext.shipID)
    ) {
      return this._buildCommonGetInfoEntry({
        itemID: shipContext.shipID,
        typeID: shipContext.shipMetadata.typeID,
        ownerID: shipContext.shipMetadata.ownerID || charID,
        locationID: this._coalesce(
          shipContext.shipMetadata.locationID,
          this._getLocationID(session),
        ),
        flagID: this._coalesce(shipContext.shipMetadata.flagID, 0),
        groupID: shipContext.shipMetadata.groupID,
        categoryID: shipContext.shipMetadata.categoryID,
        quantity:
          shipContext.shipMetadata.quantity === undefined ||
          shipContext.shipMetadata.quantity === null
            ? -1
            : shipContext.shipMetadata.quantity,
        singleton:
          shipContext.shipMetadata.singleton === undefined ||
          shipContext.shipMetadata.singleton === null
            ? 1
            : shipContext.shipMetadata.singleton,
        stacksize:
          shipContext.shipMetadata.stacksize === undefined ||
          shipContext.shipMetadata.stacksize === null
            ? 1
            : shipContext.shipMetadata.stacksize,
        customInfo: shipContext.shipMetadata.customInfo || "",
        description: "item",
        attributes: this._buildInventoryItemAttributeDict(
          shipContext.shipMetadata,
          session,
        ),
        session,
      });
    }
    const itemID = isCharacter
      ? charID
      : shipRecord
        ? shipRecord.itemID
        : this._getShipID(session);
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const shipMetadata = shipRecord || this._getActiveShipRecord(session) || this._getShipMetadata(session);
    const characterLocationID = this._getCharacterItemLocationID(session);
    return this._buildCommonGetInfoEntry({
      itemID,
      typeID: isCharacter ? (charData.typeID || 1373) : shipMetadata.typeID,
      ownerID,
      locationID: isCharacter
        ? characterLocationID
        : this._coalesce(shipMetadata.locationID, locationID),
      flagID: isCharacter
        ? FLAG_PILOT
        : this._coalesce(shipMetadata.flagID, 4),
      groupID: isCharacter ? 1 : shipMetadata.groupID,
      categoryID: isCharacter ? 3 : shipMetadata.categoryID,
      quantity: isCharacter
        ? -1
        : (
            shipMetadata.quantity === undefined || shipMetadata.quantity === null
              ? -1
              : shipMetadata.quantity
          ),
      singleton: isCharacter
        ? 1
        : (
            shipMetadata.singleton === undefined || shipMetadata.singleton === null
              ? 1
              : shipMetadata.singleton
          ),
      stacksize: isCharacter
        ? 1
        : (
            shipMetadata.stacksize === undefined || shipMetadata.stacksize === null
              ? 1
              : shipMetadata.stacksize
          ),
      customInfo: isCharacter ? "" : (shipMetadata.customInfo || ""),
      description: "item",
      attributes: isCharacter
        ? this._buildCharacterAttributeDict(charData)
        : this._buildShipAttributeDict(charData, shipMetadata, session),
      session,
    });
  }
  Handle_QueryAllAttributesForItem(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] QueryAllAttributesForItem(itemID=${requestedItemID})`);
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return this._buildAttributeValueDict(context.attributes);
  }
  Handle_QueryAttributeValue(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    log.debug(
      `[DogmaIM] QueryAttributeValue(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );
    if (!Number.isInteger(attributeID)) {
      return null;
    }
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return Object.prototype.hasOwnProperty.call(context.attributes, attributeID)
      ? context.attributes[attributeID]
      : null;
  }
  Handle_FullyDescribeAttribute(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    const reason = args && args.length > 2 ? args[2] : "";
    log.debug(
      `[DogmaIM] FullyDescribeAttribute(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    const serverValue = Number.isInteger(attributeID)
      ? context.attributes[attributeID]
      : undefined;
    const baseValue = Number.isInteger(attributeID)
      ? context.baseAttributes[attributeID]
      : undefined;
    return {
      type: "list",
      items: [
        `Item ID:${this._formatDebugValue(context.itemID)}`,
        `Reason:${this._formatDebugValue(reason, "")}`,
        `Server value:${this._formatDebugValue(serverValue)}`,
        `Base value:${this._formatDebugValue(baseValue)}`,
        "Attribute modification graph:",
        "  No server-side modifier graph is implemented in EvEJS yet.",
      ],
    };
  }
  Handle_GetLocationInfo(args, session) {
    log.debug("[DogmaIM] GetLocationInfo");
    return [
      (session && session.userid) || 1,
      this._getLocationID(session),
      0,
    ];
  }
  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[DogmaIM] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }
  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;
    log.debug(
      `[DogmaIM] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];
    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;
      log.debug(`[DogmaIM] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }
    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }
  afterCallResponse(methodName, session) {
    if (methodName !== "GetAllInfo") {
      return;
    }
    if (this._isControllingStructureSession(session)) {
      return;
    }
    flushDeferredDockedFittingReplay(session, {
      trigger: "dogma.GetAllInfo",
    });
  }
}
/**
 * Process all pending module reloads whose timers have expired.
 * Called from the scheduled timer callback and can also be invoked
 * directly for testing.
 */
DogmaService.flushPendingModuleReloads = function flushPendingModuleReloads(
  nowMs = Date.now(),
) {
  const instance = new DogmaService();
  const completed = [];
  for (const [moduleID, reloadState] of pendingModuleReloads.entries()) {
    const completeAtMs = Number(reloadState && reloadState.completeAtMs) || 0;
    const currentTimeMs = getReloadStateCurrentTimeMs(reloadState, nowMs);
    if (completeAtMs <= 0 || completeAtMs > currentTimeMs) {
      continue;
    }
    const result = instance._completePendingModuleReload(reloadState, currentTimeMs);
    completed.push({
      moduleID,
      success: result.success,
      errorMsg: result.errorMsg || null,
    });
  }
  schedulePendingModuleReloadPump();
  return completed;
};
DogmaService.boardNewbieShipForSession = boardNewbieShipForSession;
DogmaService.resolveNewbieShipTypeIDForSession = resolveNewbieShipTypeID;
DogmaService.repairShipAndFittedItemsForSession = repairShipAndFittedItemsForSession;
DogmaService._testing = {
  flushPendingModuleReloads: DogmaService.flushPendingModuleReloads,
  getPendingModuleReloads() {
    return pendingModuleReloads;
  },
  marshalDogmaAttributeValue,
  normalizeModuleAttributeChange,
  clearPendingModuleReloads() {
    pendingModuleReloads.clear();
    if (pendingModuleReloadTimer) {
      clearTimeout(pendingModuleReloadTimer);
      pendingModuleReloadTimer = null;
    }
  },
};
module.exports = DogmaService;

/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const InvBrokerService = require(path.join(
  __dirname,
  "../../server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  __dirname,
  "../../server/src/services/dogma/dogmaService",
));
const ShipService = require(path.join(
  __dirname,
  "../../server/src/services/ship/shipService",
));
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const destiny = require(path.join(
  __dirname,
  "../../server/src/space/destiny",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  buildChargeSublocationData,
  getModuleChargeCapacity,
  getShipSlotCounts,
  isShipFittingFlag,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function getListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function getDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getDictValue(value, key) {
  const entry = getDictEntries(value).find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : undefined;
}

function getRowLine(row) {
  if (!row || row.name !== "util.Row" || !row.args) {
    return [];
  }
  return getDictValue(row.args, "line") || [];
}

function getNextTemporaryItemID() {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items table");
  let maxItemID = 0;
  for (const itemID of Object.keys(itemsResult.data || {})) {
    const numericItemID = Number(itemID) || 0;
    if (numericItemID > maxItemID) {
      maxItemID = numericItemID;
    }
  }
  return maxItemID + 1000;
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function getDockedCandidates() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = [];
  for (const characterID of Object.keys(charactersResult.data || {})) {
    const numericCharacterID = Number(characterID) || 0;
    if (numericCharacterID <= 0) {
      continue;
    }

    const characterRecord = getCharacterRecord(numericCharacterID);
    const activeShip = getActiveShipRecord(numericCharacterID);
    if (!characterRecord || !activeShip) {
      continue;
    }

    const stationID = Number(
      characterRecord.stationID || characterRecord.stationid || 0,
    );
    if (
      stationID <= 0 ||
      Number(activeShip.locationID) !== stationID ||
      Number(activeShip.flagID) !== ITEM_FLAGS.HANGAR
    ) {
      continue;
    }

    candidates.push({
      characterID: numericCharacterID,
      characterRecord,
      activeShip,
      stationID,
      slots: getShipSlotCounts(activeShip.typeID || activeShip.shipTypeID),
    });
  }

  return candidates;
}

function chooseFittingCandidate(candidates) {
  const moduleFamilies = [
    { family: "low", itemName: "Damage Control I" },
    { family: "med", itemName: "Warp Disruptor I" },
    { family: "high", itemName: "125mm Railgun I" },
  ];

  for (const candidate of candidates) {
    for (const moduleFamily of moduleFamilies) {
      if ((candidate.slots[moduleFamily.family] || 0) <= 0) {
        continue;
      }

      const itemType = resolveItemByName(moduleFamily.itemName);
      if (!itemType || !itemType.success) {
        continue;
      }

      return {
        ...candidate,
        fittingModuleType: itemType.match,
      };
    }
  }

  return null;
}

function chooseAmmoCandidate(candidates) {
  const weaponChargePairs = [
    ["125mm Railgun I", "Antimatter Charge S"],
    ["75mm Gatling Rail I", "Antimatter Charge S"],
    ["Civilian Gatling Pulse Laser", "Multifrequency S"],
    ["Civilian Gatling Autocannon", "EMP S"],
  ];

  for (const candidate of candidates) {
    if ((candidate.slots.high || 0) <= 0) {
      continue;
    }

    for (const [weaponName, chargeName] of weaponChargePairs) {
      const weaponType = resolveItemByName(weaponName);
      const chargeType = resolveItemByName(chargeName);
      if (!weaponType || !weaponType.success || !chargeType || !chargeType.success) {
        continue;
      }

      const capacity = getModuleChargeCapacity(
        weaponType.match.typeID,
        chargeType.match.typeID,
      );
      if (capacity <= 0) {
        continue;
      }

      return {
        ...candidate,
        weaponModuleType: weaponType.match,
        chargeType: chargeType.match,
        chargeCapacity: capacity,
      };
    }
  }

  return null;
}

function buildDockedSession(candidate, notifications) {
  return {
    clientID: candidate.characterID + 7000,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.activeShip.itemID,
    shipid: candidate.activeShip.itemID,
    activeShipID: candidate.activeShip.itemID,
    shipTypeID: candidate.activeShip.typeID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.factionID) || 0,
    sendNotification(name, narrowcast, payload) {
      notifications.push({ name, narrowcast, payload });
    },
  };
}

function bindShipInventory(invBroker, session, shipID) {
  const bound = invBroker.Handle_GetInventoryFromId([shipID], session, {});
  const boundObjectID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert(boundObjectID, "Expected ship inventory bind to return a bound object ID");
  session.currentBoundObjectID = boundObjectID;
}

function writeTemporaryItem(itemID, item) {
  const result = database.write("items", `/${itemID}`, item);
  assert(result.success, `Failed to write temporary item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  const readResult = database.read("items", `/${itemID}`);
  if (readResult.success) {
    database.remove("items", `/${itemID}`);
  }
}

function main() {
  const candidates = getDockedCandidates();
  assert(candidates.length > 0, "Expected at least one docked character");

  const fittingCandidate = chooseFittingCandidate(candidates);
  assert(fittingCandidate, "Expected at least one docked ship with a fit-able slot");

  const ammoCandidate = chooseAmmoCandidate(candidates);
  assert(ammoCandidate, "Expected at least one docked ship with a high slot for ammo tests");

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const shipService = new ShipService();
  const tempItemIDs = new Set();

  const fittingNotifications = [];
  const fittingSession = buildDockedSession(fittingCandidate, fittingNotifications);
  bindShipInventory(invBroker, fittingSession, fittingCandidate.activeShip.itemID);

  const ammoNotifications = [];
  const ammoSession = buildDockedSession(ammoCandidate, ammoNotifications);
  bindShipInventory(invBroker, ammoSession, ammoCandidate.activeShip.itemID);

  const tempBaseID = getNextTemporaryItemID();
  const fittingModuleID = tempBaseID;
  const weaponModuleID = tempBaseID + 1;
  const chargeItemID = tempBaseID + 2;
  tempItemIDs.add(fittingModuleID);
  tempItemIDs.add(weaponModuleID);
  tempItemIDs.add(chargeItemID);

  try {
    writeTemporaryItem(
      fittingModuleID,
      buildInventoryItem({
        itemID: fittingModuleID,
        typeID: fittingCandidate.fittingModuleType.typeID,
        ownerID: fittingCandidate.characterID,
        locationID: fittingCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: fittingCandidate.fittingModuleType.name,
        singleton: 1,
      }),
    );

    const beforeFitted = shipService.Handle_GetFittedItems(
      [fittingCandidate.activeShip.itemID],
      fittingSession,
    );
    assert(
      !getDictEntries(beforeFitted).some(([itemID]) => Number(itemID) === fittingModuleID),
      "Temporary module should not be fitted before Add",
    );

    invBroker.Handle_Add(
      [fittingModuleID, fittingCandidate.stationID],
      fittingSession,
      { flag: 0 },
    );

    const fittedModule = findItemById(fittingModuleID);
    assert(fittedModule, "Expected fitted module to exist after Add");
    assert.strictEqual(
      Number(fittedModule.locationID),
      fittingCandidate.activeShip.itemID,
      "Fitted module should move into the ship inventory location",
    );
    assert(
      isShipFittingFlag(fittedModule.flagID),
      "Fitted module should land in a live fitting flag",
    );
    assert(
      fittingNotifications.some((entry) => entry.name === "OnItemChange"),
      "Fitting should emit OnItemChange to the client",
    );

    const fittedItems = shipService.Handle_GetFittedItems(
      [fittingCandidate.activeShip.itemID],
      fittingSession,
    );
    assert(
      getDictEntries(fittedItems).some(([itemID]) => Number(itemID) === fittingModuleID),
      "ship.GetFittedItems should expose the live fitted module item",
    );

    const slimEntity = runtime._testing.buildShipEntityForTesting(
      fittingSession,
      fittingCandidate.activeShip,
      Number(fittingCandidate.characterRecord.solarSystemID) || 30000142,
    );
    const slimObject = destiny.buildSlimItemDict(slimEntity);
    const slimModules = getListItems(getDictValue(slimObject, "modules"));
    assert(
      slimModules.some(
        (entry) =>
          Array.isArray(entry) &&
          Number(entry[0]) === fittingModuleID &&
          Number(entry[1]) === fittingCandidate.fittingModuleType.typeID &&
          Number(entry[2]) === Number(fittedModule.flagID),
      ),
      "Ballpark slim modules should be built from the live fitted inventory items",
    );

    dogma.Handle_SetModuleOnline(
      [fittingCandidate.activeShip.itemID, fittingModuleID],
      fittingSession,
    );
    const onlineModule = findItemById(fittingModuleID);
    assert(
      onlineModule &&
        onlineModule.moduleState &&
        onlineModule.moduleState.online === true,
      "SetModuleOnline should persist per-item online state",
    );
    const onlineModules = shipService
      ? dogma.Handle_ShipOnlineModules([], fittingSession)
      : { type: "list", items: [] };
    assert(
      getListItems(onlineModules).includes(fittingModuleID),
      "ShipOnlineModules should include the now-online module",
    );
    assert(
      fittingNotifications.some((entry) => entry.name === "OnModuleAttributeChanges"),
      "SetModuleOnline should emit module attribute changes to the client",
    );

    dogma.Handle_TakeModuleOffline(
      [fittingCandidate.activeShip.itemID, fittingModuleID],
      fittingSession,
    );
    const offlineModules = dogma.Handle_ShipOnlineModules([], fittingSession);
    assert(
      !getListItems(offlineModules).includes(fittingModuleID),
      "TakeModuleOffline should remove the module from the online list",
    );

    writeTemporaryItem(
      weaponModuleID,
      buildInventoryItem({
        itemID: weaponModuleID,
        typeID: ammoCandidate.weaponModuleType.typeID,
        ownerID: ammoCandidate.characterID,
        locationID: ammoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: ammoCandidate.weaponModuleType.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      chargeItemID,
      buildInventoryItem({
        itemID: chargeItemID,
        typeID: ammoCandidate.chargeType.typeID,
        ownerID: ammoCandidate.characterID,
        locationID: ammoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: ammoCandidate.chargeType.name,
        singleton: 0,
        quantity: ammoCandidate.chargeCapacity,
        stacksize: ammoCandidate.chargeCapacity,
      }),
    );

    invBroker.Handle_Add(
      [weaponModuleID, ammoCandidate.stationID],
      ammoSession,
      { flag: 0 },
    );
    const fittedWeapon = findItemById(weaponModuleID);
    assert(fittedWeapon, "Expected fitted weapon module to exist after Add");
    assert(
      isShipFittingFlag(fittedWeapon.flagID),
      "Weapon module should fit into a live ship slot",
    );

    const turretModules = shipService.Handle_GetTurretModules([], ammoSession);
    assert(
      getListItems(turretModules).includes(weaponModuleID),
      "ship.GetTurretModules should expose fitted turret-like modules",
    );

    dogma.Handle_LoadAmmo(
      [
        ammoCandidate.activeShip.itemID,
        weaponModuleID,
        [chargeItemID],
        ammoCandidate.stationID,
      ],
      ammoSession,
    );

    const loadedCharge = findItemById(chargeItemID);
    assert(loadedCharge, "Expected loaded charge stack to exist after LoadAmmo");
    assert.strictEqual(
      Number(loadedCharge.locationID),
      ammoCandidate.activeShip.itemID,
      "Loaded charge should move into the ship inventory location",
    );
    assert.strictEqual(
      Number(loadedCharge.flagID),
      Number(fittedWeapon.flagID),
      "Loaded charge should occupy the same fitting flag as its module",
    );

    const activationState = shipService._buildActivationResponse(
      getActiveShipRecord(ammoCandidate.characterID),
      ammoSession,
    );
    const chargeStateByShip = getDictValue(activationState[1], ammoCandidate.activeShip.itemID);
    const chargeStateRow = getDictValue(chargeStateByShip, Number(fittedWeapon.flagID));
    const chargeStateLine = getRowLine(chargeStateRow);
    assert.deepStrictEqual(
      chargeStateLine,
      [
        ammoCandidate.activeShip.itemID,
        Number(fittedWeapon.flagID),
        ammoCandidate.chargeType.typeID,
        ammoCandidate.chargeCapacity,
      ],
      "Activation response should expose loaded charge state by ship flag",
    );

    const loadedChargeSublocations = buildChargeSublocationData(
      ammoCandidate.characterID,
      ammoCandidate.activeShip.itemID,
    );
    assert(
      loadedChargeSublocations.some(
        (entry) =>
          Number(entry.flagID) === Number(fittedWeapon.flagID) &&
          Number(entry.typeID) === Number(ammoCandidate.chargeType.typeID) &&
          Number(entry.quantity) === Number(ammoCandidate.chargeCapacity),
      ),
      "Live charge sublocation data should track ammo loaded into module flags",
    );

    dogma.Handle_UnloadAmmo(
      [ammoCandidate.activeShip.itemID, weaponModuleID, ammoCandidate.activeShip.itemID],
      ammoSession,
    );
    const unloadedCharge = findItemById(chargeItemID);
    assert(unloadedCharge, "Expected charge stack to remain after unload");
    assert.strictEqual(
      Number(unloadedCharge.locationID),
      ammoCandidate.activeShip.itemID,
      "Unloaded charge should remain inside the ship inventory location",
    );
    assert.strictEqual(
      Number(unloadedCharge.flagID),
      ITEM_FLAGS.CARGO_HOLD,
      "UnloadAmmo should move charges into cargo when the destination is the ship",
    );

    console.log(JSON.stringify({
      ok: true,
      fittingCharacterID: fittingCandidate.characterID,
      fittingShipID: fittingCandidate.activeShip.itemID,
      fittedModuleID: fittingModuleID,
      fittedModuleFlagID: Number(fittedModule.flagID),
      ammoCharacterID: ammoCandidate.characterID,
      ammoShipID: ammoCandidate.activeShip.itemID,
      weaponModuleID: weaponModuleID,
      weaponFlagID: Number(fittedWeapon.flagID),
      chargeItemID: chargeItemID,
      chargeTypeID: ammoCandidate.chargeType.typeID,
      chargeCapacity: ammoCandidate.chargeCapacity,
      fittingNotifications: fittingNotifications.map((entry) => entry.name),
      ammoNotifications: ammoNotifications.map((entry) => entry.name),
    }, null, 2));
  } finally {
    for (const itemID of tempItemIDs) {
      removeItemIfPresent(itemID);
    }
  }
}

main();

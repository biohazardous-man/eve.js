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
  getLoadedChargeByFlag,
  getShipSlotCounts,
  getShipBaseAttributeValue,
  getAttributeIDByNames,
  getSlotFlagsForFamily,
  listFittedItems,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

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
  return maxItemID + 5000;
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
      turretHardpoints: Number(
        getShipBaseAttributeValue(activeShip.typeID || activeShip.shipTypeID, "turretSlotsLeft"),
      ) || 0,
      launcherHardpoints: Number(
        getShipBaseAttributeValue(activeShip.typeID || activeShip.shipTypeID, "launcherSlotsLeft"),
      ) || 0,
      upgradeCapacity: Number(
        getShipBaseAttributeValue(activeShip.typeID || activeShip.shipTypeID, "upgradeCapacity"),
      ) || 0,
    });
  }

  return candidates;
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function buildDockedSession(candidate, notifications) {
  return {
    clientID: candidate.characterID + 9000,
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

function getCapacityNumbers(capacityInfo) {
  const args = capacityInfo && capacityInfo.args;
  const entries = getDictEntries(args);
  const capacity = Number(entries.find(([key]) => key === "capacity")?.[1]) || 0;
  const used = Number(entries.find(([key]) => key === "used")?.[1]) || 0;
  return { capacity, used };
}

function getInfoAttributes(info) {
  const args = info && info.args;
  return getDictValue(args, "attributes");
}

function getAttributeValue(attributeDict, attributeID) {
  const entry = getDictEntries(attributeDict).find(([key]) => Number(key) === Number(attributeID));
  return entry ? Number(entry[1]) : null;
}

function main() {
  const candidates = getDockedCandidates();
  assert(candidates.length > 0, "Expected at least one docked character");

  const cargoCandidate =
    candidates.find((candidate) => candidate.slots.low >= 2 && candidate.slots.high >= 1) ||
    candidates.find((candidate) => candidate.slots.low >= 1) ||
    null;
  assert(cargoCandidate, "Expected a docked ship with at least one low slot");

  const rigCandidate =
    candidates.find((candidate) => candidate.slots.rig >= 2 && candidate.upgradeCapacity >= 400) ||
    null;
  assert(rigCandidate, "Expected a docked ship with at least two rig slots");

  const hardpointCandidate =
    candidates.find((candidate) => candidate.slots.high >= 1 && candidate.turretHardpoints === 0) ||
    candidates.find((candidate) => candidate.slots.high > candidate.turretHardpoints) ||
    null;
  assert(hardpointCandidate, "Expected a docked ship suitable for hardpoint rejection");

  const invBroker = new InvBrokerService();
  const dogma = new DogmaService();
  const tempItemIDs = new Set();

  const damageControl = resolveExactItem("Damage Control I");
  const expandedCargo = resolveExactItem("Expanded Cargohold I");
  const turretModule = resolveExactItem("125mm Railgun I");
  const weaponModule = turretModule;
  const chargeType = resolveExactItem("Antimatter Charge S");
  const highCostRig = resolveExactItem("Small Processor Overclocking Unit II");

  const occupancyNotifications = [];
  const occupancySession = buildDockedSession(cargoCandidate, occupancyNotifications);
  bindShipInventory(invBroker, occupancySession, cargoCandidate.activeShip.itemID);

  const hardpointNotifications = [];
  const hardpointSession = buildDockedSession(hardpointCandidate, hardpointNotifications);
  bindShipInventory(invBroker, hardpointSession, hardpointCandidate.activeShip.itemID);

  const rigNotifications = [];
  const rigSession = buildDockedSession(rigCandidate, rigNotifications);
  bindShipInventory(invBroker, rigSession, rigCandidate.activeShip.itemID);

  const cargoNotifications = [];
  const cargoSession = buildDockedSession(cargoCandidate, cargoNotifications);
  bindShipInventory(invBroker, cargoSession, cargoCandidate.activeShip.itemID);

  const ammoNotifications = [];
  const ammoSession = buildDockedSession(cargoCandidate, ammoNotifications);
  bindShipInventory(invBroker, ammoSession, cargoCandidate.activeShip.itemID);

  const capacityAttributeID = getAttributeIDByNames("capacity");
  const cargoLowFlags = getSlotFlagsForFamily("low", cargoCandidate.activeShip.typeID);
  const cargoOccupiedFlags = new Set(
    listFittedItems(cargoCandidate.characterID, cargoCandidate.activeShip.itemID).map(
      (item) => Number(item.flagID) || 0,
    ),
  );
  const freeCargoLowFlags = cargoLowFlags.filter((flagID) => !cargoOccupiedFlags.has(flagID));
  assert(freeCargoLowFlags.length >= 2, "Expected two free low slots for cargo candidate");
  const freeCargoLowFlag = freeCargoLowFlags[0];

  const hardpointHighFlags = getSlotFlagsForFamily("high", hardpointCandidate.activeShip.typeID);
  const hardpointOccupiedFlags = new Set(
    listFittedItems(hardpointCandidate.characterID, hardpointCandidate.activeShip.itemID).map(
      (item) => Number(item.flagID) || 0,
    ),
  );
  const freeHardpointHighFlag = hardpointHighFlags.find((flagID) => !hardpointOccupiedFlags.has(flagID));
  assert(Number.isInteger(freeHardpointHighFlag), "Expected a free high slot for hardpoint candidate");

  const rigFlags = getSlotFlagsForFamily("rig", rigCandidate.activeShip.typeID);
  const rigOccupiedFlags = new Set(
    listFittedItems(rigCandidate.characterID, rigCandidate.activeShip.itemID).map(
      (item) => Number(item.flagID) || 0,
    ),
  );
  const freeRigFlags = rigFlags.filter((flagID) => !rigOccupiedFlags.has(flagID));
  assert(freeRigFlags.length >= 2, "Expected two free rig slots for rig candidate");

  const ammoHighFlags = getSlotFlagsForFamily("high", cargoCandidate.activeShip.typeID);
  const ammoOccupiedFlags = new Set(
    listFittedItems(cargoCandidate.characterID, cargoCandidate.activeShip.itemID).map(
      (item) => Number(item.flagID) || 0,
    ),
  );
  const freeAmmoHighFlag = ammoHighFlags.find((flagID) => !ammoOccupiedFlags.has(flagID));
  assert(Number.isInteger(freeAmmoHighFlag), "Expected a free high slot for ammo candidate");

  const tempBaseID = getNextTemporaryItemID();
  const itemIDs = {
    occupiedOne: tempBaseID,
    occupiedTwo: tempBaseID + 1,
    hardpointTurret: tempBaseID + 2,
    rigOne: tempBaseID + 3,
    rigTwo: tempBaseID + 4,
    cargoMod: tempBaseID + 5,
    weapon: tempBaseID + 6,
    chargeOne: tempBaseID + 7,
    chargeTwo: tempBaseID + 8,
  };
  for (const itemID of Object.values(itemIDs)) {
    tempItemIDs.add(itemID);
  }

  try {
    writeTemporaryItem(
      itemIDs.occupiedOne,
      buildInventoryItem({
        itemID: itemIDs.occupiedOne,
        typeID: damageControl.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: damageControl.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      itemIDs.occupiedTwo,
      buildInventoryItem({
        itemID: itemIDs.occupiedTwo,
        typeID: damageControl.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: damageControl.name,
        singleton: 1,
      }),
    );
    invBroker.Handle_Add(
      [itemIDs.occupiedOne, cargoCandidate.stationID],
      occupancySession,
      { flag: freeCargoLowFlag },
    );
    invBroker.Handle_Add(
      [itemIDs.occupiedTwo, cargoCandidate.stationID],
      occupancySession,
      { flag: freeCargoLowFlag },
    );
    const occupiedOne = findItemById(itemIDs.occupiedOne);
    const occupiedTwo = findItemById(itemIDs.occupiedTwo);
    assert(occupiedOne, "Expected first explicitly-fitted module to exist");
    assert.strictEqual(Number(occupiedOne.locationID), cargoCandidate.activeShip.itemID);
    assert.strictEqual(Number(occupiedOne.flagID), freeCargoLowFlag);
    assert(occupiedTwo, "Expected rejected slot-occupied module to exist");
    assert.strictEqual(Number(occupiedTwo.locationID), cargoCandidate.stationID);
    assert.strictEqual(Number(occupiedTwo.flagID), ITEM_FLAGS.HANGAR);

    writeTemporaryItem(
      itemIDs.hardpointTurret,
      buildInventoryItem({
        itemID: itemIDs.hardpointTurret,
        typeID: turretModule.typeID,
        ownerID: hardpointCandidate.characterID,
        locationID: hardpointCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: turretModule.name,
        singleton: 1,
      }),
    );
    invBroker.Handle_Add(
      [itemIDs.hardpointTurret, hardpointCandidate.stationID],
      hardpointSession,
      { flag: freeHardpointHighFlag },
    );
    const rejectedTurret = findItemById(itemIDs.hardpointTurret);
    assert(rejectedTurret, "Expected hardpoint-rejected turret to remain in inventory");
    assert.strictEqual(Number(rejectedTurret.locationID), hardpointCandidate.stationID);
    assert.strictEqual(Number(rejectedTurret.flagID), ITEM_FLAGS.HANGAR);

    writeTemporaryItem(
      itemIDs.rigOne,
      buildInventoryItem({
        itemID: itemIDs.rigOne,
        typeID: highCostRig.typeID,
        ownerID: rigCandidate.characterID,
        locationID: rigCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: highCostRig.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      itemIDs.rigTwo,
      buildInventoryItem({
        itemID: itemIDs.rigTwo,
        typeID: highCostRig.typeID,
        ownerID: rigCandidate.characterID,
        locationID: rigCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: highCostRig.name,
        singleton: 1,
      }),
    );
    invBroker.Handle_Add(
      [itemIDs.rigOne, rigCandidate.stationID],
      rigSession,
      { flag: freeRigFlags[0] },
    );
    invBroker.Handle_Add(
      [itemIDs.rigTwo, rigCandidate.stationID],
      rigSession,
      { flag: freeRigFlags[1] },
    );
    const fittedRig = findItemById(itemIDs.rigOne);
    const rejectedRig = findItemById(itemIDs.rigTwo);
    assert(fittedRig, "Expected first rig to fit");
    assert.strictEqual(Number(fittedRig.locationID), rigCandidate.activeShip.itemID);
    assert.strictEqual(Number(fittedRig.flagID), freeRigFlags[0]);
    assert(rejectedRig, "Expected calibration-rejected rig to remain in inventory");
    assert.strictEqual(Number(rejectedRig.locationID), rigCandidate.stationID);
    assert.strictEqual(Number(rejectedRig.flagID), ITEM_FLAGS.HANGAR);

    const capacityBefore = getCapacityNumbers(
      invBroker.Handle_GetCapacity([ITEM_FLAGS.CARGO_HOLD], cargoSession, {}),
    );
    const shipInfoBefore = dogma.Handle_ItemGetInfo(
      [cargoCandidate.activeShip.itemID],
      cargoSession,
    );
    const shipCapacityBefore = getAttributeValue(
      getInfoAttributes(shipInfoBefore),
      capacityAttributeID,
    );

    writeTemporaryItem(
      itemIDs.cargoMod,
      buildInventoryItem({
        itemID: itemIDs.cargoMod,
        typeID: expandedCargo.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: expandedCargo.name,
        singleton: 1,
      }),
    );
    invBroker.Handle_Add(
      [itemIDs.cargoMod, cargoCandidate.stationID],
      cargoSession,
      { flag: freeCargoLowFlags[1] },
    );
    dogma.Handle_SetModuleOnline(
      [cargoCandidate.activeShip.itemID, itemIDs.cargoMod],
      cargoSession,
    );
    const capacityAfter = getCapacityNumbers(
      invBroker.Handle_GetCapacity([ITEM_FLAGS.CARGO_HOLD], cargoSession, {}),
    );
    const shipInfoAfter = dogma.Handle_ItemGetInfo(
      [cargoCandidate.activeShip.itemID],
      cargoSession,
    );
    const shipCapacityAfter = getAttributeValue(
      getInfoAttributes(shipInfoAfter),
      capacityAttributeID,
    );
    assert(
      capacityAfter.capacity > capacityBefore.capacity,
      `Expected cargo capacity to increase after online passive fit (${capacityBefore.capacity} -> ${capacityAfter.capacity})`,
    );
    assert(
      shipCapacityAfter > shipCapacityBefore,
      `Expected dogma capacity attribute to increase (${shipCapacityBefore} -> ${shipCapacityAfter})`,
    );

    writeTemporaryItem(
      itemIDs.weapon,
      buildInventoryItem({
        itemID: itemIDs.weapon,
        typeID: weaponModule.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: weaponModule.name,
        singleton: 1,
      }),
    );
    writeTemporaryItem(
      itemIDs.chargeOne,
      buildInventoryItem({
        itemID: itemIDs.chargeOne,
        typeID: chargeType.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.activeShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: chargeType.name,
        quantity: 40,
        stacksize: 40,
        singleton: 0,
      }),
    );
    writeTemporaryItem(
      itemIDs.chargeTwo,
      buildInventoryItem({
        itemID: itemIDs.chargeTwo,
        typeID: chargeType.typeID,
        ownerID: cargoCandidate.characterID,
        locationID: cargoCandidate.activeShip.itemID,
        flagID: ITEM_FLAGS.CARGO_HOLD,
        itemName: chargeType.name,
        quantity: 40,
        stacksize: 40,
        singleton: 0,
      }),
    );
    invBroker.Handle_Add(
      [itemIDs.weapon, cargoCandidate.stationID],
      ammoSession,
      { flag: freeAmmoHighFlag },
    );
    dogma.Handle_LoadAmmo(
      [
        cargoCandidate.activeShip.itemID,
        [itemIDs.weapon],
        [itemIDs.chargeOne],
        cargoCandidate.activeShip.itemID,
      ],
      ammoSession,
    );
    dogma.Handle_LoadAmmo(
      [
        cargoCandidate.activeShip.itemID,
        [itemIDs.weapon],
        [itemIDs.chargeTwo],
        cargoCandidate.activeShip.itemID,
      ],
      ammoSession,
    );
    const loadedCharge = getLoadedChargeByFlag(
      cargoCandidate.characterID,
      cargoCandidate.activeShip.itemID,
      freeAmmoHighFlag,
    );
    assert(loadedCharge, "Expected a loaded charge stack after topoff");
    assert.strictEqual(Number(loadedCharge.stacksize), 80);
    assert.strictEqual(findItemById(itemIDs.chargeTwo), null);
  } finally {
    for (const itemID of tempItemIDs) {
      removeItemIfPresent(itemID);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    occupancyShipID: cargoCandidate.activeShip.itemID,
    hardpointShipID: hardpointCandidate.activeShip.itemID,
    rigShipID: rigCandidate.activeShip.itemID,
    cargoCapacityBefore: getShipBaseAttributeValue(cargoCandidate.activeShip.typeID, "capacity"),
    cargoCapacityAfterTested: true,
    ammoTopoffShipID: cargoCandidate.activeShip.itemID,
  }, null, 2));
}

main();

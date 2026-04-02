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
const {
  getCharacterRecord,
  getActiveShipRecord,
  getCharacterShips,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  findItemById,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  buildShipResourceState,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByName,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  isMachoWrappedException,
} = require(path.join(
  __dirname,
  "../../server/src/common/machoErrors",
));

function writeItemRecord(itemID, record) {
  const result = database.write("items", `/${itemID}`, record);
  assert(result.success, `Failed to write item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  const result = database.read("items", `/${itemID}`);
  if (result.success) {
    removeInventoryItem(itemID);
  }
}

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const activeShip = getActiveShipRecord(characterID);
      const dockedShip = (getCharacterShips(characterID) || []).find((ship) => {
        const stationID = Number(ship.locationID || 0);
        return (
          stationID > 0 &&
          Number(ship.flagID) === ITEM_FLAGS.HANGAR
        );
      });
      const ship = dockedShip || activeShip;
      if (!characterRecord || !ship) {
        return null;
      }

      const stationID = Number(
        characterRecord.stationID ||
        characterRecord.stationid ||
        ship.locationID ||
        0,
      );
      if (
        stationID <= 0 ||
        Number(ship.locationID) !== stationID ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR
      ) {
        return null;
      }

      const cargoCapacity = buildShipResourceState(
        characterID,
        ship,
      ).cargoCapacity;
      const cargoUsed = listContainerItems(
        characterID,
        ship.itemID,
        ITEM_FLAGS.CARGO_HOLD,
      ).reduce((sum, item) => {
        const units =
          Number(item.singleton) === 1
            ? 1
            : Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
        const volume = Math.max(0, Number(item.volume) || 0);
        return sum + (units * volume);
      }, 0);
      if (cargoCapacity - cargoUsed <= 1) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        cargoCapacity,
        cargoUsed,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked ship candidate");
  return candidates[0];
}

function buildSession(candidate) {
  const stationID = Number(
    candidate.characterRecord.stationID ||
    candidate.characterRecord.stationid ||
    candidate.ship.locationID ||
    0,
  );
  return {
    clientID: candidate.characterID + 9900,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    stationid: stationID,
    locationid: stationID,
    solarsystemid: Number(candidate.characterRecord.solarSystemID || 0) || 30000142,
    solarsystemid2: Number(candidate.characterRecord.solarSystemID || 0) || 30000142,
    socket: { destroyed: false },
    currentBoundObjectID: null,
  };
}

function extractBoundID(bound) {
  return bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
}

function getCapacityValues(capacityInfo) {
  const entries =
    capacityInfo &&
    capacityInfo.name === "util.KeyVal" &&
    capacityInfo.args &&
    capacityInfo.args.type === "dict" &&
    Array.isArray(capacityInfo.args.entries)
      ? capacityInfo.args.entries
      : [];
  const capacityEntry = entries.find(([key]) => key === "capacity");
  const usedEntry = entries.find(([key]) => key === "used");
  return {
    capacity: Number(capacityEntry ? capacityEntry[1] : 0) || 0,
    used: Number(usedEntry ? usedEntry[1] : 0) || 0,
  };
}

function main() {
  const candidate = getCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritaniumResult = resolveItemByName("Tritanium");
  assert(tritaniumResult && tritaniumResult.success, "Expected Tritanium type data");
  const tritanium = tritaniumResult.match;
  const cargoCapacity = candidate.cargoCapacity;
  const unitVolume = Number(tritanium.volume) || 0.01;
  const itemID = 990040001;

  try {
    const bound = service.Handle_GetInventoryFromId([candidate.ship.itemID], session);
    const boundID = extractBoundID(bound);
    assert(boundID, "Expected GetInventoryFromId to return a bound ship inventory");
    session.currentBoundObjectID = boundID;
    const capacitySnapshot = getCapacityValues(service.Handle_GetCapacity([], session, {
      type: "dict",
      entries: [
        ["flag", ITEM_FLAGS.CARGO_HOLD],
        ["machoVersion", 1],
      ],
    }));
    const freeCapacity = Math.max(0, capacitySnapshot.capacity - capacitySnapshot.used);
    const maxQuantity = Math.max(1, Math.floor(freeCapacity / unitVolume));
    const successfulQuantity = Math.max(1, maxQuantity - 1);
    const oversizedQuantity = maxQuantity + 100;

    writeItemRecord(itemID, buildInventoryItem({
      itemID,
      typeID: tritanium.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.characterRecord.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      singleton: 0,
      quantity: oversizedQuantity,
      stacksize: oversizedQuantity,
    }));
    let rejectedError = null;
    try {
      service.Handle_Add([itemID, Number(candidate.characterRecord.stationID)], session, {
        type: "dict",
        entries: [
          ["flag", ITEM_FLAGS.CARGO_HOLD],
          ["machoVersion", 1],
        ],
      });
    } catch (error) {
      rejectedError = error;
    }

    assert(rejectedError, "Expected oversized cargo move to be rejected");
    assert(
      isMachoWrappedException(rejectedError),
      "Expected oversized cargo move to throw a wrapped CCP-style user error",
    );
    assert.strictEqual(
      rejectedError.machoErrorResponse.payload.header[1][0],
      "NotEnoughCargoSpace",
      "Expected oversized cargo move to use NotEnoughCargoSpace",
    );

    const sourceAfterReject = findItemById(itemID);
    assert(sourceAfterReject, "Expected source stack to remain after rejected move");
    assert.strictEqual(
      Number(sourceAfterReject.locationID),
      Number(candidate.characterRecord.stationID),
      "Expected rejected move to leave the source stack in the station hangar",
    );

    const movedItemID = service.Handle_Add([itemID, Number(candidate.characterRecord.stationID)], session, {
      type: "dict",
      entries: [
        ["flag", ITEM_FLAGS.CARGO_HOLD],
        ["qty", successfulQuantity],
        ["machoVersion", 1],
      ],
    });
    assert(movedItemID, "Expected max-quantity retry to succeed");

    const movedItem = findItemById(movedItemID);
    assert(movedItem, "Expected moved cargo stack to exist");
    assert.strictEqual(
      Number(movedItem.locationID),
      Number(candidate.ship.itemID),
      "Expected moved stack to end up in ship cargo",
    );
    assert.strictEqual(
      Number(movedItem.flagID),
      Number(ITEM_FLAGS.CARGO_HOLD),
      "Expected moved stack to use cargo hold flag",
    );
    assert(
      (Number(movedItem.stacksize || movedItem.quantity || 0) || 0) <= successfulQuantity,
      "Expected moved stack quantity to stay within available cargo space",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      cargoCapacity,
      cargoUsed: capacitySnapshot.used,
      cargoFree: freeCapacity,
      unitVolume,
      maxQuantity,
      successfulQuantity,
      oversizedQuantity,
      movedItemID,
    }, null, 2));
  } finally {
    removeItemIfPresent(itemID);
  }
}

main();

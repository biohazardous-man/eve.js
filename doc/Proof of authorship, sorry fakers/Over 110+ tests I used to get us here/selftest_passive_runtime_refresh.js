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
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
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
  getShipSlotCounts,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeItemRecord(itemID, record) {
  const result = database.write("items", `/${itemID}`, record);
  assert(result.success, `Failed to write item ${itemID}`);
}

function removeItemIfPresent(itemID) {
  const result = database.read("items", `/${itemID}`);
  if (result.success) {
    database.remove("items", `/${itemID}`);
  }
}

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship) {
        return null;
      }

      const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
      const slots = getShipSlotCounts(ship.typeID);
      if (
        stationID <= 0 ||
        Number(ship.locationID) !== stationID ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR ||
        slots.low <= 0
      ) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked ship with at least one low slot");
  return candidates[0];
}

function buildSession(candidate) {
  const notifications = [];
  return {
    clientID: candidate.characterID + 9500,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.warFactionID) || 0,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    shipName: candidate.ship.itemName,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function main() {
  runtime._testing.clearScenes();

  const candidate = getCandidate();
  const overdrive = resolveExactItem("Overdrive Injector System I");
  const tempItemID = 990010001;
  const session = buildSession(candidate);
  const previousShipRecord = clone(findItemById(candidate.ship.itemID));
  let attached = false;

  try {
    runtime.attachSession(session, candidate.ship, {
      systemID: 30000142,
      broadcast: false,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    attached = true;
    session._space.initialStateSent = true;
    const scene = runtime.getSceneForSession(session);
    const entity = scene.getShipEntityForSession(session);
    assert(entity, "Expected active ship entity after attach");

    const baselineMaxVelocity = entity.maxVelocity;

    writeItemRecord(tempItemID, buildInventoryItem({
      itemID: tempItemID,
      typeID: overdrive.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.ship.itemID,
      flagID: 11,
      singleton: 1,
      moduleState: {
        online: true,
      },
    }));

    const onlineRefresh = runtime.refreshShipDerivedState(session, {
      broadcast: false,
    });
    assert.strictEqual(onlineRefresh.success, true, "Expected passive refresh to succeed");
    const onlineMaxVelocity = entity.maxVelocity;
    assert(
      onlineMaxVelocity > baselineMaxVelocity,
      "Expected in-space passive refresh to increase max velocity",
    );

    writeItemRecord(tempItemID, buildInventoryItem({
      itemID: tempItemID,
      typeID: overdrive.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.ship.itemID,
      flagID: 11,
      singleton: 1,
      moduleState: {
        online: false,
      },
    }));

    const offlineRefresh = runtime.refreshShipDerivedState(session, {
      broadcast: false,
    });
    assert.strictEqual(offlineRefresh.success, true, "Expected offline refresh to succeed");
    assert(
      entity.maxVelocity < onlineMaxVelocity + 1e-6,
      "Expected offlining the passive module to reduce max velocity",
    );
    assert(
      Math.abs(entity.maxVelocity - baselineMaxVelocity) < 1e-6,
      "Expected offlining to restore the baseline max velocity",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      baselineMaxVelocity,
      onlineMaxVelocity,
      offlineMaxVelocity: entity.maxVelocity,
    }, null, 2));
  } finally {
    removeItemIfPresent(tempItemID);
    if (attached && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
    writeItemRecord(candidate.ship.itemID, previousShipRecord);
  }
}

main();

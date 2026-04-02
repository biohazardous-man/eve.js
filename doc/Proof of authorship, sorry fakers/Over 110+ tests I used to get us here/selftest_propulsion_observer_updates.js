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
const DogmaService = require(path.join(
  __dirname,
  "../../server/src/services/dogma/dogmaService",
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

function getCandidates() {
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
        slots.med <= 0
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

  assert(candidates.length >= 2, "Expected at least two docked ships with med slots");
  return [candidates[0], candidates[1]];
}

function buildSession(candidate, clientOffset) {
  const notifications = [];
  return {
    clientID: candidate.characterID + clientOffset,
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

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

function main() {
  runtime._testing.clearScenes();

  const [pilotCandidate, observerCandidate] = getCandidates();
  const microwarpdrive = resolveExactItem("5MN Microwarpdrive I");
  const tempItemID = 990040001;
  const pilotSession = buildSession(pilotCandidate, 9800);
  const observerSession = buildSession(observerCandidate, 9900);
  const dogma = new DogmaService();
  const previousPilotShipRecord = clone(findItemById(pilotCandidate.ship.itemID));
  const previousObserverShipRecord = clone(findItemById(observerCandidate.ship.itemID));
  let pilotAttached = false;
  let observerAttached = false;

  try {
    writeItemRecord(tempItemID, buildInventoryItem({
      itemID: tempItemID,
      typeID: microwarpdrive.typeID,
      ownerID: pilotCandidate.characterID,
      locationID: pilotCandidate.ship.itemID,
      flagID: 19,
      singleton: 1,
      moduleState: {
        online: true,
      },
    }));

    runtime.attachSession(pilotSession, pilotCandidate.ship, {
      systemID: 30000142,
      broadcast: false,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    pilotAttached = true;
    runtime.attachSession(observerSession, observerCandidate.ship, {
      systemID: 30000142,
      broadcast: false,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    observerAttached = true;

    pilotSession._space.initialStateSent = true;
    observerSession._space.initialStateSent = true;
    pilotSession._space.visibleDynamicEntityIDs = new Set([observerCandidate.ship.itemID]);
    observerSession._space.visibleDynamicEntityIDs = new Set([pilotCandidate.ship.itemID]);
    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const pilotScene = runtime.getSceneForSession(pilotSession);
    const pilotEntity = pilotScene.getShipEntityForSession(pilotSession);
    assert(pilotEntity, "Expected pilot ship entity after attach");
    const baselineMaxVelocity = pilotEntity.maxVelocity;

    const capSet = runtime.setShipCapacitorRatio(pilotSession, 1.0);
    assert.strictEqual(capSet.success, true, "Expected full capacitor setup to succeed");

    const activationResult = dogma.Handle_Activate(
      [tempItemID, "effects.MicroWarpDrive", null, 1],
      pilotSession,
    );
    assert.strictEqual(activationResult, 1, "Expected observer test propulsion activation to succeed");
    assert(
      pilotEntity.maxVelocity > baselineMaxVelocity,
      "Expected pilot max velocity to increase after propulsion activation",
    );

    const observerPayloadNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(
      observerPayloadNames.includes("SetMaxSpeed"),
      "Expected observer to receive the propulsion speed-cap update",
    );
    assert(
      observerPayloadNames.includes("SetBallMass"),
      "Expected observer to receive the propulsion mass update",
    );
    assert(
      observerPayloadNames.includes("OnSpecialFX"),
      "Expected observer to receive the propulsion special FX update",
    );

    console.log(JSON.stringify({
      ok: true,
      pilotCharacterID: pilotCandidate.characterID,
      observerCharacterID: observerCandidate.characterID,
      shipID: pilotCandidate.ship.itemID,
      moduleID: tempItemID,
      observerPayloadNames,
    }, null, 2));
  } finally {
    removeItemIfPresent(tempItemID);
    if (pilotAttached && pilotSession._space) {
      runtime.detachSession(pilotSession, { broadcast: false });
    }
    if (observerAttached && observerSession._space) {
      runtime.detachSession(observerSession, { broadcast: false });
    }
    runtime._testing.clearScenes();
    writeItemRecord(pilotCandidate.ship.itemID, previousPilotShipRecord);
    writeItemRecord(observerCandidate.ship.itemID, previousObserverShipRecord);
  }
}

main();

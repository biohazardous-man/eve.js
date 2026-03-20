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
  isModuleOnline,
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
    clientID: candidate.characterID + 9600,
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
  const passiveModule = resolveExactItem("Co-Processor I");
  const tempItemID = 990020001;
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const previousShipRecord = clone(findItemById(candidate.ship.itemID));
  let attached = false;

  try {
    writeItemRecord(tempItemID, buildInventoryItem({
      itemID: tempItemID,
      typeID: passiveModule.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.ship.itemID,
      flagID: 11,
      singleton: 1,
      moduleState: {
        online: false,
      },
    }));

    runtime.attachSession(session, candidate.ship, {
      systemID: 30000142,
      broadcast: false,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    attached = true;
    session._space.initialStateSent = true;

    let capSet = runtime.setShipCapacitorRatio(session, 0.94);
    assert.strictEqual(capSet.success, true, "Expected low capacitor setup to succeed");

    let activationResult = dogma.Handle_Activate([tempItemID, "online"], session);
    assert.strictEqual(
      activationResult,
      null,
      "Expected onlining to be rejected below the in-space capacitor threshold",
    );
    assert.strictEqual(
      isModuleOnline(findItemById(tempItemID)),
      false,
      "Expected module to remain offline after rejection",
    );

    capSet = runtime.setShipCapacitorRatio(session, 1.0);
    assert.strictEqual(capSet.success, true, "Expected full capacitor setup to succeed");

    activationResult = dogma.Handle_Activate([tempItemID, "online"], session);
    assert.strictEqual(activationResult, 1, "Expected onlining to succeed with full capacitor");
    assert.strictEqual(
      isModuleOnline(findItemById(tempItemID)),
      true,
      "Expected module to become online after successful activation",
    );

    const capacitorState = runtime.getShipCapacitorState(session);
    assert(capacitorState, "Expected capacitor state after onlining");
    assert(
      Math.abs(Number(capacitorState.ratio) - 0.05) < 1e-6,
      "Expected in-space onlining to drop capacitor to the remainder ratio",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      moduleID: tempItemID,
      capacitorRatioAfterOnline: capacitorState.ratio,
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

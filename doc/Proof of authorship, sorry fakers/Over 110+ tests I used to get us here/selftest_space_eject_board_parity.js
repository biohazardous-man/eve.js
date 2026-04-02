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
const destiny = require(path.join(
  __dirname,
  "../../server/src/space/destiny",
));
const transitions = require(path.join(
  __dirname,
  "../../server/src/space/transitions",
));
const ShipService = require(path.join(
  __dirname,
  "../../server/src/services/ship/shipService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  CAPSULE_TYPE_ID,
  ITEM_FLAGS,
  normalizeInventoryItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPilotSession(candidate) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: candidate.characterID + 9200,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    characterName: candidate.characterRecord.characterName,
    corporationID: Number(candidate.characterRecord.corporationID) || 0,
    allianceID: Number(candidate.characterRecord.allianceID) || 0,
    warFactionID: Number(candidate.characterRecord.warFactionID) || 0,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    stationid2: candidate.stationID,
    locationid: candidate.stationID,
    solarsystemid: null,
    solarsystemid2: candidate.solarSystemID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    shipName: candidate.ship.itemName,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function buildObserverSession(systemID, position) {
  const notifications = [];
  return {
    clientID: 998100,
    characterID: 998101,
    charid: 998101,
    userid: 998101,
    characterName: "observer",
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    shipID: 998102,
    shipid: 998102,
    activeShipID: 998102,
    shipTypeID: 606,
    shipName: "observer-ship",
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
    shipItem: {
      itemID: 998102,
      typeID: 606,
      ownerID: 998101,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: -1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function extractDestinyUpdates(notifications) {
  return notifications.flatMap((notification) => {
    const payload = (((notification || {}).payload || [])[0] || {});
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((entry) => ({
      stamp: entry[0],
      name: entry[1][0],
      args: entry[1][1],
    }));
  });
}

function containsStructuredValue(value, target, seen = new Set()) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return false;
  }
  if (typeof value === "number") {
    return Number(value) === Number(target);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsStructuredValue(entry, target, seen));
  }
  return Object.values(value).some((entry) =>
    containsStructuredValue(entry, target, seen),
  );
}

function getDockedNonCapsuleCandidate() {
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
      if (
        stationID <= 0 ||
        Number(ship.locationID) !== stationID ||
        Number(ship.flagID) !== ITEM_FLAGS.HANGAR ||
        Number(ship.typeID) === CAPSULE_TYPE_ID
      ) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        stationID,
        solarSystemID: Number(
          characterRecord.solarSystemID ||
            characterRecord.solarsystemid ||
            30000142,
        ),
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected a docked non-capsule character");
  return candidates[0];
}

function captureOwnedItems(characterID) {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items");
  const snapshot = new Map();
  for (const [itemID, rawItem] of Object.entries(itemsResult.data || {})) {
    const item = normalizeInventoryItem(rawItem);
    if (!item || Number(item.ownerID) !== characterID) {
      continue;
    }
    snapshot.set(Number(itemID), clone(rawItem));
  }
  return snapshot;
}

function restoreOwnedItems(characterID, snapshot) {
  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items for restore");
  for (const [itemID, rawItem] of Object.entries(itemsResult.data || {})) {
    const item = normalizeInventoryItem(rawItem);
    if (!item || Number(item.ownerID) !== characterID) {
      continue;
    }
    if (!snapshot.has(Number(itemID))) {
      const removeResult = database.remove("items", `/${itemID}`);
      assert(removeResult.success, `Failed to remove temporary item ${itemID}`);
    }
  }

  for (const [itemID, record] of snapshot.entries()) {
    const writeResult = database.write("items", `/${itemID}`, record);
    assert(writeResult.success, `Failed to restore item ${itemID}`);
  }
}

function main() {
  runtime._testing.clearScenes();

  const candidate = getDockedNonCapsuleCandidate();
  const pilotSession = buildPilotSession(candidate);
  const shipService = new ShipService();
  const previousCharacterRecord = clone(candidate.characterRecord);
  const ownedItemSnapshot = captureOwnedItems(candidate.characterID);

  let observerSession = null;

  try {
    const undockResult = transitions.undockSession(pilotSession);
    assert.strictEqual(undockResult.success, true, "Expected undock to succeed");
    assert.strictEqual(runtime.ensureInitialBallpark(pilotSession), true);
    pilotSession.notifications.length = 0;

    const scene = runtime.getSceneForSession(pilotSession);
    assert(scene, "Expected pilot scene after undock");

    const pilotEntityBeforeEject = scene.getEntityByID(candidate.ship.itemID);
    assert(pilotEntityBeforeEject, "Expected pilot ship entity before eject");

    observerSession = buildObserverSession(candidate.solarSystemID, {
      x: pilotEntityBeforeEject.position.x + 1000,
      y: pilotEntityBeforeEject.position.y,
      z: pilotEntityBeforeEject.position.z,
    });
    runtime.attachSession(observerSession, observerSession.shipItem, {
      systemID: candidate.solarSystemID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.strictEqual(runtime.ensureInitialBallpark(observerSession), true);
    scene.syncDynamicVisibilityForAllSessions();
    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const capsuleID = shipService.Handle_Eject([], pilotSession, {});
    assert(Number(capsuleID) > 0, "Expected eject to return a capsule itemID");

    const activeAfterEject = getActiveShipRecord(candidate.characterID);
    assert(activeAfterEject, "Expected active ship after eject");
    assert.strictEqual(
      Number(activeAfterEject.typeID),
      CAPSULE_TYPE_ID,
      "Expected pilot to board a capsule on eject",
    );
    assert.strictEqual(
      Number(activeAfterEject.itemID),
      Number(capsuleID),
      "Expected active capsule to match eject result",
    );

    const abandonedShipEntity = scene.getEntityByID(candidate.ship.itemID);
    const capsuleEntity = scene.getEntityByID(Number(capsuleID));
    assert(abandonedShipEntity, "Expected abandoned hull to remain in space");
    assert(capsuleEntity, "Expected capsule to exist in space");
    assert.strictEqual(
      abandonedShipEntity.session,
      null,
      "Expected abandoned hull to be sessionless after eject",
    );
    assert.strictEqual(
      Number(abandonedShipEntity.characterID),
      0,
      "Expected abandoned hull to clear pilot characterID",
    );
    assert.strictEqual(
      destiny.debugDescribeEntityBall(abandonedShipEntity).summary.flags.isInteractive,
      false,
      "Expected abandoned hull to become non-interactive after eject",
    );
    assert.strictEqual(
      capsuleEntity.session,
      pilotSession,
      "Expected capsule entity to become the active session ship",
    );
    assert.strictEqual(
      Number(abandonedShipEntity.bubbleID),
      Number(capsuleEntity.bubbleID),
      "Expected eject to keep the hull and capsule in the same live bubble",
    );

    const ejectObserverUpdates = extractDestinyUpdates(observerSession.notifications);
    assert(
      ejectObserverUpdates.some((entry) => entry.name === "OnSpecialFX" && entry.args[5] === "effects.ShipEjector"),
      "Expected observer to receive ShipEjector FX on eject",
    );
    assert(
      ejectObserverUpdates.some((entry) => entry.name === "OnSpecialFX" && entry.args[5] === "effects.CapsuleFlare"),
      "Expected observer to receive CapsuleFlare FX on eject",
    );
    assert(
      ejectObserverUpdates.some((entry) => entry.name === "AddBalls2"),
      "Expected observer to receive AddBalls2 for the new capsule",
    );
    assert(
      ejectObserverUpdates.some(
        (entry) =>
          entry.name === "AddBalls2" &&
          containsStructuredValue(entry.args, Number(capsuleID)),
      ),
      "Expected observer AddBalls2 to include the new capsule ball",
    );
    assert(
      ejectObserverUpdates.some(
        (entry) =>
          entry.name === "AddBalls2" &&
          containsStructuredValue(entry.args, Number(candidate.ship.itemID)),
      ),
      "Expected observer AddBalls2 to refresh the abandoned hull boardable state",
    );

    const pilotUpdatesAfterEject = extractDestinyUpdates(pilotSession.notifications);
    assert(
      pilotUpdatesAfterEject.some((entry) => entry.name === "AddBalls2"),
      "Expected pilot to reacquire nearby balls after eject",
    );
    assert(
      pilotUpdatesAfterEject.some(
        (entry) =>
          entry.name === "AddBalls2" &&
          containsStructuredValue(entry.args, Number(capsuleID)),
      ),
      "Expected pilot AddBalls2 to include the new capsule ego ball after eject",
    );
    assert(
      pilotUpdatesAfterEject.some(
        (entry) =>
          entry.name === "AddBalls2" &&
          containsStructuredValue(entry.args, Number(candidate.ship.itemID)),
      ),
      "Expected pilot AddBalls2 to refresh the abandoned hull after eject",
    );
    assert(
      pilotUpdatesAfterEject.some((entry) => entry.name === "SetState"),
      "Expected pilot to receive a full SetState refresh after eject",
    );

    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const boardResponse = shipService.Handle_Board(
      [candidate.ship.itemID, capsuleID],
      pilotSession,
      {},
    );
    assert(Array.isArray(boardResponse), "Expected board to return activation tuple");
    assert.strictEqual(boardResponse.length, 4, "Expected 4-slot activation tuple on board");

    const activeAfterBoard = getActiveShipRecord(candidate.characterID);
    assert(activeAfterBoard, "Expected active ship after board");
    assert.strictEqual(
      Number(activeAfterBoard.itemID),
      Number(candidate.ship.itemID),
      "Expected pilot to board the abandoned hull again",
    );

    const boardedShipEntity = scene.getEntityByID(candidate.ship.itemID);
    const abandonedCapsuleEntity = scene.getEntityByID(Number(capsuleID));
    assert.strictEqual(
      boardedShipEntity,
      abandonedShipEntity,
      "Expected boarded hull to reuse the existing ship ball instead of respawning",
    );
    assert.strictEqual(
      boardedShipEntity.session,
      pilotSession,
      "Expected boarded hull to become the active session ship",
    );
    assert.strictEqual(
      Number(boardedShipEntity.characterID),
      candidate.characterID,
      "Expected boarded hull to restore the pilot characterID",
    );
    assert.strictEqual(
      destiny.debugDescribeEntityBall(boardedShipEntity).summary.flags.isInteractive,
      true,
      "Expected boarded hull to become interactive again after boarding",
    );
    assert(abandonedCapsuleEntity, "Expected old capsule to remain in space");
    assert.strictEqual(
      abandonedCapsuleEntity.session,
      null,
      "Expected old capsule to remain sessionless after boarding the hull",
    );
    assert.strictEqual(
      destiny.debugDescribeEntityBall(abandonedCapsuleEntity).summary.flags.isInteractive,
      false,
      "Expected abandoned capsule to be non-interactive after boarding away",
    );
    assert.strictEqual(
      Number(boardedShipEntity.bubbleID),
      Number(abandonedCapsuleEntity.bubbleID),
      "Expected board to keep the swapped ships in the same live bubble",
    );

    const boardObserverUpdates = extractDestinyUpdates(observerSession.notifications);
    assert(
      boardObserverUpdates.some((entry) => entry.name === "OnSlimItemChange"),
      "Expected observer to receive slim changes during board",
    );
    assert(
      !boardObserverUpdates.some(
        (entry) =>
          entry.name === "RemoveBalls" &&
          entry.args[0] &&
          Array.isArray(entry.args[0].items) &&
          entry.args[0].items.includes(candidate.ship.itemID),
      ),
      "Expected boarded hull to stay live instead of being removed and respawned",
    );
    assert(
      boardObserverUpdates.some(
        (entry) =>
          entry.name === "AddBalls2" &&
          containsStructuredValue(entry.args, Number(candidate.ship.itemID)),
      ),
      "Expected observer AddBalls2 to refresh the boarded hull occupied state",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      originalShipID: candidate.ship.itemID,
      capsuleID: Number(capsuleID),
      ejectObserverUpdates: ejectObserverUpdates.map((entry) => entry.name),
      boardObserverUpdates: boardObserverUpdates.map((entry) => entry.name),
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    if (observerSession) {
      runtime.detachSession(observerSession, { broadcast: false });
    }
    restoreOwnedItems(candidate.characterID, ownedItemSnapshot);
    const charRestoreResult = database.write(
      "characters",
      `/${candidate.characterID}`,
      previousCharacterRecord,
    );
    assert(charRestoreResult.success, `Failed to restore character ${candidate.characterID}`);
  }
}

main();

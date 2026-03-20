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
  spawnShipDeathTestField,
} = require(path.join(
  __dirname,
  "../../server/src/space/shipDestruction",
));
const {
  getCharacterRecord,
  getCharacterShips,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = (getCharacterShips(characterID) || []).find((entry) => (
        Number(entry.flagID) === ITEM_FLAGS.HANGAR &&
        Number(entry.locationID || 0) > 0
      ));
      if (!characterRecord || !ship) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
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
    clientID: candidate.characterID + 9810,
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
    stationid: stationID,
    locationid: stationID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
}

function flattenDestinyUpdates(notifications) {
  const updates = [];
  for (const notification of notifications || []) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    const functions = [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      functions.push({
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
    updates.push(functions);
  }
  return updates;
}

async function main() {
  runtime._testing.clearScenes();

  const candidate = getCandidate();
  const session = buildSession(candidate);
  let attached = false;
  const cleanupWreckIDs = [];

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
    assert(scene, "Expected an attached scene");

    const spawnResult = spawnShipDeathTestField(session, {
      count: 3,
      delayMs: 0,
    });
    assert.strictEqual(
      spawnResult.success,
      true,
      "Expected death-test hull spawning to succeed",
    );
    assert.strictEqual(
      spawnResult.data.spawned.length,
      3,
      "Expected death-test helper to spawn the requested hull count",
    );

    const completion = await spawnResult.data.completionPromise;
    assert(
      completion &&
      completion.destroyed.length === 3,
      "Expected all death-test hulls to convert into wrecks",
    );

    for (const entry of completion.destroyed) {
      assert.strictEqual(
        scene.getEntityByID(entry.shipID),
        null,
        "Expected exploded death-test hulls to be removed from the scene",
      );
      const wreckEntity = scene.getEntityByID(entry.wreckID);
      assert(
        wreckEntity && wreckEntity.kind === "wreck",
        "Expected each exploded death-test hull to leave a wreck entity",
      );
      assert.strictEqual(
        Number(wreckEntity.launcherID),
        Number(entry.shipID),
        "Expected each wreck to point back at the destroyed ship ball via launcherID",
      );
      cleanupWreckIDs.push(entry.wreckID);
    }

    const groupedUpdates = flattenDestinyUpdates(session.notifications);
    assert(
      groupedUpdates.some((group) => (
        group.some((entry) => entry.name === "TerminalPlayDestructionEffect") &&
        group.some((entry) => entry.name === "RemoveBalls")
      )),
      "Expected ship death to use Michelle's native TerminalPlayDestructionEffect + RemoveBalls path",
    );
    const bridgeFx = groupedUpdates
      .flat()
      .filter((entry) => entry.name === "OnSpecialFX")
      .map((entry) => String(entry.args[5] || ""));
    assert(
      !bridgeFx.includes("effects.ShipEjector") &&
      !bridgeFx.includes("effects.CapsuleFlare"),
      "Expected native destruction flow to replace the temporary ShipEjector/CapsuleFlare bridge FX",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      spawnedCount: spawnResult.data.spawned.length,
      wreckIDs: cleanupWreckIDs,
    }, null, 2));
  } finally {
    for (const wreckID of cleanupWreckIDs) {
      runtime.destroyDynamicInventoryEntity(30000142, wreckID, {
        removeContents: true,
      });
    }
    if (attached && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

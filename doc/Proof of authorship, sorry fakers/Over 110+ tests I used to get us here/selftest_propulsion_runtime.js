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
  spawnDebrisFieldForSession,
  clearNearbyDebrisForSession,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/spaceDebrisState",
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
  getAttributeIDByNames,
  getEffectIDByNames,
  getShipSlotCounts,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

const EFFECT_AFTERBURNER = getEffectIDByNames("moduleBonusAfterburner") || 6731;
const EFFECT_MICROWARPDRIVE = getEffectIDByNames("moduleBonusMicrowarpdrive") || 6730;
const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_SIGNATURE_RADIUS = getAttributeIDByNames("signatureRadius") || 552;
const ATTRIBUTE_SPEED_FACTOR = getAttributeIDByNames("speedFactor") || 20;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function distance(left, right) {
  const dx = Number(left && left.x || 0) - Number(right && right.x || 0);
  const dy = Number(left && left.y || 0) - Number(right && right.y || 0);
  const dz = Number(left && left.z || 0) - Number(right && right.z || 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function magnitude(vector) {
  const x = Number(vector && vector.x || 0);
  const y = Number(vector && vector.y || 0);
  const z = Number(vector && vector.z || 0);
  return Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
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
        slots.med < 2
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

  assert(candidates.length > 0, "Expected a docked ship with at least two med slots");
  return candidates[0];
}

function buildSession(candidate) {
  const notifications = [];
  return {
    clientID: candidate.characterID + 9700,
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

function getDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getKeyValField(keyVal, key) {
  const entries =
    keyVal &&
    keyVal.name === "util.KeyVal" &&
    keyVal.args &&
    keyVal.args.type === "dict"
      ? keyVal.args.entries
      : [];
  const entry = entries.find(([entryKey]) => entryKey === key);
  return entry ? entry[1] : null;
}

function getActiveEffectIDs(itemInfo) {
  return getDictEntries(getKeyValField(itemInfo, "activeEffects"))
    .map(([effectID]) => Number(effectID) || 0)
    .filter((effectID) => effectID > 0)
    .sort((left, right) => left - right);
}

function getActiveEffectLine(itemInfo, effectID) {
  const entry = getDictEntries(getKeyValField(itemInfo, "activeEffects"))
    .find(([entryEffectID]) => Number(entryEffectID) === Number(effectID));
  return entry ? entry[1] : null;
}

function unwrapMarshalNumber(value) {
  if (value && typeof value === "object" && value.type === "real") {
    return Number(value.value);
  }
  return Number(value);
}

function findEffectNotification(session, moduleID, effectID, start) {
  return [...session.notifications]
    .reverse()
    .find((entry) =>
      entry &&
      entry.name === "OnGodmaShipEffect" &&
      Array.isArray(entry.payload) &&
      Number(entry.payload[0]) === Number(moduleID) &&
      Number(entry.payload[1]) === Number(effectID) &&
      Number(entry.payload[3]) === Number(start)
    ) || null;
}

function listEffectNotifications(session, moduleID, effectID, start) {
  return (session.notifications || []).filter((entry) =>
    entry &&
    entry.name === "OnGodmaShipEffect" &&
    Array.isArray(entry.payload) &&
    Number(entry.payload[0]) === Number(moduleID) &&
    Number(entry.payload[1]) === Number(effectID) &&
    Number(entry.payload[3]) === Number(start)
  );
}

function getNotificationItems(payloadEntry) {
  const payload = payloadEntry && Array.isArray(payloadEntry.payload)
    ? payloadEntry.payload[0]
    : null;
  if (payload && payload.type === "list" && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function findAttributeNotification(session, itemID, attributeID) {
  for (const entry of [...session.notifications].reverse()) {
    if (!entry || entry.name !== "OnModuleAttributeChanges") {
      continue;
    }
    const match = getNotificationItems(entry).find((change) =>
      Array.isArray(change) &&
      Number(change[2]) === Number(itemID) &&
      Number(change[3]) === Number(attributeID)
    );
    if (match) {
      return match;
    }
  }
  return null;
}

function main() {
  runtime._testing.clearScenes();

  const candidate = getCandidate();
  const afterburner = resolveExactItem("1MN Afterburner I");
  const microwarpdrive = resolveExactItem("5MN Microwarpdrive I");
  const afterburnerItemID = 990030001;
  const microwarpdriveItemID = 990030002;
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const previousShipRecord = clone(findItemById(candidate.ship.itemID));
  let attached = false;

  try {
    writeItemRecord(afterburnerItemID, buildInventoryItem({
      itemID: afterburnerItemID,
      typeID: afterburner.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.ship.itemID,
      flagID: 19,
      singleton: 1,
      moduleState: {
        online: true,
      },
    }));
    writeItemRecord(microwarpdriveItemID, buildInventoryItem({
      itemID: microwarpdriveItemID,
      typeID: microwarpdrive.typeID,
      ownerID: candidate.characterID,
      locationID: candidate.ship.itemID,
      flagID: 20,
      singleton: 1,
      moduleState: {
        online: true,
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

    const scene = runtime.getSceneForSession(session);
    const entity = scene.getShipEntityForSession(session);
    assert(entity, "Expected active ship entity after attach");

    const baselineStats = {
      maxVelocity: entity.maxVelocity,
      mass: entity.mass,
      signatureRadius: entity.signatureRadius,
    };

    let capSet = runtime.setShipCapacitorRatio(session, 1.0);
    assert.strictEqual(capSet.success, true, "Expected full capacitor setup to succeed");

    let activationResult = dogma.Handle_Activate(
      [afterburnerItemID, "effects.Afterburner", null, 1],
      session,
    );
    assert.strictEqual(activationResult, 1, "Expected afterburner activation to succeed");

    let afterburnerEffect = runtime.getActiveModuleEffect(session, afterburnerItemID);
    assert(afterburnerEffect, "Expected afterburner effect state after activation");
    assert(
      entity.maxVelocity > baselineStats.maxVelocity,
      "Expected afterburner to increase max velocity",
    );
    assert(
      entity.mass >= baselineStats.mass,
      "Expected afterburner mass addition to be reflected on the entity",
    );

    let capacitorState = runtime.getShipCapacitorState(session);
    assert(capacitorState, "Expected capacitor state after afterburner activation");
    const capacitorRatioAfterAbStart = Number(capacitorState.ratio);
    assert(
      capacitorRatioAfterAbStart < 1.0,
      "Expected afterburner activation to consume capacitor immediately",
    );

    let afterburnerInfo = dogma.Handle_ItemGetInfo([afterburnerItemID], session);
    const afterburnerEffectIDs = getActiveEffectIDs(afterburnerInfo);
    assert(
      afterburnerEffectIDs.includes(EFFECT_AFTERBURNER),
      "Expected ItemGetInfo activeEffects to include the propulsion effect",
    );
    const afterburnerEffectLine = getActiveEffectLine(afterburnerInfo, EFFECT_AFTERBURNER);
    assert(afterburnerEffectLine, "Expected activeEffects entry for the afterburner");
    assert(
      typeof afterburnerEffectLine[7] === "bigint",
      "Expected active afterburner effect start time to be serialized as FILETIME",
    );
    assert.strictEqual(
      unwrapMarshalNumber(afterburnerEffectLine[8]),
      Number(afterburnerEffect.durationMs),
      "Expected ItemGetInfo to expose the afterburner cycle duration",
    );
    const afterburnerActivationNotification = findEffectNotification(
      session,
      afterburnerItemID,
      EFFECT_AFTERBURNER,
      1,
    );
    assert(
      afterburnerActivationNotification,
      "Expected a propulsion activation OnGodmaShipEffect notification",
    );
    assert(
      typeof afterburnerActivationNotification.payload[6] === "bigint",
      "Expected propulsion activation notifications to include FILETIME startTime",
    );
    assert.strictEqual(
      unwrapMarshalNumber(afterburnerActivationNotification.payload[7]),
      Number(afterburnerEffect.durationMs),
      "Expected propulsion activation notifications to include cycle duration",
    );

    runtime.gotoDirection(session, { x: 1, y: 0, z: 0 });
    runtime.setSpeedFraction(session, 1);
    scene.lastTickAt = Date.now() - 1000;
    for (let index = 0; index < 6; index += 1) {
      scene.tick(Date.now() + ((index + 1) * 1000));
    }
    const speedBeforeAfterburnerStop = magnitude(entity.velocity);
    assert(
      speedBeforeAfterburnerStop > baselineStats.maxVelocity,
      "Expected afterburner test run to accelerate above the ship's passive speed cap",
    );

    let deactivateResult = dogma.Handle_Deactivate(
      [afterburnerItemID, "effects.Afterburner"],
      session,
    );
    assert.strictEqual(deactivateResult, 1, "Expected afterburner deactivation to succeed");
    let pendingAfterburnerStop = runtime.getActiveModuleEffect(session, afterburnerItemID);
    assert(
      pendingAfterburnerStop,
      "Expected afterburner deactivation to wait for the current cycle boundary",
    );
    assert(
      Number(pendingAfterburnerStop.deactivateAtMs) > Date.now(),
      "Expected manual propulsion deactivation to schedule a future stop time",
    );
    assert.strictEqual(
      findEffectNotification(session, afterburnerItemID, EFFECT_AFTERBURNER, 0),
      null,
      "Expected no immediate propulsion stop notification before the current cycle ends",
    );
    scene.tick(Number(pendingAfterburnerStop.deactivateAtMs) - 50);
    assert(
      runtime.getActiveModuleEffect(session, afterburnerItemID),
      "Expected afterburner to remain active until the scheduled cycle boundary",
    );
    scene.tick(Number(pendingAfterburnerStop.deactivateAtMs) + 25);
    assert.strictEqual(
      runtime.getActiveModuleEffect(session, afterburnerItemID),
      null,
      "Expected afterburner effect to be removed at the cycle boundary",
    );
    assert(
      Math.abs(entity.maxVelocity - baselineStats.maxVelocity) < 1e-6,
      "Expected afterburner deactivation to restore baseline max velocity",
    );
    const speedImmediatelyAfterAfterburnerStop = magnitude(entity.velocity);
    assert(
      speedImmediatelyAfterAfterburnerStop > entity.maxVelocity + 1,
      "Expected propulsion shutdown to leave the ship overspeeding briefly so it can decelerate naturally",
    );
    scene.tick(Number(pendingAfterburnerStop.deactivateAtMs) + 1025);
    assert(
      magnitude(entity.velocity) < speedImmediatelyAfterAfterburnerStop,
      "Expected ship speed to decay naturally after propulsion shutdown instead of snapping instantly",
    );
    const afterburnerStopNotification = findEffectNotification(
      session,
      afterburnerItemID,
      EFFECT_AFTERBURNER,
      0,
    );
    assert(
      afterburnerStopNotification,
      "Expected a propulsion stop OnGodmaShipEffect notification once the cycle actually ends",
    );

    const preMicrowarpPosition = clone(entity.position);
    runtime.gotoDirection(session, { x: 1, y: 0, z: 0 });
    runtime.setSpeedFraction(session, 1);
    assert(
      entity.mode === "GOTO" && entity.speedFraction >= 0.999,
      "Expected propulsion test ship to hold a commanded full-speed subwarp state",
    );

    activationResult = dogma.Handle_Activate(
      [microwarpdriveItemID, "effects.MicroWarpDrive", null, 1],
      session,
    );
    assert.strictEqual(activationResult, 1, "Expected microwarpdrive activation to succeed");
    assert(
      entity.speedFraction >= 0.999,
      "Expected microwarpdrive activation to preserve the commanded speed fraction",
    );

    let microwarpEffect = runtime.getActiveModuleEffect(session, microwarpdriveItemID);
    assert(microwarpEffect, "Expected microwarpdrive effect state after activation");
    const microwarpCycleStartedAtMs = Number(microwarpEffect.startedAtMs);
    assert(
      entity.maxVelocity > baselineStats.maxVelocity,
      "Expected microwarpdrive to increase max velocity",
    );
    assert(
      entity.mass > baselineStats.mass,
      "Expected microwarpdrive to increase ship mass while active",
    );
    assert(
      entity.signatureRadius > baselineStats.signatureRadius,
      "Expected microwarpdrive to increase signature radius while active",
    );
    const microwarpActivationNotification = findEffectNotification(
      session,
      microwarpdriveItemID,
      EFFECT_MICROWARPDRIVE,
      1,
    );
    assert(
      microwarpActivationNotification,
      "Expected a microwarpdrive activation OnGodmaShipEffect notification",
    );
    runtime.setShipCapacitorRatio(session, 1.0);
    scene.lastTickAt = Date.now() - 1000;
    for (let index = 0; index < 16; index += 1) {
      scene.tick(Date.now() + ((index + 1) * 1000));
    }
    microwarpEffect = runtime.getActiveModuleEffect(session, microwarpdriveItemID);
    assert(
      Number(microwarpEffect.startedAtMs) > microwarpCycleStartedAtMs,
      "Expected active propulsion effects to track the current cycle start time for client UI parity",
    );
    const microwarpStartNotifications = listEffectNotifications(
      session,
      microwarpdriveItemID,
      EFFECT_MICROWARPDRIVE,
      1,
    );
    assert(
      microwarpStartNotifications.length >= 2,
      "Expected repeating propulsion cycles to emit refreshed OnGodmaShipEffect start notifications",
    );
    assert(
      Number(microwarpStartNotifications[microwarpStartNotifications.length - 1].payload[6]) >
      Number(microwarpActivationNotification.payload[6]),
      "Expected later propulsion cycle notifications to advance the client-visible cycle start time",
    );
    const movedDistanceWhileActive = distance(entity.position, preMicrowarpPosition);
    assert(
      movedDistanceWhileActive > 25_000,
      "Expected the server ship entity to continue advancing after microwarpdrive activation",
    );
    assert.strictEqual(
      Number(
        dogma.Handle_QueryAttributeValue(
          [candidate.ship.itemID, ATTRIBUTE_MAX_VELOCITY],
          session,
        ),
      ),
      Number(entity.maxVelocity),
      "Expected ship maxVelocity dogma queries to reflect the active runtime state",
    );
    assert.strictEqual(
      Number(
        dogma.Handle_QueryAttributeValue(
          [candidate.ship.itemID, ATTRIBUTE_MASS],
          session,
        ),
      ),
      Number(entity.mass),
      "Expected ship mass dogma queries to reflect the active runtime state",
    );
    assert.strictEqual(
      Number(
        dogma.Handle_QueryAttributeValue(
          [candidate.ship.itemID, ATTRIBUTE_SIGNATURE_RADIUS],
          session,
        ),
      ),
      Number(entity.signatureRadius),
      "Expected ship signature-radius dogma queries to reflect the active runtime state",
    );
    assert.strictEqual(
      Number(
        dogma.Handle_QueryAttributeValue(
          [microwarpdriveItemID, ATTRIBUTE_SPEED_FACTOR],
          session,
        ),
      ),
      Number(microwarpEffect.speedFactor),
      "Expected propulsion module speedFactor dogma queries to reflect skill-adjusted runtime values",
    );

    let microwarpInfo = dogma.Handle_ItemGetInfo([microwarpdriveItemID], session);
    const microwarpEffectIDs = getActiveEffectIDs(microwarpInfo);
    assert(
      microwarpEffectIDs.includes(EFFECT_MICROWARPDRIVE),
      "Expected ItemGetInfo activeEffects to include the microwarpdrive effect",
    );
    const microwarpEffectLine = getActiveEffectLine(microwarpInfo, EFFECT_MICROWARPDRIVE);
    assert(microwarpEffectLine, "Expected activeEffects entry for the microwarpdrive");
    assert.strictEqual(
      unwrapMarshalNumber(microwarpEffectLine[8]),
      Number(microwarpEffect.durationMs),
      "Expected ItemGetInfo to expose the microwarpdrive cycle duration",
    );
    const shipMaxVelocityNotification = findAttributeNotification(
      session,
      candidate.ship.itemID,
      ATTRIBUTE_MAX_VELOCITY,
    );
    assert(
      shipMaxVelocityNotification,
      "Expected propulsion activation to push a ship maxVelocity attribute update",
    );
    const moduleSpeedFactorNotification = findAttributeNotification(
      session,
      microwarpdriveItemID,
      ATTRIBUTE_SPEED_FACTOR,
    );
    assert(
      moduleSpeedFactorNotification,
      "Expected propulsion activation to push a module speedFactor attribute update",
    );
    const debrisSpawnResult = spawnDebrisFieldForSession(session, "wreck", {
      count: 3,
    });
    assert.strictEqual(
      debrisSpawnResult.success,
      true,
      "Expected wreck spawning to succeed from the live ship position",
    );
    const spawnedDebris = (debrisSpawnResult.data && debrisSpawnResult.data.created) || [];
    assert.strictEqual(
      spawnedDebris.length,
      3,
      "Expected the debris helper to create the requested wreck count",
    );
    for (const entry of spawnedDebris) {
      const distanceFromCurrent = distance(entry.position, entity.position);
      const distanceFromOriginal = distance(entry.position, preMicrowarpPosition);
      assert(
        distanceFromCurrent <= 20_000,
        "Expected spawned wrecks to stay inside the 20 km debris radius around the current ship position",
      );
      assert(
        distanceFromOriginal > 3_000,
        "Expected spawned wrecks to no longer anchor around the ship's old pre-propulsion position",
      );
    }
    const clearResult = clearNearbyDebrisForSession(session);
    assert.strictEqual(
      clearResult.success,
      true,
      "Expected nearby debris clearing to succeed after spawning wrecks",
    );
    const clearedItemIDs = new Set(
      ((clearResult.data && clearResult.data.removed) || [])
        .map((entry) => Number(entry && entry.itemID) || 0)
        .filter((itemID) => itemID > 0),
    );
    for (const entry of spawnedDebris) {
      assert(
        clearedItemIDs.has(Number(entry.item.itemID)),
        "Expected /testclear parity helper to clear wrecks around the current ship position",
      );
    }

    runtime.setShipCapacitorRatio(session, 0);
    scene.tick(Number(microwarpEffect.nextCycleAtMs) + 1);
    assert.strictEqual(
      runtime.getActiveModuleEffect(session, microwarpdriveItemID),
      null,
      "Expected microwarpdrive to auto-shutdown when capacitor cannot pay the next cycle",
    );

    const immediateReactivation = runtime.activatePropulsionModule(
      session,
      findItemById(microwarpdriveItemID),
      "moduleBonusMicrowarpdrive",
      { repeat: 1 },
    );
    assert.strictEqual(
      immediateReactivation.success,
      false,
      "Expected immediate reactivation to fail during the lockout window",
    );
    assert(
      immediateReactivation.errorMsg === "MODULE_REACTIVATING" ||
      immediateReactivation.errorMsg === "NOT_ENOUGH_CAPACITOR",
      "Expected propulsion reactivation failure to reflect either lockout or capacitor depletion",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: candidate.characterID,
      shipID: candidate.ship.itemID,
      baselineStats,
      afterburnerEffectIDs,
      microwarpEffectIDs,
      capacitorRatioAfterAbStart,
      movedDistanceWhileActive,
      reactivationDelayMs: microwarpEffect.reactivationDelayMs,
      reactivationError: immediateReactivation.errorMsg,
    }, null, 2));
  } finally {
    removeItemIfPresent(afterburnerItemID);
    removeItemIfPresent(microwarpdriveItemID);
    if (attached && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
    writeItemRecord(candidate.ship.itemID, previousShipRecord);
  }
}

main();

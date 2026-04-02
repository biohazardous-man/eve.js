const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const { executeChatCommand } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  moveShipToSpace,
  setActiveShipForCharacter,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  listFittedItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const TEST_SYSTEM_ID = 30000142;
const SUPERTITAN_SHOW_ENTITY_ID_START = 3950000000000000;
const TEST_CHARACTER_ID = 140000004;
const TEST_OBSERVER_CHARACTER_ID = 140000005;
const registeredSessions = [];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSession(characterID, shipItem, position) {
  const character = getCharacterRecord(characterID);
  const notifications = [];
  return {
    clientID: Number(characterID) + 800000,
    characterID,
    charID: characterID,
    characterName: character && character.characterName,
    corporationID: character && character.corporationID || 0,
    allianceID: character && character.allianceID || 0,
    warFactionID: character && character.warFactionID || 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    shipName: shipItem.itemName || shipItem.shipName || `ship-${shipItem.itemID}`,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(changes, options = {}) {
      notifications.push({ name: "SessionChange", changes, options });
    },
    shipItem: {
      ...shipItem,
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: position,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function registerAttachedSession(session) {
  registeredSessions.push(session);
  sessionRegistry.register(session);
  const attachResult = spaceRuntime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.ok(attachResult, "expected session attach to succeed");
  assert.equal(
    spaceRuntime.ensureInitialBallpark(session),
    true,
    "expected session ballpark bootstrap to succeed",
  );
  session.notifications.length = 0;
  return session;
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }
    const payload = notification.payload[0];
    const items = payload && payload.items;
    if (!Array.isArray(items)) {
      continue;
    }
    for (const entry of items) {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
        continue;
      }
      updates.push({
        stamp: entry[0],
        name: entry[1][0],
        args: Array.isArray(entry[1][1]) ? entry[1][1] : [],
      });
    }
  }
  return updates;
}

function averagePositionAxis(entities, axis) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : [];
  if (list.length === 0) {
    return 0;
  }
  return list.reduce(
    (sum, entity) => sum + Number(entity && entity.position && entity.position[axis] || 0),
    0,
  ) / list.length;
}

function prepareLiveSpaceSession(characterID, position) {
  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip, `expected active ship for character ${characterID}`);
  const moveResult = moveShipToSpace(activeShip.itemID, TEST_SYSTEM_ID, {
    systemID: TEST_SYSTEM_ID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  });
  assert.equal(moveResult.success, true, "expected active ship to move to test system");
  const activeResult = setActiveShipForCharacter(characterID, activeShip.itemID);
  assert.equal(activeResult.success, true, "expected active ship selection to succeed");
  return registerAttachedSession(
    buildSession(
      characterID,
      moveResult.data,
      position,
    ),
  );
}

test.afterEach(() => {
  for (const session of registeredSessions.splice(0)) {
    sessionRegistry.unregister(session);
  }
  spaceRuntime._testing.clearScenes();
});

test("/supertitan ejects into and boards a titan with the matching superweapon fuel in cargo", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const originalShipID = Number(pilotSession._space.shipID) || 0;

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitan",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Avatar/i);
  assert.match(commandResult.message, /Judgment/i);

  const activeShip = getActiveShipRecord(TEST_CHARACTER_ID);
  assert.ok(activeShip, "expected active ship after /supertitan");
  assert.equal(Number(activeShip.typeID), 11567, "expected /supertitan to board an Avatar");
  assert.notEqual(
    Number(activeShip.itemID),
    originalShipID,
    "expected /supertitan to board a new ship",
  );
  assert.equal(
    Number(pilotSession._space.shipID),
    Number(activeShip.itemID),
    "expected session to be attached to the new titan",
  );

  const fitted = listFittedItems(TEST_CHARACTER_ID, activeShip.itemID);
  assert.ok(
    fitted.some((item) => Number(item.typeID) === 24550),
    "expected Judgment to be fitted to the titan",
  );

  const cargo = listContainerItems(
    TEST_CHARACTER_ID,
    activeShip.itemID,
    ITEM_FLAGS.CARGO_HOLD,
  );
  const fuelStack = cargo.find((item) => Number(item.typeID) === 16274);
  assert.ok(fuelStack, "expected Helium Isotopes in cargo");
  assert.ok(
    Number(fuelStack.quantity) >= 50000,
    "expected enough isotopes for at least one activation",
  );

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected session scene");
  assert.ok(
    scene.getEntityByID(originalShipID),
    "expected the abandoned original ship to remain in space",
  );
});

test("/supertitanshow spawns two transient titan fleets and broadcasts superweapon FX to owner and observer", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );
  const observerSession = prepareLiveSpaceSession(
    TEST_OBSERVER_CHARACTER_ID,
    { x: 2000, y: 0, z: 0 },
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 3",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
        targetDelayMs: 0,
        fxDurationMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /transient titan dummies/i);
  assert.match(commandResult.message, /120 km from the midpoint/i);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");
  const titanShowEntities = [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "ship" &&
    Number(entity.groupID) === 30 &&
    Number(entity.itemID) >= SUPERTITAN_SHOW_ENTITY_ID_START
  ));
  assert.equal(
    titanShowEntities.length,
    6,
    "expected /supertitanshow 3 to spawn six transient titan entities",
  );
  const fleetAEntities = titanShowEntities.filter((entity) => / A\d+$/.test(String(entity.itemName || "")));
  const fleetBEntities = titanShowEntities.filter((entity) => / B\d+$/.test(String(entity.itemName || "")));
  assert.equal(fleetAEntities.length, 3, "expected three A-fleet titans");
  assert.equal(fleetBEntities.length, 3, "expected three B-fleet titans");
  assert.equal(
    Math.round(Math.abs(averagePositionAxis(fleetAEntities, "x") - averagePositionAxis(fleetBEntities, "x"))),
    240000,
    "expected the two titan fleets to start 240 km apart center-to-center",
  );

  const ownerFxUpdates = flattenDestinyUpdates(pilotSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  const observerFxUpdates = flattenDestinyUpdates(observerSession.notifications)
    .filter((entry) => entry.name === "OnSpecialFX");
  assert.ok(ownerFxUpdates.length >= 6, "expected owner to see titan superweapon FX");
  assert.ok(observerFxUpdates.length >= 6, "expected observer to see titan superweapon FX");
});

test("/supertitanshow no longer clamps at the old 20-per-fleet cap", (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.flushAllSync();
  });

  const pilotSession = prepareLiveSpaceSession(
    TEST_CHARACTER_ID,
    { x: 0, y: 0, z: 0 },
  );

  const commandResult = executeChatCommand(
    pilotSession,
    "/supertitanshow 21",
    null,
    {
      emitChatFeedback: false,
      superTitanTestConfig: {
        random: () => 0,
        targetDelayMs: 0,
        fxDurationMs: 0,
        scheduleFn(callback) {
          callback();
          return 0;
        },
      },
    },
  );
  assert.equal(commandResult.handled, true);
  assert.match(commandResult.message, /Spawned 21 \+ 21 transient titan dummies/i);

  const scene = spaceRuntime.getSceneForSession(pilotSession);
  assert.ok(scene, "expected show scene");
  const titanShowEntities = [...scene.dynamicEntities.values()].filter((entity) => (
    entity &&
    entity.kind === "ship" &&
    Number(entity.groupID) === 30 &&
    Number(entity.itemID) >= SUPERTITAN_SHOW_ENTITY_ID_START
  ));
  assert.equal(
    titanShowEntities.length,
    42,
    "expected /supertitanshow 21 to spawn forty-two transient titan entities",
  );
});

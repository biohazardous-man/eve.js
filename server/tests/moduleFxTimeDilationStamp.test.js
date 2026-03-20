const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

const MWD_MODULE_ID = 140002489;
const MWD_EFFECT_NAME = "moduleBonusMicrowarpdrive";
const MWD_GUID = "effects.MicroWarpDrive";

function buildSession() {
  const notifications = [];
  return {
    clientID: 65453,
    characterID: 0,
    _notifications: notifications,
    socket: {
      destroyed: false,
    },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function attachCharacterToScene(systemID = 30000142) {
  const scene = spaceRuntime.ensureScene(systemID);
  const session = buildSession();

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  const shipEntity = scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  session._space.initialStateSent = true;
  scene.markBeyonceBound(session);

  const moduleItem = getFittedModuleItems(session.characterID, shipItem.itemID).find(
    (item) => item.itemID === MWD_MODULE_ID,
  );
  assert.ok(moduleItem, "expected the fitted test ship to have the MWD module");

  return {
    scene,
    session,
    shipItem,
    shipEntity,
    moduleItem,
  };
}

function getDestinyEvents(session, eventName) {
  return session._notifications
    .filter((entry) => entry.name === "DoDestinyUpdate")
    .flatMap((entry) => {
      const payload = entry && entry.payload && entry.payload[0];
      const items = payload && payload.items;
      return Array.isArray(items) ? items : [];
    })
    .filter((entry) => Array.isArray(entry) && entry[1] && entry[1][0] === eventName);
}

function getSpecialFxEvents(session, guid) {
  return getDestinyEvents(session, "OnSpecialFX").filter(
    (entry) => entry[1][1][5] === guid,
  );
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("propulsion activation FX uses the current destiny stamp under TiDi", () => {
  const { scene, session, moduleItem } = attachCharacterToScene();

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const currentStamp = scene.getCurrentDestinyStamp();
  const result = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );

  assert.equal(result.success, true);

  const activationFxEvents = getSpecialFxEvents(session, MWD_GUID);
  assert.equal(activationFxEvents.length, 1);
  assert.equal(
    activationFxEvents[0][0],
    currentStamp,
    "MWD activation FX should dispatch on the current stamp so TiDi does not add a one-tick visual delay",
  );
});

test("propulsion deactivation FX also uses the current destiny stamp under TiDi", () => {
  const { scene, session, moduleItem } = attachCharacterToScene();

  scene.setTimeDilation(0.5, {
    syncSessions: false,
  });
  scene.tick(scene.getCurrentWallclockMs() + 4000);

  const activationResult = spaceRuntime.activatePropulsionModule(
    session,
    moduleItem,
    MWD_EFFECT_NAME,
    { repeat: 1000 },
  );
  assert.equal(activationResult.success, true);

  session._notifications.length = 0;
  const currentStamp = scene.getCurrentDestinyStamp();
  const stopResult = scene.finalizePropulsionModuleDeactivation(
    session,
    moduleItem.itemID,
    {
      reason: "manual",
      nowMs: scene.getCurrentSimTimeMs(),
    },
  );

  assert.equal(stopResult.success, true);

  const stopFxEvents = getSpecialFxEvents(session, MWD_GUID);
  assert.equal(stopFxEvents.length, 1);
  assert.equal(
    stopFxEvents[0][0],
    currentStamp,
    "MWD stop FX should dispatch on the current stamp so the module state does not visually lag behind cycle timing",
  );
});

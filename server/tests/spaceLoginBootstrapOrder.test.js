const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("beyonce MachoBindObject emits the initial space bootstrap before returning", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65450,
    characterID: 0,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });
  assert.equal(session._space.initialStateSent, false);

  const service = new BeyonceService();
  const result = service.Handle_MachoBindObject([30000142, null], session, null);

  assert.ok(Array.isArray(result));
  assert.equal(session._space.beyonceBound, true);
  assert.equal(session._space.initialStateSent, true);
  assert.ok(
    notifications.some((entry) => entry.name === "DoDestinyUpdate"),
    "expected Handle_MachoBindObject to emit the initial space bootstrap",
  );
});

test("beyonce GetFormations emits the initial space bootstrap before MachoBindObject", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65451,
    characterID: 0,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const applyResult = applyCharacterToSession(session, 140000004, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const shipItem = getActiveShipRecord(session.characterID);
  assert.ok(shipItem);

  scene.attachSession(session, shipItem, {
    broadcast: false,
    emitSimClockRebase: false,
  });
  assert.equal(session._space.initialStateSent, false);

  const service = new BeyonceService();
  const formations = service.Handle_GetFormations([], session, null);

  assert.ok(Array.isArray(formations));
  assert.equal(session._space.beyonceBound, true);
  assert.equal(session._space.initialStateSent, true);
  assert.ok(
    notifications.some((entry) => entry.name === "DoDestinyUpdate"),
    "expected Handle_GetFormations to emit the initial space bootstrap",
  );

  const destinyCountAfterFormations = notifications.filter(
    (entry) => entry.name === "DoDestinyUpdate",
  ).length;

  const bindResult = service.Handle_MachoBindObject([30000142, null], session, null);
  assert.ok(Array.isArray(bindResult));
  assert.equal(
    notifications.filter((entry) => entry.name === "DoDestinyUpdate").length,
    destinyCountAfterFormations,
    "expected MachoBindObject to avoid replaying bootstrap once GetFormations already sent it",
  );
});

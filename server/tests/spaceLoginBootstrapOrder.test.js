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

    const payloadList = notification.payload[0];
    const entries = Array.isArray(payloadList && payloadList.items)
      ? payloadList.items
      : [];
    for (const entry of entries) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : null,
        name: payload[0],
      });
    }
  }
  return updates;
}

test("beyonce MachoBindObject emits the initial space bootstrap before returning", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65450,
    characterID: 0,
    socket: {
      destroyed: false,
    },
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
    socket: {
      destroyed: false,
    },
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

test("beyonce UpdateStateRequest sends a recovery SetState without replaying AddBalls2", () => {
  const scene = spaceRuntime.ensureScene(30000142);
  const notifications = [];
  const session = {
    clientID: 65452,
    characterID: 0,
    socket: {
      destroyed: false,
    },
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

  const service = new BeyonceService();
  service.Handle_MachoBindObject([30000142, null], session, null);

  notifications.length = 0;
  const result = service.Handle_UpdateStateRequest([], session, null);
  assert.equal(result, null);

  const updates = flattenDestinyUpdates(notifications);
  const updateNames = updates.map((entry) => entry.name);
  assert.equal(
    updateNames.includes("SetState"),
    true,
    "expected UpdateStateRequest to send a recovery SetState",
  );
  assert.equal(
    updateNames.includes("AddBalls2"),
    false,
    "expected UpdateStateRequest recovery to avoid replaying AddBalls2 scene bootstrap",
  );
});

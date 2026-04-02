/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  executeChatCommand,
} = require(path.join(__dirname, "../../server/src/services/chat/chatCommands"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../../server/src/services/character/characterState"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const TEST_CLIENT_ID = 968101;
const TEST_CHARACTER_ID = 978101;
const TEST_POSITION = Object.freeze({
  x: -107303362560,
  y: -18744975360,
  z: 436489052160,
});

function createFakeSession(clientID, characterID, systemID, position, direction) {
  const notifications = [];
  return {
    clientID,
    userName: `user-${characterID}`,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction,
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachReadySession(session) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
}

function advanceSceneByMs(scene, totalMs, steps = 1) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const stepMs = Math.max(1, Math.trunc(totalMs / Math.max(1, steps)));
  for (let index = 0; index < steps; index += 1) {
    wallclockNow += stepMs;
    scene.tick(wallclockNow);
  }
}

function findNotification(session, name, predicate = null) {
  return session.notifications.find((entry) => (
    entry &&
    entry.name === name &&
    (typeof predicate !== "function" || predicate(entry))
  )) || null;
}

function clearNotifications(session) {
  session.notifications.length = 0;
}

function createTemporaryCharacterRecord(characterID) {
  const characters = database.read("characters", "/");
  assert.strictEqual(characters.success, true, "characters table should be readable");
  const templateEntry = Object.entries(characters.data || {}).find(([, row]) => (
    row && Number(row.accountId) > 0
  ));
  assert(templateEntry, "expected at least one player character template in the database");
  const [, templateRecord] = templateEntry;
  const temporaryRecord = {
    ...templateRecord,
    accountId: 1,
    characterName: `test-char-${characterID}`,
    securityStatus: 0,
    securityRating: 0,
    shipID: 0,
    shipTypeID: 606,
    shipName: `ship-${characterID}`,
  };
  const writeResult = database.write(
    "characters",
    `/${String(characterID)}`,
    temporaryRecord,
    { transient: true },
  );
  assert.strictEqual(writeResult.success, true, "temporary test character should be writable");
}

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  crimewatchState.clearAllCrimewatchState();
  npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    removeContents: true,
  });

  let session = null;
  try {
    createTemporaryCharacterRecord(TEST_CHARACTER_ID);
    session = createFakeSession(
      TEST_CLIENT_ID,
      TEST_CHARACTER_ID,
      TEST_SYSTEM_ID,
      TEST_POSITION,
      { x: 1, y: 0, z: 0 },
    );
    attachReadySession(session);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message) {
        this.messages.push({
          characterID: targetSession && targetSession.characterID,
          message,
        });
      },
    };

    const safetyResult = executeChatCommand(session, "/cwatch safety none", chatHub, {});
    assert.strictEqual(safetyResult.handled, true);
    assert.strictEqual(
      crimewatchState.getSafetyLevel(session.characterID),
      crimewatchState.SAFETY_LEVEL_NONE,
      "safety none should persist through the shared crimewatch state",
    );

    clearNotifications(session);
    const naughtyResult = executeChatCommand(session, "/naughty", chatHub, {});
    assert.strictEqual(naughtyResult.handled, true);
    const criminalState = crimewatchState.getCharacterCrimewatchState(
      session.characterID,
      scene.getCurrentSimTimeMs(),
    );
    assert(criminalState, "expected a crimewatch state after /naughty");
    assert.strictEqual(criminalState.criminal, true, "criminal flag should be active");
    assert(
      findNotification(
        session,
        "OnCriminalTimerUpdate",
        (entry) => Array.isArray(entry.payload) &&
          entry.payload[0] === crimewatchState.CRIMINAL_TIMER_STATE_TIMER_CRIMINAL,
      ),
      "criminal timer notification should use CCP timer enums",
    );
    assert(
      findNotification(
        session,
        "OnSystemCriminalFlagUpdates",
        (entry) => Array.isArray(entry.payload) &&
          Array.isArray(entry.payload[2]) &&
          entry.payload[2].includes(session.characterID),
      ),
      "system criminal notification should advertise the new criminal character",
    );

    clearNotifications(session);
    const secStatusResult = executeChatCommand(session, "/secstatus -12.5", chatHub, {});
    assert.strictEqual(secStatusResult.handled, true);
    const updatedCharacterRecord = getCharacterRecord(session.characterID);
    assert(updatedCharacterRecord, "character record should still exist after /secstatus");
    assert.strictEqual(
      Number(updatedCharacterRecord.securityStatus),
      Number(crimewatchState.SECURITY_STATUS_MIN),
      "/secstatus should clamp to the shared minimum security status",
    );
    assert.strictEqual(
      Number(updatedCharacterRecord.securityRating),
      Number(crimewatchState.SECURITY_STATUS_MIN),
      "/secstatus should keep securityRating in sync with securityStatus",
    );
    assert(
      findNotification(
        session,
        "OnSecurityStatusUpdate",
        (entry) => Array.isArray(entry.payload) &&
          Number(entry.payload[0]) === Number(crimewatchState.SECURITY_STATUS_MIN),
      ),
      "/secstatus should notify the client about the new security status",
    );
    assert(
      findNotification(
        session,
        "OnModuleAttributeChanges",
        (entry) => Array.isArray(entry.payload) &&
          entry.payload.some((outer) => outer && Array.isArray(outer.items) && outer.items.some((item) => (
            Array.isArray(item) && item[0] === "OnModuleAttributeChanges"
          ))),
      ),
      "/secstatus should emit a pilot security-status attribute change while in space",
    );

    const responseDelayMs = crimewatchState.getConcordResponseDelayMsForSystem(scene.system);
    advanceSceneByMs(
      scene,
      responseDelayMs + 35_000,
      Math.max(10, Math.trunc((responseDelayMs + 35_000) / 1_000)),
    );
    const concordSummaries = npcService.getNpcOperatorSummary().filter((summary) => (
      summary.systemID === TEST_SYSTEM_ID &&
      summary.entityType === "concord"
    ));
    assert(
      concordSummaries.length > 0,
      "/naughty should schedule the same CONCORD response path as runtime aggression",
    );

    clearNotifications(session);
    const debugCriminalResult = executeChatCommand(session, "/cwatch criminal on", chatHub, {});
    assert.strictEqual(debugCriminalResult.handled, true);
    assert(
      findNotification(
        session,
        "OnCriminalTimerUpdate",
        (entry) => Array.isArray(entry.payload) &&
          entry.payload[0] === crimewatchState.CRIMINAL_TIMER_STATE_TIMER_CRIMINAL,
      ),
      "/cwatch criminal should still drive the shared criminal timer path",
    );

    clearNotifications(session);
    const clearResult = executeChatCommand(session, "/cwatch clear", chatHub, {});
    assert.strictEqual(clearResult.handled, true);
    const clearedState = crimewatchState.getCharacterCrimewatchState(
      session.characterID,
      scene.getCurrentSimTimeMs(),
    );
    assert(
      !clearedState || (!clearedState.criminal && !clearedState.suspect),
      "/cwatch clear should remove active criminal/suspect flags",
    );
    assert(
      findNotification(
        session,
        "OnCriminalTimerUpdate",
        (entry) => Array.isArray(entry.payload) &&
          entry.payload[0] === crimewatchState.CRIMINAL_TIMER_STATE_IDLE,
      ),
      "clearing crimewatch should notify the client that the criminal timer is idle",
    );
    assert(
      findNotification(
        session,
        "OnSystemCriminalFlagUpdates",
        (entry) => Array.isArray(entry.payload) &&
          Array.isArray(entry.payload[0]) &&
          entry.payload[0].includes(session.characterID),
      ),
      "clearing crimewatch should decriminalize the character in-system",
    );

    console.log(JSON.stringify({
      ok: true,
      responseDelayMs,
      safetyLevel: crimewatchState.getSafetyLevel(session.characterID),
      concordCount: concordSummaries.length,
    }, null, 2));
  } finally {
    if (session && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "concord",
      removeContents: true,
    });
    crimewatchState.clearAllCrimewatchState();
    clearControllers();
    runtime._testing.clearScenes();
    database.remove("characters", `/${String(TEST_CHARACTER_ID)}`);
    database.remove("skills", `/${String(TEST_CHARACTER_ID)}`);
  }
}

main();
setImmediate(() => process.exit(0));

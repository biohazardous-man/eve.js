const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000142;
const JITA_TRADEHUB_STATION_ID = 60003760;
const CUSTOM_ANCHOR_POSITION = Object.freeze({
  x: 1_000_000,
  y: 2_000_000,
  z: 3_000_000,
});

function createFakeSession(clientID, characterID, systemID, position, direction) {
  const notifications = [];
  return {
    clientID,
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

function cleanupSpawned(systemID, result) {
  const spawned = (result && result.data && result.data.spawned) || [];
  for (const entry of spawned) {
    try {
      runtime.removeDynamicEntity(systemID, entry.entity.itemID, {
        allowSessionOwned: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      removeInventoryItem(entry.entity.itemID, {
        removeContents: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("skills", `/${entry.ownerCharacterID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("characters", `/${entry.ownerCharacterID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
  }
}

function runSpawnGroupAnchorCheck() {
  const result = npcService.spawnNpcGroupInSystem(TEST_SYSTEM_ID, {
    spawnGroupQuery: "blood_raider_roaming_pair",
    entityType: "npc",
    anchorDescriptor: {
      kind: "coordinates",
      position: CUSTOM_ANCHOR_POSITION,
      direction: { x: 1, y: 0, z: 0 },
      name: "Custom Test Anchor",
    },
    spawnDistanceMeters: 20_000,
    spreadMeters: 0,
    formationSpacingMeters: 1_000,
  });
  assert.strictEqual(result.success, true, result.errorMsg || "group spawn failed");
  assert.strictEqual(result.data.selectionKind, "group");
  assert.strictEqual(result.data.selectionID, "blood_raider_roaming_pair");
  assert.strictEqual(result.data.spawned.length, 2);

  for (const entry of result.data.spawned) {
    assert.strictEqual(entry.controller.spawnGroupID, "blood_raider_roaming_pair");
    assert.strictEqual(entry.controller.anchorKind, "coordinates");
    assert.strictEqual(entry.controller.selectionKind, "group");
    const distanceFromAnchor = Math.hypot(
      entry.controller.homePosition.x - CUSTOM_ANCHOR_POSITION.x,
      entry.controller.homePosition.y - CUSTOM_ANCHOR_POSITION.y,
      entry.controller.homePosition.z - CUSTOM_ANCHOR_POSITION.z,
    );
    assert(
      distanceFromAnchor >= 18_500 && distanceFromAnchor <= 22_500,
      `expected coordinate-anchor spawn distance around 20km, got ${distanceFromAnchor}`,
    );
  }

  return result;
}

function runSpawnSiteControlCheck() {
  const session = createFakeSession(
    961001,
    971001,
    TEST_SYSTEM_ID,
    {
      x: -107303362560 + 150000,
      y: -18744975360,
      z: 436489052160,
    },
    { x: 1, y: 0, z: 0 },
  );
  attachReadySession(session);

  const scene = runtime.ensureScene(TEST_SYSTEM_ID);
  const result = npcService.spawnNpcSiteForSession(
    session,
    "jita_tradehub_concord_screen",
  );
  assert.strictEqual(result.success, true, result.errorMsg || "site spawn failed");
  assert.strictEqual(result.data.selectionKind, "site");
  assert.strictEqual(result.data.selectionID, "jita_tradehub_concord_screen");
  assert.strictEqual(result.data.spawned.length, 3);

  const first = result.data.spawned[0];
  for (const entry of result.data.spawned) {
    assert.strictEqual(entry.controller.spawnSiteID, "jita_tradehub_concord_screen");
    assert.strictEqual(entry.controller.spawnGroupID, "concord_police_screen");
    assert.strictEqual(entry.controller.anchorKind, "station");
    assert.strictEqual(entry.controller.anchorID, JITA_TRADEHUB_STATION_ID);
    assert.strictEqual(entry.controller.selectionKind, "site");
    assert.strictEqual(entry.controller.preferredTargetID, session._space.shipID);
    assert(entry.entity.bubbleID > 0, "spawned site NPC should own a bubble membership");
  }

  npcService.issueManualOrder(first.entity.itemID, {
    type: "hold fire",
    targetID: session._space.shipID,
  });
  const tickBase = Date.now();
  for (let index = 0; index < 3; index += 1) {
    scene.tick(tickBase + ((index + 1) * 1000));
  }
  assert.strictEqual(first.entity.activeModuleEffects.size, 0);
  assert.strictEqual(first.controller.currentTargetID, session._space.shipID);

  npcService.issueManualOrder(first.entity.itemID, {
    type: "stop",
  });
  for (let index = 0; index < 2; index += 1) {
    scene.tick(tickBase + ((index + 5) * 1000));
  }
  assert.strictEqual(first.entity.mode, "STOP");

  npcService.issueManualOrder(first.entity.itemID, {
    type: "resume behavior",
  });
  for (let index = 0; index < 3; index += 1) {
    scene.tick(tickBase + ((index + 8) * 1000));
  }
  assert.strictEqual(first.controller.manualOrder, null);
  assert.strictEqual(first.controller.currentTargetID, session._space.shipID);
  assert(
    first.entity.mode === "ORBIT" || first.entity.mode === "FOLLOW",
    `expected resumed controller to re-enter a target movement mode, got ${first.entity.mode}`,
  );

  runtime.detachSession(session, { broadcast: false });
  return {
    result,
    firstEntityID: first.entity.itemID,
    resumedMode: first.entity.mode,
  };
}

function main() {
  runtime._testing.clearScenes();
  clearControllers();
  let groupResult = null;
  let siteResult = null;
  let siteSummary = null;

  try {
    groupResult = runSpawnGroupAnchorCheck();
    siteSummary = runSpawnSiteControlCheck();
    siteResult = siteSummary.result;
    console.log(JSON.stringify({
      ok: true,
      group: {
        selectionKind: groupResult.data.selectionKind,
        selectionID: groupResult.data.selectionID,
        spawned: groupResult.data.spawned.length,
      },
      site: {
        selectionKind: siteResult.data.selectionKind,
        selectionID: siteResult.data.selectionID,
        spawned: siteResult.data.spawned.length,
        firstEntityID: siteSummary.firstEntityID,
        resumedMode: siteSummary.resumedMode,
      },
    }, null, 2));
  } finally {
    cleanupSpawned(TEST_SYSTEM_ID, groupResult);
    cleanupSpawned(TEST_SYSTEM_ID, siteResult);
    clearControllers();
  }
}

main();
setImmediate(() => process.exit(0));

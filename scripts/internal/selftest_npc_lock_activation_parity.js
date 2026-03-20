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

function cleanupSpawned(spawnedEntries) {
  for (const entry of spawnedEntries || []) {
    try {
      runtime.removeDynamicEntity(TEST_SYSTEM_ID, entry.entity.itemID, {
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

function main() {
  runtime._testing.clearScenes();
  clearControllers();

  let session = null;
  let spawnResult = null;

  try {
    session = createFakeSession(
      962001,
      972001,
      TEST_SYSTEM_ID,
      {
        x: -107303362560 + 120000,
        y: -18744975360,
        z: 436489052160,
      },
      { x: 1, y: 0, z: 0 },
    );
    attachReadySession(session);

    spawnResult = npcService.spawnNpcBatchForSession(session, {
      amount: 1,
      profileQuery: "generic_hostile",
      preferPools: false,
    });
    assert.strictEqual(spawnResult.success, true, spawnResult.errorMsg || "NPC spawn failed");
    assert.strictEqual(spawnResult.data.spawned.length, 1);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const npcEntry = spawnResult.data.spawned[0];
    const npcEntity = npcEntry.entity;
    const targetEntity = scene.getEntityByID(session._space.shipID);
    assert(npcEntity, "expected spawned NPC entity");
    assert(targetEntity, "expected player target entity");

    const pendingBefore = scene.getSortedPendingTargetLocks(npcEntity);
    assert.strictEqual(pendingBefore.length, 1, "expected one pending target lock");
    assert.strictEqual(pendingBefore[0].targetID, session._space.shipID);

    const expectedLockDurationMs = runtime._testing.computeTargetLockDurationMsForTesting(
      npcEntity,
      targetEntity,
    );
    assert.strictEqual(
      pendingBefore[0].totalDurationMs,
      expectedLockDurationMs,
      "NPC should use the same target-lock math as the runtime",
    );
    assert.strictEqual(
      npcEntity.activeModuleEffects.size,
      0,
      "NPC should not activate weapons before the lock completes",
    );

    const simNow = scene.getCurrentSimTimeMs();
    const wallclockNow = scene.getCurrentWallclockMs();
    const toWallclock = (simTimeMs) => wallclockNow + (simTimeMs - simNow);
    const beforeCompleteWallclock = Math.max(
      wallclockNow + 1,
      toWallclock(pendingBefore[0].completeAtMs) - 5,
    );
    const afterCompleteWallclock = Math.max(
      beforeCompleteWallclock + 1,
      toWallclock(pendingBefore[0].completeAtMs) + 5,
    );

    scene.tick(beforeCompleteWallclock);
    assert.strictEqual(
      scene.getSortedPendingTargetLocks(npcEntity).length,
      1,
      "NPC lock should still be pending immediately before completion",
    );
    assert.strictEqual(
      scene.getTargetsForEntity(npcEntity).includes(session._space.shipID),
      false,
      "NPC should not have an active lock before completion",
    );
    assert.strictEqual(
      npcEntity.activeModuleEffects.size,
      0,
      "NPC should still have no active modules before lock completion",
    );

    scene.tick(afterCompleteWallclock);
    assert.strictEqual(
      scene.getTargetsForEntity(npcEntity).includes(session._space.shipID),
      true,
      "NPC should acquire the lock once the pending timer completes",
    );
    assert(
      npcEntity.activeModuleEffects.size > 0,
      "NPC should activate weapons on the same think boundary as the completed lock",
    );

    console.log(JSON.stringify({
      ok: true,
      lockDurationMs: expectedLockDurationMs,
      activeEffects: npcEntity.activeModuleEffects.size,
      targetLocked: true,
    }, null, 2));
  } finally {
    if (session && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    cleanupSpawned(
      spawnResult && spawnResult.data && Array.isArray(spawnResult.data.spawned)
        ? spawnResult.data.spawned
        : [],
    );
    clearControllers();
  }
}

main();
setImmediate(() => process.exit(0));

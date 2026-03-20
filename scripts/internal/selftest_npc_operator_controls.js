const assert = require("assert");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const npcControlState = require(path.join(__dirname, "../../server/src/space/npc/npcControlState"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  listSystemSpaceItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));
const {
  executeChatCommand,
} = require(path.join(__dirname, "../../server/src/services/chat/chatCommands"));

const TEST_SYSTEM_ID = 30000145;
const TEST_PLAYER_CHARACTER_ID = 974501;
const TEST_PLAYER_CLIENT_ID = 964501;
const LOCAL_ANCHOR_POSITION = Object.freeze({
  x: -77052456960,
  y: 6477066240,
  z: 552402370560,
});
const DEFAULT_NPC_CONTROL_STATE = Object.freeze({
  startupRuleOverrides: {},
  characterFlags: {},
  systemGateControls: {},
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

function createChatHub() {
  return {
    messages: [],
    sendSystemMessage(session, message) {
      this.messages.push({
        characterID: session && session.characterID ? session.characterID : 0,
        message,
      });
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

function readNpcControlStateSnapshot() {
  const result = database.read("npcControlState", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_NPC_CONTROL_STATE));
  }
  return JSON.parse(JSON.stringify(result.data));
}

function writeNpcControlStateSnapshot(snapshot) {
  database.write(
    "npcControlState",
    "/",
    snapshot && typeof snapshot === "object"
      ? snapshot
      : JSON.parse(JSON.stringify(DEFAULT_NPC_CONTROL_STATE)),
  );
}

function cleanupSystemNpcShips(systemID) {
  for (const item of listSystemSpaceItems(systemID)) {
    const npcMetadata = npcService.parseNpcCustomInfo(item && item.customInfo);
    if (!npcMetadata) {
      continue;
    }

    try {
      runtime.removeDynamicEntity(systemID, item.itemID, {
        allowSessionOwned: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      removeInventoryItem(item.itemID, {
        removeContents: true,
      });
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("skills", `/${item.ownerID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      database.remove("characters", `/${item.ownerID}`);
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
  }
}

function cleanupSpawnResult(result) {
  const spawned = result && result.data && Array.isArray(result.data.spawned)
    ? result.data.spawned
    : [];
  for (const entry of spawned) {
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

function advanceSceneByMs(scene, totalMs, steps = 1) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const stepMs = Math.max(1, Math.trunc(totalMs / Math.max(1, steps)));
  for (let index = 0; index < steps; index += 1) {
    wallclockNow += stepMs;
    scene.tick(wallclockNow);
  }
}

function getSystemSummaries() {
  return npcService.getNpcOperatorSummary()
    .filter((summary) => summary.systemID === TEST_SYSTEM_ID)
    .sort((left, right) => left.entityID - right.entityID);
}

function main() {
  const originalNpcControlState = readNpcControlStateSnapshot();
  runtime._testing.clearScenes();
  clearControllers();
  cleanupSystemNpcShips(TEST_SYSTEM_ID);
  writeNpcControlStateSnapshot(DEFAULT_NPC_CONTROL_STATE);

  let session = null;
  let invuIgnoredSpawn = null;
  let localRatSpawn = null;
  let localConcordSpawn = null;

  try {
    session = createFakeSession(
      TEST_PLAYER_CLIENT_ID,
      TEST_PLAYER_CHARACTER_ID,
      TEST_SYSTEM_ID,
      {
        x: LOCAL_ANCHOR_POSITION.x + 40_000,
        y: LOCAL_ANCHOR_POSITION.y,
        z: LOCAL_ANCHOR_POSITION.z,
      },
      { x: 1, y: 0, z: 0 },
    );
    attachReadySession(session);
    const chatHub = createChatHub();
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);

    const invuOn = executeChatCommand(session, "/invu on", chatHub, {});
    assert.strictEqual(invuOn.handled, true);
    assert.strictEqual(npcService.isCharacterInvulnerable(session.characterID), true);

    invuIgnoredSpawn = npcService.spawnNpcBatchForSession(session, {
      amount: 1,
      profileQuery: "generic_hostile",
      preferPools: false,
    });
    assert.strictEqual(invuIgnoredSpawn.success, true, invuIgnoredSpawn.errorMsg || "invu NPC spawn failed");
    const ignoredNpcEntity = invuIgnoredSpawn.data.spawned[0].entity;
    advanceSceneByMs(scene, 8_000, 16);
    assert.strictEqual(
      scene.getTargetsForEntity(ignoredNpcEntity).length,
      0,
      "NPC should not lock an invulnerable player",
    );
    assert.strictEqual(
      scene.getSortedPendingTargetLocks(ignoredNpcEntity).length,
      0,
      "NPC should not even keep a pending target lock against an invulnerable player",
    );
    assert.strictEqual(
      ignoredNpcEntity.activeModuleEffects.size,
      0,
      "NPC should not activate weapons against an invulnerable player",
    );
    cleanupSpawnResult(invuIgnoredSpawn);
    invuIgnoredSpawn = null;

    localRatSpawn = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      amount: 1,
      profileQuery: "blood_raider_apocalypse",
      preferPools: false,
      entityType: "npc",
      preferredTargetID: 0,
      anchorDescriptor: {
        kind: "coordinates",
        position: LOCAL_ANCHOR_POSITION,
        direction: { x: 1, y: 0, z: 0 },
        name: "Local Fight Anchor",
      },
      spawnDistanceMeters: 1_000,
      spreadMeters: 0,
    });
    assert.strictEqual(localRatSpawn.success, true, localRatSpawn.errorMsg || "local rat spawn failed");

    localConcordSpawn = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      amount: 1,
      profileQuery: "concord_police_battleship",
      preferPools: false,
      entityType: "concord",
      preferredTargetID: 0,
      anchorDescriptor: {
        kind: "coordinates",
        position: LOCAL_ANCHOR_POSITION,
        direction: { x: 1, y: 0, z: 0 },
        name: "Local Fight Anchor",
      },
      spawnDistanceMeters: 1_000,
      spreadMeters: 0,
    });
    assert.strictEqual(localConcordSpawn.success, true, localConcordSpawn.errorMsg || "local concord spawn failed");

    const localRatEntity = localRatSpawn.data.spawned[0].entity;
    const localConcordEntity = localConcordSpawn.data.spawned[0].entity;
    advanceSceneByMs(scene, 25_000, 25);

    const localRatController = npcService.getControllerByEntityID(localRatEntity.itemID);
    const localConcordController = npcService.getControllerByEntityID(localConcordEntity.itemID);
    assert(localRatController, "expected local rat controller");
    assert(localConcordController, "expected local concord controller");
    assert.strictEqual(
      localConcordController.currentTargetID,
      localRatEntity.itemID,
      "CONCORD should auto-target a nearby rat when the player is invulnerable",
    );
    assert(
      localConcordEntity.activeModuleEffects.size > 0 ||
      Number(localRatEntity.conditionState && localRatEntity.conditionState.shieldCharge) < 1,
      "CONCORD should be actively firing at the rat or have already damaged it",
    );

    const concordShieldBeforeRetaliation = Number(
      localConcordEntity.conditionState && localConcordEntity.conditionState.shieldCharge,
    );
    advanceSceneByMs(scene, 20_000, 20);
    assert.strictEqual(
      localRatController.preferredTargetID,
      localConcordEntity.itemID,
      "Rats should switch preferred target to the CONCORD attacker",
    );
    assert.strictEqual(
      localRatController.currentTargetID,
      localConcordEntity.itemID,
      "Rats should actively retaliate against the CONCORD attacker",
    );
    assert(
      localRatEntity.activeModuleEffects.size > 0 ||
      scene.getTargetsForEntity(localRatEntity).includes(localConcordEntity.itemID) ||
      Number(localConcordEntity.conditionState && localConcordEntity.conditionState.shieldCharge) <
        concordShieldBeforeRetaliation,
      "Rats should fire back after taking damage from CONCORD",
    );

    cleanupSpawnResult(localRatSpawn);
    cleanupSpawnResult(localConcordSpawn);
    localRatSpawn = null;
    localConcordSpawn = null;

    const gateRatsOn = executeChatCommand(session, "/gaterats on", chatHub, {});
    const gateConcordOn = executeChatCommand(session, "/gateconcord on", chatHub, {});
    assert.strictEqual(gateRatsOn.handled, true);
    assert.strictEqual(gateConcordOn.handled, true);
    const tunedGateState = npcControlState.setSystemGateControl(TEST_SYSTEM_ID, {
      gateConcordEnabled: true,
      gateConcordRespawnDelayMs: 1_000,
      gateRatEnabled: true,
      gateRatRespawnDelayMs: 1_000,
    });
    assert.strictEqual(tunedGateState.success, true);

    const gateRatRuleID = npcControlState.getDynamicGateStartupRuleID(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.RATS,
    );
    const gateConcordRuleID = npcControlState.getDynamicGateStartupRuleID(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );

    let systemSummaries = getSystemSummaries();
    const initialGateRatCount = systemSummaries.filter(
      (summary) => summary.startupRuleID === gateRatRuleID,
    ).length;
    const initialGateConcordCount = systemSummaries.filter(
      (summary) => summary.startupRuleID === gateConcordRuleID,
    ).length;
    assert(initialGateRatCount > 0, "expected dynamic gate rats to spawn");
    assert(initialGateConcordCount > 0, "expected dynamic gate CONCORD to spawn");

    advanceSceneByMs(scene, 20_000, 20);
    systemSummaries = getSystemSummaries();
    const activeGateRatIDs = new Set(
      systemSummaries
        .filter((summary) => summary.startupRuleID === gateRatRuleID)
        .map((summary) => summary.entityID),
    );
    assert(
      systemSummaries
        .filter((summary) => summary.startupRuleID === gateConcordRuleID)
        .some((summary) => activeGateRatIDs.has(summary.currentTargetID)),
      "Dynamic gate CONCORD should engage dynamic gate rats",
    );

    const gateConcordOffBeforeRespawn = executeChatCommand(
      session,
      "/gateconcord off",
      chatHub,
      {},
    );
    assert.strictEqual(gateConcordOffBeforeRespawn.handled, true);

    const clearRats = executeChatCommand(session, "/npcclear system npc", chatHub, {});
    assert.strictEqual(clearRats.handled, true);
    systemSummaries = getSystemSummaries();
    assert.strictEqual(
      systemSummaries.filter((summary) => summary.startupRuleID === gateRatRuleID).length,
      0,
      "All gate rats should be removed by /npcclear system npc",
    );
    assert(
      [...activeGateRatIDs].every((entityID) => !scene.dynamicEntities.has(entityID)),
      "Cleared gate rats should also be removed from the live scene, not just the controller registry",
    );

    advanceSceneByMs(scene, 8_000, 16);
    systemSummaries = getSystemSummaries();
    const respawnedGateRatSummaries = systemSummaries.filter(
      (summary) => summary.startupRuleID === gateRatRuleID,
    );
    assert(
      respawnedGateRatSummaries.length > 0,
      "Gate rats should live-respawn while the gate rat rule stays enabled",
    );
    assert(
      respawnedGateRatSummaries.some((summary) => !activeGateRatIDs.has(summary.entityID)),
      "Live-respawned gate rats should be freshly spawned entities after a clear",
    );

    const gateRatsOff = executeChatCommand(session, "/gaterats off", chatHub, {});
    assert.strictEqual(gateRatsOff.handled, true);
    systemSummaries = getSystemSummaries();
    assert.strictEqual(
      systemSummaries.filter((summary) => summary.startupRuleID === gateRatRuleID).length,
      0,
      "Gate rat controllers should be gone once /gaterats off is applied",
    );
    assert.strictEqual(
      systemSummaries.filter((summary) => summary.startupRuleID === gateConcordRuleID).length,
      0,
      "Gate CONCORD controllers should stay gone once /gateconcord off is applied",
    );

    const invuOff = executeChatCommand(session, "/invu off", chatHub, {});
    assert.strictEqual(invuOff.handled, true);
    assert.strictEqual(npcService.isCharacterInvulnerable(session.characterID), false);

    console.log(JSON.stringify({
      ok: true,
      invulnerability: {
        enabledThenDisabled: true,
        ignoredNpcLockedTargets: scene.getTargetsForEntity(ignoredNpcEntity).length,
      },
      localFight: {
        concordTargetID: localConcordController.currentTargetID,
        ratPreferredTargetID: localRatController.preferredTargetID,
      },
      gateRules: {
        gateRatRuleID,
        gateConcordRuleID,
        initialGateRatCount,
        initialGateConcordCount,
      },
    }, null, 2));
  } finally {
    try {
      npcService.setGateOperatorEnabled(
        TEST_SYSTEM_ID,
        npcService.GATE_OPERATOR_KIND.RATS,
        false,
      );
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      npcService.setGateOperatorEnabled(
        TEST_SYSTEM_ID,
        npcService.GATE_OPERATOR_KIND.CONCORD,
        false,
      );
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    if (session && session.characterID) {
      try {
        npcService.setCharacterNpcInvulnerability(session.characterID, false);
      } catch (error) {
        // Best-effort cleanup for selftests.
      }
    }
    cleanupSpawnResult(invuIgnoredSpawn);
    cleanupSpawnResult(localRatSpawn);
    cleanupSpawnResult(localConcordSpawn);
    cleanupSystemNpcShips(TEST_SYSTEM_ID);
    if (session && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    clearControllers();
    runtime._testing.clearScenes();
    writeNpcControlStateSnapshot(originalNpcControlState);
  }
}

main();
setImmediate(() => process.exit(0));

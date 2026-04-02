/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

delete process.env.EVEJS_SKIP_NPC_STARTUP;

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const npcControlState = require(path.join(__dirname, "../../server/src/space/npc/npcControlState"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const config = require(path.join(__dirname, "../../server/src/config"));
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

const TEST_SYSTEM_ID = 30000142;
const TEST_CHARACTER_ID = 975601;
const TEST_CLIENT_ID = 965601;
const AUTHORED_RULE_ID = "jita_concord_gate_checkpoint_startup";
const DEFAULT_CONTROL_STATE = Object.freeze({
  startupRuleOverrides: {},
  characterFlags: {},
  systemGateControls: {},
});

const TABLE_FILE_PATHS = Object.freeze({
  characters: path.join(__dirname, "../../server/src/newDatabase/data/characters/data.json"),
  items: path.join(__dirname, "../../server/src/newDatabase/data/items/data.json"),
  skills: path.join(__dirname, "../../server/src/newDatabase/data/skills/data.json"),
  npcControlState: path.join(__dirname, "../../server/src/newDatabase/data/npcControlState/data.json"),
  npcEntities: path.join(__dirname, "../../server/src/newDatabase/data/npcEntities/data.json"),
  npcRuntimeControllers: path.join(__dirname, "../../server/src/newDatabase/data/npcRuntimeControllers/data.json"),
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readDiskJson(table) {
  return JSON.parse(fs.readFileSync(TABLE_FILE_PATHS[table], "utf8"));
}

function readTableSnapshot(table) {
  const result = database.read(table, "/");
  if (!result.success || result.data === null || result.data === undefined) {
    return {};
  }
  return cloneValue(result.data);
}

function writeTableSnapshot(table, snapshot) {
  const writeResult = database.write(
    table,
    "/",
    snapshot && typeof snapshot === "object" ? cloneValue(snapshot) : {},
  );
  assert.strictEqual(
    writeResult.success,
    true,
    `Failed to restore table ${table}: ${(writeResult && writeResult.errorMsg) || "WRITE_ERROR"}`,
  );
}

function createFakeSession(clientID, characterID, systemID) {
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
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID: 606,
      ownerID: characterID,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position: {
          x: -4067658398976.968,
          y: -710585171770.7522,
          z: -3956625004517.8574,
        },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
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

function parseNpcCustomInfo(customInfo) {
  if (!customInfo || typeof customInfo !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(customInfo);
    return parsed && parsed.npc && typeof parsed.npc === "object"
      ? parsed.npc
      : null;
  } catch (error) {
    return null;
  }
}

function countPersistedNpcResidue() {
  const characters = readDiskJson("characters");
  const items = readDiskJson("items");
  const skills = readDiskJson("skills");
  const npcEntities = readDiskJson("npcEntities");
  const npcRuntimeControllers = readDiskJson("npcRuntimeControllers");

  let syntheticCharacterCount = 0;
  const syntheticOwnerIDs = new Set();
  for (const [characterID, record] of Object.entries(characters)) {
    const numericCharacterID = Number(characterID || 0);
    const shortName = String(record && record.shortName || "").trim().toLowerCase();
    const description = String(record && record.description || "").trim().toLowerCase();
    if (
      numericCharacterID >= 980000000 ||
      shortName === "npc" ||
      description.includes("synthetic npc owner")
    ) {
      syntheticCharacterCount += 1;
      syntheticOwnerIDs.add(String(characterID));
    }
  }

  let npcMetadataItemCount = 0;
  let authoredStartupItemCount = 0;
  let dynamicStartupItemCount = 0;
  for (const item of Object.values(items)) {
    const npcMetadata = parseNpcCustomInfo(item && item.customInfo);
    if (!npcMetadata) {
      continue;
    }

    npcMetadataItemCount += 1;
    if (npcMetadata.ownerCharacterID) {
      syntheticOwnerIDs.add(String(npcMetadata.ownerCharacterID));
    }
    if (String(npcMetadata.startupRuleID || "") === AUTHORED_RULE_ID) {
      authoredStartupItemCount += 1;
    }
    if (String(npcMetadata.startupRuleID || "") === `dynamic_gate_concord_${TEST_SYSTEM_ID}`) {
      dynamicStartupItemCount += 1;
    }
  }

  let syntheticSkillRowCount = 0;
  for (const ownerID of syntheticOwnerIDs) {
    if (Object.prototype.hasOwnProperty.call(skills, ownerID)) {
      syntheticSkillRowCount += 1;
    }
  }

  return {
    syntheticCharacterCount,
    npcMetadataItemCount,
    authoredStartupItemCount,
    dynamicStartupItemCount,
    syntheticSkillRowCount,
    nativeDynamicEntityCount: Object.values(npcEntities && npcEntities.entities || {}).filter((entity) => (
      Number(entity && entity.systemID || 0) === TEST_SYSTEM_ID &&
      String(entity && entity.startupRuleID || "") === `dynamic_gate_concord_${TEST_SYSTEM_ID}`
    )).length,
    nativeDynamicControllerCount: Object.values(npcRuntimeControllers && npcRuntimeControllers.controllers || {}).filter((controller) => (
      Number(controller && controller.systemID || 0) === TEST_SYSTEM_ID &&
      String(controller && controller.startupRuleID || "") === `dynamic_gate_concord_${TEST_SYSTEM_ID}`
    )).length,
  };
}

function cleanupSystemNpcShips(systemID) {
  for (const item of listSystemSpaceItems(systemID)) {
    const npcMetadata = parseNpcCustomInfo(item && item.customInfo);
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

function main() {
  const originalTables = {
    characters: readTableSnapshot("characters"),
    items: readTableSnapshot("items"),
    skills: readTableSnapshot("skills"),
    npcControlState: readTableSnapshot("npcControlState"),
    npcEntities: readTableSnapshot("npcEntities"),
    npcModules: readTableSnapshot("npcModules"),
    npcCargo: readTableSnapshot("npcCargo"),
    npcRuntimeControllers: readTableSnapshot("npcRuntimeControllers"),
  };
  const originalConfig = {
    npcAuthoredStartupEnabled: config.npcAuthoredStartupEnabled,
    npcDefaultConcordStartupEnabled: config.npcDefaultConcordStartupEnabled,
    npcDefaultConcordStationScreensEnabled: config.npcDefaultConcordStationScreensEnabled,
  };

  runtime._testing.clearScenes();
  clearControllers();
  cleanupSystemNpcShips(TEST_SYSTEM_ID);
  writeTableSnapshot("npcControlState", DEFAULT_CONTROL_STATE);
  npcControlState.clearRuntimeGateControls();
  database.flushAllSync();

  let session = null;

  try {
    config.npcAuthoredStartupEnabled = false;
    config.npcDefaultConcordStartupEnabled = false;
    config.npcDefaultConcordStationScreensEnabled = false;

    session = createFakeSession(
      TEST_CLIENT_ID,
      TEST_CHARACTER_ID,
      TEST_SYSTEM_ID,
    );
    attachReadySession(session);

    writeTableSnapshot("npcControlState", {
      startupRuleOverrides: {
        [AUTHORED_RULE_ID]: {
          enabled: true,
        },
      },
      characterFlags: {},
      systemGateControls: {},
    });
    database.flushAllSync();

    const overrideOnlyState = npcService.getGateOperatorState(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
    assert.strictEqual(overrideOnlyState.success, true);
    assert.strictEqual(
      overrideOnlyState.data.enabled,
      false,
      "with authored startup disabled, a stale gate startup override should not resurrect persistent gate CONCORD",
    );

    const before = countPersistedNpcResidue();
    const chatHub = {
      messages: [],
      sendSystemMessage(_session, message) {
        this.messages.push(message);
      },
    };
    const commandResult = executeChatCommand(session, "/gateconcord on", chatHub, {});
    assert.strictEqual(commandResult.handled, true);

    database.flushAllSync();

    const dynamicRuleID = npcControlState.getDynamicGateStartupRuleID(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
    const gateState = npcService.getGateOperatorState(
      TEST_SYSTEM_ID,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
    const after = countPersistedNpcResidue();
    const persistedControlState = readDiskJson("npcControlState");
    const systemSummaries = npcService.getNpcOperatorSummary().filter(
      (summary) => summary.systemID === TEST_SYSTEM_ID,
    );

    assert.strictEqual(gateState.success, true);
    assert.strictEqual(gateState.data.source, "dynamic");
    assert.strictEqual(gateState.data.enabled, true);
    assert.deepStrictEqual(gateState.data.startupRuleIDs, [dynamicRuleID]);

    assert(
      systemSummaries.length > 0,
      "expected /gateconcord on to spawn live gate CONCORD controllers",
    );
    assert(
      systemSummaries.every((summary) => summary.startupRuleID === dynamicRuleID),
      "gate operator should use the transient dynamic startup rule, not the authored startup rule",
    );
    assert(
      systemSummaries.every((summary) => summary.transient === true),
      "live /gateconcord controllers should be transient",
    );

    assert.strictEqual(
      after.syntheticCharacterCount,
      before.syntheticCharacterCount,
      "transient /gateconcord should not persist synthetic owner rows to disk",
    );
    assert.strictEqual(
      after.npcMetadataItemCount,
      before.npcMetadataItemCount,
      "transient /gateconcord should not persist NPC item rows to disk",
    );
    assert.strictEqual(
      after.authoredStartupItemCount,
      before.authoredStartupItemCount,
      "operator /gateconcord should not write authored startup-rule CONCORD rows to disk",
    );
    assert.strictEqual(
      after.dynamicStartupItemCount,
      before.dynamicStartupItemCount,
      "transient dynamic gate CONCORD should stay out of the on-disk item table",
    );
    assert.strictEqual(
      after.syntheticSkillRowCount,
      before.syntheticSkillRowCount,
      "transient /gateconcord should not persist synthetic NPC skill rows to disk",
    );
    assert.strictEqual(
      after.nativeDynamicEntityCount,
      before.nativeDynamicEntityCount,
      "transient /gateconcord should not persist native NPC entity rows to disk",
    );
    assert.strictEqual(
      after.nativeDynamicControllerCount,
      before.nativeDynamicControllerCount,
      "transient /gateconcord should not persist native NPC controller rows to disk",
    );

    assert.strictEqual(
      persistedControlState.startupRuleOverrides[AUTHORED_RULE_ID].enabled,
      false,
      "gate operator command should neutralize lingering authored gate startup overrides",
    );
    assert.strictEqual(
      Object.keys(persistedControlState.systemGateControls || {}).length,
      0,
      "gate operator command should stay runtime-only and avoid persisting system gate controls",
    );

    console.log(JSON.stringify({
      ok: true,
      dynamicRuleID,
      liveControllerCount: systemSummaries.length,
      before,
      after,
      gateState: gateState.data,
    }, null, 2));
  } finally {
    try {
      runtime._testing.clearScenes();
    } catch (error) {
      // Best-effort cleanup for selftests.
    }
    try {
      clearControllers();
    } catch (error) {
      // Best-effort cleanup for selftests.
    }

    config.npcAuthoredStartupEnabled = originalConfig.npcAuthoredStartupEnabled;
    config.npcDefaultConcordStartupEnabled = originalConfig.npcDefaultConcordStartupEnabled;
    config.npcDefaultConcordStationScreensEnabled = originalConfig.npcDefaultConcordStationScreensEnabled;

    writeTableSnapshot("characters", originalTables.characters);
    writeTableSnapshot("items", originalTables.items);
    writeTableSnapshot("skills", originalTables.skills);
    npcControlState.clearRuntimeGateControls();
    writeTableSnapshot("npcControlState", originalTables.npcControlState);
    writeTableSnapshot("npcEntities", originalTables.npcEntities);
    writeTableSnapshot("npcModules", originalTables.npcModules);
    writeTableSnapshot("npcCargo", originalTables.npcCargo);
    writeTableSnapshot("npcRuntimeControllers", originalTables.npcRuntimeControllers);
    database.flushAllSync();
  }
}

main();
setImmediate(() => process.exit(0));

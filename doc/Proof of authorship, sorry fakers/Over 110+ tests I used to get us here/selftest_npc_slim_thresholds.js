/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));

const TEST_SYSTEM_ID = 30000145;
const HOSTILE_POSITION = { x: 25000, y: 0, z: 0 };
const CONCORD_POSITION = { x: -25000, y: 0, z: 0 };

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function resetSystem() {
  try {
    npcService.clearNpcControllersInSystem(TEST_SYSTEM_ID, {
      entityType: "all",
      removeContents: true,
    });
  } catch (error) {
    // Best-effort cleanup for selftests.
  }
  clearControllers();
  runtime._testing.clearScenes();
}

function main() {
  resetSystem();

  try {
    const hostileResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      profileQuery: "generic_hostile",
      amount: 1,
      transient: true,
      position: HOSTILE_POSITION,
      anchorName: "Hostile Threshold Test",
    });
    assert.strictEqual(hostileResult.success, true, hostileResult.errorMsg || "failed to spawn hostile NPC");
    const hostileEntity = hostileResult.data.spawned[0].entity;
    const hostileSlim = destiny.buildSlimItemDict(hostileEntity);
    assert.strictEqual(
      getDictValue(hostileSlim, "hostile_response_threshold"),
      11,
      "hostile NPC slim items should default to always-hostile thresholds",
    );
    assert.strictEqual(
      getDictValue(hostileSlim, "friendly_response_threshold"),
      11,
      "hostile NPC slim items should default to no-friendly window",
    );

    const concordResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      profileQuery: "concord_response",
      entityType: "concord",
      amount: 1,
      transient: true,
      position: CONCORD_POSITION,
      anchorName: "Concord Threshold Test",
    });
    assert.strictEqual(concordResult.success, true, concordResult.errorMsg || "failed to spawn CONCORD NPC");
    const concordEntity = concordResult.data.spawned[0].entity;
    const concordSlim = destiny.buildSlimItemDict(concordEntity);
    assert.strictEqual(
      getDictValue(concordSlim, "hostile_response_threshold"),
      -11,
      "CONCORD slim items should default to neutral hostile-response thresholds",
    );
    assert.strictEqual(
      getDictValue(concordSlim, "friendly_response_threshold"),
      11,
      "CONCORD slim items should default to neutral friendly-response thresholds",
    );

    console.log(JSON.stringify({
      ok: true,
      hostileEntityID: hostileEntity.itemID,
      concordEntityID: concordEntity.itemID,
      hostileThresholds: {
        hostile: getDictValue(hostileSlim, "hostile_response_threshold"),
        friendly: getDictValue(hostileSlim, "friendly_response_threshold"),
      },
      concordThresholds: {
        hostile: getDictValue(concordSlim, "hostile_response_threshold"),
        friendly: getDictValue(concordSlim, "friendly_response_threshold"),
      },
    }, null, 2));
  } finally {
    resetSystem();
  }
}

main();
setImmediate(() => process.exit(0));

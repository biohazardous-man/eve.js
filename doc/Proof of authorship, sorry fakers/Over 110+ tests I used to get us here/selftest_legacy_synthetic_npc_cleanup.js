/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const npcService = require(path.join(__dirname, "../../server/src/space/npc"));
const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  buildShipItem,
  findShipItemById,
} = require(path.join(__dirname, "../../server/src/services/inventory/itemStore"));
const {
  clearControllers,
} = require(path.join(__dirname, "../../server/src/space/npc/npcRegistry"));
const nativeNpcStore = require(path.join(
  __dirname,
  "../../server/src/space/npc/nativeNpcStore",
));

const TEST_SYSTEM_ID = 30000011;
const LEGACY_OWNER_CHARACTER_ID = 980123451;
const LEGACY_SHIP_ITEM_ID = 990123451;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readPath(table, recordID) {
  const result = database.read(table, `/${String(recordID)}`);
  return result.success ? cloneValue(result.data) : undefined;
}

function writeOrRemovePath(table, recordID, value) {
  if (value === undefined) {
    database.remove(table, `/${String(recordID)}`);
    return;
  }
  database.write(table, `/${String(recordID)}`, value);
}

function buildLegacyNpcCustomInfo() {
  return JSON.stringify({
    npc: {
      schemaVersion: 1,
      profileID: "generic_hostile",
      loadoutID: "generic_hostile_laser_destroyer",
      behaviorProfileID: "guard_brawler_medium",
      lootTableID: "blood_raider_standard",
      entityType: "npc",
      presentationTypeID: 606,
      presentationName: "Legacy Synthetic NPC",
      ownerCharacterID: LEGACY_OWNER_CHARACTER_ID,
      selectionKind: "startup",
      selectionID: "legacy_cleanup_selftest",
      selectionName: "Legacy Cleanup Selftest",
      startupRuleID: "legacy_synthetic_cleanup_selftest",
      transient: false,
      spawnedAtMs: Date.now(),
      homePosition: {
        x: 125000,
        y: 0,
        z: 0,
      },
      homeDirection: {
        x: 1,
        y: 0,
        z: 0,
      },
      behaviorOverrides: {
        autoAggro: false,
        autoActivateWeapons: false,
      },
    },
  });
}

function seedLegacySyntheticNpcRows() {
  database.write("characters", `/${LEGACY_OWNER_CHARACTER_ID}`, {
    characterID: LEGACY_OWNER_CHARACTER_ID,
    accountID: 0,
    accountId: 0,
    corporationID: 1000125,
    shipID: LEGACY_SHIP_ITEM_ID,
    shortName: "NPC",
    description: "Synthetic NPC owner",
    securityStatus: 0,
    securityRating: 0,
    bounty: 0,
  });
  database.write("skills", `/${LEGACY_OWNER_CHARACTER_ID}`, {
    3300: {
      skillLevel: 5,
      skillPoints: 256000,
    },
  });
  database.write(
    "items",
    `/${LEGACY_SHIP_ITEM_ID}`,
    buildShipItem({
      itemID: LEGACY_SHIP_ITEM_ID,
      typeID: 606,
      ownerID: LEGACY_OWNER_CHARACTER_ID,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      itemName: "Legacy Synthetic NPC",
      customInfo: buildLegacyNpcCustomInfo(),
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: {
          x: 125000,
          y: 0,
          z: 0,
        },
        velocity: {
          x: 0,
          y: 0,
          z: 0,
        },
        direction: {
          x: 1,
          y: 0,
          z: 0,
        },
        targetPoint: {
          x: 125000,
          y: 0,
          z: 0,
        },
        mode: "STOP",
        speedFraction: 0,
      },
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    }),
  );
}

function cleanupLegacySyntheticNpcRows() {
  try {
    npcService.destroyNpcControllerByEntityID(LEGACY_SHIP_ITEM_ID, {
      removeContents: true,
    });
  } catch (error) {
    // Best-effort cleanup for selftests.
  }
  try {
    nativeNpcStore.removeNativeEntityCascade(LEGACY_SHIP_ITEM_ID);
  } catch (error) {
    // Best-effort cleanup for selftests.
  }
  database.remove("items", `/${LEGACY_SHIP_ITEM_ID}`);
  database.remove("skills", `/${LEGACY_OWNER_CHARACTER_ID}`);
  database.remove("characters", `/${LEGACY_OWNER_CHARACTER_ID}`);
}

function main() {
  const originalRows = {
    character: readPath("characters", LEGACY_OWNER_CHARACTER_ID),
    skills: readPath("skills", LEGACY_OWNER_CHARACTER_ID),
    item: readPath("items", LEGACY_SHIP_ITEM_ID),
  };
  runtime._testing.clearScenes();
  clearControllers();
  cleanupLegacySyntheticNpcRows();
  runtime._testing.clearScenes();
  clearControllers();

  try {
    seedLegacySyntheticNpcRows();
    database.flushAllSync();

    assert(
      findShipItemById(LEGACY_SHIP_ITEM_ID),
      "expected seeded legacy synthetic NPC ship row before scene create",
    );

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    assert(scene, "expected cleanup test scene");

    database.flushAllSync();

    assert.strictEqual(
      scene.getEntityByID(LEGACY_SHIP_ITEM_ID),
      null,
      "scene create should purge legacy synthetic NPC entities instead of keeping them alive",
    );
    assert.strictEqual(
      findShipItemById(LEGACY_SHIP_ITEM_ID),
      null,
      "scene create should remove legacy synthetic NPC ship rows from items",
    );
    assert.strictEqual(
      database.read("characters", `/${LEGACY_OWNER_CHARACTER_ID}`).success,
      false,
      "scene create should remove synthetic NPC owner characters from characters",
    );
    assert.strictEqual(
      database.read("skills", `/${LEGACY_OWNER_CHARACTER_ID}`).success,
      false,
      "scene create should remove synthetic NPC owner skill rows from skills",
    );
    assert.strictEqual(
      npcService.getControllerByEntityID(LEGACY_SHIP_ITEM_ID),
      null,
      "scene create should not register a live controller for legacy synthetic NPC residue",
    );
    assert.strictEqual(
      nativeNpcStore.listNativeEntities().find((entry) => (
        Number(entry && entry.entityID || 0) === LEGACY_SHIP_ITEM_ID
      )) || null,
      null,
      "scene create should not migrate legacy synthetic residue into native NPC tables",
    );

    console.log(JSON.stringify({
      ok: true,
      systemID: TEST_SYSTEM_ID,
      legacyOwnerCharacterID: LEGACY_OWNER_CHARACTER_ID,
      legacyShipItemID: LEGACY_SHIP_ITEM_ID,
      cleanedOnSceneCreate: true,
    }, null, 2));
  } finally {
    cleanupLegacySyntheticNpcRows();
    writeOrRemovePath("items", LEGACY_SHIP_ITEM_ID, originalRows.item);
    writeOrRemovePath("skills", LEGACY_OWNER_CHARACTER_ID, originalRows.skills);
    writeOrRemovePath("characters", LEGACY_OWNER_CHARACTER_ID, originalRows.character);
    database.flushAllSync();
    runtime._testing.clearScenes();
    clearControllers();
  }
}

main();
setImmediate(() => process.exit(0));

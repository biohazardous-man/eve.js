process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const npcService = require(path.join(repoRoot, "server/src/space/npc/npcService"));
const nativeNpcStore = require(path.join(repoRoot, "server/src/space/npc/nativeNpcStore"));
const nativeNpcWreckService = require(path.join(repoRoot, "server/src/space/npc/nativeNpcWreckService"));
const shipDestruction = require(path.join(repoRoot, "server/src/space/shipDestruction"));
const InvBrokerService = require(path.join(repoRoot, "server/src/services/inventory/invBrokerService"));
const {
  marshalEncode,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/marshal"));
const {
  findItemById,
  ITEM_FLAGS,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  DEFAULT_STATION,
} = require(path.join(repoRoot, "server/src/services/_shared/stationStaticData"));

const TEST_SYSTEM_ID = 30000142;
const TABLE_NAMES = [
  "characters",
  "items",
  "skills",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcWrecks",
  "npcWreckItems",
];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(tableName) {
  const result = database.read(tableName, "/");
  return result.success ? cloneValue(result.data) : {};
}

function writeTableSnapshot(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot));
}

function snapshotAllTables() {
  return Object.fromEntries(TABLE_NAMES.map((tableName) => ([
    tableName,
    readTableSnapshot(tableName),
  ])));
}

function restoreAllTables(snapshot) {
  for (const tableName of TABLE_NAMES) {
    writeTableSnapshot(tableName, snapshot[tableName] || {});
  }
}

function countRows(tableName, key) {
  const snapshot = readTableSnapshot(tableName);
  const collection = snapshot && typeof snapshot === "object"
    ? snapshot[key]
    : null;
  return collection && typeof collection === "object"
    ? Object.keys(collection).length
    : 0;
}

function createNativeCombatNpc() {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    runtimeKind: "nativeCombat",
    amount: 1,
    profileQuery: "concord_response",
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 150_000, y: 0, z: 75_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.ok(Array.isArray(spawnResult.data.spawned));
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function createTransientPirateNpc() {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "npc",
    amount: 1,
    profileQuery: "generic_hostile",
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 220_000, y: 0, z: 95_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.equal(spawnResult.success, true);
  assert.ok(spawnResult.data);
  assert.equal(spawnResult.data.spawned.length, 1);
  return spawnResult.data.spawned[0].entity;
}

function createInventorySession() {
  return {
    characterID: 140000001,
    charid: 140000001,
    userid: 1,
    stationid: DEFAULT_STATION.stationID,
    stationID: DEFAULT_STATION.stationID,
    shipID: 140000101,
    shipid: 140000101,
    activeShipID: 140000101,
    sendNotification() {},
    currentBoundObjectID: null,
  };
}

test("native NPC destruction creates a native wreck without touching player tables", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const playerCountsBefore = {
      characters: Object.keys(readTableSnapshot("characters")).length,
      items: Object.keys(readTableSnapshot("items")).length,
      skills: Object.keys(readTableSnapshot("skills")).length,
    };

    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);
    assert.ok(destroyResult.data);
    assert.ok(destroyResult.data.wreck);

    const wreckRecord = nativeNpcStore.getNativeWreck(destroyResult.data.wreck.wreckID);
    assert.ok(wreckRecord);
    assert.equal(nativeNpcStore.getNativeEntity(entity.itemID), null);
    assert.equal(nativeNpcStore.getNativeController(entity.itemID), null);
    assert.equal(nativeNpcStore.listNativeModulesForEntity(entity.itemID).length, 0);
    assert.equal(nativeNpcStore.listNativeCargoForEntity(entity.itemID).length, 0);

    const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID);
    assert.ok(wreckItems.length > 0, "expected native wreck contents for destroyed native NPC");

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const wreckEntity = scene.getEntityByID(wreckRecord.wreckID);
    assert.ok(wreckEntity);
    assert.equal(wreckEntity.nativeNpcWreck, true);
    assert.equal(wreckEntity.kind, "wreck");
    assert.ok(
      Number(wreckEntity.structureHP || 0) > 0,
      "expected native wreck entities to carry attackable structure HP even when static wreck dogma omits it",
    );

    const playerCountsAfter = {
      characters: Object.keys(readTableSnapshot("characters")).length,
      items: Object.keys(readTableSnapshot("items")).length,
      skills: Object.keys(readTableSnapshot("skills")).length,
    };
    assert.deepEqual(playerCountsAfter, playerCountsBefore);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("transient pirate NPC spawns now use the native NPC path", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createTransientPirateNpc();
    assert.equal(entity.nativeNpc, true);
    assert.equal(nativeNpcStore.getNativeEntity(entity.itemID) !== null, true);
    assert.equal(nativeNpcStore.getNativeController(entity.itemID) !== null, true);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("default pirate batch spawns now use runtime-only native controllers", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
      entityType: "npc",
      amount: 1,
      profileQuery: "generic_hostile",
      anchorDescriptor: {
        kind: "coordinates",
        position: { x: 320_000, y: 0, z: 145_000 },
        direction: { x: 1, y: 0, z: 0 },
      },
    });
    assert.equal(spawnResult.success, true);
    assert.ok(spawnResult.data);
    assert.equal(spawnResult.data.spawned.length, 1);

    const entity = spawnResult.data.spawned[0].entity;
    const controller = npcService.getControllerByEntityID(entity.itemID);
    assert.equal(entity.nativeNpc, true);
    assert.ok(controller);
    assert.equal(String(controller.runtimeKind || "").startsWith("native"), true);
    assert.equal(controller.transient, true);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("inventory broker can list and loot native wreck contents", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);

    const wreckID = destroyResult.data.wreck.wreckID;
    const contentsBefore = nativeNpcStore.buildNativeWreckContents(wreckID);
    assert.ok(contentsBefore.length > 0);
    const firstItem = contentsBefore[0];

    const invBroker = new InvBrokerService();
    const session = createInventorySession();
    invBroker._rememberBoundContext("test-station-hangar", {
      inventoryID: DEFAULT_STATION.stationID,
      locationID: DEFAULT_STATION.stationID,
      flagID: ITEM_FLAGS.HANGAR,
      kind: "stationHangar",
    });
    session.currentBoundObjectID = "test-station-hangar";

    const listedItems = invBroker._resolveContainerItems(
      session,
      null,
      {
        inventoryID: wreckID,
        locationID: wreckID,
        flagID: null,
        kind: "container",
      },
    );
    assert.equal(listedItems.length, contentsBefore.length);

    const movedItemID = invBroker.Handle_Add(
      [firstItem.itemID, wreckID],
      session,
      { flag: ITEM_FLAGS.HANGAR },
    );
    assert.ok(Number(movedItemID) > 0);

    const lootedItem = findItemById(movedItemID);
    assert.ok(lootedItem);
    assert.equal(Number(lootedItem.locationID), DEFAULT_STATION.stationID);
    assert.equal(Number(lootedItem.flagID), ITEM_FLAGS.HANGAR);

    const contentsAfter = nativeNpcStore.buildNativeWreckContents(wreckID);
    assert.equal(
      contentsAfter.length,
      contentsBefore.length - 1,
      "expected one wreck item to be removed after looting",
    );

    nativeNpcWreckService.destroyNativeWreck(wreckID, {
      systemID: TEST_SYSTEM_ID,
    });
    assert.equal(nativeNpcStore.getNativeWreck(wreckID), null);
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

test("inventory broker native wreck lists marshal large wreck location IDs", () => {
  const tableSnapshot = snapshotAllTables();
  runtime._testing.clearScenes();

  try {
    const entity = createNativeCombatNpc();
    const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
      TEST_SYSTEM_ID,
      entity,
    );
    assert.equal(destroyResult.success, true);

    const wreckID = destroyResult.data.wreck.wreckID;
    const invBroker = new InvBrokerService();
    const session = createInventorySession();
    invBroker._rememberBoundContext("test-native-wreck", {
      inventoryID: wreckID,
      locationID: wreckID,
      flagID: null,
      kind: "container",
    });
    session.currentBoundObjectID = "test-native-wreck";

    const result = invBroker.Handle_List([], session, {
      type: "dict",
      entries: [
        ["flag", null],
        ["machoVersion", 1],
      ],
    });
    assert.ok(result);
    assert.equal(result.type, "list");
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.length > 0);
    assert.doesNotThrow(
      () => marshalEncode(result),
      "Expected native wreck inventory lists to marshal without int32 overflow",
    );
  } finally {
    runtime._testing.clearScenes();
    restoreAllTables(tableSnapshot);
  }
});

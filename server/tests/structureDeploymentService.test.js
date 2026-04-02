const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const StructureDeploymentService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDeploymentService",
));
const StructureDirectoryService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDirectoryService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_STATE,
} = require(path.join(repoRoot, "server/src/services/structure/structureConstants"));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  TYPE_INFRASTRUCTURE_HUB,
  TYPE_TERRITORIAL_CLAIM_UNIT,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovConstants"));
const {
  canSolarSystemSupportSovFlexShowcase,
  TYPE_ANSIBLEX_JUMP_BRIDGE,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovUpgradeSupport"));
const {
  getHubIDForSolarSystem,
  resetSovereigntyModernStateForTests,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovModernState"));
const {
  getSystemState,
  resetSovereigntyStateForTests,
  upsertSystemState,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovState"));
const {
  isSovereigntyClaimableSolarSystem,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovSystemRules"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));

const TEST_CHARACTER_ID = 140000001;
const ASTRAHUS_TYPE_ID = 35832;

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function writeCleanSovereigntyTable(snapshot = {}) {
  writeTable("sovereignty", {
    ...(snapshot || {}),
    alliances: {},
    systems: {},
    hubs: {},
    skyhooks: {},
    mercenaryDens: {},
  });
}

function writeCleanStructuresTable(snapshot = {}) {
  writeTable("structures", {
    ...(snapshot || {}),
    _meta: {
      nextStructureID: 1030000000000,
      generatedAt: null,
      lastUpdatedAt: null,
      ...(snapshot && snapshot._meta ? snapshot._meta : {}),
    },
    structures: [],
  });
}

function buildSpaceSession(solarSystemID, shipID = 990000001) {
  const notifications = [];
  return {
    clientID: 880011,
    userid: TEST_CHARACTER_ID,
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: 980090001,
    corpid: 980090001,
    allianceID: 990090001,
    allianceid: 990090001,
    corprole: 2048n,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    solarsystemid2: solarSystemID,
    solarsystemid: solarSystemID,
    _space: {
      shipID,
      systemID: solarSystemID,
    },
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function findClaimableSolarSystems(count = 2, predicate = null) {
  return worldData.getSolarSystems()
    .filter((solarSystem) => isSovereigntyClaimableSolarSystem(solarSystem))
    .filter((solarSystem) => (
      typeof predicate === "function" ? predicate(solarSystem) : true
    ))
    .slice(0, count)
    .map((solarSystem) => Number(solarSystem.solarSystemID));
}

function keyValEntriesToMap(payload) {
  assert.equal(payload && payload.name, "util.KeyVal");
  assert.equal(payload.args && payload.args.type, "dict");
  return new Map(payload.args.entries);
}

test("machoNet advertises structureDeployment for client routing", () => {
  const machoNet = new MachoNetService();
  const serviceInfo = new Map(machoNet.getServiceInfoDict().entries);

  assert.equal(serviceInfo.has("structureDeployment"), true);
  assert.equal(serviceInfo.get("structureDeployment"), null);
});

test("structureDeployment anchors and unanchors a cargo TCU through sovereignty state", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID);
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: TYPE_TERRITORIAL_CLAIM_UNIT, name: "TCU Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const service = new StructureDeploymentService();
  assert.equal(findItemById(itemID) !== null, true);

  service.Handle_Anchor(
    [itemID, 12345, 67890, 0.25, 1, "Alpha Claim", "", 5, 18, {}],
    session,
  );

  assert.equal(findItemById(itemID), null, "Expected the cargo item to be consumed");
  const system = getSystemState(solarSystemID);
  assert.ok(system, "Expected sovereignty state for the deployed system");
  assert.ok(system.claimStructureID, "Expected a live TCU claim structure");
  const tcu = (system.structures || []).find(
    (structure) => Number(structure.typeID) === TYPE_TERRITORIAL_CLAIM_UNIT,
  );
  assert.ok(tcu, "Expected a TCU structure entry");
  assert.equal(tcu.name, "Alpha Claim");
  assert.equal(Number(tcu.position.x), 12345);
  assert.equal(Number(tcu.position.z), 67890);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnItemChange"),
    true,
    "Expected the deploying client to receive inventory removal feedback",
  );

  service.Handle_Unanchor([system.claimStructureID], session);
  const clearedSystem = getSystemState(solarSystemID);
  assert.equal(Number(clearedSystem.claimStructureID || 0), 0);
});

test("structureDeployment invalidates the modern hub cache when a cargo iHub is anchored", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID, 990000002);
  const service = new StructureDeploymentService();

  assert.equal(getHubIDForSolarSystem(solarSystemID), null, "Expected the modern hub cache to start empty");

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: TYPE_INFRASTRUCTURE_HUB, name: "iHub Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  service.Handle_Anchor(
    [itemID, 20000, 30000, 0, 1, "Modern Hub", "", 5, 18, {}],
    session,
  );

  const system = getSystemState(solarSystemID);
  assert.ok(system.infrastructureHubID, "Expected an anchored iHub");
  assert.equal(
    getHubIDForSolarSystem(solarSystemID),
    system.infrastructureHubID,
    "Expected the modern cache to re-bootstrap from the updated sovereignty system slice",
  );
});

test("structureDirectory GetNearbyJumpBridges exposes aligned Ansiblex destinations for deployment UI parity", (t) => {
  const sovereigntyBackup = readTable("sovereignty");
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("sovereignty", sovereigntyBackup);
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanSovereigntyTable(sovereigntyBackup);
  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [sourceSolarSystemID] = findClaimableSolarSystems(
    1,
    (solarSystem) => canSolarSystemSupportSovFlexShowcase(solarSystem.solarSystemID),
  );
  const [destinationSolarSystemID] = findClaimableSolarSystems(
    1,
    (solarSystem) => Number(solarSystem.solarSystemID) !== Number(sourceSolarSystemID),
  );
  const session = buildSpaceSession(sourceSolarSystemID, 990000003);
  upsertSystemState(sourceSolarSystemID, {
    allianceID: session.allianceID,
    corporationID: session.corporationID,
    infrastructureHubID: 770000001,
    devIndices: {
      militaryPoints: 0,
      industrialPoints: 0,
      claimedForDays: 100,
    },
    structures: [{
      itemID: 770000001,
      typeID: TYPE_INFRASTRUCTURE_HUB,
      ownerID: session.corporationID,
      corporationID: session.corporationID,
      allianceID: session.allianceID,
      position: { x: 0, y: 0, z: 0 },
    }],
  });
  assert.equal(getHubIDForSolarSystem(sourceSolarSystemID), 770000001);

  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: TYPE_ANSIBLEX_JUMP_BRIDGE, name: "Bridge Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const deploymentService = new StructureDeploymentService();
  deploymentService.Handle_Anchor(
    [
      itemID,
      44444,
      55555,
      0,
      1,
      "West Gate",
      "",
      5,
      18,
      { destinationSolarsystemID: destinationSolarSystemID },
    ],
    session,
  );

  const directoryService = new StructureDirectoryService();
  const nearby = directoryService.Handle_GetNearbyJumpBridges([], {
    solarsystemid2: destinationSolarSystemID,
    solarsystemid: destinationSolarSystemID,
  });
  assert.equal(nearby && nearby.type, "list");
  assert.ok(nearby.items.length > 0, "Expected at least one nearby jump bridge entry");

  const matching = nearby.items
    .map((entry) => keyValEntriesToMap(entry))
    .find((entry) => Number(entry.get("solarSystemID")) === sourceSolarSystemID);
  assert.ok(matching, "Expected the source-system Ansiblex to appear in the nearby list");
  assert.equal(Number(matching.get("destinationSolarsystemID")), destinationSolarSystemID);
  assert.equal(matching.get("structureName"), "West Gate");
  assert.equal(matching.get("alignedToCurrentSystem"), true);
});

test("structureDeployment anchors and unanchors a cargo Astrahus through generic structure state", (t) => {
  const structuresBackup = readTable("structures");
  const itemsBackup = readTable("items");
  t.after(() => {
    writeTable("structures", structuresBackup);
    writeTable("items", itemsBackup);
    resetInventoryStoreForTests();
    structureState.clearStructureCaches();
  });

  writeCleanStructuresTable(structuresBackup);
  writeTable("items", itemsBackup);
  resetInventoryStoreForTests();
  structureState.clearStructureCaches();

  const [solarSystemID] = findClaimableSolarSystems(1);
  const session = buildSpaceSession(solarSystemID, 990000004);
  const grantResult = grantItemToCharacterLocation(
    session.characterID,
    session._space.shipID,
    ITEM_FLAGS.CARGO_HOLD,
    { typeID: ASTRAHUS_TYPE_ID, name: "Astrahus Deployment Crate" },
    1,
    { singleton: 1 },
  );
  assert.equal(grantResult.success, true);
  const itemID = grantResult.data.items[0].itemID;

  const service = new StructureDeploymentService();
  service.Handle_Anchor(
    [itemID, 33333, 77777, 0.5, 1, "Client Astrahus", "", 5, 18, {}],
    session,
  );

  assert.equal(findItemById(itemID), null, "Expected the cargo citadel item to be consumed");
  const structures = structureState.listStructuresForSystem(solarSystemID, {
    refresh: true,
    includeDestroyed: false,
  });
  const astrahus = structures.find(
    (structure) =>
      Number(structure.typeID) === ASTRAHUS_TYPE_ID &&
      String(structure.itemName || structure.name || "") === "Client Astrahus",
  );
  assert.ok(astrahus, "Expected the deployed Astrahus to be persisted");
  assert.equal(Number(astrahus.position.x), 33333);
  assert.equal(Number(astrahus.position.z), 77777);
  assert.equal(Number(astrahus.state), STRUCTURE_STATE.ANCHOR_VULNERABLE);
  assert.equal(
    session._notifications.some((entry) => entry.name === "OnItemChange"),
    true,
    "Expected citadel deployment to emit the consumed cargo notification",
  );

  const onlineResult = structureState.setStructureState(
    astrahus.structureID,
    STRUCTURE_STATE.SHIELD_VULNERABLE,
    { clearTimer: true },
  );
  assert.equal(onlineResult.success, true);

  service.Handle_Unanchor([astrahus.structureID], session);
  const decommissioning = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.ok(decommissioning, "Expected the decommissioning Astrahus to stay persisted during unanchor");
  assert.ok(
    Number(decommissioning.unanchoring || 0) > Date.now(),
    "Expected generic structure unanchor to start a future unanchoring timer",
  );

  service.Handle_CancelUnanchor([astrahus.structureID], session);
  const cancelled = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.equal(cancelled.unanchoring, null);

  service.Handle_Unanchor([astrahus.structureID], session);
  const restarted = structureState.getStructureByID(astrahus.structureID, { refresh: true });
  assert.ok(restarted && restarted.unanchoring, "Expected a restarted decommission timer");
  structureState.tickStructures(Number(restarted.unanchoring) + 1);
  assert.equal(
    structureState.getStructureByID(astrahus.structureID, { refresh: true }),
    null,
    "Expected generic structure to be removed after its unanchoring timer expires",
  );
});

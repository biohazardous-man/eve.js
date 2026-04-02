const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const CONTAINER_HANGAR_ID = 10004;
const CONTAINER_STRUCTURE_ID = 10014;

const originalGetStructureByID = structureState.getStructureByID;

function buildSession() {
  return {
    clientID: 65450,
    characterID: 140000002,
    charid: 140000002,
    userid: 1,
    structureID: 1030000000000,
    structureid: 1030000000000,
    locationid: 1030000000000,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    sendNotification() {},
  };
}

function buildStructure() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    itemName: "Test Astrahus",
    solarSystemID: 30002187,
  };
}

function extractBoundID(boundValue) {
  return (
    boundValue &&
    boundValue.type === "substruct" &&
    boundValue.value &&
    boundValue.value.type === "substream" &&
    Array.isArray(boundValue.value.value)
      ? boundValue.value.value[0]
      : null
  );
}

function toEntryMap(keyVal) {
  assert.equal(keyVal && keyVal.name, "util.KeyVal");
  return new Map((keyVal.args && keyVal.args.entries) || []);
}

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
});

test("structure-docked inventory bindings expose the real structure item for hangar and containerStructure lookups", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  for (const containerID of [CONTAINER_HANGAR_ID, CONTAINER_STRUCTURE_ID]) {
    const bound = service.Handle_GetInventory([containerID], session);
    const boundID = extractBoundID(bound);
    assert.ok(boundID, `Expected bound inventory ID for container ${containerID}`);
    session.currentBoundObjectID = boundID;

    const selfItem = toEntryMap(service.Handle_GetSelfInvItem([], session));

    assert.equal(selfItem.get("itemID"), structure.structureID);
    assert.equal(selfItem.get("typeID"), structure.typeID);
    assert.equal(selfItem.get("ownerID"), structure.ownerCorpID);
    assert.equal(selfItem.get("locationID"), structure.structureID);
    assert.equal(selfItem.get("groupID"), structureType.groupID);
    assert.equal(selfItem.get("categoryID"), structureType.categoryID);
    assert.equal(selfItem.get("singleton"), 1);
    assert.equal(selfItem.get("stacksize"), 1);
  }
});

test("GetItem on the docked structure ID returns a structure-shaped inventory row instead of a station shim", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const result = service.Handle_GetItem([structure.structureID], session);
  const entries = new Map(result.args.entries);
  const row = entries.get("line");

  assert.equal(row[0], structure.structureID);
  assert.equal(row[1], structure.typeID);
  assert.equal(row[2], structure.ownerCorpID);
  assert.equal(row[3], structure.structureID);
  assert.equal(row[6], structureType.groupID);
  assert.equal(row[7], structureType.categoryID);
});

test("structure inventory packed rows marshal when the docked locationID exceeds int32", () => {
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const packedRows = service._buildInventoryRemoteList([
    service._buildStructureItemOverrides(session),
    service._buildInventoryItemOverrides(session, {
      itemID: 990112614,
      typeID: 621,
      ownerID: session.characterID,
      locationID: structure.structureID,
      flagID: 4,
      quantity: -1,
      groupID: 25,
      categoryID: 6,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    }),
  ]);

  assert.doesNotThrow(
    () => marshalEncode(packedRows),
    "Expected structure-docked inventory packed rows to marshal large locationIDs safely",
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  removeInventoryItem,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

const transientItemIDs = [];

function findDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    const stationID = Number(
      characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
    ) || 0;
    if (!characterRecord || !activeShip || stationID <= 0) {
      continue;
    }

    return {
      characterID,
      stationID,
      shipID: Number(activeShip.itemID) || 0,
    };
  }

  assert.fail("Expected at least one docked character with an active ship");
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 92000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    activeShipID: candidate.shipID,
    sendNotification() {},
  };
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }

  const entry = value.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

function getDictEntryMap(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return new Map();
  }
  return new Map(value.entries);
}

test.afterEach(() => {
  for (const itemID of transientItemIDs.splice(0)) {
    if (itemID > 0) {
      removeInventoryItem(itemID, { removeContents: true });
    }
  }
  resetInventoryStoreForTests();
});

test("docked ship-info GetAllInfo still carries char brain for station ship switching", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();

  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const charInfo = getKeyValEntry(allInfo, "charInfo");

  assert.ok(
    Array.isArray(charInfo),
    "Expected docked ship-info GetAllInfo to include charInfo for client brain bootstrap",
  );
  assert.equal(charInfo.length, 2, "Expected charInfo to carry [characterInfo, charBrain]");
  assert.ok(
    charInfo[0] && charInfo[0].type === "dict",
    "Expected charInfo[0] to remain a packed character info dict",
  );
  assert.deepEqual(
    charInfo[1],
    [0, [], [], []],
    "Expected docked char brain payload to stay on the four-slot V23.02 contract",
  );
});

test("docked ship-info GetAllInfo keeps dogma invItem rows on the CCP customInfo-stacksize-singleton order", () => {
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();

  const allInfo = dogma.Handle_GetAllInfo([false, true, null], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipEntry = getDictEntryMap(shipInfo).get(candidate.shipID);
  assert.ok(shipEntry, "Expected GetAllInfo shipInfo to include the active docked ship");

  const shipFields = new Map(shipEntry.args.entries);
  const invItem = shipFields.get("invItem");
  assert.ok(invItem, "Expected shipInfo entry to include invItem");

  const invEntries = new Map(invItem.args.entries);
  const header = invEntries.get("header");
  const line = invEntries.get("line");

  assert.deepEqual(
    header,
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
    "Expected dogma invItem header order to match the live client inventory row contract",
  );
  assert.equal(
    line.length,
    header.length,
    "Expected dogma invItem row length to match the row header",
  );
  assert.equal(
    line[8],
    String(line[8] ?? ""),
    "Expected customInfo to remain in the ninth slot of the dogma invItem row",
  );
  assert.equal(
    Number(line[9]) >= 0,
    true,
    "Expected stacksize to occupy the tenth slot of the dogma invItem row",
  );
  assert.ok(
    Number.isInteger(Number(line[10])),
    "Expected singleton to occupy the final slot of the dogma invItem row",
  );
});

test("dogma ItemGetInfo keeps stackable invItem rows on the CCP customInfo-stacksize-singleton order", () => {
  resetInventoryStoreForTests();
  const candidate = findDockedCandidate();
  const session = buildDockedSession(candidate);
  const dogma = new DogmaService();
  const droneType = resolveItemByName("Acolyte II");
  assert.equal(droneType && droneType.success, true, "Expected Acolyte II metadata");

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.shipID,
    ITEM_FLAGS.DRONE_BAY,
    droneType.match,
    5,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected a transient stacked drone item");
  const stackedDroneItem = grantResult.data && grantResult.data.items && grantResult.data.items[0];
  assert.ok(stackedDroneItem && stackedDroneItem.itemID, "Expected the transient stack to have an itemID");
  transientItemIDs.push(Number(stackedDroneItem.itemID) || 0);

  const itemInfo = dogma.Handle_ItemGetInfo([stackedDroneItem.itemID], session);
  const itemFields = new Map(itemInfo.args.entries);
  const invItem = itemFields.get("invItem");
  assert.ok(invItem, "Expected ItemGetInfo to expose invItem");

  const invEntries = new Map(invItem.args.entries);
  const header = invEntries.get("header");
  const line = invEntries.get("line");
  assert.deepEqual(
    header,
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
    "Expected ItemGetInfo invItem header order to match CCP dogma rows",
  );
  assert.equal(
    Number(line[9]),
    5,
    "Expected stacksize to remain in the tenth slot for stacked dogma invItem rows",
  );
  assert.equal(
    Number(line[10]),
    0,
    "Expected singleton to remain in the final slot for stacked dogma invItem rows",
  );
});

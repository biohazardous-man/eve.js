const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildItemChangePayload,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function extractChangeKeys(payload) {
  const changeDict = Array.isArray(payload) ? payload[1] : null;
  if (!changeDict || changeDict.type !== "dict" || !Array.isArray(changeDict.entries)) {
    return [];
  }
  return changeDict.entries
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
    .filter((key) => key > 0)
    .sort((left, right) => left - right);
}

test("stackable inventory item changes prefer ixStackSize over ixQuantity", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990001,
      typeID: 34,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 5,
      quantity: 4,
      stacksize: 4,
      singleton: 0,
      groupID: 18,
      categoryID: 8,
      customInfo: "",
    },
    {
      locationID: 990101212,
      flagID: 5,
      quantity: 5,
      stacksize: 5,
      singleton: 0,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [10],
    "Expected stackable cargo updates to advertise ixStackSize only",
  );
});

test("singleton inventory item changes still keep their non-quantity deltas", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990002,
      typeID: 594,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: 53,
      categoryID: 7,
      customInfo: "",
    },
    {
      locationID: 60003760,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [3],
    "Expected singleton item moves to keep their location delta intact",
  );
});

test("inventory item changes marshal when locationID exceeds int32", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 980400000000,
      typeID: 34,
      ownerID: 1000134,
      locationID: 980300000000,
      flagID: 4,
      quantity: 10,
      stacksize: 10,
      singleton: 0,
      groupID: 18,
      categoryID: 4,
      customInfo: "",
    },
    {
      locationID: 980300000000,
      flagID: 4,
      quantity: 12,
      stacksize: 12,
      singleton: 0,
    },
  );

  assert.doesNotThrow(
    () => marshalEncode(payload),
    "Expected large wreck-backed location IDs to marshal in item change payloads",
  );
});

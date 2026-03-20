const assert = require("assert");
const path = require("path");

const {
  buildItemChangePayload,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));

function main() {
  const item = {
    itemID: 42,
    typeID: 20020,
    ownerID: 140000004,
    locationID: 140000333,
    flagID: 5,
    quantity: 7,
    groupID: 86,
    categoryID: 8,
    customInfo: "",
    singleton: 0,
    stacksize: 7,
  };

  const payload = buildItemChangePayload(item, {
    quantity: 6,
    singleton: 1,
    stacksize: 6,
  });

  const changeEntries =
    payload &&
    Array.isArray(payload) &&
    payload[1] &&
    payload[1].type === "dict" &&
    Array.isArray(payload[1].entries)
      ? payload[1].entries
      : [];
  const changeMap = new Map(changeEntries);

  assert.strictEqual(changeMap.get(5), 6, "Expected quantity changes to use ixQuantity");
  assert.strictEqual(changeMap.get(9), 1, "Expected singleton changes to use the singleton column index");
  assert.strictEqual(changeMap.get(10), 6, "Expected stacksize changes to use the stacksize column index");

  console.log(JSON.stringify({
    ok: true,
    changeEntries,
  }, null, 2));
}

main();

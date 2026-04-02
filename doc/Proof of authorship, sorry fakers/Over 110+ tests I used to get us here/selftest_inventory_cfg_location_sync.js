/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const {
  syncInventoryItemForSession,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));

function captureNotifications() {
  const notifications = [];
  return {
    session: {
      characterID: 140000003,
      stationid: 60003760,
      solarsystemid2: 30000142,
      sendNotification(name, scope, payload) {
        notifications.push({ name, scope, payload });
      },
    },
    notifications,
  };
}

function findNotification(notifications, name) {
  return notifications.find((entry) => entry.name === name) || null;
}

function main() {
  const shipCapture = captureNotifications();
  syncInventoryItemForSession(
    shipCapture.session,
    {
      itemID: 140000152,
      typeID: 11019,
      ownerID: 140000003,
      locationID: 60003760,
      flagID: 4,
      quantity: -1,
      groupID: 25,
      categoryID: 6,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
      itemName: "Cockroach",
    },
    {},
    { emitCfgLocation: true },
  );

  const shipCfgChange = findNotification(
    shipCapture.notifications,
    "OnCfgDataChanged",
  );
  assert(shipCfgChange, "Ships should still emit evelocations updates");
  assert.strictEqual(shipCfgChange.payload[0], "evelocations");
  assert.strictEqual(shipCfgChange.payload[1].type, "list");
  assert.strictEqual(
    shipCfgChange.payload[1].items.length,
    7,
    "Ship evelocations updates should use the 7-column client row shape",
  );
  assert.strictEqual(shipCfgChange.payload[1].items[0], 140000152);
  assert.strictEqual(shipCfgChange.payload[1].items[1], "Cockroach");
  assert.strictEqual(shipCfgChange.payload[1].items[2], 30000142);

  const moduleCapture = captureNotifications();
  syncInventoryItemForSession(
    moduleCapture.session,
    {
      itemID: 140001001,
      typeID: 434,
      ownerID: 140000003,
      locationID: 140000152,
      flagID: 27,
      quantity: 1,
      groupID: 55,
      categoryID: 7,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
      itemName: "Warp Scrambler I",
    },
    {
      locationID: 60003760,
      flagID: 4,
    },
    { emitCfgLocation: true },
  );

  const moduleCfgChange = findNotification(
    moduleCapture.notifications,
    "OnCfgDataChanged",
  );
  assert.strictEqual(
    moduleCfgChange,
    null,
    "Fitted modules should not emit evelocations updates",
  );
  assert(
    findNotification(moduleCapture.notifications, "OnItemChange"),
    "Fitted modules should still emit inventory item changes",
  );

  console.log(JSON.stringify({
    ok: true,
    shipCfgColumns: shipCfgChange.payload[1].items.length,
    moduleNotifications: moduleCapture.notifications.map((entry) => entry.name),
  }, null, 2));
}

main();

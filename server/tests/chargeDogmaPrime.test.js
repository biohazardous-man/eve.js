const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  buildInventoryItem,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  getAttributeIDByNames,
  getLoadedChargeItems,
  getFittedModuleItems,
  isModuleOnline,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  getCharacterRecord,
  getActiveShipRecord,
  syncChargeSublocationTransitionForSession,
  syncLoadedChargeDogmaBootstrapForSession,
  _testing: characterStateTesting,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));

const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildLoadedCharge(typeName, itemID, shipID, flagID, quantity = 1) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 0,
    quantity,
    stacksize: quantity,
  });
}

function findLiveSpaceChargeCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Expected to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (
      !characterRecord ||
      !ship ||
      !ship.spaceState ||
      Number(characterRecord.stationID || characterRecord.stationid || 0) > 0
    ) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (!fittedModules.some((moduleItem) => isModuleOnline(moduleItem))) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length === 0) {
      continue;
    }

    return loadedCharges[0];
  }

  assert.fail("Expected an in-space character with a loaded fitted charge");
}

function findLiveSpaceChargeBootstrapCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Expected to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (
      !characterRecord ||
      !ship ||
      !ship.spaceState ||
      Number(characterRecord.stationID || characterRecord.stationid || 0) > 0
    ) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length <= 0) {
      continue;
    }

    return {
      characterID,
      shipID: ship.itemID,
      loadedCharge: loadedCharges[0],
    };
  }

  assert.fail("Expected an in-space character with a loaded fitted charge bootstrap candidate");
}

function readPrimeAttributes(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const attributeEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "attributes",
  );
  const attributeEntries =
    attributeEntry &&
    attributeEntry[1] &&
    attributeEntry[1].type === "dict" &&
    Array.isArray(attributeEntry[1].entries)
      ? attributeEntry[1].entries
      : [];

  return new Map(
    attributeEntries.map((entry) => [
      Number(Array.isArray(entry) ? entry[0] : 0) || 0,
      Number(Array.isArray(entry) ? entry[1] : 0) || 0,
    ]),
  );
}

function readPrimeInvItem(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return null;
  }
  const header =
    invItem.args.entries.find((entry) => Array.isArray(entry) && entry[0] === "header")?.[1] || [];
  const line =
    invItem.args.entries.find((entry) => Array.isArray(entry) && entry[0] === "line")?.[1] || [];
  const fields = {};
  for (let index = 0; index < header.length; index += 1) {
    fields[String(header[index])] = line[index];
  }
  return fields;
}

function readPrimeInvHeader(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return [];
  }
  return (
    invItem.args.entries.find(
      (entry) => Array.isArray(entry) && entry[0] === "header",
    )?.[1] || []
  );
}

function readInventoryDescriptorColumns(descriptor) {
  return Array.isArray(descriptor && descriptor.header) &&
    Array.isArray(descriptor.header[1]) &&
    Array.isArray(descriptor.header[1][0])
    ? descriptor.header[1][0].map((column) =>
      Array.isArray(column) ? String(column[0]) : String(column),
    )
    : [];
}

function readInventoryDescriptorColumnPairs(descriptor) {
  return Array.isArray(descriptor && descriptor.header) &&
    Array.isArray(descriptor.header[1]) &&
    Array.isArray(descriptor.header[1][0])
    ? descriptor.header[1][0].map((column) => [
      String(Array.isArray(column) ? column[0] : column),
      Number(Array.isArray(column) ? column[1] : NaN),
    ])
    : [];
}

function readOnItemChangeKeys(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const changeDict =
    Array.isArray(payload) && payload[1] && payload[1].type === "dict"
      ? payload[1]
      : null;
  return Array.isArray(changeDict && changeDict.entries)
    ? changeDict.entries
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
      .filter((key) => key > 0)
      .sort((left, right) => left - right)
    : [];
}

function readOnItemChangeDescriptorColumnPairs(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.type === "packedrow" &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) => [
      String(Array.isArray(column) ? column[0] : column),
      Number(Array.isArray(column) ? column[1] : NaN),
    ])
    : [];
}

function readOnItemChangeItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.fields &&
    row.fields.itemID !== undefined
    ? row.fields.itemID
    : null;
}

function readOnGodmaPrimeTupleItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const primeEntry = Array.isArray(payload) ? payload[1] : null;
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return null;
  }
  const lineEntry = invItem.args.entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "line",
  );
  return Array.isArray(lineEntry && lineEntry[1]) ? lineEntry[1][0] : null;
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

test("charge tuple godma prime stays on the public quantity-only contract", () => {
  const chargeItem = buildLoadedCharge(
    "Gleam L",
    983100021,
    983100001,
    27,
    1,
  );

  const primeEntry = characterStateTesting.buildChargeDogmaPrimeEntry(chargeItem);
  const attributes = readPrimeAttributes(primeEntry);
  const invItem = readPrimeInvItem(primeEntry);
  const invHeader = readPrimeInvHeader(primeEntry);

  assert.equal(Number(attributes.get(ATTRIBUTE_QUANTITY)), 1);
  assert.equal(attributes.size, 1);
  assert.deepEqual(
    invHeader,
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
      "singleton",
      "stacksize",
    ],
  );
  assert.equal(invItem && invItem.typeID, chargeItem.typeID);
  assert.equal(invItem && invItem.locationID, chargeItem.locationID);
  assert.equal(invItem && invItem.flagID, chargeItem.flagID);
  assert.equal(invItem && invItem.stacksize, 1);
  assert.equal(invItem && invItem.quantity, 1);
  assert.equal(invItem && invItem.singleton, 0);
});

test("live fitted charge primes keep quantity on the public quantity-only contract", () => {
  const liveChargeItem = findLiveSpaceChargeCandidate();

  const primeEntry = characterStateTesting.buildChargeDogmaPrimeEntry(liveChargeItem);
  const attributes = readPrimeAttributes(primeEntry);
  const invItem = readPrimeInvItem(primeEntry);
  const expectedQuantity = Number(liveChargeItem.stacksize ?? liveChargeItem.quantity ?? 0);

  assert.equal(
    Number(attributes.get(ATTRIBUTE_QUANTITY)),
    expectedQuantity,
    "Expected a live fitted charge prime to preserve the current loaded quantity",
  );
  assert.equal(
    attributes.size,
    1,
    "Expected a live fitted charge prime to stay on quantity-only dogma parity",
  );
  assert.equal(invItem && invItem.typeID, liveChargeItem.typeID);
  assert.equal(invItem && invItem.locationID, liveChargeItem.locationID);
  assert.equal(invItem && invItem.flagID, liveChargeItem.flagID);
  assert.equal(invItem && invItem.stacksize, expectedQuantity);
  assert.equal(invItem && invItem.singleton, 0);
});

test("invbroker item descriptor marks singleton/stacksize as DBTYPE_EMPTY so godma filters them from sublocrd", () => {
  const invBroker = new InvBrokerService();
  const descriptor = invBroker.Handle_GetItemDescriptor([], null);

  // godma.py builds sublocrd / subloc_internalrd by iterating the descriptor
  // and filtering with `if dbtype == 0 and size == 0: continue`.  singleton
  // and stacksize must use DBTYPE_EMPTY (0) so that filter removes them —
  // otherwise the derived descriptors expect too many columns and CCP code
  // crashes with "sequence is too short" when constructing blue.DBRow for
  // charge tuples.
  assert.deepEqual(
    readInventoryDescriptorColumnPairs(descriptor),
    [
      ["itemID", 20],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
      ["stacksize", 0],
      ["singleton", 0],
    ],
  );
  assert.deepEqual(
    readInventoryDescriptorColumns(descriptor),
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
  );
});

test("same-type tuple charge transitions keep live ammo consumption on ixStackSize only", () => {
  const heavyMissile = resolveExactItem("Scourge Heavy Missile");
  const notifications = [];
  const session = {
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationTransitionForSession(session, {
    shipID: 990114054,
    flagID: 27,
    ownerID: 140000003,
    previousState: { typeID: heavyMissile.typeID, quantity: 12 },
    nextState: { typeID: heavyMissile.typeID, quantity: 11 },
    primeNextCharge: false,
  });

  const tupleRow = notifications.find(
    (entry) => entry && entry.name === "OnItemChange",
  );
  assert.ok(tupleRow, "Expected a same-type ammo decrement to emit a tuple-backed OnItemChange");
  assert.deepEqual(
    readOnItemChangeKeys(tupleRow),
    [3, 4, 10],
    "Expected same-type live ammo consumption to stay on the tuple-backed location/flag/stacksize repair contract",
  );
  assert.deepEqual(
    readOnItemChangeDescriptorColumnPairs(tupleRow),
    [
      ["itemID", 129],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
      ["singleton", 2],
      ["stacksize", 3],
    ],
    "Expected tuple-backed ammo repair rows to stay on the reference charge sublocation descriptor contract",
  );
  assert.equal(
    notifications.some((entry) => entry && entry.name === "OnGodmaPrimeItem"),
    false,
    "Expected same-type live ammo consumption to avoid re-priming an already-live tuple charge",
  );
});

test("type-swapped tuple charge transitions queue the tuple repair after godma-prime", () => {
  const scourgeHeavy = resolveExactItem("Scourge Heavy Missile");
  const mjolnirHeavy = resolveExactItem("Mjolnir Heavy Missile");
  const notifications = [];
  const session = {
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationTransitionForSession(session, {
    shipID: 990114054,
    flagID: 27,
    ownerID: 140000003,
    previousState: { typeID: scourgeHeavy.typeID, quantity: 12 },
    nextState: { typeID: mjolnirHeavy.typeID, quantity: 10 },
    primeNextCharge: true,
  });

  const tupleRow = notifications.find(
    (entry) => {
      if (!entry || entry.name !== "OnItemChange") {
        return false;
      }
      const itemID = readOnItemChangeItemID(entry);
      return (
        Array.isArray(itemID) &&
        Number(itemID[0]) === 990114054 &&
        Number(itemID[1]) === 27 &&
        Number(itemID[2]) === Number(mjolnirHeavy.typeID)
      );
    },
  );
  assert.equal(
    tupleRow,
    undefined,
    "Expected a live ammo type swap to defer the tuple-backed OnItemChange until the post-prime repair timer fires",
  );
  assert.equal(
    notifications.some((entry) => entry && entry.name === "OnGodmaPrimeItem"),
    true,
    "Expected a live ammo type swap to still godma-prime the new tuple charge item",
  );

  const timers =
    session._space && session._space._chargeSublocationReplayTimers instanceof Map
      ? [...session._space._chargeSublocationReplayTimers.values()]
      : [];
  assert.ok(
    timers.length > 0,
    "Expected a live ammo type swap to schedule a delayed tuple-backed repair",
  );
  for (const timer of timers) {
    clearTimeout(timer);
  }
});

test("refresh-only charge bootstrap stays on tuple-row repair only and schedules a delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "refresh-only",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.ok(
    session._space._chargeBootstrapRepairTimer,
    "Expected refresh-only HUD charge recovery to schedule one delayed tuple-backed repair",
  );
  assert.equal(immediateTupleRepairs.length >= 1, true);
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected refresh-only HUD charge recovery to avoid re-priming the tuple charge and stay on item-change repairs only",
  );
  assert.equal(
    readOnItemChangeKeys(immediateTupleRepairs[0]).includes(10),
    true,
    "Expected refresh-only HUD charge recovery to immediately restate the tuple row through ixStackSize repair data",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const latestTupleRepair = delayedTupleRepairs[delayedTupleRepairs.length - 1];

  assert.equal(
    delayedTupleRepairs.length >= (immediateTupleRepairs.length + 1),
    true,
    "Expected refresh-only HUD charge recovery to emit a final tuple-backed repair after the client's synthetic prime rows",
  );
  assert.deepEqual(
    readOnItemChangeKeys(latestTupleRepair),
    [3, 4, 10],
    "Expected the delayed refresh-only tuple repair to stay on the location/flag/stacksize contract",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("quantity-and-repair charge bootstrap skips tuple godma-prime but still sends quantity bootstrap before the delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "quantity-and-repair",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected quantity-and-repair HUD charge recovery to avoid re-priming the tuple charge when MakeShipActive already created it",
  );
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected quantity-and-repair HUD charge recovery to defer tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected quantity-and-repair HUD charge recovery to bootstrap tuple quantity through OnModuleAttributeChanges",
  );
  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected quantity-and-repair HUD charge recovery to emit a delayed tuple-backed repair after the quantity bootstrap",
  );
  assert.equal(
    firstQuantityBootstrapIndex >= 0 && firstQuantityBootstrapIndex < firstTupleRepairIndex,
    true,
    "Expected the tuple quantity bootstrap to land before the delayed tuple row repair when tuple godma-prime is skipped",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("repair-then-quantity charge bootstrap skips tuple godma-prime and restates the tuple row before quantity", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "repair-then-quantity",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected repair-then-quantity charge recovery to avoid re-priming the tuple charge",
  );
  assert.equal(
    immediateTupleRepairs.length >= 1,
    true,
    "Expected repair-then-quantity charge recovery to restate the tuple row immediately",
  );
  assert.equal(
    readOnItemChangeKeys(immediateTupleRepairs[0]).includes(10),
    true,
    "Expected repair-then-quantity charge recovery to keep the tuple row on ixStackSize repair data",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected repair-then-quantity charge recovery to bootstrap tuple quantity after the tuple row exists",
  );
  assert.equal(
    firstTupleRepairIndex >= 0 && firstTupleRepairIndex < firstQuantityBootstrapIndex,
    true,
    "Expected the tuple row repair to land before the tuple quantity bootstrap for login recovery",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("prime-and-repair charge bootstrap sends quantity bootstrap before the delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "prime-and-repair",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    true,
    "Expected prime-and-repair HUD charge recovery to godma-prime the tuple charge first",
  );
  assert.equal(
    immediateTupleRepairs.length,
    0,
    "Expected prime-and-repair HUD charge recovery to defer the tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected prime-and-repair HUD charge recovery to bootstrap tuple quantity through OnModuleAttributeChanges",
  );
  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected prime-and-repair HUD charge recovery to emit a delayed tuple-backed repair after the quantity bootstrap",
  );
  assert.equal(
    firstQuantityBootstrapIndex >= 0 && firstQuantityBootstrapIndex < firstTupleRepairIndex,
    true,
    "Expected the tuple quantity bootstrap to land before the delayed tuple row repair",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("prime-repair-then-quantity charge bootstrap primes first, then repairs the tuple row before the follow-up quantity", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "prime-repair-then-quantity",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to godma-prime the tuple charge first",
  );
  assert.equal(
    immediateTupleRepairs.length,
    0,
    "Expected prime-repair-then-quantity HUD charge recovery to defer the tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));

  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to emit a delayed tuple-backed repair after the godma-prime",
  );
  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to resend tuple quantity after the repaired row",
  );
  assert.equal(
    firstTupleRepairIndex >= 0 && firstTupleRepairIndex < firstQuantityBootstrapIndex,
    true,
    "Expected the repaired tuple row to land before the follow-up tuple quantity in prime-repair-then-quantity mode",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

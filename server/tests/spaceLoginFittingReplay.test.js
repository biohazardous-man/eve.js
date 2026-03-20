const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  getLoadedChargeItems,
  isModuleOnline,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const { ITEM_FLAGS } = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const ATTRIBUTE_QUANTITY = 805;

function buildLoginStyleSession(candidate) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: candidate.characterID + 9100,
    userid: candidate.characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function findSpaceLoginCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  let fallbackCandidate = null;
  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (fittedModules.length === 0) {
      continue;
    }

    const onlineModules = fittedModules.filter((item) => isModuleOnline(item));
    if (onlineModules.length === 0) {
      continue;
    }

    const candidate = {
      characterID,
      ship,
      fittedModules,
      onlineModules,
      loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
    };
    if (candidate.loadedCharges.length > 0) {
      return candidate;
    }
    if (!fallbackCandidate) {
      fallbackCandidate = candidate;
    }
  }

  if (fallbackCandidate) {
    return fallbackCandidate;
  }

  assert.fail("Expected an in-space character with online fitted modules");
}

function extractKeyValEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "object" &&
    value.name === "util.KeyVal" &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
  ) {
    return value.args.entries;
  }
  return [];
}

function extractDictEntries(value) {
  if (value && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

function getKeyValEntry(value, key) {
  return extractKeyValEntries(value).find((entry) => entry[0] === key)?.[1] ?? null;
}

function extractOnItemChangeItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return Number(itemRow && itemRow.itemID) || 0;
    })
    .filter((itemID) => itemID > 0)
    .sort((left, right) => left - right);
}

function extractOnItemChangeRawItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return itemRow ? itemRow.itemID : null;
    })
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function extractOnItemChangeKeysByItemID(notifications) {
  const byItemID = new Map();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = Number(itemRow && itemRow.itemID) || 0;
    if (!itemID) {
      continue;
    }
    const changeEntries =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
        : [];
    byItemID.set(
      itemID,
      changeEntries
        .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
        .filter((key) => key > 0)
        .sort((left, right) => left - right),
    );
  }
  return byItemID;
}

function getLatestOnItemChangeKeysByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  let latestKeys = [];

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = itemRow && itemRow.itemID;
    if (
      !Array.isArray(itemID) ||
      Number(itemID[0]) !== numericShipID ||
      Number(itemID[1]) !== numericFlagID ||
      Number(itemID[2]) !== numericTypeID
    ) {
      continue;
    }
    const changeEntries =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
        : [];
    latestKeys = changeEntries
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
      .filter((key) => key > 0)
      .sort((left, right) => left - right);
  }

  return latestKeys;
}

function countRawOnItemChangesByItemID(notifications, expectedItemID) {
  const numericExpectedItemID = Number(expectedItemID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) => Number(itemID) === numericExpectedItemID,
  ).length;
}

function countRawOnItemChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) =>
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID,
  ).length;
}

function countChargeQuantityChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractModuleAttributeChanges(notifications).filter((change) => {
    const itemID = Array.isArray(change) ? change[2] : null;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID &&
      Number(Array.isArray(change) ? change[3] : 0) === ATTRIBUTE_QUANTITY
    );
  }).length;
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
}

async function waitForNotifications(predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("space login restore seeds fitted modules while keeping loaded charges on the charge-state bootstrap path", async () => {
  const candidate = findSpaceLoginCandidate();
  const session = buildLoginStyleSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(session.notifications.length, 0);

  const restored = restoreSpaceSession(session);

  assert.equal(restored, true);
  assert.ok(session._space, "expected restoreSpaceSession to attach the space session");
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected login-in-space restore to queue a post-prime fitted-module replay for clientDogmaIM module hydration",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginShipInventoryList,
    true,
    "expected login-in-space restore to hold the fitted-module replay until ship inventory prime completes",
  );
  assert.equal(session._space.loginShipInventoryPrimed, false);
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);
  assert.equal(
    session._space.loginChargeDogmaReplayMode,
    "prime-and-refresh",
    "expected login-in-space restore to seed loaded charge sublocations through the shared godma-prime bootstrap path",
  );
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    [],
    "expected restoreSpaceSession to avoid replaying loaded charge inventory rows in space",
  );
  assert.equal(
    session.notifications.some(
      (notification) => notification.name === "OnGodmaShipEffect",
    ),
    false,
    "expected restoreSpaceSession to avoid synthetic fitting effect replay notifications",
  );

  const initialDogmaInfo = dogma.Handle_GetAllInfo([true, true, null], session);
  const initialShipInfo = getKeyValEntry(initialDogmaInfo, "shipInfo");
  const initialShipState = getKeyValEntry(initialDogmaInfo, "shipState");
  const initialShipInfoEntries = extractDictEntries(initialShipInfo);
  const initialShipStateEntries = extractDictEntries(initialShipState && initialShipState[0]);
  const initialChargeStateEntries = extractDictEntries(initialShipState && initialShipState[1]);
  const initialChargeFlags =
    initialChargeStateEntries.length > 0
      ? extractDictEntries(initialChargeStateEntries[0][1])
          .map((entry) => Number(entry[0]) || 0)
          .filter((flagID) => flagID > 0)
          .sort((left, right) => left - right)
      : [];
  const expectedChargeFlags = candidate.loadedCharges
    .map((item) => Number(item.flagID) || 0)
    .filter((flagID) => flagID > 0)
    .sort((left, right) => left - right);

  assert.equal(
    initialShipInfoEntries.length,
    1 + candidate.fittedModules.length,
    "expected login dogma bootstrap to include the ship and fitted modules only",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      initialShipInfoEntries.some(
        (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === Number(loadedCharge.itemID),
      ),
      false,
      `expected login dogma bootstrap shipInfo to suppress loaded charge ${loadedCharge.itemID}`,
    );
  }
  assert.equal(
    initialShipStateEntries.length,
    2 + candidate.fittedModules.length,
    "expected login dogma bootstrap to include fitted module activation state without duplicating loaded charges as fitted rows",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      initialShipStateEntries.some(
        (entry) => Number(Array.isArray(entry) ? entry[0] : 0) === Number(loadedCharge.itemID),
      ),
      false,
      `expected login dogma bootstrap shipState to keep loaded charge ${loadedCharge.itemID} on the charge-state path only`,
    );
  }
  assert.deepEqual(
    initialChargeFlags,
    expectedChargeFlags,
    "expected login dogma bootstrap to include loaded charge sublocations",
  );

  const beyonce = new BeyonceService();
  session.notifications.length = 0;
  const bindResult = beyonce.Handle_MachoBindObject(
    [session.solarsystemid2 || session.solarsystemid, null],
    session,
    null,
  );
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);
  await waitForNotifications(
    () => session._space && session._space.beyonceBound === true,
  );
  const replayedItemIDs = extractOnItemChangeItemIDs(session.notifications);
  const replayedRawItemIDs = extractOnItemChangeRawItemIDs(session.notifications);
  assert.deepEqual(
    replayedItemIDs,
    [],
    "expected login bind to defer the fitted-module replay until after ship inventory prime",
  );
  assert.deepEqual(
    replayedRawItemIDs,
    [],
    "expected login bind to avoid immediate OnItemChange fitting replays before ship inventory prime",
  );
  assert.equal(
    session.notifications.some(
      (notification) => notification.name === "OnGodmaShipEffect",
    ),
    false,
    "expected login bind to avoid redundant online-effect replay notifications",
  );
  assert.ok(
    session._pendingCommandShipFittingReplay,
    "expected login bind to keep the fitted-module replay queued until ship inventory prime",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);
  invBroker.Handle_List([null], session, {});
  await waitForNotifications(
    () =>
      candidate.fittedModules.every(
        (fittedModule) =>
          countRawOnItemChangesByItemID(
            session.notifications,
            fittedModule.itemID,
          ) >= 1,
      ),
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected the first non-cargo ship inventory prime to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first non-cargo ship inventory prime to defer tuple-backed charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first non-cargo ship inventory prime to avoid tuple-backed charge slot transitions before the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
  }
  for (const fittedModule of candidate.fittedModules) {
    assert.ok(
      countRawOnItemChangesByItemID(session.notifications, fittedModule.itemID) >= 1,
      `expected the first non-cargo ship inventory prime to replay fitted module ${fittedModule.itemID} before charge reseed`,
    );
  }
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);
  assert.equal(session._pendingCommandShipFittingReplay, null);

  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await waitForNotifications(
    () =>
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByTupleKey(
            session.notifications,
            candidate.ship.itemID,
            loadedCharge.flagID,
            loadedCharge.typeID,
          ) >= 1,
      ),
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await waitForNotifications(
    () =>
      session._space.loginChargeHudFinalizePending === false &&
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByTupleKey(
            session.notifications,
            candidate.ship.itemID,
            loadedCharge.flagID,
            loadedCharge.typeID,
          ) >= 2,
      ),
  );
  const finalizedTupleReplayCounts = new Map(
    candidate.loadedCharges.map((loadedCharge) => [
      `${candidate.ship.itemID}:${loadedCharge.flagID}:${loadedCharge.typeID}`,
      countRawOnItemChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
    ]),
  );
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await waitForNotifications(
    () =>
      session._space.loginChargeHudFinalizePending === false &&
      candidate.loadedCharges.every((loadedCharge) => {
        const key =
          `${candidate.ship.itemID}:${loadedCharge.flagID}:${loadedCharge.typeID}`;
        return countRawOnItemChangesByTupleKey(
          session.notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ) >= ((finalizedTupleReplayCounts.get(key) || 0) + 1);
      }),
  );
  invBroker.Handle_List([ITEM_FLAGS.DRONE_BAY], session, {});

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected login HUD hydration to avoid replaying real loaded-charge inventory row ${loadedCharge.itemID}`,
    );
    const tupleChangeKeys = getLatestOnItemChangeKeysByTupleKey(
      session.notifications,
      candidate.ship.itemID,
      loadedCharge.flagID,
      loadedCharge.typeID,
    );
    assert.equal(
      tupleChangeKeys.includes(10),
      true,
      `expected login HUD tuple repair for slot ${loadedCharge.flagID} to advertise ixStackSize`,
    );
    assert.equal(
      tupleChangeKeys.includes(5),
      false,
      `expected login HUD tuple repair for slot ${loadedCharge.flagID} to avoid ixQuantity`,
    );
  }

  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    [...candidate.fittedModules]
      .map((item) => Number(item.itemID) || 0)
      .filter((itemID) => itemID > 0)
      .sort((left, right) => left - right),
    "expected login HUD hydration to replay only fitted modules as raw inventory rows while loaded charges stay tuple-backed",
  );
  const firstDestinyUpdateIndex = session.notifications.findIndex(
    (notification) => notification.name === "DoDestinyUpdate",
  );

  assert.notEqual(
    firstDestinyUpdateIndex,
    -1,
    "expected the beyonce bootstrap to emit DoDestinyUpdate notifications",
  );
});

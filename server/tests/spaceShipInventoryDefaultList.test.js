const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  applyCharacterToSession,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const { restoreSpaceSession } = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const {
  getFittedModuleItems,
  getLoadedChargeItems,
  isShipFittingFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const { ITEM_FLAGS } = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function getInventoryEntries(value) {
  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items
      .map((item) => (item && item.type === "packedrow" && item.fields ? item.fields : item))
      .filter(Boolean);
  }
  return [];
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
      Number(Array.isArray(change) ? change[3] : 0) === 805
    );
  }).length;
}

function getInSpaceCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship || !ship.spaceState) {
        return null;
      }
      if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
        return null;
      }

      const fittedModules = getFittedModuleItems(characterID, ship.itemID)
        .filter((item) => item && isShipFittingFlag(item.flagID));
      if (fittedModules.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        fittedModules,
        loadedCharges: getLoadedChargeItems(characterID, ship.itemID),
      };
    })
    .filter(Boolean);

  assert.ok(candidates.length > 0, "Expected an in-space character with fitted modules");
  return (
    candidates.find((candidate) => Array.isArray(candidate.loadedCharges) && candidate.loadedCharges.length > 0) ||
    candidates[0]
  );
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9900,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    stationid: null,
    stationID: null,
    locationid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      Number(candidate.ship.locationID || 0) ||
      30000142,
    solarsystemid:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      30000142,
    solarsystemid2:
      Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
      30000142,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
  };
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

async function waitFor(predicate, attempts = 40) {
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

test("in-space plain ship inventory List() keeps the default cargo view while explicit flag=None still returns fittings", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);

  bindShipInventory(service, session, candidate.ship.itemID);

  const defaultList = service.Handle_List([], session, {});
  const explicitNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });

  const defaultItemIDs = new Set(
    getInventoryEntries(defaultList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );
  const explicitNullItemIDs = new Set(
    getInventoryEntries(explicitNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );

  for (const moduleItem of candidate.fittedModules) {
    assert.equal(
      defaultItemIDs.has(Number(moduleItem.itemID)),
      false,
      `Expected plain in-space List() to exclude fitted module ${moduleItem.itemID}`,
    );
    assert.equal(
      explicitNullItemIDs.has(Number(moduleItem.itemID)),
      true,
      `Expected explicit List(flag=None) to include fitted module ${moduleItem.itemID}`,
    );
  }
});

test("space login suppresses only the first explicit List(flag=None) on the active ship inventory", () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  bindShipInventory(service, session, candidate.ship.itemID);

  const firstNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const secondNullList = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });

  const firstNullItemIDs = new Set(
    getInventoryEntries(firstNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );
  const secondNullItemIDs = new Set(
    getInventoryEntries(secondNullList)
      .map((row) => Number(row.itemID) || 0)
      .filter((itemID) => itemID > 0),
  );

  assert.equal(
    session._loginInventoryBootstrapPending,
    false,
    "Expected the initial login ship-inventory gate to clear after the first List()",
  );

  for (const moduleItem of candidate.fittedModules) {
    assert.equal(
      firstNullItemIDs.has(Number(moduleItem.itemID)),
      false,
      `Expected the first login-space List(flag=None) to suppress fitted module ${moduleItem.itemID}`,
    );
    assert.equal(
      secondNullItemIDs.has(Number(moduleItem.itemID)),
      true,
      `Expected later List(flag=None) calls to include fitted module ${moduleItem.itemID}`,
    );
  }
});

test("post-login ship inventory requests flush the delayed in-space charge bootstrap while keeping ammo tuple-backed", async () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected login restore to queue a delayed fitted-module replay for the active ship",
  );
  session._loginInventoryBootstrapPending = false;
  session._space.loginInventoryBootstrapPending = false;
  session._space.beyonceBound = true;
  session._space.initialStateSent = true;

  bindShipInventory(service, session, candidate.ship.itemID);

  const cargoList = service.Handle_List([], session, {});

  const postBootstrapList = service.Handle_List([ITEM_FLAGS.DRONE_BAY], session, {});

  assert.equal(
    session._space && session._space.loginShipInventoryPrimed,
    true,
    "expected later non-cargo ship inventory requests to prime the delayed in-space charge bootstrap",
  );
  assert.equal(session._pendingCommandShipFittingReplay, null);
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnGodmaShipEffect"),
    false,
    "expected the in-space charge bootstrap fallback to avoid redundant online-effect notifications",
  );
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    candidate.fittedModules
      .map((item) => Number(item.itemID) || 0)
      .filter((itemID) => itemID > 0)
      .sort((left, right) => left - right),
    "expected the delayed in-space hydration path to replay fitted modules before charge reseed",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      extractOnItemChangeRawItemIDs(session.notifications).some(
        (itemID) => Number(itemID) === Number(loadedCharge.itemID),
      ),
      false,
      `expected the in-space charge bootstrap fallback to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the in-space ship inventory request to defer tuple-backed charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
  }

  service.Handle_GetAvailableTurretSlots([], session);
  service.afterCallResponse("GetAvailableTurretSlots", session);
  const hudHydrated = await waitFor(
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
  assert.equal(
    hudHydrated,
    true,
    "expected the HUD turret bootstrap to flush the delayed tuple-backed charge replay after ship inventory prime",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected the HUD bootstrap to avoid replaying real loaded-charge inventory row ${loadedCharge.itemID}`,
    );
  }

  assert.ok(getInventoryEntries(cargoList).length >= 0);
  assert.ok(getInventoryEntries(postBootstrapList).length >= 0);
});

test("post-login ship inventory ListByFlags flushes the delayed in-space charge bootstrap while keeping ammo tuple-backed", async () => {
  const candidate = getInSpaceCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);
  session._loginInventoryBootstrapPending = true;

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(restoreSpaceSession(session), true);
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected login restore to queue a delayed fitted-module replay for fitting ListByFlags hydration",
  );
  session._loginInventoryBootstrapPending = false;
  session._space.loginInventoryBootstrapPending = false;
  session._space.beyonceBound = true;
  session._space.initialStateSent = true;

  bindShipInventory(service, session, candidate.ship.itemID);

  service.Handle_List([], session, {});

  const fittingFlags = Array.from(
    new Set(
      candidate.fittedModules
        .map((item) => Number(item && item.flagID) || 0)
        .filter((flagID) => flagID > 0),
    ),
  );
  const requestedFlags = [ITEM_FLAGS.CARGO_HOLD, ...fittingFlags.slice(0, 2)];
  service.Handle_ListByFlags([requestedFlags], session, {});

  assert.equal(
    session._space && session._space.loginShipInventoryPrimed,
    true,
    "expected fitting ListByFlags requests to prime the delayed in-space charge bootstrap",
  );
  assert.equal(session._pendingCommandShipFittingReplay, null);
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);
  assert.deepEqual(
    extractOnItemChangeItemIDs(session.notifications),
    candidate.fittedModules
      .map((item) => Number(item.itemID) || 0)
      .filter((itemID) => itemID > 0)
      .sort((left, right) => left - right),
    "expected fitting ListByFlags to flush the delayed fitted-module replay before charge reseed",
  );
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      extractOnItemChangeRawItemIDs(session.notifications).some(
        (itemID) => Number(itemID) === Number(loadedCharge.itemID),
      ),
      false,
      `expected fitting ListByFlags to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session.notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected fitting ListByFlags to defer tuple-backed charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
  }

  service.Handle_GetAvailableTurretSlots([], session);
  service.afterCallResponse("GetAvailableTurretSlots", session);
  const hudHydrated = await waitFor(
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
  assert.equal(
    hudHydrated,
    true,
    "expected fitting ListByFlags to flush the delayed tuple-backed charge bootstrap during the HUD rack bootstrap phase",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session.notifications, loadedCharge.itemID),
      0,
      `expected fitting ListByFlags HUD hydration to avoid replaying real loaded-charge inventory row ${loadedCharge.itemID}`,
    );
  }
});

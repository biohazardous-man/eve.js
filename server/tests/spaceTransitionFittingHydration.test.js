const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
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
const ATTRIBUTE_QUANTITY = 805;

function buildSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 9200,
    userid: characterID,
    characterID: 0,
    charid: 0,
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
    _notifications: notifications,
    _sessionChanges: sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function findSpaceCombatCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

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

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length === 0) {
      continue;
    }

    return {
      characterID,
      ship,
      fittedModules,
      loadedCharges,
    };
  }

  assert.fail("Expected an in-space character with online fitted modules and loaded charges");
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
      Number(Array.isArray(change) ? change[3] : 0) === ATTRIBUTE_QUANTITY
    );
  }).length;
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

test("solar jump queues shared charge hydration while keeping loaded ammo on tuple-backed slot rows in space", async () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const targetSolarSystemID =
    Number(candidate.ship.spaceState.systemID) === 30000140 ? 30000142 : 30000140;

  session._notifications.length = 0;
  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected solar jump to queue a post-prime fitted-module replay for clientDogmaIM module hydration",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginShipInventoryList,
    true,
    "expected solar jump to hold the fitted-module replay until ship inventory prime completes",
  );
  assert.equal(session._space.loginShipInventoryPrimed, false);
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);

  const destinationScene = spaceRuntime.getSceneForSession(session);
  assert.ok(destinationScene, "expected jump to attach the session to the destination scene");
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 2500);

  const beyonce = new BeyonceService();
  const bindResult = beyonce.Handle_MachoBindObject([targetSolarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);

  const hydrated = await waitFor(
    () => session._space && session._space.beyonceBound === true,
  );
  assert.equal(hydrated, true, "expected solar jump bind to complete while keeping the fitted-module replay pending for ship inventory prime");
  const prePrimeOnItemChangeItemIDs = extractOnItemChangeRawItemIDs(
    session._notifications,
  ).filter((itemID) => Number(itemID) !== Number(candidate.ship.itemID));
  assert.deepEqual(
    prePrimeOnItemChangeItemIDs,
    [],
    "expected solar jump bind to avoid a synthetic fitted-module OnItemChange replay before ship inventory prime",
  );

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);
  invBroker.Handle_List([null], session, {});

  const primed = await waitFor(
    () =>
      candidate.fittedModules.every(
        (fittedModule) =>
          countRawOnItemChangesByItemID(
            session._notifications,
            fittedModule.itemID,
          ) >= 1,
      ),
  );
  assert.equal(
    primed,
    true,
    "expected the first post-jump ship inventory List(flag=None) to emit the delayed fitted-module replay before the HUD charge bootstrap",
  );
  for (const fittedModule of candidate.fittedModules) {
    assert.ok(
      countRawOnItemChangesByItemID(session._notifications, fittedModule.itemID) >= 1,
      `expected the first post-jump ship inventory prime to replay fitted module ${fittedModule.itemID}`,
    );
  }
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, loadedCharge.itemID),
      0,
      `expected the post-jump inventory prime to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first post-jump inventory prime to defer tuple-backed charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected the first post-jump inventory prime to avoid tuple-backed charge slot transitions before the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
  }
  assert.equal(session._space.loginShipInventoryPrimed, true);
  assert.equal(session._space.loginChargeDogmaReplayPending, true);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, false);
  assert.equal(
    session._space.loginChargeDogmaReplayMode,
    "prime-and-refresh",
    "expected solar jump charge hydration to seed loaded charge sublocations through the shared godma-prime bootstrap path",
  );
  assert.equal(session._pendingCommandShipFittingReplay, null);

  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  const hudHydrated = await waitFor(
    () =>
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByTupleKey(
            session._notifications,
            candidate.ship.itemID,
            loadedCharge.flagID,
            loadedCharge.typeID,
          ) >= 1,
      ),
  );
  assert.equal(
    hudHydrated,
    true,
    "expected the HUD turret-slot bootstrap to flush the delayed tuple-backed charge replay after the post-jump module replay",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  const hudFinalized = await waitFor(
    () =>
      session._space.loginChargeHudFinalizePending === false &&
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByTupleKey(
            session._notifications,
            candidate.ship.itemID,
            loadedCharge.flagID,
            loadedCharge.typeID,
          ) >= 2,
      ),
  );
  assert.equal(
    hudFinalized,
    true,
    "expected post-jump HUD hydration to issue one final refresh-only tuple replay after the rack finishes registering module buttons",
  );

  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, loadedCharge.itemID),
      0,
      `expected post-jump charge hydration to avoid replaying real loaded-charge inventory row ${loadedCharge.itemID}`,
    );
  }
});

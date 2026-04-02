const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
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
  listCharacterItems,
  getItemMetadata,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  CONTAINER_GLOBAL_ID,
} = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrGlobalAssets",
));

const CATEGORY_BLUEPRINT_ID = 9;
const TYPE_PLEX = 44992;

function isVisibleAssetItem(item) {
  return Boolean(item) && Number(item.stacksize || 0) !== 0;
}

function calculateItemUnits(item) {
  if (!item) {
    return 0;
  }

  if (Number(item.singleton || 0) === 1) {
    return 1;
  }

  const stacksize = Number(item.stacksize ?? item.quantity ?? 0);
  return Number.isFinite(stacksize) && stacksize > 0 ? Math.trunc(stacksize) : 0;
}

function extractBoundID(value) {
  return value &&
    Array.isArray(value) &&
    value[0] &&
    value[0].type === "substruct" &&
    value[0].value &&
    value[0].value.type === "substream" &&
    Array.isArray(value[0].value.value)
    ? value[0].value.value[0]
    : null;
}

function extractPackedRows(value) {
  if (!(value && value.type === "list" && Array.isArray(value.items))) {
    return [];
  }

  return value.items
    .map((entry) => (entry && entry.type === "packedrow" ? entry.fields : entry))
    .filter(Boolean);
}

function extractRowsetHeader(value) {
  const argsEntries =
    value &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
      ? value.args.entries
      : [];
  const headerEntry = argsEntries.find(([key]) => key === "header");
  const headerValue = headerEntry ? headerEntry[1] : null;
  return headerValue && headerValue.type === "list" && Array.isArray(headerValue.items)
    ? headerValue.items
    : [];
}

function extractRowsetObjects(value) {
  const argsEntries =
    value &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
      ? value.args.entries
      : [];
  const linesEntry = argsEntries.find(([key]) => key === "lines");
  const lineItems =
    linesEntry &&
    linesEntry[1] &&
    linesEntry[1].type === "list" &&
    Array.isArray(linesEntry[1].items)
      ? linesEntry[1].items
      : [];
  const header = extractRowsetHeader(value);

  return lineItems.map((line) => {
    const row = {};
    header.forEach((columnName, index) => {
      row[columnName] = Array.isArray(line) ? line[index] : undefined;
    });
    return row;
  });
}

function resolveStationRoot(item, itemById) {
  const seen = new Set();
  let currentItem = item;

  while (currentItem) {
    const locationID = Number(currentItem.locationID || 0);
    if (locationID <= 0) {
      return null;
    }

    if (worldData.getStationByID(locationID)) {
      return locationID;
    }

    if (seen.has(locationID)) {
      return null;
    }
    seen.add(locationID);

    currentItem = itemById.get(locationID) || null;
  }

  return null;
}

function buildExpectedAssetSnapshot(characterID) {
  const items = listCharacterItems(characterID);
  const itemById = new Map(items.map((item) => [Number(item.itemID || 0), item]));
  const recursiveDockedItems = items.filter((item) => (
    isVisibleAssetItem(item) && resolveStationRoot(item, itemById) !== null
  ));
  const topLevelDockedItems = recursiveDockedItems.filter((item) =>
    worldData.getStationByID(Number(item.locationID || 0)),
  );

  const stationCounts = {};
  for (const item of topLevelDockedItems) {
    const stationID = Number(item.locationID || 0);
    stationCounts[stationID] = (stationCounts[stationID] || 0) + 1;
  }

  let assetWorth = 0;
  let plexWorth = 0;
  for (const item of recursiveDockedItems) {
    const units = calculateItemUnits(item);
    if (units <= 0) {
      continue;
    }

    if (Number(item.typeID || 0) === TYPE_PLEX) {
      const plexMetadata = getItemMetadata(TYPE_PLEX, "PLEX");
      const plexUnitPrice = Number(plexMetadata && plexMetadata.basePrice) || 0;
      plexWorth += plexUnitPrice * units;
      continue;
    }

    if (Number(item.categoryID || 0) === CATEGORY_BLUEPRINT_ID) {
      continue;
    }

    const metadata = getItemMetadata(item.typeID, item.itemName || null);
    const basePrice = Number(metadata && metadata.basePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      continue;
    }

    assetWorth += basePrice * units;
  }

  return {
    recursiveDockedItems,
    topLevelDockedItems,
    stationCounts,
    assetWorth: Math.round(assetWorth * 100) / 100,
    plexWorth: Math.round(plexWorth * 100) / 100,
  };
}

function getDockedAssetCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !ship || stationID <= 0) {
        return null;
      }

      const snapshot = buildExpectedAssetSnapshot(characterID);
      if (snapshot.topLevelDockedItems.length === 0) {
        return null;
      }

      return {
        characterID,
        stationID,
        snapshot,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.snapshot.recursiveDockedItems.length - left.snapshot.recursiveDockedItems.length,
    );

  assert.ok(
    candidates.length > 0,
    "Expected at least one docked character with station-backed personal assets",
  );
  return candidates[0];
}

function buildSession(characterID) {
  return {
    clientID: characterID + 88000,
    userid: characterID,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

test("charMgr global asset moniker resolves and binds ListStations with station item counts", async () => {
  const candidate = getDockedAssetCandidate();
  const session = buildSession(candidate.characterID);
  const service = new CharMgrService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const resolveResult = service.Handle_MachoResolveObject(
    [[candidate.characterID, CONTAINER_GLOBAL_ID]],
    session,
    null,
  );
  assert.equal(
    resolveResult,
    config.proxyNodeId,
    "Expected charMgr global-assets resolve to stay on this proxy node",
  );

  const bindResult = await service.Handle_MachoBindObject(
    [[candidate.characterID, CONTAINER_GLOBAL_ID], ["ListStations", [], null]],
    session,
    null,
  );
  const boundID = extractBoundID(bindResult);
  assert.ok(boundID, "Expected global assets bind to return a bound object id");

  const stationRows = extractRowsetObjects(bindResult[1]);
  assert.ok(stationRows.length > 0, "Expected ListStations to return at least one row");

  const actualCounts = Object.fromEntries(
    stationRows.map((row) => [Number(row.stationID || 0), Number(row.itemCount || 0)]),
  );
  assert.deepEqual(
    actualCounts,
    candidate.snapshot.stationCounts,
    "Expected ListStations itemCount values to match direct docked station assets",
  );

  const currentStationRow = stationRows.find(
    (row) => Number(row.stationID || 0) === candidate.stationID,
  );
  assert.ok(currentStationRow, "Expected the current docked station to appear in ListStations");
  assert.ok(
    Number(currentStationRow.typeID || 0) > 0,
    "Expected ListStations rows to include a usable location typeID",
  );
  assert.ok(
    Number(currentStationRow.solarSystemID || 0) > 0,
    "Expected ListStations rows to include a solarSystemID",
  );
});

test("bound charMgr global asset methods return top-level station assets, recursive search assets, and live asset worth", async () => {
  const candidate = getDockedAssetCandidate();
  const session = buildSession(candidate.characterID);
  const service = new CharMgrService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const bindResult = await service.Handle_MachoBindObject(
    [[candidate.characterID, CONTAINER_GLOBAL_ID], null],
    session,
    null,
  );
  const boundID = extractBoundID(bindResult);
  assert.ok(boundID, "Expected global asset bind to return a bound object id");
  session.currentBoundObjectID = boundID;

  const topLevelRows = extractPackedRows(service.Handle_List([], session, null));
  const stationRows = extractPackedRows(
    service.Handle_ListStationItems([candidate.stationID], session, null),
  );
  const recursiveRows = extractPackedRows(
    service.Handle_ListIncludingContainers([], session, null),
  );
  const assetWorth = service.Handle_GetAssetWorth([], session, null);

  const expectedTopLevelIds = candidate.snapshot.topLevelDockedItems
    .map((item) => Number(item.itemID || 0))
    .sort((left, right) => left - right);
  const expectedStationIds = candidate.snapshot.topLevelDockedItems
    .filter((item) => Number(item.locationID || 0) === candidate.stationID)
    .map((item) => Number(item.itemID || 0))
    .sort((left, right) => left - right);
  const expectedRecursiveIds = candidate.snapshot.recursiveDockedItems
    .map((item) => Number(item.itemID || 0))
    .sort((left, right) => left - right);

  assert.deepEqual(
    topLevelRows
      .map((row) => Number(row.itemID || 0))
      .sort((left, right) => left - right),
    expectedTopLevelIds,
    "Expected List() to return every top-level docked asset and only top-level docked assets",
  );
  assert.deepEqual(
    stationRows
      .map((row) => Number(row.itemID || 0))
      .sort((left, right) => left - right),
    expectedStationIds,
    "Expected ListStationItems(locationID) to return the station's direct personal assets",
  );
  assert.deepEqual(
    recursiveRows
      .map((row) => Number(row.itemID || 0))
      .sort((left, right) => left - right),
    expectedRecursiveIds,
    "Expected ListIncludingContainers() to expose every docked asset rooted in a station",
  );
  assert.deepEqual(
    assetWorth,
    [candidate.snapshot.assetWorth, candidate.snapshot.plexWorth],
    "Expected GetAssetWorth() to match the live docked asset snapshot",
  );
});

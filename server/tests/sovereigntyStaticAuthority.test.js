const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const OwnerGroupManagerService = require(path.join(
  repoRoot,
  "server/src/services/character/ownerGroupManagerService",
));
const {
  grantItemToCharacterStationHangar,
  removeInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getHubResources,
  getHubUpgrades,
  processHubUpgradeConfiguration,
  resetSovereigntyModernStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovModernState",
));
const {
  getSovereigntyStaticSnapshot,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovStaticData",
));
const {
  resetSovereigntyStateForTests,
  upsertSystemState,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovState",
));

const SOVEREIGNTY_TABLE = "sovereignty";
const ITEMS_TABLE = "items";
const ALLIANCE_ID = 99000000;
const CORPORATION_ID = 98000000;
const SOLAR_SYSTEM_ID = 30000208;
const CLAIM_ID = 551000001;
const HUB_ID = 661000001;
const ACTIVE_CHARACTER_ID = 140000003;
const ACTIVE_CHARACTER_STATION_ID = 60003760;
const TYPE_CYNO_NAVIGATION = 81615;
const TYPE_CYNO_SUPPRESSION = 81619;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

test("sovereignty static snapshot comes from cached local authority with real CCP upgrade definitions", () => {
  const staticTable = readTable("sovereigntyStatic");
  assert.equal(
    Object.prototype.hasOwnProperty.call(staticTable.source || {}, "sourceDir"),
    false,
    "expected sovereignty static authority to stay local and not carry a runtime sourceDir dependency",
  );

  const snapshot = getSovereigntyStaticSnapshot();
  assert.ok(snapshot.planetDefinitions.length > 0, "expected cached planet definitions");
  assert.ok(snapshot.starConfigurations.length > 0, "expected cached star configurations");
  assert.ok(snapshot.upgradeDefinitions.length > 0, "expected cached upgrade definitions");

  const cynoNavigation = snapshot.upgradeDefinitionsByTypeID.get(TYPE_CYNO_NAVIGATION);
  const cynoSuppression = snapshot.upgradeDefinitionsByTypeID.get(TYPE_CYNO_SUPPRESSION);
  assert.ok(cynoNavigation, "expected Cynosural Navigation definition");
  assert.ok(cynoSuppression, "expected Cynosural Suppression definition");

  assert.equal(cynoNavigation.powerRequired, 250);
  assert.equal(cynoNavigation.workforceRequired, 1500);
  assert.equal(cynoNavigation.fuelTypeID, 81143);
  assert.equal(cynoNavigation.fuelConsumptionPerHour, 205);
  assert.equal(cynoNavigation.fuelStartupCost, 62000);
  assert.equal(cynoNavigation.requiredStrategicIndex, 2);

  assert.equal(cynoSuppression.powerRequired, 250);
  assert.equal(cynoSuppression.workforceRequired, 4500);
  assert.equal(cynoSuppression.fuelTypeID, 81143);
  assert.equal(cynoSuppression.fuelConsumptionPerHour, 205);
  assert.equal(cynoSuppression.fuelStartupCost, 82600);
  assert.equal(cynoSuppression.requiredStrategicIndex, 3);
});

test("sov hub upgrade configuration enforces real strategic-index requirements from cached sovereignty data", () => {
  const sovereigntyBackup = cloneValue(readTable(SOVEREIGNTY_TABLE));
  const itemsBackup = cloneValue(readTable(ITEMS_TABLE));
  const identity = {
    corporationID: CORPORATION_ID,
    allianceID: ALLIANCE_ID,
  };
  let grantedUpgradeItemID = 0;

  try {
    writeTable(SOVEREIGNTY_TABLE, {
      ...(sovereigntyBackup || {}),
      alliances: {},
      systems: {},
      hubs: {},
      skyhooks: {},
      mercenaryDens: {},
    });
    writeTable(ITEMS_TABLE, cloneValue(itemsBackup));

    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();

    upsertSystemState(SOLAR_SYSTEM_ID, {
      allianceID: ALLIANCE_ID,
      corporationID: CORPORATION_ID,
      claimStructureID: CLAIM_ID,
      infrastructureHubID: HUB_ID,
      devIndices: {
        claimedForDays: 0,
      },
    });
    resetSovereigntyModernStateForTests();

    assert.ok(getHubResources(HUB_ID, identity), "expected the seeded hub to bootstrap");
    const upgradeGrant = grantItemToCharacterStationHangar(
      ACTIVE_CHARACTER_ID,
      ACTIVE_CHARACTER_STATION_ID,
      { typeID: TYPE_CYNO_SUPPRESSION },
      1,
    );
    assert.equal(upgradeGrant.success, true, "expected cyno suppression item grant");
    grantedUpgradeItemID = Number(
      upgradeGrant.data &&
      upgradeGrant.data.items &&
      upgradeGrant.data.items[0] &&
      upgradeGrant.data.items[0].itemID,
    ) || 0;
    assert.ok(grantedUpgradeItemID > 0, "expected a granted upgrade item ID");

    const blockedResult = processHubUpgradeConfiguration(
      HUB_ID,
      [grantedUpgradeItemID],
      [{ typeID: TYPE_CYNO_SUPPRESSION, online: true }],
      identity,
    );
    assert.equal(blockedResult.ok, false);
    assert.equal(blockedResult.statusCode, 409);
    assert.equal(blockedResult.errorCode, "CONFLICT");

    upsertSystemState(SOLAR_SYSTEM_ID, {
      devIndices: {
        claimedForDays: 35,
      },
    });
    resetSovereigntyModernStateForTests();

    const allowedResult = processHubUpgradeConfiguration(
      HUB_ID,
      [grantedUpgradeItemID],
      [{ typeID: TYPE_CYNO_SUPPRESSION, online: true }],
      identity,
    );
    assert.equal(allowedResult.ok, true);

    const upgrades = getHubUpgrades(HUB_ID, identity);
    assert.equal(
      upgrades.upgrades.some(
        (installation) =>
          Number(installation && installation.typeID) === TYPE_CYNO_SUPPRESSION &&
          Number(installation && installation.powerState) === 2,
      ),
      true,
    );
  } finally {
    if (grantedUpgradeItemID > 0) {
      removeInventoryItem(grantedUpgradeItemID, { removeContents: true });
    }
    writeTable(SOVEREIGNTY_TABLE, sovereigntyBackup);
    writeTable(ITEMS_TABLE, itemsBackup);
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
  }
});

test("ownerGroupManager returns iterable empty data for sov hub access-group readers", () => {
  const service = new OwnerGroupManagerService();

  assert.deepEqual(service.Handle_GetMyGroups([], {}), []);
  assert.deepEqual(service.Handle_GetMembers([], {}), []);
  assert.deepEqual(service.Handle_GetMembersForMultipleGroups([], {}), {});
  assert.deepEqual(service.Handle_GetGroupLogs([], {}), []);
  assert.equal(service.Handle_GetGroup([12345], {}), null);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_ASTEROID_FIELDS = "true";

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/referenceData",
));
const {
  getMineableState,
  resetSceneMiningState,
  summarizeSceneMiningState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const miningResourceSiteService = require(path.join(
  repoRoot,
  "server/src/services/mining/miningResourceSiteService",
));

function pickAsteroidBeltSystem() {
  const belts = readStaticRows(TABLE.ASTEROID_BELTS);
  assert.ok(belts.length > 0, "expected stored asteroid belt rows");
  const firstBelt = belts[0];
  const systemID = Number(firstBelt && firstBelt.solarSystemID) || 0;
  assert.ok(systemID > 0, "expected asteroid belt system ID");
  return systemID;
}

function snapshotMiningSiteConfig() {
  return {
    miningGeneratedIceSitesEnabled: config.miningGeneratedIceSitesEnabled,
    miningGeneratedGasSitesEnabled: config.miningGeneratedGasSitesEnabled,
    miningIceSitesHighSecPerSystem: config.miningIceSitesHighSecPerSystem,
    miningIceSitesLowSecPerSystem: config.miningIceSitesLowSecPerSystem,
    miningIceSitesNullSecPerSystem: config.miningIceSitesNullSecPerSystem,
    miningIceSitesWormholePerSystem: config.miningIceSitesWormholePerSystem,
    miningGasSitesHighSecPerSystem: config.miningGasSitesHighSecPerSystem,
    miningGasSitesLowSecPerSystem: config.miningGasSitesLowSecPerSystem,
    miningGasSitesNullSecPerSystem: config.miningGasSitesNullSecPerSystem,
    miningGasSitesWormholePerSystem: config.miningGasSitesWormholePerSystem,
    miningGeneratedSiteRadiusMeters: config.miningGeneratedSiteRadiusMeters,
    miningIceChunksPerSite: config.miningIceChunksPerSite,
    miningGasCloudsPerSite: config.miningGasCloudsPerSite,
  };
}

function restoreMiningSiteConfig(snapshot) {
  Object.assign(config, snapshot);
}

test("scene bootstrap adds deterministic ice and gas runtime content with live mineable state", (t) => {
  const originalConfig = snapshotMiningSiteConfig();
  t.after(() => {
    restoreMiningSiteConfig(originalConfig);
    runtime._testing.clearScenes();
  });

  Object.assign(config, {
    miningGeneratedIceSitesEnabled: true,
    miningGeneratedGasSitesEnabled: true,
    miningIceSitesHighSecPerSystem: 1,
    miningIceSitesLowSecPerSystem: 1,
    miningIceSitesNullSecPerSystem: 1,
    miningIceSitesWormholePerSystem: 0,
    miningGasSitesHighSecPerSystem: 1,
    miningGasSitesLowSecPerSystem: 1,
    miningGasSitesNullSecPerSystem: 1,
    miningGasSitesWormholePerSystem: 1,
    miningGeneratedSiteRadiusMeters: 12_000,
    miningIceChunksPerSite: 4,
    miningGasCloudsPerSite: 5,
  });

  runtime._testing.clearScenes();
  const systemID = pickAsteroidBeltSystem();
  const scene = runtime.ensureScene(systemID);
  const generatedEntities = miningResourceSiteService._testing.listGeneratedResourceSiteEntities(scene);
  const iceMineables = generatedEntities.filter((entity) => (
    entity.generatedMiningSiteKind === "ice" &&
    entity.generatedMiningSiteAnchor !== true
  ));
  const gasMineables = generatedEntities.filter((entity) => (
    entity.generatedMiningSiteKind === "gas" &&
    entity.generatedMiningSiteAnchor !== true
  ));

  assert.ok(iceMineables.length > 0, "expected generated ice mineables");
  assert.ok(gasMineables.length > 0, "expected generated gas mineables");

  const iceState = getMineableState(scene, iceMineables[0].itemID);
  const gasState = getMineableState(scene, gasMineables[0].itemID);
  assert.ok(iceState, "expected live mining state for generated ice");
  assert.ok(gasState, "expected live mining state for generated gas");
  assert.equal(iceState.yieldKind, "ice");
  assert.equal(gasState.yieldKind, "gas");
  assert.ok(iceState.originalQuantity > 0);
  assert.ok(gasState.originalQuantity > 0);

  const summary = summarizeSceneMiningState(scene);
  assert.ok(summary.iceCount >= iceMineables.length);
  assert.ok(summary.gasCount >= gasMineables.length);

  const firstIceIDs = iceMineables.map((entity) => entity.itemID).sort((left, right) => left - right);
  const resetResult = resetSceneMiningState(scene, {
    rebuildAsteroids: false,
    rebuildResourceSites: true,
    broadcast: false,
    nowMs: scene.getCurrentSimTimeMs(),
  });
  assert.equal(resetResult.success, true);

  const secondIceIDs = miningResourceSiteService._testing
    .listGeneratedResourceSiteEntities(scene)
    .filter((entity) => entity.generatedMiningSiteKind === "ice" && entity.generatedMiningSiteAnchor !== true)
    .map((entity) => entity.itemID)
    .sort((left, right) => left - right);
  assert.deepEqual(secondIceIDs, firstIceIDs, "expected deterministic resource-site entity IDs after reset");
});

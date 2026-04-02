const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const structureWreckState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureWreckState",
));

test("structure wreck lookup resolves the correct CCP wreck type for core Upwell hulls", () => {
  const keepstarWreck = structureWreckState.resolveStructureWreckType(35834);
  assert.ok(keepstarWreck, "Expected Keepstar wreck type to resolve");
  assert.equal(keepstarWreck.typeID, 40646);
  assert.equal(keepstarWreck.name, "Keepstar Wreck");

  const fortizarWreck = structureWreckState.resolveStructureWreckType(35833);
  assert.ok(fortizarWreck, "Expected Fortizar wreck type to resolve");
  assert.equal(fortizarWreck.typeID, 40645);

  const moreauWreck = structureWreckState.resolveStructureWreckType(47512);
  assert.ok(moreauWreck, "Expected faction Fortizar wreck type to resolve");
  assert.equal(moreauWreck.typeID, 47517);
  assert.equal(moreauWreck.name, "'Moreau' Fortizar Wreck");
});

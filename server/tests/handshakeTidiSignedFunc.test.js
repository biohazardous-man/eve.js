const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const EVEHandshake = require(path.join(
  repoRoot,
  "server/src/network/tcp/handshake",
));

test("TiDi signedFunc snaps both into and out of TiDi", () => {
  const source = EVEHandshake._testing.buildTidiSignedFuncSource();

  assert.match(
    source,
    /blue\.os\.dilationOverloadAdjustment = 0\.1/,
  );
  assert.match(
    source,
    /blue\.os\.dilationUnderloadAdjustment = 1000(?:\.0)?/,
  );
  assert.match(
    source,
    /blue\.os\.dilationOverloadAdjustment = 0\.8254/,
  );
  assert.match(
    source,
    /blue\.os\.dilationUnderloadAdjustment = 1\.059254/,
  );
});

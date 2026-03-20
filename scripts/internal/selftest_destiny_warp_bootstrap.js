const assert = require("assert");
const path = require("path");

const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));

function makeWarpingShip() {
  return {
    kind: "ship",
    itemID: 990001001,
    typeID: 2454,
    ownerID: 1001,
    corporationID: 1000125,
    allianceID: 0,
    warFactionID: 0,
    characterID: 0,
    pilotCharacterID: 980001001,
    radius: 50,
    mass: 1000000,
    maxVelocity: 250,
    inertia: 1.5,
    speedFraction: 1,
    mode: "WARP",
    position: { x: 1000, y: 2000, z: 3000 },
    velocity: { x: 0, y: 0, z: 1250000 },
    targetPoint: { x: 4000, y: 5000, z: 6000 },
    warpState: {
      warpSpeed: 3000,
      effectStamp: 1773949240,
      totalDistance: 750000,
      stopDistance: 0,
    },
  };
}

function main() {
  const entity = makeWarpingShip();
  const debug = destiny.debugDescribeEntityBall(entity);
  const addBallsDebug = destiny.debugDescribeEntityBall(entity, { forAddBalls: true });

  assert.strictEqual(
    debug.summary.mode,
    "WARP",
    "expected warp-mode ball debug summary",
  );
  assert.deepStrictEqual(
    Object.keys(debug.summary.modeData).sort(),
    ["targetPoint", "warpFactor"],
    "warp-mode bootstrap should only expose goto + warpFactor tail",
  );
  assert.strictEqual(
    debug.encodedLength,
    128,
    "warp-mode ship bootstrap length should stay on the client-accepted tail shape",
  );
  assert.strictEqual(
    addBallsDebug.summary.mode,
    "STOP",
    "AddBalls2 should seed first-acquired warping ships as a neutral ball",
  );
  assert.strictEqual(
    addBallsDebug.summary.speedFraction,
    0,
    "AddBalls2 warp bootstrap should not claim local in-warp speed yet",
  );
  assert.strictEqual(
    addBallsDebug.encodedLength,
    100,
    "safe AddBalls2 warp bootstrap should use the neutral STOP ball shape",
  );
  assert.strictEqual(
    addBallsDebug.summary.modeData,
    null,
    "safe AddBalls2 warp bootstrap should not embed raw warp tail data",
  );

  console.log(JSON.stringify({
    ok: true,
    encodedLength: debug.encodedLength,
    modeData: debug.summary.modeData,
    addBallsEncodedLength: addBallsDebug.encodedLength,
    addBallsMode: addBallsDebug.summary.mode,
  }, null, 2));
}

main();

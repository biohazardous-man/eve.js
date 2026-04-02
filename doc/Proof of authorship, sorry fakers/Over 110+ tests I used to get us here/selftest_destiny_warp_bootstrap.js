/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

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
  const playerEntity = makeWarpingShip();
  const playerDebug = destiny.debugDescribeEntityBall(playerEntity);
  const playerAddBallsDebug = destiny.debugDescribeEntityBall(
    playerEntity,
    { forAddBalls: true },
  );
  const concordEntity = {
    ...makeWarpingShip(),
    itemID: 980000000000,
    characterID: 0,
    pilotCharacterID: 0,
    npcEntityType: "concord",
    nativeNpc: true,
    sessionlessWarpIngress: {
      startTimeMs: 0,
      completeAtMs: 1000,
      durationMs: 1000,
      lastUpdateAtMs: 0,
      origin: { x: 0, y: 0, z: 0 },
      targetPoint: { x: 4000, y: 5000, z: 6000 },
    },
  };
  const concordAddBallsDebug = destiny.debugDescribeEntityBall(
    concordEntity,
    { forAddBalls: true },
  );

  assert.strictEqual(
    playerDebug.summary.mode,
    "WARP",
    "expected warp-mode ball debug summary",
  );
  assert.deepStrictEqual(
    Object.keys(playerDebug.summary.modeData).sort(),
    ["effectStamp", "stopDistance", "targetPoint", "totalDistance", "warpFactor"],
    "warp-mode bootstrap should expose the known-good warp tail",
  );
  assert.strictEqual(
    playerDebug.encodedLength,
    148,
    "warp-mode ship bootstrap length should stay on the known-good warp shape",
  );
  assert.strictEqual(
    playerAddBallsDebug.summary.mode,
    "WARP",
    "player AddBalls2 should seed first-acquired warping ships as real warp balls",
  );
  assert.deepStrictEqual(
    Object.keys(playerAddBallsDebug.summary.modeData).sort(),
    ["effectStamp", "stopDistance", "targetPoint", "totalDistance", "warpFactor"],
    "player AddBalls2 warp bootstrap should expose the known-good warp tail",
  );
  assert.strictEqual(
    playerAddBallsDebug.encodedLength,
    148,
    "player AddBalls2 warp bootstrap should use the live warp ball shape",
  );

  assert.strictEqual(
    concordAddBallsDebug.summary.mode,
    "STOP",
    "sessionless NPC/Concord AddBalls2 should seed a neutral bootstrap ball",
  );
  assert.strictEqual(
    concordAddBallsDebug.summary.modeData,
    null,
    "sessionless NPC/Concord AddBalls2 bootstrap should leave visible ingress to EntityWarpIn",
  );
  assert.strictEqual(
    concordAddBallsDebug.encodedLength,
    100,
    "sessionless NPC/Concord AddBalls2 bootstrap should stay on the neutral stop shape",
  );

  console.log(JSON.stringify({
    ok: true,
    playerEncodedLength: playerDebug.encodedLength,
    playerModeData: playerDebug.summary.modeData,
    playerAddBallsEncodedLength: playerAddBallsDebug.encodedLength,
    playerAddBallsMode: playerAddBallsDebug.summary.mode,
    playerAddBallsModeData: playerAddBallsDebug.summary.modeData,
    concordAddBallsEncodedLength: concordAddBallsDebug.encodedLength,
    concordAddBallsMode: concordAddBallsDebug.summary.mode,
    concordAddBallsModeData: concordAddBallsDebug.summary.modeData,
  }, null, 2));
}

main();

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const {
  applyDamageToEntity,
  getEntityCurrentHealthLayers,
} = require(path.join(
  __dirname,
  "../../server/src/space/combat/damage",
));

const TEST_SYSTEM_ID = 30000142;

function createFakeSession() {
  const notifications = [];
  return {
    clientID: 969001,
    characterID: 979001,
    charID: 979001,
    characterName: "shield-test",
    shipName: "shield-test-ship",
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: 1069001,
      typeID: 606,
      ownerID: 979001,
      groupID: 25,
      categoryID: 6,
      radius: 50,
      spaceState: {
        position: {
          x: -107303362560,
          y: -18744975360,
          z: 436489052160,
        },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
      },
    },
  };
}

function attachReadySession(session) {
  runtime.attachSession(session, session.shipItem, {
    systemID: TEST_SYSTEM_ID,
    broadcast: false,
    spawnStopped: true,
  });
  assert.strictEqual(runtime.ensureInitialBallpark(session), true);
}

function advanceSceneUntil(scene, maxDurationMs, stepMs, predicate) {
  let wallclockNow = scene.getCurrentWallclockMs();
  const maxSteps = Math.max(1, Math.ceil(maxDurationMs / Math.max(1, stepMs)));
  for (let index = 0; index < maxSteps; index += 1) {
    wallclockNow += Math.max(1, stepMs);
    scene.tick(wallclockNow);
    if (predicate()) {
      return true;
    }
  }
  return false;
}

function main() {
  runtime._testing.clearScenes();

  const session = createFakeSession();
  try {
    attachReadySession(session);
    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const entity = scene.getEntityByID(session._space.shipID);
    assert(entity, "expected live test ship");

    entity.shieldCapacity = 100;
    entity.shieldRechargeRate = 10_000;
    entity.armorHP = 100;
    entity.structureHP = 100;
    entity.conditionState = {
      damage: 0.55,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 0,
      incapacitated: false,
    };

    const recharged = advanceSceneUntil(scene, 8_000, 250, () =>
      Number(entity.conditionState && entity.conditionState.shieldCharge) > 0.01
    );
    assert(
      recharged,
      "expected passive shield recharge to restore server-authoritative shield charge",
    );

    const beforeLayers = getEntityCurrentHealthLayers(entity);
    const beforeStructure = beforeLayers.structure;
    const beforeShield = beforeLayers.shield;
    assert(beforeShield > 0, "expected some regenerated shield before applying damage");

    const damageResult = applyDamageToEntity(entity, {
      em: 5,
      thermal: 0,
      kinetic: 0,
      explosive: 0,
    });
    assert.strictEqual(damageResult.success, true, "expected damage application to succeed");

    const afterLayers = getEntityCurrentHealthLayers(entity);
    assert(
      afterLayers.shield < beforeShield,
      "expected new damage to consume regenerated shield first",
    );
    assert.strictEqual(
      Number(afterLayers.structure.toFixed(6)),
      Number(beforeStructure.toFixed(6)),
      "expected regenerated shield to absorb the follow-up shot before hull takes more damage",
    );

    console.log(JSON.stringify({
      ok: true,
      shieldCharge: Number(entity.conditionState.shieldCharge.toFixed(6)),
      beforeShield: Number(beforeShield.toFixed(6)),
      afterShield: Number(afterLayers.shield.toFixed(6)),
      structure: Number(afterLayers.structure.toFixed(6)),
    }, null, 2));
  } finally {
    if (session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
    runtime._testing.clearScenes();
  }
}

main();

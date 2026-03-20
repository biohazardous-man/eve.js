const assert = require("assert");

const {
  buildShipResourceState,
} = require("../../server/src/services/fitting/liveFittingState");
const {
  buildWeaponModuleSnapshot,
} = require("../../server/src/space/combat/weaponDogma");
const {
  applyDamageToEntity,
} = require("../../server/src/space/combat/damage");
const {
  resolveLaserTurretShot,
} = require("../../server/src/space/combat/laserTurrets");

function approxEqual(actual, expected, epsilon = 1e-6, label = "value") {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function main() {
  const skillMap = new Map([
    [3300, { typeID: 3300, skillLevel: 5 }], // Gunnery
    [3303, { typeID: 3303, skillLevel: 4 }], // Small Energy Turret
    [3316, { typeID: 3316, skillLevel: 4 }], // Controlled Bursts
    [3331, { typeID: 3331, skillLevel: 4 }], // Amarr Frigate
  ]);

  const shipResourceState = buildShipResourceState(
    0,
    { itemID: 1, typeID: 597 }, // Punisher
    {
      fittedItems: [],
      skillMap,
    },
  );
  approxEqual(shipResourceState.attributes[267], 0.42, 1e-9, "Punisher armor EM resonance");
  approxEqual(shipResourceState.attributes[485], -40, 1e-9, "Punisher laser cap bonus attr");

  const moduleItem = {
    itemID: 10,
    typeID: 450, // Gatling Pulse Laser I
    groupID: 53,
    flagID: 27,
    moduleState: { online: true },
  };
  const chargeItem = {
    itemID: 11,
    typeID: 246, // Multifrequency S
    groupID: 86,
  };
  const heatSink = {
    itemID: 12,
    typeID: 2363, // Heat Sink I
    groupID: 46,
    flagID: 11,
    moduleState: { online: true },
  };

  const baseSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: { itemID: 1, typeID: 597 },
    moduleItem,
    chargeItem,
    fittedItems: [moduleItem],
    skillMap,
  });
  approxEqual(baseSnapshot.durationMs, 1890, 1e-9, "Laser duration");
  approxEqual(baseSnapshot.capNeed, 0.8736, 1e-9, "Laser cap need");
  approxEqual(baseSnapshot.damageMultiplier, 1.8, 1e-9, "Laser damage multiplier");

  const heatSinkSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: { itemID: 1, typeID: 597 },
    moduleItem,
    chargeItem,
    fittedItems: [moduleItem, heatSink],
    skillMap,
  });
  assert.ok(
    heatSinkSnapshot.damageMultiplier > baseSnapshot.damageMultiplier,
    "Heat Sink should increase laser damage multiplier",
  );
  assert.ok(
    heatSinkSnapshot.durationMs < baseSnapshot.durationMs,
    "Heat Sink should reduce laser cycle time",
  );

  const shotResult = resolveLaserTurretShot({
    attackerEntity: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      radius: 40,
    },
    targetEntity: {
      position: { x: 2200, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      radius: 40,
      signatureRadius: 40,
    },
    weaponSnapshot: baseSnapshot,
    randomValue: 0.5,
  });
  assert.strictEqual(shotResult.hit, true, "Expected test shot to hit");
  assert.ok(shotResult.chanceToHit > 0.99, "Expected near-perfect hit chance");

  const wreckEntity = {
    kind: "wreck",
    itemID: 99,
    structureHP: 1500,
    armorHP: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    conditionState: {
      damage: 0,
      armorDamage: 0,
      shieldCharge: 0,
      charge: 1,
      incapacitated: false,
    },
  };
  const damageResult = applyDamageToEntity(wreckEntity, shotResult.shotDamage);
  assert.strictEqual(damageResult.success, true, "Damage application should succeed");
  assert.ok(
    damageResult.data.afterLayers.structure < damageResult.data.beforeLayers.structure,
    "Wreck structure HP should go down",
  );

  console.log("selftest_laser_combat: ok");
}

main();

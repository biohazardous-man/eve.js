/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");

const {
  buildWeaponModuleSnapshot,
} = require("../../server/src/space/combat/weaponDogma");
const {
  applyDamageToEntity,
} = require("../../server/src/space/combat/damage");
const {
  resolveTurretShot,
} = require("../../server/src/space/combat/laserTurrets");

function approxGreater(actual, minimum, label) {
  assert.ok(
    Number(actual) > Number(minimum),
    `${label}: expected > ${minimum}, got ${actual}`,
  );
}

function approxEqual(actual, expected, epsilon = 1e-6, label = "value") {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function buildShotTarget() {
  return {
    position: { x: 2_500, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 40,
    signatureRadius: 120,
  };
}

function buildShotAttacker() {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 40,
  };
}

function verifySnapshot(label, snapshot, expectedFamily) {
  assert.ok(snapshot, `${label}: expected a weapon snapshot`);
  assert.strictEqual(snapshot.family, expectedFamily, `${label}: family`);
  assert.strictEqual(snapshot.effectGUID, "effects.ProjectileFired", `${label}: FX guid`);
  assert.strictEqual(snapshot.chargeMode, "stack", `${label}: charge mode`);
  approxGreater(snapshot.durationMs, 1, `${label}: duration`);
  approxGreater(
    snapshot.rawShotDamage.em +
      snapshot.rawShotDamage.thermal +
      snapshot.rawShotDamage.kinetic +
      snapshot.rawShotDamage.explosive,
    0,
    `${label}: damage`,
  );

  const shotResult = resolveTurretShot({
    attackerEntity: buildShotAttacker(),
    targetEntity: buildShotTarget(),
    weaponSnapshot: snapshot,
    randomValue: 0.5,
  });
  assert.strictEqual(shotResult.hit, true, `${label}: expected a close-range shot to hit`);
  approxGreater(shotResult.chanceToHit, 0.05, `${label}: chanceToHit`);

  const wreckEntity = {
    kind: "wreck",
    itemID: 99,
    structureHP: 1_500,
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
  assert.strictEqual(damageResult.success, true, `${label}: damage apply`);
  assert.ok(
    damageResult.data.afterLayers.structure < damageResult.data.beforeLayers.structure,
    `${label}: structure should go down`,
  );
}

function main() {
  const shipItem = { itemID: 1, typeID: 606 };

  const hybridSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: {
      itemID: 10,
      typeID: 3186, // Neutron Blaster Cannon II
      groupID: 74,
      flagID: 27,
      locationID: shipItem.itemID,
      moduleState: { online: true },
    },
    chargeItem: {
      itemID: 11,
      typeID: 238, // Antimatter Charge L
      groupID: 85,
      quantity: 2,
      stacksize: 2,
    },
    fittedItems: [{
      itemID: 10,
      typeID: 3186,
      groupID: 74,
      flagID: 27,
      locationID: shipItem.itemID,
      moduleState: { online: true },
    }],
    skillMap: new Map(),
  });
  verifySnapshot("hybrid", hybridSnapshot, "hybridTurret");
  approxGreater(hybridSnapshot.capNeed, 0, "hybrid capNeed");

  const projectileSnapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem,
    moduleItem: {
      itemID: 20,
      typeID: 2913, // 425mm AutoCannon II
      groupID: 55,
      flagID: 28,
      locationID: shipItem.itemID,
      moduleState: { online: true },
    },
    chargeItem: {
      itemID: 21,
      typeID: 193, // EMP M
      groupID: 83,
      quantity: 2,
      stacksize: 2,
    },
    fittedItems: [{
      itemID: 20,
      typeID: 2913,
      groupID: 55,
      flagID: 28,
      locationID: shipItem.itemID,
      moduleState: { online: true },
    }],
    skillMap: new Map(),
  });
  verifySnapshot("projectile", projectileSnapshot, "projectileTurret");
  approxEqual(projectileSnapshot.capNeed, 0, 1e-9, "projectile capNeed");

  console.log("selftest_turret_combat: ok");
}

main();

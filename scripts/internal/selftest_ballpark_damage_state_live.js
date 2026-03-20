const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  findShipItemById,
  updateShipItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

const TEST_SYSTEM_ID = 30000142;

function getSpaceCapableCandidate() {
  const candidateIDs = [140000003, 140000004, 140000002, 140000001];
  for (const characterID of candidateIDs) {
    const character = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!character || !ship) {
      continue;
    }
    return { character, ship };
  }
  return null;
}

function buildSession(candidate) {
  return {
    clientID: Number(candidate.character.characterID || candidate.character.id || 0) + 50100,
    characterID: Number(candidate.character.characterID || candidate.ship.ownerID),
    charid: Number(candidate.character.characterID || candidate.ship.ownerID),
    userid: Number(candidate.character.characterID || candidate.ship.ownerID),
    characterName: candidate.character.characterName,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    shipName: candidate.ship.itemName,
    corporationID: Number(candidate.character.corporationID || 0),
    allianceID: Number(candidate.character.allianceID || 0),
    warFactionID: Number(candidate.character.factionID || 0),
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    sendNotification() {},
    shipItem: {
      ...candidate.ship,
      locationID: TEST_SYSTEM_ID,
      flagID: 0,
      spaceState: {
        systemID: TEST_SYSTEM_ID,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        targetPoint: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
      },
    },
  };
}

function main() {
  const candidate = getSpaceCapableCandidate();
  assert(candidate, "Expected a character with an active ship");

  const shipID = Number(candidate.ship.itemID);
  const originalShip = findShipItemById(shipID);
  assert(originalShip, "Expected active ship item to exist");

  const updatedConditionState = {
    ...(originalShip.conditionState || {}),
    damage: 0.37,
    armorDamage: 0.22,
    shieldCharge: 0.61,
    charge: 0.48,
    incapacitated: false,
  };

  const updateResult = updateShipItem(shipID, (currentShip) => ({
    ...currentShip,
    conditionState: updatedConditionState,
  }));
  assert.strictEqual(updateResult.success, true, "Expected ship condition update to succeed");

  const session = buildSession({
    character: candidate.character,
    ship: updateResult.data,
  });

  try {
    runtime._testing.clearScenes();
    runtime.attachSession(session, session.shipItem, {
      systemID: TEST_SYSTEM_ID,
      broadcast: false,
      spawnStopped: true,
    });
    assert.strictEqual(runtime.ensureInitialBallpark(session), true);

    const entity = runtime.getEntity(session, shipID);
    assert(entity, "Expected active ship entity in runtime scene");

    const damageState = destiny.buildDamageState(entity);
    const [shieldEntry, armorHealth, structureHealth] = damageState;
    const [shieldHealth, shieldTau] = shieldEntry;

    assert.strictEqual(Number(shieldHealth.toFixed(3)), 0.61);
    assert.strictEqual(Number(armorHealth.toFixed(3)), 0.78);
    assert.strictEqual(Number(structureHealth.toFixed(3)), 0.63);
    assert(
      Number.isFinite(Number(shieldTau)) && Number(shieldTau) >= 0,
      "Expected live shield tau to be numeric",
    );

    console.log(JSON.stringify({
      ok: true,
      characterID: session.characterID,
      shipID,
      damageState: {
        shieldHealth,
        shieldTau,
        armorHealth,
        structureHealth,
      },
    }, null, 2));
  } finally {
    runtime.detachSession(session, { broadcast: false });
    runtime._testing.clearScenes();
    updateShipItem(shipID, originalShip);
  }
}

main();

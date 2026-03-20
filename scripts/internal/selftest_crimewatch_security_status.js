const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const crimewatchState = require(path.join(__dirname, "../../server/src/services/security/crimewatchState"));
const CrimewatchService = require(path.join(__dirname, "../../server/src/services/security/crimewatchService"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../../server/src/services/character/characterState"));

const TEST_SYSTEM_ID = 30000142;
const TEMPLATE_CHARACTER_ID = 140000002;

const SHIP_ATTACKER_CLIENT_ID = 969001;
const SHIP_ATTACKER_CHARACTER_ID = 979001;
const SHIP_VICTIM_CLIENT_ID = 969002;
const SHIP_VICTIM_CHARACTER_ID = 979002;

const POD_ATTACKER_CLIENT_ID = 969003;
const POD_ATTACKER_CHARACTER_ID = 979003;
const POD_VICTIM_CLIENT_ID = 969004;
const POD_VICTIM_CHARACTER_ID = 979004;

const TEST_POSITION = Object.freeze({
  x: -107303362560,
  y: -18744975360,
  z: 436489052160,
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTransientCharacterRecord(characterID, securityStatus = 0) {
  const template = getCharacterRecord(TEMPLATE_CHARACTER_ID);
  assert(template, `missing template character ${TEMPLATE_CHARACTER_ID}`);
  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  return {
    ...cloneValue(template),
    accountId: 0,
    characterID,
    characterName: `temp-${characterID}`,
    securityStatus,
    securityRating: securityStatus,
    bounty: 0,
    stationID: null,
    worldSpaceID: 0,
    solarSystemID: TEST_SYSTEM_ID,
    shipID: characterID + 100000,
    shipTypeID: 606,
    shipName: `ship-${characterID}`,
    createDateTime: String(now),
    startDateTime: String(now),
    logoffDate: String(now),
  };
}

function ensureTransientCharacter(characterID, securityStatus = 0) {
  const writeResult = database.write(
    "characters",
    `/${String(characterID)}`,
    buildTransientCharacterRecord(characterID, securityStatus),
    { transient: true },
  );
  assert.strictEqual(
    writeResult.success,
    true,
    writeResult.errorMsg || `failed to create transient character ${characterID}`,
  );
  const record = getCharacterRecord(characterID);
  assert(record, `expected transient character ${characterID}`);
  return record;
}

function removeTransientCharacter(characterID) {
  database.remove("characters", `/${String(characterID)}`);
}

function createFakeSession(
  clientID,
  characterID,
  {
    typeID = 606,
    groupID = 25,
    radius = 50,
    position = TEST_POSITION,
    direction = { x: 1, y: 0, z: 0 },
  } = {},
) {
  return {
    clientID,
    characterID,
    charID: characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1000044,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    shipItem: {
      itemID: clientID + 100000,
      typeID,
      ownerID: characterID,
      groupID,
      categoryID: 6,
      radius,
      spaceState: {
        position,
        velocity: { x: 0, y: 0, z: 0 },
        direction,
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

function detachSessionIfNeeded(session) {
  if (session && session._space) {
    runtime.detachSession(session, { broadcast: false });
  }
}

function getPseudoSystemSecurity(system) {
  const security = Math.max(0, Math.min(1, Number(system && system.security) || 0));
  if (security > 0 && security < 0.05) {
    return 0.05;
  }
  return security;
}

function computeExpectedSecurityStatus(beforeStatus, targetStatus, systemSecurity, isCapsule) {
  const modifierBase = isCapsule ? -0.25 : -0.025;
  const modification =
    modifierBase *
    getPseudoSystemSecurity({ security: systemSecurity }) *
    (1 + ((targetStatus - beforeStatus) / 100));
  const nextStatus = beforeStatus + ((10 - beforeStatus) * modification);
  return Number(Math.max(-10, Math.min(10, nextStatus)).toFixed(4));
}

function assertClose(actual, expected, label) {
  assert(
    Math.abs(Number(actual) - Number(expected)) <= 0.0001,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function runAggressionCase({
  attackerClientID,
  attackerCharacterID,
  victimClientID,
  victimCharacterID,
  victimShipTypeID,
  victimGroupID,
  victimRadius,
  positionOffsetX,
}) {
  ensureTransientCharacter(attackerCharacterID, 0);
  ensureTransientCharacter(victimCharacterID, 0);

  const attackerSession = createFakeSession(attackerClientID, attackerCharacterID, {
    position: {
      x: TEST_POSITION.x,
      y: TEST_POSITION.y,
      z: TEST_POSITION.z,
    },
    direction: { x: 1, y: 0, z: 0 },
  });
  const victimSession = createFakeSession(victimClientID, victimCharacterID, {
    typeID: victimShipTypeID,
    groupID: victimGroupID,
    radius: victimRadius,
    position: {
      x: TEST_POSITION.x + positionOffsetX,
      y: TEST_POSITION.y,
      z: TEST_POSITION.z,
    },
    direction: { x: -1, y: 0, z: 0 },
  });

  try {
    attachReadySession(attackerSession);
    attachReadySession(victimSession);

    const scene = runtime.ensureScene(TEST_SYSTEM_ID);
    const attackerEntity = scene.getEntityByID(attackerSession._space.shipID);
    const victimEntity = scene.getEntityByID(victimSession._space.shipID);
    assert(attackerEntity, "expected attacker entity");
    assert(victimEntity, "expected victim entity");

    const beforeStatus = Number(getCharacterRecord(attackerCharacterID).securityStatus || 0);
    const victimStatus = Number(getCharacterRecord(victimCharacterID).securityStatus || 0);
    const now = scene.getCurrentSimTimeMs();
    const aggressionResult = crimewatchState.recordHighSecCriminalAggression(
      scene,
      attackerEntity,
      victimEntity,
      now,
    );
    assert.strictEqual(
      aggressionResult.success,
      true,
      aggressionResult.errorMsg || "crimewatch aggression failed",
    );
    assert.strictEqual(aggressionResult.data.applied, true, "expected aggression to apply");
    assert(
      aggressionResult.data.securityStatusPenalty,
      "expected security status penalty payload",
    );
    assert.strictEqual(
      aggressionResult.data.securityStatusPenalty.applied,
      true,
      "expected security status penalty to apply",
    );

    const afterStatus = Number(getCharacterRecord(attackerCharacterID).securityStatus || 0);
    const expectedStatus = computeExpectedSecurityStatus(
      beforeStatus,
      victimStatus,
      scene.system.security,
      victimGroupID === 29,
    );
    assertClose(afterStatus, expectedStatus, "security status");

    const crimewatchService = new CrimewatchService();
    assertClose(
      crimewatchService.Handle_GetMySecurityStatus([], attackerSession, null),
      expectedStatus,
      "GetMySecurityStatus",
    );

    const duplicateResult = crimewatchState.recordHighSecCriminalAggression(
      scene,
      attackerEntity,
      victimEntity,
      now + 1,
    );
    assert.strictEqual(duplicateResult.success, true, "duplicate aggression call should succeed");
    assert.strictEqual(
      duplicateResult.data.securityStatusPenalty.reason,
      "DUPLICATE_TARGET",
      "duplicate aggression should not reapply a security penalty",
    );
    assertClose(
      Number(getCharacterRecord(attackerCharacterID).securityStatus || 0),
      expectedStatus,
      "duplicate aggression security status",
    );

    return {
      beforeStatus,
      afterStatus,
      expectedStatus,
      delta: Number((afterStatus - beforeStatus).toFixed(4)),
      duplicateReason: duplicateResult.data.securityStatusPenalty.reason,
    };
  } finally {
    detachSessionIfNeeded(attackerSession);
    detachSessionIfNeeded(victimSession);
    removeTransientCharacter(attackerCharacterID);
    removeTransientCharacter(victimCharacterID);
  }
}

function main() {
  runtime._testing.clearScenes();
  crimewatchState.clearAllCrimewatchState();

  try {
    const shipCase = runAggressionCase({
      attackerClientID: SHIP_ATTACKER_CLIENT_ID,
      attackerCharacterID: SHIP_ATTACKER_CHARACTER_ID,
      victimClientID: SHIP_VICTIM_CLIENT_ID,
      victimCharacterID: SHIP_VICTIM_CHARACTER_ID,
      victimShipTypeID: 606,
      victimGroupID: 25,
      victimRadius: 50,
      positionOffsetX: 4_000,
    });

    crimewatchState.clearAllCrimewatchState();

    const capsuleCase = runAggressionCase({
      attackerClientID: POD_ATTACKER_CLIENT_ID,
      attackerCharacterID: POD_ATTACKER_CHARACTER_ID,
      victimClientID: POD_VICTIM_CLIENT_ID,
      victimCharacterID: POD_VICTIM_CHARACTER_ID,
      victimShipTypeID: 670,
      victimGroupID: 29,
      victimRadius: 10,
      positionOffsetX: 7_500,
    });

    assert(
      Math.abs(capsuleCase.delta) > Math.abs(shipCase.delta) * 5,
      `expected capsule hit (${capsuleCase.delta}) to be materially larger than ship hit (${shipCase.delta})`,
    );

    console.log(JSON.stringify({
      ok: true,
      shipCase,
      capsuleCase,
    }, null, 2));
  } finally {
    crimewatchState.clearAllCrimewatchState();
    runtime._testing.clearScenes();
  }
}

main();
setImmediate(() => process.exit(0));

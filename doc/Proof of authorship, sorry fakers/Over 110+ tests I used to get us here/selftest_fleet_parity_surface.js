/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const sessionRegistry = require(path.join(
  __dirname,
  "../../server/src/services/chat/sessionRegistry",
));
const fleetRuntime = require(path.join(
  __dirname,
  "../../server/src/services/fleets/fleetRuntime",
));
const FleetObjectHandlerService = require(path.join(
  __dirname,
  "../../server/src/services/fleets/fleetObjectHandlerService",
));
const BeyonceService = require(path.join(
  __dirname,
  "../../server/src/services/ship/beyonceService",
));
const CharMgrService = require(path.join(
  __dirname,
  "../../server/src/services/character/charMgrService",
));
const FleetMgrService = require(path.join(
  __dirname,
  "../../server/src/services/fleets/fleetMgrService",
));
const FleetProxyService = require(path.join(
  __dirname,
  "../../server/src/services/fleets/fleetProxyService",
));
const InvBrokerService = require(path.join(
  __dirname,
  "../../server/src/services/inventory/invBrokerService",
));
const npcService = require(path.join(
  __dirname,
  "../../server/src/space/npc/npcService",
));
const nativeNpcStore = require(path.join(
  __dirname,
  "../../server/src/space/npc/nativeNpcStore",
));
const nativeNpcWreckService = require(path.join(
  __dirname,
  "../../server/src/space/npc/nativeNpcWreckService",
));
const shipDestruction = require(path.join(
  __dirname,
  "../../server/src/space/shipDestruction",
));
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const {
  buildDict,
  buildKeyVal,
  buildMarshalReal,
  buildPythonSet,
  marshalObjectToObject,
} = require(path.join(
  __dirname,
  "../../server/src/services/_shared/serviceHelpers",
));
const {
  ITEM_FLAGS,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  DEFAULT_STATION,
} = require(path.join(
  __dirname,
  "../../server/src/services/_shared/stationStaticData",
));

const TEST_CHARACTERS = [
  978201,
  978202,
  978203,
];
const TEST_CORPORATION_ID = 1000009;
const TEST_SYSTEM_ID = 30000142;
const TRANSIENT_TABLES = [
  "characters",
  "items",
  "skills",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcWrecks",
  "npcWreckItems",
];
const TEST_FLEET_SETUP_YAML = [
  "- setupName: Alpha Doctrine",
  "  motd: Hold cloak",
  "  isFreeMove: true",
  "  maxFleetSize: 42",
  "  defaultSquad:",
  "    - Alpha",
  "    - 1",
  "    - Two",
  "  wingsInfo:",
  "    alpha:",
  "      wingName: Alpha",
  "      wingIdx: 0",
  "      squadNames:",
  "        - One",
  "        - Two",
  "    bravo:",
  "      wingName: Bravo",
  "      wingIdx: 1",
  "      squadNames:",
  "        - Three",
].join("\n");

function createTemporaryCharacterRecord(characterID, name) {
  const characters = database.read("characters", "/");
  assert.strictEqual(characters.success, true, "characters table should be readable");
  const templateEntry = Object.entries(characters.data || {}).find(([, row]) => (
    row && Number(row.accountId) > 0
  ));
  assert(templateEntry, "expected a player character template");
  const [, templateRecord] = templateEntry;
  const temporaryRecord = {
    ...templateRecord,
    accountId: 1,
    characterName: name,
    corporationID: TEST_CORPORATION_ID,
    allianceID: null,
    warFactionID: null,
    securityStatus: 0,
    securityRating: 0,
    shipID: characterID + 100000,
    shipTypeID: 606,
    shipName: `ship-${characterID}`,
    solarSystemID: TEST_SYSTEM_ID,
    stationID: null,
    structureID: null,
  };
  const writeResult = database.write(
    "characters",
    `/${String(characterID)}`,
    temporaryRecord,
    { transient: true },
  );
  assert.strictEqual(writeResult.success, true, "temporary character should be writable");
}

function createFakeSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  const timeline = [];
  return {
    userid: characterID,
    clientID: characterID + 1000000,
    characterID,
    charID: characterID,
    charid: characterID,
    characterName: `char-${characterID}`,
    corporationID: TEST_CORPORATION_ID,
    corpid: TEST_CORPORATION_ID,
    allianceID: null,
    allianceid: null,
    warFactionID: null,
    warfactionid: null,
    shipID: characterID + 100000,
    shipid: characterID + 100000,
    shipTypeID: 606,
    solarsystemid: TEST_SYSTEM_ID,
    solarsystemid2: TEST_SYSTEM_ID,
    stationid: null,
    stationid2: null,
    structureid: null,
    fleetid: null,
    fleetrole: null,
    wingid: null,
    squadid: null,
    socket: { destroyed: false },
    notifications,
    sessionChanges,
    timeline,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
      timeline.push({
        kind: "notification",
        name,
        idType,
        payload: cloneValue(payload),
      });
    },
    sendSessionChange(changes) {
      sessionChanges.push(changes);
      timeline.push({
        kind: "sessionChange",
        keys: Object.keys(changes || {}),
        changes: cloneValue(changes),
      });
    },
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTableSnapshot(tableName) {
  const result = database.read(tableName, "/");
  return result.success ? cloneValue(result.data) : {};
}

function writeTableSnapshot(tableName, snapshot) {
  database.write(tableName, "/", cloneValue(snapshot));
}

function snapshotTransientTables() {
  return Object.fromEntries(TRANSIENT_TABLES.map((tableName) => ([
    tableName,
    readTableSnapshot(tableName),
  ])));
}

function restoreTransientTables(snapshot) {
  for (const tableName of TRANSIENT_TABLES) {
    writeTableSnapshot(tableName, snapshot[tableName] || {});
  }
}

function createNativeCombatNpc() {
  const spawnResult = npcService.spawnNpcBatchInSystem(TEST_SYSTEM_ID, {
    entityType: "concord",
    runtimeKind: "nativeCombat",
    amount: 1,
    profileQuery: "concord_response",
    transient: true,
    anchorDescriptor: {
      kind: "coordinates",
      position: { x: 150_000, y: 0, z: 75_000 },
      direction: { x: 1, y: 0, z: 0 },
    },
  });
  assert.strictEqual(spawnResult.success, true, "expected transient native NPC spawn to succeed");
  assert.ok(spawnResult.data && Array.isArray(spawnResult.data.spawned), "expected spawned native NPC payload");
  return spawnResult.data.spawned[0].entity;
}

function extractBoundOID(boundResponse) {
  const boundHandle =
    Array.isArray(boundResponse)
      ? boundResponse[0]
      : boundResponse;

  return (
    boundHandle &&
    boundHandle.value &&
    boundHandle.value.value &&
    Array.isArray(boundHandle.value.value)
  )
    ? boundHandle.value.value[0]
    : null;
}

function findNotification(session, name, predicate = null) {
  return session.notifications.find((entry) => (
    entry &&
    entry.name === name &&
    (typeof predicate !== "function" || predicate(entry))
  )) || null;
}

function findTimelineIndex(session, predicate) {
  return Array.isArray(session && session.timeline)
    ? session.timeline.findIndex((entry) => predicate(entry))
    : -1;
}

function getLiveFleetAdvert(characterID) {
  const fleet = fleetRuntime.getFleetForCharacter(characterID);
  return fleet ? fleet.advert : null;
}

function getNotificationListPayload(entry) {
  return entry && entry.payload && entry.payload[0] && entry.payload[0].type === "list"
    ? entry.payload[0]
    : null;
}

function getNotificationDictPayload(entry) {
  return entry && entry.payload && entry.payload[0] && entry.payload[0].type === "dict"
    ? entry.payload[0]
    : null;
}

function getTargetTagsFromNotification(entry) {
  const keyVal = entry && entry.payload ? entry.payload[0] : null;
  const mapped = marshalObjectToObject(keyVal);
  const targetTags = mapped && mapped.targetTags ? mapped.targetTags : null;
  if (!targetTags) {
    return new Map();
  }

  if (targetTags.type === "dict" && Array.isArray(targetTags.entries)) {
    return new Map(
      targetTags.entries.map(([itemID, tag]) => [Number(itemID) || 0, String(tag || "")]),
    );
  }

  return new Map(
    Object.entries(targetTags).map(([itemID, tag]) => [Number(itemID) || 0, String(tag || "")]),
  );
}

function clearFleetRuntime() {
  fleetRuntime.runtimeState.nextFleetSerial = 1;
  fleetRuntime.runtimeState.fleets.clear();
  fleetRuntime.runtimeState.characterToFleet.clear();
  fleetRuntime.runtimeState.invitesByCharacter.clear();
}

function main() {
  clearFleetRuntime();
  const sessions = [];

  try {
    for (const characterID of TEST_CHARACTERS) {
      createTemporaryCharacterRecord(characterID, `fleet-test-${characterID}`);
      const session = createFakeSession(characterID);
      sessions.push(session);
      sessionRegistry.register(session);
    }

    const [leader, applicant, requester] = sessions;
    const charMgr = new CharMgrService();
    const fleetObjectHandler = new FleetObjectHandlerService();
    const fleetMgr = new FleetMgrService();
    const fleetProxy = new FleetProxyService();
    const beyonce = new BeyonceService();

    charMgr.Handle_SaveCharacterSetting([
      "fleetSetups",
      TEST_FLEET_SETUP_YAML,
    ], leader);
    const settingsPayload = charMgr.Handle_GetCharacterSettings([], leader);
    assert(settingsPayload && settingsPayload.type === "dict", "GetCharacterSettings should return a flat dict");
    assert(
      settingsPayload.entries.some(([key]) => key === "fleetSetups"),
      "saved fleet setups should round-trip through charMgr settings",
    );

    const createResponse = fleetObjectHandler.Handle_CreateFleet([], leader);
    assert(createResponse && createResponse.type === "substruct", "CreateFleet should return a direct bound object handle");
    const leaderOID = extractBoundOID(createResponse);
    assert(leaderOID, "CreateFleet should return a bound fleet object");
    leader.currentBoundObjectID = leaderOID;

    const initAdvert = fleetObjectHandler.Handle_Init([606, "Alpha Doctrine"], leader, null);
    assert.strictEqual(initAdvert, null, "plain Init should not register an advert");
    assert(leader.fleetid, "Init should set a fleet session on the creator");
    assert.strictEqual(leader.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_LEADER);

    const setupFleet = fleetRuntime.getFleetState(leader.fleetid);
    const setupWings = [...setupFleet.wings.values()].sort((left, right) => left.wingID - right.wingID);
    assert.strictEqual(setupWings.length, 2, "setup init should create the saved wing count");
    assert.deepStrictEqual(
      setupWings.map((wing) => wing.name),
      ["Alpha", "Bravo"],
      "setup init should restore wing names",
    );
    assert.deepStrictEqual(
      [...setupWings[0].squads.values()].sort((left, right) => left.squadID - right.squadID).map((squad) => squad.name),
      ["One", "Two"],
      "setup init should restore first-wing squads",
    );
    assert.deepStrictEqual(
      [...setupWings[1].squads.values()].sort((left, right) => left.squadID - right.squadID).map((squad) => squad.name),
      ["Three"],
      "setup init should restore second-wing squads",
    );
    assert.strictEqual(setupFleet.motd, "Hold cloak", "setup init should restore motd");
    assert.strictEqual(setupFleet.options.isFreeMove, true, "setup init should restore free move");
    assert.strictEqual(fleetRuntime.getFleetMaxSize(leader.fleetid), 42, "setup init should restore max fleet size");
    assert.strictEqual(
      setupFleet.options.autoJoinSquadID,
      [...setupWings[0].squads.values()].sort((left, right) => left.squadID - right.squadID)[1].squadID,
      "setup init should restore the default squad",
    );

    const initState = fleetObjectHandler.Handle_GetInitState([], leader);
    assert(initState && initState.name === "util.KeyVal", "GetInitState should return KeyVal payload");

    const temporaryWingID = fleetObjectHandler.Handle_CreateWing([], leader);
    assert(temporaryWingID > 0, "CreateWing should still work after setup init");
    assert.strictEqual(
      fleetObjectHandler.Handle_LoadFleetSetup(["Alpha Doctrine"], leader),
      true,
      "LoadFleetSetup should apply a saved setup",
    );
    assert.strictEqual(
      fleetRuntime.getWings(leader.fleetid).size,
      2,
      "LoadFleetSetup should prune extra empty wings back to the saved structure",
    );

    const registeredAdvert = fleetProxy.Handle_AddFleetFinderAdvert([
      buildDict([
        ["fleetName", "Parity Fleet"],
        ["description", "Server parity test fleet"],
        ["inviteScope", fleetRuntime.FLEET.INVITE_PUBLIC_OPEN],
        ["joinNeedsApproval", false],
        ["hideInfo", false],
        ["useAdvanceOptions", true],
        ["public_minSecurity", buildMarshalReal(0.5)],
        ["advertJoinLimit", 10],
      ]),
    ], leader);
    assert(registeredAdvert && registeredAdvert.type === "dict", "AddFleetFinderAdvert should return advert dict");
    assert.strictEqual(
      getLiveFleetAdvert(leader.characterID).public_minSecurity,
      0.5,
      "AddFleetFinderAdvert should unwrap marshal real values",
    );
    assert.strictEqual(
      getLiveFleetAdvert(leader.characterID).advertJoinLimit,
      10,
      "AddFleetFinderAdvert should unwrap marshal dict values",
    );

    const allowedEntitiesAdvert = fleetProxy.Handle_UpdateAdvertAllowedEntities([
      buildKeyVal([
        ["membergroups_allowedEntities", buildPythonSet([101, 102])],
        ["public_allowedEntities", buildPythonSet([201])],
        ["membergroups_disallowedEntities", buildPythonSet([301])],
        ["public_disallowedEntities", buildPythonSet([401, 402])],
      ]),
    ], leader);
    assert(allowedEntitiesAdvert && allowedEntitiesAdvert.type === "dict", "UpdateAdvertAllowedEntities should accept marshal KeyVal input");
    assert.deepStrictEqual(
      [...getLiveFleetAdvert(leader.characterID).membergroups_allowedEntities].sort((left, right) => left - right),
      [101, 102],
      "UpdateAdvertAllowedEntities should unwrap membergroup allowed entities",
    );
    assert.deepStrictEqual(
      [...getLiveFleetAdvert(leader.characterID).public_disallowedEntities].sort((left, right) => left - right),
      [401, 402],
      "UpdateAdvertAllowedEntities should unwrap public disallowed entities",
    );

    const updatedAdvertInfo = fleetProxy.Handle_UpdateAdvertInfo([
      7,
      buildKeyVal([
        ["membergroupsToAddToAllowed", buildPythonSet([103])],
        ["membergroupsToRemoveFromAllowed", buildPythonSet([101])],
        ["membergroupsToAddToDisallowed", buildPythonSet([302])],
        ["membergroupsToRemoveFromDisallowed", buildPythonSet([301])],
        ["publicToAddToAllowed", buildPythonSet([202])],
        ["publicToRemoveFromAllowed", buildPythonSet([201])],
        ["publicToAddToDisallowed", buildPythonSet([403])],
        ["publicToRemoveFromDisallowed", buildPythonSet([402])],
      ]),
    ], leader);
    assert(updatedAdvertInfo && updatedAdvertInfo.type === "dict", "UpdateAdvertInfo should accept marshal KeyVal diffs");
    assert.strictEqual(
      getLiveFleetAdvert(leader.characterID).numMembers,
      7,
      "UpdateAdvertInfo should update advert membership count",
    );
    assert.deepStrictEqual(
      [...getLiveFleetAdvert(leader.characterID).membergroups_allowedEntities].sort((left, right) => left - right),
      [102, 103],
      "UpdateAdvertInfo should patch membergroup allowed entity sets",
    );
    assert.deepStrictEqual(
      [...getLiveFleetAdvert(leader.characterID).public_allowedEntities].sort((left, right) => left - right),
      [202],
      "UpdateAdvertInfo should patch public allowed entity sets",
    );
    assert.deepStrictEqual(
      [...getLiveFleetAdvert(leader.characterID).public_disallowedEntities].sort((left, right) => left - right),
      [401, 403],
      "UpdateAdvertInfo should patch public disallowed entity sets",
    );

    const ads = fleetProxy.Handle_GetAvailableFleetAds([], applicant);
    assert(ads && ads.type === "dict", "GetAvailableFleetAds should return a dict");

    const joinResult = fleetProxy.Handle_ApplyToJoinFleet([leader.fleetid, false], applicant);
    assert.strictEqual(joinResult, false, "open advert join should auto-invite instead of returning application received");
    const inviteNotification = findNotification(applicant, "OnFleetInvite");
    assert(inviteNotification, "applicant should receive OnFleetInvite");

    const applicantBind = fleetObjectHandler.Handle_MachoBindObject([leader.fleetid, null], applicant);
    const applicantOID = extractBoundOID(applicantBind);
    assert(applicantOID, "joining member should be able to bind the fleet moniker");
    applicant.currentBoundObjectID = applicantOID;
    assert.strictEqual(
      fleetObjectHandler.Handle_AcceptInvite([606], applicant),
      true,
      "AcceptInvite should succeed",
    );
    assert.strictEqual(applicant.fleetid, leader.fleetid, "accepted invite should join the applicant to the fleet");
    assert(
      findNotification(leader, "OnFleetJoin"),
      "leader should receive OnFleetJoin for the new member",
    );

    const createdWingID = fleetObjectHandler.Handle_CreateWing([], leader);
    assert(createdWingID > 0, "CreateWing should return a wing id");
    const createdSquadID = fleetObjectHandler.Handle_CreateSquad([createdWingID], leader);
    assert(createdSquadID > 0, "CreateSquad should return a squad id");

    const manualInviteResult = fleetObjectHandler.Handle_Invite([
      requester.characterID,
      createdWingID,
      createdSquadID,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ], leader);
    assert.strictEqual(manualInviteResult, true, "Invite should succeed");
    assert(
      findNotification(requester, "OnFleetInvite"),
      "manual invite should emit OnFleetInvite",
    );

    const applicantPreMoveWingID = applicant.wingid;
    const applicantPreMoveSquadID = applicant.squadid;
    const applicantMoveTimelineStart = applicant.timeline.length;
    const applicantMoveSessionChangeStart = applicant.sessionChanges.length;
    const moveResult = fleetObjectHandler.Handle_MoveMember([
      applicant.characterID,
      createdWingID,
      createdSquadID,
      fleetRuntime.FLEET.FLEET_ROLE_MEMBER,
    ], leader);
    assert.strictEqual(moveResult, true, "MoveMember should succeed");
    assert.strictEqual(
      applicant.wingid,
      applicantPreMoveWingID,
      "MoveMember should defer wing session changes until FinishMove",
    );
    assert.strictEqual(
      applicant.squadid,
      applicantPreMoveSquadID,
      "MoveMember should defer squad session changes until FinishMove",
    );
    assert(
      findNotification(applicant, "OnFleetMove"),
      "MoveMember should notify the moved member with OnFleetMove",
    );
    assert.strictEqual(
      applicant.sessionChanges.length,
      applicantMoveSessionChangeStart,
      "MoveMember should not emit the session change before FinishMove",
    );
    const applicantMoveTimeline = applicant.timeline.slice(applicantMoveTimelineStart);
    const applicantMemberChangedIndex = applicantMoveTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMemberChanged" &&
      Array.isArray(entry.payload) &&
      Number(entry.payload[0]) === applicant.characterID
    ));
    const applicantFleetMoveIndex = applicantMoveTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMove"
    ));
    assert(applicantMemberChangedIndex >= 0, "MoveMember should notify the moved member with OnFleetMemberChanged first");
    assert(
      applicantFleetMoveIndex > applicantMemberChangedIndex,
      "OnFleetMove should follow the moved member's OnFleetMemberChanged notification",
    );
    assert.strictEqual(
      fleetObjectHandler.Handle_FinishMove([], applicant),
      true,
      "FinishMove should apply pending move session changes",
    );
    assert.strictEqual(applicant.wingid, createdWingID, "FinishMove should update wing session state");
    assert.strictEqual(applicant.squadid, createdSquadID, "FinishMove should update squad session state");
    const applicantMoveTimelineAfterFinish = applicant.timeline.slice(applicantMoveTimelineStart);
    const applicantSessionChangeIndex = applicantMoveTimelineAfterFinish.findIndex((entry) => (
      entry &&
      entry.kind === "sessionChange" &&
      entry.keys.includes("wingid") &&
      entry.keys.includes("squadid")
    ));
    assert(
      applicantSessionChangeIndex > applicantFleetMoveIndex,
      "FinishMove session changes should land after OnFleetMove",
    );

    const broadcastResult = fleetObjectHandler.Handle_SendBroadcast([
      "NeedBackup",
      fleetRuntime.FLEET.BROADCAST_ALL,
      applicant.shipid,
      null,
    ], applicant);
    assert.strictEqual(broadcastResult, true, "SendBroadcast should succeed for a fleet member");
    assert(
      findNotification(leader, "OnFleetBroadcast"),
      "fleet broadcast should reach other fleet members",
    );

    const fleetStateChangeResult = beyonce.Handle_CmdFleetTagTarget([
      requester.shipid,
      "A",
    ], leader);
    assert.strictEqual(fleetStateChangeResult, null, "CmdFleetTagTarget should be fire-and-forget");
    const fleetStateChange = findNotification(applicant, "OnFleetStateChange");
    assert(fleetStateChange, "CmdFleetTagTarget should notify fleet members with OnFleetStateChange");
    const taggedTargets = getTargetTagsFromNotification(fleetStateChange);
    assert.strictEqual(
      taggedTargets.get(requester.shipid),
      "A",
      "OnFleetStateChange should carry targetTags keyed by itemID",
    );

    beyonce.Handle_CmdFleetTagTarget([
      requester.shipid,
      null,
    ], leader);
    const clearedFleetStateChange = leader.notifications.filter((entry) => entry && entry.name === "OnFleetStateChange").slice(-1)[0];
    assert(clearedFleetStateChange, "untagging should also emit OnFleetStateChange");
    assert.strictEqual(
      getTargetTagsFromNotification(clearedFleetStateChange).size,
      0,
      "untagging should remove the target tag from the fleet state payload",
    );

    assert.strictEqual(
      fleetRuntime.setBridgeMode(leader.fleetid, leader.shipid, TEST_SYSTEM_ID, 880001, true),
      true,
      "setBridgeMode should accept active bridge updates",
    );
    const bridgeNotification = findNotification(applicant, "OnBridgeModeChange");
    assert(bridgeNotification, "bridge changes should notify fleet members");
    assert.deepStrictEqual(
      bridgeNotification.payload,
      [leader.shipid, TEST_SYSTEM_ID, 880001, true],
      "OnBridgeModeChange should follow the CCP client payload order",
    );

    assert.strictEqual(
      fleetRuntime.setJumpBeaconModuleState(leader.fleetid, leader.characterID, TEST_SYSTEM_ID, 880002, 9876, true),
      true,
      "setJumpBeaconModuleState should accept active beacon updates",
    );
    const moduleBeaconNotification = findNotification(applicant, "OnFleetJumpBeaconModuleChange");
    assert(moduleBeaconNotification, "module beacon changes should notify fleet members");
    assert.deepStrictEqual(
      moduleBeaconNotification.payload,
      [leader.characterID, TEST_SYSTEM_ID, 880002, 9876, true],
      "OnFleetJumpBeaconModuleChange should follow the CCP client payload order",
    );

    assert.strictEqual(
      fleetRuntime.setJumpBeaconDeployableState(leader.fleetid, 880003, TEST_SYSTEM_ID, 880004, leader.characterID, true),
      true,
      "setJumpBeaconDeployableState should accept active deployable beacon updates",
    );
    const deployableBeaconNotification = findNotification(applicant, "OnFleetJumpBeaconDeployableChange");
    assert(deployableBeaconNotification, "deployable beacon changes should notify fleet members");
    assert.deepStrictEqual(
      deployableBeaconNotification.payload,
      [880003, TEST_SYSTEM_ID, 880004, leader.characterID, true],
      "OnFleetJumpBeaconDeployableChange should follow the CCP client payload order",
    );

    const updateApprovalAdvert = fleetProxy.Handle_AddFleetFinderAdvert([{
      fleetName: "Parity Fleet Approval",
      description: "Approval required",
      inviteScope: fleetRuntime.FLEET.INVITE_PUBLIC_OPEN,
      joinNeedsApproval: true,
      hideInfo: false,
      useAdvanceOptions: true,
    }], leader);
    assert(updateApprovalAdvert, "updating advert to approval flow should succeed");

    const requestResult = fleetProxy.Handle_ApplyToJoinFleet([leader.fleetid, false], requester);
    assert.strictEqual(requestResult, true, "approval advert should return application received");
    assert(
      findNotification(leader, "OnFleetJoinRequest"),
      "leader should receive OnFleetJoinRequest",
    );

    const respawnPoints = fleetRuntime.setRespawnPoints(leader.fleetid, [
      {
        solarsystemID: TEST_SYSTEM_ID,
        extraClientState: {
          characterID: leader.characterID,
        },
        label: "Homefield",
      },
    ]);
    assert.strictEqual(respawnPoints.length, 1, "setRespawnPoints should persist fleet respawn points");
    assert.strictEqual(
      respawnPoints[0].extraClientState.characterID,
      leader.characterID,
      "setRespawnPoints should preserve nested extraClientState character ids",
    );
    const respawnNotification = findNotification(leader, "OnFleetRespawnPointsUpdate");
    assert(respawnNotification, "setRespawnPoints should notify fleet members");
    const respawnPayload = getNotificationListPayload(respawnNotification);
    assert(respawnPayload, "OnFleetRespawnPointsUpdate should carry a list payload");
    assert.strictEqual(respawnPayload.items.length, 1, "OnFleetRespawnPointsUpdate should include respawn entries");
    assert.strictEqual(
      respawnPayload.items[0].name,
      "util.KeyVal",
      "respawn entries should be KeyVal shaped for the fleet respawn UI",
    );
    const respawnExtraClientState = respawnPayload.items[0].args.entries.find(([key]) => key === "extraClientState");
    assert(respawnExtraClientState, "respawn entries should include extraClientState");
    assert.strictEqual(
      respawnExtraClientState[1].name,
      "util.KeyVal",
      "respawn extraClientState should be KeyVal shaped",
    );

    const noUpdateOnBossChangeAdvert = fleetProxy.Handle_AddFleetFinderAdvert([{
      fleetName: "Parity Fleet Transfer Off",
      description: "No boss-change update",
      inviteScope: fleetRuntime.FLEET.INVITE_PUBLIC_OPEN,
      joinNeedsApproval: false,
      hideInfo: false,
      useAdvanceOptions: true,
      updateOnBossChange: false,
    }], leader);
    assert(noUpdateOnBossChangeAdvert, "AddFleetFinderAdvert should allow updateOnBossChange false");
    const leaderBossTransferStart = leader.timeline.length;
    const applicantBossTransferStart = applicant.timeline.length;
    assert.strictEqual(
      fleetObjectHandler.Handle_MakeLeader([applicant.characterID], leader),
      true,
      "MakeLeader should succeed when handing boss to another member",
    );
    assert.strictEqual(applicant.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_MEMBER, "new boss session role should wait for FinishMove");
    assert.strictEqual(leader.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_LEADER, "old boss session role should wait for FinishMove");
    assert.strictEqual(getLiveFleetAdvert(applicant.characterID), null, "leader transfer should remove adverts when updateOnBossChange is false");
    assert.strictEqual(
      fleetRuntime.getFleetForCharacter(applicant.characterID).options.isRegistered,
      false,
      "leader transfer should clear registration when updateOnBossChange is false",
    );
    const leaderBossTransferTimeline = leader.timeline.slice(leaderBossTransferStart);
    const applicantBossTransferTimeline = applicant.timeline.slice(applicantBossTransferStart);
    const leaderOwnMemberChanged = leaderBossTransferTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMemberChanged" &&
      Array.isArray(entry.payload) &&
      Number(entry.payload[0]) === leader.characterID
    ));
    const leaderOwnMove = leaderBossTransferTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMove"
    ));
    const applicantOwnMemberChanged = applicantBossTransferTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMemberChanged" &&
      Array.isArray(entry.payload) &&
      Number(entry.payload[0]) === applicant.characterID
    ));
    const applicantOwnMove = applicantBossTransferTimeline.findIndex((entry) => (
      entry &&
      entry.kind === "notification" &&
      entry.name === "OnFleetMove"
    ));
    assert(leaderOwnMemberChanged >= 0 && leaderOwnMove > leaderOwnMemberChanged, "old boss should see OnFleetMemberChanged before OnFleetMove");
    assert(applicantOwnMemberChanged >= 0 && applicantOwnMove > applicantOwnMemberChanged, "new boss should see OnFleetMemberChanged before OnFleetMove");
    assert.strictEqual(fleetObjectHandler.Handle_FinishMove([], leader), true, "demoted boss FinishMove should succeed");
    assert.strictEqual(fleetObjectHandler.Handle_FinishMove([], applicant), true, "promoted boss FinishMove should succeed");
    assert.strictEqual(applicant.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_LEADER, "new boss should receive leader session role after FinishMove");
    assert.strictEqual(leader.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_MEMBER, "old boss should be demoted in session state after FinishMove");

    const yesUpdateOnBossChangeAdvert = fleetProxy.Handle_AddFleetFinderAdvert([{
      fleetName: "Parity Fleet Transfer On",
      description: "Boss-change update enabled",
      inviteScope: fleetRuntime.FLEET.INVITE_PUBLIC_OPEN,
      joinNeedsApproval: false,
      hideInfo: false,
      useAdvanceOptions: true,
      updateOnBossChange: true,
    }], applicant);
    assert(yesUpdateOnBossChangeAdvert, "new boss should be able to re-register an advert");
    const applicantRestoreBossStart = applicant.timeline.length;
    const leaderRestoreBossStart = leader.timeline.length;
    assert.strictEqual(
      fleetObjectHandler.Handle_MakeLeader([leader.characterID], applicant),
      true,
      "MakeLeader should also support restoring boss back to the original leader",
    );
    assert.strictEqual(leader.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_MEMBER, "restored boss session role should wait for FinishMove");
    assert.strictEqual(applicant.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_LEADER, "temporary boss session role should wait for FinishMove");
    assert.strictEqual(
      getLiveFleetAdvert(leader.characterID).leader.charID,
      leader.characterID,
      "leader transfer should rewrite advert leader data when updateOnBossChange is true",
    );
    assert.strictEqual(
      fleetRuntime.getFleetForCharacter(leader.characterID).options.isRegistered,
      true,
      "leader transfer should preserve registration when updateOnBossChange is true",
    );
    const applicantRestoreBossTimeline = applicant.timeline.slice(applicantRestoreBossStart);
    const leaderRestoreBossTimeline = leader.timeline.slice(leaderRestoreBossStart);
    assert(
      applicantRestoreBossTimeline.findIndex((entry) => (
        entry &&
        entry.kind === "notification" &&
        entry.name === "OnFleetMove"
      )) >
      applicantRestoreBossTimeline.findIndex((entry) => (
        entry &&
        entry.kind === "notification" &&
        entry.name === "OnFleetMemberChanged" &&
        Array.isArray(entry.payload) &&
        Number(entry.payload[0]) === applicant.characterID
      )),
      "temporary boss demotion should emit OnFleetMemberChanged before OnFleetMove",
    );
    assert(
      leaderRestoreBossTimeline.findIndex((entry) => (
        entry &&
        entry.kind === "notification" &&
        entry.name === "OnFleetMove"
      )) >
      leaderRestoreBossTimeline.findIndex((entry) => (
        entry &&
        entry.kind === "notification" &&
        entry.name === "OnFleetMemberChanged" &&
        Array.isArray(entry.payload) &&
        Number(entry.payload[0]) === leader.characterID
      )),
      "restored boss promotion should emit OnFleetMemberChanged before OnFleetMove",
    );
    assert.strictEqual(fleetObjectHandler.Handle_FinishMove([], applicant), true, "temporary boss FinishMove should succeed");
    assert.strictEqual(fleetObjectHandler.Handle_FinishMove([], leader), true, "restored boss FinishMove should succeed");
    assert.strictEqual(leader.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_LEADER, "restored boss should regain leader session role after FinishMove");
    assert.strictEqual(applicant.fleetrole, fleetRuntime.FLEET.FLEET_ROLE_MEMBER, "temporary boss should return to member session role after FinishMove");

    const rejectResult = fleetObjectHandler.Handle_RejectJoinRequest([
      requester.characterID,
    ], leader);
    assert.strictEqual(rejectResult, true, "RejectJoinRequest should succeed");
    assert(
      findNotification(requester, "OnFleetJoinRejected"),
      "applicant should receive OnFleetJoinRejected",
    );

    const watchlistAdd = fleetMgr.Handle_AddToWatchlist([
      [applicant.characterID],
      [applicant.characterID],
    ], leader);
    assert.strictEqual(watchlistAdd, true, "AddToWatchlist should succeed");
    const damageUpdates = fleetMgr.Handle_RegisterForDamageUpdates([
      [applicant.characterID],
    ], leader);
    assert.strictEqual(damageUpdates, true, "RegisterForDamageUpdates should succeed");

    const tableSnapshot = snapshotTransientTables();
    runtime._testing.clearScenes();
    const previousBoundObjectID = leader.currentBoundObjectID;
    try {
      leader.stationid = DEFAULT_STATION.stationID;
      leader.stationid2 = DEFAULT_STATION.stationID;
      const npcEntity = createNativeCombatNpc();
      const destroyResult = shipDestruction._testing.destroyShipEntityWithWreck(
        TEST_SYSTEM_ID,
        npcEntity,
      );
      assert.strictEqual(destroyResult.success, true, "native NPC destruction should produce a wreck for loot-event validation");
      const wreckID = destroyResult.data.wreck.wreckID;
      const wreckContents = nativeNpcStore.buildNativeWreckContents(wreckID);
      assert.ok(wreckContents.length > 0, "expected wreck contents for fleet loot-event validation");

      const invBroker = new InvBrokerService();
      invBroker._rememberBoundContext("test-fleet-loot-hangar", {
        inventoryID: DEFAULT_STATION.stationID,
        locationID: DEFAULT_STATION.stationID,
        flagID: ITEM_FLAGS.HANGAR,
        kind: "stationHangar",
      });
      leader.currentBoundObjectID = "test-fleet-loot-hangar";

      const movedItemID = invBroker.Handle_Add(
        [wreckContents[0].itemID, wreckID],
        leader,
        { flag: ITEM_FLAGS.HANGAR },
      );

      assert.ok(Number(movedItemID) > 0, "looting a wreck item should still succeed through invBroker");
      const lootNotification = findNotification(applicant, "OnFleetLootEvent");
      assert(lootNotification, "looting a wreck item should emit OnFleetLootEvent to fleet members");
      const lootPayload = getNotificationDictPayload(lootNotification);
      assert(lootPayload, "OnFleetLootEvent should carry a dict payload");
      const matchingLootEntry = lootPayload.entries.find(([key, quantity]) => (
        key &&
        key.type === "tuple" &&
        Array.isArray(key.items) &&
        Number(key.items[0]) === leader.characterID &&
        Number(key.items[1]) === Number(wreckContents[0].typeID) &&
        Number(quantity) > 0
      )) || null;
      assert(matchingLootEntry, "OnFleetLootEvent should key loot quantities by (charID, typeID) tuples");

      nativeNpcWreckService.destroyNativeWreck(wreckID, {
        systemID: TEST_SYSTEM_ID,
      });
    } finally {
      leader.currentBoundObjectID = previousBoundObjectID || null;
      runtime._testing.clearScenes();
      restoreTransientTables(tableSnapshot);
    }

    const leaveResult = fleetObjectHandler.Handle_LeaveFleet([], applicant);
    assert.strictEqual(leaveResult, true, "LeaveFleet should succeed");
    assert.strictEqual(applicant.fleetid, null, "LeaveFleet should clear applicant fleet session");

    const disbandResult = fleetObjectHandler.Handle_DisbandFleet([], leader);
    assert.strictEqual(disbandResult, true, "DisbandFleet should succeed");
    assert.strictEqual(leader.fleetid, null, "DisbandFleet should clear leader fleet session");
    assert.strictEqual(fleetRuntime.runtimeState.fleets.size, 0, "fleet runtime should be empty after disband");
    assert(
      findNotification(requester, "OnMemberlessFleetUnregistered"),
      "disbanding a registered fleet should invalidate other clients' fleet-ad caches",
    );

    console.log("fleet-parity-surface-ok");
  } finally {
    for (const session of sessions) {
      sessionRegistry.unregister(session);
    }
    clearFleetRuntime();
  }
}

main();

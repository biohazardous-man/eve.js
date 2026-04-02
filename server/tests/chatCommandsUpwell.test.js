const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  executeChatCommand,
} = require(path.join(repoRoot, "server/src/services/chat/chatCommands"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureTetherRestrictionState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureTetherRestrictionState",
));
const structureAutoState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureAutoState",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

test("/upwell GM commands can seed, advance, inspect, and remove a structure lifecycle", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();

    const session = {
      clientID: 881001,
      characterID: 140000001,
      charid: 140000001,
      userid: 140000001,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const seedResult = executeChatCommand(
      session,
      "/upwell seed astrahus Chat Test Astrahus",
      chatHub,
      {},
    );
    assert.equal(seedResult.handled, true, "Expected /upwell seed to be handled");
    assert.match(
      String(seedResult.message || ""),
      /Seeded/,
      "Expected /upwell seed feedback",
    );

    const structure = structureState.getStructureByName("Chat Test Astrahus");
    assert.ok(structure, "Expected /upwell seed to persist the structure");

    executeChatCommand(session, `/upwell anchor ${structure.structureID}`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 1000`, chatHub, {});
    executeChatCommand(session, `/upwell core ${structure.structureID} on`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 90000`, chatHub, {});
    executeChatCommand(session, `/upwell ff ${structure.structureID} 1000`, chatHub, {});

    const onlineStructure = structureState.getStructureByID(structure.structureID);
    assert.equal(
      Number(onlineStructure && onlineStructure.state) || 0,
      110,
      "Expected the structure to reach shield_vulnerable after the GM timer fast-forward cycle",
    );

    const listResult = executeChatCommand(session, "/upwell list", chatHub, {});
    assert.match(
      String(listResult.message || ""),
      /Chat Test Astrahus/,
      "Expected /upwell list to include the seeded structure",
    );

    const timerResult = executeChatCommand(
      session,
      `/upwell timer ${structure.structureID} 0.01`,
      chatHub,
      {},
    );
    assert.match(
      String(timerResult.message || ""),
      /timer scale=0.01/i,
      "Expected /upwell timer to acknowledge the dev timer override",
    );

    const updatedStructure = structureState.getStructureByID(structure.structureID);
    assert.equal(
      Number(updatedStructure.devFlags && updatedStructure.devFlags.timerScale) || 0,
      0.01,
      "Expected /upwell timer to persist the structure timer scale override",
    );

    const tetherStatusResult = executeChatCommand(
      session,
      "/upwell tether status",
      chatHub,
      {},
    );
    assert.match(
      String(tetherStatusResult.message || ""),
      /scram=off/i,
      "Expected /upwell tether status to report the current tether restriction state",
    );

    const tetherScramResult = executeChatCommand(
      session,
      "/upwell tether scram on",
      chatHub,
      {},
    );
    assert.match(
      String(tetherScramResult.message || ""),
      /scram=on/i,
      "Expected /upwell tether scram to toggle the warp scramble restriction",
    );
    assert.equal(
      structureTetherRestrictionState.getCharacterTetherRestrictionState(session.characterID).warpScrambled,
      true,
      "Expected /upwell tether scram to persist the warp scramble flag",
    );

    const tetherDelayResult = executeChatCommand(
      session,
      "/upwell tether delay 30",
      chatHub,
      {},
    );
    assert.match(
      String(tetherDelayResult.message || ""),
      /delayMs=/i,
      "Expected /upwell tether delay to acknowledge the tether delay timer",
    );
    assert.ok(
      Number(
        structureTetherRestrictionState.getCharacterTetherRestrictionState(session.characterID).tetherDelayUntilMs,
      ) > 0,
      "Expected /upwell tether delay to persist a tether delay expiry",
    );

    const tetherClearResult = executeChatCommand(
      session,
      "/upwell tether clear",
      chatHub,
      {},
    );
    assert.match(
      String(tetherClearResult.message || ""),
      /Cleared tether restrictions/i,
      "Expected /upwell tether clear to acknowledge cleanup",
    );
    const clearedTetherState = structureTetherRestrictionState.getCharacterTetherRestrictionState(
      session.characterID,
    );
    assert.equal(clearedTetherState.warpScrambled, false);
    assert.equal(clearedTetherState.tetherDelayUntilMs, 0);

    const removeResult = executeChatCommand(
      session,
      `/upwell remove ${structure.structureID}`,
      chatHub,
      {},
    );
    assert.match(
      String(removeResult.message || ""),
      /Removed structure/i,
      "Expected /upwell remove to acknowledge structure cleanup",
    );
    assert.equal(
      structureState.getStructureByID(structure.structureID),
      null,
      "Expected /upwell remove to delete the persisted structure",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwell purge removes current-system structures and supports all-systems cleanup", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    writeTable("structures", {
      ...(structuresBackup || {}),
      structures: [],
    });
    structureState.clearStructureCaches();

    const primarySession = {
      clientID: 881101,
      characterID: 140000101,
      charid: 140000101,
      userid: 140000101,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const secondarySession = {
      ...primarySession,
      clientID: 881102,
      characterID: 140000102,
      charid: 140000102,
      userid: 140000102,
      solarsystemid2: 30002187,
      solarsystemid: 30002187,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    executeChatCommand(primarySession, "/upwell seed astrahus Purge Local One", chatHub, {});
    executeChatCommand(primarySession, "/upwell seed astrahus Purge Local Two", chatHub, {});
    executeChatCommand(secondarySession, "/upwell seed astrahus Purge Remote One", chatHub, {});

    const localBefore = structureState.listStructuresForSystem(primarySession.solarsystemid2, {
      includeDestroyed: true,
    });
    const remoteBefore = structureState.listStructuresForSystem(secondarySession.solarsystemid2, {
      includeDestroyed: true,
    });
    assert.equal(localBefore.length, 2, "Expected two local structures before purge");
    assert.equal(remoteBefore.length, 1, "Expected one remote structure before purge");

    const purgeLocalResult = executeChatCommand(
      primarySession,
      "/upwell purge",
      chatHub,
      {},
    );
    assert.match(
      String(purgeLocalResult.message || ""),
      /Purged 2 persisted structures from solar system 30000142/i,
      "Expected /upwell purge to report current-system cleanup",
    );
    assert.equal(
      structureState.listStructuresForSystem(primarySession.solarsystemid2, {
        includeDestroyed: true,
      }).length,
      0,
      "Expected /upwell purge to remove current-system structures",
    );
    assert.equal(
      structureState.listStructuresForSystem(secondarySession.solarsystemid2, {
        includeDestroyed: true,
      }).length,
      1,
      "Expected /upwell purge not to touch other systems",
    );

    const purgeAllResult = executeChatCommand(
      primarySession,
      "/upwell purge all",
      chatHub,
      {},
    );
    assert.match(
      String(purgeAllResult.message || ""),
      /Purged 1 persisted structure across 1 solar system/i,
      "Expected /upwell purge all to report global cleanup",
    );
    assert.equal(
      structureState.listStructures({
        includeDestroyed: true,
      }).length,
      0,
      "Expected /upwell purge all to remove the remaining persisted structure",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwellauto can bring a seeded structure fully online and then destroy it without manual attacks", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881201,
      characterID: 140000201,
      charid: 140000201,
      userid: 140000201,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    const autoOnlineResult = executeChatCommand(
      session,
      "/upwellauto astrahus Auto Flow Astrahus",
      chatHub,
      {},
    );
    assert.equal(autoOnlineResult.handled, true, "Expected /upwellauto astrahus to be handled");
    assert.match(
      String(autoOnlineResult.message || ""),
      /Started Upwell online automation/i,
      "Expected /upwellauto astrahus to acknowledge the automation start",
    );

    const seededStructure = structureState.getStructureByName("Auto Flow Astrahus");
    assert.ok(seededStructure, "Expected /upwellauto astrahus to seed a structure");
    const structureID = seededStructure.structureID;

    for (let step = 0; step < 8; step += 1) {
      const activeJob = structureAutoState._testing.getJobByStructureID(structureID);
      if (!activeJob) {
        break;
      }
      structureAutoState._testing.runJobNow(activeJob.jobID);
    }

    const onlineStructure = structureState.getStructureByID(structureID);
    assert.equal(
      Number(onlineStructure && onlineStructure.state) || 0,
      110,
      "Expected /upwellauto online flow to reach shield_vulnerable",
    );
    assert.equal(
      Number(onlineStructure && onlineStructure.serviceStates && onlineStructure.serviceStates["1"]) || 0,
      1,
      "Expected /upwellauto online flow to leave docking online",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structureID),
      null,
      "Expected the online automation job to stop once the structure is ready",
    );

    const autoDestroyResult = executeChatCommand(
      session,
      `/upwellauto ${structureID}`,
      chatHub,
      {},
    );
    assert.equal(autoDestroyResult.handled, true, "Expected /upwellauto <id> to be handled");
    assert.match(
      String(autoDestroyResult.message || ""),
      /No manual attack is required/i,
      "Expected /upwellauto <id> to explain that it uses GM damage internally",
    );

    for (let step = 0; step < 12; step += 1) {
      const activeJob = structureAutoState._testing.getJobByStructureID(structureID);
      if (!activeJob) {
        break;
      }
      structureAutoState._testing.runJobNow(activeJob.jobID);
    }

    const destroyedStructure = structureState.getStructureByID(structureID);
    assert.ok(
      Number(destroyedStructure && destroyedStructure.destroyedAt) > 0,
      "Expected /upwellauto <id> destruction flow to fully destroy the structure",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structureID),
      null,
      "Expected the destruction automation job to stop after the structure is destroyed",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

test("/upwellauto status and stop can inspect and cancel active Upwell automation jobs", () => {
  const structuresBackup = readTable("structures");
  const wrapsBackup = readTable("structureAssetSafety");
  const tetherRestrictionsBackup = readTable("structureTetherRestrictions");

  try {
    structureState.clearStructureCaches();
    structureAutoState._testing.clearAllJobs();

    const session = {
      clientID: 881301,
      characterID: 140000301,
      charid: 140000301,
      userid: 140000301,
      corporationID: 1000009,
      corpid: 1000009,
      shipTypeID: 606,
      solarsystemid2: 30000142,
      solarsystemid: 30000142,
    };
    const chatHub = {
      messages: [],
      sendSystemMessage(targetSession, message, channelID) {
        this.messages.push({ targetSession, message, channelID });
      },
    };

    executeChatCommand(session, "/upwellauto astrahus Auto Stop Astrahus", chatHub, {});
    const structure = structureState.getStructureByName("Auto Stop Astrahus");
    assert.ok(structure, "Expected automation setup to seed a structure for stop testing");

    const statusResult = executeChatCommand(session, "/upwellauto status", chatHub, {});
    assert.match(
      String(statusResult.message || ""),
      /mode=online/i,
      "Expected /upwellauto status to list the active automation job",
    );

    const stopResult = executeChatCommand(session, `/upwellauto stop ${structure.structureID}`, chatHub, {});
    assert.match(
      String(stopResult.message || ""),
      /Stopped Upwell automation/i,
      "Expected /upwellauto stop to acknowledge cancellation",
    );
    assert.equal(
      structureAutoState._testing.getJobByStructureID(structure.structureID),
      null,
      "Expected /upwellauto stop to remove the active job",
    );
  } finally {
    structureAutoState._testing.clearAllJobs();
    writeTable("structures", structuresBackup);
    writeTable("structureAssetSafety", wrapsBackup);
    writeTable("structureTetherRestrictions", tetherRestrictionsBackup);
    structureState.clearStructureCaches();
  }
});

const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildConfiguredConcordStartupRules,
} = require("./npcDefaultConcordRules");

const NPC_TABLE = Object.freeze({
  PROFILES: "npcProfiles",
  LOADOUTS: "npcLoadouts",
  BEHAVIOR_PROFILES: "npcBehaviorProfiles",
  LOOT_TABLES: "npcLootTables",
  SPAWN_POOLS: "npcSpawnPools",
  SPAWN_GROUPS: "npcSpawnGroups",
  SPAWN_SITES: "npcSpawnSites",
  STARTUP_RULES: "npcStartupRules",
});

const ROW_KEY = Object.freeze({
  [NPC_TABLE.PROFILES]: "profiles",
  [NPC_TABLE.LOADOUTS]: "loadouts",
  [NPC_TABLE.BEHAVIOR_PROFILES]: "behaviorProfiles",
  [NPC_TABLE.LOOT_TABLES]: "lootTables",
  [NPC_TABLE.SPAWN_POOLS]: "spawnPools",
  [NPC_TABLE.SPAWN_GROUPS]: "spawnGroups",
  [NPC_TABLE.SPAWN_SITES]: "spawnSites",
  [NPC_TABLE.STARTUP_RULES]: "startupRules",
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function getSearchableTokens(row, idFieldName) {
  const aliases = Array.isArray(row && row.aliases) ? row.aliases : [];
  return [
    row && row[idFieldName],
    row && row.name,
    ...aliases,
  ]
    .map((token) => normalizeQuery(token))
    .filter(Boolean);
}

function readNpcRows(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }

  const rows = result.data[ROW_KEY[tableName]];
  return Array.isArray(rows) ? rows.map((row) => cloneValue(row)) : [];
}

function findByID(rows, fieldName, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  return rows.find(
    (row) => String(row && row[fieldName] || "").trim() === normalizedValue,
  ) || null;
}

function resolveByQuery(rows, idFieldName, query, fallbackID = "") {
  const normalizedQuery = normalizeQuery(query || fallbackID);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "PROFILE_REQUIRED",
      suggestions: rows.slice(0, 8).map((row) => String(row.name || row[idFieldName] || "")),
    };
  }

  const exact =
    rows.find((row) => getSearchableTokens(row, idFieldName).includes(normalizedQuery)) ||
    null;
  if (exact) {
    return {
      success: true,
      data: cloneValue(exact),
      suggestions: [],
      matchKind: "exact",
    };
  }

  const partialMatches = rows.filter((row) => (
    getSearchableTokens(row, idFieldName)
      .some((token) => token.includes(normalizedQuery))
  ));
  if (partialMatches.length === 1) {
    return {
      success: true,
      data: cloneValue(partialMatches[0]),
      suggestions: [],
      matchKind: "partial",
    };
  }

  return {
    success: false,
    errorMsg: partialMatches.length > 1 ? "PROFILE_AMBIGUOUS" : "PROFILE_NOT_FOUND",
    suggestions: partialMatches
      .slice(0, 8)
      .map((row) => `${row.name} (${row[idFieldName]})`),
  };
}

function listNpcProfiles() {
  return readNpcRows(NPC_TABLE.PROFILES);
}

function getNpcProfile(profileID) {
  return findByID(listNpcProfiles(), "profileID", profileID);
}

function resolveNpcProfile(query, fallbackProfileID = "") {
  return resolveByQuery(listNpcProfiles(), "profileID", query, fallbackProfileID);
}

function listNpcLoadouts() {
  return readNpcRows(NPC_TABLE.LOADOUTS);
}

function getNpcLoadout(loadoutID) {
  return findByID(listNpcLoadouts(), "loadoutID", loadoutID);
}

function listNpcBehaviorProfiles() {
  return readNpcRows(NPC_TABLE.BEHAVIOR_PROFILES);
}

function getNpcBehaviorProfile(behaviorProfileID) {
  return findByID(listNpcBehaviorProfiles(), "behaviorProfileID", behaviorProfileID);
}

function listNpcLootTables() {
  return readNpcRows(NPC_TABLE.LOOT_TABLES);
}

function getNpcLootTable(lootTableID) {
  return findByID(listNpcLootTables(), "lootTableID", lootTableID);
}

function listNpcSpawnPools() {
  return readNpcRows(NPC_TABLE.SPAWN_POOLS);
}

function getNpcSpawnPool(spawnPoolID) {
  return findByID(listNpcSpawnPools(), "spawnPoolID", spawnPoolID);
}

function resolveNpcSpawnPool(query, fallbackSpawnPoolID = "") {
  return resolveByQuery(
    listNpcSpawnPools(),
    "spawnPoolID",
    query,
    fallbackSpawnPoolID,
  );
}

function listNpcSpawnGroups() {
  return readNpcRows(NPC_TABLE.SPAWN_GROUPS);
}

function getNpcSpawnGroup(spawnGroupID) {
  return findByID(listNpcSpawnGroups(), "spawnGroupID", spawnGroupID);
}

function resolveNpcSpawnGroup(query, fallbackSpawnGroupID = "") {
  return resolveByQuery(
    listNpcSpawnGroups(),
    "spawnGroupID",
    query,
    fallbackSpawnGroupID,
  );
}

function listNpcSpawnSites() {
  return readNpcRows(NPC_TABLE.SPAWN_SITES);
}

function getNpcSpawnSite(spawnSiteID) {
  return findByID(listNpcSpawnSites(), "spawnSiteID", spawnSiteID);
}

function resolveNpcSpawnSite(query, fallbackSpawnSiteID = "") {
  return resolveByQuery(
    listNpcSpawnSites(),
    "spawnSiteID",
    query,
    fallbackSpawnSiteID,
  );
}

function listNpcStartupRules() {
  const authoredRules = readNpcRows(NPC_TABLE.STARTUP_RULES);
  const generatedRules = buildConfiguredConcordStartupRules(authoredRules);
  return [
    ...authoredRules,
    ...generatedRules,
  ];
}

function getNpcStartupRule(startupRuleID) {
  return findByID(listNpcStartupRules(), "startupRuleID", startupRuleID);
}

function resolveNpcStartupRule(query, fallbackStartupRuleID = "") {
  return resolveByQuery(
    listNpcStartupRules(),
    "startupRuleID",
    query,
    fallbackStartupRuleID,
  );
}

function buildNpcDefinition(profileID) {
  const profile = getNpcProfile(profileID);
  if (!profile) {
    return null;
  }

  const loadout = getNpcLoadout(profile.loadoutID);
  const behaviorProfile = getNpcBehaviorProfile(profile.behaviorProfileID);
  const lootTable = getNpcLootTable(profile.lootTableID);
  if (!loadout || !behaviorProfile) {
    return null;
  }

  return {
    profile,
    loadout,
    behaviorProfile,
    lootTable,
  };
}

module.exports = {
  NPC_TABLE,
  listNpcProfiles,
  getNpcProfile,
  resolveNpcProfile,
  listNpcLoadouts,
  getNpcLoadout,
  listNpcBehaviorProfiles,
  getNpcBehaviorProfile,
  listNpcLootTables,
  getNpcLootTable,
  listNpcSpawnPools,
  getNpcSpawnPool,
  resolveNpcSpawnPool,
  listNpcSpawnGroups,
  getNpcSpawnGroup,
  resolveNpcSpawnGroup,
  listNpcSpawnSites,
  getNpcSpawnSite,
  resolveNpcSpawnSite,
  listNpcStartupRules,
  getNpcStartupRule,
  resolveNpcStartupRule,
  buildNpcDefinition,
};

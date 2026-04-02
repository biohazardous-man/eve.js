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

const ID_FIELD = Object.freeze({
  [NPC_TABLE.PROFILES]: "profileID",
  [NPC_TABLE.LOADOUTS]: "loadoutID",
  [NPC_TABLE.BEHAVIOR_PROFILES]: "behaviorProfileID",
  [NPC_TABLE.LOOT_TABLES]: "lootTableID",
  [NPC_TABLE.SPAWN_POOLS]: "spawnPoolID",
  [NPC_TABLE.SPAWN_GROUPS]: "spawnGroupID",
  [NPC_TABLE.SPAWN_SITES]: "spawnSiteID",
  [NPC_TABLE.STARTUP_RULES]: "startupRuleID",
});

const TABLE_INDEX_CACHE = Object.create(null);

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
  const index = getNpcTableIndex(tableName);
  return index.rows.map((row) => cloneValue(row));
}

function getRawNpcRows(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }

  const rows = result.data[ROW_KEY[tableName]];
  return Array.isArray(rows) ? rows : [];
}

function getNpcTableIndex(tableName) {
  const rows = getRawNpcRows(tableName);
  const idFieldName = ID_FIELD[tableName];
  const cached = TABLE_INDEX_CACHE[tableName];
  if (
    cached &&
    cached.rowsRef === rows &&
    cached.idFieldName === idFieldName
  ) {
    return cached;
  }

  const byID = new Map();
  const byExactToken = new Map();
  const queryEntries = [];
  for (const row of rows) {
    const normalizedID = String(row && row[idFieldName] || "").trim();
    if (normalizedID) {
      byID.set(normalizedID, row);
    }
    const tokens = getSearchableTokens(row, idFieldName);
    for (const token of tokens) {
      if (!byExactToken.has(token)) {
        byExactToken.set(token, row);
      }
    }
    queryEntries.push({
      row,
      tokens,
    });
  }

  const nextIndex = {
    rowsRef: rows,
    rows,
    idFieldName,
    byID,
    byExactToken,
    queryEntries,
  };
  TABLE_INDEX_CACHE[tableName] = nextIndex;
  return nextIndex;
}

function findRawByID(tableName, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  return getNpcTableIndex(tableName).byID.get(normalizedValue) || null;
}

function findByID(tableName, value) {
  const row = findRawByID(tableName, value);
  return row ? cloneValue(row) : null;
}

function resolveByQuery(tableName, query, fallbackID = "") {
  const {
    rows,
    idFieldName,
    byExactToken,
    queryEntries,
  } = getNpcTableIndex(tableName);
  const normalizedQuery = normalizeQuery(query || fallbackID);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "PROFILE_REQUIRED",
      suggestions: rows.slice(0, 8).map((row) => String(row.name || row[idFieldName] || "")),
    };
  }

  const exact = byExactToken.get(normalizedQuery) || null;
  if (exact) {
    return {
      success: true,
      data: cloneValue(exact),
      suggestions: [],
      matchKind: "exact",
    };
  }

  const partialMatches = queryEntries.filter((entry) => (
    entry.tokens.some((token) => token.includes(normalizedQuery))
  ));
  if (partialMatches.length === 1) {
    return {
      success: true,
      data: cloneValue(partialMatches[0].row),
      suggestions: [],
      matchKind: "partial",
    };
  }

  return {
    success: false,
    errorMsg: partialMatches.length > 1 ? "PROFILE_AMBIGUOUS" : "PROFILE_NOT_FOUND",
    suggestions: partialMatches
      .slice(0, 8)
      .map((entry) => `${entry.row.name} (${entry.row[idFieldName]})`),
  };
}

function listNpcProfiles() {
  return readNpcRows(NPC_TABLE.PROFILES);
}

function getNpcProfile(profileID) {
  return findByID(NPC_TABLE.PROFILES, profileID);
}

function resolveNpcProfile(query, fallbackProfileID = "") {
  return resolveByQuery(NPC_TABLE.PROFILES, query, fallbackProfileID);
}

function listNpcLoadouts() {
  return readNpcRows(NPC_TABLE.LOADOUTS);
}

function getNpcLoadout(loadoutID) {
  return findByID(NPC_TABLE.LOADOUTS, loadoutID);
}

function listNpcBehaviorProfiles() {
  return readNpcRows(NPC_TABLE.BEHAVIOR_PROFILES);
}

function getNpcBehaviorProfile(behaviorProfileID) {
  return findByID(NPC_TABLE.BEHAVIOR_PROFILES, behaviorProfileID);
}

function listNpcLootTables() {
  return readNpcRows(NPC_TABLE.LOOT_TABLES);
}

function getNpcLootTable(lootTableID) {
  return findByID(NPC_TABLE.LOOT_TABLES, lootTableID);
}

function listNpcSpawnPools() {
  return readNpcRows(NPC_TABLE.SPAWN_POOLS);
}

function getNpcSpawnPool(spawnPoolID) {
  return findByID(NPC_TABLE.SPAWN_POOLS, spawnPoolID);
}

function resolveNpcSpawnPool(query, fallbackSpawnPoolID = "") {
  return resolveByQuery(NPC_TABLE.SPAWN_POOLS, query, fallbackSpawnPoolID);
}

function listNpcSpawnGroups() {
  return readNpcRows(NPC_TABLE.SPAWN_GROUPS);
}

function getNpcSpawnGroup(spawnGroupID) {
  return findByID(NPC_TABLE.SPAWN_GROUPS, spawnGroupID);
}

function resolveNpcSpawnGroup(query, fallbackSpawnGroupID = "") {
  return resolveByQuery(NPC_TABLE.SPAWN_GROUPS, query, fallbackSpawnGroupID);
}

function listNpcSpawnSites() {
  return readNpcRows(NPC_TABLE.SPAWN_SITES);
}

function getNpcSpawnSite(spawnSiteID) {
  return findByID(NPC_TABLE.SPAWN_SITES, spawnSiteID);
}

function resolveNpcSpawnSite(query, fallbackSpawnSiteID = "") {
  return resolveByQuery(NPC_TABLE.SPAWN_SITES, query, fallbackSpawnSiteID);
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
  return listNpcStartupRules().find(
    (row) => String(row && row.startupRuleID || "").trim() === String(startupRuleID || "").trim(),
  ) || null;
}

function resolveNpcStartupRule(query, fallbackStartupRuleID = "") {
  const rows = listNpcStartupRules();
  const normalizedQuery = normalizeQuery(query || fallbackStartupRuleID);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "PROFILE_REQUIRED",
      suggestions: rows.slice(0, 8).map((row) => String(row.name || row.startupRuleID || "")),
    };
  }

  const exact = rows.find((row) => getSearchableTokens(row, "startupRuleID").includes(normalizedQuery)) || null;
  if (exact) {
    return {
      success: true,
      data: cloneValue(exact),
      suggestions: [],
      matchKind: "exact",
    };
  }

  const partialMatches = rows.filter((row) => (
    getSearchableTokens(row, "startupRuleID")
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
      .map((row) => `${row.name} (${row.startupRuleID})`),
  };
}

function buildNpcDefinition(profileID) {
  const profileRow = findRawByID(NPC_TABLE.PROFILES, profileID);
  if (!profileRow) {
    return null;
  }

  const loadoutRow = findRawByID(NPC_TABLE.LOADOUTS, profileRow.loadoutID);
  const behaviorProfileRow = findRawByID(
    NPC_TABLE.BEHAVIOR_PROFILES,
    profileRow.behaviorProfileID,
  );
  const lootTableRow = findRawByID(NPC_TABLE.LOOT_TABLES, profileRow.lootTableID);
  if (!loadoutRow || !behaviorProfileRow) {
    return null;
  }

  const profile = cloneValue(profileRow);
  const loadout = cloneValue(loadoutRow);
  const behaviorProfile = cloneValue(behaviorProfileRow);
  const lootTable = lootTableRow ? cloneValue(lootTableRow) : null;
  if (!profile) {
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

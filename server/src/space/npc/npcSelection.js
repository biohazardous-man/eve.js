const path = require("path");

const {
  buildNpcDefinition,
  resolveNpcProfile,
  resolveNpcSpawnPool,
  getNpcSpawnPool,
  resolveNpcSpawnGroup,
  getNpcSpawnGroup,
} = require(path.join(__dirname, "./npcData"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function dedupeSuggestions(values, limit = 8) {
  const results = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

function isEntityTypeAllowed(value, expectedEntityType = "") {
  if (!expectedEntityType) {
    return true;
  }

  return String(value || "").trim().toLowerCase() ===
    String(expectedEntityType || "").trim().toLowerCase();
}

function chooseWeightedEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const weightedEntries = entries
    .map((entry) => ({
      ...entry,
      weight: Math.max(1, toPositiveInt(entry && entry.weight, 1)),
    }))
    .filter((entry) => String(entry.profileID || "").trim().length > 0);
  if (weightedEntries.length === 0) {
    return null;
  }

  const totalWeight = weightedEntries.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  let roll = Math.random() * totalWeight;
  for (const entry of weightedEntries) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry;
    }
  }

  return weightedEntries[weightedEntries.length - 1] || null;
}

function resolveEntryCount(entry) {
  const exactCount = toPositiveInt(entry && entry.count, 0);
  if (exactCount > 0) {
    return exactCount;
  }

  const minCount = Math.max(0, toPositiveInt(entry && entry.minCount, 0));
  const maxCount = Math.max(minCount, toPositiveInt(entry && entry.maxCount, minCount));
  if (maxCount <= 0) {
    return 0;
  }

  if (minCount === maxCount) {
    return minCount;
  }

  return minCount + Math.floor(Math.random() * ((maxCount - minCount) + 1));
}

function buildDefinitionsForPool(pool, amount, expectedEntityType = "") {
  const requestedAmount = Math.max(1, toPositiveInt(amount, 1));
  const definitions = [];

  for (let index = 0; index < requestedAmount; index += 1) {
    const chosenEntry = chooseWeightedEntry(pool && pool.entries);
    if (!chosenEntry) {
      return {
        success: false,
        errorMsg: "POOL_EMPTY",
        suggestions: [],
      };
    }

    const definition = buildNpcDefinition(chosenEntry.profileID);
    if (!definition) {
      return {
        success: false,
        errorMsg: "NPC_DEFINITION_INCOMPLETE",
        suggestions: [],
      };
    }
    if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
      return {
        success: false,
        errorMsg: "PROFILE_NOT_FOUND",
        suggestions: [],
      };
    }

    definitions.push(definition);
  }

  return {
    success: true,
    data: {
      selectionKind: "pool",
      selectionID: pool.spawnPoolID,
      selectionName: pool.name || pool.spawnPoolID,
      definitions,
      pool,
    },
    suggestions: [],
  };
}

function buildDefinitionsForProfile(profileResolution, amount, expectedEntityType = "") {
  const definition = buildNpcDefinition(
    profileResolution &&
      profileResolution.data &&
      profileResolution.data.profileID,
  );
  if (!definition) {
    return {
      success: false,
      errorMsg: "NPC_DEFINITION_INCOMPLETE",
      suggestions: [],
    };
  }
  if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
    return {
      success: false,
      errorMsg: "PROFILE_NOT_FOUND",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: {
      selectionKind: "profile",
      selectionID: definition.profile.profileID,
      selectionName: definition.profile.name || definition.profile.profileID,
      definitions: Array.from(
        { length: Math.max(1, toPositiveInt(amount, 1)) },
        () => buildNpcDefinition(definition.profile.profileID),
      ),
      profile: definition.profile,
    },
    suggestions: [],
  };
}

function buildDefinitionsForSpawnGroup(group, options = {}) {
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const definitions = [];
  const composition = [];
  const entries = Array.isArray(group && group.entries) ? group.entries : [];

  for (const entry of entries) {
    const entryCount = resolveEntryCount(entry);
    if (entryCount <= 0) {
      continue;
    }

    if (String(entry && entry.profileID || "").trim()) {
      const definition = buildNpcDefinition(entry.profileID);
      if (!definition) {
        return {
          success: false,
          errorMsg: "NPC_DEFINITION_INCOMPLETE",
          suggestions: [],
        };
      }
      if (!isEntityTypeAllowed(definition.profile.entityType, expectedEntityType)) {
        return {
          success: false,
          errorMsg: "PROFILE_NOT_FOUND",
          suggestions: [],
        };
      }

      for (let index = 0; index < entryCount; index += 1) {
        definitions.push(buildNpcDefinition(definition.profile.profileID));
      }
      composition.push({
        entryKind: "profile",
        selectionID: definition.profile.profileID,
        count: entryCount,
      });
      continue;
    }

    if (String(entry && entry.spawnPoolID || "").trim()) {
      const pool = getNpcSpawnPool(entry.spawnPoolID);
      if (!pool) {
        return {
          success: false,
          errorMsg: "PROFILE_NOT_FOUND",
          suggestions: [],
        };
      }
      const poolResult = buildDefinitionsForPool(pool, entryCount, expectedEntityType);
      if (!poolResult.success || !poolResult.data) {
        return poolResult;
      }

      definitions.push(...poolResult.data.definitions);
      composition.push({
        entryKind: "pool",
        selectionID: pool.spawnPoolID,
        count: poolResult.data.definitions.length,
      });
      continue;
    }

    return {
      success: false,
      errorMsg: "POOL_EMPTY",
      suggestions: [],
    };
  }

  if (definitions.length === 0) {
    return {
      success: false,
      errorMsg: "POOL_EMPTY",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: {
      selectionKind: "group",
      selectionID: group.spawnGroupID,
      selectionName: group.name || group.spawnGroupID,
      definitions,
      composition,
      group,
    },
    suggestions: [],
  };
}

function resolveNpcSpawnGroupPlan(query, options = {}) {
  const trimmedQuery = String(query || "").trim();
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const fallbackSpawnGroupID = String(options.fallbackSpawnGroupID || "").trim();

  if (!trimmedQuery && fallbackSpawnGroupID) {
    const fallbackGroup = getNpcSpawnGroup(fallbackSpawnGroupID);
    if (fallbackGroup) {
      return buildDefinitionsForSpawnGroup(fallbackGroup, {
        entityType: expectedEntityType,
      });
    }
  }

  const groupResolution = resolveNpcSpawnGroup(trimmedQuery, "");
  if (!groupResolution.success || !groupResolution.data) {
    return groupResolution;
  }

  return buildDefinitionsForSpawnGroup(groupResolution.data, {
    entityType: expectedEntityType,
  });
}

function resolveNpcSpawnPlan(query, options = {}) {
  const trimmedQuery = String(query || "").trim();
  const requestedAmount = Math.max(1, toPositiveInt(options.amount, 1));
  const expectedEntityType = String(options.entityType || "").trim().toLowerCase();
  const defaultPoolID = String(options.defaultPoolID || "").trim();
  const fallbackProfileID = String(options.fallbackProfileID || "").trim();

  if (!trimmedQuery) {
    if (defaultPoolID) {
      const defaultPool = getNpcSpawnPool(defaultPoolID);
      if (defaultPool) {
        return buildDefinitionsForPool(defaultPool, requestedAmount, expectedEntityType);
      }
    }
    if (fallbackProfileID) {
      return buildDefinitionsForProfile(
        {
          success: true,
          data: {
            profileID: fallbackProfileID,
          },
        },
        requestedAmount,
        expectedEntityType,
      );
    }
  }

  const profileResolution = resolveNpcProfile(trimmedQuery, "");
  const poolResolution = resolveNpcSpawnPool(trimmedQuery, "");
  const profileSuccess = profileResolution.success && profileResolution.data;
  const poolSuccess = poolResolution.success && poolResolution.data;

  if (profileSuccess && !poolSuccess) {
    return buildDefinitionsForProfile(
      profileResolution,
      requestedAmount,
      expectedEntityType,
    );
  }
  if (poolSuccess && !profileSuccess) {
    return buildDefinitionsForPool(
      poolResolution.data,
      requestedAmount,
      expectedEntityType,
    );
  }
  if (profileSuccess && poolSuccess) {
    if (profileResolution.matchKind === "exact" && poolResolution.matchKind !== "exact") {
      return buildDefinitionsForProfile(
        profileResolution,
        requestedAmount,
        expectedEntityType,
      );
    }
    if (poolResolution.matchKind === "exact" && profileResolution.matchKind !== "exact") {
      return buildDefinitionsForPool(
        poolResolution.data,
        requestedAmount,
        expectedEntityType,
      );
    }
    if (options.preferPools === true) {
      return buildDefinitionsForPool(
        poolResolution.data,
        requestedAmount,
        expectedEntityType,
      );
    }
    return buildDefinitionsForProfile(
      profileResolution,
      requestedAmount,
      expectedEntityType,
    );
  }

  const profileSuggestions = profileResolution.suggestions || [];
  const poolSuggestions = poolResolution.suggestions || [];
  const errorMsg =
    profileResolution.errorMsg === "PROFILE_AMBIGUOUS" ||
    poolResolution.errorMsg === "PROFILE_AMBIGUOUS"
      ? "PROFILE_AMBIGUOUS"
      : "PROFILE_NOT_FOUND";
  return {
    success: false,
    errorMsg,
    suggestions: dedupeSuggestions([
      ...profileSuggestions,
      ...poolSuggestions,
    ]),
  };
}

module.exports = {
  resolveNpcSpawnPlan,
  buildDefinitionsForSpawnGroup,
  resolveNpcSpawnGroupPlan,
};

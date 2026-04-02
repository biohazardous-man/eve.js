const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const database = require(path.join(__dirname, "../../newDatabase"));
const {
  buildDict,
  buildList,
  extractList,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ensureAlliancesInitialized,
  ensureCorporationsInitialized,
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

const MATCH_BY = {
  PARTIAL_TERMS: 0,
  EXACT_TERMS: 1,
  EXACT_PHRASE: 2,
  EXACT_PHRASE_ONLY: 3,
};

const RESULT_TYPE = {
  CHARACTER: 2,
  CORPORATION: 3,
  ALLIANCE: 4,
};

const MAX_RESULT_COUNT = 500;

function extractKwargValue(kwargs, key, fallback = undefined) {
  if (!kwargs) {
    return fallback;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const entry = kwargs.entries.find(([entryKey]) => entryKey === key);
    return entry ? entry[1] : fallback;
  }

  if (typeof kwargs === "object" && Object.prototype.hasOwnProperty.call(kwargs, key)) {
    return kwargs[key];
  }

  return fallback;
}

function normalizeSearchString(value) {
  return normalizeText(value, "").trim().toLowerCase();
}

function collapseSearchString(value) {
  return normalizeSearchString(value).replace(/[^a-z0-9]+/g, "");
}

function tokenizeSearchString(value) {
  return normalizeSearchString(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
}

function matchesSearch(name, search, exactMode = MATCH_BY.PARTIAL_TERMS) {
  const rawTarget = normalizeSearchString(name);
  const collapsedTarget = collapseSearchString(name);
  const rawSearch = normalizeSearchString(search);
  const collapsedSearch = collapseSearchString(search);
  if (!collapsedSearch) {
    return false;
  }

  switch (Number(exactMode) || 0) {
    case MATCH_BY.EXACT_TERMS:
    case MATCH_BY.EXACT_PHRASE:
    case MATCH_BY.EXACT_PHRASE_ONLY:
      return rawTarget === rawSearch || collapsedTarget === collapsedSearch;
    case MATCH_BY.PARTIAL_TERMS:
    default: {
      const terms = tokenizeSearchString(search);
      if (!terms.length) {
        return collapsedTarget.includes(collapsedSearch);
      }
      return terms.every((term) => collapsedTarget.includes(term));
    }
  }
}

function collectSearchableOwners(groupID) {
  switch (Number(groupID) || 0) {
    case RESULT_TYPE.CHARACTER: {
      const tableResult = database.read("characters", "/");
      const characters =
        tableResult && tableResult.success && tableResult.data && typeof tableResult.data === "object"
          ? tableResult.data
          : {};
      return Object.keys(characters)
        .map((characterID) => getCharacterRecord(characterID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.characterID || 0) || 0,
          name: record.characterName || `Character ${record.characterID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    case RESULT_TYPE.CORPORATION: {
      const corporations = ensureCorporationsInitialized();
      return Object.keys((corporations && corporations.records) || {})
        .map((corporationID) => getCorporationRecord(corporationID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.corporationID || 0) || 0,
          name: record.corporationName || `Corporation ${record.corporationID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    case RESULT_TYPE.ALLIANCE: {
      const alliances = ensureAlliancesInitialized();
      return Object.keys((alliances && alliances.records) || {})
        .map((allianceID) => getAllianceRecord(allianceID))
        .filter(Boolean)
        .map((record) => ({
          id: Number(record.allianceID || 0) || 0,
          name: record.allianceName || `Alliance ${record.allianceID}`,
        }))
        .filter((entry) => entry.id > 0 && entry.name);
    }
    default:
      return [];
  }
}

function searchGroup(groupID, search, exactMode) {
  return collectSearchableOwners(groupID)
    .filter((entry) => matchesSearch(entry.name, search, exactMode))
    .map((entry) => entry.id)
    .slice(0, MAX_RESULT_COUNT);
}

class SearchService extends BaseService {
  constructor() {
    super("search");
  }

  Handle_Query(args, session, kwargs) {
    const search = normalizeText(args && args[0], "");
    const groupIDs = extractList(args && args[1])
      .map((groupID) => Number(groupID))
      .filter((groupID) => Number.isFinite(groupID));
    const exactMode = Number(extractKwargValue(kwargs, "exact", 0)) || 0;

    return buildDict(
      groupIDs.map((groupID) => [groupID, buildList(searchGroup(groupID, search, exactMode))]),
    );
  }

  Handle_QuickQuery(args, session, kwargs) {
    const search = normalizeText(args && args[0], "");
    const groupIDs = extractList(args && args[1])
      .map((groupID) => Number(groupID))
      .filter((groupID) => Number.isFinite(groupID));
    const exactMode = Number(extractKwargValue(kwargs, "exact", 0)) || 0;
    const matches = [];
    const seen = new Set();

    for (const groupID of groupIDs) {
      for (const ownerID of searchGroup(groupID, search, exactMode)) {
        const numericOwnerID = Number(ownerID) || 0;
        if (numericOwnerID > 0 && !seen.has(numericOwnerID)) {
          seen.add(numericOwnerID);
          matches.push(numericOwnerID);
        }
      }
    }

    return buildList(matches);
  }
}

module.exports = SearchService;

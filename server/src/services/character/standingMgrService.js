const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { getCharacterRecord } = require("./characterState");

// Standings use real Rowsets so the client can call both .Index() and .Filter().
// Only valid owner IDs may be present here: cfg.eveowners.Get(None) crashes the
// standings UI while building corp/faction groups.
function buildRelationshipStandingsRowset(rows = []) {
  const rowDescriptor = {
    type: "list",
    items: ["fromID", "toID", "standing"],
  };

  const rowMap = new Map();
  for (const entry of rows) {
    const normalizedEntry = normalizeStandingEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    rowMap.set(`${normalizedEntry.fromID}::${normalizedEntry.toID}`, {
      type: "list",
      items: [
        normalizedEntry.fromID,
        normalizedEntry.toID,
        normalizedEntry.standing,
      ],
    });
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...rowMap.values()] }],
      ],
    },
  };
}

function buildFromStandingRowset(rows = [], targetID) {
  const normalizedTargetID = normalizeStandingID(targetID);
  const rowDescriptor = {
    type: "list",
    items: ["fromID", "standing"],
  };

  const rowMap = new Map();
  for (const entry of rows) {
    const normalizedEntry = normalizeStandingEntry(entry);
    if (!normalizedEntry || normalizedEntry.toID !== normalizedTargetID) {
      continue;
    }

    rowMap.set(String(normalizedEntry.fromID), {
      type: "list",
      items: [
        normalizedEntry.fromID,
        normalizedEntry.standing,
      ],
    });
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...rowMap.values()] }],
      ],
    },
  };
}

function normalizeStandingID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeStandingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const fromID = normalizeStandingID(entry.fromID);
  const toID = normalizeStandingID(entry.toID);
  if (!fromID || !toID || fromID === toID) {
    return null;
  }

  const standing = Number(entry.standing);
  return {
    fromID,
    toID,
    standing: Number.isFinite(standing) ? standing : 0.0,
  };
}

function filterStandingsForTarget(rows = [], targetID) {
  const normalizedTargetID = normalizeStandingID(targetID);
  if (!normalizedTargetID) {
    return [];
  }

  return rows
    .map((entry) => normalizeStandingEntry(entry))
    .filter(
      (entry) =>
        entry !== null && entry.toID === normalizedTargetID,
    );
}

function filterNpcStandings(rows = []) {
  return rows
    .map((entry) => normalizeStandingEntry(entry))
    .filter(Boolean);
}

function getStandingData(session, key) {
  const charId = session ? session.characterID : 0;
  const charData = getCharacterRecord(charId) || {};
  const source =
    charData.standingData && typeof charData.standingData === "object"
      ? charData.standingData
      : {};
  return Array.isArray(source[key]) ? source[key] : [];
}

class StandingMgrService extends BaseService {
  constructor(name = "standingMgr") {
    super(name);
  }

  Handle_GetNPCNPCStandings(args, session) {
    log.debug("[StandingMgr] GetNPCNPCStandings called");
    return buildRelationshipStandingsRowset(
      filterNpcStandings(getStandingData(session, "npc")),
    );
  }

  Handle_GetCharStandings(args, session) {
    log.debug("[StandingMgr] GetCharStandings called");
    return buildFromStandingRowset(
      getStandingData(session, "char"),
      session && (session.characterID || session.charid),
    );
  }

  Handle_GetCorpStandings(args, session) {
    log.debug("[StandingMgr] GetCorpStandings called");
    return buildFromStandingRowset(
      getStandingData(session, "corp"),
      session && (session.corporationID || session.corpid),
    );
  }
}

class Standing2Service extends StandingMgrService {
  constructor() {
    super("standing2");
  }
}

module.exports = {
  StandingMgrService,
  Standing2Service,
};

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(__dirname, "./characterState"));
const {
  buildDict,
  buildFiletimeLong,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function resolveSessionCharacterID(session) {
  return Number(
    session &&
      (session.characterID || session.charID || session.charid || session.userid),
  ) || 0;
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function normalizeExpertSystems(charData = {}) {
  const sourceCandidates = [
    charData.expertSystems,
    charData.expertSystemData,
    charData.myExpertSystems,
  ];

  const source = sourceCandidates.find(
    (candidate) => candidate && typeof candidate === "object",
  );

  if (!source) {
    return [];
  }

  const entries = [];

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const typeID = normalizePositiveInteger(
        entry.typeID ?? entry.expertSystemTypeID ?? entry.id,
      );
      if (!typeID) {
        continue;
      }

      entries.push([
        typeID,
        {
          installedAt: entry.installedAt ?? entry.installed ?? entry.startTime ?? 0,
          expiresAt: entry.expiresAt ?? entry.expires ?? entry.endTime ?? 0,
        },
      ]);
    }
  } else {
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const typeID = normalizePositiveInteger(rawKey);
      if (!typeID) {
        continue;
      }

      if (Array.isArray(rawValue)) {
        entries.push([
          typeID,
          {
            installedAt: rawValue[0] ?? 0,
            expiresAt: rawValue[1] ?? 0,
          },
        ]);
        continue;
      }

      if (rawValue && typeof rawValue === "object") {
        entries.push([
          typeID,
          {
            installedAt:
              rawValue.installedAt ??
              rawValue.installed ??
              rawValue.startTime ??
              0,
            expiresAt:
              rawValue.expiresAt ?? rawValue.expires ?? rawValue.endTime ?? 0,
          },
        ]);
      }
    }
  }

  return entries.sort((left, right) => left[0] - right[0]);
}

class ExpertSystemMgrService extends BaseService {
  constructor() {
    super("expertSystemMgr");
  }

  Handle_GetMyExpertSystems(args, session) {
    const characterID = resolveSessionCharacterID(session);
    const charData = characterID ? getCharacterRecord(characterID) || {} : {};
    const expertSystems = normalizeExpertSystems(charData);

    log.debug(
      `[ExpertSystemMgr] GetMyExpertSystems(charID=${characterID}) -> ${expertSystems.length}`,
    );

    return buildDict(
      expertSystems.map(([typeID, timing]) => [
        typeID,
        {
          type: "list",
          items: [
            buildFiletimeLong(timing.installedAt),
            buildFiletimeLong(timing.expiresAt),
          ],
        },
      ]),
    );
  }

  Handle_ConsumeExpertSystem() {
    log.debug("[ExpertSystemMgr] ConsumeExpertSystem called");
    return null;
  }

  Handle_RemoveMyExpertSystem() {
    log.debug("[ExpertSystemMgr] RemoveMyExpertSystem called");
    return null;
  }
}

module.exports = ExpertSystemMgrService;

const {
  spawnShipInHangarForSession,
  giveItemToHangarForSession,
  getActiveShipRecord,
  applyCharacterToSession,
  activateShipForSession,
  syncInventoryItemForSession,
} = require("../character/characterState");
const sessionRegistry = require("./sessionRegistry");
const {
  getAllItems,
  getCharacterHangarShipItems,
  ITEM_FLAGS,
  listContainerItems,
  createSpaceItemForCharacter,
  grantItemsToCharacterStationHangar,
  moveItemTypeFromCharacterLocation,
  normalizeShipConditionState,
  updateShipItem,
} = require("../inventory/itemStore");
const {
  resolveDebrisType,
  listAvailableDebrisTypes,
  spawnDebrisFieldForSession,
  clearNearbyDebrisForSession,
  clearSystemDebrisForSession,
  getSpaceDebrisLifetimeMs,
} = require("../inventory/spaceDebrisState");
const {
  getCharacterWallet,
  setCharacterBalance,
  adjustCharacterBalance,
  emitPlexBalanceChangeToSession,
  setCharacterPlexBalance,
  adjustCharacterPlexBalance,
} = require("../account/walletState");
const {
  getUnpublishedShipTypes,
  resolveShipByName,
  resolveShipByTypeID,
} = require("./shipTypeRegistry");
const {
  resolveItemByName,
  resolveItemByTypeID,
} = require("../inventory/itemTypeRegistry");
const {
  resolveRuntimeWreckRadius,
} = require("../inventory/wreckRadius");
const { resolveSolarSystemByName } = require("./solarSystemRegistry");
const {
  buildShipResourceState,
  getTypeAttributeValue,
  isChargeCompatibleWithModule,
  listFittedItems,
  selectAutoFitFlagForType,
  typeHasEffectName,
  validateFitForShip,
} = require("../fitting/liveFittingState");
const {
  ensureCharacterPublishedSkills,
  ensureCharacterUnpublishedSkills,
  getPublishedSkillTypes,
  getUnpublishedSkillTypes,
} = require("../skills/skillState");
const {
  createCustomAllianceForCorporation,
  createCustomCorporation,
  joinCorporationToAllianceByName,
  getCorporationRecord,
} = require("../corporation/corporationState");
const {
  jumpSessionToSolarSystem,
  jumpSessionToStation,
} = require("../../space/transitions");
const {
  destroySessionShip,
  spawnShipDeathTestField,
} = require("../../space/shipDestruction");
const worldData = require("../../space/worldData");
const spaceRuntime = require("../../space/runtime");
const {
  TIDI_ADVANCE_NOTICE_MS,
  scheduleAdvanceNoticeTimeDilationForSystems,
} = require("../../utils/synchronizedTimeDilation");
const database = require("../../newDatabase");
const {
  buildEffectListText,
  playPlayableEffect,
  stopAllPlayableEffects,
} = require("./specialFxRegistry");
const npcService = require("../../space/npc");
const crimewatchState = require("../security/crimewatchState");
const {
  TABLE,
  readStaticRows,
} = require("../_shared/referenceData");
const {
  CHAT_ROLE_PROFILES,
  DEFAULT_CHAT_COLOR,
  DEFAULT_CHAT_ROLE,
  MAX_ACCOUNT_ROLE,
  buildPersistedAccountRoleRecord,
  getChatRoleProfile,
  normalizeRoleValue,
  roleToString,
} = require("../account/accountRoleProfiles");

const DEFAULT_MOTD_MESSAGE = [
  "Welcome to EvEJS.",
  "This emulator build is still work in progress.",
  "Warping, tidi, basic modules & space implemented! Expect things to break.",
  "Use /help to see the current command list.",
].join(" ");
const DEER_HUNTER_MESSAGE =
  "Thank you, Deer_Hunter on Discord, for helping make EvEJS possible with your contribution to rising AI development costs.";
const DEER_HUNTER_EFFECT_NAME = "microjump";
const AVAILABLE_SLASH_COMMANDS = [
  "addisk",
  "announce",
  "addplex",
  "allskills",
  "corpcreate",
  "blue",
  "commandlist",
  "commands",
  "deer_hunter",
  "giveme",
  "hangar",
  "heal",
  "help",
  "item",
  "iteminfo",
  "laser",
  "lesmis",
  "dock",
  "effect",
  "fire",
  "fire2",
  "giveitem",
  "gmweapons",
  "gmships",
  "gmskills",
  "container",
  "jetcan",
  "motd",
  "npc",
  "npcclear",
  "joinalliance",
  "loadallsys",
  "loadsys",
  "solar",
  "tr",
  "prop",
  "spawncontainer",
  "spawnwreck",
  "session",
  "setalliance",
  "setplex",
  "setisk",
  "ship",
  "suicide",
  "sysjunkclear",
  "testclear",
  "teal",
  "tidi",
  "deathtest",
  "typeinfo",
  "wallet",
  "where",
  "who",
  "wreck",
  "concord",
  "cwatch",
  "naughty",
  "gateconcord",
  "gaterats",
  "invu",
  "secstatus",
  "yellow",
  "red",
];
const COMMANDS_HELP_TEXT = [
  "Commands:",
  "/help",
  "/motd",
  "/allskills",
  "/npc [amount] [profile|pool]",
  "/npcclear <system [npc|concord|all]|radius <meters> [npc|concord|all]>",
  "/dock",
  "/heal",
  "/deer_hunter",
  "/effect <name>",
  "/fire [ship name|typeID]",
  "/fire2 [count]",
  "/giveitem <item name|typeID> [amount]",
  "/laser",
  "/lesmis",
  "/gmweapons",
  "/container [container type] [count]",
  "/jetcan <item name|typeID> [amount]",
  "/gmships",
  "/gmskills",
  "/where",
  "/who",
  "/concord [amount] [profile|pool]",
  "/cwatch [status|clear|safety <full|partial|none>|weapon <off|seconds>|pvp <off|seconds>|npc <off|seconds>|criminal <off|seconds>|suspect <off|seconds>|disapproval <off|seconds>]",
  "/naughty",
  "/secstatus [status]",
  "/gateconcord [on|off]",
  "/gaterats [on|off]",
  "/invu [on|off]",
  "/wallet",
  "/corpcreate <corporation name>",
  "/setalliance <alliance name>",
  "/joinalliance <alliance name>",
  "/loadallsys",
  "/loadsys",
  "/tidi [0.1-1.0]",
  "/prop",
  "/solar <system name>",
  "/tr <me|characterID|entityID> <destination|pos=x,y,z|offset=x,y,z>",
  "/suicide",
  "/sysjunkclear",
  "/wreck [wreck type] [count]",
  "/deathtest [ship name|typeID] [count]",
  "/testclear",
  "/addisk <amount>",
  "/addplex <amount>",
  "/blue",
  "/setisk <amount>",
  "/setplex <amount>",
  "/red",
  "/ship <ship name|typeID>",
  "/giveme <ship name|typeID>",
  "/hangar",
  "/item <item name|typeID> [amount]",
  "/iteminfo <itemID>",
  "/typeinfo <ship name|typeID>",
  "/session",
  "/announce <message>",
  "/teal",
  "/yellow",
].join("\n");
const DEFAULT_SPACE_CONTAINER_NAME = "Cargo Container";
const DEFAULT_SPACE_WRECK_NAME = "Wreck";
const DEFAULT_FIRE_TARGET_NAME = "Drake";
const LASER_COMMAND_SHIP_NAME = "Apocalypse Navy Issue";
const LASER_COMMAND_MWD_NAME = "500MN Microwarpdrive II";
const LASER_COMMAND_MIN_CRYSTALS_PER_TYPE = 5;
const LESMIS_COMMAND_SHIP_NAME = "Typhoon Fleet Issue";
const LESMIS_COMMAND_LAUNCHER_NAME = "Heavy Missile Launcher II";
const LESMIS_COMMAND_TURRET_NAME = "Mega Pulse Laser II";
const LESMIS_COMMAND_LAUNCHER_COUNT = 4;
const LESMIS_COMMAND_TURRET_COUNT = 4;
const LESMIS_COMMAND_MISSILES_PER_TYPE = 1000;
const DEFAULT_FIRE2_FLEET_SIZE = 10;
const MAX_NPC_COMMAND_SPAWN_COUNT = 25;
const DEFAULT_FIRE2_FLEET_SHIP_NAMES = Object.freeze([
  "Avatar",
  "Revelation",
  "Rorqual",
  "Orca",
  "Abaddon",
  "Harbinger",
  "Maller",
  "Coercer",
  "Punisher",
  "Executioner",
]);
const FIRE2_BASE_DISTANCE_METERS = 32_000;
const FIRE2_ROW_SPACING_METERS = 11_000;
const FIRE2_LATERAL_SPACING_METERS = 8_000;
const FIRE2_OVERLAP_PADDING_METERS = 1_500;
// CCP parity: Jettisoned cargo containers persist for exactly 2 hours from
// creation regardless of contents.  They do NOT despawn when emptied -- the
// timer is purely time-based.  (Source: EVE University wiki, community-
// verified against live Tranquility behaviour.)
const JETCAN_LIFETIME_MS = 2 * 60 * 60 * 1000; // 2 hours
const PROPULSION_MODULE_GROUP_ID = 46;
const PROPULSION_MODULE_CATEGORY_ID = 7;
const PROPULSION_FACTION_PREFIXES = Object.freeze([
  "Domination",
  "Federation Navy",
  "Republic Fleet",
  "Shadow Serpentis",
  "True Sansha",
  "Thukker Modified",
]);
const PROPULSION_OFFICER_PREFIXES = Object.freeze([
  "Asine's",
  "Brynn's",
  "Cormack's",
  "Gara's",
  "Gotan's",
  "Hakim's",
  "Mizuro's",
  "Nija's",
  "Ramaku's",
  "Setele's",
  "Sila's",
  "Tobias'",
  "Tuvan's",
  "Usaras'",
]);

let cachedPropulsionCommandTypes = null;
let cachedLaserTurretCommandTypes = null;
let cachedLesmisHeavyMissileTypes = null;
let cachedGmWeaponsSeedPlan = null;
const activeGmWeaponsJobs = new Map();

const GM_WEAPONS_BATCH_SIZE = 96;
const GM_WEAPONS_MODULE_QUANTITY = 100;
const GM_WEAPONS_AMMO_QUANTITY = 5000;

function normalizeCommandName(value) {
  return String(value || "").trim().toLowerCase();
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) {
    previous[index] = index;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function suggestCommands(query) {
  const normalizedQuery = normalizeCommandName(query);
  if (!normalizedQuery) {
    return [];
  }

  return [...AVAILABLE_SLASH_COMMANDS]
    .map((commandName) => {
      let score = levenshteinDistance(normalizedQuery, commandName);
      if (commandName.startsWith(normalizedQuery)) {
        score = Math.min(score, 0);
      } else if (commandName.includes(normalizedQuery)) {
        score = Math.min(score, 1);
      }
      return { commandName, score };
    })
    .filter((entry) => entry.score <= Math.max(2, Math.ceil(entry.commandName.length * 0.35)))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.commandName.localeCompare(right.commandName);
    })
    .slice(0, 5)
    .map((entry) => `/${entry.commandName}`);
}

function formatDistanceMeters(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0 m";
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(numeric).toLocaleString("en-US")} m`;
}

function formatIsk(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ISK`;
}

function formatPlex(value) {
  return `${Math.max(0, Math.trunc(Number(value || 0))).toLocaleString("en-US")} PLEX`;
}

function formatSignedPlex(value) {
  const numeric = Math.trunc(Number(value || 0));
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toLocaleString("en-US")} PLEX`;
}

function parseAmount(value) {
  const text = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/_/g, "");
  if (!text) {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(text);
  if (!match) {
    return null;
  }

  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  };
  const suffix = String(match[2] || "").toLowerCase();
  return baseValue * (multiplier[suffix] || 1);
}

function formatSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return "";
  }

  return ` Suggestions: ${suggestions.join(", ")}`;
}

function getFeedbackChannel(options) {
  if (!options || typeof options !== "object") {
    return null;
  }

  const candidate =
    options.feedbackChannel || options.channelID || options.channelName || null;
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed || null;
}

function isLocalFeedbackChannel(channelName) {
  if (!channelName) {
    return false;
  }

  return /^local_\d+(?:@conference\.localhost)?$/i.test(
    String(channelName).trim(),
  );
}

function getPostLocalMoveFeedbackOptions(options) {
  const feedbackChannel = getFeedbackChannel(options);
  if (!isLocalFeedbackChannel(feedbackChannel)) {
    return options;
  }

  return {
    ...options,
    feedbackChannel: null,
  };
}

function emitChatFeedback(chatHub, session, options, message) {
  if (!message) {
    return;
  }

  if (
    chatHub &&
    session &&
    (!options || options.emitChatFeedback !== false)
  ) {
    chatHub.sendSystemMessage(session, message, getFeedbackChannel(options));
  }
}

function handledResult(chatHub, session, options, message) {
  emitChatFeedback(chatHub, session, options, message);
  return {
    handled: true,
    message,
  };
}

function handledResultWithExtras(chatHub, session, options, message, extras = {}) {
  const result = handledResult(chatHub, session, options, message);
  return {
    ...result,
    ...extras,
  };
}

function splitTrailingAmount(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      lookupText: "",
      amount: null,
    };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return {
      lookupText: trimmed,
      amount: null,
    };
  }

  const trailingAmount = parseAmount(parts[parts.length - 1]);
  if (trailingAmount === null) {
    return {
      lookupText: trimmed,
      amount: null,
    };
  }

  return {
    lookupText: parts.slice(0, -1).join(" ").trim(),
    amount: trailingAmount,
  };
}

function flushPendingLocalChannelSync(chatHub, session) {
  if (
    !chatHub ||
    !session ||
    typeof chatHub.moveLocalSession !== "function"
  ) {
    return;
  }

  const pending = session._pendingLocalChannelSync || null;
  if (!pending) {
    return;
  }

  session._pendingLocalChannelSync = null;
  chatHub.moveLocalSession(session, pending.previousChannelID);
}

function normalizePositiveInteger(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseNpcSpawnArguments(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: true,
      amount: 1,
      query: "",
    };
  }

  const parts = trimmed.split(/\s+/);
  let amount = 1;
  let amountIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const parsed = parseAmount(parts[index]);
    if (parsed === null) {
      continue;
    }
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_AMOUNT",
      };
    }
    amount = parsed;
    amountIndex = index;
    break;
  }

  const query = amountIndex >= 0
    ? parts.filter((_, index) => index !== amountIndex).join(" ").trim()
    : trimmed;
  return {
    success: true,
    amount,
    query,
  };
}

function readAccountsTable() {
  const result = database.read("accounts", "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeAccountsTable(accounts) {
  return database.write("accounts", "/", accounts);
}

function getAccountRecordForSession(session) {
  if (!session) {
    return null;
  }

  const accounts = readAccountsTable();
  const userName = String(session.userName || "").trim();
  if (userName && accounts[userName]) {
    return {
      accounts,
      username: userName,
      account: accounts[userName],
    };
  }

  const matchedEntry = Object.entries(accounts).find(
    ([, account]) => Number(account && account.id) === Number(session.userid || 0),
  );
  if (!matchedEntry) {
    return null;
  }

  return {
    accounts,
    username: matchedEntry[0],
    account: matchedEntry[1],
  };
}

function persistSessionChatRole(session, roleValue) {
  const accountEntry = getAccountRecordForSession(session);
  if (!accountEntry) {
    return {
      success: false,
      errorMsg: "ACCOUNT_NOT_FOUND",
    };
  }

  const nextAccounts = { ...accountEntry.accounts };
  const normalizedAccount = buildPersistedAccountRoleRecord({
    ...accountEntry.account,
    role: roleToString(MAX_ACCOUNT_ROLE),
    chatRole: roleToString(roleValue),
  });
  nextAccounts[accountEntry.username] = normalizedAccount;
  const writeResult = writeAccountsTable(nextAccounts);
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "ACCOUNT_WRITE_FAILED",
    };
  }
  if (typeof database.flushAllSync === "function") {
    database.flushAllSync();
  }

  return {
    success: true,
    data: normalizedAccount,
  };
}

function getChatColorLabel(roleValue) {
  const normalizedRole = normalizeRoleValue(roleValue, DEFAULT_CHAT_ROLE);
  const match = Object.entries(CHAT_ROLE_PROFILES).find(
    ([, profileRole]) => normalizeRoleValue(profileRole, 0n) === normalizedRole,
  );
  return match ? match[0] : DEFAULT_CHAT_COLOR;
}

function updateSessionRole(session, nextRole) {
  if (!session) {
    return false;
  }

  const normalizedNextRole = normalizeRoleValue(nextRole, DEFAULT_CHAT_ROLE);
  const previousRole = normalizeRoleValue(session.role, DEFAULT_CHAT_ROLE);
  if (previousRole === normalizedNextRole) {
    return false;
  }

  session.chatRole = roleToString(normalizedNextRole);
  session.role = roleToString(normalizedNextRole);

  if (typeof session.sendSessionChange === "function") {
    session.sendSessionChange({
      role: [previousRole, normalizedNextRole],
    });
  }

  return true;
}

function handleChatColorCommand(session, colorName, chatHub, options) {
  const nextRole = getChatRoleProfile(colorName);
  if (!nextRole) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unknown chat color: ${colorName}. Use /blue, /red, /teal, or /yellow.`,
    );
  }

  const persisted = persistSessionChatRole(session, nextRole);
  if (!persisted.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Chat color change failed: account record could not be updated.",
    );
  }

  updateSessionRole(session, nextRole);
  return handledResultWithExtras(
    chatHub,
    session,
    options,
    `Chat color set to ${getChatColorLabel(nextRole)}.`,
    {
      refreshChatRolePresence: true,
    },
  );
}

function handleDeerHunterCommand(session, chatHub, options) {
  const effectResult = playPlayableEffect(session, DEER_HUNTER_EFFECT_NAME);
  const message = effectResult.success
    ? `${DEER_HUNTER_MESSAGE} Your ship celebrates with a brief micro-jump flash.`
    : DEER_HUNTER_MESSAGE;
  return handledResult(chatHub, session, options, message);
}

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function syncSpaceRootInventoryChangesToSession(session, changes = []) {
  const numericSystemID = normalizePositiveInteger(
    session &&
      session._space &&
      session._space.systemID,
  );
  if (!numericSystemID) {
    return;
  }

  const filteredChanges = (Array.isArray(changes) ? changes : []).filter((change) => {
    const item = change && change.item;
    const previousData = change && (change.previousData || change.previousState);
    const nextLocationID = normalizePositiveInteger(item && item.locationID);
    const previousLocationID = normalizePositiveInteger(previousData && previousData.locationID);
    return (
      (nextLocationID === numericSystemID && Number(item && item.flagID) === 0) ||
      (previousLocationID === numericSystemID && Number(previousData && previousData.flagID) === 0)
    );
  });

  syncInventoryChangesToSession(session, filteredChanges);
}

function isSpaceSessionReady(session) {
  return Boolean(
    session &&
    session.characterID &&
    session._space &&
    !session.stationid &&
    !session.stationID,
  );
}

function resolveSessionSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function resolveSessionShipEntity(session) {
  if (!session || !session._space || !session._space.shipID) {
    return null;
  }

  return spaceRuntime.getEntity(session, session._space.shipID) || null;
}

function healDockedShipForSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.itemID) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updateResult = updateShipItem(activeShip.itemID, (currentShip) => ({
    ...currentShip,
    conditionState: normalizeShipConditionState({
      ...(currentShip.conditionState || {}),
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
    }),
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  syncInventoryItemForSession(
    session,
    updateResult.data,
    updateResult.previousData || {},
    { emitCfgLocation: true },
  );

  return updateResult;
}

function parseToggleCommandArgument(argumentText) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: true,
      mode: "status",
    };
  }

  if (["on", "enable", "enabled", "true", "1"].includes(normalized)) {
    return {
      success: true,
      mode: "on",
    };
  }
  if (["off", "disable", "disabled", "false", "0"].includes(normalized)) {
    return {
      success: true,
      mode: "off",
    };
  }
  if (["status", "state"].includes(normalized)) {
    return {
      success: true,
      mode: "status",
    };
  }

  return {
    success: false,
    errorMsg: "INVALID_TOGGLE",
  };
}

function getCrimewatchReferenceMsForSession(session) {
  if (
    session &&
    session._space &&
    Number.isFinite(Number(session._space.simTimeMs))
  ) {
    return Number(session._space.simTimeMs);
  }

  return spaceRuntime.getSimulationTimeMsForSession(session, Date.now());
}

function formatDurationBriefMs(durationMs) {
  const remainingMs = Math.max(0, Math.trunc(Number(durationMs) || 0));
  if (remainingMs <= 0) {
    return "0s";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (leftoverMinutes > 0) {
    return `${hours}h ${leftoverMinutes}m`;
  }
  return `${hours}h`;
}

function formatCrimewatchSafetyLabel(safetyLevel) {
  switch (Number(safetyLevel)) {
    case crimewatchState.SAFETY_LEVEL_NONE:
      return "NONE";
    case crimewatchState.SAFETY_LEVEL_PARTIAL:
      return "PARTIAL";
    case crimewatchState.SAFETY_LEVEL_FULL:
    default:
      return "FULL";
  }
}

function parseCrimewatchDurationArgument(argumentText, defaultMs) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (["on", "enable", "enabled", "true"].includes(normalized)) {
    return {
      success: true,
      durationMs: Math.max(0, Math.trunc(Number(defaultMs) || 0)),
    };
  }

  if (["off", "disable", "disabled", "false", "clear", "0"].includes(normalized)) {
    return {
      success: true,
      durationMs: 0,
    };
  }

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(normalized);
  if (!match) {
    return {
      success: false,
      errorMsg: "INVALID_DURATION",
    };
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      success: false,
      errorMsg: "INVALID_DURATION",
    };
  }

  const unit = String(match[2] || "s").toLowerCase();
  const multiplier = unit === "ms"
    ? 1
    : unit === "m"
      ? 60_000
      : unit === "h"
        ? 3_600_000
        : 1_000;
  return {
    success: true,
    durationMs: Math.max(0, Math.trunc(amount * multiplier)),
  };
}

function parseCrimewatchSafetyArgument(argumentText) {
  const normalized = String(argumentText || "").trim().toLowerCase();
  if (!normalized) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (["full", "green", "2"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_FULL,
    };
  }
  if (["partial", "yellow", "1"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_PARTIAL,
    };
  }
  if (["none", "red", "0"].includes(normalized)) {
    return {
      success: true,
      safetyLevel: crimewatchState.SAFETY_LEVEL_NONE,
    };
  }

  return {
    success: false,
    errorMsg: "INVALID_SAFETY_LEVEL",
  };
}

function normalizeNpcEntityTypeFilter(value, fallback = "all") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["all", "any", "*"].includes(normalized)) {
    return "all";
  }
  if (["npc", "npcs", "rat", "rats"].includes(normalized)) {
    return "npc";
  }
  if (normalized === "concord") {
    return "concord";
  }
  return null;
}

function parseNpcClearArguments(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  const parts = trimmed.split(/\s+/);
  const scope = String(parts[0] || "").trim().toLowerCase();
  if (scope === "system") {
    return {
      success: true,
      scope: "system",
      radiusMeters: 0,
      entityType: normalizeNpcEntityTypeFilter(parts[1], "all"),
    };
  }

  if (scope === "radius") {
    const radiusMeters = parseAmount(parts[1]);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      return {
        success: false,
        errorMsg: "INVALID_RADIUS",
      };
    }

    return {
      success: true,
      scope: "radius",
      radiusMeters,
      entityType: normalizeNpcEntityTypeFilter(parts[2], "all"),
    };
  }

  return {
    success: false,
    errorMsg: "USAGE",
  };
}

function normalizeSpaceVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = {
    x: Number.isFinite(Number(vector && vector.x)) ? Number(vector.x) : fallback.x,
    y: Number.isFinite(Number(vector && vector.y)) ? Number(vector.y) : fallback.y,
    z: Number.isFinite(Number(vector && vector.z)) ? Number(vector.z) : fallback.z,
  };
  const length = Math.sqrt(
    (resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function addVectors(left, right) {
  return {
    x: Number(left && left.x || 0) + Number(right && right.x || 0),
    y: Number(left && left.y || 0) + Number(right && right.y || 0),
    z: Number(left && left.z || 0) + Number(right && right.z || 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: Number(left && left.x || 0) - Number(right && right.x || 0),
    y: Number(left && left.y || 0) - Number(right && right.y || 0),
    z: Number(left && left.z || 0) - Number(right && right.z || 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: Number(vector && vector.x || 0) * scalar,
    y: Number(vector && vector.y || 0) * scalar,
    z: Number(vector && vector.z || 0) * scalar,
  };
}

function crossVectors(left, right) {
  return {
    x: (Number(left && left.y || 0) * Number(right && right.z || 0))
      - (Number(left && left.z || 0) * Number(right && right.y || 0)),
    y: (Number(left && left.z || 0) * Number(right && right.x || 0))
      - (Number(left && left.x || 0) * Number(right && right.z || 0)),
    z: (Number(left && left.x || 0) * Number(right && right.y || 0))
      - (Number(left && left.y || 0) * Number(right && right.x || 0)),
  };
}

function cloneSpaceVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: Number.isFinite(Number(vector && vector.x)) ? Number(vector.x) : fallback.x,
    y: Number.isFinite(Number(vector && vector.y)) ? Number(vector.y) : fallback.y,
    z: Number.isFinite(Number(vector && vector.z)) ? Number(vector.z) : fallback.z,
  };
}

function parseTransportVectorTag(token, prefix) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return null;
  }

  const normalizedPrefix = `${String(prefix || "").toLowerCase()}=`;
  if (!trimmed.toLowerCase().startsWith(normalizedPrefix)) {
    return null;
  }

  const parts = trimmed.slice(normalizedPrefix.length).split(",");
  if (parts.length !== 3) {
    return null;
  }

  const values = parts.map((value) => Number(String(value || "").trim()));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    z: values[2],
  };
}

function parseTransportCoordinateTriplet(tokens) {
  if (!Array.isArray(tokens) || tokens.length !== 3) {
    return null;
  }

  const values = tokens.map((value) => Number(String(value || "").trim()));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    z: values[2],
  };
}

function getSessionDockedStationID(session) {
  return normalizePositiveInteger(
    session &&
      (
        session.stationID ||
        session.stationid ||
        0
      ),
  );
}

function getSessionCurrentSolarSystemID(session) {
  const dockedStationID = getSessionDockedStationID(session);
  if (dockedStationID) {
    const station = worldData.getStationByID(dockedStationID);
    return normalizePositiveInteger(station && station.solarSystemID);
  }

  return normalizePositiveInteger(
    session &&
      (
        session.solarsystemid2 ||
        session.solarsystemid ||
        (session._space && session._space.systemID) ||
        0
      ),
  );
}

function getSessionTransportEntity(session) {
  if (!session || !session._space) {
    return null;
  }

  return spaceRuntime.getEntity(
    session,
    session._space && session._space.shipID,
  );
}

function buildTransportPointAnchor(entity, fallbackSystemID = null) {
  if (!entity) {
    return null;
  }

  const systemID =
    normalizePositiveInteger(entity.systemID || entity.solarSystemID) ||
    normalizePositiveInteger(fallbackSystemID);
  if (!systemID) {
    return null;
  }

  return {
    kind: "point",
    systemID,
    point: cloneSpaceVector(entity.position),
    direction: cloneSpaceVector(entity.direction, { x: 1, y: 0, z: 0 }),
    label:
      entity.stationName ||
      entity.stargateName ||
      entity.celestialName ||
      entity.name ||
      `${entity.kind || "entity"} ${entity.itemID || ""}`.trim(),
  };
}

function getSessionTransportAnchor(session) {
  if (!session) {
    return null;
  }

  const dockedStationID = getSessionDockedStationID(session);
  if (dockedStationID) {
    const station = worldData.getStationByID(dockedStationID);
    return {
      kind: "station",
      stationID: dockedStationID,
      label:
        (station && station.stationName) ||
        `station ${dockedStationID}`,
    };
  }

  const shipEntity = getSessionTransportEntity(session);
  if (shipEntity) {
    const shipAnchor = buildTransportPointAnchor(
      shipEntity,
      getSessionCurrentSolarSystemID(session),
    );
    return shipAnchor
      ? {
          ...shipAnchor,
          label:
            session.characterName ||
            session.userName ||
            shipAnchor.label,
        }
      : null;
  }

  const solarSystemID = getSessionCurrentSolarSystemID(session);
  if (!solarSystemID) {
    return null;
  }

  const solarSystem = worldData.getSolarSystemByID(solarSystemID);
  return {
    kind: "solarSystem",
    solarSystemID,
    label:
      (solarSystem && solarSystem.solarSystemName) ||
      `solar system ${solarSystemID}`,
  };
}

function resolveTransportSceneEntity(scene, entityID) {
  if (!scene || !entityID) {
    return null;
  }

  return scene.getEntityByID(entityID) || null;
}

function findStaticTransportAnchorByID(entityID) {
  const numericEntityID = normalizePositiveInteger(entityID);
  if (!numericEntityID) {
    return null;
  }

  const stargate = worldData.getStargateByID(numericEntityID);
  if (stargate) {
    return buildTransportPointAnchor(stargate, stargate.solarSystemID);
  }

  for (const solarSystem of worldData.getSolarSystems()) {
    const match = worldData.getStaticSceneForSystem(solarSystem.solarSystemID).find(
      (candidate) => Number(candidate && candidate.itemID) === numericEntityID,
    );
    if (match) {
      if (match.stationID) {
        return {
          kind: "station",
          stationID: numericEntityID,
          label:
            match.stationName ||
            `station ${numericEntityID}`,
        };
      }
      return buildTransportPointAnchor(match, solarSystem.solarSystemID);
    }
  }

  return null;
}

function resolveTransportTargetDescriptor(requestSession, targetToken) {
  const normalizedToken = String(targetToken || "").trim().toLowerCase();
  if (!normalizedToken) {
    return {
      success: false,
      errorMsg: "USAGE",
    };
  }

  if (normalizedToken === "me") {
    if (!requestSession || !requestSession.characterID) {
      return {
        success: false,
        errorMsg: "CHARACTER_NOT_SELECTED",
      };
    }
    return {
      success: true,
      data: {
        kind: "session",
        session: requestSession,
        label: "me",
      },
    };
  }

  const numericTargetID = normalizePositiveInteger(targetToken);
  if (!numericTargetID) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }

  const targetSession = sessionRegistry.findSessionByCharacterID(numericTargetID);
  if (targetSession) {
    return {
      success: true,
      data: {
        kind: "session",
        session: targetSession,
        label: `character ${numericTargetID}`,
      },
    };
  }

  const requestScene = requestSession
    ? spaceRuntime.getSceneForSession(requestSession)
    : null;
  const entity = resolveTransportSceneEntity(requestScene, numericTargetID);
  if (
    entity &&
    requestScene &&
    requestScene.dynamicEntities instanceof Map &&
    requestScene.dynamicEntities.has(numericTargetID)
  ) {
    return {
      success: true,
      data: {
        kind: "entity",
        entity,
        systemID: requestScene.systemID,
        label: `${entity.kind || "entity"} ${numericTargetID}`,
      },
    };
  }

  return {
    success: false,
    errorMsg: "TARGET_NOT_FOUND",
  };
}

function resolveTransportPointContext(session, targetDescriptor) {
  const sessionAnchor = getSessionTransportAnchor(session);
  if (sessionAnchor) {
    if (sessionAnchor.kind === "point") {
      return sessionAnchor;
    }
    if (sessionAnchor.kind === "solarSystem") {
      return {
        kind: "point",
        systemID: sessionAnchor.solarSystemID,
        point: null,
        direction: { x: 1, y: 0, z: 0 },
      };
    }
    if (sessionAnchor.kind === "station") {
      const station = worldData.getStationByID(sessionAnchor.stationID);
      if (station) {
        return {
          kind: "point",
          systemID: normalizePositiveInteger(station.solarSystemID),
          point: null,
          direction: { x: 1, y: 0, z: 0 },
        };
      }
    }
  }

  if (targetDescriptor && targetDescriptor.kind === "session") {
    const targetAnchor = getSessionTransportAnchor(targetDescriptor.session);
    if (targetAnchor) {
      if (targetAnchor.kind === "point") {
        return targetAnchor;
      }
      if (targetAnchor.kind === "solarSystem") {
        return {
          kind: "point",
          systemID: targetAnchor.solarSystemID,
          point: null,
          direction: { x: 1, y: 0, z: 0 },
        };
      }
      if (targetAnchor.kind === "station") {
        const station = worldData.getStationByID(targetAnchor.stationID);
        if (station) {
          return {
            kind: "point",
            systemID: normalizePositiveInteger(station.solarSystemID),
            point: null,
            direction: { x: 1, y: 0, z: 0 },
          };
        }
      }
    }
  }

  if (targetDescriptor && targetDescriptor.kind === "entity") {
    return buildTransportPointAnchor(
      targetDescriptor.entity,
      targetDescriptor.systemID,
    );
  }

  return null;
}

function resolveTransportLocationToken(session, targetDescriptor, token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }

  if (normalizedToken.toLowerCase() === "me") {
    const anchor = getSessionTransportAnchor(session);
    return anchor
      ? {
          ...anchor,
          label: "me",
        }
      : null;
  }

  const numericID = normalizePositiveInteger(normalizedToken);
  if (!numericID) {
    return null;
  }

  const solarSystem = worldData.getSolarSystemByID(numericID);
  if (solarSystem) {
    return {
      kind: "solarSystem",
      solarSystemID: numericID,
      label:
        solarSystem.solarSystemName ||
        `solar system ${numericID}`,
    };
  }

  const station = worldData.getStationByID(numericID);
  if (station) {
    return {
      kind: "station",
      stationID: numericID,
      label:
        station.stationName ||
        `station ${numericID}`,
    };
  }

  const candidateScenes = [];
  const requestScene = session ? spaceRuntime.getSceneForSession(session) : null;
  if (requestScene) {
    candidateScenes.push(requestScene);
  }

  if (targetDescriptor && targetDescriptor.kind === "session") {
    const targetScene = spaceRuntime.getSceneForSession(targetDescriptor.session);
    if (targetScene && !candidateScenes.includes(targetScene)) {
      candidateScenes.push(targetScene);
    }
  }

  for (const scene of candidateScenes) {
    const entity = resolveTransportSceneEntity(scene, numericID);
    if (!entity) {
      continue;
    }
    if (entity.stationID) {
      return {
        kind: "station",
        stationID: numericID,
        label:
          entity.stationName ||
          `station ${numericID}`,
      };
    }
    return buildTransportPointAnchor(entity, scene.systemID);
  }

  return findStaticTransportAnchorByID(numericID);
}

function withTransportOffset(destination, offsetVector) {
  if (!destination || destination.kind !== "point" || !destination.point) {
    return null;
  }

  return {
    ...destination,
    point: addVectors(destination.point, offsetVector),
  };
}

function formatTransportTargetLabel(targetDescriptor) {
  if (!targetDescriptor) {
    return "target";
  }

  if (targetDescriptor.kind === "session") {
    const targetSession = targetDescriptor.session;
    if (targetDescriptor.label === "me") {
      return "me";
    }
    return (
      (targetSession && targetSession.characterName) ||
      targetDescriptor.label ||
      `character ${targetSession && targetSession.characterID || "?"}`
    );
  }

  return targetDescriptor.label || "entity";
}

function formatTransportDestinationLabel(destination) {
  if (!destination) {
    return "destination";
  }

  if (destination.kind === "point") {
    if (destination.label) {
      return destination.label;
    }
    const point = destination.point || { x: 0, y: 0, z: 0 };
    return `(${point.x}, ${point.y}, ${point.z})`;
  }

  return destination.label || destination.kind;
}

function formatTransportTransitionError(result, fallback) {
  const errorMsg = result && result.errorMsg;
  if (errorMsg === "SHIP_NOT_FOUND") {
    return "Active ship not found for this character.";
  }
  if (errorMsg === "CHARACTER_NOT_SELECTED") {
    return "Select a character before using /tr.";
  }
  if (errorMsg === "SOLAR_SYSTEM_NOT_FOUND") {
    return "Solar-system transport target was not found.";
  }
  if (errorMsg === "STATION_NOT_FOUND") {
    return "Station transport target was not found.";
  }
  if (errorMsg === "SOLAR_JUMP_IN_PROGRESS" || errorMsg === "STATION_JUMP_IN_PROGRESS") {
    return "A transport is already in progress for this character.";
  }
  return fallback;
}

function buildNearbySpaceSpawnState(shipEntity, distanceMeters = 250) {
  const position = {
    x: Number(shipEntity && shipEntity.position && shipEntity.position.x || 0),
    y: Number(shipEntity && shipEntity.position && shipEntity.position.y || 0),
    z: Number(shipEntity && shipEntity.position && shipEntity.position.z || 0),
  };
  const direction = normalizeSpaceVector(
    shipEntity && shipEntity.direction,
    { x: 1, y: 0, z: 0 },
  );
  return {
    position: addVectors(position, scaleVector(direction, Math.max(50, Number(distanceMeters) || 250))),
    velocity: { x: 0, y: 0, z: 0 },
    direction,
    mode: "STOP",
    speedFraction: 0,
  };
}

function buildRandomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const u = (Math.random() * 2) - 1;
  const planarScale = Math.sqrt(Math.max(0, 1 - (u * u)));
  return normalizeSpaceVector({
    x: Math.cos(theta) * planarScale,
    y: u,
    z: Math.sin(theta) * planarScale,
  }, { x: 1, y: 0, z: 0 });
}

function buildOffsetSpaceSpawnState(shipEntity, distanceMeters = 20_000) {
  const origin = {
    x: Number(shipEntity && shipEntity.position && shipEntity.position.x || 0),
    y: Number(shipEntity && shipEntity.position && shipEntity.position.y || 0),
    z: Number(shipEntity && shipEntity.position && shipEntity.position.z || 0),
  };
  const offsetDirection = buildRandomUnitVector();
  const position = addVectors(
    origin,
    scaleVector(offsetDirection, Math.max(1_000, Number(distanceMeters) || 20_000)),
  );
  return {
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: normalizeSpaceVector(
      buildRandomUnitVector(),
      shipEntity && shipEntity.direction,
    ),
    targetPoint: position,
    mode: "STOP",
    speedFraction: 0,
  };
}

function getShipRadiusMeters(shipType) {
  const radius = Number(shipType && shipType.radius);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }
  return 50;
}

function sortShipsLargestToSmallest(left, right) {
  const massDelta = (Number(right && right.mass) || 0) - (Number(left && left.mass) || 0);
  if (massDelta !== 0) {
    return massDelta;
  }
  const radiusDelta = getShipRadiusMeters(right) - getShipRadiusMeters(left);
  if (radiusDelta !== 0) {
    return radiusDelta;
  }
  const volumeDelta = (Number(right && right.volume) || 0) - (Number(left && left.volume) || 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }
  return String(left && left.name || "").localeCompare(String(right && right.name || ""));
}

function buildFormationBasis(direction) {
  const forward = normalizeSpaceVector(direction, { x: 1, y: 0, z: 0 });
  const upReference = Math.abs(Number(forward.y) || 0) >= 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeSpaceVector(
    crossVectors(forward, upReference),
    { x: 0, y: 0, z: 1 },
  );
  const up = normalizeSpaceVector(
    crossVectors(right, forward),
    upReference,
  );
  return { forward, right, up };
}

function resolveFire2FleetShipTypes() {
  const seenTypeIDs = new Set();
  const resolved = [];
  for (const shipName of DEFAULT_FIRE2_FLEET_SHIP_NAMES) {
    const lookup = resolveShipByName(shipName);
    if (!lookup.success || !lookup.match) {
      continue;
    }
    const typeID = Number(lookup.match.typeID) || 0;
    if (typeID <= 0 || seenTypeIDs.has(typeID)) {
      continue;
    }
    seenTypeIDs.add(typeID);
    resolved.push(lookup.match);
  }

  const ships = resolved.sort(sortShipsLargestToSmallest);
  if (ships.length < 10) {
    return {
      success: false,
      errorMsg: "FIRE2_FLEET_TYPES_UNAVAILABLE",
      availableCount: ships.length,
    };
  }

  return {
    success: true,
    ships,
  };
}

function buildFire2FleetShipList(shipTypes, fleetSize) {
  const normalizedSize = Math.max(1, normalizePositiveInteger(fleetSize) || DEFAULT_FIRE2_FLEET_SIZE);
  const fleet = [];
  for (let index = 0; index < normalizedSize; index += 1) {
    const bucketIndex = Math.min(
      shipTypes.length - 1,
      Math.floor((index * shipTypes.length) / normalizedSize),
    );
    fleet.push(shipTypes[bucketIndex]);
  }
  return fleet;
}

function buildFire2FormationRowCounts(fleetSize) {
  const rowCounts = [];
  let remaining = Math.max(1, normalizePositiveInteger(fleetSize) || DEFAULT_FIRE2_FLEET_SIZE);
  let nextRowSize = 1;
  while (remaining > 0) {
    const rowSize = Math.min(nextRowSize, remaining);
    rowCounts.push(rowSize);
    remaining -= rowSize;
    nextRowSize += 1;
  }
  return rowCounts;
}

function buildFire2RowSlots(rowShipCount) {
  const slots = [];
  if (rowShipCount % 2 === 1) {
    slots.push({ lane: 0 });
  }

  let laneMagnitude = rowShipCount % 2 === 0 ? 0.5 : 1;
  while (slots.length < rowShipCount) {
    slots.push({ lane: -laneMagnitude });
    if (slots.length < rowShipCount) {
      slots.push({ lane: laneMagnitude });
    }
    laneMagnitude += 1;
  }

  return slots;
}

function buildFire2FleetFormation(anchorEntity, shipTypes, fleetSize) {
  const fleetShips = buildFire2FleetShipList(shipTypes, fleetSize);
  const rowCounts = buildFire2FormationRowCounts(fleetShips.length);
  const anchorPosition = {
    x: Number(anchorEntity && anchorEntity.position && anchorEntity.position.x || 0),
    y: Number(anchorEntity && anchorEntity.position && anchorEntity.position.y || 0),
    z: Number(anchorEntity && anchorEntity.position && anchorEntity.position.z || 0),
  };
  const basis = buildFormationBasis(anchorEntity && anchorEntity.direction);
  const formationOrigin = addVectors(
    anchorPosition,
    scaleVector(basis.forward, FIRE2_BASE_DISTANCE_METERS),
  );
  const facingDirection = normalizeSpaceVector(
    subtractVectors(anchorPosition, formationOrigin),
    scaleVector(basis.forward, -1),
  );

  const layout = [];
  let shipIndex = 0;
  let rowDistanceMeters = 0;
  let previousRowMaxRadius = 0;
  let formationRowIndex = 0;

  for (const rowCount of rowCounts) {
    const rowShips = fleetShips.slice(shipIndex, shipIndex + rowCount);
    if (rowShips.length === 0) {
      break;
    }

    const rowMaxRadius = rowShips.reduce(
      (largest, shipType) => Math.max(largest, getShipRadiusMeters(shipType)),
      0,
    );
    if (layout.length > 0) {
      rowDistanceMeters += Math.max(
        FIRE2_ROW_SPACING_METERS,
        previousRowMaxRadius + rowMaxRadius + FIRE2_OVERLAP_PADDING_METERS,
      );
    }

    const lateralSpacingMeters = Math.max(
      FIRE2_LATERAL_SPACING_METERS,
      (rowMaxRadius * 2) + FIRE2_OVERLAP_PADDING_METERS,
    );
    const verticalSpacingMeters = Math.max(
      2_500,
      rowMaxRadius + (FIRE2_OVERLAP_PADDING_METERS * 0.75),
    );
    const wingSweepBackMeters = Math.max(
      1_250,
      Math.min(
        3_500,
        (rowMaxRadius * 0.45) + (FIRE2_OVERLAP_PADDING_METERS * 0.25),
      ),
    );
    const rowSlots = buildFire2RowSlots(rowShips.length);

    for (let slotIndex = 0; slotIndex < rowShips.length; slotIndex += 1) {
      const rowSlot = rowSlots[slotIndex] || { lane: 0 };
      const lane = Number(rowSlot.lane) || 0;
      const laneDepth = Math.abs(lane);
      const lateralOffsetMeters = lane * lateralSpacingMeters;
      const wingPullbackMeters = laneDepth * wingSweepBackMeters;
      const centerAdvanceMeters = lane === 0
        ? Math.min(300, Math.max(150, rowMaxRadius * 0.04))
        : 0;
      const verticalDirection = lane === 0
        ? (formationRowIndex % 2 === 0 ? 1 : -1)
        : (lane < 0 ? 1 : -1) * (formationRowIndex % 2 === 0 ? 1 : -1);
      const verticalOffsetMeters = lane === 0
        ? verticalDirection * verticalSpacingMeters * 0.35
        : verticalDirection
          * Math.min(2.5, Math.max(1, laneDepth))
          * verticalSpacingMeters
          * 0.55;
      const position = addVectors(
        addVectors(
          formationOrigin,
          scaleVector(
            basis.forward,
            rowDistanceMeters - wingPullbackMeters + centerAdvanceMeters,
          ),
        ),
        addVectors(
          scaleVector(basis.right, lateralOffsetMeters),
          scaleVector(basis.up, verticalOffsetMeters),
        ),
      );
      layout.push({
        shipType: rowShips[slotIndex],
        spawnState: {
          position,
          velocity: { x: 0, y: 0, z: 0 },
          direction: facingDirection,
          targetPoint: position,
          mode: "STOP",
          speedFraction: 0,
        },
      });
    }

    previousRowMaxRadius = rowMaxRadius;
    shipIndex += rowShips.length;
    formationRowIndex += 1;
  }

  return layout;
}

function isContainerType(itemType) {
  const groupName = String(itemType && itemType.groupName || "").trim().toLowerCase();
  return groupName.includes("container") || groupName === "spawn container";
}

function isWreckType(itemType) {
  const groupName = String(itemType && itemType.groupName || "").trim().toLowerCase();
  return groupName === "wreck";
}

function resolveSpaceItemType(argumentText, defaultName, predicate, label) {
  const lookupText = String(argumentText || "").trim() || defaultName;
  const lookup = resolveItemByName(lookupText);
  if (!lookup.success) {
    return lookup;
  }
  if (!predicate(lookup.match)) {
    return {
      success: false,
      errorMsg: `${label}_TYPE_REQUIRED`,
      suggestions: [lookup.match.name],
    };
  }
  return lookup;
}

function parseOptionalTypeAndCount(argumentText) {
  const trimmed = String(argumentText || "").trim();
  if (!trimmed) {
    return {
      typeName: "",
      count: null,
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      typeName: "",
      count: normalizePositiveInteger(trimmed),
    };
  }

  const splitLookup = splitTrailingAmount(trimmed);
  if (splitLookup.lookupText && splitLookup.amount !== null) {
    return {
      typeName: splitLookup.lookupText,
      count: normalizePositiveInteger(Math.trunc(splitLookup.amount)),
    };
  }

  return {
    typeName: trimmed,
    count: null,
  };
}

function isTechTwoPropulsionName(name) {
  return /\b(?:Afterburner|Microwarpdrive) II$/i.test(String(name || "").trim());
}

function startsWithAnyPrefix(name, prefixes) {
  const text = String(name || "").trim();
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function getNumericTypeAttributeValue(typeID, attributeName, fallback = 0) {
  const numeric = Number(getTypeAttributeValue(Number(typeID) || 0, attributeName));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isNonTechOneVariant(row) {
  const typeID = Number(row && row.typeID) || 0;
  const techLevel = getNumericTypeAttributeValue(typeID, "techLevel", 0);
  const metaGroupID = getNumericTypeAttributeValue(
    typeID,
    "metaGroupID",
    Number(row && row.metaGroupID) || 0,
  );
  return (
    techLevel >= 2 ||
    metaGroupID > 1 ||
    /abyssal/i.test(String(row && row.name || ""))
  );
}

function isCombatWeaponType(row) {
  const typeID = Number(row && row.typeID) || 0;
  const groupName = String(row && row.groupName || "").trim().toLowerCase();
  if (!typeID || groupName.includes("mining") || groupName.includes("gas cloud")) {
    return false;
  }

  return (
    typeHasEffectName(typeID, "turretFitted") ||
    typeHasEffectName(typeID, "launcherFitted")
  );
}

function collectChargeGroupIDsForType(typeID) {
  const chargeGroupIDs = new Set();
  for (let index = 1; index <= 5; index += 1) {
    const groupID = getNumericTypeAttributeValue(typeID, `chargeGroup${index}`, 0);
    if (groupID > 0) {
      chargeGroupIDs.add(groupID);
    }
  }
  return chargeGroupIDs;
}

function dedupeItemTypes(itemTypes) {
  const deduped = [];
  const seen = new Set();
  for (const itemType of Array.isArray(itemTypes) ? itemTypes : []) {
    const typeID = Number(itemType && itemType.typeID) || 0;
    if (typeID <= 0 || seen.has(typeID)) {
      continue;
    }
    seen.add(typeID);
    deduped.push(itemType);
  }
  return deduped;
}

function sortItemTypesByName(left, right) {
  const leftName = String(left && left.name || "");
  const rightName = String(right && right.name || "");
  const nameCompare = leftName.localeCompare(rightName);
  if (nameCompare !== 0) {
    return nameCompare;
  }
  return (Number(left && left.typeID) || 0) - (Number(right && right.typeID) || 0);
}

function getGmWeaponsSeedPlan() {
  if (cachedGmWeaponsSeedPlan) {
    return cachedGmWeaponsSeedPlan;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  const weaponTypes = dedupeItemTypes(
    rows
      .filter((row) => Number(row.categoryID) === 7)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row.name || "")))
      .filter((row) => isCombatWeaponType(row))
      .filter((row) => isNonTechOneVariant(row))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  const chargeGroupIDs = new Set();
  for (const weaponType of weaponTypes) {
    for (const chargeGroupID of collectChargeGroupIDsForType(weaponType.typeID)) {
      chargeGroupIDs.add(chargeGroupID);
    }
  }

  const ammoTypes = dedupeItemTypes(
    rows
      .filter((row) => Number(row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row.name || "")))
      .filter((row) => chargeGroupIDs.has(Number(row.groupID) || 0))
      .filter((row) => isNonTechOneVariant(row))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  cachedGmWeaponsSeedPlan = {
    weaponTypes,
    ammoTypes,
    entries: [
      ...weaponTypes.map((itemType) => ({
        itemType,
        quantity: GM_WEAPONS_MODULE_QUANTITY,
        kind: "weapon",
      })),
      ...ammoTypes.map((itemType) => ({
        itemType,
        quantity: GM_WEAPONS_AMMO_QUANTITY,
        kind: "ammo",
      })),
    ],
  };
  return cachedGmWeaponsSeedPlan;
}

function syncStationHangarChangesToSession(session, stationID, changes = []) {
  const currentStationID = Number(session && (session.stationid || session.stationID) || 0) || 0;
  if (
    !session ||
    !session.characterID ||
    currentStationID <= 0 ||
    currentStationID !== Number(stationID)
  ) {
    return;
  }

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }

    syncInventoryItemForSession(
      session,
      change.item,
      change.previousState || {
        locationID: 0,
        flagID: ITEM_FLAGS.HANGAR,
      },
      {
        emitCfgLocation: true,
      },
    );
  }
}

function grantStationHangarBatchAndSyncSession(session, stationID, entries = []) {
  const result = grantItemsToCharacterStationHangar(
    Number(session && session.characterID) || 0,
    stationID,
    entries,
  );
  if (result.success) {
    syncStationHangarChangesToSession(
      session,
      stationID,
      result.data && result.data.changes,
    );
  }
  return result;
}

function continueGmWeaponsSeedJob(job, chatHub) {
  if (!job) {
    return;
  }

  try {
    const nextEntries = job.entries.slice(
      job.nextIndex,
      job.nextIndex + GM_WEAPONS_BATCH_SIZE,
    );
    if (nextEntries.length === 0) {
      activeGmWeaponsJobs.delete(job.characterID);
      chatHub.sendSystemMessage(
        job.session,
        [
          `Completed /gmweapons for station ${job.stationID}.`,
          `Added ${job.weaponTypeCount} weapon stacks x${GM_WEAPONS_MODULE_QUANTITY} and ${job.ammoTypeCount} ammo stacks x${GM_WEAPONS_AMMO_QUANTITY}.`,
          job.sample ? `Sample: ${job.sample}.` : null,
        ].filter(Boolean).join(" "),
        job.feedbackChannel,
      );
      return;
    }

    const grantResult = grantStationHangarBatchAndSyncSession(
      job.session,
      job.stationID,
      nextEntries,
    );
    if (!grantResult.success) {
      throw new Error(grantResult.errorMsg || "WRITE_ERROR");
    }

    job.nextIndex += nextEntries.length;
    setImmediate(() => continueGmWeaponsSeedJob(job, chatHub));
  } catch (error) {
    activeGmWeaponsJobs.delete(job.characterID);
    chatHub.sendSystemMessage(
      job.session,
      ` /gmweapons failed after ${job.nextIndex}/${job.entries.length} grants: ${error.message}`.trim(),
      job.feedbackChannel,
    );
  }
}

function getPropulsionCommandItemTypes() {
  if (cachedPropulsionCommandTypes) {
    return cachedPropulsionCommandTypes;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  cachedPropulsionCommandTypes = rows
    .filter((row) => Number(row.groupID) === PROPULSION_MODULE_GROUP_ID)
    .filter((row) => Number(row.categoryID) === PROPULSION_MODULE_CATEGORY_ID)
    .filter((row) => row.published !== false)
    .filter((row) => /afterburner|microwarpdrive/i.test(String(row.name || "")))
    .filter((row) => !/blueprint|mutaplasmid/i.test(String(row.name || "")))
    .filter((row) => {
      const name = String(row.name || "").trim();
      return (
        isTechTwoPropulsionName(name) ||
        startsWithAnyPrefix(name, PROPULSION_FACTION_PREFIXES) ||
        startsWithAnyPrefix(name, PROPULSION_OFFICER_PREFIXES)
      );
    })
    .map((row) => resolveItemByName(String(row.name || "").trim()))
    .filter((lookup) => lookup && lookup.success && lookup.match)
    .map((lookup) => lookup.match)
    .filter((itemType, index, list) =>
      list.findIndex((candidate) => Number(candidate.typeID) === Number(itemType.typeID)) === index,
    )
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));

  return cachedPropulsionCommandTypes;
}

function isTechTwoLargeLaserTurretType(row) {
  const typeID = Number(row && row.typeID) || 0;
  const name = String(row && row.name || "").trim();
  if (
    typeID <= 0 ||
    Number(row && row.categoryID) !== 7 ||
    row.published === false ||
    !name ||
    /blueprint/i.test(name) ||
    !/laser/i.test(name)
  ) {
    return false;
  }

  return (
    typeHasEffectName(typeID, "turretFitted") &&
    getNumericTypeAttributeValue(typeID, "techLevel", 0) >= 2 &&
    getNumericTypeAttributeValue(typeID, "chargeSize", 0) === 3
  );
}

function isTechTwoLaserTurretType(row) {
  const typeID = Number(row && row.typeID) || 0;
  const name = String(row && row.name || "").trim();
  if (
    typeID <= 0 ||
    Number(row && row.categoryID) !== 7 ||
    row.published === false ||
    !name ||
    /blueprint/i.test(name) ||
    !/laser/i.test(name) ||
    /mining/i.test(name)
  ) {
    return false;
  }

  const chargeSize = getNumericTypeAttributeValue(typeID, "chargeSize", 0);
  return (
    typeHasEffectName(typeID, "turretFitted") &&
    getNumericTypeAttributeValue(typeID, "techLevel", 0) >= 2 &&
    chargeSize >= 1 &&
    chargeSize <= 3
  );
}

function getLaserCommandTurretTypes() {
  if (cachedLaserTurretCommandTypes) {
    return cachedLaserTurretCommandTypes;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  cachedLaserTurretCommandTypes = dedupeItemTypes(
    rows
      .filter(isTechTwoLargeLaserTurretType)
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort(sortItemTypesByName);

  return cachedLaserTurretCommandTypes;
}

function getLesmisTurretTypes() {
  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  return dedupeItemTypes(
    rows
      .filter(isTechTwoLaserTurretType)
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean),
  ).sort((left, right) => {
    const chargeSizeCompare =
      getNumericTypeAttributeValue(right.typeID, "chargeSize", 0) -
      getNumericTypeAttributeValue(left.typeID, "chargeSize", 0);
    if (chargeSizeCompare !== 0) {
      return chargeSizeCompare;
    }

    const powerCompare =
      getNumericTypeAttributeValue(right.typeID, "powerLoad", 0) -
      getNumericTypeAttributeValue(left.typeID, "powerLoad", 0);
    if (powerCompare !== 0) {
      return powerCompare;
    }

    const cpuCompare =
      getNumericTypeAttributeValue(right.typeID, "cpuLoad", 0) -
      getNumericTypeAttributeValue(left.typeID, "cpuLoad", 0);
    if (cpuCompare !== 0) {
      return cpuCompare;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function buildPlannedFittedModuleItem(charID, shipItem, itemType, flagID, itemID) {
  return {
    itemID,
    typeID: Number(itemType && itemType.typeID) || 0,
    groupID: Number(itemType && itemType.groupID) || 0,
    categoryID: Number(itemType && itemType.categoryID) || 0,
    flagID: Number(flagID) || 0,
    locationID: Number(shipItem && shipItem.itemID) || 0,
    ownerID: Number(charID) || 0,
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(itemType && itemType.name || ""),
    moduleState: {
      online: true,
    },
  };
}

function canPlannedModulesStayOnline(charID, shipItem, plannedModules) {
  const resourceState = buildShipResourceState(charID, shipItem, {
    fittedItems: plannedModules,
  });
  return {
    resourceState,
    success:
      resourceState.cpuLoad <= resourceState.cpuOutput + 1e-6 &&
      resourceState.powerLoad <= resourceState.powerOutput + 1e-6,
  };
}

function tryPlanNextModuleFit(charID, shipItem, itemType, fittedItems) {
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    Number(itemType && itemType.typeID) || 0,
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = buildPlannedFittedModuleItem(
    charID,
    shipItem,
    itemType,
    nextFlagID,
    -1000 - fittedItems.length,
  );
  const validation = validateFitForShip(
    charID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  const plannedItems = [...fittedItems, probeItem];
  const resourceCheck = canPlannedModulesStayOnline(charID, shipItem, plannedItems);
  if (!resourceCheck.success) {
    return {
      success: false,
      errorMsg:
        resourceCheck.resourceState.cpuLoad > resourceCheck.resourceState.cpuOutput + 1e-6
          ? "NOT_ENOUGH_CPU"
          : "NOT_ENOUGH_POWER",
      data: {
        resourceState: resourceCheck.resourceState,
      },
    };
  }

  return {
    success: true,
    data: {
      flagID: nextFlagID,
      plannedItems,
      resourceState: resourceCheck.resourceState,
    },
  };
}

function getCompatibleLaserCrystalTypes(moduleTypeID) {
  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  return dedupeItemTypes(
    rows
      .filter((row) => Number(row && row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean)
      .filter((itemType) => isChargeCompatibleWithModule(moduleTypeID, itemType.typeID)),
  ).sort(sortItemTypesByName);
}

function getCompatibleLesmisHeavyMissileTypes(moduleTypeID) {
  if (cachedLesmisHeavyMissileTypes) {
    return cachedLesmisHeavyMissileTypes;
  }

  const rows = readStaticRows(TABLE.ITEM_TYPES) || [];
  cachedLesmisHeavyMissileTypes = dedupeItemTypes(
    rows
      .filter((row) => Number(row && row.categoryID) === 8)
      .filter((row) => row.published !== false)
      .filter((row) => !/blueprint/i.test(String(row && row.name || "")))
      .filter((row) =>
        /^(Inferno|Mjolnir|Nova|Scourge)(?: (Fury|Precision))? Heavy Missile$/i.test(
          String(row && row.name || "").trim(),
        ),
      )
      .map((row) => resolveItemByTypeID(row.typeID))
      .filter(Boolean)
      .filter((itemType) => isChargeCompatibleWithModule(moduleTypeID, itemType.typeID)),
  ).sort(sortItemTypesByName);

  return cachedLesmisHeavyMissileTypes;
}

function buildLaserCommandPlan(charID, shipItem) {
  const propulsionType = resolveItemByName(LASER_COMMAND_MWD_NAME);
  if (!propulsionType || !propulsionType.success || !propulsionType.match) {
    return {
      success: false,
      errorMsg: "LASER_COMMAND_MWD_NOT_FOUND",
    };
  }

  const baseFit = tryPlanNextModuleFit(charID, shipItem, propulsionType.match, []);
  if (!baseFit.success) {
    return {
      success: false,
      errorMsg: baseFit.errorMsg || "LASER_COMMAND_MWD_FIT_FAILED",
    };
  }

  const turretTypes = getLaserCommandTurretTypes();
  if (turretTypes.length === 0) {
    return {
      success: false,
      errorMsg: "LASER_COMMAND_TURRETS_NOT_FOUND",
    };
  }

  const candidatePlans = [];
  for (const turretType of turretTypes) {
    let plannedItems = baseFit.data.plannedItems.slice();
    let turretCount = 0;
    let latestResourceState = baseFit.data.resourceState;

    while (true) {
      const nextFit = tryPlanNextModuleFit(charID, shipItem, turretType, plannedItems);
      if (!nextFit.success) {
        break;
      }
      plannedItems = nextFit.data.plannedItems;
      latestResourceState = nextFit.data.resourceState;
      turretCount += 1;
    }

    if (turretCount <= 0) {
      continue;
    }

    candidatePlans.push({
      turretType,
      turretCount,
      plannedItems,
      resourceState: latestResourceState,
    });
  }

  candidatePlans.sort((left, right) => {
    if (right.turretCount !== left.turretCount) {
      return right.turretCount - left.turretCount;
    }

    const powerCompare =
      getNumericTypeAttributeValue(right.turretType.typeID, "powerLoad", 0) -
      getNumericTypeAttributeValue(left.turretType.typeID, "powerLoad", 0);
    if (powerCompare !== 0) {
      return powerCompare;
    }

    const cpuCompare =
      getNumericTypeAttributeValue(right.turretType.typeID, "cpuLoad", 0) -
      getNumericTypeAttributeValue(left.turretType.typeID, "cpuLoad", 0);
    if (cpuCompare !== 0) {
      return cpuCompare;
    }

    return String(left.turretType.name || "").localeCompare(String(right.turretType.name || ""));
  });

  const bestPlan = candidatePlans[0] || null;
  if (!bestPlan) {
    return {
      success: false,
      errorMsg: "LASER_COMMAND_NO_VALID_TURRET_FIT",
    };
  }

  const crystalTypes = getCompatibleLaserCrystalTypes(bestPlan.turretType.typeID);
  const minimumCrystalVolume = crystalTypes.reduce(
    (sum, itemType) =>
      sum +
      (
        (Number(itemType && itemType.volume) || 0) *
        LASER_COMMAND_MIN_CRYSTALS_PER_TYPE
      ),
    0,
  );
  if (minimumCrystalVolume > bestPlan.resourceState.cargoCapacity + 1e-6) {
    return {
      success: false,
      errorMsg: "LASER_COMMAND_CARGO_TOO_SMALL",
      data: {
        requiredVolume: minimumCrystalVolume,
        cargoCapacity: bestPlan.resourceState.cargoCapacity,
      },
    };
  }

  return {
    success: true,
    data: {
      propulsionType: propulsionType.match,
      turretType: bestPlan.turretType,
      turretCount: bestPlan.turretCount,
      plannedItems: bestPlan.plannedItems,
      resourceState: bestPlan.resourceState,
      crystalTypes,
    },
  };
}

function buildLesmisCommandPlan(charID, shipItem) {
  const propulsionType = resolveItemByName(LASER_COMMAND_MWD_NAME);
  if (!propulsionType || !propulsionType.success || !propulsionType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_MWD_NOT_FOUND",
    };
  }

  const launcherType = resolveItemByName(LESMIS_COMMAND_LAUNCHER_NAME);
  if (!launcherType || !launcherType.success || !launcherType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_LAUNCHER_NOT_FOUND",
    };
  }

  const turretType = resolveItemByName(LESMIS_COMMAND_TURRET_NAME);
  if (!turretType || !turretType.success || !turretType.match) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_TURRET_NOT_FOUND",
    };
  }

  const baseFit = tryPlanNextModuleFit(charID, shipItem, propulsionType.match, []);
  if (!baseFit.success) {
    return {
      success: false,
      errorMsg: baseFit.errorMsg || "LESMIS_COMMAND_MWD_FIT_FAILED",
    };
  }

  let plannedItems = baseFit.data.plannedItems.slice();
  let latestResourceState = baseFit.data.resourceState;
  for (let index = 0; index < LESMIS_COMMAND_LAUNCHER_COUNT; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      launcherType.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "LESMIS_COMMAND_LAUNCHER_FIT_FAILED",
        data: {
          fittedLauncherCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  for (let index = 0; index < LESMIS_COMMAND_TURRET_COUNT; index += 1) {
    const nextFit = tryPlanNextModuleFit(
      charID,
      shipItem,
      turretType.match,
      plannedItems,
    );
    if (!nextFit.success) {
      return {
        success: false,
        errorMsg: nextFit.errorMsg || "LESMIS_COMMAND_TURRET_FIT_FAILED",
        data: {
          fittedTurretCount: index,
        },
      };
    }

    plannedItems = nextFit.data.plannedItems;
    latestResourceState = nextFit.data.resourceState;
  }

  const crystalTypes = getCompatibleLaserCrystalTypes(turretType.match.typeID);
  const missileTypes = getCompatibleLesmisHeavyMissileTypes(launcherType.match.typeID);
  if (missileTypes.length === 0) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_MISSILES_NOT_FOUND",
    };
  }

  const crystalVolume = crystalTypes.reduce(
    (sum, itemType) =>
      sum +
      ((Number(itemType && itemType.volume) || 0) * LASER_COMMAND_MIN_CRYSTALS_PER_TYPE),
    0,
  );
  const missileVolume = missileTypes.reduce(
    (sum, itemType) =>
      sum +
      ((Number(itemType && itemType.volume) || 0) * LESMIS_COMMAND_MISSILES_PER_TYPE),
    0,
  );
  const totalCargoVolume = crystalVolume + missileVolume;
  if (totalCargoVolume > latestResourceState.cargoCapacity + 1e-6) {
    return {
      success: false,
      errorMsg: "LESMIS_COMMAND_CARGO_TOO_SMALL",
      data: {
        requiredVolume: totalCargoVolume,
        cargoCapacity: latestResourceState.cargoCapacity,
      },
    };
  }

  return {
    success: true,
    data: {
      propulsionType: propulsionType.match,
      launcherType: launcherType.match,
      turretType: turretType.match,
      launcherCount: LESMIS_COMMAND_LAUNCHER_COUNT,
      turretCount: LESMIS_COMMAND_TURRET_COUNT,
      plannedItems,
      resourceState: latestResourceState,
      crystalTypes,
      missileTypes,
    },
  };
}

function fitGrantedItemTypeToShip(
  session,
  stationID,
  shipItem,
  itemType,
  count,
  chatHub,
  options,
) {
  const numericCount = normalizePositiveInteger(count, 1);
  let fittedCount = 0;
  let latestResourceState = null;

  for (let index = 0; index < numericCount; index += 1) {
    const fittedItems = listFittedItems(session.characterID, shipItem.itemID);
    const nextFit = tryPlanNextModuleFit(
      session.characterID,
      shipItem,
      itemType,
      fittedItems,
    );
    if (!nextFit.success) {
      break;
    }

    const moveResult = moveItemTypeFromCharacterLocation(
      session.characterID,
      stationID,
      ITEM_FLAGS.HANGAR,
      shipItem.itemID,
      nextFit.data.flagID,
      itemType.typeID,
      1,
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "LASER_COMMAND_MOVE_FAILED",
      };
    }

    syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
    fittedCount += 1;
    latestResourceState = nextFit.data.resourceState;
  }

  return {
    success: true,
    data: {
      fittedCount,
      resourceState: latestResourceState,
    },
  };
}

function moveGrantedItemTypeToShipCargo(session, stationID, shipItem, itemType, quantity) {
  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    ITEM_FLAGS.CARGO_HOLD,
    itemType.typeID,
    quantity,
  );
  if (!moveResult.success) {
    return moveResult;
  }

  syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
  return moveResult;
}

function boardStoredShipLikeHangarBoard(session, stationID, shipItem, options = {}) {
  const serviceManager = options && options.serviceManager;
  const shipService =
    serviceManager && typeof serviceManager.lookup === "function"
      ? serviceManager.lookup("ship")
      : null;

  if (shipService && typeof shipService.callMethod === "function") {
    shipService.callMethod(
      "BoardStoredShip",
      [stationID, shipItem.itemID],
      session,
      null,
    );

    const activeShip = getActiveShipRecord(session.characterID);
    return {
      success: Boolean(activeShip && Number(activeShip.itemID) === Number(shipItem.itemID)),
      activeShip,
      errorMsg:
        activeShip && Number(activeShip.itemID) === Number(shipItem.itemID)
          ? null
          : "BOARD_STORED_SHIP_FAILED",
    };
  }

  const activationResult = activateShipForSession(session, shipItem.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  return {
    success: activationResult.success === true,
    activeShip: activationResult.activeShip || getActiveShipRecord(session.characterID),
    errorMsg: activationResult.errorMsg || null,
  };
}

function handleLaserCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /laser.",
    );
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /laser.",
    );
  }

  const shipType = resolveShipByName(LASER_COMMAND_SHIP_NAME);
  if (!shipType || !shipType.success || !shipType.match) {
    return handledResult(
      chatHub,
      session,
      options,
      `Ship type not found for /laser: ${LASER_COMMAND_SHIP_NAME}.`,
    );
  }

  const spawnResult = spawnShipInHangarForSession(session, shipType.match);
  if (!spawnResult.success || !spawnResult.ship) {
    return handledResult(
      chatHub,
      session,
      options,
      "Failed to spawn the /laser hull in your station hangar.",
    );
  }

  const shipItem = spawnResult.ship;
  const planResult = buildLaserCommandPlan(session.characterID, shipItem);
  if (!planResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to build the /laser fit: ${planResult.errorMsg}.`,
    );
  }

  const fitPlan = planResult.data;
  const grantEntries = [
    {
      itemType: fitPlan.propulsionType,
      quantity: 1,
    },
    {
      itemType: fitPlan.turretType,
      quantity: fitPlan.turretCount,
    },
    ...fitPlan.crystalTypes.map((itemType) => ({
      itemType,
      quantity: LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    })),
  ];

  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to seed the /laser modules and crystals: ${grantResult.errorMsg || "WRITE_ERROR"}.`,
    );
  }

  const propulsionFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.propulsionType,
    1,
    chatHub,
    options,
  );
  if (!propulsionFitResult.success || propulsionFitResult.data.fittedCount !== 1) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /laser hull spawned, but the MWD fit failed: ${propulsionFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const turretFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.turretType,
    fitPlan.turretCount,
    chatHub,
    options,
  );
  if (!turretFitResult.success || turretFitResult.data.fittedCount <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /laser hull spawned, but the turret fit failed: ${turretFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  for (const crystalType of fitPlan.crystalTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      crystalType,
      LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The /laser hull spawned, but cargo seeding failed on ${crystalType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  const finalResourceState = buildShipResourceState(
    session.characterID,
    shipItem,
  );
  return handledResult(
    chatHub,
    session,
    options,
    [
      `${shipType.match.name} was added to your ship hangar as ship ${shipItem.itemID}.`,
      `Fitted 1x ${fitPlan.propulsionType.name} and ${turretFitResult.data.fittedCount}x ${fitPlan.turretType.name}.`,
      `Loaded cargo with ${LASER_COMMAND_MIN_CRYSTALS_PER_TYPE} of each compatible L crystal (${fitPlan.crystalTypes.length} types, ${(fitPlan.crystalTypes.length * LASER_COMMAND_MIN_CRYSTALS_PER_TYPE).toLocaleString("en-US")} total crystals).`,
      `Remaining fitting: ${(finalResourceState.cpuOutput - finalResourceState.cpuLoad).toFixed(2)} CPU, ${(finalResourceState.powerOutput - finalResourceState.powerLoad).toFixed(2)} PG.`,
    ].join(" "),
  );
}

function handleLesmisCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /lesmis.",
    );
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /lesmis.",
    );
  }

  const shipType = resolveShipByName(LESMIS_COMMAND_SHIP_NAME);
  if (!shipType || !shipType.success || !shipType.match) {
    return handledResult(
      chatHub,
      session,
      options,
      `Ship type not found for /lesmis: ${LESMIS_COMMAND_SHIP_NAME}.`,
    );
  }

  const spawnResult = spawnShipInHangarForSession(session, shipType.match);
  if (!spawnResult.success || !spawnResult.ship) {
    return handledResult(
      chatHub,
      session,
      options,
      "Failed to spawn the /lesmis hull in your station hangar.",
    );
  }

  const shipItem = spawnResult.ship;
  const planResult = buildLesmisCommandPlan(session.characterID, shipItem);
  if (!planResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to build the /lesmis fit: ${planResult.errorMsg}.`,
    );
  }

  const fitPlan = planResult.data;
  const grantEntries = [
    {
      itemType: fitPlan.propulsionType,
      quantity: 1,
    },
    {
      itemType: fitPlan.launcherType,
      quantity: fitPlan.launcherCount,
    },
    {
      itemType: fitPlan.turretType,
      quantity: fitPlan.turretCount,
    },
    ...fitPlan.crystalTypes.map((itemType) => ({
      itemType,
      quantity: LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    })),
    ...fitPlan.missileTypes.map((itemType) => ({
      itemType,
      quantity: LESMIS_COMMAND_MISSILES_PER_TYPE,
    })),
  ];

  const grantResult = grantStationHangarBatchAndSyncSession(
    session,
    stationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Unable to seed the /lesmis fit and ammo: ${grantResult.errorMsg || "WRITE_ERROR"}.`,
    );
  }

  const propulsionFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.propulsionType,
    1,
    chatHub,
    options,
  );
  if (!propulsionFitResult.success || propulsionFitResult.data.fittedCount !== 1) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the MWD fit failed: ${propulsionFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const launcherFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.launcherType,
    fitPlan.launcherCount,
    chatHub,
    options,
  );
  if (
    !launcherFitResult.success ||
    launcherFitResult.data.fittedCount !== fitPlan.launcherCount
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the launcher fit failed: ${launcherFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  const turretFitResult = fitGrantedItemTypeToShip(
    session,
    stationID,
    shipItem,
    fitPlan.turretType,
    fitPlan.turretCount,
    chatHub,
    options,
  );
  if (!turretFitResult.success || turretFitResult.data.fittedCount !== fitPlan.turretCount) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis hull spawned, but the turret fit failed: ${turretFitResult.errorMsg || "FIT_FAILED"}.`,
    );
  }

  for (const crystalType of fitPlan.crystalTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      crystalType,
      LASER_COMMAND_MIN_CRYSTALS_PER_TYPE,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The /lesmis hull spawned, but laser crystal cargo seeding failed on ${crystalType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  for (const missileType of fitPlan.missileTypes) {
    const cargoMoveResult = moveGrantedItemTypeToShipCargo(
      session,
      stationID,
      shipItem,
      missileType,
      LESMIS_COMMAND_MISSILES_PER_TYPE,
    );
    if (!cargoMoveResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `The /lesmis hull spawned, but missile cargo seeding failed on ${missileType.name}: ${cargoMoveResult.errorMsg || "MOVE_FAILED"}.`,
      );
    }
  }

  const activationResult = boardStoredShipLikeHangarBoard(
    session,
    stationID,
    shipItem,
    options,
  );
  if (!activationResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `The /lesmis ship was spawned and fitted, but boarding it failed: ${activationResult.errorMsg || "BOARD_FAILED"}.`,
    );
  }

  const finalResourceState = buildShipResourceState(
    session.characterID,
    shipItem,
  );
  return handledResult(
    chatHub,
    session,
    options,
    [
      `${shipType.match.name} was added to your ship hangar as ship ${shipItem.itemID}.`,
      `Fitted 1x ${fitPlan.propulsionType.name}, ${launcherFitResult.data.fittedCount}x ${fitPlan.launcherType.name}, and ${turretFitResult.data.fittedCount}x ${fitPlan.turretType.name}.`,
      `Loaded cargo with ${LASER_COMMAND_MIN_CRYSTALS_PER_TYPE} of each compatible L crystal and ${LESMIS_COMMAND_MISSILES_PER_TYPE.toLocaleString("en-US")} of each compatible T1/T2 heavy missile type (${fitPlan.missileTypes.length} missile types).`,
      `Boarded your client into the new Typhoon in station.`,
      `Remaining fitting: ${(finalResourceState.cpuOutput - finalResourceState.cpuLoad).toFixed(2)} CPU, ${(finalResourceState.powerOutput - finalResourceState.powerLoad).toFixed(2)} PG.`,
    ].join(" "),
  );
}

function refreshAffiliationSessions(characterIDs) {
  const targetCharacterIDs = new Set(
    (Array.isArray(characterIDs) ? characterIDs : [])
      .map((characterID) => normalizePositiveInteger(characterID))
      .filter(Boolean),
  );

  if (targetCharacterIDs.size === 0) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    const characterID = normalizePositiveInteger(
      targetSession && (targetSession.characterID || targetSession.charid),
    );
    if (!characterID || !targetCharacterIDs.has(characterID)) {
      continue;
    }

    applyCharacterToSession(targetSession, characterID, {
      selectionEvent: false,
      emitNotifications: true,
      logSelection: false,
    });
  }
}

function reconcileSolarTargetSessionIdentity(session, solarSystem) {
  if (
    !session ||
    !solarSystem ||
    typeof session.sendSessionChange !== "function"
  ) {
    return false;
  }

  const targetSolarSystemID =
    normalizePositiveInteger(solarSystem.solarSystemID) || null;
  const targetConstellationID =
    normalizePositiveInteger(solarSystem.constellationID) || null;
  const targetRegionID =
    normalizePositiveInteger(solarSystem.regionID) || null;

  if (!targetSolarSystemID) {
    return false;
  }

  const sessionChanges = {};
  const applyChange = (key, nextValue, aliases) => {
    const previousValue = normalizePositiveInteger(
      aliases.map((alias) => session[alias]).find((value) => value !== undefined),
    );
    const normalizedNextValue = normalizePositiveInteger(nextValue);
    if (previousValue === normalizedNextValue) {
      return;
    }

    for (const alias of aliases) {
      session[alias] = normalizedNextValue;
    }
    sessionChanges[key] = [previousValue, normalizedNextValue];
  };

  applyChange("solarsystemid2", targetSolarSystemID, ["solarsystemid2"]);
  applyChange("solarsystemid", targetSolarSystemID, ["solarsystemid"]);
  applyChange("locationid", targetSolarSystemID, ["locationid"]);

  if (targetConstellationID) {
    applyChange("constellationid", targetConstellationID, [
      "constellationid",
      "constellationID",
    ]);
  }

  if (targetRegionID) {
    applyChange("regionid", targetRegionID, [
      "regionid",
      "regionID",
    ]);
  }

  if (Object.keys(sessionChanges).length === 0) {
    return false;
  }

  session.sendSessionChange(sessionChanges);
  return true;
}

function getWalletSummary(session) {
  const wallet = session && session.characterID
    ? getCharacterWallet(session.characterID)
    : null;
  if (!wallet) {
    return null;
  }

  const deltaText =
    wallet.balanceChange === 0
      ? "0.00 ISK"
      : `${wallet.balanceChange > 0 ? "+" : ""}${formatIsk(wallet.balanceChange)}`;

  return `Wallet balance: ${formatIsk(wallet.balance)}. PLEX: ${formatPlex(wallet.plexBalance)}. Last ISK change: ${deltaText}.`;
}

function getLocationSummary(session) {
  if (!session || !session.characterID) {
    return "No character selected.";
  }

  if (session.stationid || session.stationID) {
    return `Docked in station ${session.stationid || session.stationID}, solar system ${session.solarsystemid2 || session.solarsystemid || "unknown"}.`;
  }

  if (session.solarsystemid2 || session.solarsystemid) {
    return `In space in solar system ${session.solarsystemid2 || session.solarsystemid}.`;
  }

  return "Current location is unknown.";
}

function getActiveSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
  );
}

function formatSolarSystemLabel(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  return system && system.solarSystemName
    ? `${system.solarSystemName}(${systemID})`
    : String(systemID || 0);
}

function formatSolarSystemList(systemIDs) {
  const uniqueIDs = [...new Set((Array.isArray(systemIDs) ? systemIDs : []).filter(Boolean))];
  return uniqueIDs.length > 0
    ? uniqueIDs.map((systemID) => formatSolarSystemLabel(systemID)).join(", ")
    : "none";
}

function formatTimeDilationFactor(value) {
  const factor = Number.isFinite(Number(value)) ? Number(value) : 1;
  return `${factor.toFixed(3)} (${Math.round(factor * 1000) / 10}%)`;
}


function getConnectedCharacterSummary() {
  const connected = sessionRegistry
    .getSessions()
    .filter((session) => Number(session.characterID || 0) > 0)
    .map(
      (session) =>
        `${session.characterName || session.userName || "Unknown"}(${session.characterID})`,
    );

  if (connected.length === 0) {
    return "No active characters are connected.";
  }

  return `Connected characters (${connected.length}): ${connected.join(", ")}`;
}

function getSessionSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  return [
    `char=${session.characterName || "Unknown"}(${session.characterID})`,
    `ship=${session.shipName || "Ship"}(${session.shipID || session.shipid || 0})`,
    `corp=${session.corporationID || 0}`,
    `station=${session.stationid || session.stationID || 0}`,
    `system=${session.solarsystemid2 || session.solarsystemid || 0}`,
    `wallet=${formatIsk(session.balance || 0)}`,
  ].join(" | ");
}

function getHangarSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  const stationId = session.stationid || session.stationID;
  if (!stationId) {
    return "You must be docked to inspect the station ship hangar.";
  }

  const activeShip = getActiveShipRecord(session.characterID);
  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const shipSummary = hangarShips
    .map((ship) => `${ship.itemName}(${ship.itemID})`)
    .join(", ");

  return [
    `Active ship: ${activeShip ? `${activeShip.itemName}(${activeShip.itemID})` : "none"}.`,
    `Hangar ships (${hangarShips.length}): ${shipSummary || "none"}.`,
  ].join(" ");
}

function getItemSummary(argumentText) {
  const itemID = Number(argumentText);
  if (!Number.isInteger(itemID) || itemID <= 0) {
    return "Usage: /item <itemID>";
  }

  const item = getAllItems()[String(itemID)];
  if (!item) {
    return `Item not found: ${itemID}.`;
  }

  return [
    `Item ${item.itemID}: ${item.itemName || "Unknown"}`,
    `type=${item.typeID}`,
    `owner=${item.ownerID}`,
    `location=${item.locationID}`,
    `flag=${item.flagID}`,
    `singleton=${item.singleton}`,
    `quantity=${item.quantity}`,
  ].join(" | ");
}

function sendAnnouncement(chatHub, session, message) {
  if (!message) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    if (chatHub) {
      chatHub.sendSystemMessage(targetSession, message);
    }
  }
}

function handleShipSpawn(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <ship name|typeID>`,
    );
  }

  const shipLookup = resolveShipByName(argumentText);
  if (!shipLookup.success) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship not found: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const spawnResult = spawnShipInHangarForSession(session, shipLookup.match);
  if (!spawnResult.success) {
    let message = "Ship spawn failed.";
    if (spawnResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before spawning ships into your hangar.";
    } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before spawning ships.";
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    `${shipLookup.match.name}${shipLookup.match.published === false ? " [unpublished]" : ""} was added to your ship hangar. /${commandLabel} only spawns the hull for now; board it manually from the hangar.`,
  );
}

function handleGiveItemCommand(session, argumentText, chatHub, options) {
  const trimmedArgument = String(argumentText || "").trim();
  if (!trimmedArgument) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /giveitem <item name|typeID> [amount]",
    );
  }

  let itemLookup = resolveItemByName(trimmedArgument);
  let normalizedAmount = 1;

  if (!itemLookup.success) {
    const splitLookup = splitTrailingAmount(trimmedArgument);
    if (splitLookup.lookupText && splitLookup.amount !== null) {
      const splitMatch = resolveItemByName(splitLookup.lookupText);
      if (splitMatch.success) {
        itemLookup = splitMatch;
        normalizedAmount = normalizePositiveInteger(Math.trunc(splitLookup.amount));
      }
    }
  }

  if (!normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      "Item amount must be a positive whole number.",
    );
  }

  if (!itemLookup.success) {
    const message =
      itemLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Item not found: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`
        : `Item name is ambiguous: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const giveResult = giveItemToHangarForSession(
    session,
    itemLookup.match,
    normalizedAmount,
  );
  if (!giveResult.success) {
    let message = "Item grant failed.";
    if (giveResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before using /giveitem.";
    } else if (giveResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /giveitem.";
    } else if (giveResult.errorMsg === "ITEM_TYPE_NOT_FOUND") {
      message = `Item type not found: ${trimmedArgument}.`;
    }
    return handledResult(chatHub, session, options, message);
  }

  const changedItems = Array.isArray(giveResult.data.items) ? giveResult.data.items : [];
  const stackMode =
    changedItems.length === 1 && Number(changedItems[0].singleton || 0) === 0;
  const summary = stackMode
    ? `${normalizedAmount.toLocaleString("en-US")}x ${itemLookup.match.name}`
    : `${itemLookup.match.name} x${normalizedAmount.toLocaleString("en-US")}`;

  return handledResult(
    chatHub,
    session,
    options,
    `${summary}${itemLookup.match.published === false ? " [unpublished]" : ""} was added to your station hangar.`,
  );
}

function handleSpawnContainerCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /spawncontainer.",
    );
  }

  const containerLookup = resolveSpaceItemType(
    argumentText,
    DEFAULT_SPACE_CONTAINER_NAME,
    isContainerType,
    "CONTAINER",
  );
  if (!containerLookup.success) {
    const message =
      containerLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Container type not found: ${String(argumentText || "").trim() || DEFAULT_SPACE_CONTAINER_NAME}.${formatSuggestions(containerLookup.suggestions)}`
        : containerLookup.errorMsg === "ITEM_NAME_AMBIGUOUS"
          ? `Container type is ambiguous: ${argumentText}.${formatSuggestions(containerLookup.suggestions)}`
          : `Type must resolve to a container item.${formatSuggestions(containerLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    containerLookup.match,
    buildNearbySpaceSpawnState(shipEntity),
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Container spawn failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Container item was created, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${containerLookup.match.name} (${createResult.data.itemID}) in space.`,
  );
}

function handleSpawnWreckCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /spawnwreck.",
    );
  }

  const wreckLookup = resolveSpaceItemType(
    argumentText,
    DEFAULT_SPACE_WRECK_NAME,
    isWreckType,
    "WRECK",
  );
  if (!wreckLookup.success) {
    const message =
      wreckLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Wreck type not found: ${String(argumentText || "").trim() || DEFAULT_SPACE_WRECK_NAME}.${formatSuggestions(wreckLookup.suggestions)}`
        : wreckLookup.errorMsg === "ITEM_NAME_AMBIGUOUS"
          ? `Wreck type is ambiguous: ${argumentText}.${formatSuggestions(wreckLookup.suggestions)}`
          : `Type must resolve to a wreck item.${formatSuggestions(wreckLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    wreckLookup.match,
    {
      ...buildNearbySpaceSpawnState(shipEntity, 300),
      spaceRadius: resolveRuntimeWreckRadius(wreckLookup.match),
    },
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Wreck spawn failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Wreck item was created, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${wreckLookup.match.name} (${createResult.data.itemID}) in space.`,
  );
}

function handleJetcanCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /jetcan.",
    );
  }

  const trimmedArgument = String(argumentText || "").trim();
  if (!trimmedArgument) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /jetcan <item name|typeID> [amount]",
    );
  }

  let itemLookup = resolveItemByName(trimmedArgument);
  let normalizedAmount = 1;
  if (!itemLookup.success) {
    const splitLookup = splitTrailingAmount(trimmedArgument);
    if (splitLookup.lookupText && splitLookup.amount !== null) {
      const splitMatch = resolveItemByName(splitLookup.lookupText);
      if (splitMatch.success) {
        itemLookup = splitMatch;
        normalizedAmount = normalizePositiveInteger(Math.trunc(splitLookup.amount));
      }
    }
  }

  if (!normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      "Jetcan amount must be a positive whole number.",
    );
  }

  if (!itemLookup.success) {
    const message =
      itemLookup.errorMsg === "ITEM_NOT_FOUND"
        ? `Item not found: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`
        : `Item name is ambiguous: ${trimmedArgument}.${formatSuggestions(itemLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const shipID = Number(session._space.shipID || 0) || 0;
  const cargoItems = listContainerItems(
    session.characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => Number(item.typeID) === Number(itemLookup.match.typeID));
  const availableQuantity = cargoItems.reduce((sum, item) => (
    sum + (Number(item.singleton) === 1 ? 1 : Math.max(0, Number(item.stacksize || item.quantity || 0)))
  ), 0);
  if (availableQuantity < normalizedAmount) {
    return handledResult(
      chatHub,
      session,
      options,
      `Not enough ${itemLookup.match.name} in cargo. Available: ${availableQuantity.toLocaleString("en-US")}.`,
    );
  }

  const containerLookup = resolveSpaceItemType(
    DEFAULT_SPACE_CONTAINER_NAME,
    DEFAULT_SPACE_CONTAINER_NAME,
    isContainerType,
    "CONTAINER",
  );
  if (!containerLookup.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Default jetcan container type could not be resolved.",
    );
  }

  const shipEntity = spaceRuntime.getEntity(session, shipID);
  // CCP parity: jetcans last exactly 2 hours from creation, regardless of
  // whether items are added or removed.  Empty cans persist until the timer
  // expires -- there is no early despawn on empty.
  const createResult = createSpaceItemForCharacter(
    session.characterID,
    session._space.systemID,
    containerLookup.match,
    {
      ...buildNearbySpaceSpawnState(shipEntity, 275),
      createdAtMs: spaceRuntime.getSimulationTimeMsForSession(session),
      expiresAtMs: spaceRuntime.getSimulationTimeMsForSession(session) + JETCAN_LIFETIME_MS,
    },
  );
  if (!createResult.success || !createResult.data) {
    return handledResult(chatHub, session, options, "Jetcan creation failed.");
  }

  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    shipID,
    ITEM_FLAGS.CARGO_HOLD,
    createResult.data.itemID,
    ITEM_FLAGS.HANGAR,
    itemLookup.match.typeID,
    normalizedAmount,
  );
  if (!moveResult.success) {
    return handledResult(chatHub, session, options, "Jetcan item move failed.");
  }

  syncInventoryChangesToSession(session, createResult.changes || []);
  syncInventoryChangesToSession(session, (moveResult.data && moveResult.data.changes) || []);
  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    session._space.systemID,
    createResult.data.itemID,
  );
  if (!spawnResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Jetcan contents moved, but the space ball failed to spawn.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Jettisoned ${normalizedAmount.toLocaleString("en-US")}x ${itemLookup.match.name} into ${containerLookup.match.name} (${createResult.data.itemID}). Expires in 2 hours.`,
  );
}

function handleDebrisFieldCommand(session, argumentText, chatHub, options, kind) {
  // /wreck list  or  /container list  →  show all valid types with name + typeID
  if (String(argumentText || "").trim().toLowerCase() === "list") {
    const label = kind === "wreck" ? "Wreck" : "Container";
    const types = listAvailableDebrisTypes(kind);
    if (types.length === 0) {
      return handledResult(chatHub, session, options, `No ${label.toLowerCase()} types found.`);
    }
    const lines = types.map((t) => `  ${t.name}  (typeID ${t.typeID})`);
    return handledResult(
      chatHub,
      session,
      options,
      `Available ${label.toLowerCase()} types (${types.length}):\n${lines.join("\n")}\n\nUsage: /${kind} <name|typeID> [count]`,
    );
  }

  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      `You must be in space before using /${kind}.`,
    );
  }

  const parsed = parseOptionalTypeAndCount(argumentText);
  if (
    argumentText &&
    String(argumentText).trim() &&
    /\s+\d+\s*$/.test(String(argumentText)) &&
    !parsed.count
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      "Count must be a positive whole number.",
    );
  }

  if (parsed.typeName) {
    const typeLookup = resolveDebrisType(kind, parsed.typeName);
    if (!typeLookup.success) {
      const label = kind === "wreck" ? "Wreck" : "Container";
      const message =
        typeLookup.errorMsg === "ITEM_NOT_FOUND"
          ? `${label} type not found: ${parsed.typeName}.${formatSuggestions(typeLookup.suggestions)}`
          : `${label} type is ambiguous: ${parsed.typeName}.${formatSuggestions(typeLookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }
  }

  const spawnResult = spawnDebrisFieldForSession(session, kind, {
    typeName: parsed.typeName,
    count: parsed.count,
  });
  if (!spawnResult.success) {
    const message =
      spawnResult.errorMsg === "SPACE_REQUIRED"
        ? `You must be in space before using /${kind}.`
        : "Debris spawn failed.";
    return handledResult(chatHub, session, options, message);
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    spawnResult.data && spawnResult.data.changes,
  );

  const requestedCount = Number(spawnResult.data && spawnResult.data.requestedCount) || 0;
  const actualCount = Number(spawnResult.data && spawnResult.data.actualCount) || 0;
  const lifetimeHours = Math.round((getSpaceDebrisLifetimeMs() / 3600000) * 10) / 10;
  const sample = ((spawnResult.data && spawnResult.data.created) || [])
    .slice(0, 3)
    .map((entry) => `${entry.typeName}(${entry.item.itemID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Spawned ${actualCount}/${requestedCount} ${kind}${actualCount === 1 ? "" : "s"} within 20 km.`,
      sample ? `Sample: ${sample}.` : null,
      `Lifetime: ${lifetimeHours}h.`,
    ].filter(Boolean).join(" "),
  );
}

function handleTestClearCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /testclear.",
    );
  }

  const clearResult = clearNearbyDebrisForSession(session);
  if (!clearResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Clearing nearby debris failed.",
    );
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    clearResult.data && clearResult.data.changes,
  );

  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${Number((clearResult.data && clearResult.data.removed || []).length) || 0} wrecks/containers within 20 km.`,
  );
}

function handleSystemJunkClearCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /sysjunkclear.",
    );
  }

  const clearResult = clearSystemDebrisForSession(session);
  if (!clearResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Clearing system debris failed.",
    );
  }

  syncSpaceRootInventoryChangesToSession(
    session,
    clearResult.data && clearResult.data.changes,
  );

  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${Number((clearResult.data && clearResult.data.removed || []).length) || 0} wrecks/containers across the current solar system.`,
  );
}

function handleSuicideCommand(session, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /suicide.",
    );
  }

  const destroyResult = destroySessionShip(session, {
    sessionChangeReason: "selfdestruct",
  });
  if (!destroyResult.success || !destroyResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      destroyResult.errorMsg === "ALREADY_IN_CAPSULE"
        ? "You are already in a capsule."
        : "Ship self-destruction failed.",
    );
  }

  syncInventoryChangesToSession(session, destroyResult.data.wreckChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.movedChanges || []);
  syncInventoryChangesToSession(session, destroyResult.data.destroyChanges || []);

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Self-destructed ship ${destroyResult.data.destroyedShipID}.`,
      `Wreck: ${destroyResult.data.wreck.itemName} (${destroyResult.data.wreck.itemID}).`,
      `Capsule: ${destroyResult.data.capsule.itemName} (${destroyResult.data.capsule.itemID}).`,
    ].join(" "),
  );
}

function handleDeathTestCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /deathtest.",
    );
  }

  const parsed = parseOptionalTypeAndCount(argumentText);
  let shipType = null;
  if (parsed.typeName) {
    const lookup = resolveShipByName(parsed.typeName);
    if (!lookup.success || !lookup.match) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${parsed.typeName}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type is ambiguous: ${parsed.typeName}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }
    shipType = lookup.match;
  } else {
    shipType = resolveShipByTypeID(session.shipTypeID || (session._space && session._space.shipTypeID));
    if (!shipType) {
      const activeShip = getActiveShipRecord(session.characterID);
      shipType = activeShip ? resolveShipByTypeID(activeShip.typeID) : null;
    }
  }

  const spawnResult = spawnShipDeathTestField(session, {
    shipType,
    count: parsed.count,
  });
  if (!spawnResult.success || !spawnResult.data) {
    return handledResult(
      chatHub,
      session,
      options,
      "Death-test hull spawning failed.",
    );
  }

  if (spawnResult.data.completionPromise && chatHub) {
    const feedbackChannel = getFeedbackChannel(options);
    spawnResult.data.completionPromise
      .then((result) => {
        if (!result || !session || !session.characterID) {
          return;
        }
        chatHub.sendSystemMessage(
          session,
          `Detonated ${result.destroyed.length}/${result.spawnedCount} ${result.shipType.name} hulls into wrecks.`,
          feedbackChannel,
        );
      })
      .catch((error) => {
        log.warn(`[ChatCommands] /deathtest completion failed: ${error.message}`);
      });
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${spawnResult.data.spawned.length} ${spawnResult.data.shipType.name} hulls across 20 km. Detonation in ${(spawnResult.data.delayMs / 1000).toFixed(1)}s sim time.`,
  );
}

function formatNpcSpawnSummary(result, commandLabel) {
  const data = result && result.data ? result.data : null;
  if (data && Array.isArray(data.spawned) && data.spawned.length > 0) {
    const spawnGroups = new Map();
    let totalLootEntries = 0;
    let totalModules = 0;

    for (const entry of data.spawned) {
      const profileName =
        entry &&
        entry.definition &&
        entry.definition.profile &&
        entry.definition.profile.name
          ? entry.definition.profile.name
          : "Unknown NPC";
      spawnGroups.set(profileName, (spawnGroups.get(profileName) || 0) + 1);
      totalLootEntries += Array.isArray(entry && entry.lootEntries)
        ? entry.lootEntries.length
        : 0;
      totalModules += Array.isArray(entry && entry.fittedModules)
        ? entry.fittedModules.length
        : 0;
    }

    const composition = [...spawnGroups.entries()]
      .map(([name, count]) => `${count}x ${name}`)
      .join(", ");
    const selectionText = data.selectionName
      ? ` from ${data.selectionName}`
      : "";
    const lootSummary = totalLootEntries > 0
      ? `Seeded ${totalLootEntries} random cargo loot entr${totalLootEntries === 1 ? "y" : "ies"}.`
      : "No extra cargo loot was seeded.";
    const partialSummary = data.partialFailure
      ? ` Spawn stopped at ${data.partialFailure.failedAt}/${data.requestedAmount}: ${data.partialFailure.errorMsg}.`
      : "";
    return [
      `Spawned ${data.spawned.length} hull${data.spawned.length === 1 ? "" : "s"}${selectionText}: ${composition}.`,
      `Fitted ${totalModules} laser module${totalModules === 1 ? "" : "s"} and set preferred target to your ship.`,
      "These command-spawned NPCs are transient and are not written to disk.",
      lootSummary,
      partialSummary.trim(),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (!data || !data.definition || !data.entity) {
    return `${commandLabel} spawn completed.`;
  }

  const lootEntries = Array.isArray(data.lootEntries) ? data.lootEntries : [];
  const lootSummary = lootEntries.length > 0
    ? `Seeded ${lootEntries.length} random cargo loot entr${lootEntries.length === 1 ? "y" : "ies"}.`
    : "No extra cargo loot was seeded.";
  const moduleCount = Array.isArray(data.fittedModules) ? data.fittedModules.length : 0;
  return [
    `Spawned ${data.definition.profile.name} as entity ${data.entity.itemID}.`,
    `Hull: ${data.shipItem && data.shipItem.itemName ? data.shipItem.itemName : data.definition.profile.shipNameTemplate}.`,
    `Fitted ${moduleCount} laser module${moduleCount === 1 ? "" : "s"} and set preferred target to your ship.`,
    "This command-spawned NPC is transient and is not written to disk.",
    lootSummary,
  ].join(" ");
}

function handleNpcCommand(session, argumentText, chatHub, options) {
  const parsedArguments = parseNpcSpawnArguments(argumentText);
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /npc [amount] [profile|pool]",
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC spawn count must be between 1 and ${MAX_NPC_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.spawnNpcBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "NPC spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /npc.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `NPC profile or pool not found: ${parsedArguments.query || "default"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `NPC profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "NPC_DEFINITION_INCOMPLETE") {
      message = "The selected NPC profile is missing authored loadout or behavior data.";
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected NPC pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `NPC spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatNpcSpawnSummary(result, "/npc"),
  );
}

function handleConcordCommand(session, argumentText, chatHub, options) {
  const parsedArguments = parseNpcSpawnArguments(argumentText);
  if (!parsedArguments.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /concord [amount] [profile|pool]",
    );
  }
  if (parsedArguments.amount > MAX_NPC_COMMAND_SPAWN_COUNT) {
    return handledResult(
      chatHub,
      session,
      options,
      `CONCORD spawn count must be between 1 and ${MAX_NPC_COMMAND_SPAWN_COUNT}.`,
    );
  }

  const result = npcService.spawnConcordBatchForSession(session, {
    profileQuery: parsedArguments.query,
    amount: parsedArguments.amount,
    transient: true,
  });
  if (!result.success) {
    const suggestions = formatSuggestions(result.suggestions);
    let message = "CONCORD spawn failed.";
    if (result.errorMsg === "NOT_IN_SPACE") {
      message = "You must be in space before using /concord.";
    } else if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship was not found in space.";
    } else if (result.errorMsg === "PROFILE_NOT_FOUND") {
      message = `CONCORD profile or pool not found: ${parsedArguments.query || "concord"}.${suggestions}`;
    } else if (result.errorMsg === "PROFILE_AMBIGUOUS") {
      message = `CONCORD profile or pool is ambiguous: ${parsedArguments.query}.${suggestions}`;
    } else if (result.errorMsg === "POOL_EMPTY") {
      message = `The selected CONCORD pool has no spawnable authored entries.${suggestions}`.trim();
    } else {
      message = `CONCORD spawn failed: ${result.errorMsg || "UNKNOWN_ERROR"}.${suggestions}`.trim();
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatNpcSpawnSummary(result, "/concord"),
  );
}

function handleNpcClearCommand(session, argumentText, chatHub, options) {
  const parsed = parseNpcClearArguments(argumentText);
  if (!parsed.success || !parsed.entityType) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /npcclear <system [npc|concord|all]|radius <meters> [npc|concord|all]>",
    );
  }

  const systemID = resolveSessionSolarSystemID(session);
  if (!systemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved for /npcclear.",
    );
  }

  let result = null;
  if (parsed.scope === "radius") {
    if (!isSpaceSessionReady(session) || !resolveSessionShipEntity(session)) {
      return handledResult(
        chatHub,
        session,
        options,
        "You must be in space before using /npcclear radius.",
      );
    }

    result = npcService.clearNpcControllersForSessionRadius(session, {
      entityType: parsed.entityType,
      radiusMeters: parsed.radiusMeters,
      removeContents: true,
    });
  } else {
    result = npcService.clearNpcControllersInSystem(systemID, {
      entityType: parsed.entityType,
      removeContents: true,
    });
  }

  if (!result || !result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `NPC clear failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  const scopeText = parsed.scope === "radius"
    ? `within ${formatDistanceMeters(parsed.radiusMeters)}`
    : `in system ${systemID}`;
  const entityLabel = parsed.entityType === "all"
    ? "NPC/CONCORD"
    : parsed.entityType === "concord"
      ? "CONCORD"
      : "NPC";
  return handledResult(
    chatHub,
    session,
    options,
    `Cleared ${result.data.destroyedCount} ${entityLabel} controller${result.data.destroyedCount === 1 ? "" : "s"} ${scopeText}.`,
  );
}

function formatGateOperatorStatus(label, state) {
  const sourceLabel = state && state.source === "generated"
    ? "generated default startup coverage"
    : state && state.source === "authored"
      ? "data-authored startup rules"
      : state && state.source === "startup"
        ? "startup rules"
        : "dynamic operator rule";
  const enabledText = state && state.enabled ? "ON" : "OFF";
  return `${label} is ${enabledText} in system ${state && state.systemID ? state.systemID : "unknown"} (${sourceLabel}, live respawn enabled while active).`;
}

function handleGateOperatorCommand(session, argumentText, chatHub, options, operatorKind) {
  const systemID = resolveSessionSolarSystemID(session);
  if (!systemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved for gate operator controls.",
    );
  }

  const parsed = parseToggleCommandArgument(argumentText);
  if (!parsed.success) {
    const usageLabel = operatorKind === npcService.GATE_OPERATOR_KIND.CONCORD
      ? "/gateconcord [on|off]"
      : "/gaterats [on|off]";
    return handledResult(chatHub, session, options, `Usage: ${usageLabel}`);
  }

  const label = operatorKind === npcService.GATE_OPERATOR_KIND.CONCORD
    ? "Gate CONCORD"
    : "Gate rats";
  const result = parsed.mode === "status"
    ? npcService.getGateOperatorState(systemID, operatorKind)
    : npcService.setGateOperatorEnabled(systemID, operatorKind, parsed.mode === "on");
  if (!result || !result.success || !result.data) {
    return handledResult(
      chatHub,
      session,
      options,
      `${label} command failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    formatGateOperatorStatus(label, result.data),
  );
}

function handleInvuCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /invu.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  let result = null;
  if (!trimmed) {
    result = npcService.toggleCharacterNpcInvulnerability(session.characterID);
  } else {
    const parsed = parseToggleCommandArgument(trimmed);
    if (!parsed.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /invu [on|off]",
      );
    }

    if (parsed.mode === "status") {
      const enabled = npcService.isCharacterInvulnerable(session.characterID);
      return handledResult(
        chatHub,
        session,
        options,
        `Invulnerability is ${enabled ? "ON" : "OFF"}. Rats and CONCORD ${enabled ? "will" : "will not"} ignore you.`,
      );
    }

    result = npcService.setCharacterNpcInvulnerability(
      session.characterID,
      parsed.mode === "on",
    );
  }

  if (!result || !result.success || !result.data) {
    return handledResult(
      chatHub,
      session,
      options,
      `Invulnerability update failed: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}.`,
    );
  }

  if (isSpaceSessionReady(session)) {
    const scene = spaceRuntime.ensureScene(session._space.systemID);
    if (scene) {
      npcService.tickScene(scene, scene.getCurrentSimTimeMs());
    }
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Invulnerability is now ${result.data.invulnerable ? "ON" : "OFF"}. Rats and CONCORD ${result.data.invulnerable ? "will" : "will not"} ignore you.`,
  );
}

function handleHealCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /heal.",
    );
  }

  if (isSpaceSessionReady(session)) {
    const result = spaceRuntime.healSessionShipResources(session, {
      // /heal is a live resource restore, not a real session move. Avoid the
      // owner SetState rebase path here because that packet can rebuild the
      // local ballpark without the follow-up module/charge hydration that
      // login, undock, jump, and other attach flows intentionally queue.
      refreshOwnerDamagePresentation: false,
    });
    if (!result || !result.success) {
      const message =
        result && result.errorMsg === "SCENE_NOT_FOUND"
          ? "Your ship is not loaded in space yet."
          : "Active ship not found in space.";
      return handledResult(chatHub, session, options, message);
    }

    return handledResult(
      chatHub,
      session,
      options,
      "Restored full shields, armor, hull, and capacitor on your active ship.",
    );
  }

  const updateResult = healDockedShipForSession(session);
  if (!updateResult || !updateResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      "Active ship not found.",
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    "Restored full shields, armor, hull, and capacitor on your active ship.",
  );
}

function buildCrimewatchStatusMessage(session) {
  const characterID = session && session.characterID ? session.characterID : 0;
  const now = getCrimewatchReferenceMsForSession(session);
  const state = characterID
    ? crimewatchState.getCharacterCrimewatchState(characterID, now)
    : null;
  const effectiveState = state || {
    safetyLevel: crimewatchState.SAFETY_LEVEL_FULL,
    weaponTimerExpiresAtMs: 0,
    pvpTimerExpiresAtMs: 0,
    npcTimerExpiresAtMs: 0,
    criminalTimerExpiresAtMs: 0,
    disapprovalTimerExpiresAtMs: 0,
    criminal: false,
    suspect: false,
  };

  const remainingWeaponMs = Math.max(
    0,
    Number(effectiveState.weaponTimerExpiresAtMs || 0) - now,
  );
  const remainingPvpMs = Math.max(
    0,
    Number(effectiveState.pvpTimerExpiresAtMs || 0) - now,
  );
  const remainingNpcMs = Math.max(
    0,
    Number(effectiveState.npcTimerExpiresAtMs || 0) - now,
  );
  const remainingPenaltyMs = Math.max(
    0,
    Number(effectiveState.criminalTimerExpiresAtMs || 0) - now,
  );
  const remainingDisapprovalMs = Math.max(
    0,
    Number(effectiveState.disapprovalTimerExpiresAtMs || 0) - now,
  );
  const flagLabel = effectiveState.criminal && remainingPenaltyMs > 0
    ? `CRIMINAL (${formatDurationBriefMs(remainingPenaltyMs)})`
    : effectiveState.suspect && remainingPenaltyMs > 0
      ? `SUSPECT (${formatDurationBriefMs(remainingPenaltyMs)})`
      : "CLEAR";

  return [
    `Crimewatch: safety ${formatCrimewatchSafetyLabel(effectiveState.safetyLevel)}.`,
    `Weapon ${formatDurationBriefMs(remainingWeaponMs)}.`,
    `PvP ${formatDurationBriefMs(remainingPvpMs)}.`,
    `NPC ${formatDurationBriefMs(remainingNpcMs)}.`,
    `Flag ${flagLabel}.`,
    `Disapproval ${formatDurationBriefMs(remainingDisapprovalMs)}.`,
  ].join(" ");
}

function synchronizeCrimewatchSessionState(session, scene, now) {
  const activeScene = scene || (
    isSpaceSessionReady(session)
      ? spaceRuntime.ensureScene(session._space.systemID)
      : null
  );
  if (!activeScene) {
    return;
  }

  const referenceNow = Number.isFinite(Number(now))
    ? Number(now)
    : activeScene.getCurrentSimTimeMs();
  crimewatchState.tickScene(activeScene, referenceNow);
}

function handleCrimewatchCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /cwatch.",
    );
  }

  const usage =
    "Usage: /cwatch [status|clear|safety <full|partial|none>|weapon <off|seconds>|pvp <off|seconds>|npc <off|seconds>|criminal <off|seconds>|suspect <off|seconds>|disapproval <off|seconds>]";
  const trimmed = String(argumentText || "").trim();
  const scene = isSpaceSessionReady(session)
    ? spaceRuntime.ensureScene(session._space.systemID)
    : null;
  const now = scene ? scene.getCurrentSimTimeMs() : getCrimewatchReferenceMsForSession(session);
  const offenderEntity = scene ? resolveSessionShipEntity(session) : null;

  if (!trimmed || ["status", "state"].includes(trimmed.toLowerCase())) {
    return handledResult(
      chatHub,
      session,
      options,
      buildCrimewatchStatusMessage(session),
    );
  }

  if (["clear", "reset"].includes(trimmed.toLowerCase())) {
    const result = crimewatchState.setCharacterCrimewatchDebugState(
      session.characterID,
      { clearAll: true },
      {
        now,
        systemID: resolveSessionSolarSystemID(session),
        scene,
        offenderEntity,
      },
    );
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
      );
    }

    synchronizeCrimewatchSessionState(session, scene, now);
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch timers cleared. ${buildCrimewatchStatusMessage(session)}`,
    );
  }

  const [subcommandRaw, ...rest] = trimmed.split(/\s+/);
  const subcommand = String(subcommandRaw || "").trim().toLowerCase();
  const valueText = rest.join(" ").trim();
  let updates = null;

  if (subcommand === "safety") {
    const parsed = parseCrimewatchSafetyArgument(valueText);
    if (!parsed.success) {
      return handledResult(chatHub, session, options, usage);
    }
    updates = {
      safetyLevel: parsed.safetyLevel,
    };
  } else if (
    subcommand === "weapon" ||
    subcommand === "pvp" ||
    subcommand === "npc" ||
    subcommand === "criminal" ||
    subcommand === "suspect" ||
    subcommand === "disapproval"
  ) {
    const defaultDurationMs =
      subcommand === "weapon"
        ? crimewatchState.WEAPON_TIMER_DURATION_MS
        : subcommand === "pvp"
          ? crimewatchState.PVP_TIMER_DURATION_MS
          : subcommand === "npc"
            ? crimewatchState.NPC_TIMER_DURATION_MS
            : subcommand === "disapproval"
              ? crimewatchState.DISAPPROVAL_TIMER_DURATION_MS
              : crimewatchState.CRIMINAL_TIMER_DURATION_MS;
    const parsed = parseCrimewatchDurationArgument(valueText, defaultDurationMs);
    if (!parsed.success) {
      return handledResult(chatHub, session, options, usage);
    }

    if (subcommand === "weapon") {
      updates = { weaponTimerMs: parsed.durationMs };
    } else if (subcommand === "pvp") {
      updates = { pvpTimerMs: parsed.durationMs };
    } else if (subcommand === "npc") {
      updates = { npcTimerMs: parsed.durationMs };
    } else if (subcommand === "disapproval") {
      updates = { disapprovalTimerMs: parsed.durationMs };
    } else if (subcommand === "criminal") {
      updates = parsed.durationMs > 0
        ? {
          criminal: true,
          suspect: false,
          criminalTimerMs: parsed.durationMs,
          refreshConcord: true,
        }
        : {
          criminal: false,
          suspect: false,
          criminalTimerMs: 0,
        };
    } else {
      updates = parsed.durationMs > 0
        ? {
          suspect: true,
          criminal: false,
          criminalTimerMs: parsed.durationMs,
        }
        : {
          suspect: false,
          criminal: false,
          criminalTimerMs: 0,
        };
    }
  } else {
    return handledResult(chatHub, session, options, usage);
  }

  const result = crimewatchState.setCharacterCrimewatchDebugState(
    session.characterID,
    updates,
    {
      now,
      systemID: resolveSessionSolarSystemID(session),
      scene,
      offenderEntity,
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  synchronizeCrimewatchSessionState(session, scene, now);
  return handledResult(
    chatHub,
    session,
    options,
    `Crimewatch updated. ${buildCrimewatchStatusMessage(session)}`,
  );
}

function handleNaughtyCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /naughty.",
    );
  }

  if (String(argumentText || "").trim()) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /naughty",
    );
  }

  const scene = spaceRuntime.ensureScene(session._space.systemID);
  const offenderEntity = resolveSessionShipEntity(session);
  if (!scene || !offenderEntity) {
    return handledResult(
      chatHub,
      session,
      options,
      "Active ship not found in space.",
    );
  }

  const now = scene.getCurrentSimTimeMs();
  const result = crimewatchState.triggerHighSecCriminalOffense(
    scene,
    offenderEntity,
    {
      now,
      reason: "NAUGHTY_COMMAND",
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Crimewatch update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  synchronizeCrimewatchSessionState(session, scene, now);
  if (!result.data || result.data.applied !== true) {
    const reason = String(result.data && result.data.reason || "").trim().toUpperCase();
    const message =
      reason === "NOT_HIGHSEC"
        ? "You are not in a high-security solar system, so /naughty only refreshed the local combat timers and did not schedule CONCORD."
        : "Crimewatch did not create a criminal response.";
    return handledResult(
      chatHub,
      session,
      options,
      `${message} ${buildCrimewatchStatusMessage(session)}`,
    );
  }

  const responseDueMs = Math.max(
    0,
    Number(result.data.concordResponseDueAtMs || 0) - now,
  );
  const securityPenalty = result.data.securityStatusPenalty || null;
  const securitySuffix =
    securityPenalty && securityPenalty.applied === true
      ? ` Security status is now ${Number(securityPenalty.nextSecurityStatus || 0).toFixed(2)}.`
      : "";
  return handledResult(
    chatHub,
    session,
    options,
    `Crimewatch offense simulated. CONCORD ${responseDueMs > 0 ? `will respond in about ${formatDurationBriefMs(responseDueMs)}` : "response is active now"}. ${buildCrimewatchStatusMessage(session)}${securitySuffix}`,
  );
}

function handleSecurityStatusCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /secstatus.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  const currentSecurityStatus = crimewatchState.getCharacterSecurityStatus(
    session.characterID,
    0,
  );
  if (!trimmed) {
    return handledResult(
      chatHub,
      session,
      options,
      `Security status is ${currentSecurityStatus.toFixed(2)}. Use /secstatus <value> to set it (${crimewatchState.SECURITY_STATUS_MIN.toFixed(0)} to ${crimewatchState.SECURITY_STATUS_MAX.toFixed(0)}).`,
    );
  }

  const requestedSecurityStatus = Number(trimmed);
  if (!Number.isFinite(requestedSecurityStatus)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /secstatus [status]",
    );
  }

  const scene = isSpaceSessionReady(session)
    ? spaceRuntime.ensureScene(session._space.systemID)
    : null;
  const entity = scene ? resolveSessionShipEntity(session) : null;
  const now = scene ? scene.getCurrentSimTimeMs() : Date.now();
  const result = crimewatchState.setCharacterSecurityStatus(
    session.characterID,
    requestedSecurityStatus,
    {
      now,
      scene,
      entity,
      session,
    },
  );
  if (!result.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Security status update failed: ${result.errorMsg || "UNKNOWN_ERROR"}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Security status set to ${result.data.securityStatus.toFixed(2)} (requested ${requestedSecurityStatus.toFixed(2)}; clamped to ${crimewatchState.SECURITY_STATUS_MIN.toFixed(0)} to ${crimewatchState.SECURITY_STATUS_MAX.toFixed(0)}).`,
  );
}

function handleFireCommand(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /fire.",
    );
  }

  const lookupText = String(argumentText || "").trim() || DEFAULT_FIRE_TARGET_NAME;
  const shipLookup = /^\d+$/.test(lookupText)
    ? {
      success: Boolean(resolveShipByTypeID(Number(lookupText) || 0)),
      match: resolveShipByTypeID(Number(lookupText) || 0),
      suggestions: [],
      errorMsg: "SHIP_NOT_FOUND",
    }
    : resolveShipByName(lookupText);
  if (!shipLookup.success || !shipLookup.match) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship type not found: ${lookupText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship type is ambiguous: ${lookupText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!anchorEntity) {
    return handledResult(chatHub, session, options, "Active ship was not found in space.");
  }

  const spawnResult = spaceRuntime.spawnDynamicShip(session._space.systemID, {
    typeID: shipLookup.match.typeID,
    groupID: shipLookup.match.groupID,
    categoryID: shipLookup.match.categoryID || 6,
    itemName: `${shipLookup.match.name} Dummy`,
    ownerID: Number(session.characterID || session.charid || 0) || 0,
    characterID: 0,
    corporationID: Number(session.corporationID || 0) || 0,
    allianceID: Number(session.allianceID || 0) || 0,
    warFactionID: Number(session.warFactionID || 0) || 0,
    ...buildOffsetSpaceSpawnState(anchorEntity, 20_000),
    conditionState: {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
    },
  });
  if (!spawnResult.success || !spawnResult.data || !spawnResult.data.entity) {
    return handledResult(chatHub, session, options, "Combat dummy spawn failed.");
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Spawned ${shipLookup.match.name} dummy hull ${spawnResult.data.entity.itemID} roughly 20 km away.`,
  );
}

function handleFire2Command(session, argumentText, chatHub, options) {
  if (!isSpaceSessionReady(session)) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space before using /fire2.",
    );
  }

  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!anchorEntity) {
    return handledResult(chatHub, session, options, "Active ship was not found in space.");
  }

  const trimmedArgument = String(argumentText || "").trim();
  const requestedFleetSize = trimmedArgument
    ? normalizePositiveInteger(trimmedArgument)
    : DEFAULT_FIRE2_FLEET_SIZE;
  if (trimmedArgument && !requestedFleetSize) {
    return handledResult(chatHub, session, options, "Usage: /fire2 [count]");
  }

  const fleetLookup = resolveFire2FleetShipTypes();
  if (!fleetLookup.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `The default /fire2 fleet could not be assembled from local ship data (${fleetLookup.availableCount || 0}/10 available).`,
    );
  }

  const formation = buildFire2FleetFormation(
    anchorEntity,
    fleetLookup.ships,
    requestedFleetSize,
  );
  const spawned = [];
  for (const entry of formation) {
    const shipType = entry.shipType;
    const spawnResult = spaceRuntime.spawnDynamicShip(session._space.systemID, {
      typeID: shipType.typeID,
      groupID: shipType.groupID,
      categoryID: shipType.categoryID || 6,
      itemName: `${shipType.name} Fleet Dummy`,
      ownerID: Number(session.characterID || session.charid || 0) || 0,
      characterID: 0,
      corporationID: Number(session.corporationID || 0) || 0,
      allianceID: Number(session.allianceID || 0) || 0,
      warFactionID: Number(session.warFactionID || 0) || 0,
      ...entry.spawnState,
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    });
    if (spawnResult.success && spawnResult.data && spawnResult.data.entity) {
      spawned.push({
        shipType,
        entity: spawnResult.data.entity,
      });
    }
  }

  if (spawned.length === 0) {
    return handledResult(chatHub, session, options, "Fleet dummy spawn failed.");
  }

  const leadShip = spawned[0] && spawned[0].shipType;
  const trailingShip = spawned[spawned.length - 1] && spawned[spawned.length - 1].shipType;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `Spawned ${spawned.length}/${formation.length} fleet dummies in a staggered arrowhead roughly ${Math.round(FIRE2_BASE_DISTANCE_METERS / 1000)} km ahead.`,
      leadShip && trailingShip
        ? `Formation runs ${leadShip.name} -> ${trailingShip.name} from largest to smallest.`
        : null,
    ].filter(Boolean).join(" "),
  );
}

function handleGmSkillsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmskills.",
    );
  }

  const unpublishedSkillTypes = getUnpublishedSkillTypes({ refresh: true });
  if (unpublishedSkillTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No unpublished skill types are available in local reference data.",
    );
  }

  const grantedSkills = ensureCharacterUnpublishedSkills(session.characterID);
  const polarisSkill = unpublishedSkillTypes.find((skillType) => Number(skillType.typeID) === 9955);
  const sampleNames = grantedSkills
    .slice(0, 5)
    .map((skill) => `${skill.itemName}(${skill.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      grantedSkills.length > 0
        ? `Ensured ${grantedSkills.length} GM/unpublished skills are at level V. You now have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}.`
        : `No GM/unpublished skills needed changes. You already have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}.`,
      polarisSkill ? `Catalog includes ${polarisSkill.name}(${polarisSkill.typeID}).` : null,
      sampleNames ? `Added: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleAllSkillsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /allskills.",
    );
  }

  const publishedSkillTypes = getPublishedSkillTypes({ refresh: true });
  if (publishedSkillTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No published skill types are available in local reference data.",
    );
  }

  const grantedSkills = ensureCharacterPublishedSkills(session.characterID);
  const sampleNames = grantedSkills
    .slice(0, 5)
    .map((skill) => `${skill.itemName}(${skill.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      grantedSkills.length > 0
        ? `Ensured ${grantedSkills.length} published skills are at level V. You now have ${publishedSkillTypes.length}/${publishedSkillTypes.length}.`
        : `No published skills needed changes. You already have ${publishedSkillTypes.length}/${publishedSkillTypes.length}.`,
      sampleNames ? `Updated: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleGmShipsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmships.",
    );
  }

  if (!session.stationid && !session.stationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /gmships.",
    );
  }

  const unpublishedShips = getUnpublishedShipTypes();
  if (unpublishedShips.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No unpublished ship types are available in local reference data.",
    );
  }

  const createdShips = [];
  for (const shipType of unpublishedShips) {
    const spawnResult = spawnShipInHangarForSession(session, shipType);
    if (!spawnResult.success) {
      let message = "GM ship bulk spawn failed.";
      if (spawnResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before using /gmships.";
      } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character before using /gmships.";
      }
      return handledResult(chatHub, session, options, message);
    }
    createdShips.push(spawnResult.ship);
  }

  const sampleNames = unpublishedShips
    .slice(0, 5)
    .map((shipType) => `${shipType.name}(${shipType.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Added ${createdShips.length}/${unpublishedShips.length} unpublished ships to your hangar.`,
      sampleNames ? `Sample: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handlePropCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /prop.",
    );
  }

  if (!session.stationid && !session.stationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /prop.",
    );
  }

  const propulsionTypes = getPropulsionCommandItemTypes();
  if (propulsionTypes.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No propulsion module types matched the /prop filter in local reference data.",
    );
  }

  const createdItems = [];
  for (const itemType of propulsionTypes) {
    const giveResult = giveItemToHangarForSession(session, itemType, 1);
    if (!giveResult.success) {
      let message = "Propulsion module grant failed.";
      if (giveResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before using /prop.";
      } else if (giveResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character before using /prop.";
      } else if (giveResult.errorMsg === "ITEM_TYPE_NOT_FOUND") {
        message = `A /prop item type could not be resolved: ${itemType.name}.`;
      }
      return handledResult(chatHub, session, options, message);
    }
    createdItems.push(...(Array.isArray(giveResult.data.items) ? giveResult.data.items : []));
  }

  const sampleNames = propulsionTypes
    .slice(0, 8)
    .map((itemType) => `${itemType.name}(${itemType.typeID})`)
    .join(", ");

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Added ${createdItems.length}/${propulsionTypes.length} propulsion modules to your station hangar.`,
      "Included: T2, faction, and officer afterburners/microwarpdrives.",
      sampleNames ? `Sample: ${sampleNames}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleGmWeaponsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /gmweapons.",
    );
  }

  const stationID = Number(session.stationid || session.stationID || 0) || 0;
  if (stationID <= 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be docked before using /gmweapons.",
    );
  }

  if (activeGmWeaponsJobs.has(Number(session.characterID))) {
    const existingJob = activeGmWeaponsJobs.get(Number(session.characterID));
    return handledResult(
      chatHub,
      session,
      options,
      `A /gmweapons seed job is already running (${existingJob.nextIndex}/${existingJob.entries.length} grants queued).`,
    );
  }

  const plan = getGmWeaponsSeedPlan();
  if (!plan.entries.length) {
    return handledResult(
      chatHub,
      session,
      options,
      "No non-T1 weapon or ammo types matched the /gmweapons filter in local reference data.",
    );
  }

  const sample = plan.weaponTypes
    .slice(0, 6)
    .map((itemType) => `${itemType.name}(${itemType.typeID})`)
    .join(", ");

  const job = {
    session,
    characterID: Number(session.characterID) || 0,
    stationID,
    feedbackChannel: getFeedbackChannel(options),
    entries: plan.entries,
    nextIndex: 0,
    weaponTypeCount: plan.weaponTypes.length,
    ammoTypeCount: plan.ammoTypes.length,
    sample,
  };
  activeGmWeaponsJobs.set(job.characterID, job);
  setImmediate(() => continueGmWeaponsSeedJob(job, chatHub));

  return handledResult(
    chatHub,
    session,
    options,
    [
      `Started /gmweapons in the background for station ${stationID}.`,
      `Queue: ${plan.weaponTypes.length} weapon stacks x${GM_WEAPONS_MODULE_QUANTITY} and ${plan.ammoTypes.length} ammo stacks x${GM_WEAPONS_AMMO_QUANTITY}.`,
      sample ? `Sample: ${sample}.` : null,
    ].filter(Boolean).join(" "),
  );
}

function handleSolarTeleport(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /solar.",
    );
  }

  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /solar <system name>",
    );
  }

  const lookup = resolveSolarSystemByName(argumentText);
  if (!lookup.success) {
    const message =
      lookup.errorMsg === "SOLAR_SYSTEM_NOT_FOUND"
        ? `Solar system not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
        : `Solar system name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const result = jumpSessionToSolarSystem(session, lookup.match.solarSystemID);
  if (!result.success) {
    let message = "Solar-system jump failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /solar.";
    } else if (result.errorMsg === "SOLAR_SYSTEM_NOT_FOUND") {
      message = `Solar system not found: ${lookup.match.solarSystemName}.`;
    } else if (result.errorMsg === "SOLAR_JUMP_IN_PROGRESS") {
      message = "A solar-system jump is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const spawnState = result.data && result.data.spawnState;
  const targetSolarSystem =
    (result.data && result.data.solarSystem) ||
    worldData.getSolarSystemByID(lookup.match.solarSystemID);
  const anchorText = spawnState
    ? ` near ${spawnState.anchorType} ${spawnState.anchorName}`
    : "";

  // The transition path should already send the correct full location identity.
  // Keep a command-side backstop here so /solar does not depend exclusively on
  // later session hydration if region/constellation drift again.
  reconcileSolarTargetSessionIdentity(session, targetSolarSystem);

  // Move Local before emitting feedback so slash responses do not land in the
  // new system while the client is still joined to the previous room.
  flushPendingLocalChannelSync(chatHub, session);

  return handledResult(
    chatHub,
    session,
    getPostLocalMoveFeedbackOptions(options),
    `Teleported to ${lookup.match.solarSystemName} (${lookup.match.solarSystemID})${anchorText}.`,
  );
}

function handleTransportCommand(session, argumentText, chatHub, options) {
  const usage = "Usage: /tr <me|characterID|entityID> <destination|pos=x,y,z|offset=x,y,z>";
  const tokens = String(argumentText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2) {
    return handledResult(chatHub, session, options, usage);
  }

  const targetResult = resolveTransportTargetDescriptor(session, tokens[0]);
  if (!targetResult.success) {
    const message =
      targetResult.errorMsg === "CHARACTER_NOT_SELECTED"
        ? "Select a character before using /tr."
        : targetResult.errorMsg === "TARGET_NOT_FOUND"
          ? `Transport target not found: ${tokens[0]}.`
          : usage;
    return handledResult(chatHub, session, options, message);
  }

  const targetDescriptor = targetResult.data;
  const destinationTokens = tokens
    .slice(1)
    .filter((token) => String(token || "").trim().toLowerCase() !== "noblock");
  if (destinationTokens.length === 0) {
    return handledResult(chatHub, session, options, usage);
  }

  let destination = null;
  const directPos = parseTransportVectorTag(destinationTokens[0], "pos");
  const directOffset = parseTransportVectorTag(destinationTokens[0], "offset");
  if (directPos) {
    if (destinationTokens.length !== 1) {
      return handledResult(chatHub, session, options, usage);
    }
    const pointContext = resolveTransportPointContext(session, targetDescriptor);
    if (!pointContext || !pointContext.systemID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Could not resolve a solar-system context for /tr pos=...",
      );
    }
    destination = {
      kind: "point",
      systemID: pointContext.systemID,
      point: directPos,
      direction: cloneSpaceVector(
        pointContext.direction,
        { x: 1, y: 0, z: 0 },
      ),
    };
  } else if (directOffset) {
    if (destinationTokens.length !== 1) {
      return handledResult(chatHub, session, options, usage);
    }
    const anchor =
      targetDescriptor.kind === "session"
        ? getSessionTransportAnchor(targetDescriptor.session)
        : buildTransportPointAnchor(
          targetDescriptor.entity,
          targetDescriptor.systemID,
        );
    destination = withTransportOffset(anchor, directOffset);
    if (!destination) {
      return handledResult(
        chatHub,
        session,
        options,
        "Could not apply /tr offset=... because the target has no in-space anchor.",
      );
    }
  } else {
    const coordinateTriplet = parseTransportCoordinateTriplet(destinationTokens);
    if (coordinateTriplet) {
      const pointContext = resolveTransportPointContext(session, targetDescriptor);
      if (!pointContext || !pointContext.systemID) {
        return handledResult(
          chatHub,
          session,
          options,
          "Could not resolve a solar-system context for raw /tr coordinates.",
        );
      }
      destination = {
        kind: "point",
        systemID: pointContext.systemID,
        point: coordinateTriplet,
        direction: cloneSpaceVector(
          pointContext.direction,
          { x: 1, y: 0, z: 0 },
        ),
      };
    } else {
      const offsetToken = parseTransportVectorTag(
        destinationTokens[destinationTokens.length - 1],
        "offset",
      );
      const baseTokens = offsetToken
        ? destinationTokens.slice(0, -1)
        : destinationTokens;
      if (baseTokens.length !== 1) {
        return handledResult(chatHub, session, options, usage);
      }

      const baseDestination = resolveTransportLocationToken(
        session,
        targetDescriptor,
        baseTokens[0],
      );
      if (!baseDestination) {
        return handledResult(
          chatHub,
          session,
          options,
          `Transport destination not found: ${baseTokens[0]}.`,
        );
      }

      if (offsetToken) {
        destination = withTransportOffset(baseDestination, offsetToken);
        if (!destination) {
          return handledResult(
            chatHub,
            session,
            options,
            "Could not apply /tr offset=... to that destination.",
          );
        }
      } else {
        destination = baseDestination;
      }
    }
  }

  const targetLabel = formatTransportTargetLabel(targetDescriptor);
  const destinationLabel = formatTransportDestinationLabel(destination);

  if (targetDescriptor.kind === "session") {
    const targetSession = targetDescriptor.session;
    if (!targetSession || !targetSession.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Transport target session is not available.",
      );
    }

    let crossedLocationBoundary = false;

    if (destination.kind === "solarSystem") {
      const result = jumpSessionToSolarSystem(
        targetSession,
        destination.solarSystemID,
      );
      if (!result.success) {
        return handledResult(
          chatHub,
          session,
          options,
          formatTransportTransitionError(
            result,
            `Failed to transport ${targetLabel} to ${destinationLabel}.`,
          ),
        );
      }
      crossedLocationBoundary = true;
    } else if (destination.kind === "station") {
      const result = jumpSessionToStation(
        targetSession,
        destination.stationID,
      );
      if (!result.success) {
        return handledResult(
          chatHub,
          session,
          options,
          formatTransportTransitionError(
            result,
            `Failed to transport ${targetLabel} to ${destinationLabel}.`,
          ),
        );
      }
      crossedLocationBoundary = true;
    } else if (destination.kind === "point") {
      const destinationSystemID = normalizePositiveInteger(destination.systemID);
      if (!destinationSystemID || !destination.point) {
        return handledResult(
          chatHub,
          session,
          options,
          "Point transport is missing a valid solar-system location.",
        );
      }

      const currentTargetSystemID = getSessionCurrentSolarSystemID(targetSession);
      const currentTargetStationID = getSessionDockedStationID(targetSession);
      if (
        currentTargetStationID ||
        !targetSession._space ||
        currentTargetSystemID !== destinationSystemID
      ) {
        const jumpResult = jumpSessionToSolarSystem(
          targetSession,
          destinationSystemID,
        );
        if (!jumpResult.success) {
          return handledResult(
            chatHub,
            session,
            options,
            formatTransportTransitionError(
              jumpResult,
              `Failed to transport ${targetLabel} to ${destinationLabel}.`,
            ),
          );
        }
        crossedLocationBoundary = true;
      }

      const teleportResult = spaceRuntime.teleportSessionShipToPoint(
        targetSession,
        destination.point,
        {
          direction: destination.direction,
          refreshOwnerSession: true,
        },
      );
      if (!teleportResult.success) {
        return handledResult(
          chatHub,
          session,
          options,
          teleportResult.errorMsg === "NOT_IN_SPACE"
            ? `Failed to transport ${targetLabel}: target is not in space.`
            : `Failed to teleport ${targetLabel} in space.`,
        );
      }
    } else {
      return handledResult(
        chatHub,
        session,
        options,
        `Unsupported /tr destination: ${destination.kind}.`,
      );
    }

    if (targetSession === session && crossedLocationBoundary) {
      const destinationSystemID =
        destination.kind === "solarSystem"
          ? destination.solarSystemID
          : destination.kind === "point"
            ? destination.systemID
            : normalizePositiveInteger(
              (worldData.getStationByID(destination.stationID) || {}).solarSystemID,
            );
      const destinationSystem = worldData.getSolarSystemByID(destinationSystemID);
      reconcileSolarTargetSessionIdentity(session, destinationSystem);
      flushPendingLocalChannelSync(chatHub, session);
      return handledResult(
        chatHub,
        session,
        getPostLocalMoveFeedbackOptions(options),
        `Transported ${targetLabel} to ${destinationLabel}.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Transported ${targetLabel} to ${destinationLabel}.`,
    );
  }

  if (destination.kind !== "point" || !destination.point) {
    return handledResult(
      chatHub,
      session,
      options,
      "Runtime entity /tr currently supports only in-space point moves.",
    );
  }

  if (
    normalizePositiveInteger(destination.systemID) !==
    normalizePositiveInteger(targetDescriptor.systemID)
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      "Runtime entities can only be moved within their current solar system.",
    );
  }

  const entityMoveResult = spaceRuntime.teleportDynamicEntityToPoint(
    targetDescriptor.systemID,
    targetDescriptor.entity.itemID,
    destination.point,
    {
      direction: destination.direction,
      refreshOwnerSession: false,
    },
  );
  if (!entityMoveResult.success) {
    return handledResult(
      chatHub,
      session,
      options,
      `Failed to transport ${targetLabel}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Transported ${targetLabel} to ${destinationLabel}.`,
  );
}

function handleHomeDock(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /dock.",
    );
  }

  const homeStationID = Number(
    session.homeStationID ||
    session.homestationid ||
    session.cloneStationID ||
    session.clonestationid ||
    0,
  ) || 0;

  if (!homeStationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Home station is not set for this character.",
    );
  }

  if (
    Number(session.stationid || session.stationID || 0) === homeStationID
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      `Already docked at home station ${homeStationID}.`,
    );
  }

  const result = jumpSessionToStation(session, homeStationID);
  if (!result.success) {
    let message = "Dock command failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /dock.";
    } else if (result.errorMsg === "STATION_NOT_FOUND") {
      message = `Home station not found: ${homeStationID}.`;
    } else if (result.errorMsg === "STATION_JUMP_IN_PROGRESS") {
      message = "A dock transition is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const station = result.data && result.data.station;
  flushPendingLocalChannelSync(chatHub, session);
  return handledResult(
    chatHub,
    session,
    getPostLocalMoveFeedbackOptions(options),
    `Docked at ${station ? station.stationName : `station ${homeStationID}`}.`,
  );
}

function handleEffectCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /effect.",
    );
  }

  if (!session._space || session.stationid || session.stationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space to use /effect.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  if (!trimmed || trimmed === "list" || trimmed === "help" || trimmed === "?") {
    return handledResult(chatHub, session, options, buildEffectListText());
  }

  const parts = trimmed.split(/\s+/);
  const verb = normalizeCommandName(parts[0]);
  const stop = verb === "stop" || verb === "off";
  const effectName = stop ? parts.slice(1).join(" ").trim() : trimmed;
  if (stop && !effectName) {
    const stopResult = stopAllPlayableEffects(session);
    if (!stopResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Effect stop failed.",
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Stopped all known self FX on your ship.",
    );
  }

  if (!effectName) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /effect <name>, /effect stop, or /effect stop <name>",
    );
  }

  const result = playPlayableEffect(session, effectName, { stop });
  if (!result.success) {
    if (result.errorMsg === "EFFECT_NOT_FOUND") {
      return handledResult(
        chatHub,
        session,
        options,
        `Unknown effect: ${effectName}. ${buildEffectListText()}`,
      );
    }
    if (result.errorMsg === "DESTINY_NOT_READY") {
      return handledResult(
        chatHub,
        session,
        options,
        "Space scene is not ready for FX yet. Try again in a moment.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_NO_STATION") {
      return handledResult(
        chatHub,
        session,
        options,
        "That debug/test effect needs a nearby station target, but there is no station entity available in the current scene.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_OUT_OF_RANGE") {
      const maxRangeText = formatDistanceMeters(
        result.data && result.data.maxRangeMeters,
      );
      const nearestDistanceText = formatDistanceMeters(
        result.data && result.data.nearestDistanceMeters,
      );
      const targetName =
        (result.data && result.data.targetName) || "the nearest station";
      return handledResult(
        chatHub,
        session,
        options,
        `That debug/test effect needs a nearby station target within ${maxRangeText}. The nearest station is ${targetName} at ${nearestDistanceText}.`,
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Effect playback failed.",
    );
  }

  const effect = result.data.effect;
  const autoTarget = result.data.autoTarget;
  if (effect.debugOnly && autoTarget) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship using nearby station ${autoTarget.targetName} (${autoTarget.targetID}) at ${formatDistanceMeters(autoTarget.distanceMeters)}.`,
    );
  }
  if (effect.debugOnly) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship.`,
    );
  }
  return handledResult(
    chatHub,
    session,
    options,
    `${stop ? "Stopped" : "Played"} ${effect.key} (${effect.guid}) on your ship.`,
  );
}

function handleLoadSystemCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before loading stargate destination systems.",
    );
  }

  const currentSystemID = getActiveSolarSystemID(session);
  if (!currentSystemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved.",
    );
  }

  const stargates = worldData.getStargatesForSystem(currentSystemID);
  if (stargates.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No stargates found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const destinationSystemIDs = [...new Set(
    stargates
      .map((stargate) => normalizePositiveInteger(stargate.destinationSolarSystemID))
      .filter((systemID) => systemID && systemID !== currentSystemID),
  )];
  if (destinationSystemIDs.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No valid stargate destination systems found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const alreadyLoaded = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  spaceRuntime.ensureScene(currentSystemID, {
    refreshStargates: false,
    broadcastStargateChanges: false,
  });
  const activationChanges = spaceRuntime.preloadSolarSystems(destinationSystemIDs, {
    broadcast: true,
  });
  const loadedNow = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const newlyLoaded = loadedNow.filter(
    (systemID) => !alreadyLoaded.includes(systemID),
  );
  const failed = destinationSystemIDs.filter(
    (systemID) => !loadedNow.includes(systemID),
  );

  return handledResult(
    chatHub,
    session,
    options,
    [
      `/loadsys ${formatSolarSystemLabel(currentSystemID)}:`,
      `loaded ${newlyLoaded.length}/${destinationSystemIDs.length} destination systems`,
      `(${formatSolarSystemList(newlyLoaded)})`,
      alreadyLoaded.length > 0
        ? `already loaded: ${formatSolarSystemList(alreadyLoaded)}`
        : null,
      failed.length > 0
        ? `failed: ${formatSolarSystemList(failed)}`
        : null,
      `gate updates emitted: ${activationChanges.length}.`,
    ].filter(Boolean).join(" "),
  );
}

function handleLoadAllSystemsCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before loading all solar systems.",
    );
  }

  const solarSystemIDs = worldData.getSolarSystems()
    .map((system) => normalizePositiveInteger(system && system.solarSystemID))
    .filter(Boolean);
  if (solarSystemIDs.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      "No solar systems are available to preload.",
    );
  }

  const alreadyLoaded = solarSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const activationChanges = spaceRuntime.preloadSolarSystems(solarSystemIDs, {
    broadcast: true,
  });
  const loadedNow = solarSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const newlyLoaded = loadedNow.filter(
    (systemID) => !alreadyLoaded.includes(systemID),
  );
  const failed = solarSystemIDs.filter(
    (systemID) => !loadedNow.includes(systemID),
  );

  return handledResult(
    chatHub,
    session,
    options,
    [
      "/loadallsys:",
      `loaded ${loadedNow.length}/${solarSystemIDs.length} solar systems.`,
      `newly loaded: ${newlyLoaded.length}.`,
      `already loaded: ${alreadyLoaded.length}.`,
      failed.length > 0 ? `failed: ${failed.length}.` : null,
      `gate updates emitted: ${activationChanges.length}.`,
    ].filter(Boolean).join(" "),
  );
}

//testing: /tidi <factor> — sets server-side sim time dilation AND sends
//testing: OnSetTimeDilation notification to all clients in the solar system.
//testing: The client-side handler (installed during login via signedFunc in
//testing: handshake.js) sets blue.os.maxSimDilation, minSimDilation, and
//testing: dilationOverloadThreshold so blue.dll's tick loop natively adjusts
//testing: desiredSimDilation, which the stock TiDi HUD reads.
//testing: factor < 1.0 → lock dilation at that factor (threshold=0 forces overload)
//testing: factor = 1.0 → restore defaults (threshold=100000000, max=1.0, min=0.1)
function handleTimeDilationCommand(session, argumentText, chatHub, options) {
  const currentSystemID = getActiveSolarSystemID(session);
  if (!currentSystemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved.",
    );
  }

  const systemLabel = formatSolarSystemLabel(currentSystemID);
  const trimmedArgument = String(argumentText || "").trim();

  // No argument = show current state
  if (!trimmedArgument) {
    const snapshot = spaceRuntime.getSceneTimeSnapshot(currentSystemID);
    if (!snapshot) {
      return handledResult(
        chatHub,
        session,
        options,
        `/tidi ${systemLabel}: scene not available.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      [
        `/tidi ${systemLabel}:`,
        `factor=${formatTimeDilationFactor(snapshot.timeDilation)}`,
        `simTimeMs=${Math.round(Number(snapshot.simTimeMs) || 0)}`,
        `stamp=${Number(snapshot.destinyStamp) || 0}.`,
      ].join(" "),
    );
  }

  const requestedFactor = Number(trimmedArgument);
  if (!Number.isFinite(requestedFactor)) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /tidi <0.1-1.0>",
    );
  }

  const normalizedFactor = Math.min(1, Math.max(0.1, requestedFactor));

  //testing: Send the client advance notice immediately, then apply the
  //testing: authoritative server-side TiDi factor after the lead window so the
  //testing: DoSimClockRebase lands closer to blue.dll's native sync-base switch.
  scheduleAdvanceNoticeTimeDilationForSystems(
    [currentSystemID],
    normalizedFactor,
    { delayMs: TIDI_ADVANCE_NOTICE_MS },
  );

  const clampedMessage =
    normalizedFactor !== requestedFactor
      ? ` Requested ${requestedFactor} was clamped to ${formatTimeDilationFactor(normalizedFactor)}.`
      : "";
  const isDisabling = normalizedFactor >= 1.0;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `/tidi ${systemLabel}:`,
      isDisabling ? "TiDi will disable" : `TiDi will set to ${formatTimeDilationFactor(normalizedFactor)}`,
      `in ${TIDI_ADVANCE_NOTICE_MS / 1000}s (synchronized).`,
      clampedMessage.trim() || null,
    ].filter(Boolean).join(" "),
  );

  if (false) {
  //testing: 2-second advance notice system (CCP dev blog parity).
  //testing: Both client notifications AND server factor change fire together after
  //testing: a 2-second delay. The 2s window lets the packet propagate to all clients
  //testing: so everyone (clients + server) transitions to the new TiDi factor at
  //testing: exactly the same moment.
  const TIDI_ADVANCE_NOTICE_MS = 2000;

  const capturedSystemID = currentSystemID;
  setTimeout(() => {
    // Step 1: Notify all clients in the system — blue.dll applies params immediately on receipt
    sendTimeDilationNotificationToSystem(capturedSystemID, normalizedFactor);
    // Step 2: Apply server-side factor at the same instant
    spaceRuntime.setSolarSystemTimeDilation(capturedSystemID, normalizedFactor, {
      syncSessions: true,
      emit: true,
      forceRebase: true,
    });
  }, TIDI_ADVANCE_NOTICE_MS);

  const clampedMessage =
    normalizedFactor !== requestedFactor
      ? ` Requested ${requestedFactor} was clamped to ${formatTimeDilationFactor(normalizedFactor)}.`
      : "";
  const isDisabling = normalizedFactor >= 1.0;
  return handledResult(
    chatHub,
    session,
    options,
    [
      `/tidi ${systemLabel}:`,
      isDisabling ? "TiDi will disable" : `TiDi will set to ${formatTimeDilationFactor(normalizedFactor)}`,
      `in ${TIDI_ADVANCE_NOTICE_MS / 1000}s (synchronized).`,
      clampedMessage.trim() || null,
    ].filter(Boolean).join(" "),
  );
  }
}

//testing: Helper — sends OnSetTimeDilation notification to all sessions in a solar system.
//testing: Used by /tidi command and also exported for runtime to call on system entry/leave.
function sendTimeDilationNotificationToSystem(systemID, factor) {
  const isDisabling = factor >= 1.0;
  const maxDil = isDisabling ? 1.0 : factor;
  const minDil = isDisabling ? 1.0 : factor;
  const threshold = isDisabling ? 100000000 : 0;

  let sentCount = 0;
  for (const targetSession of sessionRegistry.getSessions()) {
    const targetSystemID = getActiveSolarSystemID(targetSession);
    if (targetSystemID !== systemID) {
      continue;
    }
    if (
      !targetSession.socket ||
      targetSession.socket.destroyed ||
      typeof targetSession.sendNotification !== "function"
    ) {
      continue;
    }
    targetSession.sendNotification(
      "OnSetTimeDilation",
      "clientID",
      [maxDil, minDil, threshold],
    );
    sentCount += 1;
  }
  return sentCount;
}

//testing: Sends OnSetTimeDilation to a single session based on the given factor.
//testing: Used when a player enters a system that already has TiDi active,
//testing: or when leaving a TiDi system (factor=1.0 resets client to defaults).
function sendTimeDilationNotificationToSession(session, factor) {
  if (
    !session ||
    !session.socket ||
    session.socket.destroyed ||
    typeof session.sendNotification !== "function"
  ) {
    return false;
  }
  const isDisabling = factor >= 1.0;
  const maxDil = isDisabling ? 1.0 : factor;
  const minDil = isDisabling ? 1.0 : factor;
  const threshold = isDisabling ? 100000000 : 0;
  session.sendNotification(
    "OnSetTimeDilation",
    "clientID",
    [maxDil, minDil, threshold],
  );
  return true;
}

function executeChatCommand(session, rawMessage, chatHub, options = {}) {
  const trimmed = String(rawMessage || "").trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith(".")) {
    return { handled: false };
  }

  const commandLine = trimmed.slice(1).trim();
  if (!commandLine) {
    return handledResult(
      chatHub,
      session,
      options,
      "No command supplied. Use /help.",
    );
  }

  const [commandName, ...rest] = commandLine.split(/\s+/);
  const command = normalizeCommandName(commandName);
  const argumentText = rest.join(" ").trim();

  if (
    command === "help" ||
    command === "commands" ||
    command === "commandlist"
  ) {
    return handledResult(chatHub, session, options, COMMANDS_HELP_TEXT);
  }

  if (command === "motd") {
    return handledResult(chatHub, session, options, DEFAULT_MOTD_MESSAGE);
  }

  if (command === "deer_hunter") {
    return handleDeerHunterCommand(session, chatHub, options);
  }

  if (
    command === "blue" ||
    command === "red" ||
    command === "teal" ||
    command === "yellow"
  ) {
    return handleChatColorCommand(session, command, chatHub, options);
  }

  if (command === "where") {
    return handledResult(chatHub, session, options, getLocationSummary(session));
  }

  if (command === "dock") {
    return handleHomeDock(session, chatHub, options);
  }

  if (command === "heal") {
    return handleHealCommand(session, chatHub, options);
  }

  if (command === "effect") {
    return handleEffectCommand(session, argumentText, chatHub, options);
  }

  if (command === "jetcan") {
    return handleJetcanCommand(session, argumentText, chatHub, options);
  }

  if (command === "container") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "container");
  }

  if (command === "gmships") {
    return handleGmShipsCommand(session, chatHub, options);
  }

  if (command === "gmweapons") {
    return handleGmWeaponsCommand(session, chatHub, options);
  }

  if (command === "prop") {
    return handlePropCommand(session, chatHub, options);
  }

  if (command === "allskills") {
    return handleAllSkillsCommand(session, chatHub, options);
  }

  if (command === "gmskills") {
    return handleGmSkillsCommand(session, chatHub, options);
  }

  if (command === "loadsys") {
    return handleLoadSystemCommand(session, chatHub, options);
  }

  if (command === "loadallsys") {
    return handleLoadAllSystemsCommand(session, chatHub, options);
  }

  if (command === "tidi") {
    return handleTimeDilationCommand(session, argumentText, chatHub, options);
  }


  if (command === "spawncontainer") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "container");
  }

  if (command === "spawnwreck") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "wreck");
  }

  if (command === "wreck") {
    return handleDebrisFieldCommand(session, argumentText, chatHub, options, "wreck");
  }

  if (command === "suicide") {
    return handleSuicideCommand(session, chatHub, options);
  }

  if (command === "deathtest") {
    return handleDeathTestCommand(session, argumentText, chatHub, options);
  }

  if (command === "npc") {
    return handleNpcCommand(session, argumentText, chatHub, options);
  }

  if (command === "npcclear") {
    return handleNpcClearCommand(session, argumentText, chatHub, options);
  }

  if (command === "concord") {
    return handleConcordCommand(session, argumentText, chatHub, options);
  }

  if (command === "cwatch") {
    return handleCrimewatchCommand(session, argumentText, chatHub, options);
  }

  if (command === "naughty") {
    return handleNaughtyCommand(session, argumentText, chatHub, options);
  }

  if (command === "secstatus") {
    return handleSecurityStatusCommand(session, argumentText, chatHub, options);
  }

  if (command === "gateconcord") {
    return handleGateOperatorCommand(
      session,
      argumentText,
      chatHub,
      options,
      npcService.GATE_OPERATOR_KIND.CONCORD,
    );
  }

  if (command === "gaterats") {
    return handleGateOperatorCommand(
      session,
      argumentText,
      chatHub,
      options,
      npcService.GATE_OPERATOR_KIND.RATS,
    );
  }

  if (command === "invu") {
    return handleInvuCommand(session, argumentText, chatHub, options);
  }

  if (command === "fire") {
    return handleFireCommand(session, argumentText, chatHub, options);
  }

  if (command === "fire2") {
    return handleFire2Command(session, argumentText, chatHub, options);
  }

  if (command === "testclear") {
    return handleTestClearCommand(session, chatHub, options);
  }

  if (command === "sysjunkclear") {
    return handleSystemJunkClearCommand(session, chatHub, options);
  }

  if (command === "who") {
    return handledResult(
      chatHub,
      session,
      options,
      getConnectedCharacterSummary(),
    );
  }

  if (command === "wallet" || command === "isk") {
    const summary = getWalletSummary(session);
    return handledResult(
      chatHub,
      session,
      options,
      summary || "Select a character before checking wallet balance.",
    );
  }

  if (command === "corpcreate") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating a corporation.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /corpcreate <corporation name>",
      );
    }

    const result = createCustomCorporation(session.characterID, argumentText);
    if (!result.success) {
      const message =
        result.errorMsg === "CORPORATION_NAME_TAKEN"
          ? `Corporation already exists: ${argumentText}.`
          : "Corporation creation failed.";
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created corporation ${result.data.corporationRecord.corporationName} [${result.data.corporationRecord.tickerName}] and moved your character into it.`,
    );
  }

  if (command === "setalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = createCustomAllianceForCorporation(
      session.characterID,
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance creation failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before creating an alliance.";
      } else if (result.errorMsg === "ALLIANCE_NAME_TAKEN") {
        message = `Alliance already exists: ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}] and set your corporation into it.`,
    );
  }

  if (command === "joinalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before joining an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /joinalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = joinCorporationToAllianceByName(
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance join failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before joining a custom alliance.";
      } else if (result.errorMsg === "ALLIANCE_NOT_FOUND") {
        message = `Alliance not found: ${argumentText}.`;
      } else if (result.errorMsg === "ALREADY_IN_ALLIANCE") {
        message = `Your corporation is already in ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Joined alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}].`,
    );
  }

  if (command === "solar") {
    return handleSolarTeleport(session, argumentText, chatHub, options);
  }

  if (command === "tr") {
    return handleTransportCommand(session, argumentText, chatHub, options);
  }

  if (command === "addisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addisk <amount>",
      );
    }

    const result = adjustCharacterBalance(session.characterID, amount, {
      description: `Admin /addisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: insufficient funds."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted wallet by ${formatIsk(amount)}. New balance: ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "addplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addplex <amount>",
      );
    }

    const result = adjustCharacterPlexBalance(session.characterID, amount);
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted PLEX by ${formatSignedPlex(amount)}. New balance: ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "setisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setisk <amount>",
      );
    }

    const result = setCharacterBalance(session.characterID, amount, {
      description: `Admin /setisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: balance cannot be negative."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Wallet balance set to ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "setplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setplex <amount>",
      );
    }

    const result = setCharacterPlexBalance(session.characterID, amount);
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `PLEX balance set to ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "ship" || command === "giveme") {
    return handleShipSpawn(command, session, argumentText, chatHub, options);
  }

  if (command === "laser") {
    return handleLaserCommand(session, chatHub, options);
  }

  if (command === "lesmis") {
    return handleLesmisCommand(session, chatHub, options);
  }

  if (command === "giveitem" || command === "item") {
    return handleGiveItemCommand(session, argumentText, chatHub, options);
  }

  if (command === "hangar") {
    return handledResult(chatHub, session, options, getHangarSummary(session));
  }

  if (command === "session") {
    return handledResult(chatHub, session, options, getSessionSummary(session));
  }

  if (command === "iteminfo") {
    return handledResult(chatHub, session, options, getItemSummary(argumentText));
  }

  if (command === "typeinfo") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /typeinfo <ship name|typeID>",
      );
    }

    const lookup = resolveShipByName(argumentText);
    if (!lookup.success) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    return handledResult(
      chatHub,
      session,
      options,
      `${lookup.match.name}: typeID=${lookup.match.typeID}, groupID=${lookup.match.groupID}, categoryID=${lookup.match.categoryID}, published=${lookup.match.published === false ? "false" : "true"}.`,
    );
  }

  if (command === "announce") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /announce <message>",
      );
    }

    sendAnnouncement(chatHub, session, argumentText);
    return handledResult(
      chatHub,
      session,
      options,
      `Announcement sent: ${argumentText}`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Unknown command: /${command}. Use /help.${formatSuggestions(suggestCommands(command))}`.trim(),
  );
}

module.exports = {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  DEER_HUNTER_MESSAGE,
  DEFAULT_MOTD_MESSAGE,
  executeChatCommand,
  getGmWeaponsSeedPlan,
  getPropulsionCommandItemTypes,
  //testing: exported for runtime.js to send TiDi notifications on system entry/leave
  sendTimeDilationNotificationToSession,
  sendTimeDilationNotificationToSystem,
};

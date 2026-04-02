const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));

const SCOPED_CHAT_SESSION_KEYS = new Set([
  "corpid",
  "allianceid",
  "warfactionid",
  "fleetid",
]);
const CHAT_PRESENCE_SESSION_KEYS = new Set([
  ...SCOPED_CHAT_SESSION_KEYS,
  "role",
  "corprole",
]);

function getChangeKeys(changes) {
  if (!changes) {
    return [];
  }

  if (Array.isArray(changes)) {
    return changes
      .map((entry) => (
        Array.isArray(entry) && entry.length > 0 ? String(entry[0]) : ""
      ))
      .filter(Boolean);
  }

  if (typeof changes === "object") {
    return Object.keys(changes);
  }

  return [];
}

function hasMatchingKey(changeKeys, candidates) {
  return changeKeys.some((key) => candidates.has(String(key)));
}

function getScopedAutoJoinKinds(changeKeys) {
  const normalizedKeys = new Set(changeKeys.map((key) => String(key)));
  const joinKinds = [];

  if (normalizedKeys.has("corpid")) {
    joinKinds.push("corp");
  }
  if (normalizedKeys.has("allianceid")) {
    joinKinds.push("alliance");
  }
  if (normalizedKeys.has("fleetid")) {
    joinKinds.push("fleet");
  }
  if (normalizedKeys.has("warfactionid")) {
    joinKinds.push("faction");
  }

  return joinKinds;
}

function synchronizeSessionChatState(session, changes) {
  const changeKeys = getChangeKeys(changes);
  if (!session || changeKeys.length === 0) {
    return {
      scopedSynced: false,
      presenceRefreshed: false,
    };
  }

  const shouldSyncScoped = hasMatchingKey(changeKeys, SCOPED_CHAT_SESSION_KEYS);
  const shouldRefreshPresence = hasMatchingKey(
    changeKeys,
    CHAT_PRESENCE_SESSION_KEYS,
  );

  if (!shouldSyncScoped && !shouldRefreshPresence) {
    return {
      scopedSynced: false,
      presenceRefreshed: false,
    };
  }

  let scopedSynced = false;
  let presenceRefreshed = false;

  try {
    if (shouldSyncScoped) {
      const { syncSessionScopedRoomMembership } = require(path.join(
        __dirname,
        "./xmppStubServer",
      ));
      if (typeof syncSessionScopedRoomMembership === "function") {
        scopedSynced = Boolean(
          syncSessionScopedRoomMembership(session, {
            autoJoinKinds: getScopedAutoJoinKinds(changeKeys),
          }),
        );
      }
    }

    if (shouldRefreshPresence) {
      const chatHub = require(path.join(__dirname, "./chatHub"));
      if (typeof chatHub.refreshSessionChatRolePresence === "function") {
        presenceRefreshed = Boolean(
          chatHub.refreshSessionChatRolePresence(session),
        );
      }
    }
  } catch (error) {
    log.debug(
      `[ChatSync] Skipped post-session-change chat sync: ${error.message}`,
    );
  }

  return {
    scopedSynced,
    presenceRefreshed,
  };
}

module.exports = {
  synchronizeSessionChatState,
  SCOPED_CHAT_SESSION_KEYS,
  CHAT_PRESENCE_SESSION_KEYS,
  getScopedAutoJoinKinds,
};

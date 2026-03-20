const { toBigInt } = require("../character/characterState");
const {
  sendSessionSystemMessage,
  moveSessionToCurrentLocalRoom,
  refreshSessionChatRolePresence,
} = require("./xmppStubServer");

const joinedChannels = new Map();

const CHANNEL_MODE_CONVERSATIONALIST = 3;
const CHANNEL_HEADERS = [
  "channelID",
  "ownerID",
  "displayName",
  "motd",
  "comparisonKey",
  "memberless",
  "password",
  "mailingList",
  "cspa",
  "temporary",
  "languageRestriction",
  "groupMessageID",
  "channelMessageID",
  "mode",
  "subscribed",
  "estimatedMemberCount",
];
const CHANNEL_MOD_HEADERS = [
  "accessor",
  "mode",
  "untilWhen",
  "originalMode",
  "admin",
  "reason",
];
const CHANNEL_CHAR_HEADERS = [
  "charID",
  "corpID",
  "mode",
  "allianceID",
  "warFactionID",
  "role",
  "extra",
];
const EXTRA_CHAR_HEADERS = ["ownerID", "ownerName", "typeID"];

const CONFERENCE_DOMAIN = "conference.localhost";

function buildList(items) {
  return { type: "list", items };
}

function buildRowset(header, lines) {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", buildList(lines)],
      ],
    },
  };
}

function buildRow(header, line) {
  return {
    type: "object",
    name: "util.Row",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["line", buildList(line)],
      ],
    },
  };
}

function buildLocalChannel(channelID) {
  const normalizedChannelID = Number(channelID || 30000142) || 30000142;
  const channelName = getLocalChannelName(normalizedChannelID);
  return {
    key: `solarsystemid2:${normalizedChannelID}`,
    id: normalizedChannelID,
    type: "solarsystemid2",
    ownerID: 1,
    displayName: "Local",
    motd:
      "<br>eve.js Local Chat<br>Commands: /help, /wallet, /where, /who, /ship <name|typeID>, /laser, /lesmis, /gmships, /gmskills",
    comparisonKey: channelName,
    memberless: false,
    password: null,
    mailingList: false,
    cspa: 0,
    temporary: false,
    languageRestriction: false,
    groupMessageID: 0,
    channelMessageID: 0,
    mode: CHANNEL_MODE_CONVERSATIONALIST,
    subscribed: true,
  };
}

function getLocalChannelForSession(session) {
  const channelID =
    (session &&
      (session.solarsystemid2 || session.solarsystemid || session.stationid || session.stationID)) ||
    30000142;
  return buildLocalChannel(channelID);
}

function getLocalChannelName(channelID) {
  return `local_${Number(channelID || 30000142)}`;
}

function getChannelMembers(channel) {
  const members = joinedChannels.get(channel.key);
  if (!members) {
    return [];
  }

  return Array.from(members).filter(
    (session) => session && session.socket && !session.socket.destroyed,
  );
}

function getEstimatedMemberCount(channel) {
  return getChannelMembers(channel).length;
}

function buildChannelInfoLine(channel) {
  return buildList([
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelInfo(channel) {
  return buildRow(CHANNEL_HEADERS, [
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelMods() {
  return buildRowset(CHANNEL_MOD_HEADERS, []);
}

function buildCharacterExtra(session) {
  return buildRow(EXTRA_CHAR_HEADERS, [
    session.characterID || session.userid || 0,
    session.characterName || session.userName || "Unknown",
    session.characterTypeID || 1373,
  ]);
}

function buildChannelChars(channel) {
  const lines = getChannelMembers(channel).map((session) =>
    buildList([
      session.characterID || session.userid || 0,
      session.corporationID || 0,
      CHANNEL_MODE_CONVERSATIONALIST,
      session.allianceID || 0,
      session.warFactionID || 0,
      { type: "long", value: toBigInt(session.role || 0) },
      buildCharacterExtra(session),
    ]),
  );

  return buildRowset(CHANNEL_CHAR_HEADERS, lines);
}

function buildChannelDescriptor(channel) {
  return [[channel.type, channel.id]];
}

function buildSenderInfo(session) {
  return [
    session.allianceID || 0,
    session.corporationID || 0,
    [
      session.characterID || session.userid || 0,
      session.characterName || session.userName || "Unknown",
      session.characterTypeID || 1373,
    ],
    { type: "long", value: toBigInt(session.role || 0) },
    { type: "long", value: 0n },
    0,
  ];
}

function buildSystemSenderInfo() {
  return [
    0,
    1,
    [1, "EVE System", 1],
    { type: "long", value: 1n },
    { type: "long", value: 0n },
    0,
  ];
}

function sendOnLsc(session, channel, method, sender, argumentsTuple = []) {
  if (!session || !session.socket || session.socket.destroyed) {
    return;
  }

  session.sendNotification("OnLSC", channel.type, [
    buildChannelDescriptor(channel),
    getEstimatedMemberCount(channel),
    method,
    sender,
    argumentsTuple,
  ]);
}

function getChannelsForSession(session) {
  const channel = getLocalChannelForSession(session);
  return buildRowset(CHANNEL_HEADERS, [buildChannelInfoLine(channel)]);
}

function joinLocalChannel(session) {
  const channel = getLocalChannelForSession(session);

  if (!joinedChannels.has(channel.key)) {
    joinedChannels.set(channel.key, new Set());
  }

  const members = joinedChannels.get(channel.key);
  const alreadyJoined = members.has(session);
  members.add(session);

  if (!alreadyJoined) {
    const sender = buildSenderInfo(session);
    for (const member of getChannelMembers(channel)) {
      sendOnLsc(member, channel, "JoinChannel", sender, []);
    }
  }

  return {
    channel,
    result: [
      buildChannelDescriptor(channel),
      1,
      [buildChannelInfo(channel), buildChannelMods(), buildChannelChars(channel)],
    ],
  };
}

function leaveLocalChannel(session) {
  const channel = getLocalChannelForSession(session);
  const members = joinedChannels.get(channel.key);
  if (!members || !members.has(session)) {
    return null;
  }

  members.delete(session);
  const sender = buildSenderInfo(session);
  for (const member of getChannelMembers(channel)) {
    sendOnLsc(member, channel, "LeaveChannel", sender, []);
  }

  if (members.size === 0) {
    joinedChannels.delete(channel.key);
  }

  return channel;
}

function moveLocalSession(session, previousChannelID = 0) {
  if (!session || !session.socket || session.socket.destroyed) {
    return null;
  }

  const oldChannelID = Number(previousChannelID || 0) || 0;
  const newChannel = getLocalChannelForSession(session);
  if (!oldChannelID || oldChannelID === Number(newChannel.id || 0)) {
    moveSessionToCurrentLocalRoom(session);
    return {
      previousChannelID: oldChannelID,
      newChannel,
      moved: false,
    };
  }

  const oldChannel = {
    ...newChannel,
    key: `solarsystemid2:${oldChannelID}`,
    id: oldChannelID,
    comparisonKey: getLocalChannelName(oldChannelID),
  };
  const oldMembers = joinedChannels.get(oldChannel.key) || null;
  const wasJoined = Boolean(oldMembers && oldMembers.has(session));

  if (wasJoined) {
    oldMembers.delete(session);
    const sender = buildSenderInfo(session);
    for (const member of getChannelMembers(oldChannel)) {
      sendOnLsc(member, oldChannel, "LeaveChannel", sender, []);
    }
    if (oldMembers.size === 0) {
      joinedChannels.delete(oldChannel.key);
    }

    if (!joinedChannels.has(newChannel.key)) {
      joinedChannels.set(newChannel.key, new Set());
    }
    const newMembers = joinedChannels.get(newChannel.key);
    const alreadyJoined = newMembers.has(session);
    newMembers.add(session);
    if (!alreadyJoined) {
      const sender = buildSenderInfo(session);
      for (const member of getChannelMembers(newChannel)) {
        sendOnLsc(member, newChannel, "JoinChannel", sender, []);
      }
    }
  }

  moveSessionToCurrentLocalRoom(session);

  return {
    previousChannelID: oldChannelID,
    newChannel,
    moved: wasJoined,
  };
}

function unregisterSession(session) {
  for (const [key, members] of joinedChannels.entries()) {
    if (!members.has(session)) {
      continue;
    }

    members.delete(session);
    const [type, rawId] = key.split(":");
    const channel = {
      ...getLocalChannelForSession(session),
      key,
      type,
      id: Number(rawId),
    };
    const sender = buildSenderInfo(session);
    for (const member of getChannelMembers(channel)) {
      sendOnLsc(member, channel, "LeaveChannel", sender, []);
    }

    if (members.size === 0) {
      joinedChannels.delete(key);
    }
  }
}

function broadcastLocalMessage(session, message) {
  const channel = getLocalChannelForSession(session);
  const sender = buildSenderInfo(session);
  for (const member of getChannelMembers(channel)) {
    sendOnLsc(member, channel, "SendMessage", sender, [message]);
  }
}

function buildRoomJid(roomNameOrJid) {
  const trimmed = String(roomNameOrJid || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed}@${CONFERENCE_DOMAIN}`;
}

function resolveSystemMessageTarget(session, specificChannel = null) {
  if (!specificChannel) {
    const channel = getLocalChannelForSession(session);
    return {
      channel,
      roomJid: buildRoomJid(
        channel.comparisonKey || getLocalChannelName(channel.id),
      ),
    };
  }

  if (typeof specificChannel === "string") {
    const trimmed = specificChannel.trim();
    if (!trimmed) {
      return resolveSystemMessageTarget(session, null);
    }

    const localMatch = /^local_(\d+)(?:@conference\.localhost)?$/i.exec(trimmed);
    if (localMatch) {
      const channel = buildLocalChannel(localMatch[1]);
      return {
        channel,
        roomJid: buildRoomJid(channel.comparisonKey),
      };
    }

    return {
      channel: null,
      roomJid: buildRoomJid(trimmed),
    };
  }

  const channel = specificChannel;
  return {
    channel,
    roomJid: buildRoomJid(
      channel.comparisonKey || getLocalChannelName(channel.id),
    ),
  };
}

function sendSystemMessage(session, message, specificChannel = null) {
  const { channel, roomJid } = resolveSystemMessageTarget(session, specificChannel);
  if (channel) {
    sendOnLsc(session, channel, "SendMessage", buildSystemSenderInfo(), [message]);
  }
  sendSessionSystemMessage(session, message, roomJid);
}

module.exports = {
  getChannelsForSession,
  joinLocalChannel,
  leaveLocalChannel,
  moveLocalSession,
  unregisterSession,
  broadcastLocalMessage,
  refreshSessionChatRolePresence,
  sendSystemMessage,
  getLocalChannelForSession,
  getLocalChannelName,
};

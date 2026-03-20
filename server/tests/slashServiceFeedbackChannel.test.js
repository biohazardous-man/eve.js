const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const chatHub = require(path.join(
  repoRoot,
  "server/src/services/chat/chatHub",
));
const SlashService = require(path.join(
  repoRoot,
  "server/src/services/admin/slashService",
));
const { DEFAULT_MOTD_MESSAGE } = require(path.join(
  repoRoot,
  "server/src/services/chat/chatCommands",
));

test("slash service routes slash feedback using channelID kwargs", () => {
  const sentMessages = [];
  const originalSendSystemMessage = chatHub.sendSystemMessage;
  chatHub.sendSystemMessage = (session, message, targetChannel) => {
    sentMessages.push({ session, message, targetChannel });
  };

  try {
    const session = {
      userid: 1,
      characterID: 140000001,
    };
    const service = new SlashService();

    const result = service.Handle_SlashCmd(
      ["/motd"],
      session,
      {
        type: "dict",
        entries: [["channelID", "corp_98000001"]],
      },
    );

    assert.equal(result, DEFAULT_MOTD_MESSAGE);
    assert.deepEqual(sentMessages, [
      {
        session,
        message: DEFAULT_MOTD_MESSAGE,
        targetChannel: "corp_98000001",
      },
    ]);
  } finally {
    chatHub.sendSystemMessage = originalSendSystemMessage;
  }
});

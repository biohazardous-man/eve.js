/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const { resolveItemByName } = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));

function main() {
  const typoLookup = resolveItemByName("warp scramblar");
  assert.strictEqual(typoLookup.success, false, "Typo lookup should stay in suggestion mode");
  assert(
    typoLookup.suggestions.some((entry) => entry.includes("Warp Scrambler I")),
    "Expected fuzzy item suggestions to include Warp Scrambler I",
  );

  const ammoLookup = resolveItemByName("scorge rockt");
  assert.strictEqual(ammoLookup.success, false, "Ammo typo lookup should stay in suggestion mode");
  assert(
    ammoLookup.suggestions.some((entry) => entry.includes("Scourge Rocket")),
    "Expected fuzzy item suggestions to include Scourge Rocket",
  );

  const unknownCommand = executeChatCommand(null, "/solr Jita", null, {
    emitChatFeedback: false,
  });
  assert(unknownCommand && unknownCommand.handled, "Expected command handler to handle unknown command");
  assert(
    String(unknownCommand.message || "").includes("/solar"),
    "Expected unknown command suggestions to include /solar",
  );

  console.log(JSON.stringify({
    ok: true,
    typoItemSuggestions: typoLookup.suggestions.slice(0, 3),
    ammoSuggestions: ammoLookup.suggestions.slice(0, 3),
    unknownCommandMessage: unknownCommand.message,
  }, null, 2));
}

main();

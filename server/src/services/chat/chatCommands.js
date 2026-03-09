const { setActiveShipForSession } = require("../character/characterState");
const { resolveShipByName } = require("./shipTypeRegistry");

const AVAILABLE_SLASH_COMMANDS = [
  "commandlist",
  "commands",
  "help",
  "ship",
];
const COMMANDS_HELP_TEXT = "Commands: /help, /commands, /ship <ship name>";

function normalizeCommandName(value) {
  return String(value || "").trim().toLowerCase();
}

function formatSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return "";
  }

  return ` Suggestions: ${suggestions.join(", ")}`;
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
    chatHub.sendSystemMessage(session, message);
  }
}

function handledResult(chatHub, session, options, message) {
  emitChatFeedback(chatHub, session, options, message);
  return {
    handled: true,
    message,
  };
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
    return handledResult(
      chatHub,
      session,
      options,
      COMMANDS_HELP_TEXT,
    );
  }

  if (command === "ship") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /ship <ship name>",
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

    const switchResult = setActiveShipForSession(session, shipLookup.match);
    if (!switchResult.success) {
      let message = "Ship change failed.";
      if (switchResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before changing ships.";
      } else if (switchResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character before changing ships.";
      }
      return handledResult(chatHub, session, options, message);
    }

    if (switchResult.changed === false) {
      return handledResult(
        chatHub,
        session,
        options,
        `Active ship is already ${shipLookup.match.name}.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Active ship changed to ${shipLookup.match.name}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Unknown command: /${command}. Use /help.`,
  );
}

module.exports = {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  executeChatCommand,
};

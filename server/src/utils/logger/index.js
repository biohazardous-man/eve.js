const fs = require("fs");
const path = require("path");
const pc = require("picocolors");
const config = require(path.join(__dirname, "../../config"));

const LOG_DIR = path.join(__dirname, "../../../logs");
const SERVER_LOG_PATH = path.join(LOG_DIR, "server.log");
const DIVIDER =
  "================================================================";

function appendServerLog(level, message) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      SERVER_LOG_PATH,
      `[${new Date().toISOString()}] [${level}] ${message}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(pc.red(`[ERR]: failed to write server log: ${error.message}`));
  }
}

function writeServerLog(level, message) {
  appendServerLog(level, normalizeMessage(message));
}

function getLogLevel() {
  const numericLevel = Number(config.logLevel);
  return Number.isFinite(numericLevel) ? numericLevel : 0;
}

function isVerboseDebugEnabled() {
  return getLogLevel() >= 2;
}

function formatClock(date = new Date()) {
  return date.toISOString().slice(11, 19);
}

function normalizeMessage(message) {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error) {
    return message.stack || message.message;
  }
  return String(message);
}

function padLevel(level) {
  return String(level).padEnd(5, " ");
}

// Repeat-stacking for pktOut.
// When the same pktOut message fires repeatedly (e.g. capacitor ticks),
// keep one live console line updated instead of printing a new line each time.
const _stack = {
  key: null,
  line: null,
  count: 0,
  service: null,
  message: null,
  inline: false,
  visible: false,
};

function formatStackLine() {
  if (_stack.count <= 1) {
    return _stack.line;
  }
  return `${_stack.line} ${pc.dim(`[sent: ${_stack.count} times]`)}`;
}

function flushStack() {
  if (_stack.count === 0) {
    return;
  }

  if (!isVerboseDebugEnabled()) {
    _stack.key = null;
    _stack.line = null;
    _stack.count = 0;
    _stack.service = null;
    _stack.message = null;
    _stack.inline = false;
    _stack.visible = false;
    return;
  }

  const output = formatStackLine();

  if (_stack.inline) {
    process.stdout.write(`\r${output}\n`);
  } else if (!_stack.visible || _stack.count > 1) {
    console.log(output);
  }

  if (_stack.count === 1) {
    appendServerLog("PKT", `OUT ${_stack.service || "?"} ${_stack.message}`);
  } else {
    appendServerLog("PKT", `OUT ${_stack.service || "?"} ${_stack.message} [sent: ${_stack.count} times]`);
  }
  _stack.key = null;
  _stack.line = null;
  _stack.count = 0;
  _stack.service = null;
  _stack.message = null;
  _stack.inline = false;
  _stack.visible = false;
}

function renderLine(level, message, renderer, stream = "stdout") {
  flushStack();
  const timestamp = formatClock();
  const normalizedMessage = normalizeMessage(message);
  const label = padLevel(level);
  const line = `${pc.dim(timestamp)} ${renderer(label)} ${normalizedMessage}`;

  if (stream === "stderr") {
    console.error(line);
    return;
  }
  console.log(line);
}

function pktIn(service, message) {
  if (!isVerboseDebugEnabled()) {
    return;
  }
  flushStack();
  const timestamp = formatClock();
  const svc = pc.bold(pc.cyan(service || "?"));
  const line = `${pc.dim(timestamp)} ${pc.bgCyan(pc.black(" IN  "))} ${svc} ${pc.cyan(normalizeMessage(message))}`;
  console.log(line);
  appendServerLog("PKT", `IN  ${service || "?"} ${message}`);
}

function pktOut(service, message) {
  if (!isVerboseDebugEnabled()) {
    return;
  }
  const normalizedMsg = normalizeMessage(message);
  const key = `${service || "?"}|${normalizedMsg}`;

  if (_stack.key === key) {
    _stack.count++;
    if (_stack.inline) {
      process.stdout.write(`\r${formatStackLine()}`);
    }
    return;
  }

  flushStack();

  const timestamp = formatClock();
  const svc = pc.bold(pc.magenta(service || "?"));
  const line = `${pc.dim(timestamp)} ${pc.bgMagenta(pc.white(" OUT "))} ${svc} ${pc.magenta(normalizedMsg)}`;

  _stack.key = key;
  _stack.line = line;
  _stack.count = 1;
  _stack.service = service;
  _stack.message = normalizedMsg;
  _stack.inline = Boolean(process.stdout.isTTY);
  _stack.visible = false;

  if (_stack.inline) {
    process.stdout.write(line);
    _stack.visible = true;
    return;
  }

  console.log(line);
  _stack.visible = true;
}

function pktErr(service, message) {
  if (!isVerboseDebugEnabled()) {
    return;
  }
  flushStack();
  const timestamp = formatClock();
  const svc = pc.bold(pc.red(service || "?"));
  const line = `${pc.dim(timestamp)} ${pc.bgRed(pc.white(" ERR "))} ${svc} ${pc.red(normalizeMessage(message))}`;
  console.error(line);
  appendServerLog("PKT", `ERR ${service || "?"} ${message}`);
}

function proxy(message) {
  flushStack();
  const timestamp = formatClock();
  const line = `${pc.dim(timestamp)} ${pc.bgYellow(pc.black(" PRX "))} ${pc.yellow(normalizeMessage(message))}`;
  console.log(line);
  appendServerLog("PRX", message);
}

function proxyErr(message) {
  flushStack();
  const timestamp = formatClock();
  const line = `${pc.dim(timestamp)} ${pc.bgRed(pc.white(" PRX "))} ${pc.red(normalizeMessage(message))}`;
  console.error(line);
  appendServerLog("PRX", message);
}

function http2Log(message) {
  flushStack();
  const timestamp = formatClock();
  const line = `${pc.dim(timestamp)} ${pc.bgBlue(pc.white(" H2  "))} ${pc.blue(normalizeMessage(message))}`;
  console.log(line);
  appendServerLog("H2", message);
}

function http2Err(message) {
  flushStack();
  const timestamp = formatClock();
  const line = `${pc.dim(timestamp)} ${pc.bgRed(pc.white(" H2  "))} ${pc.red(normalizeMessage(message))}`;
  console.error(line);
  appendServerLog("H2", message);
}

function line() {
  flushStack();
  console.log(pc.dim(DIVIDER));
}

function spacer() {
  flushStack();
  console.log("");
}

function startupSection(title, rows = [], options = {}) {
  flushStack();
  const accentColor = typeof options.accentColor === "function"
    ? options.accentColor
    : pc.cyan;
  const titleRenderer = typeof options.titleRenderer === "function"
    ? options.titleRenderer
    : (value) => accentColor(pc.bold(value));
  const valueColor = typeof options.valueColor === "function"
    ? options.valueColor
    : pc.white;
  const subtitle = String(options.subtitle || "").trim();
  const normalizedRows = Array.isArray(rows) ? rows : [];

  line();
  console.log(
    `${titleRenderer(` ${String(title || "").trim()} `)}` +
      `${subtitle ? pc.dim(`  ${subtitle}`) : ""}`,
  );
  for (const row of normalizedRows) {
    if (!row) {
      continue;
    }
    const label = String(row.label || "").trim().toUpperCase().padEnd(8, " ");
    const value = String(row.value || "").trim();
    if (!value) {
      continue;
    }
    console.log(
      `  ${accentColor(pc.bold(label))} ${valueColor(value)}`,
    );
  }
  line();
}

function info(c) {
  appendServerLog("LOG", c);
  renderLine("INFO", c, (label) => pc.bgBlue(pc.white(` ${label} `)));
}

function debug(c) {
  if (!isVerboseDebugEnabled()) {
    return;
  }
  appendServerLog("DBG", c);
}

function warn(c) {
  appendServerLog("WRN", c);
  renderLine("WARN", c, (label) => pc.bgYellow(pc.black(` ${label} `)));
}

function err(c) {
  appendServerLog("ERR", c);
  renderLine("ERROR", c, (label) => pc.bgRed(pc.white(` ${label} `)), "stderr");
}

function success(c) {
  appendServerLog("SUC", c);
  renderLine("OK", c, (label) => pc.bgGreen(pc.black(` ${label} `)));
}

function logAsciiLogo() {
  appendServerLog("LOG", "eve.js startup banner rendered");
  line();
  console.log(
    `${pc.cyan("     mmmmmm m    m mmmmmm         \"         ")}
${pc.cyan("     #      \"m  m\" #            mmm    mmm  ")}
${pc.cyan("     #mmmmm  #  #  #mmmmm         #   #   \" ")}
${pc.cyan("     #       \"mm\"  #        ##    #    \"\"\"m ")}
${pc.cyan("     #mmmmm   ##   #mmmmm   ##    #   \"mmm\" ")}
${pc.dim("                                  #         ")}
${pc.dim("                                \"\"")}`,
  );
  console.log(
    `${pc.bold(pc.white(" EVE.js Server "))}${pc.dim("  local cluster bootstrap")}`,
  );
  line();
}

process.once("exit", flushStack);

module.exports = {
  info,
  debug,
  warn,
  err,
  error: err,
  success,
  pktIn,
  pktOut,
  pktErr,
  proxy,
  proxyErr,
  http2Log,
  http2Err,
  line,
  spacer,
  startupSection,
  logAsciiLogo,
  flushStack,
  isVerboseDebugEnabled,
  writeServerLog,
};

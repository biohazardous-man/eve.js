/**
 * EVE.js Server Configuration
 *
 * Default values live here. Optional local overrides can be supplied in
 * evejs.config.local.json at the repository root, or with EVEJS_* env vars.
 */

const fs = require("fs");
const path = require("path");

let nextBoundId = 1;

const rootDir = path.resolve(__dirname, "../../..");
const localConfigPath = path.join(rootDir, "evejs.config.local.json");
const sharedConfigPath = path.join(rootDir, "evejs.config.json");
const REMOVED_CONFIG_KEYS = new Set([
  "clientPath",
  "autoLaunch",
]);

const CONFIG_ENTRY_DEFINITIONS = [
  {
    key: "devMode",
    defaultValue: false,
    envVar: "EVEJS_DEV_MODE",
    envType: "boolean",
    description:
      "Enables local development shortcuts such as auto-creating accounts and skipping password validation.",
    validValues: "true or false.",
  },
  {
    key: "clientVersion",
    defaultValue: 23.02,
    description:
      "Boot version reported to the client during the login handshake.",
    validValues: 'Number matching your client build, for example 23.02.',
  },
  {
    key: "clientBuild",
    defaultValue: 3145366,
    description:
      "Client build number reported to the client during the login handshake.",
    validValues: "Integer build number matching your client.",
  },
  {
    key: "eveBirthday",
    defaultValue: 170472,
    description:
      "Birthday value used by the handshake version checks.",
    validValues: "Integer matching your client build.",
  },
  {
    key: "machoVersion",
    defaultValue: 496,
    description:
      "MachoNet protocol version reported during session bootstrap.",
    validValues: "Integer matching your client build.",
  },
  {
    key: "projectCodename",
    defaultValue: "EvEJS",
    description:
      "Project codename reported to the client during startup.",
    validValues: 'String. For the current client keep this as "EvEJS".',
  },
  {
    key: "projectRegion",
    defaultValue: "ccp",
    description:
      "Project region reported to the client during startup.",
    validValues: 'String. For the current client keep this as "ccp".',
  },
  {
    key: "projectVersion",
    defaultValue: "V23.02@ccp",
    description:
      "Full project version string reported to the client during startup.",
    validValues:
      'String matching your client boot version, for example "V23.02@ccp".',
  },
  {
    key: "logLevel",
    defaultValue: 1,
    envVar: "EVEJS_LOG_LEVEL",
    envType: "number",
    description:
      "Controls how much the server writes to the log output.",
    validValues:
      "0 = silent, 1 = normal server logging, 2 = verbose debug logging.",
  },
  {
    key: "serverPort",
    defaultValue: 26000,
    envVar: "EVEJS_SERVER_PORT",
    envType: "number",
    description:
      "TCP port used by the main game server listener.",
    validValues: "Available TCP port number.",
  },
  {
    key: "imageServerUrl",
    defaultValue: "http://127.0.0.1:26001/",
    envVar: "EVEJS_IMAGE_SERVER_URL",
    envType: "string",
    description:
      "Base URL sent to the client for image and icon requests.",
    validValues: 'Absolute URL string ending with a slash, for example "http://127.0.0.1:26001/".',
  },
  {
    key: "microservicesRedirectUrl",
    defaultValue: "http://localhost:26002/",
    envVar: "EVEJS_MICROSERVICES_REDIRECT_URL",
    envType: "string",
    description:
      "Base URL used to redirect supported microservice calls away from CCP.",
    validValues: 'Absolute URL string ending with a slash, for example "http://localhost:26002/".',
  },
  {
    key: "xmppServerPort",
    defaultValue: 5222,
    envVar: "EVEJS_XMPP_SERVER_PORT",
    envType: "number",
    description:
      "TCP port used by the local XMPP chat stub server.",
    validValues: "Available TCP port number.",
  },
  {
    key: "omegaLicenseEnabled",
    defaultValue: true,
    envVar: "EVEJS_OMEGA_LICENSE",
    envType: "boolean",
    description:
      "Enables the stubbed omega-license path for modern eve_public flows.",
    validValues: "true or false.",
  },
  {
    key: "spaceDebrisLifetimeMs",
    defaultValue: 2 * 60 * 60 * 1000,
    envVar: "EVEJS_SPACE_DEBRIS_LIFETIME_MS",
    envType: "number",
    description:
      "How long GM and testing space debris persists before cleanup.",
    validValues: "Integer duration in milliseconds. 7200000 = 2 hours.",
  },
  {
    key: "tidiAutoscaler",
    defaultValue: true,
    envVar: "EVEJS_TIDI_AUTOSCALER",
    envType: "boolean",
    description:
      "Enables automatic CPU-based time dilation scaling.",
    validValues: "true or false.",
  },
  {
    key: "NewEdenSystemLoading",
    defaultValue: 1,
    envVar: "EVEJS_NEW_EDEN_SYSTEM_LOADING",
    envType: "number",
    description:
      [
        "Controls which solar-system scenes are created during server startup.",
        "1 = current lazy/default boot: only Jita and New Caldari are preloaded so the existing startup behavior stays the same.",
        "2 = preload every high-security system by checking the solar-system security data for displayed security `0.5+` at startup, so newly added systems are picked up automatically.",
        "3 = preload every solar system in New Eden at startup.",
      ],
    validValues: "1, 2, or 3. Any other value falls back to 1.",
  },
  {
    key: "asteroidFieldsEnabled",
    defaultValue: true,
    envVar: "EVEJS_ASTEROID_FIELDS",
    envType: "boolean",
    description:
      [
        "Turns generated cosmetic asteroid-belt fields on or off when a solar-system scene is created.",
        "When this is off, belts still exist in static data, but the runtime does not populate the extra asteroid entities into space scenes.",
      ],
    validValues: "true or false.",
  },
  {
    key: "npcAuthoredStartupEnabled",
    defaultValue: false,
    envVar: "EVEJS_NPC_AUTHORED_STARTUP",
    envType: "boolean",
    description:
      [
        "Turns on the startup rules we have written by hand in the local NPC data files.",
        "Plain-English meaning: if this is off, those custom NPC and CONCORD auto-spawns will not appear when a solar system scene is created.",
      ],
    validValues: "true or false.",
  },
  {
    key: "npcDefaultConcordStartupEnabled",
    defaultValue: false,
    envVar: "EVEJS_NPC_DEFAULT_CONCORD_STARTUP",
    envType: "boolean",
    description:
      [
        "Turns on generated default CONCORD gate coverage for high-security systems (`0.5+`).",
        "This is separate from npcAuthoredStartupEnabled, so generated default CONCORD can still appear even if authored startup is off.",
      ],
    validValues: "true or false.",
  },
  {
    key: "npcDefaultConcordStationScreensEnabled",
    defaultValue: true,
    envVar: "EVEJS_NPC_DEFAULT_CONCORD_STATION_SCREENS",
    envType: "boolean",
    description:
      [
        "When generated default CONCORD coverage is on, also place passive CONCORD patrol groups near stations in `1.0` and `0.9` systems.",
        "Think of these as visible station security screens, not the separate Crimewatch punishment fleet that warps in after a criminal act.",
      ],
    validValues: "true or false.",
  },
  {
    key: "crimewatchConcordResponseEnabled",
    defaultValue: true,
    envVar: "EVEJS_CRIMEWATCH_CONCORD_RESPONSE",
    envType: "boolean",
    description:
      "Enables automatic Crimewatch-driven CONCORD response to criminal actions in high-security space.",
    validValues: "true or false.",
  },
  {
    key: "crimewatchConcordPodKillEnabled",
    defaultValue: false,
    envVar: "EVEJS_CRIMEWATCH_CONCORD_POD_KILL",
    envType: "boolean",
    description:
      [
        "When automatic Crimewatch CONCORD response is enabled, lets that transient punishment wing continue onto a criminal capsule after the ship dies.",
        "This does not affect passive startup/default CONCORD presence.",
      ],
    validValues: "true or false.",
  },
  {
    key: "proxyNodeId",
    defaultValue: 0xffaa,
    envVar: "EVEJS_PROXY_NODE_ID",
    envType: "number",
    description:
      "Proxy node ID reported to the client and used when generating bound object IDs.",
    validValues: "Integer node ID. 65450 matches the traditional 0xFFAA value.",
  },
];

const CONFIG_ENTRY_DEFINITIONS_BY_KEY = new Map(
  CONFIG_ENTRY_DEFINITIONS.map((entry) => [entry.key, entry]),
);

const defaults = Object.fromEntries(
  CONFIG_ENTRY_DEFINITIONS.map((entry) => [entry.key, entry.defaultValue]),
);

function stripJsonComments(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  let result = "";
  let inString = false;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += "\n";
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
        continue;
      }
      if (char === "\n") {
        result += "\n";
      }
      continue;
    }

    if (inString) {
      result += char;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function readJsonConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const rawText = fs.readFileSync(filePath, "utf8");
    const strippedText = stripJsonComments(rawText).trim();
    if (strippedText === "") {
      return {};
    }
    return JSON.parse(strippedText);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function parseBoolean(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseNumber(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEnvValue(entry) {
  if (!entry || !entry.envVar) {
    return undefined;
  }

  const rawValue = process.env[entry.envVar];
  if (rawValue === undefined) {
    return undefined;
  }

  switch (entry.envType) {
    case "boolean":
      return parseBoolean(rawValue);
    case "number":
      return parseNumber(rawValue);
    case "string": {
      const normalized = rawValue.trim();
      return normalized === "" ? undefined : normalized;
    }
    default:
      return undefined;
  }
}

function withDefinedEntries(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function normalizePersistedConfig(rawConfig = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(rawConfig || {})) {
    if (REMOVED_CONFIG_KEYS.has(key)) {
      continue;
    }
    normalized[key] = value;
  }

  const normalizedProjectCodename = String(
    normalized.projectCodename || "",
  ).trim().toLowerCase();
  if (
    normalizedProjectCodename === "crucible" ||
    normalizedProjectCodename === "cruicible"
  ) {
    normalized.projectCodename = defaults.projectCodename;
  }
  if (String(normalized.projectRegion || "").trim().toLowerCase() === "evejs") {
    normalized.projectRegion = defaults.projectRegion;
  }
  if (String(normalized.projectVersion || "").trim() === "V23.02@evejs") {
    normalized.projectVersion = defaults.projectVersion;
  }

  return normalized;
}

function buildPersistedConfigSnapshot(rawConfig = {}) {
  const normalizedConfig = normalizePersistedConfig(rawConfig);
  return {
    ...defaults,
    ...normalizedConfig,
  };
}

function formatInlineConfigValue(value) {
  return JSON.stringify(value);
}

function buildDocumentedCommentLines(entry) {
  const descriptionLines = Array.isArray(entry.description)
    ? entry.description
    : [entry.description];
  return [
    ...descriptionLines,
    `Valid values: ${entry.validValues}`,
    `Default: ${formatInlineConfigValue(entry.defaultValue)}.`,
  ];
}

function inferJsonValueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function buildFallbackCommentLines(key, value) {
  return [
    `Custom config override for "${key}".`,
    `Valid values: any JSON ${inferJsonValueType(value)} value.`,
  ];
}

function buildConfigPropertyLines(key, value, isLastEntry) {
  const serializedKey = JSON.stringify(key);
  const serializedValue = JSON.stringify(value, null, 2);
  const suffix = isLastEntry ? "" : ",";
  const prefix = `  ${serializedKey}: `;

  if (!serializedValue.includes("\n")) {
    return [`${prefix}${serializedValue}${suffix}`];
  }

  const valueLines = serializedValue.split("\n");
  const lines = [`${prefix}${valueLines[0]}`];
  const continuationIndent = " ".repeat(prefix.length);

  for (let index = 1; index < valueLines.length; index += 1) {
    const lineSuffix = index === valueLines.length - 1 ? suffix : "";
    lines.push(`${continuationIndent}${valueLines[index]}${lineSuffix}`);
  }

  return lines;
}

function buildCommentedConfigText(nextConfig = {}) {
  const entries = Object.entries(nextConfig);
  const lines = [
    "// EvEJS server config.",
    "// This file supports // comments.",
    "// Missing keys are re-added with defaults when the server loads it.",
    "{",
  ];

  entries.forEach(([key, value], index) => {
    const entry = CONFIG_ENTRY_DEFINITIONS_BY_KEY.get(key);
    const commentLines = entry
      ? buildDocumentedCommentLines(entry)
      : buildFallbackCommentLines(key, value);

    for (const line of commentLines) {
      lines.push(`  // ${line}`);
    }

    lines.push("");
    lines.push(
      ...buildConfigPropertyLines(key, value, index === entries.length - 1),
    );

    if (index < entries.length - 1) {
      lines.push("");
    }
  });

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function syncConfigFileDefaults(filePath, rawConfig = {}, options = {}) {
  const fileExists = fs.existsSync(filePath);
  if (!fileExists && options.createIfMissing !== true) {
    return rawConfig;
  }

  const nextConfig = buildPersistedConfigSnapshot(rawConfig);
  const nextText = buildCommentedConfigText(nextConfig);
  const previousText = fileExists ? fs.readFileSync(filePath, "utf8") : null;

  if (previousText !== nextText) {
    fs.writeFileSync(filePath, nextText, "utf8");
  }

  return nextConfig;
}

const sharedConfigExists = fs.existsSync(sharedConfigPath);
const localConfigExists = fs.existsSync(localConfigPath);
const sharedConfig = syncConfigFileDefaults(
  sharedConfigPath,
  readJsonConfig(sharedConfigPath),
);
const localConfig = syncConfigFileDefaults(
  localConfigPath,
  readJsonConfig(localConfigPath),
  {
    createIfMissing: !sharedConfigExists && !localConfigExists,
  },
);

const fileConfig = {
  ...sharedConfig,
  ...localConfig,
};

const envConfig = withDefinedEntries(
  Object.fromEntries(
    CONFIG_ENTRY_DEFINITIONS.map((entry) => [
      entry.key,
      parseEnvValue(entry),
    ]),
  ),
);

const config = {
  ...defaults,
  ...fileConfig,
  ...envConfig,
};

config.getNextBoundId = function getNextBoundId() {
  return nextBoundId++;
};

module.exports = config;

/*
 * Proof-of-authorship note: Primary authorship and project direction for this maintenance script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.join(REPO_ROOT, "server", "src", "newDatabase", "data");
const ITEMS_PATH = path.join(DATA_ROOT, "items", "data.json");
const CHARACTERS_PATH = path.join(DATA_ROOT, "characters", "data.json");
const SKILLS_PATH = path.join(DATA_ROOT, "skills", "data.json");
const NPC_CONTROL_STATE_PATH = path.join(DATA_ROOT, "npcControlState", "data.json");
const SOLAR_SYSTEMS_PATH = path.join(DATA_ROOT, "solarSystems", "data.json");
const STATIONS_PATH = path.join(DATA_ROOT, "stations", "data.json");
const LOCAL_CONFIG_PATH = path.join(REPO_ROOT, "evejs.config.local.json");
const EXAMPLE_CONFIG_PATH = path.join(REPO_ROOT, "evejs.config.example.json");
const SYNTHETIC_OWNER_ID_START = 980000000;

const args = new Set(process.argv.slice(2));
const shouldPurge = args.has("--purge");
const forcePurge = args.has("--force");

const colors = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

function colorize(text, color) {
  if (!process.stdout.isTTY || !color) {
    return String(text);
  }
  return `${color}${text}${colors.reset}`;
}

function divider(char = "=") {
  return char.repeat(78);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDataArray(filePath) {
  const payload = loadJson(filePath);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload && Array.isArray(payload.stations)) {
    return payload.stations;
  }
  if (payload && Array.isArray(payload.solarSystems)) {
    return payload.solarSystems;
  }
  return [];
}

function parseNpcCustomInfo(customInfo) {
  if (!customInfo || typeof customInfo !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(customInfo);
    const npc = parsed && typeof parsed === "object" ? parsed.npc : null;
    if (!npc || typeof npc !== "object") {
      return null;
    }
    return npc;
  } catch (error) {
    return null;
  }
}

function isSyntheticNpcCharacter(characterID, record) {
  const numericCharacterID = Number(characterID || 0);
  const shortName = String(record && record.shortName || "").trim().toLowerCase();
  const description = String(record && record.description || "").trim().toLowerCase();
  return (
    numericCharacterID >= SYNTHETIC_OWNER_ID_START ||
    shortName === "npc" ||
    description.includes("synthetic npc owner")
  );
}

function isSyntheticOwnerID(ownerID) {
  return Number(ownerID || 0) >= SYNTHETIC_OWNER_ID_START;
}

function loadNameMaps() {
  const solarSystems = loadDataArray(SOLAR_SYSTEMS_PATH);
  const stations = loadDataArray(STATIONS_PATH);
  const solarSystemNames = new Map();
  const stationNames = new Map();

  for (const system of solarSystems) {
    const solarSystemID = Number(system && system.solarSystemID || 0);
    if (!solarSystemID) {
      continue;
    }
    solarSystemNames.set(
      solarSystemID,
      String(system && system.solarSystemName || `System ${solarSystemID}`),
    );
  }

  for (const station of stations) {
    const stationID = Number(station && station.stationID || 0);
    if (!stationID) {
      continue;
    }
    stationNames.set(
      stationID,
      String(station && station.stationName || `Station ${stationID}`),
    );
  }

  return {
    solarSystemNames,
    stationNames,
  };
}

function incrementCounter(map, key, amount = 1) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) || 0) + amount);
}

function sortCountEntries(counterMap) {
  return [...counterMap.entries()].sort((left, right) => (
    right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))
  ));
}

function readConfigFlags() {
  const configPath = fs.existsSync(LOCAL_CONFIG_PATH)
    ? LOCAL_CONFIG_PATH
    : EXAMPLE_CONFIG_PATH;
  const configText = fs.readFileSync(configPath, "utf8");
  const keys = [
    "npcAuthoredStartupEnabled",
    "npcDefaultConcordStartupEnabled",
    "npcDefaultConcordStationScreensEnabled",
    "crimewatchConcordResponseEnabled",
    "asteroidFieldsEnabled",
  ];
  const flags = {};
  for (const key of keys) {
    const match = configText.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`, "i"));
    flags[key] = match ? match[1].toLowerCase() === "true" : null;
  }
  flags._path = path.relative(REPO_ROOT, configPath);
  return flags;
}

function detectOtherNodeProcesses() {
  try {
    const raw = childProcess.execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    return processes
      .filter((entry) => Number(entry && entry.ProcessId || 0) !== process.pid)
      .map((entry) => ({
        processId: Number(entry && entry.ProcessId || 0),
        commandLine: String(entry && entry.CommandLine || "").trim(),
      }));
  } catch (error) {
    return [];
  }
}

function buildLocationLabel(locationID, stationNames, solarSystemNames) {
  const numericLocationID = Number(locationID || 0);
  if (stationNames.has(numericLocationID)) {
    return stationNames.get(numericLocationID);
  }
  if (solarSystemNames.has(numericLocationID)) {
    return solarSystemNames.get(numericLocationID);
  }
  if (numericLocationID > 0) {
    return `Location ${numericLocationID}`;
  }
  return "Unknown";
}

function analyzeDatabase() {
  const items = loadJson(ITEMS_PATH);
  const characters = loadJson(CHARACTERS_PATH);
  const skills = loadJson(SKILLS_PATH);
  const npcControlState = loadJson(NPC_CONTROL_STATE_PATH);
  const { solarSystemNames, stationNames } = loadNameMaps();
  const configFlags = readConfigFlags();
  const otherNodeProcesses = detectOtherNodeProcesses();

  const syntheticCharacterIDs = new Set();
  for (const [characterID, record] of Object.entries(characters)) {
    if (isSyntheticNpcCharacter(characterID, record)) {
      syntheticCharacterIDs.add(String(characterID));
    }
  }

  const npcMetadataOwnerIDs = new Set();
  let npcMetadataItemCount = 0;
  let syntheticOwnedItemCount = 0;
  let orphanSyntheticOwnedItemCount = 0;
  let inSpaceShipCount = 0;
  let dockedOrInventoryShipCount = 0;
  const systems = new Map();
  const nonSpaceLocations = new Map();

  for (const item of Object.values(items)) {
    const itemID = Number(item && item.itemID || 0);
    const ownerID = String(item && item.ownerID || "");
    const npcMetadata = parseNpcCustomInfo(item && item.customInfo);
    const itemHasNpcMetadata = Boolean(npcMetadata);
    const syntheticOwner = syntheticCharacterIDs.has(ownerID) || isSyntheticOwnerID(ownerID);
    const categoryID = Number(item && item.categoryID || 0);
    const isShip = categoryID === 6;

    if (itemHasNpcMetadata) {
      npcMetadataItemCount += 1;
      if (ownerID) {
        npcMetadataOwnerIDs.add(ownerID);
      }
    }

    if (!syntheticOwner && !itemHasNpcMetadata) {
      continue;
    }

    syntheticOwnedItemCount += 1;
    if (syntheticOwner && !itemHasNpcMetadata) {
      orphanSyntheticOwnedItemCount += 1;
    }

    const inSpace = item && item.spaceState && Number(item.spaceState.systemID || 0) > 0;
    if (isShip && inSpace) {
      inSpaceShipCount += 1;
    }
    if (isShip && !inSpace) {
      dockedOrInventoryShipCount += 1;
    }

    const entityType = String(
      npcMetadata && npcMetadata.entityType
        ? npcMetadata.entityType
        : syntheticOwner
          ? "synthetic"
          : "unknown",
    ).toLowerCase();
    const itemName = String(item && item.itemName || `Type ${item && item.typeID || 0}`);

    if (inSpace) {
      const systemID = Number(item.spaceState.systemID || 0);
      if (!systems.has(systemID)) {
        systems.set(systemID, {
          systemID,
          systemName: solarSystemNames.get(systemID) || `System ${systemID}`,
          totalItems: 0,
          totalShips: 0,
          concordShips: 0,
          npcShips: 0,
          startupShips: 0,
          generatedStartupShips: 0,
          orphanSyntheticItems: 0,
          itemNames: new Map(),
          profileIDs: new Map(),
          startupRules: new Map(),
        });
      }
      const summary = systems.get(systemID);
      summary.totalItems += 1;
      if (isShip) {
        summary.totalShips += 1;
      }
      if (entityType === "concord" && isShip) {
        summary.concordShips += 1;
      } else if (isShip) {
        summary.npcShips += 1;
      }
      if (npcMetadata && npcMetadata.startupRuleID && isShip) {
        summary.startupShips += 1;
        incrementCounter(summary.startupRules, npcMetadata.startupRuleID);
        if (String(npcMetadata.startupRuleID).startsWith("default_concord_")) {
          summary.generatedStartupShips += 1;
        }
      }
      if (syntheticOwner && !npcMetadata) {
        summary.orphanSyntheticItems += 1;
      }
      incrementCounter(summary.itemNames, itemName);
      if (npcMetadata && npcMetadata.profileID) {
        incrementCounter(summary.profileIDs, npcMetadata.profileID);
      }
      continue;
    }

    const locationID = Number(item && item.locationID || 0);
    if (!nonSpaceLocations.has(locationID)) {
      nonSpaceLocations.set(locationID, {
        locationID,
        locationName: buildLocationLabel(locationID, stationNames, solarSystemNames),
        totalItems: 0,
        totalShips: 0,
        itemNames: new Map(),
      });
    }
    const locationSummary = nonSpaceLocations.get(locationID);
    locationSummary.totalItems += 1;
    if (isShip) {
      locationSummary.totalShips += 1;
    }
    incrementCounter(locationSummary.itemNames, itemName);
  }

  const syntheticOwnerIDs = new Set([
    ...syntheticCharacterIDs,
    ...npcMetadataOwnerIDs,
  ]);
  for (const item of Object.values(items)) {
    if (isSyntheticOwnerID(item && item.ownerID)) {
      syntheticOwnerIDs.add(String(item.ownerID));
    }
  }

  let syntheticSkillRowCount = 0;
  for (const ownerID of syntheticOwnerIDs) {
    if (Object.prototype.hasOwnProperty.call(skills, ownerID)) {
      syntheticSkillRowCount += 1;
    }
  }

  return {
    items,
    characters,
    skills,
    npcControlState,
    configFlags,
    otherNodeProcesses,
    syntheticOwnerIDs,
    summary: {
      npcMetadataItemCount,
      syntheticOwnedItemCount,
      orphanSyntheticOwnedItemCount,
      inSpaceShipCount,
      dockedOrInventoryShipCount,
      syntheticCharacterCount: syntheticCharacterIDs.size,
      syntheticSkillRowCount,
      startupRuleOverrideCount: Object.keys(
        npcControlState && npcControlState.startupRuleOverrides || {},
      ).length,
      systemGateControlCount: Object.keys(
        npcControlState && npcControlState.systemGateControls || {},
      ).length,
    },
    systems: [...systems.values()].sort((left, right) => (
      right.totalShips - left.totalShips || left.systemID - right.systemID
    )),
    nonSpaceLocations: [...nonSpaceLocations.values()].sort((left, right) => (
      right.totalShips - left.totalShips || left.locationID - right.locationID
    )),
    nameMaps: {
      solarSystemNames,
      stationNames,
    },
  };
}

function formatBoolean(value) {
  if (value === true) {
    return colorize("true", colors.green);
  }
  if (value === false) {
    return colorize("false", colors.red);
  }
  return colorize("unknown", colors.yellow);
}

function formatCountMap(counterMap, limit = 3) {
  const entries = sortCountEntries(counterMap).slice(0, limit);
  if (entries.length === 0) {
    return "-";
  }
  return entries
    .map(([key, count]) => `${key} x${count}`)
    .join(", ");
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) => (
    Math.max(
      String(header).length,
      ...rows.map((row) => String(row[index] || "").length),
    )
  ));

  const renderRow = (row) => row.map((cell, index) => (
    String(cell || "").padEnd(widths[index])
  )).join("  ");

  console.log(renderRow(headers.map((header) => colorize(header, colors.bold))));
  console.log(renderRow(widths.map((width) => "-".repeat(width))));
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

function printReport(analysis, modeLabel) {
  console.log(colorize(divider("="), colors.cyan));
  console.log(colorize("EvEJS NPC/CONCORD Persistence Audit", colors.bold));
  console.log(colorize(divider("="), colors.cyan));
  console.log(`Mode: ${modeLabel}`);
  console.log(`Repo: ${REPO_ROOT}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("");

  console.log(colorize("Config Flags", colors.bold));
  console.log(`  source: ${analysis.configFlags._path}`);
  console.log(`  asteroidFieldsEnabled: ${formatBoolean(analysis.configFlags.asteroidFieldsEnabled)}`);
  console.log(`  npcAuthoredStartupEnabled: ${formatBoolean(analysis.configFlags.npcAuthoredStartupEnabled)}`);
  console.log(`  npcDefaultConcordStartupEnabled: ${formatBoolean(analysis.configFlags.npcDefaultConcordStartupEnabled)}`);
  console.log(`  npcDefaultConcordStationScreensEnabled: ${formatBoolean(analysis.configFlags.npcDefaultConcordStationScreensEnabled)}`);
  console.log(`  crimewatchConcordResponseEnabled: ${formatBoolean(analysis.configFlags.crimewatchConcordResponseEnabled)}`);
  console.log("");

  console.log(colorize("Node Process Safety", colors.bold));
  if (analysis.otherNodeProcesses.length === 0) {
    console.log(`  ${colorize("OK", colors.green)} no other node.exe processes detected.`);
  } else {
    console.log(`  ${colorize("WARNING", colors.yellow)} other node.exe processes are running:`);
    for (const processInfo of analysis.otherNodeProcesses) {
      console.log(`    PID ${processInfo.processId}: ${processInfo.commandLine || "(no command line)"}`);
    }
  }
  console.log("");

  console.log(colorize("Summary", colors.bold));
  console.log(`  in-space synthetic/NPC ship rows: ${analysis.summary.inSpaceShipCount}`);
  console.log(`  docked/inventory synthetic ship rows: ${analysis.summary.dockedOrInventoryShipCount}`);
  console.log(`  NPC customInfo item rows: ${analysis.summary.npcMetadataItemCount}`);
  console.log(`  synthetic-owned item rows: ${analysis.summary.syntheticOwnedItemCount}`);
  console.log(`  orphan synthetic-owned rows without NPC metadata: ${analysis.summary.orphanSyntheticOwnedItemCount}`);
  console.log(`  synthetic NPC character rows: ${analysis.summary.syntheticCharacterCount}`);
  console.log(`  synthetic NPC skill rows: ${analysis.summary.syntheticSkillRowCount}`);
  console.log("");

  console.log(colorize("In-Space Spawns By System", colors.bold));
  if (analysis.systems.length === 0) {
    console.log(`  ${colorize("None.", colors.green)}`);
  } else {
    printTable(
      ["System", "Ships", "Concord", "NPC", "Startup", "Generated", "Top Types"],
      analysis.systems.map((system) => ([
        `${system.systemName} (${system.systemID})`,
        system.totalShips,
        system.concordShips,
        system.npcShips,
        system.startupShips,
        system.generatedStartupShips,
        formatCountMap(system.itemNames),
      ])),
    );
  }
  console.log("");

  console.log(colorize("Non-Space Synthetic Inventory Residue", colors.bold));
  if (analysis.nonSpaceLocations.length === 0) {
    console.log(`  ${colorize("None.", colors.green)}`);
  } else {
    printTable(
      ["Location", "Items", "Ships", "Top Types"],
      analysis.nonSpaceLocations.slice(0, 12).map((location) => ([
        `${location.locationName} (${location.locationID})`,
        location.totalItems,
        location.totalShips,
        formatCountMap(location.itemNames),
      ])),
    );
    if (analysis.nonSpaceLocations.length > 12) {
      console.log(`  ... and ${analysis.nonSpaceLocations.length - 12} more locations`);
    }
  }
  console.log("");

  console.log(colorize("Respawn-Relevant Control State", colors.bold));
  const startupRuleOverrides = analysis.npcControlState && analysis.npcControlState.startupRuleOverrides || {};
  const systemGateControls = analysis.npcControlState && analysis.npcControlState.systemGateControls || {};
  if (
    Object.keys(startupRuleOverrides).length === 0 &&
    Object.keys(systemGateControls).length === 0
  ) {
    console.log(`  ${colorize("None.", colors.green)}`);
  } else {
    if (Object.keys(startupRuleOverrides).length > 0) {
      console.log("  startupRuleOverrides:");
      for (const [ruleID, override] of Object.entries(startupRuleOverrides)) {
        console.log(`    ${ruleID}: enabled=${String(override && override.enabled)}`);
      }
    }
    if (Object.keys(systemGateControls).length > 0) {
      console.log("  systemGateControls:");
      for (const [systemID, control] of Object.entries(systemGateControls)) {
        const systemName = analysis.nameMaps.solarSystemNames.get(Number(systemID)) || `System ${systemID}`;
        console.log(
          `    ${systemName} (${systemID}): concord=${control && control.gateConcordEnabled === true}, rats=${control && control.gateRatEnabled === true}`,
        );
      }
    }
  }
  console.log("");
}

function ensureBackupDir() {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const backupDir = path.join(
    REPO_ROOT,
    "_local",
    "backups",
    `manual-stale-npc-purge-${timestamp}`,
  );
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function writeJsonAndBak(filePath, data) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, serialized, "utf8");
  fs.writeFileSync(`${filePath}.bak`, serialized, "utf8");
}

function purgeDatabase(analysis) {
  const backupDir = ensureBackupDir();
  const itemsBackupPath = path.join(backupDir, "items.data.json");
  const charactersBackupPath = path.join(backupDir, "characters.data.json");
  const skillsBackupPath = path.join(backupDir, "skills.data.json");

  fs.copyFileSync(ITEMS_PATH, itemsBackupPath);
  fs.copyFileSync(CHARACTERS_PATH, charactersBackupPath);
  fs.copyFileSync(SKILLS_PATH, skillsBackupPath);

  const items = { ...analysis.items };
  const characters = { ...analysis.characters };
  const skills = { ...analysis.skills };

  const removedItemIDs = [];
  const removedOwnerIDs = new Set();
  let removedInSpaceShipCount = 0;
  let removedDockedShipCount = 0;

  for (const [itemID, item] of Object.entries(items)) {
    const ownerID = String(item && item.ownerID || "");
    const npcMetadata = parseNpcCustomInfo(item && item.customInfo);
    const syntheticOwner = analysis.syntheticOwnerIDs.has(ownerID) || isSyntheticOwnerID(ownerID);
    if (!npcMetadata && !syntheticOwner) {
      continue;
    }

    removedItemIDs.push(itemID);
    removedOwnerIDs.add(ownerID);
    if (Number(item && item.categoryID || 0) === 6) {
      if (item && item.spaceState && Number(item.spaceState.systemID || 0) > 0) {
        removedInSpaceShipCount += 1;
      } else {
        removedDockedShipCount += 1;
      }
    }
    delete items[itemID];
  }

  let removedCharacterCount = 0;
  for (const ownerID of analysis.syntheticOwnerIDs) {
    if (Object.prototype.hasOwnProperty.call(characters, ownerID)) {
      delete characters[ownerID];
      removedCharacterCount += 1;
    }
  }

  let removedSkillCount = 0;
  for (const ownerID of analysis.syntheticOwnerIDs) {
    if (Object.prototype.hasOwnProperty.call(skills, ownerID)) {
      delete skills[ownerID];
      removedSkillCount += 1;
    }
  }

  writeJsonAndBak(ITEMS_PATH, items);
  writeJsonAndBak(CHARACTERS_PATH, characters);
  writeJsonAndBak(SKILLS_PATH, skills);

  return {
    backupDir,
    removedItemCount: removedItemIDs.length,
    removedInSpaceShipCount,
    removedDockedShipCount,
    removedCharacterCount,
    removedSkillCount,
    removedOwnerCount: removedOwnerIDs.size,
  };
}

function main() {
  const analysis = analyzeDatabase();
  printReport(analysis, shouldPurge ? "PURGE" : "REPORT");

  if (!shouldPurge) {
    return 0;
  }

  if (analysis.otherNodeProcesses.length > 0 && !forcePurge) {
    console.log(colorize(divider("-"), colors.yellow));
    console.log(colorize(
      "Refusing to purge while another node.exe process is running.",
      colors.red,
    ));
    console.log("Stop the server first, then rerun with --purge.");
    console.log("Use --force only if you are absolutely sure the live cache cannot rewrite the DB.");
    return 2;
  }

  const purgeResult = purgeDatabase(analysis);
  console.log(colorize(divider("-"), colors.cyan));
  console.log(colorize("Purge Complete", colors.bold));
  console.log(`  backupDir: ${path.relative(REPO_ROOT, purgeResult.backupDir)}`);
  console.log(`  removed item rows: ${purgeResult.removedItemCount}`);
  console.log(`  removed in-space ship rows: ${purgeResult.removedInSpaceShipCount}`);
  console.log(`  removed docked/inventory ship rows: ${purgeResult.removedDockedShipCount}`);
  console.log(`  removed synthetic owner rows: ${purgeResult.removedCharacterCount}`);
  console.log(`  removed synthetic skill rows: ${purgeResult.removedSkillCount}`);
  console.log(`  affected synthetic owners: ${purgeResult.removedOwnerCount}`);
  console.log("");

  const postPurgeAnalysis = analyzeDatabase();
  printReport(postPurgeAnalysis, "POST-PURGE REPORT");
  return 0;
}

process.exitCode = main();

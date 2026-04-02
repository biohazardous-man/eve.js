/*
 * Proof-of-authorship note: Primary authorship and project direction for this audit script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.join(__dirname, "..", "..");

const TABLE_SPECS = Object.freeze([
  {
    name: "characters",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/characters/data.json"),
    countRows(data) {
      return countObjectKeys(data);
    },
  },
  {
    name: "items",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/items/data.json"),
    countRows(data) {
      return countObjectKeys(data);
    },
  },
  {
    name: "skills",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/skills/data.json"),
    countRows(data) {
      return countObjectKeys(data);
    },
  },
  {
    name: "npcRuntimeState",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/npcRuntimeState/data.json"),
    countRows(data) {
      return countObjectKeys(data);
    },
  },
  {
    name: "npcEntities",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/npcEntities/data.json"),
    countRows(data) {
      return countObjectKeys(data && data.entities);
    },
  },
  {
    name: "npcModules",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/npcModules/data.json"),
    countRows(data) {
      return countObjectKeys(data && data.modules);
    },
  },
  {
    name: "npcCargo",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/npcCargo/data.json"),
    countRows(data) {
      return countObjectKeys(data && data.cargo);
    },
  },
  {
    name: "npcRuntimeControllers",
    filePath: path.join(repoRoot, "server/src/newDatabase/data/npcRuntimeControllers/data.json"),
    countRows(data) {
      return countObjectKeys(data && data.controllers);
    },
  },
]);

function countObjectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableClone(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, stableClone(value[key])]),
  );
}

function buildStableHash(value) {
  const normalized = JSON.stringify(stableClone(value));
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectAuditSnapshot() {
  const tables = {};
  for (const tableSpec of TABLE_SPECS) {
    const parsed = readJsonFile(tableSpec.filePath);
    tables[tableSpec.name] = {
      filePath: tableSpec.filePath,
      rowCount: tableSpec.countRows(parsed),
      stableHash: buildStableHash(parsed),
      bytes: fs.statSync(tableSpec.filePath).size,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    tables,
  };
}

function printSummary(snapshot) {
  console.log("NPC runtime table audit");
  console.log(`Generated: ${snapshot.generatedAt}`);
  console.log("");
  for (const tableSpec of TABLE_SPECS) {
    const entry = snapshot.tables[tableSpec.name];
    console.log(
      `${tableSpec.name.padEnd(22)} rows=${String(entry.rowCount).padStart(8)}  bytes=${String(entry.bytes).padStart(10)}  hash=${entry.stableHash}`,
    );
  }
}

function parseCliArguments(argv) {
  const options = {
    json: false,
    writeBaselinePath: "",
    compareBaselinePath: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = String(argv[index] || "").trim();
    if (!argument) {
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--write-baseline") {
      options.writeBaselinePath = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (argument.startsWith("--write-baseline=")) {
      options.writeBaselinePath = argument.slice("--write-baseline=".length).trim();
      continue;
    }
    if (argument === "--compare-baseline") {
      options.compareBaselinePath = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (argument.startsWith("--compare-baseline=")) {
      options.compareBaselinePath = argument.slice("--compare-baseline=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function resolveOutputPath(filePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(repoRoot, filePath);
}

function compareSnapshots(currentSnapshot, baselineSnapshot) {
  const mismatches = [];
  for (const tableSpec of TABLE_SPECS) {
    const current = currentSnapshot.tables[tableSpec.name];
    const baseline = baselineSnapshot.tables[tableSpec.name];
    if (!baseline) {
      mismatches.push({
        table: tableSpec.name,
        reason: "MISSING_BASELINE_ENTRY",
      });
      continue;
    }
    if (current.stableHash !== baseline.stableHash) {
      mismatches.push({
        table: tableSpec.name,
        reason: "HASH_MISMATCH",
        currentRowCount: current.rowCount,
        baselineRowCount: baseline.rowCount,
        currentHash: current.stableHash,
        baselineHash: baseline.stableHash,
      });
    }
  }
  return mismatches;
}

function main() {
  const options = parseCliArguments(process.argv);
  const snapshot = collectAuditSnapshot();

  if (options.writeBaselinePath) {
    const outputPath = resolveOutputPath(options.writeBaselinePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  if (options.compareBaselinePath) {
    const baselinePath = resolveOutputPath(options.compareBaselinePath);
    const baselineSnapshot = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const mismatches = compareSnapshots(snapshot, baselineSnapshot);
    if (mismatches.length > 0) {
      console.error("NPC runtime table audit mismatch detected.");
      console.error(JSON.stringify({ mismatches }, null, 2));
      process.exit(1);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  printSummary(snapshot);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const TABLE_INDEX_SOURCE = `const path = require("path");

const createTableController = require(path.join(
  __dirname,
  "../../createTableController",
));

module.exports = createTableController(__dirname);
`;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function extractSnapshotBuild(name) {
  const match = /^eve-online-static-data-(\d+)-jsonl$/.exec(name);
  return match ? Number(match[1]) : null;
}

function findLatestJsonlSnapshotDir(repoRoot) {
  const dataRoot = path.join(repoRoot, "data");
  if (!fs.existsSync(dataRoot)) {
    throw new Error(`Data directory not found: ${dataRoot}`);
  }

  const candidates = fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => extractSnapshotBuild(name) !== null)
    .sort((left, right) => extractSnapshotBuild(left) - extractSnapshotBuild(right));

  if (candidates.length === 0) {
    throw new Error(`No JSONL snapshot directories found under: ${dataRoot}`);
  }

  return path.join(dataRoot, candidates[candidates.length - 1]);
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function englishText(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    if (typeof value.en === "string" && value.en) {
      return value.en;
    }
    const firstText = Object.values(value).find(
      (entry) => typeof entry === "string" && entry,
    );
    return firstText || "";
  }
  return "";
}

async function loadJsonlMap(filePath, idSelector) {
  const rows = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    const id = toInt(idSelector(row), 0);
    if (id <= 0) {
      continue;
    }
    rows.set(id, row);
  }

  return rows;
}

function getJsonlAuthorityName(jsonlDir) {
  return path.basename(path.resolve(jsonlDir));
}

function buildDogmaAttributeTypeRecord(attributeRow) {
  const displayName = englishText(attributeRow.displayName);
  return {
    attributeID: toInt(attributeRow._key, 0),
    attributeName: displayName || attributeRow.name || "",
    description: englishText(attributeRow.description) || "",
    iconID: toNumber(attributeRow.iconID),
    defaultValue: toNumber(attributeRow.defaultValue) ?? 0,
    published: Boolean(attributeRow.published),
    displayName: displayName || "",
    unitID: toNumber(attributeRow.unitID),
    stackable: Boolean(attributeRow.stackable),
    highIsGood: Boolean(attributeRow.highIsGood),
    categoryID: toNumber(attributeRow.attributeCategoryID),
    name: attributeRow.name || "",
    dataType: toNumber(attributeRow.dataType),
    displayWhenZero: Boolean(attributeRow.displayWhenZero),
  };
}

function buildDogmaEffectTypeRecord(effectRow) {
  return {
    effectID: toInt(effectRow._key, 0),
    name: effectRow.name || "",
    displayName: englishText(effectRow.displayName) || "",
    description: englishText(effectRow.description) || "",
    guid: effectRow.guid || "",
    effectCategoryID: toInt(effectRow.effectCategoryID, 0),
    iconID: toNumber(effectRow.iconID),
    dischargeAttributeID: toNumber(effectRow.dischargeAttributeID),
    durationAttributeID: toNumber(effectRow.durationAttributeID),
    distribution: toNumber(effectRow.distribution),
    rangeAttributeID: toNumber(effectRow.rangeAttributeID),
    falloffAttributeID: toNumber(effectRow.falloffAttributeID),
    trackingSpeedAttributeID: toNumber(effectRow.trackingSpeedAttributeID),
    resistanceAttributeID: toNumber(effectRow.resistanceAttributeID),
    fittingUsageChanceAttributeID: toNumber(effectRow.fittingUsageChanceAttributeID),
    npcUsageChanceAttributeID: toNumber(effectRow.npcUsageChanceAttributeID),
    npcActivationChanceAttributeID: toNumber(effectRow.npcActivationChanceAttributeID),
    published: Boolean(effectRow.published),
    isOffensive: Boolean(effectRow.isOffensive),
    isAssistance: Boolean(effectRow.isAssistance),
    isWarpSafe: Boolean(effectRow.isWarpSafe),
    disallowAutoRepeat: Boolean(effectRow.disallowAutoRepeat),
    electronicChance: Boolean(effectRow.electronicChance),
    propulsionChance: Boolean(effectRow.propulsionChance),
    rangeChance: Boolean(effectRow.rangeChance),
    modifierInfo: Array.isArray(effectRow.modifierInfo)
      ? effectRow.modifierInfo
      : [],
  };
}

function buildTypeDogmaRecord(typeRow, dogmaRow) {
  const attributes = Object.fromEntries(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes)
      ? dogmaRow.dogmaAttributes
      : [])
      .map((entry) => [String(toInt(entry.attributeID, 0)), Number(entry.value)])
      .filter(([attributeID, value]) => toInt(attributeID, 0) > 0 && Number.isFinite(value))
      .sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  const effects = [...new Set(
    (Array.isArray(dogmaRow && dogmaRow.dogmaEffects) ? dogmaRow.dogmaEffects : [])
      .map((entry) =>
        typeof entry === "object" && entry !== null
          ? toInt(entry.effectID, 0)
          : toInt(entry, 0),
      )
      .filter((effectID) => effectID > 0),
  )].sort((left, right) => left - right);

  return {
    typeID: toInt(typeRow._key, 0),
    typeName: englishText(typeRow.name),
    attributeCount: Object.keys(attributes).length,
    effectCount: effects.length,
    attributes,
    effects,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const jsonlDir = path.resolve(
    args.jsonlDir || findLatestJsonlSnapshotDir(repoRoot),
  );
  const outputPath = path.resolve(
    args.output ||
      path.join(repoRoot, "server", "src", "newDatabase", "data", "typeDogma", "data.json"),
  );
  const outputIndexPath = path.resolve(
    args.outputIndex ||
      path.join(repoRoot, "server", "src", "newDatabase", "data", "typeDogma", "index.js"),
  );

  const [sdeMeta, typesById, dogmaAttributesById, dogmaEffectsById, typeDogmaById] =
    await Promise.all([
      loadJsonlMap(path.join(jsonlDir, "_sde.jsonl"), (row) =>
        row._key === "sde" ? 1 : null,
      ),
      loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
      loadJsonlMap(path.join(jsonlDir, "dogmaAttributes.jsonl"), (row) => row._key),
      loadJsonlMap(path.join(jsonlDir, "dogmaEffects.jsonl"), (row) => row._key),
      loadJsonlMap(path.join(jsonlDir, "typeDogma.jsonl"), (row) => row._key),
    ]);

  const sdeRow = sdeMeta.get(1) || null;
  const typesByTypeID = Object.fromEntries(
    [...typeDogmaById.entries()]
      .filter(([typeID]) => typesById.has(typeID))
      .sort((left, right) => left[0] - right[0])
      .map(([typeID, dogmaRow]) => [
        String(typeID),
        buildTypeDogmaRecord(typesById.get(typeID), dogmaRow),
      ]),
  );
  const attributeTypesByID = Object.fromEntries(
    [...dogmaAttributesById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([attributeID, row]) => [
        String(attributeID),
        buildDogmaAttributeTypeRecord(row),
      ]),
  );
  const effectTypesByID = Object.fromEntries(
    [...dogmaEffectsById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([effectID, row]) => [
        String(effectID),
        buildDogmaEffectTypeRecord(row),
      ]),
  );

  const output = {
    source: {
      provider: "EVE Static Data JSONL",
      authority: getJsonlAuthorityName(jsonlDir),
      sourceDir: jsonlDir,
      generatedAt: new Date().toISOString(),
      buildNumber: sdeRow ? sdeRow.buildNumber || null : null,
      releaseDate: sdeRow ? sdeRow.releaseDate || null : null,
      jsonlSync: {
        sourceDir: jsonlDir,
        syncedAt: new Date().toISOString(),
        buildNumber: sdeRow ? sdeRow.buildNumber || null : null,
        releaseDate: sdeRow ? sdeRow.releaseDate || null : null,
      },
    },
    attributeTypesByID,
    effectTypesByID,
    typesByTypeID,
    counts: {
      types: Object.keys(typesByTypeID).length,
      attributeTypes: Object.keys(attributeTypesByID).length,
      effectTypes: Object.keys(effectTypesByID).length,
      totalAttributes: Object.values(typesByTypeID).reduce(
        (sum, entry) => sum + toInt(entry && entry.attributeCount, 0),
        0,
      ),
      totalEffects: Object.values(typesByTypeID).reduce(
        (sum, entry) => sum + toInt(entry && entry.effectCount, 0),
        0,
      ),
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputIndexPath, TABLE_INDEX_SOURCE, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        outputIndexPath,
        types: output.counts.types,
        attributeTypes: output.counts.attributeTypes,
        effectTypes: output.counts.effectTypes,
        totalAttributes: output.counts.totalAttributes,
        totalEffects: output.counts.totalEffects,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const fs = require("fs");
const path = require("path");
const readline = require("readline");

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

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    const id = toNumber(idSelector(row));
    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }

    rows.set(id, row);
  }

  return rows;
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

function uniqueSortedNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNumber(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

function roundCoordinate(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(3));
}

function buildVector(vector = {}) {
  return {
    x: roundCoordinate(toNumber(vector.x) || 0),
    y: roundCoordinate(toNumber(vector.y) || 0),
    z: roundCoordinate(toNumber(vector.z) || 0),
  };
}

function romanNumeral(value) {
  const number = toNumber(value);
  if (!Number.isInteger(number) || number <= 0) {
    return String(value || "");
  }

  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let remainder = number;
  let output = "";
  for (const [numeric, symbol] of numerals) {
    while (remainder >= numeric) {
      output += symbol;
      remainder -= numeric;
    }
  }

  return output;
}

function getOrbitDescriptor(orbitID, orbitLookups) {
  const numericOrbitID = toNumber(orbitID);
  if (!Number.isInteger(numericOrbitID) || numericOrbitID <= 0) {
    return null;
  }

  for (const [kind, rowsById] of orbitLookups) {
    if (rowsById.has(numericOrbitID)) {
      return {
        kind,
        row: rowsById.get(numericOrbitID),
      };
    }
  }

  return null;
}

function buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups) {
  if (!orbitDescriptor || !orbitDescriptor.row) {
    return null;
  }

  const orbitRow = orbitDescriptor.row;
  const systemRow = mapSolarSystemsById.get(toNumber(orbitRow.solarSystemID)) || null;
  const systemName = englishText(systemRow && systemRow.name) || "System";

  if (orbitDescriptor.kind === "star") {
    return `${systemName} - Star`;
  }

  if (orbitDescriptor.kind === "planet") {
    return (
      englishText(orbitRow.uniqueName) ||
      englishText(orbitRow.name) ||
      `${systemName} ${romanNumeral(orbitRow.celestialIndex)}`
    );
  }

  if (orbitDescriptor.kind === "moon") {
    const parentOrbit = getOrbitDescriptor(orbitRow.orbitID, orbitLookups);
    const parentName =
      buildOrbitName(parentOrbit, mapSolarSystemsById, orbitLookups) ||
      `${systemName} ${romanNumeral(orbitRow.celestialIndex)}`;
    return `${parentName} - Moon ${toNumber(orbitRow.orbitIndex) || 0}`;
  }

  if (orbitDescriptor.kind === "asteroidBelt") {
    const parentOrbit = getOrbitDescriptor(orbitRow.orbitID, orbitLookups);
    const parentName = buildOrbitName(parentOrbit, mapSolarSystemsById, orbitLookups) || systemName;
    return `${parentName} - Asteroid Belt ${toNumber(orbitRow.orbitIndex) || 0}`;
  }

  return null;
}

function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIntegerInRange(minimum, maximum, rng) {
  const min = Math.trunc(Math.min(minimum, maximum));
  const max = Math.trunc(Math.max(minimum, maximum));
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * ((max - min) + 1));
}

function isWormholeSystem(systemRow) {
  const solarSystemID = toNumber(systemRow && systemRow._key);
  return Number.isInteger(solarSystemID) && solarSystemID >= 31000000;
}

function selectFieldStyleID(systemRow) {
  if (isWormholeSystem(systemRow)) {
    return "wormhole_standard";
  }

  const security = Number(toNumber(systemRow && systemRow.securityStatus) || 0);
  if (security < 0) {
    return "nullsec_standard";
  }
  if (security < 0.45) {
    return "empire_lowsec_standard";
  }
  return "empire_highsec_standard";
}

function buildAsteroidBeltRecord(
  beltRow,
  systemRow,
  typeRow,
  groupRow,
  mapSolarSystemsById,
  orbitLookups,
  fieldStylesByID,
) {
  const fieldStyleID = selectFieldStyleID(systemRow);
  const fieldStyle = fieldStylesByID.get(fieldStyleID) || null;
  const fieldSeed = toNumber(beltRow._key) || 1;
  const rng = createRng(fieldSeed);

  const asteroidCount = fieldStyle
    ? pickIntegerInRange(fieldStyle.asteroidCountMin, fieldStyle.asteroidCountMax, rng)
    : 20;
  const clusterCount = fieldStyle
    ? pickIntegerInRange(fieldStyle.clusterCountMin, fieldStyle.clusterCountMax, rng)
    : 4;
  const fieldRadiusMeters = fieldStyle
    ? pickIntegerInRange(fieldStyle.fieldRadiusMinMeters, fieldStyle.fieldRadiusMaxMeters, rng)
    : 32000;
  const clusterRadiusMeters = fieldStyle
    ? pickIntegerInRange(fieldStyle.clusterRadiusMinMeters, fieldStyle.clusterRadiusMaxMeters, rng)
    : 6000;
  const verticalSpreadMeters = fieldStyle
    ? pickIntegerInRange(fieldStyle.verticalSpreadMinMeters, fieldStyle.verticalSpreadMaxMeters, rng)
    : 4500;
  const largeAsteroidCount = fieldStyle
    ? Math.min(
        asteroidCount,
        pickIntegerInRange(fieldStyle.largeAsteroidCountMin, fieldStyle.largeAsteroidCountMax, rng),
      )
    : 1;

  return {
    itemID: toNumber(beltRow._key),
    typeID: toNumber(beltRow.typeID) || 15,
    groupID: toNumber(typeRow && typeRow.groupID) || 9,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Asteroid Belt",
    solarSystemID: toNumber(beltRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: toNumber(beltRow.orbitID),
    position: buildVector(beltRow.position),
    radius: toNumber(beltRow.radius) || 15000,
    itemName:
      buildOrbitName(
        { kind: "asteroidBelt", row: beltRow },
        mapSolarSystemsById,
        orbitLookups,
      ) || "Asteroid Belt",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    securityClass:
      typeof systemRow && systemRow && typeof systemRow.securityClass === "string"
        ? systemRow.securityClass
        : "",
    celestialIndex: toNumber(beltRow.celestialIndex),
    orbitIndex: toNumber(beltRow.orbitIndex),
    kind: "asteroidBelt",
    fieldStyleID,
    fieldSeed,
    asteroidCount,
    clusterCount,
    fieldRadiusMeters,
    clusterRadiusMeters,
    verticalSpreadMeters,
    largeAsteroidCount,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const jsonlDir = path.resolve(
    args.jsonlDir || findLatestJsonlSnapshotDir(repoRoot),
  );
  const localDbRoot = path.resolve(
    args.localDbRoot ||
      path.join(repoRoot, "server", "src", "newDatabase", "data"),
  );

  const [
    sdeMeta,
    groupsById,
    typesById,
    mapSolarSystemsById,
    mapStarsById,
    mapPlanetsById,
    mapMoonsById,
    mapAsteroidBeltsById,
    celestialsRoot,
    asteroidBeltsRoot,
    fieldStylesRoot,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "_sde.jsonl"), (row) => row._key === "sde" ? 1 : null),
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapSolarSystems.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStars.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapPlanets.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapMoons.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapAsteroidBelts.jsonl"), (row) => row._key),
    readJson(path.join(localDbRoot, "celestials", "data.json")),
    readJson(path.join(localDbRoot, "asteroidBelts", "data.json")),
    readJson(path.join(localDbRoot, "asteroidFieldStyles", "data.json")),
  ]);

  const fieldStylesByID = new Map(
    (Array.isArray(fieldStylesRoot.fieldStyles) ? fieldStylesRoot.fieldStyles : [])
      .map((style) => [String(style && style.fieldStyleID || "").trim(), style])
      .filter(([styleID]) => Boolean(styleID)),
  );
  const orbitLookups = new Map([
    ["star", mapStarsById],
    ["planet", mapPlanetsById],
    ["moon", mapMoonsById],
    ["asteroidBelt", mapAsteroidBeltsById],
  ]);

  const beltRows = [...mapAsteroidBeltsById.keys()]
    .sort((left, right) => left - right)
    .map((beltID) => {
      const beltRow = mapAsteroidBeltsById.get(beltID) || null;
      const systemRow =
        mapSolarSystemsById.get(toNumber(beltRow && beltRow.solarSystemID)) || null;
      const typeRow = typesById.get(toNumber(beltRow && beltRow.typeID)) || null;
      const groupRow = Number.isInteger(toNumber(typeRow && typeRow.groupID))
        ? groupsById.get(toNumber(typeRow.groupID)) || null
        : null;
      if (!beltRow || !systemRow) {
        return null;
      }

      return buildAsteroidBeltRecord(
        beltRow,
        systemRow,
        typeRow,
        groupRow,
        mapSolarSystemsById,
        orbitLookups,
        fieldStylesByID,
      );
    })
    .filter(Boolean);

  asteroidBeltsRoot.source = {
    provider: "EVE Static Data JSONL + local asteroid field derivation",
    authority: path.basename(path.resolve(jsonlDir)),
    sourceDir: jsonlDir,
    generatedAt: new Date().toISOString(),
    buildNumber: (sdeMeta.get(1) || {}).buildNumber || null,
    releaseDate: (sdeMeta.get(1) || {}).releaseDate || null,
  };
  asteroidBeltsRoot.count = beltRows.length;
  asteroidBeltsRoot.belts = beltRows;

  const nonBeltCelestials = (Array.isArray(celestialsRoot.celestials) ? celestialsRoot.celestials : [])
    .filter((row) => String(row && row.kind || "").trim() !== "asteroidBelt");
  celestialsRoot.celestials = [
    ...nonBeltCelestials,
    ...beltRows,
  ].sort((left, right) => (toNumber(left && left.itemID) || 0) - (toNumber(right && right.itemID) || 0));
  celestialsRoot.count = celestialsRoot.celestials.length;

  if (!celestialsRoot.source || typeof celestialsRoot.source !== "object") {
    celestialsRoot.source = {};
  }
  celestialsRoot.source.generatedAt = new Date().toISOString();
  celestialsRoot.source.provider = celestialsRoot.source.provider || "EVE Static Data JSONL";
  if (!celestialsRoot.source.localExtensions || typeof celestialsRoot.source.localExtensions !== "object") {
    celestialsRoot.source.localExtensions = {};
  }
  celestialsRoot.source.localExtensions.asteroidBelts = {
    count: beltRows.length,
    sourceTable: "mapAsteroidBelts.jsonl",
    note: "Asteroid belt celestial anchors now come from stored local asteroid belt export data and load as ordinary system celestials.",
  };

  writeJson(path.join(localDbRoot, "asteroidBelts", "data.json"), asteroidBeltsRoot);
  writeJson(path.join(localDbRoot, "celestials", "data.json"), celestialsRoot);

  console.log(JSON.stringify({
    asteroidBelts: beltRows.length,
    celestials: celestialsRoot.count,
    systemsWithAsteroidBelts: uniqueSortedNumbers(
      beltRows.map((row) => row.solarSystemID),
    ).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

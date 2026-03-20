const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MOVEMENT_ATTRIBUTE_IDS = Object.freeze({
  maxVelocity: 37,
  inertia: 70,
  radius: 162,
  signatureRadius: 552,
  warpSpeedMultiplier: 600,
});
const CHARACTER_CREATION_RACE_IDS = Object.freeze([1, 2, 4, 8]);
const CHARACTER_CREATION_BLOODLINE_IDS = Object.freeze([
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  11,
  12,
  13,
  14,
]);

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

function buildOptionalVector(vector) {
  if (!vector || typeof vector !== "object") {
    return null;
  }

  return buildVector(vector);
}

function getGroupRow(groupsById, groupID) {
  return Number.isInteger(groupID) ? groupsById.get(groupID) || null : null;
}

function buildTypeRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || null,
    groupName: englishText(groupRow && groupRow.name) || null,
    name: englishText(typeRow.name),
    mass: toNumber(typeRow.mass),
    volume: toNumber(typeRow.volume),
    capacity: toNumber(typeRow.capacity),
    portionSize: toNumber(typeRow.portionSize),
    raceID: toNumber(typeRow.raceID),
    basePrice: toNumber(typeRow.basePrice),
    marketGroupID: toNumber(typeRow.marketGroupID),
    iconID: toNumber(typeRow.iconID),
    soundID: toNumber(typeRow.soundID),
    graphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
    published: Boolean(typeRow.published),
  };
}

function buildSkillRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 16,
    groupName: englishText(groupRow && groupRow.name),
    name: englishText(typeRow.name),
    published: Boolean(typeRow.published),
    raceID: toNumber(typeRow.raceID),
    basePrice: toNumber(typeRow.basePrice),
    marketGroupID: toNumber(typeRow.marketGroupID),
    iconID: toNumber(typeRow.iconID),
    soundID: toNumber(typeRow.soundID),
    graphicID: toNumber(typeRow.graphicID),
  };
}

function buildCharacterCreationRaceRecord(raceRow, typesById) {
  if (!raceRow || typeof raceRow !== "object") {
    return null;
  }

  const shipTypeID = toNumber(raceRow.shipTypeID);
  const shipTypeRow = Number.isInteger(shipTypeID) ? typesById.get(shipTypeID) || null : null;
  return {
    raceID: toNumber(raceRow._key),
    name: englishText(raceRow.name),
    shipTypeID: shipTypeID || null,
    shipName: englishText(shipTypeRow && shipTypeRow.name) || null,
    skills: (Array.isArray(raceRow.skills) ? raceRow.skills : [])
      .map((entry) => ({
        typeID: toNumber(entry && entry._key),
        level: toNumber(entry && entry._value) || 0,
      }))
      .filter(
        (entry) =>
          Number.isInteger(entry.typeID) &&
          entry.typeID > 0 &&
          Number.isInteger(entry.level) &&
          entry.level >= 0,
      ),
  };
}

function buildCharacterCreationBloodlineRecord(bloodlineRow) {
  if (!bloodlineRow || typeof bloodlineRow !== "object") {
    return null;
  }

  return {
    bloodlineID: toNumber(bloodlineRow._key),
    name: englishText(bloodlineRow.name),
    raceID: toNumber(bloodlineRow.raceID),
    corporationID: toNumber(bloodlineRow.corporationID),
  };
}

function buildSolarSystemRecord(systemRow, starsById) {
  const starRow = Number.isInteger(toNumber(systemRow.starID))
    ? starsById.get(toNumber(systemRow.starID)) || null
    : null;

  return {
    regionID: toNumber(systemRow.regionID) || 0,
    constellationID: toNumber(systemRow.constellationID) || 0,
    solarSystemID: toNumber(systemRow._key),
    solarSystemName: englishText(systemRow.name),
    position: buildVector(systemRow.position),
    security: Number(toNumber(systemRow.securityStatus) || 0),
    factionID: toNumber(systemRow.factionID),
    radius: toNumber(systemRow.radius),
    sunTypeID: toNumber(starRow && starRow.typeID),
    securityClass: typeof systemRow.securityClass === "string" ? systemRow.securityClass : "",
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

function buildStarRecord(starRow, systemRow, typeRow, groupRow) {
  const systemName = englishText(systemRow && systemRow.name);
  return {
    itemID: toNumber(starRow._key),
    typeID: toNumber(starRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 6,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Sun",
    solarSystemID: toNumber(starRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: null,
    position: { x: 0, y: 0, z: 0 },
    radius: toNumber(starRow.radius),
    itemName: systemName ? `${systemName} - Star` : "Star",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex: null,
    orbitIndex: null,
    kind: "sun",
  };
}

function buildPlanetRecord(planetRow, systemRow, typeRow, groupRow) {
  const systemName = englishText(systemRow && systemRow.name);
  const celestialIndex = toNumber(planetRow.celestialIndex);
  return {
    itemID: toNumber(planetRow._key),
    typeID: toNumber(planetRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 7,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Planet",
    solarSystemID: toNumber(planetRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: toNumber(planetRow.orbitID),
    position: buildVector(planetRow.position),
    radius: toNumber(planetRow.radius),
    itemName: systemName ? `${systemName} ${romanNumeral(celestialIndex)}` : "Planet",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex,
    orbitIndex: null,
    kind: "planet",
  };
}

function buildMoonRecord(moonRow, systemRow, typeRow, groupRow, mapSolarSystemsById, orbitLookups) {
  return {
    itemID: toNumber(moonRow._key),
    typeID: toNumber(moonRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 8,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Moon",
    solarSystemID: toNumber(moonRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: toNumber(moonRow.orbitID),
    position: buildVector(moonRow.position),
    radius: toNumber(moonRow.radius),
    itemName:
      buildOrbitName({ kind: "moon", row: moonRow }, mapSolarSystemsById, orbitLookups) || "Moon",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex: toNumber(moonRow.celestialIndex),
    orbitIndex: toNumber(moonRow.orbitIndex),
    kind: "moon",
  };
}

function buildAsteroidBeltRecord(
  beltRow,
  systemRow,
  typeRow,
  groupRow,
  mapSolarSystemsById,
  orbitLookups,
) {
  return {
    itemID: toNumber(beltRow._key),
    typeID: toNumber(beltRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 9,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Asteroid Belt",
    solarSystemID: toNumber(beltRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: toNumber(beltRow.orbitID),
    position: buildVector(beltRow.position),
    radius: toNumber(beltRow.radius),
    itemName:
      buildOrbitName(
        { kind: "asteroidBelt", row: beltRow },
        mapSolarSystemsById,
        orbitLookups,
      ) || "Asteroid Belt",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex: toNumber(beltRow.celestialIndex),
    orbitIndex: toNumber(beltRow.orbitIndex),
    kind: "asteroidBelt",
  };
}

function buildStargateRecord(stargateRow, mapSolarSystemsById) {
  const sourceSystem = mapSolarSystemsById.get(toNumber(stargateRow.solarSystemID)) || null;
  const destinationSystem = mapSolarSystemsById.get(
    toNumber(stargateRow.destination && stargateRow.destination.solarSystemID),
  ) || null;
  const sourceSystemName = englishText(sourceSystem && sourceSystem.name);
  const destinationSystemName = englishText(destinationSystem && destinationSystem.name);

  return {
    itemID: toNumber(stargateRow._key),
    typeID: toNumber(stargateRow.typeID),
    solarSystemID: toNumber(stargateRow.solarSystemID) || 0,
    itemName: destinationSystemName ? `Stargate (${destinationSystemName})` : "Stargate",
    position: buildVector(stargateRow.position),
    radius: toNumber(stargateRow.radius) || 15000,
    destinationID: toNumber(stargateRow.destination && stargateRow.destination.stargateID),
    destinationSolarSystemID: toNumber(
      stargateRow.destination && stargateRow.destination.solarSystemID,
    ),
    destinationName: sourceSystemName ? `Stargate (${sourceSystemName})` : "Stargate",
  };
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

function buildStationTypeRecord(typeRow, groupRow, existingEntry = null) {
  return {
    stationTypeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    groupName: englishText(groupRow && groupRow.name) || "Station",
    raceID: toNumber(typeRow.raceID),
    graphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
    basePrice: toNumber(typeRow.basePrice),
    volume: toNumber(typeRow.volume),
    portionSize: toNumber(typeRow.portionSize),
    published: Boolean(typeRow.published),
    dockEntry: buildOptionalVector(existingEntry && existingEntry.dockEntry),
    dockOrientation: buildOptionalVector(existingEntry && existingEntry.dockOrientation),
  };
}

function buildStargateTypeRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Stargate",
    raceID: toNumber(typeRow.raceID),
    graphicID: toNumber(typeRow.graphicID),
    published: Boolean(typeRow.published),
  };
}

function buildStationRecord({
  stationRow,
  systemRow,
  constellationRow,
  regionRow,
  typeRow,
  groupRow,
  typesById,
  groupsById,
  corporationRow,
  operationRow,
  orbitDescriptor,
  existingEntry = null,
  mapSolarSystemsById,
  orbitLookups,
}) {
  const orbitRow = orbitDescriptor && orbitDescriptor.row ? orbitDescriptor.row : null;
  const orbitTypeID = toNumber(orbitRow && orbitRow.typeID);
  const orbitTypeRow =
    Number.isInteger(orbitTypeID) ? typesById.get(orbitTypeID) || null : null;
  const orbitGroupRow = getGroupRow(groupsById, toNumber(orbitTypeRow && orbitTypeRow.groupID));
  const orbitName =
    buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups) ||
    (existingEntry && existingEntry.orbitName) ||
    null;
  const corporationName =
    englishText(corporationRow && corporationRow.name) ||
    (existingEntry && existingEntry.corporationName) ||
    null;
  const operationName =
    englishText(operationRow && operationRow.operationName) ||
    (existingEntry && existingEntry.operationName) ||
    null;
  const stationName =
    (existingEntry && existingEntry.stationName) ||
    (orbitName && corporationName && operationName
      ? `${orbitName} - ${corporationName} ${operationName}`
      : orbitName || `Station ${toNumber(stationRow._key)}`);
  const radius = toNumber(typeRow.radius);

  return {
    stationID: toNumber(stationRow._key),
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    dockingCostPerVolume:
      toNumber(existingEntry && existingEntry.dockingCostPerVolume) ?? 0,
    maxShipVolumeDockable:
      toNumber(existingEntry && existingEntry.maxShipVolumeDockable) ?? 50000000,
    officeRentalCost:
      toNumber(existingEntry && existingEntry.officeRentalCost) ?? 10000,
    operationID: toNumber(stationRow.operationID),
    stationTypeID: toNumber(stationRow.typeID),
    corporationID: toNumber(stationRow.ownerID),
    solarSystemID: toNumber(stationRow.solarSystemID) || 0,
    solarSystemName: englishText(systemRow && systemRow.name) || null,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    constellationName: englishText(constellationRow && constellationRow.name) || null,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    regionName: englishText(regionRow && regionRow.name) || null,
    stationName,
    position: buildVector(stationRow.position),
    reprocessingEfficiency: toNumber(stationRow.reprocessingEfficiency),
    reprocessingStationsTake: toNumber(stationRow.reprocessingStationsTake),
    reprocessingHangarFlag: toNumber(stationRow.reprocessingHangarFlag),
    itemName: stationName,
    itemID: toNumber(stationRow._key),
    groupID: toNumber(typeRow.groupID) || 15,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    orbitID: toNumber(stationRow.orbitID),
    orbitName,
    orbitGroupID: toNumber(orbitTypeRow && orbitTypeRow.groupID),
    orbitTypeID,
    orbitKind: orbitDescriptor ? orbitDescriptor.kind : null,
    stationTypeName: englishText(typeRow.name),
    stationRaceID: toNumber(typeRow.raceID),
    stationGraphicID: toNumber(typeRow.graphicID),
    radius,
    interactionRadius:
      toNumber(existingEntry && existingEntry.interactionRadius) ?? radius,
    useOperationName: Boolean(stationRow.useOperationName),
    dockEntry: buildOptionalVector(existingEntry && existingEntry.dockEntry),
    dockPosition: buildOptionalVector(existingEntry && existingEntry.dockPosition),
    dockOrientation: buildOptionalVector(existingEntry && existingEntry.dockOrientation),
    undockDirection: buildOptionalVector(existingEntry && existingEntry.undockDirection),
    undockPosition: buildOptionalVector(existingEntry && existingEntry.undockPosition),
  };
}

function buildMovementRecord(typeRow, dogmaRow, groupsById) {
  const attributes = new Map(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [toNumber(entry.attributeID), toNumber(entry.value)]),
  );
  const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
  const categoryID = toNumber(groupRow && groupRow.categoryID);
  const radius =
    attributes.get(MOVEMENT_ATTRIBUTE_IDS.radius) ??
    toNumber(typeRow.radius) ??
    attributes.get(MOVEMENT_ATTRIBUTE_IDS.signatureRadius) ??
    (categoryID === 6 ? 50 : null);
  const mass = toNumber(typeRow.mass);
  const inertia = attributes.get(MOVEMENT_ATTRIBUTE_IDS.inertia) ?? null;

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    mass,
    maxVelocity: attributes.get(MOVEMENT_ATTRIBUTE_IDS.maxVelocity) ?? null,
    inertia,
    radius,
    signatureRadius: attributes.get(MOVEMENT_ATTRIBUTE_IDS.signatureRadius) ?? null,
    warpSpeedMultiplier: attributes.get(MOVEMENT_ATTRIBUTE_IDS.warpSpeedMultiplier) ?? null,
    alignTime:
      mass && inertia
        ? Number(((-Math.log(0.25) * ((mass / 1_000_000) * inertia))).toFixed(6))
        : null,
    maxAccelerationTime:
      mass && inertia
        ? Number(((-Math.log(0.0001) * ((mass / 1_000_000) * inertia))).toFixed(6))
        : null,
  };
}

function buildDogmaAttributeTypeRecord(attributeRow) {
  const displayName = englishText(attributeRow.displayName);
  return {
    attributeID: toNumber(attributeRow._key),
    attributeName: displayName || attributeRow.name || "",
    description: attributeRow.description || "",
    iconID: toNumber(attributeRow.iconID),
    defaultValue: toNumber(attributeRow.defaultValue),
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

function buildShipDogmaRecord(typeRow, dogmaRow) {
  const attributes = Object.fromEntries(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [String(toNumber(entry.attributeID)), toNumber(entry.value)])
      .filter(([attributeID, value]) => Number.isInteger(toNumber(attributeID)) && value !== null)
      .sort((left, right) => Number(left[0]) - Number(right[0])),
  );

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    attributeCount: Object.keys(attributes).length,
    attributes,
  };
}

function ensureJsonlSync(target) {
  const source = target.source && typeof target.source === "object"
    ? target.source
    : {};
  if (!source.jsonlSync || typeof source.jsonlSync !== "object") {
    source.jsonlSync = {};
  }
  target.source = source;
  return source.jsonlSync;
}

function getJsonlAuthorityName(jsonlDir) {
  return path.basename(path.resolve(jsonlDir));
}

function markJsonlAuthority(target, jsonlDir, sdeRow) {
  if (!target || typeof target !== "object") {
    return;
  }

  const source = target.source && typeof target.source === "object"
    ? target.source
    : {};
  source.provider = "EVE Static Data JSONL";
  source.authority = getJsonlAuthorityName(jsonlDir);
  source.sourceDir = jsonlDir;
  source.generatedAt = new Date().toISOString();
  source.buildNumber = sdeRow ? sdeRow.buildNumber || null : null;
  source.releaseDate = sdeRow ? sdeRow.releaseDate || null : null;
  delete source.dumpDate;
  delete source.sourceUrl;
  delete source.generatedFrom;
  target.source = source;
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
    mapConstellationsById,
    mapRegionsById,
    mapSolarSystemsById,
    mapStarsById,
    mapPlanetsById,
    mapMoonsById,
    mapAsteroidBeltsById,
    mapStargatesById,
    npcStationsById,
    npcCorporationsById,
    stationOperationsById,
    dogmaAttributesById,
    racesById,
    bloodlinesById,
    itemTypesRoot,
    shipTypesRoot,
    skillTypesRoot,
    characterCreationRacesRoot,
    characterCreationBloodlinesRoot,
    solarSystemsRoot,
    stationsRoot,
    stationTypesRoot,
    stargateTypesRoot,
    stargatesRoot,
    celestialsRoot,
    movementRoot,
    shipDogmaRoot,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "_sde.jsonl"), (row) => row._key === "sde" ? 1 : null),
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapConstellations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapRegions.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapSolarSystems.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStars.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapPlanets.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapMoons.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapAsteroidBelts.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStargates.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcStations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcCorporations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "stationOperations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "dogmaAttributes.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "races.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "bloodlines.jsonl"), (row) => row._key),
    readJson(path.join(localDbRoot, "itemTypes", "data.json")),
    readJson(path.join(localDbRoot, "shipTypes", "data.json")),
    readJson(path.join(localDbRoot, "skillTypes", "data.json")),
    readJson(path.join(localDbRoot, "characterCreationRaces", "data.json")),
    readJson(path.join(localDbRoot, "characterCreationBloodlines", "data.json")),
    readJson(path.join(localDbRoot, "solarSystems", "data.json")),
    readJson(path.join(localDbRoot, "stations", "data.json")),
    readJson(path.join(localDbRoot, "stationTypes", "data.json")),
    readJson(path.join(localDbRoot, "stargateTypes", "data.json")),
    readJson(path.join(localDbRoot, "stargates", "data.json")),
    readJson(path.join(localDbRoot, "celestials", "data.json")),
    readJson(path.join(localDbRoot, "movementAttributes", "data.json")),
    readJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json")),
  ]);

  const itemTypeIDs = [...typesById.keys()]
    .map((value) => toNumber(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  const shipTypeIDs = [];
  const skillTypeIDs = [];
  for (const [typeID, typeRow] of typesById.entries()) {
    const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
    const categoryID = toNumber(groupRow && groupRow.categoryID);
    if (categoryID === 6) {
      shipTypeIDs.push(typeID);
    }
    if (categoryID === 16) {
      skillTypeIDs.push(typeID);
    }
  }

  const localItemTypeIDs = new Set((itemTypesRoot.types || []).map((row) => Number(row.typeID)));
  const localShipTypeIDs = new Set((shipTypesRoot.ships || []).map((row) => Number(row.typeID)));
  const localSkillTypeIDs = new Set((skillTypesRoot.skills || []).map((row) => Number(row.typeID)));
  const localCharacterCreationRaceIDs = new Set(
    (characterCreationRacesRoot.races || []).map((row) => Number(row.raceID)),
  );
  const localCharacterCreationBloodlineIDs = new Set(
    (characterCreationBloodlinesRoot.bloodlines || []).map((row) => Number(row.bloodlineID)),
  );
  const localSolarSystemIDs = new Set((solarSystemsRoot.solarSystems || []).map((row) => Number(row.solarSystemID)));
  const localStationIDs = new Set((stationsRoot.stations || []).map((row) => Number(row.stationID)));
  const localStationTypeIDs = new Set((stationTypesRoot.stationTypes || []).map((row) => Number(row.stationTypeID)));
  const localStargateTypeIDs = new Set((stargateTypesRoot.stargateTypes || []).map((row) => Number(row.typeID)));
  const localStargateIDs = new Set((stargatesRoot.stargates || []).map((row) => Number(row.itemID)));
  const localCelestialIDs = new Set((celestialsRoot.celestials || []).map((row) => Number(row.itemID)));
  const localMovementTypeIDs = new Set((movementRoot.attributes || []).map((row) => Number(row.typeID)));
  const localDogmaAttributeIDs = new Set(Object.keys(shipDogmaRoot.attributeTypesByID || {}).map(Number));
  const localDogmaShipTypeIDs = new Set(Object.keys(shipDogmaRoot.shipAttributesByTypeID || {}).map(Number));
  const stationTypeIDs = uniqueSortedNumbers(
    [...npcStationsById.values()].map((row) => row.typeID),
  );
  const stargateTypeIDs = uniqueSortedNumbers(
    [...mapStargatesById.values()].map((row) => row.typeID),
  );
  const stationOrbitIDs = uniqueSortedNumbers(
    [...npcStationsById.values()].map((row) => row.orbitID),
  );
  const relevantMovementTypeIDs = new Set([
    ...shipTypeIDs,
    ...stationTypeIDs,
    ...[...mapStarsById.values()].map((row) => row.typeID),
    ...[...mapPlanetsById.values()].map((row) => row.typeID),
    ...[...mapMoonsById.values()].map((row) => row.typeID),
    ...[...mapAsteroidBeltsById.values()].map((row) => row.typeID),
    ...[...mapStargatesById.values()].map((row) => row.typeID),
  ].map((value) => toNumber(value)).filter((value) => Number.isInteger(value) && value > 0));
  const derivedCelestialIDs = uniqueSortedNumbers([
    ...mapStarsById.keys(),
    ...mapPlanetsById.keys(),
    ...stationOrbitIDs.filter((orbitID) =>
      mapMoonsById.has(orbitID) || mapAsteroidBeltsById.has(orbitID),
    ),
  ]);

  const missingItemTypeIDs = itemTypeIDs.filter((id) => !localItemTypeIDs.has(id));
  const missingShipTypeIDs = shipTypeIDs.filter((id) => !localShipTypeIDs.has(id));
  const missingSkillTypeIDs = skillTypeIDs.filter((id) => !localSkillTypeIDs.has(id));
  const missingCharacterCreationRaceIDs = CHARACTER_CREATION_RACE_IDS.filter(
    (id) => !localCharacterCreationRaceIDs.has(id),
  );
  const missingCharacterCreationBloodlineIDs = CHARACTER_CREATION_BLOODLINE_IDS.filter(
    (id) => !localCharacterCreationBloodlineIDs.has(id),
  );
  const missingSolarSystemIDs = [...mapSolarSystemsById.keys()].filter((id) => !localSolarSystemIDs.has(id));
  const missingStationIDs = [...npcStationsById.keys()].filter((id) => !localStationIDs.has(id));
  const missingStationTypeIDs = stationTypeIDs.filter((id) => !localStationTypeIDs.has(id));
  const missingStargateTypeIDs = stargateTypeIDs.filter((id) => !localStargateTypeIDs.has(id));
  const missingStargateIDs = [...mapStargatesById.keys()].filter((id) => !localStargateIDs.has(id));
  const missingCelestialIDs = derivedCelestialIDs.filter((id) => !localCelestialIDs.has(id));
  const missingMovementTypeIDs = [...relevantMovementTypeIDs].filter((id) => !localMovementTypeIDs.has(id));
  const missingDogmaAttributeIDs = [...dogmaAttributesById.keys()].filter((id) => !localDogmaAttributeIDs.has(id));
  const missingDogmaShipTypeIDs = shipTypeIDs.filter((id) => !localDogmaShipTypeIDs.has(id));

  const allDogmaTypeIds = new Set(shipTypeIDs);
  const missingDogmaTypeIds = new Set([
    ...shipTypeIDs,
    ...relevantMovementTypeIDs,
  ]);
  const typeDogmaById = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(jsonlDir, "typeDogma.jsonl")),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const typeID = toNumber(row._key);
    if (Number.isInteger(typeID) && missingDogmaTypeIds.has(typeID)) {
      typeDogmaById.set(typeID, row);
    }
  }

  itemTypesRoot.types = itemTypeIDs
    .map((typeID) => {
      const typeRow = typesById.get(typeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow) {
        return null;
      }
      return buildTypeRecord(typeRow, groupRow);
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")) ||
        left.typeID - right.typeID,
    );
  itemTypesRoot.count = itemTypesRoot.types.length;
  ensureJsonlSync(itemTypesRoot).updatedTypeIDs = uniqueSortedNumbers(itemTypeIDs);

  shipTypesRoot.ships = shipTypeIDs
    .map((typeID) => {
      const typeRow = typesById.get(typeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }
      return buildTypeRecord(typeRow, groupRow);
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID);
  shipTypesRoot.count = shipTypesRoot.ships.length;
  ensureJsonlSync(shipTypesRoot).updatedTypeIDs = uniqueSortedNumbers(shipTypeIDs);

  skillTypesRoot.skills = skillTypeIDs
    .map((typeID) => {
      const typeRow = typesById.get(typeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }
      return buildSkillRecord(typeRow, groupRow);
    })
    .filter(Boolean)
    .sort(
    (left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID,
  );
  skillTypesRoot.count = skillTypesRoot.skills.length;
  ensureJsonlSync(skillTypesRoot).updatedTypeIDs = uniqueSortedNumbers(skillTypeIDs);

  characterCreationRacesRoot.races = CHARACTER_CREATION_RACE_IDS
    .map((raceID) => buildCharacterCreationRaceRecord(racesById.get(raceID), typesById))
    .filter(Boolean)
    .sort((left, right) => left.raceID - right.raceID);
  characterCreationRacesRoot.count = characterCreationRacesRoot.races.length;
  ensureJsonlSync(characterCreationRacesRoot).updatedRaceIDs = uniqueSortedNumbers(
    CHARACTER_CREATION_RACE_IDS,
  );

  characterCreationBloodlinesRoot.bloodlines = CHARACTER_CREATION_BLOODLINE_IDS
    .map((bloodlineID) =>
      buildCharacterCreationBloodlineRecord(bloodlinesById.get(bloodlineID)),
    )
    .filter(Boolean)
    .sort((left, right) => left.bloodlineID - right.bloodlineID);
  characterCreationBloodlinesRoot.count = characterCreationBloodlinesRoot.bloodlines.length;
  ensureJsonlSync(characterCreationBloodlinesRoot).updatedBloodlineIDs =
    uniqueSortedNumbers(CHARACTER_CREATION_BLOODLINE_IDS);

  solarSystemsRoot.solarSystems = [...mapSolarSystemsById.keys()]
    .sort((left, right) => left - right)
    .map((systemID) => {
      const row = mapSolarSystemsById.get(systemID);
      return row ? buildSolarSystemRecord(row, mapStarsById) : null;
    })
    .filter(Boolean);
  solarSystemsRoot.count = solarSystemsRoot.solarSystems.length;
  ensureJsonlSync(solarSystemsRoot).updatedSolarSystemIDs = uniqueSortedNumbers(
    [...mapSolarSystemsById.keys()],
  );

  const existingStationsById = new Map(
    (Array.isArray(stationsRoot.stations) ? stationsRoot.stations : [])
      .map((entry) => [toNumber(entry && entry.stationID), entry]),
  );
  const existingStationTypesById = new Map(
    (Array.isArray(stationTypesRoot.stationTypes) ? stationTypesRoot.stationTypes : [])
      .map((entry) => [toNumber(entry && entry.stationTypeID), entry]),
  );
  const orbitLookups = new Map([
    ["star", mapStarsById],
    ["planet", mapPlanetsById],
    ["moon", mapMoonsById],
    ["asteroidBelt", mapAsteroidBeltsById],
  ]);

  stationTypesRoot.stationTypes = stationTypeIDs
    .map((stationTypeID) => {
      const typeRow = typesById.get(stationTypeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }

      return buildStationTypeRecord(
        typeRow,
        groupRow,
        existingStationTypesById.get(stationTypeID) || null,
      );
    })
    .filter(Boolean)
    .sort((left, right) => left.stationTypeID - right.stationTypeID);
  stationTypesRoot.count = stationTypesRoot.stationTypes.length;
  ensureJsonlSync(stationTypesRoot).updatedStationTypeIDs = uniqueSortedNumbers(
    stationTypeIDs,
  );

  stargateTypesRoot.stargateTypes = stargateTypeIDs
    .map((typeID) => {
      const typeRow = typesById.get(typeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }

      return buildStargateTypeRecord(typeRow, groupRow);
    })
    .filter(Boolean)
    .sort((left, right) => left.typeID - right.typeID);
  stargateTypesRoot.count = stargateTypesRoot.stargateTypes.length;
  ensureJsonlSync(stargateTypesRoot).updatedStargateTypeIDs = uniqueSortedNumbers(
    stargateTypeIDs,
  );

  stationsRoot.stations = [...npcStationsById.keys()]
    .sort((left, right) => left - right)
    .map((stationID) => {
      const stationRow = npcStationsById.get(stationID);
      const systemRow =
        mapSolarSystemsById.get(toNumber(stationRow && stationRow.solarSystemID)) || null;
      const typeRow = typesById.get(toNumber(stationRow && stationRow.typeID)) || null;
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      const corporationRow =
        npcCorporationsById.get(toNumber(stationRow && stationRow.ownerID)) || null;
      const operationRow =
        stationOperationsById.get(toNumber(stationRow && stationRow.operationID)) || null;
      const constellationRow =
        mapConstellationsById.get(toNumber(systemRow && systemRow.constellationID)) || null;
      const regionRow =
        mapRegionsById.get(toNumber(systemRow && systemRow.regionID)) || null;
      const orbitDescriptor = getOrbitDescriptor(stationRow && stationRow.orbitID, orbitLookups);
      if (!stationRow || !systemRow || !typeRow || !groupRow) {
        return null;
      }

      return buildStationRecord({
        stationRow,
        systemRow,
        constellationRow,
        regionRow,
        typeRow,
        groupRow,
        typesById,
        groupsById,
        corporationRow,
        operationRow,
        orbitDescriptor,
        existingEntry: existingStationsById.get(stationID) || null,
        mapSolarSystemsById,
        orbitLookups,
      });
    })
    .filter(Boolean);
  stationsRoot.count = stationsRoot.stations.length;
  ensureJsonlSync(stationsRoot).updatedStationIDs = uniqueSortedNumbers(
    [...npcStationsById.keys()],
  );

  stargatesRoot.stargates = [...mapStargatesById.keys()]
    .sort((left, right) => left - right)
    .map((gateID) => {
      const row = mapStargatesById.get(gateID);
      return row ? buildStargateRecord(row, mapSolarSystemsById) : null;
    })
    .filter(Boolean);
  stargatesRoot.count = stargatesRoot.stargates.length;
  ensureJsonlSync(stargatesRoot).updatedStargateIDs = uniqueSortedNumbers(
    [...mapStargatesById.keys()],
  );

  celestialsRoot.celestials = derivedCelestialIDs
    .map((celestialID) => {
      if (mapStarsById.has(celestialID)) {
        const row = mapStarsById.get(celestialID);
        const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
        const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
        const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
        if (!row || !systemRow) {
          return null;
        }
        return buildStarRecord(row, systemRow, typeRow, groupRow);
      }

      if (mapPlanetsById.has(celestialID)) {
        const row = mapPlanetsById.get(celestialID);
        const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
        const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
        const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
        if (!row || !systemRow) {
          return null;
        }
        return buildPlanetRecord(row, systemRow, typeRow, groupRow);
      }

      if (mapMoonsById.has(celestialID)) {
        const row = mapMoonsById.get(celestialID);
        const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
        const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
        const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
        if (!row || !systemRow) {
          return null;
        }
        return buildMoonRecord(
          row,
          systemRow,
          typeRow,
          groupRow,
          mapSolarSystemsById,
          orbitLookups,
        );
      }

      if (mapAsteroidBeltsById.has(celestialID)) {
        const row = mapAsteroidBeltsById.get(celestialID);
        const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
        const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
        const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
        if (!row || !systemRow) {
          return null;
        }
        return buildAsteroidBeltRecord(
          row,
          systemRow,
          typeRow,
          groupRow,
          mapSolarSystemsById,
          orbitLookups,
        );
      }

      return null;
    })
    .filter(Boolean)
    .sort((left, right) => left.itemID - right.itemID);
  celestialsRoot.count = celestialsRoot.celestials.length;
  ensureJsonlSync(celestialsRoot).updatedCelestialIDs = uniqueSortedNumbers(
    derivedCelestialIDs,
  );

  const movementTypeIDs = uniqueSortedNumbers([...relevantMovementTypeIDs]);
  const movementRecords = [];
  for (const typeID of movementTypeIDs) {
    const typeRow = typesById.get(typeID);
    const dogmaRow = typeDogmaById.get(typeID) || null;
    if (!typeRow) {
      continue;
    }
    movementRecords.push(buildMovementRecord(typeRow, dogmaRow, groupsById));
  }
  movementRoot.attributes = movementRecords;
  movementRoot.attributes.sort((left, right) => left.typeID - right.typeID);
  movementRoot.count = movementRoot.attributes.length;
  ensureJsonlSync(movementRoot).updatedTypeIDs = movementTypeIDs;

  shipDogmaRoot.attributeTypesByID = Object.fromEntries(
    [...dogmaAttributesById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([attributeID, attributeRow]) => [
        String(attributeID),
        buildDogmaAttributeTypeRecord(attributeRow),
      ]),
  );
  shipDogmaRoot.shipAttributesByTypeID = Object.fromEntries(
    shipTypeIDs
      .filter((typeID) => allDogmaTypeIds.has(typeID) && typeDogmaById.has(typeID))
      .sort((left, right) => left - right)
      .map((typeID) => [
        String(typeID),
        buildShipDogmaRecord(typesById.get(typeID), typeDogmaById.get(typeID)),
      ]),
  );
  shipDogmaRoot.counts = {
    shipTypes: Object.keys(shipDogmaRoot.shipAttributesByTypeID || {}).length,
    attributeTypes: Object.keys(shipDogmaRoot.attributeTypesByID || {}).length,
    totalAttributes: Object.values(shipDogmaRoot.shipAttributesByTypeID || {}).reduce(
      (sum, entry) => sum + (toNumber(entry && entry.attributeCount) || 0),
      0,
    ),
  };
  ensureJsonlSync(shipDogmaRoot).updatedAttributeIDs = uniqueSortedNumbers(missingDogmaAttributeIDs);
  ensureJsonlSync(shipDogmaRoot).updatedShipTypeIDs = uniqueSortedNumbers(shipTypeIDs);

  const sdeRow = sdeMeta.get(1) || null;
  for (const root of [
    itemTypesRoot,
    shipTypesRoot,
    skillTypesRoot,
    characterCreationRacesRoot,
    characterCreationBloodlinesRoot,
    solarSystemsRoot,
    stationsRoot,
    stationTypesRoot,
    stargatesRoot,
    stargateTypesRoot,
    celestialsRoot,
    movementRoot,
    shipDogmaRoot,
  ]) {
    markJsonlAuthority(root, jsonlDir, sdeRow);
    const sync = ensureJsonlSync(root);
    sync.sourceDir = jsonlDir;
    sync.syncedAt = new Date().toISOString();
    sync.buildNumber = sdeRow ? sdeRow.buildNumber || null : null;
    sync.releaseDate = sdeRow ? sdeRow.releaseDate || null : null;
  }
  stationsRoot.source.localExtensions = {
    preservedFields: [
      "dockingCostPerVolume",
      "maxShipVolumeDockable",
      "officeRentalCost",
      "dockEntry",
      "dockPosition",
      "dockOrientation",
      "undockDirection",
      "undockPosition",
    ],
    note: "These fields are preserved from local station geometry data because the JSONL SDE does not include dock/undock transforms.",
  };
  stationTypesRoot.source.localExtensions = {
    preservedFields: [
      "dockEntry",
      "dockOrientation",
    ],
    note: "These fields are preserved from local station geometry data because the JSONL SDE does not include dock transforms.",
  };

  writeJson(path.join(localDbRoot, "itemTypes", "data.json"), itemTypesRoot);
  writeJson(path.join(localDbRoot, "shipTypes", "data.json"), shipTypesRoot);
  writeJson(path.join(localDbRoot, "skillTypes", "data.json"), skillTypesRoot);
  writeJson(path.join(localDbRoot, "characterCreationRaces", "data.json"), characterCreationRacesRoot);
  writeJson(
    path.join(localDbRoot, "characterCreationBloodlines", "data.json"),
    characterCreationBloodlinesRoot,
  );
  writeJson(path.join(localDbRoot, "solarSystems", "data.json"), solarSystemsRoot);
  writeJson(path.join(localDbRoot, "stations", "data.json"), stationsRoot);
  writeJson(path.join(localDbRoot, "stationTypes", "data.json"), stationTypesRoot);
  writeJson(path.join(localDbRoot, "stargateTypes", "data.json"), stargateTypesRoot);
  writeJson(path.join(localDbRoot, "stargates", "data.json"), stargatesRoot);
  writeJson(path.join(localDbRoot, "celestials", "data.json"), celestialsRoot);
  writeJson(path.join(localDbRoot, "movementAttributes", "data.json"), movementRoot);
  writeJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json"), shipDogmaRoot);

  console.log(JSON.stringify({
    itemTypesAdded: missingItemTypeIDs.length,
    shipTypesAdded: missingShipTypeIDs.length,
    skillTypesAdded: missingSkillTypeIDs.length,
    characterCreationRacesAdded: missingCharacterCreationRaceIDs.length,
    characterCreationBloodlinesAdded: missingCharacterCreationBloodlineIDs.length,
    solarSystemsAdded: missingSolarSystemIDs.length,
    stationsAdded: missingStationIDs.length,
    stationTypesAdded: missingStationTypeIDs.length,
    stargatesAdded: missingStargateIDs.length,
    celestialsAdded: missingCelestialIDs.length,
    movementAttributesAdded: missingMovementTypeIDs.length,
    shipDogmaShipTypesAdded: missingDogmaShipTypeIDs.length,
    shipDogmaAttributeTypesAdded: missingDogmaAttributeIDs.length,
    shipDogmaTotalAttributes: shipDogmaRoot.counts.totalAttributes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MOVEMENT_ATTRIBUTE_IDS = new Set([37, 70, 162, 552, 600]);

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function englishText(value) {
  if (!value) {
    return null;
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
    return firstText || null;
  }

  return null;
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

function sameNumber(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }

  const numericLeft = Number(left);
  const numericRight = Number(right);
  if (!Number.isFinite(numericLeft) || !Number.isFinite(numericRight)) {
    return false;
  }

  return Math.abs(numericLeft - numericRight) < 1e-9;
}

function sameValue(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }

  if (typeof left === "number" || typeof right === "number") {
    return sameNumber(left, right);
  }

  return left === right;
}

function sameVector(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = buildVector(left);
  const normalizedRight = buildVector(right);
  return (
    sameNumber(normalizedLeft.x, normalizedRight.x) &&
    sameNumber(normalizedLeft.y, normalizedRight.y) &&
    sameNumber(normalizedLeft.z, normalizedRight.z)
  );
}

function pushMismatch(bucket, id, field, localValue, upstreamValue, sampleLimit = 15) {
  if (bucket.samples.length >= sampleLimit) {
    return;
  }

  bucket.samples.push({
    id,
    field,
    local: localValue,
    upstream: upstreamValue,
  });
}

function createMismatchBucket() {
  return {
    mismatchCount: 0,
    samples: [],
  };
}

function compareRecordFields(bucket, id, localRecord, upstreamRecord, fields) {
  for (const field of fields) {
    if (!sameValue(localRecord && localRecord[field], upstreamRecord && upstreamRecord[field])) {
      bucket.mismatchCount += 1;
      pushMismatch(
        bucket,
        id,
        field,
        localRecord && localRecord[field],
        upstreamRecord && upstreamRecord[field],
      );
    }
  }
}

function compareVectorField(bucket, id, field, localRecord, upstreamRecord) {
  if (!sameVector(localRecord && localRecord[field], upstreamRecord && upstreamRecord[field])) {
    bucket.mismatchCount += 1;
    pushMismatch(
      bucket,
      id,
      field,
      localRecord && localRecord[field],
      upstreamRecord && upstreamRecord[field],
    );
  }
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

function buildTypeRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || null,
    groupName: englishText(groupRow && groupRow.name),
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

function getGroupRow(groupsById, groupID) {
  return Number.isInteger(groupID) ? groupsById.get(groupID) || null : null;
}

function buildMovementRecord(typeRow, dogmaRow, groupsById) {
  const attributes = new Map(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [toNumber(entry.attributeID), toNumber(entry.value)]),
  );
  const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
  const categoryID = toNumber(groupRow && groupRow.categoryID);
  const radius =
    attributes.get(162) ??
    toNumber(typeRow.radius) ??
    attributes.get(552) ??
    (categoryID === 6 ? 50 : null);
  const mass = toNumber(typeRow.mass);
  const inertia = attributes.get(70) ?? null;

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    mass,
    maxVelocity: attributes.get(37) ?? null,
    inertia,
    radius,
    signatureRadius: attributes.get(552) ?? null,
    warpSpeedMultiplier: attributes.get(600) ?? null,
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
    effectID: toNumber(effectRow._key),
    name: effectRow.name || "",
    displayName: englishText(effectRow.displayName) || "",
    description: englishText(effectRow.description) || "",
    guid: effectRow.guid || "",
    effectCategoryID: toNumber(effectRow.effectCategoryID) ?? 0,
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
    modifierInfo: Array.isArray(effectRow.modifierInfo) ? effectRow.modifierInfo : [],
  };
}

function buildTypeDogmaRecord(typeRow, dogmaRow) {
  const attributes = Object.fromEntries(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [String(toNumber(entry.attributeID)), toNumber(entry.value)])
      .filter(([attributeID, value]) => Number.isInteger(toNumber(attributeID)) && value !== null)
      .sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  const effects = [...new Set(
    (Array.isArray(dogmaRow && dogmaRow.dogmaEffects) ? dogmaRow.dogmaEffects : [])
      .map((entry) => (
        typeof entry === "object" && entry !== null
          ? toNumber(entry.effectID)
          : toNumber(entry)
      ))
      .filter((effectID) => Number.isInteger(effectID) && effectID > 0),
  )].sort((left, right) => left - right);

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    attributeCount: Object.keys(attributes).length,
    effectCount: effects.length,
    attributes,
    effects,
  };
}

function buildMaterialEntry(existingEntry, upstreamRow) {
  const numericMaterialID = toNumber(
    upstreamRow && (upstreamRow.skinMaterialID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.skinMaterialID);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    skinMaterialID: numericMaterialID,
    displayNameID:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "displayNameID")
        ? existingEntry.displayNameID
        : null,
    materialSetID:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "materialSetID")
        ? existingEntry.materialSetID
        : toNumber(upstreamRow && upstreamRow.materialSetID),
    displayName:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "displayName")
        ? existingEntry.displayName
        : (upstreamRow && upstreamRow.displayName) || null,
    skinIDs: [],
    shipTypeIDs: [],
    licenseTypeIDs: [],
  };
}

function buildSkinEntry(existingEntry, upstreamRow, materialEntry) {
  const numericSkinID = toNumber(
    upstreamRow && (upstreamRow.skinID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.skinID);
  const numericMaterialID =
    toNumber(upstreamRow && upstreamRow.skinMaterialID) ||
    toNumber(existingEntry && existingEntry.skinMaterialID);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    skinID: numericSkinID,
    internalName:
      (existingEntry && existingEntry.internalName) ||
      (upstreamRow && upstreamRow.internalName) ||
      "",
    skinMaterialID: numericMaterialID || null,
    material: {
      ...(existingEntry && existingEntry.material && typeof existingEntry.material === "object"
        ? existingEntry.material
        : {}),
      skinMaterialID: numericMaterialID || null,
      displayNameID:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "displayNameID")
          ? existingEntry.material.displayNameID
          : (materialEntry ? materialEntry.displayNameID : null),
      materialSetID:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "materialSetID")
          ? existingEntry.material.materialSetID
          : (materialEntry ? materialEntry.materialSetID : null),
      displayName:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "displayName")
          ? existingEntry.material.displayName
          : (materialEntry ? materialEntry.displayName : null),
    },
    shipTypeIDs: integerArray([
      ...((existingEntry && existingEntry.shipTypeIDs) || []),
      ...(((upstreamRow && upstreamRow.types) || []).map((value) => toNumber(value))),
    ]),
    licenseTypeIDs: [],
    licenseTypes: [],
    allowCCPDevs:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "allowCCPDevs")
        ? Boolean(upstreamRow.allowCCPDevs)
        : Boolean(existingEntry && existingEntry.allowCCPDevs),
    skinDescription:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "skinDescription")
        ? upstreamRow.skinDescription
        : (existingEntry && existingEntry.skinDescription) || null,
    visibleSerenity:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "visibleSerenity")
        ? Boolean(upstreamRow.visibleSerenity)
        : Boolean(existingEntry && existingEntry.visibleSerenity),
    visibleTranquility:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "visibleTranquility")
        ? Boolean(upstreamRow.visibleTranquility)
        : Boolean(existingEntry && existingEntry.visibleTranquility),
  };
}

function buildLicenseMetadata(typesById, groupsById, licenseTypeID) {
  const typeRow = typesById.get(licenseTypeID) || null;
  const groupID = toNumber(typeRow && typeRow.groupID);
  const groupRow = groupID ? groupsById.get(groupID) || null : null;

  return {
    typeName: englishText(typeRow && typeRow.name),
    published:
      typeRow && Object.prototype.hasOwnProperty.call(typeRow, "published")
        ? Boolean(typeRow.published)
        : false,
    groupID,
    groupName: englishText(groupRow && groupRow.name),
    groupPublished:
      groupRow && Object.prototype.hasOwnProperty.call(groupRow, "published")
        ? Boolean(groupRow.published)
        : false,
  };
}

function buildLicenseEntry(existingEntry, upstreamRow, skinEntry, typesById, groupsById) {
  const numericLicenseTypeID = toNumber(
    upstreamRow && (upstreamRow.licenseTypeID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.licenseTypeID);
  const numericSkinID =
    toNumber(upstreamRow && upstreamRow.skinID) ||
    toNumber(existingEntry && existingEntry.skinID);
  const metadata = buildLicenseMetadata(typesById, groupsById, numericLicenseTypeID);
  const shipTypeIDs = integerArray([
    ...((existingEntry && existingEntry.shipTypeIDs) || []),
    ...((skinEntry && skinEntry.shipTypeIDs) || []),
  ]);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    licenseTypeID: numericLicenseTypeID,
    skinID: numericSkinID || null,
    skinMaterialID:
      (skinEntry && skinEntry.skinMaterialID) ||
      (existingEntry && existingEntry.skinMaterialID) ||
      null,
    internalName:
      (skinEntry && skinEntry.internalName) ||
      (existingEntry && existingEntry.internalName) ||
      "",
    shipTypeIDs,
    duration:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "duration")
        ? toNumber(upstreamRow.duration)
        : toNumber(existingEntry && existingEntry.duration),
    isSingleUse:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "isSingleUse")
        ? Boolean(upstreamRow.isSingleUse)
        : Boolean(existingEntry && existingEntry.isSingleUse),
    typeName: metadata.typeName || (existingEntry && existingEntry.typeName) || null,
    published:
      metadata.typeName !== null || metadata.groupID !== null
        ? metadata.published
        : Boolean(existingEntry && existingEntry.published),
    groupID:
      metadata.groupID !== null
        ? metadata.groupID
        : toNumber(existingEntry && existingEntry.groupID),
    groupName: metadata.groupName || (existingEntry && existingEntry.groupName) || null,
    groupPublished:
      metadata.groupID !== null
        ? metadata.groupPublished
        : Boolean(existingEntry && existingEntry.groupPublished),
    missingSkinDefinition:
      !skinEntry ||
      !Number.isInteger(toNumber(skinEntry.skinID)) ||
      toNumber(skinEntry.skinID) <= 0,
  };
}

function reindexCatalog(catalog) {
  const materialEntries = {};
  for (const [materialID, materialEntry] of Object.entries(catalog.materialsByMaterialID || {})) {
    materialEntries[materialID] = buildMaterialEntry(materialEntry, null);
  }

  const shipTypeEntries = {};
  const licenseRowsBySkinID = new Map();
  for (const licenseEntry of Object.values(catalog.licenseTypesByTypeID || {})) {
    const skinID = toNumber(licenseEntry && licenseEntry.skinID);
    if (!Number.isInteger(skinID) || skinID <= 0) {
      continue;
    }

    if (!licenseRowsBySkinID.has(skinID)) {
      licenseRowsBySkinID.set(skinID, []);
    }

    licenseRowsBySkinID.get(skinID).push(licenseEntry);
  }

  for (const [skinID, skinEntry] of Object.entries(catalog.skinsBySkinID || {})) {
    const numericSkinID = toNumber(skinID);
    if (!Number.isInteger(numericSkinID) || numericSkinID <= 0) {
      continue;
    }

    const skinMaterialID = toNumber(skinEntry.skinMaterialID);
    const shipTypeIDs = integerArray(skinEntry.shipTypeIDs);
    const licenseEntries = (licenseRowsBySkinID.get(numericSkinID) || [])
      .slice()
      .sort((left, right) => left.licenseTypeID - right.licenseTypeID);
    const licenseTypeIDs = licenseEntries.map((entry) => entry.licenseTypeID);

    catalog.skinsBySkinID[skinID] = {
      ...skinEntry,
      shipTypeIDs,
      licenseTypeIDs,
      licenseTypes: licenseEntries.map((entry) => ({
        licenseTypeID: entry.licenseTypeID,
        duration: entry.duration,
        isSingleUse: Boolean(entry.isSingleUse),
        typeName: entry.typeName || null,
        published: Boolean(entry.published),
        groupID: toNumber(entry.groupID),
        groupName: entry.groupName || null,
        groupPublished: Boolean(entry.groupPublished),
      })),
    };

    if (Number.isInteger(skinMaterialID) && skinMaterialID > 0) {
      const materialKey = String(skinMaterialID);
      if (!materialEntries[materialKey]) {
        materialEntries[materialKey] = buildMaterialEntry(null, { _key: skinMaterialID });
      }
      materialEntries[materialKey].skinIDs.push(numericSkinID);
      materialEntries[materialKey].shipTypeIDs.push(...shipTypeIDs);
      materialEntries[materialKey].licenseTypeIDs.push(...licenseTypeIDs);
    }

    for (const typeID of shipTypeIDs) {
      const typeKey = String(typeID);
      if (!shipTypeEntries[typeKey]) {
        shipTypeEntries[typeKey] = {
          typeID,
          skinIDs: [],
          materialIDs: [],
          licenseTypeIDs: [],
        };
      }

      shipTypeEntries[typeKey].skinIDs.push(numericSkinID);
      if (Number.isInteger(skinMaterialID) && skinMaterialID > 0) {
        shipTypeEntries[typeKey].materialIDs.push(skinMaterialID);
      }
      shipTypeEntries[typeKey].licenseTypeIDs.push(...licenseTypeIDs);
    }
  }

  for (const materialEntry of Object.values(materialEntries)) {
    materialEntry.skinIDs = integerArray(materialEntry.skinIDs);
    materialEntry.shipTypeIDs = integerArray(materialEntry.shipTypeIDs);
    materialEntry.licenseTypeIDs = integerArray(materialEntry.licenseTypeIDs);
  }

  for (const shipTypeEntry of Object.values(shipTypeEntries)) {
    shipTypeEntry.skinIDs = integerArray(shipTypeEntry.skinIDs);
    shipTypeEntry.materialIDs = integerArray(shipTypeEntry.materialIDs);
    shipTypeEntry.licenseTypeIDs = integerArray(shipTypeEntry.licenseTypeIDs);
  }

  catalog.materialsByMaterialID = Object.fromEntries(
    Object.entries(materialEntries).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  catalog.shipTypesByTypeID = Object.fromEntries(
    Object.entries(shipTypeEntries).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  catalog.licenseTypesByTypeID = Object.fromEntries(
    Object.entries(catalog.licenseTypesByTypeID || {}).sort(
      (left, right) => Number(left[0]) - Number(right[0]),
    ),
  );
  catalog.skinsBySkinID = Object.fromEntries(
    Object.entries(catalog.skinsBySkinID || {}).sort(
      (left, right) => Number(left[0]) - Number(right[0]),
    ),
  );

  catalog.counts = {
    skins: Object.keys(catalog.skinsBySkinID || {}).length,
    shipTypes: Object.keys(catalog.shipTypesByTypeID || {}).length,
    materials: Object.keys(catalog.materialsByMaterialID || {}).length,
    licenseTypes: Object.keys(catalog.licenseTypesByTypeID || {}).length,
  };
}

function listJsonlBackedLocalTables(localDbRoot) {
  return fs.readdirSync(localDbRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const dataPath = path.join(localDbRoot, name, "data.json");
      if (!fs.existsSync(dataPath)) {
        return false;
      }

      try {
        const root = readJson(dataPath);
        const provider = root?.source?.provider || root?.meta?.provider;
        return provider === "EVE Static Data JSONL";
      } catch (_error) {
        return false;
      }
    })
    .sort();
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

function buildStationTypeRecord(typeRow, groupRow) {
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

function buildStationCoreRecord({
  stationRow,
  systemRow,
  constellationRow,
  regionRow,
  typeRow,
  groupRow,
  typesById,
  groupsById,
  orbitDescriptor,
  mapSolarSystemsById,
  orbitLookups,
}) {
  const orbitRow = orbitDescriptor && orbitDescriptor.row ? orbitDescriptor.row : null;
  const orbitTypeID = toNumber(orbitRow && orbitRow.typeID);
  const orbitTypeRow =
    Number.isInteger(orbitTypeID) ? typesById.get(orbitTypeID) || null : null;

  return {
    stationID: toNumber(stationRow._key),
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    operationID: toNumber(stationRow.operationID),
    stationTypeID: toNumber(stationRow.typeID),
    corporationID: toNumber(stationRow.ownerID),
    solarSystemID: toNumber(stationRow.solarSystemID) || 0,
    solarSystemName: englishText(systemRow && systemRow.name) || null,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    constellationName: englishText(constellationRow && constellationRow.name) || null,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    regionName: englishText(regionRow && regionRow.name) || null,
    position: buildVector(stationRow.position),
    reprocessingEfficiency: toNumber(stationRow.reprocessingEfficiency),
    reprocessingStationsTake: toNumber(stationRow.reprocessingStationsTake),
    reprocessingHangarFlag: toNumber(stationRow.reprocessingHangarFlag),
    itemID: toNumber(stationRow._key),
    groupID: toNumber(typeRow.groupID) || 15,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    orbitID: toNumber(stationRow.orbitID),
    orbitName: buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups),
    orbitGroupID: toNumber(orbitTypeRow && orbitTypeRow.groupID),
    orbitTypeID,
    orbitKind: orbitDescriptor ? orbitDescriptor.kind : null,
    stationTypeName: englishText(typeRow.name),
    stationRaceID: toNumber(typeRow.raceID),
    stationGraphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
    useOperationName: Boolean(stationRow.useOperationName),
  };
}

function integerArray(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNumber(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

function compareIdSets(localIds, upstreamIds, sampleLimit = 15) {
  const localSet = new Set(integerArray(localIds));
  const upstreamSet = new Set(integerArray(upstreamIds));
  const missingLocally = [...upstreamSet]
    .filter((id) => !localSet.has(id))
    .sort((left, right) => left - right);
  const extraLocally = [...localSet]
    .filter((id) => !upstreamSet.has(id))
    .sort((left, right) => left - right);

  return {
    localCount: localSet.size,
    upstreamCount: upstreamSet.size,
    missingLocallyCount: missingLocally.length,
    extraLocallyCount: extraLocally.length,
    missingLocallySample: missingLocally.slice(0, sampleLimit),
    extraLocallySample: extraLocally.slice(0, sampleLimit),
  };
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

async function loadJsonlGroups(filePath, keySelector) {
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
    const key = toNumber(keySelector(row));
    if (!Number.isInteger(key) || key <= 0) {
      continue;
    }

    if (!rows.has(key)) {
      rows.set(key, []);
    }

    rows.get(key).push(row);
  }

  return rows;
}

async function collectJsonlSet(filePath, valueSelector) {
  const values = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    for (const value of valueSelector(row) || []) {
      const numeric = toNumber(value);
      if (Number.isInteger(numeric) && numeric > 0) {
        values.add(numeric);
      }
    }
  }

  return values;
}

function getLocalTableArray(localRoot, key) {
  return Array.isArray(localRoot && localRoot[key]) ? localRoot[key] : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameStructuredValue(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!sameStructuredValue(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!sameStructuredValue(leftKeys, rightKeys)) {
      return false;
    }

    for (const key of leftKeys) {
      if (!sameStructuredValue(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return sameValue(left, right);
}

function compareStructuredField(bucket, id, field, localRecord, upstreamRecord) {
  if (!sameStructuredValue(localRecord && localRecord[field], upstreamRecord && upstreamRecord[field])) {
    bucket.mismatchCount += 1;
    pushMismatch(
      bucket,
      id,
      field,
      localRecord && localRecord[field],
      upstreamRecord && upstreamRecord[field],
    );
  }
}

function compareStructuredValues(bucket, id, field, localValue, upstreamValue) {
  if (!sameStructuredValue(localValue, upstreamValue)) {
    bucket.mismatchCount += 1;
    pushMismatch(bucket, id, field, localValue, upstreamValue);
  }
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
  const outputPath = path.resolve(
    args.output ||
      path.join(repoRoot, "_local", "reports", "jsonl-local-static-data-report.json"),
  );

  const [
    groupsById,
    typesById,
    dogmaAttributesById,
    dogmaEffectsById,
    mapConstellationsById,
    mapRegionsById,
    mapSolarSystemsById,
    npcStationsById,
    mapStargatesById,
    mapStarsById,
    mapPlanetsById,
    mapMoonsById,
    mapAsteroidBeltsById,
    skinMaterialsById,
    skinsById,
    licenseRowsBySkinID,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "dogmaAttributes.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "dogmaEffects.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapConstellations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapRegions.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapSolarSystems.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcStations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStargates.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStars.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapPlanets.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapMoons.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapAsteroidBelts.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "skinMaterials.jsonl"), (row) => row.skinMaterialID || row._key),
    loadJsonlMap(path.join(jsonlDir, "skins.jsonl"), (row) => row.skinID || row._key),
    loadJsonlGroups(path.join(jsonlDir, "skinLicenses.jsonl"), (row) => row.skinID),
  ]);

  const shipTypeIDs = [];
  const skillTypeIDs = [];
  const itemTypeIDs = [...typesById.keys()]
    .map((value) => toNumber(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  for (const [typeID, typeRow] of typesById.entries()) {
    const groupID = toNumber(typeRow.groupID);
    const groupRow = groupID ? groupsById.get(groupID) || null : null;
    const categoryID = toNumber(groupRow && groupRow.categoryID);

    if (categoryID === 6) {
      shipTypeIDs.push(typeID);
    }
    if (categoryID === 16) {
      skillTypeIDs.push(typeID);
    }
  }

  const stationTypeIDs = integerArray(
    [...npcStationsById.values()].map((row) => row.typeID),
  );
  const stargateTypeIDs = integerArray(
    [...mapStargatesById.values()].map((row) => row.typeID),
  );
  const stationOrbitIDs = integerArray(
    [...npcStationsById.values()].map((row) => row.orbitID),
  );
  const orbitLookup = new Map([
    ...mapStarsById.entries(),
    ...mapPlanetsById.entries(),
    ...mapMoonsById.entries(),
    ...mapAsteroidBeltsById.entries(),
  ]);

  const relevantMovementTypeIDs = new Set([
    ...shipTypeIDs,
    ...stationTypeIDs,
    ...[...mapStarsById.values()].map((row) => row.typeID),
    ...[...mapPlanetsById.values()].map((row) => row.typeID),
    ...[...mapMoonsById.values()].map((row) => row.typeID),
    ...[...mapAsteroidBeltsById.values()].map((row) => row.typeID),
    ...[...mapStargatesById.values()].map((row) => row.typeID),
  ].map((value) => toNumber(value)).filter((value) => Number.isInteger(value) && value > 0));

  const shipTypeIdSet = new Set(shipTypeIDs);
  const upstreamShipDogmaTypes = new Set();
  let upstreamShipDogmaAttributeRows = 0;
  let upstreamMovementTypeIDsWithRows = 0;
  const seenMovementTypes = new Set();
  const typeDogmaById = new Map();
  const typeDogmaPath = path.join(jsonlDir, "typeDogma.jsonl");
  const typeDogmaRl = readline.createInterface({
    input: fs.createReadStream(typeDogmaPath),
    crlfDelay: Infinity,
  });
  for await (const line of typeDogmaRl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const typeID = toNumber(row._key);
    if (!Number.isInteger(typeID) || typeID <= 0) {
      continue;
    }

    const attributes = Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : [];
    typeDogmaById.set(typeID, row);
    if (shipTypeIdSet.has(typeID)) {
      upstreamShipDogmaTypes.add(typeID);
      upstreamShipDogmaAttributeRows += attributes.filter((entry) => (
        Number.isInteger(toNumber(entry && entry.attributeID))
      )).length;
    }

    if (relevantMovementTypeIDs.has(typeID)) {
      seenMovementTypes.add(typeID);
      if (attributes.some((entry) => MOVEMENT_ATTRIBUTE_IDS.has(toNumber(entry && entry.attributeID)))) {
        upstreamMovementTypeIDsWithRows += 1;
      }
    }
  }

  const localCatalog = readJson(path.join(localDbRoot, "shipCosmeticsCatalog", "data.json"));
  const localItemTypes = readJson(path.join(localDbRoot, "itemTypes", "data.json"));
  const localShipTypes = readJson(path.join(localDbRoot, "shipTypes", "data.json"));
  const localSkillTypes = readJson(path.join(localDbRoot, "skillTypes", "data.json"));
  const localSolarSystems = readJson(path.join(localDbRoot, "solarSystems", "data.json"));
  const localStations = readJson(path.join(localDbRoot, "stations", "data.json"));
  const localStationTypes = readJson(path.join(localDbRoot, "stationTypes", "data.json"));
  const localStargateTypes = readJson(path.join(localDbRoot, "stargateTypes", "data.json"));
  const localStargates = readJson(path.join(localDbRoot, "stargates", "data.json"));
  const localCelestials = readJson(path.join(localDbRoot, "celestials", "data.json"));
  const localMovementAttributes = readJson(path.join(localDbRoot, "movementAttributes", "data.json"));
  const localShipDogma = readJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json"));
  const localTypeDogma = readJson(path.join(localDbRoot, "typeDogma", "data.json"));
  const orbitLookups = new Map([
    ["star", mapStarsById],
    ["planet", mapPlanetsById],
    ["moon", mapMoonsById],
    ["asteroidBelt", mapAsteroidBeltsById],
  ]);
  const derivedCelestialIDs = new Set([
    ...mapStarsById.keys(),
    ...mapPlanetsById.keys(),
  ]);
  for (const orbitID of stationOrbitIDs) {
    if (orbitLookup.has(orbitID)) {
      derivedCelestialIDs.add(orbitID);
    }
  }
  const stationOrbitMoonIDs = stationOrbitIDs.filter((orbitID) => mapMoonsById.has(orbitID));
  const stationOrbitAsteroidBeltIDs = stationOrbitIDs
    .filter((orbitID) => mapAsteroidBeltsById.has(orbitID));
  const stationOrbitStarIDs = stationOrbitIDs.filter((orbitID) => mapStarsById.has(orbitID));
  const stationOrbitPlanetIDs = stationOrbitIDs.filter((orbitID) => mapPlanetsById.has(orbitID));
  const stationOrbitStarIDSet = new Set(stationOrbitStarIDs);
  const stationOrbitPlanetIDSet = new Set(stationOrbitPlanetIDs);
  const localCelestialKinds = new Set(
    getLocalTableArray(localCelestials, "celestials").map((row) => row.kind),
  );
  if (!localCelestialKinds.has("asteroidBelt")) {
    for (const asteroidBeltID of stationOrbitAsteroidBeltIDs) {
      derivedCelestialIDs.delete(asteroidBeltID);
    }
  }

  const itemTypeValueCheck = createMismatchBucket();
  const localItemRowsById = new Map(
    getLocalTableArray(localItemTypes, "types").map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of itemTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildTypeRecord(typeRow, groupRow);
    const localRecord = localItemRowsById.get(typeID) || null;
    compareRecordFields(
      itemTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "groupID",
        "categoryID",
        "groupName",
        "name",
        "mass",
        "volume",
        "capacity",
        "portionSize",
        "raceID",
        "basePrice",
        "marketGroupID",
        "iconID",
        "soundID",
        "graphicID",
        "radius",
        "published",
      ],
    );
  }

  const shipTypeValueCheck = createMismatchBucket();
  const localShipRowsById = new Map(
    getLocalTableArray(localShipTypes, "ships").map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of shipTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildTypeRecord(typeRow, groupRow);
    const localRecord = localShipRowsById.get(typeID) || null;
    compareRecordFields(
      shipTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "groupID",
        "categoryID",
        "groupName",
        "name",
        "mass",
        "volume",
        "capacity",
        "portionSize",
        "raceID",
        "basePrice",
        "marketGroupID",
        "iconID",
        "soundID",
        "graphicID",
        "radius",
        "published",
      ],
    );
  }

  const stationTypeValueCheck = createMismatchBucket();
  const localStationTypeRowsById = new Map(
    getLocalTableArray(localStationTypes, "stationTypes")
      .map((row) => [Number(row.stationTypeID), row]),
  );
  for (const stationTypeID of stationTypeIDs) {
    const typeRow = typesById.get(stationTypeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildStationTypeRecord(typeRow, groupRow);
    const localRecord = localStationTypeRowsById.get(stationTypeID) || null;
    compareRecordFields(
      stationTypeValueCheck,
      stationTypeID,
      localRecord,
      upstreamRecord,
      [
        "typeName",
        "groupID",
        "categoryID",
        "groupName",
        "raceID",
        "graphicID",
        "radius",
        "basePrice",
        "volume",
        "portionSize",
        "published",
      ],
    );
  }

  const skillTypeValueCheck = createMismatchBucket();
  const localSkillRowsById = new Map(
    getLocalTableArray(localSkillTypes, "skills").map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of skillTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildSkillRecord(typeRow, groupRow);
    const localRecord = localSkillRowsById.get(typeID) || null;
    compareRecordFields(
      skillTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "groupID",
        "categoryID",
        "groupName",
        "name",
        "published",
        "raceID",
        "basePrice",
        "marketGroupID",
        "iconID",
        "soundID",
        "graphicID",
      ],
    );
  }

  const stargateTypeValueCheck = createMismatchBucket();
  const localStargateTypeRowsById = new Map(
    getLocalTableArray(localStargateTypes, "stargateTypes")
      .map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of stargateTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildStargateTypeRecord(typeRow, groupRow);
    const localRecord = localStargateTypeRowsById.get(typeID) || null;
    compareRecordFields(
      stargateTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "typeName",
        "groupID",
        "categoryID",
        "groupName",
        "raceID",
        "graphicID",
        "published",
      ],
    );
  }

  const solarSystemValueCheck = createMismatchBucket();
  const localSolarSystemRowsById = new Map(
    getLocalTableArray(localSolarSystems, "solarSystems")
      .map((row) => [Number(row.solarSystemID), row]),
  );
  for (const [solarSystemID, systemRow] of mapSolarSystemsById.entries()) {
    const upstreamRecord = buildSolarSystemRecord(systemRow, mapStarsById);
    const localRecord = localSolarSystemRowsById.get(solarSystemID) || null;
    compareRecordFields(
      solarSystemValueCheck,
      solarSystemID,
      localRecord,
      upstreamRecord,
      [
        "regionID",
        "constellationID",
        "solarSystemID",
        "solarSystemName",
        "security",
        "factionID",
        "radius",
        "sunTypeID",
        "securityClass",
      ],
    );
    compareVectorField(solarSystemValueCheck, solarSystemID, "position", localRecord, upstreamRecord);
  }

  const stargateValueCheck = createMismatchBucket();
  const localStargateRowsById = new Map(
    getLocalTableArray(localStargates, "stargates").map((row) => [Number(row.itemID), row]),
  );
  for (const [stargateID, stargateRow] of mapStargatesById.entries()) {
    const upstreamRecord = buildStargateRecord(stargateRow, mapSolarSystemsById);
    const localRecord = localStargateRowsById.get(stargateID) || null;
    compareRecordFields(
      stargateValueCheck,
      stargateID,
      localRecord,
      upstreamRecord,
      [
        "typeID",
        "solarSystemID",
        "itemName",
        "radius",
        "destinationID",
        "destinationSolarSystemID",
        "destinationName",
      ],
    );
    compareVectorField(stargateValueCheck, stargateID, "position", localRecord, upstreamRecord);
  }

  const celestialValueCheck = createMismatchBucket();
  const localCelestialRowsById = new Map(
    getLocalTableArray(localCelestials, "celestials").map((row) => [Number(row.itemID), row]),
  );
  for (const [celestialID, starRow] of mapStarsById.entries()) {
    if (stationOrbitStarIDSet.has(celestialID)) {
      continue;
    }
    const systemRow = mapSolarSystemsById.get(toNumber(starRow.solarSystemID)) || null;
    const typeRow = typesById.get(toNumber(starRow.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildStarRecord(starRow, systemRow, typeRow, groupRow);
    const localRecord = localCelestialRowsById.get(celestialID) || null;
    compareRecordFields(
      celestialValueCheck,
      celestialID,
      localRecord,
      upstreamRecord,
      [
        "typeID",
        "groupID",
        "categoryID",
        "groupName",
        "solarSystemID",
        "constellationID",
        "regionID",
        "orbitID",
        "radius",
        "itemName",
        "security",
        "celestialIndex",
        "orbitIndex",
        "kind",
      ],
    );
    compareVectorField(celestialValueCheck, celestialID, "position", localRecord, upstreamRecord);
  }
  for (const [celestialID, planetRow] of mapPlanetsById.entries()) {
    if (stationOrbitPlanetIDSet.has(celestialID)) {
      continue;
    }
    const systemRow = mapSolarSystemsById.get(toNumber(planetRow.solarSystemID)) || null;
    const typeRow = typesById.get(toNumber(planetRow.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildPlanetRecord(planetRow, systemRow, typeRow, groupRow);
    const localRecord = localCelestialRowsById.get(celestialID) || null;
    compareRecordFields(
      celestialValueCheck,
      celestialID,
      localRecord,
      upstreamRecord,
      [
        "typeID",
        "groupID",
        "categoryID",
        "groupName",
        "solarSystemID",
        "constellationID",
        "regionID",
        "orbitID",
        "radius",
        "itemName",
        "security",
        "celestialIndex",
        "orbitIndex",
        "kind",
      ],
    );
    compareVectorField(celestialValueCheck, celestialID, "position", localRecord, upstreamRecord);
  }
  for (const celestialID of stationOrbitMoonIDs) {
    const moonRow = mapMoonsById.get(celestialID);
    const systemRow = mapSolarSystemsById.get(toNumber(moonRow.solarSystemID)) || null;
    const typeRow = typesById.get(toNumber(moonRow.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildMoonRecord(
      moonRow,
      systemRow,
      typeRow,
      groupRow,
      mapSolarSystemsById,
      orbitLookups,
    );
    const localRecord = localCelestialRowsById.get(celestialID) || null;
    compareRecordFields(
      celestialValueCheck,
      celestialID,
      localRecord,
      upstreamRecord,
      [
        "typeID",
        "groupID",
        "categoryID",
        "groupName",
        "solarSystemID",
        "constellationID",
        "regionID",
        "orbitID",
        "radius",
        "itemName",
        "security",
        "celestialIndex",
        "orbitIndex",
        "kind",
      ],
    );
    compareVectorField(celestialValueCheck, celestialID, "position", localRecord, upstreamRecord);
  }
  if (localCelestialKinds.has("asteroidBelt")) {
    for (const celestialID of stationOrbitAsteroidBeltIDs) {
      const beltRow = mapAsteroidBeltsById.get(celestialID);
      const systemRow = mapSolarSystemsById.get(toNumber(beltRow.solarSystemID)) || null;
      const typeRow = typesById.get(toNumber(beltRow.typeID)) || null;
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      const upstreamRecord = buildAsteroidBeltRecord(
        beltRow,
        systemRow,
        typeRow,
        groupRow,
        mapSolarSystemsById,
        orbitLookups,
      );
      const localRecord = localCelestialRowsById.get(celestialID) || null;
      compareRecordFields(
        celestialValueCheck,
        celestialID,
        localRecord,
        upstreamRecord,
        [
          "typeID",
          "groupID",
          "categoryID",
          "groupName",
          "solarSystemID",
          "constellationID",
          "regionID",
          "orbitID",
          "radius",
          "itemName",
          "security",
          "celestialIndex",
          "orbitIndex",
          "kind",
        ],
      );
      compareVectorField(celestialValueCheck, celestialID, "position", localRecord, upstreamRecord);
    }
  }

  const stationValueCheck = createMismatchBucket();
  const localStationRowsById = new Map(
    getLocalTableArray(localStations, "stations").map((row) => [Number(row.stationID), row]),
  );
  for (const [stationID, stationRow] of npcStationsById.entries()) {
    const systemRow = mapSolarSystemsById.get(toNumber(stationRow.solarSystemID)) || null;
    const constellationRow =
      mapConstellationsById.get(toNumber(systemRow && systemRow.constellationID)) || null;
    const regionRow =
      mapRegionsById.get(toNumber(systemRow && systemRow.regionID)) || null;
    const typeRow = typesById.get(toNumber(stationRow.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const orbitDescriptor = getOrbitDescriptor(stationRow.orbitID, orbitLookups);
    const upstreamRecord = buildStationCoreRecord({
      stationRow,
      systemRow,
      constellationRow,
      regionRow,
      typeRow,
      groupRow,
      typesById,
      groupsById,
      orbitDescriptor,
      mapSolarSystemsById,
      orbitLookups,
    });
    const localRecord = localStationRowsById.get(stationID) || null;
    compareRecordFields(
      stationValueCheck,
      stationID,
      localRecord,
      upstreamRecord,
      [
        "security",
        "operationID",
        "stationTypeID",
        "corporationID",
        "solarSystemID",
        "solarSystemName",
        "constellationID",
        "constellationName",
        "regionID",
        "regionName",
        "reprocessingEfficiency",
        "reprocessingStationsTake",
        "reprocessingHangarFlag",
        "itemID",
        "groupID",
        "categoryID",
        "orbitID",
        "orbitName",
        "orbitGroupID",
        "orbitTypeID",
        "orbitKind",
        "stationTypeName",
        "stationRaceID",
        "stationGraphicID",
        "radius",
        "useOperationName",
      ],
    );
    compareVectorField(stationValueCheck, stationID, "position", localRecord, upstreamRecord);
  }

  const movementValueCheck = createMismatchBucket();
  const localMovementRowsById = new Map(
    getLocalTableArray(localMovementAttributes, "attributes")
      .map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of relevantMovementTypeIDs) {
    const typeRow = typesById.get(typeID);
    if (!typeRow) {
      continue;
    }
    const localRecord = localMovementRowsById.get(typeID) || null;
    const upstreamRecord = buildMovementRecord(
      typeRow,
      typeDogmaById.get(typeID) || null,
      groupsById,
    );
    compareRecordFields(
      movementValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "typeName",
        "mass",
        "maxVelocity",
        "inertia",
        "radius",
        "signatureRadius",
        "warpSpeedMultiplier",
        "alignTime",
        "maxAccelerationTime",
      ],
    );
  }

  const upstreamCatalog = {
    skinsBySkinID: {},
    materialsByMaterialID: {},
    licenseTypesByTypeID: {},
    shipTypesByTypeID: {},
  };
  for (const [materialID, materialRow] of skinMaterialsById.entries()) {
    upstreamCatalog.materialsByMaterialID[String(materialID)] = buildMaterialEntry(null, materialRow);
  }
  for (const [skinID, skinRow] of skinsById.entries()) {
    const materialEntry =
      upstreamCatalog.materialsByMaterialID[String(toNumber(skinRow.skinMaterialID) || 0)] || null;
    upstreamCatalog.skinsBySkinID[String(skinID)] = buildSkinEntry(null, skinRow, materialEntry);
  }
  const licenseRowsByLicenseTypeID = new Map();
  for (const licenseRows of licenseRowsBySkinID.values()) {
    for (const row of licenseRows) {
      const licenseTypeID = toNumber(row.licenseTypeID || row._key);
      if (Number.isInteger(licenseTypeID) && licenseTypeID > 0) {
        licenseRowsByLicenseTypeID.set(licenseTypeID, row);
      }
    }
  }
  for (const [licenseTypeID, licenseRow] of licenseRowsByLicenseTypeID.entries()) {
    const skinID = toNumber(licenseRow.skinID);
    const skinEntry =
      Number.isInteger(skinID) && skinID > 0
        ? upstreamCatalog.skinsBySkinID[String(skinID)] || null
        : null;
    upstreamCatalog.licenseTypesByTypeID[String(licenseTypeID)] = buildLicenseEntry(
      null,
      licenseRow,
      skinEntry,
      typesById,
      groupsById,
    );
  }
  reindexCatalog(upstreamCatalog);

  const catalogCountValueCheck = createMismatchBucket();
  compareStructuredValues(
    catalogCountValueCheck,
    "shipCosmeticsCatalog",
    "counts",
    localCatalog.counts || null,
    upstreamCatalog.counts || null,
  );

  const catalogMaterialValueCheck = createMismatchBucket();
  const catalogMaterialKeys = integerArray([
    ...Object.keys(localCatalog.materialsByMaterialID || {}),
    ...Object.keys(upstreamCatalog.materialsByMaterialID || {}),
  ]);
  for (const materialID of catalogMaterialKeys) {
    const localRecord = localCatalog.materialsByMaterialID
      ? localCatalog.materialsByMaterialID[String(materialID)] || null
      : null;
    const upstreamRecord = upstreamCatalog.materialsByMaterialID
      ? upstreamCatalog.materialsByMaterialID[String(materialID)] || null
      : null;
    compareRecordFields(
      catalogMaterialValueCheck,
      materialID,
      localRecord,
      upstreamRecord,
      ["skinMaterialID", "materialSetID"],
    );
    compareStructuredField(
      catalogMaterialValueCheck,
      materialID,
      "displayName",
      localRecord,
      upstreamRecord,
    );
    compareStructuredField(
      catalogMaterialValueCheck,
      materialID,
      "skinIDs",
      localRecord,
      upstreamRecord,
    );
    compareStructuredField(
      catalogMaterialValueCheck,
      materialID,
      "shipTypeIDs",
      localRecord,
      upstreamRecord,
    );
    compareStructuredField(
      catalogMaterialValueCheck,
      materialID,
      "licenseTypeIDs",
      localRecord,
      upstreamRecord,
    );
  }

  const catalogSkinValueCheck = createMismatchBucket();
  const catalogSkinKeys = integerArray([
    ...Object.keys(localCatalog.skinsBySkinID || {}),
    ...Object.keys(upstreamCatalog.skinsBySkinID || {}),
  ]);
  for (const skinID of catalogSkinKeys) {
    const localRecord = localCatalog.skinsBySkinID
      ? localCatalog.skinsBySkinID[String(skinID)] || null
      : null;
    const upstreamRecord = upstreamCatalog.skinsBySkinID
      ? upstreamCatalog.skinsBySkinID[String(skinID)] || null
      : null;
    compareRecordFields(
      catalogSkinValueCheck,
      skinID,
      localRecord,
      upstreamRecord,
      [
        "skinID",
        "internalName",
        "skinMaterialID",
        "allowCCPDevs",
        "visibleSerenity",
        "visibleTranquility",
      ],
    );
    compareStructuredValues(
      catalogSkinValueCheck,
      skinID,
      "skinDescription",
      localRecord ? localRecord.skinDescription : null,
      upstreamRecord ? upstreamRecord.skinDescription : null,
    );
    for (const materialField of ["skinMaterialID", "materialSetID"]) {
      compareStructuredValues(
        catalogSkinValueCheck,
        skinID,
        `material.${materialField}`,
        localRecord && localRecord.material ? localRecord.material[materialField] : null,
        upstreamRecord && upstreamRecord.material ? upstreamRecord.material[materialField] : null,
      );
    }
    compareStructuredValues(
      catalogSkinValueCheck,
      skinID,
      "material.displayName",
      localRecord && localRecord.material ? localRecord.material.displayName : null,
      upstreamRecord && upstreamRecord.material ? upstreamRecord.material.displayName : null,
    );
    compareStructuredField(catalogSkinValueCheck, skinID, "shipTypeIDs", localRecord, upstreamRecord);
    compareStructuredField(catalogSkinValueCheck, skinID, "licenseTypeIDs", localRecord, upstreamRecord);
    compareStructuredField(catalogSkinValueCheck, skinID, "licenseTypes", localRecord, upstreamRecord);
  }

  const catalogLicenseValueCheck = createMismatchBucket();
  const catalogLicenseKeys = integerArray([
    ...Object.keys(localCatalog.licenseTypesByTypeID || {}),
    ...Object.keys(upstreamCatalog.licenseTypesByTypeID || {}),
  ]);
  for (const licenseTypeID of catalogLicenseKeys) {
    const localRecord = localCatalog.licenseTypesByTypeID
      ? localCatalog.licenseTypesByTypeID[String(licenseTypeID)] || null
      : null;
    const upstreamRecord = upstreamCatalog.licenseTypesByTypeID
      ? upstreamCatalog.licenseTypesByTypeID[String(licenseTypeID)] || null
      : null;
    compareRecordFields(
      catalogLicenseValueCheck,
      licenseTypeID,
      localRecord,
      upstreamRecord,
      [
        "licenseTypeID",
        "skinID",
        "skinMaterialID",
        "internalName",
        "duration",
        "isSingleUse",
        "typeName",
        "published",
        "groupID",
        "groupName",
        "groupPublished",
        "missingSkinDefinition",
      ],
    );
    compareStructuredField(
      catalogLicenseValueCheck,
      licenseTypeID,
      "shipTypeIDs",
      localRecord,
      upstreamRecord,
    );
  }

  const catalogShipTypeValueCheck = createMismatchBucket();
  const catalogShipTypeKeys = integerArray([
    ...Object.keys(localCatalog.shipTypesByTypeID || {}),
    ...Object.keys(upstreamCatalog.shipTypesByTypeID || {}),
  ]);
  for (const typeID of catalogShipTypeKeys) {
    const localRecord = localCatalog.shipTypesByTypeID
      ? localCatalog.shipTypesByTypeID[String(typeID)] || null
      : null;
    const upstreamRecord = upstreamCatalog.shipTypesByTypeID
      ? upstreamCatalog.shipTypesByTypeID[String(typeID)] || null
      : null;
    compareRecordFields(
      catalogShipTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      ["typeID"],
    );
    compareStructuredField(
      catalogShipTypeValueCheck,
      typeID,
      "skinIDs",
      localRecord,
      upstreamRecord,
    );
    compareStructuredField(
      catalogShipTypeValueCheck,
      typeID,
      "materialIDs",
      localRecord,
      upstreamRecord,
    );
    compareStructuredField(
      catalogShipTypeValueCheck,
      typeID,
      "licenseTypeIDs",
      localRecord,
      upstreamRecord,
    );
  }

  const shipDogmaValueCheck = {
    missingLocallyCount: 0,
    extraLocallyCount: 0,
    valueMismatchCount: 0,
    samples: [],
  };
  for (const typeID of shipTypeIDs) {
    const upstreamRow = typeDogmaById.get(typeID) || null;
    const upstreamAttributes = Object.fromEntries(
      (Array.isArray(upstreamRow && upstreamRow.dogmaAttributes)
        ? upstreamRow.dogmaAttributes
        : [])
        .map((entry) => [String(toNumber(entry.attributeID)), toNumber(entry.value)])
        .filter(([attributeID, value]) => Number.isInteger(toNumber(attributeID)) && value !== null),
    );
    const localEntry = localShipDogma.shipAttributesByTypeID
      ? localShipDogma.shipAttributesByTypeID[String(typeID)] || null
      : null;
    const localAttributes =
      localEntry && localEntry.attributes && typeof localEntry.attributes === "object"
        ? localEntry.attributes
        : {};
    const upstreamKeys = new Set(Object.keys(upstreamAttributes));
    const localKeys = new Set(Object.keys(localAttributes));

    for (const attributeID of upstreamKeys) {
      if (!localKeys.has(attributeID)) {
        shipDogmaValueCheck.missingLocallyCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `missing:${attributeID}`,
          null,
          upstreamAttributes[attributeID],
        );
        continue;
      }

      if (!sameValue(localAttributes[attributeID], upstreamAttributes[attributeID])) {
        shipDogmaValueCheck.valueMismatchCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `attribute:${attributeID}`,
          localAttributes[attributeID],
          upstreamAttributes[attributeID],
        );
      }
    }

    for (const attributeID of localKeys) {
      if (!upstreamKeys.has(attributeID)) {
        shipDogmaValueCheck.extraLocallyCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `extra:${attributeID}`,
          localAttributes[attributeID],
          null,
        );
      }
    }
  }

  const typeDogmaAttributeValueCheck = createMismatchBucket();
  const upstreamTypeDogmaAttributeTypes = Object.fromEntries(
    [...dogmaAttributesById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([attributeID, attributeRow]) => [
        String(attributeID),
        buildDogmaAttributeTypeRecord(attributeRow),
      ]),
  );
  for (const attributeID of integerArray([
    ...Object.keys(localTypeDogma.attributeTypesByID || {}),
    ...Object.keys(upstreamTypeDogmaAttributeTypes),
  ])) {
    compareStructuredValues(
      typeDogmaAttributeValueCheck,
      attributeID,
      "attributeType",
      localTypeDogma.attributeTypesByID
        ? localTypeDogma.attributeTypesByID[String(attributeID)] || null
        : null,
      upstreamTypeDogmaAttributeTypes[String(attributeID)] || null,
    );
  }

  const typeDogmaEffectValueCheck = createMismatchBucket();
  const upstreamTypeDogmaEffectTypes = Object.fromEntries(
    [...dogmaEffectsById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([effectID, effectRow]) => [
        String(effectID),
        buildDogmaEffectTypeRecord(effectRow),
      ]),
  );
  for (const effectID of integerArray([
    ...Object.keys(localTypeDogma.effectTypesByID || {}),
    ...Object.keys(upstreamTypeDogmaEffectTypes),
  ])) {
    compareStructuredValues(
      typeDogmaEffectValueCheck,
      effectID,
      "effectType",
      localTypeDogma.effectTypesByID
        ? localTypeDogma.effectTypesByID[String(effectID)] || null
        : null,
      upstreamTypeDogmaEffectTypes[String(effectID)] || null,
    );
  }

  const typeDogmaTypeValueCheck = createMismatchBucket();
  const upstreamTypeDogmaTypes = Object.fromEntries(
    [...typeDogmaById.entries()]
      .filter(([typeID]) => typesById.has(typeID))
      .sort((left, right) => left[0] - right[0])
      .map(([typeID, dogmaRow]) => [
        String(typeID),
        buildTypeDogmaRecord(typesById.get(typeID), dogmaRow),
      ]),
  );
  for (const typeID of integerArray([
    ...Object.keys(localTypeDogma.typesByTypeID || {}),
    ...Object.keys(upstreamTypeDogmaTypes),
  ])) {
    compareStructuredValues(
      typeDogmaTypeValueCheck,
      typeID,
      "typeDogma",
      localTypeDogma.typesByTypeID ? localTypeDogma.typesByTypeID[String(typeID)] || null : null,
      upstreamTypeDogmaTypes[String(typeID)] || null,
    );
  }

  const upstreamTypeDogmaCounts = {
    types: Object.keys(upstreamTypeDogmaTypes).length,
    attributeTypes: Object.keys(upstreamTypeDogmaAttributeTypes).length,
    effectTypes: Object.keys(upstreamTypeDogmaEffectTypes).length,
    totalAttributes: Object.values(upstreamTypeDogmaTypes).reduce(
      (sum, entry) => sum + (toNumber(entry && entry.attributeCount) || 0),
      0,
    ),
    totalEffects: Object.values(upstreamTypeDogmaTypes).reduce(
      (sum, entry) => sum + (toNumber(entry && entry.effectCount) || 0),
      0,
    ),
  };
  const comparedJsonlTables = [
    "celestials",
    "itemTypes",
    "movementAttributes",
    "shipCosmeticsCatalog",
    "shipDogmaAttributes",
    "shipTypes",
    "skillTypes",
    "solarSystems",
    "stargateTypes",
    "stargates",
    "stationTypes",
    "stations",
    "typeDogma",
  ];
  const jsonlBackedLocalTables = listJsonlBackedLocalTables(localDbRoot);

  const report = {
    generatedAt: new Date().toISOString(),
    jsonlDir,
    localDbRoot,
    coverage: {
      jsonlBackedLocalTables,
      comparedJsonlTables,
      missingTableCoverage: jsonlBackedLocalTables.filter(
        (tableName) => !comparedJsonlTables.includes(tableName),
      ),
    },
    tables: {
      "shipCosmeticsCatalog.skins": compareIdSets(
        Object.keys(localCatalog.skinsBySkinID || {}).map(Number),
        Object.keys(upstreamCatalog.skinsBySkinID || {}).map(Number),
      ),
      "shipCosmeticsCatalog.licenseTypes": compareIdSets(
        Object.keys(localCatalog.licenseTypesByTypeID || {}).map(Number),
        Object.keys(upstreamCatalog.licenseTypesByTypeID || {}).map(Number),
      ),
      "shipCosmeticsCatalog.materials": compareIdSets(
        Object.keys(localCatalog.materialsByMaterialID || {}).map(Number),
        Object.keys(upstreamCatalog.materialsByMaterialID || {}).map(Number),
      ),
      "shipCosmeticsCatalog.shipTypes": compareIdSets(
        Object.keys(localCatalog.shipTypesByTypeID || {}).map(Number),
        Object.keys(upstreamCatalog.shipTypesByTypeID || {}).map(Number),
      ),
      "shipCosmeticsCatalog.counts.values": catalogCountValueCheck,
      "shipCosmeticsCatalog.materials.values": catalogMaterialValueCheck,
      "shipCosmeticsCatalog.skins.values": catalogSkinValueCheck,
      "shipCosmeticsCatalog.licenseTypes.values": catalogLicenseValueCheck,
      "shipCosmeticsCatalog.shipTypes.values": catalogShipTypeValueCheck,
      itemTypes: compareIdSets(
        getLocalTableArray(localItemTypes, "types").map((row) => row.typeID),
        itemTypeIDs,
      ),
      "itemTypes.values": itemTypeValueCheck,
      shipTypes: compareIdSets(
        getLocalTableArray(localShipTypes, "ships").map((row) => row.typeID),
        shipTypeIDs,
      ),
      "shipTypes.values": shipTypeValueCheck,
      skillTypes: compareIdSets(
        getLocalTableArray(localSkillTypes, "skills").map((row) => row.typeID),
        skillTypeIDs,
      ),
      "skillTypes.values": skillTypeValueCheck,
      solarSystems: compareIdSets(
        getLocalTableArray(localSolarSystems, "solarSystems").map((row) => row.solarSystemID),
        [...mapSolarSystemsById.keys()],
      ),
      "solarSystems.values": solarSystemValueCheck,
      stations: compareIdSets(
        getLocalTableArray(localStations, "stations").map((row) => row.stationID),
        [...npcStationsById.keys()],
      ),
      "stations.values": stationValueCheck,
      stationTypes: compareIdSets(
        getLocalTableArray(localStationTypes, "stationTypes").map((row) => row.stationTypeID),
        stationTypeIDs,
      ),
      "stationTypes.values": stationTypeValueCheck,
      stargateTypes: compareIdSets(
        getLocalTableArray(localStargateTypes, "stargateTypes").map((row) => row.typeID),
        stargateTypeIDs,
      ),
      "stargateTypes.values": stargateTypeValueCheck,
      stargates: compareIdSets(
        getLocalTableArray(localStargates, "stargates").map((row) => row.itemID),
        [...mapStargatesById.keys()],
      ),
      "stargates.values": stargateValueCheck,
      celestials: compareIdSets(
        getLocalTableArray(localCelestials, "celestials").map((row) => row.itemID),
        [...derivedCelestialIDs],
      ),
      "celestials.values": celestialValueCheck,
      movementAttributes: compareIdSets(
        getLocalTableArray(localMovementAttributes, "attributes").map((row) => row.typeID),
        [...relevantMovementTypeIDs],
      ),
      "movementAttributes.values": movementValueCheck,
      "shipDogmaAttributes.shipTypes": compareIdSets(
        Object.keys(localShipDogma.shipAttributesByTypeID || {}).map(Number),
        [...upstreamShipDogmaTypes],
      ),
      "shipDogmaAttributes.attributeTypes": compareIdSets(
        Object.keys(localShipDogma.attributeTypesByID || {}).map(Number),
        [...dogmaAttributesById.keys()],
      ),
      "shipDogmaAttributes.attributeRows": {
        localCount: toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0,
        upstreamCount: upstreamShipDogmaAttributeRows,
        missingLocallyCount: Math.max(
          upstreamShipDogmaAttributeRows -
            (toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0),
          0,
        ),
        extraLocallyCount: Math.max(
          (toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0) -
            upstreamShipDogmaAttributeRows,
          0,
        ),
      },
      "shipDogmaAttributes.values": shipDogmaValueCheck,
      "typeDogma.attributeTypes": compareIdSets(
        Object.keys(localTypeDogma.attributeTypesByID || {}).map(Number),
        Object.keys(upstreamTypeDogmaAttributeTypes).map(Number),
      ),
      "typeDogma.attributeTypes.values": typeDogmaAttributeValueCheck,
      "typeDogma.effectTypes": compareIdSets(
        Object.keys(localTypeDogma.effectTypesByID || {}).map(Number),
        Object.keys(upstreamTypeDogmaEffectTypes).map(Number),
      ),
      "typeDogma.effectTypes.values": typeDogmaEffectValueCheck,
      "typeDogma.types": compareIdSets(
        Object.keys(localTypeDogma.typesByTypeID || {}).map(Number),
        Object.keys(upstreamTypeDogmaTypes).map(Number),
      ),
      "typeDogma.types.values": typeDogmaTypeValueCheck,
      "typeDogma.counts": {
        local: localTypeDogma.counts || null,
        upstream: upstreamTypeDogmaCounts,
        matches: sameStructuredValue(localTypeDogma.counts || null, upstreamTypeDogmaCounts),
      },
    },
    notes: {
      accounts: "Runtime table, no static JSONL equivalent.",
      characters: "Runtime table, no static JSONL equivalent.",
      items: "Runtime table, no static JSONL equivalent.",
      itemTypes:
        "Authoritative all-type catalog mirrored from types/groups JSONL for generic inventory spawning and future market/item flows.",
      skills: "Per-character runtime state, no direct static JSONL equivalent.",
      shipCosmetics: "Runtime ownership/applied-skin state, no static JSONL equivalent.",
      celestials:
        "Compared against the JSONL-derived celestial set held locally: all suns, planets, moons, and asteroid belts when present in the local table.",
      movementAttributes:
        `Compared against derived relevant type IDs (${relevantMovementTypeIDs.size}) from all ship-category types plus station, star, planet, moon, asteroid belt, and stargate types.`,
      stations:
        "Value checks cover authoritative JSONL core fields only. Dock/undock geometry remains a preserved local extension because the JSONL SDE does not ship those transforms.",
      stationTypes:
        "Value checks cover authoritative JSONL type fields. Dock geometry is preserved locally because the JSONL SDE does not include it.",
      stargateTypes:
        "Derived from authoritative JSONL type/group rows referenced by mapStargates.typeID.",
      shipDogmaAttributes:
        "Compared against all ship-category type IDs from types/groups, dogmaAttributes IDs, and total ship attribute rows from typeDogma.",
      typeDogma:
        "Compared against authoritative dogmaAttributes, dogmaEffects, and typeDogma JSONL rows, including type/effect/attribute value payloads and aggregate counts.",
      movementTypesWithAnyDogmaAttributeRow: upstreamMovementTypeIDsWithRows,
      movementRelevantTypesSeenInTypeDogma: seenMovementTypes.size,
    },
  };

  writeJson(outputPath, report);
  console.log(JSON.stringify({ outputPath, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");

const ARCHIVE_ROOT = path.join(
  __dirname,
  "../../data/eve-survival/missions/pages",
);
const OUTPUT_ROOT = path.join(
  __dirname,
  "../../data/eve-survival/missions-parsed",
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeLineEndings(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseCountToken(token) {
  const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(String(token || ""));
  if (!match) {
    return null;
  }

  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return { min, max };
}

function parseDistanceText(value) {
  const text = String(value || "");
  const kmMatch = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*km/i.exec(text);
  if (kmMatch) {
    return {
      minMeters: Math.round(Number(kmMatch[1]) * 1000),
      maxMeters: Math.round(Number(kmMatch[2]) * 1000),
      raw: kmMatch[0],
    };
  }

  const singleMatch = /(\d+(?:\.\d+)?)\s*km/i.exec(text);
  if (singleMatch) {
    const meters = Math.round(Number(singleMatch[1]) * 1000);
    return {
      minMeters: meters,
      maxMeters: meters,
      raw: singleMatch[0],
    };
  }

  return null;
}

function normalizeMissionType(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (/courier|transport|delivery|trade|exchange/.test(value)) {
    return "transport";
  }
  if (/scavenge/.test(value)) {
    return "scavenge";
  }
  if (/mining/.test(value)) {
    return "mining";
  }
  if (/kill|combat|encounter|deadspace/.test(value)) {
    return "encounter";
  }
  if (/storyline/.test(value)) {
    return "storyline";
  }
  return "unknown";
}

function normalizeSpaceType(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return {
      kind: "unknown",
      hasAccelerationGates: null,
      allowsMwd: null,
      raw: rawValue || "",
    };
  }

  return {
    kind: value.includes("deadspace")
      ? "deadspace"
      : value.includes("normal")
        ? "normal"
        : "unknown",
    hasAccelerationGates: /gate|gated|with gates/.test(value),
    allowsMwd: value.includes("mwd works")
      ? true
      : value.includes("mwd does not work")
        ? false
        : null,
    raw: rawValue || "",
  };
}

function classifyLineTags(rawLine) {
  const tags = [];
  const text = String(rawLine || "");
  if (/trigger/i.test(text)) {
    tags.push("trigger");
  }
  if (/web/i.test(text)) {
    tags.push("web");
  }
  if (/scram|warp scramble|warp disrupt/i.test(text)) {
    tags.push("scram");
  }
  if (/jam|ecm/i.test(text)) {
    tags.push("jam");
  }
  if (/target painter/i.test(text)) {
    tags.push("targetPainter");
  }
  if (/neut|neutraliz/i.test(text)) {
    tags.push("energyNeutralize");
  }
  if (/damp/i.test(text)) {
    tags.push("sensorDamp");
  }
  if (/tracking disrupt/i.test(text)) {
    tags.push("trackingDisrupt");
  }
  if (/objective/i.test(text)) {
    tags.push("objective");
  }
  return uniqueStrings(tags);
}

function inferEntityKind(label) {
  const value = String(label || "").toLowerCase();
  if (
    /battery|tower|station|structure|silo|bunker|warehouse|post|outpost|relay|generator|carcass|cells|lookout post|repair station|habitation module/i.test(
      value,
    )
  ) {
    return "structure";
  }
  if (/\bgate\b/i.test(value)) {
    return "gate";
  }
  return "npc";
}

function splitCandidateNames(value) {
  return uniqueStrings(
    String(value || "")
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseSpawnLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return null;
  }

  const normalized = line.replace(/\*\*/g, "").replace(/\/\//g, "").trim();
  const match =
    /^(\d+(?:\s*-\s*\d+)?)\s*x?\s+(.+?)$/i.exec(normalized) ||
    /^(\d+(?:\s*-\s*\d+)?)x\s*(.+?)$/i.exec(normalized);
  if (!match) {
    return null;
  }

  const count = parseCountToken(match[1]);
  if (!count) {
    return null;
  }

  let descriptor = match[2].trim();
  const tags = classifyLineTags(descriptor);
  descriptor = descriptor.replace(/\*\*.*?\*\*/g, "").trim();

  let label = descriptor;
  let candidateNames = [];
  const parenMatch = /^([^()]+?)\s*\(([^)]+)\)\s*(.*)$/.exec(descriptor);
  if (parenMatch) {
    label = parenMatch[1].trim();
    candidateNames = splitCandidateNames(parenMatch[2]);
    if (parenMatch[3] && parenMatch[3].trim()) {
      label = `${label} ${parenMatch[3].trim()}`;
    }
  }

  const entityKind = inferEntityKind(label);
  const distance = parseDistanceText(line);

  return {
    raw: line,
    count,
    entityKind,
    label,
    candidateNames,
    tags,
    distance,
  };
}

function parseBodyLines(body) {
  const lines = normalizeLineEndings(body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const spawnEntries = [];
  const noteLines = [];

  for (const line of lines) {
    const parsed = parseSpawnLine(line);
    if (parsed) {
      spawnEntries.push(parsed);
    } else {
      noteLines.push(line);
    }
  }

  return {
    spawnEntries,
    noteLines,
  };
}

function extractLinesByPattern(raw, pattern, limit = 20) {
  const lines = normalizeLineEndings(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.filter((line) => pattern.test(line)).slice(0, limit);
}

function parseKeyValueLines(text) {
  const result = {};
  const lines = normalizeLineEndings(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9/ _-]+):\s*(.+)$/.exec(line);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }

  return result;
}

function buildMissionPartSummaries(meta) {
  return (meta.missionParts || []).map((part, index) => ({
    partId: `part_${index + 1}`,
    title: part.title,
    headingLevel: part.level,
    metadata: parseKeyValueLines(part.body),
    body: part.body,
  }));
}

function inferMissionPartsFromRaw(raw) {
  const lines = normalizeLineEndings(raw).split("\n");
  const parts = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch =
      /^=+\s*(?:\(?\s*)?part\s+\d+\s+of\s+\d+(?:\s*\)?)\s*=+$/i.exec(trimmed) ||
      /^=+.*\(\s*\d+\s+of\s+\d+\s*\)\s*=+$/i.exec(trimmed);

    if (headingMatch) {
      if (current) {
        current.body = current.lines.join("\n").trim();
        delete current.lines;
        parts.push(current);
      }

      current = {
        title: trimmed.replace(/^=+|=+$/g, "").trim(),
        headingLevel: (trimmed.match(/^=+/) || [""])[0].length,
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    current.body = current.lines.join("\n").trim();
    delete current.lines;
    parts.push(current);
  }

  return parts.map((part, index) => ({
    partId: `part_${index + 1}`,
    title: part.title,
    headingLevel: part.headingLevel,
    metadata: parseKeyValueLines(part.body),
    body: part.body,
  }));
}

function inferSingleRoomFromSections(meta) {
  const candidateSections = (meta.sections || []).filter((section) =>
    /\b(group|wave|spawn|reinforcement|ambush|initial|warp-?in|objective group|timed spawn)\b/i.test(
      section.title,
    ),
  );

  if (candidateSections.length === 0) {
    return [];
  }

  return [
    {
      roomId: "single_room_inferred",
      title: "Single Room (Inferred)",
      source: "section_inference",
      gateHint: null,
      groups: candidateSections.map((section, index) => {
        const parsedBody = parseBodyLines(section.body);
        return {
          groupId: `group_${index + 1}`,
          title: section.title,
          headingLevel: section.level,
          distance: parseDistanceText(section.title),
          spawnEntries: parsedBody.spawnEntries,
          notes: parsedBody.noteLines,
        };
      }),
      notes: [],
    },
  ];
}

function buildRooms(meta) {
  if ((meta.pockets || []).length > 0) {
    return meta.pockets.map((pocket, index) => {
      const parsedBody = parseBodyLines(pocket.body);
      const groups = (pocket.groups || []).map((group, groupIndex) => {
        const parsedGroup = parseBodyLines(group.body);
        return {
          groupId: `group_${groupIndex + 1}`,
          title: group.title,
          headingLevel: group.level,
          distance: parseDistanceText(group.title),
          spawnEntries: parsedGroup.spawnEntries,
          notes: parsedGroup.noteLines,
        };
      });

      const gateLines = uniqueStrings(
        [
          ...parsedBody.noteLines,
          ...(pocket.subsections || []).flatMap((section) =>
            normalizeLineEndings(section.body)
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          ),
          ...groups.flatMap((group) => group.notes),
        ].filter((line) => /acceleration gate|gate to next pocket|bonus pocket gate/i.test(line)),
      );

      return {
        roomId: `room_${index + 1}`,
        title: pocket.title,
        source: "pocket",
        gateHint: gateLines[0] || null,
        spawnEntries: parsedBody.spawnEntries,
        groups,
        notes: uniqueStrings([
          ...parsedBody.noteLines,
          ...(pocket.subsections || []).map((section) => `${section.title}: ${section.body}`),
        ]),
      };
    });
  }

  return inferSingleRoomFromSections(meta);
}

function classifyPage(meta, raw, normalizedMissionType, roomCount, groupCount) {
  const reasons = [];
  const flags = [];
  const title = String(meta.title || meta.slug || "");
  const rawText = String(raw || "");
  const missionParts =
    (meta.missionParts || []).length || inferMissionPartsFromRaw(rawText).length;
  const transportSignals = extractLinesByPattern(
    rawText,
    /mission type:\s*courier|mission type:\s*.*transport|deliver|transport|courier|cargo delivery|drop off|pick-?up|pickup|must use .*shuttle|damaged pod|warehouse/i,
    8,
  );
  const combatSignals = extractLinesByPattern(
    rawText,
    /frigate|cruiser|battleship|battlecruiser|destroyer|spawn|trigger|aggro|scramble|battery|sentry|wave/i,
    8,
  );

  if (/epic arc/i.test(title) || /series of 50 missions|1st chapter/i.test(rawText)) {
    reasons.push("Epic arc overview/index text detected");
    return { pageKind: "epic_arc_index", confidence: "high", reasons, flags };
  }

  if (missionParts > 0) {
    reasons.push("Multi-part bundle structure detected");
    flags.push("split_required");
    return { pageKind: "multi_part_bundle", confidence: "high", reasons, flags };
  }

  const transportLike =
    normalizedMissionType === "transport" ||
    transportSignals.length > 0 ||
    /must use (?:a )?shuttle/i.test(rawText);

  if (transportLike && (roomCount > 0 || groupCount > 0 || combatSignals.length > 0)) {
    reasons.push("Transport/courier objective with combat structure detected");
    flags.push("hybrid_transport_encounter");
    return {
      pageKind: "hybrid_transport_encounter",
      confidence: "medium",
      reasons,
      flags,
    };
  }

  if (transportLike) {
    reasons.push("Transport/courier objective language detected");
    return {
      pageKind: "courier_or_transport",
      confidence:
        normalizedMissionType === "transport" ? "high" : "medium",
      reasons,
      flags,
    };
  }

  if (roomCount > 0 || groupCount > 0) {
    reasons.push("Rooms/groups extracted from page structure");
    return { pageKind: "combat_structured", confidence: "high", reasons, flags };
  }

  if (combatSignals.length > 0) {
    reasons.push("Combat/spawn language detected but structure needs second-pass parsing");
    flags.push("needs_second_pass_structure");
    return {
      pageKind: "combat_unstructured",
      confidence: "medium",
      reasons,
      flags,
    };
  }

  reasons.push("Only sparse overview text detected");
  flags.push("manual_review");
  return { pageKind: "overview_or_sparse", confidence: "low", reasons, flags };
}

function buildNormalizedMission(meta, raw, archiveDir) {
  const missionParts = (meta.missionParts || []).length
    ? buildMissionPartSummaries(meta)
    : inferMissionPartsFromRaw(raw);
  const normalizedMissionType = normalizeMissionType(
    (meta.metadata || {})["Mission type"] || (meta.metadata || {})["Mission Type"],
  );
  const normalizedSpaceType = normalizeSpaceType(
    (meta.metadata || {})["Space type"] || (meta.metadata || {})["Space Type"],
  );
  const rooms = buildRooms(meta);
  const groupCount = rooms.reduce(
    (sum, room) => sum + ((room.groups || []).length),
    0,
  );
  const classification = classifyPage(
    meta,
    raw,
    normalizedMissionType,
    rooms.length,
    groupCount,
  );

  const objectiveHints = uniqueStrings([
    ...extractLinesByPattern(
      raw,
      /mission completed|mission is flagged completed|flagged complete|objective item drops|main target|objective is/i,
      12,
    ),
    ...extractLinesByPattern(raw, /destroy .*station|kill .* and mission complete/i, 8),
  ]);

  const triggerHints = uniqueStrings(
    extractLinesByPattern(
      raw,
      /\*\*trigger|last ship triggers|spawn when|after killing|reinforcement spawn|timed spawn|appears when|when .* attacked|when .* destroyed/i,
      20,
    ),
  );

  const transportHints = uniqueStrings(
    extractLinesByPattern(
      raw,
      /deliver|transport|courier|cargo|bring|take .* to|drop off|pick-?up|pickup|warehouse|damaged pod|hidden warehouse|must use .*shuttle/i,
      20,
    ),
  );

  const timingHints = uniqueStrings(
    extractLinesByPattern(
      raw,
      /every \d+ sec|within \d+ seconds|several seconds later|\d+ minute delayed spawn|spawns at \d+ minutes|after \d+ seconds/i,
      20,
    ),
  );

  const normalized = {
    id: `eve-survival:${meta.slug}`,
    source: {
      archiveDir,
      slug: meta.slug,
      wikiName: meta.wikiName || meta.slug,
      sourceUrl: meta.sourceUrl,
      revisionTimestamp: meta.revisionTimestamp || null,
      archivedAt: meta.archivedAt || null,
      owner: meta.owner || null,
      commentCount: Number(meta.commentCount || 0),
    },
    identity: {
      title: meta.title || meta.slug,
      pageIndexTitle: meta.pageIndexTitle || meta.title || meta.slug,
      missionLevel:
        Number.isFinite(meta.missionLevel) && meta.missionLevel > 0
          ? meta.missionLevel
          : null,
      faction: (meta.metadata || {}).Faction || null,
      missionTypeRaw:
        (meta.metadata || {})["Mission type"] ||
        (meta.metadata || {})["Mission Type"] ||
        null,
      missionTypeNormalized: normalizedMissionType,
      spaceType: normalizedSpaceType,
      categories: meta.categories || [],
    },
    classification,
    contentShape: {
      sectionCount: Number(meta.sectionCount || 0),
      roomCount: rooms.length,
      groupCount,
      imageCount: Array.isArray(meta.images) ? meta.images.length : 0,
      missionPartCount: missionParts.length,
    },
    missionParts,
    rooms,
    objectiveHints,
    triggerHints,
    timingHints,
    transportHints,
    advisory: {
      damageDealt: (meta.metadata || {})["Damage dealt"] || null,
      recommendedDamage:
        (meta.metadata || {})["Recommended damage dealing"] || null,
      webScramble:
        (meta.metadata || {})["Web/ Scramble"] ||
        (meta.metadata || {})["Web/Scramble"] ||
        null,
      extras: (meta.metadata || {}).Extras || null,
      recommendedShips:
        (meta.metadata || {})["Recommended ships"] ||
        (meta.metadata || {})["Recommended ship classes"] ||
        null,
    },
    images: meta.images || [],
    warnings: uniqueStrings([
      ...(classification.flags || []),
      ...(rooms.length === 0 ? ["no_rooms_extracted"] : []),
      ...(groupCount === 0 ? ["no_groups_extracted"] : []),
      ...(objectiveHints.length === 0 ? [] : ["objective_review_recommended"]),
      ...(triggerHints.length === 0 ? [] : ["trigger_review_recommended"]),
    ]),
  };

  return normalized;
}

function removeOutputDir(outputDir) {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function summarizeResults(results) {
  const countsByKind = {};
  const countsByLevel = {};
  const countsByMissionType = {};
  const examplesByKind = {};

  for (const result of results) {
    const kind = result.classification.pageKind;
    countsByKind[kind] = (countsByKind[kind] || 0) + 1;

    const level = String(result.identity.missionLevel || "unknown");
    countsByLevel[level] = (countsByLevel[level] || 0) + 1;

    const missionType = result.identity.missionTypeNormalized || "unknown";
    countsByMissionType[missionType] = (countsByMissionType[missionType] || 0) + 1;

    if (!examplesByKind[kind]) {
      examplesByKind[kind] = [];
    }
    if (examplesByKind[kind].length < 12) {
      examplesByKind[kind].push({
        slug: result.source.slug,
        title: result.identity.title,
        level: result.identity.missionLevel,
        roomCount: result.contentShape.roomCount,
        groupCount: result.contentShape.groupCount,
        missionPartCount: result.contentShape.missionPartCount,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceArchiveDir: ARCHIVE_ROOT,
    outputDir: OUTPUT_ROOT,
    missionCount: results.length,
    countsByKind,
    countsByLevel,
    countsByMissionType,
    examplesByKind,
  };
}

function main() {
  if (!fs.existsSync(ARCHIVE_ROOT)) {
    throw new Error(`Archive directory not found: ${ARCHIVE_ROOT}`);
  }

  removeOutputDir(OUTPUT_ROOT);
  ensureDir(OUTPUT_ROOT);

  const archiveDirs = fs
    .readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const results = [];
  for (const archiveDir of archiveDirs) {
    const pageDir = path.join(ARCHIVE_ROOT, archiveDir);
    const metadataPath = path.join(pageDir, "metadata.json");
    const rawPath = path.join(pageDir, "raw.txt");
    if (!fs.existsSync(metadataPath) || !fs.existsSync(rawPath)) {
      continue;
    }

    const meta = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const raw = fs.readFileSync(rawPath, "utf8");
    const normalized = buildNormalizedMission(meta, raw, pageDir);
    results.push(normalized);
    writeJson(path.join(OUTPUT_ROOT, `${archiveDir}.json`), normalized);
  }

  writeJson(path.join(OUTPUT_ROOT, "_summary.json"), summarizeResults(results));
  console.log(
    `Parsed ${results.length} archived mission pages into ${OUTPUT_ROOT}`,
  );
}

main();

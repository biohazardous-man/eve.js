const fs = require("fs");
const path = require("path");

const SITE_ORIGIN = "https://eve-survival.org";
const MISSION_INDEX_URL = `${SITE_ORIGIN}/?wakka=CategoryMissions`;
const DEFAULT_OUTPUT_DIR = path.join(
  __dirname,
  "../../data/eve-survival/missions",
);
const DEFAULT_DELAY_MS = 350;
const REQUEST_HEADERS = {
  "user-agent": "EvEJS Mission Archiver/1.0 (+local development use)",
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
};
const REQUEST_TIMEOUT_MS = 20000;
const MAX_FETCH_ATTEMPTS = 3;
const ANSI_RESET = "\u001b[0m";
const LEVEL_COLORS = {
  1: "\u001b[38;2;120;255;140m",
  2: "\u001b[38;2;90;210;255m",
  3: "\u001b[38;2;255;225;110m",
  4: "\u001b[38;2;255;170;95m",
  5: "\u001b[38;2;255;105;105m",
};
const NAME_COLOR = "\u001b[38;2;225;235;255m";
const STATUS_COLORS = {
  starting: "\u001b[38;2;120;220;255m",
  archived: "\u001b[38;2;120;255;140m",
  skipped: "\u001b[38;2;170;180;200m",
  failed: "\u001b[38;2;255;105;105m",
};

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    limit: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      options.outputDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.outputDir = path.resolve(arg.slice("--output=".length));
      continue;
    }

    if (arg === "--delay-ms" && argv[index + 1]) {
      options.delayMs = toPositiveInt(argv[index + 1], DEFAULT_DELAY_MS);
      index += 1;
      continue;
    }

    if (arg.startsWith("--delay-ms=")) {
      options.delayMs = toPositiveInt(
        arg.slice("--delay-ms=".length),
        DEFAULT_DELAY_MS,
      );
      continue;
    }

    if (arg === "--limit" && argv[index + 1]) {
      options.limit = toPositiveInt(argv[index + 1], 0);
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = toPositiveInt(arg.slice("--limit=".length), 0);
    }
  }

  return options;
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function colorizeLevelLabel(level) {
  const numericLevel = Number(level);
  const label = `[Mission Level: ${level != null ? level : "?"}]`;
  const color = LEVEL_COLORS[numericLevel];
  if (!color) {
    return label;
  }
  return `${color}${label}${ANSI_RESET}`;
}

function colorizeSegment(label, value, color) {
  if (!color) {
    return `[${label}: ${value}]`;
  }
  return `${color}[${label}: ${value}]${ANSI_RESET}`;
}

function colorizeStatus(status) {
  const normalized = `${status || ""}`.toLowerCase();
  const color = STATUS_COLORS[normalized];
  if (!color) {
    return status;
  }
  return `${color}${status}${ANSI_RESET}`;
}

function formatProgressPrefix(current, total, level, name) {
  return `[${current}/${total}] ${colorizeLevelLabel(level)} ${colorizeSegment(
    "Name",
    name,
    NAME_COLOR,
  )} - `;
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value || "";
  }

  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function normalizeLineEndings(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function parseCharset(contentType) {
  const match = /charset=([^;]+)/i.exec(contentType || "");
  return match ? match[1].trim().toLowerCase() : "utf-8";
}

function decodeResponseBuffer(buffer, charset) {
  if (charset.includes("8859-1") || charset.includes("latin1")) {
    return buffer.toString("latin1");
  }

  return buffer.toString("utf8");
}

async function fetchText(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: controller.signal,
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const charset = parseCharset(response.headers.get("content-type"));
      const text = decodeResponseBuffer(buffer, charset);
      const headers = {};
      for (const [key, value] of response.headers.entries()) {
        headers[key] = value;
      }

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.status = response.status;
        error.url = url;
        error.body = text;
        throw error;
      }

      clearTimeout(timeout);
      return {
        url,
        status: response.status,
        headers,
        charset,
        text,
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw lastError;
}

function parseMissionIndex(html) {
  const entries = [];
  const pattern =
    /<td><a class="[^"]*" href="https:\/\/eve-survival\.org\/\?wakka=([^"&]+)">([^<]*)<\/a>\s*<span class="pagetitle">\[([^\]]*)\]<\/span><\/td>/gi;
  let match = pattern.exec(html);

  while (match) {
    const slug = decodeHtmlEntities(match[1]).trim();
    const wikiName = decodeHtmlEntities(match[2]).trim();
    const title = decodeHtmlEntities(match[3]).trim();
    if (slug) {
      entries.push({
        slug,
        wikiName,
        title,
        sourceUrl: `${SITE_ORIGIN}/?wakka=${encodeURIComponent(slug)}`,
      });
    }
    match = pattern.exec(html);
  }

  return entries;
}

function parseKeyValueLines(lines) {
  const metadata = {};
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9/ _-]+):\s*(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();
    if (!value) {
      continue;
    }
    metadata[key] = value;
  }
  return metadata;
}

function parseImageAttributes(raw) {
  const attributes = {};
  const pattern = /([a-zA-Z]+)="([^"]*)"/g;
  let match = pattern.exec(raw);

  while (match) {
    attributes[match[1]] = match[2];
    match = pattern.exec(raw);
  }

  return attributes;
}

function cleanSectionBody(lines) {
  const joined = lines.join("\n");
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}

function parseRawMission(rawText, slug) {
  const raw = normalizeLineEndings(rawText);
  const lines = raw.split("\n");
  const titleMatch = /^={2,}\s*(.*?)\s*={2,}\s*$/.exec(lines[0] || "");
  const title = titleMatch ? titleMatch[1].trim() : slug;

  const images = [];
  const imagePattern = /\{\{image\s+([^}]+)\}\}/g;
  let imageMatch = imagePattern.exec(raw);
  while (imageMatch) {
    images.push(parseImageAttributes(imageMatch[1]));
    imageMatch = imagePattern.exec(raw);
  }

  const categories = [];
  const categorySplit = raw.split(/\n----\n/);
  if (categorySplit.length > 1) {
    const categoryLines = categorySplit[categorySplit.length - 1]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const category of categoryLines) {
      if (/^Category/i.test(category)) {
        categories.push(category);
      }
    }
  }

  const sections = [];
  let currentSection = null;
  const introLines = [];

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "----") {
      break;
    }

    const headingMatch = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (headingMatch) {
      if (currentSection) {
        currentSection.body = cleanSectionBody(currentSection.lines);
        delete currentSection.lines;
        sections.push(currentSection);
      }

      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
        lines: [],
      };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.body = cleanSectionBody(currentSection.lines);
    delete currentSection.lines;
    sections.push(currentSection);
  }

  const intro = cleanSectionBody(introLines);
  const introMetadataLines = intro
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const metadata = parseKeyValueLines(introMetadataLines);

  const missionParts = [];
  for (const section of sections) {
    if (/\(\s*\d+\s+of\s+\d+\s*\)/i.test(section.title)) {
      missionParts.push({
        level: section.level,
        title: section.title,
        body: section.body,
      });
    }
  }

  const pockets = [];
  let currentPocket = null;
  for (const section of sections) {
    const isMissionPart = /\(\s*\d+\s+of\s+\d+\s*\)/i.test(section.title);
    const isPocketHeading = /\bpocket\b/i.test(section.title);

    if (isPocketHeading) {
      currentPocket = {
        level: section.level,
        title: section.title,
        body: section.body,
        groups: [],
        subsections: [],
      };
      pockets.push(currentPocket);
      continue;
    }

    if (isMissionPart) {
      currentPocket = null;
      continue;
    }

    if (
      currentPocket &&
      /\b(group|wave|spawn)\b/i.test(section.title)
    ) {
      currentPocket.groups.push({
        level: section.level,
        title: section.title,
        body: section.body,
      });
      continue;
    }

    if (currentPocket && section.level >= 2 && section.level <= 3) {
      currentPocket.subsections.push({
        level: section.level,
        title: section.title,
        body: section.body,
      });
    }
  }

  let missionLevel = null;
  for (const category of categories) {
    const match = /^CategoryLevel(\d+)/i.exec(category);
    if (match) {
      missionLevel = Number(match[1]);
      break;
    }
  }

  if (!missionLevel) {
    const levelFromTitle = /(?:^|,\s*)Level\s+(\d+)/i.exec(title);
    if (levelFromTitle) {
      missionLevel = Number(levelFromTitle[1]);
    }
  }

  return {
    slug,
    title,
    missionLevel,
    metadata,
    intro,
    images,
    categories,
    sections,
    missionParts,
    pockets,
  };
}

function parseRenderedPageMetadata(html) {
  const titleMatch = /<title>EVE-Survival:\s*([^<]+)<\/title>/i.exec(html);
  const ownerMatch = /Owner:\s*<a class="" href="[^"]+">([^<]+)<\/a>/i.exec(
    html,
  );
  const revisionMatch =
    /<a class="datetime" href="[^"]+"[^>]*>([^<]+)<\/a>/i.exec(html);
  const commentMatch = /There (?:is|are)\s+(\d+)\s+comments?/i.exec(html);

  return {
    renderedTitle: titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null,
    owner: ownerMatch ? decodeHtmlEntities(ownerMatch[1].trim()) : null,
    revisionTimestamp: revisionMatch
      ? decodeHtmlEntities(revisionMatch[1].trim())
      : null,
    commentCount: commentMatch ? Number(commentMatch[1]) : 0,
  };
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendLog(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function inferMissionLevel(entry) {
  const titleMatch = /level\s+(\d+)/i.exec(
    `${entry && entry.title ? entry.title : ""}`,
  );
  if (titleMatch) {
    return Number(titleMatch[1]);
  }

  const slugMatch = /(\d)(?!.*\d)/.exec(`${entry && entry.slug ? entry.slug : ""}`);
  if (slugMatch) {
    return Number(slugMatch[1]);
  }

  return null;
}

function readExistingMetadata(pageDir) {
  const metadataPath = path.join(pageDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function hasCompletePage(pageDir) {
  const requiredFiles = ["page.html", "raw.txt", "metadata.json"];
  return requiredFiles.every((fileName) =>
    fs.existsSync(path.join(pageDir, fileName)),
  );
}

function getExistingArchivedResult(outputDir, entry) {
  const pageDir = path.join(outputDir, "pages", entry.slug);
  if (!hasCompletePage(pageDir)) {
    return null;
  }

  const existing = readExistingMetadata(pageDir);
  return {
    status: "skipped",
    slug: entry.slug,
    title: existing && existing.title ? existing.title : entry.title,
    missionLevel:
      existing && Number.isFinite(existing.missionLevel)
        ? existing.missionLevel
        : inferMissionLevel(entry),
    pocketCount:
      existing && Number.isFinite(existing.pocketCount)
        ? existing.pocketCount
        : null,
  };
}

function buildManifest(options) {
  const { sourceUrl, generatedAt, outputDir, crawlOptions, entries, results } =
    options;
  const archivedCount = results.filter(
    (result) => result.status === "archived",
  ).length;
  const skippedCount = results.filter(
    (result) => result.status === "skipped",
  ).length;
  const failedEntries = results.filter((result) => result.status === "failed");

  return {
    sourceUrl,
    generatedAt,
    outputDir,
    options: crawlOptions,
    totalDiscovered: entries.length,
    selectedCount: crawlOptions.selectedCount,
    archivedCount,
    skippedCount,
    failedCount: failedEntries.length,
    failedSlugs: failedEntries.map((entry) => entry.slug),
    results,
  };
}

async function scrapeMission(entry, context) {
  const { outputDir, delayMs, force, logPath } = context;
  const pageDir = path.join(outputDir, "pages", entry.slug);
  ensureDir(pageDir);

  if (!force) {
    const existing = getExistingArchivedResult(outputDir, entry);
    if (existing) {
      return existing;
    }
  }

  const startedAt = Date.now();
  const rendered = await fetchText(`${SITE_ORIGIN}/?wakka=${entry.slug}`);
  await sleep(delayMs);
  const raw = await fetchText(`${SITE_ORIGIN}/?wakka=${entry.slug}/raw`);

  const extracted = parseRawMission(raw.text, entry.slug);
  const renderedMeta = parseRenderedPageMetadata(rendered.text);
  const metadata = {
    slug: entry.slug,
    sourceUrl: entry.sourceUrl,
    archivedAt: new Date().toISOString(),
    html: {
      url: rendered.url,
      status: rendered.status,
      charset: rendered.charset,
    },
    raw: {
      url: raw.url,
      status: raw.status,
      charset: raw.charset,
    },
    title: extracted.title,
    missionLevel: extracted.missionLevel,
    pageIndexTitle: entry.title,
    wikiName: entry.wikiName,
    owner: renderedMeta.owner,
    revisionTimestamp: renderedMeta.revisionTimestamp,
    commentCount: renderedMeta.commentCount,
    metadata: extracted.metadata,
    categories: extracted.categories,
    images: extracted.images,
    missionParts: extracted.missionParts,
    pocketCount: extracted.pockets.length,
    sectionCount: extracted.sections.length,
    sections: extracted.sections,
    pockets: extracted.pockets,
  };

  fs.writeFileSync(path.join(pageDir, "page.html"), rendered.text, "utf8");
  fs.writeFileSync(path.join(pageDir, "raw.txt"), raw.text, "utf8");
  writeJson(path.join(pageDir, "metadata.json"), metadata);
  writeJson(path.join(pageDir, "http.json"), {
    html: {
      url: rendered.url,
      status: rendered.status,
      headers: rendered.headers,
    },
    raw: {
      url: raw.url,
      status: raw.status,
      headers: raw.headers,
    },
  });

  const elapsedMs = Date.now() - startedAt;
  appendLog(logPath, {
    timestamp: new Date().toISOString(),
    slug: entry.slug,
    title: metadata.title,
    status: "archived",
    elapsedMs,
    pocketCount: metadata.pocketCount,
  });

  return {
    status: "archived",
    slug: entry.slug,
    title: metadata.title,
    missionLevel: metadata.missionLevel,
    pocketCount: metadata.pocketCount,
    elapsedMs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(options.outputDir);
  ensureDir(path.join(options.outputDir, "pages"));

  const crawlLogPath = path.join(options.outputDir, "crawl-log.ndjson");
  const manifestPath = path.join(options.outputDir, "manifest.json");

  console.log(`Fetching mission index from ${MISSION_INDEX_URL}`);
  const missionIndex = await fetchText(MISSION_INDEX_URL);
  fs.writeFileSync(
    path.join(options.outputDir, "category-missions.html"),
    missionIndex.text,
    "utf8",
  );

  const entries = parseMissionIndex(missionIndex.text);
  if (entries.length === 0) {
    throw new Error("No mission entries were found on CategoryMissions.");
  }

  const selectedEntries =
    options.limit > 0 ? entries.slice(0, options.limit) : entries;
  const crawlStartedAt = new Date().toISOString();

  writeJson(path.join(options.outputDir, "missions-index.json"), {
    sourceUrl: MISSION_INDEX_URL,
    archivedAt: new Date().toISOString(),
    totalDiscovered: entries.length,
    selectedCount: selectedEntries.length,
    entries: selectedEntries,
  });

  const results = [];
  for (let index = 0; index < selectedEntries.length; index += 1) {
    const entry = selectedEntries[index];
    const ordinal = index + 1;
    const inferredLevel = inferMissionLevel(entry);
    const displayLevel = inferredLevel != null ? inferredLevel : "?";
    const displayName = entry.wikiName || entry.slug || entry.title;
    const progressPrefix = formatProgressPrefix(
      ordinal,
      selectedEntries.length,
      displayLevel,
      displayName,
    );
    process.stdout.write(`${progressPrefix}${colorizeStatus("starting")} ... `);

    try {
      const existing = options.force
        ? null
        : getExistingArchivedResult(options.outputDir, entry);
      const result =
        existing ||
        (await scrapeMission(entry, {
          outputDir: options.outputDir,
          delayMs: options.delayMs,
          force: options.force,
          logPath: crawlLogPath,
        }));
      results.push(result);
      process.stdout.write(`${colorizeStatus(result.status)}\n`);
    } catch (error) {
      const failure = {
        timestamp: new Date().toISOString(),
        slug: entry.slug,
        title: entry.title,
        status: "failed",
        message: error && error.message ? error.message : String(error),
      };
      appendLog(crawlLogPath, failure);
      results.push(failure);
      process.stdout.write(`${colorizeStatus("failed")}\n`);
    }

    writeJson(
      manifestPath,
      buildManifest({
        sourceUrl: MISSION_INDEX_URL,
        generatedAt: crawlStartedAt,
        outputDir: options.outputDir,
        crawlOptions: {
          delayMs: options.delayMs,
          force: options.force,
          limit: options.limit,
          selectedCount: selectedEntries.length,
        },
        entries,
        results,
      }),
    );

    if (index + 1 < selectedEntries.length) {
      await sleep(options.delayMs);
    }
  }

  const manifest = buildManifest({
    sourceUrl: MISSION_INDEX_URL,
    generatedAt: crawlStartedAt,
    outputDir: options.outputDir,
    crawlOptions: {
      delayMs: options.delayMs,
      force: options.force,
      limit: options.limit,
      selectedCount: selectedEntries.length,
    },
    entries,
    results,
  });
  writeJson(manifestPath, manifest);

  console.log(
    `Finished. archived=${manifest.archivedCount} skipped=${manifest.skippedCount} failed=${manifest.failedCount}`,
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..");
const workerScriptPath = path.join(__dirname, "benchmark_startup_system_loading.js");
const logDir = path.join(
  repoRoot,
  "logs",
  "benchmarks",
  "startup-system-loading",
);
const latestLogPath = path.join(logDir, "startup-system-loading-latest.txt");
const MODE_SPECS = [
  { mode: 1, label: "Lazy Default", accent: "\x1b[96m" },
  { mode: 2, label: "High-Sec Preload", accent: "\x1b[93m" },
  { mode: 3, label: "Full New Eden", accent: "\x1b[95m" },
];
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[96m",
  blue: "\x1b[94m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  magenta: "\x1b[95m",
  red: "\x1b[91m",
  white: "\x1b[97m",
  gray: "\x1b[90m",
};
const SPINNER_FRAMES = ["|", "/", "-", "\\"];

function supportsAnsi() {
  return Boolean(process.stdout && process.stdout.isTTY);
}

function color(text, openCode) {
  if (!supportsAnsi() || !openCode) {
    return String(text);
  }
  return `${openCode}${text}${ANSI.reset}`;
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function repeat(char, count) {
  return new Array(Math.max(0, count) + 1).join(char);
}

function pad(value, width, alignment = "left") {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  const gap = repeat(" ", width - text.length);
  return alignment === "right" ? `${gap}${text}` : `${text}${gap}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

function formatMs(value) {
  const numeric = Number(value || 0);
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(2)} s`;
  }
  return `${numeric.toFixed(1)} ms`;
}

function formatRatio(base, value) {
  const safeBase = Number(base || 0);
  const safeValue = Number(value || 0);
  if (safeBase <= 0) {
    return "n/a";
  }
  return `${(safeValue / safeBase).toFixed(1)}x`;
}

function createTimestampParts(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return {
    display: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
    fileStamp: `${year}${month}${day}-${hours}${minutes}${seconds}`,
  };
}

function buildProgressBar(modeIndex, modeCount) {
  const completed = modeIndex + 1;
  const width = 18;
  const filled = Math.round((completed / modeCount) * width);
  return `[${repeat("=", filled)}${repeat(".", width - filled)}]`;
}

function printDivider(label, accent) {
  const line = repeat("=", 78);
  console.log(color(line, ANSI.gray));
  console.log(
    `${color("  " + label, ANSI.bold + accent)}${color(`  ${line.slice(label.length + 2)}`, ANSI.gray)}`,
  );
  console.log(color(line, ANSI.gray));
}

function findBenchmarkPayload(output) {
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("BENCHMARK_RESULT=")) {
      continue;
    }
    return JSON.parse(line.slice("BENCHMARK_RESULT=".length));
  }
  return null;
}

function renderTable(results) {
  const columns = [
    { key: "label", title: "Mode", width: 19, align: "left" },
    { key: "systemCount", title: "Systems", width: 9, align: "right" },
    { key: "elapsedMs", title: "Load Time", width: 11, align: "right" },
    { key: "staticEntities", title: "Static", width: 10, align: "right" },
    { key: "dynamicEntities", title: "Dynamic", width: 10, align: "right" },
    { key: "stations", title: "Stations", width: 10, align: "right" },
    { key: "stargates", title: "Gates", width: 8, align: "right" },
    { key: "asteroidBelts", title: "Belts", width: 8, align: "right" },
    { key: "planets", title: "Planets", width: 9, align: "right" },
    { key: "moons", title: "Moons", width: 8, align: "right" },
    { key: "suns", title: "Suns", width: 7, align: "right" },
    { key: "npcShips", title: "NPC", width: 7, align: "right" },
  ];

  const header = columns
    .map((column) => pad(column.title, column.width, column.align))
    .join("  ");
  const separator = repeat("-", header.length);
  const rows = results.map((result) => {
    const values = {
      label: result.modeName,
      systemCount: formatInteger(result.systemCount),
      elapsedMs: formatMs(result.elapsedMs),
      staticEntities: formatInteger(result.staticEntities),
      dynamicEntities: formatInteger(result.dynamicEntities),
      stations: formatInteger(result.stations),
      stargates: formatInteger(result.stargates),
      asteroidBelts: formatInteger(result.asteroidBelts),
      planets: formatInteger(result.planets),
      moons: formatInteger(result.moons),
      suns: formatInteger(result.suns),
      npcShips: formatInteger(result.npcShips),
    };
    return columns
      .map((column) => pad(values[column.key], column.width, column.align))
      .join("  ");
  });

  return [header, separator, ...rows].join("\n");
}

function renderHighlights(results) {
  const lazy = results.find((result) => result.mode === 1) || results[0];
  return results.map((result) => {
    if (!lazy || result.mode === lazy.mode) {
      return `${result.modeName}: baseline run for comparisons.`;
    }
    return `${result.modeName}: ${formatRatio(lazy.elapsedMs, result.elapsedMs)} slower than mode 1, ${formatRatio(lazy.systemCount, result.systemCount)} more systems, ${formatRatio(lazy.staticEntities, result.staticEntities)} more static objects.`;
  });
}

function renderRawBreakdown(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`${result.modeName}`);
    lines.push(
      `  systems=${formatInteger(result.systemCount)} scenes=${formatInteger(result.sceneCount)} loadTime=${formatMs(result.elapsedMs)} rss=${result.rssMb} MB heap=${result.heapUsedMb} MB`,
    );
    lines.push(
      `  stations=${formatInteger(result.stations)} gates=${formatInteger(result.stargates)} belts=${formatInteger(result.asteroidBelts)} planets=${formatInteger(result.planets)} moons=${formatInteger(result.moons)} suns=${formatInteger(result.suns)} otherStatic=${formatInteger(result.otherStaticEntities)} npcShips=${formatInteger(result.npcShips)}`,
    );
  }
  return lines.join("\n");
}

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function writeLog(results, startedAt, finishedAt) {
  ensureLogDir();
  const finishedStamp = createTimestampParts(finishedAt);
  const timestampedLogPath = path.join(
    logDir,
    `startup-system-loading-${finishedStamp.fileStamp}.txt`,
  );
  const sections = [
    "EvEJS Startup System Loading Benchmark",
    `Started: ${createTimestampParts(startedAt).display}`,
    `Finished: ${finishedStamp.display}`,
    `Repository: ${repoRoot}`,
    "",
    renderTable(results),
    "",
    "Highlights",
    ...renderHighlights(results),
    "",
    "Detailed Breakdown",
    renderRawBreakdown(results),
    "",
    "Raw JSON",
    JSON.stringify(results, null, 2),
    "",
  ];
  const contents = sections.join("\n");
  fs.writeFileSync(timestampedLogPath, contents, "utf8");
  fs.writeFileSync(latestLogPath, contents, "utf8");
  return {
    timestampedLogPath,
    latestLogPath,
  };
}

function clearSpinnerLine(lastWidth) {
  if (!supportsAnsi()) {
    return;
  }
  process.stdout.write(`\r${repeat(" ", lastWidth)}\r`);
}

function resolveRequestedModes() {
  const requestedModes = new Set(
    process.argv
      .slice(2)
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 3),
  );
  if (requestedModes.size === 0) {
    return MODE_SPECS;
  }
  return MODE_SPECS.filter((modeSpec) => requestedModes.has(modeSpec.mode));
}

function runMode(modeSpec, modeIndex, modeCount) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerScriptPath, String(modeSpec.mode)],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          EVEJS_BENCHMARK_PROGRESS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let latestProgress = null;
    let resultPayload = null;
    let lastSpinnerWidth = 0;
    let spinnerIndex = 0;
    const startedAt = Date.now();

    function handleOutputLine(line) {
      const text = String(line || "");
      if (!text) {
        return;
      }
      if (text.startsWith("BENCHMARK_PROGRESS=")) {
        try {
          latestProgress = JSON.parse(text.slice("BENCHMARK_PROGRESS=".length));
        } catch (error) {
          stderr += `\nFailed to parse progress line: ${text}`;
        }
        return;
      }
      if (text.startsWith("BENCHMARK_RESULT=")) {
        try {
          resultPayload = JSON.parse(text.slice("BENCHMARK_RESULT=".length));
        } catch (error) {
          stderr += `\nFailed to parse result line: ${text}`;
        }
        return;
      }
      stdout += `${text}\n`;
    }

    function handleChunk(chunk, pendingText, lineHandler) {
      const combined = pendingText + chunk.toString();
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop();
      for (const line of lines) {
        lineHandler(line);
      }
      return remainder;
    }

    const spinner = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const spinnerFrame = color(
        SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length],
        modeSpec.accent,
      );
      const benchmarkProgress = latestProgress
        ? `${pad(`${Number(latestProgress.percent || 0).toFixed(1)}%`, 6, "right")} ${color(`[${formatInteger(latestProgress.loadedSystems)}/${formatInteger(latestProgress.totalSystems)}]`, ANSI.bold + ANSI.white)}`
        : color("[booting]", ANSI.dim + ANSI.white);
      const currentSystem = latestProgress && latestProgress.currentSystemID
        ? color(`system ${latestProgress.currentSystemID}`, ANSI.dim + ANSI.white)
        : color(String(latestProgress && latestProgress.phase || "starting"), ANSI.dim + ANSI.white);
      const line = `${spinnerFrame} ${buildProgressBar(modeIndex, modeCount)} ${color(modeSpec.label, ANSI.bold + modeSpec.accent)} ${benchmarkProgress} ${currentSystem} ${color(`elapsed ${formatMs(elapsedMs)}`, ANSI.dim + ANSI.white)}`;
      spinnerIndex += 1;
      if (supportsAnsi()) {
        const visibleWidth = stripAnsi(line).length;
        const trailingPadding = repeat(
          " ",
          Math.max(0, lastSpinnerWidth - visibleWidth),
        );
        process.stdout.write(`\r${line}${trailingPadding}`);
        lastSpinnerWidth = visibleWidth;
      } else if (spinnerIndex === 1) {
        console.log(line);
      }
    }, 120);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = handleChunk(chunk, stdoutBuffer, handleOutputLine);
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer = handleChunk(chunk, stderrBuffer, (line) => {
        stderr += `${line}\n`;
      });
    });

    child.on("error", (error) => {
      clearInterval(spinner);
      clearSpinnerLine(lastSpinnerWidth);
      reject(error);
    });

    child.on("close", (code) => {
      clearInterval(spinner);
      clearSpinnerLine(lastSpinnerWidth);
      handleOutputLine(stdoutBuffer);
      if (stderrBuffer) {
        stderr += `${stderrBuffer}\n`;
      }
      if (code !== 0) {
        reject(
          new Error(
            `mode ${modeSpec.mode} exited with code ${code}\n${stdout}\n${stderr}`.trim(),
          ),
        );
        return;
      }

      const payload = resultPayload || findBenchmarkPayload(stdout);
      if (!payload) {
        reject(
          new Error(
            `mode ${modeSpec.mode} did not emit BENCHMARK_RESULT\n${stdout}\n${stderr}`.trim(),
          ),
        );
        return;
      }

      console.log(
        `${color("[OK]", ANSI.green + ANSI.bold)} ${color(modeSpec.label, modeSpec.accent)} ${color(`completed in ${formatMs(payload.elapsedMs)}`, ANSI.white)} ${color(`systems=${formatInteger(payload.systemCount)} static=${formatInteger(payload.staticEntities)} gates=${formatInteger(payload.stargates)} stations=${formatInteger(payload.stations)} belts=${formatInteger(payload.asteroidBelts)} npc=${formatInteger(payload.npcShips)}`, ANSI.dim + ANSI.white)}`,
      );
      resolve(payload);
    });
  });
}

async function main() {
  const startedAt = new Date();
  const activeModes = resolveRequestedModes();
  if (activeModes.length === 0) {
    throw new Error("No valid benchmark modes were requested.");
  }

  printDivider("EvEJS Startup System Loading Benchmark", ANSI.blue);
  console.log(
    `${color("Scope:", ANSI.bold + ANSI.white)} compare mode 1 (lazy), mode 2 (high-sec), and mode 3 (full New Eden) using fresh worker processes.`,
  );
  console.log(
    `${color("Log:", ANSI.bold + ANSI.white)} a timestamped report and a rolling latest report will be saved under ${path.relative(repoRoot, logDir)}`,
  );
  console.log("");

  const results = [];
  for (let index = 0; index < activeModes.length; index += 1) {
    const modeSpec = activeModes[index];
    console.log(
      `${color(`Mode ${modeSpec.mode}`, ANSI.bold + modeSpec.accent)} ${color(modeSpec.label, modeSpec.accent)}`,
    );
    const result = await runMode(modeSpec, index, activeModes.length);
    results.push(result);
    console.log("");
  }

  printDivider("Summary Table", ANSI.cyan);
  console.log(color(renderTable(results), ANSI.white));
  console.log("");

  printDivider("Highlights", ANSI.magenta);
  for (const line of renderHighlights(results)) {
    console.log(`${color("-", ANSI.gray)} ${line}`);
  }
  console.log("");

  const finishedAt = new Date();
  const logPaths = writeLog(results, startedAt, finishedAt);
  printDivider("Saved Report", ANSI.green);
  console.log(`${color("Latest:", ANSI.bold + ANSI.white)} ${logPaths.latestLogPath}`);
  console.log(`${color("Snapshot:", ANSI.bold + ANSI.white)} ${logPaths.timestampedLogPath}`);
  console.log("");
}

main().catch((error) => {
  console.error(color("Benchmark report failed.", ANSI.red + ANSI.bold));
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});

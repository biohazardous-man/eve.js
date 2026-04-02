/*
 * Proof-of-authorship note: Primary authorship and project direction for this test suite belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const marketServerDir = path.join(repoRoot, "externalservices", "market-server");
const marketServerExe = path.join(marketServerDir, "target", "release", "market-server.exe");
const marketServerConfig = path.join(marketServerDir, "config", "market-server.local.toml");
const runtimeDir = path.join(marketServerDir, "runtime");
const artifactDir = path.join(repoRoot, "artifacts", "market-load-suite");
const outputJsonPath = path.join(artifactDir, "market-load-report.json");
const stdoutLogPath = path.join(runtimeDir, "load-suite.stdout.log");
const stderrLogPath = path.join(runtimeDir, "load-suite.stderr.log");
const baseUrl = "http://127.0.0.1:40110";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const powershellCommand = process.platform === "win32" ? "powershell.exe" : "powershell";
const cpuCount = os.cpus().length || 1;

const DEFAULT_CONNECTIONS = 256;
const DEFAULT_WORKERS = Math.min(Math.max(cpuCount >> 1, 4), 16);
const HOT_REGION_ID = 10000002;
const HOT_SYSTEM_ID = 30000142;
const HOT_STATION_ID = 60003760;
const HOT_TYPE_ID = 34;
const HEAVY_REGION_ID = 10000016;
const HEAVY_SYSTEM_ID = 30001399;
const HEAVY_STATION_ID = 60000256;
const LOAD_OWNER_ID = 990000001;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomChoice(values, rng) {
  return values[Math.floor(rng() * values.length)];
}

function createRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentileFromHistogram(histogram, percentile) {
  const target = Math.ceil(histogram.totalCount * percentile);
  if (target <= 0) {
    return 0;
  }
  let running = 0;
  for (let index = 0; index < histogram.buckets.length; index += 1) {
    running += histogram.buckets[index];
    if (running >= target) {
      return index / histogram.scale;
    }
  }
  return histogram.maxMs;
}

function buildHistogram(scale = 10, bucketCount = 600_000) {
  return {
    scale,
    bucketCount,
    buckets: new Uint32Array(bucketCount),
    totalCount: 0,
    sumMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0,
  };
}

function addValue(histogram, valueMs) {
  const bucket = Math.min(
    histogram.bucketCount - 1,
    Math.max(0, Math.floor(valueMs * histogram.scale)),
  );
  histogram.buckets[bucket] += 1;
  histogram.totalCount += 1;
  histogram.sumMs += valueMs;
  histogram.minMs = Math.min(histogram.minMs, valueMs);
  histogram.maxMs = Math.max(histogram.maxMs, valueMs);
}

function summarizeAutocannon(result) {
  const latency = result.latency || {};
  const requests = result.requests || {};
  const throughput = result.throughput || {};
  const totalRequests = Number(requests.total || 0);
  const errorCount =
    Number(result.errors || 0) +
    Number(result.timeouts || 0) +
    Number(result.non2xx || 0) +
    Number(result.resets || 0);
  return {
    durationSeconds: Number(result.duration || 0),
    totalRequests,
    requestsPerSecond: Number(requests.average || 0),
    bytesPerSecond: Number(throughput.average || 0),
    totalBytes: Number(throughput.total || 0),
    errorCount,
    errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
    latencyMs: {
      avg: Number(latency.average || 0),
      p50: Number(latency.p50 || 0),
      p95: Number(latency.p95 || latency.p97_5 || 0),
      p99: Number(latency.p99 || 0),
      p99_9: Number(latency.p99_9 || 0),
      max: Number(latency.max || 0),
    },
    statusCodeStats: result.statusCodeStats || {},
    raw: result,
  };
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return null;
  }
  const histogram = buildHistogram();
  let totalRequests = 0;
  let totalBytes = 0;
  let totalErrors = 0;
  let totalDuration = 0;
  let peakRps = 0;
  let peakBps = 0;
  let worstP99 = 0;
  let worstP999 = 0;
  for (const sample of samples) {
    totalRequests += sample.totalRequests;
    totalBytes += sample.totalBytes;
    totalErrors += sample.errorCount;
    totalDuration += sample.durationSeconds;
    peakRps = Math.max(peakRps, sample.requestsPerSecond);
    peakBps = Math.max(peakBps, sample.bytesPerSecond);
    worstP99 = Math.max(worstP99, sample.latencyMs.p99);
    worstP999 = Math.max(worstP999, sample.latencyMs.p99_9);
    addValue(histogram, sample.latencyMs.p50);
    addValue(histogram, sample.latencyMs.p95);
    addValue(histogram, sample.latencyMs.p99);
    addValue(histogram, sample.latencyMs.p99_9);
  }
  return {
    runs: samples.length,
    totalRequests,
    requestsPerSecondAvg: totalDuration > 0 ? totalRequests / totalDuration : 0,
    requestsPerSecondPeak: peakRps,
    bytesPerSecondAvg: totalDuration > 0 ? totalBytes / totalDuration : 0,
    bytesPerSecondPeak: peakBps,
    errorCount: totalErrors,
    errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
    percentileApproxMs: {
      p50: percentileFromHistogram(histogram, 0.5),
      p95: percentileFromHistogram(histogram, 0.95),
      p99: percentileFromHistogram(histogram, 0.99),
      p99_9: percentileFromHistogram(histogram, 0.999),
    },
    worstObserved: {
      p99: worstP99,
      p99_9: worstP999,
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function toRecordList(raw, preferredKeys = []) {
  for (const key of preferredKeys) {
    if (Array.isArray(raw?.[key])) {
      return raw[key];
    }
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object") {
    return Object.values(raw).filter((value) => value && typeof value === "object");
  }
  return [];
}

async function loadStaticContext() {
  const stationsRaw = await readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "stations", "data.json"),
  );
  const systemsRaw = await readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "solarSystems", "data.json"),
  );
  const itemTypesRaw = await readJson(
    path.join(repoRoot, "server", "src", "newDatabase", "data", "itemTypes", "data.json"),
  );
  const stations = toRecordList(stationsRaw, ["stations", "data", "rows"]);
  const systems = toRecordList(systemsRaw, ["solarSystems", "data", "rows"]);
  const itemTypes = toRecordList(itemTypesRaw, ["types", "data", "rows"]);

  const stationList = stations
    .map((station) => ({
      stationId: Number(station.stationID),
      solarSystemId: Number(station.solarSystemID),
      regionId: Number(station.regionID),
      name: station.stationName,
    }))
    .filter((station) => Number.isFinite(station.stationId))
    .sort((left, right) => left.stationId - right.stationId);

  const systemList = systems
    .map((system) => ({
      solarSystemId: Number(system.solarSystemID),
      regionId: Number(system.regionID),
      constellationId: Number(system.constellationID),
      name: system.solarSystemName,
    }))
    .filter((system) => Number.isFinite(system.solarSystemId))
    .sort((left, right) => left.solarSystemId - right.solarSystemId);

  const typeIds = itemTypes
    .filter((itemType) => itemType && itemType.marketGroupID != null && itemType.published)
    .map((itemType) => Number(itemType.typeID))
    .filter((typeId) => Number.isFinite(typeId))
    .sort((left, right) => left - right);

  const stationCountsByRegion = new Map();
  for (const station of stationList) {
    stationCountsByRegion.set(
      station.regionId,
      (stationCountsByRegion.get(station.regionId) || 0) + 1,
    );
  }

  const heaviestRegion = [...stationCountsByRegion.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? HEAVY_REGION_ID;

  const heavyStation =
    stationList.find((station) => station.regionId === heaviestRegion) ||
    stationList.find((station) => station.stationId === HEAVY_STATION_ID);

  const hotTypes = typeIds.slice(0, 50);
  const historyTypes = typeIds.slice(0, 200);

  return {
    stationList,
    systemList,
    typeIds,
    hotTypes,
    historyTypes,
    hotRegionId: HOT_REGION_ID,
    hotSystemId: HOT_SYSTEM_ID,
    hotStationId: HOT_STATION_ID,
    heavyRegionId: heaviestRegion,
    heavySystemId: heavyStation?.solarSystemId ?? HEAVY_SYSTEM_ID,
    heavyStationId: heavyStation?.stationId ?? HEAVY_STATION_ID,
  };
}

async function removeFileIfExists(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function ensureDirs() {
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.mkdir(artifactDir, { recursive: true });
}

async function startMarketServer() {
  await ensureDirs();
  await removeFileIfExists(stdoutLogPath);
  await removeFileIfExists(stderrLogPath);

  const stdout = fs.openSync(stdoutLogPath, "a");
  const stderr = fs.openSync(stderrLogPath, "a");
  const child = spawn(
    marketServerExe,
    ["--config", marketServerConfig, "serve"],
    {
      cwd: marketServerDir,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    },
  );

  child.on("error", (error) => {
    console.error(`Failed to spawn market-server: ${error.message}`);
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`market-server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return child;
      }
    } catch {}
    await delay(500);
  }

  throw new Error("market-server did not become healthy within 60 seconds");
}

async function stopMarketServer(child) {
  if (!child || child.exitCode != null) {
    return;
  }

  child.kill("SIGTERM");
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (child.exitCode != null) {
      return;
    }
    await delay(250);
  }

  child.kill("SIGKILL");
}

async function getProcessSnapshot(pid) {
  return new Promise((resolve) => {
    execFile(
      powershellCommand,
      [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress)`,
      ],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout || !stdout.trim()) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve({
            cpuSeconds: Number(data.CPU || 0),
            rssBytes: Number(data.WorkingSet64 || 0),
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

async function withProcessSampler(pid, runner) {
  let done = false;
  const samples = [];
  const sampler = (async () => {
    let previous = await getProcessSnapshot(pid);
    let previousWall = Date.now();
    if (previous) {
      samples.push({
        at: previousWall,
        cpuTotalPct: 0,
        rssBytes: previous.rssBytes,
      });
    }
    while (!done) {
      await delay(1000);
      const current = await getProcessSnapshot(pid);
      const now = Date.now();
      if (!current || !previous) {
        previous = current;
        previousWall = now;
        continue;
      }
      const deltaCpu = current.cpuSeconds - previous.cpuSeconds;
      const deltaWall = Math.max((now - previousWall) / 1000, 0.001);
      const cpuTotalPct = Math.max(0, (deltaCpu / deltaWall / cpuCount) * 100);
      samples.push({
        at: now,
        cpuTotalPct,
        rssBytes: current.rssBytes,
      });
      previous = current;
      previousWall = now;
    }
  })();

  try {
    const result = await runner();
    done = true;
    await sampler;
    return {
      result,
      processStats: summarizeProcessSamples(samples),
    };
  } catch (error) {
    done = true;
    await sampler;
    throw error;
  }
}

function summarizeProcessSamples(samples) {
  if (!samples.length) {
    return {
      samples: 0,
      avgCpuTotalPct: 0,
      peakCpuTotalPct: 0,
      peakRssMB: 0,
      rssDriftMB: 0,
    };
  }
  const cpuSamples = samples.filter((sample) => Number.isFinite(sample.cpuTotalPct));
  const avgCpuTotalPct =
    cpuSamples.reduce((sum, sample) => sum + sample.cpuTotalPct, 0) /
    Math.max(cpuSamples.length, 1);
  const peakCpuTotalPct = cpuSamples.reduce(
    (peak, sample) => Math.max(peak, sample.cpuTotalPct),
    0,
  );
  const peakRssBytes = samples.reduce(
    (peak, sample) => Math.max(peak, sample.rssBytes || 0),
    0,
  );
  const firstRss = samples[0].rssBytes || 0;
  const lastRss = samples[samples.length - 1].rssBytes || 0;

  return {
    samples: samples.length,
    avgCpuTotalPct,
    peakCpuTotalPct,
    peakRssMB: peakRssBytes / (1024 * 1024),
    rssDriftMB: (lastRss - firstRss) / (1024 * 1024),
  };
}

async function runAutocannon(args, pid) {
  const cliArgs = ["--yes", "autocannon", "-j", "-n", "--renderStatusCodes"];
  if (args.connections) {
    cliArgs.push("-c", String(args.connections));
  }
  if (args.durationSeconds) {
    cliArgs.push("-d", String(args.durationSeconds));
  }
  if (args.amount) {
    cliArgs.push("-a", String(args.amount));
  }
  if (args.workers) {
    cliArgs.push("-w", String(args.workers));
  }
  if (args.overallRate) {
    cliArgs.push("-R", String(args.overallRate));
  }
  if (args.method) {
    cliArgs.push("-m", args.method);
  }
  if (args.body) {
    cliArgs.push("-b", args.body);
  }
  if (args.headers) {
    for (const [key, value] of Object.entries(args.headers)) {
      cliArgs.push("-H", `${key}=${value}`);
    }
  }
  if (args.harPath) {
    cliArgs.push("--har", args.harPath, args.url);
  } else {
    cliArgs.push(args.url);
  }

  const { result, processStats } = await withProcessSampler(pid, () =>
    new Promise((resolve, reject) => {
      const child = spawn(npxCommand, cliArgs, {
        cwd: repoRoot,
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`autocannon exited with code ${code}: ${stderr || stdout}`));
          return;
        }
        try {
          const json = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop());
          resolve(json);
        } catch (error) {
          reject(new Error(`failed to parse autocannon JSON: ${error.message}\n${stdout}`));
        }
      });
    }),
  );

  return {
    ...summarizeAutocannon(result),
    process: processStats,
    command: {
      connections: args.connections,
      durationSeconds: args.durationSeconds,
      workers: args.workers,
      overallRate: args.overallRate || null,
      url: args.url,
      harPath: args.harPath || null,
    },
  };
}

function makeHarEntry(spec) {
  return {
    startedDateTime: new Date().toISOString(),
    time: 0,
    request: {
      method: spec.method || "GET",
      url: spec.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: Object.entries(spec.headers || {}).map(([name, value]) => ({ name, value })),
      queryString: [],
      headersSize: -1,
      bodySize: spec.body ? Buffer.byteLength(spec.body) : 0,
      postData: spec.body
        ? {
            mimeType: (spec.headers && spec.headers["content-type"]) || "application/json",
            text: spec.body,
          }
        : undefined,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: [],
      content: {
        size: 0,
        mimeType: "application/json",
        text: "",
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: {
      send: 0,
      wait: 0,
      receive: 0,
    },
  };
}

async function writeHar(filePath, specs) {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "marketLoadSuite", version: "1.0" },
      entries: specs.map(makeHarEntry),
    },
  };
  await fsp.writeFile(filePath, JSON.stringify(har));
}

function makeGet(url) {
  return { method: "GET", url };
}

function makePost(url, body) {
  return {
    method: "POST",
    url,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

function buildProfiles(context) {
  const rng = createRng(42);
  const hotOrderBookSpecs = [];
  const hotHistorySpecs = [];
  for (const typeId of context.hotTypes) {
    hotOrderBookSpecs.push(makeGet(`${baseUrl}/v1/orders/${HOT_REGION_ID}/${typeId}`));
    hotHistorySpecs.push(makeGet(`${baseUrl}/v1/history/${typeId}`));
  }

  const tradeHubHeavy = [];
  for (let index = 0; index < 600; index += 1) {
    tradeHubHeavy.push(hotOrderBookSpecs[index % hotOrderBookSpecs.length]);
  }
  for (let index = 0; index < 200; index += 1) {
    tradeHubHeavy.push(makeGet(`${baseUrl}/v1/summaries/station/${HOT_STATION_ID}`));
  }
  for (let index = 0; index < 100; index += 1) {
    tradeHubHeavy.push(hotHistorySpecs[index % hotHistorySpecs.length]);
  }
  for (let index = 0; index < 100; index += 1) {
    tradeHubHeavy.push(makeGet(`${baseUrl}/v1/summaries/region/${HOT_REGION_ID}`));
  }

  const universeDispersed = [];
  for (let index = 0; index < 350; index += 1) {
    universeDispersed.push(
      makeGet(`${baseUrl}/v1/summaries/system/${randomChoice(context.systemList, rng).solarSystemId}`),
    );
  }
  for (let index = 0; index < 350; index += 1) {
    universeDispersed.push(
      makeGet(`${baseUrl}/v1/summaries/station/${randomChoice(context.stationList, rng).stationId}`),
    );
  }
  for (let index = 0; index < 200; index += 1) {
    const station = randomChoice(context.stationList, rng);
    const typeId = randomChoice(context.typeIds, rng);
    universeDispersed.push(makeGet(`${baseUrl}/v1/orders/${station.regionId}/${typeId}`));
  }
  for (let index = 0; index < 100; index += 1) {
    universeDispersed.push(
      makeGet(`${baseUrl}/v1/history/${randomChoice(context.historyTypes, rng)}`),
    );
  }

  const hotItemStampede = [];
  for (let index = 0; index < 900; index += 1) {
    hotItemStampede.push(hotOrderBookSpecs[index % hotOrderBookSpecs.length]);
  }
  for (let index = 0; index < 100; index += 1) {
    hotItemStampede.push(makeGet(`${baseUrl}/v1/summaries/station/${HOT_STATION_ID}`));
  }

  const worstCaseThrash = [];
  for (let index = 0; index < 700; index += 1) {
    const station = context.stationList[(index * 37) % context.stationList.length];
    const typeId = context.typeIds[(index * 53) % context.typeIds.length];
    worstCaseThrash.push(makeGet(`${baseUrl}/v1/orders/${station.regionId}/${typeId}`));
  }
  for (let index = 0; index < 150; index += 1) {
    worstCaseThrash.push(
      makeGet(`${baseUrl}/v1/summaries/system/${context.systemList[(index * 41) % context.systemList.length].solarSystemId}`),
    );
  }
  for (let index = 0; index < 150; index += 1) {
    worstCaseThrash.push(
      makeGet(`${baseUrl}/v1/summaries/station/${context.stationList[(index * 43) % context.stationList.length].stationId}`),
    );
  }

  const mixedLive = [];
  for (let index = 0; index < 500; index += 1) {
    mixedLive.push(hotOrderBookSpecs[index % hotOrderBookSpecs.length]);
  }
  for (let index = 0; index < 200; index += 1) {
    mixedLive.push(makeGet(`${baseUrl}/v1/summaries/region/${HOT_REGION_ID}`));
  }
  for (let index = 0; index < 100; index += 1) {
    mixedLive.push(makeGet(`${baseUrl}/v1/summaries/system/${HOT_SYSTEM_ID}`));
  }
  for (let index = 0; index < 100; index += 1) {
    mixedLive.push(
      makePost(`${baseUrl}/v1/history/trade`, {
        type_id: context.hotTypes[index % context.hotTypes.length],
        price: 12000 + index,
        quantity: 1 + (index % 5),
      }),
    );
  }
  for (let index = 0; index < 100; index += 1) {
    mixedLive.push(
      makePost(`${baseUrl}/v1/admin/seed-stock/adjust`, {
        station_id: HOT_STATION_ID,
        type_id: context.hotTypes[index % context.hotTypes.length],
        new_quantity: 5000,
        reason: "load_suite",
      }),
    );
  }

  return {
    trade_hub_heavy: tradeHubHeavy,
    universe_dispersed: universeDispersed,
    hot_item_stampede: hotItemStampede,
    worst_case_thrash: worstCaseThrash,
    mixed_live_simulated_writes: mixedLive,
  };
}

async function runEndpointBaselines(pid) {
  const tests = [
    {
      name: "region_summary_hot",
      url: `${baseUrl}/v1/summaries/region/${HOT_REGION_ID}`,
    },
    {
      name: "system_summary_hot",
      url: `${baseUrl}/v1/summaries/system/${HOT_SYSTEM_ID}`,
    },
    {
      name: "station_summary_hot",
      url: `${baseUrl}/v1/summaries/station/${HOT_STATION_ID}`,
    },
    {
      name: "order_book_hot",
      url: `${baseUrl}/v1/orders/${HOT_REGION_ID}/${HOT_TYPE_ID}`,
    },
    {
      name: "history_hot",
      url: `${baseUrl}/v1/history/${HOT_TYPE_ID}`,
    },
  ];

  const results = {};
  for (const test of tests) {
    results[test.name] = await runAutocannon(
      {
        url: test.url,
        connections: DEFAULT_CONNECTIONS,
        workers: DEFAULT_WORKERS,
        durationSeconds: 15,
      },
      pid,
    );
  }
  return results;
}

async function runConcurrencySweep(pid) {
  const connectionLevels = [1, 4, 16, 64, 256, 512, 1024];
  const results = [];
  for (const connections of connectionLevels) {
    const result = await runAutocannon(
      {
        url: `${baseUrl}/v1/orders/${HOT_REGION_ID}/${HOT_TYPE_ID}`,
        connections,
        workers: DEFAULT_WORKERS,
        durationSeconds: 10,
      },
      pid,
    );
    results.push({
      connections,
      ...result,
    });
  }
  return results;
}

async function runRateSweep(pid, profileHarPath) {
  const rates = [10_000, 25_000, 50_000, 75_000, 100_000, 125_000, 150_000];
  const results = [];
  for (const overallRate of rates) {
    const result = await runAutocannon(
      {
        url: baseUrl,
        harPath: profileHarPath,
        connections: 512,
        workers: DEFAULT_WORKERS,
        durationSeconds: 15,
        overallRate,
      },
      pid,
    );
    results.push({
      overallRate,
      ...result,
    });
  }
  return results;
}

function chooseStableRate(rateSweepResults) {
  let stable = null;
  for (const result of rateSweepResults) {
    if (result.errorRate > 0.001) {
      continue;
    }
    if (result.latencyMs.p99 > 20 || result.latencyMs.p99_9 > 75) {
      continue;
    }
    stable = result.overallRate;
  }
  return stable || rateSweepResults[0]?.overallRate || 10_000;
}

async function runProfileMatrix(pid, harMap, baseRate) {
  const results = {};
  for (const [name, harPath] of Object.entries(harMap)) {
    results[name] = await runAutocannon(
      {
        url: baseUrl,
        harPath,
        connections: 512,
        workers: DEFAULT_WORKERS,
        durationSeconds: 20,
        overallRate: baseRate,
      },
      pid,
    );
  }
  return results;
}

async function runBurstSequence(pid, profileHarPath, stableRate) {
  const stages = [
    { name: "baseline_50pct", overallRate: Math.floor(stableRate * 0.5), durationSeconds: 15 },
    { name: "burst_100pct", overallRate: stableRate, durationSeconds: 15 },
    { name: "recovery_50pct", overallRate: Math.floor(stableRate * 0.5), durationSeconds: 15 },
  ];
  const results = [];
  for (const stage of stages) {
    results.push({
      stage: stage.name,
      ...(await runAutocannon(
        {
          url: baseUrl,
          harPath: profileHarPath,
          connections: 512,
          workers: DEFAULT_WORKERS,
          durationSeconds: stage.durationSeconds,
          overallRate: stage.overallRate,
        },
        pid,
      )),
    });
  }
  return results;
}

async function runSoak(pid, profileHarPath, soakRate) {
  return runAutocannon(
    {
      url: baseUrl,
      harPath: profileHarPath,
      connections: 512,
      workers: DEFAULT_WORKERS,
      durationSeconds: 300,
      overallRate: soakRate,
    },
    pid,
  );
}

async function main() {
  const context = await loadStaticContext();
  const profiles = buildProfiles(context);

  await ensureDirs();
  const harPaths = {};
  for (const [name, specs] of Object.entries(profiles)) {
    const harPath = path.join(artifactDir, `${name}.har`);
    await writeHar(harPath, specs);
    harPaths[name] = harPath;
  }

  const child = await startMarketServer();
  try {
    const endpointBaselines = await runEndpointBaselines(child.pid);
    const concurrencySweep = await runConcurrencySweep(child.pid);
    const rateSweep = await runRateSweep(child.pid, harPaths.trade_hub_heavy);
    const stableRate = chooseStableRate(rateSweep);
    const profileRate = Math.max(5_000, Math.floor(stableRate * 0.7));
    const profileMatrix = await runProfileMatrix(child.pid, harPaths, profileRate);
    const burst = await runBurstSequence(child.pid, harPaths.trade_hub_heavy, stableRate);
    const soak = await runSoak(child.pid, harPaths.trade_hub_heavy, profileRate);

    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        hostCpuCount: cpuCount,
        defaultWorkers: DEFAULT_WORKERS,
        baseUrl,
        marketServerExe,
        marketServerConfig,
        marketServerPid: child.pid,
      },
      selectedTargets: {
        hot: {
          regionId: HOT_REGION_ID,
          solarSystemId: HOT_SYSTEM_ID,
          stationId: HOT_STATION_ID,
          typeId: HOT_TYPE_ID,
        },
        heavy: {
          regionId: context.heavyRegionId,
          solarSystemId: context.heavySystemId,
          stationId: context.heavyStationId,
        },
      },
      endpointBaselines,
      concurrencySweep,
      rateSweep,
      chosenStableRate: stableRate,
      chosenProfileRate: profileRate,
      profileMatrix,
      burst,
      soak,
      summaries: {
        concurrencySweep: summarizeSamples(concurrencySweep),
        rateSweep: summarizeSamples(rateSweep),
      },
      logs: {
        stdout: stdoutLogPath,
        stderr: stderrLogPath,
      },
    };

    await fsp.writeFile(outputJsonPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, outputJsonPath, chosenStableRate: stableRate, chosenProfileRate: profileRate }, null, 2));
  } finally {
    await stopMarketServer(child);
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

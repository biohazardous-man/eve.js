const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

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

function formatTimestamp(date = new Date()) {
  const parts = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}

function runNodeScript(scriptPath, args, workdir) {
  const result = childProcess.spawnSync(
    process.execPath,
    [scriptPath, ...args],
    {
      cwd: workdir,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`Script failed: ${path.basename(scriptPath)}`);
  }
}

function buildComparisonSummary(comparisons) {
  const failedChecks = [];
  for (const [name, value] of Object.entries(comparisons || {})) {
    if (value && typeof value === "object") {
      if (typeof value.matches === "boolean") {
        if (!value.matches) {
          failedChecks.push(name);
        }
        continue;
      }

      const missingLocallyCount = Number(value.missingLocallyCount) || 0;
      const extraLocallyCount = Number(value.extraLocallyCount) || 0;
      const mismatchCount = Number(value.mismatchCount) || 0;
      if (missingLocallyCount > 0 || extraLocallyCount > 0 || mismatchCount > 0) {
        failedChecks.push(name);
      }
    }
  }

  return {
    failedChecks,
    failedCheckCount: failedChecks.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const jsonlDir = path.resolve(
    args.jsonlDir || findLatestJsonlSnapshotDir(repoRoot),
  );
  const localDbRoot = path.resolve(
    args.localDbRoot || path.join(repoRoot, "server", "src", "newDatabase", "data"),
  );
  const backupRoot = path.resolve(
    args.backupRoot || path.join(repoRoot, "_local", "backups"),
  );
  const reportsRoot = path.resolve(
    args.reportsRoot || path.join(repoRoot, "_local", "reports"),
  );
  const snapshotName = path.basename(jsonlDir);
  const reportPath = path.resolve(
    args.report || path.join(reportsRoot, `jsonl-local-static-data-report-${snapshotName}.json`),
  );

  fs.mkdirSync(backupRoot, { recursive: true });
  fs.mkdirSync(reportsRoot, { recursive: true });

  const backupPath = path.join(
    backupRoot,
    `newDatabase-data-${formatTimestamp()}`,
  );
  fs.cpSync(localDbRoot, backupPath, { recursive: true });

  runNodeScript(
    path.join(repoRoot, "scripts", "dev", "merge-jsonl-static-data-into-local.js"),
    ["--jsonlDir", jsonlDir, "--localDbRoot", localDbRoot],
    repoRoot,
  );
  runNodeScript(
    path.join(repoRoot, "scripts", "dev", "merge-jsonl-cosmetics-into-local.js"),
    ["--jsonlDir", jsonlDir],
    repoRoot,
  );
  runNodeScript(
    path.join(repoRoot, "scripts", "dev", "build-type-dogma-table.js"),
    ["--jsonlDir", jsonlDir],
    repoRoot,
  );
  runNodeScript(
    path.join(repoRoot, "scripts", "dev", "compare-jsonl-local-static-data.js"),
    ["--jsonlDir", jsonlDir, "--localDbRoot", localDbRoot, "--output", reportPath],
    repoRoot,
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const comparisonSummary = buildComparisonSummary(report.comparisons);

  console.log(JSON.stringify({
    ok: comparisonSummary.failedCheckCount === 0,
    jsonlDir,
    localDbRoot,
    backupPath,
    reportPath,
    failedCheckCount: comparisonSummary.failedCheckCount,
    failedChecks: comparisonSummary.failedChecks,
    missingTableCoverage:
      report && Array.isArray(report.missingTableCoverage)
        ? report.missingTableCoverage
        : [],
  }, null, 2));
}

main();

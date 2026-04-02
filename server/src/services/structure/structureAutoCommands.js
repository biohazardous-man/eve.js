const path = require("path");

const structureAutoState = require(path.join(__dirname, "./structureAutoState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_STATE_NAME_BY_ID,
} = require(path.join(__dirname, "./structureConstants"));

const AUTO_TYPES = new Set([
  "astrahus",
  "fortizar",
  "keepstar",
  "palatine",
  "raitaru",
  "azbel",
  "sotiyo",
  "athanor",
  "tatara",
]);

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePositiveInt(value, fallback = 0) {
  const numeric = normalizeInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function buildHelpText() {
  return [
    "/upwellauto help",
    "/upwellauto status",
    "/upwellauto stop <jobID|structureID|all>",
    "/upwellauto <astrahus|fortizar|keepstar|raitaru|azbel|sotiyo|athanor|tatara|palatine> [name]",
    "/upwellauto <structureID>",
  ].join("\n");
}

function formatJobSummary(job) {
  return [
    `job=${job.jobID}`,
    `mode=${job.mode}`,
    `structure=${job.structureID}`,
    `last=${job.lastAction || "none"}`,
  ].join(" | ");
}

function formatStructureSummary(structure) {
  if (!structure) {
    return "structure=?";
  }
  return [
    `${structure.itemName || structure.name || `Structure ${structure.structureID}`}(${structure.structureID})`,
    `state=${STRUCTURE_STATE_NAME_BY_ID[normalizeInt(structure.state, 0)] || "unknown"}`,
    `core=${structure.hasQuantumCore === true ? "installed" : "missing"}`,
  ].join(" | ");
}

function executeUpwellAutoCommand(session, argumentText) {
  const trimmed = String(argumentText || "").trim();
  const [firstTokenRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const firstToken = String(firstTokenRaw || "help").trim();
  const normalizedFirstToken = firstToken.toLowerCase();

  if (!firstToken || normalizedFirstToken === "help" || normalizedFirstToken === "?") {
    return {
      success: true,
      message: buildHelpText(),
    };
  }

  if (normalizedFirstToken === "status") {
    const jobs = structureAutoState.listActiveJobs();
    return {
      success: true,
      message: jobs.length > 0
        ? jobs.map((job) => formatJobSummary(job)).join("\n")
        : "No active Upwell automation jobs.",
    };
  }

  if (normalizedFirstToken === "stop") {
    const stopTarget = String(rest.join(" ").trim() || "");
    if (!stopTarget) {
      return {
        success: false,
        message: "Usage: /upwellauto stop <jobID|structureID|all>",
      };
    }
    const stopResult = structureAutoState.stopAutomation(stopTarget);
    if (!stopResult.success) {
      return {
        success: false,
        message: `Failed to stop Upwell automation: ${stopResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: stopTarget.toLowerCase() === "all"
        ? `Stopped ${stopResult.data.stoppedCount} Upwell automation job${stopResult.data.stoppedCount === 1 ? "" : "s"}.`
        : `Stopped Upwell automation for ${stopTarget}.`,
    };
  }

  if (AUTO_TYPES.has(normalizedFirstToken)) {
    const startResult = structureAutoState.startAutoOnline(session, normalizedFirstToken, {
      name: rest.join(" ").trim() || undefined,
    });
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start Upwell online automation: ${startResult.errorMsg}.`,
      };
    }
    const structure = startResult.data.structure;
    return {
      success: true,
      message: [
        `Started Upwell online automation: ${formatJobSummary(startResult.data.job)}.`,
        `Seeded ${formatStructureSummary(structure)}.`,
        `It runs the next lifecycle step immediately, then every 10 seconds until docking is online.`,
        `Step-by-step output is written to server/logs/upwell.log.`,
      ].join("\n"),
    };
  }

  const structureID = normalizePositiveInt(firstToken, 0);
  if (structureID > 0) {
    const structure = structureState.getStructureByID(structureID);
    if (!structure) {
      return {
        success: false,
        message: `Structure ${structureID} was not found.`,
      };
    }
    const startResult = structureAutoState.startAutoDestroy(session, structureID);
    if (!startResult.success) {
      return {
        success: false,
        message: `Failed to start Upwell destruction automation: ${startResult.errorMsg}.`,
      };
    }
    return {
      success: true,
      message: [
        `Started Upwell destruction automation: ${formatJobSummary(startResult.data.job)}.`,
        `Target: ${formatStructureSummary(startResult.data.structure)}.`,
        `It uses GM damage internally every 10 seconds and will fully destroy the structure automatically.`,
        `No manual attack is required unless you want to test the real combat path instead.`,
      ].join("\n"),
    };
  }

  return {
    success: false,
    message: buildHelpText(),
  };
}

module.exports = {
  executeUpwellAutoCommand,
};

/**
 * UNIVERSAL DATABASE TABLE CONTROLLER:
 * read or write actual data
 */

const fs = require("fs");
const path = require("path");

const log = require("../../../utils/logger");
const dbFile = path.join(__dirname, "data.json");

function ensureFile() {
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({}, null, 2));
  }
}

function getSegments(pathKey) {
  return String(pathKey || "/").split("/").filter(Boolean);
}

function read(pathKey = "/") {
  try {
    ensureFile();

    const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    const segments = getSegments(pathKey);

    if (segments.length === 0) {
      return {
        success: true,
        errorMsg: null,
        data: db,
      };
    }

    let current = db;
    for (const segment of segments) {
      if (
        current === null ||
        typeof current !== "object" ||
        !(segment in current)
      ) {
        return {
          success: false,
          errorMsg: "ENTRY_NOT_FOUND",
          data: null,
        };
      }
      current = current[segment];
    }

    return {
      success: true,
      errorMsg: null,
      data: current,
    };
  } catch (err) {
    log.error("[DATABASE READ ERROR]", err);
    return {
      success: false,
      errorMsg: "READ_ERROR",
      data: null,
    };
  }
}

function write(pathKey = "/", data) {
  try {
    ensureFile();

    const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    const segments = getSegments(pathKey);

    if (segments.length === 0) {
      fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
      return {
        success: true,
        errorMsg: null,
      };
    }

    let current = db;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (
        !(segment in current) ||
        current[segment] === null ||
        typeof current[segment] !== "object"
      ) {
        current[segment] = {};
      }
      current = current[segment];
    }

    current[segments[segments.length - 1]] = data;
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return {
      success: true,
      errorMsg: null,
    };
  } catch (err) {
    log.error("[DATABASE WRITE ERROR]", err);
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }
}

module.exports = { read, write };

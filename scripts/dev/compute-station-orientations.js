/**
 * compute-station-orientations.js
 *
 * Computes per-instance dunRotation for all NPC stations, then rotates
 * model-space dockEntry / dockOrientation to world-space and writes the
 * updated station data back to data.json.
 *
 * Approach:
 *   - The station model's forward (+Z) should face outward from its orbit body.
 *   - dunRotation = [yaw, pitch, 0] in degrees that rotates model +Z to outward.
 *   - dockEntry / dockOrientation are then rotated by the same dunRotation to
 *     get world-space values stored as dockPosition / undockDirection / etc.
 *
 * Usage:  node scripts/dev/compute-station-orientations.js
 */

const fs = require("fs");
const path = require("path");

const DB_ROOT = path.join(__dirname, "../../server/src/newDatabase/data");
const STATIONS_PATH = path.join(DB_ROOT, "stations/data.json");
const STATION_TYPES_PATH = path.join(DB_ROOT, "stationTypes/data.json");
const CELESTIALS_PATH = path.join(DB_ROOT, "celestials/data.json");

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------
function vec(x, y, z) {
  return { x: x || 0, y: y || 0, z: z || 0 };
}
function vecSub(a, b) {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}
function vecAdd(a, b) {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}
function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vecMag(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function vecNorm(v, fallback) {
  const m = vecMag(v);
  if (m < 1e-10) return fallback || vec(0, 0, 1);
  return vec(v.x / m, v.y / m, v.z / m);
}

// ---------------------------------------------------------------------------
// Quaternion math  (matches CCP geo2.QuaternionRotationSetYawPitchRoll)
//
// Convention: R = R_yaw(Y) * R_pitch(X) * R_roll(Z), left-handed.
// Pitch is applied first, then yaw.  Roll is always 0 for stations.
//
// After pitch p around X:  (0,0,1) → (0, -sin(p), cos(p))
// After yaw  y around Y:  → (cos(p)·sin(y), -sin(p), cos(p)·cos(y))
//
// So to face direction D = (dx, dy, dz):
//   pitch = asin(-dy)            (guaranteed |dy| ≤ 1 for unit D)
//   yaw   = atan2(dx, dz)        (works even when cos(p) ≈ 0)
// ---------------------------------------------------------------------------
function quatFromYPR(yaw, pitch, roll) {
  const cy = Math.cos(yaw / 2),   sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2),  sr = Math.sin(roll / 2);
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
  };
}

function quatRotateVec(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function roundN(v, n = 6) {
  return Number(v.toFixed(n));
}
function roundVec(v, n = 3) {
  return { x: roundN(v.x, n), y: roundN(v.y, n), z: roundN(v.z, n) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const stationsData = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf8"));
  const stationTypesData = JSON.parse(fs.readFileSync(STATION_TYPES_PATH, "utf8"));
  const celestialsData = JSON.parse(fs.readFileSync(CELESTIALS_PATH, "utf8"));

  const celestialsById = new Map();
  for (const c of celestialsData.celestials) {
    celestialsById.set(c.itemID, c);
  }
  const stationTypesById = new Map();
  for (const st of stationTypesData.stationTypes) {
    stationTypesById.set(st.stationTypeID, st);
  }

  let updated = 0;
  let noOrbitBody = 0;
  let noDockData = 0;

  for (const station of stationsData.stations) {
    const stationType = stationTypesById.get(station.stationTypeID);

    // ALWAYS use station TYPE for model-space values (station record may
    // have been overwritten by a previous run with world-space values).
    const dockEntry = (stationType && stationType.dockEntry) || station.dockEntry;
    const modelDockDir = (stationType && stationType.dockOrientation) || station.dockOrientation;

    if (!dockEntry || !modelDockDir || vecMag(modelDockDir) < 1e-6) {
      noDockData++;
      continue;
    }

    const stationPos = station.position;
    if (!stationPos) continue;

    // Find the orbit body position
    let orbitBodyPos = null;
    if (station.orbitID) {
      const orbitBody = celestialsById.get(station.orbitID);
      if (orbitBody && orbitBody.position) {
        orbitBodyPos = orbitBody.position;
      }
    }

    // Outward direction (from orbit body toward station)
    let outwardDir;
    if (orbitBodyPos) {
      outwardDir = vecNorm(vecSub(stationPos, orbitBodyPos));
    } else {
      outwardDir = vecNorm(stationPos, vec(1, 0, 0));
      noOrbitBody++;
    }

    // -----------------------------------------------------------------------
    // Compute dunRotation:  orient model +Z to face outwardDir
    //
    //   After R_yaw * R_pitch applied to (0,0,1):
    //     result = (cos(p)·sin(y), -sin(p), cos(p)·cos(y))
    //
    //   Setting that equal to outwardDir (ox, oy, oz):
    //     pitch = asin(-oy)
    //     yaw   = atan2(ox, oz)
    // -----------------------------------------------------------------------
    const yaw   = Math.atan2(outwardDir.x, outwardDir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -outwardDir.y)));

    const dunRotation = [
      roundN(yaw * DEG, 4),
      roundN(pitch * DEG, 4),
      0,
    ];

    // Rotate dockEntry and dockOrientation to world space
    const q = quatFromYPR(yaw, pitch, 0);
    const worldDockOffset = quatRotateVec(q, vec(dockEntry.x, dockEntry.y, dockEntry.z));
    const worldDockDir = vecNorm(quatRotateVec(q, vecNorm(modelDockDir)));
    const worldDockPos = vecAdd(stationPos, worldDockOffset);

    // Write to station record
    station.dunRotation = dunRotation;
    station.dockOrientation = roundVec(worldDockDir);
    station.undockDirection = roundVec(worldDockDir);
    station.dockPosition = roundVec(worldDockPos, 3);
    station.undockPosition = roundVec(worldDockPos, 3);

    updated++;

    // Debug: Jita 4-4
    if (station.stationID === 60003760) {
      console.log("\n=== Jita 4-4 (stationID 60003760) ===");
      console.log("  Station pos:", stationPos);
      console.log("  Orbit body pos:", orbitBodyPos);
      console.log("  Outward direction:", roundVec(outwardDir, 6));
      console.log("  Model dockOrientation:", modelDockDir);
      console.log("  Model dockEntry:", dockEntry);
      console.log("  dunRotation (deg):", dunRotation);
      console.log("  World dock direction:", roundVec(worldDockDir, 6));
      console.log("  World dock position:", roundVec(worldDockPos, 0));

      // Verify: model +Z → outward?
      const fwd = quatRotateVec(q, vec(0, 0, 1));
      console.log("  Model +Z after rotation:", roundVec(fwd, 6),
        `dot=${roundN(vecDot(fwd, outwardDir), 6)}`);
    }
  }

  // Sample verification
  const sample = stationsData.stations.filter(s => s.dunRotation).slice(0, 5);
  console.log("\n=== Sample verification (model +Z → outward) ===");
  for (const s of sample) {
    const [yDeg, pDeg] = s.dunRotation;
    const q = quatFromYPR(yDeg * RAD, pDeg * RAD, 0);
    const fwd = quatRotateVec(q, vec(0, 0, 1));
    console.log(`  ${s.stationName.substring(0, 50)}:`);
    console.log(`    dunRotation: [${s.dunRotation}]`);
    console.log(`    model +Z →: ${JSON.stringify(roundVec(fwd, 4))}`);
    console.log(`    undockDir:  ${JSON.stringify(s.undockDirection)}`);
  }

  // Update metadata
  stationsData.source.localExtensions = stationsData.source.localExtensions || {};
  stationsData.source.localExtensions.preservedFields = [
    ...new Set([
      ...(stationsData.source.localExtensions.preservedFields || []),
      "dunRotation",
    ]),
  ];
  stationsData.source.localExtensions.dunRotationNote =
    "dunRotation [yaw,pitch,0] in degrees — orients model +Z outward from orbit body. " +
    "dockOrientation/undockDirection/dockPosition/undockPosition rotated to world space.";

  fs.writeFileSync(STATIONS_PATH, JSON.stringify(stationsData, null, 2) + "\n", "utf8");

  // Stats
  const withDun = stationsData.stations.filter(s => s.dunRotation);
  const yaws = withDun.map(s => s.dunRotation[0]);
  const pitches = withDun.map(s => s.dunRotation[1]);
  console.log(`\n=== Summary ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  No dock data (skipped): ${noDockData}`);
  console.log(`  No orbit body (used sun fallback): ${noOrbitBody}`);
  console.log(`  Yaw range: ${Math.min(...yaws).toFixed(1)} to ${Math.max(...yaws).toFixed(1)}`);
  console.log(`  Pitch range: ${Math.min(...pitches).toFixed(1)} to ${Math.max(...pitches).toFixed(1)}`);
  console.log(`  |Pitch| > 45°: ${pitches.filter(p => Math.abs(p) > 45).length}`);
  console.log(`  Written to: ${STATIONS_PATH}`);
}

main();

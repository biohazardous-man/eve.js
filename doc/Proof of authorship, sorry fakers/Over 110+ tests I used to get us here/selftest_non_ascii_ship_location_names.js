/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const ConfigService = require(path.join(
  __dirname,
  "../../server/src/services/config/configService",
));

function main() {
  const svc = new ConfigService();
  const session = {
    characterID: 140000003,
    stationid: 60003760,
    solarsystemid2: 30000142,
  };

  const result = svc.Handle_GetMultiLocationsEx([[140000299, 140000449]], session);
  assert(Array.isArray(result), "Expected tuple-style result");
  assert.strictEqual(result.length, 2, "Expected [header, rows]");
  assert.deepStrictEqual(
    result[0],
    ["locationID", "locationName", "solarSystemID", "x", "y", "z", "locationNameID"],
    "Location row header should match cfg.evelocations layout",
  );

  const rows = result[1];
  assert(Array.isArray(rows) && rows.length === 2, "Expected two location rows");

  for (const row of rows) {
    assert.strictEqual(row.length, 7, "Location row should have 7 fields");
    assert.strictEqual(typeof row[1], "string", "Location name should be a string");
    assert(/^[\x20-\x7E]+$/.test(row[1]), `Location name should be client-safe ASCII: ${row[1]}`);
    assert.strictEqual(row[2], 30000142, "Ship location row should include session solarSystemID");
  }

  console.log(JSON.stringify({
    ok: true,
    rows,
  }, null, 2));
}

main();

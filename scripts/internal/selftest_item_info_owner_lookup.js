const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const ConfigService = require(path.join(
  __dirname,
  "../../server/src/services/config/configService",
));
const {
  getCharacterRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));

function extractRows(tupleSet) {
  if (!Array.isArray(tupleSet) || tupleSet.length < 2) {
    return [];
  }
  return Array.isArray(tupleSet[1]) ? tupleSet[1] : [];
}

function main() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters table");

  const itemsResult = database.read("items", "/");
  assert(itemsResult.success, "Failed to read items table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);
  assert(characterIDs.length > 0, "Expected at least one character record");

  const knownCharacterID = characterIDs[0];
  const characterRecord = getCharacterRecord(knownCharacterID);
  assert(characterRecord, "Expected a readable character record");

  const candidateItemID = Object.keys(itemsResult.data || {})
    .map((value) => Number(value) || 0)
    .find((itemID) => {
      if (itemID <= 0) {
        return false;
      }
      const item = itemsResult.data[String(itemID)];
      return (
        item &&
        Number(item.ownerID) === knownCharacterID &&
        Number(item.categoryID) !== 6
      );
    });
  assert(
    candidateItemID,
    "Expected a non-ship inventory item for owner lookup regression",
  );

  const config = new ConfigService();
  const session = {
    characterID: knownCharacterID,
    charid: knownCharacterID,
    userid: knownCharacterID,
    stationid:
      Number(characterRecord.stationID || characterRecord.stationid || 0) ||
      null,
    stationID:
      Number(characterRecord.stationID || characterRecord.stationid || 0) ||
      null,
    solarsystemid:
      Number(characterRecord.solarSystemID || characterRecord.solarsystemid || 0) ||
      null,
    solarsystemid2:
      Number(characterRecord.solarSystemID || characterRecord.solarsystemid || 0) ||
      null,
  };

  const mixedResponse = config.Handle_GetMultiOwnersEx(
    [[candidateItemID, knownCharacterID]],
    session,
  );
  const mixedRows = extractRows(mixedResponse);
  assert(
    mixedRows.some((row) => Number(row && row[0]) === knownCharacterID),
    "Expected known character owner lookup to still resolve",
  );
  assert(
    !mixedRows.some((row) => Number(row && row[0]) === candidateItemID),
    "Expected non-owner inventory item IDs to be omitted from GetMultiOwnersEx",
  );

  const itemOnlyResponse = config.Handle_GetMultiOwnersEx(
    [[candidateItemID]],
    session,
  );
  const itemOnlyRows = extractRows(itemOnlyResponse);
  assert.strictEqual(
    itemOnlyRows.length,
    0,
    "Expected non-owner inventory item lookups to return no owner rows",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        knownCharacterID,
        candidateItemID,
        returnedCharacterRows: mixedRows.filter(
          (row) => Number(row && row[0]) === knownCharacterID,
        ).length,
        returnedItemRows: mixedRows.filter(
          (row) => Number(row && row[0]) === candidateItemID,
        ).length,
      },
      null,
      2,
    ),
  );
}

main();

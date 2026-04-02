/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const InvBrokerService = require(path.join(
  __dirname,
  "../../server/src/services/inventory/invBrokerService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  listFittedItems,
  isShipFittingFlag,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));
const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      if (!characterRecord || !ship) {
        return null;
      }

      const fittedModules = listFittedItems(characterID, ship.itemID)
        .filter((item) => item && isShipFittingFlag(item.flagID));
      if (fittedModules.length === 0) {
        return null;
      }

      return {
        characterID,
        characterRecord,
        ship,
        fittedModules,
      };
    })
    .filter(Boolean);

  assert(candidates.length > 0, "Expected at least one active ship with fitted modules");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9800,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    userid: candidate.characterID,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    stationid:
      Number(
        candidate.characterRecord.stationID ??
        candidate.characterRecord.stationid ??
        0,
      ) || null,
    solarsystemid:
      Number(candidate.characterRecord.solarSystemID || 0) || 30000142,
    solarsystemid2:
      Number(candidate.characterRecord.solarSystemID || 0) || 30000142,
    socket: { destroyed: false },
    currentBoundObjectID: null,
  };
}

function main() {
  const candidate = getCandidate();
  const service = new InvBrokerService();
  const session = buildSession(candidate);

  const bound = service.Handle_GetInventoryFromId([candidate.ship.itemID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;

  const result = service.Handle_List([], session, {
    type: "dict",
    entries: [
      ["flag", null],
      ["machoVersion", 1],
    ],
  });
  const listedItemIDs =
    result &&
    result.type === "list" &&
    Array.isArray(result.items)
      ? result.items
        .map((row) => Number(row && row.fields && row.fields.itemID) || 0)
        .filter((itemID) => itemID > 0)
      : [];

  assert(
    listedItemIDs.length >= candidate.fittedModules.length,
    "Expected explicit List(flag=None) on a ship inventory to include fitted modules",
  );
  for (const moduleItem of candidate.fittedModules) {
    assert(
      listedItemIDs.includes(Number(moduleItem.itemID)),
      `Expected fitted module ${moduleItem.itemID} to be present in List(flag=None) results`,
    );
  }

  console.log(JSON.stringify({
    ok: true,
    characterID: candidate.characterID,
    shipID: candidate.ship.itemID,
    fittedModuleCount: candidate.fittedModules.length,
    listedItemCount: listedItemIDs.length,
    sampleModuleIDs: candidate.fittedModules.slice(0, 5).map((item) => item.itemID),
  }, null, 2));
}

main();

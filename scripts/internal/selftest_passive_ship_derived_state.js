const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  buildInventoryItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemTypeRegistry",
));
const {
  buildShipResourceState,
  getShipSlotCounts,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert(result && result.success, `Expected item type '${name}' to exist`);
  return result.match;
}

function getCandidate() {
  const charactersResult = database.read("characters", "/");
  assert(charactersResult.success, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      );
      if (!ship || stationID <= 0) {
        return null;
      }

      return {
        characterID,
        ship,
        slots: getShipSlotCounts(ship.typeID),
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.slots.low >= 6);

  assert(candidates.length > 0, "Expected at least one ship with six low slots");
  return candidates[0];
}

function buildFittedModule(itemID, type, ownerID, shipID, flagID) {
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID,
    locationID: shipID,
    flagID,
    singleton: 1,
    moduleState: {
      online: true,
    },
  });
}

function main() {
  const candidate = getCandidate();
  const overdrive = resolveExactItem("Overdrive Injector System I");
  const expandedCargohold = resolveExactItem("Expanded Cargohold I");
  const coProcessor = resolveExactItem("Co-Processor I");
  const reactorControl = resolveExactItem("Reactor Control Unit I");

  const baseline = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [],
  });
  const oneOverdrive = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000001, overdrive, candidate.characterID, candidate.ship.itemID, 11),
    ],
  });
  const twoOverdrives = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000001, overdrive, candidate.characterID, candidate.ship.itemID, 11),
      buildFittedModule(990000002, overdrive, candidate.characterID, candidate.ship.itemID, 12),
    ],
  });
  const threeOverdrives = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000001, overdrive, candidate.characterID, candidate.ship.itemID, 11),
      buildFittedModule(990000002, overdrive, candidate.characterID, candidate.ship.itemID, 12),
      buildFittedModule(990000003, overdrive, candidate.characterID, candidate.ship.itemID, 13),
    ],
  });
  const expandedOnly = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000011, expandedCargohold, candidate.characterID, candidate.ship.itemID, 11),
    ],
  });
  const coProcessorOnly = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000012, coProcessor, candidate.characterID, candidate.ship.itemID, 11),
    ],
  });
  const reactorControlOnly = buildShipResourceState(candidate.characterID, candidate.ship, {
    fittedItems: [
      buildFittedModule(990000013, reactorControl, candidate.characterID, candidate.ship.itemID, 11),
    ],
  });

  const incrementOne = oneOverdrive.maxVelocity - baseline.maxVelocity;
  const incrementTwo = twoOverdrives.maxVelocity - oneOverdrive.maxVelocity;
  const incrementThree = threeOverdrives.maxVelocity - twoOverdrives.maxVelocity;

  assert(
    oneOverdrive.maxVelocity > baseline.maxVelocity,
    "Expected one overdrive to increase max velocity",
  );
  assert(
    twoOverdrives.maxVelocity > oneOverdrive.maxVelocity,
    "Expected a second overdrive to further increase max velocity",
  );
  assert(
    threeOverdrives.maxVelocity > twoOverdrives.maxVelocity,
    "Expected a third overdrive to further increase max velocity",
  );
  assert(
    incrementTwo < incrementOne,
    "Expected stacking penalty to reduce the second overdrive gain",
  );
  assert(
    incrementThree < incrementTwo,
    "Expected stacking penalty to reduce the third overdrive gain",
  );
  assert(
    expandedOnly.cargoCapacity > baseline.cargoCapacity,
    "Expected expanded cargohold to increase cargo capacity",
  );
  assert(
    coProcessorOnly.cpuOutput > baseline.cpuOutput,
    "Expected co-processor to increase CPU output",
  );
  assert(
    reactorControlOnly.powerOutput > baseline.powerOutput,
    "Expected reactor control unit to increase power output",
  );

  console.log(JSON.stringify({
    ok: true,
    characterID: candidate.characterID,
    shipID: candidate.ship.itemID,
    shipTypeID: candidate.ship.typeID,
    baseline: {
      maxVelocity: baseline.maxVelocity,
      cargoCapacity: baseline.cargoCapacity,
      cpuOutput: baseline.cpuOutput,
      powerOutput: baseline.powerOutput,
    },
    oneOverdrive: {
      maxVelocity: oneOverdrive.maxVelocity,
    },
    twoOverdrives: {
      maxVelocity: twoOverdrives.maxVelocity,
    },
    threeOverdrives: {
      maxVelocity: threeOverdrives.maxVelocity,
    },
    expandedOnly: {
      cargoCapacity: expandedOnly.cargoCapacity,
    },
    coProcessorOnly: {
      cpuOutput: coProcessorOnly.cpuOutput,
    },
    reactorControlOnly: {
      powerOutput: reactorControlOnly.powerOutput,
    },
  }, null, 2));
}

main();

const path = require("path");

const {
  ITEM_FLAGS,
  getAllItems,
  moveItemToLocation,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  validateFitForShip,
  isShipFittingFlag,
  isFittedModuleItem,
  isFittedChargeItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/fitting/liveFittingState",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../../server/src/services/chat/shipTypeRegistry",
));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function sortByFlagThenId(left, right) {
  const leftFlag = toInt(left && left.flagID, 0);
  const rightFlag = toInt(right && right.flagID, 0);
  if (leftFlag !== rightFlag) {
    return leftFlag - rightFlag;
  }
  return toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0);
}

function getShipFallbackDestination(shipItem) {
  if (toInt(shipItem && shipItem.flagID, 0) === 0) {
    return {
      locationID: toInt(shipItem.itemID, 0),
      flagID: ITEM_FLAGS.CARGO_HOLD,
      label: "cargo",
    };
  }

  return {
    locationID: toInt(shipItem.locationID, 0),
    flagID: ITEM_FLAGS.HANGAR,
    label: "hangar",
  };
}

function auditShipFit(shipItem, allItems) {
  const ownerID = toInt(shipItem && shipItem.ownerID, 0);
  const shipID = toInt(shipItem && shipItem.itemID, 0);
  if (ownerID <= 0 || shipID <= 0) {
    return null;
  }

  const fittedItems = allItems
    .filter(
      (item) =>
        item &&
        toInt(item.locationID, 0) === shipID &&
        isShipFittingFlag(item.flagID),
    )
    .sort(sortByFlagThenId);

  if (fittedItems.length === 0) {
    return null;
  }

  const acceptedModules = [];
  const invalidEntries = [];

  for (const item of fittedItems.filter((entry) => isFittedModuleItem(entry))) {
    const fitResult = validateFitForShip(
      ownerID,
      shipItem,
      item,
      toInt(item.flagID, 0),
      acceptedModules,
    );
    if (fitResult && fitResult.success) {
      acceptedModules.push(item);
      continue;
    }

    invalidEntries.push({
      kind: "module",
      item,
      error: fitResult ? fitResult.errorMsg : "INVALID_FIT",
      details: fitResult && fitResult.data ? fitResult.data : null,
    });
  }

  const acceptedModuleFlags = new Set(
    acceptedModules.map((item) => toInt(item.flagID, 0)),
  );
  const seenChargeFlags = new Set();
  for (const item of fittedItems.filter((entry) => isFittedChargeItem(entry))) {
    const flagID = toInt(item.flagID, 0);
    if (!acceptedModuleFlags.has(flagID)) {
      invalidEntries.push({
        kind: "charge",
        item,
        error: "ORPHANED_CHARGE",
        details: { flagID },
      });
      continue;
    }

    if (seenChargeFlags.has(flagID)) {
      invalidEntries.push({
        kind: "charge",
        item,
        error: "DUPLICATE_CHARGE_SLOT",
        details: { flagID },
      });
      continue;
    }

    seenChargeFlags.add(flagID);
  }

  if (invalidEntries.length === 0) {
    return null;
  }

  const shipType = resolveShipByTypeID(shipItem.typeID) || null;
  return {
    shipID,
    ownerID,
    shipName: shipItem.itemName || shipItem.shipName || "Ship",
    shipTypeID: toInt(shipItem.typeID, 0),
    shipTypeName: shipType && shipType.name ? shipType.name : null,
    destination: getShipFallbackDestination(shipItem),
    invalidEntries,
  };
}

function applyCleanup(audit) {
  const moved = [];

  for (const entry of audit.invalidEntries) {
    const moveResult = moveItemToLocation(
      entry.item.itemID,
      audit.destination.locationID,
      audit.destination.flagID,
    );
    if (!moveResult.success) {
      throw new Error(
        `Failed to move item ${entry.item.itemID} off ship ${audit.shipID}: ${moveResult.errorMsg}`,
      );
    }

    moved.push({
      itemID: entry.item.itemID,
      itemName: entry.item.itemName || "Item",
      error: entry.error,
      destination: audit.destination.label,
    });
  }

  return moved;
}

function main() {
  const shouldApply = process.argv.includes("--apply");
  const allItems = Object.values(getAllItems());
  const ships = allItems
    .filter((item) => item && toInt(item.categoryID, 0) === 6)
    .sort(sortByFlagThenId);

  const audits = ships
    .map((shipItem) => auditShipFit(shipItem, allItems))
    .filter(Boolean);

  if (audits.length === 0) {
    console.log("No invalid fitted ships found.");
    return;
  }

  const summary = audits.map((audit) => ({
    shipID: audit.shipID,
    shipName: audit.shipName,
    shipTypeID: audit.shipTypeID,
    shipTypeName: audit.shipTypeName,
    ownerID: audit.ownerID,
    destination: audit.destination.label,
    invalidItems: audit.invalidEntries.map((entry) => ({
      itemID: entry.item.itemID,
      itemName: entry.item.itemName || "Item",
      flagID: entry.item.flagID,
      error: entry.error,
    })),
  }));

  if (!shouldApply) {
    console.log(JSON.stringify({ invalidShipCount: audits.length, ships: summary }, null, 2));
    console.log("Run with --apply to move invalid fitted items off those ships.");
    return;
  }

  const applied = audits.map((audit) => ({
    shipID: audit.shipID,
    shipName: audit.shipName,
    moved: applyCleanup(audit),
  }));

  console.log(JSON.stringify({ cleanedShipCount: audits.length, ships: applied }, null, 2));
}

main();

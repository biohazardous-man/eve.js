const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  extractDictEntries,
  extractList,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildReprocessingOptionsForTypes,
  buildReprocessingQuotesForItems,
  getReprocessingYieldForType,
  getStationEfficiencyForTypeID,
  getStationTaxRate,
  reprocessItems,
  resolveReprocessingContext,
} = require(path.join(__dirname, "../mining/miningIndustry"));

function syncInventoryChangesToSession(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function buildRecoverableEntry(recoverable = {}) {
  return buildKeyVal([
    ["typeID", normalizeNumber(recoverable.typeID, 0)],
    ["client", normalizeNumber(recoverable.client, 0)],
    ["unrecoverable", normalizeNumber(recoverable.unrecoverable, 0)],
    ["iskCost", normalizeNumber(recoverable.iskCost, 0)],
  ]);
}

function buildQuoteEntry(quote = null) {
  if (!quote) {
    return buildKeyVal([]);
  }

  return buildKeyVal([
    ["itemID", normalizeNumber(quote.itemID, 0)],
    ["typeID", normalizeNumber(quote.typeID, 0)],
    ["quantityToProcess", normalizeNumber(quote.quantityToProcess, 0)],
    ["leftOvers", normalizeNumber(quote.leftOvers, 0)],
    ["portions", normalizeNumber(quote.portions, 0)],
    ["efficiency", normalizeNumber(quote.efficiency, 0)],
    ["recoverables", buildList(quote.recoverables.map((entry) => buildRecoverableEntry(entry)))],
    ["totalISKCost", normalizeNumber(quote.totalISKCost, 0)],
  ]);
}

function extractTypeIds(rawValue) {
  return extractDictEntries(rawValue)
    .map((entry) => normalizeNumber(entry[0], 0))
    .filter((value) => value > 0);
}

class ReprocessingService extends BaseService {
  constructor() {
    super("reprocessingSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[ReprocessingSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[ReprocessingSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetOptionsForItemTypes(args) {
    log.debug("[ReprocessingSvc] GetOptionsForItemTypes");
    const typeIds = extractTypeIds(args && args[0]);
    const optionsByTypeID = buildReprocessingOptionsForTypes(typeIds);
    return buildDict(
      [...optionsByTypeID.entries()].map(([typeID, options]) => [
        typeID,
        buildKeyVal([
          ["isRecyclable", options.isRecyclable === true],
          ["isRefinable", options.isRefinable === true],
        ]),
      ]),
    );
  }

  Handle_GetReprocessingInfo(args, session) {
    log.debug("[ReprocessingSvc] GetReprocessingInfo");
    const contextResult = resolveReprocessingContext(session);
    if (!contextResult.success || !contextResult.data) {
      return buildKeyVal([
        ["standing", 0.0],
        ["tax", 0.0],
        ["yield", 0.0],
        ["combinedyield", 0.0],
      ]);
    }

    const commonTypeID = 1230;
    const yieldValue = getReprocessingYieldForType(
      contextResult.data,
      commonTypeID,
    );
    return buildKeyVal([
      ["standing", 0.0],
      ["tax", getStationTaxRate(contextResult.data)],
      ["yield", getStationEfficiencyForTypeID(contextResult.data, commonTypeID)],
      ["combinedyield", yieldValue],
    ]);
  }

  Handle_GetQuote(args, session) {
    log.debug("[ReprocessingSvc] GetQuote");
    const itemID = normalizeNumber(args && args[0], 0);
    const quoteResult = buildReprocessingQuotesForItems(session, [itemID]);
    if (!quoteResult.success || !quoteResult.data) {
      return buildQuoteEntry(null);
    }
    return buildQuoteEntry(quoteResult.data.quotesByItemID.get(itemID) || null);
  }

  Handle_GetQuotes(args, session) {
    log.debug("[ReprocessingSvc] GetQuotes");
    const itemIds = extractList(args && args[0]).map((value) => normalizeNumber(value, 0));
    const quoteResult = buildReprocessingQuotesForItems(session, itemIds);
    if (!quoteResult.success || !quoteResult.data) {
      return [0.0, buildDict([]), buildDict([])];
    }

    const stationEfficiencyEntries = [];
    const seenTypeIDs = new Set();
    let fallbackStationEfficiency = 0;
    for (const quote of quoteResult.data.quotesByItemID.values()) {
      fallbackStationEfficiency = normalizeNumber(quote.stationEfficiency, fallbackStationEfficiency);
      if (seenTypeIDs.has(quote.typeID)) {
        continue;
      }
      seenTypeIDs.add(quote.typeID);
      stationEfficiencyEntries.push([quote.typeID, normalizeNumber(quote.stationEfficiency, 0)]);
    }

    return [
      getStationTaxRate(quoteResult.data.context),
      buildDict([
        [null, fallbackStationEfficiency],
        ...stationEfficiencyEntries,
      ]),
      buildDict(
        [...quoteResult.data.quotesByItemID.entries()].map(([itemID, quote]) => [
          itemID,
          buildQuoteEntry(quote),
        ]),
      ),
    ];
  }

  Handle_Reprocess(args, session) {
    log.debug("[ReprocessingSvc] Reprocess");
    const itemIDs = extractList(args && args[0]);
    const fromLocationID = normalizeNumber(args && args[1], 0);
    const ownerID = normalizeNumber(args && args[2], 0);
    const outputLocationID =
      args && args.length > 3 && args[3] !== null && args[3] !== undefined
        ? normalizeNumber(args[3], 0)
        : null;
    const outputFlagID =
      args && args.length > 4 && args[4] !== null && args[4] !== undefined
        ? normalizeNumber(args[4], 0)
        : null;

    const reprocessResult = reprocessItems(session, {
      itemIDs,
      fromLocationID,
      ownerID,
      outputLocationID,
      outputFlagID,
    });
    if (!reprocessResult.success || !reprocessResult.data) {
      return [buildList([]), buildDict([])];
    }

    syncInventoryChangesToSession(session, reprocessResult.data.inputChanges);
    syncInventoryChangesToSession(session, reprocessResult.data.outputChanges);
    return [
      buildList(reprocessResult.data.processedItemIDs),
      buildDict(
        Object.entries(reprocessResult.data.outputByTypeID || {}).map(([typeID, quantity]) => [
          normalizeNumber(typeID, 0),
          normalizeNumber(quantity, 0),
        ]),
      ),
    ];
  }
}

module.exports = ReprocessingService;

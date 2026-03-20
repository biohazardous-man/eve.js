/**
 * Inventory Broker Service (invbroker)
 *
 * Handles inventory/item queries from the client.
 * Called after character selection to load inventory data.
 */

const fs = require("fs");
const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));
const {
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  flushDeferredDockedFittingReplay,
  syncInventoryItemForSession,
  syncShipFittingStateForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  listContainerItems,
  findItemById,
  findShipItemById,
  getItemMetadata,
  moveItemToLocation,
  mergeItemStacks,
} = require(path.join(__dirname, "./itemStore"));
const {
  isShipFittingFlag,
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
  calculateShipDerivedAttributes,
  getShipBaseAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const runtime = require(path.join(__dirname, "../../space/runtime"));
const {
  DEFAULT_STATION,
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  getCharacterSkills,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  requestPostHudChargeRefresh,
  requestPendingShipChargeDogmaReplayFromHud,
  tryFlushPendingShipFittingReplay,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));

const inventoryDebugPath = path.join(
  __dirname,
  "../../../logs/inventory-debug.log",
);
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const STATION_TYPE_ID = DEFAULT_STATION.stationTypeID;
const STATION_GROUP_ID = 15;
const STATION_CATEGORY_ID = 3;
const STATION_OWNER_ID = DEFAULT_STATION.ownerID;
const INVENTORY_ROW_HEADER = {
  type: "list",
  items: [
    "itemID",
    "typeID",
    "ownerID",
    "locationID",
    "flagID",
    "quantity",
    "groupID",
    "categoryID",
    "customInfo",
    "singleton",
    "stacksize",
  ],
};
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 3],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];
const SHIP_BAY_FLAGS = new Set([
  ITEM_FLAGS.HANGAR,
  ITEM_FLAGS.CARGO_HOLD,
  ITEM_FLAGS.DRONE_BAY,
  ITEM_FLAGS.SHIP_HANGAR,
]);

function appendInventoryDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(inventoryDebugPath), { recursive: true });
    fs.appendFileSync(
      inventoryDebugPath,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[InvBroker] Failed to write inventory debug log: ${error.message}`);
  }
}

class InvBrokerService extends BaseService {
  constructor() {
    super("invbroker");
    this._boundContexts = new Map();
  }

  _getStationId(session) {
    return (session && (session.stationid || session.stationID)) || 0;
  }

  _getCharacterId(session) {
    return (
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001
    );
  }

  _getShipId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    return (
      (activeShip && activeShip.shipID) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _getShipTypeId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    const shipTypeID = activeShip ? activeShip.shipTypeID : (
      session && Number.isInteger(session.shipTypeID) ? session.shipTypeID : null
    );
    return shipTypeID && shipTypeID > 0 ? shipTypeID : 606;
  }

  _getStoredShips(session) {
    const charId = this._getCharacterId(session);
    return getCharacterShips(charId);
  }

  _describeValue(value, depth = 0) {
    if (depth > 4) {
      return "<max-depth>";
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return `<Buffer:${value.toString("utf8")}>`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this._describeValue(entry, depth + 1));
    }

    if (typeof value === "object") {
      const summary = {};
      for (const [key, entryValue] of Object.entries(value)) {
        summary[key] = this._describeValue(entryValue, depth + 1);
      }
      return summary;
    }

    return String(value);
  }

  _traceInventory(method, session, payload = {}) {
    const entry = {
      method,
      charId: this._getCharacterId(session),
      stationId: this._getStationId(session),
      activeShipId: this._getShipId(session),
      boundContext: this._getBoundContext(session),
      ...payload,
    };
    appendInventoryDebug(JSON.stringify(this._describeValue(entry)));
  }

  _rememberBoundContext(oidString, context) {
    if (!oidString) {
      return;
    }

    this._boundContexts.set(oidString, {
      inventoryID: context.inventoryID ?? null,
      locationID: context.locationID ?? null,
      flagID: context.flagID ?? null,
      kind: context.kind || "inventory",
    });
  }

  _getBoundContext(session) {
    if (!session || !session.currentBoundObjectID) {
      return null;
    }

    return this._boundContexts.get(session.currentBoundObjectID) || null;
  }

  _hasLoginInventoryBootstrapPending(session) {
    if (!session) {
      return false;
    }

    return (
      session._loginInventoryBootstrapPending === true ||
      (session._space &&
        session._space.loginInventoryBootstrapPending === true)
    );
  }

  _clearLoginInventoryBootstrapPending(session) {
    if (!session) {
      return;
    }

    session._loginInventoryBootstrapPending = false;
    if (session._space) {
      session._space.loginInventoryBootstrapPending = false;
    }
  }

  _isActiveInSpaceShipInventory(session, boundContext) {
    if (
      !session ||
      !boundContext ||
      boundContext.kind !== "shipInventory" ||
      session.stationid ||
      session.stationID
    ) {
      return false;
    }

    const activeShipID = this._normalizeInventoryId(
      (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        this._getShipId(session),
      0,
    );
    const boundInventoryID = this._normalizeInventoryId(
      boundContext.inventoryID,
      0,
    );

    return activeShipID > 0 && boundInventoryID === activeShipID;
  }

  _shouldPrimeLoginShipInventoryReplay(session, boundContext, options = {}) {
    if (
      !this._isActiveInSpaceShipInventory(session, boundContext) ||
      !session ||
      !session._space ||
      options.initialLoginSpaceShipInventoryList === true
    ) {
      return false;
    }

    const hasPendingFittingReplay = Boolean(session._pendingCommandShipFittingReplay);
    const hasPendingChargeDogmaReplay =
      session._space.loginChargeDogmaReplayPending === true;
    if (!hasPendingFittingReplay && !hasPendingChargeDogmaReplay) {
      return false;
    }

    const requestedFlags = Array.isArray(options.requestedFlags)
      ? options.requestedFlags
      : null;
    if (requestedFlags) {
      const normalizedFlags = requestedFlags
        .map((flagID) => this._normalizeInventoryId(flagID, 0))
        .filter((flagID) => flagID > 0);
      if (normalizedFlags.length === 0) {
        return false;
      }

      return normalizedFlags.some((flagID) => flagID !== ITEM_FLAGS.CARGO_HOLD);
    }

    if (
      options.requestedFlag === null ||
      options.requestedFlag === undefined
    ) {
      return true;
    }

    return (
      this._normalizeInventoryId(options.requestedFlag, 0) !==
      ITEM_FLAGS.CARGO_HOLD
    );
  }

  _primePendingSpaceShipInventoryReplay(session) {
    if (!session || !session._space) {
      return;
    }

    session._space.loginShipInventoryPrimed = true;
    const fittingReplayFlushed =
      tryFlushPendingShipFittingReplay(session) === true;
    if (
      !fittingReplayFlushed &&
      session._space.loginChargeDogmaReplayHudBootstrapSeen === true
    ) {
      requestPendingShipChargeDogmaReplayFromHud(session);
    }
  }

  _shouldFlushInventoryDrivenChargeReplay(
    _session,
    _boundContext,
    _requestedFlag,
    _options = {},
  ) {
    // Fresh in-space login now follows the same late HUD refresh contract as the
    // working solar-jump rack path. Inventory-driven flushes were too early and
    // could miss or get stomped by later ModuleButton rebuilds.
    return false;
  }

  _isInitialLoginSpaceShipInventoryList(session, boundContext) {
    if (
      !session ||
      !this._hasLoginInventoryBootstrapPending(session) ||
      !boundContext ||
      boundContext.kind !== "shipInventory" ||
      session.stationid ||
      session.stationID
    ) {
      return false;
    }

    const activeShipID = this._normalizeInventoryId(
      (session._space && session._space.shipID) ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        this._getShipId(session),
      0,
    );
    const boundInventoryID = this._normalizeInventoryId(
      boundContext.inventoryID,
      0,
    );

    return activeShipID > 0 && boundInventoryID === activeShipID;
  }

  _makeBoundSubstruct(context) {
    const config = require(path.join(__dirname, "../../config"));
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    this._rememberBoundContext(idString, context);

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  _getShipMetadata(session, shipTypeID = null, shipName = null) {
    const resolvedShipTypeID = shipTypeID || this._getShipTypeId(session);
    return (
      resolveShipByTypeID(resolvedShipTypeID) || {
        typeID: resolvedShipTypeID,
        name: shipName || (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }

  _extractKwarg(kwargs, key) {
    if (!kwargs || typeof kwargs !== "object") return undefined;

    if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
      return kwargs[key];
    }

    if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
      for (const [k, v] of kwargs.entries) {
        const dictKey = Buffer.isBuffer(k) ? k.toString("utf8") : k;
        if (dictKey === key) {
          return v;
        }
      }
    }

    return undefined;
  }

  _normalizeInventoryId(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
  }

  _normalizeFlagList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    return [];
  }

  _normalizeItemIdList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite)
        .filter((entry) => entry > 0);
    }

    const numericValue = this._normalizeInventoryId(value, 0);
    return numericValue > 0 ? [numericValue] : [];
  }

  _normalizeMergeOps(value) {
    const rawOps =
      Array.isArray(value)
        ? value
        : value && value.type === "list" && Array.isArray(value.items)
          ? value.items
          : [];

    return rawOps
      .map((entry) => {
        const tuple = Array.isArray(entry)
          ? entry
          : entry && entry.type === "tuple" && Array.isArray(entry.items)
            ? entry.items
            : [];
        if (tuple.length < 2) {
          return null;
        }

        const sourceItemID = this._normalizeInventoryId(tuple[0], 0);
        const destinationItemID = this._normalizeInventoryId(tuple[1], 0);
        const quantity = this._normalizeQuantityArg(tuple[2]);
        if (sourceItemID <= 0 || destinationItemID <= 0) {
          return null;
        }

        return {
          sourceItemID,
          destinationItemID,
          quantity,
        };
      })
      .filter(Boolean);
  }

  _normalizeQuantityArg(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const normalizedValue = Math.trunc(numericValue);
    return normalizedValue > 0 ? normalizedValue : null;
  }

  _resolveMoveQuantity(item, destination, requestedQuantity = null) {
    if (requestedQuantity !== null && requestedQuantity !== undefined) {
      return requestedQuantity;
    }

    // CCP's "Fit to Active Ship" path sends Add/MultiAdd with flagAutoFit and
    // no explicit qty. For a stackable source item, fitting should split off a
    // single unit into the ship slot and leave the remainder of the stack in
    // the source container.
    if (
      item &&
      Number(item.singleton) !== 1 &&
      destination &&
      isShipFittingFlag(destination.flagID)
    ) {
      return 1;
    }

    return requestedQuantity;
  }

  _destinationUsesCapacity(boundContext, destination) {
    if (!boundContext || !destination) {
      return false;
    }

    if (
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(destination.flagID)
    ) {
      return false;
    }

    return (
      boundContext.kind === "shipInventory" ||
      boundContext.kind === "container"
    );
  }

  _getMoveCapacityError(boundContext, destination, item) {
    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      Number(destination && destination.flagID) === ITEM_FLAGS.DRONE_BAY
    ) {
      return "NotEnoughDroneBaySpace";
    }

    if (
      boundContext &&
      boundContext.kind === "shipInventory" &&
      isShipFittingFlag(Number(destination && destination.flagID)) &&
      Number(item && item.categoryID) === 8
    ) {
      return "NotEnoughChargeSpace";
    }

    if (boundContext && boundContext.kind === "container") {
      return "NoSpaceForThat";
    }

    return "NotEnoughCargoSpace";
  }

  _getItemMoveVolume(item, quantity) {
    const numericQuantity = Math.max(1, Number(quantity) || 0);
    const metadata = getItemMetadata(item && item.typeID) || null;
    const unitVolume = Math.max(
      0,
      Number(item && item.volume) ||
      Number(metadata && metadata.volume) ||
      0,
    );
    return unitVolume * numericQuantity;
  }

  _checkCapacityForMove(
    session,
    boundContext,
    destination,
    item,
    requestedQuantity = null,
  ) {
    if (
      !item ||
      !boundContext ||
      !destination ||
      !this._destinationUsesCapacity(boundContext, destination)
    ) {
      return { success: true };
    }

    const currentLocationID = this._normalizeInventoryId(item.locationID, 0);
    const currentFlagID = this._normalizeInventoryId(item.flagID, 0);
    if (
      currentLocationID === this._normalizeInventoryId(destination.locationID, 0) &&
      currentFlagID === this._normalizeInventoryId(destination.flagID, 0)
    ) {
      return { success: true };
    }

    const availableQuantity =
      Number(item.singleton) === 1
        ? 1
        : Math.max(1, Number(item.stacksize ?? item.quantity ?? 1) || 1);
    const resolvedQuantity = this._resolveMoveQuantity(
      item,
      destination,
      requestedQuantity,
    );
    const moveQuantity =
      resolvedQuantity === null || resolvedQuantity === undefined
        ? availableQuantity
        : Math.max(1, Number(resolvedQuantity) || 1);
    const requiredVolume = this._getItemMoveVolume(item, moveQuantity);
    if (requiredVolume <= 0) {
      return { success: true };
    }

    const capacityInfo = this._calculateCapacity(
      session,
      boundContext,
      destination.flagID,
    );
    const capacity = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "capacity") || []
          )[1]
        : 0,
    ) || 0;
    const used = Number(
      capacityInfo &&
      capacityInfo.args &&
      capacityInfo.args.type === "dict" &&
      Array.isArray(capacityInfo.args.entries)
        ? (
            capacityInfo.args.entries.find(([key]) => key === "used") || []
          )[1]
        : 0,
    ) || 0;
    const free = Math.max(0, capacity - used);

    if (requiredVolume <= free + 1e-7) {
      return { success: true };
    }

    return {
      success: false,
      errorMsg: this._getMoveCapacityError(boundContext, destination, item),
      free,
      requiredVolume,
    };
  }

  _getShipInventoryRecord(session, boundContext) {
    const inventoryID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      0,
    );
    if (inventoryID <= 0) {
      return null;
    }

    const charId = this._getCharacterId(session);
    return (
      findCharacterShip(charId, inventoryID) ||
      findShipItemById(inventoryID) ||
      null
    );
  }

  _isAutoFitRequested(explicitFlagValue, explicitFlagProvided) {
    if (!explicitFlagProvided) {
      return false;
    }

    const numericFlag = this._normalizeInventoryId(explicitFlagValue, 0);
    if (isShipFittingFlag(numericFlag) || SHIP_BAY_FLAGS.has(numericFlag)) {
      return false;
    }

    return true;
  }

  _resolveDestinationForMove(
    session,
    boundContext,
    item,
    requestedFlag,
    explicitFlagProvided,
    fittedItemsOverride = null,
  ) {
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    if (!shipRecord) {
      return {
        locationID: this._normalizeInventoryId(
          boundContext && boundContext.inventoryID,
          this._getStationId(session),
        ),
        flagID: requestedFlag ?? ITEM_FLAGS.HANGAR,
      };
    }

    const charId = this._getCharacterId(session);
    const numericRequestedFlag =
      requestedFlag === undefined || requestedFlag === null
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const currentFittedItems =
      Array.isArray(fittedItemsOverride) && fittedItemsOverride.length >= 0
        ? fittedItemsOverride
        : listFittedItems(charId, shipRecord.itemID);

    if (numericRequestedFlag !== null && isShipFittingFlag(numericRequestedFlag)) {
      return {
        locationID: shipRecord.itemID,
        flagID: numericRequestedFlag,
      };
    }

    if (this._isAutoFitRequested(requestedFlag, explicitFlagProvided)) {
      const autoFitFlag = selectAutoFitFlagForType(
        shipRecord,
        currentFittedItems,
        item && item.typeID,
      );
      if (autoFitFlag) {
        return {
          locationID: shipRecord.itemID,
          flagID: autoFitFlag,
        };
      }

      return null;
    }

    return {
      locationID: shipRecord.itemID,
      flagID:
        numericRequestedFlag ??
        this._normalizeInventoryId(
          boundContext && boundContext.flagID,
          ITEM_FLAGS.CARGO_HOLD,
        ),
    };
  }

  _emitInventoryMoveChanges(session, changes = []) {
    const normalizedChanges = Array.isArray(changes) ? changes : [];

    for (const change of normalizedChanges) {
      if (!change || !change.item) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }

    this._refreshDockedFittingState(session, normalizedChanges);
  }

  _refreshDockedFittingState(session, changes = []) {
    if (
      !session ||
      !(session.stationid || session.stationID) ||
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session.activeShipID || session.shipID || session.shipid,
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = changes.some((change) => {
      if (!change || !change.item) {
        return false;
      }

      const previousState = change.previousData || change.previousState || {};
      const previousLocationID = this._normalizeInventoryId(
        previousState.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        previousState.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    });

    if (!touchesFittingState) {
      return;
    }

    syncShipFittingStateForSession(session, activeShipID, {
      includeOfflineModules: true,
      includeCharges: true,
      emitChargeInventoryRows: false,
    });
  }

  _refreshBallparkShipPresentation(session, changes = []) {
    if (!session || !session._space) {
      return;
    }

    const activeShipID = this._normalizeInventoryId(
      session._space.shipID || this._getShipId(session),
      0,
    );
    if (activeShipID <= 0) {
      return;
    }

    const touchesFittingState = (change) => {
      if (!change) {
        return false;
      }

      const previousLocationID = this._normalizeInventoryId(
        change.previousData && change.previousData.locationID,
        0,
      );
      const previousFlagID = this._normalizeInventoryId(
        change.previousData && change.previousData.flagID,
        0,
      );
      const nextLocationID = this._normalizeInventoryId(
        change.item && change.item.locationID,
        0,
      );
      const nextFlagID = this._normalizeInventoryId(
        change.item && change.item.flagID,
        0,
      );

      if (
        previousLocationID !== activeShipID &&
        nextLocationID !== activeShipID
      ) {
        return false;
      }

      return (
        isShipFittingFlag(previousFlagID) ||
        isShipFittingFlag(nextFlagID)
      );
    };

    if (!changes.some((change) => touchesFittingState(change))) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    runtime.refreshShipDerivedState(session, {
      broadcast: true,
    });

    const shipEntity = scene.getEntityByID(activeShipID);
    if (!shipEntity) {
      return;
    }

    scene.broadcastSlimItemChanges([shipEntity]);
  }

  _refreshBallparkInventoryPresentation(session, changes = []) {
    if (!session || !session._space || !Array.isArray(changes) || changes.length === 0) {
      return;
    }

    const scene = runtime.getSceneForSession(session);
    if (!scene) {
      return;
    }

    const affectedEntityIDs = new Set();
    const collectEntityID = (value) => {
      const numericID = this._normalizeInventoryId(value, 0);
      if (numericID <= 0) {
        return;
      }
      const entity = scene.getEntityByID(numericID);
      if (entity && (entity.kind === "container" || entity.kind === "wreck")) {
        affectedEntityIDs.add(numericID);
      }
    };

    for (const change of changes) {
      if (!change) {
        continue;
      }
      collectEntityID(change.item && change.item.itemID);
      collectEntityID(change.item && change.item.locationID);
      collectEntityID(change.previousData && change.previousData.locationID);
    }

    for (const entityID of affectedEntityIDs) {
      runtime.refreshInventoryBackedEntityPresentation(
        session._space.systemID,
        entityID,
        { broadcast: true },
      );
    }
  }

  _validateFittingMove(session, shipRecord, item, destination, fittedItemsSnapshot = null) {
    if (
      !shipRecord ||
      !item ||
      !destination ||
      destination.locationID !== shipRecord.itemID ||
      !isShipFittingFlag(destination.flagID)
    ) {
      return { success: true };
    }

    return validateFitForShip(
      this._getCharacterId(session),
      shipRecord,
      item,
      destination.flagID,
      fittedItemsSnapshot,
    );
  }

  _resolveMovedItemID(moveResult, originalItemID, destination) {
    const destinationLocationID = this._normalizeInventoryId(
      destination && destination.locationID,
      0,
    );
    const destinationFlagID = this._normalizeInventoryId(
      destination && destination.flagID,
      0,
    );

    for (const change of (moveResult && moveResult.data && moveResult.data.changes) || []) {
      if (
        !change ||
        !change.item ||
        Number(change.item.itemID) === Number(originalItemID)
      ) {
        continue;
      }

      if (
        this._normalizeInventoryId(change.item.locationID, 0) === destinationLocationID &&
        this._normalizeInventoryId(change.item.flagID, 0) === destinationFlagID
      ) {
        return Number(change.item.itemID) || null;
      }
    }

    return null;
  }

  _buildCharacterItemOverrides(session) {
    const charId = this._getCharacterId(session);
    return {
      itemID: charId,
      typeID: CHARACTER_TYPE_ID,
      ownerID: charId,
      locationID: this._getShipId(session) || this._getStationId(session),
      flagID: 0,
      quantity: -1,
      groupID: CHARACTER_GROUP_ID,
      categoryID: CHARACTER_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _findCharacterSkillRecord(session, itemID) {
    const charId = this._getCharacterId(session);
    const numericItemId = this._normalizeInventoryId(itemID, 0);
    if (numericItemId <= 0) {
      return null;
    }

    return (
      getCharacterSkills(charId).find((skill) => skill.itemID === numericItemId) ||
      null
    );
  }

  _buildSkillItemOverrides(skillRecord) {
    if (!skillRecord) {
      return null;
    }

    return {
      itemID: skillRecord.itemID,
      typeID: skillRecord.typeID,
      ownerID: skillRecord.ownerID,
      locationID: skillRecord.locationID,
      flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
      quantity: 1,
      groupID: skillRecord.groupID,
      categoryID: skillRecord.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildInventoryItemOverrides(session, itemRecord) {
    if (!itemRecord || typeof itemRecord !== "object") {
      return null;
    }

    if (Number(itemRecord.categoryID) === 16) {
      return this._buildSkillItemOverrides(itemRecord);
    }

    const itemID = this._normalizeInventoryId(
      itemRecord.itemID ?? itemRecord.shipID,
      0,
    );
    const typeID = this._normalizeInventoryId(
      itemRecord.typeID ?? itemRecord.shipTypeID,
      0,
    );
    if (itemID <= 0 || typeID <= 0) {
      return null;
    }

    const singleton =
      itemRecord.singleton === null || itemRecord.singleton === undefined
        ? Number(itemRecord.categoryID) === 6
          ? 1
          : 0
        : itemRecord.singleton;
    const quantity =
      itemRecord.quantity === null || itemRecord.quantity === undefined
        ? Number(singleton) === 1
          ? -1
          : 1
        : itemRecord.quantity;
    const stacksize =
      itemRecord.stacksize === null || itemRecord.stacksize === undefined
        ? Number(singleton) === 1
          ? 1
          : quantity
        : itemRecord.stacksize;

    return {
      itemID,
      typeID,
      shipName: itemRecord.shipName || itemRecord.itemName || null,
      ownerID: this._normalizeInventoryId(
        itemRecord.ownerID,
        this._getCharacterId(session),
      ),
      locationID: this._normalizeInventoryId(
        itemRecord.locationID,
        this._getStationId(session),
      ),
      flagID: this._normalizeInventoryId(itemRecord.flagID, 0),
      quantity,
      groupID: this._normalizeInventoryId(itemRecord.groupID, 0),
      categoryID: this._normalizeInventoryId(itemRecord.categoryID, 0),
      customInfo: itemRecord.customInfo || "",
      singleton,
      stacksize,
    };
  }

  _buildStationItemOverrides(session, overrideStationID = null) {
    const station = getStationRecord(session, overrideStationID);
    const stationID = this._normalizeInventoryId(station.stationID, this._getStationId(session));
    return {
      itemID: stationID,
      typeID: this._normalizeInventoryId(station.stationTypeID, STATION_TYPE_ID),
      ownerID: this._normalizeInventoryId(
        station.ownerID || station.corporationID,
        STATION_OWNER_ID,
      ),
      locationID: stationID,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _getCharacterContainerItems(session, requestedFlag = null) {
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);

    return getCharacterSkills(this._getCharacterId(session)).filter((skill) => {
      if (numericFlag === null || numericFlag === 0) {
        return true;
      }

      return this._normalizeInventoryId(skill.flagID, 0) === numericFlag;
    });
  }

  _buildContainerItemOverrides(session, inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const shipRecord =
      findCharacterShip(charId, numericInventoryID) ||
      findShipItemById(numericInventoryID);
    const genericItemRecord =
      shipRecord || findItemById(numericInventoryID);

    if (genericItemRecord) {
      return this._buildInventoryItemOverrides(session, genericItemRecord);
    }

    if (numericInventoryID === charId) {
      return this._buildCharacterItemOverrides(session);
    }

    if (numericInventoryID === stationId || numericInventoryID === 0) {
      return this._buildStationItemOverrides(session, stationId);
    }

    const stationItem = this._buildStationItemOverrides(session, stationId);
    return {
      itemID: numericInventoryID,
      typeID: stationItem.typeID,
      ownerID: this._getCharacterId(session),
      locationID: stationId,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _resolveContainerItems(session, requestedFlag, boundContext) {
    const stationId = this._getStationId(session);
    const charId = this._getCharacterId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const containerID = boundContext && Number(boundContext.inventoryID)
      ? Number(boundContext.inventoryID)
      : stationId;

    if (containerID === charId) {
      return this._getCharacterContainerItems(session, numericFlag);
    }

    if (containerID === stationId) {
      return listContainerItems(
        charId,
        stationId,
        numericFlag === null || numericFlag === 0
          ? ITEM_FLAGS.HANGAR
          : numericFlag,
      );
    }

    const genericContainerRecord = findItemById(containerID);
    if (genericContainerRecord && !findShipItemById(containerID)) {
      return listContainerItems(
        null,
        containerID,
        numericFlag,
      );
    }

    return listContainerItems(
      this._getCharacterId(session),
      containerID,
      numericFlag,
    );
  }

  _buildCapacityInfo(capacity, used) {
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["capacity", Number(capacity)],
          ["used", Number(used)],
        ],
      },
    };
  }

  _buildInventoryRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INVENTORY_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }

  _calculateCapacity(session, boundContext, requestedFlag = null) {
    const items = this._resolveContainerItems(session, requestedFlag, boundContext);
    const used = items.reduce((sum, item) => {
      if (!item) {
        return sum;
      }
      const units =
        Number(item.singleton) === 1
          ? 1
          : Math.max(0, Number(item.stacksize ?? item.quantity ?? 0) || 0);
      const volume = Math.max(0, Number(item.volume) || 0);
      return sum + (volume * units);
    }, 0);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? Number(boundContext.flagID)
          : null
        : Number(requestedFlag);

    let capacity = 1000000.0;
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    if (shipRecord) {
      if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
        const { resourceState } = calculateShipDerivedAttributes(
          this._getCharacterId(session),
          shipRecord,
        );
        capacity = Number(resourceState.cargoCapacity) || 0;
      } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "droneCapacity"),
        ) || 0;
      } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
        capacity = Number(
          getShipBaseAttributeValue(shipRecord.typeID, "shipMaintenanceBayCapacity"),
        ) || 0;
      }
    } else if (boundContext && boundContext.kind === "container") {
      const containerRecord = findItemById(
        this._normalizeInventoryId(boundContext.inventoryID, 0),
      );
      const containerMetadata = getItemMetadata(
        containerRecord && containerRecord.typeID,
        containerRecord && containerRecord.itemName,
      );
      capacity =
        Number(containerRecord && containerRecord.capacity) ||
        Number(containerMetadata && containerMetadata.capacity) ||
        capacity;
    } else if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
      capacity = 5000.0;
    } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
      capacity = 1000000.0;
    }

    return this._buildCapacityInfo(capacity, used);
  }

  _buildInvRow(session, overrides = {}) {
    const shipMetadata = this._getShipMetadata(
      session,
      overrides.typeID ?? null,
      overrides.shipName ?? null,
    );
    const itemID = overrides.itemID ?? this._getShipId(session);
    const typeID = overrides.typeID ?? shipMetadata.typeID;
    const ownerID = overrides.ownerID ?? this._getCharacterId(session);
    const locationID = overrides.locationID ?? this._getStationId(session);
    const flagID = overrides.flagID ?? 4; // station hangar
    const singleton = overrides.singleton ?? 1;
    const quantity = overrides.quantity ?? (singleton === 1 ? -1 : 1);
    const stacksize =
      overrides.stacksize ?? (singleton === 1 ? 1 : quantity);
    const groupID = overrides.groupID ?? shipMetadata.groupID;
    const categoryID = overrides.categoryID ?? shipMetadata.categoryID;
    const customInfo = overrides.customInfo ?? "";

    // Keep DBRowDescriptor-compatible order first, then convenience attrs.
    return [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      singleton,
      stacksize,
    ];
  }

  _buildInvItem(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const header = [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "singleton",
      "stacksize",
    ];

    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", header],
          ["line", row],
        ],
      },
    };
  }

  _itemOverridesFromId(session, itemID) {
    const id = Number.isInteger(itemID) ? itemID : Number(itemID);
    const charId = this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, id);
    if (skillRecord) {
      return this._buildSkillItemOverrides(skillRecord);
    }

    const shipRecord =
      findCharacterShip(charId, id) ||
      findShipItemById(id);
    if (shipRecord) {
      return {
        itemID: shipRecord.itemID,
        typeID: shipRecord.typeID,
        shipName: shipRecord.itemName,
        ownerID: shipRecord.ownerID,
        locationID: shipRecord.locationID,
        flagID: shipRecord.flagID,
        quantity: shipRecord.quantity,
        groupID: shipRecord.groupID,
        categoryID: shipRecord.categoryID,
        customInfo: shipRecord.customInfo || "",
        singleton: shipRecord.singleton,
        stacksize: shipRecord.stacksize,
      };
    }

    const genericItem = findItemById(id);
    if (genericItem) {
      return {
        itemID: genericItem.itemID,
        typeID: genericItem.typeID,
        ownerID: genericItem.ownerID,
        locationID: genericItem.locationID,
        flagID: genericItem.flagID,
        quantity: genericItem.quantity,
        groupID: genericItem.groupID,
        categoryID: genericItem.categoryID,
        customInfo: genericItem.customInfo || "",
        singleton: genericItem.singleton,
        stacksize: genericItem.stacksize,
      };
    }

    const shipID = this._getShipId(session);
    const shipMetadata = this._getShipMetadata(session);
    return {
      itemID: Number.isInteger(id) ? id : shipID,
      typeID: shipMetadata.typeID,
      ownerID: this._getCharacterId(session),
      locationID: this._getStationId(session),
      flagID: 4,
      quantity: -1,
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  Handle_GetInventory(args, session) {
    const containerID = args && args.length > 0 ? args[0] : null;
    const numericContainerID =
      containerID === null || containerID === undefined
        ? this._getStationId(session)
        : this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    const isStationHangar =
      numericContainerID === stationId ||
      numericContainerID === 10004 ||
      numericContainerID === ITEM_FLAGS.HANGAR;
    this._traceInventory("GetInventory", session, { args });
    log.debug("[InvBroker] GetInventory");
    return this._makeBoundSubstruct({
      inventoryID: isStationHangar ? stationId : numericContainerID,
      locationID: isStationHangar ? stationId : numericContainerID,
      flagID: isStationHangar ? ITEM_FLAGS.HANGAR : null,
      kind: isStationHangar ? "stationHangar" : "inventory",
    });
  }

  _buildInventoryRowset(lines) {
    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          ["header", INVENTORY_ROW_HEADER],
          ["RowClass", { type: "token", value: "util.Row" }],
          [
            "lines",
            {
              type: "list",
              items: lines,
            },
          ],
        ],
      },
    };
  }

  _buildInventoryRemoteList(itemOverrides = []) {
    return {
      type: "list",
      items: itemOverrides.map((overrides) =>
        this._buildInventoryPackedRow(overrides)),
    };
  }

  _buildInventoryPackedRow(overrides = {}) {
    return {
      type: "packedrow",
      header: this._buildInventoryRowDescriptor(),
      columns: INVENTORY_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        itemID: overrides.itemID,
        typeID: overrides.typeID,
        ownerID: overrides.ownerID,
        locationID: overrides.locationID,
        flagID: overrides.flagID,
        quantity: overrides.quantity,
        groupID: overrides.groupID,
        categoryID: overrides.categoryID,
        customInfo: overrides.customInfo || "",
        singleton: overrides.singleton,
        stacksize: overrides.stacksize,
      },
    };
  }

  _buildInvKeyVal(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      singleton,
      stacksize,
    ] = row;

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["typeID", typeID],
          ["ownerID", ownerID],
          ["locationID", locationID],
          ["flagID", flagID],
          ["quantity", quantity],
          ["groupID", groupID],
          ["categoryID", categoryID],
          ["customInfo", customInfo],
          ["singleton", singleton],
          ["stacksize", stacksize],
        ],
      },
    };
  }

  Handle_GetInventoryFromId(args, session, kwargs) {
    const itemid = args && args.length > 0 ? args[0] : 0;
    const numericItemId = this._normalizeInventoryId(itemid);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const boundContext = this._getBoundContext(session);
    const boundShip =
      findCharacterShip(charId, numericItemId) ||
      findShipItemById(numericItemId);
    const explicitLocationID =
      this._extractKwarg(kwargs, "locationID") ??
      (args && args.length > 2 ? args[2] : undefined);
    const normalizedExplicitLocationID =
      explicitLocationID === undefined || explicitLocationID === null
        ? 0
        : this._normalizeInventoryId(explicitLocationID);
    const inheritedLocationID =
      boundContext &&
      boundContext.locationID !== null &&
      boundContext.locationID !== undefined
        ? this._normalizeInventoryId(boundContext.locationID)
        : 0;
    const shipLocationID = boundShip
      ? this._normalizeInventoryId(boundShip.locationID)
      : 0;
    const resolvedLocationID =
      normalizedExplicitLocationID > 0
        ? normalizedExplicitLocationID
        : boundShip && inheritedLocationID > 0
          ? inheritedLocationID
          : shipLocationID > 0
            ? shipLocationID
            : numericItemId === stationId
              ? stationId
              : itemid;
    this._traceInventory("GetInventoryFromId", session, { args });
    log.debug(
      `[InvBroker] GetInventoryFromId(itemid=${itemid}, locationID=${resolvedLocationID})`,
    );
    return this._makeBoundSubstruct({
      inventoryID: itemid,
      locationID: resolvedLocationID,
      flagID:
        numericItemId === charId
          ? null
          :
        numericItemId === stationId
          ? ITEM_FLAGS.HANGAR
          : boundShip
            ? ITEM_FLAGS.CARGO_HOLD
            : null,
      kind:
        numericItemId === charId
          ? "characterInventory"
          :
        numericItemId === stationId
          ? "stationHangar"
          : boundShip
            ? "shipInventory"
            : "container",
    });
  }

  Handle_SetLabel(args, session) {
    this._traceInventory("SetLabel", session, { args });
    log.debug("[InvBroker] SetLabel");
    return null;
  }

  Handle_List(args, session, kwargs) {
    const argFlag = args && args.length > 0 ? args[0] : null;
    const kwFlag = this._extractKwarg(kwargs, "flag");
    const boundContext = this._getBoundContext(session);
    const hasArgFlag = Boolean(args && args.length > 0);
    const hasKwFlag = kwFlag !== undefined;
    const explicitFlagProvided = hasKwFlag || hasArgFlag;
    const explicitNullFlag =
      (hasKwFlag && kwFlag === null) ||
      (hasArgFlag && argFlag === null);
    const initialLoginSpaceShipInventoryList =
      this._isInitialLoginSpaceShipInventoryList(session, boundContext);
    if (initialLoginSpaceShipInventoryList) {
      this._clearLoginInventoryBootstrapPending(session);
      this._primePendingSpaceShipInventoryReplay(session);
    }
    if (initialLoginSpaceShipInventoryList && explicitNullFlag) {
      this._traceInventory("ListLoginBootstrapSuppressed", session, {
        args,
        kwargs,
        boundContext,
      });
      log.debug(
        `[InvBroker] Suppressing initial login-in-space ship List(flag=None) for ship=${boundContext && boundContext.inventoryID}`,
      );
      return this._buildInventoryRowset([]);
    }
    const inSpaceShipInventory =
      boundContext?.kind === "shipInventory" &&
      !this._getStationId(session);
    // Explicit List(flag=None) on a ship inventory is the parity-critical
    // "all ship contents" call used by fitting/dogma rebuild flows. Plain
    // no-arg List() is different: during direct login-in-space the client
    // binds ship inventory very early, and forcing fitted modules/charges into
    // that first default cargo refresh can trip ShipUI's first-pass charge
    // setup before the HUD finishes stabilizing. Keep the legacy docked
    // behavior for plain List(), but let in-space defaults fall back to the
    // bound cargo/drone flag unless the client explicitly asks for None.
    const requestedFlag =
      boundContext?.kind === "shipInventory" &&
      (
        explicitNullFlag ||
        (!explicitFlagProvided && !inSpaceShipInventory)
      )
        ? null
        : hasKwFlag
          ? kwFlag
          : hasArgFlag
            ? argFlag
            : boundContext?.flagID ?? null;
    this._traceInventory("List", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] List (inventory contents) flag=${requestedFlag} bound=${JSON.stringify(boundContext)}`,
    );

    const itemsForContainer = this._resolveContainerItems(
      session,
      requestedFlag,
      boundContext,
    );
    const itemOverrides = itemsForContainer
      .map((item) => this._buildInventoryItemOverrides(session, item))
      .filter(Boolean);

    log.debug(`[InvBroker] List ships=${itemOverrides.length}`);
    this._traceInventory("ListResult", session, {
      requestedFlag,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryReplay(session, boundContext, {
        initialLoginSpaceShipInventoryList,
        requestedFlag,
      })
    ) {
      this._primePendingSpaceShipInventoryReplay(session);
    }
    return result;
  }

  Handle_ListByFlags(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const rawFlags =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flags") ??
      [];
    const requestedFlags = this._normalizeFlagList(rawFlags);
    const seenItemIds = new Set();
    const itemOverrides = [];

    this._traceInventory("ListByFlags", session, {
      args,
      kwargs,
      requestedFlags,
    });
    log.debug(
      `[InvBroker] ListByFlags(flags=${requestedFlags.join(",")}) bound=${JSON.stringify(boundContext)}`,
    );

    for (const requestedFlag of requestedFlags) {
      const itemsForFlag = this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      );
      for (const item of itemsForFlag) {
        const itemID = item.itemID || item.shipID;
      if (seenItemIds.has(itemID)) {
        continue;
      }

      seenItemIds.add(itemID);
      const itemOverridesForRecord = this._buildInventoryItemOverrides(
        session,
        item,
      );
      if (itemOverridesForRecord) {
        itemOverrides.push(itemOverridesForRecord);
      }
    }
    }

    this._traceInventory("ListByFlagsResult", session, {
      requestedFlags,
      count: itemOverrides.length,
      firstLine: itemOverrides[0] || null,
    });
    const result = this._buildInventoryRemoteList(itemOverrides);
    if (
      this._shouldPrimeLoginShipInventoryReplay(session, boundContext, {
        requestedFlags,
      })
    ) {
      this._primePendingSpaceShipInventoryReplay(session);
    }
    return result;
  }

  Handle_GetItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const itemID =
      args && args.length > 0
        ? args[0]
        : boundContext && boundContext.inventoryID
          ? boundContext.inventoryID
          : this._getShipId(session);
    this._traceInventory("GetItem", session, {
      args,
      resolvedItemID: itemID,
    });
    log.debug(`[InvBroker] GetItem(itemID=${itemID})`);

    const numericItemID = this._normalizeInventoryId(itemID);
    const isCharacterItem = numericItemID === this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, numericItemID);
    const shipRecord = findCharacterShip(
      this._getCharacterId(session),
      numericItemID,
    );
    const overrides = isCharacterItem
      ? this._buildCharacterItemOverrides(session)
      : shipRecord || skillRecord
        ? this._itemOverridesFromId(session, numericItemID)
        : this._buildContainerItemOverrides(session, numericItemID);

    return this._buildInvItem(session, overrides);
  }

  Handle_GetItemByID(args, session) {
    return this.Handle_GetItem(args, session);
  }

  Handle_GetItems(args, session) {
    const ids = args && args.length > 0 && Array.isArray(args[0]) ? args[0] : [];
    this._traceInventory("GetItems", session, { args });
    log.debug(`[InvBroker] GetItems(count=${ids.length})`);

    const items = ids.map((id) =>
      this._buildInvItem(session, this._itemOverridesFromId(session, id)),
    );
    return { type: "list", items };
  }

  Handle_GetSelfInvItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const inventoryID =
      boundContext && boundContext.inventoryID !== null && boundContext.inventoryID !== undefined
        ? boundContext.inventoryID
        : this._getShipId(session);
    const overrides = this._buildContainerItemOverrides(session, inventoryID);
    this._traceInventory("GetSelfInvItem", session, { args });
    log.debug("[InvBroker] GetSelfInvItem");
    this._traceInventory("GetSelfInvItemResult", session, {
      inventoryID,
      overrides,
    });
    return this._buildInvKeyVal(session, overrides);
  }

  Handle_TrashItems(args, session) {
    this._traceInventory("TrashItems", session, { args });
    log.debug("[InvBroker] TrashItems");
    return null;
  }

  Handle_GetContainerContents(args, session) {
    const containerID =
      args && args.length > 0 ? args[0] : this._getStationId(session);
    const locationID = args && args.length > 1 ? args[1] : containerID;
    const numericContainerID = this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    this._traceInventory("GetContainerContents", session, { args });
    log.debug(
      `[InvBroker] GetContainerContents(containerID=${numericContainerID}, locationID=${locationID})`,
    );

    const items =
      numericContainerID === this._getCharacterId(session)
        ? this._getCharacterContainerItems(session, null)
        :
      numericContainerID === stationId
        ? listContainerItems(
            this._getCharacterId(session),
            stationId,
            ITEM_FLAGS.HANGAR,
          )
        : listContainerItems(
            this._getCharacterId(session),
            numericContainerID,
            null,
          );

    this._traceInventory("GetContainerContentsResult", session, {
      containerID: numericContainerID,
      count: items.length,
      firstItem: items[0] || null,
    });
    return this._buildInventoryRowset(
      items
        .map((item) => this._buildInventoryItemOverrides(session, item))
        .filter(Boolean)
        .map((overrides) => this._buildInvRow(session, overrides)),
    );
  }

  Handle_GetCapacity(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    this._traceInventory("GetCapacity", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] GetCapacity(flag=${String(requestedFlag)}) bound=${JSON.stringify(boundContext)}`,
    );
    return this._calculateCapacity(session, boundContext, requestedFlag);
  }

  Handle_StackAll(args, session, kwargs) {
    this._traceInventory("StackAll", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    const containerID = this._normalizeInventoryId(
      boundContext && boundContext.inventoryID,
      this._getStationId(session),
    );
    const flagID =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, ITEM_FLAGS.HANGAR)
          : ITEM_FLAGS.HANGAR
        : this._normalizeInventoryId(requestedFlag, ITEM_FLAGS.HANGAR);
    const items = listContainerItems(
      this._getCharacterId(session),
      containerID,
      flagID,
    )
      .filter((item) => item && Number(item.singleton) !== 1)
      .sort((left, right) => (Number(left.itemID) || 0) - (Number(right.itemID) || 0));
    const stacksByType = new Map();
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] StackAll container=${containerID} flag=${flagID} count=${items.length}`,
    );

    for (const item of items) {
      if (!stacksByType.has(item.typeID)) {
        stacksByType.set(item.typeID, item.itemID);
        continue;
      }

      const destinationItemID = stacksByType.get(item.typeID);
      const mergeResult = mergeItemStacks(item.itemID, destinationItemID);
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_MultiMerge(args, session, kwargs) {
    this._traceInventory("MultiMerge", session, { args, kwargs });
    const ops = this._normalizeMergeOps(args && args.length > 0 ? args[0] : []);
    const sourceContainerID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const allChanges = [];
    let mergedCount = 0;

    log.debug(
      `[InvBroker] MultiMerge opCount=${ops.length} sourceContainerID=${sourceContainerID}`,
    );

    for (const op of ops) {
      const sourceItem = findItemById(op.sourceItemID);
      const destinationItem = findItemById(op.destinationItemID);
      if (!sourceItem || !destinationItem) {
        continue;
      }

      const mergeResult = mergeItemStacks(
        op.sourceItemID,
        op.destinationItemID,
        op.quantity,
      );
      if (!mergeResult.success) {
        continue;
      }

      mergedCount += 1;
      allChanges.push(...((mergeResult.data && mergeResult.data.changes) || []));
    }

    if (mergedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return null;
  }

  Handle_Add(args, session, kwargs) {
    this._traceInventory("Add", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemID = this._normalizeInventoryId(args && args.length > 0 ? args[0] : 0, 0);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const item = findItemById(itemID);

    log.debug(
      `[InvBroker] Add itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || !item) {
      return null;
    }

    const destination = this._resolveDestinationForMove(
      session,
      boundContext,
      item,
      requestedFlag,
      explicitFlagProvided,
    );
    if (!destination) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} error=NO_SUITABLE_FIT_SLOT`,
      );
      throwWrappedUserError("ModuleFitFailed", {
        moduleName: Number(item.typeID) || 0,
        reason: "No suitable slot available",
      });
    }
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const fitValidation = this._validateFittingMove(
      session,
      shipRecord,
      item,
      destination,
      shipRecord ? listFittedItems(this._getCharacterId(session), shipRecord.itemID) : null,
    );
    if (!fitValidation.success) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${fitValidation.errorMsg}`,
      );
      return null;
    }
    const capacityCheck = this._checkCapacityForMove(
      session,
      boundContext,
      destination,
      item,
      quantity,
    );
    if (!capacityCheck.success) {
      log.warn(
        `[InvBroker] Add rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
      );
      throwWrappedUserError(capacityCheck.errorMsg, {
        type: Number(item.typeID) || 0,
        free: Number(capacityCheck.free.toFixed(6)),
        required: Number(capacityCheck.requiredVolume.toFixed(6)),
      });
    }
    const moveResult = moveItemToLocation(
      itemID,
      destination.locationID,
      destination.flagID,
      this._resolveMoveQuantity(item, destination, quantity),
    );
    if (!moveResult.success) {
      log.warn(
        `[InvBroker] Add failed itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${moveResult.errorMsg}`,
      );
      return null;
    }

    this._emitInventoryMoveChanges(session, moveResult.data.changes);
    this._refreshBallparkShipPresentation(session, moveResult.data.changes);
    this._refreshBallparkInventoryPresentation(session, moveResult.data.changes);
    return this._resolveMovedItemID(moveResult, itemID, destination);
  }

  Handle_MultiAdd(args, session, kwargs) {
    this._traceInventory("MultiAdd", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const itemIDs = this._normalizeItemIdList(args && args.length > 0 ? args[0] : []);
    const sourceLocationID = this._normalizeInventoryId(
      args && args.length > 1 ? args[1] : 0,
      0,
    );
    const explicitFlagValue = this._extractKwarg(kwargs, "flag");
    const explicitFlagProvided = explicitFlagValue !== undefined;
    const requestedFlag =
      explicitFlagProvided
        ? this._normalizeInventoryId(explicitFlagValue, 0)
        : boundContext && boundContext.flagID !== null && boundContext.flagID !== undefined
          ? this._normalizeInventoryId(boundContext.flagID, 0)
          : null;
    const quantity = this._normalizeQuantityArg(
      this._extractKwarg(kwargs, "qty") ?? this._extractKwarg(kwargs, "quantity"),
    );
    const shipRecord = this._getShipInventoryRecord(session, boundContext);
    const charId = this._getCharacterId(session);
    const fittedItemsSnapshot = shipRecord
      ? listFittedItems(charId, shipRecord.itemID).map((item) => ({ ...item }))
      : [];
    const allChanges = [];
    let movedCount = 0;

    log.debug(
      `[InvBroker] MultiAdd itemCount=${itemIDs.length} source=${sourceLocationID} requestedFlag=${String(requestedFlag)} bound=${JSON.stringify(boundContext)}`,
    );

    if (!boundContext || itemIDs.length === 0) {
      return null;
    }

    for (const itemID of itemIDs) {
      const item = findItemById(itemID);
      if (!item) {
        continue;
      }

      const destination = this._resolveDestinationForMove(
        session,
        boundContext,
        item,
        requestedFlag,
        explicitFlagProvided,
        fittedItemsSnapshot,
      );
      if (!destination) {
        continue;
      }
      const fitValidation = this._validateFittingMove(
        session,
        shipRecord,
        item,
        destination,
        fittedItemsSnapshot,
      );
      if (!fitValidation.success) {
        continue;
      }
      const capacityCheck = this._checkCapacityForMove(
        session,
        boundContext,
        destination,
        item,
        quantity,
      );
      if (!capacityCheck.success) {
        log.warn(
          `[InvBroker] MultiAdd rejected itemID=${itemID} destination=${destination.locationID}:${destination.flagID} error=${capacityCheck.errorMsg}`,
        );
        throwWrappedUserError(capacityCheck.errorMsg, {
          type: Number(item.typeID) || 0,
          free: Number(capacityCheck.free.toFixed(6)),
          required: Number(capacityCheck.requiredVolume.toFixed(6)),
        });
      }
      const moveResult = moveItemToLocation(
        itemID,
        destination.locationID,
        destination.flagID,
        this._resolveMoveQuantity(item, destination, quantity),
      );
      if (!moveResult.success) {
        continue;
      }

      movedCount += 1;
      allChanges.push(...(moveResult.data.changes || []));
      if (
        shipRecord &&
        destination.locationID === shipRecord.itemID &&
        isShipFittingFlag(destination.flagID)
      ) {
        const movedItemID =
          this._resolveMovedItemID(moveResult, itemID, destination) || itemID;
        const movedItem = findItemById(movedItemID) || item;
        fittedItemsSnapshot.push({
          itemID: movedItemID,
          typeID: movedItem.typeID,
          flagID: destination.flagID,
          locationID: shipRecord.itemID,
          categoryID: movedItem.categoryID,
          groupID: movedItem.groupID,
        });
      }
    }

    if (movedCount <= 0) {
      return null;
    }

    this._emitInventoryMoveChanges(session, allChanges);
    this._refreshBallparkShipPresentation(session, allChanges);
    this._refreshBallparkInventoryPresentation(session, allChanges);
    return true;
  }

  Handle_ListDroneBay(args, session, kwargs) {
    this._traceInventory("ListDroneBay", session, { args, kwargs });
    log.debug("[InvBroker] ListDroneBay");
    return this._buildInventoryRowset([]);
  }

  Handle_TakeOutTrash(args, session, kwargs) {
    this._traceInventory("TakeOutTrash", session, { args, kwargs });
    log.debug("[InvBroker] TakeOutTrash");
    return null;
  }

  Handle_AssembleCargoContainer(args, session, kwargs) {
    this._traceInventory("AssembleCargoContainer", session, { args, kwargs });
    log.debug("[InvBroker] AssembleCargoContainer");
    return null;
  }

  Handle_BreakPlasticWrap(args, session, kwargs) {
    this._traceInventory("BreakPlasticWrap", session, { args, kwargs });
    log.debug("[InvBroker] BreakPlasticWrap");
    return null;
  }

  Handle_DeliverToCorpHangar(args, session, kwargs) {
    this._traceInventory("DeliverToCorpHangar", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpHangar");
    return null;
  }

  Handle_DeliverToCorpMember(args, session, kwargs) {
    this._traceInventory("DeliverToCorpMember", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpMember");
    return null;
  }

  Handle_GetItemDescriptor(args, session) {
    this._traceInventory("GetItemDescriptor", session, { args });
    log.debug("[InvBroker] GetItemDescriptor");
    return this._buildInventoryRowDescriptor();
  }

  Handle_GetAvailableTurretSlots(args, session) {
    this._traceInventory("GetAvailableTurretSlots", session, { args });
    return [];
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    this._traceInventory("MachoResolveObject", session, { args, kwargs });
    log.debug("[InvBroker] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[InvBroker] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    this._traceInventory("MachoBindObject", session, {
      args,
      kwargs,
      bindParams,
      nestedCall,
    });

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    this._rememberBoundContext(idString, {
      inventoryID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      locationID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      flagID: null,
      kind: "boundInventory",
    });

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[InvBroker] MachoBindObject nested call: ${methodName}`);
      const previousBoundObjectID = session
        ? session.currentBoundObjectID
        : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  afterCallResponse(method, session) {
    if (!session) {
      return;
    }

    if (method === "GetAvailableTurretSlots") {
      requestPendingShipChargeDogmaReplayFromHud(session);
      requestPostHudChargeRefresh(session);
      return;
    }

    if (
      method === "GetInventoryFromId" ||
      method === "List" ||
      method === "GetSelfInvItem"
    ) {
      flushDeferredDockedFittingReplay(session, {
        trigger: `invbroker.${method}`,
      });
    }

    if (
      method !== "List" &&
      method !== "GetSelfInvItem"
    ) {
      return;
    }

    const boundContext = this._getBoundContext(session);
    if (!boundContext || boundContext.kind !== "stationHangar") {
      return;
    }

    if (!shouldFlushDeferredDockedShipSessionChange(session, method)) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: `invbroker.${method}`,
    });
  }
}

module.exports = InvBrokerService;

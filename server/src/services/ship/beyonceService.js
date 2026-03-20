const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  buildBoundObjectResponse,
  extractDictEntries,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const bookmarkStore = require(path.join(__dirname, "../character/bookmarkStore"));
const sharedBookmarkStore = require(path.join(__dirname, "../character/sharedBookmarkStore"));
const bookmarkNotifications = require(path.join(__dirname, "../character/bookmarkNotifications"));
const {
  jumpSessionViaStargate,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  flushPendingCommandSessionEffects,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const USER_ERROR_LOCALIZATION_LABEL = 101;
const STARGATE_CLOSED_LABEL = "UI/GateIcons/GateClosed";
const STARGATE_TOO_FAR_LABEL = "UI/Menusvc/MenuHints/NotWithingMaxJumpDist";
const CRIMEWATCH_WARP_BLOCKED_MESSAGE = "Warp is disabled while the criminal timer is active.";

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

/**
 * SHARED_BOOKMARK_DELAY — 2 minutes in milliseconds.
 * Bookmarks created by another character in a shared folder are hidden
 * for this duration.
 */
const SHARED_BOOKMARK_DELAY_MS = 2 * 60 * 1000;

/**
 * Convert a filetime string (100-ns intervals since 1601-01-01) to a JS
 * millisecond timestamp.
 */
function filetimeToMs(filetimeStr) {
  if (filetimeStr == null) return 0;
  try {
    const EVE_EPOCH_OFFSET_MS = 11644473600000n;
    return Number(BigInt(filetimeStr) / 10000n - EVE_EPOCH_OFFSET_MS);
  } catch (_) {
    return 0;
  }
}

/**
 * Check if a shared bookmark is still in the delay window.
 * Returns true if the bookmark was created by a different character
 * and is less than SHARED_BOOKMARK_DELAY_MS old.
 */
function isBookmarkDelayed(bookmark, charID) {
  if (!bookmark || !bookmark.creatorID) return false;
  if (Number(bookmark.creatorID) === Number(charID)) return false;

  const createdMs = filetimeToMs(bookmark.created);
  if (createdMs <= 0) return false;

  const ageMs = Date.now() - createdMs;
  return ageMs < SHARED_BOOKMARK_DELAY_MS;
}

/**
 * Resolve a bookmark by ID from either the personal or shared store.
 * Shared bookmarks created by other characters within the 2-minute
 * delay window are treated as non-existent (returns null).
 */
function resolveBookmarkAnyStore(session, bookmarkID) {
  const charID = session && session.characterID;
  // Try personal bookmarks first
  const personalBm = bookmarkStore.getBookmarkByID(charID, bookmarkID);
  if (personalBm) return personalBm;

  // Fall back to shared folders this character knows about
  const knownShared = bookmarkStore.getKnownSharedFolders(charID);
  for (const known of knownShared) {
    if (!known.isActive) continue;
    const bookmarks = sharedBookmarkStore.getBookmarksInFolder(known.folderID);
    const match = bookmarks.find((b) => Number(b.bookmarkID) === Number(bookmarkID));
    if (match) {
      // Enforce shared bookmark delay
      if (isBookmarkDelayed(match, charID)) {
        log.info(
          `[Beyonce] Bookmark ${bookmarkID} is still in shared delay window, denying access`,
        );
        return null;
      }
      return match;
    }
  }

  return null;
}

function resolveBookmarkAlignTarget(session, bookmarkID) {
  const normalizedBookmarkID = normalizeNumber(bookmarkID, 0);
  if (normalizedBookmarkID <= 0) {
    return 0;
  }

  const bookmark = resolveBookmarkAnyStore(session, normalizedBookmarkID);
  return normalizeNumber(bookmark && bookmark.itemID, 0);
}

class BeyonceService extends BaseService {
  constructor() {
    super("beyonce");
  }

  _throwStargateJumpUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "WRONG_SOLAR_SYSTEM":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "STARGATE_NOT_FOUND":
      case "STARGATE_DESTINATION_MISMATCH":
        throwWrappedUserError("TargetingAttemptCancelled");
        break;
      case "TOO_FAR_FROM_STARGATE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_TOO_FAR_LABEL],
        });
        break;
      case "STARGATE_NOT_ACTIVE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_CLOSED_LABEL],
        });
        break;
      case "STARGATE_JUMP_IN_PROGRESS":
        throwWrappedUserError("CustomInfo", {
          info: "Stargate jump already in progress.",
        });
        break;
      default:
        throwWrappedUserError("CustomInfo", {
          info: "The stargate jump could not be completed.",
        });
        break;
    }
  }

  Handle_GetFormations(args, session) {
    spaceRuntime.markBeyonceBound(session);
    // The client asks for formations as soon as the destination ballpark
    // exists, before the heavier MachoBindObject round-trip. Seeding the
    // early AddBalls2 visuals here removes the "empty system" gap on login/jump.
    // Cross-system jumps still defer SetState until MachoBindObject so Michelle
    // does not establish destination history before the scene swap completes.
    spaceRuntime.ensureInitialBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });

    return [
      [
        "Diamond",
        [
          [100.0, 0.0, 0.0],
          [0.0, 100.0, 0.0],
          [-100.0, 0.0, 0.0],
          [0.0, -100.0, 0.0],
        ],
      ],
      [
        "Arrow",
        [
          [100.0, 0.0, -50.0],
          [50.0, 0.0, 0.0],
          [-100.0, 0.0, -50.0],
          [-50.0, 0.0, 0.0],
        ],
      ],
    ];
  }

  Handle_UpdateStateRequest(args, session) {
    spaceRuntime.markBeyonceBound(session);
    // The client probes this repeatedly while already in space; forcing a
    // full AddBalls2/SetState replay causes scene-object churn and visible
    // respawn flicker.
    spaceRuntime.ensureInitialBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    return null;
  }

  Handle_CmdGotoDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z });
    return null;
  }

  Handle_CmdAlignTo(args, session, kwargs) {
    const positionalTargetID = normalizeNumber(args && args[0], 0);
    const kwargTargetID = normalizeNumber(getKwargValue(kwargs, "dstID"), 0);
    const bookmarkID = normalizeNumber(getKwargValue(kwargs, "bookmarkID"), 0);
    const targetID =
      positionalTargetID ||
      kwargTargetID ||
      resolveBookmarkAlignTarget(session, bookmarkID);
    log.info(
      `[Beyonce] CmdAlignTo char=${session && session.characterID} target=${targetID} bookmark=${bookmarkID}`,
    );

    if (targetID > 0) {
      spaceRuntime.alignTo(session, targetID);
    } else if (bookmarkID > 0) {
      // Coordinate bookmark — no scene entity to align to.
      // Compute direction from ship toward bookmark coordinates instead.
      const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
      if (bookmark) {
        const bx = Number(bookmark.x || 0);
        const by = Number(bookmark.y || 0);
        const bz = Number(bookmark.z || 0);
        if (bx !== 0 || by !== 0 || bz !== 0) {
          const scene = spaceRuntime.getSceneForSession(session);
          const ship = scene && scene.getShipEntityForSession(session);
          if (ship && ship.position) {
            const dx = bx - Number(ship.position.x || 0);
            const dy = by - Number(ship.position.y || 0);
            const dz = bz - Number(ship.position.z || 0);
            spaceRuntime.gotoDirection(session, { x: dx, y: dy, z: dz });
          }
        }
      }
    }

    return null;
  }

  Handle_CmdFollowBall(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdFollowBall char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    if (targetID > 0 && range <= 50) {
      const dockingDebug = spaceRuntime.getDockingDebugState(session, targetID);
      if (dockingDebug) {
        log.info(`[Beyonce] CmdFollowBall dockingState=${JSON.stringify(dockingDebug)}`);
      }
    }

    spaceRuntime.followBall(session, targetID, range);
    return null;
  }

  Handle_CmdOrbit(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdOrbit char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    spaceRuntime.orbit(session, targetID, range);
    return null;
  }

  Handle_CmdSetSpeedFraction(args, session) {
    const fraction = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdSetSpeedFraction char=${session && session.characterID} fraction=${fraction}`,
    );
    spaceRuntime.setSpeedFraction(session, fraction);
    return null;
  }

  Handle_CmdStop(args, session) {
    log.info(`[Beyonce] CmdStop char=${session && session.characterID}`);
    spaceRuntime.stop(session);
    return null;
  }

  // -----------------------------------------------------------------------
  // Bookmark creation (remote-park/beyonce path — in-space items)
  // -----------------------------------------------------------------------

  Handle_BookmarkLocation(args, session) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryConstant = normalizeNumber(args && args[4], 0);
    const subfolderID = args && args[5] != null ? normalizeNumber(args[5], null) : null;

    // Must be in space to use the beyonce (remote park) path.
    if (!session || !session._space) {
      log.warn(`[Beyonce] BookmarkLocation: char=${charID} is not in space`);
      return null;
    }

    const systemID = Number(
      (session._space && session._space.systemID) || session.solarsystemid || 0,
    );

    let x = 0;
    let y = 0;
    let z = 0;
    let resolvedItemID = null;
    let typeID = null;

    if (itemID > 0) {
      // Try to look up the entity in the current scene for its live position.
      const entity = spaceRuntime.getEntity(session, itemID);
      if (entity && entity.position) {
        x = Number(entity.position.x || 0);
        y = Number(entity.position.y || 0);
        z = Number(entity.position.z || 0);
        typeID = entity.typeID || null;

        // Only store itemID for static objects (stations, celestials, stargates)
        // whose positions the client can resolve via cfg.evelocations.
        // Non-static entities (ships, wrecks, NPCs) get coordinate-only bookmarks
        // because evelocations returns (0,0,0) for them, which would cause the
        // bookmark visual marker to appear at the sun.
        const isStatic =
          (itemID >= 60000000 && itemID < 65000000) || // stations
          (itemID >= 40000000 && itemID < 50000000) || // celestials
          (itemID >= 50000000 && itemID < 60000000);   // stargates
        if (isStatic) {
          resolvedItemID = itemID;
        }
      } else {
        log.warn(
          `[Beyonce] BookmarkLocation: entity ${itemID} not found in scene, using ship position`,
        );
      }
    }

    // Fallback / ship-position bookmark: use the ship's own position.
    if (x === 0 && y === 0 && z === 0) {
      const shipEntity =
        session._space && session._space.shipID
          ? spaceRuntime.getEntity(session, session._space.shipID)
          : null;
      if (shipEntity && shipEntity.position) {
        x = Number(shipEntity.position.x || 0);
        y = Number(shipEntity.position.y || 0);
        z = Number(shipEntity.position.z || 0);
        typeID = shipEntity.typeID || null;
      }
    }

    // For coordinate-only bookmarks (no static itemID), use typeSolarSystem (5)
    // so the client's BookmarkChecker.OfferWarpTo() recognizes this as a valid
    // warp target. The client falls back to locationID (a solar system) for the
    // itemID, and needs typeID to match.
    const TYPE_SOLAR_SYSTEM = 5;
    if (!resolvedItemID) {
      typeID = TYPE_SOLAR_SYSTEM;
    }

    const EXPIRY_MS = {
      1: 4 * 60 * 60 * 1000,
      2: 2 * 24 * 60 * 60 * 1000,
      3: 24 * 60 * 60 * 1000,
    };
    const expiryMs = EXPIRY_MS[Number(expiryConstant)] || null;
    const expiry = expiryMs != null ? Date.now() + expiryMs : null;

    log.info(
      `[Beyonce] BookmarkLocation char=${charID} item=${resolvedItemID} pos=(${x},${y},${z}) system=${systemID} folder=${folderID} name="${name}"`,
    );

    const bookmarkOpts = {
      folderID,
      itemID: resolvedItemID,
      typeID,
      locationID: systemID,
      x,
      y,
      z,
      memo: name,
      note: comment,
      expiry,
      subfolderID,
      creatorID: charID,
    };

    let result;
    if (sharedBookmarkStore.isSharedFolderID(folderID)) {
      result = sharedBookmarkStore.addBookmarkToSharedFolder(folderID, bookmarkOpts);
      if (result) {
        const bookmarks = sharedBookmarkStore.getBookmarksInFolder(folderID);
        const newBm = bookmarks.find((b) => Number(b.bookmarkID) === result[0]);
        if (newBm) {
          const update = bookmarkNotifications.buildBookmarksAddedUpdate(folderID, [newBm]);
          bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
        }
      }
    } else {
      result = bookmarkStore.addBookmark(charID, bookmarkOpts);
    }
    if (!result) return null;
    // Wrap expiryDate (index 7) as int64 for the client's datetime formatter.
    if (result[7] != null) {
      result[7] = { type: "long", value: BigInt(result[7]) };
    }
    return result;
  }

  Handle_CmdWarpToStuff(args, session, kwargs) {
    const warpType = String(args && args[0] ? args[0] : "");
    const rawTarget = args && args.length > 1 ? args[1] : null;
    const numericTarget = normalizeNumber(rawTarget, 0);
    const minimumRange = normalizeNumber(kwargs && kwargs.minRange, 0);

    log.info(
      `[Beyonce] CmdWarpToStuff char=${session && session.characterID} type=${warpType} target=${numericTarget || rawTarget} minRange=${minimumRange}`,
    );

    let result = null;

    // ---------------------------------------------------------------
    // Bookmark warp: client sends bookmarkID, not a scene entity ID.
    // Resolve the bookmark, then warp to itemID or {x,y,z} coords.
    // ---------------------------------------------------------------
    if (warpType === "bookmark" && numericTarget > 0) {
      const bookmark = resolveBookmarkAnyStore(session, numericTarget);
      if (bookmark) {
        const bmItemID = normalizeNumber(bookmark.itemID, 0);
        if (bmItemID > 0) {
          // Item bookmark — warp to the entity if it exists in the current scene.
          result = spaceRuntime.warpToEntity(session, bmItemID, { minimumRange });
          if (!result || !result.success) {
            // Entity may not be in the current scene (e.g. station in another
            // grid). Fall back to coordinate warp using stored position.
            const bx = Number(bookmark.x || 0);
            const by = Number(bookmark.y || 0);
            const bz = Number(bookmark.z || 0);
            if (bx !== 0 || by !== 0 || bz !== 0) {
              result = spaceRuntime.warpToPoint(session, { x: bx, y: by, z: bz }, { minimumRange });
            }
          }
        } else {
          // Coordinate-only bookmark — warp to {x,y,z}.
          const bx = Number(bookmark.x || 0);
          const by = Number(bookmark.y || 0);
          const bz = Number(bookmark.z || 0);
          result = spaceRuntime.warpToPoint(session, { x: bx, y: by, z: bz }, { minimumRange });
        }
      } else {
        log.warn(
          `[Beyonce] CmdWarpToStuff: bookmark ${numericTarget} not found for char=${charID}`,
        );
        result = { success: false, errorMsg: "BOOKMARK_NOT_FOUND" };
      }
    } else if (
      (warpType === "item" ||
        warpType === "scan" ||
        warpType === "launch" ||
        warpType === "char" ||
        !warpType) &&
      numericTarget > 0
    ) {
      result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
    } else if (
      rawTarget &&
      typeof rawTarget === "object" &&
      rawTarget.x !== undefined &&
      rawTarget.y !== undefined &&
      rawTarget.z !== undefined
    ) {
      result = spaceRuntime.warpToPoint(session, rawTarget, { minimumRange });
    } else {
      result = {
        success: false,
        errorMsg: "UNSUPPORTED_WARP_TARGET",
      };
    }

    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuff failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      if (result && result.errorMsg === "CRIMINAL_TIMER_ACTIVE") {
        throwWrappedUserError("CustomInfo", {
          info: CRIMEWATCH_WARP_BLOCKED_MESSAGE,
        });
      }
    }

    return null;
  }

  Handle_CmdGotoBookmark(args, session) {
    const bookmarkID = normalizeNumber(args && args[0], 0);
    const charID = session && session.characterID;

    log.info(
      `[Beyonce] CmdGotoBookmark char=${charID} bookmark=${bookmarkID}`,
    );

    if (bookmarkID <= 0) return null;

    const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
    if (!bookmark) {
      log.warn(`[Beyonce] CmdGotoBookmark bookmark ${bookmarkID} not found`);
      return null;
    }

    const scene = spaceRuntime.getSceneForSession(session);
    if (!scene) return null;

    // Determine the target position: either the entity or bookmark coordinates.
    let targetX, targetY, targetZ;
    const bmItemID = normalizeNumber(bookmark.itemID, 0);

    if (bmItemID > 0) {
      // Try to get entity position from the scene
      const entity = scene.getEntityByID(bmItemID);
      if (entity && entity.position) {
        targetX = Number(entity.position.x || 0);
        targetY = Number(entity.position.y || 0);
        targetZ = Number(entity.position.z || 0);
      }
    }

    // Fall back to stored bookmark coordinates
    if (targetX === undefined) {
      targetX = Number(bookmark.x || 0);
      targetY = Number(bookmark.y || 0);
      targetZ = Number(bookmark.z || 0);
    }

    if (targetX === 0 && targetY === 0 && targetZ === 0) {
      log.warn(`[Beyonce] CmdGotoBookmark no valid coordinates for bookmark ${bookmarkID}`);
      return null;
    }

    // Get ship position and compute a direction toward the bookmark
    const shipEntity = scene.getShipEntityForSession(session);
    if (!shipEntity || !shipEntity.position) {
      log.warn(`[Beyonce] CmdGotoBookmark ship entity not found`);
      return null;
    }

    const dx = targetX - Number(shipEntity.position.x || 0);
    const dy = targetY - Number(shipEntity.position.y || 0);
    const dz = targetZ - Number(shipEntity.position.z || 0);

    spaceRuntime.gotoDirection(session, { x: dx, y: dy, z: dz });
    return null;
  }

  Handle_CmdWarpToStuffAutopilot(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdWarpToStuffAutopilot char=${session && session.characterID} target=${targetID}`,
    );
    const result = spaceRuntime.warpToEntity(session, targetID, { minimumRange: 10000 });
    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuffAutopilot failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      if (result && result.errorMsg === "CRIMINAL_TIMER_ACTIVE") {
        throwWrappedUserError("CustomInfo", {
          info: CRIMEWATCH_WARP_BLOCKED_MESSAGE,
        });
      }
    }
    return null;
  }

  Handle_CmdDock(args, session) {
    const stationID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdDock char=${session && session.characterID} station=${stationID}`,
    );
    const dockingDebug = spaceRuntime.getDockingDebugState(session, stationID);
    if (dockingDebug) {
      log.info(`[Beyonce] CmdDock state=${JSON.stringify(dockingDebug)}`);
    }

    if (!spaceRuntime.canDockAtStation(session, stationID)) {
      log.info(
        `[Beyonce] CmdDock converting to docking approach for char=${session && session.characterID} station=${stationID}`,
      );
      const followed = spaceRuntime.followBall(session, stationID, 2500, {
        dockingTargetID: stationID,
      });
      if (!followed) {
        log.info(
          `[Beyonce] CmdDock keeping existing docking approach for char=${session && session.characterID} station=${stationID}`,
        );
      }
      throwWrappedUserError("DockingApproach");
    }

    const result = spaceRuntime.acceptDocking(session, stationID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdDock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.acceptedAtFileTime || null;
  }

  Handle_CmdStargateJump(args, session) {
    const fromStargateID = normalizeNumber(args && args[0], 0);
    const toStargateID = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdStargateJump char=${session && session.characterID} from=${fromStargateID} to=${toStargateID}`,
    );

    const result = jumpSessionViaStargate(session, fromStargateID, toStargateID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdStargateJump failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      this._throwStargateJumpUserError(result.errorMsg);
    }

    return result.data.boundResult || null;
  }

  Handle_MachoResolveObject(args, session) {
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    spaceRuntime.markBeyonceBound(session);
    const response = buildBoundObjectResponse(this, args, session, kwargs);
    // Space login is race-sensitive: if the bind reply reaches the client
    // before the first AddBalls2/SetState bootstrap, the inflight HUD can open
    // against an empty ego-ball state and only recover later via Michelle's
    // missing-module redraw path.
    spaceRuntime.ensureInitialBallpark(session);
    return response;
  }

  afterCallResponse(methodName, session) {
    if (methodName === "MachoBindObject") {
      flushPendingCommandSessionEffects(session);
      return;
    }

    if (methodName === "CmdStargateJump") {
      flushPendingCommandSessionEffects(session);
    }
  }
}

module.exports = BeyonceService;

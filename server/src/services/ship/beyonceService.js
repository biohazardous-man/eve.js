const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  buildBoundObjectResponse,
  extractDictEntries,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  jumpSessionViaStargate,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  flushPendingCommandSessionEffects,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const {
  getCynoJammerOnlineSimTime,
} = require(path.join(__dirname, "../sovereignty/sovSuppressionState"));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const USER_ERROR_LOCALIZATION_LABEL = 101;
const STARGATE_CLOSED_LABEL = "UI/GateIcons/GateClosed";
const STARGATE_TOO_FAR_LABEL = "UI/Menusvc/MenuHints/NotWithingMaxJumpDist";
const CRIMEWATCH_WARP_BLOCKED_MESSAGE = "Warp is disabled while the criminal timer is active.";

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

function resolveBookmarkAlignTarget(session, bookmarkID) {
  const normalizedBookmarkID = normalizeNumber(bookmarkID, 0);
  if (normalizedBookmarkID <= 0) {
    return 0;
  }

  const charRecord = getCharacterRecord(session && session.characterID) || {};
  const bookmarks = Array.isArray(charRecord.bookmarks) ? charRecord.bookmarks : [];
  const bookmark = bookmarks.find(
    (candidate) => normalizeNumber(candidate && candidate.bookmarkID, 0) === normalizedBookmarkID,
  );
  return normalizeNumber(bookmark && bookmark.itemID, 0);
}

function isDockedStructureObserverSession(session) {
  return Boolean(
    !session?._space &&
      Number(session && (session.structureID || session.structureid)) > 0 &&
      Number(session && (session.solarsystemid || session.solarsystemid2)) > 0,
  );
}

function bootstrapSessionBallpark(session, options = {}) {
  if (isDockedStructureObserverSession(session)) {
    return spaceRuntime.bootstrapDockedStructureView(session, options);
  }

  spaceRuntime.markBeyonceBound(session);
  return spaceRuntime.ensureInitialBallpark(session, options);
}

function prepareSessionBallpark(session) {
  if (
    isDockedStructureObserverSession(session)
  ) {
    return spaceRuntime.prepareDockedStructureView(session);
  }

  return bootstrapSessionBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
  });
}

function getSessionSolarSystemID(session) {
  return normalizeNumber(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
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
    // Docked structure exterior view is a view toggle, not a fresh space login.
    // The stock client may return to hangar without re-fetching hangar state,
    // so prepare a fresh exterior observer cache here and send the real
    // ballpark bootstrap only once Michelle completes MachoBindObject.
    prepareSessionBallpark(session);

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
    if (isDockedStructureObserverSession(session)) {
      bootstrapSessionBallpark(session, {
        allowDeferredJumpBootstrapVisuals: true,
      });
      return null;
    }

    spaceRuntime.markBeyonceBound(session);
    const scene = spaceRuntime.getSceneForSession(session);
    const egoEntity = scene && scene.getShipEntityForSession(session);
    if (
      scene &&
      egoEntity &&
      session &&
      session._space &&
      session._space.initialStateSent
    ) {
      scene.sendStateRefresh(session, egoEntity);
      return null;
    }

    bootstrapSessionBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    return null;
  }

  Handle_GetCynoJammerState(args, session) {
    return getCynoJammerOnlineSimTime(getSessionSolarSystemID(session));
  }

  Handle_CmdGotoDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdGotoDirection",
      ownerLocallyPredictsHeading: false,
    });
    return null;
  }

  Handle_CmdSteerDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdSteerDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdSteerDirection",
      ownerLocallyPredictsHeading: true,
    });
    return null;
  }

  Handle_CmdGotoPoint(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoPoint char=${session && session.characterID} point=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoPoint(session, { x, y, z });
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
    spaceRuntime.alignTo(session, targetID);
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

  Handle_CmdFleetTagTarget(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    const tag = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Beyonce] CmdFleetTagTarget char=${session && session.characterID} item=${itemID} tag=${tag === null || tag === undefined ? "<clear>" : String(tag)}`,
    );
    fleetRuntime.setFleetTargetTag(session, itemID, tag);
    return null;
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
    if (
      (warpType === "item" ||
        warpType === "scan" ||
        warpType === "launch" ||
        warpType === "bookmark" ||
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
    const response = buildBoundObjectResponse(this, args, session, kwargs);
    const dockedStructureObserverSession = isDockedStructureObserverSession(session);
    // Space login is race-sensitive: if the bind reply reaches the client
    // before the first AddBalls2/SetState bootstrap, the inflight HUD can open
    // against an empty ego-ball state and only recover later via Michelle's
    // missing-module redraw path.
    bootstrapSessionBallpark(session, {
      force: dockedStructureObserverSession,
      reset: Boolean(
        dockedStructureObserverSession &&
          session &&
          session._structureViewSpace &&
          session._structureViewSpace.pendingBallparkBind === true
      ),
    });
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

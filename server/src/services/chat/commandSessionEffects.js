const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  syncShipFittingStateForSession,
  syncLoadedChargeDogmaBootstrapForSession,
} = require(path.join(
  __dirname,
  "../character/characterState",
));

// CCP's HUD defers slot rebuilds for 200ms after synthetic module fit/location
// changes (SlotsContainer.InitSlotsDelayed). Keep the late tuple-backed charge
// replay beyond that window so the final slot binding lands on the charge tuple
// instead of getting stomped by the delayed module rebuild.
const HUD_CHARGE_REPLAY_DEBOUNCE_MS = 350;
// ModuleButton registration continues briefly after the rack's first turret-slot
// bootstrap. Debounce one final refresh-only tuple replay after the last HUD
// slot request so right-click/tooltip state lands after the buttons exist.
const HUD_CHARGE_FINALIZE_DEBOUNCE_MS = 450;
// Login traces still show a second GetAvailableTurretSlots burst after the
// first "final" tuple refresh has already fired. Keep a short re-arm window so
// a later rack rebuild can schedule one more refresh-only tuple replay instead
// of inheriting the stale chargeQuantity=None state forever.
const HUD_CHARGE_FINALIZE_REARM_WINDOW_MS = 1500;
// Michelle._DetectAndFixMissingHudModules sleeps for 10 seconds after
// inflight attach, then may redraw the HUD or ForcePrimeLocation again. Those
// late client-side repairs can recreate ModuleButtons after our early
// refresh-only tuple fix has already landed, which brings back
// chargeQuantity=None flakiness on login. Keep one short attach-scoped guard
// window after Michelle's own self-heal pass.
const HUD_CHARGE_MICHELLE_GUARD_TARGET_DELAYS_MS = Object.freeze([
  10250,
  11250,
]);
const CHARGE_REPLAY_MODE_PRIME_AND_REFRESH = "prime-and-refresh";
const CHARGE_REPLAY_MODE_REFRESH_ONLY = "refresh-only";

function getPendingShipChargeDogmaReplayMode(session) {
  return session &&
    session._space &&
    session._space.loginChargeDogmaReplayMode === CHARGE_REPLAY_MODE_REFRESH_ONLY
    ? CHARGE_REPLAY_MODE_REFRESH_ONLY
    : CHARGE_REPLAY_MODE_PRIME_AND_REFRESH;
}

function flushPendingInitialBallpark(session, pending, attempt = 0) {
  if (!session || !pending) {
    return;
  }

  if (!session.socket || session.socket.destroyed) {
    return;
  }

  if (!session._space || session._space.initialStateSent) {
    return;
  }

  if (
    pending.awaitBeyonceBound === true &&
    !session._space.beyonceBound
  ) {
    if (attempt >= 480) {
      return;
    }

    setTimeout(() => {
      flushPendingInitialBallpark(session, pending, attempt + 1);
    }, 25);
    return;
  }

  const completed = spaceRuntime.ensureInitialBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
    force: pending.force === true,
  });

  if (completed || attempt >= 480) {
    return;
  }

  setTimeout(() => {
    flushPendingInitialBallpark(session, pending, attempt + 1);
  }, 25);
}

function tryFlushPendingShipFittingReplay(session) {
  if (!session) {
    return;
  }

  const pending = session._pendingCommandShipFittingReplay || null;
  if (!pending) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    session._pendingCommandShipFittingReplay = null;
    return false;
  }

  if (
    pending.awaitBeyonceBound === true &&
    (!session._space || !session._space.beyonceBound)
  ) {
    return false;
  }

  if (
    pending.awaitInitialBallpark === true &&
    (!session._space || !session._space.initialStateSent)
  ) {
    return false;
  }

  if (
    pending.awaitPostLoginShipInventoryList === true &&
    (!session._space || session._space.loginShipInventoryPrimed !== true)
  ) {
    return false;
  }

  session._pendingCommandShipFittingReplay = null;
  syncShipFittingStateForSession(session, pending.shipID, {
    includeOfflineModules: pending.includeOfflineModules === true,
    includeCharges: pending.includeCharges === true,
    emitChargeInventoryRows: pending.emitChargeInventoryRows !== false,
    emitOnlineEffects: pending.emitOnlineEffects === true,
    syntheticFitTransition: pending.syntheticFitTransition === true,
  });
  log.debug(
    `[fitting-replay] flushed shipID=${Number(pending.shipID) || 0} ` +
    `chargeReplayPending=${
      session &&
      session._space &&
      session._space.loginChargeDogmaReplayPending === true
    } ` +
    `mode=${getPendingShipChargeDogmaReplayMode(session)} ` +
    `hudSeen=${
      session &&
      session._space &&
      session._space.loginChargeDogmaReplayHudBootstrapSeen === true
    }`,
  );
  if (
    session &&
    session._space &&
    session._space.loginChargeDogmaReplayPending === true &&
    session._space.loginChargeDogmaReplayHudBootstrapSeen === true
  ) {
    requestPendingShipChargeDogmaReplayFromHud(session, pending.shipID, {
      delayMs: HUD_CHARGE_REPLAY_DEBOUNCE_MS,
      reason: "post-fitting-replay",
    });
  }
  return true;
}

function clearPendingShipChargeDogmaReplayTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginChargeDogmaReplayTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginChargeDogmaReplayTimer);
  session._space.loginChargeDogmaReplayTimer = null;
}

function clearPendingHudChargeFinalizeTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginChargeHudFinalizeTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginChargeHudFinalizeTimer);
  session._space.loginChargeHudFinalizeTimer = null;
}

function clearPendingHudChargeMichelleGuardTimers(session) {
  if (
    !session ||
    !session._space ||
    !Array.isArray(session._space.loginChargeMichelleGuardTimers)
  ) {
    return;
  }

  for (const timer of session._space.loginChargeMichelleGuardTimers) {
    clearTimeout(timer);
  }
  session._space.loginChargeMichelleGuardTimers = [];
}

function resolvePendingShipChargeDogmaReplayShipID(session, shipID = null) {
  return (
    Number(shipID) ||
    Number(
      session &&
        session._space &&
        (session._space.shipID ||
          session.activeShipID ||
          session.shipID ||
          session.shipid ||
          0),
    ) ||
    0
  );
}

function canFlushPendingShipChargeDogmaReplay(session, shipID = null) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true
  ) {
    return {
      ready: false,
      resolvedShipID: 0,
    };
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingShipChargeDogmaReplayTimer(session);
    session._space.loginChargeDogmaReplayPending = false;
    return {
      ready: false,
      resolvedShipID: 0,
    };
  }

  if (
    session._space.beyonceBound !== true ||
    session._space.initialStateSent !== true ||
    session._space.loginShipInventoryPrimed !== true ||
    session._pendingCommandShipFittingReplay
  ) {
    return {
      ready: false,
      resolvedShipID: 0,
    };
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingShipChargeDogmaReplayTimer(session);
    session._space.loginChargeDogmaReplayPending = false;
    return {
      ready: false,
      resolvedShipID: 0,
    };
  }

  return {
    ready: true,
    resolvedShipID,
  };
}

function tryFlushPendingShipChargeDogmaReplay(session, shipID = null) {
  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    return false;
  }

  const replayMode = getPendingShipChargeDogmaReplayMode(session);
  clearPendingShipChargeDogmaReplayTimer(session);
  session._space.loginChargeDogmaReplayPending = false;
  session._space.loginChargeDogmaReplayFlushed = true;
  session._space.loginChargeHudFinalizeWindowEndsAtMs =
    session._space.loginChargeHudFinalizePending === true
      ? Date.now() + HUD_CHARGE_FINALIZE_REARM_WINDOW_MS
      : 0;
  log.debug(
    `[charge-replay] flushing shipID=${state.resolvedShipID} ` +
    `mode=${replayMode}`,
  );
  syncLoadedChargeDogmaBootstrapForSession(session, state.resolvedShipID, {
    mode: replayMode,
  });
  if (replayMode === CHARGE_REPLAY_MODE_PRIME_AND_REFRESH) {
    requestPostMichelleHudChargeRefreshGuards(session, state.resolvedShipID);
  }
  return true;
}

function requestPendingShipChargeDogmaReplayFromHud(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true
  ) {
    return false;
  }

  session._space.loginChargeDogmaReplayHudBootstrapSeen = true;

  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    return false;
  }

  clearPendingShipChargeDogmaReplayTimer(session);
  const delayMs = Math.max(
    0,
    Number(options.delayMs) || HUD_CHARGE_REPLAY_DEBOUNCE_MS,
  );
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "hud";
  log.debug(
    `[charge-replay] scheduling shipID=${state.resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason}`,
  );
  session._space.loginChargeDogmaReplayTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeDogmaReplayPending !== true
    ) {
      return;
    }

    session._space.loginChargeDogmaReplayTimer = null;
    log.debug(
      `[charge-replay] timer-fired shipID=${state.resolvedShipID} ` +
      `reason=${reason}`,
    );
    tryFlushPendingShipChargeDogmaReplay(session, state.resolvedShipID);
  }, delayMs);
  return true;
}

function requestPostHudChargeRefresh(session, shipID = null, options = {}) {
  const finalizeWindowEndsAtMs =
    Number(
      session &&
        session._space &&
        session._space.loginChargeHudFinalizeWindowEndsAtMs,
    ) || 0;
  const finalizeWindowRemainingMs = Math.max(
    0,
    finalizeWindowEndsAtMs - Date.now(),
  );
  const rearmWindowOpen = finalizeWindowRemainingMs > 0;

  if (
    !session ||
    !session._space ||
    (
      session._space.loginChargeHudFinalizePending !== true &&
      rearmWindowOpen !== true
    ) ||
    session._space.loginChargeDogmaReplayFlushed !== true
  ) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    return false;
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    return false;
  }

  if (
    session._space.loginChargeHudFinalizePending !== true &&
    rearmWindowOpen === true
  ) {
    session._space.loginChargeHudFinalizePending = true;
    log.debug(
      `[charge-hud-finalize] rearming shipID=${resolvedShipID} ` +
      `windowRemainingMs=${finalizeWindowRemainingMs}`,
    );
  }

  clearPendingHudChargeFinalizeTimer(session);
  const delayMs = Math.max(
    0,
    Number(options.delayMs) || HUD_CHARGE_FINALIZE_DEBOUNCE_MS,
  );
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "post-hud-finalize";
  log.debug(
    `[charge-hud-finalize] scheduling shipID=${resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason} ` +
    `windowRemainingMs=${Math.max(
      0,
      (Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0) -
        Date.now(),
    )}`,
  );
  session._space.loginChargeHudFinalizeTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeHudFinalizePending !== true
    ) {
      return;
    }

    session._space.loginChargeHudFinalizeTimer = null;
    session._space.loginChargeHudFinalizePending = false;
    if (
      (Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0) <=
      Date.now()
    ) {
      session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    }

    if (
      !session.socket ||
      session.socket.destroyed
    ) {
      return;
    }

    log.debug(
      `[charge-hud-finalize] timer-fired shipID=${resolvedShipID} ` +
      `reason=${reason}`,
    );
    syncLoadedChargeDogmaBootstrapForSession(session, resolvedShipID, {
      mode: CHARGE_REPLAY_MODE_REFRESH_ONLY,
    });
  }, delayMs);
  return true;
}

function requestPostMichelleHudChargeRefreshGuards(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeMichelleGuardPending !== true ||
    session._space.loginChargeDogmaReplayFlushed !== true
  ) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingHudChargeMichelleGuardTimers(session);
    session._space.loginChargeMichelleGuardPending = false;
    return false;
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingHudChargeMichelleGuardTimers(session);
    session._space.loginChargeMichelleGuardPending = false;
    return false;
  }

  const attachStartedAtMs =
    Number(session._space.loginChargeAttachStartedAtMs) || Date.now();
  const targetDelaysMs = Array.isArray(options.targetDelaysMs) &&
    options.targetDelaysMs.length > 0
    ? options.targetDelaysMs
    : HUD_CHARGE_MICHELLE_GUARD_TARGET_DELAYS_MS;

  clearPendingHudChargeMichelleGuardTimers(session);
  session._space.loginChargeMichelleGuardTimers = [];

  targetDelaysMs.forEach((targetDelayMs, index) => {
    const numericTargetDelayMs = Math.max(0, Number(targetDelayMs) || 0);
    const delayMs = Math.max(
      0,
      (attachStartedAtMs + numericTargetDelayMs) - Date.now(),
    );
    log.debug(
      `[charge-michelle-guard] scheduling shipID=${resolvedShipID} ` +
      `delayMs=${delayMs} targetDelayMs=${numericTargetDelayMs} index=${index + 1}/${
        targetDelaysMs.length
      }`,
    );
    const timer = setTimeout(() => {
      if (
        !session ||
        !session._space ||
        session._space.loginChargeMichelleGuardPending !== true
      ) {
        return;
      }

      if (
        !session.socket ||
        session.socket.destroyed
      ) {
        session._space.loginChargeMichelleGuardPending = false;
        clearPendingHudChargeMichelleGuardTimers(session);
        return;
      }

      if (
        Array.isArray(session._space.loginChargeMichelleGuardTimers)
      ) {
        session._space.loginChargeMichelleGuardTimers =
          session._space.loginChargeMichelleGuardTimers.filter(
            (candidate) => candidate !== timer,
          );
      }

      log.debug(
        `[charge-michelle-guard] timer-fired shipID=${resolvedShipID} ` +
        `targetDelayMs=${numericTargetDelayMs} index=${index + 1}/${
          targetDelaysMs.length
        }`,
      );
      syncLoadedChargeDogmaBootstrapForSession(session, resolvedShipID, {
        mode: CHARGE_REPLAY_MODE_REFRESH_ONLY,
      });

      if (index >= targetDelaysMs.length - 1 && session._space) {
        session._space.loginChargeMichelleGuardPending = false;
      }
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    session._space.loginChargeMichelleGuardTimers.push(timer);
  });

  return true;
}

function requestPendingShipChargeDogmaReplayFromInventory(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true ||
    getPendingShipChargeDogmaReplayMode(session) !==
      CHARGE_REPLAY_MODE_REFRESH_ONLY
  ) {
    return false;
  }

  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    return false;
  }

  clearPendingShipChargeDogmaReplayTimer(session);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "inventory";
  log.debug(
    `[charge-replay] scheduling shipID=${state.resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason}`,
  );
  session._space.loginChargeDogmaReplayTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeDogmaReplayPending !== true
    ) {
      return;
    }

    session._space.loginChargeDogmaReplayTimer = null;
    log.debug(
      `[charge-replay] timer-fired shipID=${state.resolvedShipID} ` +
      `reason=${reason}`,
    );
    tryFlushPendingShipChargeDogmaReplay(session, state.resolvedShipID);
  }, delayMs);
  return true;
}

function flushPendingCommandSessionEffects(session) {
  if (!session || typeof session !== "object") {
    return;
  }

  const pendingLocalChannelSync = session._pendingLocalChannelSync || null;
  const pendingInitialBallpark = session._pendingCommandInitialBallpark || null;
  session._pendingLocalChannelSync = null;
  session._pendingCommandInitialBallpark = null;

  if (pendingLocalChannelSync) {
    const chatHub = require(path.join(__dirname, "./chatHub"));
    if (typeof chatHub.moveLocalSession === "function") {
      chatHub.moveLocalSession(session, pendingLocalChannelSync.previousChannelID);
    }
  }

  if (pendingInitialBallpark) {
    setTimeout(() => {
      flushPendingInitialBallpark(session, pendingInitialBallpark);
    }, 0);
  }

  if (session._pendingCommandShipFittingReplay) {
    setTimeout(() => {
      tryFlushPendingShipFittingReplay(session);
    }, 0);
  }
}

module.exports = {
  flushPendingCommandSessionEffects,
  requestPostHudChargeRefresh,
  requestPendingShipChargeDogmaReplayFromHud,
  requestPendingShipChargeDogmaReplayFromInventory,
  tryFlushPendingShipFittingReplay,
  tryFlushPendingShipChargeDogmaReplay,
};

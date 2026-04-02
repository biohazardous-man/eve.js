const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildSpaceAttachHydrationPlan,
} = require(path.join(__dirname, "./moduleLoadParity"));

function queuePostSpaceAttachFittingHydration(
  session,
  shipID,
  options = {},
) {
  const {
    describeSessionHydrationState,
    tryFlushPendingShipFittingReplay,
  } = require(path.join(__dirname, "../../services/chat/commandSessionEffects"));
  const {
    clearDeferredDockedShipSessionChange,
    clearDeferredDockedFittingReplay,
  } = require(path.join(__dirname, "../../services/character/characterState"));

  if (!session || !session._space) {
    return false;
  }

  // Once we are attaching a live in-space session, any leftover docked-only
  // ship/fitting replay state is stale. Keeping it around lets later dogma or
  // inventory callbacks flush a hangar repair back into space.
  clearDeferredDockedShipSessionChange(session);
  clearDeferredDockedFittingReplay(session);

  const resolvedShipID =
    Number(shipID) ||
    Number(
      session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) ||
    0;
  if (resolvedShipID <= 0) {
    return false;
  }

  const inventoryBootstrapPending = options.inventoryBootstrapPending === true;
  const hydrationPlan = buildSpaceAttachHydrationPlan(
    options.hydrationProfile ||
      (options.enableChargeDogmaReplay === false ? "capsule" : "transition"),
    {
      enableChargeDogmaReplay: options.enableChargeDogmaReplay,
      chargeDogmaReplayMode: options.chargeDogmaReplayMode,
      queueModuleReplay: options.queueModuleReplay,
      awaitPostLoginHudTurretBootstrap:
        options.awaitPostLoginHudTurretBootstrap,
      rememberBlockedChargeHudBootstrap:
        options.rememberBlockedChargeHudBootstrap,
      syntheticFitTransition: options.syntheticFitTransition,
      allowLateFittingReplay: options.allowLateFittingReplay,
      allowLateChargeRefresh: options.allowLateChargeRefresh,
      lateChargeDogmaReplayMode: options.lateChargeDogmaReplayMode,
      lateChargeFinalizeReplayBudget:
        options.lateChargeFinalizeReplayBudget,
      allowMichelleGuardChargeRefresh:
        options.allowMichelleGuardChargeRefresh,
    },
  );
  const hasSharedHydrationWork =
    hydrationPlan.enableChargeDogmaReplay === true ||
    hydrationPlan.queueModuleReplay === true;
  const effectiveInventoryBootstrapPending =
    inventoryBootstrapPending && hasSharedHydrationWork;

  // Keep the shared bootstrap explicit per attach type:
  // - stargate, solar, undock, and legacy transition rely on the shared
  //   in-space replay path: one fitted-module inventory replay plus one
  //   tuple-backed charge prime-and-repair bootstrap after attach
  // - login now differs intentionally: the stock client login path already
  //   instantiates the loaded charge tuples during MakeShipActive +
  //   LoadItemsInLocation(shipID), and the HUD rack seeds charges directly
  //   from shipItem.sublocations, so login stays on that stock path with no
  //   shared synthetic module replay and no shared synthetic charge replay
  // - loaded charges stay tuple-backed whenever a profile enables shared
  //   charge bootstrap
  //
  // Late self-rearming fitting/charge replays are profile-gated and disabled by
  // default; the live parity path should stabilize from the first bootstrap
  // instead of layering extra repair passes on top.
  session._space.loginInventoryBootstrapPending =
    effectiveInventoryBootstrapPending;
  session._space.loginShipInventoryPrimed = hasSharedHydrationWork !== true;
  session._space.loginShipInventoryListed = hasSharedHydrationWork !== true;
  session._space.loginChargeDogmaReplayPending =
    hydrationPlan.enableChargeDogmaReplay;
  // The inflight rack's first loaded-ammo render comes from godma ship
  // sublocations, not from real loaded-charge inventory rows. Keep the shared
  // charge bootstrap tuple-backed for every in-space attach path.
  session._space.loginChargeDogmaReplayMode =
    hydrationPlan.chargeDogmaReplayMode;
  session._space.loginChargeDogmaReplayFlushed = false;
  session._space.loginChargeDogmaReplayHudBootstrapSeen = false;
  session._space.loginRememberBlockedChargeHudBootstrap =
    hydrationPlan.rememberBlockedChargeHudBootstrap === true;
  session._space.loginChargeHydrationProfile = hydrationPlan.profileID;
  session._space.loginAllowLateFittingReplay =
    hydrationPlan.allowLateFittingReplay === true;
  session._space.loginAllowLateChargeRefresh =
    hydrationPlan.allowLateChargeRefresh === true;
  session._space.loginLateChargeDogmaReplayMode =
    hydrationPlan.lateChargeDogmaReplayMode;
  session._space.loginChargeHudFinalizeReplayBudget = Math.max(
    0,
    Number(hydrationPlan.lateChargeFinalizeReplayBudget) || 0,
  );
  session._space.loginChargeHudFinalizeRemainingReplays = 0;
  session._space.loginAllowMichelleGuardChargeRefresh =
    hydrationPlan.allowMichelleGuardChargeRefresh === true;
  session._space.loginFittingReplayHudBootstrapSeen = false;
  session._space.loginFittingHudFinalizePending = false;
  session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
  session._space.loginFittingHudFinalizeRemainingReplays = 0;
  session._space.loginFittingFinalizeReplay = null;
  session._space.loginChargeHudFinalizePending = false;
  session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
  session._space.loginChargeAttachStartedAtMs = Date.now();
  session._space.loginChargeMichelleGuardPending =
    hydrationPlan.allowMichelleGuardChargeRefresh === true;
  if (session._space.loginChargeDogmaReplayTimer) {
    clearTimeout(session._space.loginChargeDogmaReplayTimer);
  }
  if (session._space.loginChargeHudFinalizeTimer) {
    clearTimeout(session._space.loginChargeHudFinalizeTimer);
  }
  if (session._space.loginFittingReplayTimer) {
    clearTimeout(session._space.loginFittingReplayTimer);
  }
  if (session._space.loginFittingHudFinalizeTimer) {
    clearTimeout(session._space.loginFittingHudFinalizeTimer);
  }
  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
  }
  if (Array.isArray(session._space.loginChargeMichelleGuardTimers)) {
    for (const timer of session._space.loginChargeMichelleGuardTimers) {
      clearTimeout(timer);
    }
  }
  session._space.loginChargeHudFinalizeTimer = null;
  session._space.loginChargeDogmaReplayTimer = null;
  session._space.loginFittingReplayTimer = null;
  session._space.loginFittingHudFinalizeTimer = null;
  session._space._chargeBootstrapRepairTimer = null;
  session._space.loginChargeMichelleGuardTimers = [];

  session._pendingCommandShipFittingReplay =
    hydrationPlan.queueModuleReplay === true
      ? {
          shipID: resolvedShipID,
          includeOfflineModules: true,
          includeCharges: false,
          emitChargeInventoryRows: false,
          emitOnlineEffects: options.emitOnlineEffects === true,
          syntheticFitTransition: hydrationPlan.syntheticFitTransition === true,
          awaitBeyonceBound: options.awaitBeyonceBound !== false,
          awaitInitialBallpark: options.awaitInitialBallpark !== false,
          awaitPostLoginShipInventoryList: true,
          awaitPostLoginHudTurretBootstrap:
            hydrationPlan.awaitPostLoginHudTurretBootstrap === true,
        }
      : null;

  log.debug(
    `[space-hydration] queued shipID=${resolvedShipID} ` +
    `profile=${hydrationPlan.profileID} ` +
    `inventoryBootstrapPending=${effectiveInventoryBootstrapPending} ` +
    `enableChargeDogmaReplay=${hydrationPlan.enableChargeDogmaReplay} ` +
    `chargeMode=${session._space.loginChargeDogmaReplayMode} ` +
    `queueModuleReplay=${hydrationPlan.queueModuleReplay === true} ` +
    `rememberBlockedChargeHud=${hydrationPlan.rememberBlockedChargeHudBootstrap === true} ` +
    `lateFittingReplay=${hydrationPlan.allowLateFittingReplay === true} ` +
    `lateChargeRefresh=${hydrationPlan.allowLateChargeRefresh === true} ` +
    `lateChargeMode=${hydrationPlan.lateChargeDogmaReplayMode} ` +
    `lateChargeBudget=${Math.max(
      0,
      Number(hydrationPlan.lateChargeFinalizeReplayBudget) || 0,
    )} ` +
    `${describeSessionHydrationState(session, resolvedShipID)}`,
  );

  if (session._pendingCommandShipFittingReplay) {
    tryFlushPendingShipFittingReplay(session);
  }
  return true;
}

module.exports = {
  queuePostSpaceAttachFittingHydration,
};

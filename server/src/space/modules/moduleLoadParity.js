// Space attach hydration profiles are behavior buckets, not one profile per
// entrypoint. Current callers in `server/src/space/transitions.js` map to them
// like this:
// - `login`: direct login/restore into space (`restoreSpaceSession`)
// - `stargate`: normal gate jump attach (`completeStargateJump`)
// - `solar`: direct solar-system jump/teleport attach
//   (`jumpSessionToSolarSystem`)
// - `transition`: same-scene / legacy in-space handoffs such as boarding
// - `undock`: station/structure undock attach
// - `capsule`: eject/capsule attach where ship module and charge hydration
//   should stay disabled
//
// If one entry path later needs different sequencing, split out a new profile
// here instead of reintroducing ad-hoc caller conditionals.
const CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR = "prime-and-repair";
const CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR = "quantity-and-repair";
const CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY =
  "repair-then-quantity";
const CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY =
  "prime-repair-then-quantity";
const CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY = "refresh-only";

const SPACE_ATTACH_HYDRATION_PROFILES = Object.freeze({
  login: Object.freeze({
    profileID: "login",
    // CCP login seeds the active ship through `MakeShipActive(shipState)` and
    // then `LoadItemsInLocation(shipID)`. The client traces already show all
    // five real charge rows plus all five tuple sublocations being instantiated
    // during that stock path before any later EvEJS replay fires. The HUD rack
    // then builds charges directly from `shipItem.sublocations` in
    // `slotsContainer.InitSlots()`.
    //
    // A later synthetic fitted-module replay is not part of that CCP path.
    // On login it tears down and rebuilds the registered module buttons after
    // the stock rack already exists, which is exactly the non-parity churn
    // visible in `login33.txt`. Login therefore stays on the pure stock
    // MakeShipActive + LoadItemsInLocation bootstrap with no shared synthetic
    // module replay and no shared synthetic charge replay.
    enableChargeDogmaReplay: false,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    queueModuleReplay: false,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: false,
    syntheticFitTransition: false,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  stargate: Object.freeze({
    profileID: "stargate",
    enableChargeDogmaReplay: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    queueModuleReplay: true,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  solar: Object.freeze({
    profileID: "solar",
    // Direct /solar jumps do pass tuple charge state through MakeShipActive,
    // but the live-working path still needs the same fuller tuple bootstrap
    // repair that stargates use.
    enableChargeDogmaReplay: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    queueModuleReplay: true,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  transition: Object.freeze({
    profileID: "transition",
    enableChargeDogmaReplay: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    queueModuleReplay: true,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  undock: Object.freeze({
    profileID: "undock",
    // Undock parity is the hybrid path captured in the working commit/logs:
    // keep the fitted-module replay inventory-prime driven, let the first HUD
    // turret-slot burst trigger the initial tuple dogma bootstrap, then allow
    // one later refresh-only cleanup pass after the rack is live.
    enableChargeDogmaReplay: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 1,
    queueModuleReplay: true,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: true,
    allowMichelleGuardChargeRefresh: false,
  }),
  capsule: Object.freeze({
    profileID: "capsule",
    enableChargeDogmaReplay: false,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    queueModuleReplay: false,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: false,
    syntheticFitTransition: false,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
});

function normalizeOptionalBoolean(value, defaultValue) {
  return value === undefined ? defaultValue : value === true;
}

function normalizeOptionalNonNegativeInteger(value, defaultValue) {
  if (value === undefined || value === null) {
    return Math.max(0, Number(defaultValue) || 0);
  }
  return Math.max(0, Number(value) || 0);
}

function buildSpaceAttachHydrationPlan(profileName = "transition", overrides = {}) {
  const baseProfile =
    SPACE_ATTACH_HYDRATION_PROFILES[profileName] ||
    SPACE_ATTACH_HYDRATION_PROFILES.transition;
  const enableChargeDogmaReplay = normalizeOptionalBoolean(
    overrides.enableChargeDogmaReplay,
    baseProfile.enableChargeDogmaReplay,
  );
  const queueModuleReplay = normalizeOptionalBoolean(
    overrides.queueModuleReplay,
    baseProfile.queueModuleReplay,
  );

  return {
    profileID: baseProfile.profileID,
    enableChargeDogmaReplay,
    chargeDogmaReplayMode:
      overrides.chargeDogmaReplayMode ||
      baseProfile.chargeDogmaReplayMode,
    lateChargeDogmaReplayMode:
      overrides.lateChargeDogmaReplayMode ||
      baseProfile.lateChargeDogmaReplayMode ||
      CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    queueModuleReplay,
    awaitPostLoginHudTurretBootstrap: normalizeOptionalBoolean(
      overrides.awaitPostLoginHudTurretBootstrap,
      baseProfile.awaitPostLoginHudTurretBootstrap,
    ),
    rememberBlockedChargeHudBootstrap: normalizeOptionalBoolean(
      overrides.rememberBlockedChargeHudBootstrap,
      baseProfile.rememberBlockedChargeHudBootstrap,
    ),
    syntheticFitTransition: normalizeOptionalBoolean(
      overrides.syntheticFitTransition,
      baseProfile.syntheticFitTransition,
    ),
    allowLateFittingReplay:
      queueModuleReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateFittingReplay,
        baseProfile.allowLateFittingReplay,
      ),
    allowLateChargeRefresh:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateChargeRefresh,
        baseProfile.allowLateChargeRefresh,
      ),
    lateChargeFinalizeReplayBudget:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateChargeRefresh,
        baseProfile.allowLateChargeRefresh,
      )
        ? normalizeOptionalNonNegativeInteger(
            overrides.lateChargeFinalizeReplayBudget,
            baseProfile.lateChargeFinalizeReplayBudget,
          )
        : 0,
    allowMichelleGuardChargeRefresh:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowMichelleGuardChargeRefresh,
        baseProfile.allowMichelleGuardChargeRefresh,
      ),
  };
}

module.exports = {
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
  SPACE_ATTACH_HYDRATION_PROFILES,
  buildSpaceAttachHydrationPlan,
};

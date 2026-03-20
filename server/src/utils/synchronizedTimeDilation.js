"use strict";

const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));

const TIDI_ADVANCE_NOTICE_MS = 2000;

function clampTimeDilationFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1.0;
  }
  return Math.min(1.0, Math.max(0.1, numeric));
}

function buildTimeDilationNotificationArgs(factor) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const isDisabling = normalizedFactor >= 1.0;
  return [
    isDisabling ? 1.0 : normalizedFactor,
    // Force a deterministic snap back to full speed on every client when
    // clearing TiDi; restoring the stock 0.1 minimum lets clients recover on
    // their own timeline under multi-client load.
    isDisabling ? 1.0 : normalizedFactor,
    isDisabling ? 100000000 : 0,
  ];
}

function sendTimeDilationNotificationToSystem(systemID, factor) {
  const notificationArgs = buildTimeDilationNotificationArgs(factor);
  let sentCount = 0;
  for (const targetSession of sessionRegistry.getSessions()) {
    const targetSystemID = Number(
      targetSession &&
        targetSession._space &&
        targetSession._space.systemID ||
        targetSession && targetSession.solarsystemid2 ||
        targetSession && targetSession.solarsystemid ||
        0,
    );
    if (targetSystemID !== Number(systemID)) {
      continue;
    }
    if (
      !targetSession.socket ||
      targetSession.socket.destroyed ||
      typeof targetSession.sendNotification !== "function"
    ) {
      continue;
    }
    targetSession.sendNotification(
      "OnSetTimeDilation",
      "clientID",
      notificationArgs,
    );
    sentCount += 1;
  }
  return sentCount;
}

function sendTimeDilationNotificationToSession(session, factor) {
  if (
    !session ||
    !session.socket ||
    session.socket.destroyed ||
    typeof session.sendNotification !== "function"
  ) {
    return false;
  }

  session.sendNotification(
    "OnSetTimeDilation",
    "clientID",
    buildTimeDilationNotificationArgs(factor),
  );
  return true;
}

function applyTimeDilationToSystem(systemID, factor) {
  const spaceRuntime = require(path.join(__dirname, "../space/runtime"));
  return spaceRuntime.setSolarSystemTimeDilation(systemID, factor, {
    syncSessions: true,
    emit: true,
    forceRebase: true,
  });
}

function normalizeSystemIDs(systemIDs) {
  return [...new Set(
    (Array.isArray(systemIDs) ? systemIDs : [])
      .map((systemID) => Number(systemID) || 0)
      .filter((systemID) => systemID > 0),
  )];
}

function scheduleSynchronizedTimeDilationForSystems(
  systemIDs,
  factor,
  options = {},
) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const uniqueSystemIDs = normalizeSystemIDs(systemIDs);
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Number(options.delayMs)
    : TIDI_ADVANCE_NOTICE_MS;
  const setTimeoutFn = typeof options.setTimeoutFn === "function"
    ? options.setTimeoutFn
    : setTimeout;
  const notifySystemFn = typeof options.notifySystemFn === "function"
    ? options.notifySystemFn
    : sendTimeDilationNotificationToSystem;
  const applySystemFactorFn = typeof options.applySystemFactorFn === "function"
    ? options.applySystemFactorFn
    : applyTimeDilationToSystem;

  return setTimeoutFn(() => {
    for (const systemID of uniqueSystemIDs) {
      notifySystemFn(systemID, normalizedFactor);
      applySystemFactorFn(systemID, normalizedFactor);
    }
  }, delayMs);
}

function scheduleAdvanceNoticeTimeDilationForSystems(
  systemIDs,
  factor,
  options = {},
) {
  const normalizedFactor = clampTimeDilationFactor(factor);
  const uniqueSystemIDs = normalizeSystemIDs(systemIDs);
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Number(options.delayMs)
    : TIDI_ADVANCE_NOTICE_MS;
  const setTimeoutFn = typeof options.setTimeoutFn === "function"
    ? options.setTimeoutFn
    : setTimeout;
  const notifySystemFn = typeof options.notifySystemFn === "function"
    ? options.notifySystemFn
    : sendTimeDilationNotificationToSystem;
  const applySystemFactorFn = typeof options.applySystemFactorFn === "function"
    ? options.applySystemFactorFn
    : applyTimeDilationToSystem;

  for (const systemID of uniqueSystemIDs) {
    notifySystemFn(systemID, normalizedFactor);
  }

  return setTimeoutFn(() => {
    for (const systemID of uniqueSystemIDs) {
      applySystemFactorFn(systemID, normalizedFactor);
    }
  }, delayMs);
}

module.exports = {
  TIDI_ADVANCE_NOTICE_MS,
  applyTimeDilationToSystem,
  buildTimeDilationNotificationArgs,
  scheduleAdvanceNoticeTimeDilationForSystems,
  sendTimeDilationNotificationToSession,
  sendTimeDilationNotificationToSystem,
  scheduleSynchronizedTimeDilationForSystems,
};

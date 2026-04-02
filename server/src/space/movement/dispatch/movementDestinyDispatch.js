function createMovementDestinyDispatch(deps = {}) {
  const {
    buildMissileSessionMutation,
    buildMissileSessionSnapshot,
    clamp,
    destiny,
    getPayloadPrimaryEntityID,
    getNextMissileDebugTraceID,
    isMovementContractPayload,
    isReadyForDestiny,
    logDestinyDispatch,
    logMissileDebug,
    normalizeTraceValue,
    resolveDestinyLifecycleRestampState,
    resolveOwnerMonotonicState,
    resolvePreviousLastSentDestinyWasOwnerCritical,
    roundNumber,
    shouldLogMissilePayloadGroup,
    summarizeMissileUpdatesForLog,
    toInt,
    updatesContainMovementContractPayload,
    MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
    MICHELLE_HELD_FUTURE_DESTINY_LEAD,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
  } = deps;
  const OBSERVER_DIRECT_PRESENTED_MONOTONIC_PAYLOAD_NAMES = new Set([
    "AddBalls2",
    "RemoveBalls",
    "GotoDirection",
    "GotoPoint",
    "Orbit",
    "FollowBall",
    "Stop",
    "WarpTo",
    "SetBallAgility",
    "SetBallMass",
    "SetMaxSpeed",
    "SetBallMassive",
    "SetSpeedFraction",
    "SetBallPosition",
    "SetBallVelocity",
  ]);

  function updatesContainObserverPresentedMonotonicPayload(
    updates,
    ownerShipID = 0,
  ) {
    return Array.isArray(updates) && updates.some((update) => {
      const payload = update && Array.isArray(update.payload)
        ? update.payload
        : null;
      if (!payload) {
        return false;
      }
      const payloadName = typeof payload[0] === "string"
        ? payload[0]
        : "";
      if (!OBSERVER_DIRECT_PRESENTED_MONOTONIC_PAYLOAD_NAMES.has(payloadName)) {
        return false;
      }
      const primaryEntityID = getPayloadPrimaryEntityID(payload) >>> 0;
      return ownerShipID <= 0 || primaryEntityID <= 0 || primaryEntityID !== ownerShipID;
    });
  }

  function getDestinyHistoryAnchorStampForSession(
    runtime,
    session,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (options && options.historyLeadUsesImmediateSessionStamp === true) {
      const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
        session,
        rawSimTimeMs,
      );
      return runtime.getImmediateDestinyStampForSession(
        session,
        currentSessionStamp,
      );
    }
    if (options && options.historyLeadUsesPresentedSessionStamp === true) {
      const presentedMaximumFutureLead = Math.max(
        0,
        toInt(
          options.historyLeadPresentedMaximumFutureLead,
          MICHELLE_HELD_FUTURE_DESTINY_LEAD,
        ),
      );
      return runtime.getCurrentPresentedSessionDestinyStamp(
        session,
        rawSimTimeMs,
        presentedMaximumFutureLead,
      );
    }
    if (options && options.historyLeadUsesCurrentSessionStamp === true) {
      return runtime.getCurrentSessionDestinyStamp(session, rawSimTimeMs);
    }
    // CCP parity: the client's _current_time is
    // MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD (1) tick behind the
    // server's session stamp.  The visible stamp equals the session stamp,
    // but the dispatch anchor must reflect the client's actual _current_time
    // so that lead calculations (e.g. +MICHELLE_HELD_FUTURE_DESTINY_LEAD)
    // land inside the held-future window instead of hitting the delta-3
    // SynchroniseToSimulationTime jolt threshold.
    const visibleStamp = runtime.getCurrentVisibleSessionDestinyStamp(
      session,
      rawSimTimeMs,
    );
    return visibleStamp > MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
      ? ((visibleStamp - MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD) >>> 0)
      : visibleStamp;
  }

  function resolveDestinyDeliveryStampForSession(
    runtime,
    session,
    authoredStamp,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    const maximumHistorySafeLead = Math.max(
      MICHELLE_HELD_FUTURE_DESTINY_LEAD,
      MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD,
      PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
      clamp(
        toInt(options && options.maximumHistorySafeLeadOverride, 0),
        0,
        16,
      ),
    );
    const normalizedAuthoredStamp = toInt(authoredStamp, 0) >>> 0;
    const hasMinimumLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "minimumLeadFromCurrentHistory",
      );
    const hasMaximumLead =
      options &&
      Object.prototype.hasOwnProperty.call(
        options,
        "maximumLeadFromCurrentHistory",
      );
    const avoidCurrentHistoryInsertion =
      options && options.avoidCurrentHistoryInsertion === true;
    if (
      !session ||
      !session._space ||
      (!avoidCurrentHistoryInsertion && !hasMinimumLead && !hasMaximumLead)
    ) {
      return normalizedAuthoredStamp;
    }

    const minimumLeadFloor = avoidCurrentHistoryInsertion ? 1 : 0;
    const minimumLead = clamp(
      toInt(
        hasMinimumLead
          ? options.minimumLeadFromCurrentHistory
          : minimumLeadFloor,
        minimumLeadFloor,
      ),
      minimumLeadFloor,
      maximumHistorySafeLead,
    );
    const maximumLead = hasMaximumLead
      ? clamp(
        toInt(options.maximumLeadFromCurrentHistory, minimumLead),
        minimumLead,
        maximumHistorySafeLead,
      )
      : null;
    const historyAnchorStamp = runtime.getDestinyHistoryAnchorStampForSession(
      session,
      rawSimTimeMs,
      options,
    );
    const minimumStamp = (historyAnchorStamp + minimumLead) >>> 0;
    const maximumStamp =
      maximumLead === null
        ? null
        : ((historyAnchorStamp + maximumLead) >>> 0);

    let deliveryStamp = Math.max(
      normalizedAuthoredStamp,
      minimumStamp,
    ) >>> 0;
    // Clamp to the maximum lead when the authored stamp is within tolerance
    // of the held-future ceiling. Paths that intentionally author stamps far
    // above the max (e.g. missile lifecycle restamp) must NOT be clamped —
    // doing so pushes delivery stamps backwards below previously-sent values,
    // breaking monotonicity and causing full client desync.
    // The 1-tick tolerance (MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD)
    // covers the fresh-acquire case where the authored stamp is S+2 but the
    // dispatch-anchor-based max is S+1: S+2 <= S+1+1 → clamp applies → S+1
    // → delta 2 → safe.
    if (
      maximumStamp !== null &&
      normalizedAuthoredStamp <= maximumStamp + MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
    ) {
      deliveryStamp = Math.min(deliveryStamp, maximumStamp) >>> 0;
    }
    return deliveryStamp >>> 0;
  }

  function prepareDestinyUpdateForSession(
    runtime,
    session,
    rawPayload,
    rawSimTimeMs = runtime.getCurrentSimTimeMs(),
    options = {},
  ) {
    if (!rawPayload || !Number.isFinite(Number(rawPayload.stamp))) {
      return rawPayload;
    }

    const translateStamps = options && options.translateStamps === true;
    const authoredStamp = translateStamps
      ? runtime.translateDestinyStampForSession(session, rawPayload.stamp)
      : (toInt(rawPayload.stamp, 0) >>> 0);
    const deliveryStamp = runtime.resolveDestinyDeliveryStampForSession(
      session,
      authoredStamp,
      rawSimTimeMs,
      options,
    );
    const preservePayloadStateStamp =
      options && options.preservePayloadStateStamp === true;
    const payload =
      deliveryStamp !== authoredStamp && !preservePayloadStateStamp
        ? destiny.restampPayloadState(rawPayload.payload, deliveryStamp)
        : rawPayload.payload;
    if (shouldLogMissilePayloadGroup([rawPayload])) {
      const payloadName =
        rawPayload &&
        Array.isArray(rawPayload.payload)
          ? rawPayload.payload[0]
          : null;
      logMissileDebug("destiny.prepare-update", {
        payloadName,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
        rawStamp: toInt(rawPayload && rawPayload.stamp, 0) >>> 0,
        authoredStamp,
        deliveryStamp,
        preservePayloadStateStamp,
        authoredBehindCurrentSessionBy:
          Math.max(
            0,
            (
              runtime.getCurrentSessionDestinyStamp(session, rawSimTimeMs) -
              authoredStamp
            ) >>> 0,
          ) >>> 0,
        deliveryBehindCurrentSessionBy:
          Math.max(
            0,
            (
              runtime.getCurrentSessionDestinyStamp(session, rawSimTimeMs) -
              deliveryStamp
            ) >>> 0,
          ) >>> 0,
        options: normalizeTraceValue(options),
      });
    }
    if (
      deliveryStamp === authoredStamp &&
      payload === rawPayload.payload &&
      toInt(rawPayload.stamp, 0) >>> 0 === authoredStamp
    ) {
      return rawPayload;
    }
    return {
      ...rawPayload,
      stamp: deliveryStamp,
      payload,
    };
  }

  function beginTickDestinyPresentationBatch(runtime) {
    runtime._tickDestinyPresentation = {
      nextOrder: 0,
      bySession: new Map(),
    };
  }

  function hasActiveTickDestinyPresentationBatch(runtime) {
    return Boolean(
      runtime._tickDestinyPresentation &&
      runtime._tickDestinyPresentation.bySession instanceof Map,
    );
  }

  function shouldDeferPilotMovementForMissilePressure(
    runtime,
    session,
    nowMs = runtime.getCurrentSimTimeMs(),
  ) {
    if (!session || !session._space || !isReadyForDestiny(session)) {
      return false;
    }

    const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
      session,
      nowMs,
    );
    const currentVisibleStamp = runtime.getCurrentVisibleSessionDestinyStamp(
      session,
      nowMs,
    );
    const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(nowMs);
    const lastSentDestinyStamp = toInt(
      session._space.lastSentDestinyStamp,
      0,
    ) >>> 0;
    const maximumTrustedMissilePressureLane = Math.max(
      currentVisibleStamp,
      lastSentDestinyStamp,
      (
        currentSessionStamp +
        PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS
      ) >>> 0,
    ) >>> 0;
    const lastMissileLifecycleStamp = toInt(
      session._space.lastMissileLifecycleStamp,
      0,
    ) >>> 0;
    const lastMissileLifecycleRawDispatchStamp = toInt(
      session._space.lastMissileLifecycleRawDispatchStamp,
      0,
    ) >>> 0;
    const lastOwnerMissileLifecycleStamp = toInt(
      session._space.lastOwnerMissileLifecycleStamp,
      0,
    ) >>> 0;
    const lastOwnerMissileLifecycleRawDispatchStamp = toInt(
      session._space.lastOwnerMissileLifecycleRawDispatchStamp,
      0,
    ) >>> 0;

    const hasRecentVisibleMissileLifecycle =
      lastMissileLifecycleStamp > currentSessionStamp &&
      lastMissileLifecycleStamp <= maximumTrustedMissilePressureLane &&
      lastMissileLifecycleRawDispatchStamp > 0 &&
      currentRawDispatchStamp >= lastMissileLifecycleRawDispatchStamp &&
      (
        currentRawDispatchStamp - lastMissileLifecycleRawDispatchStamp
      ) <= 2;
    const hasRecentOwnerMissileLifecycle =
      lastOwnerMissileLifecycleStamp > currentSessionStamp &&
      lastOwnerMissileLifecycleStamp <= maximumTrustedMissilePressureLane &&
      lastOwnerMissileLifecycleRawDispatchStamp > 0 &&
      currentRawDispatchStamp >= lastOwnerMissileLifecycleRawDispatchStamp &&
      (
        currentRawDispatchStamp - lastOwnerMissileLifecycleRawDispatchStamp
      ) <= 2;

    return hasRecentVisibleMissileLifecycle || hasRecentOwnerMissileLifecycle;
  }

  function normalizeQueuedPresentationSendOptions(sendOptions) {
    const normalized = {
      translateStamps: false,
    };
    if (!sendOptions || typeof sendOptions !== "object") {
      return normalized;
    }
    for (const key of Object.keys(sendOptions)) {
      const value = sendOptions[key];
      if (value !== undefined) {
        normalized[key] = value;
      }
    }
    normalized.translateStamps = false;
    return normalized;
  }

  function buildQueuedPresentationSendOptionsSignature(sendOptions) {
    const normalized = normalizeQueuedPresentationSendOptions(sendOptions);
    return JSON.stringify(
      Object.keys(normalized)
        .sort()
        .map((key) => [key, normalized[key]]),
    );
  }

  function isFreshAcquireLifecycleUpdate(update) {
    return Boolean(update && update.freshAcquireLifecycleGroup === true);
  }

  function shouldSplitMixedFreshAcquirePayloads(payloads, options = {}) {
    return (
      options &&
      options.preservePayloadStateStamp === true &&
      Array.isArray(payloads) &&
      payloads.some((update) => isFreshAcquireLifecycleUpdate(update)) &&
      payloads.some((update) => !isFreshAcquireLifecycleUpdate(update))
    );
  }

  function buildNonFreshMixedPayloadSendOptions(baseOptions = {}) {
    const nextOptions = {
      ...(baseOptions && typeof baseOptions === "object" ? baseOptions : {}),
    };
    delete nextOptions.preservePayloadStateStamp;
    delete nextOptions.skipOwnerMonotonicRestamp;
    delete nextOptions.skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical;
    delete nextOptions.avoidCurrentHistoryInsertion;
    delete nextOptions.minimumLeadFromCurrentHistory;
    delete nextOptions.maximumLeadFromCurrentHistory;
    delete nextOptions.maximumHistorySafeLeadOverride;
    delete nextOptions.historyLeadUsesCurrentSessionStamp;
    delete nextOptions.historyLeadUsesImmediateSessionStamp;
    delete nextOptions.historyLeadUsesPresentedSessionStamp;
    delete nextOptions.historyLeadPresentedMaximumFutureLead;
    return nextOptions;
  }

  function splitContiguousFreshAcquirePayloadGroups(payloads = []) {
    const groups = [];
    let currentGroup = [];
    let currentFreshAcquireState = null;

    for (const payload of Array.isArray(payloads) ? payloads : []) {
      const isFreshAcquire = isFreshAcquireLifecycleUpdate(payload);
      if (
        currentGroup.length > 0 &&
        currentFreshAcquireState !== isFreshAcquire
      ) {
        groups.push({
          isFreshAcquire: currentFreshAcquireState,
          updates: currentGroup,
        });
        currentGroup = [];
      }
      if (currentGroup.length === 0) {
        currentFreshAcquireState = isFreshAcquire;
      }
      currentGroup.push(payload);
    }

    if (currentGroup.length > 0) {
      groups.push({
        isFreshAcquire: currentFreshAcquireState,
        updates: currentGroup,
      });
    }

    return groups;
  }

  function queueTickDestinyPresentationUpdates(
    runtime,
    session,
    updates,
    options = {},
  ) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(updates) ||
      updates.length === 0
    ) {
      return 0;
    }

    const queuedSendOptions =
      options &&
      options.sendOptions &&
      typeof options.sendOptions === "object"
        ? options.sendOptions
        : null;
    const normalizedQueuedSendOptions =
      normalizeQueuedPresentationSendOptions(queuedSendOptions);

    if (!runtime.hasActiveTickDestinyPresentationBatch()) {
      runtime.sendDestinyUpdates(session, updates, false, {
        ...normalizedQueuedSendOptions,
      });
      return updates.length;
    }

    const batch = runtime._tickDestinyPresentation;
    const sessionKey = `${toInt(session.clientID, 0)}`;
    let queued = batch.bySession.get(sessionKey);
    if (!queued) {
      queued = {
        session,
        updates: [],
        dedupeIndexes: new Map(),
      };
      batch.bySession.set(sessionKey, queued);
    }

    const getDedupeKey =
      typeof options.getDedupeKey === "function"
        ? options.getDedupeKey
        : null;

    for (const update of updates) {
      if (!update || !Number.isFinite(Number(update.stamp))) {
        continue;
      }
      const dedupeKey = getDedupeKey ? getDedupeKey(update) : null;
      const queuedEntry = {
        update,
        order: batch.nextOrder++,
        sendOptions: normalizedQueuedSendOptions,
      };
      if (dedupeKey && queued.dedupeIndexes.has(dedupeKey)) {
        const existingIndex = queued.dedupeIndexes.get(dedupeKey);
        queuedEntry.order = queued.updates[existingIndex].order;
        queued.updates[existingIndex] = queuedEntry;
        continue;
      }
      if (dedupeKey) {
        queued.dedupeIndexes.set(dedupeKey, queued.updates.length);
      }
      queued.updates.push(queuedEntry);
    }

    if (shouldLogMissilePayloadGroup(updates)) {
      logMissileDebug("destiny.presentation-queue", {
        rawSimTimeMs: roundNumber(runtime.getCurrentSimTimeMs(), 3),
        session: buildMissileSessionSnapshot(runtime, session),
        queuedCount: queued.updates.length,
        sendOptions: normalizeTraceValue(normalizedQueuedSendOptions),
        updates: summarizeMissileUpdatesForLog(updates),
      });
    }

    return updates.length;
  }

  function flushTickDestinyPresentationBatch(runtime) {
    if (!runtime.hasActiveTickDestinyPresentationBatch()) {
      return;
    }

    const batch = runtime._tickDestinyPresentation;
    runtime._tickDestinyPresentation = null;

    for (const queued of batch.bySession.values()) {
      if (
        !queued ||
        !queued.session ||
        !Array.isArray(queued.updates) ||
        queued.updates.length === 0
      ) {
        continue;
      }

      const orderedEntries = queued.updates
        .slice()
        .sort((left, right) => {
          const leftStamp = toInt(left && left.update && left.update.stamp, 0) >>> 0;
          const rightStamp = toInt(right && right.update && right.update.stamp, 0) >>> 0;
          if (leftStamp !== rightStamp) {
            return leftStamp - rightStamp;
          }
          return toInt(left && left.order, 0) - toInt(right && right.order, 0);
        });
      if (orderedEntries.length <= 0) {
        continue;
      }

      let currentGroupUpdates = [];
      let currentGroupSendOptions = null;
      let currentGroupSignature = "";
      const flushQueuedGroup = () => {
        if (currentGroupUpdates.length <= 0) {
          return;
        }
        if (shouldLogMissilePayloadGroup(currentGroupUpdates)) {
          logMissileDebug("destiny.presentation-flush", {
            rawSimTimeMs: roundNumber(runtime.getCurrentSimTimeMs(), 3),
            session: buildMissileSessionSnapshot(runtime, queued.session),
            sendOptions: normalizeTraceValue(currentGroupSendOptions),
            updates: summarizeMissileUpdatesForLog(currentGroupUpdates),
          });
        }
        runtime.sendDestinyUpdates(queued.session, currentGroupUpdates, false, {
          ...currentGroupSendOptions,
        });
      };

      for (const entry of orderedEntries) {
        const update = entry && entry.update;
        if (!update) {
          continue;
        }
        const entrySendOptions = normalizeQueuedPresentationSendOptions(
          entry && entry.sendOptions,
        );
        const entrySignature =
          buildQueuedPresentationSendOptionsSignature(entrySendOptions);
        if (
          currentGroupUpdates.length > 0 &&
          entrySignature !== currentGroupSignature
        ) {
          flushQueuedGroup();
          currentGroupUpdates = [];
          currentGroupSendOptions = null;
          currentGroupSignature = "";
        }
        if (currentGroupUpdates.length <= 0) {
          currentGroupSendOptions = entrySendOptions;
          currentGroupSignature = entrySignature;
        }
        currentGroupUpdates.push(update);
      }

      flushQueuedGroup();
    }
  }

  function sendDestinyUpdates(
    runtime,
    session,
    payloads,
    waitForBubble = false,
    options = {},
  ) {
    if (!session || payloads.length === 0) {
      return 0;
    }

    runtime.refreshSessionClockSnapshot(session);
    const rawSimTimeMs = runtime.getCurrentSimTimeMs();
    const currentRawDispatchStamp = runtime.getCurrentDestinyStamp(rawSimTimeMs);
    const shouldTraceMissileDispatch =
      shouldLogMissilePayloadGroup(payloads) ||
      payloads.some((payload) => (
        payload &&
        Array.isArray(payload.payload) &&
        payload.payload[0] === "SetState"
      )) ||
      typeof options.missileDebugReason === "string";
    const destinyCallTraceID = shouldTraceMissileDispatch
      ? getNextMissileDebugTraceID()
      : 0;
    const sessionBeforeSend = shouldTraceMissileDispatch
      ? buildMissileSessionSnapshot(runtime, session, rawSimTimeMs)
      : null;

    if (shouldSplitMixedFreshAcquirePayloads(payloads, options)) {
      const payloadGroups = splitContiguousFreshAcquirePayloadGroups(payloads);
      if (shouldTraceMissileDispatch) {
        logMissileDebug("destiny.split-mixed-fresh-acquire-batch", {
          rawDispatchStamp: currentRawDispatchStamp,
          rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
          waitForBubble,
          session: sessionBeforeSend,
          sendOptions: normalizeTraceValue(options),
          groups: payloadGroups.map((group) => ({
            isFreshAcquire: group.isFreshAcquire,
            updateCount: group.updates.length,
            updates: summarizeMissileUpdatesForLog(group.updates),
          })),
        });
      }
      let highestEmittedGroupStamp = 0;
      let allowWaitForBubble = waitForBubble;
      for (const group of payloadGroups) {
        if (!group || !Array.isArray(group.updates) || group.updates.length === 0) {
          continue;
        }
        const groupOptions = group.isFreshAcquire
          ? options
          : buildNonFreshMixedPayloadSendOptions(options);
        const emittedStamp = sendDestinyUpdates(
          runtime,
          session,
          group.updates,
          allowWaitForBubble,
          groupOptions,
        );
        highestEmittedGroupStamp = Math.max(
          highestEmittedGroupStamp,
          toInt(emittedStamp, 0) >>> 0,
        ) >>> 0;
        allowWaitForBubble = false;
      }
      return highestEmittedGroupStamp >>> 0;
    }

    if (shouldTraceMissileDispatch) {
      logMissileDebug("destiny.send-request", {
        destinyCallTraceID,
        rawDispatchStamp: currentRawDispatchStamp,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        waitForBubble,
        sendReason:
          typeof options.missileDebugReason === "string"
            ? options.missileDebugReason
            : null,
        session: sessionBeforeSend,
        payloads: summarizeMissileUpdatesForLog(payloads),
      });
    }
    let groupedUpdates = [];
    let currentStamp = null;
    let firstGroup = true;
    let highestEmittedStamp = 0;
    const emittedGroupSummaries = [];
    let lastFreshAcquireLifecycleStamp = toInt(
      session &&
      session._space &&
      session._space.lastFreshAcquireLifecycleStamp,
      0,
    ) >>> 0;
    let lastMissileLifecycleStamp = toInt(
      session &&
      session._space &&
      session._space.lastMissileLifecycleStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileLifecycleStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileLifecycleStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileLifecycleAnchorStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileLifecycleAnchorStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileFreshAcquireStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireAnchorStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileFreshAcquireAnchorStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileFreshAcquireRawDispatchStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileFreshAcquireRawDispatchStamp,
      0,
    ) >>> 0;
    let lastOwnerMissileLifecycleRawDispatchStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerMissileLifecycleRawDispatchStamp,
      0,
    ) >>> 0;
    let lastOwnerNonMissileCriticalStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerNonMissileCriticalStamp,
      0,
    ) >>> 0;
    let lastOwnerNonMissileCriticalRawDispatchStamp = toInt(
      session &&
      session._space &&
      session._space.lastOwnerNonMissileCriticalRawDispatchStamp,
      0,
    ) >>> 0;
    const flushGroup = () => {
      if (groupedUpdates.length === 0) {
        return;
      }

      const emitGroupedUpdates = (updatesGroup, emitOptions = {}) => {
        if (!Array.isArray(updatesGroup) || updatesGroup.length === 0) {
          return 0;
        }

        let localUpdates = updatesGroup;
        let localStamp = toInt(localUpdates[0] && localUpdates[0].stamp, 0) >>> 0;
        const minimumPostFreshAcquireStamp = toInt(
          emitOptions && emitOptions.minimumPostFreshAcquireStamp,
          0,
        ) >>> 0;
        const isFreshAcquireLifecycleGroup = localUpdates.some(
          (payload) => payload && payload.freshAcquireLifecycleGroup === true,
        );
        const isMissileLifecycleGroup = localUpdates.some(
          (payload) => (
            payload &&
            (
              payload.missileLifecycleGroup === true ||
              payload.ownerMissileLifecycleGroup === true
            )
          ),
        );
        const isOwnerMissileLifecycleGroup = localUpdates.some(
          (payload) => payload && payload.ownerMissileLifecycleGroup === true,
        );
        const isSetStateGroup = localUpdates.some((payload) => (
          payload &&
          Array.isArray(payload.payload) &&
          payload.payload[0] === "SetState"
        ));
        const originalStamp = localStamp >>> 0;
        const traceDetails =
          shouldTraceMissileDispatch || isSetStateGroup
            ? {
                destinyCallTraceID,
                rawDispatchStamp: currentRawDispatchStamp,
                rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
                waitForBubble: waitForBubble && firstGroup,
                sendReason:
                  typeof emitOptions.missileDebugReason === "string"
                    ? emitOptions.missileDebugReason
                    : null,
                groupReason:
                  typeof emitOptions.groupReason === "string"
                    ? emitOptions.groupReason
                    : null,
                requestedMinimumPostFreshAcquireStamp: minimumPostFreshAcquireStamp,
                sessionBefore: buildMissileSessionSnapshot(
                  runtime,
                  session,
                  rawSimTimeMs,
                ),
                originalStamp,
                originalUpdates: summarizeMissileUpdatesForLog(localUpdates),
                groupFlags: {
                  freshAcquireLifecycle: isFreshAcquireLifecycleGroup,
                  missileLifecycle: isMissileLifecycleGroup,
                  ownerMissileLifecycle: isOwnerMissileLifecycleGroup,
                  setState: isSetStateGroup,
                },
                restampSteps: [],
              }
            : null;
        const restampLocalUpdates = (nextStamp) => {
          if ((nextStamp >>> 0) === (localStamp >>> 0)) {
            return false;
          }
          localUpdates = localUpdates.map((payload) => ({
            ...payload,
            stamp: nextStamp,
            payload:
              options &&
              options.preservePayloadStateStamp === true &&
              payload &&
              payload.freshAcquireLifecycleGroup === true
                ? payload.payload
                : destiny.restampPayloadState(payload.payload, nextStamp),
          }));
          localStamp = nextStamp >>> 0;
          return true;
        };
        const recordFloorStage = (reason, candidateStamp, metadata = {}) => {
          if (!traceDetails) {
            if (
              candidateStamp > 0 &&
              (localStamp >>> 0) < (candidateStamp >>> 0)
            ) {
              restampLocalUpdates(candidateStamp);
            }
            return;
          }
          const beforeStamp = localStamp >>> 0;
          const normalizedCandidateStamp = toInt(candidateStamp, 0) >>> 0;
          const applied =
            normalizedCandidateStamp > 0 &&
            beforeStamp < normalizedCandidateStamp;
          if (applied) {
            restampLocalUpdates(normalizedCandidateStamp);
          }
          traceDetails.restampSteps.push({
            reason,
            kind: "floor",
            beforeStamp,
            candidateStamp: normalizedCandidateStamp,
            applied,
            afterStamp: localStamp >>> 0,
            ...metadata,
          });
        };
        const recordCeilingStage = (reason, candidateStamp, metadata = {}) => {
          const beforeUpdates =
            metadata && metadata.captureBeforeUpdates === true
              ? summarizeMissileUpdatesForLog(localUpdates)
              : null;
          if (!traceDetails) {
            if (
              candidateStamp > 0 &&
              (localStamp >>> 0) > (candidateStamp >>> 0)
            ) {
              restampLocalUpdates(candidateStamp);
            }
            return;
          }
          const beforeStamp = localStamp >>> 0;
          const normalizedCandidateStamp = toInt(candidateStamp, 0) >>> 0;
          const applied =
            normalizedCandidateStamp > 0 &&
            beforeStamp > normalizedCandidateStamp;
          if (applied) {
            restampLocalUpdates(normalizedCandidateStamp);
          }
          traceDetails.restampSteps.push({
            reason,
            kind: "ceiling",
            beforeStamp,
            candidateStamp: normalizedCandidateStamp,
            applied,
            afterStamp: localStamp >>> 0,
            beforeUpdates,
            ...metadata,
          });
        };

        const currentSessionStamp = runtime.getCurrentSessionDestinyStamp(
          session,
          rawSimTimeMs,
        );
        const currentImmediateSessionStamp =
          runtime.getImmediateDestinyStampForSession(
            session,
            currentSessionStamp,
          );
        const lastOwnerPilotCommandMovementStamp = toInt(
          session &&
          session._space &&
          session._space.lastPilotCommandMovementStamp,
          0,
        ) >>> 0;
        const lastOwnerPilotCommandMovementAnchorStamp = toInt(
          session &&
          session._space &&
          session._space.lastPilotCommandMovementAnchorStamp,
          0,
        ) >>> 0;
        const lastOwnerPilotCommandMovementRawDispatchStamp = toInt(
          session &&
          session._space &&
          session._space.lastPilotCommandMovementRawDispatchStamp,
          0,
        ) >>> 0;
        const lifecyclePreviousLastSentDestinyStamp = toInt(
          session &&
          session._space &&
          session._space.lastSentDestinyStamp,
          0,
        ) >>> 0;
        const lifecyclePreviousLastSentDestinyRawDispatchStamp = toInt(
          session &&
          session._space &&
          session._space.lastSentDestinyRawDispatchStamp,
          0,
        ) >>> 0;
        const lifecyclePreviousLastSentDestinyWasOwnerCritical =
          session &&
          session._space &&
          session._space.lastSentDestinyWasOwnerCritical === true;
        const lifecycleRestampState = resolveDestinyLifecycleRestampState({
          localStamp,
          minimumPostFreshAcquireStamp,
          isFreshAcquireLifecycleGroup,
          isMissileLifecycleGroup,
          isOwnerMissileLifecycleGroup,
          currentSessionStamp,
          currentImmediateSessionStamp,
          currentRawDispatchStamp,
          lastFreshAcquireLifecycleStamp,
          lastMissileLifecycleStamp,
          lastOwnerMissileLifecycleStamp,
          lastOwnerMissileFreshAcquireStamp,
          lastOwnerMissileFreshAcquireRawDispatchStamp,
          lastOwnerMissileLifecycleRawDispatchStamp,
          previousLastSentDestinyStamp: lifecyclePreviousLastSentDestinyStamp,
          previousLastSentDestinyRawDispatchStamp:
            lifecyclePreviousLastSentDestinyRawDispatchStamp,
          previousLastSentDestinyWasOwnerCritical:
            lifecyclePreviousLastSentDestinyWasOwnerCritical,
          lastOwnerPilotCommandMovementStamp,
          lastOwnerPilotCommandMovementAnchorStamp,
          lastOwnerPilotCommandMovementRawDispatchStamp,
        });
        if (traceDetails && lifecycleRestampState.freshAcquireFloor) {
          traceDetails.freshAcquireFloor = lifecycleRestampState.freshAcquireFloor;
        }
        if (traceDetails && lifecycleRestampState.missileLifecycleFloor) {
          traceDetails.missileLifecycleFloor = lifecycleRestampState.missileLifecycleFloor;
        }
        if (traceDetails && lifecycleRestampState.ownerMissileLifecycleFloor) {
          traceDetails.ownerMissileLifecycleFloor =
            lifecycleRestampState.ownerMissileLifecycleFloor;
        }
        recordFloorStage(
          "lifecycle.finalStamp",
          lifecycleRestampState.finalStamp,
          {
            freshAcquireFloor: lifecycleRestampState.freshAcquireFloor,
            missileLifecycleFloor: lifecycleRestampState.missileLifecycleFloor,
            ownerMissileLifecycleFloor:
              lifecycleRestampState.ownerMissileLifecycleFloor,
          },
        );
        // CCP parity: cap per-session monotonic floors to
        // sessionStamp + ECHO_LEAD so they never push events beyond
        // delta 2 from the client.  Without this cap, missile lifecycle
        // events (sent at lead ~2 via getHistorySafeDestinyStamp) inflate
        // lastSentStamp, and the sameRaw/crossRaw floors then push NPC
        // prop toggles and other critical events to the same high stamp.
        // With many NPCs this creates 3+ tick gaps between consecutive
        // events → jolt → client fast-forward → later events in the
        // past → full desync.
        const sessionStampFloorCap = (
          currentSessionStamp +
          MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD
        ) >>> 0;
        const rawSameRawPublishedLastSentFloor =
          lifecyclePreviousLastSentDestinyStamp > 0 &&
          lifecyclePreviousLastSentDestinyRawDispatchStamp > 0 &&
          lifecyclePreviousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp
            ? lifecyclePreviousLastSentDestinyStamp
            : 0;
        const sameRawPublishedLastSentFloor =
          rawSameRawPublishedLastSentFloor > sessionStampFloorCap
            ? sessionStampFloorCap
            : rawSameRawPublishedLastSentFloor;
        recordFloorStage(
          "published.sameRawLastSentFloor",
          sameRawPublishedLastSentFloor,
        );
        // CCP parity: within a single dispatch tick, events share a
        // narrow stamp window (the same tick or +1).  The original
        // crossRawLastSentFloor pushed ALL events to the session's
        // highest-ever-sent stamp, which propagated any inflated stamp
        // (e.g. from missile RemoveBalls lifecycle clamping) to every
        // subsequent event.  With many NPCs, this creates a 3+ tick gap
        // between normal events (lead ~1) and floored events (lead ~4+),
        // which triggers SynchroniseToSimulationTime jolts and eventually
        // full client desync when later events land behind the client's
        // fast-forwarded _current_time.
        //
        // Cap the floor to currentSessionStamp + ECHO_LEAD (1).  This
        // keeps the floor within delta 2 of the client (safely inside
        // Michelle's held-future window) and prevents runaway inflation.
        // A one-time monotonicity dip (if lastSent was previously
        // inflated) is far less harmful than sustained lead inflation.
        if (
          lifecyclePreviousLastSentDestinyStamp > 0 &&
          lifecyclePreviousLastSentDestinyRawDispatchStamp > 0 &&
          lifecyclePreviousLastSentDestinyRawDispatchStamp !== currentRawDispatchStamp
        ) {
          const cappedCrossRawLastSentFloor =
            lifecyclePreviousLastSentDestinyStamp > sessionStampFloorCap
              ? sessionStampFloorCap
              : lifecyclePreviousLastSentDestinyStamp;
          recordFloorStage(
            "published.crossRawLastSentFloor",
            cappedCrossRawLastSentFloor,
          );
        }

        const ownerShipID =
          session && session._space
            ? (toInt(session._space.shipID, 0) >>> 0)
            : 0;
        const skipOwnerMonotonicRestamp =
          options && options.skipOwnerMonotonicRestamp === true;
        const containsMovementContractPayload =
          updatesContainMovementContractPayload(localUpdates);
        const isOwnerPilotMovementGroup =
          ownerShipID > 0 &&
          localUpdates.some((update) => {
            const payload = update && Array.isArray(update.payload)
              ? update.payload
              : null;
            if (!payload) {
              return false;
            }
            if (!isMovementContractPayload(payload)) {
              return false;
            }
            return getPayloadPrimaryEntityID(payload) === ownerShipID;
          });
        const isOwnerDamageStateGroup =
          ownerShipID > 0 &&
          localUpdates.some((update) => {
            const payload = update && Array.isArray(update.payload)
              ? update.payload
              : null;
            if (!payload || payload[0] !== "OnDamageStateChange") {
              return false;
            }
            return (toInt(payload[1] && payload[1][0], 0) >>> 0) === ownerShipID;
          });
        const isOwnerCriticalGroup =
          ownerShipID > 0 &&
          (
            isOwnerMissileLifecycleGroup ||
            isSetStateGroup ||
            isOwnerPilotMovementGroup
          );
        const previousLastSentDestinyStamp = toInt(
          session && session._space && session._space.lastSentDestinyStamp,
          0,
        ) >>> 0;
        const previousLastSentDestinyRawDispatchStamp = toInt(
          session && session._space && session._space.lastSentDestinyRawDispatchStamp,
          0,
        ) >>> 0;
        const previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane =
          session &&
          session._space &&
          session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true;
        const previousLastSentDestinyWasOwnerCritical =
          resolvePreviousLastSentDestinyWasOwnerCritical({
            explicitWasOwnerCritical:
              session &&
              session._space &&
              typeof session._space.lastSentDestinyWasOwnerCritical === "boolean"
                ? session._space.lastSentDestinyWasOwnerCritical === true
                : undefined,
            previousLastSentDestinyStamp,
            lastOwnerMissileLifecycleStamp,
            lastOwnerMissileFreshAcquireStamp,
            lastOwnerNonMissileCriticalStamp,
            lastOwnerPilotCommandMovementStamp,
          });
        const containsObserverPresentedMonotonicPayload =
          updatesContainObserverPresentedMonotonicPayload(
            localUpdates,
            ownerShipID,
          );
        const currentPresentedObserverStamp =
          containsObserverPresentedMonotonicPayload &&
          previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane !== true
            ? runtime.getCurrentPresentedSessionDestinyStamp(
                session,
                rawSimTimeMs,
                (
                  MICHELLE_HELD_FUTURE_DESTINY_LEAD +
                  MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD
                ) >>> 0,
              ) >>> 0
            : 0;
        const rawPresentedOwnerCriticalStamp =
          ownerShipID > 0
            ? runtime.getCurrentPresentedSessionDestinyStamp(
                session,
                rawSimTimeMs,
                PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              ) >>> 0
            : 0;
        const currentPresentedOwnerCriticalStamp =
          isMissileLifecycleGroup &&
          isOwnerMissileLifecycleGroup !== true
            ? Math.min(
                rawPresentedOwnerCriticalStamp,
                ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
              ) >>> 0
            : rawPresentedOwnerCriticalStamp;
        const observerDirectPresentedMonotonicFloor =
          !isOwnerCriticalGroup &&
          !isOwnerDamageStateGroup &&
          containsObserverPresentedMonotonicPayload
            ? currentPresentedObserverStamp
            : 0;
        const sameRawNonCriticalPresentedLaneHasClearedOwnerFreshAcquireLane =
          previousLastSentDestinyStamp > 0 &&
          previousLastSentDestinyRawDispatchStamp > 0 &&
          previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp &&
          currentPresentedOwnerCriticalStamp > 0 &&
          previousLastSentDestinyStamp === currentPresentedOwnerCriticalStamp &&
          Math.max(
            toInt(lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
            toInt(lastFreshAcquireLifecycleStamp, 0) >>> 0,
          ) > 0 &&
          previousLastSentDestinyStamp >
            Math.max(
              toInt(lastOwnerMissileFreshAcquireStamp, 0) >>> 0,
              toInt(lastFreshAcquireLifecycleStamp, 0) >>> 0,
            );
        const skipOwnerMonotonicRestampForNonCriticalPresentedLane =
          skipOwnerMonotonicRestamp !== true &&
          options &&
          options.skipOwnerMonotonicRestampWhenPreviousNotOwnerCritical === true &&
          isOwnerMissileLifecycleGroup === true &&
          isFreshAcquireLifecycleGroup === true &&
          !sameRawNonCriticalPresentedLaneHasClearedOwnerFreshAcquireLane &&
          previousLastSentDestinyWasOwnerCritical !== true &&
          !(
            previousLastSentDestinyStamp > 0 &&
            previousLastSentDestinyStamp === lastOwnerMissileLifecycleStamp &&
            previousLastSentDestinyStamp !== lastOwnerMissileFreshAcquireStamp
          ) &&
          previousLastSentDestinyStamp > 0 &&
          previousLastSentDestinyStamp === currentPresentedOwnerCriticalStamp &&
          previousLastSentDestinyRawDispatchStamp > 0 &&
          previousLastSentDestinyRawDispatchStamp === currentRawDispatchStamp;
        const ownerMonotonicState = (
          skipOwnerMonotonicRestamp ||
          skipOwnerMonotonicRestampForNonCriticalPresentedLane
        )
          ? {
              maximumTrustedRecentEmittedOwnerCriticalStamp: 0,
              projectedRecentLastSentLane: 0,
              presentedLastSentMonotonicFloor: 0,
              genericMonotonicFloor: 0,
              recentOwnerCriticalMonotonicFloor: 0,
              ownerCriticalCeilingStamp: 0,
            }
          : resolveOwnerMonotonicState({
              hasOwnerShip: ownerShipID > 0,
              containsMovementContractPayload,
              isSetStateGroup,
              isOwnerPilotMovementGroup,
              isMissileLifecycleGroup,
              isOwnerMissileLifecycleGroup,
              isOwnerCriticalGroup,
              isFreshAcquireLifecycleGroup,
              isOwnerDamageStateGroup,
              currentLocalStamp: localStamp,
              currentSessionStamp,
              currentImmediateSessionStamp,
              currentPresentedOwnerCriticalStamp,
              currentRawDispatchStamp,
              recentEmittedOwnerCriticalMaxLead:
                MICHELLE_HELD_FUTURE_DESTINY_LEAD +
                MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD +
                PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS,
              ownerCriticalCeilingLead: MICHELLE_DIRECT_CRITICAL_ECHO_DESTINY_LEAD,
              previousLastSentDestinyStamp,
              previousLastSentDestinyRawDispatchStamp,
              previousLastSentDestinyExplicitWasOwnerCritical:
                session &&
                session._space &&
                typeof session._space.lastSentDestinyWasOwnerCritical === "boolean"
                  ? session._space.lastSentDestinyWasOwnerCritical === true
                  : false,
              previousLastSentDestinyWasOwnerCritical,
              previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane:
                session &&
                session._space &&
                session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane === true,
              lastOwnerPilotCommandMovementStamp,
              lastOwnerPilotCommandMovementAnchorStamp,
              lastOwnerPilotCommandMovementRawDispatchStamp,
              lastOwnerNonMissileCriticalStamp,
              lastOwnerMissileLifecycleStamp,
              lastOwnerMissileLifecycleAnchorStamp,
              lastOwnerMissileLifecycleRawDispatchStamp,
              lastOwnerMissileFreshAcquireStamp,
              lastOwnerMissileFreshAcquireAnchorStamp,
              lastOwnerMissileFreshAcquireRawDispatchStamp,
              allowAdjacentRawFreshAcquireLaneReuse:
                options &&
                options.allowAdjacentRawFreshAcquireLaneReuse === true,
            });
        const {
          maximumTrustedRecentEmittedOwnerCriticalStamp,
          projectedRecentLastSentLane,
          presentedLastSentMonotonicFloor,
          genericMonotonicFloor,
          recentOwnerCriticalMonotonicFloor,
          ownerCriticalCeilingStamp,
          decisionSummary: ownerMonotonicDecisionSummary,
        } = ownerMonotonicState;
        if (traceDetails) {
          traceDetails.genericMonotonicFloor = {
            ownerShipID,
            containsMovementContractPayload,
            isOwnerCriticalGroup,
            isOwnerDamageStateGroup,
            isOwnerPilotMovementGroup,
            previousLastSentDestinyStamp,
            previousLastSentDestinyRawDispatchStamp,
            previousLastSentDestinyWasOwnerCritical,
            currentPresentedOwnerCriticalStamp,
            skipOwnerMonotonicRestamp,
            skipOwnerMonotonicRestampForNonCriticalPresentedLane,
            allowAdjacentRawFreshAcquireLaneReuse:
              options &&
              options.allowAdjacentRawFreshAcquireLaneReuse === true,
            maximumTrustedRecentEmittedOwnerCriticalStamp,
            projectedRecentLastSentLane,
            presentedLastSentMonotonicFloor,
            genericMonotonicFloor,
            recentOwnerCriticalMonotonicFloor,
            ownerCriticalCeilingStamp,
          };
          traceDetails.ownerMonotonicDecisionTrace =
            ownerMonotonicDecisionSummary || null;
        }
        recordFloorStage(
          "owner.presentedLastSentMonotonicFloor",
          presentedLastSentMonotonicFloor,
        );
        recordFloorStage(
          "owner.genericMonotonicFloor",
          genericMonotonicFloor,
        );
        recordFloorStage(
          "owner.recentOwnerCriticalMonotonicFloor",
          recentOwnerCriticalMonotonicFloor,
        );
        if (traceDetails) {
          traceDetails.observerDirectPresentedMonotonicFloor = {
            ownerShipID,
            containsObserverPresentedMonotonicPayload,
            currentPresentedObserverStamp,
            previousLastSentDestinyOnlyStaleProjectedOwnerMissileLane,
            observerDirectPresentedMonotonicFloor,
          };
        }
        // `client/badjolting.txt` exposed a non-missile observer movement gap:
        // an NPC Orbit was first restamped onto the correct projected lane
        // (1775143485), then the generic observer held-future ceiling dragged
        // it back onto the already-consumed presented lane (1775143484). When
        // that later notification arrived, Michelle had already rebased to
        // 1775143485 and rewound to execute the stale Orbit.
        //
        // Keep non-owner movement contracts one tick past the already-presented
        // observer lane when a previously emitted owner-critical lane has
        // already projected beyond it. This is deliberately narrow:
        // - movement contracts only
        // - non-missile observer traffic only
        // - only when owner-critical history is the thing that advanced the
        //   projected lane
        const observerMovementContractProjectedClearFloor =
          containsMovementContractPayload &&
          !isMissileLifecycleGroup &&
          !isOwnerCriticalGroup &&
          !isOwnerDamageStateGroup &&
          previousLastSentDestinyWasOwnerCritical === true &&
          currentPresentedObserverStamp > 0 &&
          projectedRecentLastSentLane > currentPresentedObserverStamp
            ? ((currentPresentedObserverStamp + 1) >>> 0)
            : 0;
        if (traceDetails) {
          traceDetails.observerMovementContractProjectedClearFloor = {
            ownerShipID,
            containsMovementContractPayload,
            previousLastSentDestinyWasOwnerCritical,
            currentPresentedObserverStamp,
            projectedRecentLastSentLane,
            observerMovementContractProjectedClearFloor,
          };
        }
        // Narrow `jolts.txt` fix: only clear the already-presented observer lane
        // for non-owner missile teardown when owner monotonic history is what
        // pushed that teardown onto the stale post-held lane. This avoids
        // regressing the steady held-future cadence validated by `glitch.txt`
        // while still fixing the real late RemoveBalls rewinds.
        const observerMissileLifecyclePostHeldClearFloor =
          isMissileLifecycleGroup &&
          !isOwnerCriticalGroup &&
          !isOwnerDamageStateGroup &&
          isFreshAcquireLifecycleGroup !== true &&
          currentPresentedObserverStamp > 0 &&
          currentPresentedObserverStamp >= (
            (currentSessionStamp + MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD) >>> 0
          ) &&
          recentOwnerCriticalMonotonicFloor >= currentPresentedObserverStamp
            ? ((currentPresentedObserverStamp + 1) >>> 0)
            : 0;
        if (traceDetails) {
          traceDetails.observerMissileLifecyclePostHeldClearFloor = {
            ownerShipID,
            isMissileLifecycleGroup,
            isFreshAcquireLifecycleGroup,
            currentSessionStamp,
            currentPresentedObserverStamp,
            recentOwnerCriticalMonotonicFloor,
            observerMissileLifecyclePostHeldClearFloor,
          };
        }
        recordFloorStage(
          "observer.directPresentedMonotonicFloor",
          observerDirectPresentedMonotonicFloor,
        );
        recordFloorStage(
          "observer.movementContractProjectedClearFloor",
          observerMovementContractProjectedClearFloor,
        );
        recordFloorStage(
          "observer.missileLifecyclePostHeldClearFloor",
          observerMissileLifecyclePostHeldClearFloor,
        );
        recordCeilingStage(
          "owner.ownerCriticalCeilingStamp",
          ownerCriticalCeilingStamp,
          {
            ownerCriticalCeilingStamp,
            captureBeforeUpdates: true,
          },
        );
        if (
          ownerCriticalCeilingStamp > 0 &&
          traceDetails &&
          traceDetails.restampSteps.length > 0
        ) {
          const latestRestampStep =
            traceDetails.restampSteps[traceDetails.restampSteps.length - 1];
          if (
            latestRestampStep &&
            latestRestampStep.reason === "owner.ownerCriticalCeilingStamp" &&
            latestRestampStep.applied === true
          ) {
            const unclampedStamp = latestRestampStep.beforeStamp >>> 0;
            const unclampedUpdates = Array.isArray(latestRestampStep.beforeUpdates)
              ? latestRestampStep.beforeUpdates
              : [];
            if (traceDetails) {
              traceDetails.ownerCriticalCeilingClamp = {
                unclampedStamp,
                clampedStamp: localStamp >>> 0,
                ownerCriticalCeilingStamp,
              };
            }
            logMissileDebug("destiny.owner-critical-ceiling-clamp", {
              destinyCallTraceID,
              rawDispatchStamp: currentRawDispatchStamp,
              rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
              ownerCriticalCeilingStamp,
              unclampedStamp,
              clampedStamp: localStamp >>> 0,
              session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
              unclampedUpdates,
              clampedUpdates: summarizeMissileUpdatesForLog(localUpdates),
              traceDetails: normalizeTraceValue(traceDetails),
            });
          }
        }

        // Non-owner missile lifecycle groups (NPC missiles hitting the
        // player) have no ownerCriticalCeilingStamp because they are neither
        // isOwnerCriticalGroup nor isOwnerDamageStateGroup. Without a
        // ceiling the lifecycle floor compounds stamps +1 per tick
        // indefinitely. When these stamps reach the client 10-30 ticks
        // ahead, Michelle triggers SynchroniseToSimulationTime which jumps
        // _current_time forward and re-extrapolates every ball = visible
        // jolt.
        //
        // But the ceiling itself must never drag the group back underneath a
        // lane we have already emitted for this session. `badjolt.txt` showed
        // exactly that failure: a same-raw owner movement burst had already
        // established 2712/2713, then the non-owner missile ceiling yanked a
        // later RemoveBalls group down to 2709, producing a full Michelle
        // rewind / UpdateStateRequest collapse.
        //
        // So: keep the held-future cap as the base ceiling, but clamp it up to
        // the monotonic floors we already derived for this session. That still
        // prevents runaway future lanes while preserving the "never backstep
        // under already-sent history" contract.
        if (
          isMissileLifecycleGroup &&
          !isOwnerCriticalGroup &&
          !isOwnerDamageStateGroup &&
          ownerCriticalCeilingStamp === 0
        ) {
          const missileLifecycleBaseCeilingStamp = Math.max(
            ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
            currentPresentedOwnerCriticalStamp,
          ) >>> 0;
          const missileLifecycleMonotonicFloor = Math.max(
            sameRawPublishedLastSentFloor,
            presentedLastSentMonotonicFloor,
            recentOwnerCriticalMonotonicFloor,
            observerDirectPresentedMonotonicFloor,
            observerMissileLifecyclePostHeldClearFloor,
          ) >>> 0;
          const missileLifecycleCeilingStamp = Math.max(
            missileLifecycleBaseCeilingStamp,
            missileLifecycleMonotonicFloor,
          ) >>> 0;
          recordCeilingStage(
            "missile.nonOwnerLifecycleCeiling",
            missileLifecycleCeilingStamp,
          );
        }

        // CCP parity: non-owner, non-missile events (e.g. NPC prop
        // toggle SetBallAgility/Mass/Speed/Massive broadcasts) have no
        // ceiling from owner-critical or missile-lifecycle paths.  The
        // session's various monotonic floors can push these events to
        // lead 3+ (delta 3+ from client), which triggers
        // SynchroniseToSimulationTime jolts and causes desync when the
        // client fast-forwards past later events.  Cap these events to
        // sessionStamp + HELD_FUTURE to stay within delta 2 of the
        // client — the same held-future window CCP uses.
        if (
          !isMissileLifecycleGroup &&
          !isOwnerCriticalGroup &&
          !isOwnerDamageStateGroup &&
          ownerCriticalCeilingStamp === 0
        ) {
          const observerBroadcastMonotonicFloor = Math.max(
            sameRawPublishedLastSentFloor,
            presentedLastSentMonotonicFloor,
            recentOwnerCriticalMonotonicFloor,
            observerDirectPresentedMonotonicFloor,
            observerMovementContractProjectedClearFloor,
            observerMissileLifecyclePostHeldClearFloor,
          ) >>> 0;
          const observerBroadcastCeilingStamp = Math.max(
            sessionStampFloorCap,
            ((currentSessionStamp + MICHELLE_HELD_FUTURE_DESTINY_LEAD) >>> 0),
            observerBroadcastMonotonicFloor,
          ) >>> 0;
          recordCeilingStage(
            "observer.heldFutureCeiling",
            observerBroadcastCeilingStamp,
          );
        }

        logDestinyDispatch(session, localUpdates, waitForBubble && firstGroup);
        if (
          traceDetails &&
          previousLastSentDestinyStamp > 0 &&
          localStamp < previousLastSentDestinyStamp
        ) {
          logMissileDebug("destiny.backstep-risk", {
            destinyCallTraceID,
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
            previousLastSentDestinyStamp,
            emittedStamp: localStamp >>> 0,
            session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
            updates: summarizeMissileUpdatesForLog(localUpdates),
            traceDetails: normalizeTraceValue(traceDetails),
          });
        }
        session.sendNotification(
          "DoDestinyUpdate",
          "clientID",
          destiny.buildDestinyUpdatePayload(
            localUpdates,
            waitForBubble && firstGroup,
          ),
        );
        if (session._space) {
          const previousSessionLastSentDestinyStamp = toInt(
            session._space.lastSentDestinyStamp,
            0,
          ) >>> 0;
          const localStampEstablishedLastSentLane =
            (localStamp >>> 0) > previousSessionLastSentDestinyStamp;
          const localStampMatchedLastSentLane =
            (localStamp >>> 0) === previousSessionLastSentDestinyStamp;
          session._space.lastSentDestinyStamp = Math.max(
            previousSessionLastSentDestinyStamp,
            localStamp,
          ) >>> 0;
          if (localStampEstablishedLastSentLane) {
            session._space.lastSentDestinyRawDispatchStamp =
              currentRawDispatchStamp;
            session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane =
              false;
            session._space.lastSentDestinyWasOwnerCritical =
              isOwnerCriticalGroup === true;
          } else if (
            localStampMatchedLastSentLane &&
            isOwnerCriticalGroup === true
          ) {
            // Refresh the raw-dispatch anchor when a real owner-critical send
            // reuses the same presented lane. Leaving the older raw anchor in
            // place makes later monotonic projection treat that lane as stale
            // and invent phantom future owner-critical floors.
            session._space.lastSentDestinyRawDispatchStamp = Math.max(
              toInt(session._space.lastSentDestinyRawDispatchStamp, 0) >>> 0,
              currentRawDispatchStamp,
            ) >>> 0;
            session._space.lastSentDestinyOnlyStaleProjectedOwnerMissileLane =
              false;
            session._space.lastSentDestinyWasOwnerCritical = true;
          }
          if (isSetStateGroup) {
            const previousOwnerNonMissileCriticalSessionStamp = toInt(
              session._space.lastOwnerNonMissileCriticalStamp,
              0,
            ) >>> 0;
            if (localStamp >= previousOwnerNonMissileCriticalSessionStamp) {
              session._space.lastOwnerNonMissileCriticalStamp = localStamp;
              lastOwnerNonMissileCriticalStamp = localStamp;
              session._space.lastOwnerNonMissileCriticalRawDispatchStamp =
                currentRawDispatchStamp;
              lastOwnerNonMissileCriticalRawDispatchStamp =
                currentRawDispatchStamp;
            }
          }
          if (isFreshAcquireLifecycleGroup && localStamp >= lastFreshAcquireLifecycleStamp) {
            session._space.lastFreshAcquireLifecycleStamp = localStamp;
            lastFreshAcquireLifecycleStamp = localStamp;
          }
          if (isMissileLifecycleGroup && localStamp >= lastMissileLifecycleStamp) {
            session._space.lastMissileLifecycleStamp = localStamp;
            lastMissileLifecycleStamp = localStamp;
          }
          // Owner damage-state is a separate Michelle path from owner missile
          // lifecycle. Letting plain `OnDamageStateChange` mutate the owner
          // missile-lifecycle anchor keeps fake "missile pressure" alive in
          // gun-only combat and pushes the next owner steer onto stale future
          // lanes.
          if (isOwnerMissileLifecycleGroup) {
            if (localStamp >= lastOwnerMissileLifecycleStamp) {
              session._space.lastOwnerMissileLifecycleStamp = localStamp;
              lastOwnerMissileLifecycleStamp = localStamp;
              session._space.lastOwnerMissileLifecycleAnchorStamp =
                currentSessionStamp;
              lastOwnerMissileLifecycleAnchorStamp = currentSessionStamp;
              session._space.lastOwnerMissileLifecycleRawDispatchStamp =
                currentRawDispatchStamp;
              lastOwnerMissileLifecycleRawDispatchStamp =
                currentRawDispatchStamp;
            }
          }
          if (isOwnerMissileLifecycleGroup) {
            if (
              isFreshAcquireLifecycleGroup &&
              localStamp >= lastOwnerMissileFreshAcquireStamp
            ) {
              session._space.lastOwnerMissileFreshAcquireStamp = localStamp;
              lastOwnerMissileFreshAcquireStamp = localStamp;
              session._space.lastOwnerMissileFreshAcquireAnchorStamp =
                currentSessionStamp;
              lastOwnerMissileFreshAcquireAnchorStamp =
                currentSessionStamp;
              session._space.lastOwnerMissileFreshAcquireRawDispatchStamp =
                currentRawDispatchStamp;
              lastOwnerMissileFreshAcquireRawDispatchStamp =
                currentRawDispatchStamp;
            }
          }
        }
        if (traceDetails) {
          traceDetails.finalStamp = localStamp >>> 0;
          traceDetails.emittedUpdates = summarizeMissileUpdatesForLog(localUpdates);
          traceDetails.sessionAfter = buildMissileSessionSnapshot(
            runtime,
            session,
            rawSimTimeMs,
          );
          traceDetails.sessionMutation = buildMissileSessionMutation(
            traceDetails.sessionBefore,
            traceDetails.sessionAfter,
          );
          emittedGroupSummaries.push({
            groupReason: traceDetails.groupReason,
            originalStamp: traceDetails.originalStamp,
            finalStamp: traceDetails.finalStamp,
            groupFlags: traceDetails.groupFlags,
            sessionMutation: traceDetails.sessionMutation,
            emittedUpdates: traceDetails.emittedUpdates,
          });
          logMissileDebug("destiny.emit-group", traceDetails);
        }
        firstGroup = false;
        highestEmittedStamp = Math.max(
          highestEmittedStamp,
          localStamp >>> 0,
        ) >>> 0;
        return localStamp >>> 0;
      };

      const hasMixedOwnerMissileFreshAcquireAndLifecycle = (
        groupedUpdates.some(
          (payload) =>
            payload &&
            payload.freshAcquireLifecycleGroup === true &&
            payload.ownerMissileLifecycleGroup === true,
        ) &&
        groupedUpdates.some(
          (payload) =>
            payload &&
            payload.ownerMissileLifecycleGroup === true &&
            payload.freshAcquireLifecycleGroup !== true,
        )
      );
      if (hasMixedOwnerMissileFreshAcquireAndLifecycle) {
        if (shouldTraceMissileDispatch) {
          logMissileDebug("destiny.split-owner-missile-group", {
            destinyCallTraceID,
            rawDispatchStamp: currentRawDispatchStamp,
            rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
            sendReason:
              typeof options.missileDebugReason === "string"
                ? options.missileDebugReason
                : null,
            session: buildMissileSessionSnapshot(runtime, session, rawSimTimeMs),
            updates: summarizeMissileUpdatesForLog(groupedUpdates),
          });
        }
        const freshAcquireUpdates = groupedUpdates.filter(
          (payload) => payload && payload.freshAcquireLifecycleGroup === true,
        );
        const lifecycleUpdates = groupedUpdates.filter(
          (payload) => !payload || payload.freshAcquireLifecycleGroup !== true,
        );
        const freshAcquireStamp = emitGroupedUpdates(freshAcquireUpdates, {
          missileDebugReason: options.missileDebugReason,
          groupReason: "owner-missile-fresh-acquire",
        });
        emitGroupedUpdates(lifecycleUpdates, {
          missileDebugReason: options.missileDebugReason,
          groupReason: "owner-missile-lifecycle",
          minimumPostFreshAcquireStamp:
            freshAcquireStamp > 0
              ? ((freshAcquireStamp + 1) >>> 0)
              : 0,
        });
        groupedUpdates = [];
        currentStamp = null;
        return;
      }

      emitGroupedUpdates(groupedUpdates, {
        missileDebugReason: options.missileDebugReason,
      });
      groupedUpdates = [];
      currentStamp = null;
    };

    for (const rawPayload of payloads) {
      const payload = runtime.prepareDestinyUpdateForSession(
        session,
        rawPayload,
        rawSimTimeMs,
        options,
      );
      const stamp = Number(payload && payload.stamp);
      if (groupedUpdates.length === 0) {
        groupedUpdates.push(payload);
        currentStamp = stamp;
        continue;
      }

      if (stamp === currentStamp) {
        groupedUpdates.push(payload);
        continue;
      }

      flushGroup();
      groupedUpdates.push(payload);
      currentStamp = stamp;
    }

    flushGroup();
    if (shouldTraceMissileDispatch) {
      const sessionAfterSend = buildMissileSessionSnapshot(
        runtime,
        session,
        rawSimTimeMs,
      );
      logMissileDebug("destiny.send-complete", {
        destinyCallTraceID,
        rawDispatchStamp: currentRawDispatchStamp,
        rawSimTimeMs: roundNumber(rawSimTimeMs, 3),
        waitForBubble,
        highestEmittedStamp,
        payloadCount: payloads.length,
        sessionBefore: sessionBeforeSend,
        sessionAfter: sessionAfterSend,
        sessionMutation: buildMissileSessionMutation(
          sessionBeforeSend,
          sessionAfterSend,
        ),
        emittedGroups: emittedGroupSummaries,
      });
    }
    return highestEmittedStamp >>> 0;
  }

  function sendDestinyBatch(runtime, session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    logDestinyDispatch(session, payloads, waitForBubble);
    session.sendNotification(
      "DoDestinyUpdate",
      "clientID",
      destiny.buildDestinyUpdatePayload(payloads, waitForBubble),
    );
  }

  function sendDestinyUpdatesIndividually(
    runtime,
    session,
    payloads,
    waitForBubble = false,
  ) {
    if (!session || payloads.length === 0) {
      return;
    }

    for (let index = 0; index < payloads.length; index += 1) {
      runtime.sendDestinyUpdates(
        session,
        [payloads[index]],
        waitForBubble && index === 0,
      );
    }
  }

  function sendMovementUpdatesToSession(runtime, session, updates) {
    if (!session || !isReadyForDestiny(session) || updates.length === 0) {
      return;
    }

    runtime.sendDestinyUpdates(session, updates);
  }

  return {
    getDestinyHistoryAnchorStampForSession,
    resolveDestinyDeliveryStampForSession,
    prepareDestinyUpdateForSession,
    beginTickDestinyPresentationBatch,
    hasActiveTickDestinyPresentationBatch,
    shouldDeferPilotMovementForMissilePressure,
    queueTickDestinyPresentationUpdates,
    flushTickDestinyPresentationBatch,
    sendDestinyUpdates,
    sendDestinyBatch,
    sendDestinyUpdatesIndividually,
    sendMovementUpdatesToSession,
  };
}

module.exports = {
  createMovementDestinyDispatch,
};

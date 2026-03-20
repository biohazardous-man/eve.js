const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const database = require(path.join(__dirname, "../../newDatabase"));
const spaceRuntime = require(path.join(__dirname, "../runtime"));
const {
  createSpaceItemForCharacter,
  grantItemToCharacterLocation,
  setActiveShipForCharacter,
  findShipItemById,
  removeInventoryItem,
  updateShipItem,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  getFittedModuleItems,
  selectAutoFitFlagForType,
  normalizeModuleState,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  buildNpcDefinition,
  listNpcProfiles,
  listNpcSpawnPools,
  listNpcSpawnGroups,
  listNpcSpawnSites,
  listNpcStartupRules,
  getNpcStartupRule,
  getNpcBehaviorProfile,
  getNpcLootTable,
  resolveNpcProfile,
  resolveNpcSpawnSite,
} = require(path.join(__dirname, "./npcData"));
const {
  resolveNpcSpawnPlan,
  resolveNpcSpawnGroupPlan,
} = require(path.join(__dirname, "./npcSelection"));
const {
  createNpcCharacter,
} = require(path.join(__dirname, "./npcOwners"));
const {
  seedNpcShipLoot,
} = require(path.join(__dirname, "./npcLoot"));
const {
  registerController,
  getControllerByEntityID,
  listControllers,
  listControllersBySystem,
  unregisterController,
} = require(path.join(__dirname, "./npcRegistry"));
const {
  tickScene: tickBehaviorScene,
  issueManualOrder,
  setBehaviorOverrides,
  normalizeBehaviorOverrides,
  noteIncomingAggression,
} = require(path.join(__dirname, "./npcBehaviorLoop"));
const {
  GATE_OPERATOR_KIND,
  getStartupRuleOverride,
  setStartupRuleEnabledOverride,
  getSystemGateControl,
  setSystemGateControl,
  toggleCharacterInvulnerability,
  setCharacterInvulnerability,
  isCharacterInvulnerable,
  listDynamicStartupRulesForSystem,
  getDynamicGateStartupRuleID,
} = require(path.join(__dirname, "./npcControlState"));
const {
  toFiniteNumber,
  toPositiveInt,
  cloneVector,
  resolveAnchors,
  resolveAnchor,
  buildSpawnStateForDefinition,
} = require(path.join(__dirname, "./npcAnchors"));

const NPC_CUSTOM_INFO_SCHEMA_VERSION = 2;

function serializeNpcCustomInfo(npcMetadata) {
  return JSON.stringify({
    npc: npcMetadata,
  });
}

function buildNpcCustomInfo(definition, npcMetadata = {}) {
  return serializeNpcCustomInfo({
    schemaVersion: NPC_CUSTOM_INFO_SCHEMA_VERSION,
    profileID: definition.profile.profileID,
    loadoutID: definition.loadout.loadoutID,
    behaviorProfileID: definition.behaviorProfile.behaviorProfileID,
    lootTableID: definition.lootTable ? definition.lootTable.lootTableID : null,
    entityType: inferNpcEntityType(definition.profile),
    presentationTypeID: toPositiveInt(definition.profile.presentationTypeID, 0),
    presentationName: String(
      definition.profile.presentationName ||
        definition.profile.name ||
        "",
    ),
    ...npcMetadata,
  });
}

function parseNpcCustomInfo(customInfo) {
  if (!customInfo) {
    return null;
  }

  try {
    const parsed = JSON.parse(customInfo);
    const npc = parsed && typeof parsed === "object" ? parsed.npc : null;
    if (!npc || typeof npc !== "object") {
      return null;
    }

    return {
      schemaVersion: toPositiveInt(npc.schemaVersion, 1),
      profileID: String(npc.profileID || "").trim() || null,
      loadoutID: String(npc.loadoutID || "").trim() || null,
      behaviorProfileID: String(npc.behaviorProfileID || "").trim() || null,
      lootTableID: String(npc.lootTableID || "").trim() || null,
      entityType: String(npc.entityType || "").trim().toLowerCase() || null,
      presentationTypeID: toPositiveInt(npc.presentationTypeID, 0),
      presentationName: String(npc.presentationName || "").trim() || null,
      ownerCharacterID: toPositiveInt(npc.ownerCharacterID, 0),
      preferredTargetID: toPositiveInt(npc.preferredTargetID, 0),
      selectionKind: String(npc.selectionKind || "").trim() || null,
      selectionID: String(npc.selectionID || "").trim() || null,
      selectionName: String(npc.selectionName || "").trim() || null,
      spawnGroupID: String(npc.spawnGroupID || "").trim() || null,
      spawnSiteID: String(npc.spawnSiteID || "").trim() || null,
      startupRuleID: String(npc.startupRuleID || "").trim() || null,
      operatorKind: String(npc.operatorKind || "").trim() || null,
      transient: npc.transient === true,
      anchorKind: String(npc.anchorKind || "").trim() || null,
      anchorID: toPositiveInt(npc.anchorID, 0),
      anchorName: String(npc.anchorName || "").trim() || null,
      spawnedAtMs: toFiniteNumber(npc.spawnedAtMs, 0),
      homePosition:
        npc.homePosition && typeof npc.homePosition === "object"
          ? cloneVector(npc.homePosition)
          : null,
      homeDirection:
        npc.homeDirection && typeof npc.homeDirection === "object"
          ? cloneVector(npc.homeDirection, { x: 1, y: 0, z: 0 })
          : null,
      behaviorOverrides: normalizeBehaviorOverrides(npc.behaviorOverrides),
    };
  } catch (error) {
    return null;
  }
}

function mergeMissingBehaviorOverrides(existingOverrides, defaultOverrides) {
  const merged = {
    ...normalizeBehaviorOverrides(existingOverrides),
  };
  let changed = false;

  for (const [field, value] of Object.entries(
    normalizeBehaviorOverrides(defaultOverrides),
  )) {
    if (Object.prototype.hasOwnProperty.call(merged, field)) {
      continue;
    }
    merged[field] = Array.isArray(value) ? [...value] : value;
    changed = true;
  }

  return {
    overrides: merged,
    changed,
  };
}

function normalizePersistedNpcMetadata(npcMetadata) {
  if (!npcMetadata || typeof npcMetadata !== "object") {
    return {
      npcMetadata: npcMetadata || null,
      changed: false,
    };
  }

  const normalizedMetadata = {
    ...npcMetadata,
    behaviorOverrides: normalizeBehaviorOverrides(npcMetadata.behaviorOverrides),
  };
  let changed = false;

  const startupRuleID = String(normalizedMetadata.startupRuleID || "").trim();
  if (startupRuleID) {
    const startupRule = getNpcStartupRule(startupRuleID);
    if (startupRule && startupRule.behaviorOverrides) {
      const merged = mergeMissingBehaviorOverrides(
        normalizedMetadata.behaviorOverrides,
        startupRule.behaviorOverrides,
      );
      if (merged.changed) {
        normalizedMetadata.behaviorOverrides = merged.overrides;
        changed = true;
      }
    }
  }

  return {
    npcMetadata: normalizedMetadata,
    changed,
  };
}

function resolveDefinitionFromNpcMetadata(npcMetadata) {
  if (!npcMetadata || !npcMetadata.profileID) {
    return null;
  }

  const definition = buildNpcDefinition(npcMetadata.profileID);
  if (!definition) {
    return null;
  }

  const behaviorProfile = npcMetadata.behaviorProfileID
    ? getNpcBehaviorProfile(npcMetadata.behaviorProfileID) || definition.behaviorProfile
    : definition.behaviorProfile;
  const lootTable = npcMetadata.lootTableID
    ? getNpcLootTable(npcMetadata.lootTableID) || definition.lootTable
    : definition.lootTable;

  return {
    ...definition,
    behaviorProfile,
    lootTable,
  };
}

function cleanupFailedNpcSpawn(ownerCharacterID, shipItemID = 0) {
  const normalizedShipItemID = toPositiveInt(shipItemID, 0);
  const normalizedOwnerCharacterID = toPositiveInt(ownerCharacterID, 0);
  if (normalizedShipItemID > 0) {
    removeInventoryItem(normalizedShipItemID, {
      removeContents: true,
    });
  }
  if (normalizedOwnerCharacterID > 0) {
    database.remove("skills", `/${String(normalizedOwnerCharacterID)}`);
    database.remove("characters", `/${String(normalizedOwnerCharacterID)}`);
  }
}

function inferNpcEntityType(profile) {
  return String(profile && profile.entityType || "").trim().toLowerCase() === "concord"
    ? "concord"
    : "npc";
}

function buildNpcSlimPresentation(definition, shipItem) {
  const profile = definition && definition.profile
    ? definition.profile
    : {};
  const fallbackTypeID = toPositiveInt(shipItem && shipItem.typeID, 0);
  const fallbackGroupID = toPositiveInt(shipItem && shipItem.groupID, 0);
  const fallbackCategoryID = toPositiveInt(shipItem && shipItem.categoryID, 0);
  const fallbackName = String(
    profile.presentationName ||
      profile.name ||
      (shipItem && shipItem.itemName) ||
      "NPC",
  );
  const presentationTypeID = toPositiveInt(profile.presentationTypeID, 0);
  const presentationType = presentationTypeID > 0
    ? resolveItemByTypeID(presentationTypeID)
    : null;

  return {
    slimTypeID: presentationType
      ? toPositiveInt(presentationType.typeID, fallbackTypeID)
      : fallbackTypeID,
    slimGroupID: presentationType
      ? toPositiveInt(presentationType.groupID, fallbackGroupID)
      : fallbackGroupID,
    slimCategoryID: presentationType
      ? toPositiveInt(presentationType.categoryID, fallbackCategoryID)
      : fallbackCategoryID,
    slimName: String(
      profile.presentationName ||
        (presentationType && presentationType.name) ||
        fallbackName,
    ),
  };
}

function resolveNpcStandingThresholds(profile = {}) {
  const explicitHostileThreshold = Number(
    profile.hostileResponseThreshold ?? profile.hostile_response_threshold,
  );
  const explicitFriendlyThreshold = Number(
    profile.friendlyResponseThreshold ?? profile.friendly_response_threshold,
  );

  if (
    Number.isFinite(explicitHostileThreshold) &&
    Number.isFinite(explicitFriendlyThreshold)
  ) {
    return {
      hostileResponseThreshold: explicitHostileThreshold,
      friendlyResponseThreshold: explicitFriendlyThreshold,
    };
  }

  const entityType = inferNpcEntityType(profile);
  if (entityType === "concord") {
    return {
      // Default CONCORD presence should read as neutral by standings until a
      // real legality/criminal response path makes them hostile.
      hostileResponseThreshold: -11,
      friendlyResponseThreshold: 11,
    };
  }

  return {
    // Pirate NPCs should present as hostile to ordinary neutral capsuleers by
    // default, matching the retail "rats are red to everyone" expectation.
    hostileResponseThreshold: 11,
    friendlyResponseThreshold: 11,
  };
}

function buildNpcSlimModules(ownerCharacterID, shipItemID) {
  return getFittedModuleItems(ownerCharacterID, shipItemID)
    .map((moduleItem) => ([
      toPositiveInt(moduleItem && moduleItem.itemID, 0),
      toPositiveInt(moduleItem && moduleItem.typeID, 0),
      toPositiveInt(moduleItem && moduleItem.flagID, 0),
    ]))
    .filter((tuple) => tuple.every((value) => value > 0))
    .sort((left, right) => left[2] - right[2] || left[0] - right[0]);
}

function applyNpcPresentationToEntity(entity, definition, shipItem, npcMetadata = {}) {
  if (!entity || entity.kind !== "ship" || !definition) {
    return entity;
  }

  const slimPresentation = buildNpcSlimPresentation(definition, shipItem);
  const ownerCharacterID = toPositiveInt(
    npcMetadata.ownerCharacterID,
    toPositiveInt(entity.pilotCharacterID, toPositiveInt(shipItem && shipItem.ownerID, 0)),
  );
  const profile = definition.profile || {};
  const standingThresholds = resolveNpcStandingThresholds(profile);

  entity.slimTypeID = slimPresentation.slimTypeID;
  entity.slimGroupID = slimPresentation.slimGroupID;
  entity.slimCategoryID = slimPresentation.slimCategoryID;
  entity.slimName = slimPresentation.slimName;
  entity.characterID = 0;
  entity.pilotCharacterID = ownerCharacterID;
  entity.ownerID = toPositiveInt(profile.corporationID, ownerCharacterID);
  entity.corporationID = toPositiveInt(profile.corporationID, 0);
  entity.allianceID = toPositiveInt(profile.allianceID, 0);
  entity.warFactionID = toPositiveInt(profile.factionID, 0);
  entity.securityStatus = toFiniteNumber(profile.securityStatus, entity.securityStatus);
  entity.bounty = toFiniteNumber(profile.bounty, entity.bounty);
  entity.npcEntityType = npcMetadata.entityType || inferNpcEntityType(profile);
  entity.hostileResponseThreshold = toFiniteNumber(
    standingThresholds.hostileResponseThreshold,
    entity.hostileResponseThreshold,
  );
  entity.friendlyResponseThreshold = toFiniteNumber(
    standingThresholds.friendlyResponseThreshold,
    entity.friendlyResponseThreshold,
  );
  entity.modules = buildNpcSlimModules(ownerCharacterID, entity.itemID);
  return entity;
}

function fitLoadoutModules(characterID, shipItem, loadout) {
  const transient = loadout && loadout.transient === true;
  const fittedModules = [];
  const moduleEntries = Array.isArray(loadout && loadout.modules)
    ? loadout.modules
    : [];

  for (const moduleEntry of moduleEntries) {
    const quantity = Math.max(1, toPositiveInt(moduleEntry && moduleEntry.quantity, 1));
    for (let index = 0; index < quantity; index += 1) {
      const fittedItems = getFittedModuleItems(characterID, shipItem.itemID);
      const flagID = selectAutoFitFlagForType(
        shipItem,
        fittedItems,
        moduleEntry.typeID,
      );
      if (!flagID) {
        return {
          success: false,
          errorMsg: "NPC_LOADOUT_NO_FREE_SLOT",
        };
      }

      const itemType = resolveItemByTypeID(moduleEntry.typeID);
      if (!itemType) {
        return {
          success: false,
          errorMsg: "NPC_LOADOUT_MODULE_NOT_FOUND",
        };
      }

      const grantResult = grantItemToCharacterLocation(
        characterID,
        shipItem.itemID,
        flagID,
        itemType,
        1,
        {
          singleton: true,
          transient,
          moduleState: normalizeModuleState({
            online: true,
            damage: 0,
            charge: 0,
            armorDamage: 0,
            shieldCharge: 0,
            incapacitated: false,
          }),
        },
      );
      if (!grantResult.success) {
        return {
          success: false,
          errorMsg: grantResult.errorMsg || "NPC_LOADOUT_MODULE_GRANT_FAILED",
        };
      }

      const moduleItem = (
        grantResult.data &&
        Array.isArray(grantResult.data.items) &&
        grantResult.data.items[0]
      ) || null;
      if (moduleItem) {
        fittedModules.push(moduleItem);
      }
    }
  }

  return {
    success: true,
    data: {
      fittedModules,
    },
  };
}

function loadNpcCharges(characterID, shipItem, loadout) {
  const transient = loadout && loadout.transient === true;
  const fittedModules = getFittedModuleItems(characterID, shipItem.itemID);
  const chargeEntries = Array.isArray(loadout && loadout.charges)
    ? loadout.charges
    : [];
  const loadedCharges = [];

  for (const chargeEntry of chargeEntries) {
    const chargeType = resolveItemByTypeID(chargeEntry.typeID);
    if (!chargeType) {
      return {
        success: false,
        errorMsg: "NPC_LOADOUT_CHARGE_NOT_FOUND",
      };
    }

    const quantityPerModule = Math.max(
      1,
      toPositiveInt(chargeEntry.quantityPerModule, 1),
    );
    for (const moduleItem of fittedModules) {
      const grantResult = grantItemToCharacterLocation(
        characterID,
        shipItem.itemID,
        moduleItem.flagID,
        chargeType,
        quantityPerModule,
        {
          singleton: chargeEntry.singleton === true,
          transient,
          moduleState: chargeEntry.singleton === true
            ? {
                damage: 0,
              }
            : undefined,
        },
      );
      if (!grantResult.success) {
        return {
          success: false,
          errorMsg: grantResult.errorMsg || "NPC_LOADOUT_CHARGE_GRANT_FAILED",
        };
      }

      loadedCharges.push(
        ...((grantResult.data && grantResult.data.items) || []),
      );
    }
  }

  return {
    success: true,
    data: {
      loadedCharges,
    },
  };
}

function fitNpcLoadout(characterID, shipItem, loadout) {
  const authoredLoadout = loadout && typeof loadout === "object"
    ? loadout
    : {};
  const runtimeLoadout = {
    ...authoredLoadout,
    transient: authoredLoadout.transient === true,
  };
  const moduleFitResult = fitLoadoutModules(characterID, shipItem, runtimeLoadout);
  if (!moduleFitResult.success) {
    return moduleFitResult;
  }

  const chargeLoadResult = loadNpcCharges(characterID, shipItem, runtimeLoadout);
  if (!chargeLoadResult.success) {
    return chargeLoadResult;
  }

  return {
    success: true,
    data: {
      fittedModules: moduleFitResult.data.fittedModules,
      loadedCharges: chargeLoadResult.data.loadedCharges,
    },
  };
}

function resolveProfileDefinition(query, fallbackProfileID) {
  const profileResolution = resolveNpcProfile(query, fallbackProfileID);
  if (!profileResolution.success || !profileResolution.data) {
    return {
      success: false,
      errorMsg: profileResolution.errorMsg || "NPC_PROFILE_NOT_FOUND",
      suggestions: profileResolution.suggestions || [],
    };
  }

  const definition = buildNpcDefinition(profileResolution.data.profileID);
  if (!definition) {
    return {
      success: false,
      errorMsg: "NPC_DEFINITION_INCOMPLETE",
      suggestions: [],
    };
  }

  return {
    success: true,
    data: definition,
    suggestions: [],
  };
}

function resolveSpawnContextForSession(session) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!systemID || !anchorEntity) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return {
    success: true,
    data: {
      systemID,
      scene: spaceRuntime.ensureScene(systemID),
      anchorEntity,
      preferredTargetID: toPositiveInt(session._space.shipID, 0),
      anchorKind: String(anchorEntity.kind || "ship"),
      anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Ship"),
      contextKind: "sessionShip",
    },
  };
}

function resolveSpawnContextForSystem(systemID, options = {}) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const anchorEntity = options.anchorEntity || null;
  if (anchorEntity && anchorEntity.position) {
    return {
      success: true,
      data: {
        systemID: numericSystemID,
        scene: spaceRuntime.ensureScene(numericSystemID),
        anchorEntity,
        preferredTargetID: toPositiveInt(options.preferredTargetID, 0),
        anchorKind: String(anchorEntity.kind || "custom"),
        anchorLabel: String(anchorEntity.itemName || anchorEntity.slimName || "Anchor"),
        contextKind: "systemAnchor",
      },
    };
  }

  const anchorDescriptor =
    options.anchorDescriptor ||
    (
      options.position
        ? {
            kind: "coordinates",
            position: options.position,
            direction: options.direction,
            radius: options.radius,
            name: options.anchorName,
          }
        : null
    );
  if (!anchorDescriptor) {
    return {
      success: false,
      errorMsg: "ANCHOR_REQUIRED",
    };
  }

  const anchorResult = resolveAnchor(numericSystemID, anchorDescriptor);
  if (!anchorResult.success || !anchorResult.data) {
    return anchorResult;
  }

  return {
    success: true,
    data: {
      systemID: numericSystemID,
      scene: anchorResult.data.scene,
      anchorEntity: anchorResult.data.anchor,
      preferredTargetID: toPositiveInt(options.preferredTargetID, 0),
      anchorKind: String(anchorResult.data.anchor.kind || anchorDescriptor.kind || "anchor"),
      anchorLabel: String(
        anchorResult.data.anchor.itemName ||
          anchorDescriptor.name ||
          anchorDescriptor.nameQuery ||
          "Anchor"
      ),
      contextKind: "systemAnchor",
    },
  };
}

function buildNpcRuntimeMetadata(context, definition, spawnState, ownerCharacterID, options = {}) {
  const systemID = toPositiveInt(context && context.systemID, 0);
  const scene = context && context.scene
    ? context.scene
    : spaceRuntime.ensureScene(systemID);

  return {
    schemaVersion: NPC_CUSTOM_INFO_SCHEMA_VERSION,
    profileID: definition.profile.profileID,
    loadoutID: definition.loadout.loadoutID,
    behaviorProfileID: definition.behaviorProfile.behaviorProfileID,
    lootTableID: definition.lootTable ? definition.lootTable.lootTableID : null,
    entityType: inferNpcEntityType(definition.profile),
    presentationTypeID: toPositiveInt(definition.profile.presentationTypeID, 0),
    presentationName: String(
      definition.profile.presentationName ||
        definition.profile.name ||
        "",
    ),
    ownerCharacterID: toPositiveInt(ownerCharacterID, 0),
    preferredTargetID: toPositiveInt(
      options.preferredTargetID,
      toPositiveInt(context && context.preferredTargetID, 0),
    ),
    selectionKind: String(options.selectionKind || "").trim() || null,
    selectionID: String(options.selectionID || "").trim() || null,
    selectionName: String(options.selectionName || "").trim() || null,
    spawnGroupID: String(options.spawnGroupID || "").trim() || null,
    spawnSiteID: String(options.spawnSiteID || "").trim() || null,
    startupRuleID: String(options.startupRuleID || "").trim() || null,
    operatorKind: String(options.operatorKind || "").trim() || null,
    transient: options.transient === true,
    anchorKind: String(options.anchorKind || context.anchorKind || "anchor"),
    anchorID: toPositiveInt(
      options.anchorID,
      toPositiveInt(context && context.anchorEntity && context.anchorEntity.itemID, 0),
    ),
    anchorName: String(
      options.anchorName ||
        context.anchorLabel ||
        (context.anchorEntity && context.anchorEntity.itemName) ||
        "Anchor"
    ),
    spawnedAtMs: scene
      ? scene.getCurrentSimTimeMs()
      : spaceRuntime.getSimulationTimeMsForSystem(systemID),
    homePosition: cloneVector(spawnState && spawnState.position),
    homeDirection: cloneVector(
      spawnState && spawnState.direction,
      { x: 1, y: 0, z: 0 },
    ),
    behaviorOverrides: normalizeBehaviorOverrides(
      options.behaviorOverrides || options.behaviorProfileOverrides,
    ),
  };
}

function buildControllerRecord(context, definition, entity, spawnState, ownerCharacterID, options = {}) {
  const systemID = toPositiveInt(context && context.systemID, 0);
  const scene = context && context.scene
    ? context.scene
    : spaceRuntime.ensureScene(systemID);
  const npcMetadata = options.npcMetadata || buildNpcRuntimeMetadata(
    context,
    definition,
    spawnState,
    ownerCharacterID,
    options,
  );

  return registerController({
    entityID: entity.itemID,
    systemID,
    profileID: npcMetadata.profileID || definition.profile.profileID,
    loadoutID: npcMetadata.loadoutID || definition.loadout.loadoutID,
    behaviorProfileID: npcMetadata.behaviorProfileID || definition.behaviorProfile.behaviorProfileID,
    lootTableID:
      npcMetadata.lootTableID ||
      (definition.lootTable ? definition.lootTable.lootTableID : null),
    behaviorProfile: definition.behaviorProfile,
    behaviorOverrides: normalizeBehaviorOverrides(npcMetadata.behaviorOverrides),
    preferredTargetID: toPositiveInt(npcMetadata.preferredTargetID, 0),
    manualOrder: null,
    currentTargetID: 0,
    spawnedAtMs: toFiniteNumber(
      npcMetadata.spawnedAtMs,
      scene
        ? scene.getCurrentSimTimeMs()
        : spaceRuntime.getSimulationTimeMsForSystem(systemID),
    ),
    nextThinkAtMs: 0,
    ownerCharacterID: toPositiveInt(npcMetadata.ownerCharacterID, ownerCharacterID),
    entityType: npcMetadata.entityType || inferNpcEntityType(definition.profile),
    transient: npcMetadata.transient === true,
    selectionKind: npcMetadata.selectionKind || null,
    selectionID: npcMetadata.selectionID || null,
    selectionName: npcMetadata.selectionName || null,
    spawnGroupID: npcMetadata.spawnGroupID || null,
    spawnSiteID: npcMetadata.spawnSiteID || null,
    startupRuleID: npcMetadata.startupRuleID || null,
    operatorKind: npcMetadata.operatorKind || null,
    anchorKind: npcMetadata.anchorKind || String(context.anchorKind || "anchor"),
    anchorID: toPositiveInt(
      npcMetadata.anchorID,
      toPositiveInt(context && context.anchorEntity && context.anchorEntity.itemID, 0),
    ),
    anchorName: npcMetadata.anchorName || String(
      context.anchorLabel ||
        (context.anchorEntity && context.anchorEntity.itemName) ||
        "Anchor"
    ),
    homePosition: cloneVector(
      npcMetadata.homePosition,
      cloneVector(spawnState && spawnState.position),
    ),
    homeDirection: cloneVector(
      npcMetadata.homeDirection,
      cloneVector(spawnState && spawnState.direction, { x: 1, y: 0, z: 0 }),
    ),
    lastHomeCommandAtMs: 0,
    lastHomeDirection: null,
    returningHome: false,
  });
}

function spawnResolvedNpcInContext(context, definition, options = {}) {
  const systemID = toPositiveInt(context && context.systemID, 0);
  const anchorEntity = context && context.anchorEntity;
  const scene = context && context.scene
    ? context.scene
    : spaceRuntime.ensureScene(systemID);
  const spawnState = options.spawnState || buildSpawnStateForDefinition(
    anchorEntity,
    definition,
    options,
  );
  const npcCharacterResult = createNpcCharacter(
    definition.profile,
    systemID,
    {
      shipName: definition.profile.shipNameTemplate,
      transient: options.transient === true,
    },
  );
  if (!npcCharacterResult.success || !npcCharacterResult.data) {
    return npcCharacterResult;
  }

  const npcCharacterID = npcCharacterResult.data.characterID;
  const npcMetadata = buildNpcRuntimeMetadata(
    context,
    definition,
    spawnState,
    npcCharacterID,
    options,
  );
  const shipCreateResult = createSpaceItemForCharacter(
    npcCharacterID,
    systemID,
    {
      typeID: definition.profile.shipTypeID,
      name: definition.profile.shipNameTemplate,
    },
    {
      ...spawnState,
      itemName: definition.profile.shipNameTemplate,
      transient: options.transient === true,
      customInfo: buildNpcCustomInfo(definition, npcMetadata),
      conditionState: {
        damage: 0,
        charge: 1,
        armorDamage: 0,
        shieldCharge: 1,
        incapacitated: false,
      },
    },
  );
  if (!shipCreateResult.success || !shipCreateResult.data) {
    cleanupFailedNpcSpawn(npcCharacterID, 0);
    return {
      success: false,
      errorMsg: shipCreateResult.errorMsg || "NPC_SHIP_CREATE_FAILED",
    };
  }

  const shipItem = shipCreateResult.data;
  setActiveShipForCharacter(npcCharacterID, shipItem.itemID);

  const fitResult = fitNpcLoadout(
    npcCharacterID,
    shipItem,
    {
      ...definition.loadout,
      transient: options.transient === true,
    },
  );
  if (!fitResult.success) {
    cleanupFailedNpcSpawn(npcCharacterID, shipItem.itemID);
    return fitResult;
  }

  const lootResult = seedNpcShipLoot(
    npcCharacterID,
    shipItem.itemID,
    definition.lootTable,
    {
      transient: options.transient === true,
    },
  );
  if (!lootResult.success) {
    cleanupFailedNpcSpawn(npcCharacterID, shipItem.itemID);
    return lootResult;
  }

  const runtimeShipResult = spaceRuntime.spawnDynamicShip(
    systemID,
    {
      ...buildNpcSlimPresentation(definition, shipItem),
      itemID: shipItem.itemID,
      typeID: shipItem.typeID,
      groupID: shipItem.groupID,
      categoryID: shipItem.categoryID,
      itemName: shipItem.itemName,
      ownerID: toPositiveInt(definition.profile.corporationID, 0) || npcCharacterID,
      characterID: 0,
      pilotCharacterID: npcCharacterID,
      corporationID: toPositiveInt(definition.profile.corporationID, 0),
      allianceID: toPositiveInt(definition.profile.allianceID, 0),
      warFactionID: toPositiveInt(definition.profile.factionID, 0),
      conditionState: shipItem.conditionState,
      spaceState: shipItem.spaceState,
      securityStatus: toFiniteNumber(definition.profile.securityStatus, 0),
      bounty: toFiniteNumber(definition.profile.bounty, 0),
      npcEntityType: inferNpcEntityType(definition.profile),
      transient: options.transient === true,
    },
    {
      persistSpaceState: options.transient !== true,
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
    },
  );
  if (
    !runtimeShipResult.success ||
    !runtimeShipResult.data ||
    !runtimeShipResult.data.entity
  ) {
    cleanupFailedNpcSpawn(npcCharacterID, shipItem.itemID);
    return {
      success: false,
      errorMsg: runtimeShipResult.errorMsg || "NPC_RUNTIME_SPAWN_FAILED",
    };
  }

  const entity = runtimeShipResult.data.entity;
  entity.transient = options.transient === true;
  applyNpcPresentationToEntity(entity, definition, shipItem, npcMetadata);
  const controller = buildControllerRecord(
    context,
    definition,
    entity,
    spawnState,
    npcCharacterID,
    {
      ...options,
      npcMetadata,
    },
  );

  tickBehaviorScene(
    scene,
    scene
      ? scene.getCurrentSimTimeMs()
      : spaceRuntime.getSimulationTimeMsForSystem(systemID),
  );

  return {
    success: true,
    data: {
      definition,
      entity,
      controller,
      shipItem: findShipItemById(shipItem.itemID) || shipItem,
      ownerCharacterID: npcCharacterID,
      lootEntries:
        lootResult.data && Array.isArray(lootResult.data.lootEntries)
          ? lootResult.data.lootEntries
          : [],
      fittedModules:
        fitResult.data && Array.isArray(fitResult.data.fittedModules)
          ? fitResult.data.fittedModules
          : [],
    },
  };
}

function spawnDefinitionsInContext(context, selectionResult, options = {}) {
  const spawned = [];
  let partialFailure = null;
  const definitions = Array.isArray(
    selectionResult &&
      selectionResult.data &&
      selectionResult.data.definitions,
  )
    ? selectionResult.data.definitions
    : [];
  const selectionKind = String(options.selectionKind || (
    selectionResult &&
      selectionResult.data &&
      selectionResult.data.selectionKind
  ) || "").trim() || null;
  const selectionID = String(options.selectionID || (
    selectionResult &&
      selectionResult.data &&
      selectionResult.data.selectionID
  ) || "").trim() || null;
  const selectionName = String(options.selectionName || (
    selectionResult &&
      selectionResult.data &&
      selectionResult.data.selectionName
  ) || "").trim() || null;

  for (let index = 0; index < definitions.length; index += 1) {
    const spawnResult = spawnResolvedNpcInContext(
      context,
      definitions[index],
      {
        ...options,
        selectionKind,
        selectionID,
        selectionName,
        batchIndex: index + 1,
        batchTotal: definitions.length,
      },
    );
    if (!spawnResult.success || !spawnResult.data) {
      partialFailure = {
        failedAt: index + 1,
        errorMsg: spawnResult.errorMsg || "NPC_SPAWN_FAILED",
      };
      break;
    }

    spawned.push(spawnResult.data);
  }

  if (spawned.length === 0) {
    return {
      success: false,
      errorMsg: partialFailure ? partialFailure.errorMsg : "NPC_SPAWN_FAILED",
      suggestions: selectionResult && selectionResult.suggestions
        ? selectionResult.suggestions
        : [],
    };
  }

  return {
    success: true,
    data: {
      selectionKind,
      selectionID,
      selectionName,
      requestedAmount: definitions.length,
      spawned,
      partialFailure,
    },
    suggestions: selectionResult && selectionResult.suggestions
      ? selectionResult.suggestions
      : [],
  };
}

function resolveBatchSelection(options = {}) {
  return resolveNpcSpawnPlan(options.profileQuery, {
    amount: Math.max(1, toPositiveInt(options.amount, 1)),
    defaultPoolID: String(options.defaultPoolID || "npc_laser_hostiles"),
    fallbackProfileID: String(options.fallbackProfileID || "generic_hostile"),
    entityType: String(options.entityType || "npc"),
    preferPools: options.preferPools !== false,
  });
}

function spawnNpcBatchForSession(session, options = {}) {
  const contextResult = resolveSpawnContextForSession(session);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const selectionResult = resolveBatchSelection(options);
  if (!selectionResult.success || !selectionResult.data) {
    return selectionResult;
  }

  return spawnDefinitionsInContext(contextResult.data, selectionResult, {
    ...options,
    preferredTargetID: toPositiveInt(
      options.preferredTargetID,
      toPositiveInt(session && session._space && session._space.shipID, 0),
    ),
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
}

function spawnNpcBatchInSystem(systemID, options = {}) {
  const contextResult = resolveSpawnContextForSystem(systemID, options);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const selectionResult = resolveBatchSelection(options);
  if (!selectionResult.success || !selectionResult.data) {
    return selectionResult;
  }

  return spawnDefinitionsInContext(contextResult.data, selectionResult, {
    ...options,
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
}

function spawnNpcForSession(session, options = {}) {
  const batchResult = spawnNpcBatchForSession(session, {
    ...options,
    amount: 1,
    entityType: "npc",
    defaultPoolID: options.defaultPoolID || "npc_laser_hostiles",
    fallbackProfileID: options.fallbackProfileID || "generic_hostile",
  });
  if (
    !batchResult.success ||
    !batchResult.data ||
    !Array.isArray(batchResult.data.spawned) ||
    batchResult.data.spawned.length === 0
  ) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data.spawned[0],
      selectionKind: batchResult.data.selectionKind,
      selectionID: batchResult.data.selectionID,
      selectionName: batchResult.data.selectionName,
      partialFailure: batchResult.data.partialFailure,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnConcordBatchForSession(session, options = {}) {
  return spawnNpcBatchForSession(session, {
    ...options,
    entityType: "concord",
    defaultPoolID: options.defaultPoolID || "concord_response_fleet",
    fallbackProfileID: options.fallbackProfileID || "concord_response",
    preferPools: true,
  });
}

function spawnConcordForSession(session, options = {}) {
  const batchResult = spawnConcordBatchForSession(session, {
    ...options,
    amount: 1,
  });
  if (
    !batchResult.success ||
    !batchResult.data ||
    !Array.isArray(batchResult.data.spawned) ||
    batchResult.data.spawned.length === 0
  ) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data.spawned[0],
      selectionKind: batchResult.data.selectionKind,
      selectionID: batchResult.data.selectionID,
      selectionName: batchResult.data.selectionName,
      partialFailure: batchResult.data.partialFailure,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnNpcGroupInSystem(systemID, options = {}) {
  const contextResult = resolveSpawnContextForSystem(systemID, options);
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const groupResult = resolveNpcSpawnGroupPlan(
    options.spawnGroupQuery || options.groupQuery,
    {
      entityType: String(options.entityType || "npc"),
      fallbackSpawnGroupID: String(options.fallbackSpawnGroupID || ""),
    },
  );
  if (!groupResult.success || !groupResult.data) {
    return groupResult;
  }

  return spawnDefinitionsInContext(contextResult.data, groupResult, {
    ...options,
    selectionKind: "group",
    selectionID: groupResult.data.selectionID,
    selectionName: groupResult.data.selectionName,
    spawnGroupID: groupResult.data.selectionID,
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
}

function spawnNpcSite(siteQuery, options = {}) {
  const siteResolution = resolveNpcSpawnSite(
    siteQuery,
    String(options.fallbackSpawnSiteID || ""),
  );
  if (!siteResolution.success || !siteResolution.data) {
    return siteResolution;
  }

  const site = siteResolution.data;
  const preferredTargetID = toPositiveInt(options.preferredTargetID, 0);
  const contextResult = resolveSpawnContextForSystem(site.systemID, {
    ...options,
    anchorDescriptor: site.anchor,
    preferredTargetID,
  });
  if (!contextResult.success || !contextResult.data) {
    return contextResult;
  }

  const groupResult = resolveNpcSpawnGroupPlan(site.spawnGroupID, {
    entityType: String(site.entityType || options.entityType || ""),
  });
  if (!groupResult.success || !groupResult.data) {
    return groupResult;
  }

  const batchResult = spawnDefinitionsInContext(contextResult.data, groupResult, {
    ...options,
    selectionKind: "site",
    selectionID: site.spawnSiteID,
    selectionName: site.name || site.spawnSiteID,
    spawnGroupID: site.spawnGroupID,
    spawnSiteID: site.spawnSiteID,
    entityType: String(site.entityType || options.entityType || ""),
    spawnDistanceMeters: toFiniteNumber(site.anchor && site.anchor.spawnDistanceMeters, 0),
    distanceFromSurfaceMeters: toFiniteNumber(
      site.anchor && site.anchor.distanceFromSurfaceMeters,
      0,
    ),
    spreadMeters: toFiniteNumber(site.anchor && site.anchor.spreadMeters, 0),
    formationSpacingMeters: toFiniteNumber(
      site.anchor && site.anchor.formationSpacingMeters,
      0,
    ),
    anchorKind: contextResult.data.anchorKind,
    anchorName: contextResult.data.anchorLabel,
    anchorID: toPositiveInt(contextResult.data.anchorEntity && contextResult.data.anchorEntity.itemID, 0),
  });
  if (!batchResult.success || !batchResult.data) {
    return batchResult;
  }

  return {
    success: true,
    data: {
      ...batchResult.data,
      site,
      group: groupResult.data.group || null,
    },
    suggestions: batchResult.suggestions || [],
  };
}

function spawnNpcSiteForSession(session, siteQuery, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const siteResolution = resolveNpcSpawnSite(
    siteQuery,
    String(options.fallbackSpawnSiteID || ""),
  );
  if (!siteResolution.success || !siteResolution.data) {
    return siteResolution;
  }

  const preferredTargetID =
    toPositiveInt(options.preferredTargetID, 0) ||
    (
      toPositiveInt(session._space.systemID, 0) === toPositiveInt(siteResolution.data.systemID, 0)
        ? toPositiveInt(session._space.shipID, 0)
        : 0
    );
  return spawnNpcSite(siteResolution.data.spawnSiteID, {
    ...options,
    preferredTargetID,
  });
}

function hydratePersistedNpcController(scene, entity) {
  if (!scene || !entity || entity.kind !== "ship") {
    return null;
  }

  const existingController = getControllerByEntityID(entity.itemID);
  if (existingController) {
    return existingController;
  }

  const shipItem = findShipItemById(entity.itemID);
  const parsedNpcMetadata = parseNpcCustomInfo(shipItem && shipItem.customInfo);
  const {
    npcMetadata,
    changed: metadataChanged,
  } = normalizePersistedNpcMetadata(parsedNpcMetadata);
  if (!shipItem || !npcMetadata || !npcMetadata.profileID) {
    return null;
  }

  const definition = resolveDefinitionFromNpcMetadata(npcMetadata);
  if (!definition) {
    return null;
  }

  if (metadataChanged) {
    updateShipItem(entity.itemID, (currentItem) => ({
      ...currentItem,
      customInfo: buildNpcCustomInfo(definition, npcMetadata),
    }));
  }

  const context = {
    systemID: scene.systemID,
    scene,
    anchorEntity: npcMetadata.anchorID > 0
      ? scene.getEntityByID(npcMetadata.anchorID) || null
      : null,
    anchorKind: npcMetadata.anchorKind || "anchor",
    anchorLabel: npcMetadata.anchorName || "Anchor",
  };
  const spawnState = {
    position: cloneVector(npcMetadata.homePosition, cloneVector(entity.position)),
    direction: cloneVector(
      npcMetadata.homeDirection,
      cloneVector(entity.direction, { x: 1, y: 0, z: 0 }),
    ),
  };
  const ownerCharacterID = toPositiveInt(
    npcMetadata.ownerCharacterID,
    toPositiveInt(shipItem.ownerID, toPositiveInt(entity.pilotCharacterID, 0)),
  );

  applyNpcPresentationToEntity(entity, definition, shipItem, {
    ...npcMetadata,
    ownerCharacterID,
  });

  return buildControllerRecord(
    context,
    definition,
    entity,
    spawnState,
    ownerCharacterID,
    {
      npcMetadata: {
        ...npcMetadata,
        ownerCharacterID,
        homePosition: cloneVector(spawnState.position),
        homeDirection: cloneVector(spawnState.direction, { x: 1, y: 0, z: 0 }),
      },
    },
  );
}

function cleanupStalePersistedStartupNpcs(scene) {
  if (!scene || process.env.EVEJS_SKIP_NPC_STARTUP === "1") {
    return [];
  }

  const activeStartupRulesByID = new Map(
    listStartupRulesForSystem(scene.systemID)
      .map((rule) => [String(rule && rule.startupRuleID || "").trim(), rule])
      .filter(([startupRuleID]) => Boolean(startupRuleID)),
  );
  const destroyed = [];

  for (const entity of [...scene.dynamicEntities.values()]) {
    if (!entity || entity.kind !== "ship") {
      continue;
    }

    const shipItem = findShipItemById(entity.itemID);
    const npcMetadata = parseNpcCustomInfo(shipItem && shipItem.customInfo);
    const startupRuleID = String(npcMetadata && npcMetadata.startupRuleID || "").trim();
    if (!npcMetadata || !startupRuleID) {
      continue;
    }
    const activeRule = activeStartupRulesByID.get(startupRuleID) || null;
    if (activeRule && activeRule.transient !== true) {
      continue;
    }

    const ownerCharacterID = toPositiveInt(
      npcMetadata.ownerCharacterID,
      toPositiveInt(shipItem && shipItem.ownerID, 0),
    );
    const destroyResult = destroyNpcController(
      {
        systemID: scene.systemID,
        entityID: entity.itemID,
        ownerCharacterID,
      },
      {
        removeContents: true,
      },
    );
    if (!destroyResult.success) {
      continue;
    }

    destroyed.push({
      entityID: entity.itemID,
      startupRuleID,
      ownerCharacterID,
      cleanupReason: activeRule ? "transientRule" : "disabledRule",
    });
  }

  return destroyed;
}

function ruleAppliesToSystem(rule, systemID) {
  const numericSystemID = toPositiveInt(systemID, 0);
  if (!numericSystemID || !rule) {
    return false;
  }

  const systemIDs = Array.isArray(rule.systemIDs)
    ? rule.systemIDs.map((value) => toPositiveInt(value, 0)).filter((value) => value > 0)
    : [];
  const fallbackSystemID = toPositiveInt(rule.systemID, 0);
  if (systemIDs.length === 0 && fallbackSystemID <= 0) {
    return false;
  }

  return systemIDs.includes(numericSystemID) || fallbackSystemID === numericSystemID;
}

function isGeneratedStartupRule(rule) {
  return rule && rule.generatedByConfig === true;
}

function getStartupRuleSource(rules = []) {
  const hasGenerated = rules.some((rule) => isGeneratedStartupRule(rule));
  const hasAuthored = rules.some((rule) => !isGeneratedStartupRule(rule));

  if (hasGenerated && !hasAuthored) {
    return "generated";
  }
  if (hasAuthored && !hasGenerated) {
    return "authored";
  }
  return "startup";
}

function isStartupRuleEnabled(rule) {
  if (!rule) {
    return false;
  }

  const override = getStartupRuleOverride(rule.startupRuleID);
  if (override && override.enabled !== undefined) {
    return override.enabled === true;
  }

  if (isGeneratedStartupRule(rule)) {
    return rule.enabled !== false;
  }

  if (config.npcAuthoredStartupEnabled !== true) {
    return false;
  }

  return rule.enabled !== false;
}

function listStartupRulesForSystem(systemID) {
  if (process.env.EVEJS_SKIP_NPC_STARTUP === "1") {
    return [];
  }

  const numericSystemID = toPositiveInt(systemID, 0);
  const startupRules = listNpcStartupRules().filter(
    (rule) => ruleAppliesToSystem(rule, numericSystemID) && isStartupRuleEnabled(rule),
  );
  const startupRuleOperatorKinds = new Set(
    startupRules
      .map((rule) => String(rule && rule.operatorKind || "").trim())
      .filter(Boolean),
  );
  const dynamicRules = listDynamicStartupRulesForSystem(numericSystemID).filter((rule) => (
    !startupRuleOperatorKinds.has(String(rule && rule.operatorKind || "").trim())
  ));
  return [
    ...startupRules,
    ...dynamicRules,
  ];
}

function countExistingStartupControllers(scene, startupRuleID, anchorID) {
  return listControllers().filter((controller) => (
    toPositiveInt(controller && controller.systemID, 0) === toPositiveInt(scene && scene.systemID, 0) &&
    scene &&
    scene.getEntityByID(toPositiveInt(controller && controller.entityID, 0)) &&
    String(controller && controller.startupRuleID || "").trim() === String(startupRuleID || "").trim() &&
    toPositiveInt(controller && controller.anchorID, 0) === toPositiveInt(anchorID, 0)
  )).length;
}

function spawnStartupRuleInScene(scene, rule) {
  const selector = rule && rule.anchorSelector && typeof rule.anchorSelector === "object"
    ? rule.anchorSelector
    : {};
  const anchorsResult = resolveAnchors(scene.systemID, selector);
  if (!anchorsResult.success || !anchorsResult.data) {
    return {
      success: false,
      errorMsg: anchorsResult.errorMsg || "ANCHOR_NOT_FOUND",
      data: {
        rule,
        anchors: [],
        spawned: [],
      },
    };
  }

  const spawned = [];
  const groupsPerAnchor = Math.max(1, toPositiveInt(rule.groupsPerAnchor, 1));
  for (const anchor of anchorsResult.data.anchors) {
    const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
    const existingCount = anchorID > 0
      ? countExistingStartupControllers(scene, rule.startupRuleID, anchorID)
      : 0;
    for (let groupIndex = existingCount; groupIndex < groupsPerAnchor; groupIndex += 1) {
      const spawnResult = spawnNpcGroupInSystem(scene.systemID, {
        entityType: String(rule.entityType || "npc"),
        spawnGroupQuery: rule.spawnGroupID,
        anchorEntity: anchor,
        preferredTargetID: toPositiveInt(rule.preferredTargetID, 0),
        startupRuleID: String(rule.startupRuleID || "").trim() || null,
        operatorKind: String(rule.operatorKind || "").trim() || null,
        transient: rule.transient === true,
        behaviorOverrides: rule.behaviorOverrides,
        spawnDistanceMeters: toFiniteNumber(
          selector.spawnDistanceMeters,
          0,
        ),
        distanceFromSurfaceMeters: toFiniteNumber(
          selector.distanceFromSurfaceMeters,
          0,
        ),
        spreadMeters: toFiniteNumber(selector.spreadMeters, 0),
        formationSpacingMeters: toFiniteNumber(
          selector.formationSpacingMeters,
          0,
        ),
      });
      if (!spawnResult.success || !spawnResult.data) {
        return {
          success: false,
          errorMsg: spawnResult.errorMsg || "NPC_STARTUP_SPAWN_FAILED",
          data: {
            rule,
            anchors: anchorsResult.data.anchors,
            spawned,
          },
        };
      }

      spawned.push(...spawnResult.data.spawned);
    }
  }

  return {
    success: true,
    data: {
      rule,
      anchors: anchorsResult.data.anchors,
      spawned,
    },
  };
}

function getStartupRuleMissingCount(scene, rule) {
  const selector = rule && rule.anchorSelector && typeof rule.anchorSelector === "object"
    ? rule.anchorSelector
    : {};
  const anchorsResult = resolveAnchors(scene.systemID, selector);
  if (!anchorsResult.success || !anchorsResult.data) {
    return {
      success: false,
      errorMsg: anchorsResult.errorMsg || "ANCHOR_NOT_FOUND",
      data: {
        anchors: [],
        missingCount: 0,
      },
    };
  }

  const groupsPerAnchor = Math.max(1, toPositiveInt(rule && rule.groupsPerAnchor, 1));
  let missingCount = 0;
  for (const anchor of anchorsResult.data.anchors) {
    const anchorID = toPositiveInt(anchor && anchor.itemID, 0);
    const existingCount = anchorID > 0
      ? countExistingStartupControllers(scene, rule.startupRuleID, anchorID)
      : 0;
    missingCount += Math.max(0, groupsPerAnchor - existingCount);
  }

  return {
    success: true,
    data: {
      anchors: anchorsResult.data.anchors,
      missingCount,
    },
  };
}

function maintainStartupRulesInScene(scene, now) {
  if (!scene) {
    return;
  }

  const maintenanceIntervalMs = 1_000;
  if (toFiniteNumber(scene._npcStartupMaintenanceNextAtMs, 0) > now) {
    return;
  }
  scene._npcStartupMaintenanceNextAtMs = now + maintenanceIntervalMs;

  if (!scene._npcStartupRespawnDeadlines || typeof scene._npcStartupRespawnDeadlines !== "object") {
    scene._npcStartupRespawnDeadlines = Object.create(null);
  }

  const activeRuleIDs = new Set();
  for (const rule of listStartupRulesForSystem(scene.systemID)) {
    if (!rule || rule.respawnEnabled === false) {
      continue;
    }

    const startupRuleID = String(rule.startupRuleID || "").trim();
    if (!startupRuleID) {
      continue;
    }
    activeRuleIDs.add(startupRuleID);

    const missingResult = getStartupRuleMissingCount(scene, rule);
    if (!missingResult.success || !missingResult.data) {
      continue;
    }

    if (missingResult.data.missingCount <= 0) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
      continue;
    }

    const respawnDelayMs = Math.max(
      1_000,
      toFiniteNumber(rule.respawnDelayMs, 15_000),
    );
    const existingDeadline = toFiniteNumber(
      scene._npcStartupRespawnDeadlines[startupRuleID],
      0,
    );
    if (existingDeadline <= 0) {
      scene._npcStartupRespawnDeadlines[startupRuleID] = now + respawnDelayMs;
      continue;
    }

    if (now < existingDeadline) {
      continue;
    }

    spawnStartupRuleInScene(scene, rule);
    const postSpawnMissingResult = getStartupRuleMissingCount(scene, rule);
    if (
      postSpawnMissingResult.success &&
      postSpawnMissingResult.data &&
      postSpawnMissingResult.data.missingCount <= 0
    ) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
    } else {
      scene._npcStartupRespawnDeadlines[startupRuleID] = now + respawnDelayMs;
    }
  }

  for (const startupRuleID of Object.keys(scene._npcStartupRespawnDeadlines)) {
    if (!activeRuleIDs.has(startupRuleID)) {
      delete scene._npcStartupRespawnDeadlines[startupRuleID];
    }
  }
}

function spawnStartupRulesForSystem(systemID) {
  const scene = spaceRuntime.ensureScene(systemID);
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  const rules = listStartupRulesForSystem(scene.systemID);
  const applied = [];
  for (const rule of rules) {
    applied.push(spawnStartupRuleInScene(scene, rule));
  }

  return {
    success: true,
    data: {
      systemID: scene.systemID,
      applied,
    },
  };
}

function tickScene(scene, now) {
  tickBehaviorScene(scene, now);
  maintainStartupRulesInScene(scene, now);
}

function handleSceneCreated(scene) {
  if (!scene || scene._npcStartupInitialized === true) {
    return {
      success: true,
      data: {
        rehydrated: [],
        applied: [],
      },
    };
  }

  scene._npcStartupInitialized = true;
  const removedStaleStartupNpcs = cleanupStalePersistedStartupNpcs(scene);
  const rehydrated = [];
  for (const entity of scene.dynamicEntities.values()) {
    const controller = hydratePersistedNpcController(scene, entity);
    if (controller) {
      rehydrated.push(controller);
    }
  }

  const startupResult = spawnStartupRulesForSystem(scene.systemID);
  return {
    success: startupResult.success,
    errorMsg: startupResult.errorMsg || null,
    data: {
      removedStaleStartupNpcs,
      rehydrated,
      applied:
        startupResult.success && startupResult.data && Array.isArray(startupResult.data.applied)
          ? startupResult.data.applied
          : [],
    },
  };
}

function getOperatorStartupRulesForSystem(systemID, operatorKind) {
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedOperatorKind) {
    return [];
  }

  return listNpcStartupRules().filter((rule) => (
    ruleAppliesToSystem(rule, systemID) &&
    String(rule && rule.operatorKind || "").trim() === normalizedOperatorKind
  ));
}

function getGateOperatorState(systemID, operatorKind) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const startupRules = getOperatorStartupRulesForSystem(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  if (startupRules.length > 0) {
    return {
      success: true,
      data: {
        systemID: normalizedSystemID,
        operatorKind: normalizedOperatorKind,
        source: getStartupRuleSource(startupRules),
        enabled: startupRules.some((rule) => isStartupRuleEnabled(rule)),
        startupRuleIDs: startupRules.map((rule) => String(rule.startupRuleID || "").trim()).filter(Boolean),
        gateControl: getSystemGateControl(normalizedSystemID),
      },
    };
  }

  const gateControl = getSystemGateControl(normalizedSystemID);
  const dynamicRuleID = getDynamicGateStartupRuleID(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  const enabled = normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD
    ? gateControl.gateConcordEnabled === true
    : gateControl.gateRatEnabled === true;
  return {
    success: true,
    data: {
      systemID: normalizedSystemID,
      operatorKind: normalizedOperatorKind,
      source: "dynamic",
      enabled,
      startupRuleIDs: dynamicRuleID ? [dynamicRuleID] : [],
      gateControl,
    },
  };
}

function wakeControllersInSystem(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return;
  }

  for (const controller of listControllersBySystem(normalizedSystemID)) {
    controller.nextThinkAtMs = 0;
  }
}

function wakeNpcController(entityID, whenMs = 0) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const normalizedWhenMs = Math.max(0, toFiniteNumber(whenMs, 0));
  controller.nextThinkAtMs =
    normalizedWhenMs > 0
      ? Math.min(
          toFiniteNumber(controller.nextThinkAtMs, normalizedWhenMs),
          normalizedWhenMs,
        )
      : 0;
  return {
    success: true,
    data: controller,
  };
}

function cleanupNpcOwnerArtifacts(ownerCharacterID) {
  const normalizedOwnerCharacterID = toPositiveInt(ownerCharacterID, 0);
  if (!normalizedOwnerCharacterID) {
    return;
  }

  database.remove("skills", `/${String(normalizedOwnerCharacterID)}`);
  database.remove("characters", `/${String(normalizedOwnerCharacterID)}`);
}

function destroyNpcController(controller, options = {}) {
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  const systemID = toPositiveInt(controller.systemID, 0);
  const entityID = toPositiveInt(controller.entityID, 0);
  const removeContents = options.removeContents !== false;
  let destroyResult = null;
  if (systemID > 0 && entityID > 0) {
    const scene = spaceRuntime.ensureScene(systemID);
    const runtimeEntity = scene ? scene.getEntityByID(entityID) : null;
    if (runtimeEntity) {
      destroyResult = spaceRuntime.removeDynamicEntity(systemID, entityID, {
        allowSessionOwned: true,
      });
    }
  }

  const shipItem = findShipItemById(entityID);
  if (shipItem) {
    removeInventoryItem(entityID, {
      removeContents,
    });
  }

  unregisterController(entityID);
  cleanupNpcOwnerArtifacts(controller.ownerCharacterID);
  return {
    success: true,
    data: {
      entityID,
      systemID,
      removedRuntimeEntity: destroyResult ? destroyResult.success === true : false,
      removedInventoryItem: Boolean(shipItem),
    },
  };
}

function destroyNpcControllerByEntityID(entityID, options = {}) {
  const controller = getControllerByEntityID(entityID);
  if (!controller) {
    return {
      success: false,
      errorMsg: "NPC_NOT_FOUND",
    };
  }

  return destroyNpcController(controller, options);
}

function clearNpcControllersInSystem(systemID, options = {}) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (!normalizedSystemID) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const entityTypeFilter = String(options.entityType || "all").trim().toLowerCase() || "all";
  const allowedEntityTypes = new Set(
    entityTypeFilter === "all"
      ? ["npc", "concord"]
      : entityTypeFilter === "rat" || entityTypeFilter === "rats"
        ? ["npc"]
        : [entityTypeFilter],
  );
  const startupRuleFilter = Array.isArray(options.startupRuleIDs)
    ? new Set(
        options.startupRuleIDs
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      )
    : null;
  const centerPosition = options.centerPosition && typeof options.centerPosition === "object"
    ? cloneVector(options.centerPosition)
    : null;
  const radiusMeters = Math.max(0, toFiniteNumber(options.radiusMeters, 0));
  const scene = spaceRuntime.ensureScene(normalizedSystemID);
  const destroyed = [];

  for (const controller of listControllersBySystem(normalizedSystemID)) {
    if (!allowedEntityTypes.has(String(controller.entityType || "npc").trim().toLowerCase())) {
      continue;
    }
    if (
      startupRuleFilter &&
      !startupRuleFilter.has(String(controller.startupRuleID || "").trim())
    ) {
      continue;
    }

    if (centerPosition && radiusMeters > 0) {
      const entity = scene && scene.getEntityByID(toPositiveInt(controller.entityID, 0));
      if (!entity || !entity.position) {
        continue;
      }
      const dx = toFiniteNumber(entity.position.x, 0) - toFiniteNumber(centerPosition.x, 0);
      const dy = toFiniteNumber(entity.position.y, 0) - toFiniteNumber(centerPosition.y, 0);
      const dz = toFiniteNumber(entity.position.z, 0) - toFiniteNumber(centerPosition.z, 0);
      const distanceMeters = Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
      if (distanceMeters > radiusMeters) {
        continue;
      }
    }

    destroyNpcController(controller, options);
    destroyed.push({
      entityID: controller.entityID,
      startupRuleID: controller.startupRuleID || null,
      entityType: controller.entityType || "npc",
    });
  }

  return {
    success: true,
    data: {
      systemID: normalizedSystemID,
      destroyed,
      destroyedCount: destroyed.length,
    },
  };
}

function clearNpcControllersForSessionRadius(session, options = {}) {
  if (!session || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const systemID = toPositiveInt(session._space.systemID, 0);
  const shipEntity = spaceRuntime.getEntity(session, session._space.shipID);
  if (!systemID || !shipEntity || !shipEntity.position) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  return clearNpcControllersInSystem(systemID, {
    ...options,
    centerPosition: shipEntity.position,
  });
}

function setGateOperatorEnabled(systemID, operatorKind, enabled) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  const normalizedOperatorKind = String(operatorKind || "").trim();
  if (!normalizedSystemID || !normalizedOperatorKind) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const startupRules = getOperatorStartupRulesForSystem(
    normalizedSystemID,
    normalizedOperatorKind,
  );
  if (startupRules.length > 0) {
    for (const rule of startupRules) {
      const overrideResult = setStartupRuleEnabledOverride(
        rule.startupRuleID,
        enabled === true,
      );
      if (!overrideResult.success) {
        return overrideResult;
      }
    }
  } else {
    const gateControlUpdates = normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD
      ? { gateConcordEnabled: enabled === true }
      : { gateRatEnabled: enabled === true };
    const gateControlResult = setSystemGateControl(
      normalizedSystemID,
      gateControlUpdates,
    );
    if (!gateControlResult.success) {
      return gateControlResult;
    }
  }

  if (enabled === true) {
    const spawnResult = spawnStartupRulesForSystem(normalizedSystemID);
    if (!spawnResult.success) {
      return spawnResult;
    }
  } else {
    const gateState = getGateOperatorState(normalizedSystemID, normalizedOperatorKind);
    if (!gateState.success) {
      return gateState;
    }
    clearNpcControllersInSystem(normalizedSystemID, {
      entityType:
        normalizedOperatorKind === GATE_OPERATOR_KIND.CONCORD
          ? "concord"
          : "npc",
      startupRuleIDs: gateState.data.startupRuleIDs,
      removeContents: true,
    });
  }

  return getGateOperatorState(normalizedSystemID, normalizedOperatorKind);
}

function setCharacterNpcInvulnerability(characterID, enabled) {
  return setCharacterInvulnerability(characterID, enabled);
}

function toggleCharacterNpcInvulnerability(characterID) {
  return toggleCharacterInvulnerability(characterID);
}

function noteNpcIncomingAggression(targetEntity, attackerEntity, now) {
  const targetEntityID = toPositiveInt(targetEntity && targetEntity.itemID, 0);
  const attackerEntityID = toPositiveInt(attackerEntity && attackerEntity.itemID, 0);
  if (!targetEntityID || !attackerEntityID) {
    return {
      success: false,
      errorMsg: "ENTITY_NOT_FOUND",
    };
  }

  return noteIncomingAggression(targetEntityID, attackerEntityID, now);
}

function getNpcOperatorSummary() {
  return listControllers().map((controller) => ({
    entityID: controller.entityID,
    systemID: controller.systemID,
    profileID: controller.profileID,
    currentTargetID: controller.currentTargetID || 0,
    preferredTargetID: controller.preferredTargetID || 0,
    entityType: controller.entityType || "npc",
    selectionKind: controller.selectionKind || null,
    selectionID: controller.selectionID || null,
    spawnGroupID: controller.spawnGroupID || null,
    spawnSiteID: controller.spawnSiteID || null,
    startupRuleID: controller.startupRuleID || null,
    operatorKind: controller.operatorKind || null,
    anchorKind: controller.anchorKind || null,
    anchorID: controller.anchorID || 0,
    transient: controller.transient === true,
    allowPodKill:
      controller.behaviorOverrides &&
      Object.prototype.hasOwnProperty.call(controller.behaviorOverrides, "allowPodKill")
        ? controller.behaviorOverrides.allowPodKill === true
        : controller.behaviorProfile && controller.behaviorProfile.allowPodKill === true,
    manualOrderType:
      controller.manualOrder && controller.manualOrder.type
        ? String(controller.manualOrder.type)
        : null,
    returningHome: controller.returningHome === true,
  }));
}

module.exports = {
  GATE_OPERATOR_KIND,
  listNpcProfiles,
  listNpcSpawnPools,
  listNpcSpawnGroups,
  listNpcSpawnSites,
  listNpcStartupRules,
  getGateOperatorState,
  resolveProfileDefinition,
  spawnNpcBatchForSession,
  spawnNpcBatchInSystem,
  spawnNpcForSession,
  spawnConcordBatchForSession,
  spawnConcordForSession,
  spawnNpcGroupInSystem,
  spawnNpcSite,
  spawnNpcSiteForSession,
  spawnStartupRulesForSystem,
  handleSceneCreated,
  tickScene,
  issueManualOrder,
  setBehaviorOverrides,
  clearNpcControllersInSystem,
  clearNpcControllersForSessionRadius,
  setGateOperatorEnabled,
  setCharacterNpcInvulnerability,
  toggleCharacterNpcInvulnerability,
  isCharacterInvulnerable,
  noteNpcIncomingAggression,
  getControllerByEntityID,
  destroyNpcControllerByEntityID,
  parseNpcCustomInfo,
  getNpcOperatorSummary,
  wakeNpcController,
};

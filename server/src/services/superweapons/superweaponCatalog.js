const {
  resolveItemByTypeID,
} = require("../inventory/itemTypeRegistry");
const {
  getTypeAttributeValue,
} = require("../fitting/liveFittingState");

const DIRECTED_TITAN_SUPERWEAPON_LOADOUTS = Object.freeze([
  {
    hullTypeID: 11567,
    moduleTypeID: 24550,
    fxGuid: "effects.SuperWeaponAmarr",
    family: "doomsday",
  },
  {
    hullTypeID: 11567,
    moduleTypeID: 40631,
    fxGuid: "effects.SuperWeaponLanceAmarr",
    family: "lance",
  },
  {
    hullTypeID: 11567,
    moduleTypeID: 40632,
    fxGuid: null,
    family: "reaper",
  },
  {
    hullTypeID: 3764,
    moduleTypeID: 24552,
    fxGuid: "effects.SuperWeaponCaldari",
    family: "doomsday",
  },
  {
    hullTypeID: 3764,
    moduleTypeID: 41439,
    fxGuid: "effects.SuperWeaponLanceCaldari",
    family: "lance",
  },
  {
    hullTypeID: 3764,
    moduleTypeID: 41442,
    fxGuid: null,
    family: "reaper",
  },
  {
    hullTypeID: 671,
    moduleTypeID: 24554,
    fxGuid: "effects.SuperWeaponGallente",
    family: "doomsday",
  },
  {
    hullTypeID: 671,
    moduleTypeID: 41440,
    fxGuid: "effects.SuperWeaponLanceGallente",
    family: "lance",
  },
  {
    hullTypeID: 671,
    moduleTypeID: 41443,
    fxGuid: null,
    family: "reaper",
  },
  {
    hullTypeID: 23773,
    moduleTypeID: 23674,
    fxGuid: "effects.SuperWeaponMinmatar",
    family: "doomsday",
  },
  {
    hullTypeID: 23773,
    moduleTypeID: 41441,
    fxGuid: "effects.SuperWeaponLanceMinmatar",
    family: "lance",
  },
  {
    hullTypeID: 23773,
    moduleTypeID: 41444,
    fxGuid: null,
    family: "reaper",
  },
]);

function resolveType(typeID) {
  const itemType = resolveItemByTypeID(Number(typeID) || 0);
  return itemType || null;
}

function resolveFuelTypeID(moduleTypeID) {
  return Number(getTypeAttributeValue(moduleTypeID, "consumptionType")) || 0;
}

function resolveFuelPerActivation(moduleTypeID) {
  return Number(getTypeAttributeValue(moduleTypeID, "consumptionQuantity")) || 0;
}

function hydrateLoadout(baseLoadout) {
  if (!baseLoadout) {
    return null;
  }

  const hullType = resolveType(baseLoadout.hullTypeID);
  const moduleType = resolveType(baseLoadout.moduleTypeID);
  const fuelTypeID = resolveFuelTypeID(baseLoadout.moduleTypeID);
  const fuelType = resolveType(fuelTypeID);
  if (!hullType || !moduleType || !fuelTypeID || !fuelType) {
    return null;
  }

  return Object.freeze({
    ...baseLoadout,
    hullType,
    moduleType,
    fuelTypeID,
    fuelType,
    fuelPerActivation: resolveFuelPerActivation(baseLoadout.moduleTypeID),
  });
}

function listTitanSuperweaponLoadouts(options = {}) {
  const requireFxGuid = options.requireFxGuid === true;
  return DIRECTED_TITAN_SUPERWEAPON_LOADOUTS
    .filter((loadout) => !requireFxGuid || Boolean(loadout.fxGuid))
    .map(hydrateLoadout)
    .filter(Boolean);
}

function pickRandomTitanSuperweaponLoadout(options = {}) {
  const random =
    typeof options.random === "function"
      ? options.random
      : Math.random;
  const loadouts = listTitanSuperweaponLoadouts(options);
  if (loadouts.length === 0) {
    return null;
  }

  const boundedRandom = Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return loadouts[Math.floor(boundedRandom * loadouts.length)] || loadouts[0];
}

module.exports = {
  DIRECTED_TITAN_SUPERWEAPON_LOADOUTS,
  listTitanSuperweaponLoadouts,
  pickRandomTitanSuperweaponLoadout,
  resolveFuelTypeID,
  resolveFuelPerActivation,
};

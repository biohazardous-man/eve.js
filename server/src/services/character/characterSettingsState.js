const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

function toCharacterID(value) {
  const numeric = Number(value) || 0;
  return numeric > 0 ? Math.trunc(numeric) : 0;
}

function normalizeSettingKey(settingKey) {
  return String(settingKey || "").trim();
}

function getSettingsPath(characterID) {
  return `/${toCharacterID(characterID)}/characterSettings`;
}

function getSettingPath(characterID, settingKey) {
  return `${getSettingsPath(characterID)}/${normalizeSettingKey(settingKey)}`;
}

function cloneSettings(settings) {
  return { ...(settings && typeof settings === "object" ? settings : {}) };
}

function getCharacterSettings(characterID) {
  const numericCharacterID = toCharacterID(characterID);
  if (!numericCharacterID) {
    return {};
  }

  const readResult = database.read("characters", getSettingsPath(numericCharacterID));
  if (!readResult.success || !readResult.data || typeof readResult.data !== "object") {
    return {};
  }

  return cloneSettings(readResult.data);
}

function getCharacterSetting(characterID, settingKey, fallback = null) {
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!normalizedKey) {
    return fallback;
  }

  const settings = getCharacterSettings(characterID);
  return Object.prototype.hasOwnProperty.call(settings, normalizedKey)
    ? settings[normalizedKey]
    : fallback;
}

function setCharacterSetting(characterID, settingKey, value) {
  const numericCharacterID = toCharacterID(characterID);
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!numericCharacterID || !normalizedKey) {
    return false;
  }

  const writeResult = database.write(
    "characters",
    getSettingPath(numericCharacterID, normalizedKey),
    value,
  );
  return Boolean(writeResult && writeResult.success);
}

function deleteCharacterSetting(characterID, settingKey) {
  const numericCharacterID = toCharacterID(characterID);
  const normalizedKey = normalizeSettingKey(settingKey);
  if (!numericCharacterID || !normalizedKey) {
    return false;
  }

  const removeResult = database.remove(
    "characters",
    getSettingPath(numericCharacterID, normalizedKey),
  );
  return Boolean(
    removeResult &&
    (removeResult.success || removeResult.errorMsg === "ENTRY_NOT_FOUND"),
  );
}

module.exports = {
  getCharacterSettings,
  getCharacterSetting,
  setCharacterSetting,
  deleteCharacterSetting,
};

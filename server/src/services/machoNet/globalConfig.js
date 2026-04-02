const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  buildClientGlobalConfigEntries,
} = require(path.join(__dirname, "../newEdenStore/storeState"));

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const SAFE_DEFAULT_COUNTRY_CODE = "GB";

function coerceCountryCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCountryCode(value, fallback = config.defaultCountryCode) {
  const fallbackCountryCode =
    coerceCountryCode(fallback) || SAFE_DEFAULT_COUNTRY_CODE;
  const normalizedCountryCode = coerceCountryCode(value);

  if (!normalizedCountryCode || normalizedCountryCode === "KR") {
    return fallbackCountryCode === "KR"
      ? SAFE_DEFAULT_COUNTRY_CODE
      : fallbackCountryCode;
  }

  return normalizedCountryCode;
}

function buildGlobalConfigEntries() {
  return [
    ["imageserverurl", config.imageServerUrl],
    ["defaultPortraitSaveSize", 1024],
    ["HyperNetKillSwitch", config.hyperNetKillSwitch ? 1 : 0],
    ["HyperNetPlexPriceOverride", Number(config.hyperNetPlexPriceOverride || 0) || 0],
    ...buildClientGlobalConfigEntries(),
  ];
}

function buildGlobalConfigDict() {
  return {
    type: "dict",
    entries: buildGlobalConfigEntries(),
  };
}

module.exports = {
  buildGlobalConfigDict,
  buildGlobalConfigEntries,
  normalizeCountryCode,
};

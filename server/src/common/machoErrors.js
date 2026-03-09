const { MACHONETERR_TYPE } = require("./packetTypes");

class MachoWrappedException extends Error {
  constructor(payload, message = "Wrapped remote exception") {
    super(message);
    this.name = "MachoWrappedException";
    this.machoErrorResponse = {
      errorCode: MACHONETERR_TYPE.WRAPPEDEXCEPTION,
      payload,
    };
  }
}

function buildUserErrorPayload(message = "", values = {}) {
  const dictEntries = Object.entries(values);

  return {
    type: "objectex1",
    header: [
      { type: "token", value: "ccp_exceptions.UserError" },
      [message, { type: "dict", entries: dictEntries }],
      {
        type: "dict",
        entries: [
          ["msg", message],
          ["dict", { type: "dict", entries: dictEntries }],
        ],
      },
    ],
    list: [],
    dict: [],
  };
}

function throwWrappedUserError(message = "", values = {}) {
  throw new MachoWrappedException(buildUserErrorPayload(message, values));
}

function isMachoWrappedException(error) {
  return Boolean(error && error.machoErrorResponse);
}

module.exports = {
  MachoWrappedException,
  buildUserErrorPayload,
  throwWrappedUserError,
  isMachoWrappedException,
};

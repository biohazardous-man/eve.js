const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  isMachoWrappedException,
} = require(path.join(
  repoRoot,
  "server/src/common/machoErrors",
));

function buildLiveSession(overrides = {}) {
  return {
    userid: 1,
    userName: "test-user",
    characterID: 0,
    characterName: "",
    clientID: 0,
    socket: {
      destroyed: false,
    },
    ...overrides,
  };
}

test("SelectCharacterID rejects a character that is already online in another live session", (t) => {
  const service = new CharService();
  const existingSession = buildLiveSession({
    userid: 2,
    userName: "existing-user",
    clientID: 77,
    characterID: 140000001,
    characterName: "testchar",
  });
  const selectingSession = buildLiveSession({
    userid: 1,
    userName: "new-user",
  });

  sessionRegistry.register(existingSession);
  t.after(() => {
    sessionRegistry.unregister(existingSession);
    sessionRegistry.unregister(selectingSession);
  });

  assert.throws(
    () => service.Handle_SelectCharacterID([140000001], selectingSession),
    (error) => {
      assert.equal(isMachoWrappedException(error), true);
      assert.equal(
        error.machoErrorResponse.payload.header[1][0],
        "CustomInfo",
      );

      const infoEntry = error.machoErrorResponse.payload.header[1][1].entries.find(
        ([key]) => key === "info",
      );
      assert.ok(infoEntry);
      assert.match(String(infoEntry[1]), /already online/i);
      return true;
    },
  );
});

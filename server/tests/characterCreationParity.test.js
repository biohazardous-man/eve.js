const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const CharMgrService = require(path.join(
  repoRoot,
  "server/src/services/character/charMgrService",
));
const PaperDollServerService = require(path.join(
  repoRoot,
  "server/src/services/character/paperDollServerService",
));
const {
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  resolveCharacterCreationBloodlineProfile,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterCreationData",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

test("modern CreateCharacterWithDoll stores identity and paper-doll metadata on parity", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const charService = new CharService();
  const charMgrService = new CharMgrService();
  const paperDollServer = new PaperDollServerService();
  const session = {
    userid: 910001,
    charid: null,
    characterID: null,
  };

  const appearanceInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["sculpts", { type: "list", items: [{ sculptLocationID: 1, weightUpDown: 0.25 }] }],
        ["modifiers", { type: "list", items: [{ modifierLocationID: 10, paperdollResourceID: 20 }] }],
        ["appearance", { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["hairDarkness", 0.75]] } }],
      ],
    },
  };
  const portraitInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["backgroundID", 1003],
        ["lightID", 2002],
        ["lightColorID", 3001],
        ["lightIntensity", 0.9],
        ["cameraFieldOfView", 0.55],
      ],
    },
  };

  const existingCharacterCount = charService.Handle_GetNumCharacters([], session);
  const newCharacterId = charService.Handle_CreateCharacterWithDoll(
    [
      "Parity Modern Contract",
      4,
      5,
      0,
      3,
      appearanceInfo,
      portraitInfo,
      11,
    ],
    session,
  );

  const record = getCharacterRecord(newCharacterId);
  assert.ok(record, "expected a created character record");
  assert.equal(record.characterName, "Parity Modern Contract");
  assert.equal(record.raceID, 4);
  assert.equal(record.bloodlineID, 5);
  assert.equal(record.gender, 0);
  assert.equal(record.ancestryID, 3);
  assert.equal(record.schoolID, 11);
  assert.equal(record.paperDollState, 0);
  assert.deepEqual(record.appearanceInfo, appearanceInfo);
  assert.deepEqual(record.portraitInfo, portraitInfo);

  assert.equal(
    charService.Handle_GetNumCharacters([], session),
    existingCharacterCount + 1,
  );

  const storedAppearance = paperDollServer.Handle_GetPaperDollData([newCharacterId], session);
  assert.deepEqual(storedAppearance, appearanceInfo);

  const portraitTuple = paperDollServer.Handle_GetPaperDollPortraitDataFor(
    [newCharacterId],
    session,
  );
  const portraitItems = extractListItems(portraitTuple[0]);
  assert.equal(portraitItems.length, 1);
  assert.deepEqual(portraitItems[0], portraitInfo);

  const paperDollState = charMgrService.Handle_GetPaperdollState(
    [newCharacterId],
    { characterID: newCharacterId, charid: newCharacterId },
  );
  assert.equal(paperDollState, 0);

  const creationDate = charMgrService.Handle_GetCharacterCreationDate(
    [newCharacterId],
    { characterID: newCharacterId, charid: newCharacterId },
  );
  assert.equal(creationDate.type, "long");
});

test("paperDollServer recustomization updates and char identity updates round-trip cleanly", async (t) => {
  const originalCharacters = cloneValue(database.read("characters", "/").data);
  const originalItems = cloneValue(database.read("items", "/").data);
  const originalSkills = cloneValue(database.read("skills", "/").data);

  t.after(() => {
    database.write("characters", "/", originalCharacters);
    database.write("items", "/", originalItems);
    database.write("skills", "/", originalSkills);
    database.flushAllSync();
  });

  const charService = new CharService();
  const paperDollServer = new PaperDollServerService();
  const ownerSession = {
    userid: 910002,
    charid: null,
    characterID: null,
  };

  const charId = charService.Handle_CreateCharacterWithDoll(
    [
      "Recustomization Parity",
      1,
      1,
      1,
      1,
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["modifiers", { type: "list", items: [] }]] } },
      { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["backgroundID", 1001]] } },
      11,
    ],
    ownerSession,
  );

  ownerSession.charid = charId;
  ownerSession.characterID = charId;

  const limitedAppearanceInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["sculpts", { type: "list", items: [] }],
        ["modifiers", { type: "list", items: [{ modifierLocationID: 7, paperdollResourceID: 88 }] }],
      ],
    },
  };
  const limitedPortraitInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["backgroundID", 1005],
        ["lightID", 2006],
      ],
    },
  };

  paperDollServer.Handle_UpdateExistingCharacterLimited(
    [charId, limitedAppearanceInfo, limitedPortraitInfo, true],
    ownerSession,
  );

  let record = getCharacterRecord(charId);
  assert.deepEqual(record.appearanceInfo, limitedAppearanceInfo);
  assert.deepEqual(record.portraitInfo, limitedPortraitInfo);
  assert.equal(record.paperDollState, 0);

  charService.Handle_UpdateCharacterGender([charId, 0], ownerSession);
  record = getCharacterRecord(charId);
  assert.equal(record.gender, 0);
  assert.equal(ownerSession.genderID, 0);

  const updatedBloodlineProfile = resolveCharacterCreationBloodlineProfile(8, {
    raceID: record.raceID || 1,
    typeID: record.typeID || 1373,
    corporationID: record.corporationID || 1000009,
  });
  charService.Handle_UpdateCharacterBloodline([charId, 8], ownerSession);
  record = getCharacterRecord(charId);
  assert.equal(record.bloodlineID, 8);
  assert.equal(record.raceID, updatedBloodlineProfile.raceID);
  assert.equal(record.typeID, updatedBloodlineProfile.typeID);
  assert.equal(ownerSession.bloodlineID, 8);
  assert.equal(ownerSession.raceID, updatedBloodlineProfile.raceID);

  const storedAppearance = paperDollServer.Handle_GetPaperDollData([charId], ownerSession);
  assert.deepEqual(storedAppearance, limitedAppearanceInfo);
});

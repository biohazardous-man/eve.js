const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const {
  calculateSkillPointsForLevel,
  getCharacterSkills,
  getUnpublishedSkillTypes,
} = require(path.join(
  __dirname,
  "../../server/src/services/skills/skillState",
));

const TEST_CHAR_ID = 190000999;

function main() {
  const unpublishedSkillTypes = getUnpublishedSkillTypes();
  assert(
    unpublishedSkillTypes.length > 0,
    "Expected unpublished skill types to be available in local reference data",
  );
  assert(
    unpublishedSkillTypes.some((skillType) => Number(skillType.typeID) === 9955),
    "Expected Polaris to be included in unpublished skill types",
  );

  const skillsRoot = database.read("skills", "/");
  assert(skillsRoot.success, "Failed to read runtime skills table");
  const originalEntry = Object.prototype.hasOwnProperty.call(
    skillsRoot.data || {},
    String(TEST_CHAR_ID),
  )
    ? skillsRoot.data[String(TEST_CHAR_ID)]
    : undefined;

  try {
    database.remove("skills", `/${TEST_CHAR_ID}`);

    const result = executeChatCommand(
      { characterID: TEST_CHAR_ID },
      "/gmskills",
      null,
      { emitChatFeedback: false },
    );

    assert.strictEqual(result.handled, true, "Command should be handled");
    assert(
      result.message.includes("GM/unpublished skills"),
      "Feedback should mention GM/unpublished skills",
    );
    assert(
      result.message.includes("Polaris(9955)"),
      "Feedback should mention Polaris",
    );
    assert(
      result.message.includes(`You now have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}`),
      "Feedback should report the total unpublished skill coverage after the first grant",
    );

    const unpublishedSkills = getCharacterSkills(TEST_CHAR_ID)
      .filter((skill) => skill.published === false);
    assert.strictEqual(
      unpublishedSkills.length,
      unpublishedSkillTypes.length,
      "Command should expose every unpublished skill type on the character",
    );

    const polarisSkill = unpublishedSkills.find((skill) => Number(skill.typeID) === 9955);
    assert(polarisSkill, "Expected Polaris skill record after /gmskills");
    assert.strictEqual(polarisSkill.skillLevel, 5, "Polaris skill should be level V");
    assert.strictEqual(
      polarisSkill.trainedSkillLevel,
      5,
      "Polaris trained skill level should be V",
    );
    assert.strictEqual(
      polarisSkill.skillPoints,
      calculateSkillPointsForLevel(polarisSkill.skillRank, polarisSkill.skillLevel),
      "Polaris should use its real rank-based level V SP total",
    );

    const secondResult = executeChatCommand(
      { characterID: TEST_CHAR_ID },
      "/gmskills",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(secondResult.handled, true, "Second command run should be handled");
    assert(
      secondResult.message.includes("No new GM/unpublished skills were missing."),
      "Second run should be idempotent and only report missing skills",
    );
    assert(
      secondResult.message.includes(`You already have ${unpublishedSkillTypes.length}/${unpublishedSkillTypes.length}`),
      "Second run should report full unpublished skill coverage",
    );

    const unpublishedSkillsAfterSecondRun = getCharacterSkills(TEST_CHAR_ID)
      .filter((skill) => skill.published === false);
    assert.strictEqual(
      unpublishedSkillsAfterSecondRun.length,
      unpublishedSkillTypes.length,
      "Second /gmskills run should not duplicate or drop unpublished skills",
    );

    console.log(JSON.stringify({
      ok: true,
      unpublishedSkillCount: unpublishedSkillTypes.length,
      polaris: {
        typeID: polarisSkill.typeID,
        itemName: polarisSkill.itemName,
        skillLevel: polarisSkill.skillLevel,
        skillPoints: polarisSkill.skillPoints,
      },
      firstMessage: result.message,
      secondMessage: secondResult.message,
    }, null, 2));
  } finally {
    if (originalEntry !== undefined) {
      database.write("skills", `/${TEST_CHAR_ID}`, originalEntry);
    } else {
      database.remove("skills", `/${TEST_CHAR_ID}`);
    }
  }
}

main();

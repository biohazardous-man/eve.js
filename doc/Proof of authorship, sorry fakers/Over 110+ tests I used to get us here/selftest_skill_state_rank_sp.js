/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const database = require(path.join(
  __dirname,
  "../../server/src/newDatabase",
));
const {
  MAX_SKILL_LEVEL,
  calculateSkillPointsForLevel,
  ensureCharacterSkills,
  seedCharacterAllSkills,
} = require(path.join(
  __dirname,
  "../../server/src/services/skills/skillState",
));

const TEST_CHAR_ID = 190000998;
const NEW_SKILL_TYPE_IDS = [92397, 92398, 92399, 92400, 92541];

function main() {
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

    const blankSkills = ensureCharacterSkills(TEST_CHAR_ID);
    assert.strictEqual(
      blankSkills.length,
      0,
      "Missing characters should not auto-gain skills during a normal ensure pass",
    );

    const awardedSkills = ensureCharacterSkills(TEST_CHAR_ID, {
      defaultSkillLevel: MAX_SKILL_LEVEL,
      populateMissingSkills: true,
    });
    assert(awardedSkills.length > 0, "Expected explicit award path to create skills");

    const seededSkills = seedCharacterAllSkills(TEST_CHAR_ID, MAX_SKILL_LEVEL);
    assert.strictEqual(
      seededSkills.length,
      awardedSkills.length,
      "Dedicated all-skills seed helper should mirror the explicit award path",
    );

    const capitalShips = awardedSkills.find((skill) => Number(skill.typeID) === 20533);
    assert(capitalShips, "Expected Capital Ships to be granted by the explicit award path");
    assert.strictEqual(capitalShips.skillLevel, MAX_SKILL_LEVEL);
    assert.strictEqual(
      capitalShips.skillPoints,
      calculateSkillPointsForLevel(capitalShips.skillRank, capitalShips.skillLevel),
      "Capital Ships should use its real rank-based level V SP total",
    );
    assert(
      capitalShips.skillPoints > 256000,
      "Capital Ships should no longer be flattened to the rank-1 SP cap",
    );

    const newSkills = NEW_SKILL_TYPE_IDS.map((typeID) =>
      awardedSkills.find((skill) => Number(skill.typeID) === typeID),
    );
    assert(
      newSkills.every(Boolean),
      "Expected new skill types to be included in the all-skills seed path",
    );
    for (const skill of newSkills) {
      assert.strictEqual(skill.skillLevel, MAX_SKILL_LEVEL);
      assert.strictEqual(
        skill.skillPoints,
        calculateSkillPointsForLevel(skill.skillRank, skill.skillLevel),
        `${skill.itemName} should use its real rank-based level V SP total`,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      blankSkillCount: blankSkills.length,
      awardedSkillCount: awardedSkills.length,
      capitalShips: {
        typeID: capitalShips.typeID,
        itemName: capitalShips.itemName,
        skillLevel: capitalShips.skillLevel,
        skillRank: capitalShips.skillRank,
        skillPoints: capitalShips.skillPoints,
      },
      newSkills: newSkills.map((skill) => ({
        typeID: skill.typeID,
        itemName: skill.itemName,
        skillLevel: skill.skillLevel,
        skillRank: skill.skillRank,
        skillPoints: skill.skillPoints,
      })),
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

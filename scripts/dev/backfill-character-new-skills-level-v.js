const path = require("path");

const database = require(path.join(__dirname, "../../server/src/newDatabase"));
const {
  MAX_SKILL_LEVEL,
  grantCharacterSkillTypes,
  getCharacterSkillPointTotal,
} = require(path.join(__dirname, "../../server/src/services/skills/skillState"));

const NEW_SKILL_TYPE_IDS = Object.freeze([92397, 92398, 92399, 92400, 92541]);

function readTable(tableName) {
  const result = database.read(tableName, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    throw new Error(`Failed to read table: ${tableName}`);
  }
  return result.data;
}

function main() {
  const characters = readTable("characters");
  const skillsTable = readTable("skills");
  const characterIDs = Object.keys(characters)
    .map((charId) => Number(charId))
    .filter((charId) => Number.isInteger(charId) && charId > 0)
    .sort((left, right) => left - right);

  const results = [];
  for (const charId of characterIDs) {
    const character = characters[String(charId)] || {};
    const existingSkills = skillsTable[String(charId)] || {};
    const missingTypeIDs = NEW_SKILL_TYPE_IDS.filter(
      (typeID) => !existingSkills[String(typeID)],
    );
    const previousSkillPoints = Number(character.skillPoints || 0) || 0;
    const grantedSkills = grantCharacterSkillTypes(
      charId,
      NEW_SKILL_TYPE_IDS,
      MAX_SKILL_LEVEL,
    );
    const nextSkillPoints = Number(getCharacterSkillPointTotal(charId) || 0) || 0;

    results.push({
      charId,
      characterName: character.characterName || "",
      missingBefore: missingTypeIDs,
      grantedCount: grantedSkills.length,
      skillPointsBefore: previousSkillPoints,
      skillPointsAfter: nextSkillPoints,
      skillPointDelta: nextSkillPoints - previousSkillPoints,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    targetSkillTypeIDs: NEW_SKILL_TYPE_IDS,
    characterCount: results.length,
    changedCharacters: results.filter((entry) => entry.missingBefore.length > 0).length,
    totalSkillPointDelta: results.reduce(
      (sum, entry) => sum + entry.skillPointDelta,
      0,
    ),
    results,
  }, null, 2));
}

main();

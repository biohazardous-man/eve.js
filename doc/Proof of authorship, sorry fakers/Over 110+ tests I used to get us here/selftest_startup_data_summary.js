/*
 * Proof-of-authorship note: Primary authorship and project direction for this self-test belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

const assert = require("assert");
const path = require("path");

const {
  buildStartupDataSummary,
  formatStartupDataSummary,
} = require(path.join(
  __dirname,
  "../../server/src/utils/startupDataSummary",
));

const summary = buildStartupDataSummary();
const formattedLines = formatStartupDataSummary(summary);

assert(summary.runtime.items > 0, "expected startup summary to count items");
assert(
  summary.space.solarSystems > 0,
  "expected startup summary to count solar systems",
);
assert(summary.space.stargates > 0, "expected startup summary to count stargates");
assert(
  summary.cosmetics.skins > 0,
  "expected startup summary to count ship cosmetics skins",
);
assert(
  formattedLines.length >= 4,
  "expected startup summary to produce formatted log lines",
);

console.log(
  JSON.stringify(
    {
      runtime: summary.runtime,
      space: summary.space,
      cosmetics: summary.cosmetics,
      formattedLines,
    },
    null,
    2,
  ),
);

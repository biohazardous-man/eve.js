const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));

test("public gateway returns an empty-success response type for mercenary den activity lookups", () => {
  assert.equal(
    publicGatewayLocal._testing.getEmptySuccessResponseType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest",
    ),
    "eve_public.sovereignty.mercenaryden.activity.api.GetAllResponse",
  );
});

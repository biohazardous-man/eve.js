const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const ClientSession = require(path.join(
  repoRoot,
  "server/src/network/clientSession",
));

function buildSocket() {
  const writes = [];
  return {
    socket: {
      destroyed: false,
      remoteAddress: "127.0.0.1",
      write(buffer) {
        writes.push(Buffer.from(buffer));
      },
    },
    writes,
  };
}

test("sendRawPayload writes a normal framed payload when unencrypted", () => {
  const { socket, writes } = buildSocket();
  const session = new ClientSession({}, socket);
  const payload = Buffer.from([0xaa, 0xbb, 0xcc]);

  session.sendRawPayload(payload, { label: "tidi-test" });

  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0],
    Buffer.from([0x03, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc]),
  );
});

test("sendRawPayload reuses the encrypted framing path", () => {
  const { socket, writes } = buildSocket();
  const session = new ClientSession({}, socket, {
    encrypted: true,
    encryptFn(payload) {
      return Buffer.concat([Buffer.from([0xfe]), payload]);
    },
  });
  const payload = Buffer.from([0x10, 0x20]);

  session.sendRawPayload(payload, { label: "tidi-test" });

  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0],
    Buffer.from([0x03, 0x00, 0x00, 0x00, 0xfe, 0x10, 0x20]),
  );
});

test("sendRawPayload rejects non-buffer payloads", () => {
  const { socket } = buildSocket();
  const session = new ClientSession({}, socket);

  assert.throws(
    () => session.sendRawPayload("not-a-buffer"),
    /Buffer payload/,
  );
});

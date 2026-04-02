const { startXmppStub } = require("../../services/chat/xmppStubServer");
const config = require("../../config");
const log = require("../../utils/logger");

module.exports = {
  enabled: true,
  serviceName: "xmppChatServer",
  exec() {
    startXmppStub();
    log.debug(
      `xmpp chat server running on tls://127.0.0.1:${config.xmppServerPort}`,
    );
  },
};

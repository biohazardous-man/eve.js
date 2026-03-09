const sessions = new Set();

function register(session) {
  if (session) {
    sessions.add(session);
  }
}

function unregister(session) {
  if (session) {
    sessions.delete(session);
  }
}

function getSessions() {
  return Array.from(sessions).filter(
    (session) => session && session.socket && !session.socket.destroyed,
  );
}

module.exports = {
  register,
  unregister,
  getSessions,
};

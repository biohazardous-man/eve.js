const sessions = new Set();

function isLiveSession(session) {
  return Boolean(session && session.socket && !session.socket.destroyed);
}

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
  return Array.from(sessions).filter(isLiveSession);
}

function findSessionByCharacterID(characterID, options = {}) {
  const targetCharacterID = Number(characterID || 0);
  if (!Number.isInteger(targetCharacterID) || targetCharacterID <= 0) {
    return null;
  }

  const excludedSession = options.excludeSession || null;
  return getSessions().find((session) => (
    session !== excludedSession &&
    Number(session.characterID || 0) === targetCharacterID
  )) || null;
}

module.exports = {
  register,
  unregister,
  getSessions,
  findSessionByCharacterID,
};

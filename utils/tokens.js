const sessions = new Map(); // In production, use Redis or database

function storeTokens(sessionId, tokens) {
  sessions.set(sessionId, {
    ...tokens,
    timestamp: Date.now()
  });
}

function getTokens(sessionId) {
  return sessions.get(sessionId);
}

function removeTokens(sessionId) {
  sessions.delete(sessionId);
}

function cleanupExpiredSessions() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, data] of sessions.entries()) {
    if (now - data.timestamp > oneHour) {
      sessions.delete(sessionId);
    }
  }
}

// Clean up expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
  storeTokens,
  getTokens,
  removeTokens
};
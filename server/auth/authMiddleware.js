const activeTokens = require('./tokenStore');

function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const session = activeTokens.get(token);

  if (!session) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  // optional: expiry check
  const expired = Date.now() - session.createdAt > 24 * 60 * 60 * 1000;

  if (expired) {
    activeTokens.delete(token);
    return res.status(401).json({ message: 'Session expired' });
  }

  req.user = session; // attach user info
  next();
}

module.exports = auth;
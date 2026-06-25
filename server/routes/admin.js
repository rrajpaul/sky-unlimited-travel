const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const activeTokens = require('../auth/tokenStore');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  console.log("BODY:", req.body);
  console.log("USERNAME:", process.env.ADMIN_USERNAME);
  console.log("PASSWORD HASH:", process.env.ADMIN_PASSWORD_HASH);

  const usernameMatch = username === process.env.ADMIN_USERNAME;

  const passwordMatch = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH
  );

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = crypto.randomBytes(32).toString('hex');

  activeTokens.set(token, {
    createdAt: Date.now(),
    username
  });

  return res.json({ success: true, token });
});

router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ valid: false });
  }

  const token = authHeader.replace('Bearer ', '');

  const session = activeTokens.get(token);

  if (!session) {
    return res.status(401).json({ valid: false });
  }

  return res.json({
    valid: true,
    username: session.username
  });
});

router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.json({ success: true });
  }

  const token = authHeader.replace('Bearer ', '');

  activeTokens.delete(token);

  res.json({ success: true });
});

module.exports = router;
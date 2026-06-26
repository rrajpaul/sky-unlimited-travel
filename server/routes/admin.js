const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const usernameMatch = username === process.env.ADMIN_USERNAME;
  const passwordMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  return res.json({ success: true, token });
});

router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ valid: false });

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ valid: true, username: decoded.username });
  } catch {
    return res.status(401).json({ valid: false });
  }
});

router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const activeTokens = new Map();

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

module.exports = router;
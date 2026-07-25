const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('LOGIN ATTEMPT:', { username, passwordLength: password?.length });

  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1',
      [username]
    );

    console.log('ROWS FOUND:', result.rows.length);
    const user = result.rows[0];
    if (!user) {
      console.log('NO USER MATCHED FOR USERNAME:', username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('STORED HASH:', user.password_hash);
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log('PASSWORD MATCH RESULT:', passwordMatch);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
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
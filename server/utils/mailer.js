const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    ciphers: 'TLSv1.2',        // ← fix: SSLv3 is deprecated
    rejectUnauthorized: false   // ← fix: allows Railway's network
  },
});

module.exports = transporter;
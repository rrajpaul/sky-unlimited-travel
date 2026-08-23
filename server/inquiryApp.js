// Location: server/inquiryApp.js
//
// Mirrors server/app.js's pattern (app factory, no .listen()) so tests can
// import it directly. Mounts the inquiry router at /api/inquiry, matching
// the paths BookingProcessModal's apiUrl() calls actually hit:
// POST /api/inquiry and POST /api/inquiry/notify-admin.
const express = require('express');
const inquiryRouter = require('./routes/inquiry');

function createInquiryApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/inquiry', inquiryRouter);
  return app;
}

module.exports = { createInquiryApp };
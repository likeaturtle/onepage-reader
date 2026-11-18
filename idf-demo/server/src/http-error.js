'use strict';

// Exposed errors are safe to show to the mini program; anything else is
// logged and replaced by a generic 500 message in app.js.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = { httpError };

'use strict';

// Explicit Express import lets Vercel identify this root entrypoint.
require('express');
module.exports = require('./api/_app');

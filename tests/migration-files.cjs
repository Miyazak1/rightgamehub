const fs = require('node:fs');
const path = require('node:path');

// Full-schema assertions must follow the current migration set. Tests upgrading
// a historical snapshot still retain their explicit starting-version boundary.
module.exports = () => fs.readdirSync(path.resolve(__dirname, '../apps/api/migrations'))
  .filter(name => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)).sort();

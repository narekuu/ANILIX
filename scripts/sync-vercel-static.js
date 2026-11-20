'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');

fs.mkdirSync(publicRoot, { recursive: true });
for (const directory of ['css', 'js', 'json']) {
  const source = path.join(root, directory);
  const destination = path.join(publicRoot, directory);
  if (fs.existsSync(source)) fs.cpSync(source, destination, { recursive: true, force: true });
}

const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replaceAll('/public/', '/');
fs.writeFileSync(path.join(publicRoot, 'index.html'), home, 'utf8');

const navigationPath = path.join(publicRoot, 'js', 'navigation.js');
if (fs.existsSync(navigationPath)) {
  let navigation = fs.readFileSync(navigationPath, 'utf8');
  navigation = navigation.replace(
    'const href = isHome ? "/" : (inPublic ? item.href : `/public/${item.href}`);',
    'const href = isHome ? "/" : `/${item.href}`;'
  );
  fs.writeFileSync(navigationPath, navigation, 'utf8');
}

console.log('[ANILIX] Vercel static assets synchronized from root sources.');

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');

fs.mkdirSync(publicRoot, { recursive: true });
for (const directory of ['css', 'js', 'json', 'components']) {
  const source = path.join(root, directory);
  const destination = path.join(publicRoot, directory);
  if (fs.existsSync(source)) fs.cpSync(source, destination, { recursive: true, force: true });
}

// Vercel maps public/* to the site root. Convert legacy homepage links.
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replaceAll('/public/', '/');
fs.writeFileSync(path.join(publicRoot, 'index.html'), home, 'utf8');

// Keep local navigation unchanged; normalize only the deployed copy.
const navigationPath = path.join(publicRoot, 'js', 'navigation.js');
if (fs.existsSync(navigationPath)) {
  let navigation = fs.readFileSync(navigationPath, 'utf8');
  navigation = navigation.replace(
    /const href = isHome \? "\/" : \(inPublic \? item\.href : `\/public\/\$\{item\.href\}`\);/,
    'const href = isHome ? "/" : `/${item.href}`;'
  );
  if (navigation.includes('/public/' + '$' + '{item.href}')) throw new Error('Navigation Vercel path rewrite failed.');
  fs.writeFileSync(navigationPath, navigation, 'utf8');
}

if (home.includes('/public/')) throw new Error('Homepage still contains legacy /public/ paths.');
console.log('[ANILIX] Vercel static assets synchronized and path-checked.');

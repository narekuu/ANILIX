'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const ROOT = __dirname;
const PORT = Number(process.env.APP_PORT || 3000);
if (process.env.APP_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET wajib diisi dengan minimal 32 karakter pada production.');
}
const DB_PATH = path.resolve(ROOT, process.env.DATABASE_PATH || './database/anilix.db');
const LEVELS_PATH = path.resolve(ROOT, process.env.LEVEL_CONFIG_PATH || './json/levels.json');
const EXP_PATH = path.resolve(ROOT, process.env.EXP_CONFIG_PATH || './json/exp.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'database'), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const levelsConfig = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8'));
const expConfig = JSON.parse(fs.readFileSync(EXP_PATH, 'utf8'));
const EXP_PER_LEVEL = Math.max(1, Number(process.env.LEVEL_EXP_REQUIRED || levelsConfig.exp_per_level || 2150));
const BCRYPT_ROUNDS = Math.min(14, Math.max(10, Number(process.env.BCRYPT_ROUNDS || 12)));
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);

// SQLite schema: tester and Google accounts share the same canonical user record.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE,
 display_name TEXT NOT NULL,
 email TEXT UNIQUE,
 password_hash TEXT,
 google_sub TEXT UNIQUE,
 role TEXT NOT NULL DEFAULT 'member',
 total_exp INTEGER NOT NULL DEFAULT 0,
 level INTEGER NOT NULL DEFAULT 0,
 nixgem INTEGER NOT NULL DEFAULT 0,
 premium_expires_at TEXT,
 avatar TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS exp_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount INTEGER NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS favorites (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content_id TEXT NOT NULL,
 content_type TEXT NOT NULL,
 title TEXT NOT NULL,
 poster TEXT,
 payload TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, content_id, content_type)
);
CREATE TABLE IF NOT EXISTS watch_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content_id TEXT NOT NULL,
 content_type TEXT NOT NULL,
 title TEXT NOT NULL,
 poster TEXT,
 episode TEXT,
 progress REAL NOT NULL DEFAULT 0,
 watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, content_id, content_type)
);
CREATE INDEX IF NOT EXISTS idx_exp_history_user ON exp_history(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id, watched_at DESC);
`);

function calcLevel(totalExp) {
  const raw = Math.floor(Math.max(0, Number(totalExp) || 0) / EXP_PER_LEVEL);
  const max = levelsConfig.max_level == null ? Infinity : Number(levelsConfig.max_level);
  return Math.min(raw, max);
}
function rankForLevel(level) {
  const rank = (levelsConfig.ranks || []).find(r => level >= Number(r.min) && (r.max == null || level <= Number(r.max)));
  return rank ? { name: rank.name, file: rank.file, colors: rank.colors, glow: rank.glow } : null;
}
function userView(row) {
  if (!row) return null;
  const level = calcLevel(row.total_exp);
  const nextLevelExp = (level + 1) * EXP_PER_LEVEL;
  const premiumActive = !!row.premium_expires_at && new Date(row.premium_expires_at).getTime() > Date.now();
  return {
    id: row.id, username: row.username, name: row.display_name, displayName: row.display_name,
    email: row.email, role: row.role, verified: row.role !== 'member', avatar: row.avatar,
    total_exp: row.total_exp, exp: row.total_exp, level,
    xp: row.total_exp - level * EXP_PER_LEVEL,
    current_exp: row.total_exp - level * EXP_PER_LEVEL,
    exp_in_level: row.total_exp - level * EXP_PER_LEVEL,
    exp_to_next_level: Math.max(0, nextLevelExp - row.total_exp),
    requiredXP: EXP_PER_LEVEL, expPerLevel: EXP_PER_LEVEL,
    exp_per_level: EXP_PER_LEVEL, rank: rankForLevel(level), nixgem: row.nixgem,
    premium: { active: premiumActive, expiresAt: row.premium_expires_at || null }
  };
}
function sessionUser(req) {
  if (!req.session?.userId) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
  req.user = user; next();
}
function requireDeveloper(req, res, next) {
  if (!req.user || req.user.role !== 'developer') return res.status(403).json({ success: false, message: 'Akses developer diperlukan.' });
  next();
}

// Seed tester IDs 1-10. The owner/developer role is intentionally enforced for all ten IDs.
const seed = db.transaction(() => {
  for (let i = 1; i <= 10; i++) {
    const id = Number(process.env[`TESTER_${i}_ID`] || i);
    const username = String(process.env[`TESTER_${i}_USERNAME`] || `TESTER${i}`).trim();
    const password = process.env[`TESTER_${i}_PASSWORD`];
    const suppliedHash = process.env[`TESTER_${i}_PASSWORD_HASH`];
    const configuredLevel = Math.max(0, Number(process.env[`TESTER_${i}_LEVELS`] || 1));
    const expMode = String(process.env[`TESTER_${i}_EXP`] || 'AUTO').toUpperCase();
    const totalExp = expMode === 'AUTO' ? configuredLevel * EXP_PER_LEVEL : Math.max(0, Number(expMode) || 0);
    const level = calcLevel(totalExp);
    const old = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    let passwordHash = suppliedHash || old?.password_hash || null;
    if (password) passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    if (!passwordHash && !old) {
      console.warn(`[ANILIX] Password tester ${i} belum diisi; akun dibuat tanpa password dan tidak bisa login.`);
    }
    db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,total_exp,level,updated_at)
      VALUES (@id,@username,@display_name,@password_hash,'developer',@total_exp,@level,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, display_name=excluded.display_name,
      password_hash=COALESCE(excluded.password_hash,users.password_hash), role='developer',
      total_exp=excluded.total_exp, level=excluded.level, updated_at=CURRENT_TIMESTAMP`)
      .run({ id, username, display_name: username, password_hash: passwordHash, total_exp: totalExp, level });
  }
});
seed();

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: process.env.SESSION_COOKIE_NAME || 'anilix_session',
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(ROOT, 'database'), concurrentDB: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-before-deploying',
  resave: false, saveUninitialized: false,
  cookie: {
    maxAge: Number(process.env.SESSION_MAX_AGE || 604800000),
    httpOnly: String(process.env.SESSION_HTTP_ONLY || 'true') === 'true',
    secure: String(process.env.SESSION_SECURE || 'false') === 'true',
    sameSite: process.env.SESSION_SAME_SITE || 'lax'
  }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

app.get('/api/system/status', (_req, res) => res.json({ success: true, app: 'ANILIX', status: 'online', database: 'sqlite' }));
app.get('/api/config/roles', (_req, res) => res.json(JSON.parse(fs.readFileSync(path.join(ROOT, 'json/roles.json'), 'utf8'))));
app.get('/api/config/levels', (_req, res) => res.json(levelsConfig));
app.get('/api/config/exp', (_req, res) => res.json(expConfig));

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  const row = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
  if (!row || !row.password_hash || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ success: false, message: 'Username atau password salah.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ success: false, message: 'Gagal membuat sesi login.' });
    req.session.userId = row.id;
    req.session.authProvider = 'tester';
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ success: false, message: 'Gagal menyimpan sesi login.' });
      res.json({ success: true, user: userView(row) });
    });
  });
});

async function verifyGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID belum dikonfigurasi di .env.');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) throw new Error('Akun Google tidak valid atau email belum terverifikasi.');
  return payload;
}
async function googleLogin(req, res) {
  try {
    const payload = await verifyGoogleCredential(String(req.body?.credential || ''));
    let row = db.prepare('SELECT * FROM users WHERE google_sub=? OR email=?').get(payload.sub, payload.email);
    if (!row) {
      const usernameBase = String(payload.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
      let username = usernameBase, suffix = 1;
      while (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) username = `${usernameBase}${suffix++}`;
      const info = db.prepare(`INSERT INTO users (username,display_name,email,google_sub,role) VALUES (?,?,?,?, 'member')`)
        .run(username, payload.name || username, payload.email, payload.sub);
      row = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    } else if (!row.google_sub) {
      db.prepare('UPDATE users SET google_sub=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(payload.sub, row.id);
      row = db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ success: false, message: 'Gagal membuat sesi Google.' });
      req.session.userId = row.id; req.session.authProvider = 'google';
      req.session.save(saveErr => saveErr ? res.status(500).json({ success: false, message: 'Gagal menyimpan sesi Google.' }) : res.json({ success: true, user: userView(row) }));
    });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message || 'Verifikasi Google gagal.' });
  }
}
app.post('/api/auth/google', loginLimiter, googleLogin);
// Legacy endpoint kept for older UI clients; use the Google ID token endpoint above.
app.post('/api/auth/google-user', loginLimiter, async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ success: false, message: 'Google Login belum dikonfigurasi.' });
    const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(String(req.body?.access_token || '')));
    const info = await r.json();
    if (!r.ok || !info.sub || info.aud !== process.env.GOOGLE_CLIENT_ID || info.email_verified !== 'true') throw new Error('Token Google tidak valid.');
    const payload = { sub: info.sub, email: info.email, email_verified: true, name: info.name || info.email.split('@')[0] };
    let row = db.prepare('SELECT * FROM users WHERE google_sub=? OR email=?').get(payload.sub, payload.email);
    if (!row) {
      const base = payload.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user'; let username=base, n=1;
      while (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) username=`${base}${n++}`;
      const result=db.prepare(`INSERT INTO users(username,display_name,email,google_sub,role) VALUES(?,?,?,?, 'member')`).run(username,payload.name,payload.email,payload.sub);
      row=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    } else if (!row.google_sub) db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(payload.sub,row.id);
    req.session.userId=row.id; req.session.authProvider='google';
    res.json({ success:true, user:userView(row) });
  } catch (e) { res.status(401).json({ success:false, message:e.message || 'Login Google gagal.' }); }
});
app.get('/api/auth/me', (req, res) => {
  const row = sessionUser(req);
  if (!row) return res.status(401).json({ success: false, message: 'Belum login.' });
  res.json({ success: true, user: userView(row) });
});
app.get('/api/me', (req, res) => {
  const row = sessionUser(req);
  if (!row) return res.status(401).json({ success: false, message: 'Belum login.' });
  res.json({ success: true, user: userView(row) });
});
app.post('/api/auth/logout', requireAuth, (req, res) => req.session.destroy(() => res.clearCookie(process.env.SESSION_COOKIE_NAME || 'anilix_session').json({ success: true })));
app.get('/api/nixgem/balance', requireAuth, (req, res) => res.json({ success: true, balance: req.user.nixgem }));
app.get('/api/premium/packages', (_req, res) => res.json({ success: true, packages: [
  {id:'premium_7d',name:'7 Hari',price:3000,group:'cheap',label:'TERMURAH',description:'Akses Premium selama 7 hari',baseGem:0,bonusGem:0},
  {id:'premium_1m',name:'1 Bulan',price:10000,group:'cheap',description:'Akses Premium selama 1 bulan',baseGem:1000,bonusGem:0},
  {id:'premium_3m',name:'3 Bulan',price:27000,group:'cheap',description:'Akses Premium selama 3 bulan',baseGem:3000,bonusGem:500},
  {id:'premium_6m',name:'6 Bulan',price:50000,group:'cheap',description:'Akses Premium selama 6 bulan',baseGem:6000,bonusGem:1500},
  {id:'premium_1y',name:'1 Tahun',price:85000,group:'standard',label:'REKOMENDASI',highlight:'recommended',description:'Akses Premium selama 1 tahun',baseGem:15000,bonusGem:5000},
  {id:'premium_2y',name:'2 Tahun',price:150000,group:'standard',description:'Akses Premium selama 2 tahun',baseGem:30000,bonusGem:12000},
  {id:'premium_3y',name:'3 Tahun',price:210000,group:'sultan',description:'Akses Premium selama 3 tahun',baseGem:50000,bonusGem:20000},
  {id:'premium_4y',name:'4 Tahun',price:260000,group:'sultan',description:'Akses Premium selama 4 tahun',baseGem:75000,bonusGem:30000},
  {id:'premium_5y',name:'5 Tahun',price:300000,group:'sultan',label:'TERMAHAL',highlight:'expensive',description:'Akses Premium selama 5 tahun',baseGem:100000,bonusGem:50000}
]}));
app.post('/api/premium/checkout', requireAuth, (_req, res) => res.status(503).json({ success:false, message:'Checkout belum aktif. Payment gateway dan verifikasi webhook belum dikonfigurasi.' }));

// Canonical EXP/level data. The client never submits an EXP amount to this route.
app.get('/api/progression/me', requireAuth, (req, res) => {
  const user = userView(req.user);
  const history = db.prepare('SELECT amount,reason,created_at FROM exp_history WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
  res.json({ success:true, progression:{ level:user.level,total_exp:user.total_exp,exp_in_level:user.exp_in_level,exp_to_next_level:user.exp_to_next_level,exp_per_level:EXP_PER_LEVEL,rank:user.rank }, history });
});
app.post('/api/admin/users/:id/progression', requireAuth, requireDeveloper, (req, res) => {
  const id = Number(req.params.id); const hasLevel = Number.isInteger(Number(req.body?.level)); const hasExp = Number.isInteger(Number(req.body?.total_exp));
  if (!Number.isSafeInteger(id) || (!hasLevel && !hasExp)) return res.status(400).json({success:false,message:'Kirim level atau total_exp yang valid.'});
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!row) return res.status(404).json({success:false,message:'User tidak ditemukan.'});
  const totalExp = hasExp ? Math.max(0, Number(req.body.total_exp)) : Math.max(0, Number(req.body.level)) * EXP_PER_LEVEL;
  const level = calcLevel(totalExp);
  db.prepare('UPDATE users SET total_exp=?,level=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(totalExp,level,id);
  db.prepare('INSERT INTO exp_history(user_id,amount,reason) VALUES(?,?,?)').run(id,totalExp-row.total_exp,'Admin progression update');
  res.json({success:true,user:userView(db.prepare('SELECT * FROM users WHERE id=?').get(id))});
});
app.get('/api/user/favorites', requireAuth, (req,res)=>{
  const rows=db.prepare('SELECT content_id AS id,content_type AS type,title,poster,payload,created_at FROM favorites WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json({success:true,favorites:rows.map(r=>({...r,...(r.payload?JSON.parse(r.payload):{})}))});
});
app.post('/api/user/favorites', requireAuth, (req,res)=>{
  const x=req.body||{}; if(!x.id||!x.title||!x.type) return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
  db.prepare(`INSERT INTO favorites(user_id,content_id,content_type,title,poster,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=excluded.title,poster=excluded.poster,payload=excluded.payload`)
    .run(req.user.id,String(x.id),String(x.type),String(x.title),x.poster||x.image||null,JSON.stringify(x));
  res.json({success:true});
});
app.delete('/api/user/favorites/:type/:id', requireAuth, (req,res)=>{
  const result=db.prepare('DELETE FROM favorites WHERE user_id=? AND content_type=? AND content_id=?').run(req.user.id,req.params.type,req.params.id);
  res.json({success:true,deleted:result.changes});
});
app.get('/api/user/history', requireAuth, (req,res)=>{
  const rows=db.prepare('SELECT content_id AS id,content_type AS type,title,poster,episode,progress,watched_at FROM watch_history WHERE user_id=? ORDER BY watched_at DESC').all(req.user.id);
  res.json({success:true,history:rows});
});
app.post('/api/user/history', requireAuth, (req,res)=>{
  const x=req.body||{}; if(!x.id||!x.title||!x.type) return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
  db.prepare(`INSERT INTO watch_history(user_id,content_id,content_type,title,poster,episode,progress,watched_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=excluded.title,poster=excluded.poster,episode=excluded.episode,progress=excluded.progress,watched_at=CURRENT_TIMESTAMP`)
    .run(req.user.id,String(x.id),String(x.type),String(x.title),x.poster||null,x.episode||null,Math.max(0,Math.min(100,Number(x.progress)||0)));
  res.json({success:true});
});
app.delete('/api/user/history/:type/:id', requireAuth, (req,res)=>{
  const result=db.prepare('DELETE FROM watch_history WHERE user_id=? AND content_type=? AND content_id=?').run(req.user.id,req.params.type,req.params.id);
  res.json({success:true,deleted:result.changes});
});

// Same-origin catalog proxy. Provider base URL and API key remain server-side.
app.get('/api/catalog', async (req, res) => {
  const base = String(process.env.SANKA_API_BASE_URL || '').trim();
  if (!base) return res.status(503).json({ success:false, message:'Sumber katalog belum dikonfigurasi. Isi SANKA_API_BASE_URL pada .env.' });
  const route = String(req.query.path || '');
  if ((!route.startsWith('/anime/') && !route.startsWith('/episode/')) || route.includes('..') || route.includes('\\')) {
    return res.status(400).json({ success:false, message:'Rute katalog tidak valid.' });
  }
  try {
    const target = new URL(route, base.endsWith('/') ? base : base + '/');
    const upstream = await fetch(target, {
      headers: { Accept:'application/json', ...(process.env.SANKA_API_KEY ? { Authorization:`Bearer ${process.env.SANKA_API_KEY}` } : {}) },
      signal: AbortSignal.timeout(12000)
    });
    const body = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(body);
  } catch (error) {
    console.error('[ANILIX SANKA]', error.message);
    res.status(502).json({ success:false, message:'Tidak dapat menghubungi provider katalog.' });
  }
});

// Serve frontend assets only; never expose server source, environment files, or SQLite data.
app.use(['/server.js','/package.json','/package-lock.json','/README.md','/database','/server','/node_modules'], (_req,res)=>res.sendStatus(404));
app.use(express.static(ROOT, { extensions: ['html'], index: 'index.html', dotfiles: 'deny' }));
app.get('/', (_req,res)=>res.sendFile(path.join(ROOT,'index.html')));
app.get('/home.html', (_req,res)=>res.redirect(302,'/'));
app.use((err,_req,res,_next)=>{ console.error('[ANILIX]',err); res.status(500).json({success:false,message:'Terjadi kesalahan pada server.'}); });
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${process.env.APP_NAME || 'ANILIX'}] running at http://0.0.0.0:${PORT}`);
  console.log(`[ANILIX] SQLite: ${DB_PATH}`);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('development-only')) console.warn('[ANILIX] Ganti SESSION_SECRET sebelum deployment.');
});

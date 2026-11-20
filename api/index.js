'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(key + ' wajib dikonfigurasi.');
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET minimal 32 karakter.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});
const ROOT = path.resolve(__dirname, '..');
const readJson = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'json', name), 'utf8'));
const levelsConfig = readJson('levels.json');
const expConfig = readJson('exp.json');
const rolesConfig = readJson('roles.json');
const EXP_PER_LEVEL = Math.max(1, Number(process.env.LEVEL_EXP_REQUIRED || levelsConfig.exp_per_level || 2150));
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: process.env.SESSION_COOKIE_NAME || 'anilix_session',
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true, pruneSessionInterval: 900 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: Number(process.env.SESSION_MAX_AGE || 604800000),
    httpOnly: true,
    secure: true,
    sameSite: 'lax'
  }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

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
  const totalExp = Number(row.total_exp || 0);
  const level = calcLevel(totalExp);
  const premiumActive = !!row.premium_expires_at && new Date(row.premium_expires_at).getTime() > Date.now();
  return {
    id: Number(row.id), username: row.username, name: row.display_name, displayName: row.display_name,
    email: row.email, role: row.role, verified: row.role !== 'member', avatar: row.avatar,
    total_exp: totalExp, exp: totalExp, level, xp: totalExp - level * EXP_PER_LEVEL,
    current_exp: totalExp - level * EXP_PER_LEVEL, exp_in_level: totalExp - level * EXP_PER_LEVEL,
    exp_to_next_level: Math.max(0, (level + 1) * EXP_PER_LEVEL - totalExp),
    requiredXP: EXP_PER_LEVEL, expPerLevel: EXP_PER_LEVEL, exp_per_level: EXP_PER_LEVEL,
    rank: rankForLevel(level), nixgem: Number(row.nixgem || 0),
    premium: { active: premiumActive, expiresAt: row.premium_expires_at || null }
  };
}
async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM public.users WHERE id=$1 LIMIT 1', [id]);
  return rows[0] || null;
}
async function sessionUser(req) {
  return req.session?.userId ? getUserById(req.session.userId) : null;
}
async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
}
function requireDeveloper(req, res, next) {
  if (!req.user || req.user.role !== 'developer') return res.status(403).json({ success: false, message: 'Akses developer diperlukan.' });
  next();
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
}
function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
}
async function loginWithGoogle(payload, req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let result = await client.query('SELECT * FROM public.users WHERE google_sub=$1 OR lower(email)=lower($2) LIMIT 1 FOR UPDATE', [payload.sub, payload.email]);
    let row = result.rows[0];
    if (!row) {
      const base = String(payload.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
      let username = base, suffix = 1;
      while ((await client.query('SELECT id FROM public.users WHERE lower(username)=lower($1)', [username])).rowCount) username = base + suffix++;
      result = await client.query(
        "INSERT INTO public.users(username,display_name,email,google_sub,role) VALUES($1,$2,$3,$4,'member') RETURNING *",
        [username, payload.name || username, payload.email, payload.sub]
      );
      row = result.rows[0];
    } else if (!row.google_sub) {
      result = await client.query('UPDATE public.users SET google_sub=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [payload.sub, row.id]);
      row = result.rows[0];
    }
    await client.query('COMMIT');
    await regenerateSession(req);
    req.session.userId = Number(row.id);
    req.session.authProvider = 'google';
    await saveSession(req);
    res.json({ success: true, user: userView(row) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

app.get('/api/system/status', (_req, res) => res.json({ success: true, app: 'ANILIX', status: 'online', database: 'postgresql' }));
app.get('/api/config/roles', (_req, res) => res.json(rolesConfig));
app.get('/api/config/levels', (_req, res) => res.json(levelsConfig));
app.get('/api/config/exp', (_req, res) => res.json(expConfig));

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    const { rows } = await pool.query('SELECT * FROM public.users WHERE lower(username)=lower($1) LIMIT 1', [username]);
    const row = rows[0];
    if (!row?.password_hash || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    await regenerateSession(req);
    req.session.userId = Number(row.id);
    req.session.authProvider = 'password';
    await saveSession(req);
    res.json({ success: true, user: userView(row) });
  } catch (error) { next(error); }
});

app.post('/api/auth/google', loginLimiter, async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ success: false, message: 'Google Login belum dikonfigurasi.' });
    const ticket = await googleClient.verifyIdToken({ idToken: String(req.body?.credential || ''), audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) return res.status(401).json({ success: false, message: 'Akun Google tidak valid atau email belum terverifikasi.' });
    await loginWithGoogle(payload, req, res);
  } catch (error) { res.status(401).json({ success: false, message: error.message || 'Verifikasi Google gagal.' }); }
});
app.post('/api/auth/google-user', loginLimiter, async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ success: false, message: 'Google Login belum dikonfigurasi.' });
    const token = encodeURIComponent(String(req.body?.access_token || ''));
    const response = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + token);
    const info = await response.json();
    if (!response.ok || !info.sub || info.aud !== process.env.GOOGLE_CLIENT_ID || info.email_verified !== 'true' || !info.email) throw new Error('Token Google tidak valid.');
    await loginWithGoogle({ sub: info.sub, email: info.email, name: info.name || info.email.split('@')[0] }, req, res);
  } catch (error) { res.status(401).json({ success: false, message: error.message || 'Login Google gagal.' }); }
});
app.get(['/api/auth/me', '/api/me'], async (req, res, next) => {
  try {
    const row = await sessionUser(req);
    if (!row) return res.status(401).json({ success: false, message: 'Belum login.' });
    res.json({ success: true, user: userView(row) });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  req.session.destroy(() => res.clearCookie(process.env.SESSION_COOKIE_NAME || 'anilix_session', { httpOnly: true, secure: true, sameSite: 'lax' }).json({ success: true }));
});
app.get('/api/nixgem/balance', requireAuth, (req, res) => res.json({ success: true, balance: Number(req.user.nixgem || 0) }));
app.get('/api/premium/packages', (_req, res) => res.json({ success: true, packages: [
  {id:'premium_7d',name:'7 Hari',price:3000,group:'cheap',label:'TERMURAH',description:'Akses Premium selama 7 hari',baseGem:0,bonusGem:0},
  {id:'premium_1m',name:'1 Bulan',price:10000,group:'cheap',description:'Akses Premium selama 1 bulan',baseGem:1000,bonusGem:0},
  {id:'premium_3m',name:'3 Bulan',price:27000,group:'cheap',description:'Akses Premium selama 3 bulan',baseGem:3000,bonusGem:500},
  {id:'premium_6m',name:'6 Bulan',price:50000,group:'cheap',description:'Akses Premium selama 6 bulan',baseGem:6000,bonusGem:1500},
  {id:'premium_1y',name:'1 Tahun',price:85000,group:'standard',label:'REKOMENDASI',highlight:'recommended',description:'Akses Premium selama 1 tahun',baseGem:15000,bonusGem:5000},
  {id:'premium_2y',name:'2 Tahun',price:150000,group:'standard',description:'Akses Premium selama 2 tahun',baseGem:30000,bonusGem:12000},
  {id:'premium_3y',name:'3 Tahun',price:210000,group:'sultan',description:'Akses Premium selama 3 tahun',baseGem:50000,bonusGem:20000},
  {id:'premium_4y',name:'4 Tahun',price:260000,group:'sultan',description:'Akses Premium selama 4 tahun',baseGem:75000,bonusGem:30000},
  {id:'premium_5y',name:'5 Tahun',price:300000,group:'sultan',label:'TERMAHAL',description:'Akses Premium selama 5 tahun',baseGem:100000,bonusGem:50000}
]}));
app.post('/api/premium/checkout', requireAuth, (_req, res) => res.status(503).json({ success:false, message:'Checkout belum aktif. Payment gateway dan verifikasi webhook belum dikonfigurasi.' }));

app.get('/api/progression/me', requireAuth, async (req, res, next) => {
  try {
    const user = userView(req.user);
    const { rows } = await pool.query('SELECT amount,reason,created_at FROM public.exp_history WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [req.user.id]);
    res.json({ success:true, progression:{ level:user.level,total_exp:user.total_exp,exp_in_level:user.exp_in_level,exp_to_next_level:user.exp_to_next_level,exp_per_level:EXP_PER_LEVEL,rank:user.rank }, history:rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/users/:id/progression', requireAuth, requireDeveloper, async (req, res, next) => {
  const id = Number(req.params.id);
  const hasLevel = req.body?.level !== undefined && Number.isInteger(Number(req.body.level));
  const hasExp = req.body?.total_exp !== undefined && Number.isInteger(Number(req.body.total_exp));
  if (!Number.isSafeInteger(id) || (!hasLevel && !hasExp)) return res.status(400).json({success:false,message:'Kirim level atau total_exp yang valid.'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM public.users WHERE id=$1 FOR UPDATE', [id]);
    const row = found.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({success:false,message:'User tidak ditemukan.'}); }
    const totalExp = hasExp ? Math.max(0, Number(req.body.total_exp)) : Math.max(0, Number(req.body.level)) * EXP_PER_LEVEL;
    const level = calcLevel(totalExp);
    await client.query('UPDATE public.users SET total_exp=$1,level=$2,updated_at=NOW() WHERE id=$3', [totalExp,level,id]);
    await client.query('INSERT INTO public.exp_history(user_id,amount,reason) VALUES($1,$2,$3)', [id,totalExp-Number(row.total_exp),'Admin progression update']);
    const updated = await client.query('SELECT * FROM public.users WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({success:true,user:userView(updated.rows[0])});
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { client.release(); }
});

app.get('/api/user/favorites', requireAuth, async (req,res,next)=>{
  try {
    const { rows } = await pool.query('SELECT content_id AS id,content_type AS type,title,poster,payload,created_at FROM public.favorites WHERE user_id=$1 ORDER BY id DESC',[req.user.id]);
    res.json({success:true,favorites:rows.map(r=>({...r,...(r.payload?JSON.parse(r.payload):{})}))});
  } catch(error){next(error);}
});
app.post('/api/user/favorites', requireAuth, async (req,res,next)=>{
  try {
    const x=req.body||{};
    if(!x.id||!x.title||!x.type) return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
    await pool.query(`INSERT INTO public.favorites(user_id,content_id,content_type,title,poster,payload) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=EXCLUDED.title,poster=EXCLUDED.poster,payload=EXCLUDED.payload`,
      [req.user.id,String(x.id),String(x.type),String(x.title),x.poster||x.image||null,JSON.stringify(x)]);
    res.json({success:true});
  } catch(error){next(error);}
});
app.delete('/api/user/favorites/:type/:id', requireAuth, async (req,res,next)=>{
  try { const result=await pool.query('DELETE FROM public.favorites WHERE user_id=$1 AND content_type=$2 AND content_id=$3',[req.user.id,req.params.type,req.params.id]); res.json({success:true,deleted:result.rowCount}); }
  catch(error){next(error);}
});
app.get('/api/user/history', requireAuth, async (req,res,next)=>{
  try { const {rows}=await pool.query('SELECT content_id AS id,content_type AS type,title,poster,episode,progress,watched_at FROM public.watch_history WHERE user_id=$1 ORDER BY watched_at DESC',[req.user.id]); res.json({success:true,history:rows}); }
  catch(error){next(error);}
});
app.post('/api/user/history', requireAuth, async (req,res,next)=>{
  try {
    const x=req.body||{};
    if(!x.id||!x.title||!x.type) return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
    await pool.query(`INSERT INTO public.watch_history(user_id,content_id,content_type,title,poster,episode,progress,watched_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=EXCLUDED.title,poster=EXCLUDED.poster,episode=EXCLUDED.episode,progress=EXCLUDED.progress,watched_at=NOW()`,
      [req.user.id,String(x.id),String(x.type),String(x.title),x.poster||null,x.episode||null,Math.max(0,Math.min(100,Number(x.progress)||0))]);
    res.json({success:true});
  } catch(error){next(error);}
});
app.delete('/api/user/history/:type/:id', requireAuth, async (req,res,next)=>{
  try { const result=await pool.query('DELETE FROM public.watch_history WHERE user_id=$1 AND content_type=$2 AND content_id=$3',[req.user.id,req.params.type,req.params.id]); res.json({success:true,deleted:result.rowCount}); }
  catch(error){next(error);}
});

app.get('/api/catalog', async (req,res)=>{
  const base=String(process.env.SANKA_API_BASE_URL||'').trim();
  if(!base) return res.status(503).json({success:false,message:'Sumber katalog belum dikonfigurasi.'});
  const route=String(req.query.path||'');
  if((!route.startsWith('/anime/')&&!route.startsWith('/episode/'))||route.includes('..')||route.includes('\\')) return res.status(400).json({success:false,message:'Rute katalog tidak valid.'});
  try {
    const target=new URL(route,base.endsWith('/')?base:base+'/');
    const upstream=await fetch(target,{headers:{Accept:'application/json',...(process.env.SANKA_API_KEY?{Authorization:`Bearer ${process.env.SANKA_API_KEY}`}:{})},signal:AbortSignal.timeout(12000)});
    const body=await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type')||'application/json').send(body);
  } catch(error){console.error('[ANILIX SANKA]',error.message);res.status(502).json({success:false,message:'Tidak dapat menghubungi provider katalog.'});}
});

app.use((err,_req,res,_next)=>{ console.error('[ANILIX API]',err); res.status(500).json({success:false,message:'Terjadi kesalahan pada server.'}); });
module.exports = app;

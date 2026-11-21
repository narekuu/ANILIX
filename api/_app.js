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

const missingEnvironment = ['DATABASE_URL', 'SESSION_SECRET'].filter(key => !process.env[key]);
const invalidSessionSecret = !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Math.max(1, Math.min(5, Number(process.env.PG_POOL_MAX) || 3)),
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
app.use((req, res, next) => {
  if (missingEnvironment.length || invalidSessionSecret) {
    console.error('[ANILIX CONFIG] Backend environment is incomplete.');
    return res.status(503).json({
      success: false,
      message: 'Backend ANILIX belum dikonfigurasi dengan lengkap.'
    });
  }
  next();
});
app.use(session({
  name: process.env.SESSION_COOKIE_NAME || 'anilix_session',
  store: new PgSession({ pool, tableName: 'user_sessions', schemaName: 'private', createTableIfMissing: false, pruneSessionInterval: 900 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: Number(process.env.SESSION_MAX_AGE || 604800000), httpOnly: true, secure: true, sameSite: 'lax' }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

function calcLevel(total) {
  const raw = Math.floor(Math.max(0, Number(total) || 0) / EXP_PER_LEVEL);
  return Math.min(raw, levelsConfig.max_level == null ? Infinity : Number(levelsConfig.max_level));
}
function rankForLevel(level) {
  const rank = (levelsConfig.ranks || []).find(r => level >= Number(r.min) && (r.max == null || level <= Number(r.max)));
  return rank ? { name: rank.name, file: rank.file, colors: rank.colors, glow: rank.glow } : null;
}
function userView(row) {
  if (!row) return null;
  const total = Number(row.total_exp || 0);
  const level = calcLevel(total);
  const premiumActive = !!row.premium_expires_at && new Date(row.premium_expires_at).getTime() > Date.now();
  return {
    id: Number(row.id), username: row.username, name: row.display_name, displayName: row.display_name,
    email: row.email, role: row.role, verified: row.role !== 'member', avatar: row.avatar,
    total_exp: total, exp: total, level, xp: total - level * EXP_PER_LEVEL,
    current_exp: total - level * EXP_PER_LEVEL, exp_in_level: total - level * EXP_PER_LEVEL,
    exp_to_next_level: Math.max(0, (level + 1) * EXP_PER_LEVEL - total),
    requiredXP: EXP_PER_LEVEL, expPerLevel: EXP_PER_LEVEL, exp_per_level: EXP_PER_LEVEL,
    rank: rankForLevel(level), nixgem: Number(row.nixgem || 0),
    premium: { active: premiumActive, expiresAt: row.premium_expires_at || null }
  };
}
async function findUser(id) {
  const r = await pool.query('SELECT * FROM public.users WHERE id=$1 LIMIT 1', [id]);
  return r.rows[0] || null;
}
async function currentUser(req) {
  return req.session && req.session.userId ? findUser(req.session.userId) : null;
}
async function auth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}
function developer(req, res, next) {
  if (req.user?.role !== 'developer') return res.status(403).json({ success: false, message: 'Akses developer diperlukan.' });
  next();
}
const saveSession = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));

let seedPromise;
async function seedConfiguredTesters() {
  // Never create developer accounts implicitly. Enable only when explicitly configured.
  if (process.env.TESTER_SEED_ENABLED !== 'true') return;

  for (let i = 1; i <= 10; i++) {
    const password = process.env['TESTER_' + i + '_PASSWORD'];
    const hash = process.env['TESTER_' + i + '_PASSWORD_HASH'];
    if (!password && !hash) continue;

    const id = Number(process.env['TESTER_' + i + '_ID'] || i);
    const username = String(process.env['TESTER_' + i + '_USERNAME'] || 'TESTER' + i).trim();
    const level = Math.max(0, Number(process.env['TESTER_' + i + '_LEVELS'] || 1));
    const expSetting = String(process.env['TESTER_' + i + '_EXP'] || 'AUTO').toUpperCase();
    const total = expSetting === 'AUTO' ? level * EXP_PER_LEVEL : Math.max(0, Number(expSetting) || 0);
    if (!Number.isSafeInteger(id) || id < 1 || !username) {
      throw new Error('Konfigurasi akun tester ' + i + ' tidak valid.');
    }
    const passwordHash = hash || bcrypt.hashSync(password, 12);

    // Insert-only: never promote, rename, reset, or overwrite an existing account.
    await pool.query(
      `INSERT INTO public.users(id,username,display_name,password_hash,role,total_exp,level)
       VALUES($1,$2,$2,$3,'developer',$4,$5)
       ON CONFLICT DO NOTHING`,
      [id, username, passwordHash, total, calcLevel(total)]
    );
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('public.users','id'), GREATEST(COALESCE((SELECT MAX(id) FROM public.users),1),1), true)`);
}
app.use(async (_req, _res, next) => {
  try {
    if (!seedPromise) seedPromise = seedConfiguredTesters().catch(error => { seedPromise = null; throw error; });
    await seedPromise;
    next();
  } catch (e) { next(e); }
});

app.get('/api/system/status', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ success: true, app: 'ANILIX', status: 'online', database: 'postgresql' }); }
  catch { res.status(503).json({ success: false, app: 'ANILIX', status: 'degraded', database: 'unavailable' }); }
});
app.get('/api/jadwal.json', (_req, res) => res.status(503).json({
  success: false,
  code: 'SCHEDULE_PROVIDER_NOT_CONFIGURED',
  message: 'Sumber data jadwal tayang belum dikonfigurasi.'
}));
app.get('/api/config/roles', (_req,res)=>res.json(rolesConfig));
app.get('/api/config/levels', (_req,res)=>res.json(levelsConfig));
app.get('/api/config/exp', (_req,res)=>res.json(expConfig));

app.post('/api/auth/login', loginLimiter, async (req,res,next)=>{
  try {
    const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
    if(!username||!password) return res.status(400).json({success:false,message:'Username dan password wajib diisi.'});
    const result=await pool.query('SELECT * FROM public.users WHERE lower(username)=lower($1) LIMIT 1',[username]);
    const row=result.rows[0];
    if(!row?.password_hash||!bcrypt.compareSync(password,row.password_hash)) return res.status(401).json({success:false,message:'Username atau password salah.'});
    await regenerate(req); req.session.userId=Number(row.id); req.session.authProvider='password'; await saveSession(req);
    res.json({success:true,user:userView(row)});
  } catch(e){next(e);}
});

async function completeGoogleLogin(payload,req,res) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    let result=await client.query('SELECT * FROM public.users WHERE google_sub=$1 OR lower(email)=lower($2) LIMIT 1 FOR UPDATE',[payload.sub,payload.email]);
    let row=result.rows[0];
    if(!row){
      const base=String(payload.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g,'').slice(0,20)||'user';
      let username=base,n=1;
      while((await client.query('SELECT 1 FROM public.users WHERE lower(username)=lower($1)',[username])).rowCount) username=base+n++;
      result=await client.query("INSERT INTO public.users(username,display_name,email,google_sub,role) VALUES($1,$2,$3,$4,'member') RETURNING *",[username,payload.name||username,payload.email,payload.sub]);
      row=result.rows[0];
    } else if(!row.google_sub) {
      result=await client.query('UPDATE public.users SET google_sub=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[payload.sub,row.id]); row=result.rows[0];
    }
    await client.query('COMMIT');
    await regenerate(req); req.session.userId=Number(row.id); req.session.authProvider='google'; await saveSession(req);
    res.json({success:true,user:userView(row)});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
app.post('/api/auth/google',loginLimiter,async(req,res)=>{
  try {
    if(!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({success:false,message:'Google Login belum dikonfigurasi.'});
    const ticket=await googleClient.verifyIdToken({idToken:String(req.body?.credential||''),audience:process.env.GOOGLE_CLIENT_ID});
    const p=ticket.getPayload();
    if(!p?.sub||!p.email||!p.email_verified) return res.status(401).json({success:false,message:'Akun Google tidak valid atau email belum terverifikasi.'});
    await completeGoogleLogin(p,req,res);
  } catch(e){res.status(401).json({success:false,message:e.message||'Verifikasi Google gagal.'});}
});
app.post('/api/auth/google-user',loginLimiter,async(req,res)=>{
  try {
    if(!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({success:false,message:'Google Login belum dikonfigurasi.'});
    const url='https://www.googleapis.com/oauth2/v3/tokeninfo?access_token='+encodeURIComponent(String(req.body?.access_token||''));
    const response=await fetch(url); const p=await response.json();
    if(!response.ok||!p.sub||p.aud!==process.env.GOOGLE_CLIENT_ID||p.email_verified!=='true'||!p.email) throw new Error('Token Google tidak valid.');
    await completeGoogleLogin({sub:p.sub,email:p.email,name:p.name||p.email.split('@')[0]},req,res);
  } catch(e){res.status(401).json({success:false,message:e.message||'Login Google gagal.'});}
});
app.get(['/api/auth/me','/api/me'],async(req,res,next)=>{
  try {const row=await currentUser(req); if(!row)return res.status(401).json({success:false,message:'Belum login.'}); res.json({success:true,user:userView(row)});}
  catch(e){next(e);}
});
app.patch('/api/user/profile',auth,async(req,res,next)=>{
 try {
  const displayName=String(req.body?.display_name ?? '').trim();
  if(!displayName || displayName.length>20){
   return res.status(400).json({success:false,message:'Nama tampilan wajib diisi dan maksimal 20 karakter.'});
  }
  let avatar=req.user.avatar || null;
  if(Object.prototype.hasOwnProperty.call(req.body || {},'avatar')){
   const supplied=req.body.avatar;
   if(supplied===null || supplied==='') avatar=null;
   else if(typeof supplied!=='string' || supplied.length>600000 ||
     !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(supplied)){
    return res.status(400).json({success:false,message:'Format foto profil tidak valid atau ukurannya terlalu besar.'});
   } else avatar=supplied;
  }
  const updated=await pool.query(
   'UPDATE public.users SET display_name=$1,avatar=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
   [displayName,avatar,req.user.id]
  );
  if(!updated.rows[0]) return res.status(404).json({success:false,message:'Akun tidak ditemukan.'});
  res.json({success:true,user:userView(updated.rows[0])});
 }catch(e){next(e);}
});
app.post('/api/auth/logout',auth,(req,res)=>{
  req.session.destroy(e=>{res.clearCookie(process.env.SESSION_COOKIE_NAME||'anilix_session',{httpOnly:true,secure:true,sameSite:'lax'}); if(e)return res.status(500).json({success:false,message:'Gagal logout.'}); res.json({success:true});});
});
app.get('/api/nixgem/balance',auth,(req,res)=>res.json({success:true,balance:Number(req.user.nixgem||0)}));
app.get('/api/premium/packages',(_req,res)=>res.json({success:true,packages:[
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
app.post('/api/premium/checkout',auth,(_req,res)=>res.status(503).json({success:false,message:'Checkout belum aktif sampai payment gateway dan webhook diverifikasi.'}));

app.get('/api/progression/me',auth,async(req,res,next)=>{
 try {
  const u=userView(req.user);
  const h=await pool.query('SELECT amount,reason,created_at FROM public.exp_history WHERE user_id=$1 ORDER BY id DESC LIMIT 20',[req.user.id]);
  res.json({success:true,progression:{level:u.level,total_exp:u.total_exp,exp_in_level:u.exp_in_level,exp_to_next_level:u.exp_to_next_level,exp_per_level:EXP_PER_LEVEL,rank:u.rank},history:h.rows});
 }catch(e){next(e);}
});
app.post('/api/admin/users/:id/progression',auth,developer,async(req,res,next)=>{
 const id=Number(req.params.id);
 const hasLevel=req.body?.level!==undefined&&Number.isInteger(Number(req.body.level));
 const hasExp=req.body?.total_exp!==undefined&&Number.isInteger(Number(req.body.total_exp));
 if(!Number.isSafeInteger(id)||(!hasLevel&&!hasExp))return res.status(400).json({success:false,message:'Kirim level atau total_exp yang valid.'});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const found=await client.query('SELECT * FROM public.users WHERE id=$1 FOR UPDATE',[id]);
  const row=found.rows[0]; if(!row){await client.query('ROLLBACK');return res.status(404).json({success:false,message:'User tidak ditemukan.'});}
  const total=hasExp?Math.max(0,Number(req.body.total_exp)):Math.max(0,Number(req.body.level))*EXP_PER_LEVEL;
  const level=calcLevel(total);
  await client.query('UPDATE public.users SET total_exp=$1,level=$2,updated_at=NOW() WHERE id=$3',[total,level,id]);
  await client.query('INSERT INTO public.exp_history(user_id,amount,reason) VALUES($1,$2,$3)',[id,total-Number(row.total_exp),'Admin progression update']);
  const updated=await client.query('SELECT * FROM public.users WHERE id=$1',[id]);
  await client.query('COMMIT'); res.json({success:true,user:userView(updated.rows[0])});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}
});

app.get('/api/user/favorites',auth,async(req,res,next)=>{
 try{const q=await pool.query('SELECT content_id AS id,content_type AS type,title,poster,payload,created_at FROM public.favorites WHERE user_id=$1 ORDER BY id DESC',[req.user.id]);
 const favorites=q.rows.map(r=>{let payload={};try{payload=r.payload?JSON.parse(r.payload):{};}catch{}return {...r,...payload};});
 res.json({success:true,favorites});}catch(e){next(e);}
});
app.post('/api/user/favorites',auth,async(req,res,next)=>{
 try{const x=req.body||{};if(!x.id||!x.title||!x.type)return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
 await pool.query(`INSERT INTO public.favorites(user_id,content_id,content_type,title,poster,payload) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=EXCLUDED.title,poster=EXCLUDED.poster,payload=EXCLUDED.payload`,
 [req.user.id,String(x.id),String(x.type),String(x.title),x.poster||x.image||null,JSON.stringify(x)]);
 res.json({success:true});}catch(e){next(e);}
});
app.delete('/api/user/favorites/:type/:id',auth,async(req,res,next)=>{
 try{const r=await pool.query('DELETE FROM public.favorites WHERE user_id=$1 AND content_type=$2 AND content_id=$3',[req.user.id,req.params.type,req.params.id]);res.json({success:true,deleted:r.rowCount});}catch(e){next(e);}
});
app.get('/api/user/history',auth,async(req,res,next)=>{
 try{const r=await pool.query('SELECT content_id AS id,content_type AS type,title,poster,episode,progress,watched_at FROM public.watch_history WHERE user_id=$1 ORDER BY watched_at DESC',[req.user.id]);res.json({success:true,history:r.rows});}catch(e){next(e);}
});
app.post('/api/user/history',auth,async(req,res,next)=>{
 try{const x=req.body||{};if(!x.id||!x.title||!x.type)return res.status(400).json({success:false,message:'ID, title, dan type wajib.'});
 await pool.query(`INSERT INTO public.watch_history(user_id,content_id,content_type,title,poster,episode,progress,watched_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
 ON CONFLICT(user_id,content_id,content_type) DO UPDATE SET title=EXCLUDED.title,poster=EXCLUDED.poster,episode=EXCLUDED.episode,progress=EXCLUDED.progress,watched_at=NOW()`,
 [req.user.id,String(x.id),String(x.type),String(x.title),x.poster||null,x.episode||null,Math.max(0,Math.min(100,Number(x.progress)||0))]);
 res.json({success:true});}catch(e){next(e);}
});
app.delete('/api/user/history/:type/:id',auth,async(req,res,next)=>{
 try{const r=await pool.query('DELETE FROM public.watch_history WHERE user_id=$1 AND content_type=$2 AND content_id=$3',[req.user.id,req.params.type,req.params.id]);res.json({success:true,deleted:r.rowCount});}catch(e){next(e);}
});

app.get('/api/catalog',async(req,res)=>{
 const base=String(process.env.SANKA_API_BASE_URL||'').trim();
 if(!base)return res.status(503).json({success:false,message:'Sumber katalog belum dikonfigurasi.'});
 const route=String(req.query.path||'');
 if((!route.startsWith('/anime/')&&!route.startsWith('/episode/'))||route.includes('..')||route.includes('\\\\'))return res.status(400).json({success:false,message:'Rute katalog tidak valid.'});
 try{
  const target=new URL(route,base.endsWith('/')?base:base+'/');
  const upstream=await fetch(target,{headers:{Accept:'application/json',...(process.env.SANKA_API_KEY?{Authorization:'Bearer '+process.env.SANKA_API_KEY}:{})},signal:AbortSignal.timeout(12000)});
  const body=await upstream.text();res.status(upstream.status).type(upstream.headers.get('content-type')||'application/json').send(body);
 }catch(e){console.error('[ANILIX SANKA]',e.message);res.status(502).json({success:false,message:'Tidak dapat menghubungi provider katalog.'});}
});
// Serve the actual Home page at the root URL. The onboarding page remains available at /loading-welcome.html.
const publicDirectory = path.join(ROOT, 'public');
app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));
app.use(express.static(publicDirectory, { extensions: ['html'] }));
// Keep legacy /public/... links working while the deployed copy uses root-relative paths.
app.use('/public', express.static(publicDirectory, { extensions: ['html'] }));

app.use((err,_req,res,_next)=>{console.error('[ANILIX API]',err);res.status(500).json({success:false,message:'Terjadi kesalahan pada server.'});});
module.exports=app;

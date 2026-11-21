'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

async function main() {
  const sqlitePath = path.resolve(process.env.DATABASE_PATH || './database/anilix.db');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi pada .env lokal.');
  if (!fs.existsSync(sqlitePath)) throw new Error('File SQLite tidak ditemukan: ' + sqlitePath);

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 1
  });
  const client = await pool.connect();
  const tables = ['users', 'exp_history', 'favorites', 'watch_history'];
  try {
    const data = {};
    for (const table of tables) data[table] = sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY id').all();

    const target = await client.query(
      'SELECT EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.exp_history) OR EXISTS(SELECT 1 FROM public.favorites) OR EXISTS(SELECT 1 FROM public.watch_history) AS has_data'
    );
    if (target.rows[0].has_data) {
      throw new Error('Supabase ANILIX tables are not empty. Migration stopped to avoid overwriting cloud data.');
    }

    await client.query('BEGIN');
    await client.query('LOCK TABLE public.users, public.exp_history, public.favorites, public.watch_history IN ACCESS EXCLUSIVE MODE');
    const lockedTarget = await client.query(
      'SELECT EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.exp_history) OR EXISTS(SELECT 1 FROM public.favorites) OR EXISTS(SELECT 1 FROM public.watch_history) AS has_data'
    );
    if (lockedTarget.rows[0].has_data) throw new Error('Supabase ANILIX tables are not empty. Migration stopped to avoid overwriting cloud data.');

    for (const row of data.users) {
      await client.query(
        `INSERT INTO public.users(id,username,display_name,email,password_hash,google_sub,role,total_exp,level,nixgem,premium_expires_at,avatar,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,
         email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,google_sub=EXCLUDED.google_sub,
         role=EXCLUDED.role,total_exp=EXCLUDED.total_exp,level=EXCLUDED.level,nixgem=EXCLUDED.nixgem,
         premium_expires_at=EXCLUDED.premium_expires_at,avatar=EXCLUDED.avatar,updated_at=EXCLUDED.updated_at`,
        [row.id,row.username,row.display_name,row.email,row.password_hash,row.google_sub,row.role,
         row.total_exp,row.level,row.nixgem,row.premium_expires_at,row.avatar,row.created_at,row.updated_at]
      );
    }
    for (const row of data.exp_history) {
      await client.query(
        `INSERT INTO public.exp_history(id,user_id,amount,reason,created_at)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,
         amount=EXCLUDED.amount,reason=EXCLUDED.reason,created_at=EXCLUDED.created_at`,
        [row.id,row.user_id,row.amount,row.reason,row.created_at]
      );
    }
    for (const row of data.favorites) {
      await client.query(
        `INSERT INTO public.favorites(id,user_id,content_id,content_type,title,poster,payload,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,content_id=EXCLUDED.content_id,
         content_type=EXCLUDED.content_type,title=EXCLUDED.title,poster=EXCLUDED.poster,
         payload=EXCLUDED.payload,created_at=EXCLUDED.created_at`,
        [row.id,row.user_id,row.content_id,row.content_type,row.title,row.poster,row.payload,row.created_at]
      );
    }
    for (const row of data.watch_history) {
      await client.query(
        `INSERT INTO public.watch_history(id,user_id,content_id,content_type,title,poster,episode,progress,watched_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,content_id=EXCLUDED.content_id,
         content_type=EXCLUDED.content_type,title=EXCLUDED.title,poster=EXCLUDED.poster,
         episode=EXCLUDED.episode,progress=EXCLUDED.progress,watched_at=EXCLUDED.watched_at`,
        [row.id,row.user_id,row.content_id,row.content_type,row.title,row.poster,row.episode,row.progress,row.watched_at]
      );
    }
    for (const table of tables) {
      const sequenceSql = "SELECT setval(pg_get_serial_sequence('public." + table + "','id'), GREATEST(COALESCE((SELECT MAX(id) FROM public." + table + "),1),1), EXISTS(SELECT 1 FROM public." + table + "))";
      await client.query(sequenceSql);
    }
    await client.query('COMMIT');
    console.log('SQLite → Supabase selesai:', Object.fromEntries(tables.map(t => [t,data[t].length])));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch(error => {
  console.error('[ANILIX migration]', error.message);
  process.exitCode = 1;
});

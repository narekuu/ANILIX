# ANILIX — backend-integrated development build

## Menjalankan
1. Salin `.env.example` menjadi `.env`.
2. Isi password untuk 10 akun tester dan `SESSION_SECRET` (acak, panjang, minimal 32 karakter).
3. Isi `GOOGLE_CLIENT_ID` dengan Client ID OAuth yang sama dengan konfigurasi Google Identity Services pada halaman login.
4. Jalankan `npm install`, lalu `npm start`.
5. Buka `http://localhost:3000`. Database SQLite dibuat otomatis di `database/anilix.db`.

## Tester dan EXP
- ID 1–10 dipaksa memiliki role `developer` sesuai keputusan proyek.
- `TESTER_n_LEVELS` adalah level target saat seed. Jika `TESTER_n_EXP=AUTO`, total EXP dihitung sebagai `level × LEVEL_EXP_REQUIRED`.
- Dengan kebutuhan 2.150 EXP per level, level 400.000 = **860.000.000 total EXP**. Level dan EXP berikutnya dihitung dari total EXP agar konsisten.
- Akun tester disinkronkan dari `.env` saat server mulai. Jangan bagikan `.env` atau memasukkan password ke Git.

## Endpoint utama
- `POST /api/auth/login` — login tester
- `POST /api/auth/google` — verifikasi Google ID token di server
- `GET /api/auth/me` dan `GET /api/me` — profil sesi
- `POST /api/auth/logout` — logout
- `GET /api/progression/me` — level/EXP akun
- `GET/POST/DELETE /api/user/favorites` — favorit tersimpan di SQLite
- `GET/POST/DELETE /api/user/history` — riwayat tersimpan di SQLite
- `GET /api/premium/packages` — paket Premium dari server
- `POST /api/premium/checkout` — sengaja nonaktif (503) sampai payment gateway dan webhook benar-benar dikonfigurasi

## Batasan yang belum boleh dianggap aktif
- Pembayaran Premium belum aktif; halaman tidak boleh memberi Premium/NixGem sebelum pembayaran terverifikasi.
- EXP tontonan belum diberikan otomatis. Konfigurasi anti-abuse ada, tetapi integrasi player dan validasi server-side durasi/progress belum tersedia pada arsip ini.
- Arsip ini belum menyertakan `public/js/api.js` yang direferensikan halaman katalog, maupun file data provider yang dibutuhkan katalog. Integrasi sumber anime/Donghua perlu dilengkapi dengan endpoint/provider yang memang digunakan proyek.
- Halaman detail/watch dan pengaturan belum ada di arsip ini; tautan ke halaman tersebut masih perlu diselesaikan saat halaman terkait dibuat.

Ini adalah build pengembangan. Sebelum dipasang publik, gunakan HTTPS, `SESSION_SECURE=true`, secret kuat, domain OAuth yang benar, backup SQLite, dan audit keamanan tambahan.

## Sinkronisasi halaman dan katalog
- Home berada di `/index.html`; halaman internal berada di `/public/`. Tautan Home dari folder `public` harus menuju `/`.
- Aset global berada di `/css/` dan `/js/`; semua halaman publik memuat page transition, skeleton controller, dan poster loading dari root.
- `public/js/api.js` menyediakan `window.SankaAPI` melalui proxy same-origin `/api/catalog`. Isi `SANKA_API_BASE_URL` dan, bila diperlukan, `SANKA_API_KEY` di `.env`. Tanpa base URL, katalog menampilkan pesan belum dikonfigurasi dan tidak memakai data palsu.
- Rute detail dan episode default menggunakan `/anime/:id` dan `/episode/:id` pada provider; sesuaikan path di `public/js/api.js` bila kontrak provider yang dipakai berbeda.

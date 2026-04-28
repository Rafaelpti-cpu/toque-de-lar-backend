const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT;
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'toquedelar2025';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, category VARCHAR(100) DEFAULT 'Geral', price DECIMAL(10,2) DEFAULT 0, description TEXT DEFAULT '', available BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS product_images (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, image_data TEXT, image_order INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (key VARCHAR(100) PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS testimonials (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, text TEXT NOT NULL, stars INTEGER DEFAULT 5, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS interest_log (id SERIAL PRIMARY KEY, product_id INTEGER, product_name VARCHAR(255), created_at TIMESTAMP DEFAULT NOW());
    INSERT INTO settings (key, value) VALUES ('banner_title', 'O toque que faz um lar de verdade.') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('banner_subtitle', 'Qualidade e carinho em cada detalhe para o seu lar.') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('whatsapp', '5545983533696') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('banner_image', '') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('hero_badge', 'NOVA COLEÇÃO') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('footer_about', 'Nascemos da ideia de que cada detalhe do lar conta uma história.') ON CONFLICT (key) DO NOTHING;
  `);
  console.log('Banco inicializado');
}

function auth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  next();
}

// PÚBLICAS
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY sort_order ASC, created_at DESC');
    for (const p of rows) { const imgs = await pool.query('SELECT id, image_data, image_order FROM product_images WHERE product_id = $1 ORDER BY image_order', [p.id]); p.images = imgs.rows; }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings', async (req, res) => {
  try { const { rows } = await pool.query('SELECT key, value FROM settings'); const obj = {}; rows.forEach(r => obj[r.key] = r.value); res.json(obj); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/testimonials', async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM testimonials WHERE active = true ORDER BY created_at DESC'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/interest', async (req, res) => {
  try { const { product_id, product_name } = req.body; await pool.query('INSERT INTO interest_log (product_id, product_name) VALUES ($1, $2)', [product_id, product_name]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ADMIN
app.post('/api/admin/login', (req, res) => { const { password } = req.body; if (password === ADMIN_PASSWORD) res.json({ ok: true }); else res.status(401).json({ error: 'Senha incorreta' }); });

app.put('/api/admin/password', auth, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  ADMIN_PASSWORD = new_password;
  res.json({ ok: true });
});

app.get('/api/admin/dashboard', auth, async (req, res) => {
  try {
    const [total, avail, sold, interests, top, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM products'),
      pool.query('SELECT COUNT(*) FROM products WHERE available = true'),
      pool.query('SELECT COUNT(*) FROM products WHERE available = false'),
      pool.query('SELECT COUNT(*) FROM interest_log'),
      pool.query('SELECT product_name, COUNT(*) as clicks FROM interest_log GROUP BY product_name ORDER BY clicks DESC LIMIT 5'),
      pool.query('SELECT product_name, created_at FROM interest_log ORDER BY created_at DESC LIMIT 10')
    ]);
    res.json({ total: +total.rows[0].count, available: +avail.rows[0].count, sold: +sold.rows[0].count, total_interests: +interests.rows[0].count, top_products: top.rows, recent_interests: recent.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/products', auth, async (req, res) => {
  try { const { name, category, price, description, available } = req.body; const { rows } = await pool.query('INSERT INTO products (name, category, price, description, available) VALUES ($1, $2, $3, $4, $5) RETURNING *', [name, category || 'Geral', price || 0, description || '', available !== false]); res.json(rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/products/:id', auth, async (req, res) => {
  try { const { name, category, price, description, available } = req.body; const { rows } = await pool.query('UPDATE products SET name=$1, category=$2, price=$3, description=$4, available=$5 WHERE id=$6 RETURNING *', [name, category, price, description, available, req.params.id]); res.json(rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/products/:id', auth, async (req, res) => {
  try { await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/products/:id/images', auth, upload.single('image'), async (req, res) => {
  try {
    const productId = req.params.id;
    const count = await pool.query('SELECT COUNT(*) FROM product_images WHERE product_id=$1', [productId]);
    if (parseInt(count.rows[0].count) >= 4) return res.status(400).json({ error: 'Máximo de 4 fotos' });
    const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const { rows } = await pool.query('INSERT INTO product_images (product_id, image_data, image_order) VALUES ($1, $2, $3) RETURNING id', [productId, imageData, parseInt(count.rows[0].count)]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/images/:id', auth, async (req, res) => {
  try { await pool.query('DELETE FROM product_images WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings', auth, async (req, res) => {
  try { for (const [key, value] of Object.entries(req.body)) { await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value]); } res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings/banner-image', auth, upload.single('image'), async (req, res) => {
  try { const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`; await pool.query("INSERT INTO settings (key, value) VALUES ('banner_image', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [imageData]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/testimonials', auth, async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC'); res.json(rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/testimonials', auth, async (req, res) => {
  try { const { name, text, stars } = req.body; const { rows } = await pool.query('INSERT INTO testimonials (name, text, stars) VALUES ($1, $2, $3) RETURNING *', [name, text, stars || 5]); res.json(rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/testimonials/:id', auth, async (req, res) => {
  try { const { active } = req.body; const { rows } = await pool.query('UPDATE testimonials SET active=$1 WHERE id=$2 RETURNING *', [active, req.params.id]); res.json(rows[0]); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/testimonials/:id', auth, async (req, res) => {
  try { await pool.query('DELETE FROM testimonials WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/interests', auth, async (req, res) => {
  try {
    const [total, top, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM interest_log'),
      pool.query('SELECT product_name, COUNT(*) as clicks FROM interest_log GROUP BY product_name ORDER BY clicks DESC LIMIT 10'),
      pool.query('SELECT product_name, created_at FROM interest_log ORDER BY created_at DESC LIMIT 20')
    ]);
    res.json({ total: +total.rows[0].count, top_products: top.rows, recent: recent.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

initDB().then(() => { app.listen(PORT, () => console.log(`Toque de Lar API rodando na porta ${PORT}`)); }).catch(e => { console.error('Erro:', e.message); process.exit(1); });

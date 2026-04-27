const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'toquedelar2025';

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Multer — memória (salva base64 no banco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB por foto
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-password']
}));
app.options('*', cors());
app.use(express.json({ limit: '20mb' }));

// ─── INIT BANCO ────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT 'Geral',
      price DECIMAL(10,2) DEFAULT 0,
      description TEXT DEFAULT '',
      available BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      image_data TEXT,
      image_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT
    );

    INSERT INTO settings (key, value)
    VALUES ('banner_title', 'O toque que faz um lar de verdade.')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO settings (key, value)
    VALUES ('banner_subtitle', 'Qualidade e carinho em cada detalhe para o seu lar.')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO settings (key, value)
    VALUES ('whatsapp', '5500000000000')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO settings (key, value)
    VALUES ('banner_image', '')
    ON CONFLICT (key) DO NOTHING;
  `);
  console.log('✅ Banco inicializado');
}

// ─── MIDDLEWARE AUTH ────────────────────────────────────────
function auth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
// ROTAS PÚBLICAS
// ═══════════════════════════════════════════════════════════

// GET /api/products — lista produtos públicos
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products ORDER BY created_at DESC'
    );
    for (const p of rows) {
      const imgs = await pool.query(
        'SELECT id, image_data, image_order FROM product_images WHERE product_id = $1 ORDER BY image_order',
        [p.id]
      );
      p.images = imgs.rows;
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings — configurações públicas
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    res.json(obj);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ROTAS ADMIN (protegidas)
// ═══════════════════════════════════════════════════════════

// POST /api/admin/login — verifica senha
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

// POST /api/admin/products — criar produto
app.post('/api/admin/products', auth, async (req, res) => {
  try {
    const { name, category, price, description, available } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO products (name, category, price, description, available)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, category || 'Geral', price || 0, description || '', available !== false]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/products/:id — editar produto
app.put('/api/admin/products/:id', auth, async (req, res) => {
  try {
    const { name, category, price, description, available } = req.body;
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, category=$2, price=$3, description=$4, available=$5
       WHERE id=$6 RETURNING *`,
      [name, category, price, description, available, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/products/:id — remover produto
app.delete('/api/admin/products/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/products/:id/images — adicionar foto (até 4)
app.post('/api/admin/products/:id/images', auth, upload.single('image'), async (req, res) => {
  try {
    const productId = req.params.id;

    // Checar quantas fotos já tem
    const count = await pool.query(
      'SELECT COUNT(*) FROM product_images WHERE product_id=$1', [productId]
    );
    if (parseInt(count.rows[0].count) >= 4) {
      return res.status(400).json({ error: 'Máximo de 4 fotos por produto' });
    }

    const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const order = parseInt(count.rows[0].count);

    const { rows } = await pool.query(
      `INSERT INTO product_images (product_id, image_data, image_order)
       VALUES ($1, $2, $3) RETURNING id, image_order`,
      [productId, imageData, order]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/images/:id — remover foto
app.delete('/api/admin/images/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM product_images WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings — atualizar configurações
app.put('/api/admin/settings', auth, async (req, res) => {
  try {
    const settings = req.body; // { key: value, ... }
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/settings/banner-image — trocar imagem do banner
app.put('/api/admin/settings/banner-image', auth, upload.single('image'), async (req, res) => {
  try {
    const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('banner_image', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [imageData]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── START ──────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`🏡 Toque de Lar API rodando na porta ${PORT}`));
});

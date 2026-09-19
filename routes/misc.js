const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/categories
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar categorias.' });
  }
});

// GET /api/companies -> lista (para o seletor "logar como empresa" enquanto nao ha auth)
router.get('/companies', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, logo_url, reputation, balance_cents FROM companies ORDER BY created_at');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar empresas.' });
  }
});

// POST /api/companies -> DESATIVADO. Criar empresa agora tem taxa e capital
// (item 4/5 do briefing) -- use POST /api/onboarding/criar-empresa.
router.post('/companies', async (req, res) => {
  res.status(410).json({ erro: 'Use /api/onboarding/criar-empresa (empresa agora exige taxa de abertura).' });
});

// GET /api/companies/:id -> pagina da empresa
router.get('/companies/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ erro: 'Empresa nao encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar empresa.' });
  }
});

// PUT /api/companies/:id -> salvar nome/descricao/logo da empresa
router.put('/companies/:id', async (req, res) => {
  try {
    const { name, description, logo_url } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ erro: 'O nome da empresa e obrigatorio.' });
    }
    const { rows } = await pool.query(
      `UPDATE companies SET
         name = $1,
         description = $2,
         logo_url = COALESCE($3, logo_url)
       WHERE id = $4 AND is_bot = false
       RETURNING id, name, description, logo_url, reputation, balance_cents`,
      [String(name).trim(), description || null, logo_url || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Empresa nao encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar empresa.' });
  }
});

// POST /api/uploads -> recebe imagem em base64 (arquivo/galeria) e devolve uma
// URL interna. Assim o jogador escolhe do celular/PC em vez de colar link.
router.post('/uploads', async (req, res) => {
  try {
    const { data, mime_type } = req.body;
    if (!data || !mime_type) return res.status(400).json({ erro: 'Envie data e mime_type.' });
    if (!/^image\//.test(mime_type)) return res.status(400).json({ erro: 'Apenas imagens sao aceitas.' });
    // ~4MB em base64 -> limite de seguranca
    if (data.length > 5.5 * 1024 * 1024) return res.status(413).json({ erro: 'Imagem muito grande (max ~4MB).' });

    const { rows } = await pool.query(
      'INSERT INTO uploads (mime_type, data) VALUES ($1,$2) RETURNING id',
      [mime_type, data]
    );
    res.status(201).json({ url: `/api/uploads/${rows[0].id}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao enviar imagem.' });
  }
});

// GET /api/uploads/:id -> serve a imagem guardada
router.get('/uploads/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT mime_type, data FROM uploads WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).send('Imagem nao encontrada.');
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(Buffer.from(rows[0].data, 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao carregar imagem.');
  }
});

module.exports = router;

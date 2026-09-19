const express = require('express');
const { pool } = require('../db/pool');
const { consumirOperacao } = require('./wifi');
const { decidirOfertaAfiliado } = require('../simulation/social');

const router = express.Router();

// ---------- AFILIADOS ----------

// GET /api/social/afiliados/:companyId -> pedidos e afiliados ativos
router.get('/afiliados/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, p.name AS product_name, p.price_cents,
              COALESCE(b.name, u.nickname, 'Jogador') AS afiliado_nome,
              CASE WHEN a.user_id IS NOT NULL THEN 'jogador' ELSE 'bot' END AS tipo
       FROM affiliates a
       JOIN products p ON p.id = a.product_id
       LEFT JOIN bots b ON b.id = a.bot_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.company_id = $1
       ORDER BY (a.status = 'pendente') DESC, a.created_at DESC
       LIMIT 100`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar afiliados.' });
  }
});

// PATCH /api/social/afiliados/:id -> aceitar/recusar pedido feito PELO BOT (fluxo antigo)
router.patch('/afiliados/:id', async (req, res) => {
  try {
    const { status, commission_pct } = req.body;
    if (!['ativo', 'recusado', 'encerrado'].includes(status)) {
      return res.status(400).json({ erro: 'Status invalido.' });
    }
    const { rows } = await pool.query(
      `UPDATE affiliates SET status = $1,
              commission_pct = COALESCE($2, commission_pct)
       WHERE id = $3 RETURNING *`,
      [status, commission_pct || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar afiliado.' });
  }
});

// POST /api/social/afiliados/:id/oferecer -> VENDEDOR propoe uma comissao,
// o bot decide: aceita, contrapropoe ou recusa (item 15/16 -- mesmo a 0%
// alguns bots aceitam e outros nao, depende do calculo abaixo).
router.post('/afiliados/:id/oferecer', async (req, res) => {
  try {
    const { commission_pct } = req.body;
    const oferta = Math.max(0, Math.min(70, Number(commission_pct)));

    const atual = await pool.query(
      `SELECT a.*, p.rating_avg, p.sales_count, p.name AS product_name
       FROM affiliates a JOIN products p ON p.id = a.product_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (atual.rows.length === 0) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
    if (atual.rows[0].status !== 'pendente') return res.status(400).json({ erro: 'Esse pedido ja foi respondido.' });
    if (atual.rows[0].negotiation_rounds >= 4) {
      return res.status(400).json({ erro: 'Limite de rodadas de negociacao atingido.' });
    }

    const resultado = decidirOfertaAfiliado({
      ofertaPct: oferta,
      produto: { rating_avg: atual.rows[0].rating_avg, sales_count: atual.rows[0].sales_count },
    });

    if (resultado.decisao === 'aceito') {
      const { rows } = await pool.query(
        `UPDATE affiliates SET status = 'ativo', commission_pct = $1, negotiation_rounds = negotiation_rounds + 1
         WHERE id = $2 RETURNING *`,
        [oferta, req.params.id]
      );
      return res.json({ decisao: 'aceito', afiliado: rows[0] });
    }
    if (resultado.decisao === 'negociando') {
      const { rows } = await pool.query(
        `UPDATE affiliates SET last_offer_pct = $1, negotiation_rounds = negotiation_rounds + 1
         WHERE id = $2 RETURNING *`,
        [resultado.proposta_pct, req.params.id]
      );
      return res.json({ decisao: 'negociando', proposta_pct: resultado.proposta_pct, afiliado: rows[0] });
    }
    const { rows } = await pool.query(
      `UPDATE affiliates SET status = 'recusado', negotiation_rounds = negotiation_rounds + 1
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ decisao: 'recusado', afiliado: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao negociar.' });
  }
});

// POST /api/social/afiliados/pedir -> jogador pede pra se afiliar a um produto de outro
router.post('/afiliados/pedir', async (req, res) => {
  try {
    const { user_id, product_id } = req.body;
    if (!user_id || !product_id) return res.status(400).json({ erro: 'user_id e product_id sao obrigatorios.' });

    const prod = await pool.query('SELECT company_id FROM products WHERE id = $1', [product_id]);
    if (prod.rows.length === 0) return res.status(404).json({ erro: 'Produto nao encontrado.' });

    const { rows } = await pool.query(
      `INSERT INTO affiliates (company_id, user_id, product_id, commission_pct, reach, status)
       VALUES ($1,$2,$3,30,500,'pendente') RETURNING *`,
      [prod.rows[0].company_id, user_id, product_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao pedir afiliacao.' });
  }
});

// ---------- MARKETCHAT ----------

// GET /api/social/feed -> timeline
router.get('/feed', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS company_name, c.logo_url,
              b.name AS bot_name, pr.name AS product_name, pr.price_cents,
              (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id) AS comentarios
       FROM posts p
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN bots b ON b.id = p.bot_id
       LEFT JOIN products pr ON pr.id = p.product_id
       ORDER BY p.created_at DESC LIMIT 40`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao carregar feed.' });
  }
});

// GET /api/social/feed/:postId/comentarios
router.get('/feed/:postId/comentarios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pc.*, COALESCE(b.name, c.name) AS autor
       FROM post_comments pc
       LEFT JOIN bots b ON b.id = pc.bot_id
       LEFT JOIN companies c ON c.id = pc.company_id
       WHERE pc.post_id = $1 ORDER BY pc.created_at LIMIT 50`,
      [req.params.postId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao carregar comentarios.' });
  }
});

// POST /api/social/feed -> jogador publica (post normal ou divulgacao de produto)
router.post('/feed', async (req, res) => {
  const client = await pool.connect();
  try {
    const { company_id, content, product_id, image_url } = req.body;
    if (!company_id || !content || !String(content).trim()) {
      client.release();
      return res.status(400).json({ erro: 'Escreva algo antes de publicar.' });
    }
    await client.query('BEGIN');
    const wifi = await consumirOperacao(client, company_id);
    if (!wifi.ok) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ erro: wifi.motivo });
    }
    const { rows } = await client.query(
      `INSERT INTO posts (company_id, product_id, content, image_url, kind, reach)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [company_id, product_id || null, String(content).trim().slice(0, 500),
       image_url || null, product_id ? 'divulgacao' : 'post',
       50 + Math.floor(Math.random() * 150)]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao publicar.' });
  } finally {
    client.release();
  }
});

// POST /api/social/feed/:postId/like
router.post('/feed/:postId/like', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE posts SET likes = likes + 1 WHERE id = $1 RETURNING likes',
      [req.params.postId]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Post nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao curtir.' });
  }
});

// POST /api/social/feed/:postId/comentarios -> jogador comenta
router.post('/feed/:postId/comentarios', async (req, res) => {
  try {
    const { company_id, content } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ erro: 'Escreva um comentario.' });
    const { rows } = await pool.query(
      'INSERT INTO post_comments (post_id, company_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.postId, company_id || null, String(content).trim().slice(0, 300)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao comentar.' });
  }
});

module.exports = router;

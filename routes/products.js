const express = require('express');
const { pool } = require('../db/pool');
const { consumirOperacao } = require('./wifi');

const router = express.Router();

const TIPOS_VALIDOS = ['ebook', 'curso', 'template', 'software', 'servico', 'fisico', 'digital', 'outro'];
const STATUS_VALIDOS = ['active', 'paused', 'draft'];

function paraCentavos(valorReais) {
  return Math.round(Number(valorReais) * 100);
}

// GET /api/products  -> marketplace geral (com filtro/ordenacao)
// query params: categoria, busca, ordenar (relevancia|preco_asc|preco_desc|recentes|vendas)
router.get('/', async (req, res) => {
  try {
    const { categoria, busca, ordenar = 'relevancia', page = 1, limit = 24 } = req.query;
    const params = [];
    const where = ["p.status = 'active'"];

    if (categoria) {
      params.push(categoria);
      where.push(`c.slug = $${params.length}`);
    }
    if (busca) {
      params.push(`%${busca}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.niche ILIKE $${params.length})`);
    }

    let orderBy = 'p.sales_count DESC, p.rating_avg DESC, p.created_at DESC'; // relevancia (simplificada ate o motor de tendencias existir)
    if (ordenar === 'preco_asc') orderBy = 'p.price_cents ASC';
    if (ordenar === 'preco_desc') orderBy = 'p.price_cents DESC';
    if (ordenar === 'recentes') orderBy = 'p.created_at DESC';
    if (ordenar === 'vendas') orderBy = 'p.sales_count DESC';

    const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
    params.push(Number(limit));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT p.id, p.name, p.description, p.product_type, p.niche, p.price_cents,
             p.cover_image_url, p.status, p.views_count, p.sales_count,
             p.rating_avg, p.rating_count, p.created_at,
             c.name AS category_name, c.slug AS category_slug,
             co.id AS company_id, co.name AS company_name, co.reputation AS company_reputation
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN companies co ON co.id = p.company_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ produtos: rows, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar produtos.' });
  }
});

// GET /api/products/:id -> pagina do produto
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              co.name AS company_name, co.logo_url AS company_logo, co.reputation AS company_reputation
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN companies co ON co.id = p.company_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Produto nao encontrado.' });

    // registra visualizacao (fase 1: contagem simples, sem bots ainda)
    await pool.query('UPDATE products SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar produto.' });
  }
});

// GET /api/products/empresa/:companyId -> "Meus Produtos"
router.get('/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.company_id = $1
       ORDER BY p.created_at DESC`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar produtos da empresa.' });
  }
});

// POST /api/products -> criar produto (exige Wi-Fi ativo)
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      company_id, name, category_id, description, product_type,
      niche, keywords, target_audience, price, cost,
      stock_quantity, cover_image_url, status, currency_code,
    } = req.body;

    if (!company_id || !name || price === undefined) {
      client.release();
      return res.status(400).json({ erro: 'company_id, name e price sao obrigatorios.' });
    }

    await client.query('BEGIN');
    const wifi = await consumirOperacao(client, company_id);
    if (!wifi.ok) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ erro: wifi.motivo });
    }
    const tipo = TIPOS_VALIDOS.includes(product_type) ? product_type : 'ebook';
    const statusFinal = STATUS_VALIDOS.includes(status) ? status : 'active';
    const keywordsArr = Array.isArray(keywords)
      ? keywords
      : (typeof keywords === 'string' && keywords.length ? keywords.split(',').map((k) => k.trim()) : []);

    const { rows } = await client.query(
      `INSERT INTO products
        (company_id, name, category_id, description, product_type, niche, keywords,
         target_audience, price_cents, cost_cents, stock_quantity, cover_image_url, status, currency_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        company_id, name, category_id || null, description || null, tipo, niche || null,
        keywordsArr, target_audience || null, paraCentavos(price), paraCentavos(cost || 0),
        stock_quantity === '' || stock_quantity === undefined ? null : Number(stock_quantity),
        cover_image_url || null, statusFinal, currency_code || 'BRL',
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar produto.' });
  } finally {
    client.release();
  }
});

// PUT /api/products/:id -> editar produto
router.put('/:id', async (req, res) => {
  try {
    const {
      name, category_id, description, product_type, niche, keywords,
      target_audience, price, cost, stock_quantity, cover_image_url, status,
    } = req.body;

    const keywordsArr = Array.isArray(keywords)
      ? keywords
      : (typeof keywords === 'string' && keywords.length ? keywords.split(',').map((k) => k.trim()) : undefined);

    const { rows } = await pool.query(
      `UPDATE products SET
         name = COALESCE($1, name),
         category_id = COALESCE($2, category_id),
         description = COALESCE($3, description),
         product_type = COALESCE($4, product_type),
         niche = COALESCE($5, niche),
         keywords = COALESCE($6, keywords),
         target_audience = COALESCE($7, target_audience),
         price_cents = COALESCE($8, price_cents),
         cost_cents = COALESCE($9, cost_cents),
         stock_quantity = $10,
         cover_image_url = COALESCE($11, cover_image_url),
         status = COALESCE($12, status),
         updated_at = now()
       WHERE id = $13
       RETURNING *`,
      [
        name || null, category_id || null, description || null, product_type || null,
        niche || null, keywordsArr || null, target_audience || null,
        price !== undefined ? paraCentavos(price) : null,
        cost !== undefined ? paraCentavos(cost) : null,
        stock_quantity === '' || stock_quantity === undefined ? null : Number(stock_quantity),
        cover_image_url || null, status || null, req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Produto nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao editar produto.' });
  }
});

// POST /api/products/:id/comprar -> jogador compra o produto de outra empresa
router.post('/:id/comprar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { company_id, user_id } = req.body; // empresa do COMPRADOR
    if (!company_id) return res.status(400).json({ erro: 'company_id e obrigatorio.' });

    await client.query('BEGIN');
    const prod = await client.query(
      `SELECT p.*, c.rate_to_brl, c.import_tax_pct
       FROM products p LEFT JOIN currencies c ON c.code = p.currency_code
       WHERE p.id = $1 FOR UPDATE OF p`,
      [req.params.id]
    );
    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Produto nao encontrado.' });
    }
    const p = prod.rows[0];
    if (p.company_id === company_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Voce nao pode comprar o proprio produto.' });
    }
    if (p.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Produto indisponivel.' });
    }
    if (p.stock_quantity !== null && p.stock_quantity <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Produto esgotado.' });
    }

    // ---- ANTI-FRAUDE: limite de compras validas por comprador/produto ----
    // Conta compras anteriores desse produto vindas da MESMA CONTA e, se
    // soubermos o dispositivo, tambem de QUALQUER OUTRA CONTA no mesmo
    // aparelho -- fecha a brecha de criar varias contas so pra farmar venda.
    const MAX_COMPRAS_POR_PRODUTO = 3;
    const COOLDOWN_MINUTOS = 10;

    let deviceId = null;
    if (user_id) {
      const u = await client.query('SELECT device_id FROM users WHERE id = $1', [user_id]);
      if (u.rows.length) deviceId = u.rows[0].device_id;
    }

    const contagem = deviceId
      ? await client.query(
          `SELECT COUNT(*)::int AS total, MAX(o.created_at) AS ultima
           FROM orders o
           JOIN companies c ON c.id = o.company_id
           JOIN users u ON u.company_id = c.id
           WHERE o.product_id = $1 AND o.source = 'jogador' AND u.device_id = $2`,
          [p.id, deviceId]
        )
      : await client.query(
          `SELECT COUNT(*)::int AS total, MAX(created_at) AS ultima
           FROM orders WHERE product_id = $1 AND company_id = $2 AND source = 'jogador'`,
          [p.id, company_id]
        );

    const { total, ultima } = contagem.rows[0];
    if (total >= MAX_COMPRAS_POR_PRODUTO) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Voce ja atingiu o limite de compras validas desse produto.' });
    }
    if (ultima && (Date.now() - new Date(ultima).getTime()) < COOLDOWN_MINUTOS * 60000) {
      await client.query('ROLLBACK');
      return res.status(429).json({ erro: `Aguarde alguns minutos antes de comprar esse produto de novo.` });
    }

    const precoBrl = Math.round(p.price_cents * Number(p.rate_to_brl || 1));
    const imposto = Math.round(precoBrl * Number(p.import_tax_pct || 0) / 100);

    const comprador = await client.query(
      'SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE',
      [company_id]
    );
    if (comprador.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Empresa compradora nao encontrada.' });
    }
    if (Number(comprador.rows[0].balance_cents) < precoBrl) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente para essa compra.' });
    }

    // comprador paga, vendedor recebe liquido (taxa da plataforma sai da economia)
    const liquido = Math.round(precoBrl * 0.92) - imposto;
    await client.query('UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2', [precoBrl, company_id]);
    await client.query('UPDATE companies SET balance_cents = balance_cents + $1 WHERE id = $2', [liquido, p.company_id]);
    await client.query(
      `INSERT INTO orders (product_id, company_id, user_id, price_cents, source, currency_code, tax_cents)
       VALUES ($1,$2,$3,$4,'jogador',$5,$6)`,
      [p.id, p.company_id, user_id || null, precoBrl, p.currency_code || 'BRL', imposto]
    );
    await client.query(
      `UPDATE products SET sales_count = sales_count + 1,
         stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE GREATEST(0, stock_quantity - 1) END
       WHERE id = $1`,
      [p.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, pago_cents: precoBrl });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao comprar produto.' });
  } finally {
    client.release();
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Produto nao encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir produto.' });
  }
});

module.exports = router;

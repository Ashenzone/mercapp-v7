const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// ---------- 8. IMPOSTOS ----------
router.get('/impostos/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tax_records WHERE company_id = $1
       ORDER BY game_month DESC, created_at DESC LIMIT 100`,
      [req.params.companyId]
    );
    const aberto = rows.filter((r) => r.status !== 'pago')
      .reduce((s, r) => s + Number(r.amount_cents), 0);
    res.json({ impostos: rows, total_aberto_cents: aberto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar impostos.' });
  }
});

// ---------- 17. CONTAS DO MES ----------
router.get('/contas/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM monthly_bills WHERE company_id = $1 ORDER BY game_month DESC LIMIT 24',
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar contas.' });
  }
});

// POST /api/financas/contas/:id/pagar -> paga a conta do mes (debita saldo)
router.post('/contas/:id/pagar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const conta = await client.query(
      'SELECT * FROM monthly_bills WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (conta.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Conta nao encontrada.' });
    }
    const c = conta.rows[0];
    if (c.status === 'pago') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Essa conta ja foi paga.' });
    }

    const empresa = await client.query(
      'SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE',
      [c.company_id]
    );
    if (Number(empresa.rows[0].balance_cents) < Number(c.total_cents)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente para pagar as contas deste mes.' });
    }

    await client.query(
      'UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2',
      [c.total_cents, c.company_id]
    );
    await client.query("UPDATE monthly_bills SET status = 'pago' WHERE id = $1", [c.id]);
    await client.query(
      "UPDATE tax_records SET status = 'pago' WHERE company_id = $1 AND game_month = $2 AND status <> 'pago'",
      [c.company_id, c.game_month]
    );

    await client.query('COMMIT');
    res.json({ ok: true, pago_cents: Number(c.total_cents) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao pagar contas.' });
  } finally {
    client.release();
  }
});

// ---------- 16. CASA E MOVEIS ----------
router.get('/casa/:companyId', async (req, res) => {
  try {
    let casa = await pool.query('SELECT * FROM houses WHERE company_id = $1', [req.params.companyId]);
    if (casa.rows.length === 0) {
      casa = await pool.query(
        'INSERT INTO houses (company_id) VALUES ($1) RETURNING *',
        [req.params.companyId]
      );
    }

    const [catalogo, meus] = await Promise.all([
      pool.query('SELECT * FROM furniture_catalog ORDER BY category, price_cents'),
      pool.query(
        `SELECT o.id, f.* FROM owned_furniture o
         JOIN furniture_catalog f ON f.id = o.furniture_id
         WHERE o.company_id = $1 ORDER BY f.category`,
        [req.params.companyId]
      ),
    ]);

    const consumoEnergia = meus.rows
      .filter((f) => f.category !== 'utilidade')
      .reduce((s, f) => s + Number(f.energy_cents), 0);
    const consumoAgua = meus.rows.reduce((s, f) => s + Number(f.water_cents), 0);
    const conforto = meus.rows.reduce((s, f) => s + Number(f.comfort), 0);
    const produtividade = meus.rows.reduce((s, f) => s + Number(f.productivity_pct), 0);

    res.json({
      casa: casa.rows[0],
      catalogo: catalogo.rows,
      meus_moveis: meus.rows,
      resumo: {
        energia_cents: 8000 + consumoEnergia,
        agua_cents: 6000 + consumoAgua,
        conforto,
        produtividade_pct: produtividade,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao carregar a casa.' });
  }
});

// comprar movel
router.post('/casa/:companyId/comprar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { furniture_id } = req.body;
    await client.query('BEGIN');

    const movel = await client.query('SELECT * FROM furniture_catalog WHERE id = $1', [furniture_id]);
    if (movel.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Movel nao encontrado.' });
    }
    const preco = Number(movel.rows[0].price_cents);

    const empresa = await client.query(
      'SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE',
      [req.params.companyId]
    );
    if (empresa.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Empresa nao encontrada.' });
    }
    if (Number(empresa.rows[0].balance_cents) < preco) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente.' });
    }

    await client.query(
      'UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2',
      [preco, req.params.companyId]
    );
    await client.query(
      'INSERT INTO owned_furniture (company_id, furniture_id) VALUES ($1,$2)',
      [req.params.companyId, furniture_id]
    );
    await client.query(
      'UPDATE houses SET comfort = comfort + $1 WHERE company_id = $2',
      [Number(movel.rows[0].comfort), req.params.companyId]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao comprar movel.' });
  } finally {
    client.release();
  }
});

// trocar de casa (alugar melhor ou comprar a propria)
const CASAS = [
  { kind: 'aluguel', name: 'Kitnet alugada',        rent_cents: 90000,  price_cents: 0 },
  { kind: 'aluguel', name: 'Apartamento alugado',   rent_cents: 220000, price_cents: 0 },
  { kind: 'aluguel', name: 'Casa alugada',          rent_cents: 380000, price_cents: 0 },
  { kind: 'propria', name: 'Apartamento proprio',   rent_cents: 0,      price_cents: 28000000 },
  { kind: 'propria', name: 'Casa propria',          rent_cents: 0,      price_cents: 52000000 },
];

router.get('/casas-disponiveis', (req, res) => res.json(CASAS));

router.post('/casa/:companyId/mudar', async (req, res) => {
  const client = await pool.connect();
  try {
    const opcao = CASAS[Number(req.body.indice)];
    if (!opcao) return res.status(400).json({ erro: 'Opcao invalida.' });

    await client.query('BEGIN');
    if (opcao.price_cents > 0) {
      const empresa = await client.query(
        'SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE',
        [req.params.companyId]
      );
      if (Number(empresa.rows[0].balance_cents) < opcao.price_cents) {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: 'Saldo insuficiente para comprar esse imovel.' });
      }
      await client.query(
        'UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2',
        [opcao.price_cents, req.params.companyId]
      );
    }

    await client.query(
      `INSERT INTO houses (company_id, kind, name, rent_cents)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_id) DO UPDATE SET kind = $2, name = $3, rent_cents = $4`,
      [req.params.companyId, opcao.kind, opcao.name, opcao.rent_cents]
    );
    await client.query('COMMIT');
    res.json({ ok: true, casa: opcao });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao mudar de casa.' });
  } finally {
    client.release();
  }
});

// ---------- 19. BANCO POR MOEDA ----------
// Mostra quanto foi vendido em cada moeda (equivalente acumulado). O saldo
// que realmente pode ser gasto e sempre o de companies.balance_cents em
// BRL -- isso aqui e informativo, pra visualizar o quanto vem de fora.
router.get('/banco/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.currency_code, cur.name, cur.symbol, cur.rate_to_brl,
              SUM(o.price_cents)::bigint AS total_brl_cents,
              COUNT(*)::int AS vendas
       FROM orders o JOIN currencies cur ON cur.code = o.currency_code
       WHERE o.company_id = $1
       GROUP BY o.currency_code, cur.name, cur.symbol, cur.rate_to_brl
       ORDER BY total_brl_cents DESC`,
      [req.params.companyId]
    );
    res.json(rows.map((r) => ({
      ...r,
      equivalente_moeda_original: Number(r.total_brl_cents) / Number(r.rate_to_brl),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao calcular banco por moeda.' });
  }
});

// ---------- 9. MOEDAS ----------
router.get('/moedas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM currencies ORDER BY code');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar moedas.' });
  }
});

module.exports = router;

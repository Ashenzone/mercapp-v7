const express = require('express');
const { pool } = require('../db/pool');
const { consumirOperacao } = require('./wifi');

const router = express.Router();

// GET /api/campaigns/empresa/:companyId
router.get('/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, p.name AS product_name
       FROM campaigns c JOIN products p ON p.id = c.product_id
       WHERE c.company_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar campanhas.' });
  }
});

// POST /api/campaigns -> criar campanha (debita orcamento do saldo da empresa)
router.post('/', async (req, res) => {
  const { company_id, product_id, budget, duration_days, audience, region, objective } = req.body;
  if (!company_id || !product_id || !budget) {
    return res.status(400).json({ erro: 'company_id, product_id e budget sao obrigatorios.' });
  }
  const budgetCents = Math.round(Number(budget) * 100);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wifi = await consumirOperacao(client, company_id);
    if (!wifi.ok) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: wifi.motivo });
    }
    const empresa = await client.query('SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE', [company_id]);
    if (empresa.rows.length === 0) throw new Error('Empresa nao encontrada.');
    if (empresa.rows[0].balance_cents < budgetCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente para esse orcamento de campanha.' });
    }

    // o orcamento e cobrado integralmente na criacao; o motor de simulacao
    // "consome" essa verba aos poucos, gerando impressoes/cliques por ciclo
    await client.query('UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2', [budgetCents, company_id]);

    const estado = await client.query('SELECT game_day, game_month FROM simulation_state WHERE id = true');
    const { game_day, game_month } = estado.rows[0] || { game_day: 1, game_month: 1 };

    const campanha = await client.query(
      `INSERT INTO campaigns (company_id, product_id, budget_cents, duration_days, audience, region, objective, start_game_day, start_game_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [company_id, product_id, budgetCents, duration_days || 7, audience || null, region || 'Brasil', objective || 'vendas', game_day, game_month]
    );
    await client.query('COMMIT');
    res.status(201).json(campanha.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: err.message || 'Erro ao criar campanha.' });
  } finally {
    client.release();
  }
});

// PATCH /api/campaigns/:id/status -> pausar/reativar
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'paused', 'finished'].includes(status)) {
      return res.status(400).json({ erro: 'status invalido.' });
    }
    const { rows } = await pool.query('UPDATE campaigns SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ erro: 'Campanha nao encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar campanha.' });
  }
});

module.exports = router;

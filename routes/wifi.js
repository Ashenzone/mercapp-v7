const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

router.get('/planos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wifi_plans ORDER BY price_cents');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar planos.' });
  }
});

router.get('/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, p.name AS plan_name, p.speed_mbps, p.stability_pct
       FROM company_wifi w JOIN wifi_plans p ON p.id = w.plan_id
       WHERE w.company_id = $1`,
      [req.params.companyId]
    );
    if (rows.length === 0) return res.json(null);
    const ativo = rows[0].operations_left > 0 && new Date(rows[0].expires_at) > new Date();
    res.json({ ...rows[0], ativo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao verificar Wi-Fi.' });
  }
});

router.post('/empresa/:companyId/comprar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { plan_id } = req.body;
    await client.query('BEGIN');

    const plano = await client.query('SELECT * FROM wifi_plans WHERE id = $1', [plan_id]);
    if (plano.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Plano nao encontrado.' });
    }
    const pl = plano.rows[0];

    const empresa = await client.query('SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE', [req.params.companyId]);
    if (empresa.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Empresa nao encontrada.' });
    }
    if (Number(empresa.rows[0].balance_cents) < pl.price_cents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente para esse plano.' });
    }

    await client.query('UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2', [pl.price_cents, req.params.companyId]);

    // 1 dia de jogo = 4h reais (mesma escala do relogio do motor)
    const expiraEm = new Date(Date.now() + pl.duration_days * 4 * 3600000);
    await client.query(
      `INSERT INTO company_wifi (company_id, plan_id, operations_left, expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_id) DO UPDATE SET plan_id = $2, operations_left = $3, activated_at = now(), expires_at = $4`,
      [req.params.companyId, plan_id, pl.operation_limit, expiraEm]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, expira_em: expiraEm });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao comprar plano.' });
  } finally {
    client.release();
  }
});

// Usado pelas outras rotas (produtos, campanhas, marketchat) pra checar e
// consumir uma "operacao" do plano antes de deixar a acao acontecer.
async function consumirOperacao(client, companyId) {
  const { rows } = await client.query(
    'SELECT * FROM company_wifi WHERE company_id = $1 FOR UPDATE',
    [companyId]
  );
  if (rows.length === 0) return { ok: false, motivo: 'Voce precisa comprar um plano de Wi-Fi antes.' };
  const w = rows[0];
  if (new Date(w.expires_at) <= new Date()) return { ok: false, motivo: 'Seu plano de Wi-Fi expirou.' };
  if (w.operations_left <= 0) return { ok: false, motivo: 'Seu plano de Wi-Fi acabou as operacoes -- compre outro.' };

  await client.query('UPDATE company_wifi SET operations_left = operations_left - 1 WHERE company_id = $1', [companyId]);
  return { ok: true };
}

module.exports = router;
module.exports.consumirOperacao = consumirOperacao;

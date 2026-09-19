const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/onboarding/config -> taxa de criacao atual
router.get('/config', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value_cents FROM game_config WHERE key = 'taxa_criacao_empresa'");
    res.json({ taxa_criacao_cents: Number(rows[0]?.value_cents || 30000) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar configuracao.' });
  }
});

// GET /api/onboarding/vagas -> empresas (bots e jogadores) com vagas abertas
router.get('/vagas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id AS company_id, c.name AS company_name, c.is_bot, c.reputation,
              r.id AS role_id, r.title, r.salary_cents, r.department
       FROM companies c
       LEFT JOIN roles r ON r.company_id = c.id
       WHERE c.id IS NOT NULL
       ORDER BY c.is_bot DESC, c.reputation DESC
       LIMIT 60`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar vagas.' });
  }
});

// POST /api/onboarding/candidatar -> jogador se candidata (com salario desejado, negociavel)
router.post('/candidatar', async (req, res) => {
  try {
    const { user_id, company_id, role_id, wage } = req.body;
    if (!user_id || !company_id) return res.status(400).json({ erro: 'Dados incompletos.' });

    const existente = await pool.query(
      `SELECT 1 FROM job_applications WHERE user_id = $1 AND company_id = $2 AND status IN ('pendente','contratado')`,
      [user_id, company_id]
    );
    if (existente.rows.length > 0) {
      return res.status(400).json({ erro: 'Voce ja tem uma candidatura em aberto nessa empresa.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO job_applications (company_id, user_id, role_id, skill, wage_cents, status)
       VALUES ($1,$2,$3,60,$4,'pendente') RETURNING *`,
      [company_id, user_id, role_id || null, Math.round(Number(wage || 1500) * 100)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao se candidatar.' });
  }
});

// GET /api/onboarding/minhas-candidaturas/:userId
router.get('/minhas-candidaturas/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, c.name AS company_name FROM job_applications j
       JOIN companies c ON c.id = j.company_id
       WHERE j.user_id = $1 ORDER BY j.created_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar candidaturas.' });
  }
});

// POST /api/onboarding/negociar/:id -> jogador contra-propoe salario numa candidatura ainda pendente
router.post('/negociar/:id', async (req, res) => {
  try {
    const { wage } = req.body;
    const { rows } = await pool.query(
      `UPDATE job_applications SET wage_cents = $1 WHERE id = $2 AND status = 'pendente' RETURNING *`,
      [Math.round(Number(wage) * 100), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Candidatura nao encontrada ou ja respondida.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao negociar.' });
  }
});

// POST /api/onboarding/criar-empresa -> paga a taxa, usa capital do saldo pessoal
router.post('/criar-empresa', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, name, description, logo_url, category_id, capital } = req.body;
    if (!user_id || !name || !String(name).trim()) {
      return res.status(400).json({ erro: 'Nome da empresa e obrigatorio.' });
    }

    await client.query('BEGIN');
    const user = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user_id]);
    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    }
    if (user.rows[0].company_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Voce ja tem uma empresa.' });
    }

    const taxa = await client.query("SELECT value_cents FROM game_config WHERE key = 'taxa_criacao_empresa'");
    const taxaCents = Number(taxa.rows[0]?.value_cents || 30000);
    const capitalCents = Math.max(0, Math.round(Number(capital || 0) * 100));
    const totalNecessario = taxaCents + capitalCents;

    if (Number(user.rows[0].balance_cents) < totalNecessario) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        erro: `Voce precisa de ${((totalNecessario) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (taxa + capital). Trabalhe mais um pouco antes de abrir a empresa.`,
      });
    }

    const empresa = await client.query(
      `INSERT INTO companies (name, description, logo_url, category_id, balance_cents, is_bot)
       VALUES ($1,$2,$3,$4,$5,false) RETURNING *`,
      [String(name).trim(), description || null, logo_url || null, category_id || null, capitalCents]
    );

    await client.query(
      'UPDATE users SET company_id = $1, balance_cents = balance_cents - $2 WHERE id = $3',
      [empresa.rows[0].id, totalNecessario, user_id]
    );

    // qualquer candidatura de emprego pendente do jogador e cancelada
    // (agora ele e patrao, nao empregado -- evita ele se contratar por engano)
    await client.query(
      "UPDATE job_applications SET status = 'recusado' WHERE user_id = $1 AND status = 'pendente'",
      [user_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ empresa: empresa.rows[0], taxa_paga_cents: taxaCents, capital_cents: capitalCents });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar empresa.' });
  } finally {
    client.release();
  }
});

module.exports = router;

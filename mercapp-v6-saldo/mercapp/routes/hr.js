const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// ---------- 12. CARGOS ----------
router.get('/cargos/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*)::int FROM job_applications j
               WHERE j.role_id = r.id AND j.status = 'contratado') AS ocupados
       FROM roles r WHERE r.company_id = $1 ORDER BY r.created_at`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar cargos.' });
  }
});

router.post('/cargos', async (req, res) => {
  try {
    const { company_id, title, salary, department, bonus_pct } = req.body;
    if (!company_id || !title) return res.status(400).json({ erro: 'company_id e title sao obrigatorios.' });
    const { rows } = await pool.query(
      `INSERT INTO roles (company_id, title, salary_cents, department, bonus_pct)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [company_id, String(title).trim(), Math.round(Number(salary || 1500) * 100),
       department || 'geral', Number(bonus_pct || 0)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar cargo.' });
  }
});

router.delete('/cargos/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Cargo nao encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao excluir cargo.' });
  }
});

// ---------- 11/13. CANDIDATURAS E FUNCIONARIOS ----------
router.get('/vagas/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, COALESCE(b.name, u.nickname, 'Jogador') AS candidato,
              b.profile AS perfil, r.title AS cargo,
              CASE WHEN j.user_id IS NOT NULL THEN 'jogador' ELSE 'bot' END AS tipo
       FROM job_applications j
       LEFT JOIN bots b ON b.id = j.bot_id
       LEFT JOIN users u ON u.id = j.user_id
       LEFT JOIN roles r ON r.id = j.role_id
       WHERE j.company_id = $1 AND j.status IN ('pendente','contratado')
       ORDER BY (j.status = 'pendente') DESC, j.created_at DESC`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar candidaturas.' });
  }
});

// contratar / recusar / demitir
router.patch('/vagas/:id', async (req, res) => {
  try {
    const { status, role_id, wage } = req.body;
    if (!['contratado', 'recusado', 'demitido'].includes(status)) {
      return res.status(400).json({ erro: 'Status invalido.' });
    }
    const { rows } = await pool.query(
      `UPDATE job_applications SET
         status = $1,
         role_id = COALESCE($2, role_id),
         wage_cents = COALESCE($3, wage_cents)
       WHERE id = $4 RETURNING *`,
      [status, role_id || null, wage !== undefined ? Math.round(Number(wage) * 100) : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Candidatura nao encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar candidatura.' });
  }
});

// jogador se candidata a uma vaga em outra empresa
router.post('/vagas/candidatar', async (req, res) => {
  try {
    const { user_id, company_id, wage } = req.body;
    if (!user_id || !company_id) return res.status(400).json({ erro: 'user_id e company_id sao obrigatorios.' });
    const { rows } = await pool.query(
      `INSERT INTO job_applications (company_id, user_id, skill, wage_cents, status)
       VALUES ($1,$2,60,$3,'pendente') RETURNING *`,
      [company_id, user_id, Math.round(Number(wage || 2000) * 100)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao se candidatar.' });
  }
});

// ---------- 10. SOCIOS ----------
router.get('/socios/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, COALESCE(u.nickname, 'Jogador') AS nickname FROM partnerships s
       JOIN users u ON u.id = s.user_id
       WHERE s.company_id = $1 ORDER BY s.created_at DESC`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar socios.' });
  }
});

// jogador pede sociedade em outra empresa (pelo e-mail do dono)
router.post('/socios/pedir', async (req, res) => {
  try {
    const { user_id, email_alvo, share_pct } = req.body;
    if (!user_id || !email_alvo) return res.status(400).json({ erro: 'Informe o e-mail do dono da empresa.' });

    const alvo = await pool.query(
      'SELECT company_id FROM users WHERE email = $1',
      [String(email_alvo).trim().toLowerCase()]
    );
    if (alvo.rows.length === 0 || !alvo.rows[0].company_id) {
      return res.status(404).json({ erro: 'Nenhum jogador com esse e-mail.' });
    }
    const companyId = alvo.rows[0].company_id;

    const proprio = await pool.query('SELECT company_id FROM users WHERE id = $1', [user_id]);
    if (proprio.rows.length && proprio.rows[0].company_id === companyId) {
      return res.status(400).json({ erro: 'Essa ja e a sua empresa.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO partnerships (company_id, user_id, share_pct, status)
       VALUES ($1,$2,$3,'pendente')
       ON CONFLICT (company_id, user_id) DO UPDATE SET status = 'pendente'
       RETURNING *`,
      [companyId, user_id, Number(share_pct || 25)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao pedir sociedade.' });
  }
});

router.patch('/socios/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['aceito', 'recusado', 'encerrado'].includes(status)) {
      return res.status(400).json({ erro: 'Status invalido.' });
    }
    const { rows } = await pool.query(
      'UPDATE partnerships SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar sociedade.' });
  }
});

module.exports = router;

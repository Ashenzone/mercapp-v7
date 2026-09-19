const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();
const LIMITE_CONTAS_POR_DISPOSITIVO = 3;

// POST /api/auth/login  { email, device_id }
// NAO cria mais empresa automaticamente -- o jogador escolhe entre procurar
// emprego ou pagar pra abrir uma empresa (fluxo novo em onboarding.html).
router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const deviceId = String(req.body.device_id || '').slice(0, 64) || null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail valido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existente = await client.query('SELECT * FROM users WHERE email = $1', [email]);

    if (existente.rows.length > 0) {
      await client.query(
        'UPDATE users SET last_login = now(), device_id = COALESCE($2, device_id) WHERE id = $1',
        [existente.rows[0].id, deviceId]
      );
      await client.query('COMMIT');
      const u = existente.rows[0];
      return res.json({
        id: u.id, email: u.email, nickname: u.nickname,
        company_id: u.company_id, balance_cents: u.balance_cents, novo: false,
      });
    }

    // limite de contas por dispositivo (item 2) -- so vale pra CONTA NOVA
    if (deviceId) {
      const contagem = await client.query(
        'SELECT COUNT(*)::int AS total FROM users WHERE device_id = $1',
        [deviceId]
      );
      if (contagem.rows[0].total >= LIMITE_CONTAS_POR_DISPOSITIVO) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          erro: `Esse dispositivo ja atingiu o limite de ${LIMITE_CONTAS_POR_DISPOSITIVO} contas.`,
        });
      }
    }

    const novo = await client.query(
      `INSERT INTO users (email, device_id, last_login) VALUES ($1,$2,now())
       RETURNING id, email, nickname, company_id, balance_cents`,
      [email, deviceId]
    );
    await client.query('COMMIT');
    res.json({ ...novo.rows[0], novo: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao entrar.' });
  } finally {
    client.release();
  }
});

// PUT /api/auth/nickname -> define/atualiza o nick publico
router.put('/nickname', async (req, res) => {
  try {
    const { user_id, nickname } = req.body;
    const nick = String(nickname || '').trim();
    if (!user_id || !nick) return res.status(400).json({ erro: 'user_id e nickname sao obrigatorios.' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(nick)) {
      return res.status(400).json({ erro: 'O nickname deve ter 3-20 caracteres (letras, numeros, _).' });
    }
    const { rows } = await pool.query(
      'UPDATE users SET nickname = $1 WHERE id = $2 RETURNING id, nickname',
      [nick, user_id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Esse nickname ja esta em uso.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar nickname.' });
  }
});

// GET /api/auth/me/:userId -> estado atual do jogador (pra onboarding/sidebar)
router.get('/me/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, nickname, company_id, balance_cents FROM users WHERE id = $1',
      [req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Usuario nao encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar usuario.' });
  }
});

module.exports = router;

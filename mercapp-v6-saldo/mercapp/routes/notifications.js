const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

router.get('/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE company_id = $1 ORDER BY created_at DESC LIMIT 40',
      [req.params.companyId]
    );
    const naoLidas = rows.filter((n) => !n.is_read).length;
    res.json({ notificacoes: rows, nao_lidas: naoLidas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar notificacoes.' });
  }
});

router.get('/usuario/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40',
      [req.params.userId]
    );
    const naoLidas = rows.filter((n) => !n.is_read).length;
    res.json({ notificacoes: rows, nao_lidas: naoLidas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar notificacoes.' });
  }
});

router.post('/:id/marcar-lida', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao marcar como lida.' });
  }
});

router.post('/marcar-todas', async (req, res) => {
  try {
    const { company_id, user_id } = req.body;
    if (company_id) await pool.query('UPDATE notifications SET is_read = true WHERE company_id = $1', [company_id]);
    if (user_id) await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [user_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao marcar todas.' });
  }
});

module.exports = router;

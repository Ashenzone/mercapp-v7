const express = require('express');
const { pool } = require('../db/pool');
const { rodarCiclo } = require('../simulation/engine');

const router = express.Router();

// GET /api/simulation/status
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM simulation_state WHERE id = true');
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao ler status da simulacao.' });
  }
});

// POST /api/simulation/tick -> forcar ciclo manualmente.
// DESLIGADO por padrao: clicar num botao pra rodar ciclo virava dinheiro de
// graca. O mercado agora anda sozinho a cada 3h (1 dia de jogo = 4h).
// So funciona se DEV_ALLOW_MANUAL_TICK=true estiver configurado.
router.post('/tick', async (req, res) => {
  if (process.env.DEV_ALLOW_MANUAL_TICK !== 'true') {
    return res.status(403).json({ erro: 'O mercado roda sozinho. Ciclo manual desativado.' });
  }
  try {
    const resultado = await rodarCiclo();
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao rodar ciclo de simulacao.' });
  }
});

module.exports = router;

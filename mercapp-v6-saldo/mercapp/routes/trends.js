const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/trends -> lista com nome da categoria
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, c.name AS category_name, c.slug AS category_slug
       FROM trends t LEFT JOIN categories c ON c.id = t.category_id
       ORDER BY t.popularity DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar tendencias.' });
  }
});

// GET /api/trends/events -> eventos de mercado recentes
router.get('/events', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, c.name AS category_name
       FROM market_events e LEFT JOIN categories c ON c.id = e.category_id
       ORDER BY e.created_at DESC LIMIT 30`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar eventos de mercado.' });
  }
});

module.exports = router;

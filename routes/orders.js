const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/orders/empresa/:companyId
router.get('/orders/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, p.name AS product_name
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.company_id = $1
       ORDER BY o.created_at DESC
       LIMIT 200`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar pedidos.' });
  }
});

// GET /api/reviews/empresa/:companyId
router.get('/reviews/empresa/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS product_name
       FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE p.company_id = $1
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar avaliacoes.' });
  }
});

module.exports = router;

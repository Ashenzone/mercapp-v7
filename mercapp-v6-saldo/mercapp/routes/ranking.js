const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/ranking -> varios rankings de uma vez
router.get('/', async (req, res) => {
  try {
    const [faturamento, produtosVendidos, avaliacao] = await Promise.all([
      pool.query(
        `SELECT co.id, co.name, COALESCE(SUM(o.price_cents),0) AS receita_cents, COUNT(o.id) AS vendas
         FROM companies co LEFT JOIN orders o ON o.company_id = co.id
         GROUP BY co.id ORDER BY receita_cents DESC LIMIT 10`
      ),
      pool.query(
        `SELECT id, name, sales_count, company_id FROM products ORDER BY sales_count DESC LIMIT 10`
      ),
      pool.query(
        `SELECT id, name, rating_avg, rating_count FROM products WHERE rating_count >= 3 ORDER BY rating_avg DESC LIMIT 10`
      ),
    ]);

    res.json({
      maior_faturamento: faturamento.rows.map((r) => ({ ...r, receita: Number(r.receita_cents) / 100 })),
      produto_mais_vendido: produtosVendidos.rows,
      melhor_avaliacao: avaliacao.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao calcular ranking.' });
  }
});

module.exports = router;

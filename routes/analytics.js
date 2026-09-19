const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

const PERIODOS = {
  '24h': "interval '24 hours'",
  '7d': "interval '7 days'",
  '30d': "interval '30 days'",
  '90d': "interval '90 days'",
  tudo: null,
};

// GET /api/analytics/empresa/:companyId?periodo=7d
// GET /api/analytics/empresa/:companyId?agrupar=dia_jogo -> serie por dia INTERNO do jogo
router.get('/empresa/:companyId', async (req, res) => {
  try {
    if (req.query.agrupar === 'dia_jogo') {
      const { companyId } = req.params;
      const { rows } = await pool.query(
        `SELECT game_month, game_day_recorded AS game_day, COUNT(*) AS vendas, SUM(price_cents)::bigint AS receita_cents
         FROM orders WHERE company_id = $1 AND game_day_recorded IS NOT NULL
         GROUP BY game_month, game_day_recorded
         ORDER BY game_month, game_day_recorded`,
        [companyId]
      );
      return res.json({
        agrupado_por: 'dia_jogo',
        serie_vendas: rows.map((r) => ({
          dia: `Mes ${r.game_month} · Dia ${r.game_day}`,
          vendas: Number(r.vendas),
          receita: Number(r.receita_cents) / 100,
        })),
      });
    }

    const periodo = PERIODOS.hasOwnProperty(req.query.periodo) ? req.query.periodo : '30d';
    const filtroIntervalo = PERIODOS[periodo];
    const { companyId } = req.params;

    const filtroSql = filtroIntervalo ? `AND created_at >= now() - ${filtroIntervalo}` : '';

    const [vendasPorDia, resumoPedidos, resumoCampanhas, produtos] = await Promise.all([
      pool.query(
        `SELECT date_trunc('day', created_at) AS dia, COUNT(*) AS vendas, SUM(price_cents)::bigint AS receita_cents
         FROM orders WHERE company_id = $1 ${filtroSql}
         GROUP BY 1 ORDER BY 1`,
        [companyId]
      ),
      pool.query(
        `SELECT COUNT(*) AS total_vendas, COALESCE(SUM(price_cents)::bigint,0) AS receita_cents
         FROM orders WHERE company_id = $1 ${filtroSql}`,
        [companyId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(impressions)::bigint,0) AS impressions, COALESCE(SUM(clicks)::bigint,0) AS clicks,
                COALESCE(SUM(spent_cents)::bigint,0) AS spent_cents
         FROM campaigns WHERE company_id = $1`,
        [companyId]
      ),
      pool.query(
        `SELECT p.id, p.name, p.views_count, p.sales_count, p.rating_avg, p.price_cents, p.cost_cents,
                (p.price_cents - p.cost_cents)::bigint * p.sales_count AS lucro_estimado_cents
         FROM products p WHERE p.company_id = $1 ORDER BY p.sales_count DESC`,
        [companyId]
      ),
    ]);

    const camp = resumoCampanhas.rows[0];
    const cliques = Number(camp.clicks) || 0;
    const gastoReais = Number(camp.spent_cents) / 100;
    const vendasCampanhas = Number(resumoPedidos.rows[0].total_vendas) || 0;

    res.json({
      periodo,
      serie_vendas: vendasPorDia.rows.map((r) => ({
        dia: r.dia,
        vendas: Number(r.vendas),
        receita: Number(r.receita_cents) / 100,
      })),
      resumo: {
        total_vendas: Number(resumoPedidos.rows[0].total_vendas),
        receita_total: Number(resumoPedidos.rows[0].receita_cents) / 100,
      },
      trafego_pago: {
        impressoes: Number(camp.impressions),
        cliques,
        gasto: gastoReais,
        cpc: cliques > 0 ? gastoReais / cliques : 0,
        cpa: vendasCampanhas > 0 ? gastoReais / vendasCampanhas : 0,
        ctr: Number(camp.impressions) > 0 ? cliques / Number(camp.impressions) : 0,
        roi: gastoReais > 0 ? ((Number(resumoPedidos.rows[0].receita_cents) / 100) - gastoReais) / gastoReais : 0,
      },
      produtos: produtos.rows.map((p) => ({
        ...p,
        lucro_estimado: Number(p.lucro_estimado_cents) / 100,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao calcular analytics.' });
  }
});

module.exports = router;

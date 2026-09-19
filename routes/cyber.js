const express = require('express');
const { pool } = require('../db/pool');
const { idsEmbaralhados, conferirResposta, puzzleAleatorio, PUZZLES } = require('../simulation/cyberPuzzles');
const { notificarEmpresa } = require('../simulation/notify');

const router = express.Router();

const CUSTO_UPGRADE = { 2: 15000, 3: 40000, 4: 90000, 5: 180000 }; // cents por nivel

// ---------- 12. SEGURANCA DO PRODUTO ----------
router.get('/produtos/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, security_level FROM products WHERE company_id = $1 ORDER BY name',
      [req.params.companyId]
    );
    res.json(rows.map((p) => ({
      ...p,
      custo_proximo_nivel: p.security_level < 5 ? CUSTO_UPGRADE[p.security_level + 1] : null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar produtos.' });
  }
});

router.post('/produtos/:id/upgrade', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prod = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Produto nao encontrado.' });
    }
    const p = prod.rows[0];
    if (p.security_level >= 5) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Esse produto ja esta no nivel maximo de seguranca.' });
    }
    const custo = CUSTO_UPGRADE[p.security_level + 1];

    const empresa = await client.query('SELECT balance_cents FROM companies WHERE id = $1 FOR UPDATE', [p.company_id]);
    if (Number(empresa.rows[0].balance_cents) < custo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Saldo insuficiente para essa melhoria.' });
    }

    await client.query('UPDATE companies SET balance_cents = balance_cents - $1 WHERE id = $2', [custo, p.company_id]);
    const atualizado = await client.query(
      'UPDATE products SET security_level = security_level + 1 WHERE id = $1 RETURNING security_level',
      [p.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, novo_nivel: atualizado.rows[0].security_level });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao melhorar seguranca.' });
  } finally {
    client.release();
  }
});

// ---------- 13. CONTRATAR BOTS DE SEGURANCA ----------
router.get('/bots', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, h.company_id AS contratado_por
       FROM security_bots b LEFT JOIN security_hires h ON h.security_bot_id = b.id
       ORDER BY b.reputation DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar especialistas.' });
  }
});

router.get('/bots/contratados/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id AS hire_id, b.* FROM security_hires h
       JOIN security_bots b ON b.id = h.security_bot_id
       WHERE h.company_id = $1`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar contratados.' });
  }
});

router.post('/bots/:id/contratar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ erro: 'company_id e obrigatorio.' });

    await client.query('BEGIN');
    const bot = await client.query('SELECT * FROM security_bots WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (bot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Especialista nao encontrado.' });
    }
    const jaContratado = await client.query('SELECT 1 FROM security_hires WHERE security_bot_id = $1', [req.params.id]);
    if (jaContratado.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Esse especialista ja trabalha em outra empresa.' });
    }

    await client.query(
      'INSERT INTO security_hires (company_id, security_bot_id) VALUES ($1,$2)',
      [company_id, req.params.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao contratar.' });
  } finally {
    client.release();
  }
});

router.delete('/bots/dispensar/:hireId', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM security_hires WHERE id = $1', [req.params.hireId]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Contrato nao encontrado.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao dispensar.' });
  }
});

// ---------- 11. TENTAR "HACKEAR" PRODUTOS (so dentro da simulacao) ----------
const MAX_TENTATIVAS_POR_DIA = 3;

router.post('/atacar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { attacker_company_id, target_product_id } = req.body;
    if (!attacker_company_id || !target_product_id) {
      return res.status(400).json({ erro: 'Dados incompletos.' });
    }

    await client.query('BEGIN');
    const prod = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [target_product_id]);
    if (prod.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Produto nao encontrado.' });
    }
    const p = prod.rows[0];
    if (p.company_id === attacker_company_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Voce nao pode atacar o proprio produto.' });
    }

    const tentativasHoje = await client.query(
      `SELECT COUNT(*)::int AS total FROM hack_attempts
       WHERE attacker_company_id = $1 AND target_product_id = $2 AND created_at >= now() - interval '24 hours'`,
      [attacker_company_id, target_product_id]
    );
    if (tentativasHoje.rows[0].total >= MAX_TENTATIVAS_POR_DIA) {
      await client.query('ROLLBACK');
      return res.status(429).json({ erro: 'Voce ja tentou o maximo de vezes hoje contra esse produto.' });
    }

    // defesa: nivel de seguranca do produto + reputacao/experiencia dos bots contratados
    const defesa = await client.query(
      `SELECT COALESCE(AVG(b.experience),0) AS exp_media, COALESCE(AVG(b.reputation),0) AS rep_media, COUNT(*)::int AS qtd
       FROM security_hires h JOIN security_bots b ON b.id = h.security_bot_id
       WHERE h.company_id = $1`,
      [p.company_id]
    );
    const def = defesa.rows[0];

    // chance de sucesso do atacante: comeca alta, cai com nivel de seguranca e defesa contratada
    let chanceSucesso = 0.55 - (p.security_level - 1) * 0.09;
    chanceSucesso -= (Number(def.exp_media) / 100) * 0.25;
    chanceSucesso -= Number(def.qtd) * 0.05;
    chanceSucesso = Math.max(0.03, Math.min(0.6, chanceSucesso));

    const sucesso = Math.random() < chanceSucesso;
    const recompensa = sucesso ? Math.round(3000 + Math.random() * 12000) : 0;

    await client.query(
      'INSERT INTO hack_attempts (attacker_company_id, target_product_id, success, reward_cents) VALUES ($1,$2,$3,$4)',
      [attacker_company_id, target_product_id, sucesso, recompensa]
    );
    if (sucesso && recompensa > 0) {
      await client.query('UPDATE companies SET balance_cents = balance_cents + $1 WHERE id = $2', [recompensa, attacker_company_id]);
      await notificarEmpresa(client, p.company_id, 'invasao_sofrida', `Seu produto "${p.name}" sofreu uma tentativa de invasao simulada -- e teve sucesso.`);
    } else {
      await notificarEmpresa(client, p.company_id, 'invasao_bloqueada', `Sua seguranca bloqueou uma tentativa de invasao no produto "${p.name}".`);
    }

    await client.query('COMMIT');
    res.json({
      sucesso,
      recompensa_cents: recompensa,
      relatorio: sucesso ? {
        produto: p.name,
        vendas: p.sales_count,
        visualizacoes: p.views_count,
        avaliacao: Number(p.rating_avg).toFixed(1),
        nivel_seguranca_encontrado: p.security_level,
        mensagem: 'Vulnerabilidade ficticia encontrada -- relatorio liberado pela simulacao.',
      } : { mensagem: 'A seguranca do produto bloqueou a tentativa.' },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ erro: 'Erro ao processar ataque.' });
  } finally {
    client.release();
  }
});

router.get('/ataques/:companyId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.*, p.name AS product_name FROM hack_attempts h
       JOIN products p ON p.id = h.target_product_id
       WHERE h.attacker_company_id = $1 ORDER BY h.created_at DESC LIMIT 30`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar ataques.' });
  }
});

// ---------- 10. MINI-GAME ----------
router.get('/minigame/novo', (req, res) => {
  const puzzle = idsEmbaralhados(puzzleAleatorio());
  res.json(puzzle);
});

router.post('/minigame/resolver', async (req, res) => {
  try {
    const { company_id, puzzle_id, ordem } = req.body;
    if (!company_id || !puzzle_id) return res.status(400).json({ erro: 'Dados incompletos.' });

    const jogadasHoje = await pool.query(
      `SELECT COUNT(*)::int AS total FROM minigame_plays
       WHERE company_id = $1 AND created_at >= now() - interval '6 hours'`,
      [company_id]
    );
    if (jogadasHoje.rows[0].total >= 4) {
      return res.status(429).json({ erro: 'Volte mais tarde para jogar de novo.' });
    }

    const acertou = conferirResposta(puzzle_id, ordem);
    const recompensa = acertou ? PUZZLES[puzzle_id].recompensa_cents : 0;

    await pool.query(
      'INSERT INTO minigame_plays (company_id, puzzle_id, success, reward_cents) VALUES ($1,$2,$3,$4)',
      [company_id, puzzle_id, acertou, recompensa]
    );
    if (acertou) {
      await pool.query('UPDATE companies SET balance_cents = balance_cents + $1 WHERE id = $2', [recompensa, company_id]);
    }

    res.json({ acertou, recompensa_cents: recompensa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao validar o desafio.' });
  }
});

module.exports = router;

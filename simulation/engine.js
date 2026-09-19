const { pool } = require('../db/pool');
const { PERFIS, comentarioAleatorio } = require('./botProfiles');
const { buscarTendenciasReais } = require('./trendsSource');
const { notificarEmpresa } = require('./notify');
const { fecharMes } = require('./economy');
const {
  preencherHierarquiaDeBots, empresasBotsRevisamCandidaturas, botsPedemAfiliacao,
  botsPedemEmprego, afiliadosDivulgam, engajarPostsDoJogador,
} = require('./social');

const PLATFORM_FEE = 0.08; // 8% fica "fora" da economia (evita inflacao descontrolada)
const BOTS_POR_TICK = 120;  // amostra de bots avaliados a cada ciclo
const PRODUTOS_AVALIADOS_POR_BOT = 8; // quantos produtos cada bot compara por ciclo

// --- dificuldade ---
// vender ficou deliberadamente mais dificil: o score minimo pra um bot sequer
// "descobrir" o produto subiu, e a chance de compra foi reduzida a um terco.
const SCORE_MINIMO_DESCOBERTA = 26;
const DIFICULDADE_COMPRA = 0.34;

// --- relogio do jogo ---
// 1 dia de jogo = 4 horas reais. 1 mes de jogo = 7 dias de jogo (28h reais).
const HORAS_REAIS_POR_DIA_DE_JOGO = 4;
const DIAS_POR_MES_DE_JOGO = 7;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// -------------------- 1. TENDENCIAS --------------------
async function atualizarTendencias(client) {
  const { rows: trends } = await client.query('SELECT * FROM trends');
  for (const t of trends) {
    const idadeDias = (Date.now() - new Date(t.created_at).getTime()) / 86400000;
    const cicloVida = idadeDias / t.estimated_duration_days; // 0 -> nasce, 1 -> deveria acabar

    // curva de vida: sobe, atinge pico perto de 0.4-0.6 do ciclo, depois cai
    let alvoMomentum;
    if (cicloVida < 0.4) alvoMomentum = 'subindo';
    else if (cicloVida < 0.7) alvoMomentum = 'pico';
    else if (cicloVida < 1) alvoMomentum = 'caindo';
    else alvoMomentum = 'esgotada';

    let delta;
    if (alvoMomentum === 'subindo') delta = 2 + Math.random() * 4;
    else if (alvoMomentum === 'pico') delta = (Math.random() - 0.5) * 3;
    else if (alvoMomentum === 'caindo') delta = -(2 + Math.random() * 5);
    else delta = -(5 + Math.random() * 5);

    const novaPop = clamp(Number(t.popularity) + delta, 0, 100);
    const historico = Array.isArray(t.history) ? t.history : [];
    historico.push({ t: new Date().toISOString(), popularity: Math.round(novaPop) });
    if (historico.length > 60) historico.shift();

    await client.query(
      `UPDATE trends SET popularity=$1, growth=$2, momentum=$3, history=$4, updated_at=now() WHERE id=$5`,
      [novaPop, Number(delta.toFixed(2)), alvoMomentum, JSON.stringify(historico), t.id]
    );
  }

  // tendencias esgotadas ha muito tempo saem e uma nova nasce em categoria aleatoria
  const esgotadas = trends.filter((t) => {
    const idadeDias = (Date.now() - new Date(t.created_at).getTime()) / 86400000;
    return idadeDias / t.estimated_duration_days > 1.3;
  });
  for (const velha of esgotadas) {
    await client.query('DELETE FROM trends WHERE id = $1', [velha.id]);
    const { rows: cats } = await client.query('SELECT id, name FROM categories ORDER BY random() LIMIT 1');
    if (cats.length) {
      await client.query(
        `INSERT INTO trends (name, category_id, popularity, growth, momentum, estimated_duration_days)
         VALUES ($1,$2,$3,$4,'subindo',$5)`,
        [`Nova onda de ${cats[0].name}`, cats[0].id, 15 + Math.random() * 15, 5, 15 + Math.floor(Math.random() * 30)]
      );
    }
  }
}

// -------------------- 2. EVENTOS DE MERCADO --------------------
async function talvezGerarEvento(client) {
  if (Math.random() > 0.08) return; // ~8% de chance por ciclo

  const { rows: cats } = await client.query('SELECT id, name FROM categories ORDER BY random() LIMIT 1');
  if (!cats.length) return;
  const cat = cats[0];

  const tipos = [
    { type: 'viralizacao', delta: 25, titulo: `Assunto de ${cat.name} viralizou nas redes`, desc: `Um tema de ${cat.name} comecou a receber enorme quantidade de atencao.` },
    { type: 'queda_interesse', delta: -20, titulo: `Interesse por ${cat.name} caiu`, desc: `A procura pelo nicho de ${cat.name} comecou a diminuir.` },
    { type: 'crise', delta: -15, titulo: `Retracao em ${cat.name}`, desc: `A procura por produtos de ${cat.name} caiu temporariamente.` },
    { type: 'evento_global', delta: 18, titulo: `Acontecimento real impacta ${cat.name}`, desc: `Um evento do mundo real aumentou o interesse por ${cat.name}.` },
  ];
  const evento = tipos[Math.floor(Math.random() * tipos.length)];

  await client.query(
    `INSERT INTO market_events (type, title, description, category_id, effect, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '2 days')`,
    [evento.type, evento.titulo, evento.desc, cat.id, JSON.stringify({ popularity_delta: evento.delta })]
  );

  await client.query(
    `UPDATE trends SET popularity = LEAST(100, GREATEST(0, popularity + $1)), updated_at = now() WHERE category_id = $2`,
    [evento.delta, cat.id]
  );
}

// -------------------- 3. CAMPANHAS (TRAFEGO PAGO) --------------------
async function processarCampanhas(client) {
  const { rows: estadoRows } = await client.query('SELECT game_day, game_month FROM simulation_state WHERE id = true');
  const diaAbsolutoAtual = estadoRows[0] ? (estadoRows[0].game_month - 1) * DIAS_POR_MES_DE_JOGO + estadoRows[0].game_day : 1;

  const { rows: campanhas } = await client.query(
    `SELECT c.*, p.price_cents, p.rating_avg, p.status AS product_status, p.name
     FROM campaigns c JOIN products p ON p.id = c.product_id
     WHERE c.status = 'active'`
  );

  for (const c of campanhas) {
    const orcamentoRestante = c.budget_cents - c.spent_cents;
    // duracao agora e contada em DIAS DE JOGO, nao em tempo real --
    // uma campanha de 3 dias comeca e termina no relogio interno mesmo se
    // o jogador ficar off-line no meio (item 22 do briefing).
    const inicioAbsoluto = c.start_game_month
      ? (c.start_game_month - 1) * DIAS_POR_MES_DE_JOGO + c.start_game_day
      : diaAbsolutoAtual;
    const diasCorridos = diaAbsolutoAtual - inicioAbsoluto;
    if (orcamentoRestante <= 0 || diasCorridos >= c.duration_days || c.product_status !== 'active') {
      await client.query('UPDATE campaigns SET status = \'finished\' WHERE id = $1', [c.id]);
      await notificarEmpresa(client, c.company_id, 'campanha_terminou', `Sua campanha do produto "${c.name || c.product_id}" terminou.`);
      continue;
    }

    // gasta uma fatia do orcamento por ciclo (simula ritmo de veiculacao)
    const gastoCiclo = Math.min(orcamentoRestante, Math.round(c.budget_cents / (c.duration_days * 6)) || 100);
    const cpm = 1500; // custo estimado por 1000 impressoes, em centavos
    const impressoes = Math.round((gastoCiclo / cpm) * 1000);
    const ctrBase = 0.02 + (Number(c.rating_avg) / 5) * 0.03; // produtos melhor avaliados clicam mais
    const cliques = Math.round(impressoes * ctrBase);

    await client.query(
      `UPDATE campaigns SET spent_cents = spent_cents + $1, impressions = impressions + $2, clicks = clicks + $3 WHERE id = $4`,
      [gastoCiclo, impressoes, cliques, c.id]
    );
    await client.query('UPDATE products SET views_count = views_count + $1 WHERE id = $2', [cliques, c.product_id]);
    // o orcamento ja foi debitado do saldo da empresa na criacao da campanha (evita inflacao);
    // aqui so controlamos o ritmo de veiculacao e as metricas (impressions/clicks/spent_cents)
  }
}

// -------------------- 4. BOTS: DESCOBERTA, COMPRA E AVALIACAO --------------------
function pontuarProduto(bot, produto, tendenciaPop) {
  const perfil = PERFIS[bot.profile] || PERFIS.curioso;
  let score = 10;

  // relevancia de tendencia (0-100 -> 0-1)
  score += (tendenciaPop / 100) * 40 * perfil.peso_tendencia;

  // preco: quanto mais caro em RELACAO AO ORCAMENTO do bot, mais penaliza --
  // sem teto artificial, um produto de R$100.000 agora fica praticamente
  // impossivel de ser "descoberto" como relevante, nao so impossivel de comprar.
  const precoReais = produto.price_cents / 100;
  const orcamentoReais = Number(bot.budget_cents) / 100;
  const razaoPreco = precoReais / Math.max(1, orcamentoReais); // 0 = de graca, 1 = todo o orcamento
  score -= Math.min(80, razaoPreco * 60) * perfil.peso_preco;
  if (razaoPreco > 1) score -= 40; // nem de longe cabe no bolso -- praticamente descarta

  // avaliacao
  score += Number(produto.rating_avg) * 6 * perfil.peso_avaliacao;
  if (perfil.rating_minimo && Number(produto.rating_avg) > 0 && Number(produto.rating_avg) < perfil.rating_minimo) {
    score -= 25; // exigente descarta produto mal avaliado
  }
  if (perfil.peso_volume_avaliacoes) {
    score += Math.min(20, produto.rating_count) * perfil.peso_volume_avaliacoes;
  }

  // fidelidade
  if (perfil.bonus_empresa_fidelizada && bot.loyalty_company_id === produto.company_id) {
    score += perfil.bonus_empresa_fidelizada * 40;
  }

  // novidade
  if (perfil.bonus_produto_novo) {
    const idadeDias = (Date.now() - new Date(produto.created_at).getTime()) / 86400000;
    if (idadeDias < 5) score += perfil.bonus_produto_novo * 30;
  }

  // categoria favorita puxa exploracao
  if (bot.favorite_category_id === produto.category_id) score += 15;
  else score *= (0.4 + perfil.exploracao * 0.6); // fora do nicho, exploracao decide o quanto ainda interessa

  return Math.max(0, score);
}

async function rodarBots(client) {
  const { rows: estadoRows } = await client.query('SELECT game_day, game_month FROM simulation_state WHERE id = true');
  const estadoJogo = estadoRows[0] || { game_day: 1, game_month: 1 };

  const { rows: produtos } = await client.query(
    `SELECT p.id, p.company_id, p.category_id, p.price_cents, p.rating_avg,
            p.rating_count, p.stock_quantity, p.created_at, p.currency_code
     FROM products p
     WHERE p.status = 'active' AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)`
  );
  if (produtos.length === 0) return { visitas: 0, compras: 0, avaliacoes: 0 };

  const { rows: tendencias } = await client.query('SELECT category_id, popularity FROM trends');
  const popPorCategoria = new Map(tendencias.map((t) => [t.category_id, Number(t.popularity)]));

  const { rows: bots } = await client.query('SELECT * FROM bots ORDER BY random() LIMIT $1', [BOTS_POR_TICK]);

  // bonus de desempenho por empresa: funcionarios contratados (skill + cargo)
  // e moveis de escritorio aumentam levemente a chance de conversao.
  const { rows: bonusRows } = await client.query(
    `SELECT c.id,
            COALESCE((SELECT SUM(j.skill) FROM job_applications j
                      WHERE j.company_id = c.id AND j.status = 'contratado'), 0) AS skill_total,
            COALESCE((SELECT SUM(f.productivity_pct) FROM owned_furniture o
                      JOIN furniture_catalog f ON f.id = o.furniture_id
                      WHERE o.company_id = c.id), 0) AS produtividade
     FROM companies c`
  );
  const bonusPorEmpresa = new Map(
    bonusRows.map((r) => [r.id, 1 + (Number(r.skill_total) / 1000) + (Number(r.produtividade) / 100)])
  );

  // cambio e imposto por moeda (produto vendido em moeda estrangeira)
  const { rows: moedas } = await client.query('SELECT code, rate_to_brl, import_tax_pct, demand_factor FROM currencies');
  const cambio = new Map(moedas.map((m) => [m.code, m]));

  // OTIMIZACAO: em vez de rodar queries dentro do laco (uma por visita, uma por
  // compra, uma por avaliacao), acumulamos tudo em memoria e gravamos em poucas
  // queries em lote no final. Isso derruba o numero de idas ao banco por ciclo
  // de centenas para menos de dez.
  const viewsPorProduto = new Map();   // produto -> qtd de visitas
  const pedidos = [];                  // {produtoId, companyId, botId, priceCents}
  const avaliacoesPend = [];           // {produtoId, botId, rating, comentario}

  for (const bot of bots) {
    const candidatos = [];
    for (let i = 0; i < PRODUTOS_AVALIADOS_POR_BOT; i++) {
      candidatos.push(produtos[Math.floor(Math.random() * produtos.length)]);
    }

    let melhor = null, melhorScore = -1;
    for (const p of candidatos) {
      const pop = popPorCategoria.get(p.category_id) || 20;
      const score = pontuarProduto(bot, p, pop);
      if (score > melhorScore) { melhorScore = score; melhor = p; }
    }
    if (!melhor || melhorScore < SCORE_MINIMO_DESCOBERTA) continue;

    viewsPorProduto.set(melhor.id, (viewsPorProduto.get(melhor.id) || 0) + 1);

    const perfil = PERFIS[bot.profile] || PERFIS.curioso;
    const bonus = bonusPorEmpresa.get(melhor.company_id) || 1;
    const moeda = cambio.get(melhor.currency_code) || { rate_to_brl: 1, import_tax_pct: 0, demand_factor: 1 };
    const probCompra = clamp(
      perfil.prob_compra_base * (melhorScore / 40) * DIFICULDADE_COMPRA * bonus * Number(moeda.demand_factor),
      0.002, 0.28
    );
    if (Math.random() > probCompra) continue;

    // preco convertido pra BRL (o bot raciocina em BRL)
    const precoBrl = Math.round(melhor.price_cents * Number(moeda.rate_to_brl));
    if (precoBrl > bot.budget_cents) continue;

    // vender la fora paga imposto do mercado de destino
    const imposto = Math.round(precoBrl * Number(moeda.import_tax_pct) / 100);

    pedidos.push({
      produtoId: melhor.id,
      companyId: melhor.company_id,
      botId: bot.id,
      priceCents: precoBrl,
      moeda: melhor.currency_code || 'BRL',
      impostoCents: imposto,
    });

    if (Math.random() < 0.5) {
      const ratingBase = melhor.rating_count > 0 ? Number(melhor.rating_avg) : 3.5;
      const rating = Math.round(clamp(ratingBase + (Math.random() - 0.5) * 2, 1, 5));
      avaliacoesPend.push({
        produtoId: melhor.id,
        botId: bot.id,
        rating,
        comentario: comentarioAleatorio(rating),
      });
    }
  }

  // ---------- gravacao em lote, numa transacao so ----------
  await client.query('BEGIN');
  try {
    if (viewsPorProduto.size > 0) {
      const ids = [...viewsPorProduto.keys()];
      const qtds = ids.map((id) => viewsPorProduto.get(id));
      await client.query(
        `UPDATE products p SET views_count = p.views_count + v.qtd
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS qtd) v
         WHERE p.id = v.id`,
        [ids, qtds]
      );
    }

    if (pedidos.length > 0) {
      await client.query(
        `INSERT INTO orders (product_id, company_id, bot_id, price_cents, source, currency_code, tax_cents, game_day_recorded, game_month_recorded)
         SELECT product_id, company_id, bot_id, price_cents, 'organico', currency_code, tax_cents, $7, $8
         FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::int[], $5::varchar[], $6::int[])
           AS t(product_id, company_id, bot_id, price_cents, currency_code, tax_cents)`,
        [
          pedidos.map((p) => p.produtoId),
          pedidos.map((p) => p.companyId),
          pedidos.map((p) => p.botId),
          pedidos.map((p) => p.priceCents),
          pedidos.map((p) => p.moeda),
          pedidos.map((p) => p.impostoCents),
          estadoJogo.game_day,
          estadoJogo.game_month,
        ]
      );

      // vendas por produto (contador + estoque)
      const vendasPorProduto = new Map();
      for (const p of pedidos) vendasPorProduto.set(p.produtoId, (vendasPorProduto.get(p.produtoId) || 0) + 1);
      await client.query(
        `UPDATE products p SET
           sales_count = p.sales_count + v.qtd,
           stock_quantity = CASE WHEN p.stock_quantity IS NULL THEN NULL
                                 ELSE GREATEST(0, p.stock_quantity - v.qtd) END
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS qtd) v
         WHERE p.id = v.id`,
        [[...vendasPorProduto.keys()], [...vendasPorProduto.values()]]
      );

      // receita liquida por empresa
      const receitaPorEmpresa = new Map();
      for (const p of pedidos) {
        const liquido = Math.round(p.priceCents * (1 - PLATFORM_FEE)) - p.impostoCents;
        receitaPorEmpresa.set(p.companyId, (receitaPorEmpresa.get(p.companyId) || 0) + liquido);
      }
      await client.query(
        `UPDATE companies c SET balance_cents = c.balance_cents + v.valor
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::bigint[]) AS valor) v
         WHERE c.id = v.id`,
        [[...receitaPorEmpresa.keys()], [...receitaPorEmpresa.values()]]
      );
    }

    if (avaliacoesPend.length > 0) {
      await client.query(
        `INSERT INTO reviews (product_id, bot_id, rating, comment)
         SELECT product_id, bot_id, rating, comment
         FROM unnest($1::uuid[], $2::int[], $3::int[], $4::text[])
           AS t(product_id, bot_id, rating, comment)`,
        [
          avaliacoesPend.map((a) => a.produtoId),
          avaliacoesPend.map((a) => a.botId),
          avaliacoesPend.map((a) => a.rating),
          avaliacoesPend.map((a) => a.comentario),
        ]
      );

      // recalcula media a partir da tabela de reviews (mais preciso que media incremental)
      const produtosAvaliados = [...new Set(avaliacoesPend.map((a) => a.produtoId))];
      await client.query(
        `UPDATE products p SET
           rating_avg = sub.media,
           rating_count = sub.total
         FROM (
           SELECT product_id, AVG(rating)::numeric(3,2) AS media, COUNT(*)::int AS total
           FROM reviews WHERE product_id = ANY($1::uuid[]) GROUP BY product_id
         ) sub
         WHERE p.id = sub.product_id`,
        [produtosAvaliados]
      );

      await client.query(
        `UPDATE companies c SET reputation = COALESCE(sub.media, 0)
         FROM (
           SELECT company_id, AVG(rating_avg) AS media FROM products
           WHERE rating_count > 0 GROUP BY company_id
         ) sub
         WHERE c.id = sub.company_id`
      );

      // notifica os vendedores que receberam avaliacao nesse ciclo
      const empresasAvisadas = new Set();
      for (const a of avaliacoesPend) {
        const prod = produtos.find((p) => p.id === a.produtoId);
        if (prod && !empresasAvisadas.has(prod.company_id)) {
          empresasAvisadas.add(prod.company_id);
          await notificarEmpresa(client, prod.company_id, 'avaliacao_recebida', `Seu produto recebeu uma nova avaliacao.`);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao gravar ciclo de bots:', err.message);
    return { visitas: 0, compras: 0, avaliacoes: 0 };
  }

  return { visitas: viewsPorProduto.size, compras: pedidos.length, avaliacoes: avaliacoesPend.length };
}

// -------------------- RELOGIO DO JOGO --------------------
// 1 dia de jogo = 4 horas reais; 1 mes de jogo = 7 dias de jogo.
async function avancarRelogio(client) {
  const { rows } = await client.query('SELECT game_day, game_month, last_day_advance FROM simulation_state WHERE id = true');
  const estado = rows[0];
  if (!estado) return null;

  const ultima = estado.last_day_advance ? new Date(estado.last_day_advance).getTime() : 0;
  const horas = (Date.now() - ultima) / 36e5;
  if (ultima && horas < HORAS_REAIS_POR_DIA_DE_JOGO) return null; // ainda e o mesmo dia de jogo

  let dia = estado.game_day + 1;
  let mes = estado.game_month;
  let virouMes = false;
  if (dia > DIAS_POR_MES_DE_JOGO) { dia = 1; mes += 1; virouMes = true; }

  await client.query(
    'UPDATE simulation_state SET game_day = $1, game_month = $2, last_day_advance = now() WHERE id = true',
    [dia, mes]
  );
  return { dia, mes, virouMes };
}

// -------------------- CONCORRENTES (EMPRESAS DE BOTS) --------------------
const NOMES_PRODUTO = [
  'Guia Definitivo', 'Metodo Pratico', 'Pack Completo', 'Masterclass',
  'Kit Profissional', 'Formula', 'Blueprint', 'Manual Avancado',
  'Curso Intensivo', 'Template Pro', 'Checklist', 'Sistema',
];

// cada estrategia define preco e ritmo de lancamento de forma diferente,
// entao um concorrente pode se sair melhor que o outro conforme o mercado muda.
const ESTRATEGIAS = {
  agressiva: { chanceLancar: 0.30, precoMin: 1900,  precoMax: 6900,  margem: 0.55 },
  premium:   { chanceLancar: 0.10, precoMin: 19900, precoMax: 59900, margem: 0.75 },
  volume:    { chanceLancar: 0.40, precoMin: 900,   precoMax: 3900,  margem: 0.45 },
  nicho:     { chanceLancar: 0.15, precoMin: 7900,  precoMax: 24900, margem: 0.65 },
};

async function concorrentesAgem(client) {
  const { rows: empresas } = await client.query(
    'SELECT id, name, strategy FROM companies WHERE is_bot = true'
  );
  if (empresas.length === 0) return;

  // concorrente lanca produto no que esta em alta -- quem ler melhor a
  // tendencia vende mais, igual ao jogador.
  const { rows: tendencias } = await client.query(
    'SELECT category_id, popularity FROM trends ORDER BY popularity DESC LIMIT 5'
  );
  if (tendencias.length === 0) return;

  for (const empresa of empresas) {
    const est = ESTRATEGIAS[empresa.strategy] || ESTRATEGIAS.volume;
    if (Math.random() > est.chanceLancar) continue;

    // limite de catalogo pra nao inflar o marketplace infinitamente
    const { rows: cont } = await client.query(
      "SELECT COUNT(*)::int AS total FROM products WHERE company_id = $1 AND status = 'active'",
      [empresa.id]
    );
    if (cont[0].total >= 12) continue;

    const tend = tendencias[Math.floor(Math.random() * tendencias.length)];
    const { rows: cat } = await client.query('SELECT name FROM categories WHERE id = $1', [tend.category_id]);
    const nomeCat = cat[0] ? cat[0].name : 'Geral';
    const titulo = `${NOMES_PRODUTO[Math.floor(Math.random() * NOMES_PRODUTO.length)]} de ${nomeCat}`;
    const preco = Math.round(est.precoMin + Math.random() * (est.precoMax - est.precoMin));
    const custo = Math.round(preco * (1 - est.margem));

    await client.query(
      `INSERT INTO products (company_id, name, category_id, description, product_type,
                             niche, price_cents, cost_cents, status)
       VALUES ($1,$2,$3,$4,'curso',$5,$6,$7,'active')`,
      [empresa.id, titulo, tend.category_id,
       `Produto de ${nomeCat} lancado por ${empresa.name}.`, nomeCat.toLowerCase(), preco, custo]
    );
  }
}

// -------------------- ORQUESTRACAO --------------------
async function rodarCiclo() {
  const client = await pool.connect();
  let resultado = {};
  try {
    const relogio = await avancarRelogio(client);
    await atualizarTendencias(client);
    await talvezGerarEvento(client);
    await concorrentesAgem(client);
    await processarCampanhas(client);
    resultado = await rodarBots(client);

    // camada social: candidaturas, afiliacao/emprego, divulgacao e engajamento
    await preencherHierarquiaDeBots(client);
    await empresasBotsRevisamCandidaturas(client);
    await botsPedemAfiliacao(client);
    await botsPedemEmprego(client);
    resultado.afiliados = await afiliadosDivulgam(client);
    await engajarPostsDoJogador(client);

    if (relogio) {
      resultado.relogio = relogio;
      // virou o mes no jogo -> gera contas, folha e impostos
      if (relogio.virouMes) {
        await fecharMes(client, relogio.mes);
        resultado.fechou_mes = relogio.mes;
      }
    }
    await client.query(
      `UPDATE simulation_state SET tick_count = tick_count + 1, last_tick = now() WHERE id = true`
    );
  } finally {
    client.release();
  }

  // busca de tendencias reais roda fora da transacao principal e nunca derruba o ciclo
  buscarTendenciasReais().catch(() => {});

  return resultado;
}

let intervalId = null;
function iniciarLoopDeSimulacao(intervaloMs = 3 * 60 * 60 * 1000) {
  if (intervalId) return;
  intervalId = setInterval(() => {
    rodarCiclo().catch((err) => console.error('Erro no ciclo de simulacao:', err));
  }, intervaloMs);
  console.log(`Motor de simulacao rodando a cada ${(intervaloMs / 3600000).toFixed(2)}h.`);
}

module.exports = { rodarCiclo, iniciarLoopDeSimulacao };

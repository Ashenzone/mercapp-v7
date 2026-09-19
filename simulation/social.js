// Camada "social" da simulacao: bots pedem pra se afiliar, pedem emprego,
// e publicam no MarketChat. Tudo probabilistico e ligado ao que ja existe
// (reputacao da empresa, tendencias, produtos ativos).

const { notificarEmpresa } = require('./notify');

const TEXTOS_DIVULGACAO = [
  'Testei esse aqui e virou meu queridinho. Link na bio!',
  'Gente, esse produto salvou minha semana. Recomendo muito.',
  'Se voce ta procurando isso ha tempo, e esse aqui.',
  'Comprei, testei e aprovei. Vale cada centavo.',
  'Achei essa joia no marketplace hoje, olha isso.',
  'Voces pediram indicacao, ta aqui. Nao me agradecam.',
  'Esse aqui ta bombando e eu entendo o porque.',
  'Usei por uma semana e ja vi resultado.',
];

const COMENTARIOS_POST = [
  'Vou dar uma olhada!', 'Parece bom mesmo.', 'Ja comprei, recomendo.',
  'Quanto ta custando?', 'Melhor que os concorrentes?', 'Salvando pra depois.',
  'Ja tava de olho nesse.', 'Vale a pena mesmo?', 'Comprei ontem, chegou certinho.',
  'Achei caro, sinceramente.', 'Top demais!', 'Alguem mais testou?',
];

// ---------- 8. HIERARQUIA DAS EMPRESAS-BOT (diretores/gerentes) ----------
async function preencherHierarquiaDeBots(client) {
  const { rows: vagas } = await client.query(
    `SELECT r.id AS role_id, r.company_id, r.salary_cents, r.title
     FROM roles r
     JOIN companies c ON c.id = r.company_id
     WHERE c.is_bot = true
       AND NOT EXISTS (
         SELECT 1 FROM job_applications j
         WHERE j.role_id = r.id AND j.status = 'contratado'
       )
     LIMIT 5`
  );

  for (const vaga of vagas) {
    const { rows: bot } = await client.query(
      `SELECT id FROM bots WHERE id NOT IN (
         SELECT bot_id FROM job_applications WHERE bot_id IS NOT NULL AND status = 'contratado'
       ) ORDER BY random() LIMIT 1`
    );
    if (bot.length === 0) continue;

    await client.query(
      `INSERT INTO job_applications (company_id, bot_id, role_id, skill, wage_cents, status)
       VALUES ($1,$2,$3,$4,$5,'contratado')`,
      [vaga.company_id, bot[0].id, vaga.role_id, 60 + Math.floor(Math.random() * 40), vaga.salary_cents]
    );
  }
}

// ---------- 15/16. BOT DECIDE SOBRE UMA OFERTA DE COMISSAO ----------
// Chamada quando o VENDEDOR propoe/atualiza a comissao de um pedido de
// afiliacao pendente. O bot nao aceita tudo -- decide com base em quao boa
// e a oferta pra ele E quao bom e o produto pra ele promover.
function decidirOfertaAfiliado({ ofertaPct, produto }) {
  // "valor justo" pro bot depende do quao vendavel o produto parece:
  // produto bom (nota alta, ja vende bem) aceita comissao menor;
  // produto fraco ou caro exige comissao maior pra compensar o esforco.
  const qualidade = Number(produto.rating_avg || 3) / 5;               // 0-1
  const tracao = Math.min(1, Number(produto.sales_count || 0) / 50);   // 0-1
  const dificuldade = 1 - (qualidade * 0.6 + tracao * 0.4);            // 0-1, mais dificil = quer mais %

  const pctJusto = 12 + dificuldade * 35; // entre ~12% (produto otimo) e ~47% (produto dificil)
  const razao = ofertaPct / pctJusto;

  if (razao >= 0.95) {
    return { decisao: 'aceito' };
  }
  if (razao >= 0.55 && Math.random() < 0.7) {
    // contraproposta -- pede um valor entre a oferta e o "justo"
    const contra = Math.round(ofertaPct + (pctJusto - ofertaPct) * (0.5 + Math.random() * 0.4));
    return { decisao: 'negociando', proposta_pct: Math.min(70, contra) };
  }
  // oferta muito baixa -- ainda assim, ALGUNS bots aceitam por outros motivos
  // (curiosidade, querem construir historico) mesmo perto de 0%
  if (Math.random() < 0.12) return { decisao: 'aceito' };
  return { decisao: 'recusado' };
}

// ---------- 6/7. EMPRESAS-BOT RESPONDEM CANDIDATURAS DE JOGADORES ----------
async function empresasBotsRevisamCandidaturas(client) {
  const { rows: pendentes } = await client.query(
    `SELECT j.*, c.reputation FROM job_applications j
     JOIN companies c ON c.id = j.company_id
     WHERE c.is_bot = true AND j.status = 'pendente' AND j.user_id IS NOT NULL`
  );

  for (const cand of pendentes) {
    // decisao baseada em salario pedido vs "razoabilidade" pra reputacao da
    // empresa -- nao aceita qualquer proposta, e nao recusa tudo tambem.
    const tetoRazoavel = 150000 + Number(cand.reputation) * 60000; // R$1.500 + bonus por reputacao
    const razao = cand.wage_cents / tetoRazoavel;

    if (razao <= 0.9) {
      await client.query("UPDATE job_applications SET status = 'contratado' WHERE id = $1", [cand.id]);
    } else if (razao <= 1.4 && Math.random() < 0.5) {
      // contraproposta: empresa oferece um valor mais baixo, candidato decide depois
      const contraproposta = Math.round(tetoRazoavel * (0.85 + Math.random() * 0.1));
      await client.query('UPDATE job_applications SET wage_cents = $1 WHERE id = $2', [contraproposta, cand.id]);
    } else if (Math.random() < 0.6) {
      await client.query("UPDATE job_applications SET status = 'recusado' WHERE id = $1", [cand.id]);
    }
    // caso restante: fica pendente pra proxima rodada (empresa "ainda avaliando")
  }
}

// ---------- BOTS PEDEM AFILIACAO ----------
async function botsPedemAfiliacao(client) {
  if (Math.random() > 0.35) return;

  const { rows: produtos } = await client.query(
    `SELECT p.id, p.company_id, p.name, p.rating_avg
     FROM products p JOIN companies c ON c.id = p.company_id
     WHERE p.status = 'active' AND c.is_bot = false AND p.rating_avg >= 3
     ORDER BY random() LIMIT 2`
  );
  if (produtos.length === 0) return;

  for (const produto of produtos) {
    const { rows: bots } = await client.query(
      `SELECT id, name FROM bots WHERE id NOT IN (
         SELECT bot_id FROM affiliates WHERE product_id = $1 AND bot_id IS NOT NULL
       ) ORDER BY random() LIMIT 1`,
      [produto.id]
    );
    if (bots.length === 0) continue;

    // afiliado com mais alcance costuma pedir comissao maior
    const alcance = 200 + Math.floor(Math.random() * 4800);
    const comissao = Math.min(60, 15 + Math.round(alcance / 200));

    await client.query(
      `INSERT INTO affiliates (company_id, bot_id, product_id, commission_pct, reach, status)
       VALUES ($1,$2,$3,$4,$5,'pendente')`,
      [produto.company_id, bots[0].id, produto.id, comissao, alcance]
    );
    await notificarEmpresa(client, produto.company_id, 'afiliado_pediu',
      `${bots[0].name || 'Um afiliado'} quer divulgar "${produto.name}" pedindo ${comissao}% de comissao.`);
  }
}

// ---------- 11. BOTS PEDEM EMPREGO ----------
const NOMES_CANDIDATOS = [
  'Rafa', 'Bia', 'Caio', 'Duda', 'Enzo', 'Fefe', 'Gabi', 'Hugo',
  'Ian', 'Ju', 'Kau', 'Lia', 'Theo', 'Nina', 'Ovi', 'Pedro',
];

async function botsPedemEmprego(client) {
  if (Math.random() > 0.3) return;

  const { rows: empresas } = await client.query(
    `SELECT c.id FROM companies c
     WHERE c.is_bot = false
       AND (SELECT COUNT(*) FROM job_applications j
            WHERE j.company_id = c.id AND j.status = 'pendente') < 6
     ORDER BY random() LIMIT 3`
  );

  for (const empresa of empresas) {
    const { rows: bots } = await client.query(
      `SELECT id FROM bots WHERE id NOT IN (
         SELECT bot_id FROM job_applications
         WHERE company_id = $1 AND bot_id IS NOT NULL AND status IN ('pendente','contratado')
       ) ORDER BY random() LIMIT 1`,
      [empresa.id]
    );
    if (bots.length === 0) continue;

    const skill = 20 + Math.floor(Math.random() * 80);
    // candidato mais habilidoso pede salario maior
    const salario = Math.round(90000 + skill * 3500 + Math.random() * 60000);

    // se a empresa ja criou cargos, o candidato se aplica a um deles
    const { rows: cargos } = await client.query(
      'SELECT id FROM roles WHERE company_id = $1 ORDER BY random() LIMIT 1',
      [empresa.id]
    );

    await client.query(
      `INSERT INTO job_applications (company_id, bot_id, role_id, skill, wage_cents, status)
       VALUES ($1,$2,$3,$4,$5,'pendente')`,
      [empresa.id, bots[0].id, cargos.length ? cargos[0].id : null, skill, salario]
    );
  }
}

// ---------- 7. AFILIADOS DIVULGAM NO MARKETCHAT E GERAM VENDAS ----------
async function afiliadosDivulgam(client) {
  const { rows: ativos } = await client.query(
    `SELECT a.id, a.bot_id, a.product_id, a.company_id, a.commission_pct, a.reach,
            p.name AS product_name, p.price_cents, p.rating_avg, p.currency_code,
            b.name AS bot_name
     FROM affiliates a
     JOIN products p ON p.id = a.product_id
     LEFT JOIN bots b ON b.id = a.bot_id
     WHERE a.status = 'ativo' AND p.status = 'active'`
  );
  if (ativos.length === 0) return { posts: 0, vendas: 0 };

  let posts = 0, vendas = 0;

  for (const af of ativos) {
    if (Math.random() > 0.45) continue; // nem todo afiliado posta todo ciclo

    const texto = TEXTOS_DIVULGACAO[Math.floor(Math.random() * TEXTOS_DIVULGACAO.length)];
    const alcanceReal = Math.round(af.reach * (0.5 + Math.random()));
    const cliques = Math.round(alcanceReal * (0.02 + Math.random() * 0.04));

    const post = await client.query(
      `INSERT INTO posts (company_id, bot_id, product_id, affiliate_id, content, kind, reach, clicks, likes)
       VALUES ($1,$2,$3,$4,$5,'afiliado',$6,$7,$8) RETURNING id`,
      [af.company_id, af.bot_id, af.product_id, af.id,
       `${texto} — ${af.product_name}`, alcanceReal, cliques,
       Math.round(alcanceReal * (0.03 + Math.random() * 0.08))]
    );
    posts++;

    // alguns comentarios de bots no post
    const qtdComentarios = Math.floor(Math.random() * 3);
    for (let i = 0; i < qtdComentarios; i++) {
      const { rows: comentarista } = await client.query('SELECT id FROM bots ORDER BY random() LIMIT 1');
      if (comentarista.length) {
        await client.query(
          'INSERT INTO post_comments (post_id, bot_id, content) VALUES ($1,$2,$3)',
          [post.rows[0].id, comentarista[0].id,
           COMENTARIOS_POST[Math.floor(Math.random() * COMENTARIOS_POST.length)]]
        );
      }
    }

    // conversao do trafego de afiliado (mais dificil que trafego pago,
    // mas so paga comissao se vender -- risco zero pro vendedor)
    const conversao = 0.02 + (Number(af.rating_avg) / 5) * 0.05;
    const vendasGeradas = Math.floor(cliques * conversao * Math.random());
    if (vendasGeradas <= 0) continue;

    const comissaoUnit = Math.round(af.price_cents * (Number(af.commission_pct) / 100));
    const liquidoUnit = af.price_cents - comissaoUnit;

    for (let i = 0; i < vendasGeradas; i++) {
      await client.query(
        `INSERT INTO orders (product_id, company_id, bot_id, affiliate_id, price_cents, source, currency_code)
         VALUES ($1,$2,$3,$4,$5,'afiliado',$6)`,
        [af.product_id, af.company_id, af.bot_id, af.id, af.price_cents, af.currency_code || 'BRL']
      );
    }

    await client.query(
      'UPDATE products SET sales_count = sales_count + $1, views_count = views_count + $2 WHERE id = $3',
      [vendasGeradas, cliques, af.product_id]
    );
    await client.query(
      'UPDATE companies SET balance_cents = balance_cents + $1 WHERE id = $2',
      [liquidoUnit * vendasGeradas, af.company_id]
    );
    await client.query(
      `UPDATE affiliates SET sales_count = sales_count + $1, earned_cents = earned_cents + $2 WHERE id = $3`,
      [vendasGeradas, comissaoUnit * vendasGeradas, af.id]
    );

    vendas += vendasGeradas;
  }

  return { posts, vendas };
}

// ---------- ENGAJAMENTO NOS POSTS DO JOGADOR ----------
async function engajarPostsDoJogador(client) {
  const { rows: posts } = await client.query(
    `SELECT id, reach FROM posts
     WHERE bot_id IS NULL AND created_at >= now() - interval '2 days'
     ORDER BY created_at DESC LIMIT 10`
  );

  for (const post of posts) {
    const novosLikes = Math.floor(Math.random() * 25);
    const novoAlcance = Math.floor(Math.random() * 400);
    await client.query(
      'UPDATE posts SET likes = likes + $1, reach = reach + $2 WHERE id = $3',
      [novosLikes, novoAlcance, post.id]
    );

    if (Math.random() < 0.4) {
      const { rows: bot } = await client.query('SELECT id FROM bots ORDER BY random() LIMIT 1');
      if (bot.length) {
        await client.query(
          'INSERT INTO post_comments (post_id, bot_id, content) VALUES ($1,$2,$3)',
          [post.id, bot[0].id, COMENTARIOS_POST[Math.floor(Math.random() * COMENTARIOS_POST.length)]]
        );
      }
    }
  }
}

module.exports = {
  preencherHierarquiaDeBots,
  decidirOfertaAfiliado,
  empresasBotsRevisamCandidaturas,
  botsPedemAfiliacao,
  botsPedemEmprego,
  afiliadosDivulgam,
  engajarPostsDoJogador,
  TEXTOS_DIVULGACAO,
};

// FASE 4: integracao com tendencias reais.
//
// Fonte usada: API publica de pageviews da Wikipedia (nao exige chave de API).
// https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/{ano}/{mes}/{dia}
//
// Isso e so um PROXY de "o que esta em alta no mundo" -- nao e um servico de
// tendencias de mercado de verdade, mas cumpre o papel pedido no briefing:
// buscar dados publicos reais e transformar em variaveis da simulacao, sem
// nunca deixar a fonte externa alterar o saldo dos jogadores diretamente.
//
// Se a fonte externa falhar (sem internet, fora do ar, rate limit etc.),
// a simulacao continua normalmente com as tendencias "seed" existentes --
// isso nunca deve derrubar o motor do jogo.

const { pool } = require('../db/pool');

const CACHE_HORAS = 6; // nao busca de novo antes desse intervalo

// mapeamento heuristico de palavras-chave do titulo -> categoria da simulacao
const MAPA_CATEGORIA = [
  [/\b(ai|gpt|intelligence|openai|chatbot)\b/i, 'ia'],
  [/\b(game|gaming|playstation|xbox|nintendo)\b/i, 'games'],
  [/\b(iphone|android|tech|software|app|chip|nvidia|apple|google|microsoft)\b/i, 'tecnologia'],
  [/\b(fitness|gym|workout|diet|nutrition)\b/i, 'fitness'],
  [/\b(school|university|exam|course|education)\b/i, 'educacao'],
  [/\b(stock|market|crypto|bitcoin|economy|finance|bank)\b/i, 'financas'],
  [/\b(python|javascript|programming|developer|code)\b/i, 'programacao'],
  [/\b(instagram|tiktok|twitter|facebook|social)\b/i, 'redes-sociais'],
  [/\b(marketing|ads|advertising|brand)\b/i, 'marketing-digital'],
  [/\b(design|ui|ux|figma)\b/i, 'design'],
];

function categoriaParaTitulo(titulo) {
  for (const [regex, slug] of MAPA_CATEGORIA) {
    if (regex.test(titulo)) return slug;
  }
  return null; // sem match -> nao vira tendencia de categoria (ignorado)
}

async function jaBuscouRecentemente(client) {
  const { rows } = await client.query('SELECT last_real_trends_fetch FROM simulation_state WHERE id = true');
  const ultima = rows[0] && rows[0].last_real_trends_fetch;
  if (!ultima) return false;
  const horas = (Date.now() - new Date(ultima).getTime()) / 36e5;
  return horas < CACHE_HORAS;
}

async function buscarTendenciasReais() {
  if (process.env.ENABLE_REAL_TRENDS !== 'true') return { ok: false, motivo: 'desativado' };

  const client = await pool.connect();
  try {
    if (await jaBuscouRecentemente(client)) return { ok: false, motivo: 'cache' };

    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ano = ontem.getUTCFullYear();
    const mes = String(ontem.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(ontem.getUTCDate()).padStart(2, '0');
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${ano}/${mes}/${dia}`;

    const resp = await fetch(url, { headers: { 'User-Agent': 'mercapp-simulador/1.0' } });
    if (!resp.ok) throw new Error(`fonte externa respondeu ${resp.status}`);
    const data = await resp.json();
    const artigos = data.items?.[0]?.articles || [];

    let aplicadas = 0;
    for (const artigo of artigos.slice(0, 40)) {
      const titulo = decodeURIComponent(artigo.article || '').replace(/_/g, ' ');
      const slug = categoriaParaTitulo(titulo);
      if (!slug) continue;

      const cat = await client.query('SELECT id FROM categories WHERE slug = $1', [slug]);
      if (cat.rows.length === 0) continue;
      const categoryId = cat.rows[0].id;

      // aumenta popularidade da categoria detectada como "em alta" no mundo real
      await client.query(
        `UPDATE trends
         SET popularity = LEAST(100, popularity + 4),
             growth = growth + 2,
             momentum = 'subindo',
             source = 'real',
             updated_at = now()
         WHERE category_id = $1`,
        [categoryId]
      );
      aplicadas++;
    }

    await client.query(
      `UPDATE simulation_state SET last_real_trends_fetch = now() WHERE id = true`
    );

    return { ok: true, artigos_processados: artigos.length, categorias_influenciadas: aplicadas };
  } catch (err) {
    console.warn('[tendencias-reais] falha ao buscar, mantendo tendencias seed:', err.message);
    return { ok: false, motivo: 'erro_fonte_externa', detalhe: err.message };
  } finally {
    client.release();
  }
}

module.exports = { buscarTendenciasReais };

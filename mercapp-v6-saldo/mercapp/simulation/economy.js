// Economia "pesada" do jogo: impostos, folha de pagamento, contas de casa
// e o fechamento de mes. Tudo roda no ciclo do motor, nunca no navegador.

// ---------- 8. IMPOSTOS ----------
// Faixas inspiradas (de forma simplificada) no modelo brasileiro real.
const FAIXAS_SIMPLES = [
  { ate: 18000000, aliquota: 6.0 },   // ate R$ 180k no mes
  { ate: 36000000, aliquota: 11.2 },
  { ate: 72000000, aliquota: 13.5 },
  { ate: Infinity, aliquota: 16.0 },
];

const IMPOSTOS = {
  simples: { label: 'Simples Nacional', base: 'faturamento' },
  icms:    { label: 'ICMS (produto fisico)', aliquota: 12.0 },
  iss:     { label: 'ISS (servicos)', aliquota: 5.0 },
  irpj:    { label: 'IRPJ sobre o lucro', aliquota: 15.0 },
  inss:    { label: 'INSS patronal (folha)', aliquota: 20.0 },
  importacao: { label: 'Imposto de venda internacional', base: 'por moeda' },
};

function aliquotaSimples(faturamentoCents) {
  for (const faixa of FAIXAS_SIMPLES) {
    if (faturamentoCents <= faixa.ate) return faixa.aliquota;
  }
  return 16.0;
}

// Calcula e registra os impostos do mes de uma empresa.
async function apurarImpostos(client, companyId, gameMonth) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(o.price_cents)::bigint, 0) AS faturamento,
       COALESCE(SUM(o.tax_cents)::bigint, 0) AS importacao,
       COALESCE(SUM(CASE WHEN p.product_type = 'fisico' THEN o.price_cents ELSE 0 END)::bigint, 0) AS base_icms,
       COALESCE(SUM(CASE WHEN p.product_type = 'servico' THEN o.price_cents ELSE 0 END)::bigint, 0) AS base_iss,
       COALESCE(SUM(o.price_cents - p.cost_cents)::bigint, 0) AS lucro
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.company_id = $1 AND o.created_at >= now() - interval '28 hours'`,
    [companyId]
  );
  const d = rows[0];
  const faturamento = Number(d.faturamento);
  if (faturamento === 0 && Number(d.importacao) === 0) return 0;

  const { rows: folhaRows } = await client.query(
    `SELECT COALESCE(SUM(wage_cents)::bigint, 0) AS folha
     FROM job_applications WHERE company_id = $1 AND status = 'contratado'`,
    [companyId]
  );
  const { rows: segurancaRows } = await client.query(
    `SELECT COALESCE(SUM(b.salary_cents)::bigint, 0) AS folha
     FROM security_hires h JOIN security_bots b ON b.id = h.security_bot_id
     WHERE h.company_id = $1`,
    [companyId]
  );
  const folha = Number(folhaRows[0].folha) + Number(segurancaRows[0].folha);
  const lucro = Math.max(0, Number(d.lucro));

  const lancamentos = [
    { kind: 'simples',    base: faturamento,        amount: Math.round(faturamento * aliquotaSimples(faturamento) / 100) },
    { kind: 'icms',       base: Number(d.base_icms),amount: Math.round(Number(d.base_icms) * IMPOSTOS.icms.aliquota / 100) },
    { kind: 'iss',        base: Number(d.base_iss), amount: Math.round(Number(d.base_iss) * IMPOSTOS.iss.aliquota / 100) },
    { kind: 'irpj',       base: lucro,              amount: Math.round(lucro * IMPOSTOS.irpj.aliquota / 100) },
    { kind: 'inss',       base: folha,              amount: Math.round(folha * IMPOSTOS.inss.aliquota / 100) },
    { kind: 'importacao', base: Number(d.importacao), amount: Number(d.importacao) },
  ].filter((l) => l.amount > 0);

  let total = 0;
  for (const l of lancamentos) {
    await client.query(
      `INSERT INTO tax_records (company_id, game_month, kind, base_cents, amount_cents)
       VALUES ($1,$2,$3,$4,$5)`,
      [companyId, gameMonth, l.kind, l.base, l.amount]
    );
    total += l.amount;
  }
  return total;
}

// ---------- 17. CONTAS DO MES ----------
async function fecharMes(client, gameMonth) {
  const { rows: empresas } = await client.query(
    'SELECT id FROM companies WHERE is_bot = false'
  );

  for (const empresa of empresas) {
    const companyId = empresa.id;

    // casa: aluguel (ou zero se for propria)
    const { rows: casaRows } = await client.query(
      'SELECT kind, rent_cents FROM houses WHERE company_id = $1',
      [companyId]
    );
    const aluguel = casaRows.length && casaRows[0].kind === 'aluguel' ? Number(casaRows[0].rent_cents) : 0;

    // contas de consumo variam conforme os moveis que o jogador comprou.
    // 'utilidade' (planos de internet) sai da energia e vira conta de internet,
    // senao seria cobrado duas vezes.
    const { rows: consumoRows } = await client.query(
      `SELECT COALESCE(SUM(f.energy_cents)::bigint,0) AS energia,
              COALESCE(SUM(f.water_cents)::bigint,0) AS agua
       FROM owned_furniture o JOIN furniture_catalog f ON f.id = o.furniture_id
       WHERE o.company_id = $1 AND f.category <> 'utilidade'`,
      [companyId]
    );
    // taxa basica + consumo dos moveis
    const energia = 8000 + Number(consumoRows[0].energia);
    const agua = 6000 + Number(consumoRows[0].agua);

    const { rows: netRows } = await client.query(
      `SELECT COALESCE(SUM(f.energy_cents)::bigint,0) AS net
       FROM owned_furniture o JOIN furniture_catalog f ON f.id = o.furniture_id
       WHERE o.company_id = $1 AND f.category = 'utilidade'`,
      [companyId]
    );
    const internet = Number(netRows[0].net) || 9900; // plano basico se nao tiver contratado

    const { rows: folhaRows } = await client.query(
      `SELECT COALESCE(SUM(wage_cents)::bigint,0) AS folha
       FROM job_applications WHERE company_id = $1 AND status = 'contratado'`,
      [companyId]
    );
    const { rows: segurancaRows } = await client.query(
      `SELECT COALESCE(SUM(b.salary_cents)::bigint,0) AS folha
       FROM security_hires h JOIN security_bots b ON b.id = h.security_bot_id
       WHERE h.company_id = $1`,
      [companyId]
    );
    const salarios = Number(folhaRows[0].folha) + Number(segurancaRows[0].folha);

    // credita o salario na conta PESSOAL de cada jogador humano contratado
    // (funcionarios-bot nao tem carteira, so os jogadores mesmo)
    await client.query(
      `UPDATE users u SET balance_cents = balance_cents + j.wage_cents
       FROM job_applications j
       WHERE j.company_id = $1 AND j.status = 'contratado' AND j.user_id = u.id`,
      [companyId]
    );

    const impostos = await apurarImpostos(client, companyId, gameMonth);
    const total = aluguel + energia + agua + internet + salarios + impostos;

    await client.query(
      `INSERT INTO monthly_bills
         (company_id, game_month, rent_cents, energy_cents, water_cents,
          internet_cents, salaries_cents, taxes_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id, game_month) DO NOTHING`,
      [companyId, gameMonth, aluguel, energia, agua, internet, salarios, impostos, total]
    );

    // contas do mes anterior que nao foram pagas viram atraso
    await client.query(
      `UPDATE monthly_bills SET status = 'atrasado'
       WHERE company_id = $1 AND status = 'aberto' AND game_month < $2`,
      [companyId, gameMonth]
    );
  }
}

module.exports = { fecharMes, apurarImpostos, aliquotaSimples, IMPOSTOS, FAIXAS_SIMPLES };

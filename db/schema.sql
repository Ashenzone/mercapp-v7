-- ============================================================
-- MERCAPP - FASE 1: NUCLEO DO MARKETPLACE
-- Empresas, categorias e produtos.
-- Tabelas de tendencias, bots, avaliacoes, trafego pago e
-- analytics virao nas proximas fases, mas os campos aqui ja
-- deixam espaco (reputation, views, sales) para nao precisar
-- de migração destrutiva depois.
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  logo_url      TEXT,
  description   TEXT,
  reputation    NUMERIC(3,2) NOT NULL DEFAULT 0,      -- media 0-5, calculada por avaliacoes (fase 5)
  balance_cents BIGINT NOT NULL DEFAULT 500000,        -- saldo inicial: R$ 5.000,00 em centavos
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(60) NOT NULL UNIQUE,
  slug  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id       INTEGER REFERENCES categories(id),
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  product_type      VARCHAR(30) NOT NULL DEFAULT 'ebook',
    -- ebook | curso | template | software | servico | fisico | digital | outro
  niche             VARCHAR(80),
  keywords          TEXT[],                     -- ex: {'ia','produtividade'}
  target_audience   VARCHAR(150),
  price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents        INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  stock_quantity    INTEGER,                    -- NULL = ilimitado (produtos digitais)
  cover_image_url   TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | paused | draft
  views_count       INTEGER NOT NULL DEFAULT 0,
  sales_count       INTEGER NOT NULL DEFAULT 0,
  rating_avg        NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_company  ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);

-- categorias iniciais
INSERT INTO categories (name, slug) VALUES
  ('Inteligencia Artificial', 'ia'),
  ('Games', 'games'),
  ('Tecnologia', 'tecnologia'),
  ('Fitness', 'fitness'),
  ('Educacao', 'educacao'),
  ('Financas', 'financas'),
  ('Programacao', 'programacao'),
  ('Redes Sociais', 'redes-sociais'),
  ('Marketing Digital', 'marketing-digital'),
  ('Design', 'design'),
  ('Produtividade', 'produtividade'),
  ('Outros', 'outros')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- FASE 2: TENDENCIAS, BOTS, COMPRAS E AVALIACOES
-- ============================================================

CREATE TABLE IF NOT EXISTS trends (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(120) NOT NULL,
  category_id         INTEGER REFERENCES categories(id),
  popularity          NUMERIC(6,2) NOT NULL DEFAULT 30,  -- 0-100
  growth              NUMERIC(6,2) NOT NULL DEFAULT 0,   -- % de variacao no ultimo ciclo
  momentum            VARCHAR(20) NOT NULL DEFAULT 'estavel', -- subindo | estavel | caindo | pico | esgotada
  estimated_duration_days INTEGER NOT NULL DEFAULT 30,
  source              VARCHAR(20) NOT NULL DEFAULT 'seed',   -- seed | real
  history             JSONB NOT NULL DEFAULT '[]',           -- [{t, popularity}]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trends_category ON trends(category_id);

CREATE TABLE IF NOT EXISTS bots (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(80) NOT NULL,
  profile             VARCHAR(30) NOT NULL,
    -- curioso | economico | impulsivo | exigente | fiel | cacador_novidades | sensivel_preco | influenciado_avaliacoes
  favorite_category_id INTEGER REFERENCES categories(id),
  budget_cents        INTEGER NOT NULL DEFAULT 20000,
  loyalty_company_id  UUID REFERENCES companies(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  budget_cents      INTEGER NOT NULL CHECK (budget_cents > 0),
  duration_days     INTEGER NOT NULL DEFAULT 7,
  audience          VARCHAR(150),
  region            VARCHAR(80) DEFAULT 'Brasil',
  objective         VARCHAR(20) NOT NULL DEFAULT 'vendas', -- visualizacoes | cliques | vendas | reconhecimento
  status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | paused | finished
  impressions       INTEGER NOT NULL DEFAULT 0,
  clicks            INTEGER NOT NULL DEFAULT 0,
  spent_cents       INTEGER NOT NULL DEFAULT 0,
  revenue_cents     INTEGER NOT NULL DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_product ON campaigns(product_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_company ON campaigns(company_id);

CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id),
  bot_id        INTEGER REFERENCES bots(id),
  campaign_id   UUID REFERENCES campaigns(id),
  price_cents   INTEGER NOT NULL,
  source        VARCHAR(20) NOT NULL DEFAULT 'organico', -- organico | anuncio
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id      UUID REFERENCES orders(id),
  bot_id        INTEGER REFERENCES bots(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

CREATE TABLE IF NOT EXISTS market_events (
  id            SERIAL PRIMARY KEY,
  type          VARCHAR(30) NOT NULL, -- nova_tendencia | queda_interesse | viralizacao | crise | evento_global
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  category_id   INTEGER REFERENCES categories(id),
  effect        JSONB NOT NULL DEFAULT '{}', -- ex: {"popularity_delta": 20}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS simulation_state (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  tick_count  BIGINT NOT NULL DEFAULT 0,
  last_tick   TIMESTAMPTZ,
  last_real_trends_fetch TIMESTAMPTZ
);
INSERT INTO simulation_state (id) VALUES (true) ON CONFLICT DO NOTHING;

-- tendencias iniciais (uma por categoria, para o mercado nao comecar vazio)
INSERT INTO trends (name, category_id, popularity, growth, momentum, estimated_duration_days)
SELECT 'Alta de ' || c.name, c.id, 30 + (random() * 30)::int, (random() * 10)::numeric(6,2), 'subindo', 30 + (random()*30)::int
FROM categories c
WHERE NOT EXISTS (SELECT 1 FROM trends);

-- bots iniciais (variedade de perfis e categorias favoritas)
INSERT INTO bots (name, profile, favorite_category_id, budget_cents)
SELECT
  'Bot-' || gs,
  (ARRAY['curioso','economico','impulsivo','exigente','fiel','cacador_novidades','sensivel_preco','influenciado_avaliacoes'])[1 + floor(random()*8)::int],
  (SELECT id FROM categories ORDER BY random() LIMIT 1),
  (5000 + floor(random()*45000))::int
FROM generate_series(1, 60) AS gs
WHERE NOT EXISTS (SELECT 1 FROM bots);

-- ============================================================
-- RELEASE 2: USUARIOS, RELOGIO DO JOGO, EMPRESAS DE BOTS
-- ============================================================

-- login simples por e-mail: cada e-mail tem sua propria empresa e
-- so enxerga/edita os proprios dados.
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(160) NOT NULL UNIQUE,
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- marca empresas controladas por bots (concorrentes da simulacao)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
-- estrategia do concorrente: define preco, ritmo de lancamento e investimento
ALTER TABLE companies ADD COLUMN IF NOT EXISTS strategy VARCHAR(30);

-- relogio interno do jogo: 1 dia de jogo = 4 horas reais; 1 mes = 7 dias de jogo
ALTER TABLE simulation_state ADD COLUMN IF NOT EXISTS game_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE simulation_state ADD COLUMN IF NOT EXISTS game_month INTEGER NOT NULL DEFAULT 1;
ALTER TABLE simulation_state ADD COLUMN IF NOT EXISTS last_day_advance TIMESTAMPTZ;

-- imagens enviadas pelo jogador (arquivo/galeria em vez de URL)
CREATE TABLE IF NOT EXISTS uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mime_type   VARCHAR(60) NOT NULL,
  data        TEXT NOT NULL,          -- base64
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- empresas concorrentes controladas por bots
INSERT INTO companies (name, description, is_bot, strategy, balance_cents)
SELECT nome, 'Concorrente controlado pela simulacao.', true, estrategia, 500000
FROM (VALUES
  ('Nexo Digital',      'agressiva'),
  ('Vortex Studios',    'premium'),
  ('Pulsar Content',    'volume'),
  ('Atlas Educacao',    'nicho'),
  ('Orbita Software',   'premium'),
  ('Raiz Criativa',     'volume'),
  ('Zenit Performance', 'agressiva'),
  ('Lumen Midia',       'nicho')
) AS t(nome, estrategia)
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE is_bot = true);

-- ============================================================
-- RELEASE 3: AFILIADOS, MARKETCHAT, FUNCIONARIOS, SOCIOS,
-- IMPOSTOS, MOEDAS, CASA/MOVEIS E DESPESAS MENSAIS
-- ============================================================

-- ---------- 7. AFILIADOS ----------
CREATE TABLE IF NOT EXISTS affiliates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_id         INTEGER REFERENCES bots(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id) ON DELETE CASCADE,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 30,
  status         VARCHAR(20) NOT NULL DEFAULT 'pendente', -- pendente | ativo | recusado | encerrado
  reach          INTEGER NOT NULL DEFAULT 100,   -- alcance do afiliado no marketchat
  sales_count    INTEGER NOT NULL DEFAULT 0,
  earned_cents   BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliates_company ON affiliates(company_id, status);

-- ---------- 7. MARKETCHAT (rede social) ----------
CREATE TABLE IF NOT EXISTS posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  bot_id        INTEGER REFERENCES bots(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  affiliate_id  UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  image_url     TEXT,
  kind          VARCHAR(20) NOT NULL DEFAULT 'post', -- post | divulgacao | afiliado
  likes         INTEGER NOT NULL DEFAULT 0,
  reach         INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  bot_id     INTEGER REFERENCES bots(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 11/12/13. CARGOS, FUNCIONARIOS E SALARIOS ----------
CREATE TABLE IF NOT EXISTS roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title          VARCHAR(80) NOT NULL,
  salary_cents   INTEGER NOT NULL DEFAULT 150000,
  department     VARCHAR(40) NOT NULL DEFAULT 'geral',
    -- geral | marketing | producao | vendas | suporte
  bonus_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- efeito do cargo na simulacao
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_id      INTEGER REFERENCES bots(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID REFERENCES roles(id) ON DELETE SET NULL,
  skill       INTEGER NOT NULL DEFAULT 50,          -- 1-100
  wage_cents  INTEGER NOT NULL DEFAULT 150000,
  status      VARCHAR(20) NOT NULL DEFAULT 'pendente', -- pendente | contratado | recusado | demitido
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON job_applications(company_id, status);

-- ---------- 10. SOCIOS ----------
CREATE TABLE IF NOT EXISTS partnerships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_pct      NUMERIC(5,2) NOT NULL DEFAULT 25,
  status         VARCHAR(20) NOT NULL DEFAULT 'pendente', -- pendente | aceito | recusado | encerrado
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

-- ---------- 9. MOEDAS E MERCADOS ----------
CREATE TABLE IF NOT EXISTS currencies (
  code            VARCHAR(5) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  symbol          VARCHAR(5) NOT NULL,
  rate_to_brl     NUMERIC(10,4) NOT NULL,   -- quanto vale 1 unidade em BRL
  import_tax_pct  NUMERIC(5,2) NOT NULL,    -- imposto cobrado por vender naquele mercado
  demand_factor   NUMERIC(4,2) NOT NULL DEFAULT 1.0
);

INSERT INTO currencies (code, name, symbol, rate_to_brl, import_tax_pct, demand_factor) VALUES
  ('BRL', 'Real (Brasil)',        'R$', 1.0000,  0.00, 1.00),
  ('USD', 'Dolar (EUA)',          'US$', 5.4000, 12.00, 1.35),
  ('EUR', 'Euro (Europa)',        'EUR', 5.9000, 15.00, 1.25),
  ('GBP', 'Libra (Reino Unido)',  'GBP', 6.8000, 14.00, 1.15),
  ('JPY', 'Iene (Japao)',         'JPY', 0.0360, 10.00, 1.10)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE products ADD COLUMN IF NOT EXISTS currency_code VARCHAR(5) NOT NULL DEFAULT 'BRL'
  REFERENCES currencies(code);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(5) NOT NULL DEFAULT 'BRL';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---------- 8. IMPOSTOS ----------
CREATE TABLE IF NOT EXISTS tax_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  game_month    INTEGER NOT NULL,
  kind          VARCHAR(30) NOT NULL,  -- simples | icms | iss | irpj | importacao | inss
  base_cents    BIGINT NOT NULL DEFAULT 0,
  amount_cents  BIGINT NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'aberto', -- aberto | pago | atrasado
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_company ON tax_records(company_id, status);

-- ---------- 16. CASA E MOVEIS ----------
CREATE TABLE IF NOT EXISTS houses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  kind               VARCHAR(20) NOT NULL DEFAULT 'aluguel', -- aluguel | propria
  name               VARCHAR(80) NOT NULL DEFAULT 'Kitnet alugada',
  rent_cents         INTEGER NOT NULL DEFAULT 90000,
  comfort            INTEGER NOT NULL DEFAULT 10,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS furniture_catalog (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(80) NOT NULL,
  category          VARCHAR(40) NOT NULL,
  price_cents       INTEGER NOT NULL,
  energy_cents      INTEGER NOT NULL DEFAULT 0,  -- custo mensal de energia
  water_cents       INTEGER NOT NULL DEFAULT 0,
  comfort           INTEGER NOT NULL DEFAULT 1,
  productivity_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owned_furniture (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  furniture_id  INTEGER NOT NULL REFERENCES furniture_catalog(id),
  bought_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO furniture_catalog (name, category, price_cents, energy_cents, water_cents, comfort, productivity_pct)
SELECT * FROM (VALUES
  ('Geladeira basica',          'cozinha',     120000,  6000,    0,  3,  0.0),
  ('Geladeira inverter premium','cozinha',    2500000, 18000,    0, 14,  2.0),
  ('Fogao simples',             'cozinha',      60000,  1500,    0,  2,  0.0),
  ('Cooktop por inducao',       'cozinha',     450000,  9000,    0,  7,  0.5),
  ('Cama de solteiro',          'quarto',       80000,     0,    0,  3,  1.0),
  ('Cama king com colchao top', 'quarto',      900000,     0,    0, 12,  4.0),
  ('Ar-condicionado comum',     'climatizacao',150000, 22000,    0,  8,  2.0),
  ('Ar-condicionado inverter',  'climatizacao',380000, 11000,    0, 12,  3.5),
  ('Ventilador',                'climatizacao', 15000,  2500,    0,  2,  0.5),
  ('Mesa de escritorio simples','escritorio',   45000,     0,    0,  2,  1.5),
  ('Setup gamer completo',      'escritorio', 1800000, 25000,    0, 15,  8.0),
  ('Cadeira ergonomica',        'escritorio',  350000,     0,    0,  9,  5.0),
  ('Notebook basico',           'escritorio',  250000,  4000,    0,  4,  3.0),
  ('Workstation profissional',  'escritorio', 1500000, 12000,    0, 10, 10.0),
  ('Maquina de lavar',          'servico',     180000,  7000, 9000,  5,  0.5),
  ('Chuveiro eletrico',         'servico',      12000,  9000, 6000,  2,  0.0),
  ('Aquecedor a gas',           'servico',     400000,  2000, 5000,  7,  0.5),
  ('TV 50 polegadas',           'sala',        220000,  5000,    0,  6,  0.0),
  ('Home theater',              'sala',        600000,  8000,    0,  9,  0.0),
  ('Sofa confortavel',          'sala',        300000,     0,    0,  7,  1.0),
  ('Internet fibra 300MB',      'utilidade',         0, 12000,    0,  5,  4.0),
  ('Internet fibra 1GB',        'utilidade',         0, 24000,    0,  8,  7.0)
) AS t
WHERE NOT EXISTS (SELECT 1 FROM furniture_catalog);

-- ---------- 17. DESPESAS MENSAIS ----------
CREATE TABLE IF NOT EXISTS monthly_bills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  game_month     INTEGER NOT NULL,
  rent_cents     BIGINT NOT NULL DEFAULT 0,
  energy_cents   BIGINT NOT NULL DEFAULT 0,
  water_cents    BIGINT NOT NULL DEFAULT 0,
  internet_cents BIGINT NOT NULL DEFAULT 0,
  salaries_cents BIGINT NOT NULL DEFAULT 0,
  taxes_cents    BIGINT NOT NULL DEFAULT 0,
  total_cents    BIGINT NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL DEFAULT 'aberto', -- aberto | pago | atrasado
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, game_month)
);

-- indices de performance para as novas consultas
CREATE INDEX IF NOT EXISTS idx_orders_company_created ON orders(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owned_furniture_company ON owned_furniture(company_id);

-- ============================================================
-- RELEASE 4: ANTI-FRAUDE, DISPOSITIVO E CYBERSECURITY
-- ============================================================

-- ---------- ANTI-FRAUDE ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN NOT NULL DEFAULT false;

-- ---------- CYBERSECURITY ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS security_level INTEGER NOT NULL DEFAULT 1
  CHECK (security_level BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS security_bots (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(60) NOT NULL,
  country       VARCHAR(40) NOT NULL,
  avatar_seed   VARCHAR(40) NOT NULL,
  specialty     VARCHAR(40) NOT NULL, -- auditoria | deteccao | protecao | resposta
  experience    INTEGER NOT NULL DEFAULT 50,       -- 1-100
  reputation    NUMERIC(3,2) NOT NULL DEFAULT 3.5,
  salary_cents  INTEGER NOT NULL DEFAULT 200000,
  available     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS security_hires (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  security_bot_id  INTEGER NOT NULL UNIQUE REFERENCES security_bots(id),
  hired_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hack_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  success               BOOLEAN NOT NULL,
  reward_cents          INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hack_attacker ON hack_attempts(attacker_company_id, target_product_id, created_at);

CREATE TABLE IF NOT EXISTS minigame_plays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  puzzle_id     VARCHAR(30) NOT NULL,
  success       BOOLEAN NOT NULL,
  reward_cents  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_minigame_company ON minigame_plays(company_id, created_at);

INSERT INTO security_bots (name, country, avatar_seed, specialty, experience, reputation, salary_cents)
SELECT * FROM (VALUES
  ('Daniel Cruz',    'Brasil',        'daniel',  'auditoria', 72, 4.2, 220000),
  ('Kenji Watanabe', 'Japao',         'kenji',   'deteccao',  88, 4.6, 340000),
  ('Mateo Fernandez','Espanha',       'mateo',   'protecao',  65, 3.9, 190000),
  ('Lukas Becker',   'Alemanha',      'lukas',   'resposta',  81, 4.4, 300000),
  ('Ahmed Al-Farsi', 'Emirados Arabes','ahmed',  'deteccao',  59, 3.7, 170000),
  ('Sofia Rossi',    'Italia',        'sofia',   'auditoria', 76, 4.3, 250000),
  ('Yuki Tanaka',    'Japao',         'yuki',    'protecao',  93, 4.8, 380000),
  ('Rafael Souza',   'Brasil',        'rafael',  'resposta',  54, 3.5, 150000),
  ('Noah Williams',  'Reino Unido',   'noah',    'deteccao',  68, 4.0, 210000),
  ('Elena Petrova',  'Russia',        'elena',   'protecao',  85, 4.5, 320000),
  ('Priya Sharma',   'India',         'priya',   'auditoria', 62, 3.8, 180000),
  ('Liam O''Connor',  'Irlanda',      'liam',    'resposta',  70, 4.1, 230000)
) AS t
WHERE NOT EXISTS (SELECT 1 FROM security_bots);

-- ============================================================
-- RELEASE 5: LIMITE DE DISPOSITIVO, NICKNAME, WI-FI E
-- NOVO FLUXO DE INICIO (emprego OU criar empresa, nada de graca)
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents BIGINT NOT NULL DEFAULT 0; -- dinheiro pessoal, antes de ter empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname) WHERE nickname IS NOT NULL;

-- companies.balance_cents deixa de comecar com valor de graca --
-- o valor inicial agora vem do capital que o jogador escolheu pagar.
ALTER TABLE companies ALTER COLUMN balance_cents SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS wifi_plans (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(60) NOT NULL,
  price_cents       INTEGER NOT NULL,
  speed_mbps        INTEGER NOT NULL,
  stability_pct     INTEGER NOT NULL,      -- 0-100, chance de nao cair
  operation_limit   INTEGER NOT NULL,      -- quantas acoes (produto/campanha/post) permite
  duration_days     INTEGER NOT NULL       -- em dias DE JOGO
);
INSERT INTO wifi_plans (name, price_cents, speed_mbps, stability_pct, operation_limit, duration_days)
SELECT * FROM (VALUES
  ('Wi-Fi Basico',       4900,  20,  80,  30,  7),
  ('Wi-Fi Intermediario',9900,  100, 92,  100, 14),
  ('Fibra Profissional', 19900, 500, 99,  400, 30)
) AS t
WHERE NOT EXISTS (SELECT 1 FROM wifi_plans);

CREATE TABLE IF NOT EXISTS company_wifi (
  company_id       UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  plan_id          INTEGER NOT NULL REFERENCES wifi_plans(id),
  operations_left  INTEGER NOT NULL,
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);

-- taxa fixa de abertura de empresa (fica de referencia central pro backend)
CREATE TABLE IF NOT EXISTS game_config (
  key   VARCHAR(60) PRIMARY KEY,
  value_cents BIGINT NOT NULL
);
INSERT INTO game_config (key, value_cents) VALUES ('taxa_criacao_empresa', 30000)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);

-- ============================================================
-- RELEASE 6: BOTS COM PERSONALIDADE, HIERARQUIA NAS EMPRESAS-BOT,
-- NEGOCIACAO DE AFILIADOS, BANCO POR MOEDA, RELOGIO NO ANALYTICS/
-- TRAFEGO PAGO, NOTIFICACOES
-- ============================================================

-- ---------- 14/24. BOTS COM NOME, PAIS E AVATAR ----------
ALTER TABLE bots ADD COLUMN IF NOT EXISTS name VARCHAR(60);
ALTER TABLE bots ADD COLUMN IF NOT EXISTS country VARCHAR(40);
ALTER TABLE bots ADD COLUMN IF NOT EXISTS avatar_seed VARCHAR(40);

-- ---------- 15/16. NEGOCIACAO DE AFILIADOS ----------
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS negotiation_rounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS last_offer_pct NUMERIC(5,2);

-- ---------- 19. BANCO POR MOEDA (ledger informativo por moeda) ----------
CREATE TABLE IF NOT EXISTS currency_ledger (
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency_code  VARCHAR(5) NOT NULL REFERENCES currencies(code),
  balance_units  BIGINT NOT NULL DEFAULT 0,  -- unidades daquela moeda, em centavos DA MOEDA
  PRIMARY KEY (company_id, currency_code)
);

-- ---------- 20/21/22. RELOGIO DO JOGO NO ANALYTICS/TRAFEGO PAGO ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS game_day_recorded INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS game_month_recorded INTEGER;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_game_day INTEGER;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_game_month INTEGER;

-- ---------- 27. NOTIFICACOES ----------
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(40) NOT NULL,
  message      TEXT NOT NULL,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_company ON notifications(company_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);

-- ---------- 8. HIERARQUIA NAS EMPRESAS-BOT (diretores) ----------
-- cargos padrao pras empresas-bot existentes, se ainda nao tiverem
INSERT INTO roles (company_id, title, salary_cents, department, bonus_pct)
SELECT c.id, cargo.titulo, cargo.salario, cargo.depto, cargo.bonus
FROM companies c
CROSS JOIN (VALUES
  ('Diretor Executivo', 800000, 'geral', 3.0),
  ('Gerente de Marketing', 350000, 'marketing', 1.5),
  ('Analista de Dados', 280000, 'geral', 1.0)
) AS cargo(titulo, salario, depto, bonus)
WHERE c.is_bot = true
  AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.company_id = c.id);

-- nomes/paises/avatares pros bots consumidores que ainda tem o nome generico "Bot-N"
UPDATE bots SET
  name = nomes.nome,
  country = nomes.pais,
  avatar_seed = lower(regexp_replace(nomes.nome, '[^a-zA-Z]', '', 'g'))
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM bots WHERE name LIKE 'Bot-%' OR name IS NULL
) idx
JOIN (VALUES
  (1,'Alice Nakamura','Japao'),(2,'Bruno Silva','Brasil'),(3,'Chen Wei','China'),
  (4,'Diego Martinez','Mexico'),(5,'Emma Johnson','EUA'),(6,'Farid Hussain','Paquistao'),
  (7,'Giulia Bianchi','Italia'),(8,'Hana Kimura','Japao'),(9,'Igor Petrov','Russia'),
  (10,'Julia Costa','Brasil'),(11,'Kwame Mensah','Gana'),(12,'Lena Fischer','Alemanha'),
  (13,'Marco Rossi','Italia'),(14,'Nadia Haddad','Libano'),(15,'Oscar Lindqvist','Suecia'),
  (16,'Priya Nair','India'),(17,'Quentin Dubois','Franca'),(18,'Rita Alves','Portugal'),
  (19,'Sana Yamamoto','Japao'),(20,'Tomas Novak','Republica Tcheca'),
  (21,'Uma Devi','India'),(22,'Victor Hugo','Brasil'),(23,'Wendy Zhang','China'),
  (24,'Xavier Moreau','Franca'),(25,'Yara Saad','Egito'),(26,'Zack Miller','EUA'),
  (27,'Ana Torres','Espanha'),(28,'Ben Cohen','Israel'),(29,'Cleo Andrade','Brasil'),
  (30,'Dmitri Volkov','Russia'),(31,'Elif Sahin','Turquia'),(32,'Felix Wagner','Alemanha'),
  (33,'Grace Park','Coreia do Sul'),(34,'Hugo Santos','Portugal'),(35,'Ines Ferreira','Brasil'),
  (36,'Jack Thompson','Reino Unido'),(37,'Keiko Sato','Japao'),(38,'Leo Fontaine','Franca'),
  (39,'Mira Kapoor','India'),(40,'Nico Bergman','Suecia'),(41,'Olga Ivanova','Russia'),
  (42,'Pablo Diaz','Argentina'),(43,'Qiu Yun','China'),(44,'Rafaela Lima','Brasil'),
  (45,'Sami Khan','Paquistao'),(46,'Talia Rosen','Israel'),(47,'Ulrich Schmidt','Alemanha'),
  (48,'Valeria Rossi','Italia'),(49,'Wale Adeyemi','Nigeria'),(50,'Ximena Rojas','Chile'),
  (51,'Yusuf Demir','Turquia'),(52,'Zara Ahmed','Bangladesh'),(53,'Aiden Clarke','Irlanda'),
  (54,'Bianca Souza','Brasil'),(55,'Carlos Fuentes','Mexico'),(56,'Dana White','EUA'),
  (57,'Eitan Barak','Israel'),(58,'Fatima Zahra','Marrocos'),(59,'Gustav Berg','Noruega'),
  (60,'Helena Kowalski','Polonia')
) AS nomes(rn, nome, pais) ON nomes.rn = idx.rn
WHERE bots.id = idx.id;

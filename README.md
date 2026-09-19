# Mercapp — simulador de negócios digitais

Marketplace + motor de simulação econômica: marketing digital, produtos,
tendências, bots consumidores, tráfego pago e analytics, tudo conectado
(Node/Express/PostgreSQL).

## O que ja funciona

**Conta e marketplace**
- Login por e-mail: cada jogador tem a propria empresa, ninguem mexe nos dados do outro
- Criar/editar/excluir produtos, com upload de imagem do PC ou da galeria do celular
- Marketplace com busca, filtro, ordenacao; jogador pode COMPRAR produto de outro jogador
- 8 empresas concorrentes controladas por bots, cada uma com estrategia propria
  (agressiva / premium / volume / nicho), que lancam produtos lendo as tendencias

**Motor de simulacao (roda sozinho, ciclo a cada 3h)**
- Relogio do jogo: 1 dia = 4 horas reais, 1 mes = 7 dias de jogo (28h reais)
- Tendencias com ciclo de vida, eventos de mercado, 60+ bots com 8 perfis de compra
- Vendas deliberadamente dificeis: score minimo de descoberta e chance de compra reduzida
- 75 variacoes de comentario nas avaliacoes
- Gravacao em lote: o ciclo inteiro usa menos de 10 queries em vez de centenas

**Rede social e afiliados**
- MarketChat: feed, posts com imagem, curtidas, comentarios de bots e de jogadores
- Bots pedem pra se afiliar aos seus produtos; voce aceita e negocia a comissao
- Afiliado divulga no MarketChat, gera alcance/cliques e vende por comissao (voce so paga se vender)
- Jogador tambem pode pedir afiliacao em produto de outro jogador

**Empresa, equipe e sociedade**
- Cargos com salario, departamento e efeito na simulacao
- Bots se candidatam a vagas (com habilidade 1-100 e pretensao salarial); voce contrata, aloca e demite
- Funcionarios aumentam sua conversao de vendas e pesam na folha todo mes
- Sociedade: pedir pra virar socio de outro jogador pelo e-mail, com % de participacao

**Economia pesada**
- Impostos reais simplificados: Simples Nacional por faixa, ICMS, ISS, IRPJ, INSS patronal
- Venda em 5 moedas (BRL/USD/EUR/GBP/JPY): mais procura la fora, mas paga imposto de importacao
- Casa (kitnet alugada ate casa propria) e 22 moveis com consumo de energia/agua,
  conforto e bonus de produtividade
- Fim de mes fecha a conta: aluguel, energia, agua, internet, salarios e impostos.
  Nao pagou, fica atrasado.

## Release 5 (mais recente)

- **Anti-fraude:** comprar o proprio produto ja era bloqueado; agora tambem ha limite de
  3 compras validas por produto (por dispositivo, nao so por conta) com cooldown de 10min
- **Preco realista pros bots:** a penalidade de preco nao tem mais teto -- escala com o
  orcamento real de cada bot, um produto de R$100.000 agora e praticamente ignorado
- **Cybersecurity:** 5 niveis de seguranca por produto, 12 especialistas contratáveis
  (nome/pais/foto), ataques entre jogadores com chance de sucesso realista, mini-game
  de reordenar codigo ficticio validado so no servidor
- **Sem dinheiro de graca no inicio:** login nao cria mais empresa automaticamente.
  Jogador junta capital trabalhando (candidatura com salario negociavel, inclusive em
  empresas de bots que aceitam/recusam/contrapropõem) ou paga a taxa de abertura
- **Wi-Fi:** sem plano ativo, nao publica produto, nao roda campanha, nao posta no
  MarketChat -- 3 planos com velocidade/estabilidade/limite de operacoes/duracao
- **Nickname publico:** substitui o e-mail em toda exibicao publica (afiliados, socios,
  candidaturas)

## Release 6 (fecha o briefing completo)

- **Bots com personalidade:** os 60 bots consumidores ganharam nome, pais e avatar
  (antes eram so "Bot-1", "Bot-2"...); aparecem assim no MarketChat e nos comentarios
- **Hierarquia nas empresas-bot:** cada uma das 8 concorrentes ganhou Diretor Executivo,
  Gerente de Marketing e Analista de Dados -- bots de verdade preenchem esses cargos
  automaticamente e entram na folha da empresa
- **Negociacao de afiliados de verdade:** voce propoe uma comissao, o bot calcula se
  vale a pena pra ele (baseado na nota/vendas do produto) e aceita, contrapropoe ou
  recusa -- mesmo em 0% alguns aceitam por outros motivos, nao e tudo-ou-nada
- **Banco por moeda:** pagina nova mostrando quanto foi vendido em cada moeda
  (USD/EUR/GBP/JPY), sempre com o equivalente em reais ao lado
- **Relogio do jogo no analytics e no trafego pago:** analytics agora tem opcao de
  agrupar por dia INTERNO do jogo (nao so por data real); campanhas contam a duracao
  em dias de jogo, entao continuam corretas mesmo se voce ficar offline no meio
- **Notificacoes:** sininho no topo da sidebar com contador, pagina propria, eventos
  reais (avaliacao recebida, campanha terminou, afiliado pediu, invasao sofrida/bloqueada)
- **Atualizacao sem F5:** saldo, relogio e notificacoes atualizam sozinhos a cada 20s
  via polling (arquitetura mais simples e igualmente valida ao WebSocket pro tamanho
  do projeto, sem abrir conexao persistente por usuario)

## Proximos passos possiveis

- Senha no login (hoje e so e-mail, sem autenticacao real)
- Socios aceitos ainda nao dividem o lucro automaticamente
- Relevancia do marketplace pode incorporar o score de tendencia do motor de bots

## Como rodar localmente

1. Tenha um PostgreSQL rodando (local ou um serviço como Railway/Supabase).
2. Copie `.env.example` para `.env` e preencha `DATABASE_URL`.
3. Instale as dependências:
   ```
   npm install
   ```
4. Crie as tabelas (e a empresa padrão):
   ```
   npm run db:init
   ```
5. Suba o servidor:
   ```
   npm start
   ```
6. Acesse `http://localhost:3000`.

## Deploy no Railway

1. Crie um novo projeto no Railway e adicione um serviço PostgreSQL.
2. Suba este código como um segundo serviço (o Railway detecta o `package.json` e usa `npm start`).
3. A variável `DATABASE_URL` já vem preenchida automaticamente pelo Railway ao conectar o serviço ao banco.
4. Rode `npm run db:init` uma vez (via `railway run npm run db:init` ou no shell do serviço) para criar as tabelas.

## Estrutura

```
mercapp/
  server.js               # servidor Express + inicia o motor de simulacao
  db/
    schema.sql             # todas as tabelas (marketplace + simulacao)
    pool.js                # conexao com Postgres
    init.js                # roda o schema.sql e cria empresa/bots/tendencias iniciais
  simulation/
    engine.js              # o motor: tendencias, eventos, campanhas, bots, compras, avaliacoes
    botProfiles.js          # pesos de decisao e comentarios por perfil de bot
    trendsSource.js         # busca de tendencia real (Wikipedia pageviews) com cache/fallback
  routes/
    products.js, misc.js, trends.js, campaigns.js, orders.js, analytics.js, ranking.js, simulation.js
  public/
    index.html, produto.html, criar-produto.html, meus-produtos.html,
    dashboard.html, marketing.html, trafego-pago.html, analytics.html,
    tendencias.html, pedidos.html, avaliacoes.html, empresa.html,
    economia.html, ranking.html
    css/style.css           # identidade visual
    js/app.js, js/sidebar.js
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | conexão com o PostgreSQL |
| `PORT` | não | porta do servidor (padrão 3000) |
| `SIMULATION_TICK_MS` | não | intervalo do motor de simulação em ms (padrão 20000) |
| `ENABLE_REAL_TRENDS` | não | `true` para buscar tendências reais (Wikipedia); desligado por padrão |

## Testando o motor sem esperar

Toda página com o botão **"Forçar novo ciclo"** (Dashboard e Tendências) chama
`POST /api/simulation/tick` e roda um ciclo completo na hora — útil pra ver
bots comprando e avaliando sem esperar os ~20s do timer automático.

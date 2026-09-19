require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const productsRouter = require('./routes/products');
const miscRouter = require('./routes/misc');
const trendsRouter = require('./routes/trends');
const campaignsRouter = require('./routes/campaigns');
const ordersReviewsRouter = require('./routes/orders');
const analyticsRouter = require('./routes/analytics');
const rankingRouter = require('./routes/ranking');
const simulationRouter = require('./routes/simulation');
const authRouter = require('./routes/auth');
const socialRouter = require('./routes/social');
const hrRouter = require('./routes/hr');
const financasRouter = require('./routes/financas');
const cyberRouter = require('./routes/cyber');
const onboardingRouter = require('./routes/onboarding');
const wifiRouter = require('./routes/wifi');
const notificationsRouter = require('./routes/notifications');

const { iniciarLoopDeSimulacao } = require('./simulation/engine');
const { inicializarBanco } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/products', productsRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/ranking', rankingRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/auth', authRouter);
app.use('/api/social', socialRouter);
app.use('/api/rh', hrRouter);
app.use('/api/financas', financasRouter);
app.use('/api/cyber', cyberRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/wifi', wifiRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', ordersReviewsRouter); // /api/orders/... e /api/reviews/...
app.use('/api', miscRouter);          // /api/categories e /api/companies

app.get('/health', (req, res) => res.json({ ok: true }));

async function iniciar() {
  try {
    await inicializarBanco();
  } catch (err) {
    // nao derruba o servidor por causa disso -- so avisa no log.
    // se a variavel DATABASE_URL estiver errada, as rotas vao falhar
    // e isso vai aparecer nos logs do Railway, mas o processo continua de pe.
    console.error('Falha ao inicializar o banco automaticamente:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Mercapp rodando em http://localhost:${PORT}`);
    const intervalo = Number(process.env.SIMULATION_TICK_MS) || 3 * 60 * 60 * 1000;
    iniciarLoopDeSimulacao(intervalo);
  });
}

iniciar();

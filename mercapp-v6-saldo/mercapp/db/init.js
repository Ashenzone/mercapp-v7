require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

// Essa funcao e' chamada tanto pelo comando manual (npm run db:init)
// quanto automaticamente pelo server.js quando o app sobe no Railway --
// e' segura de rodar varias vezes (usa IF NOT EXISTS / WHERE NOT EXISTS).
async function inicializarBanco() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await client.query(schema);

    const { rows } = await client.query('SELECT id FROM companies LIMIT 1');
    if (rows.length === 0) {
      await client.query(
        `INSERT INTO companies (name, description) VALUES ($1, $2)`,
        ['Minha Empresa', 'Empresa criada automaticamente na primeira execucao.']
      );
      console.log('Empresa padrao criada.');
    }

    console.log('Banco inicializado com sucesso.');
  } finally {
    client.release();
  }
}

// Se esse arquivo for executado direto (node db/init.js ou npm run db:init),
// roda uma vez e encerra. Se for importado (pelo server.js), so exporta a funcao.
if (require.main === module) {
  inicializarBanco()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Erro ao inicializar banco:', err);
      process.exit(1);
    });
}

module.exports = { inicializarBanco };

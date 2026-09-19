// Helper simples pra criar notificacoes. Usado pelo motor (engine/social/cyber)
// e pelas rotas quando um evento relevante acontece.

async function notificarEmpresa(client, companyId, type, message) {
  if (!companyId) return;
  await client.query(
    'INSERT INTO notifications (company_id, type, message) VALUES ($1,$2,$3)',
    [companyId, type, message]
  );
}

async function notificarUsuario(client, userId, type, message) {
  if (!userId) return;
  await client.query(
    'INSERT INTO notifications (user_id, type, message) VALUES ($1,$2,$3)',
    [userId, type, message]
  );
}

module.exports = { notificarEmpresa, notificarUsuario };

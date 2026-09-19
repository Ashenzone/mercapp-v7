const NAV_ITEMS = [
  ['dashboard.html', 'Dashboard'],
  ['index.html', 'Marketplace'],
  ['marketchat.html', 'MarketChat'],
  ['meus-produtos.html', 'Meus Produtos'],
  ['criar-produto.html', 'Criar Produto'],
  ['marketing.html', 'Marketing'],
  ['trafego-pago.html', 'Trafego Pago'],
  ['afiliados.html', 'Afiliados'],
  ['cybersecurity.html', 'Cybersecurity'],
  ['analytics.html', 'Analytics'],
  ['tendencias.html', 'Tendencias'],
  ['pedidos.html', 'Pedidos'],
  ['avaliacoes.html', 'Avaliacoes'],
  ['equipe.html', 'Equipe'],
  ['socios.html', 'Socios'],
  ['casa.html', 'Casa e Moveis'],
  ['wifi.html', 'Wi-Fi'],
  ['banco.html', 'Banco'],
  ['notificacoes.html', 'Notificacoes'],
  ['impostos.html', 'Impostos e Contas'],
  ['empresa.html', 'Empresa'],
  ['economia.html', 'Economia'],
  ['ranking.html', 'Ranking'],
];

// Sem empresa ainda, so essas abas ficam disponiveis (item 5/28: desbloqueio progressivo)
const NAV_SEM_EMPRESA = [
  ['onboarding.html', 'Comecar'],
  ['nickname.html', 'Nickname'],
  ['index.html', 'Marketplace'],
  ['ranking.html', 'Ranking'],
];

function montarSidebar() {
  const el = document.querySelector('.sidebar');
  if (!el) return;
  const atual = location.pathname.split('/').pop() || 'index.html';
  const temEmpresa = !!getEmpresaAtual();
  const itens = temEmpresa ? NAV_ITEMS : NAV_SEM_EMPRESA;

  const nav = itens.map(
    ([href, label]) => `<a href="${href}" class="${href === atual ? 'active' : ''}">${label}</a>`
  ).join('');

  el.innerHTML = `
    <div class="brand">Merc<span>app</span>
      ${temEmpresa ? `<a href="notificacoes.html" style="position:relative;float:right;font-size:16px;text-decoration:none;">
          🔔<span data-notif-badge style="display:none;position:absolute;top:-6px;right:-10px;background:var(--down);color:#fff;font-size:10px;border-radius:100px;padding:1px 5px;font-family:var(--font-body);"></span>
        </a>` : ''}
    </div>
    <div class="tagline">simulador de negocios digitais</div>
    <nav>${nav}</nav>
    <div class="balance">
      ${temEmpresa ? `
        <div class="label">Saldo</div>
        <div class="value num" data-saldo>-</div>
        <div class="label" style="margin-top:12px;">Tempo de jogo</div>
        <div class="num" style="font-size:13px;color:#b7bacb;" data-relogio>-</div>
        <div style="margin-top:14px;font-size:12px;color:#6d7284;" data-empresa-nome></div>
      ` : `
        <div class="label">Saldo pessoal</div>
        <div class="value num" data-saldo-pessoal>-</div>
      `}
      <a href="#" onclick="sair();return false;" style="display:block;margin-top:8px;font-size:12px;color:#6d7284;">Sair</a>
    </div>`;
}

async function mostrarSaldoPessoal() {
  const el = document.querySelector('[data-saldo-pessoal]');
  if (!el) return;
  const userId = getUserIdAtual();
  if (!userId) return;
  const resp = await fetch(`${API}/auth/me/${userId}`);
  if (!resp.ok) return;
  const u = await resp.json();
  el.textContent = formatarPreco(u.balance_cents);
}

document.addEventListener('DOMContentLoaded', () => {
  montarSidebar();
  mostrarSaldoPessoal();
});

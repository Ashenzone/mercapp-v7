// Mini-game de cybersecurity: codigo FICTICIO, exclusivo do jogo.
// O jogador reordena as linhas embaralhadas na ordem logica correta.
// A ordem certa nunca e enviada ao cliente -- so o array embaralhado e o id.

const PUZZLES = {
  auth_flow: {
    titulo: 'Corrija o fluxo de autenticacao',
    dificuldade: 1,
    recompensa_cents: 8000,
    linhas: [
      'function verificarLogin(usuario) {',
      '  const credencial = buscarCredencial(usuario);',
      '  if (!credencial) return acessoNegado();',
      '  const senhaOk = compararHash(usuario.senha, credencial.hash);',
      '  if (!senhaOk) return acessoNegado();',
      '  return liberarAcesso(usuario);',
      '}',
    ],
  },
  token_expira: {
    titulo: 'Ordene a validacao de token',
    dificuldade: 2,
    recompensa_cents: 12000,
    linhas: [
      'function validarToken(token) {',
      '  if (!token) return recusar("token ausente");',
      '  const payload = decodificar(token);',
      '  if (payload.expiraEm < agora()) return recusar("token expirado");',
      '  if (!assinaturaValida(token)) return recusar("assinatura invalida");',
      '  return aceitar(payload);',
      '}',
    ],
  },
  sanitizar_entrada: {
    titulo: 'Corrija a sanitizacao de entrada',
    dificuldade: 2,
    recompensa_cents: 12000,
    linhas: [
      'function processarEntrada(dados) {',
      '  const limpo = removerCaracteresPerigosos(dados);',
      '  if (contemPadraoSuspeito(limpo)) return bloquear(limpo);',
      '  const validado = validarFormato(limpo);',
      '  return salvarNoBanco(validado);',
      '}',
    ],
  },
  firewall_regras: {
    titulo: 'Organize a checagem do firewall ficticio',
    dificuldade: 3,
    recompensa_cents: 18000,
    linhas: [
      'function checarFirewall(pacote) {',
      '  if (estaNaListaBloqueio(pacote.origem)) return descartar(pacote);',
      '  if (excedeuLimiteDeTaxa(pacote.origem)) return limitar(pacote);',
      '  if (!assinaturaConhecida(pacote)) return inspecionarMaisAFundo(pacote);',
      '  return liberarPacote(pacote);',
      '}',
    ],
  },
  backup_seguro: {
    titulo: 'Ordene a rotina de backup seguro',
    dificuldade: 1,
    recompensa_cents: 8000,
    linhas: [
      'function rotinaDeBackup(dados) {',
      '  const criptografado = criptografar(dados);',
      '  const copia = enviarParaArmazenamentoSeguro(criptografado);',
      '  const integro = verificarIntegridade(copia);',
      '  return registrarBackup(integro);',
      '}',
    ],
  },
};

function idsEmbaralhados(puzzleId) {
  const puzzle = PUZZLES[puzzleId];
  if (!puzzle) return null;
  const indices = puzzle.linhas.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    id: puzzleId,
    titulo: puzzle.titulo,
    dificuldade: puzzle.dificuldade,
    recompensa_cents: puzzle.recompensa_cents,
    linhas: indices.map((i) => ({ pos: i, texto: puzzle.linhas[i] })),
  };
}

function conferirResposta(puzzleId, ordemEnviada) {
  const puzzle = PUZZLES[puzzleId];
  if (!puzzle) return false;
  if (!Array.isArray(ordemEnviada) || ordemEnviada.length !== puzzle.linhas.length) return false;
  return ordemEnviada.every((pos, i) => Number(pos) === i);
}

function puzzleAleatorio() {
  const chaves = Object.keys(PUZZLES);
  return chaves[Math.floor(Math.random() * chaves.length)];
}

module.exports = { PUZZLES, idsEmbaralhados, conferirResposta, puzzleAleatorio };

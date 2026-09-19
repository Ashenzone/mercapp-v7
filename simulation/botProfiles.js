// Cada perfil de bot pesa os fatores de decisao de um jeito diferente.
// Esses pesos sao usados pelo engine para calcular a "pontuacao de interesse"
// de um bot por um produto, e depois a probabilidade de compra.

const PERFIS = {
  curioso: {
    exploracao: 0.9,       // gosta de olhar coisas novas, mesmo fora do nicho favorito
    peso_tendencia: 0.4,
    peso_preco: 0.3,
    peso_avaliacao: 0.4,
    prob_compra_base: 0.12,
  },
  economico: {
    exploracao: 0.3,
    peso_tendencia: 0.3,
    peso_preco: 0.9,        // preto baixo pesa muito
    peso_avaliacao: 0.5,
    prob_compra_base: 0.10,
  },
  impulsivo: {
    exploracao: 0.6,
    peso_tendencia: 0.7,
    peso_preco: 0.2,
    peso_avaliacao: 0.2,
    prob_compra_base: 0.28,  // compra mais facil
  },
  exigente: {
    exploracao: 0.2,
    peso_tendencia: 0.3,
    peso_preco: 0.4,
    peso_avaliacao: 0.9,     // so compra se a avaliacao for boa
    prob_compra_base: 0.08,
    rating_minimo: 3.5,
  },
  fiel: {
    exploracao: 0.15,
    peso_tendencia: 0.2,
    peso_preco: 0.3,
    peso_avaliacao: 0.5,
    prob_compra_base: 0.14,
    bonus_empresa_fidelizada: 0.35,
  },
  cacador_novidades: {
    exploracao: 0.7,
    peso_tendencia: 0.6,
    peso_preco: 0.3,
    peso_avaliacao: 0.2,
    prob_compra_base: 0.16,
    bonus_produto_novo: 0.3,   // produtos criados ha poucos dias
  },
  sensivel_preco: {
    exploracao: 0.25,
    peso_tendencia: 0.3,
    peso_preco: 1.0,
    peso_avaliacao: 0.4,
    prob_compra_base: 0.09,
  },
  influenciado_avaliacoes: {
    exploracao: 0.3,
    peso_tendencia: 0.3,
    peso_preco: 0.4,
    peso_avaliacao: 1.0,
    prob_compra_base: 0.10,
    peso_volume_avaliacoes: 0.4, // confia mais quando tem MUITAS avaliacoes
  },
};

const COMENTARIOS = {
  5: [
    'Superou minhas expectativas, recomendo demais.',
    'Excelente custo-beneficio, vou comprar de novo.',
    'Exatamente o que eu precisava, entrega perfeita.',
    'Melhor compra que fiz esse mes, sem exagero.',
    'Conteudo direto ao ponto, sem enrolacao.',
    'Ja indiquei pra tres amigos, e serio.',
    'Valeu cada centavo, voltaria a comprar.',
    'Qualidade muito acima do que o preco sugere.',
    'Resolveu meu problema em menos de uma semana.',
    'Suporte rapido e material impecavel.',
    'Comprei com receio e me surpreendi.',
    'Simplesmente perfeito pro que eu queria.',
    'Melhor do que cursos que custam o triplo.',
    'Organizado, claro e completo. Nota maxima.',
    'Vendedor confiavel, produto entregue certinho.',
  ],
  4: [
    'Muito bom, so senti falta de mais detalhes em uma parte.',
    'Valeu o investimento, cumpriu o prometido.',
    'Gostei bastante, ficaria com 5 estrelas se fosse um pouco mais completo.',
    'Bom produto, mas o comeco e um pouco lento.',
    'Recomendo, apesar de um ou outro ponto confuso.',
    'Atendeu o que prometia, nada a reclamar de grave.',
    'Solido. Faltou so um material extra pra fechar.',
    'Gostei, mas achei o preco um pouquinho salgado.',
    'Cumpre bem o papel, da pra melhorar a apresentacao.',
    'Bem feito, so demorei a achar o que precisava.',
    'Otimo conteudo, formatacao podia ser melhor.',
    'Entrega boa, esperava um pouco mais de profundidade.',
    'Vale a pena, mesmo com alguns pontos repetitivos.',
    'Aprendi bastante, mas senti falta de exemplos.',
    'Bom, mas nao e pra quem ja tem experiencia.',
  ],
  3: [
    'Ok, mas esperava um pouco mais pelo preco.',
    'Cumpre o basico, nada excepcional.',
    'Mediano, pode melhorar em alguns pontos.',
    'Nao e ruim, mas tambem nao me empolgou.',
    'Serve pra quem esta comecando, so isso.',
    'Metade do conteudo e bom, a outra metade enche linguica.',
    'Razoavel. Provavelmente nao compraria de novo.',
    'Tem coisa util ali, mas mal organizado.',
    'Esperava mais pela descricao da pagina.',
    'Da pra aproveitar, mas com paciencia.',
    'Nem otimo nem ruim, ficou no meio termo.',
    'O preco e o problema, o conteudo ate que vai.',
    'Faltou profundidade no que realmente importa.',
    'Achei generico demais pro meu caso.',
    'Cumpriu parcialmente o que prometia.',
  ],
  2: [
    'Abaixo do que eu esperava, tive dificuldade em usar.',
    'Nao correspondeu a descricao em alguns pontos.',
    'Achei fraco para o preco cobrado.',
    'Muito superficial, da pra achar de graca por ai.',
    'Confuso, desisti no meio.',
    'A promessa da pagina de vendas nao se sustenta.',
    'Mal estruturado, perdi tempo tentando entender.',
    'Caro pelo que entrega, sinceramente.',
    'Poderia ser um post de blog, nao um produto pago.',
    'Faltou suporte quando precisei.',
    'Conteudo datado, nao serve mais hoje.',
    'Comprei esperando pratica, veio so teoria rasa.',
    'Decepcionante pro tamanho da propaganda.',
    'Nao recomendaria pra quem ja sabe o basico.',
    'Deixou a desejar em quase tudo.',
  ],
  1: [
    'Nao recomendo, muito abaixo da qualidade esperada.',
    'Me arrependi da compra.',
    'Descricao nao bate com o que foi entregue.',
    'Dinheiro jogado fora, infelizmente.',
    'Propaganda enganosa, esperava outra coisa.',
    'Conteudo praticamente vazio.',
    'Pior compra que fiz aqui.',
    'Nem consegui usar, mal feito demais.',
    'Fugiu completamente do que prometia.',
    'Sem suporte, sem qualidade, sem nada.',
    'Nao vale nem um decimo do preco.',
    'Parece feito as pressas.',
    'Quero meu dinheiro de volta.',
    'Zero utilidade pratica.',
    'Evitem, tem opcao muito melhor no marketplace.',
  ],
};

function comentarioAleatorio(rating) {
  const bucket = COMENTARIOS[rating] || COMENTARIOS[3];
  return bucket[Math.floor(Math.random() * bucket.length)];
}

module.exports = { PERFIS, comentarioAleatorio };

// queries.js — traduz o estado de filtros em SQL. Nenhuma consulta aqui é
// hardcoded sem filtro: toda função recebe `state` e monta o WHERE dinamicamente.

import { INSE_LEVELS } from './data.js';

function escSqlString(s) {
  return String(s).replace(/'/g, "''");
}

// Cláusula WHERE comum a quase todas as views. `opts.requireIdeb` controla
// se a linha precisa ter Ideb não nulo. A partir desta versão, N SEMPRE
// significa "escolas com Ideb válido" (ver critério 18 da revisão) — o
// default é true; só a consulta que mede "quantas ficaram de fora por falta
// de Ideb" passa requireIdeb:false deliberadamente.
export function buildWhere(state, opts = {}) {
  const { requireIdeb = true, extraUfFilter = null } = opts;
  const clauses = [];

  if (requireIdeb) clauses.push('ideb IS NOT NULL');

  clauses.push(`etapa_ensino = '${escSqlString(state.etapa)}'`);

  if (state.rede.size > 0 && state.rede.size < 3) {
    const list = [...state.rede].map((r) => `'${escSqlString(r)}'`).join(', ');
    clauses.push(`rede_ensino IN (${list})`);
  }

  if (state.localizacao !== 'ambas') {
    clauses.push(`localizacao = '${escSqlString(state.localizacao)}'`);
  }

  const ufs = extraUfFilter ?? state.ufs;
  if (ufs && ufs.size > 0) {
    const list = [...ufs].map((u) => `'${escSqlString(u)}'`).join(', ');
    clauses.push(`sg_uf IN (${list})`);
  }

  // INSE — dois modos. "Sem INSE calculado" é uma opção à parte porque
  // essas escolas têm inse_media/inse_classificacao NULL. Quando o filtro de
  // INSE está ativo (não é "todos os níveis + incluir sem INSE"), escolas
  // sem INSE ficam de fora — é isso que a nota da interface declara.
  if (state.inseMode === 'avancado') {
    clauses.push(`inse_media BETWEEN ${state.inseRange[0]} AND ${state.inseRange[1]}`);
  } else {
    const allLevels = state.inseLevels.size === INSE_LEVELS.length;
    if (!allLevels || !state.inseIncludeMissing) {
      const parts = [];
      if (state.inseLevels.size > 0) {
        const list = [...state.inseLevels].map((l) => `'${escSqlString(l)}'`).join(', ');
        parts.push(`inse_classificacao IN (${list})`);
      }
      if (state.inseIncludeMissing) parts.push('inse_classificacao IS NULL');
      clauses.push(parts.length ? `(${parts.join(' OR ')})` : 'FALSE');
    }
  }

  return clauses.join(' AND ');
}

export function mapQuery(state) {
  const where = buildWhere(state, { extraUfFilter: new Set() }); // mapa ignora o próprio filtro de UF, senão UF clicada desapareceria
  return `
    SELECT sg_uf, AVG(ideb) AS ideb_medio, COUNT(DISTINCT co_entidade) AS n
    FROM escolas_v
    WHERE ${where}
    GROUP BY sg_uf;
  `;
}

// Domínio de cor ESTÁVEL do mapa: média de Ideb por UF considerando só
// etapa (não os demais filtros). Calculado uma vez por etapa e reaproveitado
// em todas as consultas seguintes, para que o mesmo valor de Ideb sempre
// receba a mesma cor, independente de que outros filtros estejam ativos
// (critério 13 da revisão — "domínio estável por etapa").
export function mapColorDomainQuery(etapa) {
  return `
    SELECT MIN(m) AS min_ideb, MAX(m) AS max_ideb FROM (
      SELECT AVG(ideb) AS m
      FROM escolas_v
      WHERE ideb IS NOT NULL AND etapa_ensino = '${escSqlString(etapa)}'
      GROUP BY sg_uf
    );
  `;
}

// N "oficial" do contexto atual: escolas com Ideb válido.
export function nCounterQuery(state) {
  const where = buildWhere(state);
  return `SELECT COUNT(DISTINCT co_entidade) AS n FROM escolas_v WHERE ${where};`;
}

// N ignorando a exigência de Ideb, para calcular por subtração quantas
// escolas do contexto ficaram de fora só por não terem Ideb divulgado.
export function nTotalQuery(state) {
  const where = buildWhere(state, { requireIdeb: false });
  return `SELECT COUNT(DISTINCT co_entidade) AS n FROM escolas_v WHERE ${where};`;
}

export function scatterPointsQuery(state, xVar, segmentVar) {
  const where = buildWhere(state);
  const segCol = segmentVar && segmentVar !== 'nenhuma' ? `, ${segmentVar} AS seg_valor` : '';
  return `
    SELECT co_entidade, no_entidade, sg_uf, rede_ensino, ideb, inse_media, ${xVar} AS x_valor${segCol}
    FROM escolas_v
    WHERE ${where} AND ${xVar} IS NOT NULL;
  `;
}

// min_x/max_x (intervalo real) e p1_x/p99_x (percentis 1 e 99) são
// retornados juntos; quem chama decide o domínio a usar. Desde a correção
// de consistência P1/P99, main.js usa p1_x/p99_x (via computeAxisDomain) de
// forma UNIFORME para o eixo do scatter, o binning de tendência/densidade e
// a faixa dos destaques — os quatro precisam enxergar o mesmo domínio, senão
// um outlier como o de ~11.111 computadores/aluno distorce bins e grade sem
// que o eixo mostre isso (bug já corrigido, ver main.js: computeAxisDomain).
// min_x/max_x continuam disponíveis para quem realmente precisar do
// intervalo completo.
export function xDomainQuery(state, xVar) {
  const where = buildWhere(state);
  return `
    SELECT
      MIN(${xVar}) AS min_x,
      approx_quantile(${xVar}, 0.01) AS p1_x,
      approx_quantile(${xVar}, 0.99) AS p99_x,
      MAX(${xVar}) AS max_x
    FROM escolas_v
    WHERE ${where} AND ${xVar} IS NOT NULL;
  `;
}

const N_BINS = 16;

function binExpr(xVar, minX, maxX, nBins = N_BINS) {
  const span = maxX > minX ? maxX - minX : 1;
  return `LEAST(GREATEST(CAST(FLOOR((${xVar} - ${minX}) / ${span} * ${nBins}) AS INTEGER), 0), ${nBins - 1})`;
}

// "Ideb médio por faixa" — a tendência agregada. Receba minX/maxX como o
// domínio P1/P99 (não o intervalo completo) — valores fora desse intervalo
// ainda participam do cálculo, só caem na faixa de borda (LEAST/GREATEST em
// binExpr já faz isso), em vez de esticar todos os bins até o outlier.
// nBins é ajustável pelo usuário (controle "Nº de faixas") — o tamanho do
// bin muda o que fica visível (um bin grosseiro esconde padrões finos, um
// fino demais vira ruído), então deixamos o próprio usuário comparar.
export function trendQuery(state, xVar, minX, maxX, nBins = N_BINS) {
  const where = buildWhere(state);
  return `
    SELECT
      ${binExpr(xVar, minX, maxX, nBins)} AS faixa,
      AVG(${xVar}) AS x_medio,
      AVG(ideb) AS ideb_medio,
      COUNT(DISTINCT co_entidade) AS n
    FROM escolas_v
    WHERE ${where} AND ${xVar} IS NOT NULL
    GROUP BY faixa
    ORDER BY faixa;
  `;
}

// Grade de densidade 2D (aproximação de hexbin com células retangulares, por
// simplicidade/robustez de implementação) para o modo "Densidade" do Nível 2.
// minX/maxX devem ser o MESMO domínio (P1/P99) passado para renderDensity —
// query e desenho precisam compartilhar o sistema de coordenadas, senão a
// grade calculada não corresponde às posições mostradas no eixo.
export function densityGridQuery(state, xVar, minX, maxX, cols = 28, rows = 16) {
  const where = buildWhere(state);
  return `
    SELECT
      ${binExpr(xVar, minX, maxX, cols)} AS gx,
      LEAST(GREATEST(CAST(FLOOR(ideb / 10.0 * ${rows}) AS INTEGER), 0), ${rows - 1}) AS gy,
      COUNT(DISTINCT co_entidade) AS n
    FROM escolas_v
    WHERE ${where} AND ${xVar} IS NOT NULL
    GROUP BY gx, gy;
  `;
}

// Strip/dot-plot para variável de análise BINÁRIA: pontos individuais por
// categoria (Não possui / Possui), no lugar de um boxplot (critério 10 da
// revisão — comparar distribuições sem exigir conhecimento prévio de boxplot).
export function binaryStripQuery(state, xVar, segmentVar) {
  const where = buildWhere(state);
  const segCol = segmentVar && segmentVar !== 'nenhuma' ? `, ${segmentVar} AS seg_valor` : '';
  return `
    SELECT co_entidade, no_entidade, sg_uf, rede_ensino, ideb, inse_media,
           CAST(ROUND(${xVar}) AS INTEGER) AS categoria${segCol}
    FROM escolas_v
    WHERE ${where} AND ${xVar} IS NOT NULL;
  `;
}

// Resumo por categoria — usado tanto para as marcas de média/mediana do
// strip-plot binário quanto para o dot-plot comparativo de segmentação
// (rede/localização/classe INSE), que usa só posição (média + amplitude
// Q1–Q3), nunca uma caixa (critério 11 da revisão).
export function categorySummaryQuery(state, catVar, isNumeric) {
  const where = buildWhere(state);
  const categoriaExpr = isNumeric
    ? `CAST(CAST(ROUND(${catVar}) AS INTEGER) AS VARCHAR)`
    : `CAST(${catVar} AS VARCHAR)`;
  return `
    SELECT
      ${categoriaExpr} AS categoria,
      AVG(ideb) AS media,
      quantile_cont(ideb, 0.25) AS q1,
      quantile_cont(ideb, 0.5) AS mediana,
      quantile_cont(ideb, 0.75) AS q3,
      COUNT(DISTINCT co_entidade) AS n
    FROM escolas_v
    WHERE ${where} AND ${catVar} IS NOT NULL
    GROUP BY categoria
    ORDER BY categoria;
  `;
}

// Escolas que se destacam: distância entre o Ideb observado de cada escola e
// o Ideb médio da faixa (bin) da variável de análise ativa, dentro do
// contexto filtrado. minX/maxX: mesmo domínio P1/P99 de trendQuery/
// densityGridQuery (ver computeAxisDomain em main.js), não o intervalo
// completo — senão a faixa de cada escola é quase sempre a mesma (dominada
// pelo outlier), e a "distância" vira só o desvio em relação à média global.
// Não é regressão nem previsão — ver DISTANCIA_NOTE. Usa o mesmo nBins do
// gráfico de tendência, para a distância continuar coerente com a faixa que
// o usuário está vendo (não duas granularidades diferentes ao mesmo tempo).
export function outliersQuery(state, xVar, minX, maxX, limit = 10, nBins = N_BINS) {
  const where = buildWhere(state);
  return `
    WITH base AS (
      SELECT *, ${binExpr(xVar, minX, maxX, nBins)} AS faixa
      FROM escolas_v
      WHERE ${where} AND ${xVar} IS NOT NULL
    ),
    tendencia AS (
      SELECT faixa, AVG(ideb) AS ideb_medio_faixa
      FROM base
      GROUP BY faixa
    ),
    distancias AS (
      SELECT b.co_entidade, b.no_entidade, b.sg_uf, b.rede_ensino, b.ideb,
             b.x_valor_ref AS x_valor, b.inse_media,
             b.ideb - t.ideb_medio_faixa AS distancia
      FROM (SELECT *, ${xVar} AS x_valor_ref FROM base) b
      JOIN tendencia t USING (faixa)
    )
    (SELECT *, 'acima' AS grupo FROM distancias ORDER BY distancia DESC LIMIT ${limit})
    UNION ALL
    (SELECT *, 'abaixo' AS grupo FROM distancias ORDER BY distancia ASC LIMIT ${limit});
  `;
}

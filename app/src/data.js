// data.js — inicializa o DuckDB-Wasm, carrega o CSV tratado e expõe `query()`.
//
// A tabela `escolas` é criada exatamente a partir do CSV gerado pelo etl.py
// (uma linha por escola x etapa de ensino, rede pública, Censo/Ideb 2025 + INSE 2023).
// Uma view `escolas_v` adiciona o índice geral de infraestrutura, calculado aqui
// (média de 10 indicadores binários já presentes no CSV) para não exigir
// nenhuma mudança no pipeline Python.

import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm';

const CSV_URL = new URL('./data/escolas_ideb_infra_2025.csv', window.location.href).href;

let db = null;
let conn = null;

export async function initDatabase(onStatus) {
  onStatus?.('Baixando o motor DuckDB-Wasm…');
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  onStatus?.('Carregando a base tratada (≈40MB)…');
  await db.registerFileURL('escolas.csv', CSV_URL, duckdb.DuckDBDataProtocol.HTTP, false);

  conn = await db.connect();

  onStatus?.('Materializando a tabela…');
  await conn.query(`
    CREATE OR REPLACE TABLE escolas AS
    SELECT * FROM read_csv_auto('escolas.csv', header=true, sample_size=-1);
  `);

  // Índice geral de infraestrutura (0–1): média dos 10 indicadores de
  // infraestrutura básica/física discutidos no relatório de estatísticas.
  // Ver docs/relatorios — não é um dado do CSV, é derivado aqui em SQL.
  await conn.query(`
    CREATE OR REPLACE VIEW escolas_v AS
    SELECT *,
      (
        COALESCE(in_agua_potavel, 0) + COALESCE(in_energia_rede_publica, 0) +
        COALESCE(in_esgoto_rede_publica, 0) + COALESCE(in_banheiro_pne, 0) +
        COALESCE(in_biblioteca, 0) + COALESCE(in_quadra_esportes, 0) +
        COALESCE(in_refeitorio, 0) + COALESCE(in_parque_infantil, 0) +
        COALESCE(in_sala_atendimento_especial, 0) + COALESCE(in_acessibilidade_algum_recurso, 0)
      ) / 10.0 AS indice_infra_geral
    FROM escolas;
  `);

  onStatus?.(null);
}

export async function query(sql) {
  if (!conn) throw new Error('DuckDB ainda não foi inicializado.');
  const result = await conn.query(sql);
  // Extração manual (em vez de row.toJSON()) + normalização de BigInt -> Number:
  // o DuckDB-Wasm retorna colunas inteiras (COUNT, códigos) como BigInt via Arrow,
  // o que quebra silenciosamente qualquer conta comum do JS (Math.round, escalas do D3).
  const fieldNames = result.schema.fields.map((f) => f.name);
  return result.toArray().map((row) => {
    const obj = {};
    for (const name of fieldNames) {
      let v = row[name];
      if (typeof v === 'bigint') v = Number(v);
      obj[name] = v;
    }
    return obj;
  });
}

// ----------------------------------------------------------------------
// Abstração de dados (aula 05): a unidade de análise é a escola pública.
// Separamos três papéis que antes estavam misturados num único dropdown:
//
//   VARIÁVEL DE ANÁLISE  — atributo investigado contra o Ideb (eixo X do Nível 2).
//                           Só contínuas e binárias entram aqui — nunca
//                           categóricas (rede/localização não são "eixos").
//   VARIÁVEL DE SEGMENTAÇÃO — distingue grupos dentro da análise (cor/forma
//                           dos pontos), sem reduzir o conjunto de dados.
//   FILTROS               — restringem o universo de escolas (ver filters.js).
// ----------------------------------------------------------------------
export const ANALYSIS_VARIABLES = [
  { id: 'computadores_por_aluno', label: 'Computadores por aluno', type: 'continua' },
  { id: 'tablets_por_aluno', label: 'Tablets por aluno', type: 'continua' },
  { id: 'inse_media', label: 'INSE (nível socioeconômico)', type: 'continua' },
  { id: 'indice_infra_geral', label: 'Índice composto de infraestrutura', type: 'continua' },
  { id: 'in_internet', label: 'Acesso à internet', type: 'binaria' },
  { id: 'in_banda_larga', label: 'Banda larga', type: 'binaria' },
  { id: 'in_laboratorio_informatica', label: 'Laboratório de informática', type: 'binaria' },
  { id: 'in_laboratorio_ciencias', label: 'Laboratório de ciências', type: 'binaria' },
  { id: 'in_biblioteca', label: 'Biblioteca', type: 'binaria' },
  { id: 'in_quadra_esportes', label: 'Quadra de esportes', type: 'binaria' },
  { id: 'in_esgoto_rede_publica', label: 'Esgoto ligado à rede pública', type: 'binaria' },
  { id: 'in_refeitorio', label: 'Refeitório', type: 'binaria' },
  { id: 'in_parque_infantil', label: 'Parque infantil', type: 'binaria' },
  { id: 'in_sala_atendimento_especial', label: 'Sala de atendimento especializado (AEE)', type: 'binaria' },
  { id: 'in_acessibilidade_algum_recurso', label: 'Algum recurso de acessibilidade', type: 'binaria' },
];

// Nota metodológica do índice composto (aula 05/06: é uma variável derivada,
// não um indicador oficial do Inep) — mostrada quando essa variável é escolhida.
export const INFRA_INDEX_NOTE =
  'Índice calculado como a proporção de 10 indicadores binários de infraestrutura selecionados para esta análise. Não é um indicador oficial do Inep.';

export const SEGMENT_VARIABLES = [
  { id: 'nenhuma', label: 'Nenhuma' },
  { id: 'rede_ensino', label: 'Rede de ensino' },
  { id: 'localizacao', label: 'Localização' },
  { id: 'inse_classificacao', label: 'Classe INSE' },
];

// Rede de ensino: cor + forma FIXAS em toda a aplicação (scatter, legenda,
// dot-plot). Nunca reaproveitadas para outro significado (aula 07: canais de
// identidade — matiz de cor é o 2º mais efetivo depois de região espacial,
// que já está ocupada pelos eixos). Federal usa magenta (não o verde
// original) porque simulação de daltonismo (protanopia/deuteranopia) mostrou
// Federal x Municipal quase indistinguíveis com as cores antigas.
export const REDE_COLORS = {
  Federal: '#b23a6e',
  Estadual: '#9a5b12',
  Municipal: '#443f87',
};
export const REDE_SHAPES = {
  Federal: 'circle',
  Estadual: 'triangle',
  Municipal: 'square',
};
export const REDE_ORDER = ['Federal', 'Estadual', 'Municipal'];

// Paletas de segmentação para localização e classe INSE — deliberadamente
// diferentes do azul sequencial do mapa (Ideb) e das cores de rede, para não
// misturar os dois significados de cor que a aula 15 do material pede para
// manter separados. Localização também usa DOIS canais (cor + forma), igual
// a rede, para não depender só de cor.
export const LOCALIZACAO_COLORS = { Urbana: '#1a8f7d', Rural: '#c98a2c' };
export const LOCALIZACAO_SHAPES = { Urbana: 'circle', Rural: 'triangle' };

// Paleta de 8 tons para o dot-plot agregado (Seção "Ideb médio por
// segmentação") e para os painéis do modo small-multiples — a comparação ali
// usa POSIÇÃO (dot-plot) ou facetamento (small multiples), nunca as 8 cores
// sobrepostas no mesmo painel, que é exatamente o que essa paleta evita.
export const INSE_CLASS_COLOR_SCALE = ['#f2e9f5', '#dcc2e6', '#c19bd6', '#a473c6', '#8750b5', '#6c34a0', '#521f85', '#391066'];

export const NEUTRAL_POINT_COLOR = '#5f5e5a';

export const INSE_LEVELS = ['Nível I', 'Nível II', 'Nível III', 'Nível IV', 'Nível V', 'Nível VI', 'Nível VII', 'Nível VIII'];
export const INSE_LEVELS_DEFAULT = ['Nível III', 'Nível IV', 'Nível V', 'Nível VI'];

export const REGIOES = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC'],
};
export const TODAS_UFS = Object.values(REGIOES).flat().sort();

export const SMALL_SAMPLE_THRESHOLD = 30;

// Texto padrão do painel de destaques (Nível 3) — a distância nunca deve ser
// chamada de previsão nem "desempenho esperado" (ver critério 14 da revisão).
export const DISTANCIA_NOTE =
  'Indicador exploratório calculado em relação à média de Ideb da faixa da variável de análise no contexto filtrado. O valor de referência é recalculado a cada combinação de filtros ativos — uma mesma escola pode apresentar distâncias diferentes conforme o contexto de análise é alterado. Não é uma previsão estatística nem um "desempenho esperado" universal.';

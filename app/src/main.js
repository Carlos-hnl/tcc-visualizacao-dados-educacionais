// main.js — inicializa tudo e conecta o cross-filter entre os três níveis.
//
// Lógica analítica explícita (aula 13 — tarefas):
//   Nível 1 "Onde?"              -> distribuição espacial do Ideb.
//   Nível 2 "Como se relaciona?" -> variável de análise x Ideb, segmentado.
//   Nível 3 "Quais se destacam?" -> escolas selecionadas / destaques.

import { initDatabase, query, ANALYSIS_VARIABLES, SEGMENT_VARIABLES, INFRA_INDEX_NOTE, INSE_LEVELS, INSE_CLASS_COLOR_SCALE } from './data.js';
import { getState, subscribe, renderFilterBar, updateNCounter, toggleUf } from './filters.js';
import * as Q from './queries.js';
import { initMap, updateMap, setColorDomain, flashUf } from './map.js';
import {
  initScatter, renderContinuousPoints, renderDensity, renderTrend, renderStripPlot, renderSmallMultiples,
  renderCategoryDotPlot, getLegendItems, getScatterLegendItems, setHighlighted, clearSelection,
} from './scatter.js';
import { initComparison, renderSelecionadas, renderOutliers, highlightRow } from './comparison.js';
import { debounce, setLoading, setEmptyState, EMPTY_MESSAGES } from './ui.js';

const ui = {
  xVar: ANALYSIS_VARIABLES[0].id,
  segmentBy: 'nenhuma',
  scatterMode: 'pontos', // 'pontos' | 'densidade' | 'tendencia' (só p/ contínuas)
  level3Mode: 'selecionadas', // 'selecionadas' | 'outliers'
};
let lastSelectedRows = [];
let lastEtapaForColorDomain = null;

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function showErrorBanner(context, err) {
  console.error(`[${context}]`, err);
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#a3400c;color:#fff;padding:10px 16px;font-size:12px;font-family:var(--font-mono,monospace);z-index:300;max-height:35vh;overflow:auto;white-space:pre-wrap';
    document.body.appendChild(banner);
  }
  banner.innerHTML += `<div style="margin-bottom:6px">[${context}] ${escapeHtml(err?.message || String(err))}</div>`;
}

async function boot() {
  try {
    await initDatabase((msg) => {
      if (msg) document.querySelector('#app-init-overlay div').textContent = msg;
    });
  } catch (err) {
    document.getElementById('app-init-overlay').innerHTML =
      `<div style="max-width:420px;text-align:center">Não foi possível carregar o motor de consultas (DuckDB-Wasm). Verifique a conexão com a internet e recarregue a página.<br><br><span style="font-family:var(--font-mono);font-size:11px;color:var(--warn)">${escapeHtml(String(err))}</span></div>`;
    return;
  }

  renderFilterBar(document.getElementById('filter-bar'));
  populateVariableSelects();
  wireLevel2Controls();

  try {
    await initMap((uf) => toggleUf(uf));

    initScatter({
      onSelection: (points) => {
        lastSelectedRows = points.map((p) => ({
          co_entidade: p.id, no_entidade: p.nome, sg_uf: p.uf,
          rede_ensino: p.rede, ideb: p.ideb, x_valor: p.x, inse_media: p.inse,
          distancia: p.distancia ?? null,
        }));
        ui.level3Mode = 'selecionadas';
        syncLevel3Toggle();
        renderSelecionadas(lastSelectedRows, currentXLabel());
        updateLevel3Badges(lastSelectedRows.length, null);
        updateBrushHint(points.length === 0);
      },
      onClick: (id, uf) => highlightSchool(id, uf),
    });

    initComparison({
      onSelectSchool: (id, uf) => highlightSchool(id, uf),
    });
  } catch (err) {
    document.getElementById('app-init-overlay').innerHTML =
      `<div style="max-width:420px;text-align:center">Falha ao iniciar mapa/gráficos.<br><br><span style="font-family:var(--font-mono);font-size:11px;color:var(--warn)">${escapeHtml(String(err))}</span></div>`;
    console.error('[boot/init visualizações]', err);
    return;
  }

  document.getElementById('app-init-overlay').remove();
  document.getElementById('app-shell').style.visibility = 'visible';

  subscribe(debounce(() => refreshAll(), 180));
  refreshAll();
}

// ---------------------------------------------------------------------
// Controles do Nível 2: variável de análise (separada de segmentação) e
// modo de exibição; e do Nível 3.
// ---------------------------------------------------------------------
function populateVariableSelects() {
  const analysisSelect = document.getElementById('analysis-variable-select');
  const groups = { continua: 'Variáveis contínuas', binaria: 'Variáveis binárias' };
  Object.entries(groups).forEach(([type, label]) => {
    const og = document.createElement('optgroup');
    og.label = label;
    ANALYSIS_VARIABLES.filter((v) => v.type === type).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      og.appendChild(opt);
    });
    analysisSelect.appendChild(og);
  });
  analysisSelect.value = ui.xVar;

  const segmentSelect = document.getElementById('segment-select');
  SEGMENT_VARIABLES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    segmentSelect.appendChild(opt);
  });
  segmentSelect.value = ui.segmentBy;
}

// Domínio P1/P99, com fallback para min/max se os percentis vierem
// degenerados (ex.: variável quase constante no contexto filtrado). Usado
// tanto para o eixo visual quanto para o binning de tendência/densidade/
// destaques — os três precisam enxergar exatamente o mesmo domínio.
function computeAxisDomain(domRow) {
  let lo = domRow.p1_x, hi = domRow.p99_x;
  if (!(hi > lo)) { lo = domRow.min_x; hi = domRow.max_x; }
  if (hi <= lo) hi = lo + 1;
  return [lo, hi];
}

function currentXMeta() { return ANALYSIS_VARIABLES.find((v) => v.id === ui.xVar); }
function currentXLabel() { return currentXMeta()?.label || ui.xVar; }

function wireLevel2Controls() {
  document.getElementById('analysis-variable-select').addEventListener('change', (e) => {
    ui.xVar = e.target.value;
    updateScatterModeVisibility();
    refreshScatterAndLevel3();
  });

  document.getElementById('segment-select').addEventListener('change', (e) => {
    ui.segmentBy = e.target.value;
    refreshScatterAndLevel3();
  });

  document.getElementById('scatter-mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    ui.scatterMode = btn.dataset.mode;
    [...e.currentTarget.children].forEach((b) => b.classList.toggle('active', b === btn));
    refreshScatterAndLevel3();
  });

  document.getElementById('overplot-hint').addEventListener('click', () => {
    ui.scatterMode = 'densidade';
    document.querySelectorAll('#scatter-mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'densidade'));
    refreshScatterAndLevel3();
  });

  document.getElementById('level3-mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    ui.level3Mode = btn.dataset.mode;
    [...e.currentTarget.children].forEach((b) => b.classList.toggle('active', b === btn));
    syncLevel3Toggle();
    refreshLevel3Only();
  });

  updateScatterModeVisibility();
}

function updateScatterModeVisibility() {
  const isContinua = currentXMeta()?.type === 'continua';
  document.getElementById('scatter-mode-toggle').style.display = isContinua ? '' : 'none';
}

function syncLevel3Toggle() {
  document.querySelectorAll('#level3-mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === ui.level3Mode));
}

// ---------------------------------------------------------------------
// Destaque cruzado (Nível 3 -> Nível 2 / Nível 1, e scatter -> tabela) —
// destaque, nunca filtro: não altera o conjunto de dados em nenhuma vista.
// ---------------------------------------------------------------------
function highlightSchool(id, uf) {
  setHighlighted(id);
  highlightRow(id);
  if (uf) flashUf(uf);
}

// ---------------------------------------------------------------------
// Legenda e subtítulo dinâmicos do Nível 2 (título explica a tarefa —
// nunca "Gráfico" ou "Scatter" genéricos).
// ---------------------------------------------------------------------
// `presentValues` (Set) restringe a legenda aos rótulos que realmente
// aparecem nos dados retornados — se o filtro de INSE está em III–VI, a
// legenda nunca vai sugerir que I, II, VII, VIII estão participando.
function updateLegend(presentValues) {
  const el = document.getElementById('scatter-legend');
  if (!el) return;
  if (ui.scatterMode === 'densidade'
    || (currentXMeta()?.type === 'continua' && ui.scatterMode === 'tendencia')
    || (currentXMeta()?.type === 'continua' && ui.scatterMode === 'pontos' && ui.segmentBy === 'inse_classificacao')) {
    // small multiples (classe INSE) rotula cada painel por conta própria —
    // uma legenda à parte seria redundante.
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const items = getScatterLegendItems(ui.segmentBy, presentValues);
  el.innerHTML = items.map((it) => `
    <span class="legend-item">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${shapeSvg(it.shape, it.color)}</svg>
      ${escapeHtml(it.label)}
    </span>
  `).join('');
}

// Quais categorias de segmentação realmente aparecem no resultado atual —
// usado pra filtrar a legenda ao estado dos filtros (critério 4 da revisão).
function computePresentValues(points) {
  if (ui.segmentBy === 'nenhuma') return null;
  if (ui.segmentBy === 'rede_ensino') return new Set(points.map((p) => p.rede));
  return new Set(points.map((p) => p.seg).filter((v) => v != null));
}

function updateBrushHint(show) {
  const hint = document.getElementById('brush-hint');
  if (hint) hint.hidden = !show;
}

function shapeSvg(shape, color) {
  if (shape === 'triangle') return `<polygon points="6,1 11,10 1,10" fill="${color}"/>`;
  if (shape === 'square') return `<rect x="2" y="2" width="8" height="8" fill="${color}"/>`;
  return `<circle cx="6" cy="6" r="5" fill="${color}"/>`;
}

function updateSubtitle(extra) {
  const el = document.getElementById('scatter-subtitle');
  if (!el) return;
  const meta = currentXMeta();
  let text;
  if (meta.type === 'continua') {
    if (ui.scatterMode === 'pontos') {
      text = `Relação entre ${meta.label.toLowerCase()} e Ideb. Cada ponto representa uma escola pública no contexto filtrado.`;
    } else if (ui.scatterMode === 'densidade') {
      text = `Densidade de escolas por ${meta.label.toLowerCase()} e Ideb. Cada célula agrega várias escolas; as estatísticas usam o conjunto completo filtrado, não a grade.`;
    } else {
      text = `Ideb médio por faixa de ${meta.label.toLowerCase()}. As faixas agrupam escolas com valores semelhantes da variável selecionada. Não sugere causalidade.`;
    }
  } else {
    text = `Ideb de escolas com e sem ${meta.label.toLowerCase()}. Cada ponto representa uma escola pública no contexto filtrado.`;
  }
  if (meta.id === 'indice_infra_geral') text += ` ${INFRA_INDEX_NOTE}`;
  if (extra) text += ` ${extra}`;
  el.textContent = text;
}

// ---------------------------------------------------------------------
// Pipeline de consultas
// ---------------------------------------------------------------------
async function refreshAll() {
  const state = getState();
  setLoading('map-loading', true);
  setLoading('scatter-loading', true);

  try {
    if (state.etapa !== lastEtapaForColorDomain) {
      const domRow = (await query(Q.mapColorDomainQuery(state.etapa)))[0];
      if (domRow && domRow.min_ideb != null) setColorDomain(domRow.min_ideb, domRow.max_ideb);
      lastEtapaForColorDomain = state.etapa;
    }

    const [comIdebRows, totalRows, mapRows] = await Promise.all([
      query(Q.nCounterQuery(state)),
      query(Q.nTotalQuery(state)),
      query(Q.mapQuery(state)),
    ]);
    const nComIdeb = comIdebRows[0]?.n ?? 0;
    const nTotal = totalRows[0]?.n ?? 0;
    updateNCounter(nComIdeb, Math.max(0, nTotal - nComIdeb));
    updateMap(mapRows, state.ufs);
  } catch (err) {
    showErrorBanner('refreshAll (mapa/contador)', err);
    setLoading('map-loading', false);
    setLoading('scatter-loading', false);
    return;
  }

  await refreshScatterAndLevel3();
}

async function refreshScatterAndLevel3() {
  const state = getState();
  const meta = currentXMeta();
  setLoading('scatter-loading', true);
  clearSelection();
  lastSelectedRows = [];
  let extremeNote = '';

  try {
    if (meta.type === 'continua') {
      document.getElementById('scatter-mode-toggle').style.display = '';
      const domRow = (await query(Q.xDomainQuery(state, meta.id)))[0];
      if (!domRow || domRow.min_x == null) {
        setEmptyState('scatter-empty', EMPTY_MESSAGES.semVariavel);
        updateOverplotHint(null);
        updateBrushHint(false);
      } else {
        setEmptyState('scatter-empty', null);
        // Domínio ÚNICO para eixo E binning: P1/P99, não min/max reais. Com
        // outliers como o de ~11.111 computadores/aluno, binar em min–max faz
        // quase 100% dos dados caírem numa só faixa (span dominado pelo
        // outlier) — a "tendência" vira, na prática, só a média global.
        // P1/P99 evita isso: valores abaixo de P1 caem na primeira faixa,
        // acima de P99 caem na última — os extremos continuam nos cálculos
        // (entram na faixa de borda), só não esticam o domínio inteiro.
        const axisDomain = computeAxisDomain(domRow);
        const [axisLo, axisHi] = axisDomain;
        if (domRow.p1_x > domRow.min_x || domRow.p99_x < domRow.max_x) {
          extremeNote = 'Valores extremos são agregados nas faixas de borda (percentis 1–99) para preservar a legibilidade da tendência e da densidade; os cálculos usam todos os dados.';
        }

        // Bins usam o MESMO domínio do eixo (axisLo/axisHi) — usados também
        // para anotar a distância à tendência de cada ponto no modo "Pontos".
        const bins = await query(Q.trendQuery(state, meta.id, axisLo, axisHi));
        const binMean = new Map(bins.map((b) => [b.faixa, b.ideb_medio]));
        const span = axisHi > axisLo ? axisHi - axisLo : 1;
        const N_BINS = 16;
        const binOf = (x) => Math.min(N_BINS - 1, Math.max(0, Math.floor((x - axisLo) / span * N_BINS)));

        if (ui.scatterMode === 'pontos') {
          const rows = await query(Q.scatterPointsQuery(state, meta.id, ui.segmentBy));
          const points = rows.map((r) => {
            const bin = binOf(r.x_valor);
            const media = binMean.get(bin);
            return {
              id: r.co_entidade, nome: r.no_entidade, uf: r.sg_uf, rede: r.rede_ensino,
              ideb: r.ideb, x: r.x_valor, inse: r.inse_media, seg: r.seg_valor,
              distancia: media != null ? r.ideb - media : null,
            };
          });

          if (ui.segmentBy === 'inse_classificacao') {
            // Small multiples: nunca 8 cores no mesmo painel (aula 11) — um
            // painel por nível presente no filtro, mesma escala X/Y em todos.
            const presentLevels = INSE_LEVELS.filter((lvl) => points.some((p) => p.seg === lvl));
            const facets = presentLevels.map((lvl) => ({
              label: lvl,
              color: INSE_CLASS_COLOR_SCALE[INSE_LEVELS.indexOf(lvl)],
              points: points.filter((p) => p.seg === lvl),
            }));
            renderSmallMultiples(facets, meta.label, axisDomain);
            updateOverplotHint(null); // facetar já mitiga overplotting; trocar p/ densidade perderia o facetamento
            updateBrushHint(false); // sem brush no modo facetado (ver nota em scatter.js)
          } else {
            renderContinuousPoints(points, meta.label, axisDomain, ui.segmentBy);
            updateOverplotHint(points.length);
            updateBrushHint(lastSelectedRows.length === 0);
          }
          updateLegend(computePresentValues(points));
        } else if (ui.scatterMode === 'densidade') {
          // Mesmo domínio (axisLo/axisHi) usado pela query E pelo render —
          // antes a grade era calculada em min–max e desenhada em P1–P99,
          // dois sistemas de coordenadas diferentes (bug corrigido aqui).
          const grid = await query(Q.densityGridQuery(state, meta.id, axisLo, axisHi));
          renderDensity(grid, meta.label, axisDomain, 28, 16);
          updateOverplotHint(null);
          updateBrushHint(false);
          updateLegend(null);
        } else {
          // Mesmo domínio dos bins (axisDomain) — não o min–max real, senão
          // o eixo volta a esticar até o outlier e a linha encolhe pra um
          // traço colado na borda esquerda.
          renderTrend(bins, meta.label, axisDomain);
          updateOverplotHint(null);
          updateBrushHint(false);
          updateLegend(null);
        }
      }
    } else {
      document.getElementById('scatter-mode-toggle').style.display = 'none';
      updateOverplotHint(null);
      updateBrushHint(false); // strip-plot não tem brush
      const [rows, summaryRows] = await Promise.all([
        query(Q.binaryStripQuery(state, meta.id, ui.segmentBy)),
        query(Q.categorySummaryQuery(state, meta.id, true)),
      ]);
      if (rows.length === 0) {
        setEmptyState('scatter-empty', EMPTY_MESSAGES.semVariavel);
        updateLegend(null);
      } else {
        setEmptyState('scatter-empty', null);
        const points = rows.map((r) => ({
          id: r.co_entidade, nome: r.no_entidade, uf: r.sg_uf, rede: r.rede_ensino,
          ideb: r.ideb, inse: r.inse_media, seg: r.seg_valor, categoria: r.categoria,
        }));
        const summaryByCat = new Map(summaryRows.map((s) => [s.categoria, s]));
        renderStripPlot(points, meta.label, summaryByCat, ui.segmentBy);
        updateLegend(computePresentValues(points));
      }
    }
    updateSubtitle(extremeNote);
    await refreshSegmentSummaryPanel();
  } catch (err) {
    showErrorBanner('refreshScatterAndLevel3 (scatter)', err);
    setLoading('scatter-loading', false);
    return;
  }
  setLoading('scatter-loading', false);

  await refreshLevel3Only();
}

// Painel de segmentação: dot-plot comparativo (só posição) de Ideb médio por
// categoria — aparece sempre que "Segmentar por" está ativo, complementando
// o gráfico principal (critério 11 da revisão).
async function refreshSegmentSummaryPanel() {
  const container = document.getElementById('segment-summary');
  const wrap = document.getElementById('segment-summary-wrap');
  if (!container || !wrap) return;

  if (ui.segmentBy === 'nenhuma') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const state = getState();
  const label = SEGMENT_VARIABLES.find((s) => s.id === ui.segmentBy)?.label || ui.segmentBy;
  document.getElementById('segment-summary-title').textContent = `Ideb médio por ${label.toLowerCase()}`;

  const rows = await query(Q.categorySummaryQuery(state, ui.segmentBy, false));
  const colorFn = (cat) => {
    const items = getLegendItems(ui.segmentBy);
    return items.find((it) => it.label === cat)?.color || '#5f5e5a';
  };
  renderCategoryDotPlot(container, rows, label, colorFn);
}

// Acima desse N, pontos individuais tendem a virar uma mancha sólida mesmo
// com transparência e canvas (aula 10 — overplotting). Em vez de só deixar
// confuso, a interface oferece a saída: trocar para densidade agregada.
const OVERPLOT_HINT_THRESHOLD = 6000;

function updateOverplotHint(n) {
  const hint = document.getElementById('overplot-hint');
  const text = document.getElementById('overplot-hint-text');
  if (!hint) return;
  if (n != null && n > OVERPLOT_HINT_THRESHOLD) {
    text.textContent = `${n.toLocaleString('pt-BR')} escolas sobrepostas nesta visualização — pontos individuais ficam difíceis de ler nesta escala.`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function updateLevel3Badges(nSelecionadas, nDestaques) {
  const bSel = document.getElementById('badge-selecionadas');
  const bDest = document.getElementById('badge-destaques');
  if (bSel && nSelecionadas != null) bSel.textContent = nSelecionadas;
  if (bDest && nDestaques != null) bDest.textContent = nDestaques;
}

async function refreshLevel3Only() {
  const state = getState();
  const meta = currentXMeta();

  if (ui.level3Mode === 'selecionadas') {
    renderSelecionadas(lastSelectedRows, currentXLabel());
    updateLevel3Badges(lastSelectedRows.length, null);
    return;
  }

  // Destaques (outliers) — só faz sentido para variáveis contínuas (a
  // faixa/bin exige uma variável numérica de análise).
  if (meta.type !== 'continua') {
    document.getElementById('level3-content').innerHTML =
      '<div class="empty-state" style="margin:0 auto">Os destaques comparam escolas à tendência de uma variável de análise contínua. Selecione uma variável contínua (ex.: computadores por aluno, INSE) para ver os destaques.</div>';
    updateLevel3Badges(null, 0);
    return;
  }

  try {
    const domRow = (await query(Q.xDomainQuery(state, meta.id)))[0];
    if (!domRow || domRow.min_x == null) {
      document.getElementById('level3-content').innerHTML = `<div class="empty-state" style="margin:0 auto">${EMPTY_MESSAGES.semVariavel}</div>`;
      updateLevel3Badges(null, 0);
      return;
    }
    // Mesmo domínio P1/P99 usado no scatter/tendência/densidade — ver
    // computeAxisDomain(). Sem isso, a "distância à tendência" dos destaques
    // comparava cada escola a uma média de faixa calculada em min–max (quase
    // toda faixa 0, por causa do outlier de ~11.111), não P1–P99.
    const [outLo, outHi] = computeAxisDomain(domRow);
    const rows = await query(Q.outliersQuery(state, meta.id, outLo, outHi));
    renderOutliers(rows, currentXLabel());
    updateLevel3Badges(null, rows.length);
  } catch (err) {
    showErrorBanner('refreshLevel3Only (outliers)', err);
  }
}

window.addEventListener('unhandledrejection', (event) => {
  showErrorBanner('erro não tratado', event.reason);
  setLoading('map-loading', false);
  setLoading('scatter-loading', false);
});

boot();

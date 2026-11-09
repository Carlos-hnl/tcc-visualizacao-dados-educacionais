// scatter.js — Nível 2 ("Como se relaciona?"): dispersão (canvas, para
// performance com dezenas de milhares de pontos), densidade agregada,
// tendência ("Ideb médio por faixa") e dot/strip-plot para variáveis
// binárias. Eixos, brush e marcas de resumo sempre em SVG sobre o canvas.
//
// Estados do marcador (aula 12 — seleção/destaque):
//   normal            -> cor+forma da segmentação, opacidade moderada
//   hover             -> mesma cor+forma, contorno fino
//   selecionado(brush) -> mesma cor+forma, contorno mais forte
//   destaque cruzado  -> mesma cor+forma, halo maior
// A forma NUNCA muda de estado para estado — ela significa só rede de ensino.

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import { hexbin as d3Hexbin } from 'https://cdn.jsdelivr.net/npm/d3-hexbin@0.2/+esm';
import {
  REDE_COLORS, REDE_SHAPES, REDE_ORDER, LOCALIZACAO_COLORS, LOCALIZACAO_SHAPES,
  INSE_CLASS_COLOR_SCALE, INSE_LEVELS, NEUTRAL_POINT_COLOR,
} from './data.js';
import { showTooltip, hideTooltip, fmtIdeb, fmtDec, fmtN } from './ui.js';

// Redução de 8 para 4 tons — só usada onde classe INSE ainda precisa de UM
// canal de cor dentro de um painel só (o strip-plot de variável binária).
// No scatter contínuo, a classe INSE agora vira small multiples (ver
// renderSmallMultiples), que não precisa dessa redução — cada painel usa só
// uma cor porque já é um recorte por nível.
const INSE_STRIP_GROUP_COLORS = ['#c9a7de', '#9c5fc2', '#6f3aa3', '#3d1f66'];
function inseGroupIndex(levelIdx) { return Math.min(3, Math.floor(levelIdx / 2)); }

const MARGIN = { top: 10, right: 16, bottom: 40, left: 48 };

let canvas, ctx, svg, wrap;
let width = 0, height = 0;
let xScale, yScale; // escala ATUAL (já com zoom aplicado, quando houver)
let baseXScale, baseYScale; // escala original (domínio dos dados), nunca muda com zoom
let zoomTransform = d3.zoomIdentity;
let zoomBehavior = null;
let quadtree = null;
let currentPoints = [];
let selectedIds = new Set();
let highlightedId = null;
let hoveredId = null;
let onSelectionChange = null;
let onPointClick = null;
let currentSegmentBy = 'nenhuma';
let rafScheduled = false;
let loessCurve = []; // curva suavizada (LOESS) em espaço de DADO, recalculada só quando os dados mudam

export function initScatter({ onSelection, onClick } = {}) {
  wrap = document.getElementById('scatter-wrap');
  canvas = document.getElementById('scatter-canvas');
  svg = d3.select('#scatter-overlay');
  ctx = canvas.getContext('2d');
  onSelectionChange = onSelection;
  onPointClick = onClick;

  new ResizeObserver(() => resize()).observe(wrap);
  resize();
}

function resize() {
  width = wrap.clientWidth || 600;
  height = Math.max(wrap.clientHeight, 340);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
  redrawCurrent();
}

let lastRender = null;
function redrawCurrent() { if (lastRender) lastRender(); }

function innerW() { return width - MARGIN.left - MARGIN.right; }
function innerH() { return height - MARGIN.top - MARGIN.bottom; }

function clearAll() {
  ctx.clearRect(0, 0, width, height);
  svg.selectAll('*').remove();
  // d3.zoom() e attachHover() anexam seus listeners (wheel/mousedown/
  // mousemove/click/etc.) direto no <svg> raiz, não nos filhos —
  // selectAll('*').remove() não os limpa sozinho. Sem isso, trocar de modo
  // (ex.: Pontos individuais -> Densidade) deixava o hover da visualização
  // anterior ainda ativo por baixo da nova: o tooltip com nome/UF/rede da
  // escola (de attachHover, modo Pontos) continuava aparecendo no modo
  // Densidade, por cima do tooltip correto de cada hexágono.
  svg.on('.zoom', null);
  svg.on('.hover', null);
  svg.on('.pick', null);
}

function drawAxes(xLabel, yLabel, xIsBand) {
  const g = svg.append('g');
  const gx = g.append('g').attr('class', 'axis-x').attr('transform', `translate(${MARGIN.left},${MARGIN.top + innerH()})`);
  const gy = g.append('g').attr('class', 'axis-y').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  if (xIsBand) gx.call(d3.axisBottom(xScale));
  else gx.call(d3.axisBottom(xScale).ticks(6));
  gy.call(d3.axisLeft(yScale).ticks(6));

  g.selectAll('.domain, .tick line').attr('stroke', '#b9bab2');
  g.selectAll('text').attr('fill', '#4d514e').style('font-size', '11px').style('font-family', 'IBM Plex Sans');

  svg.append('text')
    .attr('x', MARGIN.left + innerW() / 2).attr('y', height - 6)
    .attr('text-anchor', 'middle').style('font-size', '11px').attr('fill', '#4d514e')
    .text(xLabel);
  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(MARGIN.top + innerH() / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').style('font-size', '11px').attr('fill', '#4d514e')
    .text(yLabel);

  return g;
}

// ---------------------------------------------------------------------
// Cor + forma por segmentação (centralizado — usado pelo scatter, pelo
// strip-plot e pela legenda, sempre a mesma definição).
// ---------------------------------------------------------------------
function visualFor(d, segmentBy) {
  if (segmentBy === 'rede_ensino') {
    return { color: REDE_COLORS[d.rede] || NEUTRAL_POINT_COLOR, shape: REDE_SHAPES[d.rede] || 'circle' };
  }
  if (segmentBy === 'localizacao') {
    return { color: LOCALIZACAO_COLORS[d.seg] || NEUTRAL_POINT_COLOR, shape: LOCALIZACAO_SHAPES[d.seg] || 'circle' };
  }
  if (segmentBy === 'inse_classificacao') {
    // Só chega aqui no strip-plot (variável binária); no scatter contínuo,
    // classe INSE vira small multiples (renderSmallMultiples), sem cor.
    const idx = INSE_LEVELS.indexOf(d.seg);
    return { color: idx >= 0 ? INSE_STRIP_GROUP_COLORS[inseGroupIndex(idx)] : NEUTRAL_POINT_COLOR, shape: 'circle' };
  }
  return { color: NEUTRAL_POINT_COLOR, shape: 'circle' };
}

// Usado pelo dot-plot agregado (Seção "Ideb médio por segmentação"), que tem
// uma linha por nível — precisa das cores "verdadeiras" (8 tons), porque ali
// a posição, não a cor, carrega a precisão da comparação.
export function getLegendItems(segmentBy) {
  if (segmentBy === 'rede_ensino') {
    return REDE_ORDER.map((r) => ({ label: r, color: REDE_COLORS[r], shape: REDE_SHAPES[r] }));
  }
  if (segmentBy === 'localizacao') {
    return Object.entries(LOCALIZACAO_COLORS).map(([label, color]) => ({ label, color, shape: LOCALIZACAO_SHAPES[label] }));
  }
  if (segmentBy === 'inse_classificacao') {
    return INSE_LEVELS.map((label, i) => ({ label, color: INSE_CLASS_COLOR_SCALE[i], shape: 'circle' }));
  }
  return [{ label: 'Todas as escolas', color: NEUTRAL_POINT_COLOR, shape: 'circle' }];
}

// Legenda do scatter/strip-plot. `presentValues`, quando informado, restringe
// a lista aos rótulos que realmente aparecem no resultado atual — assim a
// legenda nunca sugere que um nível excluído pelo filtro (ex.: INSE III–VI
// ativo, mas a legenda mostrando I a VIII) está participando da visualização.
export function getScatterLegendItems(segmentBy, presentValues) {
  let items;
  if (segmentBy === 'inse_classificacao') {
    const groupLabels = ['Níveis I–II', 'Níveis III–IV', 'Níveis V–VI', 'Níveis VII–VIII'];
    items = groupLabels.map((label, i) => ({ label, color: INSE_STRIP_GROUP_COLORS[i], shape: 'circle' }));
    if (presentValues) {
      const presentGroups = new Set([...presentValues].map((lvl) => inseGroupIndex(INSE_LEVELS.indexOf(lvl))));
      items = items.filter((_, i) => presentGroups.has(i));
    }
    return items;
  }
  items = getLegendItems(segmentBy);
  if (presentValues) items = items.filter((it) => presentValues.has(it.label));
  return items;
}

function drawShape(c, shape, cx, cy, r) {
  c.beginPath();
  if (shape === 'triangle') {
    const h = r * 1.25;
    c.moveTo(cx, cy - h);
    c.lineTo(cx - h * 0.95, cy + h * 0.75);
    c.lineTo(cx + h * 0.95, cy + h * 0.75);
    c.closePath();
  } else if (shape === 'square') {
    const s = r * 1.7;
    c.rect(cx - s / 2, cy - s / 2, s, s);
  } else {
    c.arc(cx, cy, r, 0, 2 * Math.PI);
  }
}

// ---------------------------------------------------------------------
// Modo "Pontos individuais" — variável de análise contínua
// ---------------------------------------------------------------------
export function renderContinuousPoints(points, xLabel, domain, segmentBy) {
  currentPoints = points;
  currentSegmentBy = segmentBy;
  selectedIds = new Set();
  hoveredId = null;
  zoomTransform = d3.zoomIdentity; // trocar variável/filtro reseta o zoom
  updateSelectionCounter();

  baseXScale = d3.scaleLinear().domain(domain).range([0, innerW()]).nice().clamp(true);
  baseYScale = d3.scaleLinear().domain([0, 10]).range([innerH(), 0]);
  xScale = baseXScale;
  yScale = baseYScale;

  // Em espaço de DADO (x, ideb) — recalculada só aqui (dados/filtro mudaram),
  // não a cada repaint de zoom/hover; o desenho (drawLoessCurve) é que
  // reprojeta pela escala atual a cada repaint, sem precisar reajustar a curva.
  loessCurve = computeLoess(points, baseXScale.domain());

  rebuildQuadtreeForZoom();

  lastRender = () => paintPoints();
  clearAll();
  drawAxes(xLabel, 'Ideb');
  paintPoints();
  drawLoessCurve(POINTS_LOESS_STROKE);
  attachBrush();
  attachHover();
  attachZoom();
}

// ---------------------------------------------------------------------
// Zoom e pan — só no modo "Pontos individuais" (contínuo). Navegação
// restrita (aula 11/livro cap. 11): escala limitada e panorâmica presa aos
// limites do próprio gráfico, para não deixar o usuário "se perder" fora
// dos dados. Zoom só por roda do mouse (scroll) — o arraste continua
// reservado exclusivamente para o brush de seleção, sem conflito entre os
// dois gestos.
function attachZoom() {
  zoomBehavior = d3.zoom()
    .scaleExtent([1, 30])
    .translateExtent([[0, 0], [innerW(), innerH()]])
    .filter((event) => event.type === 'wheel')
    .on('zoom', (event) => {
      zoomTransform = event.transform;
      xScale = zoomTransform.rescaleX(baseXScale);
      yScale = zoomTransform.rescaleY(baseYScale);
      updateAxesForZoom();
      rebuildQuadtreeForZoom();
      paintPoints();
      drawLoessCurve(POINTS_LOESS_STROKE);
      toggleZoomResetButton();
    });
  svg.call(zoomBehavior);
}

function updateAxesForZoom() {
  svg.select('.axis-x').call(d3.axisBottom(xScale).ticks(6));
  svg.select('.axis-y').call(d3.axisLeft(yScale).ticks(6));
  svg.selectAll('.axis-x .domain, .axis-x .tick line, .axis-y .domain, .axis-y .tick line').attr('stroke', '#b9bab2');
  svg.selectAll('.axis-x text, .axis-y text').attr('fill', '#4d514e').style('font-size', '11px').style('font-family', 'IBM Plex Sans');
}

function rebuildQuadtreeForZoom() {
  const domain = xScale.domain();
  quadtree = d3.quadtree()
    .x((d) => xScale(d.x) + clampJitter(d, domain))
    .y((d) => yScale(d.ideb))
    .addAll(currentPoints);
}

function toggleZoomResetButton() {
  const btn = document.getElementById('zoom-reset');
  if (btn) btn.hidden = zoomTransform.k === 1 && zoomTransform.x === 0 && zoomTransform.y === 0;
}

// Botão "Resetar zoom" (index.html) chama esta função.
export function resetZoom() {
  if (!zoomBehavior || !svg) return;
  svg.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
}

// ---------------------------------------------------------------------
// Small multiples — variável de análise contínua, segmentada por Classe
// INSE. Em vez de 8 cores sobrepostas no mesmo painel (que colapsam sob
// transparência — aula 11), um painel pequeno por nível, todos com a MESMA
// escala X e Y, na mesma posição relativa, para manter comparabilidade.
// Mostra só os níveis presentes no filtro atual (nunca os 8 fixos).
// Sem brush aqui (seleção por arraste em 4–8 paineis pequenos não compensa a
// complexidade) — hover e clique (identificar/destacar) continuam ativos.
// ---------------------------------------------------------------------
export function renderSmallMultiples(facets, xLabel, domain) {
  currentSegmentBy = 'inse_classificacao';
  selectedIds = new Set();
  hoveredId = null;
  updateSelectionCounter();
  clearAll();

  const cols = facets.length > 1 ? 2 : 1;
  const rows = Math.ceil(facets.length / cols);
  const gap = 10;
  const panelW = (innerW() - gap * (cols - 1)) / cols;
  const panelH = (innerH() - gap * (rows - 1)) / rows;
  const pMargin = { top: 20, right: 6, bottom: 22, left: 34 };

  const localX = d3.scaleLinear().domain(domain).range([0, panelW - pMargin.left - pMargin.right]).nice().clamp(true);
  const renderedDomain = localX.domain();
  const localY = d3.scaleLinear().domain([0, 10]).range([panelH - pMargin.top - pMargin.bottom, 0]);
  xScale = localX; yScale = localY;

  const g = svg.append('g');
  const allPoints = [];

  facets.forEach((facet, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const ox = col * (panelW + gap), oy = row * (panelH + gap);
    const panelX = MARGIN.left + ox, panelY = MARGIN.top + oy;

    g.append('rect')
      .attr('x', panelX).attr('y', panelY).attr('width', panelW).attr('height', panelH)
      .attr('fill', 'none').attr('stroke', '#e3e8f1');
    g.append('rect')
      .attr('x', panelX + 2).attr('y', panelY + 5).attr('width', 7).attr('height', 7)
      .attr('fill', facet.color);
    g.append('text')
      .attr('x', panelX + 13).attr('y', panelY + 12)
      .style('font-size', '11px').style('font-weight', '600').attr('fill', '#16213a')
      .text(`${facet.label} (n=${fmtN(facet.points.length)})`);

    const px0 = panelX + pMargin.left, py0 = panelY + pMargin.top;

    if (row === rows - 1) {
      g.append('g').attr('transform', `translate(${px0},${py0 + localY.range()[0]})`)
        .call(d3.axisBottom(localX).ticks(3))
        .selectAll('text').style('font-size', '9px').attr('fill', '#4d514e');
    }
    if (col === 0) {
      g.append('g').attr('transform', `translate(${px0},${py0})`)
        .call(d3.axisLeft(localY).ticks(4))
        .selectAll('text').style('font-size', '9px').attr('fill', '#4d514e');
    }

    facet.points.forEach((d) => {
      allPoints.push({
        ...d,
        _cx: px0 + localX(d.x) + clampJitter(d, renderedDomain),
        _cy: py0 + localY(d.ideb),
        _color: facet.color,
      });
    });
  });

  g.selectAll('.domain, .tick line').attr('stroke', '#e3e8f1');
  svg.append('text')
    .attr('x', MARGIN.left + innerW() / 2).attr('y', height - 4)
    .attr('text-anchor', 'middle').style('font-size', '11px').attr('fill', '#4d514e')
    .text(`${xLabel} (mesma escala em todos os painéis)`);

  currentPoints = allPoints;
  quadtree = d3.quadtree().x((d) => d._cx).y((d) => d._cy).addAll(allPoints);

  lastRender = () => paintFacetPoints();
  paintFacetPoints();
  attachFacetHover();
}

function paintFacetPoints() {
  ctx.clearRect(0, 0, width, height);
  const baseAlpha = baseAlphaFor(currentPoints.length);
  const R = 2.3;
  currentPoints.forEach((d) => {
    const isHi = d.id === highlightedId;
    const isHover = d.id === hoveredId;
    if (isHi) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(d._cx, d._cy, R * 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#3b6fd4'; ctx.fill();
    }
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath(); ctx.arc(d._cx, d._cy, isHi ? R * 1.7 : R, 0, 2 * Math.PI);
    ctx.fillStyle = d._color; ctx.fill();
    if (isHi || isHover) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = isHi ? 2 : 1;
      ctx.strokeStyle = '#1b1d1c';
      ctx.beginPath(); ctx.arc(d._cx, d._cy, isHi ? R * 1.7 : R, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
}

function attachFacetHover() {
  function handleMove(event) {
    const [mx, my] = d3.pointer(event, svg.node());
    const d = quadtree.find(mx, my, 14);
    const newHoverId = d ? d.id : null;
    if (newHoverId !== hoveredId) { hoveredId = newHoverId; scheduleHoverRepaint(); }
    if (d) showTooltip(pointTooltipHtml(d), event.clientX, event.clientY);
    else hideTooltip();
  }
  svg.on('mousemove.hover', handleMove);
  svg.on('mouseleave.hover', () => { if (hoveredId != null) { hoveredId = null; scheduleHoverRepaint(); } hideTooltip(); });
  svg.on('click.pick', (event) => {
    const [mx, my] = d3.pointer(event, svg.node());
    const d = quadtree?.find(mx, my, 14);
    if (d) onPointClick?.(d.id);
  });
}

// Opacidade adaptativa: quanto mais pontos, mais transparente cada um —
// mitiga overplotting (aula 10) sem esconder a forma/cor de nenhum ponto.
function baseAlphaFor(n) {
  if (n > 8000) return 0.32;
  if (n > 2000) return 0.5;
  if (n > 500) return 0.65;
  return 0.8;
}

// Pontos além do domínio do eixo (P1/P99) ficam "presos" (clamp) no mesmo
// pixel da borda — sem isso, dezenas de valores bem diferentes (do P99 real
// até o outlier de ~11.111) desenhariam uma linha sólida enganosa, como se
// fosse um agrupamento real no eixo X. O jitter é só visual (não muda x_valor
// nem nenhum cálculo) e só se aplica a quem realmente foi clampado.
const CLAMP_JITTER_PX = 7;
function clampJitter(d, domain) {
  if (d.x >= domain[0] && d.x <= domain[1]) return 0;
  return (hashId(d.id) - 0.5) * 2 * CLAMP_JITTER_PX;
}

// Opacidade do preenchimento, só em "Pontos individuais": ajuda a mitigar
// overplotting sem apagar demais o padrão geral — a borda de cada ponto
// (abaixo, em paintPoints) fica sempre 100% opaca na mesma cor, então o
// contorno continua bem legível mesmo com o preenchimento mais sutil.
function pointsAlphaFor(n) {
  if (n > 8000) return 0.35;
  if (n > 2000) return 0.42;
  if (n > 500) return 0.5;
  return 0.55;
}

const POINTS_RADIUS = 2.3;
// Em "Pontos individuais" a nuvem de pontos é mais fraca (opacidade baixa),
// então a LOESS precisa de mais peso visual pra continuar legível por cima;
// em Densidade os hexágonos já têm bastante cor, então a linha ali fica no
// traço padrão (drawLoessCurve(), sem argumento).
const POINTS_LOESS_STROKE = 3;

function paintPoints() {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(MARGIN.left, MARGIN.top);
  const hasSelection = selectedIds.size > 0;
  const baseAlpha = pointsAlphaFor(currentPoints.length);
  const R = POINTS_RADIUS;
  const domain = xScale.domain();

  currentPoints.forEach((d) => {
    const cx = xScale(d.x) + clampJitter(d, domain), cy = yScale(d.ideb);
    const isSel = selectedIds.has(d.id);
    const isHi = d.id === highlightedId;
    const isHover = d.id === hoveredId;
    const { color, shape } = visualFor(d, currentSegmentBy);

    // Destaque cruzado: halo maior atrás do marcador, sempre a mesma forma.
    if (isHi) {
      ctx.globalAlpha = 0.28;
      drawShape(ctx, shape, cx, cy, R * 3.4);
      ctx.fillStyle = '#3b6fd4';
      ctx.fill();
    }

    const rad = isHi ? R * 1.6 : isSel ? R * 1.3 : R;

    // Selecionadas (brush) e destacadas sempre em preenchimento cheio —
    // contra o fundo mais sutil, continuam se destacando claramente.
    if (isSel || isHi) ctx.globalAlpha = 1;
    else ctx.globalAlpha = hasSelection ? Math.min(baseAlpha, 0.25) : baseAlpha;
    drawShape(ctx, shape, cx, cy, rad);
    ctx.fillStyle = color;
    ctx.fill();

    // Borda sempre 100% opaca, na mesma cor do ponto — mantém o contorno
    // nítido mesmo quando o preenchimento está translúcido.
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = color;
    drawShape(ctx, shape, cx, cy, rad);
    ctx.stroke();

    // Seleção/destaque/hover: contorno adicional, mais grosso e em cor
    // neutra, por cima da borda colorida — reforça o estado sem escondê-la.
    if (isSel || isHi || isHover) {
      ctx.lineWidth = isHi ? 2.2 : isSel ? 1.4 : 1;
      ctx.strokeStyle = isHi ? '#1b1d1c' : isSel ? '#1b1d1c' : '#4d514e';
      drawShape(ctx, shape, cx, cy, rad);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------
// Tendência local (LOESS) — só no modo "Pontos individuais", variável
// contínua. Suavização não-paramétrica (regressão linear ponderada por
// kernel tricúbico, grau 1) ao longo de uma grade de pontos no eixo X.
// Diferente do modo "Ideb médio por faixa" (que agrega em faixas largas e
// discretas), a LOESS acompanha o formato local da nuvem de pontos de forma
// contínua — mas continua sendo só uma suavização visual: não é regressão
// preditiva, não estima um valor "esperado" e não implica causalidade (ver
// mesmas ressalvas de DISTANCIA_NOTE/INFRA_INDEX_NOTE em data.js).
// A faixa sombreada ao redor da linha é a dispersão local (desvio-padrão
// ponderado dos resíduos na janela), não um intervalo de confiança formal.
// ---------------------------------------------------------------------
function computeLoess(points, domain, span = 0.3, gridSize = 60) {
  const n = points.length;
  if (n < 20) return []; // poucos pontos: a curva ficaria instável/enganosa
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.ideb);
  const k = Math.max(15, Math.floor(span * n));
  const [lo, hi] = domain;
  if (!(hi > lo)) return [];

  const order = d3.range(n).sort((a, b) => xs[a] - xs[b]);
  const sortedX = order.map((i) => xs[i]);
  const grid = d3.range(gridSize + 1).map((i) => lo + ((hi - lo) * i) / gridSize);

  return grid.map((gx) => {
    // janela dos k pontos com x mais próximo de gx
    const i0 = d3.bisectLeft(sortedX, gx);
    let loI = Math.max(0, i0 - Math.floor(k / 2));
    const hiI = Math.min(n, loI + k);
    loI = Math.max(0, hiI - k);
    const idxs = order.slice(loI, hiI);
    if (idxs.length < 5) return null;

    const dmax = d3.max(idxs, (i) => Math.abs(xs[i] - gx)) || 1;
    let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
    idxs.forEach((i) => {
      const dn = Math.abs(xs[i] - gx) / dmax;
      const w = dn < 1 ? (1 - dn ** 3) ** 3 : 0; // kernel tricúbico
      sw += w; swx += w * xs[i]; swy += w * ys[i];
      swxx += w * xs[i] * xs[i]; swxy += w * xs[i] * ys[i];
    });
    if (sw <= 0) return null;

    // regressão linear ponderada local (grau 1)
    const denom = sw * swxx - swx * swx;
    let slope = 0;
    let intercept = swy / sw;
    if (Math.abs(denom) > 1e-9) {
      slope = (sw * swxy - swx * swy) / denom;
      intercept = (swy - slope * swx) / sw;
    }
    const yHat = intercept + slope * gx;

    let swres = 0;
    idxs.forEach((i) => {
      const dn = Math.abs(xs[i] - gx) / dmax;
      const w = dn < 1 ? (1 - dn ** 3) ** 3 : 0;
      const fitted = intercept + slope * xs[i];
      swres += w * (ys[i] - fitted) ** 2;
    });
    const sd = Math.sqrt(swres / sw);

    return { x: gx, y: Math.max(0, Math.min(10, yHat)), sd };
  }).filter(Boolean);
}

function drawLoessCurve(strokeWidth = 2) {
  svg.selectAll('.loess-layer').remove();
  if (loessCurve.length < 2) return;

  const g = svg.append('g')
    .attr('class', 'loess-layer')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)
    .attr('pointer-events', 'none'); // nunca captura brush/hover — é só leitura visual

  const area = d3.area()
    .x((d) => xScale(d.x))
    .y0((d) => yScale(Math.max(0, d.y - d.sd)))
    .y1((d) => yScale(Math.min(10, d.y + d.sd)))
    .curve(d3.curveMonotoneX);
  g.append('path').datum(loessCurve).attr('d', area)
    .attr('fill', '#1b2a52').attr('fill-opacity', 0.1).attr('stroke', 'none');

  const line = d3.line()
    .x((d) => xScale(d.x))
    .y((d) => yScale(d.y))
    .curve(d3.curveMonotoneX);
  g.append('path').datum(loessCurve).attr('d', line)
    .attr('fill', 'none').attr('stroke', '#1b2a52')
    .attr('stroke-width', strokeWidth).attr('stroke-dasharray', '2,3');
}

function attachBrush() {
  const brush = d3.brush()
    .extent([[0, 0], [innerW(), innerH()]])
    .on('end', (event) => {
      if (!event.selection) {
        selectedIds = new Set();
        updateSelectionCounter();
        paintPoints();
        onSelectionChange?.([]);
        return;
      }
      const [[x0, y0], [x1, y1]] = event.selection;
      const brushDomain = xScale.domain();
      const sel = currentPoints.filter((d) => {
        const cx = xScale(d.x) + clampJitter(d, brushDomain), cy = yScale(d.ideb);
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      });
      selectedIds = new Set(sel.map((d) => d.id));
      updateSelectionCounter();
      paintPoints();
      onSelectionChange?.(sel);
    });

  svg.append('g')
    .attr('class', 'brush-layer')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)
    .call(brush);
}

function scheduleHoverRepaint() {
  if (rafScheduled) return;
  rafScheduled = true;
  // lastRender (não paintPoints direto): precisa valer pro modo ativo
  // correto (pontos, strip-plot ou small multiples).
  requestAnimationFrame(() => { rafScheduled = false; if (lastRender) lastRender(); });
}

function attachHover() {
  function handleMove(event) {
    const [mx, my] = d3.pointer(event, svg.node());
    const x = mx - MARGIN.left, y = my - MARGIN.top;
    const d = quadtree.find(x, y, 16);
    const newHoverId = d ? d.id : null;
    if (newHoverId !== hoveredId) {
      hoveredId = newHoverId;
      scheduleHoverRepaint();
    }
    if (d) showTooltip(pointTooltipHtml(d), event.clientX, event.clientY);
    else hideTooltip();
  }
  svg.on('mousemove.hover', handleMove);
  svg.on('mouseleave.hover', () => {
    if (hoveredId != null) { hoveredId = null; scheduleHoverRepaint(); }
    hideTooltip();
  });
  svg.on('click.pick', (event) => {
    const [mx, my] = d3.pointer(event, svg.node());
    const x = mx - MARGIN.left, y = my - MARGIN.top;
    const d = quadtree?.find(x, y, 16);
    if (d) onPointClick?.(d.id);
  });
}

function pointTooltipHtml(d) {
  const distancia = d.distancia != null ? `<br>Distância à tendência: ${d.distancia > 0 ? '+' : ''}${fmtDec(d.distancia)}` : '';
  return `<div class="t-title">${escapeHtml(d.nome)}</div>
    ${d.uf} · ${d.rede}<br>
    Ideb: ${fmtIdeb(d.ideb)}<br>
    Valor da variável de análise: ${fmtDec(d.x)}<br>
    INSE: ${d.inse == null ? 'não calculado' : fmtDec(d.inse)}${distancia}`;
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function updateSelectionCounter() {
  const el = document.getElementById('selection-counter');
  if (!el) return;
  el.textContent = selectedIds.size > 0 ? `${selectedIds.size} escolas selecionadas` : '';
}

// ---------------------------------------------------------------------
// Modo "Densidade" — agregação 2D (hexbin, d3-hexbin) para contextos muito
// densos (overplotting). É só uma transformação VISUAL — N, médias e demais
// estatísticas continuam calculados sobre o conjunto completo filtrado,
// nunca sobre os hexágonos. Cor em escala logarítmica (log10): contagem de
// escolas por hexágono é uma distribuição de cauda longa (poucos hexágonos
// concentram milhares de escolas, a maioria tem dezenas) — uma escala linear
// deixaria quase todos os hexágonos indistinguíveis, dominados pelos raros
// extremos. Log10 espalha a cor por todas as ordens de grandeza presentes.
// ---------------------------------------------------------------------
const HEX_RADIUS = 9;

export function renderDensity(points, xLabel, domain) {
  lastRender = () => renderDensity(points, xLabel, domain);
  clearAll();

  xScale = d3.scaleLinear().domain(domain).range([0, innerW()]).nice().clamp(true);
  yScale = d3.scaleLinear().domain([0, 10]).range([innerH(), 0]).clamp(true);
  drawAxes(xLabel, 'Ideb');

  // Mesma função (computeLoess) e mesmo conjunto de dados filtrado (x, ideb)
  // do modo "Pontos individuais" — só muda a chave (x_valor aqui, x lá), o
  // método e o domínio (P1/P99) são idênticos, então as duas curvas devem
  // coincidir visualmente ao trocar de modo.
  loessCurve = computeLoess(points.map((p) => ({ x: p.x_valor, ideb: p.ideb })), xScale.domain());

  // Posições em pixel — o hexbin precisa da geometria real (distância
  // euclidiana) para formar hexágonos regulares, não dos valores de dado.
  const pixelPoints = points.map((p) => [xScale(p.x_valor), yScale(p.ideb)]);
  const hexGen = d3Hexbin().radius(HEX_RADIUS).extent([[0, 0], [innerW(), innerH()]]);
  const bins = hexGen(pixelPoints);

  const maxN = d3.max(bins, (b) => b.length) || 1;
  // Domínio em log precisa começar > 0; hexbin só retorna hexágonos com
  // >= 1 ponto, então 1 é um piso seguro (nunca haverá log(0)).
  const colorScale = d3.scaleSequentialLog(d3.interpolatePurples).domain([1, Math.max(2, maxN)]);
  const hexPath = new Path2D(hexGen.hexagon());

  ctx.save();
  ctx.translate(MARGIN.left, MARGIN.top);
  bins.forEach((b) => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = colorScale(b.length);
    ctx.fill(hexPath);
    ctx.restore();
  });
  ctx.restore();

  // camada de hover em SVG (mais simples que recalcular hit-test no canvas)
  const plot = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  bins.forEach((b) => {
    plot.append('path')
      .attr('d', hexGen.hexagon())
      .attr('transform', `translate(${b.x},${b.y})`)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => showTooltip(`${fmtN(b.length)} escolas nesta região`, event.clientX, event.clientY))
      .on('mouseleave', () => hideTooltip());
  });

  renderDensityLegend(plot, colorScale, maxN);
  drawLoessCurve();

  svg.append('text').attr('x', MARGIN.left + 4).attr('y', MARGIN.top + 12)
    .style('font-size', '11px').attr('fill', '#83867f')
    .text('Cor mais escura = mais escolas na região (escala log). Estatísticas usam o conjunto completo, não os hexágonos.');
}

// Legenda de cor com valores reais (log10) — sem ela não há como decodificar
// o que uma cor significa, só comparar "mais escuro vs. mais claro".
function renderDensityLegend(plot, colorScale, maxN) {
  const legendW = 14;
  const legendH = 90;
  const legendX = innerW() - 72; // deixa espaço pra rótulos dos ticks à direita, sem sair de innerW()
  const legendY = 16;

  const gradientId = 'density-legend-gradient';
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', '0').attr('x2', '0').attr('y1', '0').attr('y2', '1');
  d3.range(0, 1.0001, 0.1).forEach((t) => {
    // t=0 -> topo do gradiente -> valor MAIOR (convenção de colorbar vertical)
    const value = Math.pow(maxN, t);
    gradient.append('stop').attr('offset', `${(1 - t) * 100}%`).attr('stop-color', colorScale(Math.max(1, value)));
  });

  const legend = plot.append('g').attr('transform', `translate(${legendX},${legendY})`);
  legend.append('rect')
    .attr('width', legendW).attr('height', legendH)
    .attr('fill', `url(#${gradientId})`)
    .attr('stroke', '#b9bab2');

  // Ticks em potências de 10 (1, 10, 100, ...), mais o valor máximo real.
  const ticks = [1];
  for (let t = 10; t < maxN; t *= 10) ticks.push(t);
  if (ticks[ticks.length - 1] !== Math.round(maxN)) ticks.push(Math.round(maxN));
  const tickScale = d3.scaleLog().domain([1, Math.max(2, maxN)]).range([legendH, 0]).clamp(true);

  const tickG = legend.selectAll('.density-legend-tick')
    .data(ticks)
    .join('g')
    .attr('class', 'density-legend-tick')
    .attr('transform', (t) => `translate(0,${tickScale(t)})`);
  tickG.append('line').attr('x1', 0).attr('x2', legendW + 4).attr('stroke', '#83867f');
  tickG.append('text')
    .attr('x', legendW + 6).attr('y', 3)
    .style('font-size', '10px').attr('fill', '#4d514e')
    .text((t) => fmtN(Math.round(t)));

  legend.append('text')
    .attr('x', 0).attr('y', -6)
    .style('font-size', '10px').attr('fill', '#83867f')
    .text('N escolas');
}

// ---------------------------------------------------------------------
// "Ideb médio por faixa" — tendência agregada, só para variável contínua.
// ---------------------------------------------------------------------
export function renderTrend(bins, xLabel, domain) {
  lastRender = () => renderTrend(bins, xLabel, domain);
  clearAll();

  const valid = bins.filter((b) => b.n > 0);
  xScale = d3.scaleLinear().domain(domain).range([0, innerW()]).nice();
  const idebExtent = d3.extent(valid, (b) => b.ideb_medio);
  yScale = d3.scaleLinear().domain([Math.max(0, (idebExtent[0] ?? 0) - 0.3), Math.min(10, (idebExtent[1] ?? 10) + 0.3)]).range([innerH(), 0]);

  const g = drawAxes(xLabel, 'Ideb médio da faixa');

  const line = d3.line().x((b) => xScale(b.x_medio)).y((b) => yScale(b.ideb_medio)).curve(d3.curveMonotoneX);
  const plot = g.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  plot.append('path').datum(valid).attr('d', line).attr('fill', 'none').attr('stroke', '#3b6fd4').attr('stroke-width', 2);

  const rScale = d3.scaleSqrt().domain([0, d3.max(valid, (b) => b.n) || 1]).range([3, 11]);

  plot.selectAll('circle')
    .data(valid)
    .join('circle')
    .attr('cx', (b) => xScale(b.x_medio))
    .attr('cy', (b) => yScale(b.ideb_medio))
    .attr('r', (b) => rScale(b.n))
    .attr('fill', '#3b6fd4')
    .attr('fill-opacity', 0.75)
    .attr('stroke', '#fff')
    .on('mousemove', (event, b) => showTooltip(
      `Faixa em torno de ${fmtDec(b.x_medio)}<br>Ideb médio: ${fmtIdeb(b.ideb_medio)}<br>N: ${fmtN(b.n)} escolas`,
      event.clientX, event.clientY,
    ))
    .on('mouseleave', () => hideTooltip());

  plot.append('text')
    .attr('x', 4).attr('y', 4)
    .style('font-size', '11px').attr('fill', '#83867f')
    .text('Tamanho do ponto = N de escolas na faixa');
}

// ---------------------------------------------------------------------
// Strip-plot — variável de análise BINÁRIA. Substitui o boxplot: pontos
// individuais (jitter) por categoria + marca de mediana + N. A tarefa é
// comparar a distribuição do Ideb entre "possui" e "não possui" sem exigir
// conhecimento prévio de boxplot (critério 10 da revisão).
// ---------------------------------------------------------------------
export function renderStripPlot(points, xLabel, summaryByCat, segmentBy) {
  currentPoints = points;
  currentSegmentBy = segmentBy;
  selectedIds = new Set();
  hoveredId = null;
  updateSelectionCounter();

  const cats = ['0', '1'];
  const catLabels = { '0': 'Não possui', '1': 'Possui' };
  xScale = d3.scalePoint().domain(cats).range([0, innerW()]).padding(0.6);
  yScale = d3.scaleLinear().domain([0, 10]).range([innerH(), 0]);

  clearAll();
  const g = svg.append('g');
  const gx = g.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top + innerH()})`)
    .call(d3.axisBottom(xScale).tickFormat((c) => catLabels[c] ?? c));
  const gy = g.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`).call(d3.axisLeft(yScale).ticks(6));
  g.selectAll('.domain, .tick line').attr('stroke', '#b9bab2');
  g.selectAll('text').attr('fill', '#4d514e').style('font-size', '11px').style('font-family', 'IBM Plex Sans');
  svg.append('text').attr('transform', 'rotate(-90)')
    .attr('x', -(MARGIN.top + innerH() / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').style('font-size', '11px').attr('fill', '#4d514e').text('Ideb');
  svg.append('text').attr('x', MARGIN.left + innerW() / 2).attr('y', height - 6)
    .attr('text-anchor', 'middle').style('font-size', '11px').attr('fill', '#4d514e').text(xLabel);

  // jitter horizontal determinístico por escola, para não recalcular a cada frame
  const jitterWidth = Math.min(90, xScale.step() * 0.7);
  points.forEach((d) => {
    if (d._jitter === undefined) d._jitter = (hashId(d.id) - 0.5) * jitterWidth;
  });

  quadtree = d3.quadtree()
    .x((d) => xScale(String(d.categoria)) + d._jitter)
    .y((d) => yScale(d.ideb))
    .addAll(points);

  lastRender = () => paintStripPoints(jitterWidth);
  paintStripPoints(jitterWidth);
  attachHover();

  // Marcas de resumo (mediana + N) por categoria, em SVG por cima do canvas.
  const summary = g.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  cats.forEach((cat) => {
    const s = summaryByCat.get(cat);
    if (!s) return;
    const cx = xScale(cat);
    summary.append('line')
      .attr('x1', cx - jitterWidth / 2).attr('x2', cx + jitterWidth / 2)
      .attr('y1', yScale(s.mediana)).attr('y2', yScale(s.mediana))
      .attr('stroke', '#1b1d1c').attr('stroke-width', 2.5);
    summary.append('text').attr('x', cx).attr('y', innerH() + 32).attr('text-anchor', 'middle')
      .style('font-size', '10px').attr('fill', '#83867f')
      .text(`mediana ${fmtIdeb(s.mediana)} · n=${fmtN(s.n)}`);
  });
}

function hashId(id) {
  // hash simples e determinístico de um BigInt/Number/string -> [0,1)
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function paintStripPoints(jitterWidth) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(MARGIN.left, MARGIN.top);
  const baseAlpha = baseAlphaFor(currentPoints.length);
  const R = 2.6;
  currentPoints.forEach((d) => {
    const cx = xScale(String(d.categoria)) + d._jitter;
    const cy = yScale(d.ideb);
    const isHi = d.id === highlightedId;
    const isHover = d.id === hoveredId;
    const { color, shape } = visualFor(d, currentSegmentBy);
    if (isHi) {
      ctx.globalAlpha = 0.28;
      drawShape(ctx, shape, cx, cy, R * 3.4);
      ctx.fillStyle = '#3b6fd4';
      ctx.fill();
    }
    ctx.globalAlpha = baseAlpha;
    drawShape(ctx, shape, cx, cy, isHi ? R * 1.6 : R);
    ctx.fillStyle = color;
    ctx.fill();
    if (isHi || isHover) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = isHi ? 2.2 : 1;
      ctx.strokeStyle = '#1b1d1c';
      drawShape(ctx, shape, cx, cy, isHi ? R * 1.6 : R);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------
// Dot-plot comparativo de SEGMENTAÇÃO (rede/localização/classe INSE) — só
// posição, nunca caixa. Painel pequeno, complementar ao gráfico principal,
// mostrado sempre que "Segmentar por" está ativo (critério 11 da revisão).
// ---------------------------------------------------------------------
export function renderCategoryDotPlot(container, rows, catLabel, colorFn) {
  container.innerHTML = '';
  if (!rows || rows.length === 0) return;

  const w = container.clientWidth || 400;
  const rowH = 30;
  const h = rows.length * rowH + 30;
  const margin = { top: 10, right: 46, bottom: 20, left: 110 };

  const svgEl = d3.select(container).append('svg').attr('width', w).attr('height', h);
  const x = d3.scaleLinear().domain([0, 10]).range([margin.left, w - margin.right]);

  svgEl.append('g').attr('transform', `translate(0,${h - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5))
    .selectAll('text').style('font-size', '10px').attr('fill', '#4d514e');
  svgEl.selectAll('.domain, .tick line').attr('stroke', '#b9bab2');

  rows.forEach((r, i) => {
    const cy = margin.top + i * rowH + rowH / 2;
    const color = colorFn(r.categoria);
    svgEl.append('text').attr('x', 4).attr('y', cy + 4)
      .style('font-size', '12px').attr('fill', '#1b1d1c').text(r.categoria);
    svgEl.append('line')
      .attr('x1', x(r.q1)).attr('x2', x(r.q3)).attr('y1', cy).attr('y2', cy)
      .attr('stroke', color).attr('stroke-width', 3).attr('opacity', 0.55);
    svgEl.append('circle')
      .attr('cx', x(r.media)).attr('cy', cy).attr('r', 6)
      .attr('fill', color).attr('stroke', '#1b1d1c').attr('stroke-width', 1)
      .on('mousemove', (event) => showTooltip(
        `<div class="t-title">${escapeHtml(String(r.categoria))}</div>Média: ${fmtIdeb(r.media)}<br>Mediana: ${fmtIdeb(r.mediana)}<br>N: ${fmtN(r.n)} escolas`,
        event.clientX, event.clientY,
      ))
      .on('mouseleave', () => hideTooltip());
    svgEl.append('text').attr('x', w - 4).attr('y', cy + 4).attr('text-anchor', 'end')
      .style('font-size', '10px').attr('fill', '#83867f').text(`n=${fmtN(r.n)}`);
  });
}

export function prettyCat(cat) {
  if (cat === '1' || cat === 'true') return 'Possui';
  if (cat === '0' || cat === 'false') return 'Não possui';
  return cat;
}

export function setHighlighted(id) {
  highlightedId = id;
  if (lastRender) lastRender();
}

export function clearSelection() {
  selectedIds = new Set();
  updateSelectionCounter();
  if (lastRender) lastRender();
}

// map.js — Nível 1 ("Onde?"): mapa coroplético do Brasil por UF (Ideb médio).

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';
import { SMALL_SAMPLE_THRESHOLD } from './data.js';
import { showTooltip, hideTooltip, fmtIdeb, fmtN, setLoading, setEmptyState, EMPTY_MESSAGES } from './ui.js';

let svg, gPaths, pathGen;
let features = [];
let onUfClick = null;
let stableColorScale = null; // domínio fixo por etapa — ver setColorDomain()

export async function initMap(onUfClickCb) {
  onUfClick = onUfClickCb;
  svg = d3.select('#map-svg');
  gPaths = svg.append('g');

  const topo = await fetch('./data/br-uf-topo.json').then((r) => r.json());
  const objectName = Object.keys(topo.objects)[0];
  const geo = topojson.feature(topo, topo.objects[objectName]);
  features = geo.features;

  // Projeção cônica equivalente (preserva área), em vez de Mercator: o
  // Brasil se estende de ~5°N a ~34°S, e Mercator infla progressivamente a
  // área aparente longe do equador — exageraria visualmente o Sul em relação
  // ao Norte num mapa cuja própria cor já é mais difícil de comparar quando
  // as áreas das regiões diferem (aula 14: "problemas de percepção").
  const projection = d3.geoConicEqualArea().parallels([-2, -22]).rotate([54, 0]).fitSize([460, 460], geo);
  pathGen = d3.geoPath(projection);

  gPaths.selectAll('path.uf')
    .data(features, (d) => d.properties.sigla)
    .join('path')
    .attr('class', 'uf no-data')
    .attr('d', pathGen)
    .attr('fill', '#f0f0ec')
    .on('mousemove', (event, d) => handleHover(event, d))
    .on('mouseleave', () => hideTooltip())
    .on('click', (event, d) => onUfClick?.(d.properties.sigla));
}

// Chamado uma vez por etapa (main.js) com o min/max real de Ideb médio por
// UF, ignorando os demais filtros — domínio ESTÁVEL: o mesmo valor de Ideb
// sempre recebe a mesma cor, mesmo quando rede/localização/INSE mudam.
export function setColorDomain(minIdeb, maxIdeb) {
  const domain = minIdeb === maxIdeb ? [minIdeb - 0.5, minIdeb + 0.5] : [minIdeb, maxIdeb];
  stableColorScale = d3.scaleSequential(d3.interpolateBlues).domain(domain);
  renderLegend(domain);
}

let currentDataBySigla = new Map();

function handleHover(event, d) {
  const row = currentDataBySigla.get(d.properties.sigla);
  const n = row ? row.n : 0;
  const ideb = row ? row.ideb_medio : null;
  const warn = n > 0 && n < SMALL_SAMPLE_THRESHOLD
    ? `<div class="t-warn">⚠ Amostra pequena</div>` : '';
  const body = n > 0
    ? `<div class="t-title">${d.properties.name}</div>Ideb médio: ${fmtIdeb(ideb)}<br>N: ${fmtN(n)} escolas com Ideb válido${warn}`
    : `<div class="t-title">${d.properties.name}</div>Sem escolas no contexto filtrado`;
  showTooltip(body, event.clientX, event.clientY);
}

export function updateMap(rows, selectedUfs) {
  setLoading('map-loading', false);
  currentDataBySigla = new Map(rows.map((r) => [r.sg_uf, r]));

  gPaths.selectAll('path.uf')
    .classed('no-data', (d) => !currentDataBySigla.has(d.properties.sigla))
    .classed('selected', (d) => selectedUfs.has(d.properties.sigla))
    .classed('dimmed', (d) => selectedUfs.size > 0 && !selectedUfs.has(d.properties.sigla))
    .transition().duration(200)
    .attr('fill', (d) => {
      const row = currentDataBySigla.get(d.properties.sigla);
      return row && stableColorScale ? stableColorScale(row.ideb_medio) : '#f0f0ec';
    });

  setEmptyState('map-empty', rows.length === 0 ? EMPTY_MESSAGES.semResultado : null);
}

// Destaque cruzado (Nível 3 -> mapa): chamado quando uma escola é clicada na
// tabela/cards de destaques. É DESTAQUE, não filtro — não usa a classe
// .selected (que representa o filtro de UF ativo); usa uma classe à parte
// com uma pulsação breve, para a distinção ficar visualmente clara.
let flashTimeout = null;
export function flashUf(uf) {
  gPaths.selectAll('path.uf').classed('flash', (d) => d.properties.sigla === uf);
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => gPaths.selectAll('path.uf').classed('flash', false), 1600);
}

function renderLegend(domain) {
  const legend = document.getElementById('map-legend');
  if (!legend || !stableColorScale) return;
  const stops = d3.range(0, 1.001, 0.1).map((t) => stableColorScale(domain[0] + t * (domain[1] - domain[0])));
  legend.innerHTML = `
    <span>${fmtIdeb(domain[0])}</span>
    <span class="gradient-bar" style="background:linear-gradient(to right, ${stops.join(',')})"></span>
    <span>${fmtIdeb(domain[1])}</span>
    <span style="margin-left:8px">Ideb médio por UF · escala fixa para esta etapa</span>
  `;
}

// comparison.js — Nível 3: tabela interativa (Selecionadas) e cards de outliers.

import { fmtIdeb, fmtDec, fmtN } from './ui.js';
import { DISTANCIA_NOTE, REDE_COLORS, REDE_SHAPES } from './data.js';

function shapeSvg(shape, color) {
  if (shape === 'triangle') return `<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1 11,10 1,10" fill="${color}"/></svg>`;
  if (shape === 'square') return `<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="${color}"/></svg>`;
  return `<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${color}"/></svg>`;
}

function redeCellHtml(rede) {
  const color = REDE_COLORS[rede] || '#5f5e5a';
  const shape = REDE_SHAPES[rede] || 'circle';
  return `<span class="rede-cell">${shapeSvg(shape, color)} ${escapeHtml(rede)}</span>`;
}

function distanciaPillHtml(v) {
  if (v == null) return '—';
  const kind = v >= 0 ? 'positive' : 'negative';
  const label = v >= 0 ? 'Acima' : 'Abaixo';
  return `<span class="distance-pill ${kind}">${v > 0 ? '+' : ''}${fmtDec(v)} · ${label}</span>`;
}

let onRowClick = null;
let sortState = { col: 'ideb', dir: 'desc' };
let currentRows = [];
let xLabel = 'Variável X';

export function initComparison({ onSelectSchool } = {}) {
  onRowClick = onSelectSchool;
}

export function renderSelecionadas(rows, xVarLabel) {
  xLabel = xVarLabel;
  currentRows = rows;
  const container = document.getElementById('level3-content');
  container.innerHTML = '';

  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="empty-state" style="margin:0 auto">Nenhuma escola selecionada. Arraste (brush) sobre o gráfico de pontos individuais no Nível 2 para selecionar um grupo de escolas.</div>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'data-table-wrap';
  wrap.style.maxHeight = '360px';
  wrap.style.overflowY = 'auto';
  const table = buildTable(rows);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

const COLUMNS = [
  { key: 'no_entidade', label: 'Escola', num: false },
  { key: 'sg_uf', label: 'UF', num: false },
  { key: 'rede_ensino', label: 'Rede', num: false, html: (v) => redeCellHtml(v) },
  { key: 'ideb', label: 'Ideb', num: true, fmt: fmtIdeb },
  { key: 'x_valor', label: null, num: true, fmt: (v) => fmtDec(v) },
  { key: 'inse_media', label: 'INSE', num: true, fmt: (v) => (v == null ? 'não calculado' : fmtDec(v)) },
  { key: 'distancia', label: 'Distância à tendência', num: true, html: (v) => distanciaPillHtml(v) },
];

function buildTable(rows) {
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  COLUMNS.forEach((col) => {
    const th = document.createElement('th');
    th.className = col.num ? 'num' : '';
    th.textContent = col.label || xLabel;
    if (sortState.col === col.key) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = sortState.dir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
    th.addEventListener('click', () => {
      sortState = { col: col.key, dir: sortState.col === col.key && sortState.dir === 'desc' ? 'asc' : 'desc' };
      renderSelecionadas(currentRows, xLabel);
    });
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortState.col], bv = b[sortState.col];
    const mult = sortState.dir === 'asc' ? 1 : -1;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? mult : av < bv ? -mult : 0;
  });

  const tbody = document.createElement('tbody');
  sorted.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.co_entidade;
    COLUMNS.forEach((col) => {
      const td = document.createElement('td');
      td.className = col.num ? 'num tabular' : '';
      if (col.html) td.innerHTML = col.html(row[col.key]);
      else td.textContent = col.fmt ? col.fmt(row[col.key]) : row[col.key];
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => onRowClick?.(row.co_entidade, row.sg_uf));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

export function highlightRow(id) {
  document.querySelectorAll('#level3-content tr[data-id]').forEach((tr) => {
    tr.classList.toggle('highlighted', tr.dataset.id === String(id));
  });
}

// ---------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------
export function renderOutliers(rows, xVarLabel) {
  const container = document.getElementById('level3-content');
  container.innerHTML = '';

  const note = document.createElement('div');
  note.className = 'level3-methodology-note';
  note.textContent = DISTANCIA_NOTE;
  container.appendChild(note);

  if (!rows || rows.length === 0) {
    container.innerHTML += '<div class="empty-state" style="margin:0 auto">Sem dados suficientes para calcular outliers no contexto filtrado.</div>';
    return;
  }

  const acima = rows.filter((r) => r.grupo === 'acima').sort((a, b) => b.distancia - a.distancia);
  const abaixo = rows.filter((r) => r.grupo === 'abaixo').sort((a, b) => a.distancia - b.distancia);

  const grid = document.createElement('div');
  grid.className = 'outliers-columns';
  grid.appendChild(buildOutlierColumn('Acima da tendência', acima, 'positive', xVarLabel));
  grid.appendChild(buildOutlierColumn('Abaixo da tendência', abaixo, 'negative', xVarLabel));
  container.appendChild(grid);
}

function buildOutlierColumn(title, rows, kind, xVarLabel) {
  const col = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = title;
  col.appendChild(h3);
  rows.forEach((r) => {
    const card = document.createElement('div');
    card.className = `outlier-card ${kind}`;
    card.innerHTML = `
      <div class="oc-title">${escapeHtml(r.no_entidade)}</div>
      <div class="oc-meta"><span>${r.sg_uf} · ${redeCellHtml(r.rede_ensino)}</span><span class="oc-distance">${r.distancia > 0 ? '+' : ''}${fmtDec(r.distancia, 2)}</span></div>
      <div class="oc-meta"><span>Ideb: ${fmtIdeb(r.ideb)} · ${xVarLabel}: ${fmtDec(r.x_valor)}</span><span>INSE: ${r.inse_media == null ? '—' : fmtDec(r.inse_media)}</span></div>
    `;
    card.addEventListener('click', () => onRowClick?.(r.co_entidade, r.sg_uf));
    col.appendChild(card);
  });
  return col;
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

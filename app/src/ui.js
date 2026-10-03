// ui.js — pequenos utilitários compartilhados pelos módulos de visualização.

export function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtDec1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDec2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtN(n) { return fmtInt.format(Math.round(n)); }
export function fmtIdeb(v) { return v == null ? '—' : fmtDec1.format(v); }
export function fmtDec(v, casas = 2) {
  if (v == null) return '—';
  return casas === 1 ? fmtDec1.format(v) : fmtDec2.format(v);
}

// ---------------- Tooltip singleton ----------------
const tooltipEl = document.getElementById('tooltip');

export function showTooltip(html, x, y) {
  tooltipEl.innerHTML = html;
  tooltipEl.classList.add('visible');
  positionTooltip(x, y);
}
export function moveTooltip(x, y) { positionTooltip(x, y); }
export function hideTooltip() { tooltipEl.classList.remove('visible'); }

function positionTooltip(x, y) {
  const pad = 14;
  const rect = tooltipEl.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

// ---------------- Loading / empty state ----------------
export function setLoading(id, isLoading) {
  const el = document.getElementById(id);
  if (el) el.hidden = !isLoading;
}

export function setEmptyState(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

export const EMPTY_MESSAGES = {
  semResultado: 'Nenhuma escola corresponde aos filtros selecionados. Tente ampliar a faixa de INSE ou incluir mais redes de ensino.',
  semVariavel: 'Nenhuma escola no contexto filtrado possui valor registrado para esta variável.',
  ufSemDados: 'Sem escolas nesta UF para o contexto filtrado.',
};

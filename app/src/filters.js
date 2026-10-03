// filters.js — estado global de filtros (pub-sub simples) + render da barra fixa.

import { REGIOES, TODAS_UFS, INSE_LEVELS, INSE_LEVELS_DEFAULT } from './data.js';

function defaultState() {
  return {
    etapa: 'anos_iniciais',
    rede: new Set(['Federal', 'Estadual', 'Municipal']),
    localizacao: 'ambas',
    ufs: new Set(), // vazio = Brasil inteiro
    inseMode: 'classificacao', // 'classificacao' | 'avancado'
    inseLevels: new Set(INSE_LEVELS_DEFAULT),
    inseIncludeMissing: false,
    inseRange: [2.35, 6.65],
  };
}

let state = defaultState();
const listeners = [];

export function getState() { return state; }

export function subscribe(fn) { listeners.push(fn); }

function notify(changed) {
  listeners.forEach((fn) => fn(state, changed));
}

export function setState(patch, changed) {
  state = { ...state, ...patch };
  notify(changed || Object.keys(patch));
}

export function toggleUf(uf) {
  const next = new Set(state.ufs);
  if (next.has(uf)) next.delete(uf); else next.add(uf);
  setState({ ufs: next }, ['ufs']);
}

export function clearAllFilters() {
  state = defaultState();
  notify(['all']);
}

// ---------------------------------------------------------------------
// Render da barra de filtros
// ---------------------------------------------------------------------
export function renderFilterBar(container) {
  container.innerHTML = '';
  container.appendChild(buildUfFilter());
  container.appendChild(buildRedeFilter());
  container.appendChild(buildEtapaFilter());
  container.appendChild(buildLocalizacaoFilter());
  container.appendChild(buildInseFilter());

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  container.appendChild(spacer);

  const counter = document.createElement('div');
  counter.className = 'n-counter-card';
  counter.innerHTML = `
    <div class="n-counter-icon"><i class="ti ti-users" aria-hidden="true"></i></div>
    <div>
      <div class="n-counter-label">N escolas com Ideb válido</div>
      <div class="n-counter-value tabular" id="n-counter">—</div>
      <div class="n-counter-secondary" id="n-counter-secondary"></div>
    </div>
  `;
  container.appendChild(counter);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-filters-btn';
  clearBtn.innerHTML = '<i class="ti ti-refresh" aria-hidden="true"></i> Limpar filtros';
  clearBtn.addEventListener('click', clearAllFilters);
  container.appendChild(clearBtn);

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-popover.open').forEach((pop) => {
      if (!pop.parentElement.contains(e.target)) pop.classList.remove('open');
    });
  });
}

export function updateNCounter(nComIdeb, nSemIdeb) {
  const valueEl = document.getElementById('n-counter');
  const secondaryEl = document.getElementById('n-counter-secondary');
  if (valueEl) valueEl.textContent = nComIdeb == null ? '—' : nComIdeb.toLocaleString('pt-BR');
  if (secondaryEl) secondaryEl.textContent = nSemIdeb > 0 ? `${nSemIdeb.toLocaleString('pt-BR')} sem Ideb no contexto` : '';
}

function makeGroup(labelText, iconClass) {
  const group = document.createElement('div');
  group.className = 'filter-group';
  const label = document.createElement('label');
  label.innerHTML = iconClass ? `<i class="${iconClass}" aria-hidden="true"></i> ${labelText}` : labelText;
  group.appendChild(label);
  return group;
}

function makeTrigger(group, defaultText) {
  const trigger = document.createElement('button');
  trigger.className = 'filter-trigger';
  trigger.type = 'button';
  trigger.textContent = defaultText;
  group.appendChild(trigger);
  return trigger;
}

function makePopover(group) {
  const pop = document.createElement('div');
  pop.className = 'filter-popover';
  group.appendChild(pop);
  return pop;
}

function wireToggle(trigger, pop) {
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = pop.classList.contains('open');
    document.querySelectorAll('.filter-popover.open').forEach((p) => p.classList.remove('open'));
    if (!wasOpen) pop.classList.add('open');
  });
}

// ---- Região / UF ----
function buildUfFilter() {
  const group = makeGroup('Região / UF', 'ti ti-map-pin');
  const trigger = makeTrigger(group, 'Brasil (todas as UFs)');
  const pop = makePopover(group);

  const shortcuts = document.createElement('div');
  shortcuts.className = 'region-shortcuts';
  const brasilChip = document.createElement('button');
  brasilChip.className = 'chip-btn';
  brasilChip.textContent = 'Brasil';
  brasilChip.addEventListener('click', () => setState({ ufs: new Set() }, ['ufs']));
  shortcuts.appendChild(brasilChip);
  Object.entries(REGIOES).forEach(([nome, ufs]) => {
    const chip = document.createElement('button');
    chip.className = 'chip-btn';
    chip.textContent = nome;
    chip.addEventListener('click', () => setState({ ufs: new Set(ufs) }, ['ufs']));
    shortcuts.appendChild(chip);
  });
  pop.appendChild(shortcuts);

  TODAS_UFS.forEach((uf) => {
    const row = document.createElement('label');
    row.className = 'option-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = uf;
    row.appendChild(cb);
    row.append(uf);
    cb.addEventListener('change', () => {
      const next = new Set(state.ufs);
      if (cb.checked) next.add(uf); else next.delete(uf);
      setState({ ufs: next }, ['ufs']);
    });
    pop.appendChild(row);
  });

  wireToggle(trigger, pop);

  subscribe((s) => {
    pop.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = s.ufs.has(cb.value); });
    if (s.ufs.size === 0) trigger.textContent = 'Brasil (todas as UFs)';
    else if (s.ufs.size <= 3) trigger.textContent = [...s.ufs].join(', ');
    else trigger.textContent = `${s.ufs.size} UFs selecionadas`;
    trigger.classList.toggle('active', s.ufs.size > 0);
  });

  return group;
}

// ---- Rede de ensino ----
function buildRedeFilter() {
  const group = makeGroup('Rede de ensino', 'ti ti-building-bank');
  const trigger = makeTrigger(group, 'Todas as redes');
  const pop = makePopover(group);

  ['Federal', 'Estadual', 'Municipal'].forEach((rede) => {
    const row = document.createElement('label');
    row.className = 'option-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.value = rede;
    row.appendChild(cb);
    row.append(rede);
    cb.addEventListener('change', () => {
      const next = new Set(state.rede);
      if (cb.checked) next.add(rede); else next.delete(rede);
      if (next.size === 0) { cb.checked = true; next.add(rede); } // não deixa esvaziar
      setState({ rede: next }, ['rede']);
    });
    pop.appendChild(row);
  });

  wireToggle(trigger, pop);

  subscribe((s) => {
    if (s.rede.size === 3) trigger.textContent = 'Todas as redes';
    else trigger.textContent = [...s.rede].join(', ');
    trigger.classList.toggle('active', s.rede.size < 3);
  });

  return group;
}

// ---- Etapa (abas, exclusiva) ----
function buildEtapaFilter() {
  const group = makeGroup('Etapa de ensino', 'ti ti-calendar');
  const tabs = document.createElement('div');
  tabs.className = 'etapa-tabs';
  const opts = [
    ['anos_iniciais', 'Anos iniciais'],
    ['anos_finais', 'Anos finais'],
    ['ensino_medio', 'Ensino médio'],
  ];
  opts.forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = value === state.etapa ? 'active' : '';
    btn.addEventListener('click', () => setState({ etapa: value }, ['etapa']));
    tabs.appendChild(btn);
  });
  group.appendChild(tabs);

  subscribe((s) => {
    [...tabs.children].forEach((btn, i) => btn.classList.toggle('active', opts[i][0] === s.etapa));
  });

  return group;
}

// ---- Localização ----
function buildLocalizacaoFilter() {
  const group = makeGroup('Localização', 'ti ti-map-pin-filled');
  const tabs = document.createElement('div');
  tabs.className = 'etapa-tabs';
  const opts = [['ambas', 'Ambas'], ['Urbana', 'Urbana'], ['Rural', 'Rural']];
  opts.forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = value === state.localizacao ? 'active' : '';
    btn.addEventListener('click', () => setState({ localizacao: value }, ['localizacao']));
    tabs.appendChild(btn);
  });
  group.appendChild(tabs);

  subscribe((s) => {
    [...tabs.children].forEach((btn, i) => btn.classList.toggle('active', opts[i][0] === s.localizacao));
  });

  return group;
}

// ---- INSE (contexto socioeconômico) ----
function buildInseFilter() {
  const group = makeGroup('Contexto socioeconômico (INSE)', 'ti ti-chart-bar');
  const trigger = makeTrigger(group, 'Níveis III–VI');
  const pop = makePopover(group);

  const modeToggle = document.createElement('div');
  modeToggle.className = 'inse-mode-toggle';
  const btnClassif = document.createElement('button');
  btnClassif.textContent = 'Classificação';
  btnClassif.className = 'active';
  const btnAdv = document.createElement('button');
  btnAdv.textContent = 'Contínuo (avançado)';
  modeToggle.append(btnClassif, btnAdv);
  pop.appendChild(modeToggle);

  const classifBox = document.createElement('div');
  INSE_LEVELS.forEach((lvl) => {
    const row = document.createElement('label');
    row.className = 'option-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = INSE_LEVELS_DEFAULT.includes(lvl);
    cb.value = lvl;
    row.appendChild(cb);
    row.append(lvl);
    cb.addEventListener('change', () => {
      const next = new Set(state.inseLevels);
      if (cb.checked) next.add(lvl); else next.delete(lvl);
      setState({ inseLevels: next }, ['inse']);
    });
    classifBox.appendChild(row);
  });
  const missingRow = document.createElement('label');
  missingRow.className = 'option-row';
  const missingCb = document.createElement('input');
  missingCb.type = 'checkbox';
  missingRow.appendChild(missingCb);
  missingRow.append('Incluir escolas sem INSE calculado');
  missingCb.addEventListener('change', () => setState({ inseIncludeMissing: missingCb.checked }, ['inse']));
  classifBox.appendChild(missingRow);
  pop.appendChild(classifBox);

  const advBox = document.createElement('div');
  advBox.className = 'range-slider-row';
  advBox.style.display = 'none';
  advBox.innerHTML = `
    <input type="range" id="inse-range-min" min="2.35" max="6.65" step="0.05" value="2.35">
    <input type="range" id="inse-range-max" min="2.35" max="6.65" step="0.05" value="6.65">
    <div class="range-values"><span id="inse-range-label">2,35 – 6,65</span></div>
  `;
  pop.appendChild(advBox);

  const inseNote = document.createElement('p');
  inseNote.className = 'inse-filter-note';
  inseNote.textContent = 'Escolas sem INSE calculado não participam da análise quando o filtro de INSE está ativo (a menos que "incluir escolas sem INSE" esteja marcado).';
  pop.appendChild(inseNote);

  const rangeMin = advBox.querySelector('#inse-range-min');
  const rangeMax = advBox.querySelector('#inse-range-max');
  const rangeLabel = advBox.querySelector('#inse-range-label');
  function commitRange() {
    let lo = parseFloat(rangeMin.value);
    let hi = parseFloat(rangeMax.value);
    if (lo > hi) [lo, hi] = [hi, lo];
    rangeLabel.textContent = `${lo.toFixed(2).replace('.', ',')} – ${hi.toFixed(2).replace('.', ',')}`;
    setState({ inseRange: [lo, hi] }, ['inse']);
  }
  rangeMin.addEventListener('input', commitRange);
  rangeMax.addEventListener('input', commitRange);

  btnClassif.addEventListener('click', () => {
    btnClassif.classList.add('active'); btnAdv.classList.remove('active');
    classifBox.style.display = ''; advBox.style.display = 'none';
    setState({ inseMode: 'classificacao' }, ['inse']);
  });
  btnAdv.addEventListener('click', () => {
    btnAdv.classList.add('active'); btnClassif.classList.remove('active');
    classifBox.style.display = 'none'; advBox.style.display = '';
    setState({ inseMode: 'avancado' }, ['inse']);
  });

  wireToggle(trigger, pop);

  subscribe((s) => {
    if (s.inseMode === 'avancado') {
      trigger.textContent = `INSE ${s.inseRange[0].toFixed(2)}–${s.inseRange[1].toFixed(2)}`;
      trigger.classList.add('active');
    } else if (s.inseLevels.size === INSE_LEVELS.length && s.inseIncludeMissing) {
      trigger.textContent = 'Todos os níveis';
      trigger.classList.remove('active');
    } else {
      const n = s.inseLevels.size;
      trigger.textContent = n === 0 ? 'Nenhum nível selecionado' : `${n} nível(is) selecionado(s)`;
      trigger.classList.add('active');
    }
  });

  return group;
}

const API_BASE = (window.SEREIA_API_BASE || 'https://sereia-cs.up.railway.app').replace(/\/+$/, '');
const TOKEN_KEY = 'sereia-cs-token';
const FUNCIONARIO_KEY = 'sereia-cs-funcionario';
const SOM_KEY = 'sereia-cs-som-ligado';

// Cores de avatar por setor
const CORES_SETOR = {
  cs: '#4A2C4F',
  marketing: '#993C1D',
  financeiro: '#3B6D11',
  suporte: '#0C447C',
  outro: '#5F5E5A'
};

// ============================================================
// LOGIN — 2 etapas (escolher funcionário + token)
// ============================================================
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const getFuncionario = () => {
  try { return JSON.parse(localStorage.getItem(FUNCIONARIO_KEY) || 'null'); }
  catch { return null; }
};
const setFuncionario = (f) => localStorage.setItem(FUNCIONARIO_KEY, JSON.stringify(f));
const clearFuncionario = () => localStorage.removeItem(FUNCIONARIO_KEY);

let funcionarioSelecionado = null;

async function carregarFuncionariosLogin() {
  const grid = document.getElementById('funcionarios-grid');
  const help = document.getElementById('funcionarios-help');
  try {
    const r = await fetch(`${API_BASE}/api/contatos/funcionarios`);
    if (!r.ok) {
      grid.innerHTML = '<div class="grid-loading">Erro ao buscar o time. Servidor offline?</div>';
      return;
    }
    const lista = await r.json();
    if (!lista.length) {
      grid.innerHTML = '<div class="grid-loading">Nenhum funcionário cadastrado ainda.<br>Acesse a aba Contatos e classifique alguém como funcionário primeiro.</div>';
      return;
    }
    grid.innerHTML = lista.map(f => {
      const iniciais = (f.nome || '?').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
      const cor = CORES_SETOR[f.setor] || CORES_SETOR.outro;
      const cls = !f.conectado ? 'funcionario-card no-channel' : 'funcionario-card';
      return `
        <div class="${cls}" onclick="escolherFuncionario(${f.id}, '${escapeAttr(f.nome)}', '${escapeAttr(f.setor || 'outro')}', '${escapeAttr(iniciais)}', ${f.conectado})">
          <div class="avatar" style="background: ${cor};">${iniciais}</div>
          <div class="nome">${escapeHtml(f.nome || '—')}</div>
          <div class="setor">${escapeHtml(f.setor || '—')}</div>
        </div>`;
    }).join('');
    const semCanal = lista.filter(f => !f.conectado).length;
    help.innerHTML = semCanal
      ? `${semCanal} ${semCanal === 1 ? 'pessoa ainda não tem' : 'pessoas ainda não têm'} número 2chat conectado. ${semCanal === 1 ? 'Ela poderá usar o painel pra observar mas não pra responder.' : 'Elas poderão usar o painel pra observar mas não pra responder.'}`
      : 'Todos do time com 2chat conectado ✓';
  } catch (err) {
    grid.innerHTML = '<div class="grid-loading">Não foi possível alcançar o servidor.</div>';
  }
}

window.escolherFuncionario = function (id, nome, setor, iniciais, conectado) {
  funcionarioSelecionado = { id, nome, setor, iniciais, conectado, cor: CORES_SETOR[setor] || CORES_SETOR.outro };
  document.getElementById('login-step-funcionario').classList.add('hidden');
  document.getElementById('login-step-token').classList.remove('hidden');
  document.getElementById('selected-avatar').textContent = iniciais;
  document.getElementById('selected-avatar').style.background = funcionarioSelecionado.cor;
  document.getElementById('selected-nome').textContent = nome;
  document.getElementById('selected-setor').textContent = setor;
  document.getElementById('login-subtitle').textContent = 'Token de acesso';
  document.getElementById('token-input').focus();
};

window.voltarEscolha = function () {
  funcionarioSelecionado = null;
  document.getElementById('login-step-funcionario').classList.remove('hidden');
  document.getElementById('login-step-token').classList.add('hidden');
  document.getElementById('login-subtitle').textContent = 'Quem está entrando agora?';
};

async function tentarLogin(token) {
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const r = await fetch(`${API_BASE}/api/metrics/overview`, { headers: { 'X-CS-Token': token } });
    if (r.status === 401) { errEl.textContent = 'Token inválido.'; return false; }
    if (!r.ok) { errEl.textContent = 'Erro ao conectar com o servidor.'; return false; }
    setToken(token);
    if (funcionarioSelecionado) setFuncionario(funcionarioSelecionado);
    iniciarDashboard();
    return true;
  } catch (err) {
    errEl.textContent = 'Não foi possível alcançar o servidor.';
    return false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', () => {
    const t = document.getElementById('token-input').value.trim();
    if (!t) return;
    if (!funcionarioSelecionado) { alert('Escolha quem está entrando primeiro.'); return; }
    tentarLogin(t);
  });
  document.getElementById('token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken(); location.reload();
});

// ============================================================
// API HELPERS
// ============================================================
async function api(path, opts = {}) {
  const token = getToken();
  const funcionario = getFuncionario();
  const headers = { 'X-CS-Token': token, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (funcionario?.id) headers['X-CS-Funcionario-Id'] = funcionario.id;
  const r = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (r.status === 401) { clearToken(); clearFuncionario(); location.reload(); throw new Error('unauthorized'); }
  if (!r.ok) {
    let err = `http ${r.status}`;
    try { const j = await r.json(); if (j.error) err = j.error; } catch {}
    throw new Error(err);
  }
  if (r.status === 204) return null;
  return r.json();
}

// helper pra ações que usam o nome do funcionário logado
function getNomeLogado() {
  return getFuncionario()?.nome || '';
}

// ============================================================
// STATE
// ============================================================
let clientesCache = []; // pra dropdown de classificação
let contatosFilter = 'nao_classificado';

// ============================================================
// INIT
// ============================================================
function iniciarDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');

  // Avatar do logado no header
  const f = getFuncionario();
  if (f) {
    const headerAvatar = document.getElementById('header-avatar');
    headerAvatar.textContent = f.iniciais || (f.nome || '?').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
    headerAvatar.style.background = f.cor || '#5F5E5A';
    document.getElementById('header-user-nome').textContent = f.nome || '';
    document.getElementById('header-user-setor').textContent = f.setor || '';
  }

  configurarTabs();
  configurarFiltrosContatos();
  configurarSomToggle();
  pedirPermissaoNotificacao();
  conectarWebSocket();
  carregarClientes();
  carregarVolume();
  carregarBacklog();
  carregarAlertasAtivos();
  carregarContatosStats();

  setInterval(carregarBacklog, 30000);
  setInterval(carregarVolume, 60000);
  setInterval(carregarAlertasAtivos, 30000);
  setInterval(carregarContatosStats, 30000);
}

async function carregarClientes() {
  try { clientesCache = await api('/api/clientes'); }
  catch { clientesCache = []; }

  document.getElementById('header-clientes').textContent = clientesCache.length || 180;
}

// ============================================================
// TABS
// ============================================================
function configurarTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `panel-${tab}`));
      if (tab === 'volume') carregarVolume();
      if (tab === 'backlog') carregarBacklog();
      if (tab === 'contatos') carregarContatos();
      if (tab === 'chamados') carregarChamadosAtivos();
    });
  });
}

function configurarFiltrosContatos() {
  document.querySelectorAll('.contatos-filters .filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.contatos-filters .filter').forEach((b) => b.classList.toggle('active', b === btn));
      contatosFilter = btn.dataset.filter;
      carregarContatos();
    });
  });
}

// ============================================================
// VOLUME
// ============================================================
async function carregarVolume() {
  try {
    const [overview, series, heatmap, top] = await Promise.all([
      api('/api/metrics/overview'),
      api('/api/metrics/timeseries?days=30'),
      api('/api/metrics/heatmap'),
      api('/api/metrics/top-clientes?period=mes&limit=10')
    ]);
    renderOverview(overview);
    renderTimeseries(series);
    renderHeatmap(heatmap);
    renderTopClientes(top);
  } catch (err) { console.error('volume erro:', err); }
}

function renderOverview(o) {
  document.getElementById('metric-hoje').textContent = fmtNum(o.hoje.valor);
  document.getElementById('metric-semana').textContent = fmtNum(o.semana.valor);
  document.getElementById('metric-mes').textContent = fmtNum(o.mes.valor);

  setDelta('metric-hoje-delta', o.hoje.delta_abs, ' vs ontem', false);
  setDelta('metric-semana-delta', o.semana.delta_pct, '% vs semana passada', true);
  setDelta('metric-mes-delta', o.mes.delta_pct, '% vs mês anterior', true);
}

function setDelta(id, valor, suffix, isPct) {
  const el = document.getElementById(id);
  el.classList.remove('up', 'down', 'flat');
  if (valor === null || valor === undefined) { el.textContent = ''; el.classList.add('flat'); return; }
  const num = Number(valor);
  const dir = num > 0 ? 'up' : num < 0 ? 'down' : 'flat';
  const icon = num > 0 ? 'ti-trending-up' : num < 0 ? 'ti-trending-down' : 'ti-minus';
  const prefix = num > 0 ? '+' : '';
  el.classList.add(dir);
  el.innerHTML = `<i class="ti ${icon}"></i> ${prefix}${num}${suffix}`;
}

function renderTimeseries(series) {
  const svg = document.getElementById('timeseries');
  if (!series.length) { svg.innerHTML = ''; return; }

  const W = 700, H = 180, padL = 30, padR = 10, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxY = Math.max(10, ...series.map((d) => Math.max(d.abertos, d.resolvidos))) * 1.1;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;

  const pathFor = (key) => series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${padL + i * step},${padT + innerH - (d[key] / maxY) * innerH}`).join(' ');

  svg.innerHTML = `
    <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>
    <line x1="${padL}" y1="${padT + innerH/2}" x2="${W - padR}" y2="${padT + innerH/2}" stroke="rgba(0,0,0,0.05)" stroke-width="0.5" stroke-dasharray="2,3"/>
    <path d="${pathFor('abertos')}" fill="none" stroke="#D85C3F" stroke-width="1.5"/>
    <path d="${pathFor('resolvidos')}" fill="none" stroke="#4A2C4F" stroke-width="1.5" stroke-dasharray="3,2"/>
    <text x="4" y="${padT + 6}" font-size="9" fill="#888780">${Math.round(maxY)}</text>
    <text x="4" y="${padT + innerH + 4}" font-size="9" fill="#888780">0</text>
    <text x="${padL}" y="${H - 8}" font-size="9" fill="#888780">${formatDia(series[0].dia)}</text>
    <text x="${W - padR - 20}" y="${H - 8}" font-size="9" fill="#888780" text-anchor="end">hoje</text>
  `;
}

function renderHeatmap(matriz) {
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const container = document.getElementById('heatmap');
  const ordemSemana = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(1, ...matriz.flat());

  const band = (v) => {
    if (!v) return 0;
    const r = v / max;
    if (r < 0.2) return 1;
    if (r < 0.4) return 2;
    if (r < 0.7) return 3;
    return 4;
  };

  let html = '<div></div>';
  for (let h = 0; h < 24; h++) html += `<div class="label-h">${h}h</div>`;
  ordemSemana.forEach((dow) => {
    html += `<div class="label-d">${dias[dow]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = matriz[dow][h] || 0;
      html += `<span class="hm-cell hm-${band(v)}" title="${dias[dow]} ${h}h: ${v}"></span>`;
    }
  });
  container.innerHTML = html;
}

function renderTopClientes(rows) {
  const tbody = document.getElementById('top-clientes-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:1rem;text-align:center;">Sem dados</td></tr>'; return; }
  tbody.innerHTML = rows.map((r) => {
    const pct = r.pct_resolvido ?? 0;
    const pctClass = pct >= 90 ? 'pct-good' : pct >= 80 ? 'pct-warn' : 'pct-bad';
    return `
      <tr>
        <td>${escapeHtml(r.nome)}</td>
        <td class="num"><strong>${r.total}</strong></td>
        <td class="num ${pctClass}">${pct}%</td>
        <td class="num">${sparkline(r.sparkline || [])}</td>
      </tr>`;
  }).join('');
}

function sparkline(data) {
  if (!data || !data.length) return '<span class="muted">—</span>';
  const W = 100, H = 22;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? W / (data.length - 1) : 0;
  const pts = data.map((v, i) => `${i * step},${H - 2 - (v / max) * (H - 4)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:80px;height:22px;vertical-align:middle;"><polyline points="${pts}" fill="none" stroke="#4A2C4F" stroke-width="1"/></svg>`;
}

// ============================================================
// BACKLOG
// ============================================================
async function carregarBacklog() {
  try { renderBacklog(await api('/api/backlog')); }
  catch (err) { console.error('backlog erro:', err); }
}

function renderBacklog({ resumo, chamados }) {
  document.getElementById('kpi-ok').textContent = resumo.ok;
  document.getElementById('kpi-atencao').textContent = resumo.atencao;
  document.getElementById('kpi-critico').textContent = resumo.critico;

  const badge = document.getElementById('tab-badge-backlog');
  const totalAguardando = resumo.ok + resumo.atencao + resumo.critico;
  if (totalAguardando > 0) {
    badge.textContent = totalAguardando; badge.classList.remove('hidden');
  } else { badge.classList.add('hidden'); }

  const list = document.getElementById('backlog-list');
  const empty = document.getElementById('backlog-empty');

  if (!chamados.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  // Mapa chamadoId -> lembrete mais próximo (carregado em paralelo)
  list.innerHTML = chamados.map((c) => {
    const aguardando = c.aguardando_desde !== null;
    const dotClass = !aguardando ? 'dot-purple'
      : c.semaforo === 'critico' ? 'dot-red'
      : c.semaforo === 'atencao' ? 'dot-amber'
      : 'dot-green';

    const tempoFmt = aguardando
      ? `${fmtMinutos(c.aguardando_minutos)} aguardando`
      : `respondido · ${fmtMinutos(c.minutos_aberto)} aberto`;
    const tempoUrgent = aguardando && c.semaforo === 'critico';

    return `
      <div class="backlog-row" id="backlog-row-${c.id}">
        <span class="dot ${dotClass}" title="${aguardando ? 'aguardando resposta' : 'aguardando cliente'}"></span>
        <div class="cliente" onclick="abrirChamadoNoDrawer(${c.id}, ${c.cliente_id})" style="cursor:pointer;">
          ${badgePrioridade(c.prioridade)}${escapeHtml(c.cliente_nome)}
        </div>
        <div class="tempo ${tempoUrgent ? 'urgent' : ''}" onclick="abrirChamadoNoDrawer(${c.id}, ${c.cliente_id})" style="cursor:pointer;">${tempoFmt}</div>
        <div class="msg" onclick="abrirChamadoNoDrawer(${c.id}, ${c.cliente_id})" style="cursor:pointer;">${escapeHtml(c.ultima_mensagem || c.texto_abertura || '')}</div>
        <div class="lembrete-cell" id="lembrete-cell-${c.id}">—</div>
        <button class="backlog-menu-btn" onclick="event.stopPropagation();toggleLembreteForm(${c.id})" title="Criar lembrete"><i class="ti ti-bell-plus"></i></button>
      </div>`;
  }).join('');

  // Carrega lembretes de cada chamado em paralelo (pra coluna)
  chamados.forEach((c) => atualizarColunaLembrete(c.id));
}

async function atualizarColunaLembrete(chamadoId) {
  try {
    const list = await api(`/api/chamados/${chamadoId}/lembretes`);
    const cell = document.getElementById(`lembrete-cell-${chamadoId}`);
    if (!cell) return;
    if (!list.length) { cell.textContent = '—'; cell.className = 'lembrete-cell'; return; }
    const proximo = list[0];
    const min = proximo.vence_em_minutos;
    cell.classList.remove('urgent');
    cell.classList.add('has');
    if (min <= 0) {
      cell.classList.add('urgent');
      cell.innerHTML = `<i class="ti ti-bell-ringing"></i> agora`;
    } else {
      cell.innerHTML = `<i class="ti ti-bell-ringing"></i> em ${fmtMinutos(min)}`;
    }
  } catch (err) { /* ignora */ }
}

// ============================================================
// CONTATOS
// ============================================================
async function carregarContatosStats() {
  try {
    const s = await api('/api/contatos/stats');
    document.getElementById('contatos-nao-classificados').textContent = s.nao_classificados;
    document.getElementById('contatos-funcionarios').textContent = s.funcionarios;
    document.getElementById('contatos-clientes').textContent = s.clientes;
    document.getElementById('contatos-ignorados').textContent = s.ignorados;

    const badge = document.getElementById('tab-badge-contatos');
    if (s.nao_classificados > 0) {
      badge.textContent = s.nao_classificados;
      badge.classList.remove('hidden');
    } else { badge.classList.add('hidden'); }
  } catch (err) { console.error('contatos stats erro:', err); }
}

async function carregarContatos() {
  try {
    const list = await api(`/api/contatos?status=${contatosFilter}&limit=100`);
    renderContatos(list);
  } catch (err) { console.error('contatos lista erro:', err); }
}

function renderContatos(contatos) {
  const list = document.getElementById('contatos-list');
  const empty = document.getElementById('contatos-empty');

  if (!contatos.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  list.innerHTML = contatos.map((c) => renderContatoRow(c)).join('');
}

function renderContatoRow(c) {
  // Avatar baseado em sugestão (não classificados) ou tipo (classificados)
  let avatarClass = 'avatar-gray', sugestaoLabel = '', badgeClass = 'badge-gray';

  if (c.tipo === 'funcionario') {
    avatarClass = 'avatar-purple';
    sugestaoLabel = c.setor + (c.cargo ? ' · ' + c.cargo : '');
    badgeClass = 'badge-purple';
  } else if (c.tipo === 'cliente') {
    avatarClass = 'avatar-green';
    sugestaoLabel = c.cliente_principal_nome ? `cliente · ${c.cliente_principal_nome}` : 'cliente';
    badgeClass = 'badge-green';
  } else if (c.tipo === 'ignorado') {
    avatarClass = 'avatar-gray';
    sugestaoLabel = 'ignorado';
    badgeClass = 'badge-gray';
  } else {
    if (c.sugestao === 'funcionario') {
      avatarClass = 'avatar-purple'; sugestaoLabel = 'provável funcionário'; badgeClass = 'badge-purple';
    } else if (c.sugestao === 'cliente') {
      avatarClass = 'avatar-green'; sugestaoLabel = 'provável cliente'; badgeClass = 'badge-green';
    } else if (c.sugestao === 'pouca_atividade') {
      sugestaoLabel = 'pouca atividade';
    } else {
      sugestaoLabel = 'incerto';
    }
  }

  const iniciais = (c.nome || '?').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '??';
  const naClass = c.tipo === null;

  const meta = naClass
    ? `visto em <strong>${c.total_grupos} grupo${c.total_grupos === 1 ? '' : 's'}</strong> · ${c.total_mensagens} ${c.total_mensagens === 1 ? 'mensagem' : 'mensagens'}${c.ultima_mensagem ? ' · última: "' + escapeHtml(truncate(c.ultima_mensagem, 50)) + '"' : ''}`
    : c.tipo === 'cliente' && c.cliente_principal_nome
    ? `em ${escapeHtml(c.cliente_principal_nome)} · ${c.total_mensagens} mensagens · última atividade ${formatRelativo(c.ultimo_visto)}`
    : `${c.total_grupos} grupo${c.total_grupos === 1 ? '' : 's'} · ${c.total_mensagens} mensagens · última ${formatRelativo(c.ultimo_visto)}`;

  // Botões de ação
  let actions;
  if (naClass) {
    const funcRec = c.sugestao === 'funcionario';
    const cliRec = c.sugestao === 'cliente';
    actions = `
      <div class="contato-actions">
        <button class="contato-btn ${funcRec ? 'recommended' : ''}" onclick="iniciarClassificacao(${c.id}, 'funcionario')">Funcionário</button>
        <button class="contato-btn ${cliRec ? 'recommended' : ''}" onclick="iniciarClassificacao(${c.id}, 'cliente')">Cliente</button>
        <button class="contato-btn danger" onclick="classificar(${c.id}, 'ignorado')">Ignorar</button>
      </div>`;
  } else {
    actions = `
      <div class="contato-actions">
        <button class="contato-btn" onclick="desclassificar(${c.id})">Reclassificar</button>
      </div>`;
  }

  return `
    <div class="contato-row" id="contato-${c.id}">
      <div class="contato-avatar ${avatarClass}">${escapeHtml(iniciais)}</div>
      <div class="contato-info">
        <div class="contato-fone">${formatFone(c.telefone)}${c.nome ? `<span class="contato-nome">· ${escapeHtml(c.nome)}</span>` : ''}</div>
        <div class="contato-meta">${meta}</div>
      </div>
      ${sugestaoLabel ? `<div class="sugestao-badge ${badgeClass}">${escapeHtml(sugestaoLabel)}</div>` : ''}
      ${actions}
    </div>`;
}

window.iniciarClassificacao = function (contatoId, tipo) {
  const row = document.getElementById(`contato-${contatoId}`);
  if (!row) return;

  // Remove formulários abertos anteriormente
  document.querySelectorAll('.contato-form').forEach((f) => f.remove());
  document.querySelectorAll('.contato-row.expanded').forEach((r) => r.classList.remove('expanded'));

  row.classList.add('expanded');

  let formHtml;
  if (tipo === 'funcionario') {
    formHtml = `
      <div class="contato-form">
        <input type="text" id="form-nome-${contatoId}" placeholder="Nome do funcionário" />
        <select id="form-setor-${contatoId}">
          <option value="cs">cs</option>
          <option value="marketing">marketing</option>
          <option value="financeiro">financeiro</option>
          <option value="suporte">suporte</option>
          <option value="outro">outro</option>
        </select>
        <input type="text" id="form-cargo-${contatoId}" placeholder="Cargo (opcional)" />
        <button class="form-save-btn" onclick="salvarClassificacao(${contatoId}, 'funcionario')">Salvar</button>
      </div>`;
  } else if (tipo === 'cliente') {
    const opts = clientesCache.map((cl) => `<option value="${cl.id}">${escapeHtml(cl.nome)}</option>`).join('');
    formHtml = `
      <div class="contato-form">
        <input type="text" id="form-nome-${contatoId}" placeholder="Nome do contato (opcional)" />
        <select id="form-cliente-${contatoId}"><option value="">selecione o cliente...</option>${opts}</select>
        <input type="text" id="form-cargo-${contatoId}" placeholder="Cargo (Sócio, Gerente, etc.)" />
        <button class="form-save-btn" onclick="salvarClassificacao(${contatoId}, 'cliente')">Salvar</button>
      </div>`;
  }
  row.insertAdjacentHTML('beforeend', formHtml);

  // Pré-seleciona grupo principal se for cliente
  if (tipo === 'cliente') {
    const sel = document.getElementById(`form-cliente-${contatoId}`);
    // Tenta achar pelo grupo_principal_id (do backend)
    // Pra simplificar, deixamos o usuário escolher
  }

  // Foca no primeiro input
  const firstInput = row.querySelector('.contato-form input');
  if (firstInput) firstInput.focus();
};

window.salvarClassificacao = async function (contatoId, tipo) {
  const nome = document.getElementById(`form-nome-${contatoId}`).value.trim() || null;
  const cargo = document.getElementById(`form-cargo-${contatoId}`).value.trim() || null;

  const body = { tipo, nome, cargo };
  if (tipo === 'funcionario') {
    body.setor = document.getElementById(`form-setor-${contatoId}`).value;
  } else if (tipo === 'cliente') {
    const clienteId = document.getElementById(`form-cliente-${contatoId}`).value;
    if (!clienteId) { alert('Selecione o cliente.'); return; }
    body.cliente_principal_id = parseInt(clienteId);
  }

  try {
    await api(`/api/contatos/${contatoId}/classificar`, { method: 'POST', body: JSON.stringify(body) });
    await carregarContatos();
    await carregarContatosStats();
  } catch (err) {
    alert('Erro ao classificar: ' + err.message);
  }
};

window.classificar = async function (contatoId, tipo) {
  try {
    await api(`/api/contatos/${contatoId}/classificar`, {
      method: 'POST',
      body: JSON.stringify({ tipo })
    });
    await carregarContatos();
    await carregarContatosStats();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
};

window.desclassificar = async function (contatoId) {
  if (!confirm('Reclassificar este contato? Ele volta para "não classificados".')) return;
  try {
    await api(`/api/contatos/${contatoId}/desclassificar`, { method: 'POST' });
    await carregarContatos();
    await carregarContatosStats();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
};

// ============================================================
// WEBSOCKET
// ============================================================
let socket = null;
function conectarWebSocket() {
  socket = io(API_BASE, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });

  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');

  socket.on('connect', () => { dot.classList.add('connected'); dot.classList.remove('error'); label.textContent = 'ao vivo'; });
  socket.on('disconnect', () => { dot.classList.remove('connected'); label.textContent = 'reconectando'; });
  socket.on('connect_error', () => { dot.classList.add('error'); label.textContent = 'erro de conexão'; });

  socket.on('backlog:atualizado', () => carregarBacklog());
  socket.on('chamado:novo', () => { carregarBacklog(); carregarVolume(); });
  socket.on('chamado:fechado', () => { carregarBacklog(); carregarVolume(); });
  socket.on('contato:novo', () => carregarContatosStats());
  socket.on('contato:classificado', () => { carregarContatosStats(); if (contatosFilter) carregarContatos(); });
  socket.on('lembretes:atualizados', () => { carregarAlertasAtivos(); carregarBacklog(); });
  socket.on('lembrete:vencido', (payload) => {
    exibirToast(payload.lembrete, payload.contexto);
    carregarAlertasAtivos();
  });
  socket.on('mensagem:enviada', (payload) => {
    if (chatState.clienteId === payload.cliente_id) recarregarMensagens();
    carregarChamadosAtivos();
  });
}

// ============================================================
// ALERTAS ATIVOS (topo do Backlog)
// ============================================================
async function carregarAlertasAtivos() {
  try {
    const [lembretes, agendadosHoje] = await Promise.all([
      api('/api/lembretes/ativos'),
      api('/api/lembretes/agendados-hoje')
    ]);
    renderAlertas(lembretes);
    document.getElementById('kpi-lembretes').textContent = agendadosHoje.total;
  } catch (err) { console.error('alertas erro:', err); }
}

function renderAlertas(lembretes) {
  const card = document.getElementById('alertas-card');
  const lista = document.getElementById('alertas-list');
  const ativos = lembretes.filter((l) => l.status === 'disparado');

  if (!ativos.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  document.getElementById('alertas-count').textContent = ativos.length;

  lista.innerHTML = ativos.map((l) => {
    const tipo = l.tipo;
    const iconMap = {
      sla_estourado: 'ti-alarm',
      manual: 'ti-bell-ringing',
      cliente_silente: 'ti-message-2-off',
      fossilizado: 'ti-clock-pause'
    };
    const labelMap = {
      sla_estourado: 'SLA estourou',
      manual: l.criado_por_nome ? `lembrete de ${escapeHtml(l.criado_por_nome)}` : 'lembrete',
      cliente_silente: 'reengajar?',
      fossilizado: 'fossilizado'
    };
    const tipoCss = tipo.replace('_', '');
    const meta = construirMetaAlerta(l);

    // Botões: fossilizado/silente → encerrar fecha chamado; outros → adiar
    let acoesHtml;
    if (tipo === 'fossilizado' || tipo === 'cliente_silente') {
      const chamadoId = l.chamado_id;
      const primaryLabel = tipo === 'fossilizado' ? 'Reavivar' : 'Cutucar';
      acoesHtml = `
        <button class="btn-primary" onclick="resolverLembrete(${l.id}, 'atendido')">${primaryLabel}</button>
        <button class="btn-secondary" onclick="encerrarChamadoDoAlerta(${chamadoId}, ${l.id})">Encerrar</button>
      `;
    } else {
      const primaryLabel = tipo === 'sla_estourado' ? 'Atender agora' : 'Atender';
      const adiarMin = tipo === 'manual' ? 60 : 30;
      const adiarLabel = tipo === 'manual' ? 'Adiar 1h' : 'Adiar 30min';
      acoesHtml = `
        <button class="btn-primary" onclick="resolverLembrete(${l.id}, 'atendido')">${primaryLabel}</button>
        <button class="btn-secondary" onclick="adiarLembrete(${l.id}, ${adiarMin})">${adiarLabel}</button>
      `;
    }

    return `
      <div class="alerta-row">
        <i class="ti ${iconMap[tipo]} alerta-icon ${tipoCss}" aria-hidden="true"></i>
        <div class="alerta-info">
          <div class="cliente">${escapeHtml(l.cliente_nome)}</div>
          <div class="meta">${meta}</div>
        </div>
        <div class="alerta-tipo ${tipoCss}">${labelMap[tipo]}</div>
        <div class="alerta-actions">${acoesHtml}</div>
      </div>`;
  }).join('');
}

window.encerrarChamadoDoAlerta = async function (chamadoId, lembreteId) {
  if (!confirm('Encerrar este chamado como resolvido?')) return;
  try {
    await api(`/api/chamados/${chamadoId}/fechar`, { method: 'POST', body: JSON.stringify({}) });
    await api(`/api/lembretes/${lembreteId}/resolver`, {
      method: 'POST', body: JSON.stringify({ resolucao: 'atendido' })
    });
    carregarAlertasAtivos();
    carregarBacklog();
    carregarChamadosAtivos();
  } catch (err) { alert('Erro: ' + err.message); }
};

function construirMetaAlerta(l) {
  if (l.tipo === 'manual') {
    return escapeHtml(l.texto || 'sem anotação');
  }
  if (l.tipo === 'sla_estourado') {
    const min = l.aguardando_minutos || 0;
    const msg = l.ultima_mensagem ? ` · "${escapeHtml(truncate(l.ultima_mensagem, 50))}"` : '';
    return `cliente aguardando há ${fmtMinutos(min)}${msg}`;
  }
  if (l.tipo === 'cliente_silente') {
    return 'cliente não respondeu desde a última resposta da equipe';
  }
  if (l.tipo === 'fossilizado') {
    return 'aberto há mais de 3 dias sem atividade';
  }
  return '';
}

window.resolverLembrete = async function (id, resolucao) {
  try {
    await api(`/api/lembretes/${id}/resolver`, {
      method: 'POST',
      body: JSON.stringify({ resolucao, resolvido_por_nome: getNomeLogado() })
    });
    carregarAlertasAtivos();
    carregarBacklog();
    fecharToast(id);
  } catch (err) { alert('Erro: ' + err.message); }
};

window.adiarLembrete = async function (id, minutos) {
  const novaData = new Date(Date.now() + minutos * 60_000).toISOString();
  try {
    await api(`/api/lembretes/${id}/resolver`, {
      method: 'POST',
      body: JSON.stringify({ resolucao: 'adiado', adiar_para: novaData })
    });
    carregarAlertasAtivos();
    carregarBacklog();
    fecharToast(id);
  } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// CRIAR LEMBRETE MANUAL (inline form no backlog)
// ============================================================
const PRESETS = [
  { label: 'Em 1 hora', minutos: 60 },
  { label: 'Em 2 horas', minutos: 120 },
  { label: 'Em 4 horas', minutos: 240 },
  { label: 'Amanhã 9h', minutos: null, calc: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d;
  }}
];

window.toggleLembreteForm = function (chamadoId) {
  // Fecha qualquer outro form aberto
  document.querySelectorAll('.lembrete-form-wrapper').forEach((w) => w.remove());

  const row = document.getElementById(`backlog-row-${chamadoId}`);
  if (!row) return;

  if (row.nextElementSibling && row.nextElementSibling.classList.contains('lembrete-form-wrapper')) {
    row.nextElementSibling.remove();
    return;
  }

  const presetsHtml = PRESETS.map((p, i) => `<button class="preset-btn" data-i="${i}" onclick="selecionarPreset(${chamadoId}, ${i})">${p.label}</button>`).join('');

  const html = `
    <div class="lembrete-form-wrapper" id="form-wrapper-${chamadoId}">
      <div class="lembrete-form">
        <div class="lembrete-form-title">Criar lembrete pra este chamado</div>
        <div class="lembrete-presets">${presetsHtml}</div>
        <textarea id="form-texto-${chamadoId}" placeholder="Anotação (ex: avisar quando o jurídico retornar)"></textarea>
        <div class="lembrete-form-actions">
          <button class="cancel-btn" onclick="toggleLembreteForm(${chamadoId})">Cancelar</button>
          <button class="save-btn" onclick="salvarLembrete(${chamadoId})">Agendar lembrete</button>
        </div>
      </div>
    </div>`;

  row.insertAdjacentHTML('afterend', html);
};

const presetEscolhido = {};
window.selecionarPreset = function (chamadoId, i) {
  presetEscolhido[chamadoId] = i;
  document.querySelectorAll(`#form-wrapper-${chamadoId} .preset-btn`).forEach((b, idx) => {
    b.classList.toggle('active', idx === i);
  });
};

window.salvarLembrete = async function (chamadoId) {
  const i = presetEscolhido[chamadoId];
  if (i === undefined || i === null) { alert('Escolha um horário (1h, 2h, 4h, amanhã 9h)'); return; }
  const preset = PRESETS[i];
  const data = preset.calc ? preset.calc() : new Date(Date.now() + preset.minutos * 60_000);
  const texto = document.getElementById(`form-texto-${chamadoId}`).value.trim();

  try {
    await api('/api/lembretes', {
      method: 'POST',
      body: JSON.stringify({
        chamado_id: chamadoId,
        disparar_em: data.toISOString(),
        texto,
        criado_por_nome: getNomeLogado()
      })
    });
    delete presetEscolhido[chamadoId];
    document.getElementById(`form-wrapper-${chamadoId}`).remove();
    carregarBacklog();
    carregarAlertasAtivos();
  } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// TOASTS
// ============================================================
function exibirToast(lembrete, contexto) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const tipo = lembrete.tipo;
  const isCritico = tipo === 'sla_estourado';
  const isManual = tipo === 'manual';
  const cssClass = isCritico ? 'critico' : isManual ? 'manual' : '';

  const iconMap = {
    sla_estourado: 'ti-alarm',
    manual: 'ti-bell-ringing',
    cliente_silente: 'ti-message-2-off',
    fossilizado: 'ti-clock-pause'
  };
  const tituloMap = {
    sla_estourado: `SLA estourou: ${contexto?.cliente_nome || ''}`,
    manual: `Lembrete: ${contexto?.cliente_nome || ''}`,
    cliente_silente: `Cliente silente: ${contexto?.cliente_nome || ''}`,
    fossilizado: `Chamado fossilizado: ${contexto?.cliente_nome || ''}`
  };
  const textoTop = lembrete.texto || (tipo === 'sla_estourado'
    ? `aguardando há ${fmtMinutos(contexto?.aguardando_minutos || 0)}`
    : tipo === 'cliente_silente'
    ? 'cliente não responde há 24h+'
    : 'aberto há mais de 3 dias');

  const id = `toast-${lembrete.id}`;
  // Remove duplicado
  document.getElementById(id)?.remove();

  const html = `
    <div class="toast ${cssClass}" id="${id}">
      <div class="toast-content">
        <div class="toast-icon"><i class="ti ${iconMap[tipo]}" aria-hidden="true"></i></div>
        <div class="toast-body">
          <div class="toast-title">${escapeHtml(tituloMap[tipo])}</div>
          <div class="toast-text">${escapeHtml(textoTop)}</div>
          <div class="toast-actions">
            <button class="primary" onclick="resolverLembrete(${lembrete.id}, 'atendido')">Abrir chamado</button>
            <button onclick="adiarLembrete(${lembrete.id}, 30)">Adiar 30min</button>
            <button onclick="resolverLembrete(${lembrete.id}, 'cancelado')">Cancelar</button>
          </div>
        </div>
        <button class="toast-close" onclick="fecharToast(${lembrete.id})"><i class="ti ti-x"></i></button>
      </div>
    </div>`;

  container.insertAdjacentHTML('beforeend', html);
  tocarSom();
  notificarBrowser(tituloMap[tipo], textoTop);
}

window.fecharToast = function (lembreteId) {
  const el = document.getElementById(`toast-${lembreteId}`);
  if (el) el.remove();
};

// ============================================================
// SOM
// ============================================================
function configurarSomToggle() {
  const btn = document.getElementById('som-toggle');
  if (!btn) return;
  atualizarIconeSom();
  btn.addEventListener('click', () => {
    const atual = localStorage.getItem(SOM_KEY) !== 'off';
    localStorage.setItem(SOM_KEY, atual ? 'off' : 'on');
    atualizarIconeSom();
  });
}

function atualizarIconeSom() {
  const ligado = localStorage.getItem(SOM_KEY) !== 'off';
  const btn = document.getElementById('som-toggle');
  const icon = document.getElementById('som-icon');
  if (!btn || !icon) return;
  if (ligado) {
    btn.classList.remove('muted');
    icon.className = 'ti ti-volume';
  } else {
    btn.classList.add('muted');
    icon.className = 'ti ti-volume-off';
  }
}

let audioCtx = null;
function tocarSom() {
  if (localStorage.getItem(SOM_KEY) === 'off') return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    // 2 beeps: fa-do
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain).connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t0 = now + i * 0.18;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
  } catch (err) { /* navegador não suporta */ }
}

// ============================================================
// NOTIFICAÇÃO DO NAVEGADOR
// ============================================================
function pedirPermissaoNotificacao() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function notificarBrowser(titulo, corpo) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // só notifica se aba está em segundo plano
  try { new Notification(titulo, { body: corpo, icon: '/favicon.ico', tag: 'sereia-cs' }); }
  catch (err) { /* ignora */ }
}

// ============================================================
// CHAT — agora com envio (Opção C: usa número 2chat do funcionário logado)
// ============================================================
const EMOJIS_COMUNS = ['👍', '❤️', '😂', '🙏', '👌', '✅', '🔥', '👏', '😊', '😢', '😡', '🚫'];

const chatState = {
  clienteId: null,
  chamadoId: null,
  mensagens: [],
  carregandoMais: false,
  semMaisHistorico: false,
  replyTo: null,
  gravando: false,
  mediaRecorder: null,
  chunksAudio: [],
  hostElement: null,
};

window.fecharDrawer = function () {
  document.getElementById('chat-drawer').classList.add('hidden');
  chatState.hostElement = null;
};

window.abrirChamadoNoDrawer = async function (chamadoId, clienteId) {
  document.getElementById('chat-drawer').classList.remove('hidden');
  chatState.hostElement = document.getElementById('chat-drawer-panel');
  await abrirChat(clienteId, chamadoId);
};

window.abrirChamadoNaAba = async function (chamadoId, clienteId) {
  chatState.hostElement = document.getElementById('chamados-chat-main');
  await abrirChat(clienteId, chamadoId);
  // marca item ativo na lista
  document.querySelectorAll('.chamado-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.chamadoId == chamadoId);
  });
};

async function abrirChat(clienteId, chamadoId) {
  chatState.clienteId = clienteId;
  chatState.chamadoId = chamadoId;
  chatState.replyTo = null;
  chatState.semMaisHistorico = false;

  renderChatSkeleton();

  try {
    const [chamado, mensagens] = await Promise.all([
      api(`/api/chamados/${chamadoId}`),
      api(`/api/clientes/${clienteId}/mensagens?limit=50`)
    ]);
    chatState.mensagens = mensagens;
    renderChat(chamado);
  } catch (err) {
    console.error('abrir chat erro:', err);
  }
}

function renderChatSkeleton() {
  if (!chatState.hostElement) return;
  chatState.hostElement.innerHTML = `<div class="chat-component"><div class="chat-mensagens" style="display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);">carregando...</div></div>`;
}

function renderChat(chamado) {
  if (!chatState.hostElement) return;
  const cliente = chamado.cliente_nome;
  const iniciais = cliente.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  const aguardando = chamado.aguardando_desde;
  const statusTexto = aguardando
    ? `aguardando há ${fmtMinutos(((Date.now() - new Date(aguardando)) / 60000) | 0)}`
    : 'aguardando cliente';
  const statusCor = aguardando ? '#EF9F27' : 'var(--sereia-purple)';
  const responsavel = chamado.responsavel_nome ? ` · ${escapeHtml(chamado.responsavel_nome)}` : '';

  const linkWa = chamado.link_whatsapp;
  const btnAbrirGrupoHtml = linkWa
    ? `<a href="${escapeAttr(linkWa)}" target="_blank" rel="noopener" class="chat-header-btn" title="Abrir grupo no WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>`
    : '';

  // Selector de prioridade
  const prio = chamado.prioridade;
  const prioLabel = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const prioBtnClass = prio ? `prio-btn prio-${prio}` : 'prio-btn prio-none';
  const prioBtnText = prio ? prioLabel[prio] : 'Definir prioridade';
  const prioDropdown = `
    <div class="prio-wrapper">
      <button class="${prioBtnClass}" onclick="togglePrioDropdown(${chamado.id})">
        <i class="ti ti-flag" aria-hidden="true"></i> ${prioBtnText}
      </button>
      <div class="prio-dropdown hidden" id="prio-dropdown-${chamado.id}">
        <button onclick="definirPrioridade(${chamado.id}, 'alta')"><span class="prio-dot prio-alta"></span> Alta</button>
        <button onclick="definirPrioridade(${chamado.id}, 'media')"><span class="prio-dot prio-media"></span> Média</button>
        <button onclick="definirPrioridade(${chamado.id}, 'baixa')"><span class="prio-dot prio-baixa"></span> Baixa</button>
        ${prio ? '<button onclick="definirPrioridade(' + chamado.id + ', null)"><span class="prio-dot prio-none"></span> Remover</button>' : ''}
      </div>
    </div>
  `;

  const funcionario = getFuncionario();
  const podeEnviar = funcionario?.conectado;
  const placeholder = podeEnviar
    ? `Responder como ${funcionario.nome}`
    : 'Você não tem número 2chat conectado';

  chatState.hostElement.innerHTML = `
    <div class="chat-component">
      <div class="chat-header">
        ${chatState.hostElement.id === 'chat-drawer-panel' ? '<button class="icon-btn" onclick="fecharDrawer()"><i class="ti ti-arrow-left"></i></button>' : ''}
        <div class="chat-header-avatar">${escapeHtml(iniciais)}</div>
        <div class="chat-header-info">
          <div class="chat-header-cliente">${escapeHtml(cliente)}</div>
          <div class="chat-header-status">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${statusCor}; display: inline-block;"></span>
            ${statusTexto} · aberto há ${fmtMinutos(((Date.now() - new Date(chamado.aberto_em)) / 60000) | 0)}${responsavel}
          </div>
        </div>
        <div class="chat-header-actions">
          ${prioDropdown}
          ${btnAbrirGrupoHtml}
          <button class="chat-header-btn" onclick="abrirLembreteNoChat(${chamado.id})"><i class="ti ti-bell-plus"></i> Lembrete</button>
          <button class="chat-header-btn success" onclick="resolverChamadoNoChat(${chamado.id})"><i class="ti ti-check"></i> Resolver</button>
        </div>
      </div>
      ${chamado.contato_abertura_nome ? `
      <div class="chat-context">
        <span><i class="ti ti-user" aria-hidden="true"></i> aberto por <strong>${escapeHtml(chamado.contato_abertura_nome)}</strong>${chamado.contato_abertura_cargo ? ' · ' + escapeHtml(chamado.contato_abertura_cargo) : ''}</span>
        ${chamado.categoria_ia ? `<span><i class="ti ti-tag" aria-hidden="true"></i> ${escapeHtml(chamado.categoria_ia)}</span>` : ''}
      </div>` : ''}

      <div class="chat-mensagens" id="chat-mensagens-area" onscroll="onScrollMensagens()">
        ${renderMensagensHtml(chatState.mensagens)}
      </div>

      <div id="chat-reply-preview"></div>

      <div class="chat-emoji-bar hidden" id="chat-emoji-bar">
        ${EMOJIS_COMUNS.map(e => `<button onclick="inserirEmoji('${e}')">${e}</button>`).join('')}
      </div>

      ${!podeEnviar ? `
        <div class="chat-aviso-sem-canal">
          <i class="ti ti-alert-circle" aria-hidden="true"></i>
          Você ainda não tem WhatsApp conectado ao 2chat. ${linkWa ? '<a href="' + escapeAttr(linkWa) + '" target="_blank" style="color: inherit; text-decoration: underline;">Responda pelo WhatsApp do grupo</a>.' : 'Cadastre seu número em Contatos > seu nome.'}
        </div>
      ` : `
        <div class="chat-input">
          <button class="icon-btn" onclick="toggleEmojiBar()" title="Emoji"><i class="ti ti-mood-smile"></i></button>
          <button class="icon-btn" onclick="abrirAnexo()" title="Anexar"><i class="ti ti-paperclip"></i></button>
          <input type="file" id="anexo-file-input" style="display:none" onchange="enviarAnexo()">
          <button class="icon-btn" id="audio-btn" onclick="toggleGravacao()" title="Áudio"><i class="ti ti-microphone"></i></button>
          <input type="text" id="chat-texto-input" placeholder="${escapeAttr(placeholder)}" onkeydown="if(event.key==='Enter')enviarTexto()">
          <button class="send-btn" onclick="enviarTexto()" title="Enviar"><i class="ti ti-send"></i></button>
        </div>
      `}
    </div>`;

  const area = document.getElementById('chat-mensagens-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function renderMensagensHtml(mensagens) {
  if (!mensagens.length) return '<div style="text-align:center;color:var(--text-tertiary);font-size:11px;padding:1rem;">Sem mensagens ainda</div>';

  let html = chatState.semMaisHistorico ? '' : '<button class="chat-load-more" onclick="carregarMaisHistorico()">carregar mais antigas</button>';
  let ultimaData = null;

  mensagens.forEach((m) => {
    const dataMsg = new Date(m.enviado_em).toDateString();
    if (dataMsg !== ultimaData) {
      html += `<div class="data-divider">${formatDataDivider(m.enviado_em)}</div>`;
      ultimaData = dataMsg;
    }
    html += renderBolha(m);
  });

  return html;
}

function renderBolha(m) {
  const isDireita = m.origem === 'funcionario' || m.origem === 'bot';
  const wrapClass = isDireita ? 'right' : 'left';
  const bolhaClass = m.origem === 'bot' ? 'bot' : (m.origem === 'funcionario' ? 'funcionario' : 'cliente');

  // Quem é o remetente exibido
  let nomeRemetente = m.contato_nome || formatFone(m.remetente_telefone);
  let sufixo = '';
  if (m.origem === 'bot') sufixo = ' · bot';
  else if (m.origem === 'funcionario') {
    if (m.enviado_pelo_painel && m.funcionario_remetente_nome) {
      nomeRemetente = m.funcionario_remetente_nome;
      sufixo = m.funcionario_remetente_setor ? ' · ' + m.funcionario_remetente_setor : '';
    } else if (m.contato_setor) {
      sufixo = ' · ' + m.contato_setor;
    }
  } else if (m.contato_cargo) sufixo = ' · ' + m.contato_cargo;

  // Reply
  const replyHtml = m.reply_to_uuid && m.reply_preview
    ? `<div class="bolha-reply">↪ ${escapeHtml(truncate(m.reply_preview, 80))}</div>` : '';

  // Mídia
  const midiaHtml = renderMidia(m);

  // Reações
  const reacoes = m.reacoes || [];
  const reacoesHtml = reacoes.length
    ? `<div class="reacoes-bar">${reacoes.map(r => escapeHtml(r.emoji)).join('')} ${reacoes.length}</div>` : '';

  const checks = m.enviado_pelo_painel
    ? (m.status_entrega === 'read' ? '<span class="check">✓✓</span>' : m.status_entrega === 'delivered' ? '✓✓' : '✓')
    : '';

  return `
    <div class="msg-wrapper ${wrapClass}">
      <div class="bolha ${bolhaClass}">
        ${replyHtml}
        ${midiaHtml}
        ${m.texto ? escapeHtml(m.texto).replace(/\n/g,'<br>') : ''}
        <div class="bolha-actions">
          <button onclick="iniciarReply('${escapeAttr(m.msg_uuid)}', '${escapeAttr(truncate(m.texto || m.midia_nome || '(mídia)', 80))}')" title="Responder citando"><i class="ti ti-arrow-back-up"></i></button>
          <button onclick="reagirNaMensagem('${escapeAttr(m.msg_uuid)}', '👍')" title="👍">👍</button>
          <button onclick="reagirNaMensagem('${escapeAttr(m.msg_uuid)}', '✅')" title="✅">✅</button>
        </div>
      </div>
      ${reacoesHtml}
      <div class="bolha-meta">
        <strong>${escapeHtml(nomeRemetente)}</strong>${escapeHtml(sufixo)} · ${formatHoraMin(m.enviado_em)} ${checks}
      </div>
    </div>`;
}

function renderMidia(m) {
  if (!m.tipo_midia) return '';
  const url = m.midia_url || '';
  if (m.tipo_midia === 'imagem') {
    return `<div class="bolha-midia"><a href="${escapeAttr(url)}" target="_blank"><img src="${escapeAttr(url)}" alt="imagem"></a></div>`;
  }
  if (m.tipo_midia === 'audio') {
    return `<div class="bolha-midia bolha-audio"><audio controls src="${escapeAttr(url)}"></audio></div>`;
  }
  if (m.tipo_midia === 'video') {
    return `<div class="bolha-midia"><video controls style="max-width:100%;max-height:200px;border-radius:6px;" src="${escapeAttr(url)}"></video></div>`;
  }
  if (m.tipo_midia === 'documento') {
    const nome = m.midia_nome || 'arquivo';
    return `<a href="${escapeAttr(url)}" target="_blank" style="text-decoration:none;color:inherit;"><div class="bolha-midia bolha-documento"><i class="ti ti-file-text"></i><div style="flex:1;font-size:11px;">${escapeHtml(truncate(nome, 36))}</div><i class="ti ti-download" style="font-size:14px;color:var(--text-secondary);"></i></div></a>`;
  }
  return '';
}

// ============================================================
// Ações do chat
// ============================================================
window.onScrollMensagens = function () {
  const el = document.getElementById('chat-mensagens-area');
  if (!el || chatState.carregandoMais || chatState.semMaisHistorico) return;
  if (el.scrollTop < 60) carregarMaisHistorico();
};

window.carregarMaisHistorico = async function () {
  if (chatState.carregandoMais || chatState.semMaisHistorico) return;
  chatState.carregandoMais = true;
  const primeira = chatState.mensagens[0];
  if (!primeira) { chatState.carregandoMais = false; return; }

  try {
    const mais = await api(`/api/clientes/${chatState.clienteId}/mensagens?antes_de=${encodeURIComponent(primeira.enviado_em)}&limit=50`);
    if (mais.length === 0) chatState.semMaisHistorico = true;
    else chatState.mensagens = [...mais, ...chatState.mensagens];

    const area = document.getElementById('chat-mensagens-area');
    const scrollPrev = area.scrollHeight;
    area.innerHTML = renderMensagensHtml(chatState.mensagens);
    area.scrollTop = area.scrollHeight - scrollPrev;
  } catch (err) {
    console.error('carregar mais erro:', err);
  } finally {
    chatState.carregandoMais = false;
  }
};

// ============================================================
// Envio (texto, anexo, áudio, emoji, reply, reagir)
// ============================================================
window.enviarTexto = async function () {
  const input = document.getElementById('chat-texto-input');
  const texto = input.value.trim();
  if (!texto) return;

  const body = { cliente_id: chatState.clienteId, texto };
  if (chatState.replyTo) {
    body.reply_to_uuid = chatState.replyTo.uuid;
    body.reply_preview = chatState.replyTo.preview;
  }

  input.value = '';
  cancelarReply();

  try {
    await api('/api/mensagens/enviar', { method: 'POST', body: JSON.stringify(body) });
    await recarregarMensagens();
  } catch (err) {
    alert('Erro ao enviar: ' + err.message);
  }
};

window.abrirAnexo = function () {
  document.getElementById('anexo-file-input').click();
};

window.enviarAnexo = async function () {
  const fileInput = document.getElementById('anexo-file-input');
  const file = fileInput.files[0];
  if (!file) return;

  try {
    const form = new FormData();
    form.append('file', file);
    const f = getFuncionario();
    const r = await fetch(`${API_BASE}/api/mensagens/upload`, {
      method: 'POST',
      headers: { 'X-CS-Token': getToken(), 'X-CS-Funcionario-Id': f?.id || '' },
      body: form
    });
    const upload = await r.json();
    if (!r.ok) throw new Error(upload.error || 'falha no upload');

    await api('/api/mensagens/enviar', {
      method: 'POST',
      body: JSON.stringify({
        cliente_id: chatState.clienteId,
        midia_url: upload.url,
        midia_tipo: upload.tipo,
        midia_nome: upload.nome,
        midia_mime: upload.mime
      })
    });
    fileInput.value = '';
    await recarregarMensagens();
  } catch (err) {
    alert('Erro ao enviar anexo: ' + err.message);
  }
};

window.toggleGravacao = async function () {
  if (chatState.gravando) {
    chatState.mediaRecorder?.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Navegador não suporta gravação de áudio'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chatState.mediaRecorder = mr;
    chatState.chunksAudio = [];
    chatState.gravando = true;
    document.getElementById('audio-btn').classList.add('recording');

    mr.ondataavailable = (e) => chatState.chunksAudio.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      chatState.gravando = false;
      document.getElementById('audio-btn')?.classList.remove('recording');

      const blob = new Blob(chatState.chunksAudio, { type: 'audio/webm' });
      const form = new FormData();
      form.append('file', blob, `audio-${Date.now()}.webm`);

      try {
        const f = getFuncionario();
        const r = await fetch(`${API_BASE}/api/mensagens/upload`, {
          method: 'POST',
          headers: { 'X-CS-Token': getToken(), 'X-CS-Funcionario-Id': f?.id || '' },
          body: form
        });
        const up = await r.json();
        if (!r.ok) throw new Error(up.error);

        await api('/api/mensagens/enviar', {
          method: 'POST',
          body: JSON.stringify({
            cliente_id: chatState.clienteId,
            midia_url: up.url,
            midia_tipo: 'audio',
            midia_mime: 'audio/webm'
          })
        });
        await recarregarMensagens();
      } catch (err) {
        alert('Erro no áudio: ' + err.message);
      }
    };
    mr.start();
  } catch (err) {
    alert('Permissão de microfone negada: ' + err.message);
  }
};

window.toggleEmojiBar = function () {
  document.getElementById('chat-emoji-bar')?.classList.toggle('hidden');
};

window.inserirEmoji = function (emoji) {
  const input = document.getElementById('chat-texto-input');
  if (!input) return;
  input.value += emoji;
  input.focus();
};

window.iniciarReply = function (uuid, preview) {
  chatState.replyTo = { uuid, preview };
  document.getElementById('chat-reply-preview').innerHTML = `
    <div class="chat-reply-preview">
      <i class="ti ti-arrow-back-up"></i>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">respondendo: ${escapeHtml(preview)}</span>
      <button class="close-reply" onclick="cancelarReply()"><i class="ti ti-x"></i></button>
    </div>`;
  document.getElementById('chat-texto-input')?.focus();
};

window.cancelarReply = function () {
  chatState.replyTo = null;
  const el = document.getElementById('chat-reply-preview');
  if (el) el.innerHTML = '';
};

window.reagirNaMensagem = async function (msgUuid, emoji) {
  try {
    await api(`/api/mensagens/${encodeURIComponent(msgUuid)}/reagir`, {
      method: 'POST',
      body: JSON.stringify({ cliente_id: chatState.clienteId, emoji })
    });
    await recarregarMensagens();
  } catch (err) { alert('Erro: ' + err.message); }
};

window.togglePrioDropdown = function (chamadoId) {
  // Fecha qualquer outro aberto
  document.querySelectorAll('.prio-dropdown').forEach(d => {
    if (d.id !== `prio-dropdown-${chamadoId}`) d.classList.add('hidden');
  });
  document.getElementById(`prio-dropdown-${chamadoId}`)?.classList.toggle('hidden');
};

window.definirPrioridade = async function (chamadoId, prio) {
  try {
    await api(`/api/chamados/${chamadoId}/prioridade`, {
      method: 'PUT',
      body: JSON.stringify({ prioridade: prio })
    });
    document.getElementById(`prio-dropdown-${chamadoId}`)?.classList.add('hidden');
    // re-render
    if (chatState.chamadoId === chamadoId) abrirChat(chatState.clienteId, chamadoId);
    carregarBacklog();
    carregarChamadosAtivos();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
};

// Fecha dropdowns ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('.prio-wrapper')) {
    document.querySelectorAll('.prio-dropdown').forEach(d => d.classList.add('hidden'));
  }
});

window.resolverChamadoNoChat = async function (chamadoId) {
  if (!confirm('Marcar este chamado como resolvido?')) return;
  try {
    await api(`/api/chamados/${chamadoId}/fechar`, { method: 'POST', body: JSON.stringify({ por_nome: getNomeLogado() }) });
    await abrirChat(chatState.clienteId, chamadoId);
    carregarChamadosAtivos();
    carregarBacklog();
  } catch (err) { alert('Erro: ' + err.message); }
};

window.abrirLembreteNoChat = function (chamadoId) {
  // Reaproveita o form do backlog: pra MVP, prompt simples
  const minStr = prompt('Em quantos minutos? (60 = 1h, 120 = 2h, 240 = 4h)');
  if (!minStr) return;
  const min = parseInt(minStr);
  if (!min || min < 1) return;
  const texto = prompt('Anotação (opcional):') || '';
  const data = new Date(Date.now() + min * 60_000).toISOString();
  api('/api/lembretes', {
    method: 'POST',
    body: JSON.stringify({ chamado_id: chamadoId, disparar_em: data, texto, criado_por_nome: getNomeLogado() })
  }).then(() => {
    alert('Lembrete agendado.');
    carregarAlertasAtivos();
  }).catch((err) => alert('Erro: ' + err.message));
};

async function recarregarMensagens() {
  try {
    const m = await api(`/api/clientes/${chatState.clienteId}/mensagens?limit=50`);
    chatState.mensagens = m;
    const area = document.getElementById('chat-mensagens-area');
    if (area) {
      area.innerHTML = renderMensagensHtml(chatState.mensagens);
      area.scrollTop = area.scrollHeight;
    }
  } catch (err) { console.error(err); }
}

// ============================================================
// ABA CHAMADOS - lista lateral
// ============================================================
async function carregarChamadosAtivos() {
  try {
    const list = await api('/api/chamados/ativos');
    document.getElementById('chamados-list-count').textContent = list.length;
    const badge = document.getElementById('tab-badge-chamados');
    if (list.length > 0) { badge.textContent = list.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    const cont = document.getElementById('chamados-list-items');
    cont.innerHTML = list.map((c) => {
      const semaforoCls = c.semaforo;
      const tempoStr = c.aguardando_desde ? fmtMinutos(c.aguardando_minutos) : '—';
      const tempoCls = c.semaforo === 'critico' ? 'urgent' : '';
      return `
        <div class="chamado-item" data-chamado-id="${c.id}" onclick="abrirChamadoNaAba(${c.id}, ${c.cliente_id})">
          <span class="semaforo ${semaforoCls}"></span>
          <div style="min-width:0;">
            <div class="chamado-cliente">${badgePrioridade(c.prioridade)}${escapeHtml(c.cliente_nome)}</div>
            <div class="chamado-preview">${escapeHtml(truncate(c.ultima_mensagem || c.texto_abertura || '', 50))}</div>
          </div>
          <div class="chamado-tempo ${tempoCls}">${tempoStr}</div>
        </div>`;
    }).join('') || '<div style="padding:1.5rem;text-align:center;color:var(--text-tertiary);font-size:12px;">Sem chamados ativos</div>';
  } catch (err) { console.error('chamados ativos erro:', err); }
}

// ============================================================
// UTILS
// ============================================================
function fmtNum(n) { return Number(n).toLocaleString('pt-BR'); }

function fmtMinutos(min) {
  const m = Number(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

function formatDia(iso) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatRelativo(iso) {
  if (!iso) return 'há tempo';
  const d = new Date(iso);
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  return `há ${dias}d`;
}

function formatHoraMin(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDataDivider(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'hoje';
  if (d.toDateString() === ontem.toDateString()) return 'ontem';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function escapeAttr(s) {
  return escapeHtml(String(s)).replace(/\n/g, ' ');
}

function badgePrioridade(prio) {
  if (!prio) return '';
  const map = { alta: '🔴', media: '🟡', baixa: '⚪' };
  return `<span class="prio-badge prio-${prio}" title="prioridade ${prio}">${map[prio] || ''}</span>`;
}

function formatFone(telefone) {
  if (!telefone) return '—';
  const t = String(telefone).replace(/\D/g, '');
  // Formato BR: +55 11 99999-8888
  if (t.length === 13 && t.startsWith('55')) {
    return `+55 ${t.slice(2, 4)} ${t.slice(4, 9)}-${t.slice(9)}`;
  }
  if (t.length === 12 && t.startsWith('55')) {
    return `+55 ${t.slice(2, 4)} ${t.slice(4, 8)}-${t.slice(8)}`;
  }
  return '+' + t;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================================
// BOOT
// ============================================================
const fSaved = getFuncionario();
if (getToken() && fSaved) {
  funcionarioSelecionado = fSaved;
  tentarLogin(getToken()).then((ok) => { if (!ok) { loginView.classList.remove('hidden'); carregarFuncionariosLogin(); } });
} else {
  carregarFuncionariosLogin();
}

// Botão sair
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', () => {
    clearToken(); clearFuncionario(); location.reload();
  });
});

/* ============================================================
   MEGA-SENA — Gerador de Apostas
   script.js — Lógica principal (v5)
   ============================================================ */

// ── ESTADO GLOBAL ──────────────────────────────────────────
const S = {
    contests: [],
    group: new Set(),
    bets: [],
    settings: {
        betSize: 6,
        betCount: 10,
        withRepetition: false,
        betValue: ''
    }
};

// ── ARRAY FINAL (acumulador de lotes impressos) ────────────
const S_ARRAY_FINAL = []; // [{ id, bets, label, timestamp }]
let _afCounter = 0;

// ── RASTREAMENTO DE FILTROS (para PDF) ─────────────────────
const S_FILTER = {
    preGroup: null,          // { n: 9 } | null (se null = grupo manual/aleatório)
    originalGroupNums: null, // Set com os números do grupo no momento de usePreGroup
    manualInclusions: [],    // [{ num, delay }] — inclusões rastreadas
    exclusions: [],          // [{ type, ... }] — todas as exclusões rastreadas
    predefinedBets: [],      // [{ nums, label, k }] — apostas pré-definidas adicionadas
};

// ── MATEMÁTICA ─────────────────────────────────────────────
function comb(n, r) {
    if (r > n || r < 0) return 0;
    if (r === 0 || r === n) return 1;
    let res = 1;
    for (let i = 0; i < r; i++) res = res * (n - i) / (i + 1);
    return Math.round(res);
}

function fmtOdds(c) {
    return '1 em ' + c.toLocaleString('pt-BR');
}

// ── EMBARALHAMENTO ─────────────────────────────────────────
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ── SEÇÃO: PROBABILIDADES ──────────────────────────────────
const PROB_SIZES = [60, 48, 42, 36, 30, 24, 18];

function renderProbabilitySection() {
    const data = PROB_SIZES.map(n => ({ n, c: comb(n, 6) }));
    const logMax = Math.log10(data[0].c);
    const logMin = Math.log10(data[data.length - 1].c);
    const logRange = logMax - logMin;

    const rows = data.map(({ n, c }, i) => {
        const pct = ((Math.log10(c) - logMin) / logRange * 95 + 5).toFixed(1);
        const isLowest = i === data.length - 1;
        return `<tr>
            <td class="prob-n">${n}</td>
            <td>${c.toLocaleString('pt-BR')}</td>
            <td><strong>${fmtOdds(c)}</strong></td>
            <td class="bar-cell">
                <div class="bar-wrap">
                    <div class="bar-track">
                        <div class="bar${isLowest ? ' bar-lo' : ''}" style="width:${pct}%"></div>
                    </div>
                </div>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('prob-table-body').innerHTML = rows;
}

// ── ANÁLISE ODS ────────────────────────────────────────────
function computePreGroups() {
    return [5, 6, 7, 8, 9, 10, 11, 12, 13, 17].map(n => {
        const nums = new Set();
        S.contests.slice(-n).forEach(c => c.numbers.forEach(x => nums.add(x)));
        const count = nums.size;
        return { n, count, numbers: Array.from(nums).sort((a, b) => a - b), odds: comb(count, 6) };
    });
}

// Retorna todos os 60 números com seus atrasos, ordenados do maior para o menor
function computeAllDelays() {
    const total = S.contests.length;
    const lastSeen = {};
    for (let i = 1; i <= 60; i++) lastSeen[i] = -1;
    S.contests.forEach((c, idx) => c.numbers.forEach(n => { lastSeen[n] = idx; }));
    const out = [];
    for (let n = 1; n <= 60; n++) {
        const delay = total - 1 - lastSeen[n];
        out.push({ number: n, delay });
    }
    return out.sort((a, b) => b.delay - a.delay || a.number - b.number);
}

function computeRanges() {
    const last5 = S.contests.slice(-5);
    return [
        { label: '01–09', start: 1,  end: 9  },
        { label: '10–19', start: 10, end: 19 },
        { label: '20–29', start: 20, end: 29 },
        { label: '30–39', start: 30, end: 39 },
        { label: '40–49', start: 40, end: 49 },
        { label: '50–60', start: 50, end: 60 }
    ].map(r => {
        const allCovered = last5.length === 5 &&
            last5.every(c => c.numbers.some(n => n >= r.start && n <= r.end));
        const nums = new Set();
        last5.forEach(c => c.numbers.forEach(n => { if (n >= r.start && n <= r.end) nums.add(n); }));
        return { ...r, numbers: Array.from(nums).sort((a, b) => a - b), detected: allCovered };
    });
}

// Detecção sequencial
function computeRepeatSeq(nContests) {
    const slice = S.contests.slice(-nContests);
    if (slice.length < nContests) return { detected: false, numbers: [] };

    let detected = true;
    for (let i = 0; i < slice.length - 1; i++) {
        const setA = new Set(slice[i].numbers);
        if (!slice[i + 1].numbers.some(n => setA.has(n))) { detected = false; break; }
    }

    const counts = {};
    slice.forEach(c => c.numbers.forEach(n => { counts[n] = (counts[n] || 0) + 1; }));
    const numbers = Object.entries(counts)
        .filter(([, cnt]) => cnt >= 2)
        .map(([n, cnt]) => ({ number: parseInt(n), count: cnt }))
        .sort((a, b) => b.count - a.count || a.number - b.number);

    return { detected, numbers };
}

// Repetições últimos 10
function computeRepeat10() {
    const slice = S.contests.slice(-10);
    const counts = {};
    slice.forEach(c => c.numbers.forEach(n => { counts[n] = (counts[n] || 0) + 1; }));
    return Object.entries(counts)
        .filter(([, cnt]) => cnt >= 2)
        .map(([n, cnt]) => ({ number: parseInt(n), count: cnt }))
        .sort((a, b) => b.count - a.count || a.number - b.number);
}

// ── HISTÓRICO ─────────────────────────────────────────────
function computeHistorico() {
    const n = S.contests.length;
    const startIdx = Math.max(1, n - 80);
    const results = [];

    for (let i = startIdx; i < n; i++) {
        const contest = S.contests[i];
        const target = contest.numbers;
        const pool = new Set();
        let sena = null, quina = null, quadra = null;

        for (let j = 1; j <= i; j++) {
            S.contests[i - j].numbers.forEach(num => pool.add(num));
            const covered = target.filter(num => pool.has(num)).length;
            if (quadra === null && covered >= 4) quadra = j;
            if (quina === null && covered >= 5) quina = j;
            if (sena === null && covered === 6) { sena = j; break; }
        }

        results.push({
            concurso: contest.concurso,
            data: contest.data,
            numbers: target,
            sena,
            quina,
            quadra
        });
    }

    return results; // Ordem cronológica — mais antigo primeiro
}

// ── FAIXAS REPETIDAS ──────────────────────────────────────
const FAIXAS_REPETIDAS = [
    { label: '1–20',          threshold: 16,  test: n => n >= 1  && n <= 20 },
    { label: '11–30',         threshold: 11,  test: n => n >= 11 && n <= 30 },
    { label: '21–40',         threshold: 16,  test: n => n >= 21 && n <= 40 },
    { label: '31–50',         threshold: 13,  test: n => n >= 31 && n <= 50 },
    { label: '41–60',         threshold: 13,  test: n => n >= 41 && n <= 60 },
    { label: '31–40 e 51–60', threshold: 12,  test: n => (n >= 31 && n <= 40) || (n >= 51 && n <= 60) },
    { label: '1–30',          threshold: 100, test: n => n >= 1  && n <= 30 },
    { label: '31–60',         threshold: 67,  test: n => n >= 31 && n <= 60 },
];

function computeFaixasRepetidas() {
    return FAIXAS_REPETIDAS.map(f => {
        let consecutive = 0;
        for (let i = S.contests.length - 1; i >= 0; i--) {
            if (S.contests[i].numbers.some(n => f.test(n))) {
                consecutive++;
            } else {
                break;
            }
        }
        const rangeNums = [];
        for (let n = 1; n <= 60; n++) if (f.test(n)) rangeNums.push(n);

        return {
            label: f.label,
            threshold: f.threshold,
            consecutive,
            alerta: consecutive >= f.threshold,
            rangeNums
        };
    });
}

// ── RENDERIZAÇÃO DA ANÁLISE ────────────────────────────────
function renderODSAnalysis() {
    if (!S.contests.length) return;
    const last = S.contests[S.contests.length - 1];

    document.getElementById('section-analysis').classList.remove('hidden');
    const secCheck = document.getElementById('section-checagem');
    if (secCheck) secCheck.classList.remove('hidden');
    document.getElementById('ods-info').textContent =
        `${S.contests.length} concursos · Último: #${last.concurso} (${last.data}) · Dezenas: ${last.numbers.join(', ')}`;

    renderPreGroups(computePreGroups());
    renderDelayed(computeAllDelays());
    renderRanges(computeRanges());
    renderFaixasRepetidas(computeFaixasRepetidas());
    renderRepeats3(computeRepeatSeq(3), computeRepeatSeq(4), last);
    renderRepeats10(computeRepeat10());
    renderHistorico(computeHistorico());
}

function renderPreGroups(groups) {
    document.getElementById('pregroups-container').innerHTML = groups.map(g => `
        <div class="pregroup-card">
            <div class="pregroup-header">
                <span class="pregroup-label">Últimos <strong>${g.n}</strong> concursos</span>
                <span class="pregroup-meta">${g.count} números · ${fmtOdds(g.odds)}</span>
            </div>
            <button class="btn-blue btn-sm"
                onclick="usePreGroup(${g.n}, [${g.numbers.join(',')}]); highlightSection('section-group');">
                Usar este grupo
            </button>
        </div>`).join('');
}

function renderDelayed(allDelays) {
    const el = document.getElementById('delayed-container');
    const delayed20 = allDelays.filter(d => d.delay >= 20);

    if (!delayed20.length) {
        el.innerHTML = '<p class="muted">Nenhum número com atraso ≥ 20 concursos.</p>';
    } else {
        el.innerHTML = delayed20.map(d => `
            <div class="delayed-item">
                <span class="num-circle sm selected">${String(d.number).padStart(2, '0')}</span>
                <span class="delayed-info">Atraso: <strong>${d.delay}</strong> concursos</span>
                <button class="btn-sm btn-outline" data-add-num="${d.number}"
                    onclick="includeFromDelay(${d.number}, ${d.delay})">+ Incluir</button>
            </div>`).join('');
    }

    // Ranking completo dos 60 números
    const rankEl = document.getElementById('delayed-ranking');
    rankEl.innerHTML = `
        <div class="delay-ranking-title">Ranking de atraso — todos os números:</div>
        <div class="delay-ranking-grid">
            ${allDelays.map(d => `
                <span class="delay-rank-item${d.delay >= 20 ? ' delay-high' : ''}">
                    <span class="delay-rank-num">${String(d.number).padStart(2, '0')}</span>
                    <span class="delay-rank-val">${d.delay}c</span>
                </span>`).join('')}
        </div>`;
}

function renderRanges(ranges) {
    const el = document.getElementById('ranges-container');
    const detected = ranges.filter(r => r.detected);
    if (!detected.length) {
        el.innerHTML = '<p class="muted">Nenhuma faixa detectada nos últimos 5 concursos.</p>';
        return;
    }
    el.innerHTML = ranges.map(r => {
        if (!r.detected) return '';
        const allNums = Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i);
        return `<div class="range-item">
            <div class="range-header">
                <span class="range-badge">${r.label}</span>
                <span class="muted">${r.numbers.length} dezena(s): <strong>${r.numbers.join(', ')}</strong></span>
            </div>
            <button class="btn-sm btn-danger" data-excl-range="${r.start}-${r.end}"
                onclick="removeRangeFromGroup('${r.label}', [${allNums.join(',')}])">
                Excluir faixa ${r.label}
            </button>
        </div>`;
    }).join('');
}

function renderFaixasRepetidas(faixas) {
    const el = document.getElementById('faixas-repetidas-container');
    el.innerHTML = faixas.map(f => {
        const alertClass = f.alerta ? ' faixa-alerta' : '';
        const icon = f.alerta ? '⚠️ ' : '';
        return `<div class="faixa-rep-item${alertClass}">
            <div class="faixa-rep-info">
                <span class="range-badge${f.alerta ? ' range-badge-alert' : ''}">${f.label}</span>
                <span class="faixa-rep-text">
                    ${icon}<strong>${f.consecutive}</strong> concursos consecutivos presentes
                    <span class="muted">(limiar: ${f.threshold})</span>
                </span>
            </div>
            ${f.alerta ? `
            <button class="btn-sm btn-danger faixa-rep-btn"
                data-excl-range="${f.rangeNums[0]}-${f.rangeNums[f.rangeNums.length - 1]}"
                onclick="removeFaixaFromGroup('${f.label}', [${f.rangeNums.join(',')}])">
                Excluir faixa do grupo
            </button>` : ''}
        </div>`;
    }).join('');
}

function renderRepeatSubsection({ detected, numbers }, n) {
    let html = `<div class="rep-sub-title">Últimos ${n} concursos</div>`;
    if (detected) {
        html += `<p class="rep-seq-ok">✅ Houve repetições sequenciais nos ${n} últimos concursos.</p>`;
        if (numbers.length) {
            html += `<div class="repeats-list" style="margin-top:6px">` +
                numbers.map(r => `
                    <div class="repeat-item">
                        <span class="num-circle sm selected">${String(r.number).padStart(2, '0')}</span>
                        <span class="muted" style="font-size:11px">${r.count}×</span>
                        <button class="btn-sm btn-danger" data-excl-num="${r.number}"
                            onclick="removeRepeatNumFromGroup(${r.number}, 'repetição sequencial nos últimos ${n} concursos')">Excluir</button>
                    </div>`).join('') +
                `</div>`;
        }
    } else {
        html += `<p class="muted">Sem repetições sequenciais nos ${n} últimos concursos.</p>`;
    }
    return html;
}

function renderRepeats3(data3, data4, lastContest) {
    const el = document.getElementById('rep3-container');
    const lastNums = lastContest.numbers;

    el.innerHTML =
        renderRepeatSubsection(data3, 3) +
        `<hr class="rep-sub-divider">` +
        renderRepeatSubsection(data4, 4) +
        `<div style="margin-top:10px">
            <button class="btn-sm btn-danger" id="btn-excl-last-contest"
                onclick="removeLastContestFromGroup([${lastNums.join(',')}])">
                Excluir os 6 do último concurso (${lastNums.join(', ')})
            </button>
        </div>`;
}

function renderRepeats10(rep10) {
    const el = document.getElementById('rep10-container');
    if (!rep10.length) {
        el.innerHTML = '<p class="muted">Sem repetições nos últimos 10 concursos.</p>';
        return;
    }
    el.innerHTML = '<div class="repeats-list">' + rep10.map(r => `
        <div class="repeat-item">
            <span class="num-circle sm selected">${String(r.number).padStart(2, '00')}</span>
            <span class="muted" style="font-size:11px">${r.count}×</span>
            <button class="btn-sm btn-danger" data-excl-num="${r.number}"
                onclick="removeRepeatNumFromGroup(${r.number}, 'repetições nos últimos 10 concursos')">Excluir</button>
        </div>`).join('') + '</div>';
}

function renderHistorico(data) {
    document.getElementById('section-historico').classList.remove('hidden');
    const tbody = document.getElementById('historico-body');
    tbody.innerHTML = data.map((r, i) => {
        const numsStr = r.numbers.map(n => String(n).padStart(2, '0')).join(' ');
        const rowClass = i % 2 === 1 ? ' style="background:#fafbfc"' : '';
        return `<tr${rowClass}>
            <td><strong>${r.concurso}</strong></td>
            <td style="white-space:nowrap;font-size:12px">${r.data}</td>
            <td style="font-size:11px;font-family:monospace;letter-spacing:.5px">${numsStr}</td>
            <td style="text-align:center;font-weight:700;color:var(--green-dark)">${r.sena ?? '—'}</td>
            <td style="text-align:center;font-weight:600;color:var(--blue)">${r.quina ?? '—'}</td>
            <td style="text-align:center;font-weight:600;color:#8e44ad">${r.quadra ?? '—'}</td>
        </tr>`;
    }).join('');
}

// ── GRUPO ─────────────────────────────────────────────────
function addToGroup(nums) {
    (Array.isArray(nums) ? nums : [nums]).forEach(n => S.group.add(n));
    updateGroupUI();
}
function removeFromGroup(nums) {
    (Array.isArray(nums) ? nums : [nums]).forEach(n => S.group.delete(n));
    updateGroupUI();
}
function setGroup(nums) {
    S.group = new Set(nums);
    updateGroupUI();
}
function clearGroup() {
    S.group.clear();
    S_FILTER.preGroup = null;
    S_FILTER.originalGroupNums = null;
    S_FILTER.manualInclusions = [];
    S_FILTER.exclusions = [];
    S_FILTER.predefinedBets = [];
    updateGroupUI();
}
function selectAllNumbers() {
    for (let n = 1; n <= 60; n++) S.group.add(n);
    updateGroupUI();
}

// ── AÇÕES DE GRUPO RASTREADAS PARA PDF ─────────────────────
function usePreGroup(n, nums) {
    // Ao usar um grupo pré-definido, reseta log de filtros
    S_FILTER.preGroup = { n };
    S_FILTER.originalGroupNums = new Set(nums);  // snapshot para detectar inclusões externas
    S_FILTER.manualInclusions = [];
    S_FILTER.exclusions = [];
    S_FILTER.predefinedBets = [];
    setGroup(nums);
}

function includeFromDelay(num, delay) {
    // Inclusão rastreada a partir da lista de atrasos
    if (!S_FILTER.manualInclusions.find(m => m.num === num)) {
        S_FILTER.manualInclusions.push({ num, delay });
    }
    addToGroup(num);
}

function removeRangeFromGroup(label, nums) {
    if (!S_FILTER.exclusions.find(e => e.type === 'range' && e.label === label)) {
        S_FILTER.exclusions.push({ type: 'range', label });
    }
    removeFromGroup(nums);
}

function removeLastContestFromGroup(nums) {
    if (!S_FILTER.exclusions.find(e => e.type === 'lastContest')) {
        S_FILTER.exclusions.push({ type: 'lastContest', nums: [...nums] });
    }
    removeFromGroup(nums);
}

function removeRepeatNumFromGroup(num, reason) {
    if (!S_FILTER.exclusions.find(e => e.type === 'num' && e.num === num)) {
        S_FILTER.exclusions.push({ type: 'num', num, reason });
    }
    removeFromGroup(num);
}

function removeFaixaFromGroup(label, nums) {
    if (!S_FILTER.exclusions.find(e => e.type === 'faixa' && e.label === label)) {
        S_FILTER.exclusions.push({ type: 'faixa', label });
    }
    removeFromGroup(nums);
}

// ── RESUMO DE FILTROS (para PDF) ───────────────────────────
function buildFilterSummary() {
    const lines = [];

    // Origem do grupo
    if (S_FILTER.preGroup) {
        lines.push(`Grupo utilizado: Últimos ${S_FILTER.preGroup.n} concursos`);
    } else {
        lines.push(`Grupo: aleatório / seleção manual`);
    }

    // Inclusões manuais (via lista de atrasos)
    for (const m of S_FILTER.manualInclusions) {
        if (S.group.has(m.num)) {
            const d = m.delay != null ? ` (atraso: ${m.delay} concursos)` : '';
            lines.push(`Inclusão: ${String(m.num).padStart(2,'0')}${d}`);
        }
    }

    // Exclusões
    for (const e of S_FILTER.exclusions) {
        if (e.type === 'range')       lines.push(`Exclusão de faixa: ${e.label}`);
        else if (e.type === 'lastContest') lines.push(`Exclusão dos 6 do último concurso (${e.nums.map(n=>String(n).padStart(2,'0')).join(', ')})`);
        else if (e.type === 'num')    lines.push(`Exclusão: ${String(e.num).padStart(2,'0')} (${e.reason})`);
        else if (e.type === 'faixa')  lines.push(`Exclusão de faixa repetida: ${e.label}`);
    }

    // Apostas pré-definidas incluídas
    for (const pb of S_FILTER.predefinedBets) {
        const numsStr = pb.nums.map(n => String(n).padStart(2,'0')).join(', ');
        const lbl = pb.label ? ` — ${pb.label}` : '';
        lines.push(`Aposta pré-definida incluída: ${numsStr}${lbl}`);
    }

    return lines;
}

function updateGroupUI() {
    const arr = Array.from(S.group).sort((a, b) => a - b);
    const count = arr.length;
    const c6 = count >= 6 ? comb(count, 6) : null;

    document.getElementById('group-count').textContent = count;
    document.getElementById('group-odds').textContent = c6 ? fmtOdds(c6) : '—';

    // Refresh inline grid
    refreshGroupGridDisplay();

    // Generate button + bet count limits
    updateBetCountLimits();
    document.getElementById('btn-generate').disabled = count < S.settings.betSize;

    // Refresh analysis buttons
    refreshAnalysisButtons();
    renderBets(); // refresh cost + button states
}

function refreshGroupGridDisplay() {
    document.querySelectorAll('.group-circle').forEach(el => {
        el.classList.toggle('selected', S.group.has(parseInt(el.dataset.num)));
    });
}

function refreshAnalysisButtons() {
    document.querySelectorAll('[data-excl-num]').forEach(btn => {
        btn.disabled = !S.group.has(parseInt(btn.dataset.exclNum));
    });
    document.querySelectorAll('[data-excl-range]').forEach(btn => {
        const [s, e] = btn.dataset.exclRange.split('-').map(Number);
        let any = false;
        for (let n = s; n <= e; n++) if (S.group.has(n)) { any = true; break; }
        btn.disabled = !any;
    });
    document.querySelectorAll('[data-add-num]').forEach(btn => {
        const n = parseInt(btn.dataset.addNum);
        if (S.group.has(n)) {
            btn.textContent = '✓ No grupo';
            btn.classList.add('btn-sm-done');
            btn.disabled = true;
        } else {
            btn.textContent = '+ Incluir';
            btn.classList.remove('btn-sm-done');
            btn.disabled = false;
        }
    });
    const btnLast = document.getElementById('btn-excl-last-contest');
    if (btnLast && S.contests.length) {
        const last = S.contests[S.contests.length - 1].numbers;
        btnLast.disabled = !last.some(n => S.group.has(n));
    }
}

// ── CONTAGEM DE APOSTAS COM CAP DE COMBINAÇÕES ─────────────
function getMaxBets() {
    const gs = S.group.size;
    const bs = S.settings.betSize;
    if (gs < bs) return 0;
    const combos = comb(gs, bs);
    return Math.min(100, combos);
}

function updateBetCountLimits() {
    const max = Math.max(1, getMaxBets());
    const slider = document.getElementById('bet-count');
    const input = document.getElementById('bet-count-input');
    const info = document.getElementById('bet-count-max-info');

    slider.max = max;
    input.max = max;

    const current = parseInt(slider.value) || 1;
    if (current > max) {
        slider.value = max;
        input.value = max;
        S.settings.betCount = max;
    }

    const gs = S.group.size, bs = S.settings.betSize;
    if (gs >= bs) {
        const combos = comb(gs, bs);
        if (combos <= 100) {
            info.textContent = `Máx: ${combos.toLocaleString('pt-BR')} combinações disponíveis`;
        } else {
            info.textContent = '';
        }
    } else {
        info.textContent = '';
    }
}

// ── GERAÇÃO DE APOSTAS ─────────────────────────────────────
function generateBets() {
    const { betSize, betCount, withRepetition } = S.settings;
    const arr = Array.from(S.group).sort((a, b) => a - b);
    if (arr.length < betSize) {
        alert(`O grupo precisa ter pelo menos ${betSize} números!`);
        return;
    }
    const raw = withRepetition
        ? genWithRepetition(arr, betSize, betCount)
        : genWithoutRepetition(arr, betSize, betCount);
    S.bets = dedup(raw);
    renderBets();
    highlightSection('section-bets');
}

function genWithRepetition(arr, size, count) {
    const bets = [];
    for (let i = 0; i < count * 100 && bets.length < count; i++)
        bets.push(shuffle([...arr]).slice(0, size).sort((a, b) => a - b));
    return bets;
}

function genWithoutRepetition(arr, size, count) {
    const bets = [];
    let pool = shuffle([...arr]);
    for (let i = 0; i < count * 200 && bets.length < count; i++) {
        if (pool.length < size) pool = shuffle([...arr]);
        bets.push(pool.splice(0, size).sort((a, b) => a - b));
    }
    return bets;
}

function dedup(bets) {
    const seen = new Set();
    return bets.filter(b => { const k = b.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
}

function addRandomBet() {
    const { betSize } = S.settings;
    const arr = Array.from(S.group);
    if (arr.length < betSize) return;
    for (let i = 0; i < 500; i++) {
        const candidate = shuffle([...arr]).slice(0, betSize).sort((a, b) => a - b);
        if (!S.bets.some(b => b.join(',') === candidate.join(','))) {
            S.bets.push(candidate);
            renderBets();
            return;
        }
    }
    alert('Não foi possível gerar aposta única adicional.');
}

function removeBet(idx) {
    S.bets.splice(idx, 1);
    renderBets();
}

function clearBets() {
    if (!S.bets.length) return;
    if (!confirm('Limpar todas as apostas?')) return;
    S.bets = [];
    renderBets();
}

// ── RENDERIZAR APOSTAS ─────────────────────────────────────
function renderBets() {
    const list = document.getElementById('bets-list');
    const predefinedKeys = new Set(S_FILTER.predefinedBets.map(pb => pb.k));

    if (!S.bets.length) {
        list.innerHTML = '<p class="muted">Nenhuma aposta gerada ainda.</p>';
    } else {
        list.innerHTML = S.bets.map((bet, idx) => {
            const isPredef = predefinedKeys.has(bet.join(','));
            const circles = bet.map(n =>
                `<span class="num-circle selected${isPredef ? ' predef-bet' : ''}" style="width:30px;height:30px;font-size:11px">${String(n).padStart(2, '0')}</span>`
            ).join('');
            return `<div class="bet-row${isPredef ? ' predef-row' : ''}">
                <span class="bet-num">${idx + 1}.</span>
                <div class="bet-circles">${circles}</div>
                <button class="btn-icon" title="Excluir" onclick="removeBet(${idx})">✕</button>
            </div>`;
        }).join('');
    }

    const val = parseFloat(String(S.settings.betValue).replace(',', '.'));
    const costEl = document.getElementById('bet-cost');
    if (S.bets.length) {
        const groupCount = S.group.size;
        const c6 = groupCount >= 6 ? comb(groupCount, 6) : null;
        // Uma aposta com k números contém C(k,6) combinações de 6
        const perBet = comb(S.settings.betSize, 6) || 1;
        const n = S.bets.length;
        let probHTML = '';
        if (c6) {
            probHTML = `<br><span style="font-size:12px;font-weight:400;color:var(--green-dark)">
                1 aposta: 1 em ${Math.max(1, Math.round(c6 / perBet)).toLocaleString('pt-BR')} &nbsp;·&nbsp;
                ${n} aposta(s): 1 em ${Math.max(1, Math.round(c6 / (n * perBet))).toLocaleString('pt-BR')}
            </span>`;
        }
        let txt = '';
        if (!isNaN(val) && val > 0) {
            txt = `Custo total: R$ ${(n * val).toFixed(2).replace('.', ',')}`;
        }
        costEl.innerHTML = (txt || `${n} aposta(s)`) + probHTML;
        costEl.classList.remove('hidden');
    } else {
        costEl.classList.add('hidden');
    }

    const hasBets = S.bets.length > 0;
    document.getElementById('btn-add-one').disabled = !hasBets || S.group.size < S.settings.betSize || S.bets.length >= 100;
    document.getElementById('btn-clear-bets').disabled = !hasBets;
    document.getElementById('btn-print').disabled = !hasBets;
}

// ── APOSTAS PRÉ-DEFINIDAS ──────────────────────────────────
const PREDEFINED = [
    { nums: [5,  10, 17, 42, 48, 53], label: '' },
    { nums: [3,  8,  14, 21, 29, 48], label: '' },
    { nums: [4,  17, 18, 21, 38, 53], label: 'Perf.: 7 quadras' },
    { nums: [2,  10, 13, 41, 42, 53], label: 'Perf.: 8 quadras' },
    { nums: [10, 13, 27, 41, 42, 52], label: 'Perf.: 8 quadras' },
    { nums: [10, 13, 41, 42, 49, 53], label: 'Perf.: 8 quadras' },
    { nums: [5,  10, 13, 41, 42, 53], label: 'Perf.: 6 quadras' },
    { nums: [11, 14, 36, 53, 55, 60], label: 'Perf.: 3 quinas' }
];

function renderPredefined() {
    document.getElementById('predefined-container').innerHTML = PREDEFINED.map((p, i) => {
        const circles = p.nums.map(n =>
            `<span class="num-circle xs selected">${String(n).padStart(2, '0')}</span>`).join('');
        return `<div class="prebet-card">
            <div class="prebet-nums">${circles}</div>
            ${p.label ? `<span class="prebet-label">${p.label}</span>` : ''}
            <button class="btn-sm btn-outline" onclick="addPredefined(${i})">+ Incluir</button>
        </div>`;
    }).join('');
}

function addPredefined(i) {
    const p = PREDEFINED[i];
    const nums = p.nums;
    const k = nums.join(',');
    if (S.bets.some(b => b.join(',') === k)) { alert('Esta aposta já está na lista.'); return; }
    if (S.bets.length >= 100) { alert('Limite de 100 apostas atingido.'); return; }
    S.bets.push([...nums]);
    // Rastreia para exibição no PDF
    if (!S_FILTER.predefinedBets.find(pb => pb.k === k)) {
        S_FILTER.predefinedBets.push({ nums: [...nums], label: p.label, k });
    }
    renderBets();
    highlightSection('section-bets');
}

// ── PDF / IMPRESSÃO ────────────────────────────────────────
function printPDF() {
    if (!S.bets.length) return;
    const groupArr = Array.from(S.group).sort((a, b) => a - b);
    const G = groupArr.length;

    // Nome do arquivo para salvar o PDF
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const ph = String(now.getHours()).padStart(2, '0');
    const pmi = String(now.getMinutes()).padStart(2, '0');
    const ps = String(now.getSeconds()).padStart(2, '0');
    const dateStr = `${dd}-${mm}-${yyyy}`;
    const timeStr = `${ph}${pmi}${ps}`;
    const grupoStr = S_FILTER.preGroup
        ? `Ult${S_FILTER.preGroup.n}`
        : 'Grupo aleatório';
    const pdfTitle = `Gerador Mega ${dateStr} - ${timeStr} - ${grupoStr}`;

    const val = parseFloat(String(S.settings.betValue).replace(',', '.'));
    const hasVal = !isNaN(val) && val > 0;
    const n = S.bets.length;
    const N_MEGA = 60, D_MEGA = 6;

    const predefinedKeys = new Set(S_FILTER.predefinedBets.map(pb => pb.k));
    const betsHTML = S.bets.map((bet, idx) => {
        const isPredef = predefinedKeys.has(bet.join(','));
        const circles = bet.map(num =>
            `<span class="pc${isPredef ? ' predef' : ''}">${String(num).padStart(2, '0')}</span>`).join('');
        const predefTag = isPredef
            ? `<span class="predef-tag">pré-definida</span>`
            : '';
        return `<div class="pr"><span class="pi">${idx + 1}.</span><div>${circles}</div>${predefTag}</div>`;
    }).join('');

    const groupCircles = groupArr.map(num =>
        `<span class="pc sm">${String(num).padStart(2, '0')}</span>`).join('');

    // Probabilidades considerando apostas de tamanhos mistos
    let pNotWinUniv = 1, pNotWinGrp = 1;
    const sizeMap = {};
    S.bets.forEach(bet => {
        const B = bet.length;
        sizeMap[B] = (sizeMap[B] || 0) + 1;
        if (comb(B, D_MEGA) > 0) {
            pNotWinUniv *= (1 - comb(B, D_MEGA) / comb(N_MEGA, D_MEGA));
            if (G >= D_MEGA && comb(G, D_MEGA) > 0) {
                pNotWinGrp *= (1 - comb(B, D_MEGA) / comb(G, D_MEGA));
            }
        }
    });
    const fmtO = p => p > 0 ? `1 em ${Math.round(1/p).toLocaleString('pt-BR')}` : '—';
    const pWinUniv = fmtO(1 - pNotWinUniv);
    const pWinGrp  = G >= D_MEGA ? fmtO(1 - pNotWinGrp) : null;

    // Linha de prob por tamanho único (só mostra se há apostas de tamanhos diferentes)
    const uniqueSizes = Object.keys(sizeMap).map(Number);
    let sizeLinesHTML = '';
    if (uniqueSizes.length > 1) {
        sizeLinesHTML = uniqueSizes.map(B => {
            const p1u = comb(B,D_MEGA) > 0 ? fmtO(comb(B,D_MEGA)/comb(N_MEGA,D_MEGA)) : '—';
            const p1g = (G >= D_MEGA && comb(B,D_MEGA) > 0 && comb(G,D_MEGA) > 0)
                ? fmtO(comb(B,D_MEGA)/comb(G,D_MEGA)) : null;
            return `<div class="prob-line">↳ ${sizeMap[B]}× aposta de ${B} núm.: univ. ${p1u}${p1g ? ` · grupo ${p1g}` : ''}</div>`;
        }).join('');
    }

    const probBlock = `
  <strong>Prob. total (${n} aposta(s)) — universo 60 núm.:</strong> <strong>${pWinUniv}</strong><br>
  ${pWinGrp ? `<strong>Prob. total — no grupo (${G} núm.):</strong> <strong>${pWinGrp}</strong><br>` : ''}
  ${sizeLinesHTML}`;

    // Filtros
    const filterLines = buildFilterSummary()
        .map(line => `  <div class="filter-line">• ${line}</div>`).join('\
');

    // Captura lote para Array Final (antes de abrir a janela)
    arrayFinalAddBatch(S.bets);

    const pw = window.open('', '_blank', 'width=820,height=720');
    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Apostas Mega-Sena</title>
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;padding:24px;max-width:740px;margin:0 auto}
  h1{color:#1c8059;font-size:22px;border-bottom:2px solid #1c8059;padding-bottom:8px;margin-bottom:16px}
  h2{color:#1c8059;font-size:15px;margin:18px 0 8px}
  .meta{background:#e6f5ef;border-radius:8px;padding:10px 14px;margin:10px 0;font-size:13px;line-height:1.9}
  .pc{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
      border-radius:50%;background:#1c8059;color:#fff;font-weight:bold;font-size:12px;margin:2px}
  .pc.sm{width:26px;height:26px;font-size:10px}
  .pc.predef{background:#BED084;color:#2d3a0a}
  .pr{display:flex;align-items:center;gap:8px;margin:5px 0;border-bottom:1px solid #eee;padding-bottom:5px}
  .predef-tag{font-size:10px;color:#5a6e1a;background:#eef5cc;border:1px solid #c5d97a;border-radius:8px;padding:1px 7px;white-space:nowrap;margin-left:4px}
  .pi{font-weight:bold;font-size:13px;color:#666;min-width:24px}
  .total{font-size:15px;font-weight:bold;color:#1c8059;margin-top:14px;padding:8px 12px;
         background:#e6f5ef;border-radius:6px;display:inline-block}
  .prob-line{font-size:11px;color:#555;margin:2px 0 2px 8px}
  .filters-block{background:#f0f7ff;border-left:4px solid #1565c0;border-radius:6px;
                 padding:10px 14px;margin:10px 0;font-size:13px}
  .filter-line{margin:4px 0;line-height:1.6;color:#1a1a1a}
  @media print{body{padding:12px}}
</style></head><body>
<h1>🍀 Apostas Mega-Sena</h1>
<div class="meta">
  <strong>Grupo definido:</strong> ${G} números<br>
  ${groupCircles}<br>
  ${probBlock}
</div>
<h2>Apostas — ${n} jogo(s)</h2>
${betsHTML}
${hasVal ? `<div class="total">Valor total: R$ ${(n * val).toFixed(2).replace('.', ',')}</div>` : ''}
<h2>📋 Filtros e configurações utilizados</h2>
<div class="filters-block">
${filterLines}
</div>
<script>window.onload=()=>{ document.title='${pdfTitle}'; window.print(); };<\/script>
</body></html>`);
    pw.document.close();
}

// ── CALCULADORA ────────────────────────────────────────────
function calcOdds() {
    const total = parseFloat(document.getElementById('calc-total').value);
    const ind   = parseFloat(document.getElementById('calc-individual').value);
    const el    = document.getElementById('calc-result');
    if (isNaN(total) || isNaN(ind) || ind <= 0) {
        el.innerHTML = '<span class="muted">Preencha os dois valores.</span>'; return;
    }
    const n = Math.floor(total / ind);
    const base = comb(60, 6);
    el.innerHTML = `<strong>${n}</strong> aposta(s) de 6 números (universo de 60)<br>
        <strong>≈ 1 chance em ${Math.round(base / n).toLocaleString('pt-BR')}</strong>`;
}

// ── GRUPO GRID INLINE (SIDEBAR) ────────────────────────────
function buildGroupGrid() {
    const grid = document.getElementById('group-grid');
    grid.innerHTML = '';
    for (let n = 1; n <= 60; n++) {
        const span = document.createElement('span');
        span.className = 'group-circle';           // no num-circle — fixed 36px would override grid sizing
        span.textContent = String(n).padStart(2, '0');
        span.dataset.num = n;
        span.addEventListener('click', () => {
            if (S.group.has(n)) {
                removeFromGroup(n);
            } else {
                // Rastreia inclusões manuais via sidebar quando um grupo pré-definido está ativo
                // e o número não fazia parte do grupo original
                if (S_FILTER.preGroup &&
                    S_FILTER.originalGroupNums &&
                    !S_FILTER.originalGroupNums.has(n) &&
                    !S_FILTER.manualInclusions.find(m => m.num === n)) {
                    S_FILTER.manualInclusions.push({ num: n, delay: null });
                }
                addToGroup(n);
            }
        });
        grid.appendChild(span);
    }
}

// ── AUXILIARES ────────────────────────────────────────────
function highlightSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
}

// ── ODS ───────────────────────────────────────────────────
async function loadODS(event) {
    const file = event.target.files[0];
    if (!file) return;
    const st = document.getElementById('ods-status');
    st.textContent = 'Lendo arquivo...';
    try {
        S.contests = await ODSParser.parse(file);
        renderODSAnalysis();
        st.textContent = `✓ ${S.contests.length} concursos carregados.`;
        refreshAnalysisButtons();
    } catch (err) {
        st.textContent = '⚠ Erro: ' + err.message;
        console.error(err);
    }
}

// ── CONFIGURAÇÕES ─────────────────────────────────────────
function updateSettings() {
    S.settings.betSize = parseInt(document.getElementById('bet-size').value) || 6;
    S.settings.withRepetition = document.getElementById('bet-repetition').value === 'yes';
    S.settings.betValue = document.getElementById('bet-value').value;
    updateBetCountLimits();
    updateGroupUI();
}

// ════════════════════════════════════════════════════════════
//  OUTROS JOGOS
// ════════════════════════════════════════════════════════════

const OJ_CONFIG = {
    quina:     { max: 80, betMin: 5,  betMax: 15, name: 'Quina',     color: '#388e3c' },
    duplasena: { max: 50, betMin: 6,  betMax: 15, name: 'Dupla-Sena',color: '#1565c0' },
    lotofacil: { max: 25, betMin: 15, betMax: 20, name: 'Lotofácil', color: '#6a1b9a' },
    milionaria:{ max: 50, betMin: 6,  betMax: 12, name: 'Milionária',color: '#c62828',
                 trefoMin: 2, trefoMax: 6 }
};

// Quantidade de números sorteados por jogo (para cálculo de probabilidade do 1º prêmio)
const OJ_DRAWS = { quina: 5, duplasena: 6, lotofacil: 15, milionaria: 6 };

// Calcula e exibe probabilidades em tempo real no painel de cada jogo
function ojComputeOdds(game) {
    const config = OJ_CONFIG[game];
    const G  = OJ[game].pool.size;
    const bs = document.getElementById(`${game}-betsize`);
    const B  = bs ? parseInt(bs.value) || config.betMin : config.betMin;
    const D  = OJ_DRAWS[game];
    const N  = config.max;
    const el = document.getElementById(`${game}-odds-info`);
    if (!el) return;

    const fmtO = p => p > 0 ? `1 em ${Math.round(1/p).toLocaleString('pt-BR')}` : '—';

    if (G < B || G === 0) { el.innerHTML = ''; return; }

    const rows = [];

    // Probabilidade no universo total
    if (comb(B, D) > 0) {
        const pUniv = comb(B, D) / comb(N, D);
        rows.push(`<span class="oj-odds-row">🌐 1 aposta de <strong>${B}</strong> núm. — universo total: <strong>${fmtO(pUniv)}</strong></span>`);
    }

    // Probabilidade condicional ao grupo selecionado
    if (G >= D && comb(B, D) > 0 && comb(G, D) > 0) {
        const pGrp = comb(B, D) / comb(G, D);
        rows.push(`<span class="oj-odds-row">🎯 1 aposta de <strong>${B}</strong> núm. — no grupo (<strong>${G}</strong> núm.): <strong>${fmtO(pGrp)}</strong></span>`);
    }

    // Milionária: combina números + trevos
    if (game === 'milionaria') {
        const GT  = OJ.milionaria.trevos.size;
        const tse = document.getElementById('milionaria-trevosize');
        const BT  = tse ? parseInt(tse.value) || config.trefoMin : config.trefoMin;
        const NT  = 6, DT = 2;
        if (GT >= BT && comb(BT, DT) > 0) {
            const pTUniv = comb(BT, DT) / comb(NT, DT);
            if (comb(B, D) > 0) {
                const combUniv = (comb(B, D) / comb(N, D)) * pTUniv;
                rows.push(`<span class="oj-odds-row">🌐 Combinada (núm.+trevo) — universo: <strong>${fmtO(combUniv)}</strong></span>`);
            }
            if (G >= D && comb(B, D) > 0 && comb(G, D) > 0 && GT >= DT && comb(GT, DT) > 0) {
                const pTGrp = comb(BT, DT) / comb(GT, DT);
                const combGrp = (comb(B, D) / comb(G, D)) * pTGrp;
                rows.push(`<span class="oj-odds-row">🎯 Combinada — no grupo: <strong>${fmtO(combGrp)}</strong></span>`);
            }
        }
    }

    el.innerHTML = rows.length
        ? `<div class="oj-odds-block">${rows.join('')}</div>`
        : '';
}

const OJ = {
    quina:     { pool: new Set(), bets: [] },
    duplasena: { pool: new Set(), bets: [] },
    lotofacil: { pool: new Set(), bets: [] },
    milionaria:{ pool: new Set(), trevos: new Set(), bets: [] }
};

function buildOJGrid(game) {
    const config = OJ_CONFIG[game];
    const gridEl = document.getElementById(`${game}-grid`);
    gridEl.innerHTML = '';
    for (let n = 1; n <= config.max; n++) {
        const span = document.createElement('span');
        span.className = 'oj-num';                 // no num-circle — fixed 36px would override grid sizing
        span.textContent = String(n).padStart(2, '0');
        span.dataset.num = n;
        span.dataset.game = game;
        span.addEventListener('click', () => {
            if (OJ[game].pool.has(n)) OJ[game].pool.delete(n);
            else OJ[game].pool.add(n);
            ojRefreshGrid(game);
        });
        gridEl.appendChild(span);
    }
}

function buildMilionariaTrevoGrid() {
    const gridEl = document.getElementById('milionaria-trevo-grid');
    gridEl.innerHTML = '';
    for (let n = 1; n <= 6; n++) {
        const span = document.createElement('span');
        span.className = 'trevo-circle';
        span.textContent = n;
        span.dataset.trevo = n;
        span.addEventListener('click', () => {
            if (OJ.milionaria.trevos.has(n)) OJ.milionaria.trevos.delete(n);
            else OJ.milionaria.trevos.add(n);
            ojRefreshTrevoGrid();
        });
        gridEl.appendChild(span);
    }
}

function ojRefreshGrid(game) {
    document.querySelectorAll(`#${game}-grid .oj-num`).forEach(el => {
        el.classList.toggle('selected', OJ[game].pool.has(parseInt(el.dataset.num)));
    });
    const countEl = document.getElementById(`${game}-count`);
    if (countEl) countEl.textContent = OJ[game].pool.size;
    ojComputeOdds(game);  // atualiza probabilidades em tempo real
}

function ojRefreshTrevoGrid() {
    document.querySelectorAll('#milionaria-trevo-grid .trevo-circle').forEach(el => {
        el.classList.toggle('selected', OJ.milionaria.trevos.has(parseInt(el.dataset.trevo)));
    });
    const countEl = document.getElementById('milionaria-trevo-count');
    if (countEl) countEl.textContent = OJ.milionaria.trevos.size;
    ojComputeOdds('milionaria');  // recalcula prob combinada ao mudar trevos
}

function ojSelectAll(game) {
    const config = OJ_CONFIG[game];
    for (let n = 1; n <= config.max; n++) OJ[game].pool.add(n);
    ojRefreshGrid(game);
}

function ojClearAll(game) {
    OJ[game].pool.clear();
    ojRefreshGrid(game);
}

function ojSelectAllTrevos() {
    for (let n = 1; n <= 6; n++) OJ.milionaria.trevos.add(n);
    ojRefreshTrevoGrid();
}

function ojClearTrevos() {
    OJ.milionaria.trevos.clear();
    ojRefreshTrevoGrid();
}

function ojGenerate(game) {
    const pool = Array.from(OJ[game].pool).sort((a, b) => a - b);
    const betSize = parseInt(document.getElementById(`${game}-betsize`).value);
    const withRep = document.getElementById(`${game}-repetition`).value === 'yes';
    const count = parseInt(document.getElementById(`${game}-count-range`).value) || 5;

    if (pool.length < betSize) {
        alert(`Selecione pelo menos ${betSize} números!`);
        return;
    }

    if (game === 'milionaria') {
        const trefoPool = Array.from(OJ.milionaria.trevos).sort((a, b) => a - b);
        const trefoSize = parseInt(document.getElementById('milionaria-trevosize').value);
        if (trefoPool.length < trefoSize) {
            alert(`Selecione pelo menos ${trefoSize} trevos!`);
            return;
        }

        const raw = withRep
            ? genWithRepetition(pool, betSize, count)
            : genWithoutRepetition(pool, betSize, count);
        const bets = dedup(raw);
        OJ[game].bets = bets.map(b => ({
            nums: b,
            trevos: shuffle([...trefoPool]).slice(0, trefoSize).sort((a, b) => a - b)
        }));
    } else {
        const raw = withRep
            ? genWithRepetition(pool, betSize, count)
            : genWithoutRepetition(pool, betSize, count);
        OJ[game].bets = dedup(raw);
    }

    ojRenderBets(game);
}

function ojRenderBets(game) {
    const listEl   = document.getElementById(`${game}-bets-list`);
    const costEl   = document.getElementById(`${game}-bet-cost`);
    const clearBtn = document.getElementById(`${game}-btn-clear`);
    const printBtn = document.getElementById(`${game}-btn-print`);
    const bets     = OJ[game].bets;

    if (!bets.length) {
        listEl.innerHTML = '<p class="muted">Nenhuma aposta gerada.</p>';
        costEl.classList.add('hidden');
        clearBtn.disabled = true;
        printBtn.disabled = true;
        return;
    }

    if (game === 'milionaria') {
        listEl.innerHTML = bets.map((bet, idx) => {
            const circles = bet.nums.map(n =>
                `<span class="num-circle selected" style="width:27px;height:27px;font-size:10px">${String(n).padStart(2, '0')}</span>`
            ).join('');
            const trevos = bet.trevos.map(n =>
                `<span class="trevo-circle selected" style="width:24px;height:24px;font-size:11px">${n}</span>`
            ).join('');
            return `<div class="bet-row">
                <span class="bet-num">${idx + 1}.</span>
                <div class="bet-circles">${circles}<span style="margin:0 3px;color:var(--muted);font-size:11px">+</span>${trevos}</div>
                <button class="btn-icon" onclick="ojRemoveBet('${game}',${idx})">✕</button>
            </div>`;
        }).join('');
    } else {
        listEl.innerHTML = bets.map((bet, idx) => {
            const circles = bet.map(n =>
                `<span class="num-circle selected" style="width:27px;height:27px;font-size:10px">${String(n).padStart(2, '0')}</span>`
            ).join('');
            return `<div class="bet-row">
                <span class="bet-num">${idx + 1}.</span>
                <div class="bet-circles">${circles}</div>
                <button class="btn-icon" onclick="ojRemoveBet('${game}',${idx})">✕</button>
            </div>`;
        }).join('');
    }

    const valInput = document.getElementById(`${game}-value`);
    const val = parseFloat(String(valInput.value).replace(',', '.'));
    if (!isNaN(val) && val > 0) {
        const total = (bets.length * val).toFixed(2).replace('.', ',');
        costEl.textContent = `${bets.length} aposta(s) · Total: R$ ${total}`;
        costEl.classList.remove('hidden');
    } else {
        costEl.classList.add('hidden');
    }

    clearBtn.disabled = false;
    printBtn.disabled = false;
}

function ojRemoveBet(game, idx) {
    OJ[game].bets.splice(idx, 1);
    ojRenderBets(game);
}

function ojClearBets(game) {
    if (!OJ[game].bets.length) return;
    if (!confirm('Limpar todas as apostas?')) return;
    OJ[game].bets = [];
    ojRenderBets(game);
}

function ojPrint(game) {
    const config = OJ_CONFIG[game];
    const bets   = OJ[game].bets;
    if (!bets.length) return;

    const color  = config.color;
    const D      = OJ_DRAWS[game];
    const N      = config.max;
    const G      = OJ[game].pool.size;
    const nBets  = bets.length;

    // Nome do arquivo para salvar o PDF
    const ojNameMap = { quina: 'Quina', duplasena: 'Dupla', lotofacil: 'Lotofácil', milionaria: 'Milionária' };
    const nowOJ = new Date();
    const ddOJ  = String(nowOJ.getDate()).padStart(2, '0');
    const mmOJ  = String(nowOJ.getMonth() + 1).padStart(2, '0');
    const yyyyOJ = nowOJ.getFullYear();
    const ojPdfTitle = `Gerador ${ojNameMap[game]} ${ddOJ}-${mmOJ}-${yyyyOJ}`;
    const fmtO   = p => p > 0 ? `1 em ${Math.round(1/p).toLocaleString('pt-BR')}` : '—';

    // ── Apostas HTML ──────────────────────────────────────────
    let betsHTML = '';
    if (game === 'milionaria') {
        betsHTML = bets.map((bet, idx) => {
            const circles = bet.nums.map(n => `<span class="pc">${String(n).padStart(2,'0')}</span>`).join('');
            const trevos  = bet.trevos.map(n => `<span class="pc trevo">${n}</span>`).join('');
            return `<div class="pr"><span class="pi">${idx+1}.</span><div>${circles} + ${trevos}</div></div>`;
        }).join('');
    } else {
        betsHTML = bets.map((bet, idx) => {
            const circles = bet.map(n => `<span class="pc">${String(n).padStart(2,'0')}</span>`).join('');
            return `<div class="pr"><span class="pi">${idx+1}.</span><div>${circles}</div></div>`;
        }).join('');
    }

    // ── Valor total ───────────────────────────────────────────
    const valInput = document.getElementById(`${game}-value`);
    const val = parseFloat(String(valInput.value).replace(',','.'));
    const hasVal = !isNaN(val) && val > 0;

    // ── Cálculo de probabilidades considerando tamanhos mistos ─
    const GT = game === 'milionaria' ? OJ.milionaria.trevos.size : 0;
    const NT = 6, DT = 2;
    let pNotWinUniv = 1, pNotWinGrp = 1;
    const sizeMap = {};

    if (game === 'milionaria') {
        bets.forEach(b => {
            const B = b.nums.length, BT = b.trevos.length;
            sizeMap[`${B}n+${BT}t`] = (sizeMap[`${B}n+${BT}t`] || 0) + 1;
            const pN = comb(B,D) > 0 ? comb(B,D)/comb(N,D) : 0;
            const pT = comb(BT,DT) > 0 ? comb(BT,DT)/comb(NT,DT) : 0;
            pNotWinUniv *= (1 - pN * pT);
            if (G >= D && GT >= DT && comb(G,D) > 0 && comb(GT,DT) > 0) {
                pNotWinGrp *= (1 - (comb(B,D)/comb(G,D)) * (comb(BT,DT)/comb(GT,DT)));
            }
        });
    } else {
        bets.forEach(b => {
            const B = b.length;
            sizeMap[B] = (sizeMap[B] || 0) + 1;
            if (comb(B,D) > 0) {
                pNotWinUniv *= (1 - comb(B,D)/comb(N,D));
                if (G >= D && comb(G,D) > 0) pNotWinGrp *= (1 - comb(B,D)/comb(G,D));
            }
        });
    }

    // Linhas por tamanho de aposta
    let sizeLines = '';
    if (game === 'milionaria') {
        Object.entries(sizeMap).forEach(([key, cnt]) => {
            const [bPart, tPart] = key.split('+');
            const B = parseInt(bPart), BT = parseInt(tPart);
            const p1N = comb(B,D)/comb(N,D), p1T = comb(BT,DT)/comb(NT,DT);
            const p1u = p1N * p1T;
            let g1 = '';
            if (G >= D && comb(G,D) > 0 && GT >= DT && comb(GT,DT) > 0) {
                g1 = ` · grupo: ${fmtO((comb(B,D)/comb(G,D))*(comb(BT,DT)/comb(GT,DT)))}`;
            }
            sizeLines += `<li>${cnt}× aposta de ${B} números + ${BT} trevos — universo: ${fmtO(p1u)}${g1}</li>`;
        });
    } else {
        Object.entries(sizeMap).forEach(([B, cnt]) => {
            B = Number(B);
            const p1u = comb(B,D) > 0 ? fmtO(comb(B,D)/comb(N,D)) : '—';
            const p1g = (G >= D && comb(B,D) > 0 && comb(G,D) > 0) ? ` · grupo (${G} núm.): ${fmtO(comb(B,D)/comb(G,D))}` : '';
            sizeLines += `<li>${cnt}× aposta de ${B} números — universo: ${p1u}${p1g}</li>`;
        });
    }

    const grpLine = (G >= D) ? `<strong>Prob. total — no grupo (${G} núm.)${game==='milionaria'?` + ${GT} trevos`:''}:</strong> <strong>${fmtO(1-pNotWinGrp)}</strong><br>` : '';

    // Pool circles
    const poolArr = Array.from(OJ[game].pool).sort((a, b) => a - b);
    const poolCircles = poolArr.map(n => `<span class="pc sm">${String(n).padStart(2,'0')}</span>`).join('');
    let trevoCircles = '';
    if (game === 'milionaria') {
        const trevoArr = Array.from(OJ.milionaria.trevos).sort((a, b) => a - b);
        trevoCircles = `<br><strong>Trevos selecionados (${GT}):</strong><br>${trevoArr.map(n => `<span class="pc sm trevo">${n}</span>`).join('')}`;
    }

    const statsBlock = `
<div class="meta">
  <strong>Números selecionados (${G}):</strong><br>${poolCircles}${trevoCircles}<br>
  <ul style="margin:4px 0 6px;padding-left:18px;font-size:12px">${sizeLines}</ul>
  <strong>Prob. total (${nBets} aposta(s), tamanhos mistos) — universo completo:</strong> <strong>${fmtO(1-pNotWinUniv)}</strong><br>
  ${grpLine}
</div>`;

    const pw = window.open('', '_blank', 'width=820,height=720');
    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Apostas ${config.name}</title>
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;padding:24px;max-width:740px;margin:0 auto}
  h1{color:${color};font-size:22px;border-bottom:2px solid ${color};padding-bottom:8px;margin-bottom:16px}
  h2{color:${color};font-size:15px;margin:18px 0 8px}
  .meta{background:#f0f4ff;border-left:4px solid ${color};border-radius:6px;padding:10px 14px;margin:10px 0;font-size:13px;line-height:1.9}
  .pc{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
      border-radius:50%;background:${color};color:#fff;font-weight:bold;font-size:11px;margin:2px}
  .pc.sm{width:24px;height:24px;font-size:9px;margin:2px}
  .pc.trevo{background:#7b2d8b}
  .pr{display:flex;align-items:center;gap:8px;margin:5px 0;border-bottom:1px solid #eee;padding-bottom:5px}
  .pi{font-weight:bold;font-size:13px;color:#666;min-width:24px}
  .total{font-size:15px;font-weight:bold;color:${color};margin-top:14px;padding:8px 12px;
         background:#f3f3f3;border-radius:6px;display:inline-block}
  @media print{body{padding:12px}}
</style></head><body>
<h1>🎲 Apostas ${config.name}</h1>
${statsBlock}
<h2>Apostas — ${nBets} jogo(s)</h2>
${betsHTML}
${hasVal ? `<div class="total">Valor total: R$ ${(nBets*val).toFixed(2).replace('.',',')}</div>` : ''}
<script>window.onload=()=>{ document.title='${ojPdfTitle}'; window.print(); };<\/script>
</body></html>`);
    pw.document.close();
}

function switchOJGame(game) {
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.game === game));
    document.querySelectorAll('.game-panel').forEach(p => p.classList.toggle('active', p.id === 'game-' + game));
}

// ════════════════════════════════════════════════════════════
//  ARRAY FINAL
// ════════════════════════════════════════════════════════════

function arrayFinalAddBatch(bets) {
    if (!bets || !bets.length) return;
    _afCounter++;
    // Build group label from current filter state
    let groupLabel;
    if (S_FILTER.preGroup) {
        groupLabel = `Ult${S_FILTER.preGroup.n}`;
    } else if (S.group.size === 60) {
        groupLabel = 'Todos';
    } else {
        groupLabel = `Grupo (${S.group.size} núm.)`;
    }
    S_ARRAY_FINAL.push({
        id: Date.now() + Math.random(),
        bets: bets.map(b => [...b]),
        label: `Lote ${_afCounter} — ${groupLabel}`,
        groupLabel
    });
    arrayFinalRender();
}

function arrayFinalDelete(id) {
    const idx = S_ARRAY_FINAL.findIndex(b => b.id === id);
    if (idx !== -1) S_ARRAY_FINAL.splice(idx, 1);
    arrayFinalRender();
}

function arrayFinalClearAll() {
    if (!S_ARRAY_FINAL.length) return;
    if (!confirm('Limpar todos os arrays do Array Final?')) return;
    S_ARRAY_FINAL.length = 0;
    _afCounter = 0;
    arrayFinalRender();
}

function arrayFinalRender() {
    const listEl  = document.getElementById('array-final-list');
    const totalEl = document.getElementById('array-final-total');
    const printBtn = document.getElementById('btn-array-final-print');
    if (!listEl) return;

    if (!S_ARRAY_FINAL.length) {
        listEl.innerHTML = '<p class="muted">Nenhuma aposta impressa ainda.</p>';
        if (totalEl) totalEl.innerHTML = '';
        if (printBtn) printBtn.disabled = true;
        return;
    }

    // Individual batches
    listEl.innerHTML = S_ARRAY_FINAL.map(batch => {
        const circlesHTML = batch.bets.map(bet =>
            '[' + bet.map(n => String(n).padStart(2,'0')).join(',') + ']'
        ).join(', ');
        return `<div class="af-batch">
            <div class="af-batch-header">
                <span class="af-batch-label">${batch.label} — <strong>${batch.bets.length}</strong> aposta(s)</span>
                <button class="btn-icon af-del-btn" title="Excluir lote" onclick="arrayFinalDelete(${batch.id})">✕</button>
            </div>
            <div class="af-batch-array">[${circlesHTML}]</div>
        </div>`;
    }).join('');

    // Totalizer
    const allBets = S_ARRAY_FINAL.flatMap(b => b.bets);
    const totalArrayStr = '[' + allBets.map(bet => '[' + bet.join(',') + ']').join(', ') + ']';
    if (totalEl) {
        totalEl.innerHTML = `<div class="af-total">
            <div class="af-total-header">📦 Array totalizador — <strong>${allBets.length}</strong> aposta(s)</div>
            <div class="af-total-array">${totalArrayStr}</div>
        </div>`;
    }
    if (printBtn) printBtn.disabled = false;
}

function arrayFinalPrint() {
    if (!S_ARRAY_FINAL.length) return;
    const allBets = S_ARRAY_FINAL.flatMap(b => b.bets);

    const now = new Date();
    const dd  = String(now.getDate()).padStart(2,'0');
    const mm  = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const hh  = String(now.getHours()).padStart(2,'0');
    const min = String(now.getMinutes()).padStart(2,'0');
    const pdfTitle = `Array Final — Mega-Sena ${dd}-${mm}-${yyyy} ${hh}h${min}`;

    const batchesHTML = S_ARRAY_FINAL.map((batch) => {
        const rows = batch.bets.map((bet, idx) => {
            const circles = bet.map(n =>
                `<span class="pc">${String(n).padStart(2,'0')}</span>`).join('');
            return `<div class="pr"><span class="pi">${idx+1}.</span><div>${circles}</div></div>`;
        }).join('');
        return `<h2>${batch.label}</h2>${rows}`;
    }).join('');

    const totalArrayStr = '[' + allBets.map(bet => '[' + bet.join(',') + ']').join(', ') + ']';

    const pw = window.open('', '_blank', 'width=820,height=720');
    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${pdfTitle}</title>
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;padding:24px;max-width:740px;margin:0 auto}
  h1{color:#1c8059;font-size:22px;border-bottom:2px solid #1c8059;padding-bottom:8px;margin-bottom:16px}
  h2{color:#1c8059;font-size:14px;margin:18px 0 6px;border-bottom:1px solid #cce8da;padding-bottom:4px}
  .pc{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
      border-radius:50%;background:#1c8059;color:#fff;font-weight:bold;font-size:11px;margin:2px}
  .pr{display:flex;align-items:center;gap:6px;margin:4px 0;border-bottom:1px solid #eee;padding-bottom:4px}
  .pi{font-weight:bold;font-size:12px;color:#666;min-width:22px}
  .total-box{background:#e6f5ef;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:12px;
             border-left:4px solid #1c8059;word-break:break-all;line-height:1.8}
  .meta-box{background:#f0f7ff;border-radius:6px;padding:10px 14px;font-size:13px;margin-bottom:16px}
  @media print{body{padding:12px}}
</style></head><body>
<h1>🍀 Array Final — Mega-Sena</h1>
<div class="meta-box">
  Total de lotes: <strong>${S_ARRAY_FINAL.length}</strong> &nbsp;·&nbsp;
  Total de apostas: <strong>${allBets.length}</strong> &nbsp;·&nbsp;
  Gerado em: <strong>${dd}/${mm}/${yyyy}</strong>
</div>
${batchesHTML}
<h2>📦 Array Totalizador</h2>
<div class="total-box"><strong>${totalArrayStr}</strong></div>
<script>window.onload=()=>{ document.title='${pdfTitle}'; window.print(); };<\/script>
</body></html>`);
    pw.document.close();
}

// ════════════════════════════════════════════════════════════
//  CHECAGEM DE APOSTAS
// ════════════════════════════════════════════════════════════

function checagemRun() {
    const textarea = document.getElementById('checagem-input');
    const resultEl = document.getElementById('checagem-result');
    const raw = (textarea.value || '').trim();

    if (!raw) {
        resultEl.innerHTML = '<p class="chk-error">Cole o array de apostas no campo acima.</p>';
        return;
    }
    if (!S.contests.length) {
        resultEl.innerHTML = '<p class="chk-error">Carregue o arquivo ODS primeiro.</p>';
        return;
    }

    let bets;
    try {
        bets = JSON.parse(raw);
        if (!Array.isArray(bets) || !bets.length) throw new Error('Array vazio');
        bets.forEach((b, i) => {
            if (!Array.isArray(b) || b.length < 6)
                throw new Error(`Aposta ${i+1} inválida (mínimo 6 números)`);
        });
    } catch(e) {
        resultEl.innerHTML = `<p class="chk-error">⚠ Formato inválido: ${e.message}<br>Use o formato: [[1,2,3,4,5,6], [7,8,9,10,11,12]]</p>`;
        return;
    }

    if (bets.length > 200) {
        resultEl.innerHTML = '<p class="chk-error">Máximo de 200 apostas por checagem.</p>';
        return;
    }

    const lastContest = S.contests[S.contests.length - 1];
    const drawn = lastContest.numbers; // already sorted

    const results = bets.map((bet, idx) => {
        const hits = bet.filter(n => drawn.includes(n));
        return { idx, bet: [...bet].sort((a,b)=>a-b), hits, hitCount: hits.length };
    });

    // Render inline results
    resultEl.innerHTML = results.map(r => {
        const badgeClass = r.hitCount >= 6 ? ' chk-badge-sena'
                         : r.hitCount === 5 ? ' chk-badge-quina'
                         : r.hitCount === 4 ? ' chk-badge-quadra' : '';
        const icon = r.hitCount >= 6 ? ' 🏆' : r.hitCount === 5 ? ' 🥈' : r.hitCount === 4 ? ' 🥉' : '';
        const circles = r.bet.map(n => {
            const hit = r.hits.includes(n);
            return `<span class="chk-circle${hit ? ' chk-hit' : ' chk-miss'}">${String(n).padStart(2,'0')}</span>`;
        }).join('');
        return `<div class="chk-card${badgeClass}">
            <div class="chk-card-header">
                <span class="chk-num">Aposta ${r.idx+1}</span>
                <span class="chk-hits">${r.hitCount} acerto(s)${icon}</span>
            </div>
            <div class="chk-circles">${circles}</div>
        </div>`;
    }).join('');

    // Show print button
    const printBtn = document.getElementById('btn-checagem-print');
    if (printBtn) {
        printBtn.disabled = false;
        printBtn.onclick = () => checagemPrint(results, lastContest);
    }
}

function checagemPrint(results, lastContest) {
    const now = new Date();
    const dd  = String(now.getDate()).padStart(2,'0');
    const mm  = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const pdfTitle = `Checagem Mega-Sena — Concurso ${lastContest.concurso}`;

    const drawnCircles = lastContest.numbers.map(n =>
        `<span class="pc drawn">${String(n).padStart(2,'00')}</span>`).join('');

    const betsHTML = results.map(r => {
        const badgeClass = r.hitCount >= 6 ? 'sena' : r.hitCount === 5 ? 'quina' : r.hitCount === 4 ? 'quadra' : '';
        const icon = r.hitCount >= 6 ? '🏆 SENA!' : r.hitCount === 5 ? '🥈 QUINA!' : r.hitCount === 4 ? '🥉 QUADRA!' : '';
        const rowClass = badgeClass ? ` chk-row-${badgeClass}` : '';
        const circles = r.bet.map(n => {
            const hit = r.hits.includes(n);
            return `<span class="pc${hit ? ' hit' : ' miss'}">${String(n).padStart(2,'00')}</span>`;
        }).join('');
        return `<div class="bet-entry${rowClass}">
            <div class="bet-header">
                <span class="bet-label">Aposta ${r.idx+1}</span>
                <span class="bet-score${badgeClass ? ' score-'+badgeClass : ''}">${r.hitCount} acerto(s)${icon ? ' — '+icon : ''}</span>
            </div>
            <div class="circles-row">${circles}</div>
        </div>`;
    }).join('');

    const pw = window.open('', '_blank', 'width=820,height=720');
    pw.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${pdfTitle}</title>
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;padding:24px;max-width:740px;margin:0 auto}
  h1{color:#1c8059;font-size:22px;border-bottom:2px solid #1c8059;padding-bottom:8px;margin-bottom:16px}
  .contest-box{background:#e6f5ef;border-radius:8px;padding:12px 16px;margin:0 0 20px;font-size:14px;line-height:2}
  .pc{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;
      border-radius:50%;font-weight:bold;font-size:12px;margin:3px}
  .pc.drawn{background:#1c8059;color:#fff}
  .pc.hit{background:#1c8059;color:#fff;box-shadow:0 0 0 3px #a8dfc5}
  .pc.miss{background:#fff;color:#333;border:2px solid #bbb}
  .bet-entry{border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;margin:8px 0}
  .bet-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .bet-label{font-weight:bold;font-size:13px;color:#555}
  .bet-score{font-weight:bold;font-size:14px;color:#444}
  .bet-entry.chk-row-quadra{background:#fffde7;border-color:#f9a825}
  .bet-entry.chk-row-quina{background:#fff3e0;border-color:#ef6c00}
  .bet-entry.chk-row-sena{background:#e8f5e9;border-color:#2e7d32}
  .score-quadra{color:#f57f17}
  .score-quina{color:#e65100}
  .score-sena{color:#1b5e20}
  .circles-row{display:flex;flex-wrap:wrap;gap:2px}
  .summary-box{background:#f0f7ff;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px}
  @media print{body{padding:12px}}
</style></head><body>
<h1>🍀 Checagem de Apostas — Mega-Sena</h1>
<div class="contest-box">
  <strong>Concurso sorteado:</strong> #${lastContest.concurso} (${lastContest.data})<br>
  <strong>Dezenas sorteadas:</strong> ${drawnCircles}
</div>
<div class="summary-box">
  Total de apostas checadas: <strong>${results.length}</strong> &nbsp;·&nbsp;
  Com 4+ acertos: <strong>${results.filter(r=>r.hitCount>=4).length}</strong>
</div>
${betsHTML}
<script>window.onload=()=>{ document.title='${pdfTitle}'; window.print(); };<\/script>
</body></html>`);
    pw.document.close();
}

// ── INIT ──────────────────────────────────────────────────
function init() {
    renderProbabilitySection();
    renderPredefined();
    buildGroupGrid();

    // Outros Jogos grids
    ['quina', 'duplasena', 'lotofacil', 'milionaria'].forEach(g => buildOJGrid(g));
    buildMilionariaTrevoGrid();

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Outros Jogos sub-tabs
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchOJGame(btn.dataset.game));
    });

    // ODS
    document.getElementById('ods-file-input').addEventListener('change', loadODS);

    // Settings
    ['bet-size', 'bet-repetition', 'bet-value'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateSettings);
    });

    // Bet count: slider ↔ number input bidirectional sync
    const slider  = document.getElementById('bet-count');
    const numInput = document.getElementById('bet-count-input');

    slider.addEventListener('input', () => {
        numInput.value = slider.value;
        S.settings.betCount = parseInt(slider.value) || 1;
    });
    numInput.addEventListener('input', () => {
        // Permite apagar/editar livremente; sincroniza só quando há número válido
        const v = parseInt(numInput.value);
        if (!isNaN(v) && v >= 1) {
            const clamped = Math.min(v, parseInt(slider.max) || 100);
            slider.value = clamped;
            S.settings.betCount = clamped;
        }
    });
    numInput.addEventListener('blur', () => {
        // Ao sair do campo, aplica clamping e normaliza o valor exibido
        let v = parseInt(numInput.value) || 1;
        v = Math.max(1, Math.min(v, parseInt(slider.max) || 100));
        slider.value = v;
        numInput.value = v;
        S.settings.betCount = v;
    });
    slider.addEventListener('change', updateSettings);
    numInput.addEventListener('change', updateSettings);

    // Outros Jogos: count slider ↔ input sync
    ['quina', 'duplasena', 'lotofacil', 'milionaria'].forEach(game => {
        const s = document.getElementById(`${game}-count-range`);
        const inp = document.getElementById(`${game}-count-input`);
        s.addEventListener('input', () => { inp.value = s.value; });
        inp.addEventListener('input', () => {
            // Permite apagar/editar livremente; sincroniza só quando há número válido
            const v = parseInt(inp.value);
            if (!isNaN(v) && v >= 1) {
                s.value = Math.min(v, 50);
            }
        });
        inp.addEventListener('blur', () => {
            // Ao sair do campo, aplica clamping e normaliza o valor exibido
            let v = Math.max(1, Math.min(parseInt(inp.value) || 1, 50));
            s.value = v; inp.value = v;
        });
    });

    // OJ: recalcular probabilidades ao mudar tamanho da aposta ou trevo
    ['quina', 'duplasena', 'lotofacil', 'milionaria'].forEach(game => {
        const bs = document.getElementById(`${game}-betsize`);
        if (bs) bs.addEventListener('change', () => ojComputeOdds(game));
    });
    const milTrevo = document.getElementById('milionaria-trevosize');
    if (milTrevo) milTrevo.addEventListener('change', () => ojComputeOdds('milionaria'));

    updateGroupUI();
    renderBets();

    // Ajusta offsets dinâmicos com base na altura real do sticky-header
    updateStickyOffsets();
    window.addEventListener('resize', updateStickyOffsets);
}

// Calcula a altura real do bloco sticky (cabeçalho + abas) e ajusta
// o topo da sidebar e da barra de sub-abas de Outros Jogos
function updateStickyOffsets() {
    const wrapper = document.querySelector('.sticky-header');
    if (!wrapper) return;
    const h = wrapper.offsetHeight;
    const sidebar = document.querySelector('.sidebar-col');
    if (sidebar) {
        sidebar.style.top = h + 'px';
        sidebar.style.maxHeight = `calc(100vh - ${h + 8}px)`;
    }
    const subtab = document.querySelector('.subtab-bar');
    if (subtab) {
        subtab.style.top = h + 'px';
    }
}

window.addEventListener('DOMContentLoaded', init);

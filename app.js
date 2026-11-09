import {
  MAX_GRADE, TARGETS, ceil2, examNeeded, formatAverage, formatFixed, formatGrade, parseGrade,
  semesterStats, solve, subjectStats, typeGrade, yearAverage,
} from './calc.js';
import { load, newSemester, newSubject, normalize, save, uid } from './store.js';

let data = load();

const stage = document.getElementById('stage');
const overlays = document.getElementById('overlays');
const toastRoot = document.getElementById('toast');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pct = (grade) => (grade / MAX_GRADE) * 100;
const percent = (share) => `${Math.round(share * 100)} %`;
const activeSemester = () => data.semesters.find((s) => s.id === data.activeSemesterId) ?? data.semesters[0];
const findSubject = (id) => activeSemester().subjects.find((s) => s.id === id);

const svg = (viewBox, body) => `<svg viewBox="${viewBox}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons = {
  down: svg('0 0 14 14', '<path d="M3 5.5l4 4 4-4"/>'),
  back: svg('0 0 12 20', '<path d="M10 2l-8 8 8 8"/>'),
  next: svg('0 0 8 14', '<path d="M1.5 1.5L7 7l-5.5 5.5"/>'),
  close: svg('0 0 14 14', '<path d="M2.5 2.5l9 9M11.5 2.5l-9 9"/>'),
  plus: svg('0 0 14 14', '<path d="M7 2v10M2 7h10"/>'),
  minus: svg('0 0 14 14', '<path d="M2 7h10"/>'),
  check: svg('0 0 16 16', '<path d="M3 8.5l3.5 3.5L13 4.5"/>'),
  settings: svg('0 0 22 22', '<path d="M3 7h9M16 7h3M3 15h3M10 15h9"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="15" r="2"/>'),
  backspace: svg('0 0 26 20', '<path d="M8.5 2H23a1.5 1.5 0 011.5 1.5v13A1.5 1.5 0 0123 18H8.5L1.5 10z"/><path d="M12.5 7l6 6M18.5 7l-6 6"/>'),
};

/* ---------- Morceaux d'interface ---------- */

const TICKS = Array.from({ length: 21 }, (_, i) => `<line x1="${i * 10}" x2="${i * 10}" y1="0" y2="${i % 5 === 0 ? 14 : 7}" vector-effect="non-scaling-stroke"/>`).join('');

function ruler({ key, worst, best, value, target }) {
  const labels = [0, 5, 10, 15, 20].filter((n) => Math.abs(n - target) >= 1.5);
  const showBand = worst !== null && best - worst > 0.001;
  return `
    <div class="ruler" role="img" aria-label="Règle de 0 à 20. Objectif ${target}.">
      ${showBand ? `<div class="ruler-band" data-band="${key}" data-left="${pct(worst)}" data-width="${pct(best - worst)}" style="left:${pct(worst)}%;width:${pct(best - worst)}%"></div>` : ''}
      <svg class="ruler-ticks" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">${TICKS}</svg>
      <div class="ruler-goal" style="left:${pct(target)}%"></div>
      ${value === null ? '' : `<div class="ruler-pin-track" data-slide="${key}" data-to="${pct(value)}" style="transform:translateX(${pct(value)}%)"><i class="ruler-pin"></i></div>`}
      <div class="ruler-labels">
        ${labels.map((n) => `<span style="left:${pct(n)}%">${n}</span>`).join('')}
        <span class="ruler-label-goal" style="left:${pct(target)}%">${target}</span>
      </div>
    </div>`;
}

const targetsControl = (semester) => `
  <div class="targets" role="group" aria-label="Objectif de moyenne">
    <span>Objectif</span>
    <div class="seg">
      ${TARGETS.map((t) => `<button data-act="target" data-value="${t}" aria-pressed="${t === semester.target}">${t}</button>`).join('')}
    </div>
  </div>`;

const number = (key, value, text) => `<span data-num="${key}" data-to="${value}">${text}</span>`;

function remainingPhrase(stats) {
  if (stats.pendingCC === 0 && stats.pendingExams === 1) return 'à ton dernier partiel';
  if (stats.pendingCC === 0) return `à chacun de tes ${stats.pendingExams} partiels`;
  return 'à tout ce qu’il reste à noter';
}

const goalPhrase = (target) => (target === 10 ? 'valider' : `finir à ${target}`);
const gap = (target, average) => {
  const points = ceil2(target - average);
  return `${formatFixed(points)} point${points >= 2 ? 's' : ''}`;
};

function answerBlock(semester, stats, result) {
  const { target } = semester;
  const validate = target === 10;
  let state = result.status;
  let body;
  if (result.status === 'possible') {
    body = `
      <p class="answer-lead">Il te faut</p>
      <p class="answer-big">${number('home-need', result.need, formatFixed(result.need))}<small>/20</small></p>
      <p class="answer-text">${remainingPhrase(stats)} pour ${goalPhrase(target)}.</p>`;
  } else if (result.status === 'secured') {
    body = `
      <p class="answer-word">C’est acquis</p>
      <p class="answer-text">Même avec 0 ${remainingPhrase(stats)}, tu finis à ${formatAverage(result.worst)}.</p>`;
  } else if (result.status === 'impossible') {
    body = `
      <p class="answer-word">Hors de portée</p>
      <p class="answer-text">Même avec 20 ${remainingPhrase(stats)}, tu finis à ${formatAverage(result.best)}.</p>`;
  } else {
    state = result.reached ? 'secured' : 'impossible';
    const word = validate ? `Semestre ${result.reached ? 'validé' : 'non validé'}` : `Objectif ${target} ${result.reached ? 'atteint' : 'manqué'}`;
    body = `
      <p class="answer-word">${word}</p>
      <p class="answer-text">${result.reached ? `Tu finis à ${formatAverage(result.average)}.` : `Il manque ${gap(target, result.average)} pour ${target}.`}</p>`;
  }
  return `
    <section class="answer" data-state="${state}">
      ${targetsControl(semester)}
      ${body}
      ${result.status === 'done' ? '' : `<button class="answer-sim" data-act="simulate">Simuler mes partiels${icons.next}</button>`}
    </section>`;
}

function needSummary(subject, target) {
  const need = examNeeded(subject, target);
  if (need.status === 'possible') return `Partiel : ${formatFixed(need.need)} pour ${target}`;
  if (need.status === 'secured') return `${target} déjà assuré`;
  return `${target} hors de portée`;
}

function subjectRow(subject, target) {
  const stats = subjectStats(subject);
  let detail;
  if (stats.isFinal) detail = subject.ccWeight === 100 ? 'Contrôle continu seul' : 'Terminée';
  else if (stats.average === null) detail = 'Pas encore de note';
  else if (stats.examPending) detail = needSummary(subject, target);
  else detail = 'CC à venir';
  const low = stats.average !== null && stats.average < 10;
  return `
    <li>
      <button class="row" data-act="open-subject" data-id="${subject.id}">
        <span class="row-main">
          <span class="row-title">${esc(subject.name)}</span>
          <span class="row-detail">Coef ${formatGrade(subject.coef)} · ${detail}</span>
        </span>
        <span class="row-grade${low ? ' is-low' : ''}${stats.isFinal ? '' : ' is-provisional'}">${formatAverage(stats.average)}</span>
        <span class="row-next">${icons.next}</span>
      </button>
    </li>`;
}

/* ---------- Écrans ---------- */

function viewHome() {
  const semester = activeSemester();
  const header = `
    <header class="bar">
      <button class="bar-title" data-act="semesters" aria-label="Changer de semestre, actuellement ${esc(semester.name)}"><span>${esc(semester.name)}</span>${icons.down}</button>
      <button class="icon-btn" data-act="settings" aria-label="Réglages">${icons.settings}</button>
    </header>`;
  if (semester.subjects.length === 0) {
    return `${header}
      <section class="empty">
        ${ruler({ key: 'empty', worst: null, best: null, value: null, target: 10 })}
        <h1>Commence par tes matières</h1>
        <p>Ajoute-les avec leur coefficient. Ensuite, tu rentres tes notes au fur et à mesure.</p>
        <button class="primary" data-act="add-subject">Ajouter une matière</button>
      </section>`;
  }
  const stats = semesterStats(semester);
  const result = solve(stats, semester.target);
  const finished = result.status === 'done';
  const partial = stats.gradedCount < stats.subjectCount;
  return `${header}
    <section class="hero">
      <div class="hero-meta">
        <p>${finished ? 'Ta moyenne finale' : 'Ta moyenne pour l’instant'}</p>
        ${partial && stats.gradedCount ? `<p>${stats.gradedCount} matière${stats.gradedCount > 1 ? 's' : ''} sur ${stats.subjectCount}</p>` : ''}
      </div>
      <p class="big${finished ? '' : ' is-provisional'}">${number('home-avg', stats.average ?? 0, formatAverage(stats.average))}<small>/20</small></p>
      ${ruler({ key: 'home', worst: stats.worst, best: stats.best, value: stats.average, target: semester.target })}
    </section>
    ${answerBlock(semester, stats, result)}
    <section class="list">
      <div class="list-head">
        <h2>Matières</h2>
        <button class="link with-icon" data-act="add-subject">${icons.plus}Ajouter</button>
      </div>
      <ul class="rows">${semester.subjects.map((s) => subjectRow(s, semester.target)).join('')}</ul>
    </section>`;
}

function needsStrip(subject, semester) {
  const cell = (target) => {
    const need = examNeeded(subject, target);
    const value = need.status === 'possible' ? formatFixed(need.need) : need.status === 'secured' ? 'Acquis' : '> 20';
    return `<div class="need" data-current="${target === semester.target}" data-status="${need.status}"><small>pour ${target}</small><b>${value}</b></div>`;
  };
  const stats = semesterStats(semester);
  const line = stats.remaining.find((r) => r.subject.id === subject.id);
  const subjectState = subjectStats(subject);
  const examShare = (subject.coef * (1 - subject.ccWeight / 100)) / stats.total;
  return `
    <section class="answer answer-compact" data-state="possible">
      <p class="answer-lead">Il te faut au partiel</p>
      <div class="needs">${TARGETS.map(cell).join('')}</div>
      <p class="answer-foot">${line ? `Ce partiel compte pour ${percent(examShare)} de ton semestre.` : ''}${subjectState.ccPending ? ' Sans note de CC pour l’instant, on compte la même note au CC et au partiel.' : ''}</p>
    </section>`;
}

function gradeRow(grade) {
  const date = new Date(grade.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `
    <li${grade.id === justAdded ? ' class="is-new"' : ''}>
      <button class="row row-grade-line" data-act="edit-cc" data-id="${grade.id}">
        <span class="row-main">
          <span class="row-title">${esc(grade.label ?? 'Note')}</span>
          <span class="row-detail">${date}</span>
        </span>
        <span class="row-grade${grade.value < 10 ? ' is-low' : ''}">${formatGrade(grade.value)}</span>
      </button>
    </li>`;
}

function viewSubject(id) {
  const subject = findSubject(id);
  const semester = activeSemester();
  const stats = subjectStats(subject);
  const hasCC = subject.ccWeight > 0;
  const hasExam = subject.ccWeight < 100;
  const parts = [`Coef ${formatGrade(subject.coef)}`];
  if (hasCC) parts.push(`CC ${subject.ccWeight} %`);
  if (hasExam) parts.push(`Partiel ${100 - subject.ccWeight} %`);
  let status = 'Pas encore de note.';
  if (stats.isFinal) status = subject.ccWeight === 100 ? 'Moyenne de tes notes de contrôle continu.' : 'Moyenne définitive.';
  else if (stats.examPending && stats.average !== null) status = 'Provisoire, le partiel n’est pas encore noté.';
  else if (stats.average !== null) status = 'Provisoire, le contrôle continu n’est pas encore noté.';
  return `
    <header class="bar bar-nav">
      <button class="bar-back" data-act="back">${icons.back}<span>${esc(semester.name)}</span></button>
      <button class="link" data-act="edit-subject" data-id="${subject.id}">Modifier</button>
    </header>
    <section class="hero hero-subject">
      <h1>${esc(subject.name)}</h1>
      <p class="hero-sub">${parts.join(' · ')}</p>
      <p class="big big-subject${stats.isFinal ? '' : ' is-provisional'}">${number(`subject-${id}`, stats.average ?? 0, formatAverage(stats.average))}<small>/20</small></p>
      <p class="hero-sub">${status}</p>
    </section>
    ${stats.examPending ? needsStrip(subject, semester) : ''}
    ${hasCC ? `
      <section class="list">
        <div class="list-head">
          <h2>Contrôle continu</h2>
          ${stats.ccAverage !== null ? `<span class="list-note">Moyenne ${formatAverage(stats.ccAverage)}</span>` : ''}
        </div>
        <ul class="rows">${subject.cc.map(gradeRow).join('')}</ul>
        <button class="add-line" data-act="add-cc" data-id="${subject.id}">${icons.plus}Ajouter une note</button>
      </section>` : ''}
    ${hasExam ? `
      <section class="list">
        <div class="list-head"><h2>Partiel</h2></div>
        ${subject.exam === null
          ? `<button class="add-line" data-act="set-exam" data-id="${subject.id}">${icons.plus}Rentrer ma note de partiel</button>`
          : `<ul class="rows"><li><button class="row row-grade-line" data-act="set-exam" data-id="${subject.id}">
              <span class="row-main"><span class="row-title">Note de partiel</span></span>
              <span class="row-grade${subject.exam < 10 ? ' is-low' : ''}">${formatGrade(subject.exam)}</span>
            </button></li></ul>`}
      </section>` : ''}`;
}

const simulation = { pinned: {} };

function simRowDetail({ stats, share }) {
  const what = stats.ccPending && stats.examPending ? 'CC + partiel' : stats.ccPending ? 'CC' : 'Partiel';
  return `${what} · ${percent(share)} du semestre`;
}

function viewSimulation() {
  const semester = activeSemester();
  const stats = semesterStats(semester);
  return `
    <header class="bar bar-nav">
      <button class="bar-back" data-act="back">${icons.back}<span>${esc(semester.name)}</span></button>
      <button class="link" data-act="sim-reset">Réinitialiser</button>
    </header>
    <section class="sim-summary">
      <div class="hero-meta"><p>Moyenne finale</p></div>
      <p class="big big-subject is-provisional"><span data-sim-average></span><small>/20</small></p>
      ${ruler({ key: 'sim', worst: null, best: null, value: 10, target: semester.target })}
      <p class="sim-text" data-sim-text></p>
    </section>
    <div class="sim-controls">
      ${targetsControl(semester)}
      <p class="sim-help">Bouge un curseur pour fixer une note, les autres s’ajustent. Rien n’est enregistré.</p>
    </div>
    <ul class="sim-rows">
      ${stats.remaining.map((line) => `
        <li class="sim-row" data-row="${line.subject.id}">
          <div class="sim-head">
            <div>
              <p class="row-title">${esc(line.subject.name)}</p>
              <p class="row-detail">${simRowDetail(line)}</p>
            </div>
            <div class="sim-value">
              <button class="unpin" data-act="sim-unpin" data-id="${line.subject.id}" aria-label="Revenir au calcul automatique pour ${esc(line.subject.name)}">${icons.close}</button>
              <span data-sim-value></span>
            </div>
          </div>
          <div class="slider" data-id="${line.subject.id}">
            <input type="range" min="0" max="20" step="0.5" value="10" aria-label="Note simulée en ${esc(line.subject.name)}">
            <div class="slider-track"><div class="slider-fill"></div></div>
            <div class="slider-thumb"></div>
          </div>
        </li>`).join('')}
    </ul>`;
}

function paintSimulation(root) {
  const semester = activeSemester();
  const stats = semesterStats(semester, simulation.pinned);
  const result = solve(stats, semester.target);
  const base = semesterStats(semester);
  const pinnedCount = base.remaining.filter((r) => r.subject.id in simulation.pinned).length;
  const freeCount = base.remaining.length - pinnedCount;
  let others = remainingPhrase(base);
  if (pinnedCount > 0) others = freeCount === 1 ? 'à la dernière matière' : `aux ${freeCount} autres matières`;

  let projected;
  let text;
  let auto = 0;
  if (result.status === 'possible') {
    projected = semester.target;
    auto = result.need;
    text = `Il te faut <b>${formatFixed(result.need)}</b> ${others} pour ${goalPhrase(semester.target)}.`;
  } else if (result.status === 'secured') {
    projected = result.worst;
    text = `Même avec 0 ${others}, tu finis à ${formatAverage(result.worst)}.`;
  } else if (result.status === 'impossible') {
    projected = result.best;
    auto = MAX_GRADE;
    text = `Même avec 20 ${others}, tu finis à ${formatAverage(result.best)}.`;
  } else {
    projected = result.average;
    if (result.reached) text = semester.target === 10 ? 'Avec ces notes, ton semestre est validé.' : `Avec ces notes, tu atteins ${semester.target}.`;
    else text = `Avec ces notes, il manque ${gap(semester.target, result.average)} pour ${semester.target}.`;
  }

  root.querySelector('[data-sim-average]').textContent = formatAverage(projected);
  root.querySelector('[data-sim-text]').innerHTML = text;
  root.querySelector('.ruler-pin-track').style.transform = `translateX(${pct(projected)}%)`;

  root.querySelectorAll('[data-row]').forEach((row) => {
    const { row: id } = row.dataset;
    const pinned = id in simulation.pinned;
    const value = pinned ? simulation.pinned[id] : auto;
    row.dataset.pinned = pinned;
    row.querySelector('[data-sim-value]').textContent = pinned ? formatGrade(value) : formatFixed(value);
    const slider = row.querySelector('.slider');
    if (!slider.matches('.is-dragging')) {
      slider.querySelector('input').value = value;
      slider.style.setProperty('--p', pct(value));
    }
  });
}

/* ---------- Curseur et ressort ---------- */

const THUMB_INSET = 14;

// Le curseur ne bouge qu'une fois le geste reconnu comme horizontal, pour qu'un défilement de la liste ne change aucune note.
function bindSlider(wrapper, onChange) {
  const input = wrapper.querySelector('input');
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step);
  const fractionOf = (value) => (value - min) / (max - min);

  const apply = (value) => {
    input.value = value;
    wrapper.style.setProperty('--p', fractionOf(value) * 100);
    onChange(value);
  };

  const setFromX = (x) => {
    const rect = wrapper.getBoundingClientRect();
    const fraction = clamp((x - rect.left - THUMB_INSET) / (rect.width - THUMB_INSET * 2), 0, 1);
    const value = Math.round((min + fraction * (max - min)) / step) * step;
    if (value !== Number(input.value) || !wrapper.matches('.is-dragging')) apply(value);
  };

  wrapper.addEventListener('pointerdown', (start) => {
    if (!start.isPrimary) return;
    const rect = wrapper.getBoundingClientRect();
    const thumbX = rect.left + THUMB_INSET + fractionOf(Number(input.value)) * (rect.width - THUMB_INSET * 2);
    const offset = Math.abs(start.clientX - thumbX) < 26 ? thumbX - start.clientX : 0;
    let dragging = false;

    const onMove = (event) => {
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      if (!dragging && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
        dragging = true;
        wrapper.classList.add('is-dragging');
        wrapper.setPointerCapture(event.pointerId);
      }
      if (dragging) setFromX(event.clientX + offset);
    };
    const finish = (event) => {
      wrapper.removeEventListener('pointermove', onMove);
      wrapper.removeEventListener('pointerup', finish);
      wrapper.removeEventListener('pointercancel', finish);
      if (event.type === 'pointerup' && !dragging) setFromX(event.clientX + offset);
      wrapper.classList.remove('is-dragging');
    };
    wrapper.addEventListener('pointermove', onMove);
    wrapper.addEventListener('pointerup', finish);
    wrapper.addEventListener('pointercancel', finish);
  });

  input.addEventListener('input', () => apply(Number(input.value)));
}

function spring({ from, to, velocity = 0, response = 0.36, damping = 1, onFrame, onEnd }) {
  const omega = (2 * Math.PI) / response;
  const a = from - to;
  const start = performance.now();
  let frame;
  const tick = (now) => {
    const t = (now - start) / 1000;
    let x;
    let v;
    if (damping >= 1) {
      const b = velocity + omega * a;
      const decay = Math.exp(-omega * t);
      x = to + (a + b * t) * decay;
      v = (b - omega * (a + b * t)) * decay;
    } else {
      const damped = omega * Math.sqrt(1 - damping * damping);
      const b = (velocity + damping * omega * a) / damped;
      const decay = Math.exp(-damping * omega * t);
      const position = a * Math.cos(damped * t) + b * Math.sin(damped * t);
      x = to + decay * position;
      v = decay * (-damping * omega * position + damped * (b * Math.cos(damped * t) - a * Math.sin(damped * t)));
    }
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 8) {
      onFrame(to);
      onEnd?.();
      return;
    }
    onFrame(x);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

const project = (velocity) => (velocity / 1000) * (0.998 / (1 - 0.998));
const rubberband = (overshoot, size) => (overshoot * size * 0.55) / (size + 0.55 * overshoot);

/* ---------- Feuilles coulissantes ---------- */

function openSheet({ html, label, tall = false, onClose }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const panel = document.createElement('section');
  panel.className = `sheet${tall ? ' sheet-tall' : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', label);
  panel.tabIndex = -1;
  panel.innerHTML = `<div class="grabber" data-grab aria-hidden="true"></div>${html}`;
  overlays.append(scrim, panel);

  const height = panel.offsetHeight;
  let y = reducedMotion.matches ? 0 : height;
  let stop = () => {};
  let closed = false;

  const paint = () => {
    panel.style.transform = `translate3d(0, ${y}px, 0)`;
    scrim.style.opacity = clamp(1 - y / height, 0, 1);
  };
  paint();

  const moveTo = (target, options, onEnd) => {
    stop();
    if (reducedMotion.matches) {
      y = target;
      paint();
      onEnd?.();
      return;
    }
    stop = spring({ from: y, to: target, ...options, onFrame: (x) => { y = x; paint(); }, onEnd });
  };

  const close = (velocity = 0) => {
    if (closed) return;
    closed = true;
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    scrim.style.pointerEvents = 'none';
    panel.style.pointerEvents = 'none';
    onClose?.();
    moveTo(height, { velocity, response: 0.3 }, () => {
      panel.remove();
      scrim.remove();
    });
  };

  moveTo(0, { response: 0.38 });

  scrim.addEventListener('click', () => close());
  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-sheet-close]')) close();
  });

  panel.addEventListener('pointerdown', (down) => {
    if (!down.isPrimary || !down.target.closest('[data-grab]') || down.target.closest('button, input') || closed) return;
    stop();
    const origin = y;
    const samples = [{ t: down.timeStamp, y: down.clientY }];
    panel.setPointerCapture(down.pointerId);

    const onMove = (event) => {
      samples.push({ t: event.timeStamp, y: event.clientY });
      if (samples.length > 6) samples.shift();
      const next = origin + event.clientY - down.clientY;
      y = next >= 0 ? next : -rubberband(-next, height);
      paint();
    };
    const finish = () => {
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerup', finish);
      panel.removeEventListener('pointercancel', finish);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
      if (y + project(velocity) > height * 0.5) close(velocity);
      else moveTo(0, { velocity, damping: 0.85, response: 0.34 });
    };
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerup', finish);
    panel.addEventListener('pointercancel', finish);
  });

  return { panel, close };
}

function shake(element) {
  if (reducedMotion.matches) return;
  element.animate(
    [0, -7, 6, -4, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 260, easing: 'ease-out' },
  );
}

const CC_LABELS = ['DS', 'TP', 'Oral', 'QCM', 'Projet'];

function openKeypad({ title, hint, initial = '', chips = false, initialChip = null, submit, onSubmit, onDelete }) {
  let text = initial;
  let chip = initialChip;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

  const { panel, close } = openSheet({
    label: title,
    onClose: () => document.removeEventListener('keydown', onKeydown),
    html: `
      <header class="sheet-head" data-grab>
        <button class="sheet-corner" data-sheet-close aria-label="Fermer">${icons.close}</button>
        <h2>${esc(title)}</h2>
        ${onDelete ? '<button class="link danger-text" data-delete>Supprimer</button>' : '<span class="sheet-corner"></span>'}
      </header>
      <output class="pad-display" data-grab><span data-value></span><small>/20</small></output>
      ${hint ? `<p class="pad-hint" data-grab>${hint}</p>` : ''}
      ${chips ? `<div class="chips" role="group" aria-label="Type de note">${CC_LABELS.map((c) => `<button class="chip" data-chip="${c}" aria-pressed="${c === chip}">${c}</button>`).join('')}</div>` : ''}
      <div class="pad" role="group" aria-label="Pavé numérique">
        ${keys.map((k) => `<button class="key" data-key="${k}" aria-label="${k === 'del' ? 'Effacer' : k === ',' ? 'Virgule' : k}">${k === 'del' ? icons.backspace : k}</button>`).join('')}
      </div>
      <button class="primary pad-submit" data-submit>${submit}</button>`,
  });

  const display = panel.querySelector('.pad-display');
  const valueEl = panel.querySelector('[data-value]');
  const submitBtn = panel.querySelector('[data-submit]');

  const paint = () => {
    valueEl.textContent = text || '–';
    display.classList.toggle('is-empty', text === '');
    submitBtn.disabled = parseGrade(text) === null;
  };
  paint();

  const press = (key) => {
    const next = typeGrade(text, key);
    if (next === text && key !== 'del') shake(display);
    text = next;
    paint();
  };
  const confirm = () => {
    const value = parseGrade(text);
    if (value === null) return;
    close();
    onSubmit(value, chip);
  };

  // La touche réagit dès le contact. Le « click » reste pour VoiceOver et le clavier.
  let handledByPointer = false;
  panel.querySelector('.pad').addEventListener('pointerdown', (event) => {
    const key = event.target.closest('[data-key]');
    if (!key) return;
    handledByPointer = true;
    press(key.dataset.key);
  });
  panel.querySelector('.pad').addEventListener('click', (event) => {
    const key = event.target.closest('[data-key]');
    if (!key) return;
    if (handledByPointer) handledByPointer = false;
    else press(key.dataset.key);
  });

  panel.querySelectorAll('[data-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      chip = chip === button.dataset.chip ? null : button.dataset.chip;
      panel.querySelectorAll('[data-chip]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.chip === chip));
    });
  });
  submitBtn.addEventListener('click', confirm);
  panel.querySelector('[data-delete]')?.addEventListener('click', () => {
    close();
    onDelete();
  });

  function onKeydown(event) {
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === ',' || event.key === '.') press(',');
    else if (event.key === 'Backspace') press('del');
    else if (event.key === 'Enter') confirm();
    else if (event.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);
}

function openConfirm({ title, text, action, onConfirm }) {
  const { panel, close } = openSheet({
    label: title,
    html: `
      <div class="confirm">
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <button class="primary is-danger" data-yes>${esc(action)}</button>
        <button class="secondary" data-sheet-close>Annuler</button>
      </div>`,
  });
  panel.querySelector('[data-yes]').addEventListener('click', () => {
    close();
    onConfirm();
  });
}

function parseCoef(text) {
  const value = Number(String(text).replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function openSubjectForm(subject) {
  const editing = Boolean(subject);
  let ccWeight = subject?.ccWeight ?? data.lastCcWeight;
  let added = 0;

  const { panel, close } = openSheet({
    tall: true,
    label: editing ? 'Modifier la matière' : 'Nouvelle matière',
    html: `
      <header class="form-head" data-grab>
        <button class="link" data-cancel>Annuler</button>
        <h2>${editing ? 'Modifier' : 'Nouvelle matière'}</h2>
        <button class="link is-strong" data-save>${editing ? 'OK' : 'Ajouter'}</button>
      </header>
      <div class="form-body">
        <label class="field">
          <span class="field-label">Nom</span>
          <input class="input" data-name type="text" maxlength="60" autocapitalize="sentences" autocomplete="off" enterkeyhint="${editing ? 'done' : 'next'}" placeholder="Ex. : Microéconomie" value="${esc(subject?.name ?? '')}">
        </label>
        <p class="form-added" data-added aria-live="polite"></p>
        <div class="field">
          <label class="field-label" for="coef-input">Coefficient</label>
          <div class="stepper">
            <button class="stepper-btn" data-step="-1" aria-label="Diminuer le coefficient">${icons.minus}</button>
            <input class="input stepper-input" id="coef-input" data-coef type="text" inputmode="decimal" autocomplete="off" value="${formatGrade(subject?.coef ?? 1)}">
            <button class="stepper-btn" data-step="1" aria-label="Augmenter le coefficient">${icons.plus}</button>
          </div>
        </div>
        <div class="field">
          <div class="split-labels">
            <span>Contrôle continu <b data-cc-label></b></span>
            <span>Partiel <b data-exam-label></b></span>
          </div>
          <div class="slider slider-split" style="--p:${ccWeight}">
            <input type="range" min="0" max="100" step="5" value="${ccWeight}" aria-label="Part du contrôle continu en pourcentage">
            <div class="slider-track"><div class="slider-fill"></div></div>
            <div class="slider-thumb"></div>
          </div>
        </div>
        ${editing ? '<button class="delete-line" data-delete>Supprimer la matière</button>' : ''}
      </div>`,
  });

  const nameInput = panel.querySelector('[data-name]');
  const coefInput = panel.querySelector('[data-coef]');
  const addedEl = panel.querySelector('[data-added]');
  const cancelBtn = panel.querySelector('[data-cancel]');

  const paintSplit = () => {
    panel.querySelector('[data-cc-label]').textContent = `${ccWeight} %`;
    panel.querySelector('[data-exam-label]').textContent = `${100 - ccWeight} %`;
  };
  paintSplit();
  bindSlider(panel.querySelector('.slider'), (value) => {
    ccWeight = value;
    paintSplit();
  });

  panel.querySelectorAll('[data-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = parseCoef(coefInput.value) ?? 1;
      coefInput.value = formatGrade(Math.max(0.5, current + Number(button.dataset.step)));
    });
  });

  // Rend vrai si la matière a été enregistrée.
  const store = () => {
    const name = nameInput.value.trim();
    if (!name) {
      shake(nameInput);
      nameInput.focus({ preventScroll: true });
      return false;
    }
    const coef = parseCoef(coefInput.value);
    if (coef === null) {
      shake(coefInput);
      return false;
    }
    if (editing) {
      Object.assign(subject, { name, coef, ccWeight });
    } else {
      activeSemester().subjects.push(newSubject({ name, coef, ccWeight }));
    }
    data.lastCcWeight = ccWeight;
    commit();
    return true;
  };

  panel.querySelector('[data-save]').addEventListener('click', () => {
    if (added > 0 && nameInput.value.trim() === '') close();
    else if (store()) close();
  });
  cancelBtn.addEventListener('click', () => close());

  // La touche « suivant » du clavier enchaîne les matières sans refermer la feuille.
  nameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (editing) {
      if (store()) close();
      return;
    }
    const name = nameInput.value.trim();
    if (!store()) return;
    added += 1;
    addedEl.textContent = `${name} ajoutée. Tape la suivante, ou touche Terminé.`;
    cancelBtn.textContent = 'Terminé';
    nameInput.value = '';
    coefInput.value = '1';
  });

  panel.querySelector('[data-delete]')?.addEventListener('click', () => {
    close();
    const snapshot = JSON.stringify(data);
    const semester = activeSemester();
    semester.subjects = semester.subjects.filter((s) => s !== subject);
    if (current.route.page === 'matiere') history.back();
    saveData();
    toast('Matière supprimée', () => restore(snapshot));
  });

  if (!editing) nameInput.focus({ preventScroll: true });
}

function openNameForm({ title, name, placeholder, onSave, onDelete }) {
  const { panel, close } = openSheet({
    tall: true,
    label: title,
    html: `
      <header class="form-head" data-grab>
        <button class="link" data-sheet-close>Annuler</button>
        <h2>${esc(title)}</h2>
        <button class="link is-strong" data-save>OK</button>
      </header>
      <div class="form-body">
        <label class="field">
          <span class="field-label">Nom</span>
          <input class="input" data-name type="text" maxlength="40" autocomplete="off" enterkeyhint="done" placeholder="${esc(placeholder)}" value="${esc(name)}">
        </label>
        ${onDelete ? '<button class="delete-line" data-delete>Supprimer ce semestre</button>' : ''}
      </div>`,
  });
  const input = panel.querySelector('[data-name]');
  const save_ = () => {
    const value = input.value.trim();
    if (!value) {
      shake(input);
      return;
    }
    close();
    onSave(value);
  };
  panel.querySelector('[data-save]').addEventListener('click', save_);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save_();
  });
  panel.querySelector('[data-delete]')?.addEventListener('click', () => {
    close();
    onDelete();
  });
  input.focus({ preventScroll: true });
}

function openSemesters() {
  const year = yearAverage(data.semesters);
  const { panel, close } = openSheet({
    label: 'Semestres',
    html: `
      <header class="sheet-head" data-grab>
        <span class="sheet-corner"></span>
        <h2>Semestres</h2>
        <button class="sheet-corner" data-sheet-close aria-label="Fermer">${icons.close}</button>
      </header>
      <ul class="menu">
        ${data.semesters.map((semester) => `
          <li class="menu-row">
            <button class="menu-pick" data-pick="${semester.id}" aria-current="${semester.id === data.activeSemesterId}">
              <span class="menu-check">${semester.id === data.activeSemesterId ? icons.check : ''}</span>
              <span class="row-title">${esc(semester.name)}</span>
              <span class="row-grade">${formatAverage(semesterStats(semester).average)}</span>
            </button>
            <button class="link" data-rename="${semester.id}">Modifier</button>
          </li>`).join('')}
      </ul>
      ${year === null ? '' : `<p class="menu-year"><span>Moyenne de l’année</span><span class="row-grade">${formatAverage(year)}</span></p>`}
      <button class="add-line" data-new>${icons.plus}Nouveau semestre</button>`,
  });

  panel.querySelectorAll('[data-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      data.activeSemesterId = button.dataset.pick;
      simulation.pinned = {};
      close();
      commit();
    });
  });

  panel.querySelector('[data-new]').addEventListener('click', () => {
    close();
    openNameForm({
      title: 'Nouveau semestre',
      name: `Semestre ${data.semesters.length + 1}`,
      placeholder: 'Ex. : Semestre 2',
      onSave: (name) => {
        const semester = newSemester(name);
        data.semesters.push(semester);
        data.activeSemesterId = semester.id;
        simulation.pinned = {};
        commit();
      },
    });
  });

  panel.querySelectorAll('[data-rename]').forEach((button) => {
    button.addEventListener('click', () => {
      const semester = data.semesters.find((s) => s.id === button.dataset.rename);
      close();
      openNameForm({
        title: 'Modifier le semestre',
        name: semester.name,
        placeholder: 'Ex. : Semestre 2',
        onSave: (name) => {
          semester.name = name;
          commit();
        },
        onDelete: data.semesters.length > 1 ? () => {
          const snapshot = JSON.stringify(data);
          data.semesters = data.semesters.filter((s) => s !== semester);
          if (data.activeSemesterId === semester.id) data.activeSemesterId = data.semesters[0].id;
          commit();
          toast('Semestre supprimé', () => restore(snapshot));
        } : undefined,
      });
    });
  });
}

function backupLabel() {
  if (!data.lastBackup) return 'Jamais faite';
  return `Dernière : ${new Date(data.lastBackup).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

async function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  // Un .txt passe partout sur iPhone : partage, Fichiers, AirDrop.
  const file = new File([JSON.stringify(data, null, 2)], `moyenne-sauvegarde-${stamp}.txt`, { type: 'text/plain' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (error.name === 'AbortError') return false;
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
  data.lastBackup = Date.now();
  saveData();
  return true;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importBackup(onRestored) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.json,text/plain,application/json';
  input.addEventListener('change', async () => {
    const [file] = input.files;
    if (!file) return;
    let imported;
    try {
      imported = normalize(JSON.parse(await file.text()));
    } catch {
      toast('Ce fichier n’est pas une sauvegarde Moyenne.');
      return;
    }
    const count = imported.semesters.length;
    openConfirm({
      title: 'Restaurer cette sauvegarde ?',
      text: `${count} semestre${count > 1 ? 's' : ''} dans ce fichier. Tes notes actuelles seront remplacées.`,
      action: 'Restaurer',
      onConfirm: () => {
        const snapshot = JSON.stringify(data);
        data = imported;
        simulation.pinned = {};
        commit();
        onRestored();
        toast('Sauvegarde restaurée', () => restore(snapshot));
      },
    });
  });
  input.click();
}

function openSettings() {
  const { panel, close } = openSheet({
    label: 'Réglages',
    html: `
      <header class="sheet-head" data-grab>
        <span class="sheet-corner"></span>
        <h2>Réglages</h2>
        <button class="sheet-corner" data-sheet-close aria-label="Fermer">${icons.close}</button>
      </header>
      <ul class="menu">
        <li><button class="menu-line" data-export><span class="row-title">Sauvegarder mes notes</span><span class="row-detail" data-backup-label>${backupLabel()}</span></button></li>
        <li><button class="menu-line" data-import><span class="row-title">Restaurer une sauvegarde</span></button></li>
        <li><button class="menu-line" data-wipe><span class="row-title danger-text">Tout effacer</span></button></li>
      </ul>
      <p class="sheet-note">Tes notes restent sur ce téléphone, rien n’est envoyé sur internet. Si tu supprimes l’appli, elles disparaissent : garde une sauvegarde.</p>`,
  });

  panel.querySelector('[data-export]').addEventListener('click', async () => {
    if (await exportBackup()) panel.querySelector('[data-backup-label]').textContent = backupLabel();
  });
  panel.querySelector('[data-import]').addEventListener('click', () => importBackup(close));
  panel.querySelector('[data-wipe]').addEventListener('click', () => {
    close();
    openConfirm({
      title: 'Tout effacer ?',
      text: 'Tous tes semestres, matières et notes seront supprimés.',
      action: 'Tout effacer',
      onConfirm: () => {
        const snapshot = JSON.stringify(data);
        const semester = newSemester('Semestre 1');
        data = { ...data, activeSemesterId: semester.id, semesters: [semester] };
        simulation.pinned = {};
        commit();
        toast('Tout est effacé', () => restore(snapshot));
      },
    });
  });
}

let toastTimer;
function toast(message, onUndo) {
  clearTimeout(toastTimer);
  toastRoot.innerHTML = `<div class="toast"><span>${esc(message)}</span>${onUndo ? '<button>Annuler</button>' : ''}</div>`;
  const pill = toastRoot.firstElementChild;
  const hide = () => {
    pill.classList.add('is-leaving');
    setTimeout(() => pill.remove(), 200);
  };
  pill.querySelector('button')?.addEventListener('click', () => {
    clearTimeout(toastTimer);
    onUndo();
    hide();
  });
  toastTimer = setTimeout(hide, onUndo ? 6000 : 3000);
}

/* ---------- Données et rendu ---------- */

function saveData() {
  if (!save(data)) toast('Impossible d’enregistrer sur ce téléphone.');
}

function commit() {
  saveData();
  refresh();
}

function restore(snapshot) {
  data = JSON.parse(snapshot);
  commit();
}

const seenValues = new Map();

function tween(element, from, to) {
  const finalText = element.textContent;
  const start = performance.now();
  const step = (now) => {
    if (!element.isConnected) return;
    const t = Math.min(1, (now - start) / 520);
    const eased = 1 - (1 - t) ** 4;
    element.textContent = t < 1 ? formatFixed(from + (to - from) * eased) : finalText;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Quand une valeur a changé depuis son dernier affichage, elle glisse de l'ancienne à la nouvelle.
function settle(root) {
  const animate = !reducedMotion.matches;
  const options = { duration: 520, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };

  root.querySelectorAll('[data-num]').forEach((element) => {
    const key = `num:${element.dataset.num}`;
    const to = Number(element.dataset.to);
    const from = seenValues.get(key);
    seenValues.set(key, to);
    if (animate && from !== undefined && Math.abs(from - to) > 0.004) tween(element, from, to);
  });

  root.querySelectorAll('[data-slide]:not([data-slide="sim"])').forEach((element) => {
    const key = `slide:${element.dataset.slide}`;
    const to = Number(element.dataset.to);
    const from = seenValues.get(key);
    seenValues.set(key, to);
    if (animate && from !== undefined && from !== to) {
      element.animate([{ transform: `translateX(${from}%)` }, { transform: `translateX(${to}%)` }], options);
    }
  });

  root.querySelectorAll('[data-band]').forEach((element) => {
    const key = `band:${element.dataset.band}`;
    const to = { left: Number(element.dataset.left), width: Number(element.dataset.width) };
    const from = seenValues.get(key);
    seenValues.set(key, to);
    if (animate && from && (from.left !== to.left || from.width !== to.width)) {
      element.animate([{ left: `${from.left}%`, width: `${from.width}%` }, { left: `${to.left}%`, width: `${to.width}%` }], options);
    }
  });
}

function afterRender(root, route) {
  settle(root);
  if (route.page === 'simulation') {
    root.querySelectorAll('.slider').forEach((slider) => {
      bindSlider(slider, (value) => {
        simulation.pinned[slider.dataset.id] = value;
        paintSimulation(root);
      });
    });
    paintSimulation(root);
  }
}

/* ---------- Navigation ---------- */

let depth = 0;
let current = null;
const scrollPositions = new Map();

function routeFromHash() {
  const [, page, id] = location.hash.split('/');
  if (page === 'matiere' && findSubject(id)) return { page, id };
  if (page === 'simulation') return { page };
  return { page: 'home' };
}

const routeKey = (route) => `${route.page}:${route.id ?? ''}`;

function renderRoute(route) {
  if (route.page === 'matiere') return viewSubject(route.id);
  if (route.page === 'simulation') return viewSimulation();
  return viewHome();
}

function show(route, transition = 'none') {
  const previous = current;
  if (previous) scrollPositions.set(routeKey(previous.route), previous.el.scrollTop);

  const el = document.createElement('main');
  el.className = 'view';
  el.innerHTML = renderRoute(route);
  if (transition === 'pop' && previous) stage.insertBefore(el, previous.el);
  else stage.append(el);
  if (transition !== 'push') el.scrollTop = scrollPositions.get(routeKey(route)) ?? 0;

  current = { el, route };
  afterRender(el, route);
  if (!previous) return;

  if (transition === 'none' || reducedMotion.matches) {
    previous.el.remove();
    return;
  }
  const options = { duration: 420, easing: EASE };
  const pushing = transition === 'push';
  const moving = pushing ? el : previous.el;
  const under = pushing ? previous.el : el;
  moving.classList.add('is-sliding');
  moving.animate(
    [{ transform: pushing ? 'translateX(100%)' : 'none' }, { transform: pushing ? 'none' : 'translateX(100%)' }],
    { ...options, fill: 'both' },
  ).finished.catch(() => {}).then(() => {
    moving.classList.remove('is-sliding');
    moving.getAnimations().forEach((animation) => animation.cancel());
    previous.el.remove();
  });
  under.animate(
    [{ transform: pushing ? 'none' : 'translateX(-28%)' }, { transform: pushing ? 'translateX(-28%)' : 'none' }],
    { ...options, fill: 'backwards' },
  );
}

function go(hash) {
  depth += 1;
  history.pushState({ depth }, '', hash);
  show(routeFromHash(), 'push');
}

function refresh() {
  if (!current) return;
  if (current.route.page === 'matiere' && !findSubject(current.route.id)) {
    current.route = { page: 'home' };
  }
  const top = current.el.scrollTop;
  current.el.innerHTML = renderRoute(current.route);
  current.el.scrollTop = top;
  afterRender(current.el, current.route);
  justAdded = null;
}

window.addEventListener('popstate', (event) => {
  const next = event.state?.depth ?? 0;
  const direction = next < depth ? 'pop' : 'push';
  depth = next;
  // Le geste de retour d'iOS anime déjà la page : on n'en rajoute pas.
  show(routeFromHash(), event.hasUAVisualTransition ? 'none' : direction);
});

/* ---------- Actions ---------- */

let justAdded = null;

function nextLabel(subject, chip) {
  if (!chip) return null;
  const same = subject.cc.filter((grade) => grade.label?.split(' ')[0] === chip).length;
  return same === 0 ? chip : `${chip} ${same + 1}`;
}

const actions = {
  back: () => history.back(),
  settings: openSettings,
  semesters: openSemesters,
  simulate: () => go('#/simulation'),
  'add-subject': () => openSubjectForm(),
  'open-subject': (target) => go(`#/matiere/${target.dataset.id}`),
  'edit-subject': (target) => openSubjectForm(findSubject(target.dataset.id)),

  target: (target) => {
    activeSemester().target = Number(target.dataset.value);
    commit();
  },

  'add-cc': (target) => {
    const subject = findSubject(target.dataset.id);
    openKeypad({
      title: `CC · ${subject.name}`,
      chips: true,
      submit: 'Ajouter la note',
      onSubmit: (value, chip) => {
        const grade = { id: uid(), value, label: nextLabel(subject, chip), date: Date.now() };
        subject.cc.push(grade);
        justAdded = grade.id;
        commit();
      },
    });
  },

  'edit-cc': (target) => {
    const subject = findSubject(current.route.id);
    const grade = subject.cc.find((g) => g.id === target.dataset.id);
    openKeypad({
      title: `CC · ${subject.name}`,
      initial: formatGrade(grade.value).replace(/\s/g, ''),
      chips: true,
      initialChip: grade.label?.split(' ')[0] ?? null,
      submit: 'Enregistrer',
      onSubmit: (value, chip) => {
        grade.value = value;
        if (chip !== (grade.label?.split(' ')[0] ?? null)) grade.label = nextLabel(subject, chip);
        commit();
      },
      onDelete: () => {
        const snapshot = JSON.stringify(data);
        subject.cc = subject.cc.filter((g) => g !== grade);
        commit();
        toast('Note supprimée', () => restore(snapshot));
      },
    });
  },

  'set-exam': (target) => {
    const subject = findSubject(target.dataset.id);
    const semester = activeSemester();
    const need = subject.exam === null ? examNeeded(subject, semester.target) : null;
    openKeypad({
      title: `Partiel · ${subject.name}`,
      hint: need?.status === 'possible' ? `Il te fallait ${formatFixed(need.need)} pour avoir ${semester.target}.` : '',
      initial: subject.exam === null ? '' : formatGrade(subject.exam),
      submit: subject.exam === null ? 'Ajouter la note' : 'Enregistrer',
      onSubmit: (value) => {
        subject.exam = value;
        commit();
      },
      onDelete: subject.exam === null ? undefined : () => {
        const snapshot = JSON.stringify(data);
        subject.exam = null;
        commit();
        toast('Note supprimée', () => restore(snapshot));
      },
    });
  },

  'sim-unpin': (target) => {
    delete simulation.pinned[target.dataset.id];
    paintSimulation(current.el);
  },

  'sim-reset': () => {
    simulation.pinned = {};
    paintSimulation(current.el);
  },

  'skip-install': () => {
    document.querySelector('.install')?.remove();
  },
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-act]');
  if (target) actions[target.dataset.act]?.(target, event);
});

// Sans cet écouteur, iOS n'applique pas l'état :active pendant l'appui.
document.addEventListener('touchstart', () => {}, { passive: true });

// iOS peut laisser la page décalée après la fermeture du clavier.
document.addEventListener('focusout', () => window.scrollTo(0, 0));

/* ---------- Démarrage ---------- */

const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function showInstallGuide() {
  const guide = document.createElement('section');
  guide.className = 'install';
  guide.innerHTML = `
    <img src="icons/apple-touch-icon.png" alt="" width="84" height="84">
    <h1>Installe Moyenne sur ton iPhone</h1>
    <p>C’est gratuit et ça prend dix secondes.</p>
    <ol>
      <li>Touche le bouton <b>Partager</b> de Safari, le carré avec une flèche. Il peut être dans le menu <b>•••</b>.</li>
      <li>Choisis <b>Sur l’écran d’accueil</b>. Si tu ne le vois pas, descends dans la liste ou touche <b>Plus</b>.</li>
      <li>Touche <b>Ajouter</b>, puis ouvre Moyenne depuis ton écran d’accueil.</li>
    </ol>
    <p class="install-warn">Rentre tes notes depuis l’icône. Ce que tu tapes ici, dans Safari, n’y apparaîtra pas.</p>
    <button class="link" data-act="skip-install">Continuer dans Safari</button>`;
  overlays.append(guide);
}

history.replaceState({ depth: 0 }, '', '#/');
show({ page: 'home' });
if (isIOS && !isInstalled) showInstallGuide();

navigator.storage?.persist?.();
// Pas de cache hors ligne pendant le développement, sinon les modifications ne s'affichent pas.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js');

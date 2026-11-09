// Tous les calculs de l'appli. Aucune dépendance au navigateur : testé avec `node --test`.

export const MAX_GRADE = 20;
export const TARGETS = [10, 12, 14, 16];
const EPS = 1e-9;

const sum = (values) => values.reduce((total, value) => total + value, 0);

export function mean(values) {
  return values.length ? sum(values) / values.length : null;
}

// Une moyenne s'arrondit vers le bas et une note à obtenir vers le haut :
// on n'affiche jamais « 10,00 » pour 9,996, ni une note requise qui laisserait juste en dessous.
export const floor2 = (x) => Math.floor((x + EPS) * 100) / 100;
export const ceil2 = (x) => Math.ceil((x - EPS) * 100) / 100;

const twoDecimals = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const upToTwoDecimals = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export const formatFixed = (x) => twoDecimals.format(x);
export const formatAverage = (x) => (x === null ? '–' : twoDecimals.format(floor2(x)));
export const formatGrade = (x) => upToTwoDecimals.format(x);

// Une matière se découpe en une part de contrôle continu et une part de partiel.
// « knownPoints » cumule ce qui est déjà noté, « missingShare » ce qu'il reste à noter (de 0 à 1).
export function subjectStats(subject) {
  const ccShare = subject.ccWeight / 100;
  const examShare = 1 - ccShare;
  const ccAverage = mean(subject.cc.map((grade) => grade.value));

  const ccPending = ccShare > 0 && ccAverage === null;
  const examPending = examShare > 0 && subject.exam === null;

  const knownPoints =
    (ccShare > 0 && ccAverage !== null ? ccShare * ccAverage : 0) +
    (examShare > 0 && subject.exam !== null ? examShare * subject.exam : 0);
  const missingShare = (ccPending ? ccShare : 0) + (examPending ? examShare : 0);
  const knownShare = 1 - missingShare;

  return {
    ccAverage,
    ccPending,
    examPending,
    knownPoints,
    missingShare,
    average: knownShare > EPS ? knownPoints / knownShare : null,
    isFinal: missingShare === 0,
  };
}

// Quelle note mettre sur tout ce qui manque pour atteindre l'objectif ?
export function solve({ total, known, missing }, target) {
  if (missing <= EPS) {
    const average = known / total;
    return { status: 'done', average, reached: average >= target - EPS };
  }
  const need = (target * total - known) / missing;
  if (need > MAX_GRADE + EPS) return { status: 'impossible', best: (known + MAX_GRADE * missing) / total };
  if (need <= EPS) return { status: 'secured', worst: known / total };
  return { status: 'possible', need: Math.min(ceil2(need), MAX_GRADE) };
}

// Sans CC pour l'instant, on compte la même note au CC et au partiel.
export function examNeeded(subject, target) {
  const { examPending, knownPoints, missingShare } = subjectStats(subject);
  if (!examPending) return null;
  return solve({ total: 1, known: knownPoints, missing: missingShare }, target);
}

// « pinned » associe à une matière une note simulée, appliquée à tout ce qu'il lui reste à noter.
export function semesterStats(semester, pinned = {}) {
  let total = 0;
  let known = 0;
  let missing = 0;
  let gradedCoef = 0;
  let gradedPoints = 0;
  let gradedCount = 0;
  let pendingExams = 0;
  let pendingCC = 0;
  const open = [];

  for (const subject of semester.subjects) {
    const stats = subjectStats(subject);
    total += subject.coef;
    known += subject.coef * stats.knownPoints;
    if (stats.examPending) pendingExams += 1;
    if (stats.ccPending) pendingCC += 1;
    if (stats.average !== null) {
      gradedCoef += subject.coef;
      gradedPoints += subject.coef * stats.average;
      gradedCount += 1;
    }
    if (stats.missingShare > 0) {
      const weight = subject.coef * stats.missingShare;
      open.push({ subject, stats, weight });
      if (subject.id in pinned) known += weight * pinned[subject.id];
      else missing += weight;
    }
  }

  return {
    total,
    known,
    missing,
    average: gradedCoef ? gradedPoints / gradedCoef : null,
    worst: total ? known / total : null,
    best: total ? (known + MAX_GRADE * missing) / total : null,
    gradedCount,
    subjectCount: semester.subjects.length,
    pendingExams,
    pendingCC,
    remaining: open
      .map(({ subject, stats, weight }) => ({ subject, stats, share: weight / total }))
      .sort((a, b) => b.share - a.share),
  };
}

export function yearAverage(semesters) {
  const averages = semesters.map((semester) => semesterStats(semester).average).filter((a) => a !== null);
  return averages.length >= 2 ? mean(averages) : null;
}

export function parseGrade(text) {
  if (text === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 && value <= MAX_GRADE ? value : null;
}

// Saisie au pavé numérique : renvoie le nouveau texte, ou le même si la touche est refusée.
export function typeGrade(text, key) {
  if (key === 'del') return text.slice(0, -1);
  if (key === ',') {
    if (text.includes(',')) return text;
    return text === '' ? '0,' : `${text},`;
  }
  const next = text === '0' ? key : text + key;
  const decimals = next.split(',')[1];
  if (decimals && decimals.length > 2) return text;
  return parseGrade(next) === null ? text : next;
}

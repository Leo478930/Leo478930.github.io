import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ceil2, examNeeded, floor2, formatAverage, formatGrade, parseGrade, semesterStats, solve, subjectStats, typeGrade, yearAverage,
} from '../calc.js';
import { load, normalize, save } from '../store.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
const cc = (...values) => values.map((value, i) => ({ id: `g${i}`, value, label: null, date: 1700000000000 }));
const subject = (id, coef, ccWeight, grades, exam) => ({ id, name: id, coef, ccWeight, cc: cc(...grades), exam });

const droit = () => subject('droit', 3, 40, [12, 14], null);
const eco = () => subject('eco', 2, 50, [8], 12);
const stats = () => subject('stats', 1, 0, [], null);
const semester = () => ({ subjects: [droit(), eco(), stats()] });

test('moyenne de matière : provisoire tant que le partiel manque', () => {
  const s = subjectStats(droit());
  assert.equal(s.ccAverage, 13);
  assert.equal(s.average, 13);
  assert.equal(s.isFinal, false);
  near(s.missingShare, 0.6);
});

test('moyenne de matière : CC et partiel pondérés une fois les deux notés', () => {
  const s = subjectStats(subject('m', 1, 40, [12, 14], 9));
  near(s.average, 10.6); // 0,4 × 13 + 0,6 × 9
  assert.equal(s.isFinal, true);
});

test('matière sans CC ou sans partiel', () => {
  const examOnly = subjectStats(subject('m', 1, 0, [], 11));
  assert.equal(examOnly.average, 11);
  assert.equal(examOnly.isFinal, true);

  const ccOnly = subjectStats(subject('m', 1, 100, [15], null));
  assert.equal(ccOnly.average, 15);
  assert.equal(ccOnly.isFinal, true);
  assert.equal(ccOnly.examPending, false);
});

test('partiel noté mais CC encore vide : la moyenne provisoire est celle du partiel', () => {
  const s = subjectStats(subject('m', 1, 40, [], 14));
  near(s.average, 14);
  assert.equal(s.ccPending, true);
  near(s.missingShare, 0.4);
});

test('note à avoir au partiel pour un objectif dans la matière', () => {
  assert.deepEqual(examNeeded(droit(), 10), { status: 'possible', need: 8 }); // (10 − 5,2) / 0,6
  assert.deepEqual(examNeeded(droit(), 12), { status: 'possible', need: 11.34 }); // 11,333… arrondi au-dessus
  assert.deepEqual(examNeeded(droit(), 16), { status: 'possible', need: 18 });
  const impossible = examNeeded(droit(), 18);
  assert.equal(impossible.status, 'impossible');
  near(impossible.best, 17.2);
});

test('note à avoir : déjà acquis, partiel déjà noté, CC encore vide', () => {
  assert.equal(examNeeded(subject('m', 1, 80, [18], null), 10).status, 'secured');
  assert.equal(examNeeded(subject('m', 1, 40, [12], 9), 10), null);
  assert.deepEqual(examNeeded(subject('m', 1, 40, [], null), 12), { status: 'possible', need: 12 });
});

test('semestre : moyenne actuelle sur les matières déjà notées', () => {
  const s = semesterStats(semester());
  near(s.average, 11.8); // (3 × 13 + 2 × 10) / 5
  assert.equal(s.gradedCount, 2);
  assert.equal(s.subjectCount, 3);
  assert.equal(s.pendingExams, 2);
  assert.equal(s.pendingCC, 0);
});

test('semestre : fourchette encore possible', () => {
  const s = semesterStats(semester());
  near(s.total, 6);
  near(s.known, 35.6);
  near(s.missing, 2.8);
  near(s.worst, 35.6 / 6);
  near(s.best, 91.6 / 6);
});

test('semestre : note à avoir partout pour valider, vérifiée à la main', () => {
  const s = semesterStats(semester());
  assert.deepEqual(solve(s, 10), { status: 'possible', need: 8.72 });

  const finalWith = (x) => (3 * (5.2 + 0.6 * x) + 2 * 10 + x) / 6;
  assert.ok(finalWith(8.72) >= 10);
  assert.ok(finalWith(8.71) < 10);
});

test('semestre : la compensation joue entre matières', () => {
  const sem = { subjects: [subject('a', 1, 0, [], 18), subject('b', 1, 0, [], 3)] };
  const result = solve(semesterStats(sem), 10);
  assert.equal(result.status, 'done');
  near(result.average, 10.5);
  assert.equal(result.reached, true);
});

test('simulation : une note fixée change ce qu\'il faut ailleurs', () => {
  const s = semesterStats(semester(), { stats: 6 });
  near(s.known, 41.6);
  near(s.missing, 1.8);
  assert.deepEqual(solve(s, 10), { status: 'possible', need: 10.23 }); // 18,4 / 1,8 = 10,22…
  assert.equal(s.remaining.length, 2);
});

test('simulation : tout fixé donne une moyenne finale', () => {
  const result = solve(semesterStats(semester(), { stats: 6, droit: 10 }), 10);
  assert.equal(result.status, 'done');
  near(result.average, 59.6 / 6);
  assert.equal(result.reached, false);
});

test('semestre : objectif déjà sûr ou hors de portée', () => {
  const secured = solve(semesterStats({ subjects: [subject('a', 9, 0, [], 20), subject('b', 1, 0, [], null)] }), 10);
  assert.equal(secured.status, 'secured');
  near(secured.worst, 18);

  const impossible = solve(semesterStats({ subjects: [subject('a', 9, 0, [], 2), subject('b', 1, 0, [], null)] }), 10);
  assert.equal(impossible.status, 'impossible');
  near(impossible.best, 3.8);
});

test('semestre : les matières restantes sont triées par poids', () => {
  const s = semesterStats(semester());
  assert.deepEqual(s.remaining.map((r) => r.subject.id), ['droit', 'stats']);
  near(s.remaining[0].share, 0.3); // 3 × 0,6 / 6
});

test('moyenne de l\'année : seulement avec au moins deux semestres notés', () => {
  const s1 = { subjects: [subject('a', 1, 0, [], 12)] };
  const s2 = { subjects: [subject('b', 1, 0, [], 9)] };
  const empty = { subjects: [] };
  near(yearAverage([s1, s2]), 10.5);
  assert.equal(yearAverage([s1, empty]), null);
});

test('arrondis : jamais d\'illusion de validation', () => {
  assert.equal(floor2(9.996), 9.99);
  assert.equal(floor2(12.35), 12.35);
  assert.equal(ceil2(8.000000000000002), 8);
  assert.equal(ceil2(11.3334), 11.34);
});

test('affichage français', () => {
  assert.equal(formatAverage(12.5), '12,50');
  assert.equal(formatAverage(9.996), '9,99');
  assert.equal(formatAverage(null), '–');
  assert.equal(formatGrade(14.5), '14,5');
  assert.equal(formatGrade(12), '12');
});

test('pavé numérique', () => {
  const typed = (...keys) => keys.reduce(typeGrade, '');
  assert.equal(typed('1', '4', ',', '5'), '14,5');
  assert.equal(typed('1', '5', '5'), '15'); // 155 refusé
  assert.equal(typed('2', '1'), '2'); // 21 refusé
  assert.equal(typed('2', '0', ',', '5'), '20,'); // 20,5 refusé
  assert.equal(typed('1', '4', ',', '2', '5', '1'), '14,25'); // 2 décimales max
  assert.equal(typed(','), '0,');
  assert.equal(typed('1', ',', ','), '1,');
  assert.equal(typed('0', '5'), '5');
  assert.equal(typed('1', '2', 'del'), '1');
  assert.equal(parseGrade('14,'), 14);
  assert.equal(parseGrade(''), null);
  assert.equal(parseGrade('20,5'), null);
});

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map };
};

test('sauvegarde : aller-retour fidèle', () => {
  const storage = fakeStorage();
  const data = load(storage);
  data.semesters[0].subjects.push(subject('a', 2.5, 30, [11.25], 9));
  assert.equal(save(data, storage), true);
  assert.deepEqual(load(storage), data);
});

test('sauvegarde : un fichier abîmé est refusé, des valeurs folles sont écartées', () => {
  assert.throws(() => normalize({}));
  assert.throws(() => normalize({ semesters: [] }));
  const clean = normalize({
    semesters: [{ name: 'S1', target: 99, subjects: [{ name: '<b>x</b>', coef: -1, ccWeight: 500, cc: [{ value: 42 }, { value: 12 }], exam: 'a' }] }],
  });
  const [s] = clean.semesters[0].subjects;
  assert.equal(clean.semesters[0].target, 10);
  assert.equal(s.coef, 1);
  assert.equal(s.ccWeight, 40);
  assert.deepEqual(s.cc.map((g) => g.value), [12]);
  assert.equal(s.exam, null);
});

test('stockage illisible : les données sont mises de côté, pas perdues', () => {
  const storage = fakeStorage({ 'moyenne.donnees.v1': '{cassé' });
  const data = load(storage);
  assert.equal(data.semesters.length, 1);
  assert.equal(storage.map.get('moyenne.donnees.v1.illisible'), '{cassé');
});

// Les données vivent uniquement sur le téléphone, dans le stockage du navigateur.
import { TARGETS, MAX_GRADE } from './calc.js';

const KEY = 'moyenne.donnees.v1';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const newSemester = (name) => ({ id: uid(), name, target: 10, subjects: [] });

export const newSubject = ({ name, coef, ccWeight }) => ({ id: uid(), name, coef, ccWeight, cc: [], exam: null });

export function emptyData() {
  const semester = newSemester('Semestre 1');
  return { version: 1, activeSemesterId: semester.id, semesters: [semester], lastCcWeight: 40, lastBackup: null };
}

const isGrade = (value) => typeof value === 'number' && value >= 0 && value <= MAX_GRADE;

function cleanSubject(raw) {
  const coef = Number(raw.coef);
  const ccWeight = Number(raw.ccWeight);
  return {
    id: String(raw.id || uid()),
    name: String(raw.name || 'Matière').slice(0, 60),
    coef: coef > 0 ? coef : 1,
    ccWeight: ccWeight >= 0 && ccWeight <= 100 ? ccWeight : 40,
    cc: (Array.isArray(raw.cc) ? raw.cc : [])
      .filter((grade) => isGrade(grade?.value))
      .map((grade) => ({
        id: String(grade.id || uid()),
        value: grade.value,
        label: grade.label ? String(grade.label).slice(0, 20) : null,
        date: Number(grade.date) || Date.now(),
      })),
    exam: isGrade(raw.exam) ? raw.exam : null,
  };
}

// Valide un fichier de sauvegarde ou le contenu du stockage. Lève une erreur si c'est inutilisable.
export function normalize(raw) {
  if (!raw || !Array.isArray(raw.semesters) || raw.semesters.length === 0) throw new Error('Données invalides');
  const semesters = raw.semesters.map((semester) => ({
    id: String(semester.id || uid()),
    name: String(semester.name || 'Semestre').slice(0, 40),
    target: TARGETS.includes(semester.target) ? semester.target : 10,
    subjects: (Array.isArray(semester.subjects) ? semester.subjects : []).map(cleanSubject),
  }));
  const active = semesters.some((semester) => semester.id === raw.activeSemesterId);
  return {
    version: 1,
    activeSemesterId: active ? raw.activeSemesterId : semesters[0].id,
    semesters,
    lastCcWeight: Number(raw.lastCcWeight) >= 0 && Number(raw.lastCcWeight) <= 100 ? Number(raw.lastCcWeight) : 40,
    lastBackup: Number(raw.lastBackup) || null,
  };
}

export function load(storage = localStorage) {
  const stored = storage.getItem(KEY);
  if (stored === null) return emptyData();
  try {
    return normalize(JSON.parse(stored));
  } catch {
    // On ne jette jamais des notes illisibles : elles restent de côté.
    storage.setItem(`${KEY}.illisible`, stored);
    return emptyData();
  }
}

export function save(data, storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

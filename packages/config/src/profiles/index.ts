export {
  applicableElements,
  blueprintFor,
  CHAPTER_BLUEPRINTS,
} from './blueprints.js';
export {
  CHECK_IDS,
  CHECK_LAYERS,
  CHECK_SEVERITIES,
  CHECKS,
  type CheckId,
  type CheckLayer,
  type CheckSeverity,
  type CheckSpec,
  isCheckId,
  UNIVERSAL_CHECKS,
} from './checks.js';
export {
  DEFAULT_DISCIPLINE_ID,
  DISCIPLINE_PROFILES,
  disciplineProfile,
  suggestDiscipline,
} from './disciplines.js';
export { LANGUAGES, type LanguageSetting, languageSetting, latinScript } from './languages.js';
export { PITFALL_SEED, type PitfallSeed } from './pitfalls.js';
export {
  type BlueprintElement,
  type ChapterBlueprint,
  type DisciplineProfile,
  type EntityType,
  PARADIGM_LABELS,
  PARADIGMS,
  type Paradigm,
  type SpellingVariant,
  type TerminologyRule,
  type UniversityProfile,
} from './types.js';
export {
  DEFAULT_UNIVERSITY_ID,
  SPELLING_PAIRS,
  UNIVERSITY_PROFILES,
  universityProfile,
} from './universities.js';

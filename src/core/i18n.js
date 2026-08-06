// THE GAME'S LANGUAGES (2026-08-06 ruling: "add a languages section in the
// settings so people who speak spanish, french, english, etc can play my game
// just fine").
//
// One table, one lookup, one authority. Rules that keep this honest as the
// string count grows:
//
//   * ENGLISH IS THE KEY SET. Every other locale is a partial overlay, and a
//     missing entry falls through to English rather than showing a raw key or
//     an empty label. A half-translated build is playable; a build showing
//     "settings.audio.title" is not.
//   * NOTHING IS TRANSLATED BY GUESSING AT RUNTIME. If a string is not in the
//     table it is English, and `coverage()` says so out loud, so "we support
//     Spanish" can be measured instead of asserted.
//   * PLACEHOLDERS are {named} and substituted after lookup, so word order can
//     differ per language - which is the whole reason a translation table
//     exists rather than string concatenation.

export const LOCALES = Object.freeze([
  { id: 'en', label: 'English', endonym: 'English' },
  { id: 'es', label: 'Spanish', endonym: 'Español' },
  { id: 'fr', label: 'French', endonym: 'Français' },
]);

export const DEFAULT_LOCALE = 'en';

// The English key set. Add a key here first; the overlays below are optional.
const EN = Object.freeze({
  'settings.title': 'Settings',
  'settings.tab.audio': 'Audio',
  'settings.tab.camera': 'Camera',
  'settings.tab.display': 'Display',
  'settings.tab.controls': 'Controls',
  'settings.tab.language': 'Language',
  'settings.tab.accessibility': 'Accessibility',
  'settings.tab.developer': 'Developer',

  'settings.audio.title': 'Audio',
  'settings.audio.intro': 'Each category is mixed through one audio graph.',
  'settings.audio.mute': 'Mute all audio',
  'settings.audio.mute.detail': 'Silences everything without changing the category levels.',
  'settings.audio.master': 'Master volume',
  'settings.audio.master.detail': 'Overall game volume.',

  'settings.camera.title': 'Camera',
  'settings.camera.intro': 'Changes apply straight away and survive every mode change.',
  'settings.camera.sensitivity': 'Mouse sensitivity',
  'settings.camera.invert': 'Invert vertical look',
  'settings.camera.fov': 'Field of view',
  'settings.camera.bob': 'View bob',

  'settings.display.title': 'Display',
  'settings.display.intro': 'These change real renderer features.',
  'settings.display.quality': 'Quality preset',
  'settings.display.shadows': 'Shadows',
  'settings.display.bloom': 'Bloom',
  'settings.display.ao': 'Ambient occlusion',
  'settings.display.uiScale': 'Interface scale',
  'settings.display.fullscreen': 'Fullscreen',

  'settings.controls.title': 'Controls',
  'settings.controls.intro': 'Click a key, then press the one you want. Every prompt follows it straight away.',
  'settings.controls.reset': 'Reset to defaults',
  'settings.controls.press': 'Press a key',

  'settings.language.title': 'Language',
  'settings.language.intro': 'Changes the language of everything you read in the game.',
  'settings.language.select': 'Language',
  'settings.language.select.detail': 'Anything not yet translated stays in English.',
  'settings.language.coverage': 'Translated so far: {done} of {total} lines.',

  'settings.accessibility.title': 'Accessibility',
  'settings.accessibility.intro': 'Important state is shown with words and shapes, never colour alone.',
  'settings.accessibility.reducedMotion': 'Reduced motion',
  'settings.accessibility.highContrast': 'High contrast',
  'settings.accessibility.toolActivation': 'Tool activation',

  'common.on': 'On',
  'common.off': 'Off',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.cancel': 'Cancel',

  'menu.continue': 'Continue',
  'menu.newGame': 'New game',
  'menu.settings': 'Settings',
  'menu.quit': 'Quit',

  'prompt.read': 'read',
  'prompt.carry': 'carry',
  'prompt.setDown': 'set down',
  'prompt.interact': 'interact',
  'prompt.clubRegister': 'Club register',

  'book.previousPage': 'previous page',
  'book.nextPage': 'next page',
  'book.close': 'close the book',
});

const ES = Object.freeze({
  'settings.title': 'Ajustes',
  'settings.tab.audio': 'Sonido',
  'settings.tab.camera': 'Cámara',
  'settings.tab.display': 'Pantalla',
  'settings.tab.controls': 'Controles',
  'settings.tab.language': 'Idioma',
  'settings.tab.accessibility': 'Accesibilidad',
  'settings.tab.developer': 'Desarrollo',

  'settings.audio.title': 'Sonido',
  'settings.audio.intro': 'Cada categoría se mezcla en un solo gráfico de audio.',
  'settings.audio.mute': 'Silenciar todo',
  'settings.audio.mute.detail': 'Silencia todo sin cambiar los niveles de cada categoría.',
  'settings.audio.master': 'Volumen general',
  'settings.audio.master.detail': 'Volumen general del juego.',

  'settings.camera.title': 'Cámara',
  'settings.camera.intro': 'Los cambios se aplican al momento y se mantienen al cambiar de modo.',
  'settings.camera.sensitivity': 'Sensibilidad del ratón',
  'settings.camera.invert': 'Invertir la vista vertical',
  'settings.camera.fov': 'Campo de visión',
  'settings.camera.bob': 'Balanceo de la vista',

  'settings.display.title': 'Pantalla',
  'settings.display.intro': 'Estos cambian funciones reales del renderizador.',
  'settings.display.quality': 'Ajuste de calidad',
  'settings.display.shadows': 'Sombras',
  'settings.display.bloom': 'Resplandor',
  'settings.display.ao': 'Oclusión ambiental',
  'settings.display.uiScale': 'Tamaño de la interfaz',
  'settings.display.fullscreen': 'Pantalla completa',

  'settings.controls.title': 'Controles',
  'settings.controls.intro': 'Haz clic en una tecla y pulsa la que quieras. Los avisos la siguen al momento.',
  'settings.controls.reset': 'Restablecer',
  'settings.controls.press': 'Pulsa una tecla',

  'settings.language.title': 'Idioma',
  'settings.language.intro': 'Cambia el idioma de todo lo que leas en el juego.',
  'settings.language.select': 'Idioma',
  'settings.language.select.detail': 'Lo que aún no está traducido se queda en inglés.',
  'settings.language.coverage': 'Traducido hasta ahora: {done} de {total} líneas.',

  'settings.accessibility.title': 'Accesibilidad',
  'settings.accessibility.intro': 'Lo importante se muestra con palabras y formas, nunca solo con color.',
  'settings.accessibility.reducedMotion': 'Menos movimiento',
  'settings.accessibility.highContrast': 'Alto contraste',
  'settings.accessibility.toolActivation': 'Uso de herramientas',

  'common.on': 'Sí',
  'common.off': 'No',
  'common.close': 'Cerrar',
  'common.back': 'Atrás',
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',

  'menu.continue': 'Continuar',
  'menu.newGame': 'Partida nueva',
  'menu.settings': 'Ajustes',
  'menu.quit': 'Salir',

  'prompt.read': 'leer',
  'prompt.carry': 'llevar',
  'prompt.setDown': 'dejar',
  'prompt.interact': 'usar',
  'prompt.clubRegister': 'Registro del club',

  'book.previousPage': 'página anterior',
  'book.nextPage': 'página siguiente',
  'book.close': 'cerrar el libro',
});

const FR = Object.freeze({
  'settings.title': 'Réglages',
  'settings.tab.audio': 'Audio',
  'settings.tab.camera': 'Caméra',
  'settings.tab.display': 'Affichage',
  'settings.tab.controls': 'Commandes',
  'settings.tab.language': 'Langue',
  'settings.tab.accessibility': 'Accessibilité',
  'settings.tab.developer': 'Développement',

  'settings.audio.title': 'Audio',
  'settings.audio.intro': 'Chaque catégorie passe par un seul graphe audio.',
  'settings.audio.mute': 'Tout couper',
  'settings.audio.mute.detail': 'Coupe le son sans toucher aux niveaux de chaque catégorie.',
  'settings.audio.master': 'Volume général',
  'settings.audio.master.detail': 'Volume général du jeu.',

  'settings.camera.title': 'Caméra',
  'settings.camera.intro': 'Les changements sont immédiats et se conservent entre les modes.',
  'settings.camera.sensitivity': 'Sensibilité de la souris',
  'settings.camera.invert': 'Inverser la vue verticale',
  'settings.camera.fov': 'Champ de vision',
  'settings.camera.bob': 'Balancement de la vue',

  'settings.display.title': 'Affichage',
  'settings.display.intro': 'Ces réglages touchent de vraies fonctions du moteur.',
  'settings.display.quality': 'Niveau de qualité',
  'settings.display.shadows': 'Ombres',
  'settings.display.bloom': 'Halo lumineux',
  'settings.display.ao': 'Occlusion ambiante',
  'settings.display.uiScale': "Taille de l'interface",
  'settings.display.fullscreen': 'Plein écran',

  'settings.controls.title': 'Commandes',
  'settings.controls.intro': 'Cliquez sur une touche puis appuyez sur celle que vous voulez. Les indications suivent aussitôt.',
  'settings.controls.reset': 'Rétablir',
  'settings.controls.press': 'Appuyez sur une touche',

  'settings.language.title': 'Langue',
  'settings.language.intro': 'Change la langue de tout ce que vous lisez dans le jeu.',
  'settings.language.select': 'Langue',
  'settings.language.select.detail': "Ce qui n'est pas encore traduit reste en anglais.",
  'settings.language.coverage': 'Traduit à ce jour : {done} lignes sur {total}.',

  'settings.accessibility.title': 'Accessibilité',
  'settings.accessibility.intro': "L'essentiel est montré par des mots et des formes, jamais par la couleur seule.",
  'settings.accessibility.reducedMotion': 'Moins de mouvement',
  'settings.accessibility.highContrast': 'Contraste élevé',
  'settings.accessibility.toolActivation': 'Usage des outils',

  'common.on': 'Oui',
  'common.off': 'Non',
  'common.close': 'Fermer',
  'common.back': 'Retour',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',

  'menu.continue': 'Continuer',
  'menu.newGame': 'Nouvelle partie',
  'menu.settings': 'Réglages',
  'menu.quit': 'Quitter',

  'prompt.read': 'lire',
  'prompt.carry': 'porter',
  'prompt.setDown': 'poser',
  'prompt.interact': 'utiliser',
  'prompt.clubRegister': 'Registre du club',

  'book.previousPage': 'page précédente',
  'book.nextPage': 'page suivante',
  'book.close': 'fermer le livre',
});

const TABLES = Object.freeze({ en: EN, es: ES, fr: FR });

let current = DEFAULT_LOCALE;
const listeners = new Set();

export function isLocale(id) {
  return Object.prototype.hasOwnProperty.call(TABLES, id);
}

export function locale() {
  return current;
}

/** Switch language. Returns the locale actually in force. */
export function setLocale(id) {
  const next = isLocale(id) ? id : DEFAULT_LOCALE;
  if (next === current) return current;
  current = next;
  for (const fn of listeners) {
    try { fn(current); } catch { /* one bad listener must not strand the rest */ }
  }
  return current;
}

/** Re-render hook: called with the new locale whenever it changes. */
export function onLocaleChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Look a line up. Missing entries fall through to English, then to the key
 * itself, so nothing the player sees is ever blank.
 */
export function t(key, values = null) {
  const table = TABLES[current] || EN;
  let text = table[key];
  if (text === undefined) text = EN[key];
  if (text === undefined) return key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
  ));
}

/** How much of the English key set a locale actually covers. Honest, measurable. */
export function coverage(id = current) {
  const table = TABLES[id] || EN;
  const total = Object.keys(EN).length;
  const done = Object.keys(EN).filter((key) => table[key] !== undefined).length;
  return { locale: id, done, total, fraction: total ? done / total : 1 };
}

/** Every key English defines, for tests that check a locale is not drifting. */
export function englishKeys() {
  return Object.keys(EN);
}

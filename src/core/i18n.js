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

// E3 — THE TOP TEN LANGUAGES ON STEAM, in Steam's own order by share of users
// (Simplified Chinese, English, Russian, Spanish, Portuguese-Brazil, German,
// Japanese, Korean, French, Turkish). Each carries its endonym, because a
// player looking for their own language scans for the word they call it by.
//
// LISTING A LANGUAGE IS NOT TRANSLATING IT. `coverage()` reports what fraction
// of the key set each one actually has, and the settings screen prints that
// beside the name — an untranslated entry says so instead of silently falling
// back to English and looking broken.
export const LOCALES = Object.freeze([
  { id: 'en', label: 'English', endonym: 'English' },
  { id: 'zh-Hans', label: 'Simplified Chinese', endonym: '简体中文' },
  { id: 'ru', label: 'Russian', endonym: 'Русский' },
  { id: 'es', label: 'Spanish', endonym: 'Español' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', endonym: 'Português do Brasil' },
  { id: 'de', label: 'German', endonym: 'Deutsch' },
  { id: 'ja', label: 'Japanese', endonym: '日本語' },
  { id: 'ko', label: 'Korean', endonym: '한국어' },
  { id: 'fr', label: 'French', endonym: 'Français' },
  { id: 'tr', label: 'Turkish', endonym: 'Türkçe' },
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

  // G5 - the settings screen's own copy, moved off literals so a player who
  // comes here to CHANGE THE LANGUAGE is not reading English while they do
  // it. Guarded by tests/settings-panel-localised.test.js.
  'settings.display.windowMode': 'Window mode',
  'settings.display.windowMode.detail': 'Fullscreen uses the active display. Windowed mode supports explicit sizes.',
  'settings.display.qualityRow': 'Graphics quality',
  'settings.display.quality.detail': 'Sets render scale, ambient occlusion, bloom, and shadows together.',
  'settings.display.shadowDetail': 'Shadow detail',
  'settings.display.reading': 'Reading display…',
  'settings.controls.resetRow': 'Reset controls',
  'settings.controls.reset.detail': 'Every verb returns to its shipped key.',
  'settings.tutorials.title': 'Contextual tutorials',
  'settings.tutorials.detail': 'Progress is saved with the current game. Reset re-enables every first-use lesson.',
  'settings.tutorials.reset': 'Reset tutorials',
  'settings.tutorials.disable': 'Disable guidance',
  'settings.developer.intro': 'Not player-facing. Visible because this is a development session.',
  'settings.developer.room': 'Clubhouse room',
  'settings.developer.save': 'Save and reload',
  'settings.reset.button': 'Reset to defaults',
  'settings.reset.detail': 'Audio, camera, display, controls, language and accessibility - all of it.',
  'settings.reset.done': 'Settings are back to their defaults.',
  'settings.error.save': 'This setting works for this session, but it could not be saved. Check that the game can write to local storage.',
  'settings.error.windowMode': 'Window mode could not be changed. Try again after returning to the main menu.',
  'settings.error.resolution': 'That window size is not available on this display.',
  'settings.error.room': 'The room choice could not be saved. Check that the game can write to local storage.',
  'settings.display.resolution': 'Window resolution',
  'settings.display.resolution.detail': 'Available while windowed; the game UI remains responsive.',
  'settings.display.shadowDetail.detail': 'How big the shadow map is and how often it is redrawn. The single biggest cost in the shop.',
  'settings.developer.room.detail': 'Which clubhouse the next load builds. Saved, so plain dev runs keep returning to it.',
  'settings.developer.apply': 'Apply',
  'settings.developer.apply.detail': 'Saves the choice and reloads - the floor plan resolves once, at load, so nothing changes until then.',

  'settings.audio.title': 'Audio',
  'settings.audio.intro': 'Each category is mixed through one audio graph.',
  'settings.audio.mute': 'Mute all audio',
  'settings.audio.mute.detail': 'Silences everything without changing the category levels.',
  'settings.audio.master': 'Master volume',
  'settings.audio.master.detail': 'How loud everything is.',
  'settings.audio.effects': 'Effects',
  'settings.audio.effects.detail': 'Tools, doors, products, the till, footsteps.',
  'settings.audio.ambience': 'Ambience',
  'settings.audio.ambience.detail': 'Weather, the course outside, the room itself.',
  'settings.audio.ui': 'Menus',
  'settings.audio.ui.detail': 'Clicks, confirmations, warnings.',
  'settings.audio.mute.on': 'Muted',
  'settings.audio.mute.off': 'Sound on',

  'settings.camera.title': 'Camera',
  'settings.camera.intro': 'Changes apply straight away and survive every mode change.',
  'settings.camera.sensitivity': 'Mouse sensitivity',
  'settings.camera.sensitivity.detail': 'How fast you turn.',
  'settings.camera.invert': 'Invert looking up and down',
  'settings.camera.invert.detail': 'Push the mouse forward to look down.',
  'settings.camera.invert.on': 'Inverted',
  'settings.camera.invert.off': 'Normal',
  'settings.camera.fov': 'Field of view',
  'settings.camera.fov.detail': 'How wide the view is. The laptop uses its own.',
  'settings.camera.bob': 'View bob',
  'settings.camera.bob.detail': 'A little movement as you walk. Reduced motion turns this off anyway.',
  'settings.camera.bob.on': 'On',
  'settings.camera.bob.off': 'Off',

  'settings.display.renderScale': 'Render scale',
  'settings.display.renderScale.detail': 'How sharp the 3D is. Menus stay sharp either way.',
  'settings.display.ao.detail': 'Soft shading where things meet.',
  'settings.display.bloom.detail': 'A gentle glow on bright lights.',
  'settings.display.shadows.detail': 'Real shadows under everything.',
  'settings.display.uiScale.detail': 'Makes menus, prompts and the laptop bigger or smaller.',

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
  'settings.accessibility.reducedMotion.detail': 'Stops menu animation, view bob and tool sway.',
  'settings.accessibility.highContrast': 'High contrast',
  'settings.accessibility.highContrast.detail': 'Stronger edges on panels, prompts and focus.',
  'settings.accessibility.toolActivation': 'Using a tool',
  'settings.accessibility.toolActivation.detail': 'Hold the button to work, or press once to start and again to stop.',
  'settings.accessibility.toolActivation.hold': 'Hold the button',
  'settings.accessibility.toolActivation.toggle': 'Press to start and stop',

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
  'settings.audio.master.detail': 'Lo alto que suena todo.',
  'settings.audio.effects': 'Efectos',
  'settings.audio.effects.detail': 'Herramientas, puertas, productos, la caja, los pasos.',
  'settings.audio.ambience': 'Ambiente',
  'settings.audio.ambience.detail': 'El tiempo, el campo de fuera, la sala en sí.',
  'settings.audio.ui': 'Menús',
  'settings.audio.ui.detail': 'Clics, confirmaciones, avisos.',
  'settings.audio.mute.on': 'Silenciado',
  'settings.audio.mute.off': 'Con sonido',

  'settings.camera.sensitivity.detail': 'Lo rápido que giras.',
  'settings.camera.invert.detail': 'Empuja el ratón hacia delante para mirar abajo.',
  'settings.camera.invert.on': 'Invertido',
  'settings.camera.invert.off': 'Normal',
  'settings.camera.fov.detail': 'Lo ancha que es la vista. El portátil usa la suya.',
  'settings.camera.bob.detail': 'Un poco de movimiento al andar. Menos movimiento lo desactiva igualmente.',
  'settings.camera.bob.on': 'Sí',
  'settings.camera.bob.off': 'No',

  'settings.display.renderScale': 'Resolución del 3D',
  'settings.display.renderScale.detail': 'Lo nítido que se ve el 3D. Los menús se ven igual de bien.',
  'settings.display.ao.detail': 'Sombra suave donde las cosas se tocan.',
  'settings.display.bloom.detail': 'Un brillo suave en las luces.',
  'settings.display.shadows.detail': 'Sombras reales bajo todo.',
  'settings.display.uiScale.detail': 'Agranda o reduce menús, avisos y el portátil.',

  'settings.accessibility.reducedMotion.detail': 'Quita la animación de los menús, el balanceo y el vaivén de la herramienta.',
  'settings.accessibility.highContrast.detail': 'Bordes más marcados en paneles, avisos y el foco.',
  'settings.accessibility.toolActivation.detail': 'Mantén el botón para trabajar, o pulsa una vez para empezar y otra para parar.',
  'settings.accessibility.toolActivation.hold': 'Mantener el botón',
  'settings.accessibility.toolActivation.toggle': 'Pulsar para empezar y parar',

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
  'settings.audio.master.detail': 'Le volume de tout.',
  'settings.audio.effects': 'Effets',
  'settings.audio.effects.detail': 'Outils, portes, produits, la caisse, les pas.',
  'settings.audio.ambience': 'Ambiance',
  'settings.audio.ambience.detail': 'La météo, le parcours dehors, la salle elle-même.',
  'settings.audio.ui': 'Menus',
  'settings.audio.ui.detail': 'Clics, confirmations, alertes.',
  'settings.audio.mute.on': 'Coupé',
  'settings.audio.mute.off': 'Son actif',

  'settings.camera.sensitivity.detail': 'La vitesse à laquelle vous tournez.',
  'settings.camera.invert.detail': 'Poussez la souris en avant pour regarder en bas.',
  'settings.camera.invert.on': 'Inversé',
  'settings.camera.invert.off': 'Normal',
  'settings.camera.fov.detail': "La largeur de la vue. L'ordinateur portable a la sienne.",
  'settings.camera.bob.detail': 'Un léger mouvement en marchant. Le mode moins de mouvement le coupe de toute façon.',
  'settings.camera.bob.on': 'Oui',
  'settings.camera.bob.off': 'Non',

  'settings.display.renderScale': 'Résolution de la 3D',
  'settings.display.renderScale.detail': 'La netteté de la 3D. Les menus restent nets.',
  'settings.display.ao.detail': 'Une ombre douce là où les objets se touchent.',
  'settings.display.bloom.detail': 'Une lueur douce sur les lumières.',
  'settings.display.shadows.detail': 'De vraies ombres sous tout.',
  'settings.display.uiScale.detail': "Agrandit ou réduit les menus, les indications et l'ordinateur portable.",

  'settings.accessibility.reducedMotion.detail': "Coupe l'animation des menus, le balancement de la vue et celui des outils.",
  'settings.accessibility.highContrast.detail': 'Des bords plus nets sur les panneaux, les indications et le focus.',
  'settings.accessibility.toolActivation.detail': 'Maintenez le bouton pour travailler, ou appuyez une fois pour commencer et une fois pour arrêter.',
  'settings.accessibility.toolActivation.hold': 'Maintenir le bouton',
  'settings.accessibility.toolActivation.toggle': 'Appuyer pour commencer et arrêter',

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

// E3: the seven new entries have EMPTY tables, so every one of their keys falls
// through to English. Empty and REGISTERED, not absent: `isLocale` gates what a
// saved preference may hold, so an unregistered id would be silently rewritten
// to English on load and the player's choice would not stick. Registered, the
// choice persists, every line falls through, `coverage()` reports 0, and the
// settings screen prints "not translated yet" beside the name.
//
// A language listed as untranslated is a promise the player can check. A
// language listed as available that quietly draws English is a lie.
const EMPTY = Object.freeze({});
const TABLES = Object.freeze({
  en: EN,
  es: ES,
  fr: FR,
  'zh-Hans': EMPTY,
  ru: EMPTY,
  'pt-BR': EMPTY,
  de: EMPTY,
  ja: EMPTY,
  ko: EMPTY,
  tr: EMPTY,
});

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

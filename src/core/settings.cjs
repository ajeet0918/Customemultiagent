const DEFAULT_SETTINGS = Object.freeze({ theme: 'system', chatFontSize: 14, codeFontSize: 13, interfaceScale: 100, fontFamily: 'system', sendShortcut: 'enter', startScreen: 'chat', reducedMotion: false });
function normalizeSettings(input = {}) {
  const choose = (key, values) => values.includes(input[key]) ? input[key] : DEFAULT_SETTINGS[key];
  return { theme: choose('theme', ['system','light','dark']), chatFontSize: choose('chatFontSize',[12,14,16,18,20,22]), codeFontSize: choose('codeFontSize',[11,12,13,14,16,18,20]), interfaceScale: choose('interfaceScale',[90,100,110,125]), fontFamily: choose('fontFamily',['system','serif','mono']), sendShortcut: choose('sendShortcut',['enter','mod-enter']), startScreen: choose('startScreen',['chat','workspace']), reducedMotion: input.reducedMotion === true };
}
module.exports = { DEFAULT_SETTINGS, normalizeSettings };

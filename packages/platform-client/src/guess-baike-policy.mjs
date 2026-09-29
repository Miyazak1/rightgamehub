export const MIN_WIKIPEDIA_INTRO_HAN = 180;

const hanPattern = /[\u3400-\u9fff]/u;
const guessablePattern = /[\u3400-\u9fffA-Za-z0-9]/u;
const visiblePunctuation = new Set(Array.from('，。！？；：、,.!?;:\'"“”‘’（）()[]【】《》〈〉「」『』—–…·-'));
const whitespacePattern = /\s/u;

export function isVisibleGuessPunctuation(character = '') {
  return character !== '' && (visiblePunctuation.has(character) || whitespacePattern.test(character));
}

export function shouldMaskGuessCharacter(character = '') {
  return character !== '' && !isVisibleGuessPunctuation(character);
}

export function normalizeGuessCharacter(character = '') {
  return guessablePattern.test(character) ? character.toLocaleLowerCase('en-US') : null;
}

export function uniqueGuessCharacters(value = '') {
  return [...new Set(Array.from(value, normalizeGuessCharacter).filter(Boolean))];
}

export function countGuessOccurrences(value = '', characters = []) {
  const keys = new Set(Array.from(characters, normalizeGuessCharacter).filter(Boolean));
  return Array.from(value).filter(character => keys.has(normalizeGuessCharacter(character))).length;
}

export function isGuessTitleSolved(title = '', guessed = []) {
  const titleCharacters = uniqueGuessCharacters(title);
  const guessedCharacters = new Set(Array.from(guessed, normalizeGuessCharacter).filter(Boolean));
  return titleCharacters.length > 0 && titleCharacters.every(character => guessedCharacters.has(character));
}

export function countHan(value = '') {
  return Array.from(value).filter(character => hanPattern.test(character)).length;
}

export function normalizeWikipediaIntro(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function evaluateWikipediaIntro(value, minimumHan = MIN_WIKIPEDIA_INTRO_HAN) {
  const content = normalizeWikipediaIntro(value);
  const hanCount = countHan(content);
  return {
    content,
    hanCount,
    eligible: hanCount >= minimumHan,
    reason: hanCount >= minimumHan ? null : `导言只有 ${hanCount} 个汉字，低于 ${minimumHan} 字门槛`,
  };
}


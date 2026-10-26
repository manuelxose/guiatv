// EPG feeds send filler as programme descriptions ("sin descripción.", "Programación Alacantí TV.") and prefix
// some with their genre list ("(Documental,Otros) …"). Shown on indexable pages, both read as broken content.
const PLACEHOLDER = /^(?:sin descripci[oó]n|programaci[oó]n [^.]{1,40})\.?$/i;
// Letters, spaces and commas only, starting with a capital: "(25)" or "(voz en off)" stay.
const GENRE_PREFIX = /^\(\p{Lu}[\p{L} ]*(?:,\s*\p{L}[\p{L} ]*)*\)\s*/u;

export function cleanEpgDescription(description: string | undefined | null): string | undefined {
  const text = String(description ?? '').trim().replace(GENRE_PREFIX, '');
  return text && !PLACEHOLDER.test(text) ? text : undefined;
}

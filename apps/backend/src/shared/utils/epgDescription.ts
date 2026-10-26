// EPG feeds send filler as programme descriptions ("sin descripción.", "Programación Alacantí TV.") and prefix
// some with their genre list ("(Documental,Otros) …"). Shown on indexable pages, both read as broken content.
// Display only: stored descriptions stay raw because category inference reads the genre prefix.
const PLACEHOLDER = /^(?:sin descripci[oó]n|programaci[oó]n \p{Lu}[^.:]{0,40}\bTV)\.?$/iu;
// A genre list has a comma or starts with a genre word: "(Estreno)", "(VOS)", "(25)", "(Des)montando" stay.
const GENRE_PREFIX =
  /^\((?:(?:Cine|Series?|Documental|Pel[ií]culas|Programa|Cortometrajes)\b[\p{L} ]*|\p{Lu}[\p{L} ]*(?:,\s*\p{L}[\p{L} ]*)+)\)\s*/u;

export function cleanEpgDescription(description: string | undefined | null): string | undefined {
  const text = String(description ?? '').trim().replace(GENRE_PREFIX, '');
  return text && !PLACEHOLDER.test(text) ? text : undefined;
}

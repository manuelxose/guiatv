/**
 * Shared personalization-answer contract used by every surface that edits
 * assistant/profile preferences: the chatbot's ChatProfilePanel, Mi GuíaTV's
 * assistant-preferences surface, and ChatbotService's save routing. Moved out
 * of the chat-profile-panel component folder so it can be a genuine shared
 * facade instead of a component-owned type imported sideways by services and
 * other feature areas.
 */
export type PreferencePersistenceTarget = 'profile' | 'memory';

export type PreferenceQuestionKey =
  | 'preferredPlatforms'
  | 'likedGenres'
  | 'preferredViewingContexts'
  | 'preferredDurations'
  | 'favoriteFranchisesOrTitles'
  | 'preferredAutonomousCommunity'
  | 'negativeSignals';

export interface PreferenceOption {
  value: string;
  label: string;
}

export interface PreferenceQuestion {
  key: PreferenceQuestionKey;
  title: string;
  description: string;
  kind: 'multi' | 'single' | 'text-list';
  target: PreferencePersistenceTarget;
  field?: string;
  options: PreferenceOption[];
  optional?: boolean;
}

export interface PreferenceAnswer {
  key: PreferenceQuestionKey;
  target: PreferencePersistenceTarget;
  field?: string;
  values: string[];
  community?: string | null;
}

/** The personalization questions, shared by the chatbot panel and the profile so both edit the same fields with the same options. */
export const PREFERENCE_QUESTIONS: PreferenceQuestion[] = [
  {
    key: 'preferredPlatforms', target: 'profile', field: 'preferredPlatforms', kind: 'multi',
    title: '¿Qué plataformas utilizas?', description: 'Selecciona todas las que tengas para priorizar contenido que realmente puedas ver.',
    options: ['Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'Movistar+', 'SkyShowtime', 'Apple TV+', 'Filmin', 'RTVE Play', 'ATRESplayer', 'Mitele', 'Pluto TV'].map((value) => ({ value, label: value })),
  },
  {
    key: 'likedGenres', target: 'profile', field: 'likedGenres', kind: 'multi',
    title: '¿Qué géneros te interesan?', description: 'Elige varios; podrás cambiarlos cuando quieras sin afectar a tu conversación.',
    options: [
      ['Cine', 'Cine y películas'], ['Series', 'Series'], ['Documental', 'Documentales'], ['Deportes', 'Deportes'],
      ['Infantil', 'Infantil'], ['Entretenimiento', 'Entretenimiento'], ['Informativos', 'Actualidad'], ['Cultura', 'Cultura'],
      ['Musica', 'Música'], ['Lifestyle', 'Lifestyle'], ['Motor', 'Motor'],
    ].map(([value, label]) => ({ value, label })),
  },
  {
    key: 'preferredViewingContexts', target: 'memory', field: 'preferredViewingContexts', kind: 'multi',
    title: '¿Con quién sueles verlo?', description: 'Así ajustaré el tono y el tipo de recomendación a cada plan.',
    options: ['Solo', 'En pareja', 'En familia', 'Con amigos'].map((value) => ({ value, label: value })), optional: true,
  },
  {
    key: 'preferredDurations', target: 'memory', field: 'preferredDurations', kind: 'multi',
    title: '¿Qué duración prefieres?', description: 'Puedes combinar opciones para no limitar demasiado las recomendaciones.',
    options: [
      { value: 'corto', label: 'Menos de 60 min' },
      { value: 'episodio', label: 'Episodios de 30–45 min' },
      { value: 'largo', label: 'Más de 60 min' },
    ], optional: true,
  },
  {
    key: 'favoriteFranchisesOrTitles', target: 'memory', field: 'favoriteFranchisesOrTitles', kind: 'text-list',
    title: '¿Qué títulos te representan?', description: 'Añade películas, series o sagas que sirvan como referencia.', options: [], optional: true,
  },
  {
    key: 'preferredAutonomousCommunity', target: 'memory', kind: 'single',
    title: '¿Quieres canales autonómicos?', description: 'Selecciona tu comunidad para incluirlos cuando sean relevantes.',
    options: ['Andalucía', 'Aragón', 'Asturias', 'Baleares', 'Canarias', 'Cantabria', 'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Comunidad Valenciana', 'Extremadura', 'Galicia', 'La Rioja', 'Madrid', 'Murcia', 'Navarra', 'País Vasco'].map((value) => ({ value, label: value })), optional: true,
  },
  {
    key: 'negativeSignals', target: 'memory', field: 'negativeSignals', kind: 'multi',
    title: '¿Qué prefieres evitar?', description: 'Lo usaré como filtro secundario, nunca como una consulta nueva.',
    options: ['Terror', 'Deportes', 'Realities', 'Contenido infantil'].map((value) => ({ value, label: value })), optional: true,
  },
];

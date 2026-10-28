// M11-F: changes whenever public editorial content changes, so the SSR can drop only its rendered guide pages
// (it polls /v2/health). Process-local: a restart is a new epoch, which only costs one extra re-render.
const boot = Date.now().toString(36);
let counter = 0;

export const editorialEpoch = (): string => `${boot}-${counter}`;
export const bumpEditorialEpoch = (): void => {
  counter++;
};

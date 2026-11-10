# Prompt para continuar la unificación de la interfaz (Guía TV)

Copia todo lo que hay debajo de la línea en un chat nuevo.

---

Seguimos con la unificación de la interfaz de Guía TV (Angular 20, `apps/frontend`). Trabajamos sección por sección, en español, con el dev server del usuario en `http://localhost:3000`. **Todas las secciones están ya en la estructura compartida, Fútbol incluido.** Pendiente: pasar los tests y ajustar specs (entre otros `sports-v2/shell/app-shell.spec.ts` y `sports-v2/pages/navigation-flows.spec.ts`, que aún esperan la cabecera y la barra inferior propias de Fútbol), el cuerpo de la rama nueva de `EntityDetailComponent` (estilo antiguo), borrar `pages/unified-guide` (ninguna ruta lo usa) y desplegar los arreglos de backend del catálogo.

## Objetivo y reglas del usuario
- Toda la app tiene la estructura de 3 paneles de Fútbol: menú izquierdo de 264 px (72 px plegado), centro, panel derecho de 360 px desde 1200 px (por debajo, cajón con botón ✕), cabecera de 64 px y 8 px de separación. Solo cambian los menús y el contenido.
- Orientado a **SEO y tráfico**: H1 con las palabras que se buscan, migas de pan, filtros como **enlaces** (`<a>` con query params, nunca botones), JSON-LD y preguntas frecuentes con datos del día.
- El **panel derecho** tiene que ser útil de verdad en cada sección y terminar con las preguntas rápidas al asistente.
- El **asistente es central**:
  - Botón "✦ Asistente" en la cabecera, que abre y cierra el chat.
  - En móvil, botón central de la barra inferior.
  - En escritorio, el chat se encaja sobre la columna derecha.
- **Dos temas, claro y oscuro**, y un **color por sección**: Inicio y Qué ver verde, TV rosa, Plataformas azul, Fútbol lima, Guías violeta. El logo y la pestaña activa cambian de color.
- **Tests al final de todo**: no lanzarlos salvo que se pida. Al final, ajustar specs (por ejemplo `channel-catalog.component.spec.ts`).
- Nunca inventar URLs en los enlaces: comprobar que la ruta existe.

## Piezas compartidas (reutilizar siempre)
- `components/panel-shell/` es la estructura de 3 paneles:
  - Huecos: `[panelSide]`, el contenido por defecto y `[panelContext]`. Recibe `[(contextOpen)]`.
  - Lleva cabecera y footer. Añade la clase `body.has-panel-shell`.
  - Usa los tokens `--sv2-*` de `sports-v2/styles/_tokens.scss`, con paleta clara y oscura.
- `components/panel-nav/`: menú izquierdo. `links` y `groups`; los enlaces de grupo con `active` se dibujan como opción de filtro.
- `components/panel-tile/`: tarjeta. Variante `tv` (16:9, pill "En directo", progreso) y variante `poster` (2:3, con `[affiliate]` para el botón de afiliado).
- `components/unified-top-nav/`: la única cabecera. Logo, pestañas de sección (Inicio, TV, Qué ver, Plataformas, Fútbol, Guías), buscador centrado, Asistente, tema, notificaciones y cuenta.
  - Pone `html[data-section]` según la ruta.
  - Huecos: `utnLead`, `utnSearch`, `utnActions`. Entradas: `showAssistant`, `brandSuffix`.
- `components/footer/`: footer SEO con 6 columnas. En móvil va en acordeón; los enlaces siempre están en el HTML.
- `components/auth-layout/` y `_auth-form.scss`: inicio de sesión y registro.
- `config/tv-section-nav.ts` (`TV_SECTION_LINKS`): menú de TV con Parrilla, Guía de canales, Series en TV y Películas en TV.
- `config/portal-navigation.config.ts`:
  - `PORTAL_MOBILE_MENU`: el menú móvil completo.
  - Barra inferior: Inicio, TV, Asistente, Fútbol y Menú.
  - `resolvePortalPrimaryDestination` decide la sección; series y películas cuentan como TV.
- `styles/design-tokens.scss`:
  - `--section-accent` (relleno), `--section-accent-ink` (texto sobre el relleno) y `--section-accent-text` (el acento como texto), según `data-section` y el tema.
  - `--unified-top-nav-h` es 4rem.
- `services/chat.service.ts`: `requestToggleAssistant()` abre o cierra el asistente. `app.component` encaja el chat (estilos con `:host-context(body.has-panel-shell)`).
- Logos de canal: siempre sobre fondo oscuro `#12151a`, porque muchos son blancos.

## Hecho (referencia de estilo)
- **Inicio** (`pages/home`):
  - Título con la fecha, caja de pregunta al asistente y secciones por demanda de búsqueda en cuadrículas de 4.
  - Preguntas frecuentes dinámicas, y JSON-LD con WebSite, ItemList y FAQ.
  - Panel derecho "Ahora en TV" con pestañas Ahora, Esta noche y Fútbol.
  - En `app.routes.ts`, el título de la ruta es igual al meta title; si no, lo pisa.
- **Parrilla** (`pages/tv-guide` + `components/epg-grid`):
  - Filtros como enlaces y panel derecho "Programa seleccionado".
  - Títulos pegajosos en los bloques: `overflow: clip` en la celda y `position: sticky` + `align-self: flex-start` en el texto.
- **Guía de canales** (`pages/channel-catalog`):
  - `?grupo=` y `?acceso=` como enlaces, sin buscador propio.
  - Tarjetas con Ahora y Después, y panel derecho "A continuación".
- **Películas y Series en TV** (`pages/content-page`):
  - Solo emisiones de TV, sacadas de `TvDataFacade` con categoría `Cine` o `Series`.
  - `?vista=hoy|ahora|noche|manana` y `?grupo=tdt`.
  - Emisiones duplicadas entre canales repetidos agrupadas por título + hora; 48 tarjetas y botón "Ver más".
- **Página de canal** (`pages/canal-completo`, `/canales/:id`):
  - `?dia=manana|pasado` y `?genero=<slug>` como enlaces; el día recarga, el género solo filtra. Sin título de ruta.
  - Menú izquierdo con grupos TDT, Autonómicos y Pago sacados del directorio (`getTvReadChannels`, filtrado con `filterChannelDirectory`).
  - Contenido rico (el usuario pidió más contenido para SEO): datos del canal en chips, "Qué echan ahora" con `panel-tile`, parrilla con miniatura y descripción, "Esta noche" y "Películas y series" con `panel-tile`, bloque "Sobre el canal" con enlaces internos, tarjetas de otros canales con lo que echan ahora, FAQ ampliada y JSON-LD (BreadcrumbList, TelevisionChannel, ItemList).
  - **Regla para las siguientes secciones:** nada de páginas escuetas; secciones con H2 + enlace "… ›", tarjetas con imagen y texto propio, como en la maqueta.
  - Panel derecho: ficha (Ahora con progreso, Ver ficha, botones de interacción), Después, Dónde verlo (solo datos confirmados del registro, sin diales) y afiliados del canal.
  - Se ha quitado la tarjeta grande "Ahora en emisión" (`unified-program-card` con CTA de afiliado por programa).
- **Ficha de programa, película y serie** (`pages/catalog-detail`, plantilla y estilos ya en `.html`/`.scss`):
  - Sirve `/contenido/:catalogId`, las rutas antiguas y el respaldo de `/peliculas|series|programas/:slug` (`EntityDetailComponent` cae en ella mientras la lectura pública de entidades está desactivada). Todas con `layout: 'portal-page'`.
  - Hero con fondo, póster, metadatos, géneros y botón «Ver hoy 10:35 en LA 1»; sinopsis; saltos a secciones; próximas emisiones; dónde ver; reparto en cuadrícula; «También en el canal»; similares con `panel-tile`; «Sobre…»; FAQ propia dentro del mismo JSON-LD (un spec exige un solo script).
  - Panel derecho: tarjeta con póster y botón principal, «Dónde verlo en TV», ficha clave/valor, compartir y asistente.
  - `resolvePortalPrimaryDestination`: `/contenido/program:…` y `/programas/` cuentan como TV; películas y series siguen en «Qué ver» (pero aún usan el menú de TV hasta que exista el de Qué ver).
  - La rama nueva de `EntityDetailComponent` solo se ha envuelto en `app-panel-shell`; su cuerpo sigue con el estilo antiguo.
- **Qué ver** (`pages/que-ver`, `/programacion-tv/que-ver-hoy`; `unified-guide` sigue sirviendo `/plataformas` y `/comparador-streaming`):
  - Filtros combinables, todos enlaces dentro de la página: `?types=movie|series|program`, `?cuando=ahora|noche|manana` (hoy por defecto), `?donde=tv|abierto|streaming|gratis`, `?platforms=<nombre>`, `?q=`, `?page=`. `link()` limpia combinaciones imposibles (plataforma quita «esta noche» y «programas», TV en abierto quita la plataforma…). Se siguen leyendo los antiguos `?availability=free|live|streaming`.
  - Resultados en dos bloques: «En TV» (`getLivePrograms`/`getTonightPrograms`/`getAllPrograms` según cuándo, `group: 'tdt'` para abierto/gratis, categoría Cine/Series; «Programas» = ni cine ni series) con «Ver más», y «En streaming» (`discoverContent`, `limit: 24`: con 48 la API devuelve 8) con paginación por enlaces.
  - Plataformas del filtro: solo las que devuelven títulos (Netflix, Prime Video, Disney+, HBO Max, Movistar+, SkyShowtime, Apple TV+, Filmin). RTVE Play, ATRESplayer, Mitele y Pluto TV no devuelven nada.
  - Menú izquierdo compartido en `config/que-ver-nav.ts` (`QUE_VER_LINKS`): vistas de la página + Tendencias + Para ti; ya no saca a la sección TV.
  - **Tendencias** (`pages/stats`, `/tendencias`) y **Para ti** (`pages/for-you`, `/para-ti`) integradas en el shell con ese menú; reutilizan `que-ver.component.scss`. Para ti fija `noindex` desde la página (nadie lee `data.robots` de la ruta). `resolvePortalPrimaryDestination` pone `/para-ti` en Qué ver.
  - Arreglos de datos: `TvDataFacade` compara plataformas normalizadas con alias (`platformKey`: «Apple TV+» = «Apple TV», «Movistar Plus+ Ficción Total» = «Movistar+») y con filtro de plataforma no cuela emisiones de TV. **Backend (sin desplegar)**: alias `rtve`/`movistar plus+…` en `CATALOG_PLATFORM_NAME_MAP`, `matchesPlatforms` por clave de plataforma y paginación del catálogo (la página N de TMDB ya no se vuelve a cortar; antes la página 2 salía vacía).
  - **Ojo:** sin backend local en :4000 el dev server usa la API de producción, así que los cambios de backend no se ven en local hasta desplegar.
- **Plataformas** (`pages/plataformas`, `/plataformas`) y **Comparador** (`pages/streaming-comparison`, `/comparador-streaming`), con el menú `config/plataformas-nav.ts` (`PLATAFORMAS_LINKS`, `STREAMING_PLATFORMS`). `pages/unified-guide` ya no lo usa ninguna ruta.
  - Filtros enlace con los params de siempre: `?platform=<nombre>`, `?type=movie|series`, `?sort=recent` (solo con plataforma: sin ella la API da títulos sin estrenar), `?availability=free` (solo sin plataforma: con ella saldrían títulos gratis en otro sitio), `?page=`. «Mejor valorado» quitado (la API da títulos raros).
  - Precios y prestaciones de la API de ofertas del comparador (`MonetizationService.getOffers`, `provider.id` = clave del registro); el plan más barato es el «Desde».
  - Portada: tarjetas por plataforma (precio, para qué es mejor, catálogo y ranking), lo más visto en Netflix/Prime Video/Disney+/HBO Max, gratis, tabla de precios, «Cómo elegir» y FAQ. Con plataforma: datos en chips, catálogo con paginación, alternativas, «Sobre…» y FAQ con su precio y prueba; panel derecho con todos sus planes y botón de salida (`placement: 'provider-summary'`). Sin botón de afiliado por título cuando hay plataforma (sugería otra plataforma).
  - Comparador: filtros como enlaces (`?prioridad=`, `?prestaciones=`, `?orden=`), selección de hasta 3 ofertas igual que antes, panel derecho «Tu comparación».
- **Guías** (`blog/pages/*`: hub `/guias`, categoría `/guias/categoria/:slug`, rankings `/guias/rankings`, artículo `/guias/:slug`), menú `config/guias-nav.ts` (`GUIAS_LINKS` + `guiasCategoryGroups()` con las categorías reales de `EditorialService.getCategories()`; «Temas» y «Por plataforma»). Las cuatro reutilizan `que-ver.component.scss` + `blog-home.component.scss` (bloques `.lead`, `.g-num`, `.post__cat`, `.art`); el artículo conserva `post-detail.component.scss` para el texto. Sin título de ruta en `guias`.
  - Hub: destacada, «Sigue leyendo», últimas, rankings numerados, un bloque por categoría, tendencias, lo más visto en streaming (antes «series mejor valoradas» con el orden basura) y la TV en abierto de esta noche (antes salía «en directo» de canales menores). FAQ + CollectionPage/ItemList. Panel derecho: portada con su índice y plataformas mencionadas, temas con recuento.
  - Categoría: mantiene 404 real y `noindex` con menos de 3 guías; las categorías de plataforma (`GUIAS_PLATFORM_CATEGORIES`) añaden lo más visto de esa plataforma y enlaces a Plataformas/Qué ver.
  - Menú como la maqueta (`GUIAS_SECTIONS`/`GUIAS_LINKS`): Destacadas, Streaming, Fútbol, TV y legislación (categoría `television`), Comparativas, Lo mejor del mes (rankings); «Por plataforma» con las 8 plataformas; «Más temas» con Plataformas, Tecnología y cualquier categoría nueva de la API. Las secciones sin guías aún (Comparativas, SkyShowtime, Apple TV+, Filmin) se pintan como «Muy pronto» (200, `noindex, follow`) con últimas guías y, si es plataforma, su catálogo; un slug desconocido sigue siendo 404.
  - Color de Guías: violeta (`#a685ff` relleno, `#6b3fd4` texto claro, `#c4adff` texto oscuro), también en `--accent-editorial` y en la maqueta; el gris parecía desactivado.
  - Enlaces `#ancla`: con `<base href="/">` un `href="#x"` llevaba a la portada (pasaba en «Todas las guías», el índice del artículo y el «Saltar al contenido» del shell). Ahora son `routerLink` + `fragment`, y `panel-shell` hace el scroll (el contenido se desplaza dentro de `.main`, no en la ventana): espera a que aparezca el destino y llama a `scrollIntoView` sin animación (la suave no avanza en el panel del navegador). El hub tiene la lista completa en `#todas`.
  - Rankings: el filtro por plataforma es enlace (`?categoria=netflix`) en vez de botón; con plataforma, su catálogo. Artículo: índice en el panel derecho, plataformas mencionadas → `/plataformas?platform=`, sin las «%» inventadas de tendencias.
- **Artículo de guía** (`blog/pages/post-detail`) rediseñado para leer: columna centrada de 46rem, cabecera con antetítulo (tipo, categoría, minutos), titular grande, entradilla, firma con avatar; índice «En este artículo» generado de los H2/H3 (`withHeadingIds`, con spec) en línea y en el panel derecho; barra de progreso de lectura; final con autor, compartir y «Más de…»; «Sigue leyendo» cae a las últimas guías si no hay relacionadas.
  - El texto lo pinta `.post-content` en `styles.scss` (global: los estilos de componente no llegan a `innerHTML`): 17-18 px, interlineado 1.75, H2 con filete, listas con viñeta (el preflight de Tailwind las quitaba), citas, tablas en tarjeta con cabecera tintada y cebra; en móvil la tabla se desplaza.
  - El sanitizador de Angular quita los `id` del HTML inyectado: se ponen en el navegador tras pintar (`applyHeadingIds`, con reintentos). La barra de progreso escucha `scroll` en captura en `document` (el `<main>` del shell puede cambiar con la hidratación) y usa un signal (con `markForCheck` no repintaba).
- **Fútbol** (`sports-v2/shell/app-shell`): ya no tiene marco propio; monta `app-panel-shell` con layout `portal-page` (en `app.routes.ts` y en `SHELL` de `sports-v2.routes.ts`), así que lleva la cabecera común (sin «Sports», con Asistente), la barra inferior de la app y el chat.
  - `panel-shell` tiene dos opciones nuevas: `searchTemplate` (buscador propio en la cabecera; va como plantilla porque los huecos no se pueden reproyectar a la cabecera) y `contextHidden` (sin columna derecha, para el partido a pantalla completa). Nuevo hueco `[panelAfterFooter]`.
  - Buscador de fútbol sacado a `shell/search-box.ts` (se borró `top-navigation.ts`); el menú «Mi fútbol» (`sidebar-navigation`) va en `[panelSide]` y el Match Center en `[panelContext]` (sin su propio botón de cerrar: lo pone el cajón). En móvil, el menú es una fila de chips como en el resto; el tracker queda pegado abajo dentro del contenido.
  - «Noticias» (menú, «Más noticias», tarjetas) lleva al blog: `/guias/categoria/futbol` y `/guias/<slug>` (`FOOTBALL_NEWS_PATH`, `NavItem.path`, `canonicalPath` de cada noticia).
  - Quitado el aviso fijo «Última actualización… proveedor de datos» (solo queda el de error al refrescar). La atribución de OpenLigaDB / footballdata.io / Football-Data.org es obligatoria por licencia (ODbL 4.3 y condiciones del proveedor): ya no es una barra aparte, va con la letra pequeña bajo el footer, sin cambiar el texto.
- **Footer**: «Diseñado por Tecnoria» con enlace a https://tecnoriasl.com/ en la línea legal (sale en todas las páginas).
- **Chatbot**: cabecera con el logo de sección, pantalla de bienvenida con lo que sabe hacer y colores de sección. He quitado la barra "Recomendaciones" del móvil y los botones flotantes.
- **Inicio de sesión y registro**: rehechos con `auth-layout`.
- **Maqueta de referencia**: `docs/design/unified-shell.html`. Servir con la config `design-mockups` de `.claude/launch.json` y abrir `http://localhost:8765/unified-shell.html#canal`; la vista "canal" es la referencia de la página que toca ahora.

## Avisos prácticos
- **Plantillas desactualizadas:** el dev server (Vite) a veces deja una plantilla o un SCSS sin refrescar. Hacer `touch` de los `.html`/`.scss` cambiados y recargar. Si el navegador cachea un chunk, forzar `fetch(url, {cache:'reload'})`.
- **Heredocs:** en el Bash de esta máquina fallan con comillas mezcladas. Usar la herramienta Write/Edit o scripts de Python escritos con Write.
- **Compilar:** `npx ng build --configuration development` (desde `apps/frontend`) detecta errores de plantilla; `tsc` no.
- **Canonical:** `MetaService` quita los query params de la canonical, así que las variantes con filtros cuentan para Google como la página base.
- **Datos:** el proveedor manda canales duplicados (feeds alias) con emisiones mal asignadas. Conviene limpiarlo en la importación.
- **Fútbol:** usa `minimal-shell` y ahí no se dibuja el chat (`showAssistant=false`). Tiene su propia barra inferior; queda pendiente unificarlo.
- **Rama:** no hay nada commiteado de este trabajo y estamos en `fix/football-data-org-backfill-retry`. Antes de commitear, preguntar al usuario la rama o el PR.

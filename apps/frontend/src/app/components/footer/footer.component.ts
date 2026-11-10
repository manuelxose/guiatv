import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_PATHS } from '../../config/route-map';
import { ConsentService } from '../../services/analytics/consent.service';
import { ViewportService } from '../../services/viewport.service';

interface FooterLink {
  label: string;
  path: string;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const FOOTBALL = APP_PATHS.football;
const channel = (label: string, slug: string): FooterLink => ({ label, path: `${APP_PATHS.channels}/${slug}` });
const guide = (label: string, slug: string): FooterLink => ({ label, path: `${APP_PATHS.blog}/${slug}` });

/**
 * Site-wide footer. Every link is a real, crawlable URL that is always in the DOM:
 * on mobile the columns collapse into <details>, which hides but does not remove them.
 */
@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent {
  readonly consent = inject(ConsentService);
  readonly viewport = inject(ViewportService);
  readonly currentYear = new Date().getFullYear();
  readonly homePath = APP_PATHS.home;

  readonly columns: FooterColumn[] = [
    {
      title: 'Programación TV',
      links: [
        { label: 'TV en directo', path: APP_PATHS.guide },
        { label: 'Qué ver hoy', path: APP_PATHS.explore },
        { label: 'Películas en TV', path: APP_PATHS.movies },
        { label: 'Series en TV', path: APP_PATHS.series },
        { label: 'Guía de canales', path: '/programacion-tv/guia-canales' },
      ],
    },
    {
      title: 'Canales',
      links: [
        channel('LA 1', 'la-1'),
        channel('La 2', 'la-2'),
        channel('Antena 3', 'antena-3'),
        channel('Cuatro', 'cuatro'),
        channel('Telecinco', 'telecinco'),
        channel('laSexta', 'la-sexta'),
        channel('Neox', 'neox'),
        channel('Clan', 'clan'),
        channel('24 Horas', '24-horas'),
        { label: 'Todos los canales', path: APP_PATHS.channels },
      ],
    },
    {
      title: 'Fútbol',
      links: [
        { label: 'Partidos de hoy', path: FOOTBALL },
        { label: 'En directo', path: `${FOOTBALL}/en-directo` },
        { label: 'Resultados', path: `${FOOTBALL}/resultados` },
        { label: 'Clasificaciones', path: `${FOOTBALL}/clasificaciones` },
        { label: 'LaLiga', path: `${FOOTBALL}/competiciones/laliga` },
        { label: 'Premier League', path: `${FOOTBALL}/competiciones/premier-league` },
        { label: 'Champions League', path: `${FOOTBALL}/competiciones/champions-league` },
      ],
    },
    {
      title: 'Plataformas',
      links: [
        { label: 'Plataformas de streaming', path: APP_PATHS.platforms },
        { label: 'Comparador', path: APP_PATHS.streamingComparison },
        guide('Precios del streaming', 'precios-plataformas-streaming-espana'),
        guide('Lo mejor de Netflix', 'mejores-series-y-peliculas-netflix-espana'),
        guide('Lo mejor de HBO Max', 'mejores-series-y-peliculas-hbo-max-espana'),
        guide('Lo mejor de Disney+', 'mejores-series-y-peliculas-disney-plus-espana'),
        guide('Lo mejor de Prime Video', 'mejores-series-y-peliculas-prime-video-espana'),
      ],
    },
    {
      title: 'Explorar',
      links: [
        { label: 'Guías', path: APP_PATHS.blog },
        { label: 'Rankings', path: APP_PATHS.top10 },
        { label: 'Tendencias', path: APP_PATHS.stats },
        { label: 'Para ti', path: APP_PATHS.forYou },
        { label: 'Comunidad', path: APP_PATHS.community },
      ],
    },
    {
      title: 'Cuenta y marca',
      links: [
        { label: 'Mi perfil', path: APP_PATHS.profile },
        { label: 'Acceder', path: APP_PATHS.login },
        { label: 'Crear cuenta', path: APP_PATHS.register },
        { label: 'Sobre nosotros', path: APP_PATHS.about },
        { label: 'Prensa', path: APP_PATHS.pressKit },
        { label: 'Widget', path: APP_PATHS.embed },
        { label: 'Desarrolladores', path: APP_PATHS.developers },
      ],
    },
  ];

  readonly legal: FooterLink[] = [
    { label: 'Aviso legal', path: '/avisolegal' },
    { label: 'Política editorial', path: '/politica-editorial' },
    { label: 'Privacidad', path: '/privacidad' },
    { label: 'Cookies', path: '/cookies' },
    { label: 'Términos', path: '/terminos' },
    { label: 'Accesibilidad', path: '/accesibilidad' },
    { label: 'Mapa del sitio', path: '/sitemap' },
  ];
}

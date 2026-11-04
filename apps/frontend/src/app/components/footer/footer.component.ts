import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_PATHS } from '../../config/route-map';
import { ConsentService } from '../../services/analytics/consent.service';

interface FooterLinkGroup {
  id: string;
  title: string;
  links: Array<{ label: string; path: string }>;
}

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
})
export class FooterComponent {
  readonly consent = inject(ConsentService);
  readonly currentYear = new Date().getFullYear();
  readonly highlightLinks = [
    { label: 'TV en directo', description: 'Qué emiten ahora los canales', path: APP_PATHS.guide },
    { label: 'Qué ver hoy', description: 'Películas, series y deporte', path: APP_PATHS.explore },
    { label: 'Plataformas', description: 'Streaming y comparador de planes', path: APP_PATHS.platforms },
    { label: 'Fútbol', description: 'Partidos de hoy y dónde verlos', path: APP_PATHS.sports },
  ];
  readonly groups: FooterLinkGroup[] = [
    {
      id: 'producto',
      title: 'Producto',
      links: [
        { label: 'Inicio', path: APP_PATHS.home },
        { label: 'TV en directo', path: APP_PATHS.guide },
        { label: 'Qué ver hoy', path: APP_PATHS.explore },
        { label: 'Plataformas', path: APP_PATHS.platforms },
        { label: 'Fútbol', path: APP_PATHS.sports },
      ],
    },
    {
      id: 'explorar',
      title: 'Explorar',
      links: [
        { label: 'Guías', path: APP_PATHS.blog },
        { label: 'Tendencias', path: APP_PATHS.stats },
        { label: 'Comparador', path: APP_PATHS.streamingComparison },
        { label: 'Series', path: APP_PATHS.series },
      ],
    },
    {
      id: 'cuenta',
      title: 'Cuenta',
      links: [
        { label: 'Mi perfil', path: APP_PATHS.profile },
        { label: 'Acceder', path: APP_PATHS.login },
        { label: 'Crear cuenta', path: APP_PATHS.register },
      ],
    },
    {
      id: 'marca',
      title: 'Marca',
      links: [
        { label: 'Sobre nosotros', path: APP_PATHS.about },
        { label: 'Prensa', path: APP_PATHS.pressKit },
        { label: 'Widget', path: APP_PATHS.embed },
        { label: 'Desarrolladores', path: APP_PATHS.developers },
      ],
    },
  ];

  openSections: Record<string, boolean> = {
    producto: true,
    explorar: false,
    cuenta: false,
    marca: false,
  };

  toggleSection(sectionId: string): void {
    this.openSections[sectionId] = !this.openSections[sectionId];
  }

  isOpen(sectionId: string): boolean {
    return !!this.openSections[sectionId];
  }
}

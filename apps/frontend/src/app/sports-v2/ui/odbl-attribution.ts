import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * ODbL 1.0 attribution (section 4.3) required when publicly using football data ingested
 * from OpenLigaDB. Wording and links are fixed by the captain's research — see
 * .m06-r1/docs/sports-v2/M06-R1-F02-ODBL-ATTRIBUTION.md — do not reword or relink.
 */
export const ODBL_DATABASE_NAME = 'OpenLigaDB';
export const ODBL_DATABASE_URL = 'https://www.openligadb.de/';
export const ODBL_LICENSE_LABEL = 'Open Database License (ODbL)';
export const ODBL_LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';
/** The exact 4.3 notice, one sentence; DATABASE NAME and the licence label are the two anchors. */
export const ODBL_NOTICE_TEXT = `Contiene información de ${ODBL_DATABASE_NAME}, disponible aquí bajo la ${ODBL_LICENSE_LABEL}.`;

/**
 * Small, unobtrusive, keyboard-reachable attribution footer rendered on every public
 * Sports V2 page that presents ingested football data. It is a top-level `contentinfo`
 * landmark: real text (not an image), links whose purpose is readable out of context.
 */
@Component({
  selector: 'app-sv2-odbl-attribution',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="odbl" role="contentinfo">
      <p>Contiene información de <a [href]="databaseUrl">{{ databaseName }}</a>, disponible aquí bajo la <a [href]="licenseUrl">{{ licenseLabel }}</a>.</p>
    </footer>
  `,
  styles: `
    :host { display: block; }
    .odbl {
      padding: 8px 12px;
      font-size: var(--sv2-fs-xs);
      line-height: 1.4;
      color: var(--sv2-text-muted); /* 7.6:1 on the surface behind it */
      text-align: center;
    }
    .odbl p { margin: 0; }
    .odbl a {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      border-radius: 3px;
    }
    .odbl a:hover { color: var(--sv2-text); }
    .odbl a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2OdblAttributionComponent {
  protected readonly databaseName = ODBL_DATABASE_NAME;
  protected readonly databaseUrl = ODBL_DATABASE_URL;
  protected readonly licenseLabel = ODBL_LICENSE_LABEL;
  protected readonly licenseUrl = ODBL_LICENSE_URL;
}

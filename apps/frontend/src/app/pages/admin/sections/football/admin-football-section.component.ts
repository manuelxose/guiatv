import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AdminFootballControlCenterComponent } from './centro-de-control/admin-football-control-center.component';
import { AdminFootballProvidersComponent } from './proveedores/admin-football-providers.component';
import { AdminFootballCoverageComponent } from './cobertura/admin-football-coverage.component';
import { AdminFootballMatchesComponent } from './partidos/admin-football-matches.component';
import { AdminFootballEntitiesComponent } from './entidades/admin-football-entities.component';
import { AdminFootballBroadcastsComponent } from './retransmisiones/admin-football-broadcasts.component';
import { AdminFootballSyncComponent } from './sincronizacion/admin-football-sync.component';
import { AdminFootballQualityComponent } from './calidad/admin-football-quality.component';

/**
 * Futbol control center — one top-level admin group with eight sections.
 * This is the integration surface the captain wires into admin.component.*:
 * `<app-admin-football-section [activeItem]="activeItem" (lastUpdatedChange)="onLastUpdated($event)">`
 * when `activeGroup === 'futbol'`. Each section owns its own data loading and
 * honest empty/error/missing-provider/stale states.
 */
@Component({
  selector: 'app-admin-football-section',
  standalone: true,
  imports: [
    CommonModule,
    AdminFootballControlCenterComponent,
    AdminFootballProvidersComponent,
    AdminFootballCoverageComponent,
    AdminFootballMatchesComponent,
    AdminFootballEntitiesComponent,
    AdminFootballBroadcastsComponent,
    AdminFootballSyncComponent,
    AdminFootballQualityComponent,
  ],
  templateUrl: './admin-football-section.component.html',
  styleUrls: ['./admin-football-section.component.scss'],
})
export class AdminFootballSectionComponent {
  @Input() activeItem = 'centro-de-control';
  @Output() lastUpdatedChange = new EventEmitter<Date>();
}

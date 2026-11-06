import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { broadcastAvailabilityLabel, BroadcastAvailability } from '@app/features/football/admin-data/football-admin.models';
import { FootballMatchDTO } from '@app/features/football/football.models';

@Component({
  selector: 'app-admin-football-broadcasts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-football-broadcasts.component.html',
  styleUrls: ['./admin-football-broadcasts.component.scss'],
})
export class AdminFootballBroadcastsComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  matches: FootballMatchDTO[] = [];
  loading = false;
  error: string | null = null;

  private sub?: Subscription;

  constructor(private readonly data: FootballAdminDataService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.sub?.unsubscribe();
    this.sub = this.data.getMatches().subscribe({
      next: (matches) => {
        this.matches = matches;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar las retransmisiones';
        this.loading = false;
      },
    });
  }

  availabilityLabel(value: BroadcastAvailability): string {
    return broadcastAvailabilityLabel(value);
  }

  get matchesWithBroadcasts(): FootballMatchDTO[] {
    return this.matches.filter((match) => (match.broadcasts?.length ?? 0) > 0);
  }
}

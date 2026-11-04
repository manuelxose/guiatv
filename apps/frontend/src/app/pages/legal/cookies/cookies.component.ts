import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ConsentService } from '../../../services/analytics/consent.service';

@Component({
  selector: 'app-cookies',
  templateUrl: './cookies.component.html',
  styleUrls: ['./cookies.component.scss'],
  standalone: true,
  imports: [RouterModule],
})
export class CookiesComponent {
  readonly consent = inject(ConsentService);
}

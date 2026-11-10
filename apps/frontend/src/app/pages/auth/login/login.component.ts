import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthLayoutComponent } from '../../../components/auth-layout/auth-layout.component';
import { Router, RouterModule } from '@angular/router';
import { MenuStateService } from '../../../services/menu-state.service';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../services/auth.service';
import { Subject, filter, takeUntil } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, AuthLayoutComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit, OnDestroy {
  public statusMessage = '';
  public statusTone: 'success' | 'error' | 'info' = 'info';
  public loading = false;
  public isAuthenticated$ = this.userService.isAuthenticated$;
  public credentials = { email: '', password: '' };
  private readonly destroy$ = new Subject<void>();
  private hasRedirected = false;

  constructor(
    private userService: UserService,
    private router: Router,
    private menuState: MenuStateService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.menuState.setActive('iniciar-sesion');
    this.isAuthenticated$
      .pipe(
        filter((isAuthenticated) => isAuthenticated),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.redirectToAccount());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onPasswordLogin(): void {
    const email = this.credentials.email.trim();
    const password = this.credentials.password;

    if (!email || !password) {
      this.statusTone = 'error';
      this.statusMessage = 'Completa email y contrasena.';
      return;
    }

    this.loading = true;
    this.statusTone = 'info';
    this.statusMessage = 'Validando credenciales...';
    this.authService.loginWithPassword({ email, password }).subscribe({
      next: () => {
        this.statusTone = 'success';
        this.statusMessage = 'Sesion iniciada. Redirigiendo...';
        this.redirectToAccount();
      },
      error: (err) => {
        this.loading = false;
        this.statusTone = 'error';
        this.statusMessage =
          err?.message || 'No se pudo iniciar sesion con email.';
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  onGoogleLogin(): void {
    this.loading = true;
    this.statusTone = 'info';
    this.statusMessage = 'Abriendo autenticacion con Google...';
    this.authService.loginWithGoogle().subscribe({
      next: () => {
        this.statusTone = 'success';
        this.statusMessage = 'Sesion iniciada con Google. Redirigiendo...';
        this.redirectToAccount();
      },
      error: (err) => {
        this.loading = false;
        this.statusTone = 'error';
        this.statusMessage =
          err?.message || 'No se pudo iniciar sesion con Google.';
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  private redirectToAccount(): void {
    if (this.hasRedirected) return;
    this.hasRedirected = true;
    this.menuState.setActive('mi-cuenta');
    this.router.navigateByUrl('/mi-cuenta');
  }
}

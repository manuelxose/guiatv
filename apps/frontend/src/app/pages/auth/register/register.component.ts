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
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, AuthLayoutComponent],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent implements OnInit, OnDestroy {
  public statusMessage = '';
  public statusTone: 'success' | 'error' | 'info' = 'info';
  public loading = false;
  public isAuthenticated$ = this.userService.isAuthenticated$;
  public registerData = {
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  };
  private readonly destroy$ = new Subject<void>();
  private hasRedirected = false;

  constructor(
    private router: Router,
    private menuState: MenuStateService,
    private authService: AuthService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.menuState.setActive('registro');
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

  onPasswordRegister(): void {
    const name = this.registerData.name.trim();
    const email = this.registerData.email.trim();
    const password = this.registerData.password;
    const confirmPassword = this.registerData.confirmPassword;

    if (!email || !password) {
      this.statusTone = 'error';
      this.statusMessage = 'Completa email y contrasena.';
      return;
    }

    if (password.length < 8) {
      this.statusTone = 'error';
      this.statusMessage = 'La contrasena debe tener al menos 8 caracteres.';
      return;
    }

    if (password !== confirmPassword) {
      this.statusTone = 'error';
      this.statusMessage = 'Las contrasenas no coinciden.';
      return;
    }

    this.loading = true;
    this.statusTone = 'info';
    this.statusMessage = 'Creando cuenta...';
    this.authService
      .registerWithPassword({
        name: name || undefined,
        email,
        password,
      })
      .subscribe({
        next: () => {
          this.statusTone = 'success';
          this.statusMessage = 'Cuenta creada. Redirigiendo...';
          this.redirectToAccount();
        },
        error: (err) => {
          this.loading = false;
          this.statusTone = 'error';
          this.statusMessage =
            err?.message || 'No se pudo crear la cuenta con email.';
        },
        complete: () => {
          this.loading = false;
        },
      });
  }

  onGoogleRegister(): void {
    this.loading = true;
    this.statusTone = 'info';
    this.statusMessage = 'Abriendo autenticacion con Google...';
    this.authService.loginWithGoogle().subscribe({
      next: () => {
        this.statusTone = 'success';
        this.statusMessage = 'Cuenta creada. Redirigiendo...';
        this.redirectToAccount();
      },
      error: (err) => {
        this.loading = false;
        this.statusTone = 'error';
        this.statusMessage =
          err?.message || 'No se pudo crear la cuenta con Google.';
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

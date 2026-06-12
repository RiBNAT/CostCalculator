import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

import { AuthService } from '../../core/auth.service';
import { GoogleSignInComponent } from './google-signin.component';

export const AUTH_STYLES = `
  .auth-wrap {
    min-height: 100vh;
    display: grid; place-items: center;
    background:
      radial-gradient(1200px 600px at 10% -10%, #c5cae9 0%, transparent 60%),
      radial-gradient(1000px 500px at 110% 110%, #b2dfdb 0%, transparent 60%),
      var(--bg);
    padding: 24px;
  }
  .auth-card { width: 100%; max-width: 400px; padding: 36px; }
  .auth-brand {
    display: flex; align-items: center; gap: 10px;
    font-weight: 800; font-size: 18px; color: var(--primary);
    margin-bottom: 28px;
  }
  .auth-brand .mark {
    width: 36px; height: 36px; border-radius: 10px;
    background: var(--primary-soft);
    display: grid; place-items: center; font-size: 18px;
  }
  h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; }
  .sub { color: var(--ink-soft); margin: 0 0 24px; }
  form { display: flex; flex-direction: column; gap: 4px; }
  .full { width: 100%; height: 44px; font-weight: 600; margin-top: 4px; }
  .error { color: var(--bad); font-size: 13px; margin: 0 0 12px; }
  .alt { margin: 20px 0 0; font-size: 14px; color: var(--ink-soft); text-align: center; }
  .alt a { color: var(--primary); font-weight: 600; text-decoration: none; }
`;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, GoogleSignInComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand"><span class="mark">৳</span> Cost Calculator</div>
        <h1>Welcome back</h1>
        <p class="sub">Sign in to your cost tracker</p>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="email" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="current-password" />
          </mat-form-field>

          @if (error()) {
            <div class="error">{{ error() }}</div>
          }

          <button mat-flat-button color="primary" class="full" [disabled]="form.invalid || busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <app-google-signin />
        <p class="alt">No account yet? <a routerLink="/register">Create one</a></p>
      </div>
    </div>
  `,
  styles: [AUTH_STYLES],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly busy = signal(false);
  readonly error = signal('');

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (e) => {
        this.busy.set(false);
        this.error.set(e?.error?.error?.message ?? 'Sign-in failed');
      },
    });
  }
}

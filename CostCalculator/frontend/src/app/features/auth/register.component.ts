import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { AuthService } from '../../core/auth.service';
import { AUTH_STYLES } from './login.component';
import { GoogleSignInComponent } from './google-signin.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, GoogleSignInComponent],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand"><span class="mark">৳</span> Cost Calculator</div>
        <h1>Create your account</h1>
        <p class="sub">Default categories and accounts are set up for you</p>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" autocomplete="name" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="email" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password (min 8 characters)</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="new-password" />
          </mat-form-field>

          @if (error()) {
            <div class="error">{{ error() }}</div>
          }

          <button mat-flat-button color="primary" class="full" [disabled]="form.invalid || busy()">
            {{ busy() ? 'Creating…' : 'Create account' }}
          </button>
        </form>
        <app-google-signin />
        <p class="alt">Already registered? <a routerLink="/login">Sign in</a></p>
      </div>
    </div>
  `,
  styles: [AUTH_STYLES],
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly busy = signal(false);
  readonly error = signal('');

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const { name, email, password } = this.form.getRawValue();
    this.auth.register(name, email, password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (e) => {
        this.busy.set(false);
        this.error.set(e?.error?.error?.message ?? 'Registration failed');
      },
    });
  }
}

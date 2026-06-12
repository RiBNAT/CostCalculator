import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PeriodStateService } from '../../core/period-state.service';
import { Account, Category } from '../../core/models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatIconModule, MatTabsModule, MatTooltipModule, MatSnackBarModule,
  ],
  template: `
    <div class="page">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Profile, categories, accounts and periods</p>

      <mat-tab-group class="settings-tabs" animationDuration="250ms">
        <!-- ===================== PROFILE ===================== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon>person</mat-icon> Profile</ng-template>
          <div class="tab-body profile-grid">
            <div class="card">
              <h3><mat-icon>badge</mat-icon> Personal info</h3>
              <form [formGroup]="profileForm" (ngSubmit)="saveProfile()">
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Name</mat-label>
                  <input matInput formControlName="name" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Phone</mat-label>
                  <input matInput formControlName="phone" placeholder="01XXXXXXXXX" />
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="profileForm.invalid || profileForm.pristine">
                  Save changes
                </button>
              </form>
            </div>

            <div class="card">
              <h3><mat-icon>alternate_email</mat-icon> Change email</h3>
              <p class="hint">Current: <strong>{{ auth.user()?.email }}</strong></p>
              <form [formGroup]="emailForm" (ngSubmit)="saveEmail()">
                <mat-form-field appearance="outline" class="full">
                  <mat-label>New email</mat-label>
                  <input matInput type="email" formControlName="email" autocomplete="off" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Current password</mat-label>
                  <input matInput type="password" formControlName="password" autocomplete="current-password" />
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="emailForm.invalid">Update email</button>
              </form>
            </div>

            <div class="card">
              <h3><mat-icon>lock</mat-icon> Change password</h3>
              <form [formGroup]="passwordForm" (ngSubmit)="savePassword()">
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Current password</mat-label>
                  <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>New password (min 8 characters)</mat-label>
                  <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Confirm new password</mat-label>
                  <input matInput type="password" formControlName="confirm" autocomplete="new-password" />
                  @if (passwordForm.value.confirm && passwordForm.value.confirm !== passwordForm.value.newPassword) {
                    <mat-hint class="neg">passwords do not match</mat-hint>
                  }
                </mat-form-field>
                <button mat-flat-button color="primary"
                        [disabled]="passwordForm.invalid || passwordForm.value.newPassword !== passwordForm.value.confirm">
                  Update password
                </button>
              </form>
            </div>
          </div>
        </mat-tab>

        <!-- ===================== CATEGORIES ===================== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon>category</mat-icon> Categories</ng-template>
          <div class="tab-body">
            <div class="card">
              @for (c of categories(); track c.id) {
                <div class="cat-block" [class.inactive]="!c.active">
                  <div class="cat-head">
                    <strong>{{ c.name }}</strong>
                    <span class="kind">{{ c.kind }}</span>
                    <span class="spacer"></span>
                    <button mat-icon-button (click)="toggleCategory(c)" [matTooltip]="c.active ? 'Deactivate' : 'Activate'">
                      <mat-icon>{{ c.active ? 'visibility' : 'visibility_off' }}</mat-icon>
                    </button>
                  </div>
                  <div class="subs">
                    @for (s of c.subcategories; track s.name) {
                      <span class="sub-chip" [class.off]="!s.active">
                        {{ s.name }}
                        <button class="chip-x" (click)="toggleSub(c, s.name)" [matTooltip]="s.active ? 'Deactivate' : 'Activate'">
                          {{ s.active ? '×' : '+' }}
                        </button>
                      </span>
                    }
                    <form class="inline-add" (ngSubmit)="addSub(c)">
                      <input [(ngModel)]="newSub[c.id]" name="ns{{ c.id }}" placeholder="add subcategory" />
                      <button mat-icon-button type="submit"><mat-icon>add</mat-icon></button>
                    </form>
                  </div>
                </div>
              }
              <form [formGroup]="catForm" (ngSubmit)="addCategory()" class="add-form">
                <mat-form-field appearance="outline" class="grow" subscriptSizing="dynamic">
                  <mat-label>New category</mat-label>
                  <input matInput formControlName="name" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-kind" subscriptSizing="dynamic">
                  <mat-label>Kind</mat-label>
                  <mat-select formControlName="kind">
                    <mat-option value="expense">expense</mat-option>
                    <mat-option value="savings">savings</mat-option>
                    <mat-option value="pay">pay</mat-option>
                  </mat-select>
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="catForm.invalid"><mat-icon>add</mat-icon> Add</button>
              </form>
            </div>
          </div>
        </mat-tab>

        <!-- ===================== ACCOUNTS ===================== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon>account_balance</mat-icon> Accounts</ng-template>
          <div class="tab-body">
            <div class="card">
              @for (a of accounts(); track a.id) {
                <div class="row" [class.inactive]="!a.active">
                  <mat-icon>{{ accIcon(a.kind) }}</mat-icon>
                  <span class="grow">{{ a.name }}</span>
                  <span class="kind">{{ a.kind }}{{ a.virtualRole ? ' · ' + a.virtualRole : '' }}</span>
                  @if (!a.virtualRole) {
                    <button mat-icon-button (click)="toggleAccount(a)" [matTooltip]="a.active ? 'Deactivate' : 'Activate'">
                      <mat-icon>{{ a.active ? 'visibility' : 'visibility_off' }}</mat-icon>
                    </button>
                  }
                </div>
              }
              <form [formGroup]="accForm" (ngSubmit)="addAccount()" class="add-form">
                <mat-form-field appearance="outline" class="grow" subscriptSizing="dynamic">
                  <mat-label>New account</mat-label>
                  <input matInput formControlName="name" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-kind" subscriptSizing="dynamic">
                  <mat-label>Kind</mat-label>
                  <mat-select formControlName="kind">
                    <mat-option value="bank">bank</mat-option>
                    <mat-option value="mobile">mobile</mat-option>
                    <mat-option value="cash">cash</mat-option>
                    <mat-option value="savings">savings</mat-option>
                  </mat-select>
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="accForm.invalid"><mat-icon>add</mat-icon> Add</button>
              </form>
            </div>
          </div>
        </mat-tab>

        <!-- ===================== PERIODS ===================== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon>calendar_month</mat-icon> Periods</ng-template>
          <div class="tab-body">
            <div class="card">
              @for (p of state.periods(); track p.id) {
                <div class="row">
                  <mat-icon>calendar_month</mat-icon>
                  <span class="grow">{{ p.name }}</span>
                  <span class="kind">{{ p.startDate | date: 'd MMM' }} – {{ p.endDate | date: 'd MMM yy' }}</span>
                  <span class="chip" [class]="p.status">{{ p.status }}</span>
                  @if (p.status === 'open') {
                    <button mat-button (click)="closePeriod(p.id)">Close</button>
                  } @else {
                    <button mat-button (click)="reopenPeriod(p.id)">Reopen</button>
                  }
                </div>
              }
              <form [formGroup]="periodForm" (ngSubmit)="addPeriod()" class="add-form">
                <mat-form-field appearance="outline" class="grow" subscriptSizing="dynamic">
                  <mat-label>Name</mat-label>
                  <input matInput formControlName="name" placeholder="July 26" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-date" subscriptSizing="dynamic">
                  <mat-label>Start</mat-label>
                  <input matInput type="date" formControlName="startDate" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-date" subscriptSizing="dynamic">
                  <mat-label>End</mat-label>
                  <input matInput type="date" formControlName="endDate" />
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="periodForm.invalid"><mat-icon>add</mat-icon> Add</button>
              </form>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [
    `
      .settings-tabs { margin-top: 8px; }
      .settings-tabs ::ng-deep .mdc-tab { min-width: 140px; }
      .settings-tabs mat-icon { margin-right: 8px; }
      .tab-body { padding: 20px 2px; }
      .profile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
      h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-size: 15px; font-weight: 700; }
      h3 mat-icon { color: var(--primary); font-size: 19px; width: 19px; height: 19px; }
      .hint { color: var(--ink-soft); font-size: 13px; margin: -6px 0 14px; }
      .full { width: 100%; }
      .cat-block { padding: 10px 0; border-bottom: 1px solid #f0f2f8; }
      .cat-block.inactive { opacity: 0.5; }
      .cat-head { display: flex; align-items: center; gap: 8px; }
      .kind { color: var(--ink-soft); font-size: 12px; }
      .spacer, .grow { flex: 1; }
      .subs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
      .sub-chip {
        background: var(--primary-soft); color: var(--primary);
        border-radius: 999px; padding: 3px 6px 3px 12px;
        font-size: 12px; font-weight: 600;
        display: inline-flex; align-items: center; gap: 4px;
      }
      .sub-chip.off { background: #f1f3f4; color: var(--ink-soft); }
      .chip-x { border: none; background: none; cursor: pointer; font-size: 14px; color: inherit; padding: 0 4px; }
      .inline-add { display: inline-flex; align-items: center; }
      .inline-add input {
        border: 1px dashed #c3c9dd; border-radius: 999px;
        padding: 4px 12px; font: inherit; font-size: 12px; width: 130px;
        background: transparent;
      }
      .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f2f8; }
      .row.inactive { opacity: 0.5; }
      .row mat-icon { color: var(--ink-soft); font-size: 20px; width: 20px; height: 20px; }
      .add-form { display: flex; gap: 8px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
      .w-kind { width: 130px; }
      .w-date { width: 145px; }
    `,
  ],
})
export class SettingsComponent {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private snack = inject(MatSnackBar);
  readonly auth = inject(AuthService);
  readonly state = inject(PeriodStateService);

  readonly categories = signal<Category[]>([]);
  readonly accounts = signal<Account[]>([]);
  newSub: Record<string, string> = {};

  profileForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    phone: [''],
  });
  emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  passwordForm = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirm: ['', Validators.required],
  });

  catForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    kind: ['expense', Validators.required],
  });
  accForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    kind: ['bank', Validators.required],
  });
  periodForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
  });

  constructor() {
    this.reload();
    this.api.me().subscribe((u) => {
      this.auth.setUser(u);
      this.profileForm.patchValue({ name: u.name, phone: u.phone ?? '' });
      this.profileForm.markAsPristine();
    });
  }

  reload(): void {
    this.api.listCategories().subscribe((c) => this.categories.set(c));
    this.api.listAccounts().subscribe((a) => this.accounts.set(a));
  }

  accIcon(kind: string): string {
    return (
      { cash: 'payments', bank: 'account_balance', mobile: 'smartphone', savings: 'savings', virtual: 'sync_alt' }[kind] ??
      'wallet'
    );
  }

  fail = (e: any) => this.snack.open(e?.error?.error?.message ?? 'Failed', 'OK', { duration: 4000 });

  // --- profile ---

  saveProfile(): void {
    this.api.updateProfile(this.profileForm.getRawValue()).subscribe({
      next: (u) => {
        this.auth.setUser(u);
        this.profileForm.markAsPristine();
        this.snack.open('Profile updated', undefined, { duration: 2000 });
      },
      error: this.fail,
    });
  }

  saveEmail(): void {
    this.api.updateEmail(this.emailForm.getRawValue()).subscribe({
      next: (u) => {
        this.auth.setUser(u);
        this.emailForm.reset({ email: '', password: '' });
        this.snack.open('Email updated', undefined, { duration: 2500 });
      },
      error: this.fail,
    });
  }

  savePassword(): void {
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.api.updatePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        this.passwordForm.reset({ currentPassword: '', newPassword: '', confirm: '' });
        this.snack.open('Password updated', undefined, { duration: 2500 });
      },
      error: this.fail,
    });
  }

  // --- categories ---

  addCategory(): void {
    const v = this.catForm.getRawValue();
    this.api.createCategory({ name: v.name, kind: v.kind as any, subcategories: [] }).subscribe({
      next: () => {
        this.catForm.reset({ name: '', kind: 'expense' });
        this.reload();
      },
      error: this.fail,
    });
  }

  toggleCategory(c: Category): void {
    this.api
      .updateCategory(c.id, { name: c.name, kind: c.kind, subcategories: c.subcategories, active: !c.active })
      .subscribe({ next: () => this.reload(), error: this.fail });
  }

  addSub(c: Category): void {
    const name = (this.newSub[c.id] ?? '').trim();
    if (!name) return;
    const subs = [...c.subcategories, { name, active: true }];
    this.api.updateCategory(c.id, { name: c.name, kind: c.kind, subcategories: subs, active: c.active }).subscribe({
      next: () => {
        this.newSub[c.id] = '';
        this.reload();
      },
      error: this.fail,
    });
  }

  toggleSub(c: Category, subName: string): void {
    const subs = c.subcategories.map((s) => (s.name === subName ? { ...s, active: !s.active } : s));
    this.api
      .updateCategory(c.id, { name: c.name, kind: c.kind, subcategories: subs, active: c.active })
      .subscribe({ next: () => this.reload(), error: this.fail });
  }

  // --- accounts ---

  addAccount(): void {
    this.api.createAccount(this.accForm.getRawValue()).subscribe({
      next: () => {
        this.accForm.reset({ name: '', kind: 'bank' });
        this.reload();
      },
      error: this.fail,
    });
  }

  toggleAccount(a: Account): void {
    this.api
      .updateAccount(a.id, { name: a.name, kind: a.kind, active: !a.active })
      .subscribe({ next: () => this.reload(), error: this.fail });
  }

  // --- periods ---

  addPeriod(): void {
    this.api.createPeriod(this.periodForm.getRawValue()).subscribe({
      next: () => {
        this.periodForm.reset({ name: '', startDate: '', endDate: '' });
        this.state.refreshSelected();
        this.snack.open('Period created', undefined, { duration: 2000 });
      },
      error: this.fail,
    });
  }

  closePeriod(id: string): void {
    this.api.closePeriod(id).subscribe({ next: () => this.state.refreshSelected(), error: this.fail });
  }

  reopenPeriod(id: string): void {
    this.api.reopenPeriod(id).subscribe({ next: () => this.state.refreshSelected(), error: this.fail });
  }
}

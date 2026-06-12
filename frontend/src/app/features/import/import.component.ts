import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ApiService } from '../../core/api.service';
import { PeriodStateService } from '../../core/period-state.service';
import { ImportReport } from '../../core/models';
import { saveBlob } from '../../core/save-blob';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule],
  template: `
    <div class="page">
      <h1 class="page-title">Import Excel</h1>
      <p class="page-subtitle">
        Bring a month's data in from Excel — or skip Excel entirely and add periods, expenses and transfers
        directly from the app.
      </p>

      <div class="import-grid">
        <!-- step 1: template -->
        <div class="card step-card">
          <div class="step-num">1</div>
          <h3><mat-icon>file_download</mat-icon> Get the monthly template</h3>
          <p>
            A blank one-month workbook with six sheets, prefilled with <strong>your</strong> categories and
            accounts as dropdowns:
          </p>
          <ul class="sheet-list">
            <li><strong>Config</strong> — period name, start & end date</li>
            <li><strong>Expenses</strong> — date, category, subcategory, payment method, amount, remarks</li>
            <li><strong>Transactions</strong> — transfers between accounts with fees</li>
            <li><strong>Budget</strong> — per-subcategory budget amounts (rows prefilled)</li>
            <li><strong>Finance</strong> — opening balances, savings openings, new lends</li>
            <li><strong>Planner</strong> — payment windows & reminders</li>
          </ul>
          <button mat-flat-button color="primary" (click)="downloadTemplate()" [disabled]="downloading()">
            <mat-icon>download</mat-icon> {{ downloading() ? 'Preparing…' : 'Download template' }}
          </button>
        </div>

        <!-- step 2: upload -->
        <div class="card step-card">
          <div class="step-num">2</div>
          <h3><mat-icon>upload_file</mat-icon> Fill it in & upload</h3>
          <p>
            One file = one month. Leave the Finance openings blank to roll balances over from the previous
            period automatically. The legacy CostSheet workbook format is also accepted.
          </p>
          <div
            class="dropzone"
            [class.drag]="dragging()"
            (dragover)="$event.preventDefault(); dragging.set(true)"
            (dragleave)="dragging.set(false)"
            (drop)="onDrop($event)"
          >
            <mat-icon class="big-icon">cloud_upload</mat-icon>
            <p><strong>Drag & drop</strong> your .xlsx here, or</p>
            <button mat-stroked-button color="primary" (click)="fileInput.click()" [disabled]="busy()">
              Choose file
            </button>
            <input #fileInput type="file" accept=".xlsx" hidden (change)="onPick($event)" />
            @if (busy()) {
              <mat-progress-bar mode="indeterminate" class="bar" />
            }
          </div>
          <p class="note">
            <mat-icon class="mini">replay</mat-icon> Re-uploading an unchanged file is skipped — no duplicates.
          </p>
        </div>
      </div>

      @if (report(); as rep) {
        <div class="card report">
          <h3>Import report</h3>
          <table class="data">
            <thead>
              <tr>
                <th>Period / Sheet</th><th class="num">Expenses</th><th class="num">Transfers</th>
                <th class="num">Budget items</th><th class="num">Lends</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (s of rep.sheets; track s.sheet) {
                <tr>
                  <td><strong>{{ s.sheet }}</strong></td>
                  <td class="num">{{ s.expenses }}</td>
                  <td class="num">{{ s.transfers }}</td>
                  <td class="num">{{ s.budgetItems }}</td>
                  <td class="num">{{ s.lends }}</td>
                  <td>
                    @if (s.skipped) {
                      <span class="chip closed">skipped (unchanged)</span>
                    } @else {
                      <span class="chip paid">imported</span>
                    }
                  </td>
                </tr>
                @if ((s.warnings ?? []).length) {
                  <tr class="warn-row">
                    <td colspan="6">
                      @for (w of s.warnings; track $index) {
                        <div class="warning"><mat-icon>warning_amber</mat-icon> {{ w }}</div>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .import-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; }
      @media (max-width: 1000px) { .import-grid { grid-template-columns: 1fr; } }
      .step-card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 24px; }
      .step-num {
        position: absolute; top: 18px; right: 20px;
        width: 30px; height: 30px; border-radius: 50%;
        background: var(--primary-soft); color: var(--primary);
        display: grid; place-items: center; font-weight: 800;
      }
      h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; font-weight: 700; }
      h3 mat-icon { color: var(--primary); }
      p { color: var(--ink-soft); font-size: 13px; margin: 0; }
      .sheet-list { margin: 4px 0 12px; padding-left: 18px; color: var(--ink-soft); font-size: 13px; line-height: 1.8; }
      .sheet-list strong { color: var(--ink); }
      .step-card > button { align-self: flex-start; }
      .dropzone {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 28px; text-align: center;
        border: 2px dashed #c3c9dd; border-radius: 12px;
        transition: border-color 0.15s, background 0.15s;
        margin-top: 6px;
      }
      .dropzone.drag { border-color: var(--primary); background: var(--primary-soft); }
      .big-icon { font-size: 40px; width: 40px; height: 40px; color: var(--primary); }
      .bar { width: 220px; margin-top: 12px; }
      .note { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12px; }
      .mini { font-size: 15px; width: 15px; height: 15px; }
      .report { margin-top: 16px; }
      .report h3 { margin: 0 0 12px; font-size: 15px; }
      .warn-row td { background: #fff8e8; }
      .warning { display: flex; align-items: center; gap: 6px; color: #8a6d00; font-size: 12px; padding: 2px 0; }
      .warning mat-icon { font-size: 16px; width: 16px; height: 16px; }
    `,
  ],
})
export class ImportComponent {
  private api = inject(ApiService);
  private snack = inject(MatSnackBar);
  private state = inject(PeriodStateService);

  readonly busy = signal(false);
  readonly downloading = signal(false);
  readonly dragging = signal(false);
  readonly report = signal<ImportReport | null>(null);

  downloadTemplate(): void {
    this.downloading.set(true);
    this.api.downloadTemplate().subscribe({
      next: (blob) => {
        this.downloading.set(false);
        saveBlob(blob, 'ribnat-monthly-template.xlsx');
      },
      error: () => {
        this.downloading.set(false);
        this.snack.open('Template download failed', 'OK', { duration: 4000 });
      },
    });
  }

  onPick(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.upload(file);
  }

  private upload(file: File): void {
    if (!file.name.endsWith('.xlsx')) {
      this.snack.open('Please choose a .xlsx workbook', 'OK', { duration: 3000 });
      return;
    }
    this.busy.set(true);
    this.api.importExcel(file).subscribe({
      next: (rep) => {
        this.busy.set(false);
        this.report.set(rep);
        this.state.refreshSelected();
        this.snack.open('Import finished', undefined, { duration: 2500 });
      },
      error: (e) => {
        this.busy.set(false);
        this.snack.open(e?.error?.error?.message ?? 'Import failed', 'OK', { duration: 6000 });
      },
    });
  }
}

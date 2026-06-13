import { Component, Injectable, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';

export interface ConfirmData {
  title: string;
  message: string;
  confirmLabel?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title><mat-icon>warning_amber</mat-icon> {{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close cdkFocusInitial>Cancel</button>
      <button mat-flat-button color="warn" [mat-dialog-close]="true">{{ data.confirmLabel ?? 'Delete' }}</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 { display: flex; align-items: center; gap: 10px; font-weight: 700; }
      h2 mat-icon { color: var(--warn-amber); }
      mat-dialog-content { color: var(--ink-soft); max-width: 360px; }
    `,
  ],
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

/** Opens a confirmation dialog; emits true only when the user confirms. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private dialog = inject(MatDialog);

  confirm(data: ConfirmData): Observable<boolean> {
    return this.dialog
      .open(ConfirmDialogComponent, { data, autoFocus: false, panelClass: 'app-dialog' })
      .afterClosed();
  }
}

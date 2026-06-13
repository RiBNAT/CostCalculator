import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';
import { ConfirmService } from './confirm-dialog.component';

export interface HasPendingChanges {
  hasPendingChanges(): boolean;
}

/** Blocks navigation away from a page with unsaved edits until confirmed. */
export const pendingChangesGuard: CanDeactivateFn<HasPendingChanges> = (
  component,
): boolean | Observable<boolean> => {
  if (!component.hasPendingChanges()) return true;
  return inject(ConfirmService).confirm({
    title: 'Discard unsaved changes?',
    message: 'Your budget edits have not been saved and will be lost.',
    confirmLabel: 'Discard',
  });
};

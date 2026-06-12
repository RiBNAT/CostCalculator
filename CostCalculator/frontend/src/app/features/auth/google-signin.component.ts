import { AfterViewInit, Component, ElementRef, NgZone, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';

// Google Identity Services injects this global once its script loads.
declare const google: any;

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Renders the official "Sign in with Google" button when the backend reports
 * the feature is configured (GOOGLE_CLIENT_ID set). Otherwise renders nothing,
 * so neither login nor register show a broken button.
 */
@Component({
  selector: 'app-google-signin',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (enabled()) {
      <div class="g-divider"><span>or</span></div>
    }
    <!-- always present so the ViewChild exists before config resolves -->
    <div #btnHost class="g-btn" [style.display]="enabled() ? 'flex' : 'none'"></div>
    @if (error()) {
      <div class="error g-err">{{ error() }}</div>
    }
  `,
  styles: [
    `
      .g-divider {
        display: flex; align-items: center; gap: 12px;
        color: var(--ink-soft); font-size: 12px; margin: 18px 0;
      }
      .g-divider::before, .g-divider::after {
        content: ''; flex: 1; height: 1px; background: #e3e6f0;
      }
      .g-btn { justify-content: center; }
      .g-err { margin-top: 12px; text-align: center; }
    `,
  ],
})
export class GoogleSignInComponent implements AfterViewInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private zone = inject(NgZone);

  private readonly btnHost = viewChild.required<ElementRef<HTMLDivElement>>('btnHost');
  readonly enabled = signal(false);
  readonly error = signal('');

  ngAfterViewInit(): void {
    this.auth.googleConfig().subscribe({
      next: (cfg) => {
        if (cfg.googleEnabled && cfg.googleClientId) {
          this.setup(cfg.googleClientId);
        }
      },
      error: () => {
        /* config unreachable — silently leave Google sign-in hidden */
      },
    });
  }

  private setup(clientId: string): void {
    loadScript()
      .then(() => {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp: { credential: string }) => this.onCredential(resp.credential),
        });
        google.accounts.id.renderButton(this.btnHost().nativeElement, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
        });
        this.enabled.set(true);
      })
      .catch(() => this.error.set('Could not load Google sign-in'));
  }

  /** GSI fires its callback outside Angular's zone; re-enter for routing + signals. */
  private onCredential(idToken: string): void {
    this.zone.run(() => {
      this.error.set('');
      this.auth.loginWithGoogle(idToken).subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: (e) => this.error.set(e?.error?.error?.message ?? 'Google sign-in failed'),
      });
    });
  }
}

let scriptPromise: Promise<void> | null = null;

/** Inject the GSI script once and resolve when it's ready. */
function loadScript(): Promise<void> {
  if (typeof google !== 'undefined' && google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GSI_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error('gsi load failed'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

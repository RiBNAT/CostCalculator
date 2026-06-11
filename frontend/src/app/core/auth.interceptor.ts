import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the Bearer token; on 401 tries one refresh, then logs out. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const withToken = (token: string | null) =>
    token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  if (req.url.includes('/auth/')) {
    return next(req);
  }
  return next(withToken(auth.accessToken)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && auth.refreshToken) {
        return auth.refresh().pipe(
          switchMap((r) => next(withToken(r.tokens.accessToken))),
          catchError((e2) => {
            auth.logout();
            router.navigate(['/login']);
            return throwError(() => e2);
          }),
        );
      }
      if (err.status === 401) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};

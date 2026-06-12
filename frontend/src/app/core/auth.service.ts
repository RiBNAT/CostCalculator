import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { TokenPair, User } from './models';
import { environment } from '../../environments/environment';

const USER_KEY = 'ribnat.user';
const ACCESS_KEY = 'ribnat.access';
const REFRESH_KEY = 'ribnat.refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(readJSON<User>(USER_KEY));

  constructor(private http: HttpClient) {}

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.accessToken;
  }

  register(name: string, email: string, password: string): Observable<{ user: User; tokens: TokenPair }> {
    return this.http
      .post<{ user: User; tokens: TokenPair }>(`${environment.apiBase}/auth/register`, { name, email, password })
      .pipe(tap((r) => this.store(r.user, r.tokens)));
  }

  login(email: string, password: string): Observable<{ user: User; tokens: TokenPair }> {
    return this.http
      .post<{ user: User; tokens: TokenPair }>(`${environment.apiBase}/auth/login`, { email, password })
      .pipe(tap((r) => this.store(r.user, r.tokens)));
  }

  refresh(): Observable<{ tokens: TokenPair }> {
    return this.http
      .post<{ tokens: TokenPair }>(`${environment.apiBase}/auth/refresh`, { refreshToken: this.refreshToken })
      .pipe(tap((r) => this.storeTokens(r.tokens)));
  }

  logout(): void {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.user.set(null);
  }

  /** Sync the cached user after a profile update. */
  setUser(user: User): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  private store(user: User, tokens: TokenPair): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user.set(user);
    this.storeTokens(tokens);
  }

  private storeTokens(tokens: TokenPair): void {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  }
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

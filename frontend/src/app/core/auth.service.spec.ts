import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('stores tokens and user on login', () => {
    service.login('t@example.com', 'secret123').subscribe();
    const req = http.expectOne(`${environment.apiBase}/auth/login`);
    expect(req.request.method).toBe('POST');
    req.flush({
      user: { id: 'u1', name: 'T', email: 't@example.com' },
      tokens: { accessToken: 'acc', refreshToken: 'ref' },
    });

    expect(service.accessToken).toBe('acc');
    expect(service.refreshToken).toBe('ref');
    expect(service.isLoggedIn).toBeTrue();
    expect(service.user()?.email).toBe('t@example.com');
  });

  it('clears everything on logout', () => {
    localStorage.setItem('ribnat.access', 'acc');
    localStorage.setItem('ribnat.refresh', 'ref');
    service.logout();
    expect(service.accessToken).toBeNull();
    expect(service.isLoggedIn).toBeFalse();
    expect(service.user()).toBeNull();
  });

  it('setUser updates the cached profile', () => {
    service.setUser({ id: 'u1', name: 'New Name', email: 'n@example.com', phone: '017' });
    expect(service.user()?.name).toBe('New Name');
    expect(JSON.parse(localStorage.getItem('ribnat.user')!).phone).toBe('017');
  });
});

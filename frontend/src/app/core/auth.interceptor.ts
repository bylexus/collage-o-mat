import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** 401 from these URLs is an expected result, not an expired session. */
const IGNORED_URLS = ['/api/auth/me', '/api/auth/login'];

/** On 401 from the API (session missing/expired): clear the user and go to the login page. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        req.url.startsWith('/api/') &&
        !IGNORED_URLS.includes(req.url)
      ) {
        auth.clearUser();
        const returnUrl = router.url;
        void router.navigate(['/login'], {
          queryParams: returnUrl.startsWith('/login') ? {} : { returnUrl },
        });
      }
      return throwError(() => err);
    }),
  );
};

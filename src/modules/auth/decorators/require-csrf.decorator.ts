// src/modules/auth/decorators/require-csrf.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CSRF_KEY = 'requireCsrf';

// Marks a dangerous mutation as needing the double-submit CSRF check (see
// CsrfGuard) — defense-in-depth alongside SameSite=Strict cookies, per
// Part F of the frontend plan. Applied to every state-changing endpoint
// that isn't already excluded by its own cookie-based auth boundary
// (login/refresh/logout, and gateway webhook receivers, which aren't
// browser-originated requests at all).
export const RequireCsrf = () => SetMetadata(REQUIRE_CSRF_KEY, true);

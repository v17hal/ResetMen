import { Global, Module } from '@nestjs/common';

import { AdminAuthController, AuthController } from './auth.controller.js';
import { AdminGuard, CustomerGuard, OptionalCustomerGuard, RolesGuard } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { FirebaseTokenVerifier } from './firebase-token.verifier.js';
import { TokenService } from './token.service.js';

/**
 * Global so guards can be applied anywhere without every module re-importing auth.
 *
 * Customers sign in through Firebase; staff sign in with email and password. Phone + OTP
 * was removed entirely in Aug 2026 — there is no SMS provider, and a dormant OTP path is
 * a credential-issuing endpoint nobody is watching.
 */
@Global()
@Module({
  controllers: [AuthController, AdminAuthController],
  providers: [
    AuthService,
    TokenService,
    FirebaseTokenVerifier,
    CustomerGuard,
    AdminGuard,
    OptionalCustomerGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    TokenService,
    FirebaseTokenVerifier,
    CustomerGuard,
    AdminGuard,
    OptionalCustomerGuard,
    RolesGuard,
  ],
})
export class AuthModule {}

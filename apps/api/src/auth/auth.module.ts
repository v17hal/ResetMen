import { Global, Module } from '@nestjs/common';

import { AdminAuthController, AuthController } from './auth.controller.js';
import { AdminGuard, CustomerGuard, OptionalCustomerGuard, RolesGuard } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { FirebaseTokenVerifier } from './firebase-token.verifier.js';
import { OTP_PROVIDER, createOtpProvider } from './otp.provider.js';
import { TokenService } from './token.service.js';

/**
 * Global so guards can be applied anywhere without every module re-importing auth.
 *
 * The OTP provider is bound through a token rather than imported directly, so swapping
 * Firebase for MSG91 or Twilio is a one-line change here — see docs/02 §3.
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
    // A factory, not `useClass`: which provider is correct depends on configuration, and
    // the choice has to be able to fail loudly at boot when production has none.
    { provide: OTP_PROVIDER, useFactory: () => createOtpProvider() },
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

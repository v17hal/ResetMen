import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminLogin, firebaseSignIn, refreshRequest, updateProfile } from '@reset/types';
import type { z } from 'zod';

import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, CustomerGuard } from './auth.guards.js';

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * The customer sign-in path.
   *
   * Rate limited despite the token being cryptographically verified: verification costs an
   * RSA check and, on a cold cert cache, a call out to Google. Without a cap that is a free
   * amplifier for anyone with a script.
   */
  @Post('firebase')
  @RateLimited({ limit: 30, windowSeconds: 3600 })
  async firebase(
    @Body(new ZodValidationPipe(firebaseSignIn)) body: z.infer<typeof firebaseSignIn>,
  ) {
    return this.auth.signInWithFirebase(body);
  }

  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshRequest)) body: z.infer<typeof refreshRequest>,
  ) {
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async me(@CurrentUser() userId: string) {
    return this.auth.getProfile(userId);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async update(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(updateProfile)) body: z.infer<typeof updateProfile>,
  ) {
    return this.auth.updateProfile(userId, body);
  }

  /** Required by Play Store policy and the DPDP Act 2023. */
  @Delete('me')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async deleteAccount(@CurrentUser() userId: string) {
    return this.auth.requestDeletion(userId);
  }
}

@ApiTags('admin')
@Controller('admin/auth')
@UseGuards(RateLimitGuard)
export class AdminAuthController {
  constructor(private readonly auth: AuthService) {}

  /** Brute-force protection on staff credentials. */
  @Post('login')
  @RateLimited({ limit: 10, windowSeconds: 900 })
  async login(@Body(new ZodValidationPipe(adminLogin)) body: z.infer<typeof adminLogin>) {
    return this.auth.adminLogin(body.email, body.password);
  }

  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshRequest)) body: z.infer<typeof refreshRequest>,
  ) {
    return this.auth.refresh(body.refreshToken);
  }
}

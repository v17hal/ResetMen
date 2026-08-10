import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AdminBookingsController } from './admin/admin-bookings.controller.js';
import { AdminCatalogController } from './admin/admin-catalog.controller.js';
import { AdminCatalogService } from './admin/admin-catalog.service.js';
import { AdminCustomersController, AdminStaffController } from './admin/admin-people.controller.js';
import { AdminCustomersService } from './admin/admin-customers.service.js';
import { AdminAuditController, AdminPaymentsController } from './admin/admin-payments.controller.js';
import { AdminProductsController } from './admin/admin-products.controller.js';
import { AdminProductsService } from './admin/admin-products.service.js';
import { AdminRewardsController } from './admin/admin-rewards.controller.js';
import { AdminRewardsService } from './admin/admin-rewards.service.js';
import { AdminStaffService } from './admin/admin-staff.service.js';
import { CapacityController } from './admin/capacity.controller.js';
import { CapacityService } from './admin/capacity.service.js';
import { ReportsController } from './admin/reports.controller.js';
import { ReportsService } from './admin/reports.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityController } from './availability/availability.controller.js';
import { AvailabilityService } from './availability/availability.service.js';
import { ScheduleResolverService } from './availability/schedule-resolver.service.js';
import { BookingLifecycleService } from './booking/booking-lifecycle.service.js';
import { BookingController } from './booking/booking.controller.js';
import { BookingService } from './booking/booking.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { CheckinController } from './checkin/checkin.controller.js';
import { CheckinService } from './checkin/checkin.service.js';
import { CommonModule } from './common/common.module.js';
import { loadEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { BookingJobs } from './jobs/booking.jobs.js';
import { PrivacyJobs } from './jobs/privacy.jobs.js';
import { MediaAdminController, MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import {
  EmailProvider,
  SmsProvider,
  WhatsAppProvider,
} from './notifications/channel.providers.js';
import { FcmProvider } from './notifications/fcm.provider.js';
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationJobs } from './notifications/notification.jobs.js';
import { NotificationService } from './notifications/notification.service.js';
import { PaymentController } from './payments/payment.controller.js';
import { PaymentJobs } from './payments/payment.jobs.js';
import { PaymentService } from './payments/payment.service.js';
import { RazorpayClient } from './payments/razorpay.client.js';
import { WebhookController } from './payments/webhook.controller.js';
import { ProductController, ProductOrderController } from './products/product.controller.js';
import { ProductJobs } from './products/product.jobs.js';
import { ProductService } from './products/product.service.js';
import { RewardsController } from './rewards/rewards.controller.js';
import { RewardsJobs } from './rewards/rewards.jobs.js';
import { RewardsService } from './rewards/rewards.service.js';
import { ScratchService } from './rewards/scratch.service.js';
import { StreakService } from './rewards/streak.service.js';

/**
 * A modular monolith with hard internal boundaries.
 *
 * `capacity`, `availability` and `booking` share a transactional invariant and must never be
 * split apart. Everything else can be extracted later; the module boundaries exist for
 * exactly that reason.
 *
 * The dependency graph between the newer modules is deliberately acyclic:
 *
 *     notifications ← rewards ← checkin ← booking/lifecycle ← payments
 *                            ↖──────────── booking (discount at checkout)
 *
 * Nothing points back up. `rewards` reads services and add-ons directly rather than calling
 * `BookingService.quote`, which would close the loop and make the two impossible to separate.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The process refuses to start on a bad config, rather than failing at 2 a.m.
      validate: loadEnv,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    // Before AuthModule: its controllers use the rate-limit guard, which needs Redis.
    CommonModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    CatalogController,
    AvailabilityController,
    BookingController,
    CheckinController,
    PaymentController,
    WebhookController,
    RewardsController,
    NotificationController,
    ProductController,
    ProductOrderController,
    MediaController,
    // Admin surface.
    CapacityController,
    AdminBookingsController,
    AdminCatalogController,
    AdminCustomersController,
    AdminStaffController,
    AdminRewardsController,
    AdminProductsController,
    AdminPaymentsController,
    AdminAuditController,
    ReportsController,
    MediaAdminController,
  ],
  providers: [
    CatalogService,
    ScheduleResolverService,
    AvailabilityService,
    BookingService,
    BookingLifecycleService,
    CheckinService,
    CapacityService,
    // Payments.
    RazorpayClient,
    PaymentService,
    // Rewards.
    RewardsService,
    ScratchService,
    StreakService,
    // Notifications. Push is primary; SMS and WhatsApp are fallbacks, email is additive.
    FcmProvider,
    SmsProvider,
    WhatsAppProvider,
    EmailProvider,
    NotificationService,
    // Storefront and media.
    ProductService,
    MediaService,
    // Admin services.
    AdminCatalogService,
    AdminCustomersService,
    AdminStaffService,
    AdminRewardsService,
    AdminProductsService,
    ReportsService,
    // Scheduled work.
    BookingJobs,
    PrivacyJobs,
    PaymentJobs,
    RewardsJobs,
    NotificationJobs,
    ProductJobs,
  ],
})
export class AppModule {}

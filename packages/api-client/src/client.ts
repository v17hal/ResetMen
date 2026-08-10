import { HttpClient, type HttpClientOptions } from './http.js';
import {
  AdminAuditResource,
  AdminAuthResource,
  AdminBookingsResource,
  AdminCapacityResource,
  AdminCatalogResource,
  AdminCheckinResource,
  AdminCustomersResource,
  AdminMediaResource,
  AdminPaymentsResource,
  AdminProductsResource,
  AdminReportsResource,
  AdminRewardsResource,
  AdminStaffResource,
} from './resources/admin.js';
import {
  AuthResource,
  AvailabilityResource,
  BookingsResource,
  CatalogResource,
  NotificationsResource,
  PaymentsResource,
  ProductsResource,
  RewardsResource,
} from './resources/customer.js';

/**
 * The customer-facing client, for the web app and anything else a signed-in customer uses.
 *
 * ```ts
 * const reset = new ResetClient({ baseUrl: 'https://api.reset.app' });
 * const home = await reset.catalog.home();
 * ```
 */
export class ResetClient {
  readonly http: HttpClient;

  readonly auth: AuthResource;
  readonly catalog: CatalogResource;
  readonly availability: AvailabilityResource;
  readonly bookings: BookingsResource;
  readonly payments: PaymentsResource;
  readonly rewards: RewardsResource;
  readonly products: ProductsResource;
  readonly notifications: NotificationsResource;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient({ audience: 'customer', ...options });

    this.auth = new AuthResource(this.http);
    this.catalog = new CatalogResource(this.http);
    this.availability = new AvailabilityResource(this.http);
    this.bookings = new BookingsResource(this.http);
    this.payments = new PaymentsResource(this.http);
    this.rewards = new RewardsResource(this.http);
    this.products = new ProductsResource(this.http);
    this.notifications = new NotificationsResource(this.http);
  }

  get isAuthenticated(): boolean {
    return this.http.isAuthenticated;
  }
}

/**
 * The staff client.
 *
 * Separate from `ResetClient` rather than a flag on it, because the two hold different
 * tokens against different refresh endpoints. One object holding both would eventually
 * send a customer's token to an admin route, and the failure would look like a permissions
 * bug rather than a client bug.
 */
export class ResetAdminClient {
  readonly http: HttpClient;

  readonly auth: AdminAuthResource;
  readonly bookings: AdminBookingsResource;
  readonly checkin: AdminCheckinResource;
  readonly catalog: AdminCatalogResource;
  readonly capacity: AdminCapacityResource;
  readonly customers: AdminCustomersResource;
  readonly staff: AdminStaffResource;
  readonly rewards: AdminRewardsResource;
  readonly payments: AdminPaymentsResource;
  readonly products: AdminProductsResource;
  readonly reports: AdminReportsResource;
  readonly media: AdminMediaResource;
  readonly audit: AdminAuditResource;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient({ audience: 'admin', ...options });

    this.auth = new AdminAuthResource(this.http);
    this.bookings = new AdminBookingsResource(this.http);
    this.checkin = new AdminCheckinResource(this.http);
    this.catalog = new AdminCatalogResource(this.http);
    this.capacity = new AdminCapacityResource(this.http);
    this.customers = new AdminCustomersResource(this.http);
    this.staff = new AdminStaffResource(this.http);
    this.rewards = new AdminRewardsResource(this.http);
    this.payments = new AdminPaymentsResource(this.http);
    this.products = new AdminProductsResource(this.http);
    this.reports = new AdminReportsResource(this.http);
    this.media = new AdminMediaResource(this.http);
    this.audit = new AdminAuditResource(this.http);
  }

  get isAuthenticated(): boolean {
    return this.http.isAuthenticated;
  }
}

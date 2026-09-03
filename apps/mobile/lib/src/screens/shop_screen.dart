import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/generated/reset_enums.dart';
import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'phone_required_sheet.dart';
import 'sign_in_sheet.dart';

/// The retail shelf, and the orders placed from it.
///
/// The app had no shop at all — the API and the website have both had one throughout, so
/// anyone on Android simply could not buy a product. This is the web screen's flow, with
/// one thing done differently on purpose.
///
/// The website ran the payment path whether or not payments were switched on. In production
/// that created the order, took the stock off the shelf, and then failed: with no gateway
/// keys the payment endpoint reports itself simulated, and simulation refuses to run in
/// production. The customer saw an error for an order that had been placed. Here — and now
/// there too — an order placed while payment happens at the counter is simply an order, and
/// the customer is told to pay when they collect.
class ShopScreen extends ConsumerStatefulWidget {
  const ShopScreen({super.key});

  @override
  ConsumerState<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends ConsumerState<ShopScreen> {
  /// Product id → quantity. Deliberately not persisted: these are things picked up on the
  /// way out, and a basket that survives a week only ever surprises somebody with a stale
  /// price at the counter.
  final Map<String, int> _cart = {};

  String _orderKey = _randomKey();
  bool _placing = false;

  static String _randomKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return 'order-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  int _qty(String productId) => _cart[productId] ?? 0;

  void _add(Product product) {
    setState(() => _cart[product.id] = min(_qty(product.id) + 1, 20));
  }

  void _remove(Product product) {
    setState(() {
      final next = _qty(product.id) - 1;
      if (next <= 0) {
        _cart.remove(product.id);
      } else {
        _cart[product.id] = next;
      }
    });
  }

  Future<void> _placeOrder(List<Product> products) async {
    if (_cart.isEmpty) return;

    // Signed in first: an order has to belong to somebody who can be told it is ready.
    if (ref.read(sessionProvider).valueOrNull == null) {
      final signedIn = await showSignInSheet(
        context,
        reason: 'So we can tell you when your order is ready to collect.',
      );
      if (!signedIn || !mounted) return;
    }

    setState(() => _placing = true);

    try {
      await ref.read(repositoryProvider).createProductOrder(
            quantities: Map<String, int>.from(_cart),
            idempotencyKey: _orderKey,
          );

      if (!mounted) return;
      setState(() {
        _cart.clear();
        _placing = false;
        // A fresh key, or the next order replays this one's response instead of being
        // placed.
        _orderKey = _randomKey();
      });

      ref.invalidate(productOrdersProvider);
      ref.invalidate(productsProvider);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ordered. Pay at the store when you collect it.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _placing = false);

      // The store has no number for this account, and an order it cannot tell anyone about
      // is not much of an order. Same prompt the booking flow uses.
      if (error is ResetApiException && error.needsPhone) {
        final saved = await showPhoneRequiredSheet(
          context,
          reason: 'The store rings this number when your order is ready to collect.',
        );
        if (saved && mounted) await _placeOrder(products);
        return;
      }

      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyMessage(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final products = ref.watch(productsProvider);
    final orders = ref.watch(productOrdersProvider);

    final chosen = products.valueOrNull ?? const <Product>[];
    final total = chosen.fold<int>(
      0,
      (sum, product) => sum + product.pricePaise * _qty(product.id),
    );
    final count = _cart.values.fold<int>(0, (sum, qty) => sum + qty);

    return Scaffold(
      appBar: AppBar(title: const Text('Shop')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(productsProvider);
          ref.invalidate(productOrdersProvider);
        },
        child: products.when(
          loading: () => const SkeletonList(
            rows: 4,
            height: 96,
            padding: EdgeInsets.all(ResetTokens.gutter),
          ),
          error: (error, _) => ErrorView(
            error: error,
            onRetry: () => ref.invalidate(productsProvider),
          ),
          data: (list) => ListView(
            padding: const EdgeInsets.all(ResetTokens.gutter),
            children: [
              if (list.isEmpty)
                const EmptyState(
                  title: 'Nothing on the shelf yet',
                  message: 'Products the store stocks will appear here.',
                )
              else
                for (final product in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: ResetTokens.spaceSm),
                    child: _ProductTile(
                      product: product,
                      qty: _qty(product.id),
                      onAdd: () => _add(product),
                      onRemove: () => _remove(product),
                    ),
                  ),

              // Orders already placed, so somebody can check what they still owe for.
              if ((orders.valueOrNull ?? const <ProductOrder>[]).isNotEmpty) ...[
                const SizedBox(height: ResetTokens.spaceXl),
                Text('Your orders', style: ResetTokens.h2),
                const SizedBox(height: ResetTokens.spaceSm),
                for (final order in orders.value!)
                  Padding(
                    padding: const EdgeInsets.only(bottom: ResetTokens.spaceSm),
                    child: _OrderTile(order: order),
                  ),
              ],

              // Clear of the sticky bar, which would otherwise cover the last row.
              SizedBox(height: count == 0 ? ResetTokens.spaceXl : 120),
            ],
          ),
        ),
      ),
      bottomNavigationBar: count == 0
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(ResetTokens.gutter),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    PrimaryButton(
                      label: '$count item${count == 1 ? '' : 's'} · '
                          '${formatMoney(total)} — Place order',
                      loading: _placing,
                      onPressed: () => _placeOrder(chosen),
                    ),
                    const SizedBox(height: ResetTokens.spaceXs),
                    Text(
                      // Said before ordering, not after.
                      'Pay at the store when you collect.',
                      style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({
    required this.product,
    required this.qty,
    required this.onAdd,
    required this.onRemove,
  });

  final Product product;
  final int qty;
  final VoidCallback onAdd;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ResetCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.name, style: ResetTokens.body.copyWith(fontWeight: FontWeight.w600)),
                if (product.description != null && product.description!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    product.description!,
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: ResetTokens.spaceXs),
                Row(
                  children: [
                    Text(formatMoney(product.pricePaise), style: ResetTokens.body.copyWith(fontWeight: FontWeight.w600)),
                    if (product.hasDiscount) ...[
                      const SizedBox(width: ResetTokens.spaceXs),
                      Text(
                        formatMoney(product.mrpPaise!),
                        style: ResetTokens.caption.copyWith(
                          color: theme.mutedColor,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: ResetTokens.spaceSm),

          if (!product.inStock)
            ResetBadge('Out of stock', color: theme.mutedColor)
          else if (qty == 0)
            OutlinedButton(onPressed: onAdd, child: const Text('Add'))
          else
            Row(
              children: [
                IconButton(
                  onPressed: onRemove,
                  icon: const Icon(Icons.remove_circle_outline),
                  tooltip: 'One fewer',
                ),
                Text('$qty', style: ResetTokens.body.copyWith(fontWeight: FontWeight.w600)),
                IconButton(
                  // Twenty is the API's per-line cap; offering a button that will be
                  // refused is worse than a button that stops.
                  onPressed: qty >= 20 ? null : onAdd,
                  icon: const Icon(Icons.add_circle_outline),
                  tooltip: 'One more',
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order});

  final ProductOrder order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    /// "Pending" tells a customer nothing. An unpaid order is waiting on them to come and
    /// pay for it, so it says that — the same words the website uses.
    final (label, color) = switch (order.status) {
      ProductOrderStatus.pending => ('Pay at the store', theme.warningColor),
      ProductOrderStatus.paid => ('Paid', theme.successColor),
      ProductOrderStatus.readyForPickup => ('Ready to collect', theme.successColor),
      ProductOrderStatus.pickedUp => ('Collected', theme.mutedColor),
      ProductOrderStatus.cancelled => ('Cancelled', theme.mutedColor),
      null => ('—', theme.mutedColor),
    };

    return ResetCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(formatBookingCode(order.publicId), style: ResetTokens.body.copyWith(fontWeight: FontWeight.w600)),
              ),
              ResetBadge(label, color: color),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            order.items.map((line) => '${line.qty}× ${line.name}').join(', '),
            style: ResetTokens.caption.copyWith(color: theme.mutedColor),
          ),
          const SizedBox(height: ResetTokens.spaceXs),
          Text(formatMoney(order.totalPaise), style: ResetTokens.body),
        ],
      ),
    );
  }
}

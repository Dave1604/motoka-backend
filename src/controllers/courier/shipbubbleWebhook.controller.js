import { logError, logInfo, logWarn } from '../../utils/logger.js';
import { applyShipbubbleWebhookEvent } from '../../services/courier/shipment.service.js';

/**
 * POST /api/webhooks/shipbubble
 * Always return 200 quickly so Shipbubble does not retry forever on unknown orders.
 */
export const handleShipbubbleWebhook = async (req, res) => {
  const started = Date.now();
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const event = payload.event || payload.type || 'shipment.status.changed';
    const orderId = payload.order_id || payload.data?.order_id || null;

    logInfo('[Shipbubble Webhook] Event', {
      event,
      orderId,
      status: payload.status,
    });

    const result = await applyShipbubbleWebhookEvent(payload);

    logInfo('[Shipbubble Webhook] Processed', {
      event,
      orderId,
      updated: Boolean(result?.updated),
      shipmentId: result?.shipmentId || null,
      ms: Date.now() - started,
    });

    return res.status(200).json({
      status: true,
      message: 'Webhook received',
      data: {
        event,
        order_id: orderId,
        updated: Boolean(result?.updated),
      },
    });
  } catch (error) {
    logError('[Shipbubble Webhook] Handler error', {
      message: error.message,
      stack: error.stack,
    });
    // Acknowledge anyway — Shipbubble retries failed delivery for ~5 attempts.
    // Returning 200 avoids hammering Motoka when our DB is briefly down after we already logged.
    logWarn('[Shipbubble Webhook] Returning 200 after error to stop retry storm');
    return res.status(200).json({
      status: false,
      message: 'Webhook accepted with processing error',
    });
  }
};

export default handleShipbubbleWebhook;

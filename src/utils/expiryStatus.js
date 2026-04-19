const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLD_DAYS = 30;

const toUtcDateStart = (date) => {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/**
 * Build expiry status with pending order awareness
 * 
 * @param {string|Date} expiryDate - Document expiry date
 * @param {Date} now - Current date (for testing)
 * @param {Object|null} pendingOrder - Pending renewal order if exists
 * @returns {Object} Expiry status object
 */
export const buildExpiryStatus = (expiryDate, now = new Date(), pendingOrder = null) => {
  // Condition 1: expiry_date is NULL
  if (!expiryDate) {
    if (pendingOrder) {
      return {
        message: 'Renewal in progress',
        days_left: null,
        status: 'renewal_pending',
        is_urgent: false,
        is_expired: false,
        expires_today: false,
        has_pending_order: true,
        order_number: pendingOrder.order_number
      };
    }
    return {
      message: 'Up to date',
      days_left: null,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    };
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    if (pendingOrder) {
      return {
        message: 'Renewal in progress',
        days_left: null,
        status: 'renewal_pending',
        is_urgent: false,
        is_expired: false,
        expires_today: false,
        has_pending_order: true,
        order_number: pendingOrder.order_number
      };
    }
    return {
      message: 'Invalid expiry date',
      days_left: null,
      status: 'invalid',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    };
  }

  const todayUtc = toUtcDateStart(now);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const diffDays = Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
  const expiresToday = diffDays === 0;
  const isExpired = diffDays < 0;
  const isUrgent = diffDays <= 3;

  if (pendingOrder) {
    return {
      message: 'Renewal in progress',
      days_left: diffDays,
      status: 'renewal_pending',
      is_urgent: false,
      is_expired: isExpired,
      expires_today: expiresToday,
      has_pending_order: true,
      order_number: pendingOrder.order_number
    };
  }

  // Condition 4: Today > expiry_date (overdue)
  if (isExpired) {
    const daysOverdue = Math.abs(diffDays);
    return {
      message: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`,
      days_left: diffDays,
      status: 'overdue',
      is_urgent: true,
      is_expired: true,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    };
  }

  // Condition 2: Today < expiry_date - 30 days (more than 30 days remaining)
  if (diffDays > REMINDER_THRESHOLD_DAYS) {
    return {
      message: 'Up to date',
      days_left: diffDays,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false,
      has_pending_order: false,
      order_number: null
    };
  }

  // Condition 3: Today >= expiry_date - 30 days AND Today <= expiry_date
  // (0 to 30 days remaining, inclusive)
  return {
    message: expiresToday ? 'Expires today' : `${diffDays} day${diffDays === 1 ? '' : 's'} to expire`,
    days_left: diffDays,
    status: 'reminder',
    is_urgent: isUrgent,
    is_expired: false,
    expires_today: expiresToday,
    has_pending_order: false,
    order_number: null
  };
};

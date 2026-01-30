const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLD_DAYS = 30;

const toUtcDateStart = (date) => {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export const buildExpiryStatus = (expiryDate, now = new Date()) => {
  // Condition 1: expiry_date is NULL
  if (!expiryDate) {
    return {
      message: 'No reminder available',
      days_left: null,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false
    };
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return {
      message: 'Invalid expiry date',
      days_left: null,
      status: 'invalid',
      is_urgent: false,
      is_expired: false,
      expires_today: false
    };
  }

  const todayUtc = toUtcDateStart(now);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const diffDays = Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
  const expiresToday = diffDays === 0;
  const isExpired = diffDays < 0;
  const isUrgent = diffDays <= 3;

  // Condition 4: Today > expiry_date (overdue)
  if (isExpired) {
    return {
      message: 'Overdue',
      days_left: diffDays,
      status: 'overdue',
      is_urgent: true,
      is_expired: true,
      expires_today: false
    };
  }

  // Condition 2: Today < expiry_date - 30 days (more than 30 days remaining)
  if (diffDays > REMINDER_THRESHOLD_DAYS) {
    return {
      message: 'No reminder available',
      days_left: diffDays,
      status: 'no_reminder',
      is_urgent: false,
      is_expired: false,
      expires_today: false
    };
  }

  // Condition 3: Today >= expiry_date - 30 days AND Today <= expiry_date
  // (0 to 30 days remaining, inclusive)
  return {
    message: expiresToday ? 'Expires today' : `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`,
    days_left: diffDays,
    status: 'reminder',
    is_urgent: isUrgent,
    is_expired: false,
    expires_today: expiresToday
  };
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLD_DAYS = 30;

const toUtcDateStart = (date) => {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export const buildExpiryStatus = (expiryDate, now = new Date()) => {
  // Condition 1: expiry_date is NULL
  if (!expiryDate) {
    return {
      status: 'no_reminder',
      days_remaining: null,
      label: 'No reminder available'
    };
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return {
      status: 'invalid',
      days_remaining: null,
      label: 'Invalid expiry date'
    };
  }

  const todayUtc = toUtcDateStart(now);
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const diffDays = Math.round((expiryUtc - todayUtc) / MS_PER_DAY);

  // Condition 4: Today > expiry_date (overdue)
  if (diffDays < 0) {
    return {
      status: 'overdue',
      days_remaining: diffDays,
      label: 'Overdue'
    };
  }

  // Condition 2: Today < expiry_date - 30 days (more than 30 days remaining)
  if (diffDays > REMINDER_THRESHOLD_DAYS) {
    return {
      status: 'no_reminder',
      days_remaining: diffDays,
      label: 'No reminder available'
    };
  }

  // Condition 3: Today >= expiry_date - 30 days AND Today <= expiry_date
  // (0 to 30 days remaining, inclusive)
  return {
    status: 'reminder',
    days_remaining: diffDays,
    label: `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`
  };
};

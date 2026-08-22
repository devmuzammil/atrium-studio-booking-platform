export function formatMoney(amountMinor: number, currency = 'PKR'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function toIsoLocal(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)).toISOString();
}

export function roundToHalfHour(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  const minutes = copy.getUTCMinutes();
  const rounded = minutes < 15 ? 0 : minutes < 45 ? 30 : 60;
  if (rounded === 60) {
    copy.setUTCHours(copy.getUTCHours() + 1, 0, 0, 0);
  } else {
    copy.setUTCMinutes(rounded, 0, 0);
  }
  return copy;
}

export function amenitiesList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

export function friendlyApiMessage(status: number, message: string): string {
  if (status === 409) {
    if (/room|unavailable|equipment|conflict/i.test(message)) {
      return 'That room or equipment was just taken. Please choose another time or room.';
    }
    if (/hold has expired|expired/i.test(message)) {
      return 'This hold has expired. Please search again and create a new booking.';
    }
    if (/not available for payment|payment/i.test(message)) {
      return 'This booking is not available for payment right now.';
    }
    return message || 'This action conflicts with the current booking state.';
  }
  return message;
}

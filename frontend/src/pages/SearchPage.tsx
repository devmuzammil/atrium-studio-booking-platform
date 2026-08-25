import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { searchRooms } from '../api/bookings';
import { ApiError } from '../api/client';
import type { AvailableRoom } from '../types';
import { Alert, EmptyState, LoadingSpinner } from '../components/ui';
import { amenitiesList, formatMoney, friendlyApiMessage, toIsoLocal } from '../utils/format';

function defaultSearchWindow(): { date: string; startTime: string; endTime: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 2);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const date = start.toISOString().slice(0, 10);
  return {
    date,
    startTime: start.toISOString().slice(11, 16),
    endTime: end.toISOString().slice(11, 16),
  };
}

export function SearchPage() {
  const defaults = useMemo(() => defaultSearchWindow(), []);
  const [city, setCity] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [minCapacity, setMinCapacity] = useState('1');
  const [amenities, setAmenities] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const start = toIsoLocal(date, startTime);
      const end = toIsoLocal(date, endTime);
      const result = await searchRooms({
        start,
        end,
        city: city || undefined,
        minCapacity: minCapacity ? Number(minCapacity) : undefined,
        amenities: amenities || undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
      });
      setRooms(result.rooms);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setRooms([]);
      setError(apiError ? friendlyApiMessage(apiError.status, apiError.message) : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">Find a Studio</h2>
        <p className="mt-1 text-slate-600">Find a room that fits your schedule, group size, and budget.</p>
      </header>

      <form onSubmit={onSearch} className="grid gap-4 rounded-2xl border border-[#d9d2c5] bg-white/80 p-5 shadow-sm md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">
          City
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Karachi, Dubai, London" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Date
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Min capacity
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="number" min={1} value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Start (UTC)
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="time" step={1800} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </label>
        <label className="text-sm font-medium text-slate-700">
          End (UTC)
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="time" step={1800} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Max hourly price (minor)
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="number" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="e.g. 10000" />
        </label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Amenities
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="e.g. quiet, daylight" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#14213d] px-4 py-2.5 font-medium text-white hover:bg-[#1d2f55] disabled:opacity-60">
            {loading ? 'Searching…' : 'Search availability'}
          </button>
        </div>
      </form>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading ? <LoadingSpinner label="Checking availability…" /> : null}

      {!loading && searched && rooms.length === 0 && !error ? (
        <EmptyState title="No rooms available" detail="Try another city, time window, or capacity filter." />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {rooms.map((room) => (
          <article key={room.id} className="rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{room.name}</h3>
                <p className="text-sm text-slate-600">{room.venueName} · {room.city}</p>
              </div>
              <p className="text-sm font-semibold text-[#c45c26]">{formatMoney(room.hourlyRateMinor, room.currency)}/hr</p>
            </div>
            <p className="mt-3 text-sm text-slate-700">Capacity {room.capacity}</p>
            <p className="mt-1 text-sm text-slate-600">{amenitiesList(room.amenities).join(' · ') || 'No amenities listed'}</p>
            <p className="mt-2 text-xs text-slate-500">Requested window: {date} {startTime}–{endTime} UTC</p>
            <Link
              to={`/book/${room.id}`}
              state={{ room, start: toIsoLocal(date, startTime), end: toIsoLocal(date, endTime) }}
              className="mt-4 inline-flex rounded-lg bg-[#c45c26] px-4 py-2 text-sm font-medium text-white hover:bg-[#a84c1f]"
            >
              Select room
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

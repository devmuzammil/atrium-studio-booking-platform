import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createHold, listEquipment } from '../api/bookings';
import { ApiError } from '../api/client';
import type { AvailableRoom, EquipmentType } from '../types';
import { Alert, LoadingSpinner } from '../components/ui';
import { amenitiesList, formatMoney, friendlyApiMessage, toIsoLocal } from '../utils/format';

interface BookLocationState {
  room?: AvailableRoom;
  start?: string;
  end?: string;
}

export function BookPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as BookLocationState | null) ?? {};
  const room = state.room;

  const initialStart = state.start ? new Date(state.start) : null;
  const initialEnd = state.end ? new Date(state.end) : null;

  const [date, setDate] = useState(initialStart?.toISOString().slice(0, 10) ?? '');
  const [startTime, setStartTime] = useState(initialStart?.toISOString().slice(11, 16) ?? '10:00');
  const [endTime, setEndTime] = useState(initialEnd?.toISOString().slice(11, 16) ?? '12:00');
  const [equipment, setEquipment] = useState<EquipmentType[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();

  useEffect(() => {
    if (!room?.venueId) return;
    let cancelled = false;
    async function load(): Promise<void> {
      setLoadingEquipment(true);
      try {
        const result = await listEquipment(room!.venueId);
        if (!cancelled) setEquipment(result.equipment);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof ApiError ? err.message : 'Unable to load equipment';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoadingEquipment(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [room]);

  const durationHours = useMemo(() => {
    if (!date) return 0;
    const start = new Date(toIsoLocal(date, startTime));
    const end = new Date(toIsoLocal(date, endTime));
    return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
  }, [date, startTime, endTime]);

  const roomAmount = room ? Math.round(room.hourlyRateMinor * durationHours) : 0;
  const equipmentAmount = equipment.reduce((total, item) => {
    const quantity = quantities[item.id] ?? 0;
    return total + Math.round(item.hourlyRateMinor * quantity * durationHours);
  }, 0);
  const total = roomAmount + equipmentAmount;

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!roomId || !room) return;
    if (durationHours < 1 || durationHours > 8) {
      setError('Duration must be between 1 and 8 hours.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setCorrelationId(undefined);
    try {
      const selectedEquipment = Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([equipmentTypeId, quantity]) => ({ equipmentTypeId, quantity }));
      const result = await createHold({
        roomId,
        start: toIsoLocal(date, startTime),
        end: toIsoLocal(date, endTime),
        equipment: selectedEquipment,
      });
      navigate(`/checkout/${result.booking.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(friendlyApiMessage(err.status, err.message));
        setCorrelationId(err.correlationId);
      } else {
        setError('Unable to create hold');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!room || room.id !== roomId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Alert tone="warning" title="Room selection required">
          Start from search so the booking uses a backend-confirmed available room.
        </Alert>
        <Link to="/search" className="inline-flex rounded-lg bg-[#14213d] px-4 py-2 text-sm text-white">Back to search</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-sm text-slate-500">{room.venueName} · {room.city}</p>
        <h2 className="text-3xl font-semibold text-slate-900">Book {room.name}</h2>
        <p className="mt-1 text-slate-600">Capacity {room.capacity} · {amenitiesList(room.amenities).join(', ') || 'No amenities'}</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-[#d9d2c5] bg-white/80 p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Date
            <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Start (UTC)
            <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="time" step={1800} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </label>
          <label className="text-sm font-medium text-slate-700">
            End (UTC)
            <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="time" step={1800} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </label>
        </div>

        <section>
          <h3 className="text-lg font-semibold text-slate-900">Equipment (optional)</h3>
          {loadingEquipment ? <div className="mt-3"><LoadingSpinner label="Loading equipment…" /></div> : null}
          <div className="mt-3 space-y-3">
            {equipment.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ece7de] px-3 py-3">
                <div>
                  <p className="font-medium text-slate-800">{item.name}</p>
                  <p className="text-sm text-slate-600">{formatMoney(item.hourlyRateMinor, item.currency)}/hr · {item.totalUnits} units</p>
                </div>
                <label className="text-sm text-slate-700">
                  Qty
                  <input
                    className="ml-2 w-20 rounded-lg border border-[#d9d2c5] px-2 py-1"
                    type="number"
                    min={0}
                    max={item.totalUnits}
                    value={quantities[item.id] ?? 0}
                    onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))}
                  />
                </label>
              </div>
            ))}
            {!loadingEquipment && equipment.length === 0 ? <p className="text-sm text-slate-600">No equipment listed for this venue.</p> : null}
          </div>
        </section>

        <section className="rounded-xl bg-[#f7f4ef] px-4 py-3 text-sm text-slate-700">
          <p>Duration: {durationHours.toFixed(1)} hours</p>
          <p>Room: {formatMoney(roomAmount, room.currency)}</p>
          <p>Equipment: {formatMoney(equipmentAmount, room.currency)}</p>
          <p className="mt-1 text-base font-semibold text-slate-900">Estimated total: {formatMoney(total, room.currency)}</p>
          <p className="mt-1 text-xs text-slate-500">Final amount is calculated by the backend when the hold is created.</p>
        </section>

        {error ? (
          <Alert tone="danger" title="Could not create hold">
            <p>{error}</p>
            {correlationId ? <p className="mt-1 text-xs">Request ID: {correlationId}</p> : null}
          </Alert>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-[#c45c26] px-4 py-2.5 font-medium text-white hover:bg-[#a84c1f] disabled:opacity-60"
        >
          {submitting ? 'Creating hold…' : 'Place hold'}
        </button>
      </form>
    </div>
  );
}

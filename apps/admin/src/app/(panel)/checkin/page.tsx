'use client';

import type { CheckinResult } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  Input,
  formatBookingCode,
  formatDuration,
  formatPhone,
  formatTime,
  useToast,
} from '@reset/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { QrScanner } from '@/components/qr-scanner';
import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

/**
 * The counter screen.
 *
 * Two ways in, both always available. The camera is faster, and it fails often enough —
 * cracked screen, dead battery, a phone that will not brighten in daylight — that manual
 * entry is not a fallback tucked behind a link. The queue does not stop.
 */
export default function CheckinPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);

  const onSuccess = (checkin: CheckinResult): void => {
    setResult(checkin);
    setError(null);
    setCode('');
    setScanning(false);
    toast.success(`${checkin.customerName ?? 'Customer'} checked in.`);
    void queryClient.invalidateQueries({ queryKey: keys.dashboard });
    void queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

  const onError = (caught: unknown): void => {
    setResult(null);
    setError(errorMessage(caught, 'That code could not be checked in.'));
  };

  const scan = useMutation({
    mutationFn: (token: string) => adminClient().checkin.scan(token),
    onSuccess,
    onError,
  });

  const manual = useMutation({
    mutationFn: (publicId: string) => adminClient().checkin.manual(publicId),
    onSuccess,
    onError,
  });

  function onManualSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed !== '') manual.mutate(trimmed);
  }

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-display text-h1">Check in</h1>
        <p className="text-body-sm text-text-muted">
          Scan the customer&rsquo;s QR, or type their booking code.
        </p>
      </header>

      <div className="grid gap-base lg:grid-cols-2">
        <Card className="flex flex-col gap-base">
          <h2 className="font-display text-h2">Scan</h2>

          {scanning ? (
            <QrScanner
              onDetect={(token) => scan.mutate(token)}
              onError={(message) => {
                setScanning(false);
                setError(message);
              }}
              busy={scan.isPending}
            />
          ) : (
            <Button size="lg" onClick={() => setScanning(true)}>
              Open camera
            </Button>
          )}

          {scanning && (
            <Button variant="secondary" onClick={() => setScanning(false)}>
              Stop
            </Button>
          )}
        </Card>

        <Card className="flex flex-col gap-base">
          <h2 className="font-display text-h2">Booking code</h2>
          <form onSubmit={onManualSubmit} className="flex flex-col gap-base">
            <Input
              label="Code"
              placeholder="RST-2K8F4M"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono uppercase"
              hint="On the customer's confirmation screen and in their email."
            />
            <Button
              type="submit"
              size="lg"
              loading={manual.isPending}
              disabled={code.trim() === ''}
            >
              Check in
            </Button>
          </form>
        </Card>
      </div>

      {error !== null && (
        <Card className="border-danger/40 bg-danger/5">
          <p role="alert" className="text-body font-medium text-danger">
            {error}
          </p>
          <p className="mt-xs text-body-sm text-text-muted">
            A code only works once, and only around its slot time. If it was already scanned,
            the booking is already checked in.
          </p>
        </Card>
      )}

      {result !== null && <CheckinCard result={result} />}
    </div>
  );
}

/**
 * What the counter sees after a successful scan.
 *
 * Leads with the station, because the next thing anyone says out loud is where to go.
 */
function CheckinCard({ result }: { result: CheckinResult }) {
  return (
    <Card elevated className="flex flex-col gap-base border-success/40 bg-success/5">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <p className="font-display text-display">{result.stationName}</p>
          <p className="text-body text-text-muted">
            {result.customerName ?? 'Guest'}
            {result.customerPhone !== null && ` · ${formatPhone(result.customerPhone)}`}
          </p>
        </div>
        <Badge tone="success">Checked in</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-sm text-body-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">Service</dt>
          <dd className="font-medium">{result.serviceName}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Starts</dt>
          <dd className="font-medium">{formatTime(result.startsAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Duration</dt>
          <dd className="font-medium">{formatDuration(result.durationMinutes)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Code</dt>
          <dd className="font-mono">{formatBookingCode(result.publicId)}</dd>
        </div>
      </dl>

      {result.addons.length > 0 && (
        <div className="flex flex-wrap items-center gap-xs">
          <span className="text-body-sm text-text-muted">Add-ons:</span>
          {result.addons.map((addon) => (
            <Badge key={addon}>{addon}</Badge>
          ))}
        </div>
      )}

      {/* The reason the streak is on this screen at all: someone has to say it out loud. */}
      {result.streak !== null && (
        <div
          className={
            result.streak.milestoneReached
              ? 'rounded-md border border-accent/40 bg-accent/10 p-base'
              : 'rounded-md border border-border p-base'
          }
        >
          {result.streak.milestoneReached ? (
            <p className="text-body font-medium text-accent">
              Milestone reached — {result.streak.rewardLabel ?? 'reward earned'}. Tell them.
            </p>
          ) : (
            <p className="text-body-sm text-text-muted">
              Visit {result.streak.current}
              {result.streak.required !== null && ` of ${result.streak.required}`} towards their
              next reward.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

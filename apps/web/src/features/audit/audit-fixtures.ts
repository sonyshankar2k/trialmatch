import type { AuditEvent } from '@trialmatch/shared';

/** Week 9: sample events for tests and stories. */
export function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 1,
    at: '2026-11-21T10:00:00.000Z',
    actor: { id: 1, name: 'Alice Chen' },
    action: 'patient.update',
    entityType: 'patient',
    entityId: 5,
    label: 'P-0005',
    patientId: 5,
    trialId: null,
    changes: [
      { field: 'age', from: 40, to: 41 },
      { field: 'notes', redacted: true },
    ],
    details: {},
    requestId: 'req-1',
    ip: '10.0.0.7',
    ...overrides,
  };
}

export const sampleHistory: AuditEvent[] = [
  makeEvent({ id: 3 }),
  makeEvent({
    id: 2,
    action: 'patient.view',
    changes: [],
    at: '2026-11-21T09:30:00.000Z',
  }),
  makeEvent({
    id: 1,
    action: 'patient.create',
    at: '2026-11-20T15:00:00.000Z',
    changes: [
      { field: 'pseudonym', to: 'P-0005' },
      { field: 'conditions', to: ['Asthma', 'Hypertension'] },
    ],
  }),
];

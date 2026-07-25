import type { WizardStep } from '@onboarding/contracts';

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'DETAILS', label: 'Details' },
  { key: 'VALIDATE', label: 'Validate integration' },
  { key: 'REVIEW', label: 'Review and go live' },
];

const ORDER: WizardStep[] = ['DETAILS', 'VALIDATE', 'REVIEW', 'LIVE'];

export function Stepper({ current }: { current: WizardStep }) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <ol className="stepper" aria-label="Onboarding progress">
      {STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';

        return (
          <li key={step.key} className={`stepper-item is-${state}`}>
            <span className="stepper-index" aria-hidden="true">
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span>{step.label}</span>
            {state === 'current' && <span className="sr-only"> (current step)</span>}
          </li>
        );
      })}
    </ol>
  );
}

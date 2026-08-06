import * as React from 'react';

/**
 * Numbered step in a member flow (verify: connect → sign). A 24px accent circle
 * with the step number, then a bold title over a dimmed description.
 */
export interface StepProps extends React.HTMLAttributes<HTMLDivElement> {
  number: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Circle color. Default blurple; pass a success color for a completed step. */
  accent?: string;
}

export function Step(props: StepProps): JSX.Element;

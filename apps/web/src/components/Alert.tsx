import type { ReactNode } from 'react';

export function Alert({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {children ? <div className="alert-body">{children}</div> : null}
    </div>
  );
}

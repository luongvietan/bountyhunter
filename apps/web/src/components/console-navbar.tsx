import Link from 'next/link';
import type { ReactNode } from 'react';

export type ConsoleSection = 'targets' | 'merge-queue' | 'outcomes';

interface ConsoleNavbarProps {
  activeSection?: ConsoleSection;
  trailing?: ReactNode;
}

export function ConsoleNavbar({ activeSection, trailing }: ConsoleNavbarProps) {
  return (
    <header className="masthead">
      <div>
        <p className="product-name">Kritt Radar</p>
        <p className="console-label">Internal operator console</p>
      </div>
      <div className="masthead-end">
        <nav className="masthead-nav" aria-label="Console sections">
          <Link href="/targets" aria-current={activeSection === 'targets' ? 'page' : undefined}>
            Targets
          </Link>
          <Link
            href="/merge-queue"
            aria-current={activeSection === 'merge-queue' ? 'page' : undefined}
          >
            Merge queue
          </Link>
          <Link href="/outcomes" aria-current={activeSection === 'outcomes' ? 'page' : undefined}>
            Outcomes
          </Link>
        </nav>
        {trailing}
      </div>
    </header>
  );
}

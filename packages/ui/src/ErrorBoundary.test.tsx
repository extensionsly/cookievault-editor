import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.js';

const SCREEN = {
  title: 'Boom title',
  body: 'Boom body',
  retryLabel: 'Try again',
  reportLabel: 'Report',
  reportHref: 'https://example.test/issue',
};

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary screen={SCREEN}>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('renders the fatal screen and calls onError when a child throws', () => {
    const onError = vi.fn();
    // React logs the caught error to console.error; silence it for the test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary screen={SCREEN} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Boom title')).toBeTruthy();
    expect(screen.getByText('Boom body')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Report' }).getAttribute('href')).toBe(
      'https://example.test/issue',
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    spy.mockRestore();
  });

  it('a failing onError never escapes the boundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <ErrorBoundary
          screen={SCREEN}
          onError={() => {
            throw new Error('logger blew up');
          }}
        >
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    expect(screen.getByText('Boom title')).toBeTruthy();
    spy.mockRestore();
  });

  it('Retry clears the failed state and re-renders the subtree', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Maybe(): ReactElement {
      if (shouldThrow) throw new Error('first render');
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary screen={SCREEN}>
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Boom title')).toBeTruthy();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
    spy.mockRestore();
  });
});

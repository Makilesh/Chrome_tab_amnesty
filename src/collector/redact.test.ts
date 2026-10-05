import { describe, expect, it } from 'vitest';
import type { TabTrace } from '../cluster/types';
import { redactTrace, scrubText } from './redact';

describe('shareable redaction', () => {
  it('replaces anything shaped like an email address', () => {
    expect(scrubText('Page shared with you - someone.name+tag@gmail.com - Gmail')).toBe('Page shared with you - [email] - Gmail');
    expect(scrubText('kunal@user.luma-mail.com Unsubscribe')).toBe('[email] Unsubscribe');
    expect(scrubText('No address here @ all')).toBe('No address here @ all');
  });

  it('keeps what the clusterer needs and drops the rest', () => {
    const t = {
      url: 'https://mail.google.com/mail/u/0/?q=secret#inbox',
      title: 'Inbox - me@example.com',
      queryKeys: { q: 'secret' },
      digest: { description: 'from a@b.co', headings: ['Hi c@d.org', 'Plain'], leadText: 'private text' },
    } as unknown as TabTrace;
    const r = redactTrace(t);
    expect(r.url).toBe('https://mail.google.com/mail/u/0/');
    expect(r.title).toBe('Inbox - [email]');
    expect(r.queryKeys).toEqual({ q: '' });
    expect(r.digest).toEqual({ description: 'from [email]', headings: ['Hi [email]', 'Plain'], leadText: '' });
  });
});

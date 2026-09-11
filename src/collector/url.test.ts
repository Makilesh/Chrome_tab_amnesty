import { describe, expect, it } from 'vitest';
import { eTLD1, reduceUrl, urlFeatures } from './url';

describe('eTLD1', () => {
  it('plain two-label hosts', () => {
    expect(eTLD1('github.com')).toBe('github.com');
    expect(eTLD1('docs.github.com')).toBe('github.com');
  });
  it('private-section suffixes do not collapse unrelated sites', () => {
    expect(eTLD1('alice.github.io')).toBe('alice.github.io');
    expect(eTLD1('bob.github.io')).toBe('bob.github.io');
    expect(eTLD1('my-app.vercel.app')).toBe('my-app.vercel.app');
    expect(eTLD1('foo.pages.dev')).toBe('foo.pages.dev');
    expect(eTLD1('deep.sub.notion.site')).toBe('sub.notion.site');
  });
  it('icann multi-part suffixes', () => {
    expect(eTLD1('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(eTLD1('abc.net.au')).toBe('abc.net.au');
    expect(eTLD1('shop.example.co.jp')).toBe('example.co.jp');
  });
  it('longest suffix wins', () => {
    expect(eTLD1('bucket.s3.amazonaws.com')).toBe('bucket.s3.amazonaws.com');
  });
  it('unknown suffix falls back to last two labels', () => {
    expect(eTLD1('a.b.example.xyz')).toBe('example.xyz');
  });
  it('a host that is itself a suffix is returned unchanged', () => {
    expect(eTLD1('github.io')).toBe('github.io');
    expect(eTLD1('co.uk')).toBe('co.uk');
  });
  it('ip literals and localhost', () => {
    expect(eTLD1('127.0.0.1')).toBe('127.0.0.1');
    expect(eTLD1('localhost')).toBe('localhost');
  });
});

describe('urlFeatures', () => {
  it('extracts host, path tokens and query keys', () => {
    const f = urlFeatures('https://www.GitHub.com/acme/deploy-tool/pull/42?tab=files&x=1#top');
    expect(f.host).toBe('github.com');
    expect(f.eTLD1).toBe('github.com');
    expect(f.pathTokens).toEqual(['acme', 'deploy', 'tool', 'pull', '42']);
    expect(f.queryKeys).toEqual({ tab: 'files', x: '1' });
  });
  it('drops noise tokens', () => {
    expect(urlFeatures('https://a.com/index.html').pathTokens).toEqual([]);
  });
  it('tolerates junk', () => {
    expect(urlFeatures('not a url')).toEqual({ host: '', eTLD1: '', pathTokens: [], queryKeys: {} });
    expect(urlFeatures('chrome://newtab/').host).toBe('newtab');
  });
});

describe('reduceUrl', () => {
  it('keeps scheme, host and path only', () => {
    expect(reduceUrl('https://x.com/a/b?secret=1#frag')).toBe('https://x.com/a/b');
  });
});

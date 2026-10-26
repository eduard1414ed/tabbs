import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, sameUrl, completeUrl } from '../extension/lib/urls.js';

test('fragment is ignored', () => {
  assert.ok(sameUrl('https://example.com/page#top', 'https://example.com/page'));
  assert.ok(sameUrl('https://example.com/page#a', 'https://example.com/page#b'));
  assert.ok(sameUrl('https://example.com/#', 'https://example.com'));
  assert.ok(sameUrl('https://mail.google.com/mail/u/0/#inbox', 'https://mail.google.com/mail/u/0/#sent'));
});

test('trailing slash is ignored, also before the query', () => {
  assert.ok(sameUrl('https://example.com/', 'https://example.com'));
  assert.ok(sameUrl('https://example.com/docs/', 'https://example.com/docs'));
  assert.ok(sameUrl('https://example.com/docs/?q=1', 'https://example.com/docs?q=1'));
});

test('scheme and domain are case-insensitive', () => {
  assert.ok(sameUrl('HTTPS://Example.COM/page', 'https://example.com/page'));
  assert.ok(sameUrl('chrome://Settings/', 'chrome://settings'));
});

test('path, query, www and scheme must match exactly', () => {
  assert.ok(!sameUrl('https://example.com/Page', 'https://example.com/page'));
  assert.ok(!sameUrl('https://example.com/?q=1', 'https://example.com/?q=2'));
  assert.ok(!sameUrl('https://example.com/?a=1&b=2', 'https://example.com/?b=2&a=1'));
  assert.ok(!sameUrl('https://www.example.com/', 'https://example.com/'));
  assert.ok(!sameUrl('http://example.com/', 'https://example.com/'));
  assert.ok(!sameUrl('https://example.com/a', 'https://example.com/a/b'));
});

test('default port and percent-encoding are normalized by the URL parser', () => {
  assert.ok(sameUrl('https://example.com:443/', 'https://example.com/'));
  assert.ok(sameUrl('https://ru.wikipedia.org/wiki/Кот', 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%82'));
  assert.ok(sameUrl('https://пример.рф/', 'https://xn--e1afmkfd.xn--p1ai/'));
});

test('user info keeps its case, the host after it does not', () => {
  assert.equal(normalizeUrl('ftp://User@Example.com/x'), 'ftp://User@example.com/x');
});

test('invalid or empty addresses', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(undefined), '');
  assert.ok(!sameUrl('', ''));
  assert.ok(!sameUrl(undefined, undefined));
  assert.ok(sameUrl('not a url#x', 'not a url'));
  assert.ok(!sameUrl('not a url', 'https://example.com'));
});

test('special pages', () => {
  assert.ok(sameUrl('about:blank', 'about:blank'));
  assert.ok(sameUrl('helium://extensions/', 'helium://extensions'));
  assert.ok(!sameUrl('helium://extensions', 'helium://settings'));
});

test('completeUrl adds https:// to a bare address', () => {
  assert.equal(completeUrl('example.com'), 'https://example.com/');
  assert.equal(completeUrl('  www.example.com/docs?q=1#top '), 'https://www.example.com/docs?q=1#top');
  assert.equal(completeUrl('Example.COM/Path'), 'https://example.com/Path');
  assert.equal(completeUrl('192.168.1.1'), 'https://192.168.1.1/');
});

test('completeUrl treats host:port as an address, not a scheme', () => {
  assert.equal(completeUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(completeUrl('localhost'), 'https://localhost/');
  assert.equal(completeUrl('example.com:8080/admin'), 'https://example.com:8080/admin');
});

test('completeUrl keeps an address with its own scheme as is', () => {
  assert.equal(completeUrl('http://example.com'), 'http://example.com');
  assert.equal(completeUrl('https://vk.com/podcast'), 'https://vk.com/podcast');
  assert.equal(completeUrl('helium://extensions'), 'helium://extensions');
  assert.equal(completeUrl('about:blank'), 'about:blank');
  assert.equal(completeUrl('mailto:ed@example.com'), 'mailto:ed@example.com');
});

test('completeUrl rejects what is not an address', () => {
  assert.equal(completeUrl(''), null);
  assert.equal(completeUrl('   '), null);
  assert.equal(completeUrl(undefined), null);
  assert.equal(completeUrl('hello world'), null);
  assert.equal(completeUrl('example.com/a b'), null);
  assert.equal(completeUrl('podcast'), null);
  assert.equal(completeUrl('example.'), null);
  assert.equal(completeUrl('https://'), null);
});

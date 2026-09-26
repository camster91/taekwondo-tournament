import { describe, expect, it } from 'vitest';
import { decodeStrictBase64, sniffRasterImageType } from './image-sniff.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

describe('sniffRasterImageType', () => {
  it('detects PNG, JPEG, GIF and WebP from their signatures', () => {
    expect(sniffRasterImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png');
    expect(sniffRasterImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
    expect(sniffRasterImageType(ascii('GIF89a\u0001\u0000'))).toBe('image/gif');
    expect(sniffRasterImageType(ascii('GIF87a\u0001\u0000'))).toBe('image/gif');
    expect(sniffRasterImageType(ascii('RIFF$\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects SVG in every common spelling', () => {
    expect(sniffRasterImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffRasterImageType(ascii('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffRasterImageType(ascii('﻿<svg onload="alert(1)"/>'))).toBeNull();
    expect(sniffRasterImageType(ascii('   \n<svg/>'))).toBeNull();
  });

  it('rejects other active or unexpected content', () => {
    expect(sniffRasterImageType(ascii('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffRasterImageType(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffRasterImageType(ascii('RIFF$\u0000\u0000\u0000WAVEfmt '))).toBeNull();
    expect(sniffRasterImageType(ascii('BM'))).toBeNull();
    expect(sniffRasterImageType(bytes())).toBeNull();
  });

  it('does not match truncated signatures', () => {
    expect(sniffRasterImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffRasterImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffRasterImageType(ascii('RIFF1234WEB'))).toBeNull();
  });
});

describe('decodeStrictBase64', () => {
  it('decodes valid base64, tolerating whitespace/newlines', () => {
    expect(decodeStrictBase64('aGVs\nbG8=')?.toString()).toBe('hello');
  });

  it('rejects input Buffer.from would silently mangle', () => {
    expect(decodeStrictBase64('')).toBeNull();
    expect(decodeStrictBase64('<svg>')).toBeNull();
    expect(decodeStrictBase64('aGVsbG8')).toBeNull(); // bad length
    expect(decodeStrictBase64('aGV$bG8=')).toBeNull();
    expect(decodeStrictBase64('a===')).toBeNull();
  });
});

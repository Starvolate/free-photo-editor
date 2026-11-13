// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * QR codes. The codeword vectors are the worked examples of the QR code rules (version 1, levels M and Q), checked by
 * hand; the whole squares were made by a second, independent encoder (segno 1.6.6, mask and version forced) and stored
 * here as hex rows, so every module of ours is compared with someone else's. segno adds a whole zero byte when the bits
 * already end on a byte boundary, where the rules add none, so that one step followed the rules when the rows were made.
 */
import { describe, expect, it } from 'vitest';
import {
  qrCodewords, qrData, qrDataCodewords, qrDataModules, qrEncode, qrFormatBits, qrMode, qrPenalty, qrPixels, qrRepair, qrSubpaths, qrTotalCodewords,
  qrVersionBits, utf8, type QrLevel,
} from '../src/qr';

const REFS: { text: string; level: QrLevel; version: number; mask: number; rows: string[] }[] = [
  { text: "01234567", level: 'M', version: 1, mask: 0, rows: [
    '1fc77f', '105c41', '174c5d', '174b5d', '175b5d', '104241', '1fd57f', '000000', '154512', '1a16a2', '0376ee',
    '19abb2', '04eee1', '001442', '1fc111', '10444b', '175d5d', '174aae', '175ae5', '1043b8', '1fd2e5',
  ] },
  { text: "HELLO WORLD", level: 'Q', version: 1, mask: 6, rows: [
    '1fc27f', '105941', '174b5d', '175f5d', '175a5d', '104941', '1fd57f', '001b00', '0bd9da', '17a1ee', '056260',
    '168b18', '1bfddf', '001128', '1fcccf', '105497', '175a47', '175714', '174843', '105ce6', '1fca02',
  ] },
  { text: "HELLO WORLD 1234 $%*+-./: QR CODES IN FIVE", level: 'Q', version: 5, mask: 3, rows: [
    '1fcc6ad07f', '105838f641', '1759a68f5d', '174eab825d', '174166615d', '10476e1941', '1fd555557f', '00009ee100',
    '0ec89fd906', '18b7170fc5', '094c55d235', '0d8e54e6e9', '14c800f86a', '049d9f9dd1', '0e4120bb86', '1534b405cd',
    '127fe66efd', '1625edd3fb', '186c2cfe89', '171cbdded8', '127efcecc2', '1621e60b4b', '0953f24a7a', '05b378b056',
    '10fa20b781', '043f4124a2', '0a45d758fc', '1115a2cafb', '04e73b0dfa', '001d04171c', '1fc6be9756', '1050e37d15',
    '1749e07df5', '1754a15087', '175617f4ae', '105e55cd79', '1fc952c3fd',
  ] },
  { text: "https://bhaweshtibrewal.com/free-photo-editor/ seven", level: 'M', version: 7, mask: 2, rows: [
    '1fc4674ff17f', '104425f10a41', '175a6f43625d', '1753f5a8035d', '17503ff36f5d', '105039180841', '1fd55555557f',
    '001e631b4a00', '17cb1bf8ff7c', '16ae07bb511f', '0e4f5e1effee', '11a370bab1e4', '1d47be1920d1', '002a585bb3b8',
    '04dcc4e57fd3', '0e38bf4036c9', '16d225aa6c67', '0fa55fb0e7c6', '1cd2aa5aaa2c', '06b8d03d8a36', '0bfbabf4b3fc',
    '011d851c591d', '075515503156', '09191d19ad1e', '09f8f5fc0bfa', '07baaedba189', '11d711864d2e', '0aab7d1c50bc',
    '1fe3fe96eb5a', '033eb1204246', '1569de52ef2c', '0898f7eedb66', '08c1d345608c', '0b8d00affa28', '016a05b12383',
    '0f1a34136769', '134df1f84df7', '001c0911e71d', '1fce815a8b56', '105b6f134b1d', '175573f8f3f8', '175ca1b85127',
    '175bf317f694', '1049195ebc3c', '1fdac2652292',
  ] },
  { text: "Free Photo Editor: every function in one place, free. A beginner must become a pro while using it. Ten, H.", level: 'H', version: 10, mask: 5, rows: [
    '1fdf9b239d5667f', '10446f7c5558a41', '1750142afcbbe5d', '174b8cd684fb25d', '1755f6c7e3bf25d', '10426a8c5643441',
    '1fd55555555557f', '001157946dd8300', '00c44937dc43255', '00b0ee90a19474c', '1ede98dd84231ea', '0a25ef0522b51de',
    '0645d0f5ba53e1b', '17385370a48c99b', '12766dd27c6a06a', '14048f1f47e4d9e', '117a1b2d3484210', '1235f98dbd9fb17',
    '0ef01a78429028d', '0534d63eed0b7de', '12cb4b1e9e02049', '1d3f6f7ccdd7fe0', '05f923f36462d66', '15a4ee6ab725114',
    '1edb9183d7b7afb', '041109d823a6ba0', '0bfc4747e76edf2', '031a2a2459cc51d', '1b5f87054886954', '151a2484438c91d',
    '01f9450ffa9bbff', '0eb7469c2ad336e', '0c77db96e20e872', '1cadc75d8cd7cfc', '0e56a0fa22725b6', '0619a30d05d907f',
    '0250e5948799deb', '0c99bc82250ca85', '1c7dbcd9f461f0a', '0534b06f7647aff', '1564649241a4db2', '14b872e67b2eea1',
    '1f719ab1927fd55', '1b21653506df35c', '0c63d605e726853', '0c95b7510d77d38', '14d70af99741c1e', '1f3f959e0cdda7d',
    '007307dfdc91bf8', '001dbc147dcdb1d', '1fcde4157c20d5e', '1056801c7986b1d', '1744064fc466dfa', '1742579321be0f8',
    '174d4311fac499b', '104da9b02e49914', '1fc9e252dd52146',
  ] },
];
const hexRows = (dark: boolean[][]): string[] => dark.map((r) => BigInt('0b' + r.map((b) => (b ? '1' : '0')).join('')).toString(16).padStart(Math.ceil(r.length / 4), '0'));

describe('the codewords', () => {
  it('"01234567" at 1-M: 16 data codewords, then 10 repair codewords', () => {
    const data = qrData('01234567', 1, 'M');
    expect(data).toEqual([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
    expect(qrRepair(data!, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });
  it('"HELLO WORLD" at 1-Q: 13 data codewords in capitals mode, then 13 repair codewords', () => {
    expect(qrMode('HELLO WORLD')).toBe('alnum');
    const data = qrData('HELLO WORLD', 1, 'Q');
    expect(data).toEqual([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]);
    expect(qrRepair(data!, 13)).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
  });
  it('picks the smallest mode: digits, capitals and signs, or bytes (UTF-8)', () => {
    expect(qrMode('0123')).toBe('numeric');
    expect(qrMode('AB-12 $')).toBe('alnum');
    expect(qrMode('Hello')).toBe('byte');
    expect(qrData('é', 1, 'L')!.slice(0, 3)).toEqual([0x40, 0x2c, 0x3a]); // 0100, count 2, then C3 A9
    expect(utf8('aé€😀')).toEqual([0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  });
  it('each version holds as many codewords as it has free modules (26, 44, 70 … 346)', () => {
    const want = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    for (let v = 1; v <= 10; v++) {
      expect(qrTotalCodewords(v)).toBe(want[v - 1]);
      expect(Math.floor(qrDataModules(v) / 8)).toBe(want[v - 1]);
      for (const l of ['L', 'M', 'Q', 'H'] as const) expect(qrCodewords(new Array(qrDataCodewords(v, l)).fill(0), v, l).length).toBe(want[v - 1]);
    }
    expect(qrDataModules(1)).toBe(208);
    expect(qrDataModules(7)).toBe(1568);
  });
  it('format and version bits', () => {
    expect(qrFormatBits('M', 0).toString(2).padStart(15, '0')).toBe('101010000010010');
    expect(qrFormatBits('L', 0).toString(2).padStart(15, '0')).toBe('111011111000100');
    expect(qrVersionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });
});

describe('the whole square, module by module, against a second encoder', () => {
  for (const r of REFS) it(`${r.version}-${r.level}, mask ${r.mask}: "${r.text.slice(0, 24)}…"`, () => {
    const code = qrEncode(r.text, r.level, r.mask, r.version)!;
    expect(code.version).toBe(r.version);
    expect(code.size).toBe(17 + 4 * r.version);
    expect(hexRows(code.dark)).toEqual(r.rows);
  });
  it('without a mask, it takes the one with the lowest penalty', () => {
    const auto = qrEncode('HELLO WORLD', 'Q')!, scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => qrPenalty(qrEncode('HELLO WORLD', 'Q', m)!.dark));
    expect(scores[auto.mask]).toBe(Math.min(...scores));
  });
  it('takes the smallest version that holds the text, and gives up past version 10', () => {
    expect(qrEncode('01234567', 'M')!.version).toBe(1);
    expect(qrEncode('x'.repeat(100), 'L')!.version).toBe(5); // 5-L holds 108 bytes, 4-L only 80
    expect(qrEncode('x'.repeat(272), 'L')).toBeNull(); // 10-L holds 271 bytes after the mode and count
    expect(qrEncode('', 'M')).toBeNull();
  });
});

describe('outline and pixels', () => {
  const code = qrEncode('01234567', 'M', 0)!, dark = code.dark.flat().filter(Boolean).length;
  it('one rectangle per run of dark modules, covering exactly the dark modules', () => {
    const subs = qrSubpaths(code, 10, 20, 4);
    const runs = code.dark.reduce((n, row) => n + row.filter((b, i) => b && !row[i - 1]).length, 0);
    expect(subs.length).toBe(runs);
    const area = subs.reduce((n, s) => n + (s.anchors[1].x - s.anchors[0].x) * (s.anchors[2].y - s.anchors[1].y), 0);
    expect(area).toBe(dark * 16);
    expect(subs[0].anchors[0]).toMatchObject({ x: 10, y: 20 }); // the top-left corner target starts the first run
  });
  it('pixels: a light border 4 modules wide, then the corner target in dark', () => {
    const { width, data } = qrPixels(code, 3, 4, [0, 0, 0, 255], [255, 255, 255, 255]);
    expect(width).toBe((21 + 8) * 3);
    const px = (x: number, y: number): number => data[(y * width + x) * 4];
    expect(px(11, 11)).toBe(255); // inside the border
    expect(px(12, 12)).toBe(0); // the first module of the code
    expect(px(12 + 3, 12 + 3)).toBe(255); // the corner target's light ring
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from './XMLParser';

function xmltv(channels: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><tv>${channels}</tv>`;
}

test('XMLParser.parse extracts country/countryCode from an accented country name (no diacritic in the lookup map)', async () => {
  const xml = xmltv(`
    <channel id="UnivisionCanal5.mx">
      <display-name>México | Canal 5</display-name>
    </channel>
    <channel id="TNTSports1.uk">
      <display-name>UK | TNT Sports 1</display-name>
    </channel>
    <channel id="la_1">
      <display-name>La 1</display-name>
    </channel>
  `);

  const { channels } = await new XMLParser().parse(xml);

  const mx = channels.find((c) => c.id === 'UnivisionCanal5.mx');
  assert.equal(mx?.country, 'México');
  assert.equal(mx?.countryCode, 'MX');

  const uk = channels.find((c) => c.id === 'TNTSports1.uk');
  assert.equal(uk?.country, 'Reino Unido');
  assert.equal(uk?.countryCode, 'GB');

  // A channel with no recognizable country token stays untagged, not misclassified.
  const la1 = channels.find((c) => c.id === 'la_1');
  assert.equal(la1?.country, undefined);
  assert.equal(la1?.countryCode, undefined);
});

test('XMLParser.parse recognizes the "PT | …" / "DE | …" pipe-prefix convention (EPG_dobleM), not just full country names', async () => {
  const xml = xmltv(`
    <channel id="PT | Mezzo Live HD">
      <display-name>PT | Mezzo Live HD</display-name>
    </channel>
    <channel id="DE | Sportdigital FUSSBALL">
      <display-name>DE | Sportdigital FUSSBALL</display-name>
    </channel>
  `);

  const { channels } = await new XMLParser().parse(xml);

  const pt = channels.find((c) => c.id === 'PT | Mezzo Live HD');
  assert.equal(pt?.country, 'Portugal');
  assert.equal(pt?.countryCode, 'PT');

  const de = channels.find((c) => c.id === 'DE | Sportdigital FUSSBALL');
  assert.equal(de?.country, 'Alemania');
  assert.equal(de?.countryCode, 'DE');
});

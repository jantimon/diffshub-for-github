/**
 * Packs the Chrome zip as a CRX3 signed with the publisher's own key.
 *
 *   CHROME_UPLOAD_SIGNING_KEY="$(cat key.pem)" node scripts/release/sign-crx.mjs in.zip out.crx
 *
 * With verified uploads on, the Chrome Web Store accepts only packages signed
 * with the key registered for the item, so a stolen API credential alone cannot
 * ship an update. Written here, about sixty lines on `node:crypto`, rather than
 * taken from a package, so no third-party code ever holds the key.
 *
 * The format, from Chromium's `components/crx_file/crx3.proto`:
 *
 *   "Cr24" | uint32 3 | uint32 header length | CrxFileHeader | zip
 *
 *   CrxFileHeader {
 *     2:     AsymmetricKeyProof sha256_with_rsa { 1: public key (DER), 2: signature }
 *     10000: signed_header_data, a SignedData { 1: crx_id }
 *   }
 *
 * The crx_id is the first 16 bytes of the SHA-256 of the public key, and the
 * signature covers "CRX3 SignedData\x00", the length of signed_header_data,
 * signed_header_data, and the zip
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** A length-delimited protobuf field, the only wire type CRX3 uses */
function field(number, payload) {
  return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

export function signCrx(zip, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  const crxId = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId);

  const signature = crypto
    .createSign('sha256')
    .update(Buffer.from('CRX3 SignedData\x00', 'binary'))
    .update(uint32(signedHeaderData.length))
    .update(signedHeaderData)
    .update(zip)
    .sign(privateKey);

  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
    field(10000, signedHeaderData),
  ]);
  return Buffer.concat([Buffer.from('Cr24'), uint32(3), uint32(header.length), header, zip]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  const key = process.env.CHROME_UPLOAD_SIGNING_KEY;
  if (input == null || output == null || !key) {
    console.error(
      'usage: CHROME_UPLOAD_SIGNING_KEY=<pem> node scripts/release/sign-crx.mjs <in.zip> <out.crx>',
    );
    process.exit(1);
  }
  fs.writeFileSync(output, signCrx(fs.readFileSync(input), key));
  console.log(`signed ${input} -> ${output}`);
}

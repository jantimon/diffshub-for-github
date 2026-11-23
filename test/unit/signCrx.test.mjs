import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { signCrx } from '../../scripts/release/sign-crx.mjs';

/**
 * Reads the package back the way Chrome does: the header names a public key and
 * a signature, and the signature must hold over the signed data and the zip.
 * The output was checked byte for byte against the `crx3` package once, and this
 * keeps it honest after that
 */
test('a signed CRX3 verifies with its own public key', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const zip = Buffer.from('PK\x03\x04 not really a zip, but the bytes are what is signed');
  const crx = signCrx(zip, privateKey.export({ type: 'pkcs8', format: 'pem' }));

  assert.equal(crx.subarray(0, 4).toString(), 'Cr24');
  assert.equal(crx.readUInt32LE(4), 3);
  const headerLength = crx.readUInt32LE(8);
  assert.deepEqual(crx.subarray(12 + headerLength), zip, 'the zip follows the header unchanged');

  const header = crx.subarray(12, 12 + headerLength);
  const fields = readFields(header);
  const proof = readFields(fields.get(2));
  const publicKey = crypto.createPublicKey({ key: proof.get(1), format: 'der', type: 'spki' });
  const signedHeaderData = fields.get(10000);

  const crxId = readFields(signedHeaderData).get(1);
  const expectedId = crypto.createHash('sha256').update(proof.get(1)).digest().subarray(0, 16);
  assert.deepEqual(crxId, expectedId, 'the id comes from the public key');

  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  const signed = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'binary'), length, signedHeaderData, zip]);
  assert.ok(crypto.verify('sha256', signed, publicKey, proof.get(2)));
});

/** Length-delimited protobuf fields, by number. Enough for CRX3 */
function readFields(buffer) {
  const fields = new Map();
  let offset = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = buffer[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
      shift += 7;
    }
  };
  while (offset < buffer.length) {
    const number = Math.floor(varint() / 8);
    const length = varint();
    fields.set(number, buffer.subarray(offset, offset + length));
    offset += length;
  }
  return fields;
}
